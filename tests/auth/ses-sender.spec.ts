/**
 * V2-03 03-11b (AUTH-03, PO-A3, R-31): the SES sender, with no network.
 *
 * 1. An injected client receives exactly one `SendEmailCommand` with the configured `FromEmailAddress`, one recipient,
 *    both bodies and the category tag.
 * 2. The real SESv2 client the sender builds (`createSesClient`), with its HTTP layer replaced by a capturing handler,
 *    signs a request for SES in ap-south-1 (host, SigV4 scope, access key id) whose JSON body carries the message.
 *    Nothing is sent: the handler answers with a synthetic MessageId.
 * 3. Provider errors become `EmailSendError` with the SDK error name only (SES messages can quote the address).
 * Synthetic credentials are assembled at runtime.
 */
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { getEmailSender, EmailSendError, type EmailMessage } from "@/lib/email";
import { SesEmailSender, createSesClient } from "@/lib/email/ses";
import { parseEnv, SES_REGION } from "@/lib/env";
import { LOCAL_SEND_EMAIL_HOOK_SECRET } from "../setup/test-env";

const FROM = "no-reply@auth.synthetic-clinic.example.org";
const KEY_ID = ["AKIA", "SYNTHETIC0000000"].join("");
const SECRET = ["synthetic", "not", "real", "ses", "secret", "access", "key"].join("-");

const MESSAGE: EmailMessage = {
  to: "hook-recovery@example.com",
  subject: "Your ClinicOS password reset code",
  html: "<p>Your password reset code is:</p><p>246801</p>",
  text: "Your password reset code is:\n246801\n",
  tag: "auth-recovery",
};

describe("SesEmailSender with an injected client", () => {
  it("sends exactly one SendEmailCommand: configured From, one recipient, both bodies, the category tag", async () => {
    const send = vi.fn(async (command: SendEmailCommand) => {
      void command;
      return { MessageId: "synthetic-message-id" };
    });
    const sender = new SesEmailSender({ from: FROM, client: { send } });
    await expect(sender.send(MESSAGE)).resolves.toEqual({ providerMessageId: "synthetic-message-id" });
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(command.input).toEqual({
      FromEmailAddress: FROM,
      Destination: { ToAddresses: [MESSAGE.to] },
      Content: {
        Simple: {
          Subject: { Data: MESSAGE.subject, Charset: "UTF-8" },
          Body: { Html: { Data: MESSAGE.html, Charset: "UTF-8" }, Text: { Data: MESSAGE.text, Charset: "UTF-8" } },
        },
      },
      EmailTags: [{ Name: "category", Value: "auth-recovery" }],
    });
  });

  it("a provider error becomes EmailSendError carrying the SDK error name, never its message", async () => {
    const providerError = Object.assign(
      new Error(`Email address is not verified. The following identities failed the check: ${MESSAGE.to}`),
      { name: "MessageRejected" },
    );
    const sender = new SesEmailSender({ from: FROM, client: { send: async () => Promise.reject(providerError) } });
    const err = await sender.send(MESSAGE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect((err as EmailSendError).code).toBe("MessageRejected");
    expect((err as Error).message).not.toContain(MESSAGE.to);
  });

  it("a response without a MessageId is a failure (200 only after the provider accepted)", async () => {
    const sender = new SesEmailSender({ from: FROM, client: { send: async () => ({}) } });
    await expect(sender.send(MESSAGE)).rejects.toMatchObject({ code: "ses_no_message_id" });
  });
});

describe("the real SESv2 client the sender builds (HTTP layer captured, no network)", () => {
  it("signs one request for SES in ap-south-1 with the IAM user's key and the message as JSON", async () => {
    const captured: Array<{ hostname: string; path: string; method: string; headers: Record<string, string>; body: string }> = [];
    const handler = {
      async handle(request: { hostname: string; path: string; method: string; headers: Record<string, string>; body: unknown }) {
        const raw = request.body;
        const body = typeof raw === "string" ? raw : new TextDecoder().decode(raw as Uint8Array);
        captured.push({ ...request, body });
        return {
          response: {
            statusCode: 200,
            headers: { "content-type": "application/json" },
            body: Readable.from([Buffer.from(JSON.stringify({ MessageId: "synthetic-captured-id" }))]),
          },
        };
      },
      updateHttpClientConfig() {},
      httpHandlerConfigs() {
        return {};
      },
    };
    const client = createSesClient({ accessKeyId: KEY_ID, secretAccessKey: SECRET }, handler as never);
    expect(await client.config.region()).toBe(SES_REGION);
    expect(SES_REGION).toBe("ap-south-1");

    const sender = new SesEmailSender({ from: FROM, client });
    await expect(sender.send(MESSAGE)).resolves.toEqual({ providerMessageId: "synthetic-captured-id" });

    expect(captured).toHaveLength(1);
    const [req] = captured;
    expect(req.method).toBe("POST");
    expect(req.hostname).toBe("email.ap-south-1.amazonaws.com");
    expect(req.path).toBe("/v2/email/outbound-emails");
    const auth = req.headers.authorization ?? req.headers.Authorization;
    expect(auth).toMatch(new RegExp(`^AWS4-HMAC-SHA256 Credential=${KEY_ID}/\\d{8}/ap-south-1/ses/aws4_request, `));
    expect(auth).not.toContain(SECRET);
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      FromEmailAddress: FROM,
      Destination: { ToAddresses: [MESSAGE.to] },
      Content: { Simple: { Subject: { Data: MESSAGE.subject }, Body: { Html: { Data: MESSAGE.html }, Text: { Data: MESSAGE.text } } } },
    });
  });
});

