/**
 * The job runner (V2-04 04-01, P0-12, TARGET_ARCHITECTURE §8; revised 04-07b). One pass: claim due jobs in fair
 * batches, run each through its handler, finish it under its lease token, until the time budget is spent or nothing
 * is due.
 *
 * - Batches (04-07b, M-FAIR): each claim asks for `batch` jobs, at most `perTenant` per tenant, round-robin across
 *   tenants (SQL and {@link fairOrder}). The batch is not sized by the slowest kind's bound (that made every claim a
 *   batch of 1, i.e. global FIFO). Instead each job has its own deadline: it starts only if its handler bound plus
 *   margins ({@link jobCostMs}) fits in the remaining budget; claimed jobs that no longer fit are handed back unstarted
 *   (`release_job`, in parallel). Only kinds that fit at all are claimed.
 * - Attempts (04-07b, M-ATTEMPT): `start_job` counts the attempt just before the handler runs; a claimed job the pass
 *   never reached costs nothing when its lease expires. If `start_job` refuses (lease lost), the handler never runs.
 * - Outcomes: unknown kind → dead (`unknown_kind`); payload failing the handler's zod schema → dead
 *   (`invalid_payload`); a thrown error → retry with `errorTag(err)` (a code or class name, never the message);
 *   `defer` → `defer_job` (attempt returned); a `retryAt` that is not a valid date → retry `invalid_retry_at` for that
 *   job only (review A L-4).
 * - Timeouts (04-07b, review A L-2): at `maxDurationMs` the handler's signal aborts. A handler that settles within
 *   {@link SETTLE_GRACE_MS} is finished normally (its own result if it returned one, else retry `handler_timeout`). One
 *   that does not is abandoned WITH its lease: the job stays `running` until the lease expires, so no other runner can
 *   start it while the abandoned run may still act, and if it settles later in this process it is finished under its
 *   token (fenced: refused if the job was re-claimed meanwhile).
 * - Every queue RPC has a hard timeout (`rpcTimeoutMs`, review A L-3); see `run-config.ts` for the 60 s bound.
 * - Fencing is the database's: a runner whose lease was taken over gets `false` / `stale` / `null` and changes nothing.
 * - No env reads (the caller passes config), no `getSystemDb` (the route passes the client), no payload or job kind in
 *   logs: one `jobs.run.completed` line with counts.
 */
import { errorTag, log } from "@/lib/log";
import {
  beginRunnerRun,
  claimJobs,
  completeJob,
  deferJob,
  endRunnerRun,
  failJob,
  RPC_TIMEOUT_MS,
  releaseJob,
  startJob,
  validRetryAt,
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

/** Budget kept free after a handler's own bound: the RPCs that start and finish the job. */
export const FINISH_MARGIN_MS = 1000;
/** How long a handler may take to settle after its abort before the runner abandons it (lease kept). */
export const SETTLE_GRACE_MS = 500;

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
  /** Wall-clock budget in which the pass may start jobs. */
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
  /** Hard bound per queue RPC (default {@link RPC_TIMEOUT_MS}). */
  rpcTimeoutMs?: number;
  now?: () => Date;
}

/** Budget a job of this kind needs to start: its bound, the settle grace after an abort, and the queue RPCs. */
export function jobCostMs(handler: JobHandler<unknown> | undefined): number {
  return (
    (handler?.maxDurationMs ?? 0) +
    (handler ? SETTLE_GRACE_MS : 0) +
    FINISH_MARGIN_MS
  );
}

function handlerFor(
  handlers: HandlerMap,
  kind: string
): JobHandler<unknown> | undefined {
  return Object.prototype.hasOwnProperty.call(handlers, kind)
    ? handlers[kind]
    : undefined;
}

type Settlement =
  | { ok: true; result: HandlerResult }
  | { ok: false; error: unknown };

const TIMEOUT = Symbol("timeout");

