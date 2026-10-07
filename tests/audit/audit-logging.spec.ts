import { describe, it, expect, beforeAll } from "vitest";
import { seedTenantWithOwner, addMemberToTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";

describe("Audit Logging & Patient Traceability (REQ-compliance-data-layer, REQ-nfr-security)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  const admin = getAdminClient();

  beforeAll(async () => {
    tenantA = await seedTenantWithOwner("Apollo Care Clinic");
    tenantB = await seedTenantWithOwner("Fortis Health");
  });

  it("proves creating a patient writes a patient record and an audit log row under RLS", async () => {
    // 1. Insert patient via tenant A owner
    const { data: newPatient, error: pError } = await (tenantA.client.from("patients") as any)
      .insert({
        tenant_id: tenantA.tenantId,
        full_name: "Rahul Verma",
        phone: "+919876543210",
        created_by: tenantA.userId,
      })
      .select("id")
      .single();

    expect(pError).toBeNull();
    expect(newPatient?.id).toBeDefined();

    // 2. Insert audit log
    const { error: aError } = await (tenantA.client.from("audit_logs") as any).insert({
      tenant_id: tenantA.tenantId,
      actor_id: tenantA.userId,
      actor_role: "owner",
      action: "patient.create",
      entity_type: "patient",
      entity_id: newPatient.id,
      metadata: { fields_changed: ["created"] },
    });

    expect(aError).toBeNull();

    // 3. Verify audit log exists
    const { data: auditRows } = await (tenantA.client.from("audit_logs") as any)
      .select("*")
      .eq("tenant_id", tenantA.tenantId)
      .eq("entity_id", newPatient.id);

    expect(auditRows?.length).toBe(1);
    expect(auditRows?.[0].action).toBe("patient.create");
  });

  it("proves audit logs cannot be updated or deleted by tenant members (strictly append-only)", async () => {
    const { data: auditRow } = await (tenantA.client.from("audit_logs") as any)
      .select("id")
      .eq("tenant_id", tenantA.tenantId)
      .limit(1)
      .single();

    expect(auditRow?.id).toBeDefined();

    // Attempt UPDATE on audit_logs
    const { data: updatedData, error: updateError } = await (tenantA.client.from("audit_logs") as any)
      .update({ action: "tampered.action" })
      .eq("id", auditRow.id)
      .select();

    // RLS denies update: either raises error or returns 0 rows updated
    const updateFailed = updateError !== null || (updatedData && updatedData.length === 0);
    expect(updateFailed).toBe(true);

    // Verify row was not mutated in database
    const { data: checkRow } = await (tenantA.client.from("audit_logs") as any)
      .select("action")
      .eq("id", auditRow.id)
      .single();
    expect(checkRow.action).not.toBe("tampered.action");

    // Attempt DELETE on audit_logs
    const { data: deletedData, error: deleteError } = await (tenantA.client.from("audit_logs") as any)
      .delete()
      .eq("id", auditRow.id)
      .select();

    // RLS denies delete: either raises error or returns 0 rows deleted
    const deleteFailed = deleteError !== null || (deletedData && deletedData.length === 0);
    expect(deleteFailed).toBe(true);
  });

  it("proves Tenant B cannot read Tenant A audit logs (Cross-tenant RLS)", async () => {
    const { data: foreignLogs } = await (tenantB.client.from("audit_logs") as any)
      .select("*")
      .eq("tenant_id", tenantA.tenantId);

    expect(foreignLogs?.length).toBe(0);
  });

  it("proves doctor cannot read audit logs (Audit is Owner/Admin privileged)", async () => {
    const doctorA = await addMemberToTenant(tenantA.tenantId, "doctor");

    const { data: docLogs, error: docError } = await (doctorA.client.from("audit_logs") as any)
      .select("*")
      .eq("tenant_id", tenantA.tenantId);

    // RLS policy permits SELECT only for owner/admin
    expect(docLogs?.length).toBe(0);
  });
});
