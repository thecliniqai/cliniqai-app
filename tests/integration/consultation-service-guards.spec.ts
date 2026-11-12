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
import { getAdminClient } from "../helpers/supabase-admin";
import { consultationDraftInput, vitalsWithForgedRecorder } from "../helpers/fixtures";

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
      const res = await saveConsultationDraft(
        ctxFor(doctor),
        consultationDraftInput({
          visit_id: visitId,
          vitals: vitalsWithForgedRecorder({ systolic: 128, diastolic: 84, pulse: 72 }, nurse.userId),
          clinical_notes: "Synthetic note.",
        })
      );
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

      const res = await saveConsultationDraft(
        ctxFor(doctor),
        consultationDraftInput({
          visit_id: visitId,
          vitals: vitalsWithForgedRecorder({ systolic: 118, diastolic: 76, pulse: 70 }, owner.userId),
          clinical_notes: "Synthetic note.",
        })
      );
      expect(res.success).toBe(true);
      expect((await storedVitals(visitId)).recorded_by).toBe(nurse.userId);
    });

    it("re-attributes to the doctor when the doctor changes a reading", async () => {
      const visitId = await newVisit();
      await recordVisitVitals(ctxFor(nurse), visitId, { systolic: 118, diastolic: 76, pulse: 70 });

      const res = await saveConsultationDraft(
        ctxFor(doctor),
        consultationDraftInput({
          visit_id: visitId,
          vitals: vitalsWithForgedRecorder({ systolic: 124, diastolic: 76, pulse: 70 }, nurse.userId),
          clinical_notes: "Synthetic note.",
        })
      );
      expect(res.success).toBe(true);
      const vitals = await storedVitals(visitId);
      expect(vitals.systolic).toBe(124);
      expect(vitals.recorded_by).toBe(doctor.userId);
    });
  });

  describe("permission checks inside the services", () => {
    it("denies receptionist and nurse sign-off, reopen and finalize; the visit is unchanged", async () => {
      const visitId = await newVisit();
      await saveConsultationDraft(ctxFor(doctor), consultationDraftInput({ visit_id: visitId, clinical_notes: "Synthetic note." }));

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
      await saveConsultationDraft(ctxFor(doctor), consultationDraftInput({ visit_id: visitId, clinical_notes: "Synthetic note." }));

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
      await saveConsultationDraft(ctxFor(doctor), consultationDraftInput({ visit_id: visitId, clinical_notes: "Synthetic note." }));

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

  // V2-01 01-05 P1-23 (ARC-10, D10): sign-off error handling and the `visit.completed` payload.
  describe("P1-23: completeAndSignConsultation", () => {
    let subscriptionId: string;

    beforeAll(async () => {
      // Loopback endpoint: the dispatcher's SSRF check fails it permanently, so nothing leaves the machine.
      const { data, error } = await getAdminClient()
        .from("webhook_subscriptions")
        .insert({
          tenant_id: owner.tenantId,
          endpoint_url: "https://127.0.0.1/p1-23-hook",
          event_types: ["visit.completed"],
          signing_secret: "whsec_p1_23_synthetic",
          is_active: true,
          created_by: owner.userId,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`subscription seed failed: ${error?.message}`);
      subscriptionId = data.id;
    });

    async function completedEventsFor(visitId: string): Promise<Array<Record<string, unknown>>> {
      const { data } = await getAdminClient()
        .from("webhook_delivery_queue")
        .select("payload")
        .eq("subscription_id", subscriptionId)
        .eq("event_type", "visit.completed");
      return (data ?? [])
        .map((row: { payload: string }) => JSON.parse(row.payload).data as Record<string, unknown>)
        .filter((d) => d.visit_id === visitId);
    }

    it("emits visit.completed with the visit's patient_id and the visit doctor (not the signer)", async () => {
      const visitId = await newVisit();
      await saveConsultationDraft(ctxFor(owner), consultationDraftInput({ visit_id: visitId, clinical_notes: "Synthetic note." }));

      // The owner signs a visit assigned to `doctor`.
      const res = await completeAndSignConsultation(ctxFor(owner), visitId);
      expect(res.success).toBe(true);

      const events = await completedEventsFor(visitId);
      expect(events).toHaveLength(1);
      expect(events[0].patient_id).toBe(patientId);
      expect(events[0].doctor_id).toBe(doctor.userId);
      expect(events[0].doctor_id).not.toBe(owner.userId);

      const { data: visit } = await owner.client
        .from("visits")
        .select("status, signed_by")
        .eq("id", visitId)
        .single();
      expect(visit).toEqual({ status: "completed", signed_by: owner.userId });
    });

    it("refuses a second sign-off: signer, signed_at and the outbox are unchanged", async () => {
      const visitId = await newVisit();
      await saveConsultationDraft(ctxFor(doctor), consultationDraftInput({ visit_id: visitId, clinical_notes: "Synthetic note." }));
      expect((await completeAndSignConsultation(ctxFor(doctor), visitId)).success).toBe(true);

      const { data: before } = await owner.client
        .from("visits")
        .select("status, signed_at, signed_by")
        .eq("id", visitId)
        .single();

      const second = await completeAndSignConsultation(ctxFor(owner), visitId);
      expect(second.success).toBe(false);

      const { data: after } = await owner.client
        .from("visits")
        .select("status, signed_at, signed_by")
        .eq("id", visitId)
        .single();
      expect(after).toEqual(before);
      expect(after?.signed_by).toBe(doctor.userId);

      const { data: audit } = await owner.client
        .from("audit_logs")
        .select("id")
        .eq("entity_id", visitId)
        .eq("action", "visit.complete_and_sign");
      expect(audit).toHaveLength(1);
    });

    it("refuses to sign a visit reopened for amendment (signed_at still set)", async () => {
      const visitId = await newVisit();
      await saveConsultationDraft(ctxFor(doctor), consultationDraftInput({ visit_id: visitId, clinical_notes: "Synthetic note." }));
      expect((await completeAndSignConsultation(ctxFor(doctor), visitId)).success).toBe(true);
      expect(
        (await reopenVisitForAmendment(ctxFor(doctor), visitId, "Synthetic amendment reason text")).success
      ).toBe(true);

      const res = await completeAndSignConsultation(ctxFor(owner), visitId);
      expect(res.success).toBe(false);

      const { data: visit } = await owner.client.from("visits").select("status, signed_by").eq("id", visitId).single();
      expect(visit).toEqual({ status: "in_consultation", signed_by: doctor.userId });
    });
  });
});
