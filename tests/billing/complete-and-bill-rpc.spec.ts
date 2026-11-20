/**
 * V2-07 07-03 (R-1, R-2, R-3, R-7): `public.complete_and_bill`, Sign & Bill as one atomic command.
 *
 * The sign-off (visit signed, prescriptions sealed, `visit.complete_and_sign` audit, `visit.completed` /
 * `prescription.issued` outbox), the visit's invoice (`invoice.create` audit) and the payment (`invoice.payment_recorded`
 * audit, `payment.recorded` outbox) commit together or not at all; a visit this user already signed that has no invoice
 * resumes at billing. SECURITY DEFINER; consultations:edit, plus billing:collect when a payment is given. Called through
 * the caller's own client; rows are seeded and read with the service-role client. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import {
  BILLING_COLLECT_FORBIDDEN_MESSAGE,
  COMPLETE_AND_BILL_MESSAGES,
  SIGN_AND_BILL_ALREADY_DONE_MESSAGE,
  completeAndBillConsultation,
} from "@/features/billing/service";
import { addMemberToTenant, createDualMembershipUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import type { TestDb } from "../helpers/db";
import { ctxFor } from "../helpers/context";
import { signInActingIn } from "../helpers/active-tenant";
import { leftoverFaults, withFault } from "../helpers/fault";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { createBarrier, gateClient } from "../helpers/write-barrier";
import {
  ITEMS_700,
  auditRows,
  callCreateInvoice,
  commandResultRows,
  createInvoiceArgs,
  invoicesOfVisit,
  itemsOfInvoice,
  outboxOfPayment,
  paymentsOfInvoice,
  subscribePaymentEvents,
  expectDataOnlyStoredResult,
} from "../helpers/billing-commands";
import {
  callSign,
  deactivateSubscription,
  outboxRows,
  prescriptionsOfVisit,
  seedClinicalVisit,
  signArgs,
  subscribeSignEvents,
  visitRow,
} from "../helpers/clinical-commands";
import { callCompleteAndBill, completeAndBillArgs, messagesOfVisit } from "../helpers/front-desk-commands";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];

let tenantA: SeededTenant;
let tenantB: SeededTenant;
let tenantFault: SeededTenant;
const members = {} as Record<UserRole, SeededTenant>;
const subscriptions: string[] = [];

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI SignBill Clinic A");
  tenantB = await seedTenantWithOwner("CI SignBill Clinic B");
  tenantFault = await seedTenantWithOwner("CI SignBill Fault Clinic");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
  for (const t of [tenantA, tenantFault]) {
    subscriptions.push(await subscribeSignEvents(t), await subscribePaymentEvents(t));
  }
});

afterAll(async () => {
  for (const id of subscriptions) await deactivateSubscription(id);
  expect(leftoverFaults()).toBe(0);
});

/** Everything the command writes for one visit, to compare before and after. */
async function writes(t: SeededTenant, visitId: string, rxIds: string[]) {
  const invoices = await invoicesOfVisit(visitId);
  const payments = (await Promise.all(invoices.map((i) => paymentsOfInvoice(i.id)))).flat();
  return {
    signAudit: (await auditRows(t.tenantId, "visit.complete_and_sign", visitId)).length,
    invoices: invoices.length,
    payments: payments.length,
    completed: (await outboxRows(t.tenantId, "visit.completed", visitId)).length,
    issued: (await Promise.all(rxIds.map((id) => outboxRows(t.tenantId, "prescription.issued", id)))).flat().length,
    paymentOutbox: (await Promise.all(payments.map((p) => outboxOfPayment(p.id)))).flat().length,
  };
}

const NOTHING = { signAudit: 0, invoices: 0, payments: 0, completed: 0, issued: 0, paymentOutbox: 0 };

describe("complete_and_bill: catalog", () => {
  it("is DEFINER with the pinned settings, EXECUTE for authenticated only, and a required p_client_request_id", () => {
    expectCommandCatalog({ signature: "public.complete_and_bill(uuid, uuid, jsonb, numeric, numeric, jsonb, uuid)", definer: true });
  });
});

