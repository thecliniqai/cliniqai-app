/**
 * V2-04 04-02 (P0-12, C22, RL-23; T-04-01): `/api/jobs/run` on the built app (the e2e server runs the drill kinds with
 * the lane's synthetic runner secret, tests/e2e/support/app-env.ts). Through the real proxy and route:
 * - `POST` without a bearer → 401 `{"ok":false}` with the proxy's `x-request-id`, and a seeded `drill.noop` job stays
 *   `pending`;
 * - `POST` with the raw secret or a stale token → 401 (R-49); with a fresh token minted from the e2e secret → 200 with
 *   counts only and the seeded job `done`;
 * - `GET` → 405 with `Allow: POST`.
 * The pg_cron → pg_net half is tested in Vitest (tests/jobs/scheduler-migration-db.spec.ts) and end to end on macOS by
 * scripts/ops/scheduler-local-e2e.ts (pitfall 6, R-21).
 *
 * Desktop Chromium only: the runner claims every due drill job, so a second device running in parallel would claim
 * this test's job (and the route is server-side and device-independent).
 */
import { expect, test } from "../fixtures";
import { mintRunnerToken } from "@/lib/jobs/auth";
import { E2E_JOBS_RUNNER_SECRET } from "../support/app-env";
import { psql, psqlSession } from "../../helpers/sql";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ONE_DEVICE = "desktop-chrome";
const ONE_DEVICE_REASON = "server-side runner, proven once (see the file comment)";

test.use({ storageState: { cookies: [], origins: [] } });
// One drill kind, one runner: the two tests must not interleave (a pass claims every due drill job).
test.describe.configure({ mode: "serial" });

function seedDrillJob(): string {
  const [count, id] = psqlSession([
    "begin",
    "select ops.drill_enqueue('drill.noop', 1)",
    "select id from ops.jobs where kind = 'drill.noop' and created_at = now()",
    "commit",
  ]);
  expect(count).toBe("1");
  expect(id).toMatch(UUID);
  return id;
}

const statusOf = (id: string) => psql(`select status from ops.jobs where id = '${id}'`)[0];

/**
 * 04-04: the route claims every registered kind, now incl. `alert.notify`, which the local stack's 5-minute alert
 * evaluation (pg_cron between lanes) may have left due; other files can leave `message.send` jobs too. Park every due
 * non-drill job a day ahead (as tests/jobs/run-route.spec.ts does) and remove other drill kinds, so the counts asserted
 * here are this test's own.
 */
test.beforeEach(() => {
  psql(
    "update ops.jobs set run_at = now() + interval '1 day' where status = 'pending' and kind not like 'drill.%' and run_at <= now() + interval '1 hour'",
  );
  psql("delete from ops.jobs where kind like 'drill.%' and kind <> 'drill.noop'");
});

test.afterEach(() => {
  psql("delete from ops.jobs where kind = 'drill.noop'");
});

test("the runner route refuses a call without the bearer and runs a drill job with it", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== ONE_DEVICE, ONE_DEVICE_REASON);
  const id = seedDrillJob();

  const refused = await request.post("/api/jobs/run", { data: { source: "manual" } });
  expect(refused.status()).toBe(401);
  expect(await refused.text()).toBe('{"ok":false}');
  expect(refused.headers()["x-request-id"]).toMatch(UUID);
  expect(statusOf(id)).toBe("pending");

  const wrong = await request.post("/api/jobs/run", { headers: { authorization: "Bearer not-the-runner-secret" } });
  expect(wrong.status()).toBe(401);
  // R-49: the raw secret is not a bearer; only a fresh token minted from it is.
  const raw = await request.post("/api/jobs/run", { headers: { authorization: `Bearer ${E2E_JOBS_RUNNER_SECRET}` } });
  expect(raw.status()).toBe(401);
  const stale = await request.post("/api/jobs/run", {
    headers: { authorization: `Bearer ${mintRunnerToken(E2E_JOBS_RUNNER_SECRET, Math.floor(Date.now() / 1000) - 300)}` },
  });
  expect(stale.status()).toBe(401);
  expect(statusOf(id)).toBe("pending");

  const ran = await request.post("/api/jobs/run", {
    headers: { authorization: `Bearer ${mintRunnerToken(E2E_JOBS_RUNNER_SECRET)}` },
    data: { source: "manual" },
  });
  expect(ran.status()).toBe(200);
  const body = (await ran.json()) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["claimed", "dead", "done", "durationMs", "ok", "retried"]);
  expect(body).toMatchObject({ ok: true, done: 1, dead: 0 });
  expect(ran.headers()["x-request-id"]).toMatch(UUID);
  expect(statusOf(id)).toBe("done");
});

test("GET /api/jobs/run is 405 with Allow: POST and runs nothing", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== ONE_DEVICE, ONE_DEVICE_REASON);
  const id = seedDrillJob();
  const res = await request.get("/api/jobs/run", { headers: { authorization: `Bearer ${mintRunnerToken(E2E_JOBS_RUNNER_SECRET)}` } });
  expect(res.status()).toBe(405);
  expect(res.headers()["allow"]).toBe("POST");
  expect(statusOf(id)).toBe("pending");
});
