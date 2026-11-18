import { MessagingProvider, MessagingSendResult } from "../types";

/** The error text the dispatcher stores on a queue row the `disabled` provider refused. Contains no message data. */
export const PROVIDER_DISABLED = "provider_disabled";

/**
 * `MESSAGING_PROVIDER=disabled` (V2-03 03-01, ruling R-16): staging boots fail-closed before the PO's messaging
 * account exists. It sends nothing, writes nothing (unlike the dev logger, no recipient or template reaches a log or
 * file) and returns a non-retryable failure. The env schema refuses `disabled` in production.
 */
export class DisabledMessagingProvider implements MessagingProvider {
  readonly name = "disabled" as const;

  // No parameters: the recipient, template and values are never read.
  async sendSms(): Promise<MessagingSendResult> {
    return { success: false, channelUsed: "sms", error: PROVIDER_DISABLED, code: PROVIDER_DISABLED, retryable: false };
  }

  async sendWhatsApp(): Promise<MessagingSendResult> {
    return { success: false, channelUsed: "whatsapp", error: PROVIDER_DISABLED, code: PROVIDER_DISABLED, retryable: false };
  }
}
