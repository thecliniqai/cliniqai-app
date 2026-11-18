/**
 * V2-04 04-02 (P0-12, C22, RL-23, R-17, R-18, R-32; T-04-01): `POST /api/jobs/run`, the route half of the scheduler
 * (the DB half is scheduler-migration-db.spec.ts; CI cannot run pg_net → app, pitfall 6, R-21). The handler is called
 * directly on the local stack with the real env parse, the real system client and the real runner.
 *
 * - Tracer: a `drill.noop` job seeded by `ops.drill_enqueue` is processed by a POST with the synthetic bearer: 200 with
 *   exactly `{ ok, claimed, done, retried, dead, durationMs }`, the job `done`, well inside the 25 s budget, and one
 *   `ops.job_runner_runs` row with the body's `source`.
 * - R-49: the bearer is a token `v1.<ts>.<hmac>` minted from the secret; tokens up to ±120 s old are accepted.
 * - Refusals before any database access (the seeded job stays `pending`, no runner run is recorded): no configured
 *   secret; missing, wrong, different-length and scheme-less bearers; the raw secret; stale (−125 s), future
 *   (+125 s) and other-secret tokens; a signed-in clinic owner's session cookie
 *   without the bearer (no role is a runner). `GET`/`PUT`/`PATCH`/`DELETE` → 405 `Allow: POST` even with the bearer.
 * - The rotation slot is accepted; drill kinds are not claimed with `JOBS_DRILL_ENABLED` off; oversized, non-JSON and
 *   unknown-key bodies are refused; a thrown error is 500 `{ ok: false }` with one `jobs.run.failed` line carrying a
 *   code only. No response carries an id or a payload.
 *
 * Secrets are random per run (built at run time) and set with `vi.stubEnv` after the lane guard; `afterEach` undoes
 * them so the next file's worker guard sees a clean environment.
 */
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { NextRequest } from "next/server";
import type { Session } from "@supabase/supabase-js";
import { DELETE, GET, PATCH, POST, PUT } from "@/app/api/jobs/run/route";
import { publicEnv } from "@/lib/env";
import { mintRunnerToken } from "@/lib/jobs/auth";
import { psql, psqlSession } from "../helpers/sql";
import { seedTenantWithOwner } from "../helpers/tenants";

const URL_RUN = "http://localhost/api/jobs/run";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SIX_KEYS = ["claimed", "dead", "done", "durationMs", "ok", "retried"];

const secret = randomBytes(32).toString("hex");
const nextSecret = randomBytes(32).toString("hex");
/** R-49: the bearer is a token minted from the secret (as `ops.kick_job_runner()` does), never the secret. */
const bearer = (value: string, offsetSeconds = 0) => ({
  authorization: `Bearer ${mintRunnerToken(value, Math.floor(Date.now() / 1000) + offsetSeconds)}`,
});
const rawBearer = (value: string) => ({ authorization: `Bearer ${value}` });

/** Seeds `count` drill.noop jobs through the SQL-editor function; returns their ids in run_at order. */
function seedDrill(count = 1): string[] {
  const out = psqlSession([
    "begin",
    `select ops.drill_enqueue('drill.noop', ${count})`,
    "select id from ops.jobs where kind = 'drill.noop' and created_at = now() order by run_at, id",
    "commit",
  ]);
  const ids = out.slice(1);
  expect(ids).toHaveLength(count);
  return ids;
}

function statusOf(ids: string[]): string[] {
  if (ids.length === 0) return [];
  return psql(`select status from ops.jobs where id in (${ids.map((i) => `'${i}'`).join(",")}) order by run_at, id`);
}

function purgeDrillJobs(): void {
  psql("delete from ops.jobs where kind = 'drill.noop'");
}

/**
 * 04-03a: the route claims every registered kind, now incl. `message.send`, whose jobs other specs leave pending (an
 * enqueue in a guard leg, a share). Park every due non-drill job a day ahead so the counts here are this spec's own;
 * no later spec depends on another file's leftover jobs.
 */
function parkOtherDueJobs(): void {
  psql("update ops.jobs set run_at = now() + interval '1 day' where status = 'pending' and kind not like 'drill.%' and run_at <= now() + interval '1 hour'");
}

function runnerRunsSince(marker: string): string[] {
  return psql(`select source || '|' || coalesce(ok::text, 'null') from ops.job_runner_runs where started_at >= '${marker}'::timestamptz order by id`);
}

