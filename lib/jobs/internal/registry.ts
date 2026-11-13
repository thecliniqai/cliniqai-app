/**
 * The job handler registry (V2-04 04-02). `/api/jobs/run` claims exactly the kinds returned here, so a kind without a
 * handler is never claimed by a deployment that cannot run it. Later plans add their kinds (04-03a `message.send`,
 * 04-03b `webhook.deliver`, 04-03c, 04-04). Drill kinds are included only when `JOBS_DRILL_ENABLED` is true (R-32).
 */
import { serverEnv } from "@/lib/env-server";
import { DRILL_HANDLERS } from "./handlers/drill";
import type { HandlerMap } from "./types";

/** The production handlers (none until 04-03a). */
const PRODUCTION_HANDLERS: HandlerMap = {};

export function getJobHandlers(): HandlerMap {
  return {
    ...PRODUCTION_HANDLERS,
    ...(serverEnv().JOBS_DRILL_ENABLED ? DRILL_HANDLERS : {}),
  };
}
