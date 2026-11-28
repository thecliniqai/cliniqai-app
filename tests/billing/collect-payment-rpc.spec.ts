/**
 * V2-07 07-02 (R-1, R-2, R-3, R-7): `public.collect_payment`, desk checkout as one atomic command.
 *
 * The visit's live invoice (created from the items when there is none) and the payment commit together: invoice,
 * items, `invoice.create` and `invoice.payment_recorded` audit rows, the payment, the status move and the
 * `payment.recorded` outbox rows, or nothing. SECURITY DEFINER; billing:collect only (owner, admin, receptionist).
 * Called through the caller's own client; rows are seeded and read back with the service-role client. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { BILLING_COLLECT_FORBIDDEN_MESSAGE, collectPayment, RECORD_PAYMENT_MESSAGES } from "@/features/billing/service";
import { addMemberToTenant, createDualMembershipUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import type { TestDb } from "../helpers/db";
import { ctxFor } from "../helpers/context";
import { signInActingIn } from "../helpers/active-tenant";
import { installScopedFault, leftoverFaults, withFault } from "../helpers/fault";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { createBarrier, gateClient } from "../helpers/write-barrier";
import {
  ITEMS_700,
  auditRows,
  callCollectPayment,
  collectPaymentArgs,
  commandResultRows,
  invoicesOfVisit,
  itemsOfInvoice,
  outboxOfPayment,
  paymentsOfInvoice,
  seedVisit,
  subscribePaymentEvents,
  expectDataOnlyStoredResult,
} from "../helpers/billing-commands";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];

let tenantA: SeededTenant;
let tenantB: SeededTenant;
let endpointA: string;
const members = {} as Record<UserRole, SeededTenant>;

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI Collect Clinic A");
  tenantB = await seedTenantWithOwner("CI Collect Clinic B");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
  endpointA = await subscribePaymentEvents(tenantA);
});

afterAll(async () => {
  await getAdminClient().from("webhook_subscriptions").update({ is_active: false }).eq("id", endpointA);
  expect(leftoverFaults()).toBe(0);
});

async function counts(tenantId: string) {
  return {
    created: (await auditRows(tenantId, "invoice.create")).length,
    paid: (await auditRows(tenantId, "invoice.payment_recorded")).length,
  };
}

describe("collect_payment: catalog", () => {
  it("is DEFINER with the pinned settings, EXECUTE for authenticated only, and a required p_client_request_id", () => {
    expectCommandCatalog({ signature: "public.collect_payment(uuid, uuid, jsonb, numeric, text, text, text, uuid, numeric, numeric, bigint)", definer: true });
  });
});

describe("collect_payment: one transaction", () => {
  it("happy path: invoice, items, payment, both audit rows, the outbox row and the claim commit together", async () => {
    const { visitId, patientId } = await seedVisit(tenantA);
    const args = collectPaymentArgs(tenantA, visitId, { p_method: "upi", p_reference: "UPI-SYNTH-1", p_notes: "synthetic" });
    const { data, error } = await callCollectPayment(members.receptionist.client, args);
    expect(error).toBeNull();
    const r = data as Record<string, unknown> & { invoice_id: string; payment_id: string; invoice_number: string };
    expect(r).toMatchObject({
      invoice_created: true, invoice_status: "paid", paid_total: 650, total_amount: 650, balance_due: 0, replayed: false,
    });
    expect(r.invoice_number).toMatch(/^INV-\d{4}-\d{5}$/);

    const [invoice] = await invoicesOfVisit(visitId);
    expect(invoice).toMatchObject({ id: r.invoice_id, status: "paid", subtotal: 700, discount: 50, total_amount: 650, patient_id: patientId });
    expect(await itemsOfInvoice(r.invoice_id)).toHaveLength(2);
    expect(await paymentsOfInvoice(r.invoice_id)).toEqual([
      { id: r.payment_id, amount: 650, payment_method: "upi", recorded_by: members.receptionist.userId, command_id: args.p_client_request_id },
    ]);

    expect(await auditRows(tenantA.tenantId, "invoice.create", r.invoice_id)).toEqual([
      expect.objectContaining({ actor_id: members.receptionist.userId, actor_role: "receptionist", actor_type: "user" }),
    ]);
    expect(await auditRows(tenantA.tenantId, "invoice.payment_recorded", r.payment_id)).toEqual([
      expect.objectContaining({
        actor_id: members.receptionist.userId,
        entity_type: "payment",
        metadata: { invoice_id: r.invoice_id, payment_method: "upi", old_status: "issued", new_status: "paid" },
      }),
    ]);
    expect(await outboxOfPayment(r.payment_id)).toEqual([expect.objectContaining({ tenant_id: tenantA.tenantId, subscription_id: endpointA })]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual(["public.collect_payment|true"]);
    // F-5 (07-04a): the stored result holds ids, numbers, amounts, statuses and flags only, no free text.
    expectDataOnlyStoredResult(tenantA.tenantId, args.p_client_request_id);
  });

  it("a visit with an invoice: the payment is added to it, the items are ignored, nothing is created", async () => {
    const { visitId } = await seedVisit(tenantA);
    const first = await callCollectPayment(tenantA.client, collectPaymentArgs(tenantA, visitId, { p_amount: 200 }));
    expect(first.data).toMatchObject({ invoice_created: true, invoice_status: "issued", paid_total: 200, balance_due: 450 });
    const invoiceId = (first.data as { invoice_id: string }).invoice_id;
    const createdBefore = (await auditRows(tenantA.tenantId, "invoice.create", invoiceId)).length;

    const second = await callCollectPayment(
      tenantA.client,
      collectPaymentArgs(tenantA, visitId, { p_items: [], p_amount: 450, p_discount: 0 })
    );
    expect(second.error).toBeNull();
    expect(second.data).toMatchObject({ invoice_id: invoiceId, invoice_created: false, invoice_status: "paid", paid_total: 650, balance_due: 0 });
    expect(await invoicesOfVisit(visitId)).toHaveLength(1);
    expect(await itemsOfInvoice(invoiceId)).toHaveLength(2);
    expect(await paymentsOfInvoice(invoiceId)).toHaveLength(2);
    expect(await auditRows(tenantA.tenantId, "invoice.create", invoiceId)).toHaveLength(createdBefore);
  });

  it("rollback: a fault after the items insert leaves no invoice, items, payment, audit, outbox or claim; the same id then succeeds", async () => {
    const { visitId } = await seedVisit(tenantA);
    const marker = `CI-FAULT-${randomUUID().slice(0, 8)}`;
    const items = [{ item_type: "procedure", description: marker, unit_price: 300, quantity: 1 }];
    const args = collectPaymentArgs(tenantA, visitId, { p_items: items, p_amount: 300, p_discount: 0 });
    const before = await counts(tenantA.tenantId);

    await withFault({ table: "public.invoice_items", column: "description", marker }, async () => {
      const { data, error } = await callCollectPayment(tenantA.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");
    });

    expect(await invoicesOfVisit(visitId)).toEqual([]);
    expect(await counts(tenantA.tenantId)).toEqual(before);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);

    const retry = await callCollectPayment(tenantA.client, args);
    expect(retry.error).toBeNull();
    expect(retry.data).toMatchObject({ invoice_created: true, replayed: false, invoice_status: "paid" });
  });

  it("rollback: a fault in the payment step (after the invoice, items and invoice audit) takes the invoice with it", async () => {
    const { visitId } = await seedVisit(tenantA);
    const reference = `REF-${randomUUID().slice(0, 8)}`;
    const args = collectPaymentArgs(tenantA, visitId, { p_reference: reference });
    const before = await counts(tenantA.tenantId);

    await withFault({ table: "public.payments", column: "reference_number", marker: reference }, async () => {
      const { data, error } = await callCollectPayment(tenantA.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");

      // Through the service: a fixed message, never the driver's text, and not a "success without payment".
      const viaService = await collectPayment(ctxFor(tenantA), {
        visit_id: visitId,
        patient_id: await patientOf(visitId),
        items: ITEMS_700.map((i) => ({ ...i, item_type: i.item_type as "consultation" | "procedure" })),
        discount: 50,
        tax: 0,
        amount: 650,
        payment_method: "cash",
        reference_number: reference,
        client_request_id: randomUUID(),
      });
      expect(viaService).toMatchObject({ ok: false, error: { code: "INTERNAL", message: RECORD_PAYMENT_MESSAGES.INTERNAL } });
      expect(JSON.stringify(viaService)).not.toContain("SPIKE_FAULT");
    });

    expect(await invoicesOfVisit(visitId)).toEqual([]);
    expect(await counts(tenantA.tenantId)).toEqual(before);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
  });

  it("rollback: a fault in the outbox insert (the last write) leaves nothing", async () => {
    const { visitId } = await seedVisit(tenantA);
    const marker = await subscribePaymentEvents(tenantA);
    const fault = installScopedFault({ table: "public.webhook_delivery_queue", column: "subscription_id", marker });
    const args = collectPaymentArgs(tenantA, visitId);
    const before = await counts(tenantA.tenantId);
    try {
      const { data, error } = await callCollectPayment(tenantA.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");
    } finally {
      fault.remove();
      await getAdminClient().from("webhook_subscriptions").update({ is_active: false }).eq("id", marker);
    }
    expect(await invoicesOfVisit(visitId)).toEqual([]);
    expect(await counts(tenantA.tenantId)).toEqual(before);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
  });

  it("an amount above the bill is OVERPAYMENT and the invoice it would have created is not left behind", async () => {
    const { visitId } = await seedVisit(tenantA);
    const args = collectPaymentArgs(tenantA, visitId, { p_amount: 650.01 });
    const { data, error } = await callCollectPayment(tenantA.client, args);
    expect(data).toBeNull();
    expect(error).toMatchObject({ code: "P0001", message: "OVERPAYMENT" });
    expect(mapDbError(error)).toMatchObject({ code: "CONFLICT", reason: "OVERPAYMENT" });
    expect(await invoicesOfVisit(visitId)).toEqual([]);
  });

  it("a settled invoice is INVOICE_NOT_PAYABLE", async () => {
    const { visitId } = await seedVisit(tenantA);
    expect((await callCollectPayment(tenantA.client, collectPaymentArgs(tenantA, visitId))).error).toBeNull();
    const again = await callCollectPayment(tenantA.client, collectPaymentArgs(tenantA, visitId, { p_amount: 1 }));
    expect(mapDbError(again.error)).toMatchObject({ code: "CONFLICT", reason: "INVOICE_NOT_PAYABLE" });
    expect(await paymentsOfInvoice((await invoicesOfVisit(visitId))[0].id)).toHaveLength(1);
  });
});

async function patientOf(visitId: string): Promise<string> {
  const { data } = await getAdminClient().from("visits").select("patient_id").eq("id", visitId).single();
  return (data as { patient_id: string }).patient_id;
}

describe("collect_payment: idempotency and races", () => {
  it("the same id twice: one invoice, one payment, one outbox row, the first result with replayed: true", async () => {
    const { visitId } = await seedVisit(tenantA);
    const args = collectPaymentArgs(tenantA, visitId);
    const first = await callCollectPayment(tenantA.client, args);
    const second = await callCollectPayment(tenantA.client, args);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ...(first.data as object), replayed: true });
    const [invoice] = await invoicesOfVisit(visitId);
    const payments = await paymentsOfInvoice(invoice.id);
    expect(payments).toHaveLength(1);
    expect(await outboxOfPayment(payments[0].id)).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "invoice.payment_recorded", payments[0].id)).toHaveLength(1);
  });

  it("the same id with another amount or items is IDEMPOTENCY_MISMATCH and writes nothing", async () => {
    const { visitId } = await seedVisit(tenantA);
    const args = collectPaymentArgs(tenantA, visitId, { p_amount: 300 });
    expect((await callCollectPayment(tenantA.client, args)).error).toBeNull();
    // Every input the command acts on is part of the request hash (T-1): a retry may repeat a request, never change it.
    const changed = [
      { p_amount: 301 },
      { p_method: "card" },
      { p_items: [] as never },
      { p_notes: "other" },
      { p_reference: "UTR-2" },
      { p_discount: 10 },
      { p_tax: 5 },
      { p_items: [{ item_type: "consultation", description: "Another fee", unit_price: 500, quantity: 1 }] as never },
    ];
    for (const over of changed) {
      const res = await callCollectPayment(tenantA.client, { ...args, ...over });
      expect(mapDbError(res.error), JSON.stringify(over)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    }
    expect(await paymentsOfInvoice((await invoicesOfVisit(visitId))[0].id)).toHaveLength(1);
  });

  it("the id of a create_invoice call cannot be reused for collect_payment", async () => {
    const { visitId } = await seedVisit(tenantA);
    const id = randomUUID();
    const created = await tenantA.client.rpc("create_invoice", { p_tenant_id: tenantA.tenantId, p_visit_id: visitId, p_items: ITEMS_700, p_client_request_id: id });
    expect(created.error).toBeNull();
    const res = await callCollectPayment(tenantA.client, collectPaymentArgs(tenantA, visitId, { p_client_request_id: id }));
    expect(mapDbError(res.error)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
  });

  it("two concurrent submits of one visit with different ids: one invoice, and the payments never exceed the total", async () => {
    // 400 + 400 on a 650 bill: exactly one fits.
    const over = await seedVisit(tenantA);
    const b1 = createBarrier(2);
    const [x, y] = await Promise.all([
      callCollectPayment(gateClient(tenantA.client, { rpc: { collect_payment: b1 } }), collectPaymentArgs(tenantA, over.visitId, { p_amount: 400 })),
      callCollectPayment(gateClient(members.receptionist.client, { rpc: { collect_payment: b1 } }), collectPaymentArgs(tenantA, over.visitId, { p_amount: 400 })),
    ]);
    expect([x.error, y.error].filter(Boolean)).toHaveLength(1);
    const failed = [x.error, y.error].find(Boolean);
    expect(mapDbError(failed)).toMatchObject({ code: "CONFLICT", reason: "OVERPAYMENT" });
    const invoicesOver = await invoicesOfVisit(over.visitId);
    expect(invoicesOver).toHaveLength(1);
    expect(await paymentsOfInvoice(invoicesOver[0].id)).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "invoice.create", invoicesOver[0].id)).toHaveLength(1);

    // 325 + 325 on 650: both fit, the invoice is paid once, still one invoice.
    const fit = await seedVisit(tenantA);
    const b2 = createBarrier(2);
    const [p, q] = await Promise.all([
      callCollectPayment(gateClient(tenantA.client, { rpc: { collect_payment: b2 } }), collectPaymentArgs(tenantA, fit.visitId, { p_amount: 325 })),
      callCollectPayment(gateClient(members.admin.client, { rpc: { collect_payment: b2 } }), collectPaymentArgs(tenantA, fit.visitId, { p_amount: 325 })),
    ]);
    expect(p.error).toBeNull();
    expect(q.error).toBeNull();
    expect([(p.data as { invoice_created: boolean }).invoice_created, (q.data as { invoice_created: boolean }).invoice_created].sort()).toEqual([false, true]);
    const [invoice] = await invoicesOfVisit(fit.visitId);
    expect(invoice.status).toBe("paid");
    expect((await paymentsOfInvoice(invoice.id)).reduce((s, row) => s + row.amount, 0)).toBe(650);
  });

  it("two concurrent submits of one id: one payment, the loser replays the winner's result", async () => {
    const { visitId } = await seedVisit(tenantA);
    const args = collectPaymentArgs(tenantA, visitId);
    const barrier = createBarrier(2);
    const [x, y] = await Promise.all([
      callCollectPayment(gateClient(tenantA.client, { rpc: { collect_payment: barrier } }), args),
      callCollectPayment(gateClient(tenantA.client, { rpc: { collect_payment: barrier } }), args),
    ]);
    expect(x.error).toBeNull();
    expect(y.error).toBeNull();
    expect([(x.data as { replayed: boolean }).replayed, (y.data as { replayed: boolean }).replayed].sort()).toEqual([false, true]);
    const [invoice] = await invoicesOfVisit(visitId);
    expect(await paymentsOfInvoice(invoice.id)).toHaveLength(1);
  });
});

describe("collect_payment: input", () => {
  const bad: [string, Partial<Parameters<typeof collectPaymentArgs>[2]>, string][] = [
    ["a zero amount", { p_amount: 0 }, "AMOUNT_INVALID"],
    ["a negative amount", { p_amount: -5 }, "AMOUNT_INVALID"],
    ["an amount with three decimals", { p_amount: 10.001 }, "AMOUNT_INVALID"],
    ["an unknown method", { p_method: "bitcoin" }, "METHOD_INVALID"],
    ["a reference over 100 characters", { p_reference: "x".repeat(101) }, "INPUT_INVALID"],
    ["notes over 500 characters", { p_notes: "x".repeat(501) }, "INPUT_INVALID"],
    ["no items and no invoice", { p_items: [] as never }, "ITEM_COUNT_INVALID"],
    ["a negative discount", { p_discount: -1 }, "INPUT_INVALID"],
  ];
  it.each(bad)("%s is refused and writes nothing", async (_name, over, reason) => {
    const { visitId } = await seedVisit(tenantA);
    const args = collectPaymentArgs(tenantA, visitId, over);
    const { data, error } = await callCollectPayment(tenantA.client, args);
    expect(data).toBeNull();
    expect(error).toMatchObject({ code: "P0001", message: reason });
    expect(await invoicesOfVisit(visitId)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
  });
});

describe("collect_payment: who may call it", () => {
  it.each(ROLES)("%s: allowed exactly when the matrix grants billing:collect", async (role) => {
    const { visitId } = await seedVisit(tenantA, members.doctor.userId);
    const { data, error } = await callCollectPayment(members[role].client, collectPaymentArgs(tenantA, visitId));
    if (hasPerm(role, "billing:collect")) {
      expect(error).toBeNull();
      expect(data).toMatchObject({ invoice_status: "paid" });
    } else {
      expect(error?.code).toBe("42501");
      expect(await invoicesOfVisit(visitId)).toEqual([]);
    }
  });

  it("the service answers a doctor with the fixed text and checks the visit belongs to the patient", async () => {
    const { visitId, patientId } = await seedVisit(tenantA, members.doctor.userId);
    const input = {
      visit_id: visitId, patient_id: patientId, items: [], discount: 0, tax: 0, amount: 100,
      payment_method: "cash" as const, client_request_id: randomUUID(),
    };
    expect(await collectPayment(ctxFor(members.doctor), input)).toMatchObject({ ok: false, error: { code: "FORBIDDEN", message: BILLING_COLLECT_FORBIDDEN_MESSAGE } });
    const other = await seedVisit(tenantA);
    expect(await collectPayment(ctxFor(tenantA), { ...input, patient_id: other.patientId })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await invoicesOfVisit(visitId)).toEqual([]);
  });

  it("the service parses its input: a missing or malformed request id is VALIDATION_FAILED", async () => {
    const { visitId, patientId } = await seedVisit(tenantA);
    const base = { visit_id: visitId, patient_id: patientId, items: [], discount: 0, tax: 0, amount: 100, payment_method: "cash" as const };
    const res = await collectPayment(ctxFor(tenantA), { ...base, client_request_id: "not-a-uuid" });
    expect(res).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(await invoicesOfVisit(visitId)).toEqual([]);
  });

  it("the service collects and replays: the same client_request_id returns the first result", async () => {
    const { visitId, patientId } = await seedVisit(tenantA);
    const input = {
      visit_id: visitId, patient_id: patientId,
      items: [{ item_type: "consultation" as const, description: "OPD Consultation Fee", unit_price: 500, quantity: 1 }],
      discount: 0, tax: 0, amount: 500, payment_method: "cash" as const, client_request_id: randomUUID(),
    };
    const first = await collectPayment(ctxFor(tenantA), input);
    expect(first).toMatchObject({ ok: true, value: { invoiceCreated: true, status: "paid", totalPaid: 500, balanceDue: 0, replayed: false } });
    const second = await collectPayment(ctxFor(tenantA), input);
    expect(second).toMatchObject({ ok: true, value: { invoiceCreated: true, replayed: true } });
    expect(await paymentsOfInvoice((await invoicesOfVisit(visitId))[0].id)).toHaveLength(1);
  });

  it("anon cannot execute it (42501)", async () => {
    const { visitId } = await seedVisit(tenantA);
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as TestDb;
    const { data, error } = await callCollectPayment(anon, collectPaymentArgs(tenantA, visitId));
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect(await invoicesOfVisit(visitId)).toEqual([]);
  });

  it("another clinic's visit is NOT_FOUND, whichever clinic is named, and nothing is written", async () => {
    const visitB = await seedVisit(tenantB);
    const underA = await callCollectPayment(tenantA.client, collectPaymentArgs(tenantA, visitB.visitId));
    expect(underA.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    const underB = await callCollectPayment(tenantA.client, collectPaymentArgs(tenantB, visitB.visitId));
    expect(underB.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    expect(mapDbError(underB.error).code).toBe("NOT_FOUND");
    expect(await invoicesOfVisit(visitB.visitId)).toEqual([]);
  });

  it("a member of A and B acting in A cannot collect on B's visit, naming B or A, but can in B", async () => {
    const visitB = await seedVisit(tenantB);
    const dual = await createDualMembershipUser(tenantA.tenantId, "receptionist", tenantB.tenantId, "receptionist");
    const actingInA = await signInActingIn(dual.userEmail, tenantA.tenantId);
    for (const named of [tenantB, tenantA]) {
      const res = await callCollectPayment(actingInA, collectPaymentArgs(named, visitB.visitId));
      expect(res.error).toMatchObject({ code: "P0002", message: "VISIT_NOT_FOUND" });
    }
    expect(await invoicesOfVisit(visitB.visitId)).toEqual([]);

    const actingInB = await signInActingIn(dual.userEmail, tenantB.tenantId);
    const ok = await callCollectPayment(actingInB, collectPaymentArgs(tenantB, visitB.visitId));
    expect(ok.error).toBeNull();
    const paymentId = (ok.data as { payment_id: string }).payment_id;
    expect(await auditRows(tenantB.tenantId, "invoice.payment_recorded", paymentId)).toEqual([
      expect.objectContaining({ actor_id: dual.userId, actor_role: "receptionist", actor_type: "user" }),
    ]);
  });
});
