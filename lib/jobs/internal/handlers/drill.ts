/**
 * Drill job kinds (V2-04 04-02, R-32). They exist only when `JOBS_DRILL_ENABLED=true` (refused in production by the env
 * schema), are enqueued only by `ops.drill_enqueue` (executable by `postgres` only, from the SQL editor) and carry an
 * empty payload. `drill.noop` proves the scheduler path end to end (pg_cron → pg_net → `/api/jobs/run` → runner) and
 * measures queue lag (`first_claimed_at − run_at`) without any side effect. 04-04 adds its alert drills here.
 */
import { z } from "zod";
import type { HandlerMap, JobHandler } from "../types";

const EMPTY = z.object({}).strict();

/** Done at once. */
export const drillNoop: JobHandler<z.infer<typeof EMPTY>> = {
  schema: EMPTY,
  maxDurationMs: 1_000,
  async run() {
    return { outcome: "done" };
  },
};

export const DRILL_HANDLERS: HandlerMap = {
  "drill.noop": drillNoop as JobHandler<unknown>,
};