function call(
  handler: (req: NextRequest) => Promise<Response>,
  method: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<Response> {
  return handler(new NextRequest(URL_RUN, { method, headers, body }));
}

async function post(headers: Record<string, string> = {}, body?: string) {
  const res = await call(POST, "POST", headers, body);
  const text = await res.text();
  return { res, text, json: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

let output: string[];
let stdout: MockInstance;
let stderr: MockInstance;

beforeAll(() => {
  purgeDrillJobs();
  parkOtherDueJobs();
});

afterAll(() => {
  purgeDrillJobs();
});

beforeEach(() => {
  output = [];
  const capture = (chunk: unknown) => {
    output.push(String(chunk));
    return true;
  };
  stdout = vi.spyOn(process.stdout, "write").mockImplementation(capture as typeof process.stdout.write);
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(capture as typeof process.stderr.write);
  vi.stubEnv("JOBS_RUNNER_SECRET", secret);
  vi.stubEnv("JOBS_DRILL_ENABLED", "true");
  // 04-03a (R-9): a message.send job reaching this route sends nothing and writes no .planning/dev-messages.txt.
  vi.stubEnv("MESSAGING_PROVIDER", "sink");
  parkOtherDueJobs();
});

afterEach(() => {
  stdout.mockRestore();
  stderr.mockRestore();
  vi.unstubAllEnvs();
  purgeDrillJobs();
});

describe("POST /api/jobs/run: the tracer", () => {
  it("runs a drill.noop job seeded by ops.drill_enqueue to done, inside the budget, counts only", async () => {
    const [marker] = psql("select clock_timestamp()");
    const ids = seedDrill(1);
    expect(statusOf(ids)).toEqual(["pending"]);

    const started = Date.now();
    const { res, text, json } = await post(bearer(secret), JSON.stringify({ source: "pg_cron" }));
    const elapsed = Date.now() - started;

    expect(res.status).toBe(200);
    expect(Object.keys(json!).sort()).toEqual(SIX_KEYS);
    expect(json).toMatchObject({ ok: true, claimed: 1, done: 1, retried: 0, dead: 0 });
    expect(json!.durationMs as number).toBeLessThan(25_000);
    expect(elapsed).toBeLessThan(25_000);
    expect(statusOf(ids)).toEqual(["done"]);
    expect(text).not.toMatch(UUID);
    expect(runnerRunsSince(marker)).toEqual(["pg_cron|true"]);
    // One `db.system_acquired` line for the runner's reason, nothing that names the job.
    const lines = output.join("");
    expect(lines).toContain('"reason":"jobs.run"');
    expect(lines).toContain('"module":"app/api/jobs/run"');
    for (const id of ids) expect(lines).not.toContain(id);
  });

  it("drains several due jobs in one pass; an empty body is a manual run", async () => {
    const [marker] = psql("select clock_timestamp()");
    const ids = seedDrill(5);
    const { res, json } = await post(bearer(secret));
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, claimed: 5, done: 5 });
    expect(statusOf(ids)).toEqual(Array(5).fill("done"));
    expect(runnerRunsSince(marker)).toEqual(["manual|true"]);
  });

  it("accepts the rotation slot JOBS_RUNNER_SECRET_NEXT next to the current secret", async () => {
    vi.stubEnv("JOBS_RUNNER_SECRET_NEXT", nextSecret);
    const ids = seedDrill(1);
    const { res, json } = await post(bearer(nextSecret));
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, done: 1 });
    expect(statusOf(ids)).toEqual(["done"]);
  });

  it("accepts a token minted 100 s ago or 100 s ahead (inside the ±120 s window, R-49)", async () => {
    for (const offset of [-100, 100]) {
      const ids = seedDrill(1);
      const { res, json } = await post(bearer(secret, offset));
      expect(res.status, String(offset)).toBe(200);
      expect(json).toMatchObject({ ok: true, done: 1 });
      expect(statusOf(ids)).toEqual(["done"]);
    }
  });

  it("claims no drill kind while JOBS_DRILL_ENABLED is off (the job stays pending)", async () => {
    vi.stubEnv("JOBS_DRILL_ENABLED", "false");
    const ids = seedDrill(1);
    const { res, json } = await post(bearer(secret));
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, claimed: 0, done: 0 });
    expect(statusOf(ids)).toEqual(["pending"]);
  });
});

