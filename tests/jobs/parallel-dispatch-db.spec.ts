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
