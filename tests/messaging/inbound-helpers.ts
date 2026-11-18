/**
 * Shared helpers for the 04-03c inbound messaging webhook specs (V2-04; P0-12, R-25). Synthetic data only: every patient
 * number is in the synthetic range (`syntheticMobile`), the webhook secret is random per run, and the route is called
 * in-process (no socket). Nothing here sends: the route only queues; specs that run the reply handler pass a recording
 * provider.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { vi } from "vitest";
import { POST } from "@/app/api/webhooks/messaging/[provider]/route";
import { inboundDedupeKey, parseMsg91Payload } from "@/lib/messaging/webhook-helpers";
import { runJobs } from "@/lib/jobs/internal/runner";
import {
  createMessageReplyUnmatchedHandler,
  MESSAGE_REPLY_UNMATCHED_KIND,
} from "@/lib/jobs/internal/handlers/message-reply-unmatched";
import type { MessagingProvider } from "@/lib/messaging/types";
import type { RunJobsResult } from "@/lib/jobs/internal/types";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql } from "../helpers/sql";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { letters } from "../jobs/helpers";
import { syntheticMobile } from "../jobs/message-helpers";
import { seedSlotIso } from "../helpers/seed-slots";

export const WEBHOOK_SECRET = ["wh", randomBytes(16).toString("hex")].join("-");

/** Sets MSG91_WEBHOOK_SECRET for the route (undo with `vi.unstubAllEnvs()`). */
export function useWebhookSecret(): void {
  vi.stubEnv("MSG91_WEBHOOK_SECRET", WEBHOOK_SECRET);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function uuid(value: string): string {
  if (!UUID.test(value)) throw new Error("inbound-helpers: not a uuid");
  return value;
}
/** Single-quoted SQL literal of a key built by the spec (letters, digits, `:`, `.`, `_`, `-` only). */
function keyLiteral(key: string): string {
  if (!/^[A-Za-z0-9:._=+/-]{1,200}$/.test(key)) throw new Error("inbound-helpers: unexpected key shape");
  return `'${key}'`;
}

/** POSTs `body` (an object → JSON, or the exact raw text) to the MSG91 webhook with the secret header. */
export async function postMsg91(body: unknown): Promise<{ status: number; text: string }> {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const res = await POST(
    new NextRequest("http://localhost:3000/api/webhooks/messaging/msg91", {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": WEBHOOK_SECRET },
      body: raw,
    }),
    { params: Promise.resolve({ provider: "msg91" }) }
  );
  return { status: res.status, text: await res.text() };
}

/** The dedupe key the route derives for `body` (the same helper the route uses). */
export function keyFor(body: unknown): string {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const key = inboundDedupeKey(parseMsg91Payload(raw), raw);
  if (!key) throw new Error("inbound-helpers: no key for this body");
  return key;
}

export interface Conversation {
  owner: SeededTenant;
  tenantId: string;
  patientId: string;
  /** The patient's synthetic number in E.164. */
  phone: string;
  visitId: string;
  /** The provider id of the sent booking message the patient replies to. */
  replyMsgId: string;
  queueId: string;
}

/** A clinic with a booked visit and the sent WhatsApp booking message (`external_message_id = replyMsgId`). */
export async function seedConversation(label: string, owner?: SeededTenant): Promise<Conversation> {
  const admin = getAdminClient();
  const o = owner ?? (await seedTenantWithOwner(`Inbound ${label} ${letters(6)}`));
  const phone = syntheticMobile();
  const { data: patient, error: pErr } = await admin
    .from("patients")
    .insert({ tenant_id: o.tenantId, full_name: `Synthetic Patient ${letters(6)}`, phone, sex: "other", created_by: o.userId })
    .select("id")
    .single();
  if (pErr || !patient) throw new Error(`seed patient failed: ${pErr?.code}`);
  const { data: visit, error: vErr } = await admin
    .from("visits")
    .insert({
      tenant_id: o.tenantId,
      patient_id: patient.id,
      doctor_id: o.userId,
      origin_type: "scheduled",
      // A slot of its own (05-08: overlapping scheduled visits of one doctor are refused).
      scheduled_at: seedSlotIso(),
      status: "booked",
      created_by: o.userId,
    })
    .select("id")
    .single();
  if (vErr || !visit) throw new Error(`seed visit failed: ${vErr?.code}`);
  const replyMsgId = `wamid.${label}-${letters(10)}`;
  const { data: queue, error: qErr } = await admin
    .from("communication_queue")
    .insert({
      tenant_id: o.tenantId,
      patient_id: patient.id,
      appointment_id: visit.id,
      channel: "whatsapp",
      message_type: "appointment_booked",
      template_id: "appointment_booked",
      recipient_phone: phone,
      status: "sent",
      external_message_id: replyMsgId,
    })
    .select("id")
    .single();
  if (qErr || !queue) throw new Error(`seed queue failed: ${qErr?.code}`);
  return { owner: o, tenantId: o.tenantId, patientId: patient.id, phone, visitId: visit.id, replyMsgId, queueId: queue.id };
}

/** A sent message of the conversation's patient with its own provider id (for delivery-report specs). */
export async function seedSentMessage(c: Conversation, messageType = "appointment_reminder"): Promise<{ id: string; requestId: string }> {
  const requestId = `req-${letters(12)}`;
  const { data, error } = await getAdminClient()
    .from("communication_queue")
    .insert({
      tenant_id: c.tenantId,
      patient_id: c.patientId,
      appointment_id: c.visitId,
      channel: "whatsapp",
      message_type: messageType,
      template_id: messageType,
      recipient_phone: c.phone,
      status: "sent",
      external_message_id: requestId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seed sent message failed: ${error?.code}`);
  return { id: data.id, requestId };
}

/** The sender spelling MSG91 uses: international digits without `+`. */
export function senderOf(phone: string): string {
  return phone.replace("+", "");
}

export function button(id: string): string {
  return JSON.stringify({ button_reply: { id, title: id } });
}

/** A patient's button reply to the conversation's message; `uuid` (the inbound message id) is unique unless given. */
export function buttonReply(c: Conversation, action: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { uuid: randomUUID(), customerNumber: senderOf(c.phone), replyMsgId: c.replyMsgId, interactive: button(action), ...extra };
}

export async function visitStatus(visitId: string): Promise<string> {
  const { data, error } = await getAdminClient().from("visits").select("status").eq("id", visitId).single();
  if (error || !data) throw new Error(`visit read failed: ${error?.code}`);
  return data.status;
}

export interface ReplyRow {
  id: string;
  templateId: string;
  status: string;
  recipient: string | null;
  dedupeKey: string | null;
  params: Record<string, unknown>;
}

/** Queued bot replies (dedupe key `bot:…`) about the conversation's visit. */
export async function botReplies(visitId: string): Promise<ReplyRow[]> {
  const { data, error } = await getAdminClient()
    .from("communication_queue")
    .select("id, template_id, status, recipient_phone, dedupe_key, template_params")
    .eq("appointment_id", visitId)
    .like("dedupe_key", "bot:%")
    .order("created_at");
  if (error) throw new Error(`reply read failed: ${error.code}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    templateId: r.template_id,
    status: r.status,
    recipient: r.recipient_phone,
    dedupeKey: r.dedupe_key,
    params: (r.template_params ?? {}) as Record<string, unknown>,
  }));
}

