/**
 * V2-04 04-01 (P0-12, T-04-09, T-04-10): `runJobs` against a fake RPC client (no database).
 *
 * - An unknown kind and an invalid payload are failed non-retryable (`unknown_kind`, `invalid_payload`).
 * - A handler that throws an error whose message holds a synthetic phone: `fail_job` gets the error tag only, and the
 *   phone appears nowhere in the recorded RPC calls or in captured stdout/stderr.
 * - With a 3 s budget and a handler of `maxDurationMs` 5 s, nothing is claimed or started.
 * - Outcomes map to complete/fail calls and the returned counts; a job that no longer fits the budget is released;
 *   a refused completion (lost lease) counts as stale; a handler that outlives its bound is retried; a failed queue RPC
 *   ends the pass with ok = false and a code.
 * - 04-07b: batches are not sized by the slowest kind (route config + 12 s handler → p_batch 10, M-FAIR); claimed jobs
 *   run round-robin across tenants; `start_job` runs before every handler and a refused start never runs it
 *   (M-ATTEMPT); a handler that ignores its abort is abandoned with its lease (no fail_job) and finished under its token
 *   only if it settles later (L-2); an invalid retryAt fails only that job (L-4); a stalled RPC ends the pass with
 *   `rpc_timeout` and claimed-but-unstarted jobs are handed back (L-3); `defer` reaches defer_job.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { fairOrder } from "@/lib/jobs/internal/claim";
import { RUN_PASS_CONFIG } from "@/lib/jobs/internal/run-config";
import { runJobs, type RunJobsOptions } from "@/lib/jobs/internal/runner";
import type {
  ClaimedJob,
  HandlerMap,
  HandlerResult,
  JobHandler,
  JobsDb,
} from "@/lib/jobs/internal/types";

interface Call {
  fn: string;
  args: Record<string, unknown>;
}

interface FakeJob {
  id: string;
  kind: string;
  payload: unknown;
  tenantId?: string;
}

/** An in-memory stand-in for the runner RPCs: hands out `jobs` on the first claims, records every call. */
function fakeDb(
  jobs: FakeJob[],
  opts: {
    completeReturns?: boolean;
    failClaim?: boolean;
    startReturns?: number | null;
    /** RPCs that never answer (a stalled connection). */
    stall?: string[];
    /** RPCs that answer with an error. */
    fail?: string[];
  } = {}
) {
  const calls: Call[] = [];
  const signals: Array<{ fn: string; signal: AbortSignal }> = [];
  let queue = jobs.map((j, i) => ({
    ...j,
    attempts: 0,
    max_attempts: 5,
    lease_token: `token-${i}`,
    run_at: `2026-11-13T00:00:${String(i).padStart(2, "0")}Z`,
    tenant_id: j.tenantId ?? null,
  }));
  const answer = async (fn: string, args: Record<string, unknown>) => {
    switch (fn) {
      case "jobs_runner_begin":
        return { data: 7, error: null };
      case "jobs_runner_end":
        return { data: null, error: null };
      case "claim_jobs": {
        if (opts.failClaim)
          return {
            data: null,
            error: {
              code: "57014",
              message: "canceling statement due to timeout",
            },
          };
        const kinds = args.p_kinds as string[];
        const take = queue
          .filter((j) => kinds.includes(j.kind))
          .slice(0, args.p_batch as number);
        queue = queue.filter((j) => !take.includes(j));
        return { data: take, error: null };
      }
      case "start_job":
        return { data: opts.startReturns === undefined ? 1 : opts.startReturns, error: null };
      case "complete_job":
        return { data: opts.completeReturns ?? true, error: null };
      case "fail_job":
        return { data: args.p_retryable ? "pending" : "dead", error: null };
      case "defer_job":
        return { data: "deferred", error: null };
      case "release_job":
        return { data: true, error: null };
      default:
        throw new Error(`unexpected rpc ${fn}`);
    }
  };
  const rpc = (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    const p: Promise<unknown> = opts.stall?.includes(fn)
      ? new Promise(() => {})
      : opts.fail?.includes(fn)
        ? Promise.resolve({ data: null, error: { code: "08006", message: "connection lost" } })
        : answer(fn, args);
    // The PostgREST builder's abortSignal(): the runner must pass one on every call.
    return Object.assign(p, {
      abortSignal(signal: AbortSignal) {
        signals.push({ fn, signal });
        return p;
      },
    });
  };
  return { db: { rpc } as unknown as JobsDb, calls, signals };
}