describe("03-13a: the hook's time budget reaches the SES HTTP layer", () => {
  it("send(message, { signal }) hands the abort signal to the real SDK; an abort ends a hung request at once", async () => {
    const seen: Array<AbortSignal | undefined> = [];
    const handler = {
      handle(_request: unknown, options?: { abortSignal?: AbortSignal }) {
        seen.push(options?.abortSignal);
        // A request SES never answers: it ends only when the signal aborts.
        return new Promise((_, reject) => {
          options?.abortSignal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        });
      },
      updateHttpClientConfig() {},
      httpHandlerConfigs() {
        return {};
      },
    };
    const client = createSesClient({ accessKeyId: KEY_ID, secretAccessKey: SECRET }, handler as never);
    const sender = new SesEmailSender({ from: FROM, client });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const started = performance.now();
    const outcome = await sender.send(MESSAGE, { signal: controller.signal }).catch((e: unknown) => e);
    expect(outcome).toBeInstanceOf(EmailSendError);
    expect((outcome as EmailSendError).code).toBe("AbortError");
    expect(performance.now() - started).toBeLessThan(1_500);
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[0]).toBeDefined();
    expect(seen.every((sig) => sig?.aborted)).toBe(true);
  });
});

describe("getEmailSender picks the sender from EMAIL_PROVIDER", () => {
  const base = {
    NODE_ENV: "test",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable",
  };

  it("ses → the SES sender (credentials from SES_*), mailpit → Mailpit, unset → disabled", () => {
    const ses = parseEnv({
      ...base,
      EMAIL_PROVIDER: "ses",
      EMAIL_FROM: FROM,
      SES_ACCESS_KEY_ID: KEY_ID,
      SES_SECRET_ACCESS_KEY: SECRET,
      SEND_EMAIL_HOOK_SECRET: LOCAL_SEND_EMAIL_HOOK_SECRET,
    });
    expect(getEmailSender(ses)).toBeInstanceOf(SesEmailSender);
    const mailpit = parseEnv({ ...base, EMAIL_PROVIDER: "mailpit", MAILPIT_API_URL: "http://127.0.0.1:54324", EMAIL_FROM: FROM });
    expect(getEmailSender(mailpit).provider).toBe("mailpit");
    expect(getEmailSender(parseEnv(base)).provider).toBe("disabled");
  });

  it("the disabled sender sends nothing and says so", async () => {
    const sender = getEmailSender(parseEnv(base));
    await expect(sender.send(MESSAGE)).rejects.toMatchObject({ name: "EmailDisabledError", code: "email_disabled" });
  });
});
