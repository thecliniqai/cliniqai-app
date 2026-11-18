/**
 * V2-04 04-00b (PO decision 2026-11-13: Resend now, SES after go-live): the Resend sender, with no network.
 *
 * Every call goes to a loopback fake of Resend's `POST /emails` (tests/helpers/fake-resend-server.ts) through a
 * transport that accepts only the real Resend URL, so the spec proves the URL, the method, the headers (bearer key,
 * idempotency key) and the body (one recipient, both bodies) the sender produces; that a hung call is aborted with
 * `resend_timeout` inside the Send Email hook's budget; that 4xx/5xx answers, redirects and a missing id map to fixed
 * codes; and that no error carries the key, the recipient or the body. Each case fails without `lib/email/resend.ts`.
 * The API key is synthetic and assembled at run time.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { HOOK_SEND_BUDGET_MS } from "@/app/api/auth/send-email/route";
import { EmailConfigError, EmailSendError, getEmailSender, type EmailMessage } from "@/lib/email";
import { RESEND_API_URL, RESEND_REQUEST_TIMEOUT_MS, ResendEmailSender } from "@/lib/email/resend";
import { parseEnv, type Env } from "@/lib/env";
import { fetchVia, startFakeResend, type FakeResendServer } from "../helpers/fake-resend-server";
import { LOCAL_SEND_EMAIL_HOOK_SECRET } from "../setup/test-env";

const KEY = ["re", "SyntheticSenderSpecKey00000000"].join("_");
const FROM = "no-reply@auth.synthetic-clinic.example.org";
const CODE = "246801";
const MESSAGE: EmailMessage = {
  to: "resend-recovery@example.com",
  subject: "Your ClinicOS password reset code",
  html: `<p>Your password reset code is:</p><p>${CODE}</p>`,
  text: `Your password reset code is:\n${CODE}\n`,
  tag: "auth-recovery",
};

let fake: FakeResendServer;
let seen: string[];

function sender(options: { timeoutMs?: number; key?: string } = {}): ResendEmailSender {
  seen = [];
  return new ResendEmailSender({ apiKey: options.key ?? KEY, from: FROM, fetchImpl: fetchVia(fake, seen), timeoutMs: options.timeoutMs });
}

/** Rejects with the sender's error; asserts no sensitive value reached it. */
async function failure(p: Promise<unknown>): Promise<EmailSendError> {
  const err = await p.then(
    () => {
      throw new Error("expected the send to fail");
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(EmailSendError);
  const text = `${(err as Error).message} ${(err as EmailSendError).code} ${JSON.stringify(err)}`;
  for (const value of [KEY, MESSAGE.to, CODE]) expect(text).not.toContain(value);
  return err as EmailSendError;
}

beforeAll(async () => {
  fake = await startFakeResend(KEY);
});
afterEach(() => {
  fake.reset();
  vi.useRealTimers();
});
afterAll(async () => {
  await fake.close();
});

describe("ResendEmailSender: the request", () => {
  it("POSTs once to https://api.resend.com/emails with the bearer key, JSON, the idempotency key and no redirect", async () => {
    const result = await sender().send(MESSAGE, { idempotencyKey: "auth-email/abc123/0" });
    expect(result).toEqual({ providerMessageId: "fake-resend-1" });
    expect(seen).toEqual([RESEND_API_URL]);
    expect(RESEND_API_URL).toBe("https://api.resend.com/emails");
    expect(fake.requests).toHaveLength(1);
    const [req] = fake.requests;
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/emails");
    expect(req.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.headers["idempotency-key"]).toBe("auth-email/abc123/0");
  });

  it("the body carries from, exactly one recipient, the subject, both the HTML and the text body and the category tag", async () => {
    await sender().send(MESSAGE);
    expect(fake.requests[0].body).toEqual({
      from: FROM,
      to: [MESSAGE.to],
      subject: MESSAGE.subject,
      html: MESSAGE.html,
      text: MESSAGE.text,
      tags: [{ name: "category", value: "auth-recovery" }],
    });
    // No idempotency key was given, so none is sent.
    expect(fake.requests[0].headers["idempotency-key"]).toBeUndefined();
  });

  it("a repeated idempotency key delivers once (the fake keeps keys like Resend does)", async () => {
    const s = sender();
    const first = await s.send(MESSAGE, { idempotencyKey: "auth-email/same/0" });
    const second = await s.send(MESSAGE, { idempotencyKey: "auth-email/same/0" });
    expect(second).toEqual(first);
    expect(fake.requests).toHaveLength(2);
    expect(fake.delivered).toHaveLength(1);
  });

  it("refuses an idempotency key of an unexpected shape before any request", async () => {
    await expect(sender().send(MESSAGE, { idempotencyKey: "has space\r\nx-injected: 1" })).rejects.toBeInstanceOf(EmailConfigError);
    await expect(sender().send(MESSAGE, { idempotencyKey: "k".repeat(257) })).rejects.toMatchObject({ code: "resend_idempotency_key" });
    expect(fake.requests).toHaveLength(0);
  });

  it("refuses to construct without a key or a sender address", () => {
    expect(() => new ResendEmailSender({ apiKey: "", from: FROM })).toThrow(EmailConfigError);
    expect(() => new ResendEmailSender({ apiKey: KEY, from: "" })).toThrow(EmailConfigError);
  });
});

describe("ResendEmailSender: timeouts and aborts", () => {
  it("its own deadline is inside the Send Email hook's budget", () => {
    expect(RESEND_REQUEST_TIMEOUT_MS).toBeLessThan(HOOK_SEND_BUDGET_MS);
  });

  it("a call that never answers is aborted at RESEND_REQUEST_TIMEOUT_MS and mapped to resend_timeout", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const hung = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_, reject) => signal?.addEventListener("abort", () => reject(signal?.reason)));
    });
    const s = new ResendEmailSender({ apiKey: KEY, from: FROM, fetchImpl: hung as unknown as typeof fetch });
    let settled = false;
    const pending = s.send(MESSAGE).finally(() => {
      settled = true;
    });
    pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(RESEND_REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await failure(pending)).code).toBe("resend_timeout");
    expect(signal?.aborted).toBe(true);
  });

  it("over real HTTP: a hung Resend answer becomes resend_timeout after the configured deadline, not later", async () => {
    fake.mode = { kind: "hang" };
    const started = Date.now();
    const err = await failure(sender({ timeoutMs: 300 }).send(MESSAGE));
    const elapsed = Date.now() - started;
    expect(err.code).toBe("resend_timeout");
    expect(elapsed).toBeGreaterThanOrEqual(290);
    expect(elapsed).toBeLessThan(HOOK_SEND_BUDGET_MS);
    expect(fake.requests).toHaveLength(1);
  });

  it("the caller's abort (the hook's budget) ends the call as resend_aborted", async () => {
    fake.mode = { kind: "hang" };
    const controller = new AbortController();
    const pending = sender().send(MESSAGE, { signal: controller.signal });
    setTimeout(() => controller.abort(new Error("budget")), 100);
    expect((await failure(pending)).code).toBe("resend_aborted");
    const already = new AbortController();
    already.abort();
    expect((await failure(sender().send(MESSAGE, { signal: already.signal }))).code).toBe("resend_aborted");
  });
});

