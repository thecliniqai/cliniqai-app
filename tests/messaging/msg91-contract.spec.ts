/**
 * V2-04 04-03a (roadmap "MSW contract for MSG91", TEST_STRATEGY T-09; R-20): the request `Msg91Provider` builds and how
 * it classifies MSG91's answers, at the HTTP boundary with MSW (`setupServer`, `onUnhandledFrame: "error"`). Handled
 * requests never reach a socket, and the worker guard stays active.
 *
 * MSW 3 answers at the socket, below `fetch`; `mswFetch` (tests/setup/worker-guard.ts) lets requests to
 * control.msg91.com reach it and makes any socket to that host dial 127.0.0.1 instead, so even a request MSW did not
 * handle never reaches MSG91 (asserted below). Every other host stays refused by the worker guard.
 *
 * Fixture recipients are fake numbers OUTSIDE the synthetic range (that range is refused before any request, covered in
 * provider-timeouts-and-synthetic.spec.ts and message-send-handler-db.spec.ts); they never leave MSW.
 *
 * - SMS: POST https://control.msg91.com/api/v5/flow/ with the `authkey` header and body { template_id, sender,
 *   short_url, mobiles: "91…", …params }; 200 → `externalMessageId` from `request_id`.
 * - WhatsApp: a catalogue template → the bulk endpoint with name, language { code, policy } and the positional
 *   components incl. the URL button; a non-catalogue template → the session-text endpoint.
 * - 400 → `retryable: false` (before: no `retryable`); 429 and 500 and a network error → `retryable: true`; a 2xx body
 *   reporting an error → `retryable: false`; error codes never carry MSG91's text.
 * - A response delayed past `timeoutMs` (50 ms here) aborts within 1 s, `retryable: true`; aborting the runner's
 *   signal aborts the call within 1 s (before: the call ran to the 10 s bound).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { Msg91Provider } from "@/lib/messaging";
import { buildPositionalComponents } from "@/lib/messaging/templates/mapping";
import { mswFetch } from "../setup/worker-guard";

const FLOW = "https://control.msg91.com/api/v5/flow/";
const BULK = "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";
const TEXT = "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/";
// Fake, outside the synthetic range (+91 90000 000xx); only MSW ever sees it.
const TO = "+91 98123 00045";
const TO_DIGITS = "919812300045";
const AUTH = ["fake", "msg91", "auth", "key"].join("-");
const SECRET_LOOKING_TEXT = "Recipient 919812300045 is not on WhatsApp";

interface Captured {
  url: string;
  method: string;
  authkey: string | null;
  contentType: string | null;
  body: Record<string, unknown>;
}
let captured: Captured[] = [];

const server = setupServer();
let net: { restore: () => void };
beforeAll(() => {
  net = mswFetch(["control.msg91.com"]);
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  server.resetHandlers();
  captured = [];
});
afterAll(() => {
  server.close();
  net.restore();
});

function capture(url: string, answer: () => Response | Promise<Response>) {
  return http.post(url, async ({ request }) => {
    captured.push({
      url: request.url,
      method: request.method,
      authkey: request.headers.get("authkey"),
      contentType: request.headers.get("content-type"),
      body: (await request.json()) as Record<string, unknown>,
    });
    return answer();
  });
}

const provider = (timeoutMs?: number) => new Msg91Provider({ authKey: AUTH, senderId: "synthetic-sender", timeoutMs });

async function within<T>(p: Promise<T>, ms: number): Promise<{ value: T | "hung"; elapsed: number }> {
  const start = Date.now();
  const value = await Promise.race([p, new Promise<"hung">((r) => setTimeout(() => r("hung"), ms))]);
  return { value, elapsed: Date.now() - start };
}

describe("MSG91 request shape", () => {
  it("SMS goes to the flow API with authkey and the flow body; 200 → externalMessageId", async () => {
    server.use(capture(FLOW, () => HttpResponse.json({ type: "success", request_id: "flow-req-1" })));
    const result = await provider().sendSms(TO, "flow_template_1", { patient_name: "Synthetic", clinic_name: "Clinic" });

    expect(result).toEqual({ success: true, channelUsed: "sms", externalMessageId: "flow-req-1", statusCode: 200 });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      url: FLOW,
      method: "POST",
      authkey: AUTH,
      contentType: "application/json",
      body: {
        template_id: "flow_template_1",
        sender: "synthetic-sender",
        short_url: "0",
        mobiles: TO_DIGITS,
        patient_name: "Synthetic",
        clinic_name: "Clinic",
      },
    });
  });

  // V2-04 04-07a (review B H-1, triage H-SMS): before, `...params` was spread after the control fields, so a queued row's
  // params replaced the recipient, the Flow template and the sender id. The request now never changes.
  it.each([
    ["an undeclared template", "flow_template_1"],
    ["a declared SMS fallback", "appointment_booked_sms_fallback"],
  ])("SMS (%s): params named mobiles / template_id / sender / short_url (any case) never change the request", async (_label, template) => {
    server.use(capture(FLOW, () => HttpResponse.json({ type: "success", request_id: "flow-req-2" })));
    const hostile = {
      patient_name: "Synthetic",
      mobiles: "917000000001,917000000002",
      template_id: "ATTACKER_FLOW",
      sender: "EVILID",
      short_url: "1",
      MOBILES: "917000000003",
      Template_Id: "ATTACKER_FLOW_2",
      recipients: "[]",
      authkey: "stolen",
    };
    const result = await provider().sendSms(TO, template, hostile);
    expect(result).toMatchObject({ success: true, channelUsed: "sms" });
    expect(captured).toHaveLength(1);
    expect(captured[0].body).toEqual({
      template_id: template,
      sender: "synthetic-sender",
      short_url: "0",
      mobiles: TO_DIGITS,
      patient_name: "Synthetic",
    });
    expect(captured[0].authkey).toBe(AUTH);
  });

  it("SMS with a declared template sends only its declared variables", async () => {
    server.use(capture(FLOW, () => HttpResponse.json({ type: "success", request_id: "flow-req-3" })));
    await provider().sendSms(TO, "appointment_rescheduled_sms_fallback", {
      patient_name: "Synthetic",
      new_date_time: "20 Nov 2026, 10:30 am",
      clinic_name: "Clinic",
      document_url: "https://phish.invalid/x",
      message: "free text",
    });
    expect(captured[0].body).toEqual({
      template_id: "appointment_rescheduled_sms_fallback",
      sender: "synthetic-sender",
      short_url: "0",
      mobiles: TO_DIGITS,
      patient_name: "Synthetic",
      new_date_time: "20 Nov 2026, 10:30 am",
      clinic_name: "Clinic",
    });
  });

  it("a catalogue WhatsApp template goes to the bulk endpoint with name, language and positional components", async () => {
    server.use(capture(BULK, () => HttpResponse.json({ status: "success", request_id: "bulk-req-1" })));
    const params = {
      patient_name: "Synthetic",
      doctor_name: "Doctor",
      clinic_name: "Clinic",
      document_url: "https://app.example.test/r/synthetic-token-1",
    };
    const result = await provider().sendWhatsApp(TO, "prescription_ready", params, [{ id: "btn_view_rx", text: "View" }]);

    expect(result).toMatchObject({ success: true, channelUsed: "whatsapp", externalMessageId: "bulk-req-1" });
    expect(captured).toHaveLength(1);
    const { url, authkey, body } = captured[0];
    expect(url).toBe(BULK);
    expect(authkey).toBe(AUTH);
    const components = buildPositionalComponents("prescription_ready", params);
    expect(components).toHaveProperty("button_1", expect.objectContaining({ type: "url", value: "synthetic-token-1" }));
    expect(body).toEqual({
      integrated_number: "synthetic-sender",
      content_type: "template",
      payload: {
        type: "template",
        template: {
          name: "prescription_ready",
          language: { code: "en", policy: "deterministic" },
          to_and_components: [{ to: [TO_DIGITS], components }],
        },
        messaging_product: "whatsapp",
      },
    });
  });

  it("a non-catalogue WhatsApp message goes to the session-text endpoint", async () => {
    server.use(capture(TEXT, () => HttpResponse.json({ status: "success", message_uuid: "text-uuid-1" })));
    const result = await provider().sendWhatsApp(TO, "conversational_triage", { message: "Synthetic reply" });

    expect(result).toMatchObject({ success: true, externalMessageId: "text-uuid-1" });
    expect(captured[0]).toMatchObject({
      url: TEXT,
      authkey: AUTH,
      body: { integrated_number: "synthetic-sender", recipient_number: TO_DIGITS, content_type: "text", text: "Synthetic reply" },
    });
  });
});

describe("MSG91 failure classification (R-20)", () => {
  const sends: Array<[string, string, () => Promise<unknown>]> = [
    ["SMS", FLOW, () => provider().sendSms(TO, "flow_template_1", {})],
    ["WhatsApp (catalogue)", BULK, () => provider().sendWhatsApp(TO, "appointment_booked", {})],
    ["WhatsApp (session text)", TEXT, () => provider().sendWhatsApp(TO, "conversational_triage", { message: "x" })],
  ];

  it.each(sends)("%s: 400 → not retryable, code only (never MSG91's text)", async (_label, url, send) => {
    server.use(capture(url, () => HttpResponse.json({ type: "error", message: SECRET_LOOKING_TEXT }, { status: 400 })));
    const result = await send();
    expect(result).toMatchObject({ success: false, retryable: false, code: "msg91_http_400", error: "msg91_http_400", statusCode: 400 });
    expect(JSON.stringify(result)).not.toContain("919812300045");
  });

  it.each(sends)("%s: 500 and 429 → retryable", async (_label, url, send) => {
    for (const status of [500, 503, 429]) {
      server.use(capture(url, () => HttpResponse.json({ message: SECRET_LOOKING_TEXT }, { status })));
      expect(await send()).toMatchObject({ success: false, retryable: true, code: `msg91_http_${status}` });
    }
  });

  it.each(sends)("%s: a 200 body reporting an error → not retryable", async (_label, url, send) => {
    server.use(
      capture(url, () => HttpResponse.json({ type: "error", status: "error", hasError: true, message: SECRET_LOOKING_TEXT }))
    );
    const result = await send();
    expect(result).toMatchObject({ success: false, retryable: false, code: "msg91_rejected" });
    expect(JSON.stringify(result)).not.toContain("919812300045");
  });

  it.each(sends)("%s: a network error → retryable", async (_label, url, send) => {
    server.use(http.post(url, () => HttpResponse.error()));
    expect(await send()).toMatchObject({ success: false, retryable: true, code: "msg91_request_failed:TypeError" });
  });

  it("no auth key → not retryable, no request", async () => {
    // The lane's placeholder MSG91_AUTH_KEY is the constructor's fallback: blank it for this case only.
    vi.stubEnv("MSG91_AUTH_KEY", "");
    try {
      const result = await new Msg91Provider({ authKey: "", senderId: "s" }).sendSms(TO, "t", {});
      expect(result).toMatchObject({ success: false, retryable: false, code: "msg91_not_configured" });
      expect(captured).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("MSG91 call bounds", () => {
  it("a response delayed past timeoutMs (50 ms) is aborted within 1 s, retryable", async () => {
    server.use(
      http.post(FLOW, async () => {
        await delay(5_000);
        return HttpResponse.json({ type: "success", request_id: "late" });
      })
    );
    const { value, elapsed } = await within(provider(50).sendSms(TO, "flow_template_1", {}), 3_000);
    expect(value).toMatchObject({ success: false, retryable: true, code: "msg91_request_failed:TimeoutError" });
    expect(elapsed).toBeLessThan(1_000);
  });

  it("aborting the runner's signal aborts the call within 1 s (the 10 s bound is not waited for)", async () => {
    server.use(
      http.post(BULK, async () => {
        await delay(5_000);
        return HttpResponse.json({ status: "success" });
      })
    );
    const controller = new AbortController();
    const pending = provider().sendWhatsApp(TO, "appointment_booked", {}, undefined, { signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    const { value, elapsed } = await within(pending, 3_000);
    expect(value).toMatchObject({ success: false, retryable: true });
    expect((value as { code: string }).code).toMatch(/^msg91_request_failed:/);
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe("the lane stays offline around MSW", () => {
  it("a request MSW does not handle never reaches MSG91 (its socket dials 127.0.0.1); other hosts stay refused", async () => {
    const result = await provider().sendSms(TO, "flow_template_1", {});
    expect(result).toMatchObject({ success: false, retryable: true });
    expect((result as { code: string }).code).toMatch(/^msg91_request_failed:/);
    const other = await fetch("https://api.example.test/x", { method: "POST" }).catch((e: Error) => e.name);
    expect(other).toBe("NonLocalNetworkError");
  });
});
