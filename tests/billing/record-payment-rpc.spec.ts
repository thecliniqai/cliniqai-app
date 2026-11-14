/**
 * V2-03 03-07 D1 confirmation spike (C18, R-2, AD-7; TARGET §3.2, §6, §7.1): `public.record_payment` (000027).
 *
 * One atomic command under the caller's RLS, called through user-scoped supabase-js clients: the invoice row lock, the
 * invariants, the payment, the status transition, the audit row (actor = auth.uid()) and the `payment.recorded` outbox
 * rows commit together or not at all. The system path runs the same function through `getSystemDb(reason)` with an
 * explicit system actor. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm, ROLE_PERMISSIONS } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { recordPayment, RECORD_PAYMENT_MESSAGES } from "@/features/billing/service";
import { recordPaymentAsSystem } from "@/features/billing/system";
import {
  addMemberToTenant,
  createDualMembershipUser,
  createUnlinkedUser,
  seedTenantWithOwner,
  type SeededTenant,
} from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { insertReturningId, type TestDb } from "../helpers/db";
import { ctxFor } from "../helpers/context";
import { signInActingIn } from "../helpers/active-tenant";
import { psql, psqlAsync } from "../helpers/sql";

const RPC_SIGNATURE = "public.record_payment(uuid, uuid, numeric, text, text, uuid, text, text)";
const HELPER_SIGNATURE = "private.outbox_payment_recorded(uuid)";

type RpcArgs = {
  p_tenant_id: string;
  p_invoice_id: string;
  p_amount: number;
  p_method: string;
  p_reference: string;
  p_command_id: string;
  p_notes?: string;
  p_system_actor?: string;
};

let tenantA: SeededTenant;
let tenantB: SeededTenant;
let subscribedEndpoint: string;
let admin: TestDb;

/** Calls the RPC with the active tenant A unless the case names another one. */
function rpc(db: TestDb, args: Partial<RpcArgs> & { p_invoice_id: string; p_amount: number }) {
  return db.rpc("record_payment", {
    p_tenant_id: tenantA.tenantId,
    p_method: "cash",
    p_reference: "",
    p_command_id: randomUUID(),
    ...args,
  });
}

/** A fresh patient, visit and invoice in `t`'s tenant (one live invoice per visit, 000024). */
async function seedInvoice(t: SeededTenant, total: number, status: "issued" | "paid" | "cancelled" | "draft" = "issued") {
  const patientId = await insertReturningId(admin, "patients", {
    tenant_id: t.tenantId,
    full_name: "Synthetic Payer",
    phone: "+910000000000",
    created_by: t.userId,
  });
  const visitId = await insertReturningId(admin, "visits", {
    tenant_id: t.tenantId,
    patient_id: patientId,
    doctor_id: t.userId,
    origin_type: "walk_in",
    created_by: t.userId,
  });
  return insertReturningId(admin, "invoices", {
    tenant_id: t.tenantId,
    visit_id: visitId,
    patient_id: patientId,
    invoice_number: `RP-${randomUUID()}`,
    subtotal: total,
    total_amount: total,
    status,
  });
}

async function subscribe(t: SeededTenant, eventTypes: string[], isActive = true): Promise<string> {
  return insertReturningId(admin, "webhook_subscriptions", {
    tenant_id: t.tenantId,
    endpoint_url: `https://hooks.example.test/${randomUUID()}`,
    event_types: eventTypes,
    signing_secret: randomUUID(),
    is_active: isActive,
    created_by: t.userId,
  });
}

