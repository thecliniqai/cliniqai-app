/**
 * V2-05 05-11b, M-INVOICE billing part (05a review IND M2, RLS L-1, IND Info 3; migration 000072), through the same
 * paths an attacker and the app use: the user's own supabase-js client (PostgREST with the user's JWT) and the real
 * billing services with that client (`ctxFor`).
 *
 * Before 000072 the doctor of a visit could PATCH its invoice to `paid` (or zero its total) through the Data API with no
 * payment, audit or outbox row, and a collector could POST a payment row directly, bypassing record_payment. Now no
 * member updates invoices or inserts payments; the services' charge edits still move the totals and the status
 * (computed in the database), and paying still works through record_payment. 05-11d (N-3, migration 000075): line
 * totals are computed, a paid invoice's items are locked, and a bill with payments is never lowered to the amount
 * collected, so only record_payment settles an invoice. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addInvoiceItem,
  deleteInvoiceItem,
  INVOICE_BELOW_COLLECTED_MESSAGE,
  INVOICE_LOCKED_MESSAGE,
  recordPayment,
} from "@/features/billing/service";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { insertReturningId, type TestDb } from "../helpers/db";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

let admin: TestDb;
let owner: SeededTenant;
let doctor: SeededTenant;
let receptionist: SeededTenant;

async function seedBilledVisit(total: number): Promise<{ invoiceId: string; itemId: string }> {
  const patientId = await insertReturningId(admin, "patients", {
    tenant_id: owner.tenantId,
    full_name: "Synthetic Totals Patient",
    phone: "+919000000831",
    created_by: owner.userId,
  });
  const visitId = await insertReturningId(admin, "visits", {
    tenant_id: owner.tenantId,
    patient_id: patientId,
    doctor_id: doctor.userId,
    origin_type: "walk_in",
    created_by: owner.userId,
  });
  const invoiceId = await insertReturningId(admin, "invoices", {
    tenant_id: owner.tenantId,
    visit_id: visitId,
    patient_id: patientId,
    invoice_number: `TOT-${randomUUID()}`,
    status: "issued",
  });
  const itemId = await insertReturningId(admin, "invoice_items", {
    tenant_id: owner.tenantId,
    invoice_id: invoiceId,
    item_type: "consultation",
    description: "Synthetic consultation fee",
    unit_price: total,
    quantity: 1,
    total_price: total,
  });
  return { invoiceId, itemId };
}

async function invoiceState(invoiceId: string): Promise<string> {
  const { data, error } = await admin.from("invoices").select("subtotal, total_amount, status").eq("id", invoiceId).single();
  if (error || !data) throw new Error(`invoice read: ${error?.message}`);
  return `${Number(data.subtotal)}/${Number(data.total_amount)}/${data.status}`;
}

async function paymentCount(invoiceId: string): Promise<number> {
  const { count, error } = await admin
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", invoiceId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

beforeAll(async () => {
  admin = getAdminClient();
  owner = await seedTenantWithOwner("Synthetic Invoice Totals Clinic");
  doctor = await addMemberToTenant(owner.tenantId, "doctor");
  receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
});

describe("M-INVOICE: invoices and payments are not writable through the Data API", () => {
  it("the visit's doctor cannot mark its invoice paid or zero it (the reviewer's PATCH)", async () => {
    const { invoiceId } = await seedBilledVisit(500);
    const { data, error } = await doctor.client
      .from("invoices")
      .update({ status: "paid", total_amount: 0 })
      .eq("id", invoiceId)
      .select("id");
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect(await invoiceState(invoiceId)).toBe("500/500/issued");
  });

  it("a collector cannot change an invoice directly either", async () => {
    const { invoiceId } = await seedBilledVisit(500);
    const { error } = await receptionist.client.from("invoices").update({ discount: 500 }).eq("id", invoiceId);
    expect(error?.code).toBe("42501");
    expect(await invoiceState(invoiceId)).toBe("500/500/issued");
  });

  it("a collector cannot insert a payment row directly (record_payment only)", async () => {
    const { invoiceId } = await seedBilledVisit(500);
    const { error } = await receptionist.client.from("payments").insert({
      tenant_id: owner.tenantId,
      invoice_id: invoiceId,
      amount: 500,
      payment_method: "cash",
    });
    expect(error?.code).toBe("42501");
    expect(await paymentCount(invoiceId)).toBe(0);
    expect(await invoiceState(invoiceId)).toBe("500/500/issued");
  });

  it("an invoice cannot be created already paid (Sign & Bill INSERT)", async () => {
    const patientId = await insertReturningId(admin, "patients", {
      tenant_id: owner.tenantId,
      full_name: "Synthetic Totals Patient",
      phone: "+919000000832",
      created_by: owner.userId,
    });
    const visitId = await insertReturningId(admin, "visits", {
      tenant_id: owner.tenantId,
      patient_id: patientId,
      doctor_id: doctor.userId,
      origin_type: "walk_in",
      created_by: owner.userId,
    });
    const { error } = await doctor.client.from("invoices").insert({
      tenant_id: owner.tenantId,
      visit_id: visitId,
      patient_id: patientId,
      invoice_number: `TOT-${randomUUID()}`,
      subtotal: 500,
      total_amount: 0,
      status: "paid",
    });
    expect(error).toMatchObject({ code: "42501", message: "INVOICE_STATUS_RPC_ONLY" });
  });
});

describe("N-3 (05-11d): a doctor cannot settle or zero an invoice through its items (PostgREST, the re-verifier's probes)", () => {
  it("MI5: after a part payment, the doctor's item edit down to the amount collected is refused; the invoice is not paid", async () => {
    const { invoiceId, itemId } = await seedBilledVisit(500);
    expect(
      await recordPayment(ctxFor(receptionist), { invoice_id: invoiceId, amount: 100, payment_method: "cash" })
    ).toMatchObject({ success: true, status: "issued" });
    const { data, error } = await doctor.client
      .from("invoice_items")
      .update({ unit_price: 100, total_price: 100 })
      .eq("id", itemId)
      .select("id");
    expect(data).toBeNull();
    expect(error).toMatchObject({ code: "42501", message: "INVOICE_BELOW_COLLECTED" });
    expect(await invoiceState(invoiceId)).toBe("500/500/issued");
  });

  it("MI6/MI7: a negative charge is refused and a typed line total is replaced by price x quantity", async () => {
    const { invoiceId } = await seedBilledVisit(500);
    const negative = await doctor.client.from("invoice_items").insert({
      tenant_id: owner.tenantId,
      invoice_id: invoiceId,
      item_type: "other",
      description: "Synthetic credit",
      unit_price: -500,
      quantity: 1,
      total_price: -500,
    });
    expect(negative.error?.code).toBe("23514");
    const typed = await doctor.client
      .from("invoice_items")
      .insert({
        tenant_id: owner.tenantId,
        invoice_id: invoiceId,
        item_type: "procedure",
        description: "Synthetic procedure",
        unit_price: 500,
        quantity: 1,
        total_price: 1,
      })
      .select("total_price")
      .single();
    expect(typed.error).toBeNull();
    expect(Number(typed.data?.total_price)).toBe(500);
    expect(await invoiceState(invoiceId)).toBe("1000/1000/issued");
  });
});

describe("M-INVOICE: the app's billing paths still work", () => {
  it("adding and removing charges moves the totals and the paid/issued status; paying goes through record_payment", async () => {
    const { invoiceId } = await seedBilledVisit(500);
    const ctx = ctxFor(receptionist);

    const added = await addInvoiceItem(ctx, {
      invoice_id: invoiceId,
      item_type: "procedure",
      description: "Synthetic dressing",
      unit_price: 150,
      quantity: 2,
    });
    expect(added.success).toBe(true);
    expect(await invoiceState(invoiceId)).toBe("800/800/issued");

    const paid = await recordPayment(ctx, { invoice_id: invoiceId, amount: 800, payment_method: "upi" });
    expect(paid).toMatchObject({ success: true, status: "paid", totalPaid: 800, balanceDue: 0 });
    expect(await invoiceState(invoiceId)).toBe("800/800/paid");

    // 05-11d (N-3): a paid invoice's charges are locked (no adjustment or refund path before V2-10). Before, a later
    // charge reopened the balance and removing it "settled" the invoice again without a payment.
    const extra = await addInvoiceItem(ctx, {
      invoice_id: invoiceId,
      item_type: "other",
      description: "Synthetic extra",
      unit_price: 100,
      quantity: 1,
    });
    expect(extra).toEqual({ success: false, error: INVOICE_LOCKED_MESSAGE });
    expect(await invoiceState(invoiceId)).toBe("800/800/paid");
    expect(await paymentCount(invoiceId)).toBe(1);
  });

  it("checkout with an advance: a charge added after a part payment, a removal that leaves a balance, then the rest is collected (05-11d)", async () => {
    const { invoiceId, itemId } = await seedBilledVisit(500);
    const ctx = ctxFor(receptionist);

    const advance = await recordPayment(ctx, { invoice_id: invoiceId, amount: 200, payment_method: "cash" });
    expect(advance).toMatchObject({ success: true, status: "issued", totalPaid: 200, balanceDue: 300 });

    const dressing = await addInvoiceItem(ctx, {
      invoice_id: invoiceId,
      item_type: "procedure",
      description: "Synthetic dressing",
      unit_price: 150,
      quantity: 1,
    });
    expect(dressing.success).toBe(true);
    expect(await invoiceState(invoiceId)).toBe("650/650/issued");

    // Removing the consultation fee would bring the bill (150) below the ₹200 already collected: refused.
    expect(await deleteInvoiceItem(ctx, itemId)).toEqual({ success: false, error: INVOICE_BELOW_COLLECTED_MESSAGE });
    expect(await invoiceState(invoiceId)).toBe("650/650/issued");

    // Removing the dressing leaves ₹300 due: allowed.
    expect(await deleteInvoiceItem(ctx, dressing.item!.id)).toEqual({ success: true });
    expect(await invoiceState(invoiceId)).toBe("500/500/issued");

    const rest = await recordPayment(ctx, { invoice_id: invoiceId, amount: 300, payment_method: "upi" });
    expect(rest).toMatchObject({ success: true, status: "paid", totalPaid: 500, balanceDue: 0 });
    expect(await invoiceState(invoiceId)).toBe("500/500/paid");
  });

  it("a doctor's recordPayment is still refused (billing:collect), and nothing is written", async () => {
    const { invoiceId } = await seedBilledVisit(300);
    const res = await recordPayment(ctxFor(doctor), { invoice_id: invoiceId, amount: 300, payment_method: "cash" });
    expect(res.success).toBe(false);
    expect(await paymentCount(invoiceId)).toBe(0);
    expect(await invoiceState(invoiceId)).toBe("300/300/issued");
  });
});
