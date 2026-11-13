/**
 * V2-04 04-01 (P0-12, T-07 subset at the jobs level; T-04-07): parallel runners over the live local queue
 * (migration 000031) claim every job exactly once.
 *
 * - Tracer: one job enqueued in SQL is claimed by `runJobs` and ends `done` with `attempts = 1`.
 * - 200 jobs across 3 tenants, 8 concurrent `runJobs` (batch 10, lease 60 s), a recording handler: 200 handled ids,
 *   200 distinct, every job `done` with `attempts = 1`, and the runners' claimed counts add up to 200.
 * - Fairness (04-07b M-FAIR, review A M-1 / independent M1): driven through the real runner with the route's
 *   configuration (`RUN_PASS_CONFIG`) and a 12 s handler bound (message.send's): tenant A has 30 due jobs, all older
 *   than tenant B's one; B's job is among the first two the pass runs (the 04-01 runner claimed batches of 1, so the
 *   pass ran only A's oldest jobs). And `claim_jobs` interleaves tenants even when p_per_tenant ≥ the batch.
 * - Rotation (04-07d, re-verification N-1, migration 000044): tenants are claimed least recently served first, so with
 *   10 tenants holding older backlogs an 11th tenant's job is claimed within 2 batches (000043: batch 41), 23
 *   backlogged tenants are all served within 3 batches, and the real runner runs the 11th tenant's job among its first
 *   20.
 * - Hand-backs (04-07e, adversarial re-check N-1b, migration 000045): the re-checker's probe through real runner passes
 *   (message.send's 12 s bound, 1.5 s per job, so 2 of every batch of 10 are handed back) runs the victim's job within
 *   2 passes (000044 + the 04-07b order: never, in 30 passes); a hand-back restores the claim stamp and a started job
 *   keeps it; `claim_jobs` returns its fair order (`claim_order`) and the runner starts the batch in it.
 * - 04-03a (roadmap "the parallel-dispatcher test shows 0 duplicate sends", T-04-07): 200 `communication_queue` rows
 *   enqueued through `enqueue_message_system` (their trigger creates 200 `message.send` jobs), 8 concurrent `runJobs`
 *   with the real `message.send` handler and a recording provider → 200 provider calls for those rows, 200 distinct
 *   rows, every row `sent` once and every job `done` with `attempts = 1`.
 */
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { RUN_PASS_CONFIG } from "@/lib/jobs/internal/run-config";
import { runJobs } from "@/lib/jobs/internal/runner";
import { getAdminClient } from "../helpers/supabase-admin";
import { psql } from "../helpers/sql";
import { seedTenantWithOwner } from "../helpers/tenants";
import { recordingProvider, runMessages, seedPatient } from "./message-helpers";
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

const WORKER = `spec-parallel-${letters(8)}`;
const kinds: string[] = [];
const tenants: string[] = [];

afterAll(() => {
  deleteJobs(kinds);
  deleteRunnerRuns(WORKER);
  deleteTenants(tenants);
});

function kind(word: string): string {
  const k = uniqueKind(word);
  kinds.push(k);
  return k;
}

function tenant(label: string): string {
  const id = insertTenant(`${label} ${letters(6)}`);
  tenants.push(id);
  return id;
}

describe("runJobs over the live queue", () => {
  it("tracer: a job enqueued in SQL is claimed by runJobs and ends done with attempts = 1", async () => {
    const k = kind("tracer");
    const [id] = enqueueMany(k, tenant("tracer"), 1);
    const seen: string[] = [];

    const result = await runJobs({
      db: getAdminClient(),
      budgetMs: 20_000,
      batch: 10,
      leaseSeconds: 60,
      perTenant: 10,
      worker: `${WORKER}-tracer`,
      source: "test",
      kinds: [k],
      handlers: { [k]: recordingHandler(seen) },
    });

    expect(seen).toEqual([id]);
    expect(result).toMatchObject({
      claimed: 1,
      done: 1,
      retried: 0,
      dead: 0,
      stale: 0,
      released: 0,
    });
    expect(jobRows(k)).toEqual([
      { id, status: "done", attempts: 1, lastError: null },
    ]);
  });

  it("8 parallel runners over 200 jobs in 3 tenants handle each job exactly once", async () => {
    const k = kind("record");
    const ids = [
      ...enqueueMany(k, tenant("p1"), 80),
      ...enqueueMany(k, tenant("p2"), 70),
      ...enqueueMany(k, tenant("p3"), 50),
    ];
    expect(ids).toHaveLength(200);
    const seen: string[] = [];
    const handlers = { [k]: recordingHandler(seen, 2_000) };

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        runJobs({
          // A client per runner: separate HTTP connections, as separate runner invocations would have.
          db: getAdminClient(),
          budgetMs: 60_000,
          batch: 10,
          leaseSeconds: 60,
          perTenant: 10,
          worker: `${WORKER}-${i}`,
          source: "test",
          kinds: [k],
          handlers,
        })
      )
    );

    expect(seen).toHaveLength(200);
    expect(new Set(seen).size).toBe(200);
    expect([...seen].sort()).toEqual([...ids].sort());
    expect(results.reduce((n, r) => n + r.claimed, 0)).toBe(200);
    expect(results.reduce((n, r) => n + r.done, 0)).toBe(200);
    const rows = jobRows(k);
    expect(rows).toHaveLength(200);
    expect(rows.every((r) => r.status === "done" && r.attempts === 1)).toBe(
      true
    );
  }, 60_000);
});

