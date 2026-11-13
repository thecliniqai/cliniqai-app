/**
 * The job runner (V2-04 04-01, P0-12, TARGET_ARCHITECTURE §8). One pass: claim due jobs, run each through its handler,
 * finish it under its lease token, until the time budget is spent or nothing is due.
 *
 * - Claims only kinds whose handler fits in the remaining budget (`maxDurationMs` + 1 s), so a job is never started
 *   that the pass cannot finish; a claimed job that no longer fits is handed back unstarted (`release_job`).
 * - Unknown kind → dead (`unknown_kind`); payload failing the handler's zod schema → dead (`invalid_payload`); a thrown
 *   error → retry with `errorTag(err)` (a code or class name, never the message); a handler that outlives
 *   `maxDurationMs` → retry (`handler_timeout`). Jobs in one pass run sequentially.
 * - Fencing is the database's: a runner whose lease was taken over gets `false` / `stale` and changes nothing.
 * - No env reads (the caller passes config), no `getSystemDb` (the route passes the client), no payload or job kind in
 *   logs: one `jobs.run.completed` line with counts.
 */
import { errorTag, log } from "@/lib/log";
import {
  beginRunnerRun,
  claimJobs,
  completeJob,
  endRunnerRun,
  failJob,
  releaseJob,
  type FailOutcome,
} from "./claim";
import type {
  ClaimedJob,
  HandlerMap,
  HandlerResult,
  JobHandler,
  JobsDb,
  RunJobsResult,
  RunnerSource,
} from "./types";

/** Budget kept free after a handler's own bound: the RPC that finishes the job. */
export const FINISH_MARGIN_MS = 1000;

const CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
const DIGIT_RUN = /\d{6,}/;

/** A code safe to store and log: a short machine word without a 6+ digit run, else a fixed fallback. */
export function jobErrorCode(code: unknown, fallback = "error"): string {
  return typeof code === "string" && CODE.test(code) && !DIGIT_RUN.test(code)
    ? code
    : fallback;
}

export interface RunJobsOptions {
  db: JobsDb;
  /** Wall-clock budget for the whole pass. */
  budgetMs: number;
  /** Jobs per claim (1..100). */
  batch: number;
  /** Lease per claimed job (10..900 s); must exceed the budget so a live runner never loses its lease. */
  leaseSeconds: number;
  /** At most this many jobs of one tenant per claim (1..100). */
  perTenant: number;
  /** Runner instance name (≤ 64 chars), recorded as `locked_by`. */
  worker: string;
  source: RunnerSource;
  /** Kinds this pass may claim. */
  kinds: string[];
  handlers: HandlerMap;
  now?: () => Date;
}

function costMs(handler: JobHandler<unknown> | undefined): number {
  return (handler?.maxDurationMs ?? 0) + FINISH_MARGIN_MS;
}

function handlerFor(
  handlers: HandlerMap,
  kind: string
): JobHandler<unknown> | undefined {
  return Object.prototype.hasOwnProperty.call(handlers, kind)
    ? handlers[kind]
    : undefined;
}

async function runHandler(
  handler: JobHandler<unknown>,
  job: ClaimedJob,
  payload: unknown,
  db: JobsDb,
  now: () => Date
): Promise<HandlerResult> {
  const signal = AbortSignal.timeout(handler.maxDurationMs);
  let onAbort: () => void = () => {};
  const timedOut = new Promise<HandlerResult>((resolve) => {
    onAbort = () => resolve({ outcome: "retry", code: "handler_timeout" });
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const running = handler.run(job, payload, { db, signal, now });
  // If the timeout wins, a later rejection of the abandoned run must not become an unhandled rejection.
  running.catch(() => {});
  try {
    return await Promise.race([running, timedOut]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

type Settled = "done" | FailOutcome;

async function processJob(
  opts: RunJobsOptions,
  job: ClaimedJob,
  now: () => Date
): Promise<Settled> {
  const handler = handlerFor(opts.handlers, job.kind);
  if (!handler) return failJob(opts.db, job, "unknown_kind", false);

  const parsed = handler.schema.safeParse(job.payload);
  if (!parsed.success) return failJob(opts.db, job, "invalid_payload", false);

  let result: HandlerResult;
  try {
    result = await runHandler(handler, job, parsed.data, opts.db, now);
  } catch (err) {
    return failJob(opts.db, job, jobErrorCode(errorTag(err)), true);
  }

  switch (result?.outcome) {
    case "done":
      return (await completeJob(opts.db, job)) ? "done" : "stale";
    case "retry":
      return failJob(
        opts.db,
        job,
        jobErrorCode(result.code),
        true,
        result.retryAt
      );
    case "dead":
      return failJob(opts.db, job, jobErrorCode(result.code), false);
    default:
      return failJob(opts.db, job, "invalid_result", true);
  }
}

export async function runJobs(opts: RunJobsOptions): Promise<RunJobsResult> {
  const now = opts.now ?? (() => new Date());
  const started = now().getTime();
  const remaining = () => opts.budgetMs - (now().getTime() - started);
  const counts = {
    claimed: 0,
    done: 0,
    retried: 0,
    dead: 0,
    stale: 0,
    released: 0,
  };
  let ok = true;
  let errorCode: string | null = null;

  const runId = await beginRunnerRun(opts.db, opts.worker, opts.source);
  try {
    for (;;) {
      const left = remaining();
      const fitting = opts.kinds.filter(
        (k) => costMs(handlerFor(opts.handlers, k)) <= left
      );
      if (fitting.length === 0) break;
      const worst = Math.max(
        ...fitting.map((k) => costMs(handlerFor(opts.handlers, k)))
      );
      const batch = Math.min(opts.batch, Math.max(1, Math.floor(left / worst)));

      const jobs = await claimJobs(opts.db, {
        kinds: fitting,
        batch,
        leaseSeconds: opts.leaseSeconds,
        worker: opts.worker,
        perTenant: opts.perTenant,
      });
      if (jobs.length === 0) break;
      counts.claimed += jobs.length;

      for (const job of jobs) {
        if (costMs(handlerFor(opts.handlers, job.kind)) > remaining()) {
          if (await releaseJob(opts.db, job)) counts.released += 1;
          else counts.stale += 1;
          continue;
        }
        const settled = await processJob(opts, job, now);
        if (settled === "done") counts.done += 1;
        else if (settled === "pending") counts.retried += 1;
        else if (settled === "dead") counts.dead += 1;
        else counts.stale += 1;
      }
    }
  } catch (err) {
    // A queue RPC failed (database unavailable, lock timeout): stop the pass. Unfinished jobs keep their lease and are
    // claimable again when it expires.
    ok = false;
    errorCode = jobErrorCode(errorTag(err), "runner_failed");
    log.warn({ event: "jobs.run.failed", code: errorCode });
  }

  await endRunnerRun(opts.db, runId, {
    claimed: counts.claimed,
    done: counts.done,
    retried: counts.retried,
    dead: counts.dead,
    ok,
    errorCode,
  });

  const durationMs = Math.max(0, now().getTime() - started);
  log.info({ event: "jobs.run.completed", count: counts.claimed, durationMs });
  return { ...counts, durationMs };
}
