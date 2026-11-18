/**
 * Drill job kinds (V2-04 04-02, R-32). They exist only when `JOBS_DRILL_ENABLED=true` (refused in production by the env
 * schema), are enqueued only by `ops.drill_enqueue` (executable by `postgres` only, from the SQL editor) and carry an
 * empty payload. `drill.noop` proves the scheduler path end to end (pg_cron → pg_net → `/api/jobs/run` → runner) and
 * measures queue lag (`first_claimed_at − run_at`) without any side effect. 04-04: `drill.always_fail` always fails
 * retryably (`drill_failure`), so with `ops.drill_enqueue(…, max_attempts => 2)` it goes dead after two passes and
 * raises the `dead_letter` alert (the alert drill, docs/runbooks/jobs.md).
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

/** 04-04: fails every attempt with a retryable code; dead after `max_attempts` (the alert drill). */
export const drillAlwaysFail: JobHandler<z.infer<typeof EMPTY>> = {
  schema: EMPTY,
  maxDurationMs: 1_000,
  async run() {
    return { outcome: "retry", code: "drill_failure" };
  },
};

export const DRILL_HANDLERS: HandlerMap = {
  "drill.noop": drillNoop as JobHandler<unknown>,
  "drill.always_fail": drillAlwaysFail as JobHandler<unknown>,
};
