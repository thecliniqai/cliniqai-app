/**
 * Patient clinical visit history (Plan 03.2-01 / REQ-patient-records) on the local stack.
 *
 * V2-02 02-04 (TEST_STRATEGY T-12, E-5): rewritten from a hand-built query-builder mock, whose "isolation" check
 * only proved the service called `.eq("tenant_id", ...)` and whose "ordering" check returned rows in insertion
 * order. Here two tenants are seeded and the service runs with each owner's own JWT client (RLS applies), so the
 * assertions are about what a caller actually receives.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getPatientVisitHistory } from "@/features/patients/service";
import {
  addMemberToTenant,
  createDualMembershipUser,
  seedTenantWithOwner,
  type SeededTenant,
} from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";

async function insertRow(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await getAdminClient().from(table).insert(row).select("id").single();
  if (error || !data) throw new Error(`${table} seed failed: ${error?.message}`);
  return data.id as string;
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

describe("Patient Clinical Visit History (Plan 03.2-01 / REQ-patient-records)", () => {
  let ownerA: SeededTenant;
  let doctorA1: SeededTenant;
  let doctorA2: SeededTenant;
  let ownerB: SeededTenant;
  let doctorB: SeededTenant;
  let patientA: string;
  let patientB: string;
  let emptyPatientA: string;
  let olderVisitA: string;
  let newerVisitA: string;
  let visitB: string;

  beforeAll(async () => {
    const admin = getAdminClient();
    const suffix = randomUUID().slice(0, 8);

    ownerA = await seedTenantWithOwner(`History Clinic A ${suffix}`);
    doctorA1 = await addMemberToTenant(ownerA.tenantId, "doctor");
    doctorA2 = await addMemberToTenant(ownerA.tenantId, "doctor");
    ownerB = await seedTenantWithOwner(`History Clinic B ${suffix}`);
    doctorB = await addMemberToTenant(ownerB.tenantId, "doctor");

    for (const [doctor, name, quals, reg] of [
      [doctorA1, "Dr. Synthetic One", "MBBS, MD", "MCI-00001"],
      [doctorA2, "Dr. Synthetic Two", "MBBS", "DMC-00002"],
    ] as const) {
      const { error } = await admin
        .from("memberships")
        .update({ full_name: name, qualifications: quals, medical_council_reg_no: reg })
        .eq("user_id", doctor.userId)
        .eq("tenant_id", ownerA.tenantId);
      if (error) throw new Error(`doctor profile seed failed: ${error.message}`);
    }

    patientA = await insertRow("patients", {
      tenant_id: ownerA.tenantId,
      full_name: "Synthetic History Patient A",
      phone: "+919800000201",
      sex: "female",
      age: 34,
      created_by: ownerA.userId,
    });
    emptyPatientA = await insertRow("patients", {
      tenant_id: ownerA.tenantId,
      full_name: "Synthetic History Patient Empty",
      phone: "+919800000202",
      sex: "male",
      age: 50,
      created_by: ownerA.userId,
    });
    patientB = await insertRow("patients", {
      tenant_id: ownerB.tenantId,
      full_name: "Synthetic History Patient B",
      phone: "+919800000203",
      sex: "male",
      age: 41,
      created_by: ownerB.userId,
    });

    // Inserted oldest first so that insertion order and the expected (newest-first) order differ.
    olderVisitA = await insertRow("visits", {
      tenant_id: ownerA.tenantId,
      patient_id: patientA,
      doctor_id: doctorA1.userId,
      origin_type: "walk_in",
      status: "completed",
      scheduled_at: daysAgo(2),
      created_at: daysAgo(2),
      reason_for_visit: "Synthetic fever",
      specialty: "general_physician",
      vitals: { systolic: 120, diastolic: 80, pulse: 72 },
      chief_complaints: [{ symptom: "Fever", duration_val: 3, duration_unit: "days" }],
      clinical_notes: "Synthetic note one.",
      investigations_advised: ["CBC"],
      advice: ["Rest"],
      created_by: ownerA.userId,
    });
    newerVisitA = await insertRow("visits", {
      tenant_id: ownerA.tenantId,
      patient_id: patientA,
      doctor_id: doctorA2.userId,
      origin_type: "scheduled",
      status: "in_consultation",
      scheduled_at: daysAgo(1),
      created_at: daysAgo(1),
      reason_for_visit: "Synthetic follow-up",
      specialty: "general_physician",
      created_by: ownerA.userId,
    });
    visitB = await insertRow("visits", {
      tenant_id: ownerB.tenantId,
      patient_id: patientB,
      doctor_id: doctorB.userId,
      origin_type: "walk_in",
      status: "completed",
      scheduled_at: daysAgo(1),
      reason_for_visit: "Synthetic tenant B visit",
      created_by: ownerB.userId,
    });

    await insertRow("queue_tokens", { tenant_id: ownerA.tenantId, visit_id: olderVisitA, token_number: 14 });
    await insertRow("consultation_diagnoses", {
      tenant_id: ownerA.tenantId,
      visit_id: olderVisitA,
      patient_id: patientA,
      diagnosis_name: "Acute Upper Respiratory Infection",
      icd11_code: "CA40",
    });
    const rxId = await insertRow("prescriptions", {
      tenant_id: ownerA.tenantId,
      visit_id: olderVisitA,
      patient_id: patientA,
      doctor_id: doctorA1.userId,
      version: 1,
      status: "active",
      letterhead_mode: "blank_paper",
      signed_at: daysAgo(2),
    });
    await insertRow("prescription_items", {
      prescription_id: rxId,
      medicine_name: "Paracetamol 650mg",
      generic_name: "Paracetamol",
      dose_form: "Tablet",
      dosage: "1-0-1",
      timing: "After food",
      duration: "5 days",
    });
    const invoiceId = await insertRow("invoices", {
      tenant_id: ownerA.tenantId,
      patient_id: patientA,
      visit_id: olderVisitA,
      invoice_number: `INV-HIST-${suffix}`,
      subtotal: 500,
      total_amount: 500,
      status: "paid",
    });
    for (const [amount, method] of [
      [300, "cash"],
      [200, "upi"],
    ] as const) {
      await insertRow("payments", {
        tenant_id: ownerA.tenantId,
        invoice_id: invoiceId,
        amount,
        payment_method: method,
        recorded_by: ownerA.userId,
        recorded_at: daysAgo(2),
      });
    }
  });

  it("returns only the active tenant's visits, newest first, with doctor, token, diagnoses, prescription and billing", async () => {
    const result = await getPatientVisitHistory(ctxFor(ownerA), patientA);

    expect(result.map((v) => v.id)).toEqual([newerVisitA, olderVisitA]);
    expect(result.map((v) => v.id)).not.toContain(visitB);

    const [newer, older] = result;
    expect(newer.doctor.full_name).toBe("Dr. Synthetic Two");
    expect(older.doctor.full_name).toBe("Dr. Synthetic One");
    expect(older.doctor.qualifications).toBe("MBBS, MD");

    expect(older.token_number).toBe(14);
    expect(older.diagnoses).toHaveLength(1);
    expect(older.diagnoses[0].diagnosis_name).toBe("Acute Upper Respiratory Infection");
    expect(older.diagnoses[0].icd11_code).toBe("CA40");

    expect(older.prescription?.items).toHaveLength(1);
    expect(older.prescription?.items[0].medicine_name).toBe("Paracetamol 650mg");

    expect(older.invoice?.total_amount).toBe(500);
    expect(older.invoice?.total_paid).toBe(500);
    expect(older.invoice?.balance_due).toBe(0);

    expect(newer.diagnoses).toEqual([]);
    expect(newer.prescription ?? null).toBeNull();
    expect(newer.invoice ?? null).toBeNull();
  });

  it("gives tenant A's caller nothing for tenant B's patient, while B's own caller sees B's visit", async () => {
    expect(await getPatientVisitHistory(ctxFor(ownerA), patientB)).toEqual([]);

    const bHistory = await getPatientVisitHistory(ctxFor(ownerB), patientB);
    expect(bHistory.map((v) => v.id)).toEqual([visitB]);
    expect(bHistory[0].diagnoses).toEqual([]);
  });

  it("scopes to the context's tenant even for a user whose RLS reaches both tenants", async () => {
    const dual = await createDualMembershipUser(ownerA.tenantId, "doctor", ownerB.tenantId, "receptionist");
    const inA = ctxFor({ userId: dual.userId, tenantId: ownerA.tenantId, role: dual.roleInA, client: dual.client });
    const inB = ctxFor({ userId: dual.userId, tenantId: ownerB.tenantId, role: dual.roleInB, client: dual.client });

    // The same JWT can read B's visit when acting in B ...
    expect((await getPatientVisitHistory(inB, patientB)).map((v) => v.id)).toEqual([visitB]);
    // ... but acting in A it receives none of B's rows.
    expect(await getPatientVisitHistory(inA, patientB)).toEqual([]);
    expect((await getPatientVisitHistory(inA, patientA)).map((v) => v.id)).toEqual([newerVisitA, olderVisitA]);
  });

  it("handles a patient with zero visits cleanly", async () => {
    expect(await getPatientVisitHistory(ctxFor(ownerA), emptyPatientA)).toEqual([]);
  });
});
