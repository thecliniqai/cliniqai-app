/**
 * V2-03 03-13c (03-13-REVIEW-TRIAGE.md H-PAY, M-AUDITSYS, Low "outbox inside a savepoint"; migration 000029). Each
 * case is the reviewer's exploit replayed against the live local stack through the same path an attacker has: the
 * user's own supabase-js client (PostgREST with the user's JWT) or, for the savepoint case, a psql session acting as
 * `authenticated` with that user's claims. Synthetic data only.
 *
 * - H-PAY: a direct `payments` INSERT cannot name another actor in `recorded_by` (forced to auth.uid()) and cannot
 *   carry a command id (only record_payment writes one); record_payment never replays another actor's row as its own.
 * - M-AUDITSYS: a direct `audit_logs` INSERT cannot claim the system, another user, an API key or another role. Since
 *   V2-05 05-02c (R-20) the direct INSERT is refused outright (privilege revoked) and a user's row goes through
 *   `log_audit`, which takes the actor from the session; the 000029 guard stays behind the revoke (audit_v2.test.sql).
 * - Low: record_payment works inside a savepoint (the outbox check no longer compares xmin with the top-level xid).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { insertReturningId, type TestDb } from "../helpers/db";
import { psqlSession } from "../helpers/sql";

let admin: TestDb;
let owner: SeededTenant;
let nurse: SeededTenant;
// PO-3 (V2-05 05-02b): only billing:collect holders write payments; the H-PAY and savepoint cases run as the front desk
// (they were the nurse's while every member could collect). The audit cases below keep the nurse.
let collector: SeededTenant;
let other: SeededTenant; // a member of another clinic only (the reviewer's u2)

async function seedInvoice(t: SeededTenant, total: number): Promise<string> {
  const patientId = await insertReturningId(admin, "patients", {
    tenant_id: t.tenantId,
    full_name: "Synthetic Guardpayer",
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
    invoice_number: `GP-${randomUUID()}`,
    subtotal: total,
    total_amount: total,
    status: "issued",
  });
}

async function paymentsOf(invoiceId: string) {
  const { data, error } = await admin
    .from("payments")
    .select("id, amount, recorded_by, recorded_by_system, command_id")
    .eq("invoice_id", invoiceId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

beforeAll(async () => {
  admin = getAdminClient();
  owner = await seedTenantWithOwner("Guard Clinic A");
  nurse = await addMemberToTenant(owner.tenantId, "nurse");
  collector = await addMemberToTenant(owner.tenantId, "receptionist");
  other = await seedTenantWithOwner("Guard Clinic C");
  await insertReturningId(admin, "webhook_subscriptions", {
    tenant_id: owner.tenantId,
    endpoint_url: `https://hooks.example.test/${randomUUID()}`,
    event_types: ["payment.recorded"],
    signing_secret: randomUUID(),
    is_active: true,
    created_by: owner.userId,
  });
});

describe("H-PAY: direct payments INSERT through PostgREST", () => {
  it("a receptionist naming another user in recorded_by is stored as the receptionist (actor forced to auth.uid())", async () => {
    const invoiceId = await seedInvoice(owner, 100);
    const { error } = await collector.client.from("payments").insert({
      tenant_id: owner.tenantId,
      invoice_id: invoiceId,
      amount: 1,
      payment_method: "cash",
      recorded_by: other.userId,
    });
    expect(error).toBeNull();
    const rows = await paymentsOf(invoiceId);
    expect(rows.map((r) => [r.recorded_by, r.recorded_by_system])).toEqual([[collector.userId, null]]);
  });

  it("the reviewer's forged command: a direct insert carrying a command id is refused, and the RPC then does not replay it", async () => {
    const invoiceId = await seedInvoice(owner, 100);
    const commandId = randomUUID();
    const { error } = await collector.client.from("payments").insert({
      tenant_id: owner.tenantId,
      invoice_id: invoiceId,
      amount: 99999,
      payment_method: "cash",
      recorded_by: other.userId,
      command_id: commandId,
    });
    expect(error?.code).toBe("42501");
    expect(error?.message).toBe("COMMAND_ID_RPC_ONLY");
    expect(await paymentsOf(invoiceId)).toEqual([]);

    const replay = await collector.client.rpc("record_payment", {
      p_tenant_id: owner.tenantId,
      p_invoice_id: invoiceId,
      p_amount: 99999,
      p_method: "cash",
      p_reference: "",
      p_command_id: commandId,
    });
    expect(replay.data).toBeNull();
    expect(replay.error?.message).toBe("OVERPAYMENT");
    expect(await paymentsOf(invoiceId)).toEqual([]);
  });

  it("record_payment does not replay another actor's row with the same command id (IDEMPOTENCY_MISMATCH)", async () => {
    // A row already holding the command id with another actor (a pre-000029 forgery, or a collision).
    const invoiceId = await seedInvoice(owner, 100);
    const commandId = randomUUID();
    await insertReturningId(admin, "payments", {
      tenant_id: owner.tenantId,
      invoice_id: invoiceId,
      amount: 40,
      payment_method: "cash",
      recorded_by: owner.userId,
      command_id: commandId,
    });
    const { data, error } = await collector.client.rpc("record_payment", {
      p_tenant_id: owner.tenantId,
      p_invoice_id: invoiceId,
      p_amount: 40,
      p_method: "cash",
      p_reference: "",
      p_command_id: commandId,
    });
    expect(data).toBeNull();
    expect(error?.message).toBe("IDEMPOTENCY_MISMATCH");

    // The owner (the row's actor) still gets the replay.
    const own = await owner.client.rpc("record_payment", {
      p_tenant_id: owner.tenantId,
      p_invoice_id: invoiceId,
      p_amount: 40,
      p_method: "cash",
      p_reference: "",
      p_command_id: commandId,
    });
    expect(own.error).toBeNull();
    expect((own.data as { replayed: boolean }).replayed).toBe(true);
  });

  it("the RPC's own command still records and replays for its actor", async () => {
    const invoiceId = await seedInvoice(owner, 100);
    const args = {
      p_tenant_id: owner.tenantId,
      p_invoice_id: invoiceId,
      p_amount: 30,
      p_method: "upi",
      p_reference: "",
      p_command_id: randomUUID(),
    };
    const first = await collector.client.rpc("record_payment", args);
    expect(first.error).toBeNull();
    const second = await collector.client.rpc("record_payment", args);
    expect(second.error).toBeNull();
    expect((second.data as { replayed: boolean; payment_id: string }).replayed).toBe(true);
    expect((second.data as { payment_id: string }).payment_id).toBe((first.data as { payment_id: string }).payment_id);
    const rows = await paymentsOf(invoiceId);
    expect(rows.map((r) => [r.recorded_by, r.command_id])).toEqual([[collector.userId, args.p_command_id]]);
  });
});

describe("Low: record_payment inside a savepoint (outbox subject check)", () => {
  it("succeeds inside SAVEPOINT and writes its outbox row; the marker does not outlive the call", async () => {
    const invoiceId = await seedInvoice(owner, 100);
    const claims = JSON.stringify({ sub: collector.userId, role: "authenticated" });
    const out = psqlSession([
      "begin",
      "set local role authenticated",
      `select set_config('request.jwt.claims', '${claims}', true) is not null`,
      "savepoint s1",
      `select (public.record_payment('${owner.tenantId}', '${invoiceId}', 100, 'cash', null, '${randomUUID()}') ->> 'invoice_status')`,
      "release savepoint s1",
      "select coalesce(current_setting('clinicos.record_payment_id', true), '') = ''",
      "reset role",
      `select count(*) from public.webhook_delivery_queue q join public.payments p on q.payload like '%' || p.id::text || '%' where p.invoice_id = '${invoiceId}'`,
      "rollback",
    ]);
    expect(out).toEqual(["t", "paid", "t", "1"]);
  });

  it("succeeds inside a plpgsql exception block", () => {
    const claims = JSON.stringify({ sub: collector.userId, role: "authenticated" });
    return seedInvoice(owner, 50).then((invoiceId) => {
      const out = psqlSession([
        "begin",
        "set local role authenticated",
        `select set_config('request.jwt.claims', '${claims}', true) is not null`,
        `do $$ begin perform public.record_payment('${owner.tenantId}', '${invoiceId}', 50, 'cash', null, '${randomUUID()}');
           exception when others then raise exception 'wrapped: %', sqlerrm; end $$`,
        "reset role",
        `select status from public.invoices where id = '${invoiceId}'`,
        "rollback",
      ]);
      expect(out).toEqual(["t", "paid"]);
    });
  });
});

describe("M-AUDITSYS: audit_logs writes through PostgREST", () => {
  async function auditRow(entityId: string) {
    const { data, error } = await admin
      .from("audit_logs")
      .select("actor_id, actor_role, actor_type, api_key_id, metadata")
      .eq("entity_id", entityId);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  it("a nurse claiming the system (the reviewer's row) is refused; through log_audit it is the nurse, without system_actor", async () => {
    const entityId = randomUUID();
    const { error } = await nurse.client.from("audit_logs").insert({
      tenant_id: owner.tenantId,
      actor_id: null,
      actor_role: "system",
      actor_type: "system",
      action: "invoice.payment_recorded",
      entity_type: "payment",
      entity_id: entityId,
      metadata: { system_actor: "system:payment_webhook", invoice_id: entityId },
    });
    expect(error?.code).toBe("42501");
    expect(await auditRow(entityId)).toEqual([]);
    const { error: rpcError } = await nurse.client.rpc("log_audit", {
      p_tenant: owner.tenantId,
      p_action: "invoice.payment_recorded",
      p_entity_type: "payment",
      p_entity_id: entityId,
      p_metadata: { system_actor: "system:payment_webhook", invoice_id: entityId },
    });
    expect(rpcError).toBeNull();
    expect(await auditRow(entityId)).toEqual([
      { actor_id: nurse.userId, actor_role: "nurse", actor_type: "user", api_key_id: null, metadata: { invoice_id: entityId } },
    ]);
  });

  it("a nurse naming another user, an API key and the owner role is refused, and no row is written", async () => {
    const entityId = randomUUID();
    const apiKeyId = await insertReturningId(admin, "api_keys", {
      tenant_id: owner.tenantId,
      name: "Guard spec key",
      key_prefix: "clq_live_guard00",
      key_hash: randomUUID().replace(/-/g, "").repeat(2),
      created_by: owner.userId,
    });
    const { error } = await nurse.client.from("audit_logs").insert({
      tenant_id: owner.tenantId,
      actor_id: owner.userId,
      actor_role: "owner",
      actor_type: "api_key",
      api_key_id: apiKeyId,
      action: "patient.updated",
      entity_type: "patient",
      entity_id: entityId,
    });
    expect(error?.code).toBe("42501");
    expect(await auditRow(entityId)).toEqual([]);
    // log_audit has no actor, role, type or key argument at all: the same write is the nurse's.
    const { error: rpcError } = await nurse.client.rpc("log_audit", {
      p_tenant: owner.tenantId,
      p_action: "patient.updated",
      p_entity_type: "patient",
      p_entity_id: entityId,
      p_metadata: null as unknown as Record<string, never>,
    });
    expect(rpcError).toBeNull();
    expect(await auditRow(entityId)).toEqual([
      { actor_id: nurse.userId, actor_role: "nurse", actor_type: "user", api_key_id: null, metadata: null },
    ]);
  });

  it("the service role (system path, /api/v1) keeps its actor_type and api key", async () => {
    const entityId = randomUUID();
    const apiKeyId = await insertReturningId(admin, "api_keys", {
      tenant_id: owner.tenantId,
      name: "Guard spec key 2",
      key_prefix: "clq_live_guard01",
      key_hash: randomUUID().replace(/-/g, "").repeat(2),
      created_by: owner.userId,
    });
    const { error } = await admin.from("audit_logs").insert({
      tenant_id: owner.tenantId,
      actor_id: owner.userId,
      actor_role: "admin",
      actor_type: "api_key",
      api_key_id: apiKeyId,
      action: "patient.updated",
      entity_type: "patient",
      entity_id: entityId,
    });
    expect(error).toBeNull();
    expect(await auditRow(entityId)).toEqual([
      { actor_id: owner.userId, actor_role: "admin", actor_type: "api_key", api_key_id: apiKeyId, metadata: null },
    ]);
  });
});
