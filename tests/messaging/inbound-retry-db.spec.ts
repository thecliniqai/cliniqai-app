/**
 * V2-04 04-07a, triage M-INBOUND (review B M-3, IND L3/L4) and the inbound Lows (review B L-2, L-6; IND L2): a transient
 * failure inside the MSG91 webhook is retried by the provider instead of being recorded as handled, the retry finishes
 * the work exactly once, and delivery reports are never lost. On the live local stack through the real route; faults
 * are injected into the route's own system client (one failing RPC or UPDATE), never into the database.
 *
 * Each case fails on the 04-03c route: a failed cancel answered 200 `ignored` (slot never released), a failed reply
 * enqueue was swallowed (200, reply lost), notes were written again on a reprocess, a reply could act on the visit named
 * in the queue row's metadata, the failure note printed the provider's free text, and a delivery report that beat the
 * sender's finish write was recorded as handled and dropped.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as systemDb from "@/lib/supabase/system";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql } from "../helpers/sql";
import {
  auditCount,
  botReplies,
  buttonReply,
  deleteInboundEvents,
  deleteReplyJobs,
  inboundEvent,
  keyFor,
  postMsg91,
  replyJob,
  seedConversation,
  seedSentMessage,
  senderOf,
  useWebhookSecret,
  visitStatus,
  type Conversation,
} from "./inbound-helpers";

const OK = { status: 200, text: JSON.stringify({ ok: true }) };
const FAILED = { status: 500, text: JSON.stringify({ ok: false }) };
const keys: string[] = [];
const replyKeys: string[] = [];
const earlyIds: string[] = [];
function track<T>(body: T): T {
  keys.push(keyFor(body));
  return body;
}

beforeEach(() => {
  useWebhookSecret();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

afterAll(() => {
  deleteInboundEvents(keys);
  deleteReplyJobs(replyKeys);
  if (earlyIds.length) {
    psql(`delete from ops.early_delivery_reports where external_message_id in (${earlyIds.map((i) => `'${i}'`).join(", ")})`);
  }
});

const SYNTHETIC_FAILURE = { data: null, error: { code: "57014", message: "synthetic transient failure" } };

/**
 * The route's system client with one injected transient failure: the next call of RPC `rpcOnce`, or the next
 * `.update(…)` / `.insert(…)` on table `updateOnce` / `insertOnce`, answers a statement-timeout error. Everything else is
 * the real client.
 */
