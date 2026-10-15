import { describe, it, expect, beforeAll } from "vitest";
import { seedTenantWithOwner } from "../helpers/tenants";
import { createVisit } from "@/features/visits/actions";
import { transitionQueueState } from "@/features/queue/actions";
import {
  saveConsultationDraft,
  completeAndSignConsultation,
  reopenVisitForAmendment,
  finalizeVisitAmendment,
} from "@/features/consultation/actions";
import { addConsultationDiagnosis } from "@/features/terminology/actions";
import {
  addPrescriptionItem,
  removePrescriptionItem,
  getPrescriptionPdfSignedUrl,
} from "@/features/prescriptions/actions";
import { generateAndArchivePrescriptionPdf } from "@/features/prescriptions/pdf/generator";
import { PrescriptionPdfPayload } from "@/features/prescriptions/pdf/prescription-document";

describe("Prescription Archival, Server-Side React-PDF, & Post-Sign-Off Amendment Lifecycle (REQ-e-prescriptions, REQ-diagnosis-visit-management, REQ-multi-tenancy)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let sessionA: { userId: string; tenantId: string };
  let sessionB: { userId: string; tenantId: string };

  let patientAId: string;
  let visitAId: string;
  let prescriptionAId: string;
  let med1ItemId: string;

  beforeAll(async () => {
    // 1. Seed test tenants
    tenantA = await seedTenantWithOwner("Apex Medical Center");
    tenantB = await seedTenantWithOwner("Beacon Diagnostics & Clinic");

    sessionA = { userId: tenantA.userId, tenantId: tenantA.tenantId };
    sessionB = { userId: tenantB.userId, tenantId: tenantB.tenantId };

    // 2. Create test patient for Tenant A
    const { data: patient, error: pErr } = await tenantA.client
      .from("patients")
      .insert({
        tenant_id: tenantA.tenantId,
        full_name: "Sunita Rao",
        phone: "+919876543222",
        age: 38,
        sex: "female",
        allergies: ["Aspirin"],
        created_by: tenantA.userId,
      })
      .select("id")
      .single();

    if (pErr || !patient) {
      throw new Error(`Failed to seed patient Sunita Rao: ${pErr?.message}`);
    }
    patientAId = patient.id;
  });

  it("1. Create visit encounter, add clinical notes, diagnoses, and prescription items", async () => {
    // 1. Create walk-in visit
    const visitRes = await createVisit(
      {
        patient_id: patientAId,
        doctor_id: tenantA.userId,
        origin_type: "walk_in",
        estimated_duration_minutes: 15,
        reason_for_visit: "High grade fever with body ache",
      },
      tenantA.client,
      sessionA
    );
    expect(visitRes.success).toBe(true);
    if (!visitRes.success) return;
    visitAId = visitRes.visitId;

    // 2. Transition status to in_consultation
    const queueRes = await transitionQueueState(visitAId, "in_consultation", tenantA.client, sessionA);
    expect(queueRes.success).toBe(true);

    // 3. Save consultation SOAP clinical documentation
    const draftRes = await saveConsultationDraft(
      {
        visit_id: visitAId,
        specialty: "general_physician",
        vitals: {
          systolic: 120,
          diastolic: 80,
          pulse: 76,
          temperature: 100.4,
          spo2: 98,
          weight: 62,
          height: 165,
        },
        chief_complaints: [
          { symptom: "High grade fever", duration_val: 2, duration_unit: "days" },
        ],
        clinical_notes: "Patient presents with chills and rigors. Chest clear, throat mildly congested.",
        advice: ["Strict bed rest", "Maintain oral fluid intake > 2.5L/day"],
        investigations_advised: ["Complete Blood Count (CBC)"],
      },
      tenantA.client,
      sessionA
    );
    expect(draftRes.success).toBe(true);

    // 4. Add diagnosis
    const diagRes = await addConsultationDiagnosis(
      {
        visit_id: visitAId,
        patient_id: patientAId,
        diagnosis_name: "Acute Upper Respiratory Tract Infection",
        icd11_code: "CA40",
        is_chronic: false,
        is_custom: false,
      },
      tenantA.client,
      sessionA
    );
    expect(diagRes.success).toBe(true);

    // 5. Prescribe 2 medications (Paracetamol 650mg & Cetirizine 10mg)
    const med1Res = await addPrescriptionItem(
      visitAId,
      {
        medicine_name: "Paracetamol 650mg",
        generic_name: "Paracetamol",
        dose_form: "Tablet",
        dosage: "1-0-1",
        timing: "After food",
        duration: "3 days",
        special_instructions: "Take SOS if temp > 100°F",
      },
      tenantA.client,
      sessionA
    );
    expect(med1Res.success).toBe(true);
    if (!med1Res.success) return;
    prescriptionAId = med1Res.prescriptionId;
    med1ItemId = med1Res.itemId;

    const med2Res = await addPrescriptionItem(
      visitAId,
      {
        medicine_name: "Cetirizine 10mg",
        generic_name: "Cetirizine Hydrochloride",
        dose_form: "Tablet",
        dosage: "0-0-1",
        timing: "After food",
        duration: "5 days",
        special_instructions: "Take at bedtime",
      },
      tenantA.client,
      sessionA
    );
    expect(med2Res.success).toBe(true);
  });

  it("2. Call completeAndSignConsultation: transitions visit to 'completed' and seals prescription v1", async () => {
    const signRes = await completeAndSignConsultation(visitAId, tenantA.client, sessionA);
    expect(signRes.success).toBe(true);

    // Verify visit status is completed and signed_at is recorded
    const { data: visitRow } = await tenantA.client
      .from("visits")
      .select("status, signed_at, signed_by")
      .eq("id", visitAId)
      .single();

    expect(visitRow?.status).toBe("completed");
    expect(visitRow?.signed_at).not.toBeNull();
    expect(visitRow?.signed_by).toBe(tenantA.userId);

    // Verify prescription status is active, version is 1, and signed_at is stamped
    const { data: rxRow } = await tenantA.client
      .from("prescriptions")
      .select("version, status, signed_at")
      .eq("id", prescriptionAId)
      .single();

    expect(rxRow?.version).toBe(1);
    expect(rxRow?.status).toBe("active");
    expect(rxRow?.signed_at).not.toBeNull();
  });

  it("3. Server-side PDF Compilation produces valid binary buffer with %PDF- header", async () => {
    const payload: PrescriptionPdfPayload = {
      tenant_id: tenantA.tenantId,
      visit_id: visitAId,
      prescription_id: prescriptionAId,
      version: 1,
      letterhead_mode: "blank_paper",
      clinic: {
        name: "Apex Medical Center",
        address: "123 Medical Road, Bengaluru",
        phone: "+91 80 2345 6789",
      },
      doctor: {
        name: "Dr. Apex Doctor",
        qualifications: "MBBS, MD",
        medical_council_reg_no: "KMC/12345",
      },
      patient: {
        full_name: "Sunita Rao",
        age: 38,
        sex: "female",
        phone: "+919876543222",
      },
      visit: {
        visit_date: "2026-10-15",
        vitals: { systolic: 120, diastolic: 80, pulse: 76, temperature: 100.4, weight: 62 },
        chief_complaints: [{ symptom: "High grade fever", duration_val: 2, duration_unit: "days" }],
        clinical_notes: "Patient presents with chills and rigors.",
      },
      diagnoses: [{ diagnosis_name: "Acute Upper Respiratory Tract Infection", icd11_code: "CA40" }],
      medications: [
        {
          medicine_name: "Paracetamol 650mg",
          dosage: "1-0-1",
          timing: "After food",
          duration: "3 days",
        },
      ],
      investigations_advised: ["Complete Blood Count (CBC)"],
      advice: ["Strict bed rest"],
    };

    const genRes = await generateAndArchivePrescriptionPdf(payload, tenantA.client, sessionA);

    expect(genRes.buffer).toBeDefined();
    expect(genRes.buffer.length).toBeGreaterThan(1000);
    // Verifies PDF magic bytes %PDF-
    expect(genRes.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(genRes.storagePath).toBe(`${tenantA.tenantId}/${visitAId}/rx_v1.pdf`);
    expect(genRes.signedUrl).toContain("http");
  });

  it("4. getPrescriptionPdfSignedUrl generates valid 3600s signed URLs for both Blank Paper and Pre-Printed modes", async () => {
    // 1. Blank paper mode
    const blankRes = await getPrescriptionPdfSignedUrl(
      prescriptionAId,
      "blank_paper",
      tenantA.client,
      sessionA
    );

    expect(blankRes.success).toBe(true);
    if (blankRes.success) {
      expect(blankRes.signedUrl).toContain("http");
      expect(blankRes.version).toBe(1);
    }

    // 2. Pre-printed letterhead mode
    const preprintedRes = await getPrescriptionPdfSignedUrl(
      prescriptionAId,
      "preprinted_letterhead",
      tenantA.client,
      sessionA
    );

    expect(preprintedRes.success).toBe(true);
    if (preprintedRes.success) {
      expect(preprintedRes.signedUrl).toContain("http");
      expect(preprintedRes.version).toBe(1);
    }
  });

  it("5. Post-sign-off amendment lifecycle: enforces justification, creates immutable revision snapshot, and increments version to v2", async () => {
    // 1. Attempt amendment without valid reason (< 10 chars) -> must fail
    const invalidRes = await reopenVisitForAmendment(
      visitAId,
      "Too short",
      tenantA.client,
      sessionA
    );
    expect(invalidRes.success).toBe(false);

    // 2. Reopen for amendment with valid mandatory reason
    const validReason = "Adjusted medication dosage after CBC showed viral etiology";
    const reopenRes = await reopenVisitForAmendment(
      visitAId,
      validReason,
      tenantA.client,
      sessionA
    );

    expect(reopenRes.success).toBe(true);
    if (reopenRes.success) {
      expect(reopenRes.revisionNumber).toBe(1);
    }

    // 3. Verify snapshot is permanently stored in visit_revisions table
    const { data: revisionRow, error: revErr } = await tenantA.client
      .from("visit_revisions")
      .select("*")
      .eq("visit_id", visitAId)
      .eq("revision_number", 1)
      .single();

    expect(revErr).toBeNull();
    expect(revisionRow).not.toBeNull();
    expect(revisionRow?.amendment_reason).toBe(validReason);
    expect(revisionRow?.snapshot).toBeDefined();

    // Verify snapshot captured frozen v1 state
    const snap = revisionRow?.snapshot as Record<string, unknown>;
    expect((snap.visit as Record<string, unknown>).status).toBe("completed");
    expect((snap.prescription as Record<string, unknown>).version).toBe(1);
    expect(((snap.prescription as Record<string, unknown>).items as unknown[]).length).toBe(2);

    // 4. Verify visit status has returned to 'in_consultation' to allow doctor edits
    const { data: reopenedVisit } = await tenantA.client
      .from("visits")
      .select("status")
      .eq("id", visitAId)
      .single();

    expect(reopenedVisit?.status).toBe("in_consultation");

    // 5. Doctor edits medication: Remove 650mg and add 500mg
    const removeRes = await removePrescriptionItem(med1ItemId, visitAId, tenantA.client, sessionA);
    expect(removeRes.success).toBe(true);

    const addRes = await addPrescriptionItem(
      visitAId,
      {
        medicine_name: "Paracetamol 500mg",
        generic_name: "Paracetamol",
        dose_form: "Tablet",
        dosage: "1-0-1",
        timing: "After food",
        duration: "3 days",
        special_instructions: "Reduced dose to 500mg",
      },
      tenantA.client,
      sessionA
    );
    expect(addRes.success).toBe(true);

    // 6. Doctor finalizes amendment
    const finalizeRes = await finalizeVisitAmendment(visitAId, tenantA.client, sessionA);
    expect(finalizeRes.success).toBe(true);
    if (finalizeRes.success) {
      expect(finalizeRes.version).toBe(2);
    }

    // 7. Verify prescription version counter is incremented to 2 and stamped with amendment reason
    const { data: amendedRx } = await tenantA.client
      .from("prescriptions")
      .select("version, amendment_reason, status")
      .eq("id", prescriptionAId)
      .single();

    expect(amendedRx?.version).toBe(2);
    expect(amendedRx?.amendment_reason).toBe(validReason);

    // 8. Verify visit status is sealed back to 'completed'
    const { data: finalizedVisit } = await tenantA.client
      .from("visits")
      .select("status")
      .eq("id", visitAId)
      .single();

    expect(finalizedVisit?.status).toBe("completed");

    // 9. Verify amended PDF signed URL returns v2
    const v2PdfRes = await getPrescriptionPdfSignedUrl(
      prescriptionAId,
      "blank_paper",
      tenantA.client,
      sessionA
    );
    expect(v2PdfRes.success).toBe(true);
    if (v2PdfRes.success) {
      expect(v2PdfRes.version).toBe(2);
    }
  });

  it("6. Multi-tenant RLS isolation prevents Tenant B from reading revision snapshots or PDFs", async () => {
    // 1. Tenant B cannot read Tenant A's revision snapshots
    const { data: bRevisions, error: bRevErr } = await tenantB.client
      .from("visit_revisions")
      .select("*")
      .eq("visit_id", visitAId);

    expect(bRevErr).toBeNull();
    expect(bRevisions).toHaveLength(0);

    // 2. Tenant B cannot reopen Tenant A's visit for amendment
    const maliciousReopen = await reopenVisitForAmendment(
      visitAId,
      "Malicious unauthorized attempt to reopen Tenant A visit",
      tenantB.client,
      sessionB
    );
    expect(maliciousReopen.success).toBe(false);

    // 3. Tenant B cannot generate or access Tenant A's signed prescription PDF URL
    const maliciousPdf = await getPrescriptionPdfSignedUrl(
      prescriptionAId,
      "blank_paper",
      tenantB.client,
      sessionB
    );
    expect(maliciousPdf.success).toBe(false);
  });
});
