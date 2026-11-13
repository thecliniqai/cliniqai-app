/**
 * V2-04 04-00b: the Send Email hook end to end with `EMAIL_PROVIDER=resend`, against a loopback fake of Resend.
 *
 * Nothing is mocked inside the app: the env schema parses the stubbed configuration, `getEmailSender()` builds the real
 * `ResendEmailSender`, and only the global transport is replaced by one that sends calls for the real Resend URL to the
 * fake (and refuses every other URL). The fake honours `Idempotency-Key` like Resend. Proven:
 *   - a signed `recovery` call sends exactly one message, keyed by the `webhook-id` (`idempotencyKeyFor`);
 *   - GoTrue retries never send twice: a retry on the same instance is answered from the route's memory, and a retry
 *     that reaches another instance (memory empty) repeats the same key, so the fake delivers nothing new;
 *   - `email_change` sends two messages with two keys, once each, across retries;
 *   - a provider failure answers 500 and the retry sends once, with the same key;
 *   - a hung provider answers 500 (`resend_timeout`) inside the hook budget, under GoTrue's 5 s timeout;
 *   - no log line carries the key, an address, a code or a token hash.
 * Fails without the change: there is no `resend` provider, no sender and no idempotency key before 04-00b.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  GOTRUE_HOOK_TIMEOUT_MS,
  HOOK_SEND_BUDGET_MS,
  POST,
  idempotencyKeyFor,
  resetHookDedupeForTests,
} from "@/app/api/auth/send-email/route";
import { RESEND_API_URL, RESEND_REQUEST_TIMEOUT_MS } from "@/lib/email/resend";
import { fetchVia, startFakeResend, type FakeResendServer } from "../helpers/fake-resend-server";
import { signedWebhookHeaders } from "../security/guard/engine";
import { LOCAL_SEND_EMAIL_HOOK_SECRET } from "../setup/test-env";

// V2-04 04-03c: this spec isolates Resend's own idempotency key (the second line of defence across instances). The
// shared webhook-id store (features/auth/system, R-43) is bypassed here, as for an id it does not record; it is proven
// against the local stack in tests/integration/auth/send-email-hook-dedupe-db.spec.ts. (Its DB calls would otherwise go
// through this spec's Resend-only global fetch stub.)
vi.mock("@/features/auth/system", () => ({
  authHookDeliveryBegin: async () => "skipped",
  authHookDeliveryFinish: async () => undefined,
}));

const ROOT = path.resolve(__dirname, "../..");
/** Synthetic, assembled at run time (no key-shaped literal in the repo). */
const KEY = ["re", "SyntheticHookSpecKey000000000"].join("_");
const FROM = "no-reply@auth.synthetic-clinic.example.org";

type Fixture = { user: Record<string, unknown>; email_data: Record<string, string> } & Record<string, unknown>;

function fixture(name: string): Fixture {
  return JSON.parse(readFileSync(path.join(ROOT, "lint-fixtures/auth-hook", `${name}.json`), "utf8")) as Fixture;
}

const SENSITIVE: string[] = [KEY];
for (const name of ["recovery", "email_change"]) {
  const f = fixture(name);
  for (const v of [f.user.email, f.user.new_email, f.email_data.token, f.email_data.token_new, f.email_data.token_hash]) {
    if (typeof v === "string" && v.length > 0) SENSITIVE.push(v);
  }
}

let fake: FakeResendServer;
let seen: string[];
let logLines: string[];

/** One signed GoTrue delivery; `send()` posts it (again), as GoTrue does on a retry. */
function delivery(name: string) {
  const body = JSON.stringify(fixture(name));
  const headers = signedWebhookHeaders(LOCAL_SEND_EMAIL_HOOK_SECRET, body);
  return {
    webhookId: headers["webhook-id"],
    async send() {
      const res = await POST(
        new NextRequest("http://localhost/api/auth/send-email", {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body,
        }),
      );
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    },
  };
}

function logged(): Array<Record<string, unknown>> {
  return logLines.map((l) => JSON.parse(l) as Record<string, unknown>);
}

beforeAll(async () => {
  fake = await startFakeResend(KEY);
});
afterAll(async () => {
  await fake.close();
});

beforeEach(() => {
  resetHookDedupeForTests();
  fake.reset();
  seen = [];
  logLines = [];
  vi.stubEnv("EMAIL_PROVIDER", "resend");
  vi.stubEnv("RESEND_API_KEY", KEY);
  vi.stubEnv("EMAIL_FROM", FROM);
  vi.stubEnv("SEND_EMAIL_HOOK_SECRET", LOCAL_SEND_EMAIL_HOOK_SECRET);
  vi.stubGlobal("fetch", fetchVia(fake, seen));
  const capture = (chunk: unknown) => {
    const text = String(chunk);
    if (text.includes('"event":"auth.email.')) logLines.push(...text.trim().split("\n"));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capture);
  vi.spyOn(process.stderr, "write").mockImplementation(capture);
});

