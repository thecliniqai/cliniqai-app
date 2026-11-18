import { describe, it, expect, afterAll, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import * as nodeCrypto from "node:crypto";
import * as routeModule from "@/app/api/webhooks/messaging/[provider]/route";
import * as appointmentsActions from "@/features/appointments/system";
import * as systemDb from "@/lib/supabase/system";
import * as messagingModule from "@/lib/messaging";
import { inboundDedupeKey, parseMsg91Payload, verifyMsg91WebhookSecret } from "@/lib/messaging/webhook-helpers";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner } from "../helpers/tenants";
import { psql } from "../helpers/sql";
import { syntheticMobile } from "../jobs/message-helpers";

const usedPhones = new Set<string>();

// Spy on timingSafeEqual while keeping the real implementation (proves the constant-time path is used).
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

/**
 * P0-03 webhook lockdown regression suite (V2-01 plan 01-03; SEC-04, SEC-15, SEC-19, D9;
 * SECURITY_VERIFICATION_PLAN TC-WH-01..07). DB-backed on the local stack: two tenants, each with a booked visit and
 * a sent WhatsApp queue row, are seeded with the service-role helpers, and every assertion about "no change" reads
 * the rows back. Replay dedupe (TC-WH-04) is P1-10, not P0-03.
 *
 * V2-04 04-03c (R-25, P0-12): the route no longer sends. Bot replies are asserted as queued rows (`communication_queue`,
 * dedupe key `bot:<key>:<template>`) or, for an unmatched sender, as `message.reply_unmatched` jobs; the provider
 * factory is never called by a request (spied in every case). Each posted body carries its own inbound message id
 * (`uuid`), as MSG91 callbacks do, so repeated actions in this file are distinct events, not provider retries.
 */

const SECRET = `wh-${nodeCrypto.randomBytes(16).toString("hex")}`;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

interface SeededSide {
  tenantId: string;
  userId: string;
  patientId: string;
  patientPhone: string;
  visitId: string;
  replyMsgId: string;
}

/** Inbound dedupe keys and unmatched-reply job keys this file created (removed in afterAll: ops rows have no tenant). */
const createdKeys: string[] = [];

function webhook(
  provider: string,
  payload: unknown,
  opts: { headers?: Record<string, string>; method?: string; query?: string } = {}
) {
  const method = opts.method ?? "POST";
  const withId =
    payload && typeof payload === "object" && !("uuid" in payload) ? { uuid: nodeCrypto.randomUUID(), ...payload } : payload;
  const raw = JSON.stringify(withId);
  const key = inboundDedupeKey(parseMsg91Payload(raw), raw);
  if (key) createdKeys.push(key);
  return new NextRequest(
    `http://localhost:3000/api/webhooks/messaging/${provider}${opts.query ?? ""}`,
    {
      method,
      headers: opts.headers ?? { "content-type": "application/json", "x-webhook-secret": SECRET },
      body: method === "GET" || method === "HEAD" ? undefined : raw,
    }
  );
}

const SQL_KEY = /^[A-Za-z0-9:._=+/-]{1,200}$/;
function sqlKeys(keys: string[]): string {
  return keys.filter((k) => SQL_KEY.test(k)).map((k) => `'${k}'`).join(", ") || "''";
}

interface QueuedReply {
  template_id: string;
  recipient_phone: string | null;
  template_params: Record<string, unknown> | null;
}

/** Bot replies queued about a visit (V2-04 04-03c: replies are rows, not sends). */
async function repliesFor(visitId: string, since = "1970-01-01T00:00:00Z"): Promise<QueuedReply[]> {
  const { data, error } = await (getAdminClient().from("communication_queue") as any)
    .select("template_id, recipient_phone, template_params")
    .eq("appointment_id", visitId)
    .like("dedupe_key", "bot:%")
    .gte("created_at", since);
  if (error) throw new Error(error.message);
  return (data ?? []) as QueuedReply[];
}