describe("tenant fairness (04-07b M-FAIR)", () => {
  it("review A M-1 repro through the real runner: A's 30 older jobs do not starve B's one", async () => {
    const k = kind("fair");
    const a = tenant("fair a");
    const b = tenant("fair b");
    enqueueMany(k, a, 30, { ageSeconds: 600 });
    const [bId] = enqueueMany(k, b, 1, { ageSeconds: 60 });

    // Every job "takes" 2 s of the pass's clock; a 12 s handler starts only with ≥ 13.5 s of the 25 s budget left, so
    // the pass runs 6 jobs. The 04-01 runner claimed batches of 1 (oldest first): all 6 would have been A's.
    let clock = Date.now();
    const order: string[] = [];
    const result = await runJobs({
      db: getAdminClient(),
      ...RUN_PASS_CONFIG,
      worker: `${WORKER}-fair`,
      source: "test",
      kinds: [k],
      handlers: {
        [k]: {
          schema: z.object({ n: z.number().int() }),
          maxDurationMs: 12_000,
          async run(job) {
            order.push(job.id === bId ? "B" : job.tenantId === a ? "A" : "?");
            clock += 2_000;
            return { outcome: "done" };
          },
        },
      },
      now: () => new Date(clock),
    });

    expect(order).toHaveLength(6);
    expect(order.slice(0, 2)).toContain("B");
    expect(order.filter((t) => t === "B")).toHaveLength(1);
    expect(result).toMatchObject({ ok: true, done: 6, released: 0, stale: 0 });
    const rows = jobRows(k);
    expect(rows.find((r) => r.id === bId)).toMatchObject({ status: "done", attempts: 1 });
    // A's remaining jobs were never claimed or started: still pending, no attempt spent.
    expect(rows.filter((r) => r.status === "pending")).toHaveLength(25);
    expect(rows.filter((r) => r.status === "pending").every((r) => r.attempts === 0)).toBe(true);
  });

  it("claim_jobs picks round-robin across tenants even when p_per_tenant is not below the batch", async () => {
    const k = kind("rr");
    const a = tenant("rr a");
    const b = tenant("rr b");
    enqueueMany(k, a, 100, { ageSeconds: 3600 });
    const bIds = enqueueMany(k, b, 5, { ageSeconds: 60 });

    const { data, error } = await getAdminClient().rpc("claim_jobs", {
      p_kinds: [k],
      p_batch: 10,
      p_lease_seconds: 60,
      p_worker: `${WORKER}-rr`,
      p_per_tenant: 10,
    });

    expect(error).toBeNull();
    const claimed = data ?? [];
    expect(claimed).toHaveLength(10);
    expect(claimed.filter((r) => r.tenant_id === a)).toHaveLength(5);
    expect(claimed.filter((r) => r.tenant_id === b).map((r) => r.id).sort()).toEqual([...bIds].sort());
    // 04-07b: the claim counts no attempt (start_job does).
    expect(claimed.every((r) => r.attempts === 0)).toBe(true);
  });
});

/**
 * Claims with the route's batch / per-tenant values until `stop` holds, marking every claimed batch done as a runner
 * would. Returns the tenant ids of each batch, in claim order.
 */
async function claimBatches(k: string, worker: string, maxBatches: number, stop: (seen: Set<string>) => boolean) {
  const batches: string[][] = [];
  const seen = new Set<string>();
  for (let b = 0; b < maxBatches && !stop(seen); b++) {
    const { data, error } = await getAdminClient().rpc("claim_jobs", {
      p_kinds: [k],
      p_batch: RUN_PASS_CONFIG.batch,
      p_lease_seconds: RUN_PASS_CONFIG.leaseSeconds,
      p_worker: worker,
      p_per_tenant: RUN_PASS_CONFIG.perTenant,
    });
    expect(error).toBeNull();
    const rows = data ?? [];
    if (rows.length === 0) break;
    batches.push(rows.map((r) => r.tenant_id ?? ""));
    for (const r of rows) seen.add(r.tenant_id ?? "");
    psql(
      `update ops.jobs set status = 'done', finished_at = now(), updated_at = now() ` +
        `where id in (${rows.map((r) => `'${r.id}'`).join(",")})`
    );
  }
  return batches;
}

