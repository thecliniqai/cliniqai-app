/**
 * V2-03 03-13d: outbound provider calls are time-bounded (review E-6) and the real messaging providers never send to
 * the synthetic number range (M-SEEDPHONE). `fetch` is stubbed: no request leaves the process. A hung provider is
 * simulated by a fetch that only settles when its signal aborts; `AbortSignal.timeout` is spied so the test both
 * records the bound each call asks for and shortens it to milliseconds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GupshupProvider, Msg91Provider, TwilioProvider, type MessagingSendResult } from "@/lib/messaging";
import { MESSAGING_PROVIDER_TIMEOUT_MS } from "@/lib/messaging/provider-guard";
import { isSyntheticPhone, SYNTHETIC_PHONE_PREFIX } from "@/lib/messaging/synthetic-numbers";
import { AI_TIMEOUT_MS, AiUnavailableError, OpenAiGatewayClient } from "@/lib/ai/client";
import templates from "@/lib/messaging/templates/whatsapp-templates.json";

const REAL_LOOKING = "+919812300045"; // not in the synthetic range; never contacted (fetch is stubbed)
const CATALOGUE_TEMPLATE = (templates as Array<{ template_name: string }>)[0].template_name;

let requestedTimeouts: number[];
const realTimeout = AbortSignal.timeout.bind(AbortSignal);

beforeEach(() => {
  requestedTimeouts = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    requestedTimeouts.push(ms);
    return realTimeout(25);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A fetch that never answers; it rejects only when the request's signal aborts (or never, without a signal). */
function hangingFetch() {
  return vi.fn((_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
    }),
  );
}

/** Settles `p` or reports "hung" after `ms` (so a missing timeout fails the test instead of stalling it). */
async function within<T>(p: Promise<T>, ms = 2000): Promise<T | "hung"> {
  return Promise.race([p, new Promise<"hung">((r) => setTimeout(() => r("hung"), ms))]);
}

const providerCalls: Array<[string, () => Promise<MessagingSendResult>]> = [
  ["MSG91 SMS", () => new Msg91Provider({ authKey: "k", senderId: "s" }).sendSms(REAL_LOOKING, "t", {})],
  ["MSG91 WhatsApp (catalogue)", () => new Msg91Provider({ authKey: "k", senderId: "s" }).sendWhatsApp(REAL_LOOKING, CATALOGUE_TEMPLATE, {})],
  ["MSG91 WhatsApp (free-form)", () => new Msg91Provider({ authKey: "k", senderId: "s" }).sendWhatsApp(REAL_LOOKING, "not_in_catalogue", {})],
  ["Gupshup WhatsApp", () => new GupshupProvider({ apiKey: "k", appName: "a", srcPhone: "1" }).sendWhatsApp(REAL_LOOKING, "t", {})],
  ["Twilio SMS", () => new TwilioProvider({ accountSid: "AC0", authToken: "x", fromPhone: "+10000000000" }).sendSms(REAL_LOOKING, "t", {})],
  ["Twilio WhatsApp", () => new TwilioProvider({ accountSid: "AC0", authToken: "x", fromPhone: "+10000000000" }).sendWhatsApp(REAL_LOOKING, "t", {})],
];

describe("provider calls are time-bounded (review E-6)", () => {
  it.each(providerCalls)("%s gives up on a hung provider and reports a failure", async (_label, call) => {
    const fetchStub = hangingFetch();
    vi.stubGlobal("fetch", fetchStub);
    const result = await within(call());
    expect(result).not.toBe("hung");
    expect(result).toMatchObject({ success: false });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(requestedTimeouts).toEqual([MESSAGING_PROVIDER_TIMEOUT_MS]);
  });

  it("the AI client gives up on a hung provider with AiUnavailableError", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    const client = new OpenAiGatewayClient({ provider: "openai", apiKey: "k", model: "m", baseUrl: "https://ai.example.test/v1" });
    const outcome = await within(client.chatCompletion({ messages: [{ role: "user", content: "synthetic" }] }).catch((e) => e));
    expect(outcome).toBeInstanceOf(AiUnavailableError);
    expect(requestedTimeouts).toEqual([AI_TIMEOUT_MS]);
  });
});

describe("synthetic recipients are never sent to (M-SEEDPHONE)", () => {
  const SYNTHETIC_FORMS = ["+919000000001", "+91 90000 00042", "919000000099", "09000000007", "9000000063", "+91-90000-00010"];

  it.each(SYNTHETIC_FORMS)("%s is in the synthetic range", (phone) => {
    expect(isSyntheticPhone(phone)).toBe(true);
  });

  it.each(["+919812300045", "+919000001000", "+14155238886", "", "not a phone"])("%s is not", (phone) => {
    expect(isSyntheticPhone(phone)).toBe(false);
  });

  it("the prefix covers +91 90000 000xx", () => {
    expect(SYNTHETIC_PHONE_PREFIX).toBe("+9190000000");
  });

  const realProviders: Array<[string, (to: string) => Promise<MessagingSendResult>]> = [
    ["MSG91 SMS", (to) => new Msg91Provider({ authKey: "k", senderId: "s" }).sendSms(to, "t", {})],
    ["MSG91 WhatsApp", (to) => new Msg91Provider({ authKey: "k", senderId: "s" }).sendWhatsApp(to, CATALOGUE_TEMPLATE, {})],
    ["Gupshup WhatsApp", (to) => new GupshupProvider({ apiKey: "k", appName: "a", srcPhone: "1" }).sendWhatsApp(to, "t", {})],
    ["Twilio SMS", (to) => new TwilioProvider({ accountSid: "AC0", authToken: "x", fromPhone: "+10000000000" }).sendSms(to, "t", {})],
    ["Twilio WhatsApp", (to) => new TwilioProvider({ accountSid: "AC0", authToken: "x", fromPhone: "+10000000000" }).sendWhatsApp(to, "t", {})],
  ];

  it.each(realProviders)("%s refuses a synthetic recipient without any HTTP call, not retryable", async (_label, send) => {
    const fetchStub = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);
    for (const phone of SYNTHETIC_FORMS) {
      const result = await send(phone);
      expect(result).toMatchObject({ success: false, retryable: false, error: "Recipient is a synthetic test number" });
    }
    expect(fetchStub).not.toHaveBeenCalled();
    // A non-synthetic recipient still reaches the (stubbed) provider.
    await send(REAL_LOOKING);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});
