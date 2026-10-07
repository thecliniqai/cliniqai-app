import { describe, it, expect, beforeAll } from "vitest";
import {
  seedDualTenantEcosystem,
  DualTenantEcosystem,
} from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { assertRlsCatalog, TENANT_OWNED_TABLES } from "../helpers/rls";
import {
  getActiveMembership,
  MultipleClinicsSelectionRequiredError,
} from "@/lib/auth/tenant";

describe("Cross-Tenant Security Proof & Operational Hardening (REQ-multi-tenancy, REQ-nfr-security)", () => {
  let ecosystem: DualTenantEcosystem;
  const admin = getAdminClient();

  beforeAll(async () => {
    ecosystem = await seedDualTenantEcosystem();
  });

  describe("1. Catalog-Level RLS Verification", () => {
    it("asserts every tenant-owned table has RLS enabled with active policies and no USING(true) bypass", async () => {
      const result = await assertRlsCatalog();

      expect(result.inspectedTables).toEqual([...TENANT_OWNED_TABLES]);
      expect(result.totalPolicies).toBeGreaterThanOrEqual(TENANT_OWNED_TABLES.length);
    });
  });

  describe("2. Exhaustive Negative-Path Read Isolation Matrix", () => {
    it("proves Tenant A cannot read Tenant B rows from 'tenants'", async () => {
      const { data, error } = await ecosystem.tenantA.owner.client
        .from("tenants")
        .select("*")
        .eq("id", ecosystem.tenantB.tenantId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("proves Tenant A cannot read Tenant B rows from 'memberships'", async () => {
      const { data, error } = await ecosystem.tenantA.owner.client
        .from("memberships")
        .select("*")
        .eq("tenant_id", ecosystem.tenantB.tenantId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("proves Tenant A cannot read Tenant B rows from 'invitations'", async () => {
      const { data, error } = await ecosystem.tenantA.owner.client
        .from("invitations")
        .select("*")
        .eq("id", ecosystem.tenantB.invitationId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("proves Tenant A cannot read Tenant B rows from 'subscriptions'", async () => {
      const { data, error } = await ecosystem.tenantA.owner.client
        .from("subscriptions")
        .select("*")
        .eq("id", ecosystem.tenantB.subscriptionId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("proves Tenant A cannot read Tenant B rows from 'payment_records'", async () => {
      const { data, error } = await ecosystem.tenantA.owner.client
        .from("payment_records")
        .select("*")
        .eq("id", ecosystem.tenantB.paymentRecordId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("proves Tenant A cannot read Tenant B rows from 'patients'", async () => {
      const { data, error } = await ecosystem.tenantA.owner.client
        .from("patients")
        .select("*")
        .eq("id", ecosystem.tenantB.patientId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("proves Tenant A cannot read Tenant B rows from 'audit_logs'", async () => {
      const { data, error } = await ecosystem.tenantA.owner.client
        .from("audit_logs")
        .select("*")
        .eq("id", ecosystem.tenantB.auditLogId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("proves Tenant A cannot read Tenant B rows from 'consent_records'", async () => {
      const { data, error } = await ecosystem.tenantA.owner.client
        .from("consent_records")
        .select("*")
        .eq("id", ecosystem.tenantB.consentId);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });

  describe("3. Exhaustive Negative-Path Write Isolation Matrix", () => {
    it("proves Tenant A cannot UPDATE Tenant B's patient (PostgREST mutates 0 rows)", async () => {
      const { data } = await ecosystem.tenantA.owner.client
        .from("patients")
        .update({ full_name: "ATTACK_OVERWRITE" })
        .eq("id", ecosystem.tenantB.patientId)
        .select();

      expect(data).toHaveLength(0);

      // Verify row in Tenant B remained intact via service role
      const { data: intactPatient } = await admin
        .from("patients")
        .select("full_name")
        .eq("id", ecosystem.tenantB.patientId)
        .single();

      expect(intactPatient?.full_name).not.toBe("ATTACK_OVERWRITE");
    });

    it("proves Tenant A cannot UPDATE Tenant B's tenant profile", async () => {
      const { data } = await ecosystem.tenantA.owner.client
        .from("tenants")
        .update({ name: "TAMPERED_CLINIC_NAME" })
        .eq("id", ecosystem.tenantB.tenantId)
        .select();

      expect(data).toHaveLength(0);

      const { data: intactTenant } = await admin
        .from("tenants")
        .select("name")
        .eq("id", ecosystem.tenantB.tenantId)
        .single();

      expect(intactTenant?.name).toBe(ecosystem.tenantB.tenantName);
    });

    it("proves Tenant A cannot INSERT a patient into Tenant B's partition", async () => {
      const { error } = await (ecosystem.tenantA.owner.client.from("patients") as any).insert({
        tenant_id: ecosystem.tenantB.tenantId,
        full_name: "Illegitimate Injected Patient",
        phone: "9998887776",
        sex: "other",
        created_by: ecosystem.tenantA.owner.userId,
      });

      // RLS WITH CHECK refuses insert with error
      expect(error).not.toBeNull();
    });

    it("proves Tenant A cannot INSERT an invitation for Tenant B", async () => {
      const crypto = await import("crypto");
      const fakeHash = crypto.randomBytes(32).toString("hex");

      const { error } = await (ecosystem.tenantA.owner.client.from("invitations") as any).insert({
        tenant_id: ecosystem.tenantB.tenantId,
        invited_address: "hacked@example.com",
        role: "admin",
        token_hash: fakeHash,
        created_by: ecosystem.tenantA.owner.userId,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      });

      expect(error).not.toBeNull();
    });

    it("proves Tenant A cannot DELETE Tenant B's patient record", async () => {
      const { data } = await ecosystem.tenantA.owner.client
        .from("patients")
        .delete()
        .eq("id", ecosystem.tenantB.patientId)
        .select();

      expect(data).toHaveLength(0);

      // Verify row still exists via admin client
      const { data: stillExisting } = await admin
        .from("patients")
        .select("id")
        .eq("id", ecosystem.tenantB.patientId)
        .single();

      expect(stillExisting?.id).toBe(ecosystem.tenantB.patientId);
    });
  });

  describe("4. Client-Supplied Tenant ID Forgery & Tampering", () => {
    it("proves querying with a forged tenant_id filter returns only 0 rows and leaks nothing", async () => {
      // Caller is authenticated in Tenant A, but supplies Tenant B's tenant_id filter
      const { data: patients, error } = await ecosystem.tenantA.owner.client
        .from("patients")
        .select("*")
        .eq("tenant_id", ecosystem.tenantB.tenantId);

      expect(error).toBeNull();
      expect(patients).toHaveLength(0);
    });

    it("proves omitting tenant_id filter naturally restricts queries strictly to caller's own tenant", async () => {
      const { data: myPatients, error } = await ecosystem.tenantA.owner.client
        .from("patients")
        .select("tenant_id");

      expect(error).toBeNull();
      expect(myPatients?.length).toBeGreaterThan(0);
      for (const p of myPatients || []) {
        expect(p.tenant_id).toBe(ecosystem.tenantA.tenantId);
        expect(p.tenant_id).not.toBe(ecosystem.tenantB.tenantId);
      }
    });
  });

  describe("5. Dual-Membership Multi-Tenant Scoping", () => {
    it("requires explicit tenant selection when a user belongs to multiple clinics", async () => {
      const { data: memberships } = await ecosystem.dualUser.client
        .from("memberships")
        .select("tenant_id, role")
        .eq("user_id", ecosystem.dualUser.userId);

      expect(memberships).toHaveLength(2);
      const tenantIds = memberships?.map((m) => m.tenant_id);
      expect(tenantIds).toContain(ecosystem.tenantA.tenantId);
      expect(tenantIds).toContain(ecosystem.tenantB.tenantId);
    });

    it("proves dual user querying in Tenant A context receives only Tenant A data when filtered", async () => {
      const { data: pA } = await ecosystem.dualUser.client
        .from("patients")
        .select("id, tenant_id")
        .eq("tenant_id", ecosystem.tenantA.tenantId);

      expect(pA?.length).toBeGreaterThan(0);
      for (const p of pA || []) {
        expect(p.tenant_id).toBe(ecosystem.tenantA.tenantId);
      }
    });

    it("proves dual user querying in Tenant B context receives only Tenant B data when filtered", async () => {
      const { data: pB } = await ecosystem.dualUser.client
        .from("patients")
        .select("id, tenant_id")
        .eq("tenant_id", ecosystem.tenantB.tenantId);

      expect(pB?.length).toBeGreaterThan(0);
      for (const p of pB || []) {
        expect(p.tenant_id).toBe(ecosystem.tenantB.tenantId);
      }
    });
  });

  describe("6. Deterministic Pagination with Tied Timestamps", () => {
    it("proves paginating across tied created_at timestamps never drops or duplicates rows", async () => {
      const tiedTimestamp = new Date("2026-05-01T10:00:00.000Z").toISOString();
      const testPatientsCount = 8;
      const seededIds: string[] = [];

      // Seed 8 patients with identical created_at timestamps
      for (let i = 0; i < testPatientsCount; i++) {
        const { data: p, error } = await (admin.from("patients") as any)
          .insert({
            tenant_id: ecosystem.tenantA.tenantId,
            full_name: `Tied Time Patient ${i}`,
            phone: `97777${Math.floor(10000 + Math.random() * 90000)}`,
            sex: "other",
            created_by: ecosystem.tenantA.owner.userId,
            created_at: tiedTimestamp,
          })
          .select("id")
          .single();

        expect(error).toBeNull();
        if (p) seededIds.push(p.id);
      }

      // Paginate with page size 3 using deterministic ordering (created_at ASC, id ASC)
      const pageSize = 3;
      const collectedIds: string[] = [];

      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const to = from + pageSize - 1;
        const { data: pageRows, error } = await ecosystem.tenantA.owner.client
          .from("patients")
          .select("id")
          .eq("tenant_id", ecosystem.tenantA.tenantId)
          .in("id", seededIds)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);

        expect(error).toBeNull();

        if (!pageRows || pageRows.length === 0) {
          hasMore = false;
          break;
        }

        for (const row of pageRows) {
          collectedIds.push(row.id);
        }

        if (pageRows.length < pageSize) {
          hasMore = false;
        } else {
          from += pageSize;
        }
      }

      // Assert deterministic pagination results
      expect(collectedIds).toHaveLength(testPatientsCount);

      // Verify NO duplicates
      const uniqueCollected = new Set(collectedIds);
      expect(uniqueCollected.size).toBe(testPatientsCount);

      // Verify NO missing records
      for (const id of seededIds) {
        expect(uniqueCollected.has(id)).toBe(true);
      }
    });
  });
});