describe("complete_and_bill: one transaction", () => {
  it("sign, invoice and payment commit together: signature, sealed prescription, invoice, items, payment, audit and outbox rows", async () => {
    const v = await seedClinicalVisit(tenantA, { diagnosis: true });
    const args = completeAndBillArgs(tenantA, v.visitId, { p_payment: { method: "upi", reference: "UTR-1" } });
    const { data, error } = await callCompleteAndBill(tenantA.client, args);
    expect(error).toBeNull();
    const result = data as { invoice_id: string; invoice_number: string; payment_id: string };
    expect(data).toMatchObject({
      visit_id: v.visitId,
      sealed_prescriptions: 1,
      resumed: false,
      total_amount: 650,
      already_billed: false,
      payment_recorded: true,
      invoice_status: "paid",
      paid_total: 650,
      replayed: false,
    });

    expect(await visitRow(v.visitId)).toMatchObject({ status: "completed", signed_by: tenantA.userId });
    expect((await prescriptionsOfVisit(v.visitId))[0].signed_at).not.toBeNull();

    const [invoice] = await invoicesOfVisit(v.visitId);
    expect(invoice).toMatchObject({ id: result.invoice_id, invoice_number: result.invoice_number, status: "paid", total_amount: 650, subtotal: 700, discount: 50 });
    expect(invoice.location_id).toBeTruthy();
    expect(await itemsOfInvoice(invoice.id)).toHaveLength(2);
    const [payment] = await paymentsOfInvoice(invoice.id);
    expect(payment).toMatchObject({ id: result.payment_id, amount: 650, payment_method: "upi", recorded_by: tenantA.userId, command_id: args.p_client_request_id });

    expect(await auditRows(tenantA.tenantId, "visit.complete_and_sign", v.visitId)).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "invoice.create", invoice.id)).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "invoice.payment_recorded", payment.id)).toHaveLength(1);
    expect(await outboxRows(tenantA.tenantId, "visit.completed", v.visitId)).toHaveLength(1);
    expect(await outboxRows(tenantA.tenantId, "prescription.issued", v.prescriptionIds[0])).toHaveLength(1);
    expect(await outboxOfPayment(payment.id)).toHaveLength(1);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual(["public.complete_and_bill|true"]);
    // F-5 (07-04a): the stored result holds ids, numbers, amounts, statuses and flags only, no free text.
    expectDataOnlyStoredResult(tenantA.tenantId, args.p_client_request_id);
  });

  it("without a payment: the invoice stays issued and nothing is paid", async () => {
    const v = await seedClinicalVisit(tenantA);
    const { data, error } = await callCompleteAndBill(tenantA.client, completeAndBillArgs(tenantA, v.visitId, { p_payment: null as never }));
    expect(error).toBeNull();
    expect(data).toMatchObject({ payment_recorded: false, invoice_status: "issued", paid_total: 0, total_amount: 650 });
    expect(await writes(tenantA, v.visitId, v.prescriptionIds)).toMatchObject({ signAudit: 1, invoices: 1, payments: 0, paymentOutbox: 0 });
  });

  it("a part payment leaves the invoice issued with the paid total", async () => {
    const v = await seedClinicalVisit(tenantA);
    const { data, error } = await callCompleteAndBill(tenantA.client, completeAndBillArgs(tenantA, v.visitId, { p_payment: { method: "card", amount: 200 } }));
    expect(error).toBeNull();
    expect(data).toMatchObject({ payment_recorded: true, invoice_status: "issued", paid_total: 200 });
  });

  it("a fully discounted bill (total 0) is signed and invoiced without a payment", async () => {
    const v = await seedClinicalVisit(tenantA);
    const { data, error } = await callCompleteAndBill(
      tenantA.client,
      completeAndBillArgs(tenantA, v.visitId, { p_discount: 700 })
    );
    expect(error).toBeNull();
    expect(data).toMatchObject({ total_amount: 0, payment_recorded: false });
    expect((await visitRow(v.visitId)).status).toBe("completed");
  });

  it.each([
    ["the payment insert", "payments", "reference_number"],
    ["the invoice items insert", "invoice_items", "description"],
  ])("rollback: a fault on %s leaves the visit unsigned and no invoice, payment, audit row, outbox row or claim", async (_name, table, column) => {
    const marker = `CI-FAULT-${randomUUID().slice(0, 8)}`;
    const v = await seedClinicalVisit(tenantFault, { diagnosis: true });
    const args = completeAndBillArgs(tenantFault, v.visitId, {
      p_items: [{ item_type: "consultation", description: column === "description" ? marker : "OPD Consultation Fee", unit_price: 700, quantity: 1 }],
      p_payment: { method: "cash", reference: marker },
    });

    await withFault({ table: `public.${table}`, column, marker }, async () => {
      const { data, error } = await callCompleteAndBill(tenantFault.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");

      // Through the service: a real failure with a fixed message, never a success with paymentRecorded: false.
      const viaService = await completeAndBillConsultation(ctxFor(tenantFault), {
        visit_id: v.visitId,
        patient_id: v.patientId,
        consultation_fee: 700,
        additional_items:
          column === "description" ? [{ item_type: "other" as const, description: marker, unit_price: 10, quantity: 1 }] : [],
        discount: 0,
        payment_collected: true,
        payment_method: "cash",
        reference_number: marker,
        client_request_id: randomUUID(),
      });
      expect(viaService).toMatchObject({ success: false, code: "INTERNAL", error: COMPLETE_AND_BILL_MESSAGES.INTERNAL });
      expect(JSON.stringify(viaService)).not.toContain("SPIKE_FAULT");
    });

    expect(await visitRow(v.visitId)).toMatchObject({ status: "waiting", signed_at: null, signed_by: null });
    expect((await prescriptionsOfVisit(v.visitId))[0].signed_at).toBeNull();
    expect(await writes(tenantFault, v.visitId, v.prescriptionIds)).toEqual(NOTHING);
    expect(commandResultRows(tenantFault.tenantId, args.p_client_request_id)).toEqual([]);
  });

  it("rollback: an overpayment fails the whole command, the visit stays unsigned and the same id then succeeds with a valid amount", async () => {
    const v = await seedClinicalVisit(tenantA);
    const args = completeAndBillArgs(tenantA, v.visitId, { p_payment: { method: "cash", amount: 651 } });
    const res = await callCompleteAndBill(tenantA.client, args);
    expect(res.error).toMatchObject({ code: "P0001", message: "OVERPAYMENT" });
    expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "OVERPAYMENT" });
    expect(await visitRow(v.visitId)).toMatchObject({ status: "waiting", signed_at: null });
    expect(await writes(tenantA, v.visitId, v.prescriptionIds)).toEqual(NOTHING);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);

    const fixed = await callCompleteAndBill(tenantA.client, { ...args, p_payment: { method: "cash", amount: 650 } });
    expect(fixed.error).toBeNull();
    expect((await visitRow(v.visitId)).status).toBe("completed");
  });

  it("a visit without a diagnosis or note is SIGN_CONTENT_REQUIRED and nothing is invoiced", async () => {
    const v = await seedClinicalVisit(tenantA, { notes: null });
    const res = await callCompleteAndBill(tenantA.client, completeAndBillArgs(tenantA, v.visitId));
    expect(res.error).toMatchObject({ code: "P0001", message: "SIGN_CONTENT_REQUIRED" });
    expect(await writes(tenantA, v.visitId, v.prescriptionIds)).toEqual(NOTHING);
  });
});

