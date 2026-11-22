/**
 * V2-09c 09C-02 (R-8, Q-6, T-09C-07): the three allergy states are true again. Registration stores NULL ("not recorded") unless allergies were entered;
 * "No known allergies" is only an explicit choice ([]); a demographics edit by a clinical role does not write [] over NULL. Each default fix has a case that
 * fails without it: the registration commands (the normaliser and the insert, migration 000118), `newPatientPayload` (QuickRegister) and `updatePatient`.
 * Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { registerPatient } from "@/features/patients/register";
import { updatePatient } from "@/features/patients/service";
import { newPatientPayload, patientSchema } from "@/features/patients/schema";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { callWalkIn, newPatient, walkInArgs, patientsMarked } from "../helpers/front-desk-commands";
import { seedVisit } from "../helpers/billing-commands";

const admin = getAdminClient();
let clinic: SeededTenant;
let doctor: SeededTenant;
let receptionist: SeededTenant;

beforeAll(async () => {
  clinic = await seedTenantWithOwner("CI Allergy States Clinic");
  doctor = await addMemberToTenant(clinic.tenantId, "doctor");
  receptionist = await addMemberToTenant(clinic.tenantId, "receptionist");
}, 120_000);

const stored = async (id: string) => (await admin.from("patients").select("allergies, full_name").eq("id", id).single()).data;

describe("registration records 'not recorded' unless allergies were entered", () => {
  it("register_patient with no allergies key stores NULL, with an explicit [] stores [], with a list stores the list (fails without the 000118 normaliser)", async () => {
    const make = async (patient: Record<string, unknown>) => {
      const res = await receptionist.client.rpc("register_patient", { p_tenant_id: clinic.tenantId, p_patient: patient as never, p_client_request_id: randomUUID() });
      expect(res.error).toBeNull();
      return (await stored((res.data as { patient_id: string }).patient_id))?.allergies;
    };
    expect(await make(newPatient("States absent"))).toBeNull();
    expect(await make(newPatient("States null", { allergies: null }))).toBeNull();
    expect(await make(newPatient("States none", { allergies: [] }))).toEqual([]);
    expect(await make(newPatient("States list", { allergies: ["Penicillin"] }))).toEqual(["Penicillin"]);
  });

  it("the walk-in command (a new patient at the desk) stores NULL too", async () => {
    const marker = `States walk-in ${randomUUID().slice(0, 6)}`;
    const res = await callWalkIn(receptionist.client, walkInArgs(clinic, { p_new_patient: newPatient(marker) as never, p_doctor_id: doctor.userId }));
    expect(res.error).toBeNull();
    const rows = await patientsMarked(clinic.tenantId, marker);
    expect(rows).toHaveLength(1);
    expect((await stored(rows[0].id))?.allergies).toBeNull();
  });

  it("QuickRegister (the service with the form's input, no allergies key) stores NULL (fails without newPatientPayload keeping null)", async () => {
    const input = { full_name: `Synthetic States Quick ${randomUUID().slice(0, 6)}`, phone: "9810000011", age: 31, sex: "female" as const };
    expect(newPatientPayload(patientSchema.parse(input))).toMatchObject({ allergies: null });
    const res = await registerPatient(ctxFor(receptionist), input, randomUUID());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((await stored(res.value.patientId))?.allergies).toBeNull();
  });
});

describe("a demographics edit keeps the three states", () => {
  const edit = (patientId: string, over: Record<string, unknown> = {}) =>
    updatePatient(ctxFor(doctor), patientId, patientSchema.parse({ full_name: "Synthetic Edited Patient", phone: "9810000022", age: 40, ...over }) as never);

  it("a doctor's edit that sends no allergies leaves NULL as NULL (fails without the updatePatient fix)", async () => {
    const { patientId } = await seedVisit(clinic);
    await admin.from("patients").update({ allergies: null }).eq("id", patientId).throwOnError();
    const res = await edit(patientId);
    expect(res.success).toBe(true);
    expect((await stored(patientId))?.allergies).toBeNull();
  });

  it("an explicit [] stays [], and a list that is unchanged is not rewritten", async () => {
    const { patientId } = await seedVisit(clinic);
    await admin.from("patients").update({ allergies: [] }).eq("id", patientId).throwOnError();
    expect((await edit(patientId, { allergies: [] })).success).toBe(true);
    expect((await stored(patientId))?.allergies).toEqual([]);
    await admin.from("patients").update({ allergies: ["Sulfa"] }).eq("id", patientId).throwOnError();
    expect((await edit(patientId, { allergies: ["Sulfa"] })).success).toBe(true);
    expect((await stored(patientId))?.allergies).toEqual(["Sulfa"]);
  });

  it("a doctor who types allergies on a not-recorded patient records them; clearing a recorded list records 'none'", async () => {
    const { patientId } = await seedVisit(clinic);
    await admin.from("patients").update({ allergies: null }).eq("id", patientId).throwOnError();
    expect((await edit(patientId, { allergies: ["Penicillin"] })).success).toBe(true);
    expect((await stored(patientId))?.allergies).toEqual(["Penicillin"]);
    expect((await edit(patientId, { allergies: [] })).success).toBe(true);
    expect((await stored(patientId))?.allergies).toEqual([]);
  });

  it("the front desk still cannot change allergies (the 000055 rule), and an edit that leaves them out succeeds", async () => {
    const { patientId } = await seedVisit(clinic);
    await admin.from("patients").update({ allergies: null }).eq("id", patientId).throwOnError();
    const input = patientSchema.parse({ full_name: "Synthetic Desk Edit", phone: "9810000033", age: 40 });
    expect((await updatePatient(ctxFor(receptionist), patientId, input as never)).success).toBe(true);
    expect((await stored(patientId))?.allergies).toBeNull();
    const withAllergy = patientSchema.parse({ full_name: "Synthetic Desk Edit", phone: "9810000033", age: 40, allergies: ["Penicillin"] });
    expect(await updatePatient(ctxFor(receptionist), patientId, withAllergy as never)).toMatchObject({ success: false });
    expect((await stored(patientId))?.allergies).toBeNull();
  });
});
