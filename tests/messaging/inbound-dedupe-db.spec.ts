/**
 * V2-04 04-03c (P0-12 inbound idempotency, R-25; T-04-08, T-04-10): the MSG91 webhook processes each callback at most
 * once and never sends from the request. On the live local stack (migration 000037), through the real route.
 *
 * - Tracer: one "confirm" reply posted twice → the visit is confirmed once (one audit row), one queued
 *   `appointment_confirmed_ack` row with one `message.send` job; the second answer is 200 with no effect.
 * - The same reply posted 5 times at once → one effect, one reply.
 * - The same delivery report twice → one status change and one audit row (before 04-03c: two audit rows).
 * - Monotonic reports: `failed` after `delivered` stays `delivered`; `delivered` after `read` stays `read`.
 * - Crash recovery: an unfinished claim older than 5 minutes, or a `failed` one, is processed again (once).
 * - A failure inside the route (the delivery-report RPC errors) answers 500, marks the key failed, and MSG91's retry
 *   applies it once.
 * - An unmatched Indian sender → one `message.reply_unmatched` job (also when posted twice); a runner pass with a
 *   recording provider sends it once and the job's payload no longer holds the phone; a foreign sender gets nothing.
 * - The provider factory is never called by the request; the dedupe row holds provider, key, timestamps and outcome
 *   only (no phone, no body).
 * - The new RPCs are service-role only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as messaging from "@/lib/messaging";
import * as systemDb from "@/lib/supabase/system";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql } from "../helpers/sql";
import { addMemberToTenant, type SeededTenant } from "../helpers/tenants";
import { anonClient } from "../jobs/helpers";
import { onlyFor, recordingProvider } from "../jobs/message-helpers";
import {
  auditCount,
  botReplies,
  buttonReply,
  deleteInboundEvents,
  deleteReplyJobs,
  inboundEvent,
  keyFor,
  messageJobCount,
  postMsg91,
  replyJob,
  runUnmatchedReplies,
  seedConversation,
  seedInboundEvent,
  seedSentMessage,
  senderOf,
  useWebhookSecret,
  visitStatus,
  type Conversation,
} from "./inbound-helpers";

const OK = { status: 200, text: JSON.stringify({ ok: true }) };
const IN_FLIGHT = { status: 503, text: JSON.stringify({ ok: false }) };
const keys: string[] = [];
const replyKeys: string[] = [];
function track<T>(body: T): T {
  keys.push(keyFor(body));
  return body;
}

let factorySpy: { mock: { calls: unknown[] } };

beforeEach(() => {
  useWebhookSecret();
  factorySpy = vi.spyOn(messaging, "getMessagingProvider");
});

afterEach(() => {
  // No request in this file ever builds a provider (R-33: replies are queued; the runner sends).
  expect(factorySpy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

afterAll(() => {
  deleteInboundEvents(keys);
  deleteReplyJobs(replyKeys);
});

describe("inbound replies: exactly-once effect, at most one queued reply", () => {
  let c: Conversation;
  beforeEach(async () => {
    c = await seedConversation("dedupe");
  });

  it("tracer: a confirm posted twice confirms once and queues one acknowledgement with one job", async () => {
    const body = track(buttonReply(c, "btn_confirm"));
    expect(await postMsg91(body)).toEqual(OK);
    expect(await postMsg91(body)).toEqual(OK);

    expect(await visitStatus(c.visitId)).toBe("confirmed");
    expect(await auditCount(c.visitId, "appointment_confirmed_whatsapp")).toBe(1);
    const replies = await botReplies(c.visitId);
    expect(replies.map((r) => [r.templateId, r.status, r.recipient])).toEqual([["appointment_confirmed_ack", "pending", c.phone]]);
    expect(replies[0].dedupeKey).toBe(`bot:${keyFor(body)}:appointment_confirmed_ack`);
    expect(messageJobCount(replies[0].id)).toBe(1);

    const event = inboundEvent("msg91", keyFor(body));
    expect(event).toMatchObject({ outcome: "processed", processed: true, attempts: 1 });
    // Provider, key, timestamps and outcome only: no phone, no body.
    expect(event!.raw).not.toContain(senderOf(c.phone).slice(-10));
    expect(event!.raw).not.toContain("btn_confirm");
  });

  it("the same reply posted 5 times at once → one confirmation, one reply; 200 for the first, 200 or 503 for the rest", async () => {
    const body = track(buttonReply(c, "btn_confirm"));
    const answers = await Promise.all(Array.from({ length: 5 }, () => postMsg91(body)));
    // 04-07a M-INBOUND: a copy that arrives while the first is still processing answers 503 (the provider retries it
    // later and then reads `duplicate`); one that arrives after it finished answers 200.
    expect(answers.filter((a) => a.status === 200)).not.toHaveLength(0);
    for (const a of answers) expect([OK, IN_FLIGHT]).toContainEqual(a);
    expect(await visitStatus(c.visitId)).toBe("confirmed");
    expect(await auditCount(c.visitId, "appointment_confirmed_whatsapp")).toBe(1);
    expect((await botReplies(c.visitId)).map((r) => r.templateId)).toEqual(["appointment_confirmed_ack"]);
  });

  it("a body without a message id is keyed by its hash: a byte-identical retry is a duplicate", async () => {
    const body = { customerNumber: senderOf(c.phone), replyMsgId: c.replyMsgId, text: "Can I come an hour later?" };
    track(body);
    expect(keyFor(body)).toMatch(/^in:sha256:[0-9a-f]{64}$/);
    expect(await postMsg91(body)).toEqual(OK);
    expect(await postMsg91(body)).toEqual(OK);
    expect((await botReplies(c.visitId)).map((r) => r.templateId)).toEqual(["conversational_triage"]);
    const { count } = await getAdminClient()
      .from("in_app_notifications")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", c.tenantId)
      .eq("event_type", "inbound_whatsapp_reply");
    expect(count).toBe(1);
  });

  it("two distinct replies (different message ids) are two events: confirm, then cancel", async () => {
    expect(await postMsg91(track(buttonReply(c, "btn_confirm")))).toEqual(OK);
    expect(await postMsg91(track(buttonReply(c, "btn_cancel")))).toEqual(OK);
    expect(await visitStatus(c.visitId)).toBe("cancelled");
    expect((await botReplies(c.visitId)).map((r) => r.templateId).sort()).toEqual([
      "appointment_cancelled_ack",
      "appointment_confirmed_ack",
    ]);
  });

  it("an unfinished claim older than 5 minutes (a crashed instance) is processed again, once", async () => {
    const body = track(buttonReply(c, "btn_confirm"));
    seedInboundEvent("msg91", keyFor(body), { ageMinutes: 6, outcome: null });
    expect(await postMsg91(body)).toEqual(OK);
    expect(await postMsg91(body)).toEqual(OK);
    expect(await visitStatus(c.visitId)).toBe("confirmed");
    expect((await botReplies(c.visitId)).map((r) => r.templateId)).toEqual(["appointment_confirmed_ack"]);
    expect(inboundEvent("msg91", keyFor(body))).toMatchObject({ outcome: "processed", attempts: 2 });
  });

  it("a recent unfinished claim (another instance is on it) answers 503 Retry-After without any effect (04-07a M-INBOUND)", async () => {
    const body = track(buttonReply(c, "btn_confirm"));
    seedInboundEvent("msg91", keyFor(body), { ageMinutes: 1, outcome: null });
    // Before 04-07a: 200, so a provider that timed out the first delivery stopped retrying; if that first attempt then
    // failed, the callback was lost.
    expect(await postMsg91(body)).toEqual(IN_FLIGHT);
    expect(await visitStatus(c.visitId)).toBe("booked");
    expect(await botReplies(c.visitId)).toEqual([]);
  });

  it("a failed earlier attempt is processed by the retry", async () => {
    const body = track(buttonReply(c, "btn_confirm"));
    seedInboundEvent("msg91", keyFor(body), { ageMinutes: 0, outcome: "failed" });
    expect(await postMsg91(body)).toEqual(OK);
    expect(await visitStatus(c.visitId)).toBe("confirmed");
    expect(inboundEvent("msg91", keyFor(body))).toMatchObject({ outcome: "processed", processed: true, attempts: 2 });
  });
});

describe("delivery reports: one transition and one audit row per report, monotonic", () => {
  let c: Conversation;
  beforeAll(async () => {
    c = await seedConversation("dlr");
  });

  const dlr = (requestId: string, status: string, extra: Record<string, unknown> = {}) =>
    track({ direction: "outbound", status, request_id: requestId, ...extra });

  async function row(id: string) {
    const { data } = await getAdminClient()
      .from("communication_queue")
      .select("status, error_message, metadata")
      .eq("id", id)
      .single();
    return data as { status: string; error_message: string | null; metadata: Record<string, unknown> };
  }

  it("the same Delivered report twice → delivered once, one audit row (before: two)", async () => {
    const m = await seedSentMessage(c);
    const body = dlr(m.requestId, "Delivered");
    expect(await postMsg91(body)).toEqual(OK);
    expect(await postMsg91(body)).toEqual(OK);
    expect((await row(m.id)).status).toBe("delivered");
    expect(await auditCount(m.id, "communication_dlr_delivered")).toBe(1);
    // Even past the dedupe store (the key already finished), the RPC applies nothing twice.
    const { data } = await getAdminClient().rpc("communication_queue_apply_dlr", {
      p_external_message_id: m.requestId,
      p_status: "delivered",
      p_at: new Date().toISOString(),
      p_reason_code: null as unknown as string,
    });
    expect(data).toMatchObject({ applied: false, new_status: "delivered" });
    expect(await auditCount(m.id, "communication_dlr_delivered")).toBe(1);
  });

  it("Failed after Delivered stays delivered (no audit, no urgent note)", async () => {
    const m = await seedSentMessage(c, "appointment_booked");
    expect(await postMsg91(dlr(m.requestId, "Delivered"))).toEqual(OK);
    expect(await postMsg91(dlr(m.requestId, "Failed", { reason: "late_failure" }))).toEqual(OK);
    expect((await row(m.id)).status).toBe("delivered");
    expect(await auditCount(m.id, "communication_dlr_failed")).toBe(0);
  });

  it("Delivered after Read stays read", async () => {
    const m = await seedSentMessage(c);
    expect(await postMsg91(dlr(m.requestId, "Read"))).toEqual(OK);
    expect(await postMsg91(dlr(m.requestId, "Delivered"))).toEqual(OK);
    expect((await row(m.id)).status).toBe("read");
    expect(await auditCount(m.id, "communication_dlr_read")).toBe(1);
    expect(await auditCount(m.id, "communication_dlr_delivered")).toBe(0);
  });

  it("Failed on a sent urgent message → dead_letter with a code, one audit row and one urgent note", async () => {
    const m = await seedSentMessage(c, "appointment_booked");
    const body = dlr(m.requestId, "Failed", { reason: "Synthetic free text failure" });
    expect(await postMsg91(body)).toEqual(OK);
    expect(await postMsg91(body)).toEqual(OK);
    const failed = await row(m.id);
    expect(failed.status).toBe("dead_letter");
    // error_message holds a machine code, never the provider's free text.
    expect(failed.error_message).toBe("dlr_failed");
    expect(failed.metadata).toHaveProperty("failed_at");
    expect(await auditCount(m.id, "communication_dlr_failed")).toBe(1);
    const { count } = await getAdminClient()
      .from("in_app_notifications")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", c.tenantId)
      .eq("event_type", "whatsapp_delivery_failed");
    expect(count).toBe(1);
  });

  it("an error inside the route answers 500 and marks the key failed; the retry applies the report once", async () => {
    const m = await seedSentMessage(c);
    const body = dlr(m.requestId, "Read");
    const real = systemDb.getSystemDb("webhook.messaging_inbound");
    let failNext = true;
    const flaky = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "rpc") {
          return (fn: string, args: unknown) => {
            if (fn === "communication_queue_apply_dlr" && failNext) {
              failNext = false;
              return Promise.resolve({ data: null, error: { code: "57014", message: "synthetic" } });
            }
            return (target.rpc as (f: string, a: unknown) => unknown).call(target, fn, args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    vi.spyOn(systemDb, "getSystemDb").mockReturnValue(flaky);

    const first = await postMsg91(body);
    expect(first.status).toBe(500);
    expect(JSON.parse(first.text)).toEqual({ ok: false });
    expect((await row(m.id)).status).toBe("sent");
    expect(inboundEvent("msg91", keyFor(body))).toMatchObject({ outcome: "failed", processed: false });

    expect(await postMsg91(body)).toEqual(OK);
    expect((await row(m.id)).status).toBe("read");
    expect(await auditCount(m.id, "communication_dlr_read")).toBe(1);
    expect(inboundEvent("msg91", keyFor(body))).toMatchObject({ outcome: "processed", attempts: 2 });
  });

  it("an unknown request id is finished as ignored (a repeat is a duplicate); 04-07a keeps it for a later finish", async () => {
    const id = `req-unknown-${randomUUID()}`;
    const body = dlr(id, "Delivered");
    expect(await postMsg91(body)).toEqual(OK);
    expect(inboundEvent("msg91", keyFor(body))).toMatchObject({ outcome: "ignored", processed: true });
    expect(psql(`select status from ops.early_delivery_reports where external_message_id = '${id}'`)).toEqual(["delivered"]);
    psql(`delete from ops.early_delivery_reports where external_message_id = '${id}'`);
  });
});

describe("unmatched sender: one tenant-less reply job, phone erased when it finishes (R-25)", () => {
  it("an Indian sender with no matching message → one message.reply_unmatched job, even when posted twice", async () => {
    const phone = `+9190000000${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;
    const body = track({ uuid: randomUUID(), customerNumber: senderOf(phone), text: "hello" });
    const replyKey = `bot:${keyFor(body)}:bot_not_found`;
    replyKeys.push(replyKey);
    expect(await postMsg91(body)).toEqual(OK);
    expect(await postMsg91(body)).toEqual(OK);

    const job = replyJob(replyKey);
    expect(job).toMatchObject({ status: "pending", attempts: 0 });
    expect(JSON.parse(job!.payload)).toEqual({ to: phone, template_id: "bot_not_found" });

    // The runner sends it once and the payload no longer holds the phone.
    const provider = recordingProvider();
    await runUnmatchedReplies(onlyFor(phone, provider), "inbound-dedupe-1");
    expect(provider.calls.map((call) => [call.channel, call.to, call.templateId])).toEqual([["whatsapp", phone, "bot_not_found"]]);
    expect(provider.calls[0].signal).toBeInstanceOf(AbortSignal);
    const done = replyJob(replyKey);
    expect(done).toMatchObject({ status: "done" });
    expect(JSON.parse(done!.payload)).toEqual({ redacted: true });
    expect(done!.payload).not.toContain(phone.slice(-10));

    // A later retry of the same callback queues nothing new.
    expect(await postMsg91(body)).toEqual(OK);
    expect(replyJob(replyKey)).toMatchObject({ id: job!.id, status: "done" });
  });

  it("a non-retryable refusal (disabled provider) dead-letters the reply at once and erases the phone", async () => {
    const phone = `+9190000000${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;
    const body = track({ uuid: randomUUID(), customerNumber: senderOf(phone), text: "hi" });
    const replyKey = `bot:${keyFor(body)}:bot_not_found`;
    replyKeys.push(replyKey);
    expect(await postMsg91(body)).toEqual(OK);
    const refusing = recordingProvider(() => ({
      success: false,
      channelUsed: "whatsapp",
      code: "provider_disabled",
      retryable: false,
    }));
    await runUnmatchedReplies(onlyFor(phone, refusing), "inbound-dedupe-2");
    const dead = replyJob(replyKey);
    expect(dead).toMatchObject({ status: "dead", attempts: 1, lastError: "provider_disabled" });
    expect(JSON.parse(dead!.payload)).toEqual({ redacted: true });
  });

  it("a foreign sender with no match gets no reply job (only Indian mobiles are answered)", async () => {
    const body = track({ uuid: randomUUID(), customerNumber: "14155550123", text: "hello" });
    expect(await postMsg91(body)).toEqual(OK);
    expect(replyJob(`bot:${keyFor(body)}:bot_not_found`)).toBeNull();
    expect(inboundEvent("msg91", keyFor(body))).toMatchObject({ outcome: "ignored", processed: true });
  });
});

describe("the new RPCs are service-role only", () => {
  let member: SeededTenant;
  beforeAll(async () => {
    const c = await seedConversation("grants");
    member = await addMemberToTenant(c.tenantId, "receptionist");
  });

  it.each([
    ["inbound_webhook_begin", { p_provider: "msg91", p_dedupe_key: "in:grant-probe" }],
    ["inbound_webhook_finish", { p_provider: "msg91", p_dedupe_key: "in:grant-probe", p_outcome: "processed" }],
    ["communication_queue_apply_dlr", { p_external_message_id: "x", p_status: "read", p_at: null, p_reason_code: null }],
    ["enqueue_unmatched_reply_system", { p_system_actor: "system:messaging_webhook", p_to: "+919000000001", p_template_id: "bot_not_found", p_dedupe_key: "bot:grant-probe" }],
  ])("%s: a member and anon get 42501", async (fn, args) => {
    for (const client of [member.client, anonClient()]) {
      const { error } = await (client.rpc as unknown as (f: string, a: unknown) => Promise<{ error: { code?: string } | null }>)(fn, args);
      expect(error?.code, fn).toBe("42501");
    }
  });

  it("enqueue_unmatched_reply_system refuses another actor, a non-Indian number and a matched-only template", async () => {
    const admin = getAdminClient();
    const call = (over: Record<string, unknown>) =>
      (admin.rpc as unknown as (f: string, a: unknown) => Promise<{ error: { code?: string; message?: string } | null }>)(
        "enqueue_unmatched_reply_system",
        { p_system_actor: "system:messaging_webhook", p_to: "+919000000001", p_template_id: "bot_not_found", p_dedupe_key: `bot:probe-${randomUUID()}`, ...over }
      );
    expect((await call({ p_system_actor: "system:jobs" })).error?.message).toBe("ACTOR_INVALID");
    expect((await call({ p_to: "+14155550123" })).error?.message).toBe("RECIPIENT_NOT_ALLOWED");
    expect((await call({ p_to: "9000000001" })).error?.message).toBe("RECIPIENT_NOT_ALLOWED");
    expect((await call({ p_template_id: "appointment_confirmed_ack" })).error?.message).toBe("TEMPLATE_NOT_ALLOWED");
    expect((await call({ p_dedupe_key: "" })).error?.message).toBe("INPUT_INVALID");
  });
});
