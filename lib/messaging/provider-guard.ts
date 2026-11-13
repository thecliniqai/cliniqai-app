/**
 * Shared guards for the real messaging providers (V2-03 03-13d): a bounded wait on every provider HTTP call (review
 * E-6: a hung provider otherwise holds a request or the serial dispatcher until the platform kills it) and the
 * synthetic-number refusal (M-SEEDPHONE).
 */
import { isSyntheticPhone } from "./synthetic-numbers";
import type { MessagingSendResult } from "./types";

/** Upper bound for one MSG91 / Gupshup / Twilio HTTP call (connect, headers and body). */
export const MESSAGING_PROVIDER_TIMEOUT_MS = 10_000;

/** A fresh timeout signal for one provider call. */
export function providerSignal(): AbortSignal {
  return AbortSignal.timeout(MESSAGING_PROVIDER_TIMEOUT_MS);
}

/** The refusal a real provider returns for a synthetic recipient (no HTTP call is made), or `null`. */
export function syntheticRecipientRefusal(to: string, channel: "sms" | "whatsapp"): MessagingSendResult | null {
  if (!isSyntheticPhone(to)) return null;
  return { success: false, channelUsed: channel, error: "Recipient is a synthetic test number", retryable: false };
}
