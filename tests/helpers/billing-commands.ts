/**
 * Shared seeds and read-backs for the V2-07 07-02 billing command specs (create_invoice, collect_payment). Synthetic
 * data only; rows are seeded and read with the service-role client, commands are called with the caller's own client.
 */
import { randomUUID } from "node:crypto";
import { insertReturningId, type TestDb } from "./db";
import { getAdminClient } from "./supabase-admin";
import type { SeededTenant } from "./tenants";
import { psql } from "./sql";
import type { Database } from "@/types/database";

type Fns = Database["public"]["Functions"];
export type CreateInvoiceArgs = Fns["create_invoice"]["Args"];
export type CollectPaymentArgs = Fns["collect_payment"]["Args"];

export const ITEMS_700 = [
  { item_type: "consultation", description: "OPD Consultation Fee", unit_price: 500, quantity: 1 },
  { item_type: "procedure", description: "Wound Dressing", unit_price: 200, quantity: 1 },
];

export interface SeededVisit {
  visitId: string;
  patientId: string;
}

/** A fresh synthetic patient and visit in `t`'s clinic; `doctorId` defaults to the clinic owner. */
export async function seedVisit(t: Pick<SeededTenant, "tenantId" | "userId">, doctorId?: string): Promise<SeededVisit> {
  const admin = getAdminClient();
  const patientId = await insertReturningId(admin, "patients", {
    tenant_id: t.tenantId,
    full_name: "Synthetic Billing Patient",
    phone: "+910000000000",
    created_by: t.userId,
  });
  const visitId = await insertReturningId(admin, "visits", {
    tenant_id: t.tenantId,
    patient_id: patientId,
    doctor_id: doctorId ?? t.userId,
    origin_type: "walk_in",
    created_by: t.userId,
  });
  return { visitId, patientId };
}

export async function invoicesOfVisit(visitId: string) {
  const { data, error } = await getAdminClient()
    .from("invoices")
    .select("id, invoice_number, status, subtotal, discount, tax, total_amount, patient_id, location_id, tenant_id")
    .eq("visit_id", visitId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function itemsOfInvoice(invoiceId: string) {
  const { data, error } = await getAdminClient()
    .from("invoice_items")
    .select("item_type, description, unit_price, quantity, total_price")
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: true })
    .order("description", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function paymentsOfInvoice(invoiceId: string) {
  const { data, error } = await getAdminClient()
    .from("payments")
    .select("id, amount, payment_method, recorded_by, command_id")
    .eq("invoice_id", invoiceId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Audit rows of one action in one clinic (optionally for one entity). */
export async function auditRows(tenantId: string, action: string, entityId?: string) {
  let q = getAdminClient().from("audit_logs").select("actor_id, actor_role, actor_type, entity_type, entity_id, metadata").eq("tenant_id", tenantId).eq("action", action);
  if (entityId) q = q.eq("entity_id", entityId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Rows of `private.command_results` for one client request id (superuser read). */
export function commandResultRows(tenantId: string, clientRequestId: string): string[] {
  return psql(
    `select command || '|' || (result is not null)::text from private.command_results ` +
      `where tenant_id = '${tenantId}' and client_request_id = '${clientRequestId}'`
  );
}

/**
 * F-5 (V2-07 07-04a): the stored result of a command holds ids, numbers, amounts, statuses and flags only, never free text
 * (an amendment reason, notes, a reference, a name could carry PHI and the table is kept for the retention window). It also checks
 * that the request hash is a keyed 64-hex digest (G-8).
 * Reads the stored `command_results.result` (superuser) and fails when a string value is anything but a token: a uuid, a
 * timestamp, a number such as an invoice number, or a status word, i.e. no whitespace and at most 64 characters. Returns the
 * parsed result so a spec can go on to compare it.
 */
export function expectDataOnlyStoredResult(tenantId: string, clientRequestId: string): Record<string, unknown> {
  const [line] = psql(
    `select request_hash || '|' || result::text from private.command_results where tenant_id = '${tenantId}' and client_request_id = '${clientRequestId}'`
  );
  if (!line) throw new Error(`no stored result for ${clientRequestId}`);
  const [hash, raw] = [line.slice(0, line.indexOf("|")), line.slice(line.indexOf("|") + 1)];
  // G-8 (000099): the request hash is a keyed HMAC-SHA256 digest (64 hex characters), not an md5 of the payload.
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`request hash of ${clientRequestId} is not a 64-hex keyed digest`);
  const result = JSON.parse(raw) as Record<string, unknown>;
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "string") {
      if (!/^[A-Za-z0-9_.:+\-]{1,64}$/.test(value)) throw new Error(`stored result key ${key} holds free text (${value.length} characters)`);
    } else if (value !== null && typeof value !== "number" && typeof value !== "boolean") {
      throw new Error(`stored result key ${key} holds a ${typeof value}, not a scalar`);
    }
  }
  return result;
}

/** `payment.recorded` outbox rows whose payload names the payment. */
export async function outboxOfPayment(paymentId: string) {
  const { data, error } = await getAdminClient()
    .from("webhook_delivery_queue")
    .select("id, tenant_id, subscription_id, event_key")
    .eq("event_type", "payment.recorded")
    .like("payload", `%${paymentId}%`);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function subscribePaymentEvents(t: Pick<SeededTenant, "tenantId" | "userId">): Promise<string> {
  return insertReturningId(getAdminClient(), "webhook_subscriptions", {
    tenant_id: t.tenantId,
    endpoint_url: `https://hooks.example.test/${randomUUID()}`,
    event_types: ["payment.recorded"],
    signing_secret: randomUUID(),
    is_active: true,
    created_by: t.userId,
  });
}

export function createInvoiceArgs(t: Pick<SeededTenant, "tenantId">, visitId: string, over: Partial<CreateInvoiceArgs> = {}): CreateInvoiceArgs {
  return {
    p_tenant_id: t.tenantId,
    p_visit_id: visitId,
    p_items: ITEMS_700,
    p_discount: 50,
    p_client_request_id: randomUUID(),
    ...over,
  };
}

export function collectPaymentArgs(t: Pick<SeededTenant, "tenantId">, visitId: string, over: Partial<CollectPaymentArgs> = {}): CollectPaymentArgs {
  return {
    p_tenant_id: t.tenantId,
    p_visit_id: visitId,
    p_items: ITEMS_700,
    p_discount: 50,
    p_amount: 650,
    p_method: "cash",
    p_reference: "",
    p_notes: "",
    p_client_request_id: randomUUID(),
    ...over,
  };
}

export function callCreateInvoice(db: TestDb, args: CreateInvoiceArgs) {
  return db.rpc("create_invoice", args);
}

export function callCollectPayment(db: TestDb, args: CollectPaymentArgs) {
  return db.rpc("collect_payment", args);
}
