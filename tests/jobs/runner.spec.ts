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
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { runJobs, type RunJobsOptions } from "@/lib/jobs/internal/runner";
import type {
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
}

/** An in-memory stand-in for the six runner RPCs: hands out `jobs` on the first claims, records every call. */
function fakeDb(
  jobs: FakeJob[],
  opts: { completeReturns?: boolean; failClaim?: boolean } = {}
) {
  const calls: Call[] = [];
  let queue = jobs.map((j, i) => ({
    ...j,
    attempts: 1,
    max_attempts: 5,
    lease_token: `token-${i}`,
    run_at: `2026-11-13T00:00:${String(i).padStart(2, "0")}Z`,
    tenant_id: null,
  }));
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
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
      case "complete_job":
        return { data: opts.completeReturns ?? true, error: null };
      case "fail_job":
        return { data: args.p_retryable ? "pending" : "dead", error: null };
      case "release_job":
        return { data: true, error: null };
      default:
        throw new Error(`unexpected rpc ${fn}`);
    }
  };
  return { db: { rpc } as unknown as JobsDb, calls };
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

  it("claims only what fits and releases a claimed job the budget no longer covers", async () => {
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

    // 5 s / (1 s + 1 s margin) → a claim of 2; after the first job only 1.5 s is left, so the second is handed back.
    expect(calls.find((c) => c.fn === "claim_jobs")?.args.p_batch).toBe(2);
    expect(ran).toEqual(["j-1"]);
    expect(
      calls.filter((c) => c.fn === "release_job").map((c) => c.args.p_id)
    ).toEqual(["j-2"]);
    expect(result).toMatchObject({ claimed: 2, done: 1, released: 1 });
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

  it("a handler that outlives maxDurationMs is aborted and retried as handler_timeout", async () => {
    let signalled = false;
    const { db, calls } = fakeDb([
      { id: "j-hang", kind: "test.hang", payload: { id: ID } },
    ]);
    const result = await runJobs(
      options(db, {
        "test.hang": handler(
          (_job, _p, ctx) =>
            new Promise<HandlerResult>(() => {
              ctx.signal.addEventListener("abort", () => {
                signalled = true;
              });
            }),
          50
        ),
      })
    );
    expect(signalled).toBe(true);
    expect(failCalls(calls)).toEqual([["j-hang", "handler_timeout", true]]);
    expect(result).toMatchObject({ claimed: 1, retried: 1 });
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
