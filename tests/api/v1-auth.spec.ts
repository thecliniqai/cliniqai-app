import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { authenticateApiKey, createApiKeySecret } from "@/lib/api/auth";
import { GET, POST } from "@/app/api/v1/patients/route";
import { seedTenantWithOwner } from "../helpers/tenants";
import { getAdminClient } from "@/lib/supabase/admin";

describe("API v1 Authentication & Tenant Isolation (REQ-api-access, D-01, D-02)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let keyA: { rawToken: string; keyPrefix: string; keyHash: string; id: string };
  let keyB: { rawToken: string; keyPrefix: string; keyHash: string; id: string };

  beforeAll(async () => {
    const admin = getAdminClient();
    tenantA = await seedTenantWithOwner("API Alpha Clinic");
    tenantB = await seedTenantWithOwner("API Beta Clinic");

    // Create Key for Tenant A
    const secretA = createApiKeySecret();
    const { data: keyRecordA, error: errA } = await admin
      .from("api_keys")
      .insert({
        tenant_id: tenantA.tenantId,
        name: "Test Key Alpha",
        key_prefix: secretA.keyPrefix,
        key_hash: secretA.keyHash,
        created_by: tenantA.userId,
      })
      .select("id")
      .single();
    if (errA || !keyRecordA) throw new Error(`Failed to create key A: ${errA?.message}`);
    keyA = { ...secretA, id: keyRecordA.id };

    // Create Key for Tenant B
    const secretB = createApiKeySecret();
    const { data: keyRecordB, error: errB } = await admin
      .from("api_keys")
      .insert({
        tenant_id: tenantB.tenantId,
        name: "Test Key Beta",
        key_prefix: secretB.keyPrefix,
        key_hash: secretB.keyHash,
        created_by: tenantB.userId,
      })
      .select("id")
      .single();
    if (errB || !keyRecordB) throw new Error(`Failed to create key B: ${errB?.message}`);
    keyB = { ...secretB, id: keyRecordB.id };
  });

  describe("1. Header & Format Validation", () => {
    it("rejects requests missing the Authorization header with 401", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/patients", {
        method: "GET",
      });

      const res = await GET(req);
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe("UNAUTHORIZED");
      expect(json.error.message).toContain("Authorization header");
    });

    it("rejects requests without Bearer scheme with 401", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/patients", {
        method: "GET",
        headers: {
          authorization: "Basic 12345",
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
    });

    it("rejects keys without clq_live_ prefix with 401", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/patients", {
        method: "GET",
        headers: {
          authorization: "Bearer invalid_prefix_9876543210abcdef",
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
      expect(json.error.message).toContain("Invalid API key format");
    });

    it("rejects nonexistent or forged API tokens with 401", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/patients", {
        method: "GET",
        headers: {
          authorization: "Bearer clq_live_000000000000000000000000000000000000000000000000",
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
      expect(json.error.message).toContain("Invalid or revoked");
    });
  });

  describe("2. Revocation & State Handling", () => {
    it("rejects revoked API keys immediately with 401", async () => {
      const admin = getAdminClient();
      const secret = createApiKeySecret();
      const { data: revokedKey } = await admin
        .from("api_keys")
        .insert({
          tenant_id: tenantA.tenantId,
          name: "Revoked Key",
          key_prefix: secret.keyPrefix,
          key_hash: secret.keyHash,
          created_by: tenantA.userId,
          revoked_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      expect(revokedKey).toBeDefined();

      const req = new NextRequest("http://localhost:3000/api/v1/patients", {
        method: "GET",
        headers: {
          authorization: `Bearer ${secret.rawToken}`,
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("3. Authenticated Session & Usage Tracking", () => {
    it("authenticates valid token, returns creator userId, and records usage counters", async () => {
      const admin = getAdminClient();
      const req = new NextRequest("http://localhost:3000/api/v1/patients", {
        method: "GET",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
        },
      });

      const authResult = await authenticateApiKey(getAdminClient(), req);
      expect(authResult.success).toBe(true);
      if (!authResult.success) return;

      expect(authResult.session.tenantId).toBe(tenantA.tenantId);
      expect(authResult.session.userId).toBe(tenantA.userId);
      expect(authResult.session.role).toBe("admin");

      // Verify last_used_at on api_keys
      const { data: updatedKey } = await admin
        .from("api_keys")
        .select("last_used_at")
        .eq("id", keyA.id)
        .single();

      expect(updatedKey?.last_used_at).not.toBeNull();

      // Verify daily usage record
      const today = new Date().toISOString().split("T")[0];
      const { data: dailyUsage } = await admin
        .from("api_key_usage_daily")
        .select("request_count")
        .eq("api_key_id", keyA.id)
        .eq("date", today)
        .single();

      expect(dailyUsage).toBeDefined();
      expect(dailyUsage?.request_count).toBeGreaterThanOrEqual(1);
    });
  });

  describe("4. Tenant Isolation Enforcement", () => {
    it("proves API key for Tenant A cannot access Tenant B patient records", async () => {
      const admin = getAdminClient();

      // Create Patient in Tenant A
      const { data: patientA } = await admin
        .from("patients")
        .insert({
          tenant_id: tenantA.tenantId,
          full_name: "Patient Belongs To Alpha",
          phone: "9876543210",
          created_by: tenantA.userId,
        })
        .select("id, full_name")
        .single();

      // Create Patient in Tenant B
      const { data: patientB } = await admin
        .from("patients")
        .insert({
          tenant_id: tenantB.tenantId,
          full_name: "Patient Belongs To Beta",
          phone: "9876543211",
          created_by: tenantB.userId,
        })
        .select("id, full_name")
        .single();

      // Query with Key A
      const reqA = new NextRequest("http://localhost:3000/api/v1/patients", {
        method: "GET",
        headers: {
          authorization: `Bearer ${keyA.rawToken}`,
        },
      });

      const resA = await GET(reqA);
      expect(resA.status).toBe(200);
      const jsonA = await resA.json();

      const alphaPatientIds = jsonA.data.map((p: { id: string }) => p.id);
      expect(alphaPatientIds).toContain(patientA?.id);
      expect(alphaPatientIds).not.toContain(patientB?.id);

      // Query with Key B
      const reqB = new NextRequest("http://localhost:3000/api/v1/patients", {
        method: "GET",
        headers: {
          authorization: `Bearer ${keyB.rawToken}`,
        },
      });

      const resB = await GET(reqB);
      expect(resB.status).toBe(200);
      const jsonB = await resB.json();

      const betaPatientIds = jsonB.data.map((p: { id: string }) => p.id);
      expect(betaPatientIds).toContain(patientB?.id);
      expect(betaPatientIds).not.toContain(patientA?.id);
    });
  });
});
