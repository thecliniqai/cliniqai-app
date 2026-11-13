/**
 * V2-03 03-11b (AUTH-03, A00-1; threats T-03-05, T-03-06): the Supabase Auth Send Email hook route.
 *
 * Signed synthetic payloads (`lint-fixtures/auth-hook/*.json`, the spike E3 key lists) go through `POST` with a
 * recording sender in place of SES/Mailpit, except where the real `disabled` sender is the subject. Each case fails
 * without the route: there is no handler, no signature check, no magiclink drop and no code-only rendering before it.
 * Every log line the route writes is captured and must carry no address, no code and no token hash.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { EmailSendError, type EmailMessage } from "@/lib/email";
import { renderAuthEmail } from "@/lib/email/templates/auth";
import { POST } from "@/app/api/auth/send-email/route";
import { LOCAL_SEND_EMAIL_HOOK_SECRET } from "../setup/test-env";
import { signedWebhookHeaders } from "../security/guard/engine";

const ROOT = path.resolve(__dirname, "../..");

/** `null` = the real `getEmailSender()` (driven by EMAIL_PROVIDER); otherwise this fake. */
const fake = vi.hoisted(() => ({
  sender: null as null | { provider: "mailpit"; send: (m: EmailMessage) => Promise<{ providerMessageId: string }> },
}));

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, getEmailSender: () => fake.sender ?? actual.getEmailSender() };
});

type Fixture = { user: Record<string, unknown>; email_data: Record<string, string> } & Record<string, unknown>;

function fixture(name: string): Fixture {
  return JSON.parse(readFileSync(path.join(ROOT, "lint-fixtures/auth-hook", `${name}.json`), "utf8")) as Fixture;
}

const FIXTURES = ["signup", "recovery", "invite", "magiclink", "email_change", "password_changed_notification", "reauthentication"];

/** Every address, code and token hash in the fixtures: none may reach a log line. */
const SENSITIVE: string[] = FIXTURES.flatMap((name) => {
  const f = fixture(name);
  return [
    f.user.email as string,
    (f.user.new_email as string | undefined) ?? "",
    f.email_data.token,
    f.email_data.token_new,
    f.email_data.token_hash,
  ].filter((v) => v.length > 0);
});

let sent: EmailMessage[];
let logLines: string[];

function recordingSender() {
  return {
    provider: "mailpit" as const,
    send: async (m: EmailMessage) => {
      sent.push(m);
      return { providerMessageId: `recorded-${sent.length}` };
    },
  };
}

