/**
 * Typed wrappers over the job queue RPCs (V2-04 04-01, migrations 000031 and 000043). Every RPC is a service-role-only
 * SECURITY DEFINER function; the caller passes the system client. A failed RPC throws {@link JobsRpcError} carrying the
 * database / PostgREST code only: the message (which can quote row values) is never kept.
 *
 * 04-07b (review A L-3): every call has a hard wall-clock bound (`timeoutMs`, default {@link RPC_TIMEOUT_MS}). The
 * request is aborted (`abortSignal`) and the call rejects with code `rpc_timeout` even if the transport ignores the
 * abort, so a stalled connection can never hold a runner pass past the route's 60 s limit.
 */
import type { ClaimedJob, JobsDb, RunnerSource } from "./types";

/** Default hard bound for one queue RPC. */
export const RPC_TIMEOUT_MS = 5_000;

export class JobsRpcError extends Error {
  readonly code: string;

  constructor(rpc: string, code: string | undefined) {
    super(`jobs rpc ${rpc} failed`);
    this.name = "JobsRpcError";
    this.code =
      code && /^[A-Za-z0-9_.-]{1,40}$/.test(code) ? code : "jobs_rpc_failed";
  }
}

type RpcResponse<T> = { data: T | null; error: { code?: string } | null };
type RpcBuilder<T> = PromiseLike<RpcResponse<T>> & {
  abortSignal?: (signal: AbortSignal) => PromiseLike<RpcResponse<T>>;
};

async function call<T>(
  db: JobsDb,
  rpc: string,
  args: Record<string, unknown>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new JobsRpcError(rpc, "rpc_timeout"));
    }, timeoutMs);
  });
  try {
    const builder = (db.rpc as unknown as (
      fn: string,
      a: Record<string, unknown>
    ) => RpcBuilder<T>)(rpc, args);
    const request: PromiseLike<RpcResponse<T>> =
      typeof builder.abortSignal === "function"
        ? builder.abortSignal(controller.signal)
        : builder;
    const pending = Promise.resolve(request);
    // A response (or rejection) arriving after the timeout must not become an unhandled rejection.
    pending.catch(() => {});
    const res = await Promise.race([pending, timedOut]);
    if (res.error) throw new JobsRpcError(rpc, res.error.code);
    return res.data as T;
  } catch (err) {
    if (err instanceof JobsRpcError) throw err;
    // A transport error (fetch rejected): keep a code, never the message.
    throw new JobsRpcError(rpc, (err as { code?: string } | null)?.code ?? "rpc_transport");
  } finally {
    clearTimeout(timer);
  }
}

export interface ClaimArgs {
  kinds: string[];
  batch: number;
  leaseSeconds: number;
  worker: string;
  perTenant: number;
}

interface ClaimRow {
  id: string;
  kind: string;
  tenant_id: string | null;
  payload: unknown;
  attempts: number;
  max_attempts: number;
  lease_token: string;
  run_at: string;
}

const byRunAt = (a: ClaimedJob, b: ClaimedJob) =>
  a.runAt < b.runAt ? -1 : a.runAt > b.runAt ? 1 : a.id < b.id ? -1 : 1;

/**
 * 04-07b (M-FAIR): the claimed jobs in round-robin order across tenants, the same order `claim_jobs` picks them in:
 * every tenant's oldest job first (tenants ordered by their oldest job), then every tenant's second, and so on. A pass
 * that runs out of budget part-way through a batch has then served every tenant in it about equally.
 */
export function fairOrder(jobs: ClaimedJob[]): ClaimedJob[] {
  const groups = new Map<string, ClaimedJob[]>();
  for (const job of [...jobs].sort(byRunAt)) {
    const key = job.tenantId ?? "";
    const group = groups.get(key);
    if (group) group.push(job);
    else groups.set(key, [job]);
  }
  // Map iteration follows insertion order, i.e. each tenant's oldest job in run_at order.
  const queues = [...groups.values()];
  const out: ClaimedJob[] = [];
  for (let round = 0; out.length < jobs.length; round++) {
    for (const q of queues) if (round < q.length) out.push(q[round]);
  }
  return out;
}

export async function claimJobs(
  db: JobsDb,
  args: ClaimArgs,
  timeoutMs = RPC_TIMEOUT_MS
): Promise<ClaimedJob[]> {
  const rows = await call<ClaimRow[]>(
    db,
    "claim_jobs",
    {
      p_kinds: args.kinds,
      p_batch: args.batch,
      p_lease_seconds: args.leaseSeconds,
      p_worker: args.worker,
      p_per_tenant: args.perTenant,
    },
    timeoutMs
  );
  return fairOrder(
    (rows ?? []).map((r) => ({
      id: r.id,
      kind: r.kind,
      // The generated type says string; tenant-less jobs (unmatched-sender replies, alerts) carry NULL.
      tenantId: r.tenant_id ?? null,
      payload: r.payload,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      leaseToken: r.lease_token,
      runAt: r.run_at,
    }))
  );
}

