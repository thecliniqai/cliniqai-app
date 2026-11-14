/**
 * Delete paths with real JWTs (V2-05 plan 05-04; research Pitfall 11; R-21, R-22; T-05-06, T-05-07).
 *
 * Before 05-04 three deletes the product relies on were silent no-ops: the doctor's draft Rx item and diagnosis
 * removal (owner/admin-only DELETE policies) and every invoice item delete (no DELETE policy). PostgREST answers a
 * write that RLS filters with success and 0 rows, so the services reported success AND wrote an audit row for a row
 * that was still there. Since 000052 the role that performs each delete may do it (bound to the active clinic), and
 * the services ask for the deleted rows (`.select("id")`) and refuse a no-op: FORBIDDEN, row untouched, no audit row.
 *
 * Every call goes through the real service with the user's own JWT client (`ctxFor`), as in a request. Rows are
 * seeded and read back with the service-role client; synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { removePrescriptionItem } from "@/features/prescriptions/service";
import { removeConsultationDiagnosis } from "@/features/terminology/service";
import { deleteInvoiceItem } from "@/features/billing/service";
import { saveConsultationDraft } from "@/features/consultation/service";
import { DEFAULT_APP_ERROR_MESSAGES } from "@/lib/errors/app-error";
import type { ServiceContext } from "@/lib/auth/context";
import { ctxFor } from "../helpers/context";
import { signInActingIn } from "../helpers/active-tenant";
import { consultationDraftInput } from "../helpers/fixtures";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, createDualMembershipUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

const FORBIDDEN = DEFAULT_APP_ERROR_MESSAGES.FORBIDDEN;

describe("delete paths: no silent no-ops (05-04)", () => {
  const admin = getAdminClient();
  let owner: SeededTenant;
  let doctor: SeededTenant;
  let receptionist: SeededTenant;
  let otherClinic: SeededTenant;
  let patientId: string;
  let visitId: string;
  let prescriptionId: string;
  let invoiceId: string;

  async function insertId(table: "prescription_items" | "consultation_diagnoses" | "invoice_items" | "follow_ups", row: Record<string, unknown>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin.from(table) as any).insert(row).select("id").single();
    if (error || !data) throw new Error(`seeding ${table} failed: ${error?.message}`);
    return data.id as string;
  }

  async function exists(table: "prescription_items" | "consultation_diagnoses" | "invoice_items" | "follow_ups", id: string) {
    const { data, error } = await admin.from(table).select("id").eq("id", id);
    if (error) throw new Error(error.message);
    return (data ?? []).length === 1;
  }

  async function auditCount(action: string, entityId: string) {
    const { count, error } = await admin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", owner.tenantId)
      .eq("action", action)
      .eq("entity_id", entityId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  const rxItem = () =>
    insertId("prescription_items", {
      tenant_id: owner.tenantId,
      prescription_id: prescriptionId,
      medicine_name: "Synthetic medicine",
      dosage: "1-0-1",
      duration: "5 days",
    });
  const diagnosis = () =>
    insertId("consultation_diagnoses", {
      tenant_id: owner.tenantId,
      visit_id: visitId,
      patient_id: patientId,
      diagnosis_name: "Synthetic diagnosis",
    });
  const invoiceItem = () =>
    insertId("invoice_items", {
      tenant_id: owner.tenantId,
      invoice_id: invoiceId,
      item_type: "consultation",
      description: "Synthetic consultation fee",
      quantity: 1,
      unit_price: 100,
      total_price: 100,
    });

  beforeAll(async () => {
    owner = await seedTenantWithOwner("Synthetic Delete Paths Clinic");
    doctor = await addMemberToTenant(owner.tenantId, "doctor");
    receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
    otherClinic = await seedTenantWithOwner("Synthetic Delete Paths Other Clinic");

    const { data: patient, error: pErr } = await admin
      .from("patients")
      .insert({ tenant_id: owner.tenantId, full_name: "Synthetic Delete Patient", phone: "+919000000301", created_by: owner.userId })
      .select("id")
      .single();
    if (pErr || !patient) throw new Error(`patient: ${pErr?.message}`);
    patientId = patient.id;

    const { data: visit, error: vErr } = await admin
      .from("visits")
      .insert({
        tenant_id: owner.tenantId,
        patient_id: patientId,
        doctor_id: doctor.userId,
        origin_type: "walk_in",
        status: "in_consultation",
        created_by: owner.userId,
      })
      .select("id")
      .single();
    if (vErr || !visit) throw new Error(`visit: ${vErr?.message}`);
    visitId = visit.id;

    const { data: rx, error: rxErr } = await admin
      .from("prescriptions")
      .insert({ tenant_id: owner.tenantId, visit_id: visitId, patient_id: patientId, doctor_id: doctor.userId })
      .select("id")
      .single();
    if (rxErr || !rx) throw new Error(`prescription: ${rxErr?.message}`);
    prescriptionId = rx.id;

    const { data: invoice, error: iErr } = await admin
      .from("invoices")
      .insert({ tenant_id: owner.tenantId, visit_id: visitId, patient_id: patientId, invoice_number: `DEL-${Date.now()}` })
      .select("id")
      .single();
    if (iErr || !invoice) throw new Error(`invoice: ${iErr?.message}`);
    invoiceId = invoice.id;
  });

  it("a doctor deletes a draft Rx item: the row is gone and one audit row records it (was: success, row kept)", async () => {
    const itemId = await rxItem();
    const res = await removePrescriptionItem(ctxFor(doctor), itemId);
    expect(res).toEqual({ success: true });
    expect(await exists("prescription_items", itemId)).toBe(false);
    expect(await auditCount("prescription.item_remove", prescriptionId)).toBe(1);
  });

  it("a doctor removes a diagnosis: the row is gone (was: success, row kept)", async () => {
    const diagnosisId = await diagnosis();
    const res = await removeConsultationDiagnosis(ctxFor(doctor), diagnosisId, visitId);
    expect(res).toEqual({ success: true });
    expect(await exists("consultation_diagnoses", diagnosisId)).toBe(false);
    expect(await auditCount("diagnosis.remove", diagnosisId)).toBe(1);
  });

  it("a receptionist deletes an invoice item: the row is gone and the totals follow (was: success, row kept)", async () => {
    const keep = await invoiceItem();
    const itemId = await invoiceItem();
    const res = await deleteInvoiceItem(ctxFor(receptionist), itemId);
    expect(res.success).toBe(true);
    expect(await exists("invoice_items", itemId)).toBe(false);
    expect(await exists("invoice_items", keep)).toBe(true);
    const { data: inv } = await admin.from("invoices").select("subtotal").eq("id", invoiceId).single();
    expect(Number(inv?.subtotal)).toBe(100);
    expect(await auditCount("invoice.item_remove", invoiceId)).toBe(1);
    await admin.from("invoice_items").delete().eq("id", keep);
  });

  it("a doctor's 'no follow-up' draft clears the visit's follow-up (was: success, follow-up kept)", async () => {
    const followUpId = await insertId("follow_ups", {
      tenant_id: owner.tenantId,
      patient_id: patientId,
      visit_id: visitId,
      doctor_id: doctor.userId,
      follow_up_date: "2030-01-01",
    });
    const res = await saveConsultationDraft(ctxFor(doctor), consultationDraftInput({ visit_id: visitId }));
    expect(res.success).toBe(true);
    expect(await exists("follow_ups", followUpId)).toBe(false);
  });

  it("a receptionist attempting an Rx item delete gets FORBIDDEN: row kept, no audit row", async () => {
    const itemId = await rxItem();
    const before = await auditCount("prescription.item_remove", prescriptionId);
    const res = await removePrescriptionItem(ctxFor(receptionist), itemId);
    expect(res).toEqual({ success: false, error: FORBIDDEN });
    expect(await exists("prescription_items", itemId)).toBe(true);
    expect(await auditCount("prescription.item_remove", prescriptionId)).toBe(before);
  });

  it("a doctor past the service guard but refused by RLS (invoice item, billing:collect) gets FORBIDDEN: row kept, no audit, totals untouched", async () => {
    const itemId = await invoiceItem();
    const { data: invBefore } = await admin.from("invoices").select("subtotal, updated_at").eq("id", invoiceId).single();
    const res = await deleteInvoiceItem(ctxFor(doctor), itemId);
    expect(res).toEqual({ success: false, error: FORBIDDEN });
    expect(await exists("invoice_items", itemId)).toBe(true);
    const { data: invAfter } = await admin.from("invoices").select("subtotal, updated_at").eq("id", invoiceId).single();
    expect(invAfter).toEqual(invBefore);
    const { count } = await admin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", owner.tenantId)
      .eq("action", "invoice.item_remove")
      .eq("actor_id", doctor.userId);
    expect(count).toBe(0);
    await admin.from("invoice_items").delete().eq("id", itemId);
  });

  describe("a session bound to another clinic than the service context (R-42 active tenant)", () => {
    let dualCtx: (actingIn: string | null) => Promise<ServiceContext>;

    beforeAll(async () => {
      const dual = await createDualMembershipUser(owner.tenantId, "doctor", otherClinic.tenantId, "receptionist");
      dualCtx = async (actingIn) => ({
        userId: dual.userId,
        tenantId: owner.tenantId,
        role: "doctor",
        actorType: "user",
        db: await signInActingIn(dual.userEmail, actingIn),
      });
    });

    it("acting in the same clinic, the dual member (doctor there) deletes an Rx item", async () => {
      const itemId = await rxItem();
      const res = await removePrescriptionItem(await dualCtx(owner.tenantId), itemId);
      expect(res).toEqual({ success: true });
      expect(await exists("prescription_items", itemId)).toBe(false);
    });

    it("acting in the other clinic, the Rx item and diagnosis deletes are refused, rows kept, no audit row", async () => {
      const itemId = await rxItem();
      const diagnosisId = await diagnosis();
      const rxAudits = await auditCount("prescription.item_remove", prescriptionId);
      const ctx = await dualCtx(otherClinic.tenantId);

      // Since 05-02b the SELECT policies are bound to the active clinic too, so the rows are not even visible from the
      // other clinic: the services refuse at their first read (before 05-02b: visible, then the DELETE filtered → FORBIDDEN).
      expect(await removePrescriptionItem(ctx, itemId)).toEqual({ success: false, error: "Prescription item not found." });
      expect((await removeConsultationDiagnosis(ctx, diagnosisId, visitId)).success).toBe(false);

      expect(await exists("prescription_items", itemId)).toBe(true);
      expect(await exists("consultation_diagnoses", diagnosisId)).toBe(true);
      expect(await auditCount("prescription.item_remove", prescriptionId)).toBe(rxAudits);
      expect(await auditCount("diagnosis.remove", diagnosisId)).toBe(0);
    });
  });
});