function request(body: string, headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/auth/send-email", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

async function call(payload: unknown, options: { secret?: string; at?: Date; headers?: Record<string, string> } = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const headers = options.headers ?? signedWebhookHeaders(options.secret ?? LOCAL_SEND_EMAIL_HOOK_SECRET, body, options.at);
  const res = await POST(request(body, headers));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function logged(): Array<Record<string, unknown>> {
  return logLines.map((l) => JSON.parse(l) as Record<string, unknown>);
}

beforeEach(() => {
  sent = [];
  logLines = [];
  fake.sender = recordingSender();
  vi.stubEnv("SEND_EMAIL_HOOK_SECRET", LOCAL_SEND_EMAIL_HOOK_SECRET);
  const capture = (chunk: unknown) => {
    const text = String(chunk);
    if (text.includes('"event":"auth.email.')) logLines.push(...text.trim().split("\n"));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capture);
  vi.spyOn(process.stderr, "write").mockImplementation(capture);
});

afterEach(() => {
  // No address, code or token hash in any line the route wrote, whatever the case.
  const all = logLines.join("\n");
  for (const value of SENSITIVE) expect(all, "a log line carries a fixture value").not.toContain(value);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Send Email hook: delivery (signature valid)", () => {
  it("recovery → 200 after exactly one send to the user, whose text and HTML carry the code and no link", async () => {
    const f = fixture("recovery");
    const res = await call(f);
    expect(res).toEqual({ status: 200, json: {} });
    expect(sent).toHaveLength(1);
    const [m] = sent;
    expect(m.to).toBe(f.user.email);
    expect(m.subject).toBe("Your ClinicOS password reset code");
    expect(m.tag).toBe("auth-recovery");
    expect(m.text).toContain(f.email_data.token);
    expect(m.html).toContain(f.email_data.token);
    for (const body of [m.text, m.html]) {
      expect(body).not.toMatch(/https?:|href=|www\./i);
      expect(body).not.toContain(f.email_data.token_hash);
    }
    expect(logged()).toEqual([
      expect.objectContaining({ event: "auth.email.sent", level: "info", action: "recovery", module: "auth.email.mailpit", count: 1 }),
    ]);
  });

  it.each([
    ["signup", "Your ClinicOS confirmation code", "auth-signup"],
    ["invite", "Your ClinicOS invitation code", "auth-invite"],
  ])("%s → one code email to the user", async (name, subject, tag) => {
    const f = fixture(name);
    expect((await call(f)).status).toBe(200);
    expect(sent.map((m) => [m.to, m.subject, m.tag, m.text.includes(f.email_data.token)])).toEqual([
      [f.user.email, subject, tag, true],
    ]);
  });

  it("email_change → `token` to the current address and `token_new` to the new address (secure email change)", async () => {
    const f = fixture("email_change");
    expect((await call(f)).status).toBe(200);
    expect(sent.map((m) => m.to)).toEqual([f.user.email, f.user.new_email]);
    expect(sent[0].text).toContain(f.email_data.token);
    expect(sent[0].text).not.toContain(f.email_data.token_new);
    expect(sent[1].text).toContain(f.email_data.token_new);
    expect(sent[1].text).not.toContain(f.email_data.token);
    expect(logged()[0]).toEqual(expect.objectContaining({ event: "auth.email.sent", action: "email_change", count: 2 }));
  });

  it("password_changed_notification is passed (03-11a): one code-free security notice to the user", async () => {
    const f = fixture("password_changed_notification");
    expect((await call(f)).status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(f.user.email);
    expect(sent[0].subject).toBe("Your ClinicOS password was changed");
    expect(sent[0].tag).toBe("auth-password-changed");
    expect(sent[0].text).not.toMatch(/[0-9]{6}/);
    expect(sent[0].html).not.toMatch(/[0-9]{6}|https?:|href=/);
  });

  it("accepts the right signature among several (secret rotation: GoTrue signs with every configured secret)", async () => {
    const f = fixture("recovery");
    const body = JSON.stringify(f);
    const good = signedWebhookHeaders(LOCAL_SEND_EMAIL_HOOK_SECRET, body);
    const other = signedWebhookHeaders(`v1,whsec_${Buffer.alloc(32, 9).toString("base64")}`, body);
    const headers = { ...good, "webhook-signature": `${other["webhook-signature"]} ${good["webhook-signature"]}` };
    expect((await call(body, { headers })).status).toBe(200);
    expect(sent).toHaveLength(1);
  });
});

describe("Send Email hook: drops (A00-1 and default deny)", () => {
  it("magiclink → 200 and zero sends, logged as dropped with reason magiclink", async () => {
    expect(await call(fixture("magiclink"))).toEqual({ status: 200, json: {} });
    expect(sent).toEqual([]);
    expect(logged()).toEqual([
      expect.objectContaining({ event: "auth.email.dropped", level: "info", action: "magiclink", reason: "magiclink" }),
    ]);
  });

  it("an action the app does not use (reauthentication) → 200 and zero sends", async () => {
    expect((await call(fixture("reauthentication"))).status).toBe(200);
    expect(sent).toEqual([]);
    expect(logged()[0]).toEqual(
      expect.objectContaining({ event: "auth.email.dropped", action: "reauthentication", reason: "unsupported_action" }),
    );
  });

  it("an unknown action type → 200 and zero sends; an odd action string is not echoed into the log", async () => {
    const f = fixture("recovery");
    expect((await call({ ...f, email_data: { ...f.email_data, email_action_type: "brand_new_type" } })).status).toBe(200);
    expect((await call({ ...f, email_data: { ...f.email_data, email_action_type: "Weird Type <x>" } })).status).toBe(200);
    expect(sent).toEqual([]);
    expect(logged().map((l) => l.action)).toEqual(["brand_new_type", "unrecognised"]);
  });
});

describe("Send Email hook: refusals (T-03-05)", () => {
  it("a bad signature → 401 in the hook error shape, zero sends, and the body is not even parsed", async () => {
    const f = fixture("recovery");
    const body = JSON.stringify(f);
    const headers = { ...signedWebhookHeaders(LOCAL_SEND_EMAIL_HOOK_SECRET, body), "webhook-signature": "v1,AAAA" };
    expect(await call(body, { headers })).toEqual({ status: 401, json: { error: { http_code: 401, message: "Invalid signature" } } });
    expect((await call("not json at all", { headers })).status).toBe(401);
    expect(sent).toEqual([]);
    expect(logged()[0]).toEqual(expect.objectContaining({ event: "auth.email.refused", reason: "bad_signature", status: 401 }));
  });

  it("missing signature headers, another secret, or a body changed after signing → 401, zero sends", async () => {
    const f = fixture("recovery");
    const body = JSON.stringify(f);
    expect((await call(body, { headers: {} })).status).toBe(401);
    expect((await call(f, { secret: `v1,whsec_${Buffer.alloc(32, 3).toString("base64")}` })).status).toBe(401);
    const signed = signedWebhookHeaders(LOCAL_SEND_EMAIL_HOOK_SECRET, body);
    const tampered = body.replace(f.user.email as string, "attacker@example.com");
    expect((await call(tampered, { headers: signed })).status).toBe(401);
    expect(sent).toEqual([]);
  });

  it("a stale timestamp (> 5 min old) or one from the future → 401, zero sends", async () => {
    const f = fixture("recovery");
    expect((await call(f, { at: new Date(Date.now() - 6 * 60_000) })).status).toBe(401);
    expect((await call(f, { at: new Date(Date.now() + 6 * 60_000) })).status).toBe(401);
    // Inside the tolerance it is accepted.
    expect((await call(f, { at: new Date(Date.now() - 2 * 60_000) })).status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("SEND_EMAIL_HOOK_SECRET unset → every call 401 (fail closed), zero sends", async () => {
    vi.stubEnv("SEND_EMAIL_HOOK_SECRET", undefined);
    expect((await call(fixture("recovery"))).status).toBe(401);
    expect(sent).toEqual([]);
    expect(logged()[0]).toEqual(expect.objectContaining({ event: "auth.email.refused", reason: "no_secret" }));
  });

  it("a body over 64 KiB → 413 before the signature is computed, zero sends", async () => {
    const f = fixture("recovery");
    const big = { ...f, padding: "x".repeat(70 * 1024) };
    expect((await call(big)).status).toBe(413);
    expect(sent).toEqual([]);
  });

  it("a signed but malformed payload → 400, zero sends", async () => {
    expect((await call("{ not json")).status).toBe(400);
    expect((await call({ user: {}, email_data: { email_action_type: "recovery", token: "246801" } })).status).toBe(400);
    const f = fixture("email_change");
    // Secure email change needs both codes and both addresses; anything else is refused rather than half-sent.
    expect((await call({ ...f, email_data: { ...f.email_data, token_new: "" } })).status).toBe(400);
    expect((await call({ ...f, user: { ...f.user, new_email: "" } })).status).toBe(400);
    expect(sent).toEqual([]);
  });
});

describe("Send Email hook: sender failures surface to Supabase Auth", () => {
  it("a provider failure → 500 in the hook error shape, logged by error code only", async () => {
    fake.sender = {
      provider: "mailpit",
      send: async () => {
        throw new EmailSendError("MessageRejected");
      },
    };
    expect(await call(fixture("recovery"))).toEqual({
      status: 500,
      json: { error: { http_code: 500, message: "Email could not be sent" } },
    });
    expect(logged()).toEqual([
      expect.objectContaining({ event: "auth.email.failed", level: "error", action: "recovery", code: "MessageRejected", status: 500 }),
    ]);
  });

  it("EMAIL_PROVIDER=disabled (the real sender) → 503 'Email delivery is disabled', nothing sent", async () => {
    fake.sender = null;
    vi.stubEnv("EMAIL_PROVIDER", "disabled");
    expect(await call(fixture("recovery"))).toEqual({
      status: 503,
      json: { error: { http_code: 503, message: "Email delivery is disabled" } },
    });
    expect(sent).toEqual([]);
    expect(logged()[0]).toEqual(
      expect.objectContaining({ event: "auth.email.failed", module: "auth.email.disabled", code: "email_disabled", status: 503 }),
    );
  });

  it("the default (EMAIL_PROVIDER unset outside staging/production) is disabled too", async () => {
    fake.sender = null;
    vi.stubEnv("EMAIL_PROVIDER", undefined);
    expect((await call(fixture("recovery"))).status).toBe(503);
  });

  it("magiclink is still dropped with 200 when email is disabled (the drop needs no provider)", async () => {
    fake.sender = null;
    vi.stubEnv("EMAIL_PROVIDER", "disabled");
    expect((await call(fixture("magiclink"))).status).toBe(200);
  });
});

describe("code-only templates match supabase/templates (the SMTP fallback's copy)", () => {
  it.each([
    ["signup", "confirmation.html"],
    ["recovery", "recovery.html"],
    ["email_change", "email_change.html"],
  ] as const)("%s HTML equals %s with the code in place of {{ .Token }}", (kind, file) => {
    const template = readFileSync(path.join(ROOT, "supabase/templates", file), "utf8");
    expect(renderAuthEmail(kind, "246801").html.trimEnd()).toBe(template.replace("{{ .Token }}", "246801").trimEnd());
  });

  it("password_changed HTML equals supabase/templates/password_changed.html (no code)", () => {
    const template = readFileSync(path.join(ROOT, "supabase/templates/password_changed.html"), "utf8");
    expect(renderAuthEmail("password_changed").html.trimEnd()).toBe(template.trimEnd());
  });

  it("refuses a code that is not a digit string (no markup or link can be injected)", () => {
    for (const code of [undefined, "", "12345", "<a href=x>1</a>", "123456 https://x.example"]) {
      expect(() => renderAuthEmail("recovery", code)).toThrow(/digit string/);
    }
  });
});
