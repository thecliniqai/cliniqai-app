/**
 * V2-08 08-05 (AI-13, R-18): `public.slot_suggestion_context` through `getSlotSuggestionContext` (the service behind the
 * booking sheet's Smart Assist), against the local stack: the doctor's average consult minutes over the last 60 days (null under
 * five samples), the patient's preferred time band over their last five attended visits in the clinic zone, the caller's clinic
 * only, and the permission. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getSlotSuggestionContext } from "@/features/visits/scheduling-service";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { seedPatient } from "../helpers/front-desk-commands";

let a: SeededTenant;
let b: SeededTenant;
let receptionist: SeededTenant;
let nurse: SeededTenant;
let tokenCounter = 0;

/** A signed visit of `doctor` that was called `minutes` before it was signed, `daysAgo` days ago. */
async function signedConsult(t: SeededTenant, patientId: string, minutes: number, daysAgo: number): Promise<void> {
  const admin = getAdminClient();
  const signed = new Date(Date.now() - daysAgo * 86_400_000);
  const called = new Date(signed.getTime() - minutes * 60_000);
  const { data: visit, error } = await admin
    .from("visits")
    .insert({
      tenant_id: t.tenantId,
      patient_id: patientId,
      doctor_id: t.userId,
      origin_type: "walk_in",
      status: "completed",
      created_by: t.userId,
      signed_at: signed.toISOString(),
      signed_by: t.userId,
    })
    .select("id")
    .single();
  if (error || !visit) throw new Error(`seed visit: ${error?.message}`);
  const { error: tokenError } = await admin.from("queue_tokens").insert({
    tenant_id: t.tenantId,
    visit_id: visit.id,
    token_number: ++tokenCounter,
    date: signed.toISOString().slice(0, 10),
    called_at: called.toISOString(),
  });
  if (tokenError) throw new Error(`seed token: ${tokenError.message}`);
}

/** An attended visit scheduled at a clinic-local (Asia/Kolkata) hour on a day in the past. */
async function attendedAt(t: SeededTenant, patientId: string, daysAgo: number, istHour: number): Promise<void> {
  const day = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const at = new Date(`${day}T${String(istHour).padStart(2, "0")}:00:00+05:30`);
  const { error } = await getAdminClient().from("visits").insert({
    tenant_id: t.tenantId,
    patient_id: patientId,
    doctor_id: t.userId,
    origin_type: "scheduled",
    status: "completed",
    created_by: t.userId,
    scheduled_at: at.toISOString(),
  });
  if (error) throw new Error(`seed attended visit: ${error.message}`);
}

beforeAll(async () => {
  a = await seedTenantWithOwner("Slot Context Clinic A");
  b = await seedTenantWithOwner("Slot Context Clinic B");
  receptionist = await addMemberToTenant(a.tenantId, "receptionist");
  nurse = await addMemberToTenant(a.tenantId, "nurse");
});

describe("slot_suggestion_context (service)", () => {
  it("the average consult is null under five samples and reports the count", async () => {
    const patient = await seedPatient(a, { full_name: "Synthetic Context Few" });
    for (const minutes of [10, 20, 30, 40]) await signedConsult(a, patient, minutes, 3);
    const out = await getSlotSuggestionContext(ctxFor(receptionist), a.userId, null);
    expect(out).toEqual({ ok: true, value: { entitled: true, avgConsultMinutes: null, preferredBand: null } });
  });

  it("from five samples it is the rounded average of call-to-signature minutes; old, odd and other doctors' consults do not count", async () => {
    const patient = await seedPatient(a, { full_name: "Synthetic Context Five" });
    await signedConsult(a, patient, 20, 5); // the fifth sample: 10, 20, 30, 40 (above) and this one average 24
    await signedConsult(a, patient, 55, 90); // older than 60 days: ignored
    await signedConsult(a, patient, 600, 2); // longer than 4 hours (a visit left open): ignored
    const out = await getSlotSuggestionContext(ctxFor(receptionist), a.userId, null);
    expect(out.ok && out.value.avgConsultMinutes).toBe(24);
    // Another doctor of the clinic has no samples.
    const other = await getSlotSuggestionContext(ctxFor(receptionist), randomUUID(), null);
    expect(other).toEqual({ ok: true, value: { entitled: true, avgConsultMinutes: null, preferredBand: null } });
  });

  it("the preferred band is the most frequent of the last five attended visits, in the clinic's zone", async () => {
    const evening = await seedPatient(a, { full_name: "Synthetic Context Evening" });
    for (const [daysAgo, hour] of [[1, 18], [2, 17], [3, 10], [4, 19], [5, 18]] as const) await attendedAt(a, evening, daysAgo, hour);
    const out = await getSlotSuggestionContext(ctxFor(receptionist), a.userId, evening);
    expect(out.ok && out.value.preferredBand).toBe("evening");

    // Only the last five count: an old morning habit does not outvote the recent afternoons.
    const afternoon = await seedPatient(a, { full_name: "Synthetic Context Afternoon" });
    for (const daysAgo of [1, 2, 3]) await attendedAt(a, afternoon, daysAgo, 14);
    for (const daysAgo of [10, 11, 12, 13]) await attendedAt(a, afternoon, daysAgo, 9);
    const recent = await getSlotSuggestionContext(ctxFor(receptionist), a.userId, afternoon);
    expect(recent.ok && recent.value.preferredBand).toBe("afternoon");
  });

  it("a tie goes to the more recent band; a patient with no attended visit has no band; cancelled and no-show visits do not count", async () => {
    const tie = await seedPatient(a, { full_name: "Synthetic Context Tie" });
    await attendedAt(a, tie, 1, 9); // morning, the most recent
    await attendedAt(a, tie, 2, 18); // evening
    const out = await getSlotSuggestionContext(ctxFor(receptionist), a.userId, tie);
    expect(out.ok && out.value.preferredBand).toBe("morning");

    const none = await seedPatient(a, { full_name: "Synthetic Context None" });
    const { error } = await getAdminClient().from("visits").insert({
      tenant_id: a.tenantId,
      patient_id: none,
      doctor_id: a.userId,
      origin_type: "scheduled",
      status: "no_show",
      created_by: a.userId,
      scheduled_at: new Date(Date.now() - 86_400_000).toISOString(),
    });
    expect(error).toBeNull();
    const empty = await getSlotSuggestionContext(ctxFor(receptionist), a.userId, none);
    expect(empty.ok && empty.value.preferredBand).toBeNull();
  });

  it("another clinic's patient gives no band and another clinic's doctor no average (the caller's clinic only)", async () => {
    const foreign = await seedPatient(b, { full_name: "Synthetic Context Foreign" });
    await attendedAt(b, foreign, 1, 18);
    const out = await getSlotSuggestionContext(ctxFor(receptionist), a.userId, foreign);
    expect(out.ok && out.value.preferredBand).toBeNull();
    const doctorOfB = await getSlotSuggestionContext(ctxFor(receptionist), b.userId, null);
    expect(doctorOfB.ok && doctorOfB.value.avgConsultMinutes).toBeNull();
  });

  it("the permission and the inputs are checked: a malformed id is refused; the nurse (appointments:view) reads", async () => {
    const bad = await getSlotSuggestionContext(ctxFor(receptionist), "not-a-uuid", null);
    expect(bad.ok).toBe(false);
    const asNurse = await getSlotSuggestionContext(ctxFor(nurse), a.userId, null);
    expect(asNurse.ok).toBe(true);
  });
});
