/**
 * Job queue types (V2-04 04-01, P0-12, TARGET_ARCHITECTURE §8). Internal to the runner: request paths never import
 * `lib/jobs/internal/**` (ESLint `jobsInternal` zone, ADR-0005 D2); they enqueue through SECURITY DEFINER RPCs.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZodType } from "zod";
import type { Database } from "@/lib/db/types";

/** The service-role client the runner route passes in (`getSystemDb("jobs.run")` from 04-02). */
export type JobsDb = SupabaseClient<Database>;

/** Where a runner pass came from (`ops.job_runner_runs.source`). */
export type RunnerSource = "pg_cron" | "manual" | "test";

/** A job as `claim_jobs` hands it to the runner: ids-only payload, the attempt it is on and its lease token. */
export interface ClaimedJob {
  id: string;
  kind: string;
  tenantId: string | null;
  payload: unknown;
  /** The attempt this claim counted (1 on the first claim). */
  attempts: number;
  maxAttempts: number;
  /** The fencing token: `complete_job` / `fail_job` / `release_job` change the row only under this token. */
  leaseToken: string;
  runAt: string;
}

/**
 * What a handler reports. `code` is a machine code (`provider_timeout`, `not_found`), never a message: the runner and
 * the database both replace anything else with a fixed code (T-04-10).
 */
export type HandlerResult =
  | { outcome: "done" }
  | { outcome: "retry"; code: string; retryAt?: Date }
  | { outcome: "dead"; code: string };

export interface JobContext {
  db: JobsDb;
  /** Aborts after the handler's `maxDurationMs`; handlers pass it to every network call. */
  signal: AbortSignal;
  now(): Date;
}

export interface JobHandler<P> {
  /** The payload contract; a payload that fails it dead-letters the job (`invalid_payload`). */
  schema: ZodType<P>;
  /** Upper bound for one run; the runner never starts the job with less than this + 1 s of budget left. */
  maxDurationMs: number;
  run(job: ClaimedJob, payload: P, ctx: JobContext): Promise<HandlerResult>;
}

export type HandlerMap = Record<string, JobHandler<unknown>>;

export interface RunJobsResult {
  claimed: number;
  done: number;
  retried: number;
  dead: number;
  /** Jobs whose lease another runner had taken over by the time this one finished them (fencing refused the write). */
  stale: number;
  /** Claimed jobs handed back unstarted because the budget ran out. */
  released: number;
  /** 04-02: false when a queue RPC failed and the pass stopped early (`ops.job_runner_runs.ok`, with its code). */
  ok: boolean;
  durationMs: number;
}
