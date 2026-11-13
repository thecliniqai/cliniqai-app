/**
 * V2-03 03-11b (AUTH-03): the Mailpit sender and the Send Email hook path against the local stack's Mailpit.
 *
 * - A message sent through `MailpitEmailSender` is readable from the Mailpit API with the expected subject; a
 *   non-loopback URL or a deployment tier is refused before anything is sent.
 * - The hook path: a signed synthetic `recovery` payload goes through `POST /api/auth/send-email` with
 *   `EMAIL_PROVIDER=mailpit`; exactly one code email reaches Mailpit for that address, carrying the payload's code
 *   and no link. A signed `magiclink` payload for another address reaches Mailpit zero times; a
 *   `password_changed_notification` once; a forged call zero times.
 *
 * Local GoTrue keeps its own SMTP path (the hook is off in `config.toml`: on Linux CI its container cannot reach a
 * loopback app server), so these calls stand in for it. Addresses are synthetic; codes are never printed.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/send-email/route";
import { EmailConfigError } from "@/lib/email";
import { MailpitEmailSender } from "@/lib/email/mailpit";
import { signedWebhookHeaders } from "../../security/guard/engine";
import { LOCAL_MAILPIT_API_URL, LOCAL_SEND_EMAIL_HOOK_SECRET } from "../../setup/test-env";

const ROOT = path.resolve(__dirname, "../../..");
const FROM = "no-reply@auth.example.com";
const SETTLE_MS = 1_500;

interface MailpitSummary {
  ID: string;
  Subject: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function address(label: string): string {
  return `hook-${label}-${Date.now()}-${randomBytes(3).toString("hex")}@example.com`;
}

async function mailFor(to: string): Promise<MailpitSummary[]> {
  const res = await fetch(`${LOCAL_MAILPIT_API_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  if (!res.ok) throw new Error(`Mailpit search failed (HTTP ${res.status})`);
  return ((await res.json()) as { messages?: MailpitSummary[] }).messages ?? [];
}

async function message(id: string): Promise<{ Subject: string; Text: string; HTML: string; From: { Address: string } }> {
  const res = await fetch(`${LOCAL_MAILPIT_API_URL}/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`Mailpit message read failed (HTTP ${res.status})`);
  return (await res.json()) as { Subject: string; Text: string; HTML: string; From: { Address: string } };
}

function fixture(name: string, email: string): Record<string, unknown> {
  const f = JSON.parse(readFileSync(path.join(ROOT, "lint-fixtures/auth-hook", `${name}.json`), "utf8")) as {
    user: Record<string, unknown>;
  };
  return { ...f, user: { ...f.user, email } };
}

async function hook(payload: Record<string, unknown>): Promise<number> {
  const body = JSON.stringify(payload);
  const res = await POST(
    new NextRequest("http://localhost/api/auth/send-email", {
      method: "POST",
      headers: { "content-type": "application/json", ...signedWebhookHeaders(LOCAL_SEND_EMAIL_HOOK_SECRET, body) },
      body,
    }),
  );
  return res.status;
}

function useMailpitHook() {
  vi.stubEnv("SEND_EMAIL_HOOK_SECRET", LOCAL_SEND_EMAIL_HOOK_SECRET);
  vi.stubEnv("EMAIL_PROVIDER", "mailpit");
  vi.stubEnv("MAILPIT_API_URL", LOCAL_MAILPIT_API_URL);
  vi.stubEnv("EMAIL_FROM", FROM);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("MailpitEmailSender (local stack)", () => {
  it("a sent message is readable from the Mailpit API with the expected subject, sender and bodies", async () => {
    const to = address("sender");
    const sender = new MailpitEmailSender({ apiUrl: LOCAL_MAILPIT_API_URL, from: FROM, appEnv: "test" });
    const subject = `Synthetic 03-11b message ${randomBytes(4).toString("hex")}`;
    const { providerMessageId } = await sender.send({ to, subject, html: "<p>synthetic html</p>", text: "synthetic text", tag: "auth-recovery" });
    expect(providerMessageId).toMatch(/\S+/);
    const found = await mailFor(to);
    expect(found).toHaveLength(1);
    expect(found[0].ID).toBe(providerMessageId);
    const msg = await message(found[0].ID);
    expect(msg.Subject).toBe(subject);
    expect(msg.From.Address).toBe(FROM);
    expect(msg.Text.trim()).toBe("synthetic text");
    expect(msg.HTML).toContain("synthetic html");
  });

  it("refuses a non-loopback URL or a deployment tier before sending anything", () => {
    const fetchImpl = vi.fn();
    for (const apiUrl of ["http://mail.example.org:8025", "https://10.0.0.5", "file:///tmp/x", "not a url"]) {
      expect(() => new MailpitEmailSender({ apiUrl, from: FROM, appEnv: "test", fetchImpl })).toThrow(EmailConfigError);
    }
    for (const appEnv of ["staging", "production"] as const) {
      expect(() => new MailpitEmailSender({ apiUrl: LOCAL_MAILPIT_API_URL, from: FROM, appEnv, fetchImpl })).toThrow(
        /Mailpit is not allowed/,
      );
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a Mailpit error status is a failure, not a delivery", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 400 }));
    const sender = new MailpitEmailSender({ apiUrl: LOCAL_MAILPIT_API_URL, from: FROM, appEnv: "test", fetchImpl });
    await expect(sender.send({ to: address("err"), subject: "s", html: "h", text: "t", tag: "auth-recovery" })).rejects.toMatchObject({
      name: "EmailSendError",
      code: "mailpit_http_400",
    });
  });
});

describe("Send Email hook path → Mailpit (local stack)", () => {
  it("recovery: exactly one code email reaches Mailpit for the user, carrying the payload's code and no link", async () => {
    useMailpitHook();
    const email = address("recovery");
    const payload = fixture("recovery", email);
    const code = (payload.email_data as Record<string, string>).token;
    expect(await hook(payload)).toBe(200);

    await sleep(SETTLE_MS);
    const found = await mailFor(email);
    expect(found).toHaveLength(1);
    const msg = await message(found[0].ID);
    expect(msg.Subject).toBe("Your ClinicOS password reset code");
    expect(msg.From.Address).toBe(FROM);
    expect(/\b(\d{6})\b/.exec(msg.Text)?.[1] === code, "the mailed code is the payload's code").toBe(true);
    expect(msg.HTML).toContain(code);
    for (const part of [msg.Text, msg.HTML]) expect(part).not.toMatch(/https?:|href=/);
  });

  it("magiclink: 200 and zero emails in Mailpit (A00-1)", async () => {
    useMailpitHook();
    const email = address("magiclink");
    expect(await hook(fixture("magiclink", email))).toBe(200);
    await sleep(SETTLE_MS);
    expect(await mailFor(email)).toHaveLength(0);
  });

  it("password_changed_notification: exactly one code-free notice in Mailpit", async () => {
    useMailpitHook();
    const email = address("password-changed");
    expect(await hook(fixture("password_changed_notification", email))).toBe(200);
    await sleep(SETTLE_MS);
    const found = await mailFor(email);
    expect(found).toHaveLength(1);
    const msg = await message(found[0].ID);
    expect(msg.Subject).toBe("Your ClinicOS password was changed");
    expect(msg.Text).not.toMatch(/\d{6}/);
  });

  it("a bad signature sends nothing to Mailpit", async () => {
    useMailpitHook();
    const email = address("forged");
    const body = JSON.stringify(fixture("recovery", email));
    const headers = { ...signedWebhookHeaders(LOCAL_SEND_EMAIL_HOOK_SECRET, body), "webhook-signature": "v1,AAAA" };
    const res = await POST(new NextRequest("http://localhost/api/auth/send-email", { method: "POST", headers, body }));
    expect(res.status).toBe(401);
    await sleep(SETTLE_MS);
    expect(await mailFor(email)).toHaveLength(0);
  });
});