describe("complete_and_bill: resume and existing invoices", () => {
  it("a visit this user signed that has no invoice resumes at billing: not re-signed, no second sign audit or outbox row", async () => {
    const v = await seedClinicalVisit(tenantA);
    expect((await callSign(tenantA.client, signArgs(tenantA, v.visitId))).error).toBeNull();
    const signed = await visitRow(v.visitId);
    const before = await writes(tenantA, v.visitId, v.prescriptionIds);

    const { data, error } = await callCompleteAndBill(tenantA.client, completeAndBillArgs(tenantA, v.visitId));
    expect(error).toBeNull();
    expect(data).toMatchObject({ resumed: true, sealed_prescriptions: 0, payment_recorded: true, invoice_status: "paid" });
    expect((await visitRow(v.visitId)).signed_at).toBe(signed.signed_at);
    expect(await writes(tenantA, v.visitId, v.prescriptionIds)).toEqual({ ...before, invoices: 1, payments: 1, paymentOutbox: 1 });

    // Now it is signed and billed: a further Sign & Bill is refused and pays nothing.
    const again = await callCompleteAndBill(tenantA.client, completeAndBillArgs(tenantA, v.visitId));
    expect(again.error).toMatchObject({ code: "P0001", message: "ALREADY_BILLED" });
    expect(mapDbError(again.error)).toMatchObject({ code: "CONFLICT", reason: "ALREADY_BILLED" });
    expect((await writes(tenantA, v.visitId, v.prescriptionIds)).payments).toBe(1);
  });

  it("a visit signed by someone else is ALREADY_SIGNED and is not billed through this flow", async () => {
    const v = await seedClinicalVisit(tenantA, { doctorId: members.doctor.userId });
    expect((await callSign(members.doctor.client, signArgs(tenantA, v.visitId))).error).toBeNull();
    const res = await callCompleteAndBill(tenantA.client, completeAndBillArgs(tenantA, v.visitId));
    expect(res.error).toMatchObject({ code: "P0001", message: "ALREADY_SIGNED" });
    expect(mapDbError(res.error).code).toBe("CONFLICT");
    expect((await writes(tenantA, v.visitId, v.prescriptionIds)).invoices).toBe(0);
  });

  it("an invoice made at the desk before the sign-off: the visit is signed, that invoice is returned, nothing is paid", async () => {
    const v = await seedClinicalVisit(tenantA);
    const desk = await callCreateInvoice(tenantA.client, createInvoiceArgs(tenantA, v.visitId, { p_items: ITEMS_700, p_discount: 0 }));
    expect(desk.error).toBeNull();
    const deskInvoice = desk.data as { invoice_id: string; invoice_number: string };

    const { data, error } = await callCompleteAndBill(tenantA.client, completeAndBillArgs(tenantA, v.visitId));
    expect(error).toBeNull();
    expect(data).toMatchObject({
      already_billed: true,
      payment_recorded: false,
      invoice_id: deskInvoice.invoice_id,
      invoice_number: deskInvoice.invoice_number,
      invoice_status: "issued",
    });
    expect((await visitRow(v.visitId)).status).toBe("completed");
    expect(await writes(tenantA, v.visitId, v.prescriptionIds)).toMatchObject({ invoices: 1, payments: 0, signAudit: 1 });
  });

  it("a voided (cancelled) invoice is re-billed on resume", async () => {
    const v = await seedClinicalVisit(tenantA);
    expect((await callCompleteAndBill(tenantA.client, completeAndBillArgs(tenantA, v.visitId, { p_payment: null as never }))).error).toBeNull();
    const [first] = await invoicesOfVisit(v.visitId);
    await getAdminClient().from("invoices").update({ status: "cancelled" }).eq("id", first.id);

    const again = await callCompleteAndBill(tenantA.client, completeAndBillArgs(tenantA, v.visitId));
    expect(again.error).toBeNull();
    expect(again.data).toMatchObject({ resumed: true, already_billed: false, payment_recorded: true });
    expect(await invoicesOfVisit(v.visitId)).toHaveLength(2);
  });
});