/** `message.reply_unmatched` jobs created by this file's requests since `since` (an ISO time). */
function unmatchedJobsSince(since: string): string[] {
  return psql(
    `select payload ->> 'template_id' from ops.jobs where kind = 'message.reply_unmatched' ` +
      `and dedupe_key in (${sqlKeys(createdKeys.map((k) => `bot:${k}:bot_not_found`))}) and created_at >= '${since}'::timestamptz`
  );
}

const ctx = (provider: string) => ({ params: Promise.resolve({ provider }) });

function button(id: string) {
  return JSON.stringify({ button_reply: { id, title: id } });
}

describe("P0-03 messaging webhook lockdown (SEC-04, SEC-19, SEC-15, D9)", () => {
  const admin = getAdminClient();
  const originalEnv = { ...process.env };
  let A: SeededSide;
  let B: SeededSide;

  async function seedSide(label: string): Promise<SeededSide> {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const owner = await seedTenantWithOwner(`Webhook ${label} ${suffix}`);
    // 04-03c: a synthetic number (+91 90000 000xx; never a real subscriber), distinct from the other side's, because an
    // unmatched reply to it is now a queued job.
    let patientPhone = syntheticMobile();
    while (usedPhones.has(patientPhone)) patientPhone = syntheticMobile();
    usedPhones.add(patientPhone);
    const { data: patient, error: pErr } = await (admin.from("patients") as any)
      .insert({
        tenant_id: owner.tenantId,
        full_name: `Synthetic Patient ${label}`,
        phone: patientPhone,
        sex: "female",
        created_by: owner.userId,
      })
      .select("id, phone")
      .single();
    if (pErr || !patient) throw new Error(`seed patient ${label}: ${pErr?.message}`);

    const { data: visit, error: vErr } = await (admin.from("visits") as any)
      .insert({
        tenant_id: owner.tenantId,
        patient_id: patient.id,
        doctor_id: owner.userId,
        origin_type: "scheduled",
        scheduled_at: new Date(Date.now() + 3 * 86400000).toISOString(),
        status: "booked",
        created_by: owner.userId,
      })
      .select("id")
      .single();
    if (vErr || !visit) throw new Error(`seed visit ${label}: ${vErr?.message}`);

    const replyMsgId = `wamid.${label}-${suffix}`;
    const { error: qErr } = await (admin.from("communication_queue") as any).insert({
      tenant_id: owner.tenantId,
      patient_id: patient.id,
      appointment_id: visit.id,
      channel: "whatsapp",
      message_type: "appointment_booked",
      template_id: "appointment_booked",
      recipient_phone: patient.phone,
      status: "sent",
      external_message_id: replyMsgId,
    });
    if (qErr) throw new Error(`seed queue ${label}: ${qErr.message}`);

    return {
      tenantId: owner.tenantId,
      userId: owner.userId,
      patientId: patient.id,
      patientPhone: patient.phone,
      visitId: visit.id,
      replyMsgId,
    };
  }

  async function visitStatus(visitId: string): Promise<string> {
    const { data, error } = await (admin.from("visits") as any).select("status").eq("id", visitId).single();
    if (error) throw new Error(error.message);
    return data.status;
  }

  async function resetVisit(visitId: string) {
    const { error } = await (admin.from("visits") as any)
      .update({ status: "booked", metadata: {} })
      .eq("id", visitId);
    if (error) throw new Error(error.message);
  }

  beforeAll(async () => {
    A = await seedSide("A");
    B = await seedSide("B");
  });

  let providerFactory: { mock: { calls: unknown[] } };

  beforeEach(async () => {
    process.env = { ...originalEnv, MSG91_WEBHOOK_SECRET: SECRET };
    providerFactory = vi.spyOn(messagingModule, "getMessagingProvider");
    await resetVisit(A.visitId);
    await resetVisit(B.visitId);
  });

  afterEach(() => {
    // 04-03c (P0-12): no request builds a messaging provider; replies are queued and the job runner sends them.
    expect(providerFactory).not.toHaveBeenCalled();
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  afterAll(() => {
    psql(`delete from ops.jobs where kind = 'message.reply_unmatched' and dedupe_key in (${sqlKeys(createdKeys.map((k) => `bot:${k}:bot_not_found`))})`);
    psql(`delete from ops.inbound_webhook_events where provider = 'msg91' and dedupe_key in (${sqlKeys(createdKeys)})`);
  });

  describe("TC-WH-01: only msg91 exists (default deny, D5/D6)", () => {
    const handlers = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

    it.each(["dev", "twilio", "gupshup", "unknown", "MSG91", "msg91 "])(
      "provider %j answers 404 with an empty body for every method, even with a valid secret",
      async (provider) => {
        const dbSpy = vi.spyOn(systemDb, "getSystemDb");
        for (const method of handlers) {
          const handler = routeModule[method] as (req: NextRequest, c: unknown) => Promise<Response>;
          const res = await handler(
            webhook(
              provider,
              { from: A.patientPhone, action: "btn_cancel", replyMsgId: A.replyMsgId },
              { method, query: `?from=${encodeURIComponent(A.patientPhone)}&action=btn_cancel` }
            ),
            ctx(provider)
          );
          expect(res.status, `${method} ${provider}`).toBe(404);
          expect(await res.text()).toBe("");
        }
        expect(dbSpy).not.toHaveBeenCalled();
        expect(await visitStatus(A.visitId)).toBe("booked");
      }
    );

    it.each([["development"], ["production"]])(
      "GET /api/webhooks/messaging/dev?action=btn_cancel is 404 under NODE_ENV=%s",
      async (nodeEnv) => {
        (process.env as Record<string, string>).NODE_ENV = nodeEnv;
        const res = await routeModule.GET();
        expect(res.status).toBe(404);
        const post = await routeModule.POST(
          webhook("dev", { from: A.patientPhone, action: "btn_cancel" }, { headers: {} }),
          ctx("dev")
        );
        expect(post.status).toBe(404);
        expect(await visitStatus(A.visitId)).toBe("booked");
      }
    );

    it("GET on the msg91 provider is also 404 (the GET simulator is gone)", async () => {
      const res = await routeModule.GET();
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("");
    });
  });

  describe("TC-WH-02/03: MSG91 header secret, constant time, fail closed", () => {
    const cancelA = () => ({
      customerNumber: A.patientPhone.replace("+", ""),
      replyMsgId: A.replyMsgId,
      interactive: button("btn_cancel"),
    });

    const cases: Array<[string, Record<string, string>, string?]> = [
      ["no secret header", { "content-type": "application/json" }],
      ["wrong secret", { "content-type": "application/json", "x-webhook-secret": "wrong" }],
      ["shorter secret (length mismatch)", { "content-type": "application/json", "x-webhook-secret": SECRET.slice(0, 5) }],
      ["longer secret (length mismatch)", { "content-type": "application/json", "x-webhook-secret": `${SECRET}x` }],
      ["empty secret header", { "content-type": "application/json", "x-webhook-secret": "" }],
      ["secret only in the query string", { "content-type": "application/json" }, `?secret=${SECRET}`],
      ["secret in an authkey header", { "content-type": "application/json", authkey: SECRET }],
    ];

    it.each(cases)("%s → 401 { ok: false }, no DB access, visit unchanged", async (_label, headers, query) => {
      const dbSpy = vi.spyOn(systemDb, "getSystemDb");
      const res = await routeModule.POST(webhook("msg91", cancelA(), { headers, query }), ctx("msg91"));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false });
      expect(dbSpy).not.toHaveBeenCalled();
      expect(await visitStatus(A.visitId)).toBe("booked");
    });

    it("the MSG91 API auth key is not a webhook credential", async () => {
      process.env.MSG91_AUTH_KEY = "synthetic-auth-key";
      const dbSpy = vi.spyOn(systemDb, "getSystemDb");
      const res = await routeModule.POST(
        webhook("msg91", cancelA(), { headers: { "content-type": "application/json", authkey: "synthetic-auth-key" } }),
        ctx("msg91")
      );
      expect(res.status).toBe(401);
      expect(dbSpy).not.toHaveBeenCalled();
    });

    it.each(["test", "development", "production"])(
      "an unset MSG91_WEBHOOK_SECRET rejects everything under NODE_ENV=%s",
      async (nodeEnv) => {
        delete process.env.MSG91_WEBHOOK_SECRET;
        (process.env as Record<string, string>).NODE_ENV = nodeEnv;
        const dbSpy = vi.spyOn(systemDb, "getSystemDb");
        const headerSets: Record<string, string>[] = [
          { "content-type": "application/json" },
          { "content-type": "application/json", "x-webhook-secret": "" },
          { "content-type": "application/json", "x-webhook-secret": SECRET },
        ];
        for (const headers of headerSets) {
          const res = await routeModule.POST(webhook("msg91", cancelA(), { headers }), ctx("msg91"));
          expect(res.status).toBe(401);
        }
        expect(dbSpy).not.toHaveBeenCalled();
        expect(await visitStatus(A.visitId)).toBe("booked");
      }
    );

    it("compares with crypto.timingSafeEqual over equal-length digests", () => {
      const tse = vi.mocked(nodeCrypto.timingSafeEqual);
      tse.mockClear();
      expect(verifyMsg91WebhookSecret(new Headers({ "x-webhook-secret": "x" }))).toBe(false);
      expect(verifyMsg91WebhookSecret(new Headers({ "x-webhook-secret": SECRET }))).toBe(true);
      expect(tse).toHaveBeenCalledTimes(2);
      for (const [a, b] of tse.mock.calls) {
        expect((a as Buffer).length).toBe(32);
        expect((b as Buffer).length).toBe(32);
      }
    });
  });

  describe("TC-WH-05/07: replies route only by replyMsgId, tenant-scoped, injection-proof", () => {
    it("AR-L1: a reply from a number other than the message's recipient changes nothing and gets no link", async () => {
      const since = psql("select now()")[0];
      for (const action of ["btn_confirm", "btn_cancel", "btn_reschedule"]) {
        const res = await routeModule.POST(
          webhook("msg91", {
            customerNumber: A.patientPhone.replace("+", ""), // tenant A's patient replying to tenant B's message
            replyMsgId: B.replyMsgId,
            interactive: button(action),
          }),
          ctx("msg91")
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
      }
      expect(await visitStatus(B.visitId)).toBe("booked");
      expect(await visitStatus(A.visitId)).toBe("booked");
      // No reply about either visit (no link): the sender is unmatched and gets the queued "not found" reply only.
      expect(await repliesFor(B.visitId, since)).toEqual([]);
      expect(await repliesFor(A.visitId, since)).toEqual([]);
      expect(unmatchedJobsSince(since)).toEqual(["bot_not_found", "bot_not_found", "bot_not_found"]);
    });

    it("a tenant-B replyMsgId from tenant B's recipient acts only on tenant B; tenant A is untouched", async () => {
      const res = await routeModule.POST(
        webhook("msg91", {
          customerNumber: B.patientPhone.replace("+", ""),
          replyMsgId: B.replyMsgId,
          interactive: button("btn_confirm"),
        }),
        ctx("msg91")
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(await visitStatus(B.visitId)).toBe("confirmed");
      expect(await visitStatus(A.visitId)).toBe("booked");
    });

    it("AR-L1: a late confirm does not move a waiting visit back to confirmed", async () => {
      await admin.from("visits").update({ status: "waiting" }).eq("id", B.visitId);
      try {
        const res = await routeModule.POST(
          webhook("msg91", {
            customerNumber: B.patientPhone.replace("+", ""),
            replyMsgId: B.replyMsgId,
            interactive: button("btn_confirm"),
          }),
          ctx("msg91")
        );
        expect(res.status).toBe(200);
        expect(await visitStatus(B.visitId)).toBe("waiting");
      } finally {
        await admin.from("visits").update({ status: "booked" }).eq("id", B.visitId);
      }
    });

    it("a queue row whose appointment points at another tenant's visit resolves nothing", async () => {
      const forgedId = `wamid.forged-${Date.now()}`;
      const { error } = await (admin.from("communication_queue") as any).insert({
        tenant_id: A.tenantId,
        appointment_id: B.visitId, // cross-tenant pointer: the visit read is bound to tenant A and must miss
        channel: "whatsapp",
        message_type: "appointment_booked",
        template_id: "appointment_booked",
        recipient_phone: A.patientPhone,
        status: "sent",
        external_message_id: forgedId,
      });
      expect(error).toBeNull();

      const cancelSpy = vi.spyOn(appointmentsActions, "cancelAppointment");
      const res = await routeModule.POST(
        webhook("msg91", {
          customerNumber: B.patientPhone.replace("+", ""),
          replyMsgId: forgedId,
          interactive: button("btn_cancel"),
        }),
        ctx("msg91")
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(cancelSpy).not.toHaveBeenCalled();
      expect(await visitStatus(B.visitId)).toBe("booked");
      expect(await visitStatus(A.visitId)).toBe("booked");
    });

    it.each([
      (id: string) => `${id},external_message_id.neq.null`,
      () => "x),or(external_message_id.neq.null",
      (id: string) => `${id}),or(id.neq.null`,
      (id: string) => `x,metadata->>message_id.eq.${id}`,
      () => "*",
      () => "%",
    ])("injected replyMsgId #%# does not widen the match", async (makeId) => {
      const cancelSpy = vi.spyOn(appointmentsActions, "cancelAppointment");
      const res = await routeModule.POST(
        webhook("msg91", {
          customerNumber: A.patientPhone.replace("+", ""),
          replyMsgId: makeId(A.replyMsgId),
          interactive: button("btn_cancel"),
        }),
        ctx("msg91")
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(cancelSpy).not.toHaveBeenCalled();
      expect(await visitStatus(A.visitId)).toBe("booked");
      expect(await visitStatus(B.visitId)).toBe("booked");
    });

    it("no phone fallback: a cancel without replyMsgId from a seeded patient's phone changes nothing", async () => {
      const since = psql("select now()")[0];
      const cancelSpy = vi.spyOn(appointmentsActions, "cancelAppointment");
      for (const phone of [A.patientPhone, A.patientPhone.replace("+", ""), A.patientPhone.slice(-10)]) {
        const res = await routeModule.POST(
          webhook("msg91", { customerNumber: phone, interactive: button("btn_cancel") }),
          ctx("msg91")
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
      }
      expect(cancelSpy).not.toHaveBeenCalled();
      expect(await visitStatus(A.visitId)).toBe("booked");
      expect(await repliesFor(A.visitId, since)).toEqual([]);
      // The two spellings with the country code are an Indian sender: one queued "not found" reply each; the bare
      // 10-digit sender is not (AR3-N3) and gets nothing.
      expect(unmatchedJobsSince(since)).toEqual(["bot_not_found", "bot_not_found"]);
    });

    it("the correct tenant-A replyMsgId cancels tenant A's visit and only that visit", async () => {
      const res = await routeModule.POST(
        webhook("msg91", {
          customerNumber: A.patientPhone.replace("+", ""),
          replyMsgId: A.replyMsgId,
          interactive: button("btn_cancel"),
        }),
        ctx("msg91")
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(await visitStatus(A.visitId)).toBe("cancelled");
      expect(await visitStatus(B.visitId)).toBe("booked");
    });
  });

  describe("01-09 review round 2 (AR2-L3, AR2-L4)", () => {
    const reply = (side: SeededSide, action: string, customerNumber = side.patientPhone.replace("+", "")) =>
      routeModule.POST(
        webhook("msg91", { customerNumber, replyMsgId: side.replyMsgId, interactive: button(action) }),
        ctx("msg91")
      );

    it("AR2-L3: a foreign number ending in the recipient's 10 digits is not the recipient", async () => {
      const since = psql("select now()")[0];
      const tenDigits = A.patientPhone.replace("+91", "");
      for (const foreign of [`1${tenDigits}`, `44${tenDigits}`, `0001${tenDigits}`, `92${tenDigits}`]) {
        for (const action of ["btn_confirm", "btn_cancel", "btn_reschedule"]) {
          const res = await reply(A, action, foreign);
          expect(res.status).toBe(200);
        }
      }
      expect(await visitStatus(A.visitId)).toBe("booked");
      expect(await repliesFor(A.visitId, since)).toEqual([]);
      // Foreign senders are never answered (only Indian mobiles get the unmatched reply, T-04-16).
      expect(unmatchedJobsSince(since)).toEqual([]);

      // The recipient's own number in its international spellings still matches (AR3-N3: country code required).
      for (const own of [`91${tenDigits}`, `+91 ${tenDigits.slice(0, 5)} ${tenDigits.slice(5)}`, `0091${tenDigits}`]) {
        await resetVisit(A.visitId);
        await reply(A, "btn_confirm", own);
        expect(await visitStatus(A.visitId), own).toBe("confirmed");
      }
    });

    it("AR3-N3: a sender without a country code never matches (a 10-digit foreign number is not an Indian mobile)", async () => {
      const since = psql("select now()")[0];
      const tenDigits = A.patientPhone.replace("+91", "");
      // `+65 9123 4567` arrives as 6591234567: ten digits, no 91. Each spelling below has the recipient's ten digits
      // with no Indian country code.
      for (const sender of [tenDigits, `+${tenDigits}`, `0${tenDigits}`, `${tenDigits.slice(0, 5)} ${tenDigits.slice(5)}`]) {
        for (const action of ["btn_confirm", "btn_cancel", "btn_reschedule"]) {
          const res = await reply(A, action, sender);
          expect(res.status).toBe(200);
        }
      }
      expect(await visitStatus(A.visitId)).toBe("booked");
      expect(await repliesFor(A.visitId, since)).toEqual([]);
      expect(unmatchedJobsSince(since)).toEqual([]);
    });

    it("01-10 / 04-03c: delivery reports persist and are monotonic — a late Failed leaves delivered; Failed on a sent row → dead_letter", async () => {
      async function seedSent() {
        const requestId = `req-dlr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const { data: seeded, error: seedErr } = await (admin.from("communication_queue") as any)
          .insert({
            tenant_id: A.tenantId,
            patient_id: A.patientId,
            appointment_id: A.visitId,
            channel: "whatsapp",
            message_type: "appointment_reminder",
            template_id: "appointment_reminder",
            recipient_phone: A.patientPhone,
            status: "sent",
            external_message_id: requestId,
          })
          .select("id, next_retry_at")
          .single();
        if (seedErr || !seeded) throw new Error(`seed queue: ${seedErr?.message}`);
        return { requestId, id: seeded.id as string, nextRetryAt: seeded.next_retry_at as string };
      }
      const row = async (id: string) => {
        const { data } = await (admin.from("communication_queue") as any)
          .select("status, error_message, next_retry_at, metadata")
          .eq("id", id)
          .single();
        return data as { status: string; error_message: string | null; next_retry_at: string; metadata: Record<string, unknown> };
      };
      const dlr = (requestId: string, status: string) =>
        routeModule.POST(
          webhook("msg91", { direction: "outbound", status, request_id: requestId, reason: "Synthetic failure" }),
          ctx("msg91")
        );
      const audits = async (id: string) => {
        const { data } = await (admin.from("audit_logs") as any)
          .select("action, metadata")
          .eq("entity_id", id)
          .in("action", ["communication_dlr_delivered", "communication_dlr_failed"]);
        return (data ?? []) as Array<{ action: string; metadata: Record<string, unknown> }>;
      };

      const delivered = await seedSent();
      expect((await dlr(delivered.requestId, "Delivered")).status).toBe(200);
      expect((await row(delivered.id)).status).toBe("delivered");
      // 04-03c (communication_queue_apply_dlr): a late Failed never overwrites delivered, and writes no audit row.
      expect((await dlr(delivered.requestId, "Failed")).status).toBe(200);
      expect((await row(delivered.id)).status).toBe("delivered");

      const failedRow = await seedSent();
      expect((await dlr(failedRow.requestId, "Failed")).status).toBe(200);
      const failed = await row(failedRow.id);
      expect(failed.status).toBe("dead_letter");
      // 04-03c: error_message holds a machine code, never the provider's free text.
      expect(failed.error_message).toBe("dlr_failed");
      expect(failed.metadata).toHaveProperty("failed_at");
      expect(failed.next_retry_at).toBe(failedRow.nextRetryAt);

      // The delivery-report audit rows carry the queue id, status and message type, never the phone number.
      const all = [...(await audits(delivered.id)), ...(await audits(failedRow.id))];
      expect(all.map((a) => a.action).sort()).toEqual(["communication_dlr_delivered", "communication_dlr_failed"]);
      for (const a of all) {
        expect([delivered.id, failedRow.id]).toContain(a.metadata.queue_id);
        expect(a.metadata).toMatchObject({ message_type: "appointment_reminder" });
        expect(a.metadata).not.toHaveProperty("recipient_phone");
        expect(JSON.stringify(a.metadata)).not.toContain(A.patientPhone.replace("+91", ""));
      }
    });

    it.each(["waiting", "in_consultation"])(
      "AR2-L4: a late cancel or reschedule reply does nothing to a %s visit (no link, no cancellation)",
      async (status) => {
        const since = psql("select now()")[0];
        await admin.from("visits").update({ status }).eq("id", B.visitId);
        try {
          const tokenSpy = vi.spyOn(appointmentsActions, "generateRescheduleToken");
          expect((await reply(B, "btn_cancel")).status).toBe(200);
          expect(await visitStatus(B.visitId)).toBe(status);
          expect((await reply(B, "btn_reschedule")).status).toBe(200);
          expect(await visitStatus(B.visitId)).toBe(status);
          expect(tokenSpy).not.toHaveBeenCalled();
          const replies = await repliesFor(B.visitId, since);
          expect(replies.map((r) => r.template_id)).not.toContain("appointment_cancelled_ack");
          expect(JSON.stringify(replies)).not.toContain("/reschedule/");
        } finally {
          await admin.from("visits").update({ status: "booked" }).eq("id", B.visitId);
        }
      }
    );

    it("AR2-L4: a booked visit can still be cancelled and a confirmed one gets a reschedule link (queued to the recipient)", async () => {
      const since = psql("select now()")[0];
      await admin.from("visits").update({ status: "confirmed" }).eq("id", B.visitId);
      await reply(B, "btn_reschedule");
      const link = (await repliesFor(B.visitId, since)).filter((r) => r.template_id === "appointment_reschedule_link");
      expect(link).toHaveLength(1);
      expect(String(link[0].template_params?.message)).toContain("/reschedule/");
      expect(link[0].recipient_phone).toBe(B.patientPhone);

      await resetVisit(B.visitId);
      await reply(B, "btn_cancel");
      expect(await visitStatus(B.visitId)).toBe("cancelled");
    });
  });

  describe("TC-WH-06: responses carry no ids, tokens or URLs", () => {
    function assertBare(text: string) {
      expect(JSON.parse(text)).toEqual({ ok: true });
      expect(text).not.toMatch(UUID_RE);
      expect(text).not.toMatch(/reschedule|https?:|token|wamid/i);
    }

    it.each([
      ["confirm", { interactive: button("btn_confirm") }],
      ["cancel", { interactive: button("btn_cancel") }],
      ["reschedule", { interactive: button("btn_reschedule") }],
      ["triage", { text: "Can I come an hour later?" }],
    ])("inbound %s", async (_label, extra) => {
      const res = await routeModule.POST(
        webhook("msg91", { customerNumber: A.patientPhone.replace("+", ""), replyMsgId: A.replyMsgId, ...extra }),
        ctx("msg91")
      );
      expect(res.status).toBe(200);
      assertBare(await res.text());
    });

    it.each(["Delivered", "Read", "Failed", "Submitted"])("DLR %s (known and unknown request id)", async (status) => {
      for (const requestId of [A.replyMsgId, "req-unknown-id"]) {
        const res = await routeModule.POST(
          webhook("msg91", { direction: "outbound", status, request_id: requestId, reason: "Synthetic" }),
          ctx("msg91")
        );
        expect(res.status).toBe(200);
        assertBare(await res.text());
      }
    });
  });
});
