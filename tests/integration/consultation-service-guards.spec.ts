/**
 * Consultation and billing services with an explicit context (V2-01 01-01c, ADR-0005 D1).
 * - F6: `saveConsultationDraft` never stores a caller-chosen `vitals.recorded_by`.
 * - Every service re-checks its own permission, including inside the completeAndBill chain.
 * Runs on the local stack with each seeded user's own JWT client (RLS applies).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { seedTenantWithOwner, addMemberToTenant, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { createVisit, recordVisitVitals } from "@/features/visits/service";
import {
  saveConsultationDraft,
  completeAndSignConsultation,
  reopenVisitForAmendment,
  finalizeVisitAmendment,
} from "@/features/consultation/service";
import { completeAndBillConsultation } from "@/features/billing/service";

describe("consultation service guards (01-01c)", () => {
  let owner: SeededTenant;
  let doctor: SeededTenant;
  let nurse: SeededTenant;
  let receptionist: SeededTenant;
  let patientId: string;

  async function newVisit(): Promise<string> {
    const res = await createVisit(ctxFor(owner), {
      patient_id: patientId,
      doctor_id: doctor.userId,
      origin_type: "walk_in",
      scheduled_at: new Date().toISOString(),
      estimated_duration_minutes: 15,
      is_overbooked: false,
    });
    if (!res.success) throw new Error(`visit seed failed: ${res.error}`);
    return res.visitId;
  }

  async function storedVitals(visitId: string): Promise<Record<string, unknown>> {
    const { data } = await owner.client.from("visits").select("vitals").eq("id", visitId).single();
    return (data?.vitals ?? {}) as Record<string, unknown>;
  }

  beforeAll(async () => {
    owner = await seedTenantWithOwner("Consult Guard Clinic");
    doctor = await addMemberToTenant(owner.tenantId, "doctor");
    nurse = await addMemberToTenant(owner.tenantId, "nurse");
    receptionist = await addMemberToTenant(owner.tenantId, "receptionist");

    const { data: patient, error } = await owner.client
      .from("patients")
      .insert({
        tenant_id: owner.tenantId,
        full_name: "Synthetic Guard Patient",
        phone: "+919800000101",
        sex: "female",
        age: 41,
        created_by: owner.userId,
      })
      .select("id")
      .single();
    if (error || !patient) throw new Error(`patient seed failed: ${error?.message}`);
    patientId = patient.id;
  });

  describe("F6: vitals attribution in saveConsultationDraft", () => {
    it("ignores a caller-sent recorded_by and attributes new measurements to the acting doctor", async () => {
      const visitId = await newVisit();
      const res = await saveConsultationDraft(ctxFor(doctor), {
        visit_id: visitId,
        vitals: { systolic: 128, diastolic: 84, pulse: 72, recorded_by: nurse.userId },
        clinical_notes: "Synthetic note.",
      });
      expect(res.success).toBe(true);

      const vitals = await storedVitals(visitId);
      expect(vitals.systolic).toBe(128);
      expect(vitals.recorded_by).toBe(doctor.userId);
    });

    it("keeps the nurse's attribution when the doctor re-saves the same readings", async () => {
      const visitId = await newVisit();
      const recorded = await recordVisitVitals(ctxFor(nurse), visitId, { systolic: 118, diastolic: 76, pulse: 70 });
      expect(recorded.success).toBe(true);
      expect((await storedVitals(visitId)).recorded_by).toBe(nurse.userId);

      const res = await saveConsultationDraft(ctxFor(doctor), {
        visit_id: visitId,
        vitals: { systolic: 118, diastolic: 76, pulse: 70, recorded_by: owner.userId },
        clinical_notes: "Synthetic note.",
      });
      expect(res.success).toBe(true);
      expect((await storedVitals(visitId)).recorded_by).toBe(nurse.userId);
    });

    it("re-attributes to the doctor when the doctor changes a reading", async () => {
      const visitId = await newVisit();
      await recordVisitVitals(ctxFor(nurse), visitId, { systolic: 118, diastolic: 76, pulse: 70 });

      const res = await saveConsultationDraft(ctxFor(doctor), {
        visit_id: visitId,
        vitals: { systolic: 124, diastolic: 76, pulse: 70, recorded_by: nurse.userId },
        clinical_notes: "Synthetic note.",
      });
      expect(res.success).toBe(true);
      const vitals = await storedVitals(visitId);
      expect(vitals.systolic).toBe(124);
      expect(vitals.recorded_by).toBe(doctor.userId);
    });
  });

  describe("permission checks inside the services", () => {
    it("denies receptionist and nurse sign-off, reopen and finalize; the visit is unchanged", async () => {
      const visitId = await newVisit();
      await saveConsultationDraft(ctxFor(doctor), { visit_id: visitId, clinical_notes: "Synthetic note." });

      for (const actor of [receptionist, nurse]) {
        expect((await completeAndSignConsultation(ctxFor(actor), visitId)).success).toBe(false);
        expect(
          (await reopenVisitForAmendment(ctxFor(actor), visitId, "Synthetic amendment reason text")).success
        ).toBe(false);
        expect((await finalizeVisitAmendment(ctxFor(actor), visitId)).success).toBe(false);
      }

      const { data } = await owner.client.from("visits").select("status, signed_by").eq("id", visitId).single();
      expect(data?.status).not.toBe("completed");
      expect(data?.signed_by).toBeNull();
    });

    it("denies completeAndBillConsultation to a nurse before any invoice is written", async () => {
      const visitId = await newVisit();
      await saveConsultationDraft(ctxFor(doctor), { visit_id: visitId, clinical_notes: "Synthetic note." });

      const res = await completeAndBillConsultation(ctxFor(nurse), {
        visit_id: visitId,
        patient_id: patientId,
        consultation_fee: 500,
        discount: 0,
        additional_items: [],
        payment_collected: true,
        payment_method: "cash",
      });
      expect(res.success).toBe(false);

      const { data: invoices } = await owner.client.from("invoices").select("id").eq("visit_id", visitId);
      expect(invoices ?? []).toHaveLength(0);
    });

    it("lets the doctor sign and bill; signer and audit actor are the session doctor", async () => {
      const visitId = await newVisit();
      await saveConsultationDraft(ctxFor(doctor), { visit_id: visitId, clinical_notes: "Synthetic note." });

      const res = await completeAndBillConsultation(ctxFor(doctor), {
        visit_id: visitId,
        patient_id: patientId,
        consultation_fee: 500,
        discount: 0,
        additional_items: [],
        payment_collected: true,
        payment_method: "cash",
      });
      expect(res.success).toBe(true);

      const { data: visit } = await owner.client.from("visits").select("status, signed_by").eq("id", visitId).single();
      expect(visit?.status).toBe("completed");
      expect(visit?.signed_by).toBe(doctor.userId);

      const { data: audit } = await owner.client
        .from("audit_logs")
        .select("actor_id, action")
        .eq("entity_id", visitId)
        .eq("action", "visit.complete_and_sign");
      expect(audit).toHaveLength(1);
      expect(audit?.[0].actor_id).toBe(doctor.userId);
    });
  });
});
