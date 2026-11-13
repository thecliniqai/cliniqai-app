import { SESv2Client, SendEmailCommand, type SESv2ClientConfig } from "@aws-sdk/client-sesv2";
import { SES_REGION } from "@/lib/env";
import {
  EmailConfigError,
  EmailSendError,
  safeCode,
  type EmailMessage,
  type EmailSender,
  type SendOptions,
  type SendResult,
} from "./types";

/** The one call the sender makes; tests inject a client with the same `send`. */
export interface SesClientLike {
  send(command: SendEmailCommand, options?: { abortSignal?: AbortSignal }): Promise<{ MessageId?: string }>;
}

export interface SesEmailSenderOptions {
  /** The verified identity's address (`EMAIL_FROM`). */
  from: string;
  /** The least-privilege IAM user's key pair (R-31). Unused when `client` is given. */
  credentials?: { accessKeyId: string; secretAccessKey: string };
  /** Injected client (tests); otherwise {@link createSesClient}. */
  client?: SesClientLike;
}

/**
 * SES HTTP timeouts (ms). With one retry the worst case is 2 × (1 000 + 1 500) = 5 000 ms, so the Send Email hook also
 * aborts the call at its own budget (`HOOK_SEND_BUDGET_MS`, below GoTrue's 5 s hook timeout; 03-13a).
 */
export const SES_CONNECTION_TIMEOUT_MS = 1_000;
export const SES_REQUEST_TIMEOUT_MS = 1_500;

/**
 * The SESv2 client the sender uses: {@link SES_REGION}, explicit credentials, short timeouts, one retry.
 * `requestHandler` replaces the HTTP layer (the spec captures the signed request instead of sending it).
 */
export function createSesClient(
  credentials: { accessKeyId: string; secretAccessKey: string },
  requestHandler?: SESv2ClientConfig["requestHandler"],
): SESv2Client {
  return new SESv2Client({
    region: SES_REGION,
    credentials,
    maxAttempts: 2,
    requestHandler: requestHandler ?? { connectionTimeout: SES_CONNECTION_TIMEOUT_MS, requestTimeout: SES_REQUEST_TIMEOUT_MS },
  });
}

/**
 * Amazon SES (SESv2 `SendEmail`) in ap-south-1 (03-11b, AUTH-03, PO-A3). SigV4 is the SDK's; the region is the
 * {@link SES_REGION} constant. Credentials are passed explicitly from `SES_ACCESS_KEY_ID` / `SES_SECRET_ACCESS_KEY`,
 * never from the SDK default chain: on Vercel that chain would find the platform's own `AWS_*` runtime credentials.
 *
 * Timeouts are short (the Send Email hook has a few seconds in total) and the SDK retries once. A provider error is
 * rethrown as {@link EmailSendError} carrying the SDK error name only: SES messages can quote the recipient address.
 */
export class SesEmailSender implements EmailSender {
  readonly provider = "ses" as const;
  private readonly from: string;
  private readonly client: SesClientLike;

  constructor(options: SesEmailSenderOptions) {
    if (!options.from) throw new EmailConfigError("email_from_missing", "SES sender needs a from address");
    this.from = options.from;
    if (options.client) {
      this.client = options.client;
    } else {
      if (!options.credentials) throw new EmailConfigError("ses_credentials_missing", "SES sender needs credentials");
      this.client = createSesClient(options.credentials);
    }
  }

  /** The exact SESv2 request for a message (exported for the spec through the injected client). */
  buildCommand(message: EmailMessage): SendEmailCommand {
    return new SendEmailCommand({
      FromEmailAddress: this.from,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: message.html, Charset: "UTF-8" },
            Text: { Data: message.text, Charset: "UTF-8" },
          },
        },
      },
      EmailTags: [{ Name: "category", Value: message.tag }],
    });
  }

  async send(message: EmailMessage, options: SendOptions = {}): Promise<SendResult> {
    let out: { MessageId?: string };
    try {
      out = await this.client.send(this.buildCommand(message), options.signal ? { abortSignal: options.signal } : undefined);
    } catch (err) {
      throw new EmailSendError(safeCode(err instanceof Error ? err.name : undefined, "ses_error"));
    }
    if (!out.MessageId) throw new EmailSendError("ses_no_message_id");
    return { providerMessageId: out.MessageId };
  }
}
