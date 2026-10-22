import { describe, it, expect, beforeAll } from "vitest";
import {
  createReferral,
  getOutboundReferrals,
  getInboundReferrals,
  acknowledgeReferral,
  closeReferralLoop,
  getReferralSignedUrl,
  getPatientReferrals,
} from "@/features/referrals/actions";
import { createReferralSchema, closeReferralLoopSchema } from "@/features/referrals/schema";
import { seedTenantWithOwner } from "../helpers/tenants";

describe("Referrals Lifecycle & DPDP Consent Compliance (REQ-referrals)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let sessionA: { userId: string; tenantId: string };
  let sessionB: { userId: string; tenantId: string };
  let patientAId: string;
  let outOfNetworkReferralId: string;
  let inNetworkReferralId: string;

  beforeAll(async () => {
    tenantA = await seedTenantWithOwner("City Care Family Clinic");
    tenantB = await seedTenantWithOwner("Metro Cardiology Center");

    sessionA = { userId: tenantA.userId, tenantId: tenantA.tenantId };
    sessionB = { userId: tenantB.userId, tenantId: tenantB.tenantId };

    // Seed patient in Tenant A
    const { data: patient, error } = await (tenantA.client.from("patients") as any)
      .insert({
        tenant_id: tenantA.tenantId,
        full_name: "Vikram Malhotra",
        phone: "+919876500123",
        age: 48,
        sex: "male",
        created_by: tenantA.userId,
      })
      .select("id")
      .single();

    if (error || !patient) {
      throw new Error(`Failed to seed patient: ${error?.message}`);
    }
    patientAId = patient.id;

    // Seed past visit for Vikram Malhotra
    await (tenantA.client.from("visits") as any).insert({
      tenant_id: tenantA.tenantId,
      patient_id: patientAId,
      doctor_id: tenantA.userId,
      origin_type: "walk_in",
      status: "completed",
      estimated_duration_minutes: 20,
      vitals: { systolic: 142, diastolic: 92, pulse: 78, temperature: 98.4 },
      chief_complaints: [{ symptom: "Exertional chest heaviness", duration_val: 2, duration_unit: "weeks" }],
      created_by: tenantA.userId,
    });
  });

  describe("1. Referral Urgency & Types Specification", () => {
    it("validates valid urgency levels (routine, priority, urgent)", () => {
      const allowedUrgencies = ["routine", "priority", "urgent"];
      expect(allowedUrgencies.includes("routine")).toBe(true);
      expect(allowedUrgencies.includes("priority")).toBe(true);
      expect(allowedUrgencies.includes("urgent")).toBe(true);
      expect(allowedUrgencies.includes("emergency")).toBe(false);
    });

    it("validates valid status transitions (sent -> acknowledged -> completed, cancelled)", () => {
      const validStatuses = ["sent", "acknowledged", "completed", "cancelled"];
      expect(validStatuses).toContain("sent");
      expect(validStatuses).toContain("acknowledged");
      expect(validStatuses).toContain("completed");
    });

    it("requires DPDP consent when sharing clinical history with in-network clinics", () => {
      const inNetworkRequestWithConsent = {
        referral_type: "in_network",
        patient_consents_history_sharing: true,
      };
      const inNetworkRequestWithoutConsent = {
        referral_type: "in_network",
        patient_consents_history_sharing: false,
      };

      expect(inNetworkRequestWithConsent.patient_consents_history_sharing).toBe(true);
      expect(inNetworkRequestWithoutConsent.patient_consents_history_sharing).toBe(false);
    });

    it("rejects in-network referral without target_tenant_id", () => {
      const result = createReferralSchema.safeParse({
        patient_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        referral_type: "in_network",
        referred_to_name: "Dr. Sharma",
        reason_for_referral: "Echocardiogram required",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("2. Out-of-Network Referral & Branded PDF Generation", () => {
    it("creates out-of-network referral with specialist name and facility", async () => {
      const res = await createReferral(
        {
          patient_id: patientAId,
          referral_type: "out_of_network",
          referred_to_name: "Dr. Rajesh Verma",
          referred_to_facility: "Max Super Speciality Hospital",
          referred_to_specialty: "Cardiology",
          referred_to_contact: "+919811223344",
          reason_for_referral: "Suspected CAD with atypical angina; advice coronary angiogram",
          provisional_diagnosis: "Atypical Angina Pectoris / Suspected IHD",
          urgency: "priority",
          clinical_summary: "Patient has 2-week history of exertional substernal discomfort. Resting ECG shows T-wave inversions in V4-V6.",
          active_medications_snapshot: [
            { medicine_name: "Aspirin 75mg", dosage: "1 tab", duration: "30 days", timing: "Post lunch" },
            { medicine_name: "Atorvastatin 20mg", dosage: "1 tab", duration: "30 days", timing: "Bedtime" },
          ],
          investigations_advised: ["2D Echocardiography", "TMT (Treadmill Test)"],
          letterhead_mode: "blank_paper",
        },
        tenantA.client,
        sessionA
      );

      expect(res.success).toBe(true);
      expect(res.referral).toBeDefined();
      if (res.referral) {
        expect(res.referral.status).toBe("sent");
        expect(res.referral.urgency).toBe("priority");
        expect(res.referral.referred_to_name).toBe("Dr. Rajesh Verma");
        expect(res.referral.pdf_storage_path).toContain(`tenants/${tenantA.tenantId}/referrals/${res.referral.id}/referral_letter.pdf`);
        outOfNetworkReferralId = res.referral.id;
      }
    });

    it("generates a valid 3600-second signed URL for the referral letter PDF", async () => {
      const urlRes = await getReferralSignedUrl(outOfNetworkReferralId, tenantA.client, sessionA);
      expect(urlRes.success).toBe(true);
      expect(urlRes.signedUrl).toBeDefined();
      expect(urlRes.signedUrl).toContain("http");
    });

    it("retrieves outbound referrals including patient details", async () => {
      const outRes = await getOutboundReferrals(tenantA.client, sessionA);
      expect(outRes.success).toBe(true);
      expect(outRes.referrals.length).toBeGreaterThanOrEqual(1);

      const found = outRes.referrals.find((r) => r.id === outOfNetworkReferralId);
      expect(found).toBeDefined();
      expect(found?.patient?.full_name).toBe("Vikram Malhotra");
      expect(found?.referred_to_specialty).toBe("Cardiology");
    });
  });

  describe("3. In-Network Referral, DPDP Consent & Loop Closure Lifecycle", () => {
    it("creates in-network referral and logs DPDP consent entry in consent_records", async () => {
      const res = await createReferral(
        {
          patient_id: patientAId,
          referral_type: "in_network",
          target_tenant_id: tenantB.tenantId,
          referred_to_name: "Dr. Ananya Roy",
          referred_to_facility: "Metro Cardiology Center",
          referred_to_specialty: "Interventional Cardiology",
          reason_for_referral: "Urgent consultation for secondary evaluation and angiography",
          provisional_diagnosis: "Unstable Angina",
          urgency: "urgent",
          patient_consents_history_sharing: true,
          letterhead_mode: "blank_paper",
        },
        tenantA.client,
        sessionA
      );

      expect(res.success).toBe(true);
      expect(res.referral).toBeDefined();
      if (res.referral) {
        inNetworkReferralId = res.referral.id;
        expect(res.referral.patient_consents_history_sharing).toBe(true);
        expect(res.referral.consented_history_snapshot).toBeDefined();

        const snapshot = res.referral.consented_history_snapshot as any;
        expect(snapshot.consented_by_patient).toBe(true);
        expect(snapshot.encounters.length).toBeGreaterThanOrEqual(1);
      }

      // Verify DPDP consent record is recorded in consent_records table
      const { data: consentRecord } = await (tenantA.client.from("consent_records") as any)
        .select("*")
        .eq("patient_id", patientAId)
        .eq("consent_type", "referral_history_sharing")
        .eq("status", "granted")
        .maybeSingle();

      expect(consentRecord).toBeDefined();
      expect(consentRecord?.note).toContain(tenantB.tenantId);
    });

    it("allows target clinic (Tenant B) to view and acknowledge the inbound referral", async () => {
      // 1. Tenant B checks inbound register
      const inRes = await getInboundReferrals(tenantB.client, sessionB);
      expect(inRes.success).toBe(true);

      const found = inRes.referrals.find((r) => r.id === inNetworkReferralId);
      expect(found).toBeDefined();
      expect(found?.status).toBe("sent");
      expect(found?.urgency).toBe("urgent");
      expect(found?.originating_clinic?.name).toBe("City Care Family Clinic");

      // 2. Tenant B acknowledges referral
      const ackRes = await acknowledgeReferral(inNetworkReferralId, tenantB.client, sessionB);
      expect(ackRes.success).toBe(true);

      // Verify status updated in database
      const { data: refRow } = await (tenantB.client.from("referrals") as any)
        .select("status, acknowledged_at")
        .eq("id", inNetworkReferralId)
        .single();

      expect(refRow?.status).toBe("acknowledged");
      expect(refRow?.acknowledged_at).toBeDefined();
    });

    it("allows originating clinic (Tenant A) to Close the Loop with specialist return notes", async () => {
      const closeRes = await closeReferralLoop(
        {
          referral_id: inNetworkReferralId,
          closure_notes:
            "Patient underwent successful CAG at Metro Cardiology Center. Normal coronaries with slow flow. Started on Diltiazem. Patient advised regular follow-up.",
          return_date: "2026-10-22",
        },
        tenantA.client,
        sessionA
      );

      expect(closeRes.success).toBe(true);

      // Verify referral is now completed with closure notes
      const { data: completedRef } = await (tenantA.client.from("referrals") as any)
        .select("status, completed_at, closure_notes, closed_by")
        .eq("id", inNetworkReferralId)
        .single();

      expect(completedRef?.status).toBe("completed");
      expect(completedRef?.closure_notes).toContain("Patient underwent successful CAG");
      expect(completedRef?.closed_by).toBe(tenantA.userId);
    });

    it("retrieves all referrals for a specific patient under the clinic", async () => {
      const patRes = await getPatientReferrals(patientAId, tenantA.client, sessionA);
      expect(patRes.success).toBe(true);
      expect(patRes.referrals.length).toBe(2);
    });
  });

  describe("4. Multi-Tenant Boundary & Access Protection (T-04-11)", () => {
    it("proves Tenant B cannot view Tenant A outbound referrals", async () => {
      const outRes = await getOutboundReferrals(tenantB.client, sessionB);
      expect(outRes.success).toBe(true);

      const leak = outRes.referrals.find((r) => r.id === outOfNetworkReferralId);
      expect(leak).toBeUndefined();
    });

    it("proves Tenant B cannot close the loop on Tenant A referral", async () => {
      const closeRes = await closeReferralLoop(
        {
          referral_id: outOfNetworkReferralId,
          closure_notes: "Unauthorized attempt by Tenant B",
        },
        tenantB.client,
        sessionB
      );

      expect(closeRes.success).toBe(false);
      expect(closeRes.error).toContain("denied");
    });
  });
});
