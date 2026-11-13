/**
 * The job handler registry (V2-04 04-02). `/api/jobs/run` claims exactly the kinds returned here, so a kind without a
 * handler is never claimed by a deployment that cannot run it. Later plans add their kinds (04-03a `message.send`,
 * 04-03b `webhook.deliver`, 04-03c, 04-04). Drill kinds are included only when `JOBS_DRILL_ENABLED` is true (R-32).
 */
import { serverEnv } from "@/lib/env-server";
import { DRILL_HANDLERS } from "./handlers/drill";
import { MESSAGE_REPLY_UNMATCHED_HANDLERS } from "./handlers/message-reply-unmatched";
import { MESSAGE_SEND_HANDLERS } from "./handlers/message-send";
import { WEBHOOK_DELIVER_HANDLERS } from "./handlers/webhook-deliver";
import type { HandlerMap } from "./types";

/** The production handlers. 04-03a: `message.send`; 04-03b: `webhook.deliver`; 04-03c: `message.reply_unmatched`. */
const PRODUCTION_HANDLERS: HandlerMap = {
  ...MESSAGE_SEND_HANDLERS,
  ...MESSAGE_REPLY_UNMATCHED_HANDLERS,
  ...WEBHOOK_DELIVER_HANDLERS,
};

export function getJobHandlers(): HandlerMap {
  return {
    ...PRODUCTION_HANDLERS,
    ...(serverEnv().JOBS_DRILL_ENABLED ? DRILL_HANDLERS : {}),
  };
}