describe("tenant rotation across more tenants than a batch (04-07d, re-verification N-1)", () => {
  // 000043 chose the claimed tenants by their oldest due work, so with ≥ 10 tenants holding older backlogs every other
  // tenant waited for those backlogs to drain (the re-verifier's repro: the victim's first claim was batch 41 of 45).
  it("re-verifier's repro: 10 tenants × 40 jobs from 30 minutes ago, an 11th tenant's one job from 1 minute ago → served within 2 batches", async () => {
    const k = kind("rotate");
    const backlogged = Array.from({ length: 10 }, (_, i) => tenant(`rotate ${i}`));
    for (const t of backlogged) enqueueMany(k, t, 40, { ageSeconds: 1800 });
    const victim = tenant("rotate victim");
    enqueueMany(k, victim, 1, { ageSeconds: 60 });

    const batches = await claimBatches(k, `${WORKER}-rotate`, 45, (seen) => seen.has(victim));

    const first = batches.findIndex((b) => b.includes(victim));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first + 1).toBeLessThanOrEqual(2);
    // The per-tenant cap and the round-robin still hold: every batch is 10 rows from 10 distinct tenants.
    for (const b of batches) {
      expect(b).toHaveLength(RUN_PASS_CONFIG.batch);
      expect(new Set(b).size).toBe(RUN_PASS_CONFIG.batch);
    }
  });

  it("bound: with 23 backlogged tenants every one is served within ceil(23 / 10) = 3 batches", async () => {
    const k = kind("bound");
    const all = Array.from({ length: 23 }, (_, i) => tenant(`bound ${i}`));
    // Older backlogs for the first tenants, so oldest-work ordering alone would keep serving them.
    all.forEach((t, i) => enqueueMany(k, t, 6, { ageSeconds: 3600 - i * 60 }));

    const batches = await claimBatches(k, `${WORKER}-bound`, 3, () => false);

    expect(batches).toHaveLength(3);
    expect(new Set(batches.flat())).toEqual(new Set(all));
  });

  it("through the real runner with the route's configuration: the 11th tenant's job runs among the first 2 batches (20 jobs)", async () => {
    const k = kind("rotrun");
    const backlogged = Array.from({ length: 10 }, (_, i) => tenant(`rotrun ${i}`));
    for (const t of backlogged) enqueueMany(k, t, 40, { ageSeconds: 1800 });
    const victim = tenant("rotrun victim");
    const [victimJob] = enqueueMany(k, victim, 1, { ageSeconds: 60 });

    // Every job "takes" 1 s of the pass's clock and a 1 s handler starts only with ≥ 2.5 s of the 25 s budget left, so
    // the pass runs 23 jobs over 3 claims. 000043: all 23 were the backlogged tenants' (the victim's job was the 401st).
    let clock = Date.now();
    const order: string[] = [];
    const result = await runJobs({
      db: getAdminClient(),
      ...RUN_PASS_CONFIG,
      worker: `${WORKER}-rotrun`,
      source: "test",
      kinds: [k],
      handlers: {
        [k]: {
          schema: z.object({ n: z.number().int() }),
          maxDurationMs: 1_000,
          async run(job) {
            order.push(job.id);
            clock += 1_000;
            return { outcome: "done" };
          },
        },
      },
      now: () => new Date(clock),
    });

    expect(result).toMatchObject({ ok: true, stale: 0 });
    expect(order.length).toBeGreaterThanOrEqual(2 * RUN_PASS_CONFIG.batch);
    const at = order.indexOf(victimJob);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(2 * RUN_PASS_CONFIG.batch);
    expect(jobRows(k).find((r) => r.id === victimJob)).toMatchObject({ status: "done", attempts: 1 });
  });
});

/**
 * Real `runJobs` passes with the route's configuration, message.send's 12 s handler bound and `msPerJob` of the pass
 * clock per job. Each pass is a fresh runner on its own clock, as the route runs them. Returns, per pass, the job ids
 * the handler ran and the pass result.
 */
