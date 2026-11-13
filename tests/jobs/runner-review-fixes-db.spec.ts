/**
 * V2-04 04-07b (review triage 04-07: M-ATTEMPT, Lows L-2, L-4, I-3 of review A; independent review M2) on the live local
 * queue with migration 000043, driving the real runner (`runJobs` with the route's `RUN_PASS_CONFIG`). Time moves by SQL
 * (`locked_until`, `run_at`), never by sleeping; a crash is a client whose RPCs fail from a point on.
 *
 * - M-ATTEMPT: a pass that dies between claim and start (start_job and release_job never answer) leaves the job
 *   `running` with 0 attempts; after its lease expires the reaper does not dead-letter it (even with max_attempts 1,
 *   which 04-01 dead-lettered `lease_expired` without ever running it), repeated crashes spend nothing, and the next
 *   healthy pass runs it once (attempt 1).
 * - L-2: a handler that ignores its abort is abandoned with its lease: the job stays `running`, a second runner claims
 *   nothing until the lease expires, then re-claims and retries it; when the abandoned handler finally returns `done`,
 *   its completion is refused by fencing and the job stays as the second runner left it.
 * - L-4: a handler's invalid `retryAt` fails only that job (`invalid_retry_at`, retryable); the pass stays ok and its
 *   other job completes.
 * - `defer_job` (independent review M2): returns the started attempt, counts a deferral, keeps `run_at` ≥ now + 5 s;
 *   after 20 deferrals it is an ordinary retry; a NULL time is refused (22023).
 * - I-3: a pending job of a kind no deployment registers fires `queue_oldest_due` after 5 minutes (rolled back).
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { RUN_PASS_CONFIG } from "@/lib/jobs/internal/run-config";
import { runJobs } from "@/lib/jobs/internal/runner";
import type { HandlerResult, JobHandler, JobsDb } from "@/lib/jobs/internal/types";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql, psqlSession } from "../helpers/sql";
import {
  deleteJobs,
  deleteRunnerRuns,
  deleteTenants,
  enqueueMany,
  insertTenant,
  jobRows,
  letters,
  recordingHandler,
  uniqueKind,
} from "./helpers";

const WORKER = `spec-rfix-${letters(8)}`;
const kinds: string[] = [];
const tenantId = insertTenant(`runner fixes ${letters(6)}`);

afterAll(() => {
  deleteJobs(kinds);
  deleteRunnerRuns(WORKER);
  deleteTenants([tenantId]);
});

function kind(word: string): string {
  const k = uniqueKind(word);
  kinds.push(k);
  return k;
}

function expireLease(id: string): void {
  psql(`update ops.jobs set locked_until = now() - interval '1 second' where id = '${id}'`);
}

function column(id: string, expr: string): string {
  return psql(`select ${expr} from ops.jobs where id = '${id}'`)[0];
}

interface Recorded {
  fn: string;
  data: unknown;
}

/**
 * The service-role client, except that the named RPCs fail (the process "died" there: nothing reaches the database).
 * Records every answered RPC.
 */