/**
 * 04-07b (M-ATTEMPT): counts the attempt just before the handler runs. Returns the attempt number, or `null` when the
 * lease is no longer this caller's (taken over, expired, or already started): the handler must not run.
 */
export async function startJob(
  db: JobsDb,
  job: Pick<ClaimedJob, "id" | "leaseToken">,
  timeoutMs = RPC_TIMEOUT_MS
): Promise<number | null> {
  const out = await call<number | null>(
    db,
    "start_job",
    { p_id: job.id, p_lease_token: job.leaseToken },
    timeoutMs
  );
  if (out === null || out === undefined) return null;
  if (typeof out !== "number")
    throw new JobsRpcError("start_job", "unexpected_result");
  return out;
}

/** `true` if the job is now `done`; `false` if the lease was no longer this caller's (fencing). */
export async function completeJob(
  db: JobsDb,
  job: Pick<ClaimedJob, "id" | "leaseToken">,
  timeoutMs = RPC_TIMEOUT_MS
): Promise<boolean> {
  return (
    (await call<boolean>(
      db,
      "complete_job",
      { p_id: job.id, p_lease_token: job.leaseToken },
      timeoutMs
    )) === true
  );
}

export type FailOutcome = "pending" | "dead" | "stale";

/** A usable retry time: a `Date` holding a finite time. Anything else is dropped (04-07b, review A L-4). */
export function validRetryAt(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export async function failJob(
  db: JobsDb,
  job: Pick<ClaimedJob, "id" | "leaseToken">,
  code: string,
  retryable: boolean,
  retryAt?: Date,
  timeoutMs = RPC_TIMEOUT_MS
): Promise<FailOutcome> {
  const out = await call<string>(
    db,
    "fail_job",
    {
      p_id: job.id,
      p_lease_token: job.leaseToken,
      p_error_code: code,
      p_retryable: retryable,
      ...(validRetryAt(retryAt) ? { p_retry_at: retryAt.toISOString() } : {}),
    },
    timeoutMs
  );
  if (out !== "pending" && out !== "dead" && out !== "stale")
    throw new JobsRpcError("fail_job", "unexpected_result");
  return out;
}

export type DeferOutcome = "deferred" | FailOutcome;

/** 04-07b: hands a started job back to `retryAt` with its attempt returned (bounded in SQL; see `defer_job`). */
export async function deferJob(
  db: JobsDb,
  job: Pick<ClaimedJob, "id" | "leaseToken">,
  code: string,
  retryAt: Date,
  timeoutMs = RPC_TIMEOUT_MS
): Promise<DeferOutcome> {
  if (!validRetryAt(retryAt))
    throw new JobsRpcError("defer_job", "invalid_retry_at");
  const out = await call<string>(
    db,
    "defer_job",
    {
      p_id: job.id,
      p_lease_token: job.leaseToken,
      p_error_code: code,
      p_retry_at: retryAt.toISOString(),
    },
    timeoutMs
  );
  if (out !== "deferred" && out !== "pending" && out !== "dead" && out !== "stale")
    throw new JobsRpcError("defer_job", "unexpected_result");
  return out;
}

/** Hands an unstarted job back (pending again; no attempt was counted). `false` if the lease was lost. */
export async function releaseJob(
  db: JobsDb,
  job: Pick<ClaimedJob, "id" | "leaseToken">,
  timeoutMs = RPC_TIMEOUT_MS
): Promise<boolean> {
  return (
    (await call<boolean>(
      db,
      "release_job",
      { p_id: job.id, p_lease_token: job.leaseToken },
      timeoutMs
    )) === true
  );
}

export async function beginRunnerRun(
  db: JobsDb,
  worker: string,
  source: RunnerSource,
  timeoutMs = RPC_TIMEOUT_MS
): Promise<number> {
  const id = await call<number>(
    db,
    "jobs_runner_begin",
    { p_worker: worker, p_source: source },
    timeoutMs
  );
  if (typeof id !== "number")
    throw new JobsRpcError("jobs_runner_begin", "unexpected_result");
  return id;
}

export interface RunnerRunEnd {
  claimed: number;
  done: number;
  retried: number;
  dead: number;
  ok: boolean;
  errorCode: string | null;
}

export async function endRunnerRun(
  db: JobsDb,
  runId: number,
  end: RunnerRunEnd,
  timeoutMs = RPC_TIMEOUT_MS
): Promise<void> {
  await call<null>(
    db,
    "jobs_runner_end",
    {
      p_run_id: runId,
      p_claimed: end.claimed,
      p_done: end.done,
      p_retried: end.retried,
      p_dead: end.dead,
      p_ok: end.ok,
      // NULL means "no error".
      p_error_code: end.errorCode,
    },
    timeoutMs
  );
}
