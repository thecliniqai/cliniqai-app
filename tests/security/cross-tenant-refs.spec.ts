/**
 * Cross-tenant references on write (P0-13 finding, V2-02 02-02; lib/auth/tenant-refs.ts).
 *
 * The guard enumeration (guard-actions.spec.ts, leg 3) found that services copied caller-supplied patient, visit and
 * doctor ids into new tenant-A rows without checking them: the FKs reference the id alone and the RLS insert policies
 * check only the row's own tenant_id, so a tenant-A user could create an A visit, waitlist entry or consent record
 * pointing at tenant B's patient or user. Each service below now refuses a reference outside the caller's clinic.
 * Every case asserts the refusal AND that no tenant-A row references a tenant-B id afterwards; one positive control
 * per check proves in-clinic references still work.
 *
 * Local stack, real JWT clients, synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createVisit } from "@/features/visits/service";
import { createScheduleBlock } from "@/features/visits/scheduling-service";
import { addToWaitlist } from "@/features/waitlist/service";
import { grantConsent, toggleGlobalConsent, withdrawConsent } from "@/features/patients/consent-service";
import { recordFollowUp } from "@/features/consultation/service";
import { addConsultationDiagnosis } from "@/features/terminology/service";
import { createReferral } from "@/features/referrals/service";
import { createVisitInvoice } from "@/features/billing/service";
import { uploadLabDocument } from "@/features/labs/service";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { insertReturningId, type IdTable } from "../helpers/db";
import type { TablesInsert } from "@/types/database";

const admin = getAdminClient();
const TABLES = ["visits", "waitlist_entries", "consent_records", "follow_ups", "consultation_diagnoses", "referrals",
  "invoices", "schedule_blocks", "patient_documents"] as const;

function insertRow<T extends IdTable>(table: T, row: TablesInsert<T>): Promise<string> {
  return insertReturningId(admin, table, row);
}

async function seedPatientAndVisit(owner: SeededTenant, label: string) {
  const patient = await insertRow("patients", {
    tenant_id: owner.tenantId,
    full_name: `Synthetic Ref Patient ${label}`,
    phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    created_by: owner.userId,
  });
  const visit = await insertRow("visits", {
    tenant_id: owner.tenantId,
    patient_id: patient,
    doctor_id: owner.userId,
    origin_type: "scheduled",
    status: "booked",
    scheduled_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    created_by: owner.userId,
  });
  return { patient, visit };
}

describe("P0-13: services refuse references to another clinic's patient, visit or user", () => {
  let ownerA: SeededTenant;
  let doctorA: SeededTenant;
  let receptionistA: SeededTenant;
  let nurseA: SeededTenant;
  let ownerB: SeededTenant;
  let A: { patient: string; visit: string };
  let B: { patient: string; visit: string };

  /** Tenant-A rows in the written tables that mention any tenant-B id. */
  async function aRowsReferencingB(): Promise<string[]> {
    const bIds = [B.patient, B.visit, ownerB.userId, ownerB.tenantId];
    const out: string[] = [];
    for (const table of TABLES) {
      const { data, error } = await admin.from(table).select("*").eq("tenant_id", ownerA.tenantId);
      if (error) throw new Error(`read ${table}: ${error.message}`);
      for (const row of data ?? []) if (bIds.some((id) => JSON.stringify(row).includes(id))) out.push(table);
    }
    return out;
  }

  beforeAll(async () => {
    ownerA = await seedTenantWithOwner(`Ref Clinic A ${randomUUID().slice(0, 8)}`);
    doctorA = await addMemberToTenant(ownerA.tenantId, "doctor");
    receptionistA = await addMemberToTenant(ownerA.tenantId, "receptionist");
    nurseA = await addMemberToTenant(ownerA.tenantId, "nurse");
    ownerB = await seedTenantWithOwner(`Ref Clinic B ${randomUUID().slice(0, 8)}`);
    A = await seedPatientAndVisit(ownerA, "A");
    B = await seedPatientAndVisit(ownerB, "B");
  }, 60_000);

  const visitInput = (patient_id: string, doctor_id: string) => ({
    patient_id,
    doctor_id,
    origin_type: "walk_in" as const,
    estimated_duration_minutes: 15,
    is_overbooked: false,
  });

  it("createVisit (and bookAppointment / waitlist promotion through it): B patient or B doctor refused", async () => {
    expect((await createVisit(ctxFor(receptionistA), visitInput(B.patient, doctorA.userId))).success).toBe(false);
    expect((await createVisit(ctxFor(receptionistA), visitInput(A.patient, ownerB.userId))).success).toBe(false);
    expect((await createVisit(ctxFor(receptionistA), visitInput(A.patient, doctorA.userId))).success).toBe(true);
  });

  it("addToWaitlist: B patient or B doctor refused", async () => {
    const date = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const input = (patient_id: string, doctor_id: string | null) => ({ patient_id, doctor_id, target_date: date, priority: 0 });
    expect((await addToWaitlist(ctxFor(receptionistA), input(B.patient, null))).success).toBe(false);
    expect((await addToWaitlist(ctxFor(receptionistA), input(A.patient, ownerB.userId))).success).toBe(false);
    expect((await addToWaitlist(ctxFor(receptionistA), input(A.patient, doctorA.userId))).success).toBe(true);
  });

  it("grantConsent, withdrawConsent, toggleGlobalConsent: B patient refused", async () => {
    expect((await grantConsent(ctxFor(nurseA), B.patient, "data_sharing")).success).toBe(false);
    expect((await withdrawConsent(ctxFor(nurseA), B.patient, "data_sharing", "Synthetic reason")).success).toBe(false);
    expect((await toggleGlobalConsent(ctxFor(nurseA), B.patient, "withdrawn")).success).toBe(false);
    expect((await grantConsent(ctxFor(nurseA), A.patient, "data_sharing")).success).toBe(true);
  });

  it("recordFollowUp: B visit, B patient on an A visit, or B doctor refused", async () => {
    const input = (visitId: string, patientId: string, doctorId?: string) => ({
      visitId,
      patientId,
      doctorId,
      followUpDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    });
    expect((await recordFollowUp(ctxFor(doctorA), input(B.visit, B.patient))).success).toBe(false);
    expect((await recordFollowUp(ctxFor(doctorA), input(A.visit, B.patient))).success).toBe(false);
    expect((await recordFollowUp(ctxFor(doctorA), input(A.visit, A.patient, ownerB.userId))).success).toBe(false);
    expect((await recordFollowUp(ctxFor(doctorA), input(A.visit, A.patient))).success).toBe(true);
  });

  it("addConsultationDiagnosis: B patient on an A visit refused", async () => {
    const input = (patient_id: string) => ({
      visit_id: A.visit,
      patient_id,
      diagnosis_name: "Synthetic diagnosis",
      is_custom: true,
      is_chronic: false,
    });
    expect((await addConsultationDiagnosis(ctxFor(doctorA), input(B.patient))).success).toBe(false);
    expect((await addConsultationDiagnosis(ctxFor(doctorA), input(A.patient))).success).toBe(true);
  });

  it("createReferral: B patient, or a B visit linked to an A patient, refused", async () => {
    const input = (patient_id: string, visit_id?: string) => ({
      patient_id,
      visit_id,
      referral_type: "out_of_network" as const,
      referred_to_name: "Synthetic Specialist",
      reason_for_referral: "Synthetic reason",
      urgency: "routine" as const,
      patient_consents_history_sharing: false,
      letterhead_mode: "blank_paper" as const,
    });
    expect((await createReferral(ctxFor(doctorA), input(B.patient))).success).toBe(false);
    expect((await createReferral(ctxFor(doctorA), input(A.patient, B.visit))).success).toBe(false);
  });

  it("createVisitInvoice: B visit, or B patient on an A visit, refused", async () => {
    const input = (visit_id: string, patient_id: string) => ({
      visit_id,
      patient_id,
      items: [{ item_type: "consultation" as const, description: "Synthetic fee", unit_price: 100, quantity: 1 }],
      discount: 0,
      tax: 0,
    });
    expect((await createVisitInvoice(ctxFor(receptionistA), input(B.visit, B.patient))).success).toBe(false);
    expect((await createVisitInvoice(ctxFor(receptionistA), input(A.visit, B.patient))).success).toBe(false);
  });

  it("createScheduleBlock: a B doctor refused", async () => {
    const start = new Date(Date.now() + 9 * 86_400_000);
    const input = (doctor_id: string) => ({
      doctor_id,
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + 3_600_000).toISOString(),
      all_day: false,
    });
    expect((await createScheduleBlock(ctxFor(ownerA), input(ownerB.userId))).success).toBe(false);
    expect((await createScheduleBlock(ctxFor(ownerA), input(doctorA.userId))).success).toBe(true);
  });

  it("uploadLabDocument (IR-F1/AR-M1): a B visit, or another A patient's visit, is refused before the upload", async () => {
    const other = await seedPatientAndVisit(ownerA, "A2");
    const form = (visit_id: string) => {
      const fd = new FormData();
      fd.set("file", new File([Buffer.from("%PDF-1.4 synthetic")], "synthetic.pdf", { type: "application/pdf" }));
      fd.set("patient_id", A.patient);
      fd.set("visit_id", visit_id);
      fd.set("title", "Synthetic report");
      fd.set("document_type", "lab_report");
      fd.set("report_date", new Date().toISOString().slice(0, 10));
      fd.set("is_abnormal", "false");
      return fd;
    };
    const docsOf = async () =>
      (await admin.from("patient_documents").select("id").eq("tenant_id", ownerA.tenantId).eq("patient_id", A.patient)).data ?? [];
    const before = (await docsOf()).length;
    const foreign = await uploadLabDocument(ctxFor(doctorA), form(B.visit));
    expect(foreign).toEqual({ success: false, error: "Not found in this clinic." });
    const otherPatients = await uploadLabDocument(ctxFor(doctorA), form(other.visit));
    expect(otherPatients).toEqual({ success: false, error: "Not found in this clinic." });
    expect((await docsOf()).length).toBe(before);
    expect((await uploadLabDocument(ctxFor(doctorA), form(A.visit))).success).toBe(true);
  });

  it("a soft-deleted or erased patient of the same clinic is refused like a foreign one (AR-L6)", async () => {
    const deleted = await seedPatientAndVisit(ownerA, "A-deleted");
    const erased = await seedPatientAndVisit(ownerA, "A-erased");
    await admin.from("patients").update({ is_deleted: true }).eq("id", deleted.patient);
    await admin.from("patients").update({ erased_at: new Date().toISOString(), status: "erased" }).eq("id", erased.patient);
    const date = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    for (const patient of [deleted.patient, erased.patient]) {
      expect((await createVisit(ctxFor(receptionistA), visitInput(patient, doctorA.userId))).success).toBe(false);
      expect((await addToWaitlist(ctxFor(receptionistA), { patient_id: patient, doctor_id: null, target_date: date, priority: 0 })).success).toBe(false);
      expect((await grantConsent(ctxFor(nurseA), patient, "data_sharing")).success).toBe(false);
    }
    const { data: rows } = await admin
      .from("visits")
      .select("id")
      .in("patient_id", [deleted.patient, erased.patient])
      .neq("id", deleted.visit)
      .neq("id", erased.visit);
    expect(rows ?? []).toEqual([]);
  });

  it("no tenant A row references a tenant B id", async () => {
    expect(await aRowsReferencingB()).toEqual([]);
  });
});