describe("ResendEmailSender: error mapping", () => {
  it.each([400, 401, 403, 404, 409, 422, 429, 500, 502, 503])(
    "HTTP %i becomes EmailSendError resend_http_%i, without the provider's message (it quotes the recipient)",
    async (status) => {
      fake.mode = { kind: "status", status };
      expect((await failure(sender().send(MESSAGE))).code).toBe(`resend_http_${status}`);
    },
  );

  it("a wrong key is refused by the API as 401 and mapped, never echoing the key", async () => {
    const wrong = ["re", "SyntheticWrongSpecKey0000000"].join("_");
    const err = await failure(sender({ key: wrong }).send(MESSAGE));
    expect(err.code).toBe("resend_http_401");
    expect(JSON.stringify(err)).not.toContain(wrong);
  });

  it("a redirect is not followed (the bearer key never goes elsewhere): resend_unreachable", async () => {
    const elsewhere = await startFakeResend(KEY);
    try {
      fake.mode = { kind: "redirect", location: `${elsewhere.url}/emails` };
      expect((await failure(sender().send(MESSAGE))).code).toBe("resend_unreachable");
      expect(elsewhere.requests).toHaveLength(0);
    } finally {
      await elsewhere.close();
    }
  });

  it("a refused connection is resend_unreachable; a 200 without an id is resend_no_id", async () => {
    const closed = await startFakeResend(KEY);
    const url = closed.url;
    await closed.close();
    const s = new ResendEmailSender({ apiKey: KEY, from: FROM, fetchImpl: fetchVia({ url }) });
    expect((await failure(s.send(MESSAGE))).code).toBe("resend_unreachable");

    const noId = new ResendEmailSender({
      apiKey: KEY,
      from: FROM,
      fetchImpl: (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch,
    });
    expect((await failure(noId.send(MESSAGE))).code).toBe("resend_no_id");
  });
});

describe("getEmailSender: EMAIL_PROVIDER=resend", () => {
  const base = {
    NODE_ENV: "test",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable",
  };

  it("builds the Resend sender from RESEND_API_KEY and EMAIL_FROM", () => {
    const env = parseEnv({ ...base, EMAIL_PROVIDER: "resend", RESEND_API_KEY: KEY, EMAIL_FROM: FROM, SEND_EMAIL_HOOK_SECRET: LOCAL_SEND_EMAIL_HOOK_SECRET });
    const s = getEmailSender(env);
    expect(s).toBeInstanceOf(ResendEmailSender);
    expect(s.provider).toBe("resend");
  });

  it("refuses (EmailConfigError resend_config) when the key is missing, never falling back to another sender", () => {
    const env = { ...parseEnv(base), EMAIL_PROVIDER: "resend", EMAIL_FROM: FROM } as Env;
    expect(() => getEmailSender(env)).toThrow(expect.objectContaining({ code: "resend_config" }));
  });
});