function after(ms: number): { promise: Promise<typeof TIMEOUT>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

type HandlerRun =
  | { kind: "settled"; settlement: Settlement; timedOut: boolean }
  | { kind: "abandoned"; late: Promise<Settlement> };

async function runHandler(
  handler: JobHandler<unknown>,
  job: ClaimedJob,
  payload: unknown,
  db: JobsDb,
  now: () => Date
): Promise<HandlerRun> {
  const controller = new AbortController();
  let running: Promise<Settlement>;
  try {
    running = handler
      .run(job, payload, { db, signal: controller.signal, now })
      .then(
        (result): Settlement => ({ ok: true, result }),
        (error: unknown): Settlement => ({ ok: false, error })
      );
  } catch (error) {
    // A handler that throws synchronously.
    return { kind: "settled", settlement: { ok: false, error }, timedOut: false };
  }

  const bound = after(handler.maxDurationMs);
  const first = await Promise.race([running, bound.promise]);
  bound.cancel();
  if (first !== TIMEOUT) return { kind: "settled", settlement: first, timedOut: false };

  controller.abort();
  const grace = after(SETTLE_GRACE_MS);
  const second = await Promise.race([running, grace.promise]);
  grace.cancel();
  if (second !== TIMEOUT) return { kind: "settled", settlement: second, timedOut: true };
  return { kind: "abandoned", late: running };
}

type Settled = "done" | "pending" | "dead" | "stale" | "deferred";

/** Finishes a started job under its lease from what its handler did. */
async function finish(
  opts: RunJobsOptions,
  job: ClaimedJob,
  settlement: Settlement,
  timedOut: boolean
): Promise<Settled> {
  const db = opts.db;
  const t = opts.rpcTimeoutMs ?? RPC_TIMEOUT_MS;
  if (!settlement.ok) {
    const code = timedOut
      ? "handler_timeout"
      : jobErrorCode(errorTag(settlement.error));
    return failJob(db, job, code, true, undefined, t);
  }
  const result = settlement.result;
  switch (result?.outcome) {
    case "done":
      return (await completeJob(db, job, t)) ? "done" : "stale";
    case "retry":
      if (result.retryAt !== undefined && !validRetryAt(result.retryAt))
        return failJob(db, job, "invalid_retry_at", true, undefined, t);
      return failJob(db, job, jobErrorCode(result.code), true, result.retryAt, t);
    case "defer":
      if (!validRetryAt(result.retryAt))
        return failJob(db, job, "invalid_retry_at", true, undefined, t);
      return deferJob(db, job, jobErrorCode(result.code), result.retryAt, t);
    case "dead":
      return failJob(db, job, jobErrorCode(result.code), false, undefined, t);
    default:
      return failJob(db, job, "invalid_result", true, undefined, t);
  }
}

async function processJob(
  opts: RunJobsOptions,
  claimed: ClaimedJob,
  now: () => Date
): Promise<Settled | "abandoned"> {
  const db = opts.db;
  const t = opts.rpcTimeoutMs ?? RPC_TIMEOUT_MS;
  const handler = handlerFor(opts.handlers, claimed.kind);
  if (!handler)
    return failJob(db, claimed, "unknown_kind", false, undefined, t);

  const parsed = handler.schema.safeParse(claimed.payload);
  if (!parsed.success)
    return failJob(db, claimed, "invalid_payload", false, undefined, t);

  const attempt = await startJob(db, claimed, t);
  if (attempt === null) return "stale";
  const job: ClaimedJob = { ...claimed, attempts: attempt };

  const run = await runHandler(handler, job, parsed.data, db, now);
  if (run.kind === "abandoned") {
    // The lease stays with this runner. If the handler settles while this process lives, finish under the token;
    // fencing refuses it if the lease expired and another runner re-claimed the job meanwhile.
    void run.late
      .then((settlement) => finish(opts, job, settlement, true))
      .then(
        (settled) => log.info({ event: "jobs.run.late_settle", code: settled }),
        (err: unknown) =>
          log.warn({
            event: "jobs.run.late_settle_failed",
            code: jobErrorCode(errorTag(err), "late_settle_failed"),
          })
      );
    return "abandoned";
  }
  return finish(opts, job, run.settlement, run.timedOut);
}

export async function runJobs(opts: RunJobsOptions): Promise<RunJobsResult> {
  const now = opts.now ?? (() => new Date());
  const t = opts.rpcTimeoutMs ?? RPC_TIMEOUT_MS;
  const started = now().getTime();
  const remaining = () => opts.budgetMs - (now().getTime() - started);
  const counts = {
    claimed: 0,
    done: 0,
    retried: 0,
    dead: 0,
    stale: 0,
    released: 0,
    deferred: 0,
    abandoned: 0,
  };
  let ok = true;
  let errorCode: string | null = null;
  // Claimed jobs not started (or handed back) yet: released in parallel when the pass stops.
  let unstarted: ClaimedJob[] = [];

  const releaseAll = async (jobs: ClaimedJob[]) => {
    const results = await Promise.allSettled(
      jobs.map((job) => releaseJob(opts.db, job, t))
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value) counts.released += 1;
        else counts.stale += 1;
      }
    }
    const failed = results.find((r) => r.status === "rejected");
    if (failed) throw (failed as PromiseRejectedResult).reason;
  };

  const runId = await beginRunnerRun(opts.db, opts.worker, opts.source, t);
  try {
    for (;;) {
      const left = remaining();
      const fitting = opts.kinds.filter(
        (k) => jobCostMs(handlerFor(opts.handlers, k)) <= left
      );
      if (fitting.length === 0) break;

      const jobs = await claimJobs(
        opts.db,
        {
          kinds: fitting,
          batch: opts.batch,
          leaseSeconds: opts.leaseSeconds,
          worker: opts.worker,
          perTenant: opts.perTenant,
        },
        t
      );
      if (jobs.length === 0) break;
      counts.claimed += jobs.length;
      // Every job of the batch is unstarted until processJob takes it; the ones that no longer fit stay in the list.
      unstarted = [...jobs];

      for (const job of jobs) {
        if (jobCostMs(handlerFor(opts.handlers, job.kind)) > remaining()) continue;
        unstarted = unstarted.filter((j) => j !== job);
        const settled = await processJob(opts, job, now);
        if (settled === "done") counts.done += 1;
        else if (settled === "pending") counts.retried += 1;
        else if (settled === "dead") counts.dead += 1;
        else if (settled === "deferred") counts.deferred += 1;
        else if (settled === "abandoned") counts.abandoned += 1;
        else counts.stale += 1;
      }
      if (unstarted.length > 0) {
        // Something no longer fitted: hand it back now; the loop then re-checks which kinds still fit.
        const handBack = unstarted;
        unstarted = [];
        await releaseAll(handBack);
      }
    }
  } catch (err) {
    // A queue RPC failed or timed out: stop the pass. Claimed jobs not yet started are handed back (best effort; if
    // that fails too, their leases expire and they are claimed again without an attempt spent). A started job keeps
    // its lease and its counted attempt.
    ok = false;
    errorCode = jobErrorCode(errorTag(err), "runner_failed");
    log.warn({ event: "jobs.run.failed", code: errorCode });
    if (unstarted.length > 0) {
      await releaseAll(unstarted).catch(() => {});
    }
  }

  await endRunnerRun(
    opts.db,
    runId,
    {
      claimed: counts.claimed,
      done: counts.done,
      // A deferral is a "come back later" like a retry (ops.job_runner_runs has no separate column).
      retried: counts.retried + counts.deferred,
      dead: counts.dead,
      ok,
      errorCode,
    },
    t
  );

  const durationMs = Math.max(0, now().getTime() - started);
  log.info({ event: "jobs.run.completed", count: counts.claimed, durationMs });
  return { ...counts, ok, durationMs };
}