describe("POST /api/jobs/run: refusals before any database access", () => {
  async function expectRefused(headers: Record<string, string>, label: string) {
    const [marker] = psql("select clock_timestamp()");
    const ids = seedDrill(1);
    const { res, text } = await post(headers, JSON.stringify({ source: "pg_cron" }));
    expect(res.status, label).toBe(401);
    expect(text, label).toBe('{"ok":false}');
    expect(statusOf(ids), label).toEqual(["pending"]);
    expect(runnerRunsSince(marker), label).toEqual([]);
    expect(output.join(""), label).not.toContain("db.system_acquired");
    purgeDrillJobs();
  }

  it("no configured secret: even `Bearer undefined` and the old secret are refused", async () => {
    vi.stubEnv("JOBS_RUNNER_SECRET", undefined);
    await expectRefused(bearer(secret), "a token of the old secret");
    await expectRefused({ authorization: "Bearer undefined" }, "Bearer undefined");
    await expectRefused({ authorization: "Bearer " }, "empty bearer");
    await expectRefused({}, "no header");
  });

  it("an environment the schema refuses authenticates nothing", async () => {
    vi.stubEnv("JOBS_RUNNER_SECRET", "short");
    await expectRefused(bearer("short"), "a secret the schema refuses");
  });

  // Headers are built when each case runs (a token's age is measured from the moment it is minted).
  it.each<[string, () => Record<string, string>]>([
    ["no header", () => ({})],
    ["a wrong raw bearer", () => rawBearer(randomBytes(32).toString("hex"))],
    ["a different-length bearer", () => rawBearer(secret.slice(0, 10))],
    ["a longer bearer", () => rawBearer(`${secret}${secret}`)],
    ["the raw secret as bearer (the 000033 form, R-49)", () => rawBearer(secret)],
    // ±125 s here (wall clock, a few ms pass before the call); the exact ±120/121 s edges are runner-auth.spec.ts.
    ["a stale token (−125 s)", () => bearer(secret, -125)],
    ["a future token (+125 s)", () => bearer(secret, 125)],
    ["a token of another secret", () => bearer(randomBytes(32).toString("hex"))],
    ["a token without the scheme", () => ({ authorization: mintRunnerToken(secret) })],
    ["a lower-case scheme", () => ({ authorization: `bearer ${mintRunnerToken(secret)}` })],
    ["the token in another header", () => ({ "x-jobs-runner-secret": mintRunnerToken(secret) })],
  ])("%s → 401", async (label, headers) => {
    await expectRefused(headers(), label);
  });

  it("a signed-in clinic owner's session cookie without the bearer → 401 (no role is a runner)", async () => {
    const owner = await seedTenantWithOwner("Jobs run route spec clinic");
    const { data } = await owner.client.auth.getSession();
    const session = data.session as Session;
    expect(session).toBeTruthy();
    const name = `sb-${new URL(publicEnv.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
    const cookie = `${name}=base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
    await expectRefused({ cookie }, "owner session cookie");
    await expectRefused({ cookie, authorization: `Bearer ${session.access_token}` }, "owner access token as bearer");
  });

  it.each([
    ["GET", GET],
    ["PUT", PUT],
    ["PATCH", PATCH],
    ["DELETE", DELETE],
  ] as const)("%s → 405 with Allow: POST, even with the bearer, and runs nothing", async (method, handler) => {
    const ids = seedDrill(1);
    for (const headers of [{}, bearer(secret)]) {
      const res = await call(handler as (req: NextRequest) => Promise<Response>, method, headers);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      expect(await res.text()).toBe("");
    }
    expect(statusOf(ids)).toEqual(["pending"]);
  });
});

describe("POST /api/jobs/run: body and failure handling", () => {
  it.each([
    ["more than 1 KB", JSON.stringify({ source: "manual", pad: "x".repeat(2048) }), 413],
    ["not JSON", "source=pg_cron", 400],
    ["an unknown key", JSON.stringify({ source: "manual", kinds: ["message.send"] }), 400],
    ["an unknown source", JSON.stringify({ source: "attacker" }), 400],
    ["a JSON array", "[]", 400],
  ])("refuses a body that is %s (nothing runs)", async (_label, body, status) => {
    const ids = seedDrill(1);
    const { res, text } = await post(bearer(secret), body);
    expect(res.status).toBe(status);
    expect(text).toBe('{"ok":false}');
    expect(statusOf(ids)).toEqual(["pending"]);
  });

  it("a thrown error is 500 { ok: false } with one jobs.run.failed line carrying a code only", async () => {
    // The system client cannot be built without its key: the factory throws after authentication.
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const ids = seedDrill(1);
    const { res, text } = await post(bearer(secret));
    expect(res.status).toBe(500);
    expect(text).toBe('{"ok":false}');
    expect(statusOf(ids)).toEqual(["pending"]);
    const failed = output
      .join("")
      .split("\n")
      .filter((l) => l.includes('"event":"jobs.run.failed"'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ level: "error", code: "Error" });
    expect(output.join("")).not.toContain("SUPABASE_SECRET_KEY is required");
  });
});
