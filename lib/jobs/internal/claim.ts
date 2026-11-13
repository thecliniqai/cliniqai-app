/**
 * Typed wrappers over the job queue RPCs (V2-04 04-01, migration 000031). Every RPC is a service-role-only SECURITY
 * DEFINER function; the caller passes the system client. A failed RPC throws {@link JobsRpcError} carrying the
 * database / PostgREST code only: the message (which can quote row values) is never kept.
 */
import type { ClaimedJob, JobsDb, RunnerSource } from "./types";

export class JobsRpcError extends Error {
  readonly code: string;

  constructor(rpc: string, code: string | undefined) {
    super(`jobs rpc ${rpc} failed`);
    this.name = "JobsRpcError";
    this.code =
      code && /^[A-Za-z0-9_.-]{1,40}$/.test(code) ? code : "jobs_rpc_failed";
  }
}

function check<T>(
  rpc: string,
  res: { data: T | null; error: { code?: string } | null }
): T {
  if (res.error) throw new JobsRpcError(rpc, res.error.code);
  return res.data as T;
}

export interface ClaimArgs {
  kinds: string[];
  batch: number;
  leaseSeconds: number;
  worker: string;
  perTenant: number;
}

export async function claimJobs(
  db: JobsDb,
  args: ClaimArgs
): Promise<ClaimedJob[]> {
  const rows = check(
    "claim_jobs",
    await db.rpc("claim_jobs", {
      p_kinds: args.kinds,
      p_batch: args.batch,
      p_lease_seconds: args.leaseSeconds,
      p_worker: args.worker,
      p_per_tenant: args.perTenant,
    })
  );
  return (rows ?? [])
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      // The generated type says string; tenant-less jobs (unmatched-sender replies, alerts) carry NULL.
      tenantId: (r.tenant_id as string | null) ?? null,
      payload: r.payload,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      leaseToken: r.lease_token,
      runAt: r.run_at,
    }))
    .sort((a, b) =>
      a.runAt < b.runAt ? -1 : a.runAt > b.runAt ? 1 : a.id < b.id ? -1 : 1
    );
}

/** `true` if the job is now `done`; `false` if the lease was no longer this caller's (fencing). */
export async function completeJob(
  db: JobsDb,
  job: Pick<ClaimedJob, "id" | "leaseToken">
): Promise<boolean> {
  return (
    check(
      "complete_job",
      await db.rpc("complete_job", {
        p_id: job.id,
        p_lease_token: job.leaseToken,
      })
    ) === true
  );
}

export type FailOutcome = "pending" | "dead" | "stale";

export async function failJob(
  db: JobsDb,
  job: Pick<ClaimedJob, "id" | "leaseToken">,
  code: string,
  retryable: boolean,
  retryAt?: Date
): Promise<FailOutcome> {
  const out = check(
    "fail_job",
    await db.rpc("fail_job", {
      p_id: job.id,
      p_lease_token: job.leaseToken,
      p_error_code: code,
      p_retryable: retryable,
      ...(retryAt ? { p_retry_at: retryAt.toISOString() } : {}),
    })
  );
  if (out !== "pending" && out !== "dead" && out !== "stale")
    throw new JobsRpcError("fail_job", "unexpected_result");
  return out;
}

/** Hands an unstarted job back (pending again, the claim's attempt returned). `false` if the lease was lost. */
export async function releaseJob(
  db: JobsDb,
  job: Pick<ClaimedJob, "id" | "leaseToken">
): Promise<boolean> {
  return (
    check(
      "release_job",
      await db.rpc("release_job", {
        p_id: job.id,
        p_lease_token: job.leaseToken,
      })
    ) === true
  );
}

export async function beginRunnerRun(
  db: JobsDb,
  worker: string,
  source: RunnerSource
): Promise<number> {
  const id = check(
    "jobs_runner_begin",
    await db.rpc("jobs_runner_begin", { p_worker: worker, p_source: source })
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
  end: RunnerRunEnd
): Promise<void> {
  check(
    "jobs_runner_end",
    await db.rpc("jobs_runner_end", {
      p_run_id: runId,
      p_claimed: end.claimed,
      p_done: end.done,
      p_retried: end.retried,
      p_dead: end.dead,
      p_ok: end.ok,
      // The generated Args type marks it required; NULL means "no error".
      p_error_code: end.errorCode as string,
    })
  );
}
