import { MAILPIT_TIERS, type AppEnv } from "@/lib/env";
import { EmailConfigError, EmailSendError, type EmailMessage, type EmailSender, type SendOptions, type SendResult } from "./types";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export interface MailpitEmailSenderOptions {
  /** Mailpit API base URL (`MAILPIT_API_URL`), loopback only. */
  apiUrl: string;
  from: string;
  /** The env schema's tier; Mailpit is refused outside development | test | e2e | ci. */
  appEnv: AppEnv;
  fetchImpl?: typeof fetch;
}

function isLoopback(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname) || url.hostname.endsWith(".localhost");
}

/**
 * The local stack's Mailpit catcher (03-11b): `POST ${MAILPIT_API_URL}/api/v1/send`. Refused (at construction) unless
 * the URL is loopback http(s) and the tier is a local one; the env schema already refuses `mailpit` in staging and
 * production, so this is the second lock. Nothing leaves the machine.
 */
export class MailpitEmailSender implements EmailSender {
  readonly provider = "mailpit" as const;
  private readonly endpoint: string;
  private readonly from: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MailpitEmailSenderOptions) {
    if (!MAILPIT_TIERS.includes(options.appEnv)) {
      throw new EmailConfigError("mailpit_tier", `Mailpit is not allowed in ${options.appEnv}`);
    }
    let url: URL;
    try {
      url = new URL(options.apiUrl);
    } catch {
      throw new EmailConfigError("mailpit_url", "MAILPIT_API_URL is not a URL");
    }
    if (!["http:", "https:"].includes(url.protocol) || !isLoopback(url)) {
      throw new EmailConfigError("mailpit_url", "MAILPIT_API_URL must be a loopback URL");
    }
    if (!options.from) throw new EmailConfigError("email_from_missing", "Mailpit sender needs a from address");
    this.endpoint = new URL("/api/v1/send", url).toString();
    this.from = options.from;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(message: EmailMessage, options: SendOptions = {}): Promise<SendResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          From: { Email: this.from, Name: "ClinicOS" },
          To: [{ Email: message.to }],
          Subject: message.subject,
          HTML: message.html,
          Text: message.text,
          Tags: [message.tag],
        }),
        signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000),
      });
    } catch (err) {
      throw new EmailSendError(err instanceof Error && err.name === "TimeoutError" ? "mailpit_timeout" : "mailpit_unreachable");
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new EmailSendError(`mailpit_http_${res.status}`);
    }
    const body = (await res.json().catch(() => null)) as { ID?: unknown } | null;
    if (!body || typeof body.ID !== "string" || body.ID === "") throw new EmailSendError("mailpit_no_id");
    return { providerMessageId: body.ID };
  }
}
