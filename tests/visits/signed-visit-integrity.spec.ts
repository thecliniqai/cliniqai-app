/**
 * Signed-visit integrity through the real API (V2-05 fix plan 05-11a; 05a review H-VISIT, M-INVOICE doctor_id part;
 * migrations 000068-000070). The reviewers' reproductions used each role's own JWT against PostgREST: a receptionist
 * re-keyed a signed visit to another patient and forged its sign-off, a doctor took a colleague's visit, and the app's
 * `cancelVisit` would cancel a signed consultation (and promote the day's waitlist into its slot). Each case below
 * succeeded before 05-11a. The database cases go through PostgREST with the member's JWT (RLS and the guard apply);
 * the service case through the real `cancelVisit`. Rows are read back with the service-role client. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { cancelVisit } from "@/features/visits/service";
import { ymdOf } from "@/lib/datetime";
import { ctxFor } from "../helpers/context";
import { seedSlotIso } from "../helpers/seed-slots";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

describe("signed visits keep their patient, signer and status (05-11a)", () => {
  const admin = getAdminClient();
  let owner: SeededTenant;
  let reception: SeededTenant;
  let doctor2: SeededTenant;
  let patientOne: string;
  let patientTwo: string;
  let signedVisit: string;
  let openVisit: string;
  let scheduledAt: string;

  beforeAll(async () => {
    owner = await seedTenantWithOwner("Synthetic Signed Visit Clinic");
    reception = await addMemberToTenant(owner.tenantId, "receptionist");
    doctor2 = await addMemberToTenant(owner.tenantId, "doctor");

    const { data: patients, error: pErr } = await admin
      .from("patients")
      .insert([
        { tenant_id: owner.tenantId, full_name: "Synthetic Signed One", phone: "+919000011101", created_by: owner.userId },
        { tenant_id: owner.tenantId, full_name: "Synthetic Signed Two", phone: "+919000011102", created_by: owner.userId },
      ])
      .select("id");
    if (pErr || !patients) throw new Error(`Failed to seed the patients: ${pErr?.message}`);
    [patientOne, patientTwo] = patients.map((p) => p.id as string);

    scheduledAt = seedSlotIso();
    const { data: visits, error: vErr } = await admin
      .from("visits")
      .insert([
        {
          tenant_id: owner.tenantId,
          patient_id: patientOne,
          doctor_id: owner.userId,
          origin_type: "scheduled",
          scheduled_at: scheduledAt,
          status: "completed",
          signed_at: new Date().toISOString(),
          signed_by: owner.userId,
          created_by: owner.userId,
        },
        {
          tenant_id: owner.tenantId,
          patient_id: patientOne,
          doctor_id: owner.userId,
          origin_type: "walk_in",
          status: "waiting",
          created_by: owner.userId,
        },
      ])
      .select("id, status");
    if (vErr || !visits) throw new Error(`Failed to seed the visits: ${vErr?.message}`);
    signedVisit = visits.find((v) => v.status === "completed")!.id as string;
    openVisit = visits.find((v) => v.status === "waiting")!.id as string;

    // A waiting list entry for the signed visit's day: cancelling that visit would promote it into the slot.
    const { error: wErr } = await admin.from("waitlist_entries").insert({
      tenant_id: owner.tenantId,
      patient_id: patientTwo,
      target_date: ymdOf(scheduledAt, "Asia/Kolkata"),
      created_by: owner.userId,
    });
    if (wErr) throw new Error(`Failed to seed the waitlist entry: ${wErr.message}`);
  }, 60_000);

  async function visitRow(id: string) {
    const { data, error } = await admin
      .from("visits")
      .select("patient_id, doctor_id, status, signed_by")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  it("a receptionist cannot move a signed visit to another patient or forge its sign-off (INT H-1)", async () => {
    const { data, error } = await reception.client
      .from("visits")
      .update({ patient_id: patientTwo, signed_by: reception.userId, status: "booked" })
      .eq("id", signedVisit)
      .select("id");
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect(await visitRow(signedVisit)).toEqual({
      patient_id: patientOne,
      doctor_id: owner.userId,
      status: "completed",
      signed_by: owner.userId,
    });
  });

  it("a receptionist cannot sign an open visit in a doctor's name (RLS M-3)", async () => {
    const { error } = await reception.client
      .from("visits")
      .update({ status: "completed", signed_at: new Date().toISOString(), signed_by: owner.userId })
      .eq("id", openVisit)
      .select("id");
    expect(error?.code).toBe("42501");
    expect(await visitRow(openVisit)).toMatchObject({ status: "waiting", signed_by: null });
  });

  it("a doctor cannot take a colleague's visit, so cannot reach its invoice (IND M2, RLS L-1)", async () => {
    const { error } = await doctor2.client.from("visits").update({ doctor_id: doctor2.userId }).eq("id", openVisit).select("id");
    expect(error?.code).toBe("42501");
    expect(await visitRow(openVisit)).toMatchObject({ doctor_id: owner.userId });
  });

  it("cancelVisit refuses a signed consultation: no cancel, no audit row, no waitlist promotion", async () => {
    const res = await cancelVisit(ctxFor(reception), signedVisit);
    expect(res).toEqual({ success: false, error: "A signed consultation cannot be cancelled." });
    expect(await visitRow(signedVisit)).toMatchObject({ status: "completed", signed_by: owner.userId });

    const { data: entries, error: wErr } = await admin
      .from("waitlist_entries")
      .select("status, promoted_visit_id")
      .eq("tenant_id", owner.tenantId);
    if (wErr) throw new Error(wErr.message);
    expect(entries).toEqual([{ status: "waiting", promoted_visit_id: null }]);

    const { count, error: aErr } = await admin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", owner.tenantId)
      .eq("action", "visit.cancel");
    if (aErr) throw new Error(aErr.message);
    expect(count).toBe(0);
  });
});