async function paymentsOf(invoiceId: string) {
  const { data, error } = await admin
    .from("payments")
    .select("id, amount, payment_method, recorded_by, recorded_by_system, command_id, tenant_id")
    .eq("invoice_id", invoiceId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function auditOf(paymentIds: string[]) {
  if (paymentIds.length === 0) return [];
  const { data, error } = await admin
    .from("audit_logs")
    .select("tenant_id, actor_id, actor_role, actor_type, action, entity_type, entity_id, metadata")
    .eq("entity_type", "payment")
    .in("entity_id", paymentIds);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Audit rows of any payment of this invoice, found through the metadata (works when the payment rolled back). */
async function auditByInvoice(invoiceId: string) {
  const { data, error } = await admin
    .from("audit_logs")
    .select("id")
    .eq("action", "invoice.payment_recorded")
    .eq("metadata->>invoice_id", invoiceId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function outboxOf(paymentId: string) {
  const { data, error } = await admin
    .from("webhook_delivery_queue")
    .select("id, tenant_id, subscription_id, event_type, payload, status, event_key")
    .eq("event_type", "payment.recorded")
    .like("payload", `%${paymentId}%`);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function invoiceStatus(invoiceId: string): Promise<string> {
  const { data, error } = await admin.from("invoices").select("status").eq("id", invoiceId).single();
  if (error || !data) throw new Error(error?.message);
  return data.status;
}

beforeAll(async () => {
  admin = getAdminClient();
  tenantA = await seedTenantWithOwner("RP Spike Clinic A");
  tenantB = await seedTenantWithOwner("RP Spike Clinic B");
  subscribedEndpoint = await subscribe(tenantA, ["payment.recorded", "visit.completed"]);
  await subscribe(tenantA, ["visit.completed"]); // not subscribed to the event
  await subscribe(tenantA, ["payment.recorded"], false); // inactive
  await subscribe(tenantB, ["payment.recorded"]); // another tenant
});

describe("record_payment: one transaction under the caller's RLS", () => {
  it("happy path: one payment, audit actor = auth.uid(), one outbox row for the subscribed endpoint, invoice paid", async () => {
    const invoiceId = await seedInvoice(tenantA, 650);
    const commandId = randomUUID();

    const { data, error } = await rpc(tenantA.client, { p_invoice_id: invoiceId, p_amount: 650, p_method: "upi", p_reference: "UPI-SYNTH-1", p_command_id: commandId });
    expect(error).toBeNull();
    expect(data).toMatchObject({ invoice_status: "paid", paid_total: 650, total_amount: 650, balance_due: 0, replayed: false });
    const paymentId = (data as { payment_id: string }).payment_id;

    expect(await paymentsOf(invoiceId)).toEqual([
      { id: paymentId, amount: 650, payment_method: "upi", recorded_by: tenantA.userId, recorded_by_system: null, command_id: commandId, tenant_id: tenantA.tenantId },
    ]);
    expect(await invoiceStatus(invoiceId)).toBe("paid");

    expect(await auditOf([paymentId])).toEqual([
      {
        tenant_id: tenantA.tenantId,
        actor_id: tenantA.userId,
        actor_role: "owner",
        actor_type: "user",
        action: "invoice.payment_recorded",
        entity_type: "payment",
        entity_id: paymentId,
        metadata: { invoice_id: invoiceId, payment_method: "upi", old_status: "issued", new_status: "paid" },
      },
    ]);

    const outbox = await outboxOf(paymentId);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ tenant_id: tenantA.tenantId, subscription_id: subscribedEndpoint, status: "pending" });
    const envelope = JSON.parse(outbox[0].payload) as { event: string; data: Record<string, unknown> };
    expect(envelope.event).toBe("payment.recorded");
    expect(envelope.data).toMatchObject({ payment_id: paymentId, invoice_id: invoiceId, amount: 650, payment_method: "upi", invoice_status: "paid", paid_total: 650 });
    expect(Object.keys(envelope.data).sort()).toEqual(
      ["amount", "invoice_id", "invoice_status", "paid_total", "payment_id", "payment_method", "recorded_at"].sort()
    );

    // V2-04 04-03b (03-07 handover): the writer sets the event key, and the row's trigger gives it a webhook.deliver job
    // (record_payment itself is unchanged).
    expect(outbox[0].event_key).toBe(`payment.recorded:${paymentId}`);
    expect(
      psql(
        `select status || '|' || dedupe_key || '|' || tenant_id from ops.jobs where kind = 'webhook.deliver' ` +
          `and payload ->> 'delivery_id' = '${outbox[0].id}'`
      )
    ).toEqual([`pending|wh:${outbox[0].id}|${tenantA.tenantId}`]);
  });

  it("a partial payment keeps the invoice issued; the remainder settles it", async () => {
    const invoiceId = await seedInvoice(tenantA, 650);
    const first = await rpc(tenantA.client, { p_invoice_id: invoiceId, p_amount: 300 });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ invoice_status: "issued", paid_total: 300, balance_due: 350 });
    expect(await invoiceStatus(invoiceId)).toBe("issued");

    const second = await rpc(tenantA.client, { p_invoice_id: invoiceId, p_amount: 350 });
    expect(second.error).toBeNull();
    expect(second.data).toMatchObject({ invoice_status: "paid", paid_total: 650, balance_due: 0 });
    expect(await paymentsOf(invoiceId)).toHaveLength(2);
  });

  it("rollback: a fault in the outbox insert (after the payment and audit inserts) leaves 0 payments, 0 audit, 0 outbox rows and the invoice unchanged", async () => {
    const invoiceId = await seedInvoice(tenantA, 400);
    const marker = await subscribe(tenantA, ["payment.recorded"]);
    const suffix = randomUUID().replace(/-/g, "");
    const fn = `public.rp_spike_fault_${suffix}`;
    const trigger = `rp_spike_fault_${suffix}`;
    // The fault is scoped to the marker endpoint, so no other row (or test) is affected while it exists.
    psql(
      `create function ${fn}() returns trigger language plpgsql as $$ begin ` +
        `if new.subscription_id = '${marker}'::uuid then raise exception 'SPIKE_FAULT' using errcode = 'XX000'; end if; ` +
        `return new; end $$; ` +
        `create trigger ${trigger} before insert on public.webhook_delivery_queue for each row execute function ${fn}();`
    );
    const commandId = randomUUID();
    try {
      const { data, error } = await rpc(tenantA.client, { p_invoice_id: invoiceId, p_amount: 400, p_command_id: commandId });
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");
      expect(mapDbError(error)).toEqual({ code: "INTERNAL", message: "Something went wrong. Try again." });

      expect(await paymentsOf(invoiceId)).toEqual([]);
      expect(await auditByInvoice(invoiceId)).toEqual([]);
      const { data: queued } = await admin.from("webhook_delivery_queue").select("id").eq("subscription_id", marker);
      expect(queued).toEqual([]);
      expect(await invoiceStatus(invoiceId)).toBe("issued");

      // Through the service the caller gets the fixed message, never the driver text.
      const viaService = await recordPayment(ctxFor(tenantA), { invoice_id: invoiceId, amount: 400, payment_method: "cash" });
      expect(viaService).toEqual({ success: false, error: RECORD_PAYMENT_MESSAGES.INTERNAL });
      expect(JSON.stringify(viaService)).not.toContain("SPIKE_FAULT");
      expect(await paymentsOf(invoiceId)).toEqual([]);
    } finally {
      psql(`drop trigger if exists ${trigger} on public.webhook_delivery_queue; drop function if exists ${fn}();`);
      await admin.from("webhook_subscriptions").update({ is_active: false }).eq("id", marker);
    }

    // Control: without the fault the same command id records a new payment (nothing of the failed attempt survived).
    const retry = await rpc(tenantA.client, { p_invoice_id: invoiceId, p_amount: 400, p_command_id: commandId });
    expect(retry.error).toBeNull();
    expect(retry.data).toMatchObject({ replayed: false, invoice_status: "paid" });
    expect(await auditByInvoice(invoiceId)).toHaveLength(1);
  });

  it("a cross-tenant invoice id is NOT_FOUND and nothing changes in either tenant", async () => {
    const invoiceId = await seedInvoice(tenantA, 500);
    // B's owner, active in B, names A's invoice; then also names A as the tenant (RLS still hides it).
    const forged = await rpc(tenantB.client, { p_tenant_id: tenantA.tenantId, p_invoice_id: invoiceId, p_amount: 100 });
    expect(mapDbError(forged.error).code).toBe("NOT_FOUND");
    const { data, error } = await rpc(tenantB.client, { p_tenant_id: tenantB.tenantId, p_invoice_id: invoiceId, p_amount: 100 });
    expect(data).toBeNull();
    expect(error?.code).toBe("P0002");
    expect(mapDbError(error)).toMatchObject({ code: "NOT_FOUND", reason: "INVOICE_NOT_FOUND" });

    expect(await paymentsOf(invoiceId)).toEqual([]);
    expect(await auditByInvoice(invoiceId)).toEqual([]);
    expect(await invoiceStatus(invoiceId)).toBe("issued");
    const { data: bPayments } = await admin.from("payments").select("id").eq("tenant_id", tenantB.tenantId);
    expect(bPayments).toEqual([]);

    const viaService = await recordPayment(ctxFor(tenantB), { invoice_id: invoiceId, amount: 100, payment_method: "cash" });
    expect(viaService).toEqual({ success: false, error: RECORD_PAYMENT_MESSAGES.NOT_FOUND });
  });

  it("a member of A and B acting in B cannot pay A's invoice (the active tenant narrows RLS, AR-M2b)", async () => {
    const invoiceId = await seedInvoice(tenantA, 500);
    const dual = await createDualMembershipUser(tenantA.tenantId, "receptionist", tenantB.tenantId, "receptionist");
    const { error } = await rpc(dual.client, { p_tenant_id: tenantB.tenantId, p_invoice_id: invoiceId, p_amount: 100 });
    expect(mapDbError(error)).toMatchObject({ code: "NOT_FOUND", reason: "INVOICE_NOT_FOUND" });
    expect(await paymentsOf(invoiceId)).toEqual([]);
    expect(await auditByInvoice(invoiceId)).toEqual([]);

    // Through the service the active tenant comes from the context, never from the input.
    const ctxInB = { userId: dual.userId, tenantId: tenantB.tenantId, role: "receptionist" as const, actorType: "user" as const, db: dual.client };
    expect(await recordPayment(ctxInB, { invoice_id: invoiceId, amount: 100, payment_method: "cash" })).toEqual({
      success: false,
      error: RECORD_PAYMENT_MESSAGES.NOT_FOUND,
    });
    expect(await paymentsOf(invoiceId)).toEqual([]);

    // Acting in A (the app's client names the cookie's clinic in x-clinicos-tenant, R-42), the same user can.
    const actingInA = await signInActingIn(dual.userEmail, tenantA.tenantId);
    const inA = await rpc(actingInA, { p_tenant_id: tenantA.tenantId, p_invoice_id: invoiceId, p_amount: 100 });
    expect(inA.error).toBeNull();
  });

  it("a user with no membership gets NOT_FOUND", async () => {
    const invoiceId = await seedInvoice(tenantA, 500);
    const outsider = await createUnlinkedUser();
    const { error } = await rpc(outsider.client, { p_invoice_id: invoiceId, p_amount: 100 });
    expect(mapDbError(error).code).toBe("NOT_FOUND");
    expect(await paymentsOf(invoiceId)).toEqual([]);
  });
});

describe("record_payment: role matrix derived from ROLE_PERMISSIONS (billing:collect since V2-05 05-02b)", () => {
  const roles = Object.keys(ROLE_PERMISSIONS) as UserRole[];
  const allowed = roles.filter((r) => hasPerm(r, "appointments:edit"));

  // The function's own role check still mirrors appointments:edit (000027/000029); 05-02c replaces it with
  // has_permission('billing:collect'). Since 05-02b the payments INSERT and invoices policies (000056, PO-3) already
  // decide who pays: the per-role case below asserts that effective rule.
  it("the function's own role list still equals the appointments:edit roles (replaced in 05-02c)", () => {
    const def = psql(`select pg_get_functiondef('${RPC_SIGNATURE}'::regprocedure)`).join("\n");
    const lists = [...def.matchAll(/ARRAY\[([^\]]*)\]/g)].map((m) => m[1]);
    expect(lists).toHaveLength(1);
    const sqlRoles = [...lists[0].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(sqlRoles.sort()).toEqual([...allowed].sort());
  });

  it.each(roles)("%s: succeeds iff the matrix grants billing:collect (PO-3); the outbox row is written for every collector", async (role) => {
    const member = role === "owner" ? tenantA : await addMemberToTenant(tenantA.tenantId, role);
    const invoiceId = await seedInvoice(tenantA, 200);
    const { data, error } = await rpc(member.client, { p_invoice_id: invoiceId, p_amount: 200 });

    if (hasPerm(role, "billing:collect")) {
      expect(error).toBeNull();
      const paymentId = (data as { payment_id: string }).payment_id;
      expect(await auditOf([paymentId])).toMatchObject([{ actor_id: member.userId, actor_role: role, actor_type: "user" }]);
      // The outbox tables are owner/admin-only under RLS; the definer fan-out still writes the row for every role.
      expect(await outboxOf(paymentId)).toHaveLength(1);
    } else {
      // Doctors and nurses do not read another doctor's invoice at all (000056: billing:view, or the visit's own
      // doctor), so the locked lookup finds nothing; a doctor's own-visit attempt is refused by the payments INSERT
      // policy (42501, tests/billing/collect-permission.spec.ts).
      expect(mapDbError(error).code).toBe("NOT_FOUND");
      expect(await paymentsOf(invoiceId)).toEqual([]);
    }
  });
});

describe("record_payment: invariants", () => {
  it("overpayment is CONFLICT/OVERPAYMENT and writes nothing", async () => {
    const invoiceId = await seedInvoice(tenantA, 500);
    const { error } = await rpc(tenantA.client, { p_invoice_id: invoiceId, p_amount: 500.01 });
    expect(error?.code).toBe("P0001");
    expect(mapDbError(error)).toMatchObject({ code: "CONFLICT", reason: "OVERPAYMENT" });
    expect(await paymentsOf(invoiceId)).toEqual([]);
    expect(await auditByInvoice(invoiceId)).toEqual([]);

    const viaService = await recordPayment(ctxFor(tenantA), { invoice_id: invoiceId, amount: 900, payment_method: "card" });
    expect(viaService).toEqual({ success: false, error: RECORD_PAYMENT_MESSAGES.OVERPAYMENT });
  });

  it.each(["paid", "cancelled"] as const)("a %s invoice is CONFLICT/INVOICE_NOT_PAYABLE", async (status) => {
    const invoiceId = await seedInvoice(tenantA, 500, status);
    const { error } = await rpc(tenantA.client, { p_invoice_id: invoiceId, p_amount: 1 });
    expect(mapDbError(error)).toMatchObject({ code: "CONFLICT", reason: "INVOICE_NOT_PAYABLE" });
    expect(await paymentsOf(invoiceId)).toEqual([]);
  });

  it.each([
    ["zero amount", { p_amount: 0 }, "AMOUNT_INVALID"],
    ["negative amount", { p_amount: -5 }, "AMOUNT_INVALID"],
    ["three decimals", { p_amount: 10.005 }, "AMOUNT_INVALID"],
    ["unknown method", { p_amount: 10, p_method: "cheque" }, "METHOD_INVALID"],
    ["reference over 100 characters", { p_amount: 10, p_reference: "R".repeat(101) }, "INPUT_INVALID"],
  ] as const)("%s is VALIDATION_FAILED", async (_name, args, reason) => {
    const invoiceId = await seedInvoice(tenantA, 500);
    const { error } = await rpc(tenantA.client, { p_invoice_id: invoiceId, ...args });
    expect(mapDbError(error)).toMatchObject({ code: "VALIDATION_FAILED", reason });
    expect(await paymentsOf(invoiceId)).toEqual([]);
  });

  it("concurrent overpayment race: of two 600 payments on a 1000 invoice exactly one succeeds (3 rounds)", async () => {
    const receptionist = await addMemberToTenant(tenantA.tenantId, "receptionist");
    for (let round = 0; round < 3; round++) {
      const invoiceId = await seedInvoice(tenantA, 1000);
      const results = await Promise.all([
        rpc(tenantA.client, { p_invoice_id: invoiceId, p_amount: 600 }),
        rpc(receptionist.client, { p_invoice_id: invoiceId, p_amount: 600 }),
      ]);
      const ok = results.filter((r) => r.error === null);
      const refused = results.filter((r) => r.error !== null);
      expect(ok).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(mapDbError(refused[0].error)).toMatchObject({ code: "CONFLICT", reason: "OVERPAYMENT" });
      const rows = await paymentsOf(invoiceId);
      expect(rows).toHaveLength(1);
      expect(rows[0].amount).toBe(600);
      expect(await auditByInvoice(invoiceId)).toHaveLength(1);
      expect(await invoiceStatus(invoiceId)).toBe("issued");
    }
  });

  it("concurrent full-balance race: one payment, the invoice paid once", async () => {
    const invoiceId = await seedInvoice(tenantA, 700);
    const results = await Promise.all([
      rpc(tenantA.client, { p_invoice_id: invoiceId, p_amount: 700 }),
      rpc(tenantA.client, { p_invoice_id: invoiceId, p_amount: 700 }),
    ]);
    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    const refused = results.find((r) => r.error !== null);
    expect(mapDbError(refused?.error).code).toBe("CONFLICT");
    expect(await paymentsOf(invoiceId)).toHaveLength(1);
    expect(await invoiceStatus(invoiceId)).toBe("paid");
  });

  it("a held invoice lock makes the call fail fast with CONFLICT/LOCK_TIMEOUT (lock_timeout 2s), not hang", async () => {
    const invoiceId = await seedInvoice(tenantA, 300);
    const marker = `rp_lock_${randomUUID().replace(/-/g, "")}`;
    const holder = psqlAsync(
      `begin; select 1 from public.invoices where id = '${invoiceId}' for update; select pg_sleep(5) /* ${marker} */; commit;`
    );
    // Wait until the holder is asleep with the row lock taken.
    for (let i = 0; i < 100; i++) {
      const active = psql(`select count(*) from pg_stat_activity where query like '%pg_sleep(5) /* ${marker} */%' and state = 'active' and pid <> pg_backend_pid()`);
      if (active[0] === "1") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const started = Date.now();
    const { error } = await rpc(tenantA.client, { p_invoice_id: invoiceId, p_amount: 300 });
    const elapsed = Date.now() - started;
    expect(error?.code).toBe("55P03");
    expect(mapDbError(error)).toMatchObject({ code: "CONFLICT", reason: "LOCK_TIMEOUT" });
    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(elapsed).toBeLessThan(4500);
    await holder;
    expect(await paymentsOf(invoiceId)).toEqual([]);
  });
});

describe("record_payment: idempotent replay by command id", () => {
  it("the same command twice returns the same payment, replayed, and writes one payment, one audit and one outbox row", async () => {
    const invoiceId = await seedInvoice(tenantA, 800);
    const commandId = randomUUID();
    const first = await rpc(tenantA.client, { p_invoice_id: invoiceId, p_amount: 300, p_command_id: commandId });
    const second = await rpc(tenantA.client, { p_invoice_id: invoiceId, p_amount: 300, p_command_id: commandId });
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const a = first.data as { payment_id: string; replayed: boolean };
    const b = second.data as { payment_id: string; replayed: boolean; paid_total: number };
    expect(a.replayed).toBe(false);
    expect(b).toMatchObject({ payment_id: a.payment_id, replayed: true, paid_total: 300 });
    expect(await paymentsOf(invoiceId)).toHaveLength(1);
    expect(await auditOf([a.payment_id])).toHaveLength(1);
    expect(await outboxOf(a.payment_id)).toHaveLength(1);
  });

  it("two concurrent submits of one command record one payment; one of them is the replay", async () => {
    const invoiceId = await seedInvoice(tenantA, 800);
    const commandId = randomUUID();
    const results = await Promise.all([
      rpc(tenantA.client, { p_invoice_id: invoiceId, p_amount: 800, p_command_id: commandId }),
      rpc(tenantA.client, { p_invoice_id: invoiceId, p_amount: 800, p_command_id: commandId }),
    ]);
    expect(results.map((r) => r.error)).toEqual([null, null]);
    const values = results.map((r) => r.data as { payment_id: string; replayed: boolean });
    expect(values[0].payment_id).toBe(values[1].payment_id);
    expect(values.map((v) => v.replayed).sort()).toEqual([false, true]);
    expect(await paymentsOf(invoiceId)).toHaveLength(1);
  });

  it("reusing a command id with a different amount is IDEMPOTENCY_MISMATCH", async () => {
    const invoiceId = await seedInvoice(tenantA, 800);
    const commandId = randomUUID();
    expect((await rpc(tenantA.client, { p_invoice_id: invoiceId, p_amount: 100, p_command_id: commandId })).error).toBeNull();
    const { error } = await rpc(tenantA.client, { p_invoice_id: invoiceId, p_amount: 200, p_command_id: commandId });
    expect(mapDbError(error)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH", reason: "IDEMPOTENCY_MISMATCH" });
    expect(await paymentsOf(invoiceId)).toHaveLength(1);
  });

  it("the service passes the client's commandId: a resubmitted payment replays instead of paying twice", async () => {
    const invoiceId = await seedInvoice(tenantA, 500);
    const input = { invoice_id: invoiceId, amount: 200, payment_method: "cash" as const, commandId: randomUUID() };
    const first = await recordPayment(ctxFor(tenantA), input);
    const second = await recordPayment(ctxFor(tenantA), input);
    expect(first).toMatchObject({ success: true, replayed: false, totalPaid: 200, balanceDue: 300, status: "issued" });
    expect(second).toMatchObject({ success: true, replayed: true, totalPaid: 200 });
    expect(await paymentsOf(invoiceId)).toHaveLength(1);
  });
});

describe("record_payment: actor rule and the system path (TARGET §7.1)", () => {
  it("system path via getSystemDb: recorded_by_system set, audit actor_type system, outbox row written", async () => {
    const invoiceId = await seedInvoice(tenantA, 450);
    const result = await recordPaymentAsSystem(
      tenantA.tenantId,
      { invoice_id: invoiceId, amount: 450, payment_method: "upi", commandId: randomUUID() },
      "system:payment_webhook"
    );
    expect(result).toMatchObject({ success: true, status: "paid", totalPaid: 450, balanceDue: 0, replayed: false });
    if (!result.success) return;

    expect(await paymentsOf(invoiceId)).toMatchObject([
      { id: result.paymentId, recorded_by: null, recorded_by_system: "system:payment_webhook", tenant_id: tenantA.tenantId },
    ]);
    expect(await auditOf([result.paymentId])).toEqual([
      {
        tenant_id: tenantA.tenantId,
        actor_id: null,
        actor_role: "system",
        actor_type: "system",
        action: "invoice.payment_recorded",
        entity_type: "payment",
        entity_id: result.paymentId,
        metadata: { invoice_id: invoiceId, payment_method: "upi", old_status: "issued", new_status: "paid", system_actor: "system:payment_webhook" },
      },
    ]);
    expect(await outboxOf(result.paymentId)).toHaveLength(1);
  });

  it("the system path is bound to the tenant it names: another tenant's invoice is NOT_FOUND", async () => {
    const invoiceId = await seedInvoice(tenantA, 450);
    const result = await recordPaymentAsSystem(
      tenantB.tenantId,
      { invoice_id: invoiceId, amount: 450, payment_method: "upi", commandId: randomUUID() },
      "system:payment_webhook"
    );
    expect(result).toEqual({ success: false, error: RECORD_PAYMENT_MESSAGES.NOT_FOUND });
    expect(await paymentsOf(invoiceId)).toEqual([]);
  });

  it("a user session passing p_system_actor is ACTOR_INVALID", async () => {
    const invoiceId = await seedInvoice(tenantA, 100);
    const { error } = await rpc(tenantA.client, { p_invoice_id: invoiceId, p_amount: 100, p_system_actor: "system:payment_webhook" });
    expect(mapDbError(error)).toMatchObject({ code: "FORBIDDEN", reason: "ACTOR_INVALID" });
    expect(await paymentsOf(invoiceId)).toEqual([]);
  });

  it("the service role without a system actor, or with one outside the closed set, is ACTOR_INVALID", async () => {
    const invoiceId = await seedInvoice(tenantA, 100);
    for (const actor of [undefined, "system:other", "owner"]) {
      const { error } = await rpc(admin, { p_invoice_id: invoiceId, p_amount: 100, p_system_actor: actor });
      expect(mapDbError(error)).toMatchObject({ code: "FORBIDDEN", reason: "ACTOR_INVALID" });
    }
    expect(await paymentsOf(invoiceId)).toEqual([]);
  });
});

describe("record_payment: privileges", () => {
  it("anon cannot execute record_payment (EXECUTE revoked)", async () => {
    const invoiceId = await seedInvoice(tenantA, 100);
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as TestDb;
    const { data, error } = await rpc(anon, { p_invoice_id: invoiceId, p_amount: 100 });
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect(await paymentsOf(invoiceId)).toEqual([]);
  });

  it("catalog: INVOKER, empty search_path, lock_timeout; EXECUTE for authenticated and service_role only; the definer helper is not anon-executable", () => {
    const [prosecdef, config] = psql(
      `select prosecdef, array_to_string(proconfig, ',') from pg_proc where oid = '${RPC_SIGNATURE}'::regprocedure`
    )[0].split("|");
    expect(prosecdef).toBe("f");
    expect(config.split(",").sort()).toEqual(['lock_timeout=2s', 'search_path=""']);

    const privileges = (fn: string) =>
      psql(
        `select r, has_function_privilege(r, '${fn}', 'EXECUTE') from unnest(array['anon','authenticated','service_role']) r order by r`
      );
    expect(privileges(RPC_SIGNATURE)).toEqual(["anon|f", "authenticated|t", "service_role|t"]);
    expect(privileges(HELPER_SIGNATURE)).toEqual(["anon|f", "authenticated|t", "service_role|t"]);
    expect(psql(`select prosecdef from pg_proc where oid = '${HELPER_SIGNATURE}'::regprocedure`)).toEqual(["t"]);
    expect(psql("select has_schema_privilege('anon', 'private', 'USAGE')")).toEqual(["f"]);
  });

  it("the outbox writer is not served by PostgREST", async () => {
    const { error } = await tenantA.client.rpc("outbox_payment_recorded" as never, { p_payment_id: randomUUID() } as never);
    expect(error?.code).toBe("PGRST202");
  });

  it("the outbox writer refuses a payment the current transaction did not insert (no forged or replayed events)", async () => {
    const invoiceId = await seedInvoice(tenantA, 100);
    const { data } = await rpc(tenantA.client, { p_invoice_id: invoiceId, p_amount: 100 });
    const paymentId = (data as { payment_id: string }).payment_id;
    const claims = JSON.stringify({ sub: tenantA.userId, role: "authenticated" });
    expect(() =>
      psql(
        `begin; set local role authenticated; select set_config('request.jwt.claims', '${claims}', true); ` +
          `select private.outbox_payment_recorded('${paymentId}'); rollback;`
      )
    ).toThrow(/OUTBOX_SUBJECT_INVALID/);
    expect(await outboxOf(paymentId)).toHaveLength(1);
  });

  it("a request-path client cannot write recorded_by_system (column privilege), so it cannot forge a system payment", async () => {
    const invoiceId = await seedInvoice(tenantA, 100);
    const { error } = await tenantA.client.from("payments").insert({
      tenant_id: tenantA.tenantId,
      invoice_id: invoiceId,
      amount: 1,
      payment_method: "cash",
      recorded_by_system: "system:payment_webhook",
    });
    expect(error?.code).toBe("42501");
    expect(await paymentsOf(invoiceId)).toEqual([]);
  });
});

afterAll(() => {
  // Run data (tenants, users, rows) is removed by the global teardown; the fault trigger is dropped in its finally.
  expect(psql("select count(*) from pg_trigger where tgname like 'rp_spike_fault_%'")).toEqual(["0"]);
});
