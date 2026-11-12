#!/usr/bin/env node
/**
 * Wait for a staging release (V2-03 03-08; rulings R-26, R-19).
 *
 * The staging app deploys through the Vercel Git integration on `feature/v2`; `staging.yml` applies the migrations
 * and then proves the two halves meet:
 *   1. polls `GET <origin>/api/health` until its `release` (the deployed commit, `VERCEL_GIT_COMMIT_SHA`, 03-01) equals
 *      the workflow's commit, for at most `--timeout-ms` (default 10 minutes);
 *   2. then `GET <origin>/api/ready` must answer 200 with `status: "ready"` and `latestMigration` equal to the newest
 *      file in `supabase/migrations` (its zero-padded number).
 * Only origins that are bare https origins are accepted (no loopback http, no path). Nothing is printed beyond
 * statuses, the release SHA and the migration numbers; the readiness body is never echoed.
 *
 * Usage: node scripts/staging/wait-for-release.mjs <origin> <sha> [--timeout-ms N] [--interval-ms N]
 *                                                  [--migrations-dir <dir>]
 * Exit 0 = released and ready, 1 = timeout / not ready / wrong migration, 2 = usage.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 15_000;
const SHA = /^[0-9a-f]{40}$/;
const MIGRATION_FILE = /^([0-9]{6})_[a-z0-9_]+\.sql$/;

/** Problems with `origin` as a staging origin (bare https origin), or null. */
export function originProblem(origin) {
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:") return "must be https";
    if (u.origin !== origin) return "must be a bare origin (scheme and host, no path or trailing slash)";
    return null;
  } catch {
    return "is not a URL";
  }
}

/** The newest migration number in `dir` (e.g. "000027"), or null when there is none. */
export function newestMigration(dir = path.join(REPO_ROOT, "supabase/migrations")) {
  const versions = fs
    .readdirSync(dir)
    .map((f) => MIGRATION_FILE.exec(f)?.[1])
    .filter((v) => v !== undefined)
    .sort();
  return versions.at(-1) ?? null;
}

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body: body && typeof body === "object" && !Array.isArray(body) ? body : null };
}

/**
 * @param {{ origin: string, sha: string, expectedMigration: string | null, fetchImpl?: typeof fetch,
 *   sleep?: (ms: number) => Promise<void>, now?: () => number, timeoutMs?: number, intervalMs?: number }} options
 * @returns {Promise<{ exitCode: number, lines: string[] }>}
 */
export async function waitForRelease({
  origin,
  sha,
  expectedMigration,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
}) {
  const lines = [];
  const done = (exitCode, line) => ({ exitCode, lines: [...lines, line] });
  const bad = originProblem(origin);
  if (bad) return done(2, `wait-for-release: REFUSED origin ${bad}`);
  if (!SHA.test(sha)) return done(2, "wait-for-release: REFUSED the release must be a 40-character lowercase commit SHA");
  if (!expectedMigration) return done(2, "wait-for-release: REFUSED no migration file found to compare with");

  const deadline = now() + timeoutMs;
  let attempts = 0;
  let last = "no answer yet";
  for (;;) {
    attempts += 1;
    try {
      const { status, body } = await getJson(fetchImpl, `${origin}/api/health`);
      const release = body && typeof body.release === "string" ? body.release : null;
      if (status === 200 && release === sha) {
        lines.push(`wait-for-release: /api/health reports release ${sha} (attempt ${attempts})`);
        break;
      }
      last = status === 200 ? `release ${release ?? "null"}` : `HTTP ${status}`;
    } catch (e) {
      last = `request failed (${e instanceof Error ? e.name : "error"})`;
    }
    if (now() + intervalMs > deadline) {
      return done(1, `wait-for-release: TIMEOUT after ${attempts} attempt(s): ${origin}/api/health never reported release ${sha} (last: ${last})`);
    }
    await sleep(intervalMs);
  }

  let ready;
  try {
    ready = await getJson(fetchImpl, `${origin}/api/ready`);
  } catch (e) {
    return done(1, `wait-for-release: FAIL /api/ready request failed (${e instanceof Error ? e.name : "error"})`);
  }
  if (ready.status !== 200 || ready.body?.status !== "ready") {
    return done(1, `wait-for-release: FAIL /api/ready answered HTTP ${ready.status} (status ${JSON.stringify(ready.body?.status ?? null)})`);
  }
  const latest = typeof ready.body.latestMigration === "string" ? ready.body.latestMigration : null;
  if (latest !== expectedMigration) {
    return done(1, `wait-for-release: FAIL /api/ready latestMigration ${JSON.stringify(latest)}, the repository's newest is ${expectedMigration}`);
  }
  return done(0, `wait-for-release: PASS release ${sha} is live and ready at migration ${expectedMigration}`);
}

function parseArgs(argv) {
  const positional = [];
  const opts = { timeoutMs: DEFAULT_TIMEOUT_MS, intervalMs: DEFAULT_INTERVAL_MS, migrationsDir: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--timeout-ms") opts.timeoutMs = Number(argv[++i]);
    else if (a === "--interval-ms") opts.intervalMs = Number(argv[++i]);
    else if (a === "--migrations-dir") opts.migrationsDir = argv[++i];
    else if (a.startsWith("--")) return null;
    else positional.push(a);
  }
  if (positional.length !== 2 || !(opts.timeoutMs > 0) || !(opts.intervalMs > 0)) return null;
  return { origin: positional[0], sha: positional[1], ...opts };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error("usage: node scripts/staging/wait-for-release.mjs <origin> <sha> [--timeout-ms N] [--interval-ms N] [--migrations-dir <dir>]");
    return 2;
  }
  const { exitCode, lines } = await waitForRelease({
    origin: args.origin,
    sha: args.sha,
    expectedMigration: newestMigration(args.migrationsDir),
    timeoutMs: args.timeoutMs,
    intervalMs: args.intervalMs,
  });
  for (const line of lines) (exitCode === 0 ? console.log : console.error)(line);
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main());
}
