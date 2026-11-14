import { describe, it, expect, beforeAll } from "vitest";
import { seedTenantWithOwner } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";

describe("Visits & Queue Data Layer (REQ-patient-records, REQ-appointment-booking, REQ-multi-tenancy)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  const admin = getAdminClient();

  let patientA1Id: string;
  let patientA2Id: string;
  let visitA1Id: string;
  let visitA2Id: string;

  beforeAll(async () => {
    // Seed two independent tenant clinics
    tenantA = await seedTenantWithOwner("Apex Health Clinic");
    tenantB = await seedTenantWithOwner("Beacon Care Hospital");

    // Create 2 test patients for Tenant A via tenantA client
    const { data: p1, error: p1Err } = await tenantA.client
      .from("patients")
      .insert({
        tenant_id: tenantA.tenantId,
        full_name: "Rahul Sharma",
        phone: "+919876543210",
        age: 35,
        created_by: tenantA.userId,
      })
      .select("id")
      .single();

    if (p1Err || !p1) throw new Error(`Failed to seed patient A1: ${p1Err?.message}`);
    patientA1Id = p1.id;

    const { data: p2, error: p2Err } = await tenantA.client
      .from("patients")
      .insert({
        tenant_id: tenantA.tenantId,
        full_name: "Pooja Verma",
        phone: "+919876543211",
        age: 28,
        created_by: tenantA.userId,
      })
      .select("id")
      .single();

    if (p2Err || !p2) throw new Error(`Failed to seed patient A2: ${p2Err?.message}`);
    patientA2Id = p2.id;
  });

  it("1. Tenant A owner can create a visit and check in patient, receiving sequential token #1", async () => {
    // 1. Create visit for patient 1
    const { data: v1, error: v1Err } = await tenantA.client
      .from("visits")
      .insert({
        tenant_id: tenantA.tenantId,
        patient_id: patientA1Id,
        doctor_id: tenantA.userId,
        origin_type: "scheduled",
        scheduled_at: new Date().toISOString(),
        estimated_duration_minutes: 15,
        reason_for_visit: "General Checkup",
        created_by: tenantA.userId,
      })
      .select("id, status, origin_type")
      .single();

    expect(v1Err).toBeNull();
    expect(v1).not.toBeNull();
    expect(v1?.status).toBe("booked");
    visitA1Id = v1!.id;

    // 2. Check in through the token RPC (V2-05 05-11a, M-TOKEN): it issues the clinic day's next number and writes the
    // queue_tokens row itself; a member holds no INSERT privilege on queue_tokens.
    const { data: issued, error: rpcErr } = await tenantA.client.rpc("issue_queue_token", { p_visit_id: visitA1Id });

    expect(rpcErr).toBeNull();
    expect(issued?.[0]).toMatchObject({ token_number: 1, reused: false });

    // 3. The token row exists; a member cannot write one directly (a forged number once stopped the day's check-ins).
    const { data: tokenRow } = await tenantA.client
      .from("queue_tokens")
      .select("id, token_number, priority, date")
      .eq("visit_id", visitA1Id)
      .single();
    expect(tokenRow).toMatchObject({ token_number: 1, priority: "normal", date: issued?.[0]?.token_date });

    const { error: forgedErr } = await tenantA.client.from("queue_tokens").insert({
      tenant_id: tenantA.tenantId,
      visit_id: visitA1Id,
      date: issued![0].token_date,
      token_number: 2147483647,
      priority: "normal",
    });
    expect(forgedErr?.code).toBe("42501");

    // 4. Update visit status to waiting
    const { error: updateErr } = await tenantA.client
      .from("visits")
      .update({ status: "waiting" })
      .eq("id", visitA1Id);

    expect(updateErr).toBeNull();

    // Verify visit updated
    const { data: refreshedVisit } = await tenantA.client
      .from("visits")
      .select("status")
      .eq("id", visitA1Id)
      .single();

    expect(refreshedVisit?.status).toBe("waiting");
  });

  it("2. Checking in a second patient receives sequential token #2 on the same day", async () => {
    // 1. Create walk-in visit for patient 2
    const { data: v2, error: v2Err } = await tenantA.client
      .from("visits")
      .insert({
        tenant_id: tenantA.tenantId,
        patient_id: patientA2Id,
        doctor_id: tenantA.userId,
        origin_type: "walk_in",
        status: "waiting",
        estimated_duration_minutes: 15,
        reason_for_visit: "Acute fever",
        created_by: tenantA.userId,
      })
      .select("id, status, origin_type")
      .single();

    expect(v2Err).toBeNull();
    expect(v2).not.toBeNull();
    visitA2Id = v2!.id;

    // 2. Check in through the token RPC with priority "urgent" (05-11a)
    const { data: issued, error: rpcErr } = await tenantA.client.rpc("issue_queue_token", {
      p_visit_id: visitA2Id,
      p_priority: "urgent",
    });

    expect(rpcErr).toBeNull();
    expect(issued?.[0]).toMatchObject({ token_number: 2, reused: false });

    const { data: tokenRow } = await tenantA.client
      .from("queue_tokens")
      .select("id, token_number, priority")
      .eq("visit_id", visitA2Id)
      .single();
    expect(tokenRow?.token_number).toBe(2);
    expect(tokenRow?.priority).toBe("urgent");
  });

  it("3. Proves Tenant B cannot read Tenant A visits or queue tokens under Row Level Security", async () => {
    // Tenant B queries visits with Tenant A's ID
    const { data: visitsData, error: visitsErr } = await tenantB.client
      .from("visits")
      .select("*")
      .eq("tenant_id", tenantA.tenantId);

    expect(visitsErr).toBeNull();
    expect(visitsData).toHaveLength(0);

    // Tenant B queries queue_tokens with Tenant A's ID
    const { data: tokensData, error: tokensErr } = await tenantB.client
      .from("queue_tokens")
      .select("*")
      .eq("tenant_id", tenantA.tenantId);

    expect(tokensErr).toBeNull();
    expect(tokensData).toHaveLength(0);
  });

  it("4. Proves Tenant B cannot insert a visit with Tenant A's tenant_id (rejected by RLS WITH CHECK)", async () => {
    const { data, error } = await tenantB.client
      .from("visits")
      .insert({
        tenant_id: tenantA.tenantId, // Forged tenant ID
        patient_id: patientA1Id,
        doctor_id: tenantB.userId,
        origin_type: "walk_in",
        created_by: tenantB.userId,
      })
      .select("id");

    // Either error returned or 0 rows created
    if (!error) {
      expect(data).toHaveLength(0);
    } else {
      expect(error).not.toBeNull();
    }

    // Verify row does not exist in Tenant A
    const { data: verifyRow } = await admin
      .from("visits")
      .select("id")
      .eq("tenant_id", tenantA.tenantId)
      .eq("created_by", tenantB.userId);

    expect(verifyRow).toHaveLength(0);
  });

  it("5. Proves Tenant B cannot mutate or delete Tenant A visits under RLS", async () => {
    // Tenant B attempts to update Tenant A visit
    const { data: updateData, error: updateErr } = await tenantB.client
      .from("visits")
      .update({ reason_for_visit: "Hacked reason" })
      .eq("id", visitA1Id)
      .select();

    expect(updateErr).toBeNull();
    expect(updateData).toHaveLength(0);

    // Tenant B attempts to delete Tenant A visit
    const { data: deleteData, error: deleteErr } = await tenantB.client
      .from("visits")
      .delete()
      .eq("id", visitA1Id)
      .select();

    // No member deletes a visit (05-04); since V2-05 05-02c the DELETE privilege itself is revoked (42501).
    expect(deleteErr?.code).toBe("42501");
    expect(deleteData).toBeNull();

    // Verify Tenant A visit remains untouched
    const { data: originalVisit } = await admin
      .from("visits")
      .select("reason_for_visit")
      .eq("id", visitA1Id)
      .single();

    expect(originalVisit?.reason_for_visit).toBe("General Checkup");
  });

  it("6. Proves database unique constraint (tenant_id, date, token_number) rejects duplicate tokens", async () => {
    // The clinic-local day token #1 was issued on (SQL's tenant_local_date, not the UTC date).
    const { data: first } = await admin.from("queue_tokens").select("date").eq("visit_id", visitA1Id).single();
    const today = first!.date as string;

    // Create a 3rd visit for Tenant A
    const { data: v3 } = await tenantA.client
      .from("visits")
      .insert({
        tenant_id: tenantA.tenantId,
        patient_id: patientA1Id,
        doctor_id: tenantA.userId,
        origin_type: "walk_in",
        created_by: tenantA.userId,
      })
      .select("id")
      .single();

    // Attempt to reuse token #1 on the same date for Tenant A
    const { error: dupErr } = await admin.from("queue_tokens").insert({
      tenant_id: tenantA.tenantId,
      visit_id: v3!.id,
      date: today,
      token_number: 1, // Already issued to visitA1
      priority: "normal",
    });

    expect(dupErr).not.toBeNull();
    expect(dupErr?.code).toBe("23505"); // Postgres unique_violation code
  });
});