/** `message.send` jobs of a queue row (`msg:<id>`). */
export function messageJobCount(queueId: string): number {
  return Number(psql(`select count(*) from ops.jobs where dedupe_key = 'msg:${uuid(queueId)}'`)[0]);
}

export async function auditCount(entityId: string, action: string): Promise<number> {
  const { count, error } = await getAdminClient()
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("entity_id", entityId)
    .eq("action", action);
  if (error) throw new Error(`audit read failed: ${error.code}`);
  return count ?? 0;
}

export interface InboundEvent {
  provider: string;
  outcome: string | null;
  processed: boolean;
  attempts: number;
  /** Every column of the row as text (to prove what is NOT stored). */
  raw: string;
}

export function inboundEvent(provider: "msg91" | "supabase_auth_hook", key: string): InboundEvent | null {
  const [line] = psql(
    `select provider || '|' || coalesce(outcome, '') || '|' || (processed_at is not null) || '|' || attempts || '|' || ` +
      `row_to_json(e)::text from ops.inbound_webhook_events e where provider = '${provider}' and dedupe_key = ${keyLiteral(key)}`
  );
  if (!line) return null;
  const [p, outcome, processed, attempts, ...rest] = line.split("|");
  return { provider: p, outcome: outcome || null, processed: processed === "true", attempts: Number(attempts), raw: rest.join("|") };
}

/** Seeds an inbound event row in a given state (a crashed or failed earlier attempt). */
export function seedInboundEvent(
  provider: "msg91" | "supabase_auth_hook",
  key: string,
  state: { ageMinutes: number; outcome: "failed" | null }
): void {
  psql(
    `insert into ops.inbound_webhook_events (provider, dedupe_key, received_at, outcome) values ('${provider}', ` +
      `${keyLiteral(key)}, now() - interval '${Math.trunc(state.ageMinutes)} minutes', ` +
      `${state.outcome ? `'${state.outcome}'` : "null"})`
  );
}

export function deleteInboundEvents(keys: string[]): void {
  if (keys.length === 0) return;
  psql(`delete from ops.inbound_webhook_events where dedupe_key in (${keys.map(keyLiteral).join(", ")})`);
}

export interface ReplyJob {
  id: string;
  status: string;
  attempts: number;
  lastError: string | null;
  payload: string;
}

/** The `message.reply_unmatched` job of a dedupe key. */
export function replyJob(dedupeKey: string): ReplyJob | null {
  const [line] = psql(
    `select id || '|' || status || '|' || attempts || '|' || coalesce(last_error, '') || '|' || payload::text ` +
      `from ops.jobs where kind = 'message.reply_unmatched' and dedupe_key = ${keyLiteral(dedupeKey)}`
  );
  if (!line) return null;
  const [id, status, attempts, lastError, ...payload] = line.split("|");
  return { id, status, attempts: Number(attempts), lastError: lastError || null, payload: payload.join("|") };
}

export function deleteReplyJobs(dedupeKeys: string[]): void {
  if (dedupeKeys.length === 0) return;
  psql(
    `delete from ops.jobs where kind = 'message.reply_unmatched' and dedupe_key in (${dedupeKeys.map(keyLiteral).join(", ")})`
  );
}

/** One runner pass over `message.reply_unmatched` with the real handler and the given provider. */
export function runUnmatchedReplies(provider: MessagingProvider, worker: string): Promise<RunJobsResult> {
  return runJobs({
    db: getAdminClient(),
    budgetMs: 20_000,
    batch: 25,
    leaseSeconds: 120,
    perTenant: 100,
    worker,
    source: "test",
    kinds: [MESSAGE_REPLY_UNMATCHED_KIND],
    handlers: { [MESSAGE_REPLY_UNMATCHED_KIND]: createMessageReplyUnmatchedHandler({ provider: () => provider }) as never },
  });
}
