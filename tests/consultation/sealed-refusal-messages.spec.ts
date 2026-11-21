/**
 * V2-09a 09A-05 (R-17): a write to a signed consultation through the diagnosis, prescription and follow-up services is refused by the
 * database (000107, 000108) and the service answers with the one fixed, data-free text, never the driver's message; the rows are
 * unchanged. The same writes succeed on a draft and on a reopened (amending) visit, so the refusal is the seal and not a broken fixture.
 * Real rows, the doctor's own JWT client (RLS applies). Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { reopenVisitAs, seedClinicalVisit, signVisitAs, type ClinicalVisit } from "../helpers/clinical-commands";
import { insertReturningId } from "../helpers/db";
import { isSealedRefusal, SIGNED_CONSULTATION_MESSAGE } from "@/features/consultation/record-state";
import { recordFollowUp } from "@/features/consultation/service";
import { addConsultationDiagnosis, removeConsultationDiagnosis, updateDiagnosisNote } from "@/features/terminology/service";
import { addPrescriptionItem, removePrescriptionItem } from "@/features/prescriptions/service";

const admin = getAdminClient();
let owner: SeededTenant;
let doctor: SeededTenant;

interface Case {
  visit: ClinicalVisit;
  diagnosisId: string;
  itemId: string;
  followUpId: string;
}

async function seedCase(): Promise<Case> {
  const visit = await seedClinicalVisit(owner, { doctorId: doctor.userId, prescriptions: 1, diagnosis: true });
  const itemId = await insertReturningId(admin, "prescription_items", {
    tenant_id: owner.tenantId,
    prescription_id: visit.prescriptionIds[0],
    medicine_name: "Synthetic medicine",
    dosage: "1-0-1",
    duration: "5 days",
    sort_order: 0,
  });
  const followUpId = await insertReturningId(admin, "follow_ups", {
    tenant_id: owner.tenantId,
    patient_id: visit.patientId,
    visit_id: visit.visitId,
    doctor_id: doctor.userId,
    follow_up_date: "2031-03-01",
    status: "scheduled",
  });
  const { data } = await admin.from("consultation_diagnoses").select("id").eq("visit_id", visit.visitId).single();
  return { visit, diagnosisId: data!.id, itemId, followUpId };
}

async function counts(visitId: string) {
  const [{ count: diagnoses }, { data: rx }, { data: followUps }] = await Promise.all([
    admin.from("consultation_diagnoses").select("id", { count: "exact", head: true }).eq("visit_id", visitId),
    admin.from("prescriptions").select("id, items:prescription_items(id)").eq("visit_id", visitId),
    admin.from("follow_ups").select("follow_up_date").eq("visit_id", visitId),
  ]);
  return {
    diagnoses,
    items: (rx ?? []).flatMap((r) => r.items as unknown[]).length,
    followUps: (followUps ?? []).map((f) => f.follow_up_date),
  };
}

const newDiagnosis = (c: Case) => ({
  visit_id: c.visit.visitId,
  patient_id: c.visit.patientId,
  diagnosis_name: "Synthetic added diagnosis",
  is_custom: true,
  is_chronic: false,
});
const newItem = { medicine_name: "Synthetic added medicine", dosage: "1-0-1", duration: "3 days" };

let sealed: Case;
let draft: Case;
let amending: Case;

beforeAll(async () => {
  owner = await seedTenantWithOwner("Synthetic Sealed Messages Clinic");
  doctor = await addMemberToTenant(owner.tenantId, "doctor");
  sealed = await seedCase();
  await signVisitAs(doctor, sealed.visit.visitId);
  draft = await seedCase();
  amending = await seedCase();
  await signVisitAs(doctor, amending.visit.visitId);
  await reopenVisitAs(doctor, amending.visit.visitId);
}, 120_000);

describe("a signed consultation answers every refused write with the fixed text (R-17)", () => {
  it("adding a diagnosis", async () => {
    const before = await counts(sealed.visit.visitId);
    const res = await addConsultationDiagnosis(ctxFor(doctor), newDiagnosis(sealed));
    expect(res).toEqual({ success: false, error: SIGNED_CONSULTATION_MESSAGE });
    expect(await counts(sealed.visit.visitId)).toEqual(before);
  });

  it("removing a diagnosis", async () => {
    const before = await counts(sealed.visit.visitId);
    const res = await removeConsultationDiagnosis(ctxFor(doctor), sealed.diagnosisId, sealed.visit.visitId);
    expect(res).toEqual({ success: false, error: SIGNED_CONSULTATION_MESSAGE });
    expect(await counts(sealed.visit.visitId)).toEqual(before);
  });

  it("editing a diagnosis note", async () => {
    const res = await updateDiagnosisNote(ctxFor(doctor), sealed.diagnosisId, sealed.visit.visitId, "Rewritten after signing");
    expect(res).toEqual({ success: false, error: SIGNED_CONSULTATION_MESSAGE });
    const { data } = await admin.from("consultation_diagnoses").select("notes").eq("id", sealed.diagnosisId).single();
    expect(data?.notes).toBeNull();
  });

  it("adding a medication", async () => {
    const before = await counts(sealed.visit.visitId);
    const res = await addPrescriptionItem(ctxFor(doctor), sealed.visit.visitId, newItem);
    expect(res).toEqual({ success: false, error: SIGNED_CONSULTATION_MESSAGE });
    expect(await counts(sealed.visit.visitId)).toEqual(before);
  });

  it("removing a medication", async () => {
    const before = await counts(sealed.visit.visitId);
    const res = await removePrescriptionItem(ctxFor(doctor), sealed.itemId);
    expect(res).toEqual({ success: false, error: SIGNED_CONSULTATION_MESSAGE });
    expect(await counts(sealed.visit.visitId)).toEqual(before);
  });

  it("changing the follow-up date", async () => {
    const res = await recordFollowUp(ctxFor(doctor), { visitId: sealed.visit.visitId, patientId: sealed.visit.patientId, followUpDate: "2031-04-01" });
    expect(res).toEqual({ success: false, error: SIGNED_CONSULTATION_MESSAGE });
    expect((await counts(sealed.visit.visitId)).followUps).toEqual(["2031-03-01"]);
  });

  it("a plain privilege error is not a sealed refusal", () => {
    expect(isSealedRefusal({ code: "42501", message: "permission denied for table prescriptions" })).toBe(false);
    expect(isSealedRefusal({ code: "23505", message: "RX_SEALED" })).toBe(false);
    expect(isSealedRefusal({ code: "42501", message: "RX_SEALED" })).toBe(true);
    expect(isSealedRefusal(null)).toBe(false);
  });
});

describe.each([
  ["a draft visit", () => draft],
  ["a reopened (amending) visit", () => amending],
])("the same writes on %s are admitted (control)", (_name, pick) => {
  it("adds and removes a diagnosis, adds and removes a medication, changes the follow-up", async () => {
    const c = pick();
    const ctx = ctxFor(doctor);
    const added = await addConsultationDiagnosis(ctx, newDiagnosis(c));
    expect(added.success).toBe(true);
    expect((await updateDiagnosisNote(ctx, c.diagnosisId, c.visit.visitId, "Synthetic note")).success).toBe(true);
    if (added.success) expect((await removeConsultationDiagnosis(ctx, added.diagnosisId, c.visit.visitId)).success).toBe(true);
    const item = await addPrescriptionItem(ctx, c.visit.visitId, newItem);
    expect(item.success).toBe(true);
    if (item.success) expect((await removePrescriptionItem(ctx, item.itemId)).success).toBe(true);
    expect((await recordFollowUp(ctx, { visitId: c.visit.visitId, patientId: c.visit.patientId, followUpDate: "2031-05-01" })).success).toBe(true);
    expect((await counts(c.visit.visitId)).followUps).toEqual(["2031-05-01"]);
  });
});
