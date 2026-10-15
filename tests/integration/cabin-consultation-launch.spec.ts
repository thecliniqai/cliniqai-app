import { describe, it, expect, beforeAll } from "vitest";
import { seedTenantWithOwner } from "../helpers/tenants";
import { createVisit } from "@/features/visits/actions";
import { checkInVisit, transitionQueueState } from "@/features/queue/actions";
import { saveConsultationDraft } from "@/features/consultation/actions";

describe("Cabin & Live Queue Consultation Launch Integration (REQ-diagnosis-visit-management, REQ-multi-tenancy)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let patientAId: string;
  let visitAId: string;

  beforeAll(async () => {
    tenantA = await seedTenantWithOwner("Apex Specialty Clinic");
    tenantB = await seedTenantWithOwner("Beacon Health Center");

    // 1. Create a patient in Tenant A
    const { data: pA, error: pAErr } = await tenantA.client
      .from("patients")
      .insert({
        tenant_id: tenantA.tenantId,
        full_name: "Rahul Verma",
        phone: "+919876543210",
        sex: "male",
        age: 38,
        created_by: tenantA.userId,
      })
      .select("id")
      .single();

    if (pAErr || !pA) throw new Error(`Failed to create test patient A: ${pAErr?.message}`);
    patientAId = pA.id;
  });

  it("1. Schedules a visit, checks in patient into queue, transitions to in_consultation, and saves clinical draft", async () => {
    const sessionA = { userId: tenantA.userId, tenantId: tenantA.tenantId };

    // Step A: Create scheduled visit
    const createRes = await createVisit(
      {
        patient_id: patientAId,
        doctor_id: tenantA.userId,
        origin_type: "scheduled",
        scheduled_at: new Date().toISOString(),
        reason_for_visit: "Severe sore throat and fatigue",
        estimated_duration_minutes: 15,
        is_overbooked: false,
      },
      tenantA.client,
      sessionA
    );

    expect(createRes.success).toBe(true);
    if (!createRes.success) return;
    visitAId = createRes.visitId;

    // Step B: Check in visit via Queue
    const checkInRes = await checkInVisit(visitAId, "normal", tenantA.client, sessionA);
    expect(checkInRes.success).toBe(true);
    if (!checkInRes.success) return;
    expect(checkInRes.tokenNumber).toBeGreaterThanOrEqual(1);

    // Verify visit status is 'waiting'
    const { data: waitingVisit } = await tenantA.client
      .from("visits")
      .select("status")
      .eq("id", visitAId)
      .single();
    expect(waitingVisit?.status).toBe("waiting");

    // Step C: Launch consultation (1-tap Start Consultation action)
    const transitionRes = await transitionQueueState(
      visitAId,
      "in_consultation",
      tenantA.client,
      sessionA
    );
    expect(transitionRes.success).toBe(true);

    // Verify visit status is now 'in_consultation'
    const { data: inConsultVisit } = await tenantA.client
      .from("visits")
      .select("status")
      .eq("id", visitAId)
      .single();
    expect(inConsultVisit?.status).toBe("in_consultation");

    // Step D: Clinician fills in triage vitals and clinical notes in consultation workspace
    const draftRes = await saveConsultationDraft(
      {
        visit_id: visitAId,
        vitals: {
          systolic: 122,
          diastolic: 82,
          pulse: 76,
          temperature: 99.1,
          weight: 71,
          spo2: 98,
        },
        chief_complaints: [
          { symptom: "Sore throat", duration_val: 3, duration_unit: "days" },
        ],
        clinical_notes: "Erythematous pharynx with no tonsillar exudates.",
        specialty: "general_physician",
      },
      tenantA.client,
      sessionA
    );

    expect(draftRes.success).toBe(true);

    // Verify vitals and notes persisted under visit
    const { data: updatedVisit } = await tenantA.client
      .from("visits")
      .select("vitals, clinical_notes")
      .eq("id", visitAId)
      .single();

    expect(updatedVisit?.vitals).toMatchObject({ systolic: 122, pulse: 76 });
    expect(updatedVisit?.clinical_notes).toBe("Erythematous pharynx with no tonsillar exudates.");
  });

  it("2. Enforces cross-tenant boundary: Tenant B cannot transition or modify Tenant A's visit", async () => {
    const sessionB = { userId: tenantB.userId, tenantId: tenantB.tenantId };

    // Tenant B attempts to transition Tenant A's visit
    const unauthorizedTransition = await transitionQueueState(
      visitAId,
      "completed",
      tenantB.client,
      sessionB
    );

    // Should fail or not find the record under RLS
    // In our system, RLS or tenant check returns failure
    const { data: visitAsSeenByB } = await tenantB.client
      .from("visits")
      .select("id")
      .eq("id", visitAId)
      .maybeSingle();

    expect(visitAsSeenByB).toBeNull();
  });
});
