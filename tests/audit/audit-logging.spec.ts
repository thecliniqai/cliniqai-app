import { randomUUID } from "node:crypto";
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
    // 1. Register the patient through the command (V2-08 08-06a, S-8: `authenticated` holds no INSERT on patients any more); the
    //    command writes the patient.create audit row in the same transaction.
    const { data: registered, error: pError } = await tenantA.client.rpc("register_patient", {
      p_tenant_id: tenantA.tenantId,
      p_patient: { full_name: "Rahul Verma", phone: "9876543210", age: 40 },
      p_client_request_id: randomUUID(),
    } as never);
    expect(pError).toBeNull();
    const newPatient = { id: (registered as { patient_id: string }).patient_id };
    expect(newPatient.id).toBeDefined();

    // 2. A member cannot write the audit row directly (V2-05 05-02c, R-20: INSERT on audit_logs is revoked)
    const { error: directError } = await (tenantA.client.from("audit_logs") as any).insert({
      tenant_id: tenantA.tenantId,
      actor_id: tenantA.userId,
      actor_role: "owner",
      action: "patient.create",
      entity_type: "patient",
      entity_id: newPatient.id,
    });
    expect(directError?.code).toBe("42501");

    // 3. Verify audit log exists
    const { data: auditRows } = await (tenantA.client.from("audit_logs") as any)
      .select("*")
      .eq("tenant_id", tenantA.tenantId)
      .eq("entity_id", newPatient.id);

    expect(auditRows?.length).toBe(1);
    expect(auditRows?.[0].action).toBe("patient.create");
    expect(auditRows?.[0].actor_id).toBe(tenantA.userId);
    expect(auditRows?.[0].actor_role).toBe("owner");
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
