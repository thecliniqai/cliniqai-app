/**
 * V2-08 08-06a (A-1): `recordVisitVitals` merges what it is sent into the vitals already stored on the visit, so recording one
 * more reading never drops an earlier one. Before, the whole `clinical_notes.vitals` object was replaced by the latest save:
 * a nurse's BP, pulse and temperature were erased when the doctor added the SpO2 from the same row's "Record vitals".
 * Real database, the caller's own client (RLS applies); rows are read back with the service-role client. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { recordVisitVitals } from "@/features/visits/service";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { createVisit } from "../helpers/seed-visit";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { seedPatient } from "../helpers/front-desk-commands";

const admin = getAdminClient();
let owner: SeededTenant;
let nurse: SeededTenant;
let doctor: SeededTenant;
let receptionist: SeededTenant;
let patientId: string;

async function newVisit(): Promise<string> {
  const res = await createVisit(owner, { patient_id: patientId, doctor_id: doctor.userId, origin_type: "walk_in" });
  if (!res.success) throw new Error(res.error);
  return res.visitId;
}

async function storedVitals(visitId: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from("clinical_notes").select("vitals").eq("visit_id", visitId).single();
  if (error) throw new Error(error.message);
  return data.vitals as Record<string, unknown>;
}

beforeAll(async () => {
  owner = await seedTenantWithOwner("Synthetic Vitals Merge Clinic");
  nurse = await addMemberToTenant(owner.tenantId, "nurse");
  doctor = await addMemberToTenant(owner.tenantId, "doctor");
  receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
  patientId = await seedPatient(owner);
}, 60_000);

describe("recordVisitVitals merges into the stored vitals (A-1)", () => {
  it("record BP, then record pulse only: both are stored", async () => {
    const visitId = await newVisit();
    const bp = await recordVisitVitals(ctxFor(nurse), visitId, { systolic: 124, diastolic: 82 });
    expect(bp.success).toBe(true);
    expect(await storedVitals(visitId)).toMatchObject({ systolic: 124, diastolic: 82 });

    const pulse = await recordVisitVitals(ctxFor(doctor), visitId, { pulse: 76 });
    expect(pulse.success).toBe(true);
    expect(await storedVitals(visitId)).toMatchObject({ systolic: 124, diastolic: 82, pulse: 76, recorded_by: doctor.userId });
    if (pulse.success) expect(pulse.vitals).toMatchObject({ systolic: 124, diastolic: 82, pulse: 76 });
  });

  it("a field that is sent again overwrites its stored value; the others stay", async () => {
    const visitId = await newVisit();
    await recordVisitVitals(ctxFor(nurse), visitId, { systolic: 150, diastolic: 95, pulse: 88, temperature: 99.1 });
    const second = await recordVisitVitals(ctxFor(nurse), visitId, { systolic: 130, diastolic: 85, spo2: 97 });
    expect(second.success).toBe(true);
    expect(await storedVitals(visitId)).toMatchObject({ systolic: 130, diastolic: 85, pulse: 88, temperature: 99.1, spo2: 97 });
  });

  it("explicit nulls (an empty form field) keep the stored value", async () => {
    const visitId = await newVisit();
    await recordVisitVitals(ctxFor(nurse), visitId, { pulse: 70, spo2: 98 });
    await recordVisitVitals(ctxFor(nurse), visitId, { pulse: null, spo2: null, temperature: 98.4 });
    expect(await storedVitals(visitId)).toMatchObject({ pulse: 70, spo2: 98, temperature: 98.4 });
  });

  it("the BMI follows the merged weight and height: the height first, the weight later", async () => {
    const visitId = await newVisit();
    await recordVisitVitals(ctxFor(nurse), visitId, { height: 175 });
    const later = await recordVisitVitals(ctxFor(nurse), visitId, { weight: 70 });
    expect(later.success).toBe(true);
    expect(await storedVitals(visitId)).toMatchObject({ height: 175, weight: 70, bmi: 22.9 });
  });

  it("the recorder is the session user of the last write", async () => {
    const visitId = await newVisit();
    await recordVisitVitals(ctxFor(nurse), visitId, { pulse: 72 });
    await recordVisitVitals(ctxFor(doctor), visitId, { spo2: 99 });
    expect(await storedVitals(visitId)).toMatchObject({ pulse: 72, spo2: 99, recorded_by: doctor.userId });
  });

  it("a role without vitals:edit is refused and nothing is stored", async () => {
    const visitId = await newVisit();
    const res = await recordVisitVitals(ctxFor(receptionist), visitId, { pulse: 72 });
    expect(res.success).toBe(false);
    expect(await storedVitals(visitId)).toEqual({});
  });
});
