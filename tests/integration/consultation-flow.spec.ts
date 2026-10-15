import { describe, it, expect, beforeAll } from "vitest";
import { seedTenantWithOwner } from "../helpers/tenants";
import { createVisit } from "@/features/visits/actions";
import { checkInVisit, transitionQueueState } from "@/features/queue/actions";
import { saveConsultationDraft, recordFollowUp, getPatientConsultationHistory } from "@/features/consultation/actions";
import {
  searchDiagnoses,
  addConsultationDiagnosis,
  getVisitDiagnoses,
} from "@/features/terminology/actions";
import {
  addPrescriptionItem,
  getVisitPrescription,
} from "@/features/prescriptions/actions";

describe("Consultation Lifecycle & Clinical Data Progression (REQ-consultation-workspace, REQ-prescribing, REQ-multi-tenancy)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let sessionA: { userId: string; tenantId: string };
  let sessionB: { userId: string; tenantId: string };

  let patientAId: string;
  let visitAId: string;
  let prescriptionAId: string;

  beforeAll(async () => {
    // 1. Seed two distinct clinics for multi-tenant isolation testing
    tenantA = await seedTenantWithOwner("Apex Dental & General Clinic");
    tenantB = await seedTenantWithOwner("Beacon Hospital & Research");

    sessionA = { userId: tenantA.userId, tenantId: tenantA.tenantId };
    sessionB = { userId: tenantB.userId, tenantId: tenantB.tenantId };

    // 2. Create test patient for Tenant A
    const { data: patient, error: pErr } = await tenantA.client
      .from("patients")
      .insert({
        tenant_id: tenantA.tenantId,
        full_name: "Ramesh Patel",
        phone: "+919876543210",
        age: 42,
        sex: "male",
        allergies: ["Penicillin", "Sulfa"],
        chronic_conditions: ["Dyslipidemia"],
        created_by: tenantA.userId,
      })
      .select("id")
      .single();

    if (pErr || !patient) {
      throw new Error(`Failed to create test patient for Tenant A: ${pErr?.message}`);
    }
    patientAId = patient.id;
  });

  it("1. Setup fixture and create scheduled visit (status 'booked')", async () => {
    const scheduledTime = new Date().toISOString();
    const createRes = await createVisit(
      {
        patient_id: patientAId,
        doctor_id: tenantA.userId,
        origin_type: "scheduled",
        scheduled_at: scheduledTime,
        estimated_duration_minutes: 20,
        reason_for_visit: "Severe tooth pain and fever",
      },
      tenantA.client,
      sessionA
    );

    expect(createRes.success).toBe(true);
    if (!createRes.success) return;
    visitAId = createRes.visitId;

    const { data: visitRow, error } = await tenantA.client
      .from("visits")
      .select("id, status, origin_type")
      .eq("id", visitAId)
      .single();

    expect(error).toBeNull();
    expect(visitRow?.status).toBe("booked");
    expect(visitRow?.origin_type).toBe("scheduled");
  });

  it("2. Check-in visit: transitions status from 'booked' -> 'waiting' and generates token", async () => {
    const checkInRes = await checkInVisit(visitAId, "normal", tenantA.client, sessionA);

    expect(checkInRes.success).toBe(true);
    if (!checkInRes.success) return;
    expect(checkInRes.tokenNumber).toBeGreaterThanOrEqual(1);

    const { data: visitRow } = await tenantA.client
      .from("visits")
      .select("status")
      .eq("id", visitAId)
      .single();

    expect(visitRow?.status).toBe("waiting");
  });

  it("3. Nurse records patient vitals during 'waiting' queue state without altering status", async () => {
    const triageVitals = {
      systolic: 130,
      diastolic: 85,
      pulse: 82,
      temperature: 99.4,
      spo2: 98,
      weight: 74,
      height: 172,
    };

    const { error: vitalsErr } = await tenantA.client
      .from("visits")
      .update({ vitals: triageVitals, updated_at: new Date().toISOString() })
      .eq("id", visitAId);

    expect(vitalsErr).toBeNull();

    const { data: visitRow } = await tenantA.client
      .from("visits")
      .select("status, vitals")
      .eq("id", visitAId)
      .single();

    expect(visitRow?.status).toBe("waiting");
    expect(visitRow?.vitals).toEqual(triageVitals);
  });

  it("4. Doctor calls patient into consultation room: transitions status to 'in_consultation'", async () => {
    const transitionRes = await transitionQueueState(
      visitAId,
      "in_consultation",
      tenantA.client,
      sessionA
    );

    expect(transitionRes.success).toBe(true);

    const { data: visitRow } = await tenantA.client
      .from("visits")
      .select("status")
      .eq("id", visitAId)
      .single();

    expect(visitRow?.status).toBe("in_consultation");
  });

  it("5. Doctor records chief complaints, clinical examination notes, and specialty data (dental odontogram)", async () => {
    const draftRes = await saveConsultationDraft(
      {
        visit_id: visitAId,
        specialty: "dental",
        vitals: {
          systolic: 128,
          diastolic: 82,
          pulse: 80,
          temperature: 99.2,
          weight: 74,
        },
        chief_complaints: [
          {
            symptom: "Severe throbbing pain in lower right molar",
            duration_val: 3,
            duration_unit: "days",
          },
        ],
        clinical_notes:
          "Deep cavitated lesion observed on occlusal surface of tooth 46 with tenderness on vertical percussion. No visible swelling.",
        specialty_data: {
          specialty: "dental",
          odontogram: [
            {
              tooth_number: 46,
              condition_tags: ["decay"],
              notes: "Deep dentinal caries near pulp chamber",
            },
          ],
          general_notes: "Deep cavitated lesion observed on occlusal surface",
        },
        advice: [
          "Avoid biting on hard foods on the right side",
          "Warm salt water rinses three times daily",
        ],
        investigations_advised: ["Intraoral Periapical (IOPA) X-Ray #46"],
      },
      tenantA.client,
      sessionA
    );

    expect(draftRes.success).toBe(true);

    const { data: visitRow } = await tenantA.client
      .from("visits")
      .select("specialty, chief_complaints, clinical_notes, specialty_data, advice, investigations_advised")
      .eq("id", visitAId)
      .single();

    expect(visitRow?.specialty).toBe("dental");
    expect(visitRow?.clinical_notes).toContain("Deep cavitated lesion observed");
    expect(visitRow?.chief_complaints).toHaveLength(1);
    expect(visitRow?.advice).toHaveLength(2);
    expect(visitRow?.investigations_advised).toContain("Intraoral Periapical (IOPA) X-Ray #46");
    expect((visitRow?.specialty_data as Record<string, unknown>)?.odontogram).toBeDefined();
  });

  it("6. Doctor searches terminology and adds 2 diagnoses (1 chronic synced to patient profile, 1 custom)", async () => {
    // 1. Search diagnoses
    const searchRes = await searchDiagnoses(
      { query: "Hypertension", limit: 5 },
      tenantA.client,
      sessionA
    );
    expect(searchRes.success).toBe(true);

    // 2. Add catalog diagnosis with is_chronic: true
    const chronicDiagRes = await addConsultationDiagnosis(
      {
        visit_id: visitAId,
        patient_id: patientAId,
        diagnosis_name: "Essential Hypertension",
        icd11_code: "BA00",
        snomed_concept_id: "38341003",
        is_chronic: true,
        is_custom: false,
        notes: "BP consistently elevated; starting regular monitoring",
      },
      tenantA.client,
      sessionA
    );
    expect(chronicDiagRes.success).toBe(true);

    // Verify patient's persistent profile was automatically updated with chronic condition
    const { data: patientAfterChronic } = await tenantA.client
      .from("patients")
      .select("chronic_conditions")
      .eq("id", patientAId)
      .single();

    expect(patientAfterChronic?.chronic_conditions).toContain("Essential Hypertension");
    expect(patientAfterChronic?.chronic_conditions).toContain("Dyslipidemia");

    // 3. Add custom diagnosis for dental pulpitis
    const customDiagRes = await addConsultationDiagnosis(
      {
        visit_id: visitAId,
        patient_id: patientAId,
        diagnosis_name: "Acute Irreversible Pulpitis - 46",
        is_chronic: false,
        is_custom: true,
        notes: "Endodontic access opening advised",
      },
      tenantA.client,
      sessionA
    );
    expect(customDiagRes.success).toBe(true);

    // Verify custom diagnosis was saved to doctor_custom_diagnoses for Doctor A
    const { data: doctorCustom } = await tenantA.client
      .from("doctor_custom_diagnoses")
      .select("diagnosis_name, use_count")
      .eq("tenant_id", tenantA.tenantId)
      .eq("doctor_id", tenantA.userId)
      .eq("diagnosis_name", "Acute Irreversible Pulpitis - 46")
      .single();

    expect(doctorCustom?.diagnosis_name).toBe("Acute Irreversible Pulpitis - 46");

    // 4. Verify both diagnoses are returned for this visit
    const visitDiagsRes = await getVisitDiagnoses(visitAId, tenantA.client, sessionA);
    expect(visitDiagsRes.success).toBe(true);
    if (visitDiagsRes.success) {
      expect(visitDiagsRes.diagnoses).toHaveLength(2);
      const names = visitDiagsRes.diagnoses.map((d) => d.diagnosis_name);
      expect(names).toContain("Essential Hypertension");
      expect(names).toContain("Acute Irreversible Pulpitis - 46");
    }
  });

  it("7. Doctor prescribes 2 medications using fast dosage chips (Paracetamol & Amoxicillin)", async () => {
    // 1. Prescribe Paracetamol 650mg
    const med1Res = await addPrescriptionItem(
      visitAId,
      {
        medicine_name: "Paracetamol 650mg",
        generic_name: "Paracetamol",
        dose_form: "Tablet",
        dosage: "1-0-1",
        timing: "After food",
        duration: "5 days",
        special_instructions: "Take SOS if pain recurs",
      },
      tenantA.client,
      sessionA
    );
    expect(med1Res.success).toBe(true);
    if (!med1Res.success) return;
    prescriptionAId = med1Res.prescriptionId;

    // 2. Prescribe Amoxicillin 500mg
    const med2Res = await addPrescriptionItem(
      visitAId,
      {
        medicine_name: "Amoxicillin 500mg",
        generic_name: "Amoxicillin",
        dose_form: "Capsule",
        dosage: "1-0-1",
        timing: "After food",
        duration: "5 days",
        special_instructions: "Complete full 5-day course",
      },
      tenantA.client,
      sessionA
    );
    expect(med2Res.success).toBe(true);

    // 3. Verify prescription and ordered items
    const rxRes = await getVisitPrescription(visitAId, tenantA.client, sessionA);
    expect(rxRes.success).toBe(true);
    if (rxRes.success && rxRes.prescription) {
      expect(rxRes.prescription.id).toBe(prescriptionAId);
      expect(rxRes.prescription.status).toBe("active");
      expect(rxRes.prescription.items).toHaveLength(2);

      const [item1, item2] = rxRes.prescription.items;
      expect(item1.medicine_name).toBe("Paracetamol 650mg");
      expect(item1.dosage).toBe("1-0-1");
      expect(item1.timing).toBe("After food");
      expect(item1.duration).toBe("5 days");

      expect(item2.medicine_name).toBe("Amoxicillin 500mg");
      expect(item2.dosage).toBe("1-0-1");
      expect(item2.timing).toBe("After food");
    }
  });

  it("8. Doctor selects follow-up in 5 days; persists to follow_ups table", async () => {
    const followUpDate = new Date(Date.now() + 5 * 86400000).toISOString().split("T")[0];

    const followUpRes = await recordFollowUp(
      {
        visitId: visitAId,
        patientId: patientAId,
        followUpDate,
        notes: "RCT obturation and crown preparation",
      },
      tenantA.client,
      sessionA
    );

    expect(followUpRes.success).toBe(true);

    const { data: followUpRow, error } = await tenantA.client
      .from("follow_ups")
      .select("id, status, follow_up_date, notes")
      .eq("visit_id", visitAId)
      .single();

    expect(error).toBeNull();
    expect(followUpRow?.status).toBe("scheduled");
    expect(followUpRow?.follow_up_date).toBe(followUpDate);
    expect(followUpRow?.notes).toBe("RCT obturation and crown preparation");
  });

  it("9. Complete consultation: transitions status directly to 'completed' and verifies history retrieval", async () => {
    const compRes = await transitionQueueState(
      visitAId,
      "completed",
      tenantA.client,
      sessionA
    );
    expect(compRes.success).toBe(true);

    const { data: visitRow } = await tenantA.client
      .from("visits")
      .select("status")
      .eq("id", visitAId)
      .single();

    expect(visitRow?.status).toBe("completed");

    // Longitudinal patient history query retrieves completed consultation encounter
    const historyRes = await getPatientConsultationHistory(
      patientAId,
      undefined,
      tenantA.client,
      sessionA
    );

    expect(historyRes.success).toBe(true);
    if (historyRes.success) {
      expect(historyRes.encounters).toHaveLength(1);
      const encounter = historyRes.encounters[0];
      expect(encounter.visitId).toBe(visitAId);
      expect(encounter.status).toBe("completed");
      expect(encounter.specialty).toBe("dental");
      expect(encounter.diagnoses).toHaveLength(2);
      expect(encounter.prescriptions).toHaveLength(1);
      expect(encounter.prescriptions[0].items).toHaveLength(2);
    }
  });

  it("10. Strict Row Level Security prevents Tenant B from reading or modifying Tenant A's consultation data", async () => {
    // 1. Tenant B cannot read Tenant A's consultation diagnoses
    const { data: bDiags, error: bDiagErr } = await tenantB.client
      .from("consultation_diagnoses")
      .select("*")
      .eq("visit_id", visitAId);

    expect(bDiagErr).toBeNull();
    expect(bDiags).toHaveLength(0);

    // 2. Tenant B cannot read Tenant A's active prescriptions
    const { data: bRx, error: bRxErr } = await tenantB.client
      .from("prescriptions")
      .select("*")
      .eq("visit_id", visitAId);

    expect(bRxErr).toBeNull();
    expect(bRx).toHaveLength(0);

    // 3. Tenant B cannot read Tenant A's prescription items
    const { data: bItems, error: bItemsErr } = await tenantB.client
      .from("prescription_items")
      .select("*")
      .eq("prescription_id", prescriptionAId);

    expect(bItemsErr).toBeNull();
    expect(bItems).toHaveLength(0);

    // 4. Tenant B cannot read Tenant A's doctor custom diagnoses
    const { data: bCustomDiags, error: bCustomErr } = await tenantB.client
      .from("doctor_custom_diagnoses")
      .select("*")
      .eq("tenant_id", tenantA.tenantId);

    expect(bCustomErr).toBeNull();
    expect(bCustomDiags).toHaveLength(0);

    // 5. Tenant B cannot read Tenant A's follow-up appointments
    const { data: bFollowUps, error: bFollowErr } = await tenantB.client
      .from("follow_ups")
      .select("*")
      .eq("visit_id", visitAId);

    expect(bFollowErr).toBeNull();
    expect(bFollowUps).toHaveLength(0);

    // 6. Cross-tenant insertion forgery is blocked by RLS WITH CHECK
    const { data: maliciousDiag, error: maliciousDiagErr } = await tenantB.client
      .from("consultation_diagnoses")
      .insert({
        tenant_id: tenantA.tenantId,
        visit_id: visitAId,
        patient_id: patientAId,
        diagnosis_name: "Tenant B Forgery Diagnosis",
      })
      .select("id");

    expect(maliciousDiag).toBeNull();
    expect(maliciousDiagErr).not.toBeNull();
  });
});
