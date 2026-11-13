import { randomUUID } from "node:crypto";
import { log } from "@/lib/log";
import { MessagingProvider, MessagingSendResult } from "../types";

/**
 * `MESSAGING_PROVIDER=sink` (V2-04 04-03a, ruling R-9): staging and the e2e lane run the real queue and runner without
 * sending anything. Every send succeeds with a `sink-<uuid>` id, writes one log line with a count and nothing else (no
 * recipient, template or parameter), and touches no network and no file (unlike the dev logger). It is not a real
 * provider: `/api/ready` reports it as `disabled`, and the env schema refuses it in production.
 */
export class SinkProvider implements MessagingProvider {
  readonly name = "sink" as const;

  // No parameters: the recipient, template and values are never read.
  async sendSms(): Promise<MessagingSendResult> {
    log.info({ event: "messaging.sink.recorded", action: "sms", count: 1 });
    return { success: true, channelUsed: "sms", externalMessageId: `sink-${randomUUID()}` };
  }

  async sendWhatsApp(): Promise<MessagingSendResult> {
    log.info({ event: "messaging.sink.recorded", action: "whatsapp", count: 1 });
    return { success: true, channelUsed: "whatsapp", externalMessageId: `sink-${randomUUID()}` };
  }
}
