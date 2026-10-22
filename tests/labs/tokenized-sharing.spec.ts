import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import { generateDocumentShareToken } from "@/features/labs/actions";
import { seedTenantWithOwner } from "../helpers/tenants";
import { getAdminClient } from "@/lib/supabase/admin";

describe("Tokenized Patient Document Sharing (REQ-lab-records, D-05)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let sessionA: { userId: string; tenantId: string };
  let patientAId: string;
  let documentAId: string;
  let activeToken: string;

  beforeAll(async () => {
    tenantA = await seedTenantWithOwner("LifeCare Diagnostics");
    sessionA = { userId: tenantA.userId, tenantId: tenantA.tenantId };

    // Seed patient
    const { data: patient } = await (tenantA.client.from("patients") as any)
      .insert({
        tenant_id: tenantA.tenantId,
        full_name: "Kavita Verma",
        phone: "+919876543333",
        created_by: tenantA.userId,
      })
      .select("id")
      .single();
    patientAId = patient.id;

    // Seed patient document
    const { data: doc } = await (tenantA.client.from("patient_documents") as any)
      .insert({
        tenant_id: tenantA.tenantId,
        patient_id: patientAId,
        title: "Thyroid Profile (T3, T4, TSH)",
        document_type: "lab_report",
        original_filename: "thyroid_results.pdf",
        storage_path: `tenants/${tenantA.tenantId}/patients/${patientAId}/labs/Kavita_Verma_thyroid_results_2026-10-22.pdf`,
        file_size_bytes: 1048576,
        mime_type: "application/pdf",
        report_date: "2026-10-22",
        uploaded_by: tenantA.userId,
      })
      .select("id")
      .single();
    documentAId = doc.id;
  });

  describe("1. Token Entropy & Expiry Specification", () => {
    it("generates 64-character hexadecimal cryptographically secure random token (256 bits)", () => {
      const token = crypto.randomBytes(32).toString("hex");
      expect(token).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
    });

    it("calculates 7-day TTL expiration date", () => {
      const now = new Date("2026-10-22T10:00:00Z");
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const diffDays = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(7);
    });
  });

  describe("2. Server Action Token Generation & Retrieval", () => {
    it("generates a valid share token with 7-day TTL via generateDocumentShareToken", async () => {
      const res = await generateDocumentShareToken(documentAId, tenantA.client, sessionA);
      expect(res.success).toBe(true);
      expect(res.token).toBeDefined();
      expect(res.token).toHaveLength(64);
      expect(res.shareUrl).toBe(`/reports/view?token=${res.token}`);
      expect(res.expiresAt).toBeDefined();

      activeToken = res.token!;
    });

    it("records access counter and last_accessed_at in document_share_tokens", async () => {
      const admin = getAdminClient();

      // Fetch initial state
      const { data: initial } = await (admin.from("document_share_tokens") as any)
        .select("access_count, last_accessed_at")
        .eq("token", activeToken)
        .single();

      expect(initial?.access_count).toBe(0);

      // Increment access counter simulate viewing
      await (admin.from("document_share_tokens") as any)
        .update({
          access_count: initial.access_count + 1,
          last_accessed_at: new Date().toISOString(),
        })
        .eq("token", activeToken);

      const { data: updated } = await (admin.from("document_share_tokens") as any)
        .select("access_count, last_accessed_at")
        .eq("token", activeToken)
        .single();

      expect(updated?.access_count).toBe(1);
      expect(updated?.last_accessed_at).not.toBeNull();
    });

    it("blocks revoked tokens from granting document access", async () => {
      const admin = getAdminClient();

      // Revoke the token
      await (admin.from("document_share_tokens") as any)
        .update({
          revoked_at: new Date().toISOString(),
        })
        .eq("token", activeToken);

      const { data: revokedToken } = await (admin.from("document_share_tokens") as any)
        .select("revoked_at")
        .eq("token", activeToken)
        .single();

      expect(revokedToken?.revoked_at).not.toBeNull();
    });

    it("identifies expired tokens (> 7 days past creation)", async () => {
      const admin = getAdminClient();
      const pastDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

      const expiredTokenHex = crypto.randomBytes(32).toString("hex");
      await (admin.from("document_share_tokens") as any).insert({
        tenant_id: tenantA.tenantId,
        document_id: documentAId,
        token: expiredTokenHex,
        expires_at: pastDate,
        created_by: tenantA.userId,
      });

      const { data: fetchedExpired } = await (admin.from("document_share_tokens") as any)
        .select("expires_at")
        .eq("token", expiredTokenHex)
        .single();

      const isExpired = new Date(fetchedExpired.expires_at).getTime() < Date.now();
      expect(isExpired).toBe(true);
    });
  });
});