function client(opts: { dead?: string[] } = {}) {
  const real = getAdminClient();
  const answered: Recorded[] = [];
  const rpc = (fn: string, args: Record<string, unknown>) => {
    if (opts.dead?.includes(fn)) return Promise.resolve({ data: null, error: { code: "08006" } });
    return Promise.resolve(
      (real.rpc as unknown as (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>)(fn, args)
    ).then((res) => {
      answered.push({ fn, data: res.data });
      return res;
    });
  };
  return { db: { rpc } as unknown as JobsDb, answered };
}

const NUM = z.object({ n: z.number().int() });

function pass(db: JobsDb, k: string, handler: JobHandler<unknown>, worker: string) {
  return runJobs({ db, ...RUN_PASS_CONFIG, worker: `${WORKER}-${worker}`, source: "test", kinds: [k], handlers: { [k]: handler } });
}

describe("M-ATTEMPT: a crash between claim and start spends no attempt", () => {
  it("a job with max_attempts 1 survives repeated crashes after its claim and then runs once", async () => {
    const k = kind("crash");
    const [id] = enqueueMany(k, tenantId, 1, { maxAttempts: 1 });
    const seen: string[] = [];

    for (let i = 0; i < 3; i++) {
      const dying = client({ dead: ["start_job", "release_job"] });
      const result = await pass(dying.db, k, recordingHandler(seen), `crash-${i}`);
      expect(result).toMatchObject({ ok: false, claimed: 1, done: 0 });
      expect(seen).toEqual([]);
      expect(jobRows(k)).toEqual([{ id, status: "running", attempts: 0, lastError: null }]);

      // The lease runs out; the job reaper must not dead-letter a job that never ran.
      expireLease(id);
      psql("select ops.reap_jobs()");
      expect(jobRows(k)).toEqual([{ id, status: "running", attempts: 0, lastError: null }]);
    }

    const result = await pass(getAdminClient(), k, recordingHandler(seen), "healthy");
    expect(result).toMatchObject({ ok: true, claimed: 1, done: 1 });
    expect(seen).toEqual([id]);
    expect(jobRows(k)).toEqual([{ id, status: "done", attempts: 1, lastError: null }]);
  });
});

describe("L-2: a timed-out handler keeps its lease and cannot complete after a re-claim", () => {
  it("the abandoned run blocks other runners until the lease expires, and its late `done` is refused", async () => {
    const k = kind("deaf");
    const [id] = enqueueMany(k, tenantId, 1, { maxAttempts: 5 });
    let settle: (r: HandlerResult) => void = () => {};
    let aborted = false;
    const deaf: JobHandler<unknown> = {
      schema: NUM,
      maxDurationMs: 50,
      run: (_job, _payload, ctx) =>
        new Promise<HandlerResult>((resolve) => {
          ctx.signal.addEventListener("abort", () => {
            aborted = true; // ignored: the run carries on
          });
          settle = resolve;
        }),
    };

    const first = client();
    const r1 = await pass(first.db, k, deaf, "deaf");
    expect(aborted).toBe(true);
    expect(r1).toMatchObject({ ok: true, claimed: 1, abandoned: 1, retried: 0, done: 0 });
    expect(jobRows(k)).toEqual([{ id, status: "running", attempts: 1, lastError: null }]);
    const firstToken = column(id, "lease_token");

    // While the abandoned handler may still act, no other runner can take the job.
    const seen: string[] = [];
    const r2 = await pass(getAdminClient(), k, recordingHandler(seen), "second");
    expect(r2.claimed).toBe(0);
    expect(seen).toEqual([]);

    // The lease runs out: the second runner re-claims it and its handler asks for a retry.
    expireLease(id);
    const retrying: JobHandler<unknown> = {
      schema: NUM,
      maxDurationMs: 1_000,
      run: async () => ({ outcome: "retry", code: "provider_down" }),
    };
    const r3 = await pass(getAdminClient(), k, retrying, "third");
    expect(r3).toMatchObject({ claimed: 1, retried: 1 });
    expect(jobRows(k)).toEqual([{ id, status: "pending", attempts: 2, lastError: "provider_down" }]);

    // The abandoned run finally returns `done`: it is finished under its own (stale) token and refused.
    settle({ outcome: "done" });
    await vi.waitFor(() => expect(first.answered.filter((c) => c.fn === "complete_job").map((c) => c.data)).toEqual([false]));
    expect(jobRows(k)).toEqual([{ id, status: "pending", attempts: 2, lastError: "provider_down" }]);
    expect(column(id, "lease_token is null")).toBe("t");
    expect(firstToken).not.toBe("");
  });
});

describe("L-4: an invalid retryAt fails only its own job", () => {
  it("retryable invalid_retry_at for that job; the pass stays ok and the other job completes", async () => {
    const k = kind("badat");
    const [bad, good] = enqueueMany(k, tenantId, 2);
    const handler: JobHandler<unknown> = {
      schema: NUM,
      maxDurationMs: 1_000,
      run: async (job) =>
        job.id === bad ? { outcome: "retry", code: "rate_limited", retryAt: new Date("not a date") } : { outcome: "done" },
    };
    const result = await pass(getAdminClient(), k, handler, "badat");
    expect(result).toMatchObject({ ok: true, claimed: 2, done: 1, retried: 1 });
    const rows = jobRows(k);
    expect(rows.find((r) => r.id === bad)).toEqual({ id: bad, status: "pending", attempts: 1, lastError: "invalid_retry_at" });
    expect(rows.find((r) => r.id === good)).toEqual({ id: good, status: "done", attempts: 1, lastError: null });
  });
});

describe("defer_job (independent review M2)", () => {
  async function claimAndStart(k: string): Promise<{ id: string; token: string }> {
    const db = getAdminClient();
    const { data, error } = await db.rpc("claim_jobs", { p_kinds: [k], p_batch: 1, p_lease_seconds: 60, p_worker: `${WORKER}-defer` });
    expect(error).toBeNull();
    const [row] = data ?? [];
    const started = await db.rpc("start_job", { p_id: row.id, p_lease_token: row.lease_token });
    expect(started.error).toBeNull();
    expect(started.data).toBe(row.attempts + 1);
    return { id: row.id, token: row.lease_token };
  }

  async function defer(id: string, token: string, retryAt: string | null) {
    return getAdminClient().rpc("defer_job", {
      p_id: id,
      p_lease_token: token,
      p_error_code: "delivery_in_progress",
      p_retry_at: retryAt as string,
    });
  }

  it("returns the attempt, counts a deferral and waits at least 5 s; the stale token is refused", async () => {
    const k = kind("defer");
    const [id] = enqueueMany(k, tenantId, 1);
    const job = await claimAndStart(k);
    const now = psql("select now()::text")[0];
    const res = await defer(id, job.token, now);
    expect(res.error).toBeNull();
    expect(res.data).toBe("deferred");
    expect(jobRows(k)).toEqual([{ id, status: "pending", attempts: 0, lastError: "delivery_in_progress" }]);
    expect(column(id, "deferrals")).toBe("1");
    expect(Number(column(id, "extract(epoch from run_at - updated_at)"))).toBeGreaterThanOrEqual(5);
    expect(column(id, "lease_token is null and locked_until is null and finished_at is null")).toBe("t");
    expect((await defer(id, job.token, now)).data).toBe("stale");
  });

  it("after 20 deferrals a deferral keeps its attempt (an ordinary retry), so a job that never progresses still ends", async () => {
    const k = kind("defercap");
    const [id] = enqueueMany(k, tenantId, 1, { maxAttempts: 2 });
    psql(`update ops.jobs set deferrals = 20 where id = '${id}'`);
    let job = await claimAndStart(k);
    expect((await defer(id, job.token, psql("select (now() + interval '1 minute')::text")[0])).data).toBe("pending");
    expect(jobRows(k)).toEqual([{ id, status: "pending", attempts: 1, lastError: "delivery_in_progress" }]);
    psql(`update ops.jobs set run_at = now() - interval '1 second' where id = '${id}'`);
    job = await claimAndStart(k);
    expect((await defer(id, job.token, psql("select (now() + interval '1 minute')::text")[0])).data).toBe("dead");
    expect(jobRows(k)).toEqual([{ id, status: "dead", attempts: 2, lastError: "delivery_in_progress" }]);
  });

  it("refuses a NULL retry time (22023) and changes nothing", async () => {
    const k = kind("defernull");
    const [id] = enqueueMany(k, tenantId, 1);
    const job = await claimAndStart(k);
    const res = await defer(id, job.token, null);
    expect(res.error?.code).toBe("22023");
    expect(jobRows(k)).toEqual([{ id, status: "running", attempts: 1, lastError: null }]);
  });
});

describe("I-3: a job of a kind no deployment registers is not silent", () => {
  it("fires queue_oldest_due with its id once it is 5 minutes overdue (rolled back)", () => {
    const lines = psqlSession([
      "begin",
      "delete from ops.jobs where status = 'pending'",
      "insert into ops.jobs (kind, dedupe_key, run_at) values ('test.unregistered_kind', 'rfix:' || gen_random_uuid(), now() - interval '6 minutes')",
      "select 'R|' || f.firing::text || '|' || (f.details -> 'job_ids' ->> 0 = (select id::text from ops.jobs where kind = 'test.unregistered_kind')) from ops.alert_rule_queue_oldest_due('{}'::jsonb) f",
      "rollback",
    ]);
    expect(lines.find((l) => l.startsWith("R|"))).toBe("R|true|true");
  });
});
