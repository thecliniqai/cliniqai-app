import { describe, it, expect, vi } from "vitest";
import { getPatientVisitHistory } from "@/features/patients/actions";
import { PatientVisitHistoryItem } from "@/features/patients/schema";

describe("Patient Clinical Visit History (Plan 03.2-01 / REQ-patient-records)", () => {
  it("enforces tenant isolation and returns reverse chronological visits with full clinical details", async () => {
    const tenantId = "tenant-100";
    const patientId = "patient-abc";
    const otherTenantId = "tenant-999";

    const mockVisits = [
      {
        id: "visit-1",
        tenant_id: tenantId,
        patient_id: patientId,
        doctor_id: "doc-1",
        origin_type: "walk_in",
        status: "completed",
        scheduled_at: "2026-10-15T10:00:00Z",
        created_at: "2026-10-15T09:45:00Z",
        reason_for_visit: "Seasonal fever & sore throat",
        specialty: "general_physician",
        vitals: { bp_sys: 120, bp_dia: 80, pulse: 72, temp: 98.6, spo2: 99, weight: 70 },
        chief_complaints: [{ complaint: "Fever", duration: "3", duration_unit: "days" }],
        clinical_notes: "Mild pharyngeal erythema. Clear lungs.",
        investigations_advised: ["CBC"],
        advice: ["Adequate hydration", "Rest"],
      },
      {
        id: "visit-2",
        tenant_id: tenantId,
        patient_id: patientId,
        doctor_id: "doc-2",
        origin_type: "scheduled",
        status: "in_consultation",
        scheduled_at: "2026-10-16T11:00:00Z",
        created_at: "2026-10-16T10:30:00Z",
        reason_for_visit: "Follow-up checkup",
        specialty: "general_physician",
        vitals: { bp_sys: 130, bp_dia: 85, pulse: 80 },
        chief_complaints: [{ complaint: "Weakness" }],
        clinical_notes: null,
      },
    ];

    const mockDoctors = [
      {
        user_id: "doc-1",
        tenant_id: tenantId,
        full_name: "Dr. Aarti Sharma",
        qualifications: "MBBS, MD",
        medical_council_reg_no: "MCI-48291",
        default_specialty: "General Medicine",
        role: "doctor",
      },
      {
        user_id: "doc-2",
        tenant_id: tenantId,
        full_name: "Dr. Vikram Patel",
        qualifications: "MBBS",
        medical_council_reg_no: "DMC-90214",
        default_specialty: "Internal Medicine",
        role: "doctor",
      },
    ];

    const mockDiagnoses = [
      {
        id: "diag-1",
        visit_id: "visit-1",
        tenant_id: tenantId,
        diagnosis_name: "Acute Upper Respiratory Infection",
        icd11_code: "CA40",
        snomed_concept_id: "195662009",
        is_chronic: false,
        notes: null,
      },
    ];

    const mockPrescriptions = [
      {
        id: "rx-1",
        visit_id: "visit-1",
        tenant_id: tenantId,
        version: 1,
        status: "active",
        signed_at: "2026-10-15T10:15:00Z",
        created_at: "2026-10-15T10:10:00Z",
      },
    ];

    const mockPrescriptionItems = [
      {
        id: "rx-item-1",
        prescription_id: "rx-1",
        medicine_name: "Paracetamol 650mg",
        generic_name: "Acetaminophen",
        dose_form: "tablet",
        dosage: "1-0-1",
        timing: "after food",
        duration: "5 days",
        sort_order: 1,
      },
    ];

    const mockInvoices = [
      {
        id: "inv-1",
        visit_id: "visit-1",
        tenant_id: tenantId,
        invoice_number: "INV-2026-001",
        total_amount: 500,
        status: "paid",
      },
    ];

    const mockPayments = [
      {
        invoice_id: "inv-1",
        amount: 500,
        tenant_id: tenantId,
      },
    ];

    // Build chainable supabase mock tracking filters
    const queryTracker = {
      tenantFilter: "",
      patientFilter: "",
    };

    const mockClient: any = {
      from: vi.fn((table: string) => {
        const query: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((col: string, val: any) => {
            if (col === "tenant_id") queryTracker.tenantFilter = val;
            if (col === "patient_id") queryTracker.patientFilter = val;
            return query;
          }),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          then: (resolve: any) => {
            if (table === "visits") {
              // Ensure tenant isolation
              const filtered = mockVisits.filter(
                (v) => v.tenant_id === queryTracker.tenantFilter && v.patient_id === queryTracker.patientFilter
              );
              return resolve({ data: filtered, error: null });
            }
            if (table === "memberships") {
              return resolve({ data: mockDoctors, error: null });
            }
            if (table === "queue_tokens") {
              return resolve({ data: [{ visit_id: "visit-1", token_number: 14 }], error: null });
            }
            if (table === "consultation_diagnoses") {
              return resolve({ data: mockDiagnoses, error: null });
            }
            if (table === "prescriptions") {
              return resolve({ data: mockPrescriptions, error: null });
            }
            if (table === "prescription_items") {
              return resolve({ data: mockPrescriptionItems, error: null });
            }
            if (table === "invoices") {
              return resolve({ data: mockInvoices, error: null });
            }
            if (table === "payments") {
              return resolve({ data: mockPayments, error: null });
            }
            return resolve({ data: [], error: null });
          },
        };
        return query;
      }),
    };

    const result = await getPatientVisitHistory(patientId, mockClient, {
      userId: "user-1",
      tenantId,
    });

    // 1. Check tenant filter enforcement
    expect(queryTracker.tenantFilter).toBe(tenantId);
    expect(queryTracker.patientFilter).toBe(patientId);

    // 2. Check visit count and order
    expect(result.length).toBe(2);
    expect(result[0].id).toBe("visit-1");
    expect(result[1].id).toBe("visit-2");

    // 3. Check doctor resolution
    expect(result[0].doctor.full_name).toBe("Dr. Aarti Sharma");
    expect(result[0].doctor.qualifications).toBe("MBBS, MD");
    expect(result[1].doctor.full_name).toBe("Dr. Vikram Patel");

    // 4. Check token number
    expect(result[0].token_number).toBe(14);

    // 5. Check diagnoses and prescriptions
    expect(result[0].diagnoses.length).toBe(1);
    expect(result[0].diagnoses[0].diagnosis_name).toBe("Acute Upper Respiratory Infection");
    expect(result[0].diagnoses[0].icd11_code).toBe("CA40");

    expect(result[0].prescription).toBeDefined();
    expect(result[0].prescription?.items.length).toBe(1);
    expect(result[0].prescription?.items[0].medicine_name).toBe("Paracetamol 650mg");

    // 6. Check invoice and payment calculation
    expect(result[0].invoice).toBeDefined();
    expect(result[0].invoice?.total_amount).toBe(500);
    expect(result[0].invoice?.total_paid).toBe(500);
    expect(result[0].invoice?.balance_due).toBe(0);
  });

  it("handles patient with zero visits cleanly", async () => {
    const mockClient: any = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        then: (resolve: any) => resolve({ data: [], error: null }),
      })),
    };

    const result = await getPatientVisitHistory("empty-patient", mockClient, {
      userId: "user-1",
      tenantId: "tenant-100",
    });

    expect(result).toEqual([]);
  });
});