describe("complete_and_bill: idempotency and races", () => {
  it("the same id twice: one signature, one invoice, one payment, the first result with replayed: true", async () => {
    const v = await seedClinicalVisit(tenantA);
    const args = completeAndBillArgs(tenantA, v.visitId);
    const first = await callCompleteAndBill(tenantA.client, args);
    const second = await callCompleteAndBill(tenantA.client, args);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ...(first.data as object), replayed: true });
    expect(await writes(tenantA, v.visitId, v.prescriptionIds)).toEqual({ signAudit: 1, invoices: 1, payments: 1, completed: 1, issued: 1, paymentOutbox: 1 });
  });

  it("the same id for another bill or payment is IDEMPOTENCY_MISMATCH and writes nothing more", async () => {
    const v = await seedClinicalVisit(tenantA);
    const args = completeAndBillArgs(tenantA, v.visitId);
    expect((await callCompleteAndBill(tenantA.client, args)).error).toBeNull();
    // Every input is part of the request hash (T-1, G-7): bill, discount, tax, method, reference, amount and whether to collect.
    for (const over of [
      { p_discount: 0 },
      { p_tax: 5 },
      { p_items: [{ item_type: "consultation", description: "Another fee", unit_price: 700, quantity: 1 }] as never },
      { p_payment: { method: "card" } },
      { p_payment: { method: "cash", reference: "UTR-9" } },
      { p_payment: { method: "cash", amount: 10 } },
      { p_payment: null as never },
    ]) {
      const res = await callCompleteAndBill(tenantA.client, { ...args, ...over });
      expect(mapDbError(res.error), JSON.stringify(over)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    }
    expect((await writes(tenantA, v.visitId, v.prescriptionIds)).payments).toBe(1);
  });

  it("two concurrent Sign & Bills of one visit (different ids): one wins; the other is ALREADY_BILLED; one signature, invoice and payment", async () => {
    const v = await seedClinicalVisit(tenantA);
    const barrier = createBarrier(2);
    const results = await Promise.all(
      [tenantA, tenantA].map((t) =>
        callCompleteAndBill(gateClient(t.client, { rpc: { complete_and_bill: barrier } }), completeAndBillArgs(tenantA, v.visitId))
      )
    );
    const wins = results.filter((r) => !r.error);
    expect(wins).toHaveLength(1);
    expect(results.find((r) => r.error)?.error).toMatchObject({ code: "P0001", message: "ALREADY_BILLED" });
    expect(await writes(tenantA, v.visitId, v.prescriptionIds)).toEqual({ signAudit: 1, invoices: 1, payments: 1, completed: 1, issued: 1, paymentOutbox: 1 });
  });

  it("two concurrent submits of the same id: one writes, the other replays", async () => {
    const v = await seedClinicalVisit(tenantA);
    const args = completeAndBillArgs(tenantA, v.visitId);
    const [x, y] = await Promise.all([callCompleteAndBill(tenantA.client, args), callCompleteAndBill(tenantA.client, args)]);
    expect(x.error).toBeNull();
    expect(y.error).toBeNull();
    expect([(x.data as { replayed: boolean }).replayed, (y.data as { replayed: boolean }).replayed].sort()).toEqual([false, true]);
    expect((await writes(tenantA, v.visitId, v.prescriptionIds)).payments).toBe(1);
  });
});