async function runPasses(k: string, worker: string, msPerJob: number, maxPasses: number, stop: (ran: Set<string>) => boolean) {
  const passes: Array<{ ran: string[]; released: number; done: number }> = [];
  const ran = new Set<string>();
  for (let p = 0; p < maxPasses && !stop(ran); p++) {
    let clock = Date.now();
    const order: string[] = [];
    const result = await runJobs({
      db: getAdminClient(),
      ...RUN_PASS_CONFIG,
      worker,
      source: "test",
      kinds: [k],
      handlers: {
        [k]: {
          schema: z.object({ n: z.number().int() }),
          maxDurationMs: 12_000,
          async run(job) {
            order.push(job.id);
            clock += msPerJob;
            return { outcome: "done" };
          },
        },
      },
      now: () => new Date(clock),
    });
    expect(result).toMatchObject({ ok: true, stale: 0 });
    for (const id of order) ran.add(id);
    passes.push({ ran: order, released: result.released, done: result.done });
  }
  return passes;
}

describe("hand-backs and batch order through the real runner (04-07e, adversarial re-check N-1b)", () => {
  // 000044 + the 04-07b runner: a hand-back kept its claim stamp (the tenant went to the back of the rotation without
  // having run), and the runner started each batch by oldest work, so the tenant with the newest work was always last
  // in its batch and the one handed back. The re-checker's probe never ran the victim's job in 30 passes.
  it("re-checker's probe #8: 10 tenants × 40 jobs + a victim, 12 s bound, 1.5 s per job (8 of 10 fit a pass) → the victim runs within 2 passes", async () => {
    const k = kind("handback");
    const backlogged = Array.from({ length: 10 }, (_, i) => tenant(`handback ${i}`));
    for (const t of backlogged) enqueueMany(k, t, 40, { ageSeconds: 1800 });
    const victim = tenant("handback victim");
    const [victimJob] = enqueueMany(k, victim, 1, { ageSeconds: 60 });

    const passes = await runPasses(k, `${WORKER}-handback`, 1_500, 30, (ran) => ran.has(victimJob));

    // The setup reproduces the hand-backs: a 12 s send starts only with >= 13.5 s of the 25 s budget left, so 8 jobs
    // run and the rest of the batch of 10 is handed back unstarted.
    expect(passes[0]).toMatchObject({ done: 8, released: 2 });
    const at = passes.findIndex((p) => p.ran.includes(victimJob));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at + 1).toBeLessThanOrEqual(2);
    expect(jobRows(k).find((r) => r.id === victimJob)).toMatchObject({ status: "done", attempts: 1 });
  }, 120_000);

  it("the same at 1.0 s per job (11 fit a pass, so batch 2 is cut short): the victim runs within 2 passes", async () => {
    const k = kind("handbackfast");
    const backlogged = Array.from({ length: 10 }, (_, i) => tenant(`handbackfast ${i}`));
    for (const t of backlogged) enqueueMany(k, t, 40, { ageSeconds: 1800 });
    const victim = tenant("handbackfast victim");
    const [victimJob] = enqueueMany(k, victim, 1, { ageSeconds: 60 });

    const passes = await runPasses(k, `${WORKER}-handbackfast`, 1_000, 30, (ran) => ran.has(victimJob));

    const at = passes.findIndex((p) => p.ran.includes(victimJob));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at + 1).toBeLessThanOrEqual(2);
  }, 120_000);

  it("release_job puts the row's previous claim stamp back; a started job keeps its stamp, also through defer_job", async () => {
    const k = kind("stamp");
    const t = tenant("stamp");
    const [first, second] = enqueueMany(k, t, 2, { ageSeconds: 600 });
    const stamp = (id: string) => psql(`select coalesce(last_claimed_at::text, 'null') from ops.jobs where id = '${id}'`)[0];
    const db = getAdminClient();
    const claim = async (batch: number) => {
      const { data, error } = await db.rpc("claim_jobs", {
        p_kinds: [k], p_batch: batch, p_lease_seconds: 60, p_worker: `${WORKER}-stamp`, p_per_tenant: 5,
      });
      expect(error).toBeNull();
      return data ?? [];
    };

    // Claimed and handed back unstarted: never served, so the stamp is NULL again.
    const [c1] = await claim(1);
    expect(c1.id).toBe(first);
    expect(stamp(first)).not.toBe("null");
    expect((await db.rpc("release_job", { p_id: first, p_lease_token: c1.lease_token })).data).toBe(true);
    expect(stamp(first)).toBe("null");

    // Claimed, started, deferred: the handler ran, so the stamp stays.
    const [c2] = await claim(1);
    expect(c2.id).toBe(first);
    expect((await db.rpc("start_job", { p_id: first, p_lease_token: c2.lease_token })).data).toBe(1);
    const served = stamp(first);
    expect(
      (await db.rpc("defer_job", {
        p_id: first, p_lease_token: c2.lease_token, p_error_code: "not_yet", p_retry_at: new Date(Date.now() + 60_000).toISOString(),
      })).data
    ).toBe("deferred");
    expect(stamp(first)).toBe(served);

    // A second claim and hand-back of another row restores that row's own previous value (NULL), and the tenant's
    // last-served time stays the started claim's.
    const [c3] = await claim(1);
    expect(c3.id).toBe(second);
    expect((await db.rpc("release_job", { p_id: second, p_lease_token: c3.lease_token })).data).toBe(true);
    expect(stamp(second)).toBe("null");
    expect(psql(`select max(last_claimed_at)::text from ops.jobs where tenant_id = '${t}'`)).toEqual([served]);
  });

  it("claim_jobs returns its fair order: claim_order 1..n, a never-served tenant with the newest work first", async () => {
    const k = kind("order");
    const served = Array.from({ length: 3 }, (_, i) => tenant(`order ${i}`));
    for (const t of served) enqueueMany(k, t, 4, { ageSeconds: 1800 });
    const db = getAdminClient();
    // Serve the three tenants once (claimed, then marked done as a runner would).
    const { data: firstBatch } = await db.rpc("claim_jobs", {
      p_kinds: [k], p_batch: 3, p_lease_seconds: 60, p_worker: `${WORKER}-order`, p_per_tenant: 1,
    });
    expect(new Set((firstBatch ?? []).map((r) => r.tenant_id))).toEqual(new Set(served));
    psql(`update ops.jobs set status = 'done', finished_at = now() where id in (${(firstBatch ?? []).map((r) => `'${r.id}'`).join(",")})`);
    const victim = tenant("order victim");
    const [victimJob] = enqueueMany(k, victim, 1, { ageSeconds: 5 });

    const { data, error } = await db.rpc("claim_jobs", {
      p_kinds: [k], p_batch: 10, p_lease_seconds: 60, p_worker: `${WORKER}-order`, p_per_tenant: 5,
    });
    expect(error).toBeNull();
    const rows = data ?? [];
    expect(rows.map((r) => r.claim_order)).toEqual(rows.map((_, i) => i + 1));
    expect(rows[0].id).toBe(victimJob);
    // Round 1 gives every chosen tenant one row before any tenant gets a second.
    expect(new Set(rows.slice(0, 4).map((r) => r.tenant_id))).toEqual(new Set([victim, ...served]));
  });
});

