/**
 * V2-04 04-01 (P0-12, T-07 subset at the jobs level; T-04-07): parallel runners over the live local queue
 * (migration 000031) claim every job exactly once.
 *
 * - Tracer: one job enqueued in SQL is claimed by `runJobs` and ends `done` with `attempts = 1`.
 * - 200 jobs across 3 tenants, 8 concurrent `runJobs` (batch 10, lease 60 s), a recording handler: 200 handled ids,
 *   200 distinct, every job `done` with `attempts = 1`, and the runners' claimed counts add up to 200.
 * - Fairness: tenant A has 100 due jobs, all older than tenant B's 5; one claim (batch 10, per tenant 5) returns 5 of A
 *   and all 5 of B, so A's backlog cannot starve B.
 * - 04-03a (roadmap "the parallel-dispatcher test shows 0 duplicate sends", T-04-07): 200 `communication_queue` rows
 *   enqueued through `enqueue_message_system` (their trigger creates 200 `message.send` jobs), 8 concurrent `runJobs`
 *   with the real `message.send` handler and a recording provider → 200 provider calls for those rows, 200 distinct
 *   rows, every row `sent` once and every job `done` with `attempts = 1`.
 */
import { afterAll, describe, expect, it } from "vitest";
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

describe("claim_jobs tenant fairness", () => {
  it("one tenant's older backlog does not starve another: batch 10, per tenant 5 → 5 of A and all 5 of B", async () => {
    const k = kind("fair");
    const a = tenant("fair a");
    const b = tenant("fair b");
    // All of A's jobs are older than any of B's: an oldest-first claim without a per-tenant cap returns only A.
    enqueueMany(k, a, 100, { ageSeconds: 3600 });
    const bIds = enqueueMany(k, b, 5, { ageSeconds: 60 });

    const { data, error } = await getAdminClient().rpc("claim_jobs", {
      p_kinds: [k],
      p_batch: 10,
      p_lease_seconds: 60,
      p_worker: `${WORKER}-fair`,
      p_per_tenant: 5,
    });

    expect(error).toBeNull();
    const claimed = data ?? [];
    expect(claimed).toHaveLength(10);
    expect(claimed.filter((r) => r.tenant_id === a)).toHaveLength(5);
    expect(
      claimed
        .filter((r) => r.tenant_id === b)
        .map((r) => r.id)
        .sort()
    ).toEqual([...bIds].sort());
    expect(claimed.every((r) => r.attempts === 1)).toBe(true);
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
        `'prescription_ready', jsonb_build_object('n', g::text), null, null, '{}'::jsonb, now(), 'par:${run}:' || g) ->> 'id') ` +
        `from generate_series(1, 200) g`
    );
    expect(new Set(ids).size).toBe(200);
    expect(psql(`select count(*) from ops.jobs where kind = 'message.send' and tenant_id = '${t}' and status = 'pending'`)).toEqual(["200"]);

    const provider = recordingProvider();
    await Promise.all(Array.from({ length: 8 }, (_, i) => runMessages(provider, `${WORKER}-msg-${i}`, { batch: 10, perTenant: 10, budgetMs: 60_000 })));

    const ours = provider.calls.filter((c) => c.to === phone && c.templateId === "prescription_ready").map((c) => c.params.n);
    expect(ours).toHaveLength(200);
    expect(new Set(ours).size).toBe(200);
    expect(psql(`select status || ':' || count(*) from public.communication_queue where tenant_id = '${t}' group by status`)).toEqual(["sent:200"]);
    expect(
      psql(`select status || ':' || attempts || ':' || count(*) from ops.jobs where kind = 'message.send' and tenant_id = '${t}' group by status, attempts`)
    ).toEqual(["done:1:200"]);
    expect(psql(`select count(*) from public.audit_logs where tenant_id = '${t}' and action = 'communication_sent'`)).toEqual(["200"]);
  }, 90_000);
});