describe("complete_and_bill: input", () => {
  it.each([
    ["no items", { p_items: [] }, "ITEM_COUNT_INVALID"],
    ["an item without a description", { p_items: [{ item_type: "other", unit_price: 5, quantity: 1 }] }, "ITEM_DESCRIPTION_INVALID"],
    ["a negative discount", { p_discount: -1 }, "INPUT_INVALID"],
    ["a payment with an unknown key", { p_payment: { method: "cash", mystery: 1 } }, "INPUT_INVALID"],
    ["a payment method outside the set", { p_payment: { method: "barter" } }, "METHOD_INVALID"],
    ["a zero payment amount", { p_payment: { method: "cash", amount: 0 } }, "AMOUNT_INVALID"],
    ["a payment amount with three decimals", { p_payment: { method: "cash", amount: 1.234 } }, "AMOUNT_INVALID"],
    ["a payment reference over 100 characters", { p_payment: { method: "cash", reference: "x".repeat(101) } }, "INPUT_INVALID"],
  ])("%s: %s, nothing is signed", async (_name, over, reason) => {
    const v = await seedClinicalVisit(tenantA);
    const args = completeAndBillArgs(tenantA, v.visitId, over as never);
    const res = await callCompleteAndBill(tenantA.client, args);
    expect(res.error).toMatchObject({ code: "P0001", message: reason });
    expect(await visitRow(v.visitId)).toMatchObject({ status: "waiting", signed_at: null });
    expect(await writes(tenantA, v.visitId, v.prescriptionIds)).toEqual(NOTHING);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
  });

  it("a missing visit or request id is refused", async () => {
    const v = await seedClinicalVisit(tenantA);
    expect((await callCompleteAndBill(tenantA.client, completeAndBillArgs(tenantA, null as unknown as string))).error).toMatchObject({ message: "INPUT_INVALID" });
    expect((await callCompleteAndBill(tenantA.client, completeAndBillArgs(tenantA, v.visitId, { p_client_request_id: null as unknown as string }))).error).toMatchObject({
      message: "CLIENT_REQUEST_ID_REQUIRED",
    });
    expect((await visitRow(v.visitId)).signed_at).toBeNull();
  });
});