function faultOnce(fault: { rpcOnce?: string; updateOnce?: string; insertOnce?: string }) {
  const real = systemDb.getSystemDb("webhook.messaging_inbound");
  const pending = { ...fault };
  // A query builder whose every method returns itself and which resolves to the failure when awaited.
  const failingChain: unknown = new Proxy(function () {}, {
    get: (_t, prop) =>
      prop === "then"
        ? (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(SYNTHETIC_FAILURE).then(resolve, reject)
        : () => failingChain,
    apply: () => failingChain,
  });
  const faulty = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "rpc") {
        return (fn: string, args: unknown) => {
          if (pending.rpcOnce === fn) {
            pending.rpcOnce = undefined;
            return Promise.resolve(SYNTHETIC_FAILURE);
          }
          return (target.rpc as (f: string, a: unknown) => unknown).call(target, fn, args);
        };
      }
      if (prop === "from") {
        return (table: string) => {
          const builder = (target.from as (t: string) => object)(table);
          return new Proxy(builder, {
            get(b, method, r) {
              if (method === "update" && pending.updateOnce === table) {
                pending.updateOnce = undefined;
                return () => failingChain;
              }
              if (method === "insert" && pending.insertOnce === table) {
                pending.insertOnce = undefined;
                return () => failingChain;
              }
              const value = Reflect.get(b, method, r);
              return typeof value === "function" ? value.bind(b) : value;
            },
          });
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  vi.spyOn(systemDb, "getSystemDb").mockReturnValue(faulty);
}

function noteCount(c: Conversation, eventType: string): number {
  return Number(
    psql(
      `select count(*) from public.in_app_notifications where tenant_id = '${c.tenantId}' and event_type = '${eventType}'`
    )[0]
  );
}

describe("M-INBOUND: a transient failure answers 500 and the provider's retry completes the work once", () => {
  it("cancel: the visit UPDATE fails → 500, still booked, key failed; the retry cancels and acknowledges once", async () => {
    const c = await seedConversation("retry-cancel-update");
    const body = track(buttonReply(c, "btn_cancel"));
    faultOnce({ updateOnce: "visits" });

    // Before 04-07a: 200 `ignored`, the key finished, the slot never released and every retry read `duplicate`.
    expect(await postMsg91(body)).toEqual(FAILED);
    expect(await visitStatus(c.visitId)).toBe("booked");
    expect(inboundEvent("msg91", keyFor(body))).toMatchObject({ outcome: "failed", processed: false });

    expect(await postMsg91(body)).toEqual(OK);
    expect(await visitStatus(c.visitId)).toBe("cancelled");
    expect(await auditCount(c.visitId, "appointment_cancelled_whatsapp")).toBe(1);
    expect((await botReplies(c.visitId)).map((r) => r.templateId)).toEqual(["appointment_cancelled_ack"]);
    expect(inboundEvent("msg91", keyFor(body))).toMatchObject({ outcome: "processed", attempts: 2 });
  });

  it("cancel: the acknowledgement enqueue fails after the cancel → 500; the retry queues the acknowledgement once (no 'not found' reply, no second audit)", async () => {
    const c = await seedConversation("retry-cancel-ack");
    const body = track(buttonReply(c, "btn_cancel"));
    replyKeys.push(`bot:${keyFor(body)}:bot_not_found`);
    faultOnce({ rpcOnce: "enqueue_message_system" });

    // Before 04-07a: 200 with the acknowledgement silently lost.
    expect(await postMsg91(body)).toEqual(FAILED);
    expect(await visitStatus(c.visitId)).toBe("cancelled");
    expect(await botReplies(c.visitId)).toEqual([]);

    expect(await postMsg91(body)).toEqual(OK);
    expect((await botReplies(c.visitId)).map((r) => r.templateId)).toEqual(["appointment_cancelled_ack"]);
    expect(await auditCount(c.visitId, "appointment_cancelled_whatsapp")).toBe(1);
    expect(replyJob(`bot:${keyFor(body)}:bot_not_found`)).toBeNull();
    // A third delivery of the same callback is a duplicate.
    expect(await postMsg91(body)).toEqual(OK);
    expect(await botReplies(c.visitId)).toHaveLength(1);
  });

  it("a cancel for a visit that moved on is a business no-op: 200 `ignored`, no retry needed", async () => {
    const c = await seedConversation("retry-moved-on");
    psql(`update public.visits set status = 'in_consultation' where id = '${c.visitId}'`);
    const body = track(buttonReply(c, "btn_cancel"));
    expect(await postMsg91(body)).toEqual(OK);
    expect(await visitStatus(c.visitId)).toBe("in_consultation");
    expect(inboundEvent("msg91", keyFor(body))).toMatchObject({ outcome: "ignored", processed: true });
  });

  it("confirm: the acknowledgement enqueue fails → 500; the retry acknowledges once and confirms once", async () => {
    const c = await seedConversation("retry-confirm");
    const body = track(buttonReply(c, "btn_confirm"));
    faultOnce({ rpcOnce: "enqueue_message_system" });
    expect(await postMsg91(body)).toEqual(FAILED);
    expect(await visitStatus(c.visitId)).toBe("confirmed");
    expect(await postMsg91(body)).toEqual(OK);
    expect((await botReplies(c.visitId)).map((r) => r.templateId)).toEqual(["appointment_confirmed_ack"]);
    expect(await auditCount(c.visitId, "appointment_confirmed_whatsapp")).toBe(1);
  });

  it("triage: the reply enqueue fails after the front-desk note → 500; the retry writes no second note (review IND L4)", async () => {
    const c = await seedConversation("retry-triage");
    const body = track({ uuid: randomUUID(), customerNumber: senderOf(c.phone), replyMsgId: c.replyMsgId, text: "Is parking available?" });
    faultOnce({ rpcOnce: "enqueue_message_system" });
    expect(await postMsg91(body)).toEqual(FAILED);
    expect(noteCount(c, "inbound_whatsapp_reply")).toBe(1);
    expect(await postMsg91(body)).toEqual(OK);
    expect(noteCount(c, "inbound_whatsapp_reply")).toBe(1);
    expect((await botReplies(c.visitId)).map((r) => r.templateId)).toEqual(["conversational_triage"]);
  });

  it("reschedule: a failed note insert → 500; the retry writes one note and one link reply", async () => {
    const c = await seedConversation("retry-reschedule");
    const body = track(buttonReply(c, "btn_reschedule"));
    faultOnce({ insertOnce: "in_app_notifications" });
    expect(await postMsg91(body)).toEqual(FAILED);
    expect(noteCount(c, "reschedule_requested")).toBe(0);
    expect(await postMsg91(body)).toEqual(OK);
    expect(noteCount(c, "reschedule_requested")).toBe(1);
    expect((await botReplies(c.visitId)).map((r) => r.templateId)).toEqual(["appointment_reschedule_link"]);
  });

  it("unmatched sender: the reply enqueue fails → 500; the retry queues one reply job", async () => {
    const phone = `+9190000000${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;
    const body = track({ uuid: randomUUID(), customerNumber: senderOf(phone), text: "hello" });
    const replyKey = `bot:${keyFor(body)}:bot_not_found`;
    replyKeys.push(replyKey);
    faultOnce({ rpcOnce: "enqueue_unmatched_reply_system" });
    expect(await postMsg91(body)).toEqual(FAILED);
    expect(replyJob(replyKey)).toBeNull();
    expect(await postMsg91(body)).toEqual(OK);
    expect(replyJob(replyKey)).toMatchObject({ status: "pending" });
  });

  it("a permanent refusal of the reply (the stored recipient is no longer the patient's number) is handled, not retried", async () => {
    const c = await seedConversation("retry-permanent");
    psql(`update public.patients set phone = '+919000000099', guardian_phone = null where id = '${c.patientId}'`);
    const body = track(buttonReply(c, "btn_confirm"));
    expect(await postMsg91(body)).toEqual(OK);
    expect(await visitStatus(c.visitId)).toBe("confirmed");
    expect(await botReplies(c.visitId)).toEqual([]);
    expect(inboundEvent("msg91", keyFor(body))).toMatchObject({ outcome: "processed", processed: true });
  });
});

describe("review B L-2: a reply acts only on the queue row's own visit column, never on metadata", () => {
  it("a row without appointment_id whose metadata names another visit changes nothing there", async () => {
    const c = await seedConversation("l2-target");
    const victim = await seedConversation("l2-victim", c.owner);
    const replyMsgId = `wamid.l2-${randomUUID()}`;
    const { error } = await getAdminClient()
      .from("communication_queue")
      .insert({
        tenant_id: c.tenantId,
        patient_id: c.patientId,
        channel: "whatsapp",
        message_type: "lab_report_uploaded",
        template_id: "lab_report_uploaded",
        recipient_phone: c.phone,
        status: "sent",
        external_message_id: replyMsgId,
        metadata: { visit_id: victim.visitId, appointment_id: victim.visitId },
      });
    expect(error).toBeNull();
    const body = track({ ...buttonReply(c, "btn_cancel"), replyMsgId });
    replyKeys.push(`bot:${keyFor(body)}:bot_not_found`);
    expect(await postMsg91(body)).toEqual(OK);
    // Before 04-07a: the victim's visit (another patient's) was cancelled by this patient's button.
    expect(await visitStatus(victim.visitId)).toBe("booked");
    expect(await botReplies(victim.visitId)).toEqual([]);
    expect(replyJob(`bot:${keyFor(body)}:bot_not_found`)).toMatchObject({ status: "pending" });
  });
});

describe("delivery reports: an early report is kept; the failure note carries a code (IND L2, B L-6)", () => {
  const dlr = (requestId: string, status: string, extra: Record<string, unknown> = {}) =>
    track({ direction: "outbound", status, request_id: requestId, ...extra });

  it("a Delivered report that beats the sender's finish write is applied when the id is written (before: lost)", async () => {
    const c = await seedConversation("early-dlr");
    const requestId = `req-early-${randomUUID()}`;
    earlyIds.push(requestId);
    // The row is being sent: claimed (`processing`), its provider id not written yet.
    const [queueId] = psql(
      `insert into public.communication_queue (tenant_id, patient_id, appointment_id, channel, message_type, template_id, ` +
        `recipient_phone, status) values ('${c.tenantId}', '${c.patientId}', '${c.visitId}', 'whatsapp', 'appointment_reminder', ` +
        `'appointment_reminder', '${c.phone}', 'processing') returning id`
    );
    expect(await postMsg91(dlr(requestId, "Delivered", { delivered_at: "2026-11-14T05:00:00Z" }))).toEqual(OK);
    expect(await postMsg91(dlr(requestId, "Read"))).toEqual(OK);
    expect(psql(`select status from ops.early_delivery_reports where external_message_id = '${requestId}' order by 1`)).toEqual([
      "delivered",
      "read",
    ]);

    // The sender's finish write.
    const { data, error } = await getAdminClient().rpc("communication_queue_finish", {
      p_id: queueId,
      p_success: true,
      p_external_message_id: requestId,
      p_error: null as unknown as string,
    });
    expect(error).toBeNull();
    expect(data).toEqual([expect.objectContaining({ new_status: "sent" })]);
    expect(psql(`select status || '|' || (metadata ? 'delivered_at') || '|' || (metadata ? 'read_at') from public.communication_queue where id = '${queueId}'`)).toEqual([
      "read|true|true",
    ]);
    expect(await auditCount(queueId, "communication_dlr_delivered")).toBe(1);
    expect(await auditCount(queueId, "communication_dlr_read")).toBe(1);
    expect(psql(`select count(*) from ops.early_delivery_reports where external_message_id = '${requestId}'`)).toEqual(["0"]);
  });

  it("the urgent-failure note prints a reason code, never the provider's free text", async () => {
    const c = await seedConversation("dlr-note");
    const free = await seedSentMessage(c, "appointment_booked");
    const coded = await seedSentMessage(c, "appointment_rescheduled");
    expect(await postMsg91(dlr(free.requestId, "Failed", { reason: "Number 919812300045 blocked the business account" }))).toEqual(OK);
    expect(await postMsg91(dlr(coded.requestId, "Failed", { reason: "131026" }))).toEqual(OK);
    const notes = psql(
      `select message from public.in_app_notifications where tenant_id = '${c.tenantId}' and event_type = 'whatsapp_delivery_failed' order by created_at`
    );
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(/Reason: unreachable$/);
    expect(notes.join(" ")).not.toContain("blocked");
    expect(notes.join(" ")).not.toContain("919812300045");
    expect(notes[1]).toMatch(/Reason: 131026$/);
  });
});
