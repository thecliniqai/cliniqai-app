import { describe, it, expect, beforeAll } from "vitest";
import { seedTenantWithOwner } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";

describe("Immutable Append-Only Consent Records (REQ-compliance-data-layer)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let patientId: string;
  const admin = getAdminClient();

  beforeAll(async () => {
    tenantA = await seedTenantWithOwner("Narayana Clinic");
    tenantB = await seedTenantWithOwner("Max Healthcare");

    // Seed patient in Tenant A
    const { data: p } = await (tenantA.client.from("patients") as any)
      .insert({
        tenant_id: tenantA.tenantId,
        full_name: "Pooja Hegde",
        phone: "+919876543210",
        created_by: tenantA.userId,
      })
      .select("id")
      .single();

    patientId = p.id;
  });

  it("appends a consent grant record and ensures it cannot be updated in-place", async () => {
    // 1. Grant consent
    const { data: grantRow, error: gError } = await (tenantA.client.from("consent_records") as any)
      .insert({
        tenant_id: tenantA.tenantId,
        patient_id: patientId,
        consent_type: "treatment",
        status: "granted",
        recorded_by: tenantA.userId,
        note: "Initial treatment consent",
      })
      .select("*")
      .single();

    expect(gError).toBeNull();
    expect(grantRow.status).toBe("granted");

    // 2. Attempt in-place UPDATE on the granted row
    const { data: updatedData, error: updateError } = await (tenantA.client.from("consent_records") as any)
      .update({ status: "withdrawn" })
      .eq("id", grantRow.id)
      .select();

    // Blocked by RLS (no UPDATE policy on consent_records)
    const updateFailed = updateError !== null || (updatedData && updatedData.length === 0);
    expect(updateFailed).toBe(true);

    // 3. Verify original row is byte-identical
    const { data: refetched } = await (tenantA.client.from("consent_records") as any)
      .select("*")
      .eq("id", grantRow.id)
      .single();

    expect(refetched.status).toBe("granted");
    expect(refetched.note).toBe("Initial treatment consent");
    expect(refetched.note).toBe("Initial treatment consent");
  });

  it("records withdrawal as an immutable append leaving original grant intact", async () => {
    // Append withdrawal row
    const { data: withdrawRow, error: wError } = await (tenantA.client.from("consent_records") as any)
      .insert({
        tenant_id: tenantA.tenantId,
        patient_id: patientId,
        consent_type: "treatment",
        status: "withdrawn",
        recorded_by: tenantA.userId,
        note: "Patient revoked treatment consent",
      })
      .select("*")
      .single();

    expect(wError).toBeNull();
    expect(withdrawRow.status).toBe("withdrawn");

    // Assert there are now exactly two rows in the consent history
    const { data: history } = await (tenantA.client.from("consent_records") as any)
      .select("*")
      .eq("patient_id", patientId)
      .eq("consent_type", "treatment")
      .order("recorded_at", { ascending: false })
      .order("id", { ascending: false });

    expect(history.length).toBe(2);
    expect(history[0].status).toBe("withdrawn"); // Latest
    expect(history[1].status).toBe("granted");   // Previous intact
  });

  it("blocks Tenant B from recording or reading Tenant A consent records", async () => {
    // Cross-tenant read
    const { data: foreignConsents } = await (tenantB.client.from("consent_records") as any)
      .select("*")
      .eq("patient_id", patientId);

    expect(foreignConsents.length).toBe(0);

    // Cross-tenant write
    const { error: foreignWriteError } = await (tenantB.client.from("consent_records") as any)
      .insert({
        tenant_id: tenantA.tenantId,
        patient_id: patientId,
        consent_type: "treatment",
        status: "withdrawn",
        recorded_by: tenantB.userId,
      });

    expect(foreignWriteError).not.toBeNull();
  });
});
