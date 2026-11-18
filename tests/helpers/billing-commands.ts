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