const payload = z.object({ id: z.string().uuid() });
const ID = "6f0c2a4e-8a51-4c1e-9d5b-3f1a2b3c4d5e";

function handler(
  run: JobHandler<{ id: string }>["run"],
  maxDurationMs = 1000
): JobHandler<unknown> {
  return { schema: payload, maxDurationMs, run } as JobHandler<unknown>;
}

function options(
  db: JobsDb,
  handlers: HandlerMap,
  extra: Partial<RunJobsOptions> = {}
): RunJobsOptions {
  return {
    db,
    budgetMs: 20_000,
    batch: 10,
    leaseSeconds: 120,
    perTenant: 10,
    worker: "spec-runner",
    source: "test",
    kinds: Object.keys(handlers),
    handlers,
    ...extra,
  };
}

const failCalls = (calls: Call[]) =>
  calls
    .filter((c) => c.fn === "fail_job")
    .map((c) => [c.args.p_id, c.args.p_error_code, c.args.p_retryable]);

let output: string[];

beforeEach(() => {
  output = [];
  const capture = (chunk: unknown) => {
    output.push(String(chunk));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(
    capture as typeof process.stdout.write
  );
  vi.spyOn(process.stderr, "write").mockImplementation(
    capture as typeof process.stderr.write
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runJobs: refusals", () => {
  it("fails an unknown kind and an invalid payload non-retryable, without running any handler", async () => {
    const ran = vi.fn(async (): Promise<HandlerResult> => ({
      outcome: "done",
    }));
    const { db, calls } = fakeDb([
      { id: "j-unknown", kind: "test.nohandler", payload: { id: ID } },
      { id: "j-invalid", kind: "test.known", payload: { id: "not-a-uuid" } },
    ]);
    const result = await runJobs(
      options(
        db,
        { "test.known": handler(ran) },
        { kinds: ["test.known", "test.nohandler"] }
      )
    );

    expect(ran).not.toHaveBeenCalled();
    expect(failCalls(calls)).toEqual([
      ["j-unknown", "unknown_kind", false],
      ["j-invalid", "invalid_payload", false],
    ]);
    expect(result).toMatchObject({ claimed: 2, done: 0, retried: 0, dead: 2 });
  });

  it("a thrown error reaches fail_job as its tag only; a synthetic phone in the message is never recorded or logged", async () => {
    const phone = ["+91", "90000", "00042"].join("");
    const { db, calls } = fakeDb([
      { id: "j-throw", kind: "test.throw", payload: { id: ID } },
    ]);
    const result = await runJobs(
      options(db, {
        "test.throw": handler(async () => {
          throw new TypeError(`provider rejected ${phone} (patient ${phone})`);
        }),
      })
    );

    expect(failCalls(calls)).toEqual([["j-throw", "TypeError", true]]);
    expect(result).toMatchObject({ claimed: 1, retried: 1 });
    const recorded = JSON.stringify(calls) + output.join("");
    expect(recorded).not.toContain("00042");
    expect(recorded).not.toContain("provider rejected");
    // The pass still logs its one counts-only line.
    expect(output.join("")).toContain('"event":"jobs.run.completed"');
  });

  it("a handler's free-text code is replaced by a fixed one", async () => {
    const phone = ["+91", "90000", "00043"].join("");
    const { db, calls } = fakeDb([
      { id: "j-a", kind: "test.code", payload: { id: ID } },
      { id: "j-b", kind: "test.code", payload: { id: ID } },
    ]);
    let n = 0;
    await runJobs(
      options(db, {
        "test.code": handler(async () =>
          n++ === 0
            ? { outcome: "retry", code: `failed for ${phone}` }
            : { outcome: "dead", code: phone }
        ),
      })
    );
    expect(failCalls(calls)).toEqual([
      ["j-a", "error", true],
      ["j-b", "error", false],
    ]);
    expect(JSON.stringify(calls)).not.toContain("00043");
  });
});

describe("runJobs: budget", () => {
  it("with a 3 s budget and a 5 s handler, claims nothing and starts nothing", async () => {
    const ran = vi.fn(async (): Promise<HandlerResult> => ({
      outcome: "done",
    }));
    const { db, calls } = fakeDb([
      { id: "j-slow", kind: "test.slow", payload: { id: ID } },
    ]);
    const result = await runJobs(
      options(db, { "test.slow": handler(ran, 5_000) }, { budgetMs: 3_000 })
    );

    expect(ran).not.toHaveBeenCalled();
    expect(calls.map((c) => c.fn)).toEqual([
      "jobs_runner_begin",
      "jobs_runner_end",
    ]);
    expect(result).toMatchObject({
      claimed: 0,
      done: 0,
      retried: 0,
      dead: 0,
      released: 0,
    });
  });

  it("claims a full batch and releases a claimed job the budget no longer covers, without starting it", async () => {
    let clock = Date.parse("2026-11-13T00:00:00Z");
    const now = () => new Date(clock);
    const ran: string[] = [];
    const { db, calls } = fakeDb([
      { id: "j-1", kind: "test.tick", payload: { id: ID } },
      { id: "j-2", kind: "test.tick", payload: { id: ID } },
      { id: "j-3", kind: "test.tick", payload: { id: ID } },
    ]);
    const result = await runJobs(
      options(
        db,
        {
          "test.tick": handler(async (job) => {
            ran.push(job.id);
            clock += 3_500; // the job took 3.5 s of the 5 s budget
            return { outcome: "done" };
          }, 1_000),
        },
        { budgetMs: 5_000, now }
      )
    );

    // 04-07b: the claim asks for the configured batch (10), not budget / worst cost; after the first job only 1.5 s is
    // left (< 1 s + 0.5 s grace + 1 s margin), so the other two are handed back unstarted: no start_job for them.
    expect(calls.find((c) => c.fn === "claim_jobs")?.args.p_batch).toBe(10);
    expect(ran).toEqual(["j-1"]);
    expect(
      calls.filter((c) => c.fn === "release_job").map((c) => c.args.p_id)
    ).toEqual(["j-2", "j-3"]);
    expect(
      calls.filter((c) => c.fn === "start_job").map((c) => c.args.p_id)
    ).toEqual(["j-1"]);
    expect(result).toMatchObject({ claimed: 3, done: 1, released: 2 });
  });
});

describe("runJobs: outcomes and counts", () => {
  it("maps done / retry / dead to complete_job and fail_job and returns the counts", async () => {
    const retryAt = new Date("2026-11-13T01:00:00Z");
    const results: Record<string, HandlerResult> = {
      "j-done": { outcome: "done" },
      "j-retry": { outcome: "retry", code: "rate_limited", retryAt },
      "j-dead": { outcome: "dead", code: "recipient_invalid" },
    };
    const { db, calls } = fakeDb(
      Object.keys(results).map((id) => ({
        id,
        kind: "test.mix",
        payload: { id: ID },
      }))
    );
    const seen: Array<{ id: string; payload: unknown; aborted: boolean }> = [];
    const result = await runJobs(
      options(db, {
        "test.mix": handler(async (job, p, ctx) => {
          seen.push({ id: job.id, payload: p, aborted: ctx.signal.aborted });
          return results[job.id];
        }),
      })
    );

    expect(seen.map((s) => s.id)).toEqual(["j-done", "j-retry", "j-dead"]);
    expect(
      seen.every((s) => !s.aborted && (s.payload as { id: string }).id === ID)
    ).toBe(true);
    expect(
      calls
        .filter((c) => c.fn === "complete_job")
        .map((c) => [c.args.p_id, c.args.p_lease_token])
    ).toEqual([["j-done", "token-0"]]);
    expect(calls.filter((c) => c.fn === "fail_job").map((c) => c.args)).toEqual(
      [
        {
          p_id: "j-retry",
          p_lease_token: "token-1",
          p_error_code: "rate_limited",
          p_retryable: true,
          p_retry_at: retryAt.toISOString(),
        },
        {
          p_id: "j-dead",
          p_lease_token: "token-2",
          p_error_code: "recipient_invalid",
          p_retryable: false,
        },
      ]
    );
    expect(result).toMatchObject({
      ok: true,
      claimed: 3,
      done: 1,
      retried: 1,
      dead: 1,
      stale: 0,
      released: 0,
    });
    const end = calls.find((c) => c.fn === "jobs_runner_end")?.args;
    expect(end).toEqual({
      p_run_id: 7,
      p_claimed: 3,
      p_done: 1,
      p_retried: 1,
      p_dead: 1,
      p_ok: true,
      p_error_code: null,
    });
    expect(calls.find((c) => c.fn === "jobs_runner_begin")?.args).toEqual({
      p_worker: "spec-runner",
      p_source: "test",
    });
  });

  it("a completion refused by fencing (lease taken over) counts as stale, not done", async () => {
    const { db } = fakeDb(
      [{ id: "j-late", kind: "test.late", payload: { id: ID } }],
      { completeReturns: false }
    );
    const result = await runJobs(
      options(db, { "test.late": handler(async () => ({ outcome: "done" })) })
    );
    expect(result).toMatchObject({ claimed: 1, done: 0, stale: 1 });
  });

  it("a handler that outlives maxDurationMs is aborted; one that stops on the abort is retried as handler_timeout", async () => {
    let signalled = false;
    const { db, calls } = fakeDb([
      { id: "j-hang", kind: "test.hang", payload: { id: ID } },
    ]);
    const result = await runJobs(
      options(db, {
        "test.hang": handler(
          (_job, _p, ctx) =>
            new Promise<HandlerResult>((_resolve, reject) => {
              ctx.signal.addEventListener("abort", () => {
                signalled = true;
                reject(new DOMException("aborted", "AbortError"));
              });
            }),
          50
        ),
      })
    );
    expect(signalled).toBe(true);
    expect(failCalls(calls)).toEqual([["j-hang", "handler_timeout", true]]);
    expect(result).toMatchObject({ claimed: 1, retried: 1, abandoned: 0 });
  });

  it("a failed queue RPC ends the pass with ok = false and the error code, never the message", async () => {
    const { db, calls } = fakeDb([], { failClaim: true });
    const result = await runJobs(
      options(db, { "test.any": handler(async () => ({ outcome: "done" })) })
    );
    // 04-02: the route reports the pass outcome as `ok`.
    expect(result).toMatchObject({ claimed: 0, done: 0, ok: false });
    expect(calls.find((c) => c.fn === "jobs_runner_end")?.args).toMatchObject({
      p_ok: false,
      p_error_code: "57014",
    });
    expect(output.join("")).toContain('"event":"jobs.run.failed"');
    expect(output.join("")).not.toContain("canceling statement");
  });
});

describe("runJobs: 04-07b review fixes", () => {
  it("M-FAIR: with the route's configuration and a 12 s handler the claim batch is 10, not 1", async () => {
    const { db, calls } = fakeDb([
      { id: "j-a", kind: "test.msg", payload: { id: ID } },
    ]);
    await runJobs(
      options(
        db,
        { "test.msg": handler(async () => ({ outcome: "done" }), 12_000) },
        { ...RUN_PASS_CONFIG }
      )
    );
    const claim = calls.find((c) => c.fn === "claim_jobs")?.args;
    expect(claim).toMatchObject({ p_batch: 10, p_per_tenant: 5, p_lease_seconds: 120 });
  });

  it("M-FAIR: claimed jobs run round-robin across tenants (A's older backlog does not go first)", async () => {
    const A = "aaaaaaaa-0000-4000-8000-000000000001";
    const B = "bbbbbbbb-0000-4000-8000-000000000002";
    const jobs: FakeJob[] = [
      ...["a1", "a2", "a3", "a4"].map((id) => ({ id, kind: "test.rr", payload: { id: ID }, tenantId: A })),
      { id: "b1", kind: "test.rr", payload: { id: ID }, tenantId: B },
      { id: "b2", kind: "test.rr", payload: { id: ID }, tenantId: B },
    ];
    const ran: string[] = [];
    const { db } = fakeDb(jobs);
    await runJobs(
      options(db, {
        "test.rr": handler(async (job) => {
          ran.push(job.id);
          return { outcome: "done" };
        }),
      })
    );
    expect(ran).toEqual(["a1", "b1", "a2", "b2", "a3", "a4"]);
  });

  it("fairOrder: tenants in order of their oldest job, one job per tenant per round, tenant-less jobs as one tenant", () => {
    const job = (id: string, tenantId: string | null, runAt: string): ClaimedJob => ({
      id, kind: "k", tenantId, payload: {}, attempts: 0, maxAttempts: 5, leaseToken: id, runAt,
    });
    const out = fairOrder([
      job("b1", "B", "2026-11-13T00:00:05Z"),
      job("a2", "A", "2026-11-13T00:00:02Z"),
      job("n1", null, "2026-11-13T00:00:03Z"),
      job("a1", "A", "2026-11-13T00:00:01Z"),
      job("a3", "A", "2026-11-13T00:00:04Z"),
    ]);
    expect(out.map((j) => j.id)).toEqual(["a1", "n1", "b1", "a2", "a3"]);
  });

  it("M-ATTEMPT: start_job is called under the lease before the handler, and the handler sees the counted attempt", async () => {
    const seen: number[] = [];
    const { db, calls } = fakeDb([{ id: "j-s", kind: "test.start", payload: { id: ID } }]);
    await runJobs(
      options(db, {
        "test.start": handler(async (job) => {
          seen.push(job.attempts);
          expect(calls.map((c) => c.fn)).toContain("start_job");
          return { outcome: "done" };
        }),
      })
    );
    expect(seen).toEqual([1]);
    const fns = calls.map((c) => c.fn);
    expect(fns.indexOf("start_job")).toBeLessThan(fns.indexOf("complete_job"));
    expect(calls.find((c) => c.fn === "start_job")?.args).toEqual({ p_id: "j-s", p_lease_token: "token-0" });
  });

  it("M-ATTEMPT: a refused start (lease lost) never runs the handler and finishes nothing", async () => {
    const ran = vi.fn(async (): Promise<HandlerResult> => ({ outcome: "done" }));
    const { db, calls } = fakeDb([{ id: "j-lost", kind: "test.lost", payload: { id: ID } }], { startReturns: null });
    const result = await runJobs(options(db, { "test.lost": handler(ran) }));
    expect(ran).not.toHaveBeenCalled();
    expect(calls.filter((c) => ["complete_job", "fail_job", "defer_job"].includes(c.fn))).toEqual([]);
    expect(result).toMatchObject({ claimed: 1, stale: 1, done: 0 });
  });

  it("L-2: a handler that ignores its abort is abandoned with its lease kept; it is finished under its token only when it settles", async () => {
    let settle: (r: HandlerResult) => void = () => {};
    let aborted = false;
    const { db, calls } = fakeDb([
      { id: "j-deaf", kind: "test.deaf", payload: { id: ID } },
      { id: "j-next", kind: "test.ok", payload: { id: ID } },
    ]);
    const result = await runJobs(
      options(db, {
        "test.deaf": handler(
          (_job, _p, ctx) =>
            new Promise<HandlerResult>((resolve) => {
              ctx.signal.addEventListener("abort", () => {
                aborted = true; // and carries on regardless
              });
              settle = resolve;
            }),
          30
        ),
        "test.ok": handler(async () => ({ outcome: "done" })),
      })
    );

    expect(aborted).toBe(true);
    // The pass went on, and the abandoned job was neither failed (which would free it for another runner) nor released.
    expect(result).toMatchObject({ claimed: 2, abandoned: 1, done: 1, retried: 0, released: 0 });
    expect(calls.filter((c) => c.args.p_id === "j-deaf").map((c) => c.fn)).toEqual(["start_job"]);

    // It settles later in this process: finished under its own token (fenced in SQL).
    settle({ outcome: "done" });
    await vi.waitFor(() =>
      expect(calls.filter((c) => c.args.p_id === "j-deaf").map((c) => c.fn)).toEqual(["start_job", "complete_job"])
    );
    expect(calls.find((c) => c.fn === "complete_job" && c.args.p_id === "j-deaf")?.args.p_lease_token).toBe("token-0");
  });

  it("L-4: an invalid retryAt fails only that job (retryable, invalid_retry_at); the pass continues and stays ok", async () => {
    const { db, calls } = fakeDb([
      { id: "j-bad", kind: "test.badat", payload: { id: ID } },
      { id: "j-baddefer", kind: "test.baddefer", payload: { id: ID } },
      { id: "j-good", kind: "test.good", payload: { id: ID } },
    ]);
    const result = await runJobs(
      options(db, {
        "test.badat": handler(async () => ({ outcome: "retry", code: "rate_limited", retryAt: new Date("garbage") })),
        "test.baddefer": handler(async () => ({ outcome: "defer", code: "not_due", retryAt: new Date(Number.NaN) })),
        "test.good": handler(async () => ({ outcome: "done" })),
      })
    );
    expect(failCalls(calls)).toEqual([
      ["j-bad", "invalid_retry_at", true],
      ["j-baddefer", "invalid_retry_at", true],
    ]);
    expect(calls.filter((c) => c.fn === "fail_job").every((c) => !("p_retry_at" in c.args))).toBe(true);
    expect(result).toMatchObject({ ok: true, claimed: 3, retried: 2, done: 1 });
  });

  it("defer reaches defer_job with the handler's time, counted as deferred (and as retried in the run row)", async () => {
    const at = new Date("2026-11-13T00:05:00Z");
    const { db, calls } = fakeDb([{ id: "j-wait", kind: "test.wait", payload: { id: ID } }]);
    const result = await runJobs(
      options(db, { "test.wait": handler(async () => ({ outcome: "defer", code: "delivery_in_progress", retryAt: at })) })
    );
    expect(calls.find((c) => c.fn === "defer_job")?.args).toEqual({
      p_id: "j-wait",
      p_lease_token: "token-0",
      p_error_code: "delivery_in_progress",
      p_retry_at: at.toISOString(),
    });
    expect(result).toMatchObject({ deferred: 1, retried: 0 });
    expect(calls.find((c) => c.fn === "jobs_runner_end")?.args).toMatchObject({ p_retried: 1 });
  });

  it("L-3: every queue RPC carries an abort signal; a stalled claim ends the pass with rpc_timeout", async () => {
    const { db, calls, signals } = fakeDb([{ id: "j-x", kind: "test.x", payload: { id: ID } }], { stall: ["claim_jobs"] });
    const result = await runJobs(
      options(db, { "test.x": handler(async () => ({ outcome: "done" })) }, { rpcTimeoutMs: 25 })
    );
    expect(result).toMatchObject({ ok: false, claimed: 0 });
    expect(calls.find((c) => c.fn === "jobs_runner_end")?.args).toMatchObject({ p_ok: false, p_error_code: "rpc_timeout" });
    expect(signals.map((s) => s.fn)).toEqual(["jobs_runner_begin", "claim_jobs", "jobs_runner_end"]);
    expect(signals.find((s) => s.fn === "claim_jobs")?.signal.aborted).toBe(true);
  });

  it("L-3: a stalled finish stops the pass and hands back the batch's unstarted jobs (no attempt spent on them)", async () => {
    const { db, calls } = fakeDb(
      [
        { id: "j-1", kind: "test.y", payload: { id: ID } },
        { id: "j-2", kind: "test.y", payload: { id: ID } },
        { id: "j-3", kind: "test.y", payload: { id: ID } },
      ],
      { stall: ["complete_job"] }
    );
    const result = await runJobs(
      options(db, { "test.y": handler(async () => ({ outcome: "done" })) }, { rpcTimeoutMs: 25 })
    );
    expect(result).toMatchObject({ ok: false, claimed: 3, released: 2 });
    expect(calls.filter((c) => c.fn === "start_job").map((c) => c.args.p_id)).toEqual(["j-1"]);
    expect(calls.filter((c) => c.fn === "release_job").map((c) => c.args.p_id).sort()).toEqual(["j-2", "j-3"]);
  });

  it("L-3: a stalled jobs_runner_end rejects within its bound instead of hanging the route", async () => {
    const { db } = fakeDb([], { stall: ["jobs_runner_end"] });
    await expect(
      runJobs(options(db, { "test.z": handler(async () => ({ outcome: "done" })) }, { rpcTimeoutMs: 25 }))
    ).rejects.toMatchObject({ name: "JobsRpcError", code: "rpc_timeout" });
  });
});