describe("8 parallel runners over 200 queued messages (04-03a, real message.send handler)", () => {
  it("send each message exactly once: 200 provider calls, 200 distinct rows, 0 duplicates", async () => {
    // A signed-up owner (patients need a creator); the global teardown removes the tenant, its rows and jobs.
    const owner = await seedTenantWithOwner(`Parallel Messages ${letters(6)}`);
    const t = owner.tenantId;
    const { patientId, phone } = await seedPatient(t, owner.userId);
    const run = letters(8);
    const ids = psql(
      `select (public.enqueue_message_system('system:jobs', '${patientId}', null, 'whatsapp', 'prescription_ready', ` +
        `'prescription_ready', jsonb_build_object('patient_name', g::text), null, null, '{}'::jsonb, now(), 'par:${run}:' || g) ->> 'id') ` +
        `from generate_series(1, 200) g`
    );
    expect(new Set(ids).size).toBe(200);
    expect(psql(`select count(*) from ops.jobs where kind = 'message.send' and tenant_id = '${t}' and status = 'pending'`)).toEqual(["200"]);

    const provider = recordingProvider();
    await Promise.all(Array.from({ length: 8 }, (_, i) => runMessages(provider, `${WORKER}-msg-${i}`, { batch: 10, perTenant: 10, budgetMs: 60_000 })));

    const ours = provider.calls.filter((c) => c.to === phone && c.templateId === "prescription_ready").map((c) => c.params.patient_name); // 04-07a: a declared parameter carries the number
    expect(ours).toHaveLength(200);
    expect(new Set(ours).size).toBe(200);
    expect(psql(`select status || ':' || count(*) from public.communication_queue where tenant_id = '${t}' group by status`)).toEqual(["sent:200"]);
    expect(
      psql(`select status || ':' || attempts || ':' || count(*) from ops.jobs where kind = 'message.send' and tenant_id = '${t}' group by status, attempts`)
    ).toEqual(["done:1:200"]);
    expect(psql(`select count(*) from public.audit_logs where tenant_id = '${t}' and action = 'communication_sent'`)).toEqual(["200"]);
  }, 90_000);
});
