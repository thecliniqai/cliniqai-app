import {
  EmailConfigError,
  EmailSendError,
  safeCode,
  type EmailMessage,
  type EmailSender,
  type SendOptions,
  type SendResult,
} from "./types";

/** Resend's send endpoint. A constant: the env schema has no URL override, so a deployment cannot be pointed elsewhere. */
export const RESEND_API_URL = "https://api.resend.com/emails";

/**
 * Time one Resend call may take (ms). Inside the Send Email hook's budget (`HOOK_SEND_BUDGET_MS`, 3 500 ms, under
 * GoTrue's 5 s hook timeout; 03-13a): a hung call is aborted and mapped to `resend_timeout` before the route's own
 * deadline, so the route answers with a failure GoTrue can report instead of timing out.
 */
export const RESEND_REQUEST_TIMEOUT_MS = 3_000;

/** Resend accepts an `Idempotency-Key` of 1 to 256 characters; the route sends `auth-email/<sha256 hex>/<n>`. */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9/_:.-]{1,256}$/;

export interface ResendEmailSenderOptions {
  /** `RESEND_API_KEY` (server only). Sent as the bearer token; never logged and never part of an error. */
  apiKey: string;
  /** `EMAIL_FROM`: a plain address on the verified domain. */
  from: string;
  /** Injected transport (tests); otherwise the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Overrides {@link RESEND_REQUEST_TIMEOUT_MS} (tests only). */
  timeoutMs?: number;
}

class ResendTimeoutError extends Error {
  constructor() {
    super("Resend did not answer in time");
    this.name = "ResendTimeoutError";
  }
}

/**
 * Resend (04-00b; PO decision 2026-11-13: Resend now, SES after go-live). One plain `fetch` POST to
 * {@link RESEND_API_URL} per message; no SDK and no new dependency.
 *
 * - `Authorization: Bearer <RESEND_API_KEY>`; JSON body `{ from, to: [one], subject, html, text, tags }`.
 * - `Idempotency-Key` from {@link SendOptions.idempotencyKey} (the hook derives it from `webhook-id`): Resend answers
 *   a repeated key with the first result and sends nothing, so a GoTrue retry that lands on another server instance
 *   (past the route's per-instance dedupe) never sends twice.
 * - Aborted after {@link RESEND_REQUEST_TIMEOUT_MS} or when the caller's signal aborts; `redirect: "error"` (the API
 *   never redirects; following one would replay the bearer token elsewhere).
 * - Every failure is an {@link EmailSendError} with a fixed code (`resend_timeout`, `resend_aborted`,
 *   `resend_unreachable`, `resend_http_<status>`, `resend_no_id`). Resend's error body is never read into a message:
 *   it can quote the recipient address.
 */
export class ResendEmailSender implements EmailSender {
  readonly provider = "resend" as const;
  private readonly apiKey: string;
  private readonly from: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ResendEmailSenderOptions) {
    if (!options.apiKey) throw new EmailConfigError("resend_key_missing", "Resend sender needs an API key");
    if (!options.from) throw new EmailConfigError("email_from_missing", "Resend sender needs a from address");
    this.apiKey = options.apiKey;
    this.from = options.from;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? RESEND_REQUEST_TIMEOUT_MS;
  }

  /** The JSON body Resend receives for a message. */
  buildBody(message: EmailMessage): Record<string, unknown> {
    return {
      from: this.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      tags: [{ name: "category", value: message.tag }],
    };
  }

  async send(message: EmailMessage, options: SendOptions = {}): Promise<SendResult> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "clinicos-email/1",
    };
    if (options.idempotencyKey !== undefined) {
      if (!IDEMPOTENCY_KEY_PATTERN.test(options.idempotencyKey)) {
        throw new EmailConfigError("resend_idempotency_key", "The idempotency key has an unexpected shape");
      }
      headers["idempotency-key"] = options.idempotencyKey;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new ResendTimeoutError()), this.timeoutMs);
    const onCallerAbort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) onCallerAbort();
    else options.signal?.addEventListener("abort", onCallerAbort, { once: true });

    try {
      let res: Response;
      try {
        res = await this.fetchImpl(RESEND_API_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(this.buildBody(message)),
          redirect: "error",
          signal: controller.signal,
        });
      } catch {
        throw new EmailSendError(this.abortCode(controller.signal));
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new EmailSendError(safeCode(`resend_http_${res.status}`, "resend_http_error"));
      }
      let body: { id?: unknown } | null;
      try {
        body = (await res.json()) as { id?: unknown } | null;
      } catch {
        // A body that stops mid-read because the deadline passed is a timeout, not a malformed answer.
        if (controller.signal.aborted) throw new EmailSendError(this.abortCode(controller.signal));
        body = null;
      }
      if (!body || typeof body.id !== "string" || body.id === "") throw new EmailSendError("resend_no_id");
      return { providerMessageId: body.id };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onCallerAbort);
    }
  }

  /** Why the call ended without an answer: our own deadline, the caller's abort, or the network. */
  private abortCode(signal: AbortSignal): string {
    if (!signal.aborted) return "resend_unreachable";
    return signal.reason instanceof ResendTimeoutError ? "resend_timeout" : "resend_aborted";
  }
}
