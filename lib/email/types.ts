/**
 * Outbound email (V2-03 03-11b, AUTH-03, PO-A3). Every sender implements {@link EmailSender}; the Send Email hook route
 * (`app/api/auth/send-email`) and, later, the outbox (V2-04) choose one through `getEmailSender()` (`lib/email`).
 *
 * Errors never carry a provider's message: SES and Mailpit messages can quote the recipient address. A sender throws
 * {@link EmailDisabledError}, {@link EmailConfigError} or {@link EmailSendError}, each with a fixed message and a short
 * `code` that `errorTag()` writes to the log.
 */
import type { EmailProviderName } from "@/lib/env";

/** What a message is for. SES records it as the `category` message tag; Mailpit as a tag. `[a-z_-]` only. */
export type EmailTag =
  | "auth-signup"
  | "auth-recovery"
  | "auth-invite"
  | "auth-email-change"
  | "auth-password-changed";

export interface EmailMessage {
  /** One recipient. */
  to: string;
  subject: string;
  html: string;
  text: string;
  tag: EmailTag;
}

export interface SendResult {
  /** The provider's id for the accepted message (SES `MessageId`, Mailpit `ID`, Resend `id`). */
  providerMessageId: string;
}

/** Per-call options. `signal` aborts the provider call (the Send Email hook's time budget, 03-13a). */
export interface SendOptions {
  signal?: AbortSignal;
  /**
   * 04-00b: a key that makes a repeated call send nothing (Resend's `Idempotency-Key`). The Send Email hook derives it
   * from the signed `webhook-id`, one per message. Providers without the feature ignore it.
   */
  idempotencyKey?: string;
}

export interface EmailSender {
  readonly provider: EmailProviderName;
  /** Resolves only once the provider has accepted the message; rejects otherwise (also when `signal` aborts). */
  send(message: EmailMessage, options?: SendOptions): Promise<SendResult>;
}

/** `EMAIL_PROVIDER=disabled`: nothing is sent, and the caller is told so. */
export class EmailDisabledError extends Error {
  readonly code = "email_disabled";
  constructor() {
    super("Email delivery is disabled (EMAIL_PROVIDER=disabled)");
    this.name = "EmailDisabledError";
  }
}

/** A sender was asked to run with a configuration it refuses (wrong tier, non-loopback Mailpit, missing value). */
export class EmailConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EmailConfigError";
    this.code = code;
  }
}

/** The provider did not accept the message. `code` is the provider's error name or HTTP status, never its text. */
export class EmailSendError extends Error {
  readonly code: string;
  constructor(code: string) {
    super("The email provider did not accept the message");
    this.name = "EmailSendError";
    this.code = code;
  }
}

/** A log-safe code: `[A-Za-z0-9_.-]`, at most 40 characters (the logger's `code` shape). */
export function safeCode(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(value) ? value : fallback;
}
