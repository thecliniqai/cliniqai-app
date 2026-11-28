/**
 * V2-10 10-02 (D-10, D-11; migration 000141): Sign & Bill reads its context when it opens and sends the visit version with the sign-off.
 *   - the service read: the clinic's fee in integer paise (₹650 → 65000), null when the clinic set none (never ₹500), the accepted methods in order, the
 *     visit's row_version and status as the table holds them, the live invoice with its paid total; another doctor's visit and another clinic's visit
 *     are NOT_FOUND (the database's NULL), a nurse is FORBIDDEN before any call;
 *   - the sign-off with the version from the context signs and bills ₹650; with a version the visit moved past it is CONFLICT / ROW_CHANGED with the fixed
 *     text, and nothing is signed or billed (no invoice, the visit unchanged);
 *   - no default fee: a sign-off without `consultation_fee` is VALIDATION_FAILED (the old schema defaulted to ₹500);
 *   - the server action requires the version (`@ts-expect-error` below; `npm run typecheck` is the check).
 * Rows are seeded and read with the service-role client; every call runs as the member's own client. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { completeAndBillConsultation, getSignAndBillContext } from "@/features/billing/service";
import * as billingActions from "@/features/billing/actions";
import { ROW_CHANGED_MESSAGE } from "@/lib/errors/row-changed";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import { seedClinicalVisit } from "../helpers/clinical-commands";
import { invoicesOfVisit } from "../helpers/billing-commands";

let clinic: SeededTenant;
let other: SeededTenant;
let doctor: SeededTenant;
let doctorTwo: SeededTenant;
let nurse: SeededTenant;

async function setFees(tenantId: string, consultation: number | null, followup: number | null, methods?: string[]) {
  const { error } = await getAdminClient()
    .from("tenants")
    .update({ default_consultation_fee: consultation, default_followup_fee: followup, ...(methods ? { accepted_payment_methods: methods } : {}) })
    .eq("id", tenantId);
  if (error) throw new Error(error.message);
}
async function visitOf(visitId: string) {
  const { data, error } = await getAdminClient().from("visits").select("row_version, status, signed_at").eq("id", visitId).single();
  if (error) throw new Error(error.message);
  return data;
}

beforeAll(async () => {
  clinic = await seedTenantWithOwner("CI SignBillContext Clinic");
  other = await seedTenantWithOwner("CI SignBillContext Other Clinic");
  doctor = await addMemberToTenant(clinic.tenantId, "doctor");
  doctorTwo = await addMemberToTenant(clinic.tenantId, "doctor");
  nurse = await addMemberToTenant(clinic.tenantId, "nurse");
  await setFees(clinic.tenantId, 650, 300, ["upi", "cash"]);
  await setFees(other.tenantId, null, null);
});

describe("getSignAndBillContext (service)", () => {
  it("answers the clinic's fees in paise, the methods in order and the visit's version and status", async () => {
    const v = await seedClinicalVisit(clinic, { doctorId: doctor.userId, diagnosis: true });
    const res = await getSignAndBillContext(ctxFor(doctor), v.visitId);
    const row = await visitOf(v.visitId);
    expect(res).toEqual({
      ok: true,
      value: {
        fee: { consultation: 65_000, followup: 30_000 },
        methods: ["cash", "upi"],
        visit: { id: v.visitId, rowVersion: row.row_version, status: "waiting" },
        invoice: null,
      },
    });
  });

  it("a clinic that set no fee answers null (the field starts empty, never ₹500)", async () => {
    const v = await seedClinicalVisit(other, { diagnosis: true });
    const res = await getSignAndBillContext(ctxFor(other), v.visitId);
    expect(res.ok && res.value.fee).toEqual({ consultation: null, followup: null });
  });

  it("answers the live invoice with its paid total when the desk billed first", async () => {
    const v = await seedClinicalVisit(clinic, { doctorId: doctor.userId, diagnosis: true });
    const admin = getAdminClient();
    const { data: inv, error } = await admin
      .from("invoices")
      .insert({ tenant_id: clinic.tenantId, visit_id: v.visitId, patient_id: v.patientId, invoice_number: `INV-CTX-${randomUUID().slice(0, 8)}`, subtotal: 650, total_amount: 650, status: "issued" })
      .select("id, row_version")
      .single();
    if (error) throw new Error(error.message);
    const { error: payErr } = await admin.from("payments").insert({ tenant_id: clinic.tenantId, invoice_id: inv.id, amount: 250.5, payment_method: "cash", recorded_by: clinic.userId });
    if (payErr) throw new Error(payErr.message);
    const res = await getSignAndBillContext(ctxFor(clinic), v.visitId);
    expect(res.ok && res.value.invoice).toEqual({ id: inv.id, rowVersion: inv.row_version, totalPaise: 65_000, paidPaise: 25_050 });
  });

  it("another doctor's visit and another clinic's visit are NOT_FOUND; a nurse is FORBIDDEN", async () => {
    const v = await seedClinicalVisit(clinic, { doctorId: doctor.userId, diagnosis: true });
    const foreign = await seedClinicalVisit(other, { diagnosis: true });
    expect(await getSignAndBillContext(ctxFor(doctorTwo), v.visitId)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await getSignAndBillContext(ctxFor(clinic), foreign.visitId)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await getSignAndBillContext(ctxFor(nurse), v.visitId)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await getSignAndBillContext(ctxFor(doctor), "not-a-uuid")).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
  });
});

describe("the sign-off with the version from the context", () => {
  const input = (v: { visitId: string; patientId: string }, expected: number, over: Record<string, unknown> = {}) => ({
    visit_id: v.visitId,
    patient_id: v.patientId,
    consultation_fee: 650,
    additional_items: [] as never[],
    discount: 0,
    payment_collected: false,
    payment_method: "cash" as const,
    client_request_id: randomUUID(),
    expected_version: expected,
    ...over,
  });

  it("signs and bills the clinic's fee when the visit has not moved", async () => {
    const v = await seedClinicalVisit(clinic, { doctorId: doctor.userId, diagnosis: true });
    const ctx = await getSignAndBillContext(ctxFor(doctor), v.visitId);
    if (!ctx.ok) throw new Error("context");
    const res = await completeAndBillConsultation(ctxFor(doctor), input(v, ctx.value.visit.rowVersion, { consultation_fee: ctx.value.fee.consultation! / 100 }));
    expect(res).toMatchObject({ success: true, paymentRecorded: false });
    expect((await invoicesOfVisit(v.visitId)).map((i) => [Number(i.total_amount), i.status])).toEqual([[650, "issued"]]);
    expect((await visitOf(v.visitId)).status).toBe("completed");
  });

  it("a visit that moved after the context was read is refused with ROW_CHANGED: nothing signed, no invoice", async () => {
    const v = await seedClinicalVisit(clinic, { doctorId: doctor.userId, diagnosis: true });
    const ctx = await getSignAndBillContext(ctxFor(doctor), v.visitId);
    if (!ctx.ok) throw new Error("context");
    // The desk moves the visit on another device (a listed column of the version).
    const { error } = await getAdminClient().from("visits").update({ estimated_duration_minutes: 35 }).eq("id", v.visitId);
    if (error) throw new Error(error.message);
    const before = await visitOf(v.visitId);
    const res = await completeAndBillConsultation(ctxFor(doctor), input(v, ctx.value.visit.rowVersion));
    expect(res).toEqual({ success: false, error: ROW_CHANGED_MESSAGE, code: "CONFLICT", reason: "ROW_CHANGED" });
    expect(await visitOf(v.visitId)).toEqual(before);
    expect(before.signed_at).toBeNull();
    expect(await invoicesOfVisit(v.visitId)).toEqual([]);
    // The re-read answers the new version, and the sign-off with it succeeds.
    const again = await getSignAndBillContext(ctxFor(doctor), v.visitId);
    if (!again.ok) throw new Error("context");
    expect(again.value.visit.rowVersion).toBe(before.row_version);
    expect(await completeAndBillConsultation(ctxFor(doctor), input(v, again.value.visit.rowVersion))).toMatchObject({ success: true });
  });

  it("has no default fee: a sign-off without consultation_fee is VALIDATION_FAILED and writes nothing", async () => {
    const v = await seedClinicalVisit(clinic, { doctorId: doctor.userId, diagnosis: true });
    const req = input(v, (await visitOf(v.visitId)).row_version) as Record<string, unknown>;
    delete req.consultation_fee;
    const res = await completeAndBillConsultation(ctxFor(doctor), req as never);
    expect(res).toMatchObject({ success: false, code: "VALIDATION_FAILED", error: "Enter the consultation fee." });
    expect(await invoicesOfVisit(v.visitId)).toEqual([]);
  });

  it("the server action requires the version (never executed here: `npm run typecheck` is the check)", () => {
    const never = (): void => {
      // @ts-expect-error `expected_version` is required in what the Sign & Bill screen sends
      void billingActions.completeAndBillConsultation({ visit_id: "v", patient_id: "p", consultation_fee: 650, additional_items: [], discount: 0, payment_collected: false, payment_method: "cash", client_request_id: "r" });
    };
    expect(typeof never).toBe("function");
  });
});