describe("complete_and_bill: who may call it", () => {
  it.each(ROLES)("%s: allowed exactly when the matrix grants consultations:edit (+ billing:collect with a payment, + collect or being the visit's doctor)", async (role) => {
    for (const withPayment of [false, true]) {
      const own = await seedClinicalVisit(tenantA, { doctorId: members[role].userId });
      const res = await callCompleteAndBill(members[role].client, completeAndBillArgs(tenantA, own.visitId, withPayment ? {} : { p_payment: null as never }));
      const allowed = hasPerm(role, "consultations:edit") && (!withPayment || hasPerm(role, "billing:collect"));
      if (allowed) {
        expect(res.error, `${role} payment=${withPayment}`).toBeNull();
        expect((await visitRow(own.visitId)).signed_by).toBe(members[role].userId);
      } else {
        expect(res.error?.code, `${role} payment=${withPayment}`).toBe("42501");
        expect(await visitRow(own.visitId)).toMatchObject({ signed_at: null });
        expect(await writes(tenantA, own.visitId, own.prescriptionIds)).toEqual(NOTHING);
      }
    }
  });

  it("a clinician without billing:collect cannot bill another doctor's visit: the sign-off is rolled back too", async () => {
    const others = await seedClinicalVisit(tenantA, { doctorId: tenantA.userId });
    const res = await callCompleteAndBill(members.doctor.client, completeAndBillArgs(tenantA, others.visitId, { p_payment: null as never }));
    if (hasPerm("doctor", "billing:collect")) {
      expect(res.error).toBeNull();
    } else {
      expect(res.error?.code).toBe("42501");
      expect(await visitRow(others.visitId)).toMatchObject({ status: "waiting", signed_at: null });
      expect(await writes(tenantA, others.visitId, others.prescriptionIds)).toEqual(NOTHING);
    }
  });

  it("anon cannot execute it (42501)", async () => {
    const v = await seedClinicalVisit(tenantA);
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as TestDb;
    const { data, error } = await callCompleteAndBill(anon, completeAndBillArgs(tenantA, v.visitId));
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect((await visitRow(v.visitId)).signed_at).toBeNull();
  });

  it("another clinic's visit is NOT_FOUND, whichever clinic is named, and nothing is written", async () => {
    const visitB = await seedClinicalVisit(tenantB);
    for (const named of [tenantA, tenantB]) {
      const res = await callCompleteAndBill(tenantA.client, completeAndBillArgs(named, visitB.visitId));
      expect(res.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
      expect(mapDbError(res.error).code).toBe("NOT_FOUND");
    }
    expect(await visitRow(visitB.visitId)).toMatchObject({ signed_at: null });
    expect(await writes(tenantB, visitB.visitId, visitB.prescriptionIds)).toEqual(NOTHING);
  });

  it("a member of A and B acting in A cannot bill B's visit, naming B or A, but can in B", async () => {
    const visitB = await seedClinicalVisit(tenantB);
    const dual = await createDualMembershipUser(tenantA.tenantId, "owner", tenantB.tenantId, "owner");
    const actingInA = await signInActingIn(dual.userEmail, tenantA.tenantId);
    for (const named of [tenantB, tenantA]) {
      const res = await callCompleteAndBill(actingInA, completeAndBillArgs(named, visitB.visitId));
      expect(res.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    }
    expect((await visitRow(visitB.visitId)).signed_at).toBeNull();

    const actingInB = await signInActingIn(dual.userEmail, tenantB.tenantId);
    const ok = await callCompleteAndBill(actingInB, completeAndBillArgs(tenantB, visitB.visitId));
    expect(ok.error).toBeNull();
    expect(await auditRows(tenantB.tenantId, "visit.complete_and_sign", visitB.visitId)).toEqual([
      expect.objectContaining({ actor_id: dual.userId, actor_role: "owner", actor_type: "user" }),
    ]);
  });
});

describe("completeAndBillConsultation (service)", () => {
  const input = (v: { visitId: string; patientId: string }, over: Record<string, unknown> = {}) => ({
    visit_id: v.visitId,
    patient_id: v.patientId,
    consultation_fee: 500,
    additional_items: [] as never[],
    discount: 0,
    payment_collected: true,
    payment_method: "cash" as const,
    client_request_id: randomUUID(),
    ...over,
  });

  it("signs, bills and collects in one call; a repeat of the same id returns the first result and writes nothing new", async () => {
    const v = await seedClinicalVisit(tenantA, { diagnosis: true });
    const req = input(v);
    const first = await completeAndBillConsultation(ctxFor(tenantA), req);
    expect(first).toMatchObject({ success: true, visitId: v.visitId, paymentRecorded: true, replayed: false });
    const replay = await completeAndBillConsultation(ctxFor(tenantA), req);
    expect(replay).toMatchObject({ success: true, invoiceId: (first as { invoiceId: string }).invoiceId, paymentRecorded: true, replayed: true });
    expect(await writes(tenantA, v.visitId, v.prescriptionIds)).toMatchObject({ signAudit: 1, invoices: 1, payments: 1 });
  });

  // V2-07 07-04a (F-7, G-2): a response lost after the commit must not lose the steps that follow it. A replay runs them
  // again, idempotently: the prescription PDF and the receipt are rendered when they are missing, and the one consolidated
  // WhatsApp message has a per-visit dedupe key, so nothing is queued twice.
  describe("post-commit steps after a replay (F-7, G-2)", () => {
    const admin = getAdminClient();
    const receiptPath = (invoiceId: string) => `${tenantA.tenantId}/receipts/inv_${invoiceId}.pdf`;
    const receiptExists = async (invoiceId: string) => {
      const { data } = await admin.storage.from("prescriptions").download(receiptPath(invoiceId));
      return data !== null;
    };
    const rxPath = async (visitId: string) =>
      ((await admin.from("prescriptions").select("pdf_storage_path").eq("visit_id", visitId).order("version", { ascending: false }).limit(1).single()).data as {
        pdf_storage_path: string | null;
      }).pdf_storage_path;
    const consolidated = async (visitId: string) => (await messagesOfVisit(visitId)).filter((m) => m.template_id === "consultation_documents");
    const pdfAudits = async (rxId: string, invoiceId: string) => ({
      rx: (await auditRows(tenantA.tenantId, "prescription.generate_pdf", rxId)).length,
      receipt: (await auditRows(tenantA.tenantId, "invoice.generate_receipt_pdf", invoiceId)).length,
    });

    /** A visit whose patient has a mobile number the message accepts (the seed's number is not one). */
    const messageableVisit = async () => {
      const v = await seedClinicalVisit(tenantA, { diagnosis: true });
      const { error } = await admin.from("patients").update({ phone: "+919876543210" }).eq("id", v.patientId);
      if (error) throw new Error(error.message);
      return v;
    };

    it("the first call archives the prescription PDF and the receipt and queues one consolidated message; an untouched replay does none of it again", async () => {
      const v = await messageableVisit();
      const req = input(v);
      const first = (await completeAndBillConsultation(ctxFor(tenantA), req)) as { success: true; invoiceId: string };
      expect(first.success).toBe(true);
      expect(await rxPath(v.visitId)).toMatch(/rx_v1\.pdf$/);
      expect(await receiptExists(first.invoiceId)).toBe(true);
      expect(await consolidated(v.visitId)).toHaveLength(1);
      const before = await pdfAudits(v.prescriptionIds[0], first.invoiceId);

      const replay = await completeAndBillConsultation(ctxFor(tenantA), req);
      expect(replay).toMatchObject({ success: true, replayed: true });
      expect(await pdfAudits(v.prescriptionIds[0], first.invoiceId)).toEqual(before);
      expect(await consolidated(v.visitId)).toHaveLength(1);
    });

    it("a replay after a lost post-commit renders the missing prescription PDF and receipt, and still queues one message", async () => {
      const v = await messageableVisit();
      const req = input(v);
      const first = (await completeAndBillConsultation(ctxFor(tenantA), req)) as { success: true; invoiceId: string };
      expect(first.success).toBe(true);
      // Simulate the first call dying right after the commit: no archive, no receipt (the queued message stays: it may or may not
      // have been queued before the loss, and a repeat must not add a second).
      const path = await rxPath(v.visitId);
      expect(path).toBeTruthy();
      await admin.from("prescriptions").update({ pdf_storage_path: null }).eq("visit_id", v.visitId);
      await admin.storage.from("prescriptions").remove([path as string, receiptPath(first.invoiceId)]);
      expect(await receiptExists(first.invoiceId)).toBe(false);
      const before = await pdfAudits(v.prescriptionIds[0], first.invoiceId);

      const replay = await completeAndBillConsultation(ctxFor(tenantA), req);
      expect(replay).toMatchObject({ success: true, invoiceId: first.invoiceId, paymentRecorded: true, replayed: true });
      expect(await rxPath(v.visitId)).toMatch(/rx_v1\.pdf$/);
      expect(await receiptExists(first.invoiceId)).toBe(true);
      const after = await pdfAudits(v.prescriptionIds[0], first.invoiceId);
      expect(after.rx).toBe(before.rx + 1);
      expect(after.receipt).toBe(before.receipt + 1);
      expect(await consolidated(v.visitId)).toHaveLength(1);
      // The command itself wrote nothing new.
      expect(await writes(tenantA, v.visitId, v.prescriptionIds)).toMatchObject({ signAudit: 1, invoices: 1, payments: 1 });
    });

    it("a replay of an already-billed result (the desk made the invoice first) runs no receipt or message step", async () => {
      const v = await seedClinicalVisit(tenantA, { diagnosis: true });
      const desk = await callCreateInvoice(tenantA.client, createInvoiceArgs(tenantA, v.visitId));
      expect(desk.error).toBeNull();
      const req = input(v);
      const first = await completeAndBillConsultation(ctxFor(tenantA), req);
      expect(first).toMatchObject({ success: true, alreadyBilled: true });
      const replay = await completeAndBillConsultation(ctxFor(tenantA), req);
      expect(replay).toMatchObject({ success: true, alreadyBilled: true, replayed: true });
      expect(await consolidated(v.visitId)).toHaveLength(0);
      expect(await receiptExists((replay as { invoiceId: string }).invoiceId)).toBe(false);
    });
  });

  it("an already-signed-and-billed visit is the fixed 'already done' failure; a malformed request id is refused before any call", async () => {
    const v = await seedClinicalVisit(tenantA);
    expect(await completeAndBillConsultation(ctxFor(tenantA), input(v))).toMatchObject({ success: true });
    const again = await completeAndBillConsultation(ctxFor(tenantA), input(v));
    expect(again).toMatchObject({ success: false, error: SIGN_AND_BILL_ALREADY_DONE_MESSAGE, code: "CONFLICT", reason: "ALREADY_BILLED" });
    expect(await completeAndBillConsultation(ctxFor(tenantA), input(v, { client_request_id: "nope" }))).toMatchObject({ success: false, code: "VALIDATION_FAILED" });
  });

  it("a doctor without billing:collect who collects is refused before anything is signed; routing to reception works", async () => {
    const v = await seedClinicalVisit(tenantA, { doctorId: members.doctor.userId });
    if (!hasPerm("doctor", "billing:collect")) {
      const denied = await completeAndBillConsultation(ctxFor(members.doctor), input(v));
      expect(denied).toMatchObject({ success: false, error: BILLING_COLLECT_FORBIDDEN_MESSAGE, code: "FORBIDDEN" });
      expect((await visitRow(v.visitId)).signed_at).toBeNull();
    }
    const routed = await completeAndBillConsultation(ctxFor(members.doctor), input(v, { payment_collected: false }));
    expect(routed).toMatchObject({ success: true, paymentRecorded: false });
  });

  it("another clinic's visit is a not-found failure", async () => {
    const visitB = await seedClinicalVisit(tenantB);
    expect(await completeAndBillConsultation(ctxFor(tenantA), input(visitB))).toMatchObject({
      success: false,
      error: COMPLETE_AND_BILL_MESSAGES.NOT_FOUND,
      code: "NOT_FOUND",
    });
    expect((await visitRow(visitB.visitId)).signed_at).toBeNull();
  });
});
