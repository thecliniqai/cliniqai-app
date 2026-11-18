/**
 * Job kind `message.reply_unmatched` (V2-04 04-03c; P0-12, R-25, T-04-10, T-04-16). The bot reply to an inbound
 * WhatsApp sender no patient matches: a tenant-less job `{ to, template_id }` created by
 * `public.enqueue_unmatched_reply_system` (migration 000037), one per inbound event (its dedupe key). There is no
 * delivery row; the database erases the phone (`payload := {"redacted": true}`) as soon as the job leaves
 * pending/running, whatever the outcome.
 *
 * Sends through the provider like `message.send`, passing the runner's abort signal: success → done; a
 * `retryable: false` result (the `disabled` provider, a synthetic recipient, an MSG91 4xx) → dead at once; a retryable
 * failure → retry with the runner's backoff (3 attempts). Results carry codes only, never the number.
 */
import { z } from "zod";
import { errorTag } from "@/lib/log";
import { getMessagingProvider } from "@/lib/messaging";
import type { MessagingProvider, MessagingSendResult } from "@/lib/messaging/types";
import type { HandlerResult, JobHandler } from "../types";

export const MESSAGE_REPLY_UNMATCHED_KIND = "message.reply_unmatched";

/** The copy of each unmatched-sender template (unchanged from the inbound route's former direct send). */
export const UNMATCHED_REPLY_PARAMS: Record<"bot_not_found", Record<string, string>> = {
  bot_not_found: {
    message:
      "We could not find an upcoming scheduled appointment for this phone number. For assistance, please call the clinic directly.",
  },
};

const PAYLOAD = z
  .object({
    to: z.string().regex(/^\+91[6-9][0-9]{9}$/),
    template_id: z.enum(["bot_not_found"]),
  })
  .strict();
type Payload = z.infer<typeof PAYLOAD>;

const CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

function failureCode(result: MessagingSendResult): string {
  if (result.code && CODE.test(result.code)) return result.code;
  if (result.error && CODE.test(result.error)) return result.error;
  return "provider_failed";
}

export function createMessageReplyUnmatchedHandler(
  options: { provider?: () => MessagingProvider } = {}
): JobHandler<Payload> {
  const providerFor = options.provider ?? (() => getMessagingProvider());
  return {
    schema: PAYLOAD,
    // Provider calls are bounded at 10 s (MESSAGING_PROVIDER_TIMEOUT_MS) and also abort on this signal.
    maxDurationMs: 12_000,
    async run(_job, payload, ctx): Promise<HandlerResult> {
      let result: MessagingSendResult;
      try {
        result = await providerFor().sendWhatsApp(
          payload.to,
          payload.template_id,
          { ...UNMATCHED_REPLY_PARAMS[payload.template_id] },
          [],
          { signal: ctx.signal }
        );
      } catch (err) {
        result = { success: false, channelUsed: "whatsapp", code: `send_threw:${errorTag(err)}`.slice(0, 64), retryable: true };
      }
      if (result.success) return { outcome: "done" };
      const code = failureCode(result);
      return result.retryable === false ? { outcome: "dead", code } : { outcome: "retry", code };
    },
  };
}

export const MESSAGE_REPLY_UNMATCHED_HANDLERS = {
  [MESSAGE_REPLY_UNMATCHED_KIND]: createMessageReplyUnmatchedHandler() as JobHandler<unknown>,
};
