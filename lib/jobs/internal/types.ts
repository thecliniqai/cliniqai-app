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
  /**
   * Attempts spent so far. `claim_jobs` returns the attempts spent before this claim; the runner replaces it with the
   * attempt `start_job` counts just before the handler runs (1 on the first run). 04-07b (M-ATTEMPT).
   */
  attempts: number;
  maxAttempts: number;
  /** The fencing token: `start_job` / `complete_job` / `fail_job` / `defer_job` / `release_job` act only under it. */
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
  | { outcome: "dead"; code: string }
  /**
   * 04-07b (independent review M2): the handler found nothing to do yet (its delivery row is held by another sender,
   * not due, or its claim missed). The job goes back to pending at `retryAt` and the attempt is returned (`defer_job`,
   * at most 20 times per job, then an ordinary retry).
   */
  | { outcome: "defer"; code: string; retryAt: Date };

export interface JobContext {
  db: JobsDb;
  /**
   * Aborts after the handler's `maxDurationMs`; handlers pass it to every network call and stop when it fires. A handler
   * that has not settled shortly after the abort is abandoned with its lease kept (04-07b, review A L-2).
   */
  signal: AbortSignal;
  now(): Date;
}

export interface JobHandler<P> {
  /** The payload contract; a payload that fails it dead-letters the job (`invalid_payload`). */
  schema: ZodType<P>;
  /** Upper bound for one run; the runner starts the job only while this + its margins fit in the remaining budget. */
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
  /** 04-07b: started jobs handed back with their attempt returned (`defer` outcome). */
  deferred: number;
  /**
   * 04-07b (review A L-2): jobs whose handler outlived `maxDurationMs` and did not settle after the abort. The lease is
   * kept (no other runner can claim the job until it expires) and the job is finished under it if the handler settles
   * later while this process lives.
   */
  abandoned: number;
  /** 04-02: false when a queue RPC failed and the pass stopped early (`ops.job_runner_runs.ok`, with its code). */
  ok: boolean;
  durationMs: number;
}