afterEach(() => {
  const all = logLines.join("\n");
  for (const value of SENSITIVE) expect(all, "a log line carries a key, an address or a code").not.toContain(value);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Send Email hook with EMAIL_PROVIDER=resend (04-00b)", () => {
  it("a signed recovery call sends one message to Resend, keyed by the webhook-id, carrying the code in both bodies", async () => {
    const f = fixture("recovery");
    const d = delivery("recovery");
    expect(await d.send()).toEqual({ status: 200, json: {} });

    expect(seen).toEqual([RESEND_API_URL]);
    expect(fake.requests).toHaveLength(1);
    const [req] = fake.requests;
    expect(req.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(req.headers["idempotency-key"]).toBe(idempotencyKeyFor(d.webhookId, 0));
    expect(req.headers["idempotency-key"]).toMatch(/^auth-email\/[0-9a-f]{64}\/0$/);
    expect(req.body).toMatchObject({ from: FROM, to: [f.user.email], subject: "Your ClinicOS password reset code" });
    expect(String(req.body?.text)).toContain(f.email_data.token);
    expect(String(req.body?.html)).toContain(f.email_data.token);
    expect(fake.delivered).toHaveLength(1);
    expect(logged()).toEqual([
      expect.objectContaining({ event: "auth.email.sent", action: "recovery", module: "auth.email.resend", count: 1 }),
    ]);
  });

  it("GoTrue retries send once: same instance from memory, another instance through the idempotency key", async () => {
    const d = delivery("recovery");
    expect((await d.send()).status).toBe(200);
    // Same instance: answered from the route's webhook-id memory, Resend is not called again.
    expect((await d.send()).status).toBe(200);
    expect(fake.requests).toHaveLength(1);

    // Another instance (its memory is empty): Resend is called with the same key and delivers nothing new.
    resetHookDedupeForTests();
    expect((await d.send()).status).toBe(200);
    resetHookDedupeForTests();
    expect((await d.send()).status).toBe(200);
    expect(fake.requests).toHaveLength(3);
    expect(new Set(fake.requests.map((r) => r.headers["idempotency-key"]))).toEqual(new Set([idempotencyKeyFor(d.webhookId, 0)]));
    expect(fake.delivered).toHaveLength(1);

    // A different delivery (another webhook-id) is a different key and is sent.
    expect((await delivery("recovery").send()).status).toBe(200);
    expect(fake.delivered).toHaveLength(2);
  });

  it("email_change sends two messages with two keys, each delivered once across a cross-instance retry", async () => {
    const f = fixture("email_change");
    const d = delivery("email_change");
    expect((await d.send()).status).toBe(200);
    resetHookDedupeForTests();
    expect((await d.send()).status).toBe(200);
    expect(fake.requests).toHaveLength(4);
    expect(fake.delivered.map((m) => [m.to, m.idempotencyKey]).sort()).toEqual(
      [
        [[f.user.email], idempotencyKeyFor(d.webhookId, 0)],
        [[f.user.new_email], idempotencyKeyFor(d.webhookId, 1)],
      ].sort(),
    );
  });

  it("a provider failure answers 500; GoTrue's retry sends once, with the same key", async () => {
    fake.queue.push({ kind: "status", status: 500 });
    const d = delivery("recovery");
    expect(await d.send()).toEqual({ status: 500, json: { error: { http_code: 500, message: "Email could not be sent" } } });
    expect(logged()).toEqual([
      expect.objectContaining({ event: "auth.email.failed", module: "auth.email.resend", code: "resend_http_500", status: 500 }),
    ]);
    expect((await d.send()).status).toBe(200);
    expect(fake.requests.map((r) => r.headers["idempotency-key"])).toEqual([
      idempotencyKeyFor(d.webhookId, 0),
      idempotencyKeyFor(d.webhookId, 0),
    ]);
    expect(fake.delivered).toHaveLength(1);
  });

  it("a hung Resend answers 500 (resend_timeout) inside the hook budget, before GoTrue's timeout", async () => {
    fake.mode = { kind: "hang" };
    const started = Date.now();
    const res = await delivery("recovery").send();
    const elapsed = Date.now() - started;
    expect(res).toEqual({ status: 500, json: { error: { http_code: 500, message: "Email could not be sent" } } });
    expect(elapsed).toBeGreaterThanOrEqual(RESEND_REQUEST_TIMEOUT_MS - 50);
    expect(elapsed).toBeLessThan(HOOK_SEND_BUDGET_MS);
    expect(elapsed).toBeLessThan(GOTRUE_HOOK_TIMEOUT_MS);
    expect(logged()).toEqual([expect.objectContaining({ event: "auth.email.failed", code: "resend_timeout", status: 500 })]);
    expect(fake.delivered).toHaveLength(0);
  }, 10_000);

  it("a wrong key is a 500 with code resend_http_401, never the key", async () => {
    vi.stubEnv("RESEND_API_KEY", ["re", "SyntheticOtherHookKey0000000"].join("_"));
    expect((await delivery("recovery").send()).status).toBe(500);
    expect(logged()).toEqual([expect.objectContaining({ event: "auth.email.failed", code: "resend_http_401" })]);
    expect(logLines.join("\n")).not.toContain("SyntheticOtherHookKey");
  });
});
