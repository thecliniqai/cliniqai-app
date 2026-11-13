/**
 * V2-04 04-02 (R-21; acceptance "queue lag p95 < 2 min", local measurement): the whole scheduler path once, for real,
 * on a developer Mac: pg_cron (`jobs-kick`) → `ops.kick_job_runner()` → Vault → pg_net → `POST /api/jobs/run` on the
 * e2e build → runner → `drill.noop` jobs done. CI cannot do this (the database container cannot reach the app on a
 * Linux runner, pitfall 6), so CI tests the DB half and the route half separately.
 *
 *   npm run e2e:build && npx tsx scripts/ops/scheduler-local-e2e.ts
 *
 * Steps: refuse anything but the loopback local stack (the Vitest/Playwright lane guard) and anything but macOS (exit 2:
 * `host.docker.internal` is a Docker Desktop name); take the test-run lock; start the e2e server on 127.0.0.1:3100 the
 * way Playwright does (`tests/e2e/support/serve.ts`, guarded env, the e2e build only); write the Vault secrets
 * `jobs_runner_url` = `http://host.docker.internal:3100/api/jobs/run` and `jobs_runner_secret` = the lane's synthetic
 * runner secret; activate `jobs-kick`; enqueue 5 `drill.noop` (`ops.drill_enqueue`); wait at most 150 s for all 5 to be
 * `done` and for an `ops.job_runner_runs` row with `source = pg_cron`; record each job's lag (`first_claimed_at −
 * run_at`). `finally`: delete the Vault secrets and the drill jobs, restore every `cron.job` row's active state, stop
 * the server, release the lock. Writes `evidence/scheduler-local-e2e.json` (counts and timings only).
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assertLocalTestEnv, loadLocalStackKeys, loadTestEnv, LOCAL_JOBS_RUNNER_SECRET } from "../../tests/setup/test-env";
import { acquireRunLock, releaseRunLock } from "../../tests/setup/teardown";
import { E2E_BASE_URL, E2E_PORT, LOCAL_SUPABASE_URL, ROOT } from "../../tests/e2e/support/app-env";
import { psql, psqlSession } from "../../tests/helpers/sql";

const RUNNER_URL = `http://host.docker.internal:${E2E_PORT}/api/jobs/run`;
const JOBS = 5;
const WAIT_MS = 150_000;
const OUT = path.join(ROOT, ".planning/phases/04-jobs-reliability/evidence/scheduler-local-e2e.json");

function say(line: string): void {
  process.stdout.write(`[scheduler-local-e2e] ${line}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${E2E_BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error("the e2e server did not answer /api/health in time (run `npm run e2e:build` first)");
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

async function main(): Promise<number> {
  if (process.platform !== "darwin") {
    process.stderr.write("[scheduler-local-e2e] host.docker.internal is macOS-only; CI covers the halves separately\n");
    return 2;
  }
  loadTestEnv(ROOT);
  loadLocalStackKeys(ROOT);
  assertLocalTestEnv();
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (url.origin !== new URL(LOCAL_SUPABASE_URL).origin) {
    throw new Error("refusing: NEXT_PUBLIC_SUPABASE_URL is not the loopback local stack");
  }
  if (!/^[A-Za-z0-9-]{32,}$/.test(LOCAL_JOBS_RUNNER_SECRET)) throw new Error("unexpected local runner secret shape");

  const lockFile = acquireRunLock();
  let server: ChildProcess | null = null;
  const cronBefore = psql("select jobid || '=' || active from cron.job order by jobid");
  try {
    say("starting the e2e server on 127.0.0.1:3100 (tests/e2e/support/serve.ts)");
    server = spawn(process.execPath, ["--import", "tsx", "tests/e2e/support/serve.ts"], {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "inherit"],
      env: process.env,
    });
    await waitForHealth(Date.now() + 120_000);

    psql("delete from ops.jobs where kind = 'drill.noop'");
    psqlSession([
      "begin",
      "delete from vault.secrets where name in ('jobs_runner_url', 'jobs_runner_secret')",
      `select vault.create_secret('${RUNNER_URL}', 'jobs_runner_url') is not null`,
      `select vault.create_secret('${LOCAL_JOBS_RUNNER_SECRET}', 'jobs_runner_secret') is not null`,
      "commit",
    ]);
    // Everything else stays as it was; the kick runs every minute from here.
    psql("select cron.alter_job(jobid, active := true) from cron.job where jobname = 'jobs-kick'");

    const [startedAt] = psql("select now()");
    const [enqueued] = psql(`select ops.drill_enqueue('drill.noop', ${JOBS})`);
    say(`enqueued ${enqueued} drill.noop jobs; waiting up to ${WAIT_MS / 1000} s for pg_cron`);

    const deadline = Date.now() + WAIT_MS;
    let done = 0;
    let cronRuns = 0;
    while (Date.now() < deadline) {
      [done, cronRuns] = psql(
        "select (select count(*) from ops.jobs where kind = 'drill.noop' and status = 'done') || '|' || " +
          `(select count(*) from ops.job_runner_runs where source = 'pg_cron' and ok and started_at >= '${startedAt}'::timestamptz)`,
      )[0]
        .split("|")
        .map(Number);
      if (done === JOBS && cronRuns > 0) break;
      await sleep(2_000);
    }
    const waitedSeconds = Math.round((Date.now() - (deadline - WAIT_MS)) / 1000);

    const lags = psql(
      "select extract(epoch from (first_claimed_at - run_at))::numeric(10,3) from ops.jobs " +
        "where kind = 'drill.noop' and first_claimed_at is not null order by 1",
    ).map(Number);
    const [responses] = psql(
      `select count(*) filter (where status_code = 200) || '|' || count(*) filter (where timed_out) || '|' || count(*) ` +
        `from net._http_response where created >= '${startedAt}'::timestamptz`,
    );
    const [ok200, timedOut, total] = responses.split("|").map(Number);

    const evidence = {
      generated_at: new Date().toISOString(),
      tool: "scripts/ops/scheduler-local-e2e.ts",
      platform: `${process.platform}-${process.arch}`,
      path: "pg_cron jobs-kick -> ops.kick_job_runner() -> Vault -> pg_net -> POST /api/jobs/run (e2e build) -> runner",
      jobs_enqueued: Number(enqueued),
      jobs_done: done,
      pg_cron_runner_runs_ok: cronRuns,
      pg_net_responses: { total, status_200: ok200, timed_out: timedOut },
      lag_seconds: {
        count: lags.length,
        min: lags[0] ?? null,
        p50: percentile(lags, 50),
        p95: percentile(lags, 95),
        max: lags[lags.length - 1] ?? null,
      },
      waited_seconds: waitedSeconds,
      passed: done === JOBS && cronRuns > 0 && percentile(lags, 95) < 120,
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`);
    say(`wrote ${path.relative(ROOT, OUT)}: ${done}/${JOBS} done, ${cronRuns} pg_cron runs, lag p95 ${evidence.lag_seconds.p95} s`);
    return evidence.passed ? 0 : 1;
  } finally {
    try {
      psql("delete from vault.secrets where name in ('jobs_runner_url', 'jobs_runner_secret')");
      psql("delete from ops.jobs where kind = 'drill.noop'");
      for (const line of cronBefore) {
        const [jobid, active] = line.split("=");
        psql(`select cron.alter_job(${Number(jobid)}, active := ${active === "true"})`);
      }
    } finally {
      if (server && server.exitCode === null) {
        server.kill("SIGTERM");
        await new Promise((r) => server!.once("exit", r));
      }
      releaseRunLock(lockFile);
    }
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`[scheduler-local-e2e] failed: ${err instanceof Error ? err.message : "error"}\n`);
    process.exit(1);
  },
);
