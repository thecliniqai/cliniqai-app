#!/usr/bin/env node
/**
 * Wait for a staging release (V2-03 03-08; rulings R-26, R-19).
 *
 * The staging app deploys through the Vercel Git integration on `feature/v2`; `staging.yml` applies the migrations
 * and then proves the two halves meet:
 *   1. polls `GET <origin>/api/health` until its `release` (the deployed commit, `VERCEL_GIT_COMMIT_SHA`, 03-01) equals
 *      the workflow's commit, for at most `--timeout-ms` (default 10 minutes). V2-04 04-00 (review A L-6): a release
 *      that **descends** from the workflow's commit is accepted too (`git merge-base --is-ancestor <sha> <release>` in
 *      the job's full-history checkout), so a later commit that deployed while this run waited for approval does not
 *      fail it. A release that does not descend from it (a rollback, another branch) keeps the wait going until the
 *      timeout, as before; so does a newer commit the checkout does not hold;
 *   2. then `GET <origin>/api/ready` must answer 200 with `status: "ready"` and `checks.schema: "current"`. Since
 *      03-13c (M-PROBE) the probe returns booleans only: the build asks the database whether its own
 *      `EXPECTED_MIGRATION` (`app/api/ready/expected-migration.ts`, which a spec pins to the newest file in
 *      `supabase/migrations`) is applied. Step 1 proved the deployed build is this commit, so "current" means the
 *      staging database carries this commit's newest migration. No version number leaves the server.
 * Only origins that are bare https origins are accepted (no loopback http, no path). Nothing is printed beyond
 * statuses and the release SHA; the readiness body is never echoed.
 *
 * Usage: node scripts/staging/wait-for-release.mjs <origin> <sha> [--timeout-ms N] [--interval-ms N]
 * Exit 0 = released and ready, 1 = timeout / not ready / schema behind, 2 = usage.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const DEFAULT_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 15_000;
const SHA = /^[0-9a-f]{40}$/;

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

/**
 * True when `ancestor` is an ancestor of (or equal to) `descendant` in the repository's history. Both are 40-hex SHAs
 * checked by the caller and passed as an argument array (no shell). A commit the checkout lacks answers false.
 * @param {string} ancestor
 * @param {string} descendant
 * @param {typeof spawnSync} [spawnImpl]
 */
export function gitIsAncestor(ancestor, descendant, spawnImpl = spawnSync) {
  if (!SHA.test(ancestor) || !SHA.test(descendant)) return false;
  const r = spawnImpl("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 30_000,
  });
  return r.status === 0;
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
 * @param {{ origin: string, sha: string, fetchImpl?: typeof fetch, isAncestor?: (ancestor: string, descendant: string) => boolean,
 *   sleep?: (ms: number) => Promise<void>, now?: () => number, timeoutMs?: number, intervalMs?: number }} options
 * @returns {Promise<{ exitCode: number, lines: string[] }>}
 */
export async function waitForRelease({
  origin,
  sha,
  fetchImpl = globalThis.fetch,
  isAncestor = (a, d) => gitIsAncestor(a, d),
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

  const deadline = now() + timeoutMs;
  let attempts = 0;
  let last = "no answer yet";
  let live = sha;
  /** 04-00 L-6: one git answer per release value (the poll repeats the same release many times). */
  const descends = new Map();
  for (;;) {
    attempts += 1;
    try {
      const { status, body } = await getJson(fetchImpl, `${origin}/api/health`);
      const release = body && typeof body.release === "string" ? body.release : null;
      if (status === 200 && release === sha) {
        lines.push(`wait-for-release: /api/health reports release ${sha} (attempt ${attempts})`);
        break;
      }
      if (status === 200 && release !== null && SHA.test(release)) {
        if (!descends.has(release)) descends.set(release, isAncestor(sha, release) === true);
        if (descends.get(release)) {
          live = release;
          lines.push(`wait-for-release: /api/health reports release ${release}, a descendant of ${sha} (attempt ${attempts})`);
          break;
        }
      }
      last = status === 200 ? `release ${release !== null && SHA.test(release) ? release : release === null ? "null" : "malformed"}${release !== null && descends.get(release) === false ? " (not a descendant)" : ""}` : `HTTP ${status}`;
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
  const schema = ready.body.checks && typeof ready.body.checks === "object" ? ready.body.checks.schema : undefined;
  if (schema !== "current") {
    const shown = typeof schema === "string" && /^[a-z_]{1,20}$/.test(schema) ? schema : "missing";
    return done(1, `wait-for-release: FAIL /api/ready checks.schema is ${shown}, not current (staging lacks this commit's newest migration)`);
  }
  if (live !== sha) {
    return done(0, `wait-for-release: PASS release ${live} (descends from ${sha}) is live and ready with the schema current`);
  }
  return done(0, `wait-for-release: PASS release ${sha} is live and ready with the schema current`);
}

function parseArgs(argv) {
  const positional = [];
  const opts = { timeoutMs: DEFAULT_TIMEOUT_MS, intervalMs: DEFAULT_INTERVAL_MS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--timeout-ms") opts.timeoutMs = Number(argv[++i]);
    else if (a === "--interval-ms") opts.intervalMs = Number(argv[++i]);
    else if (a.startsWith("--")) return null;
    else positional.push(a);
  }
  if (positional.length !== 2 || !(opts.timeoutMs > 0) || !(opts.intervalMs > 0)) return null;
  return { origin: positional[0], sha: positional[1], ...opts };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error("usage: node scripts/staging/wait-for-release.mjs <origin> <sha> [--timeout-ms N] [--interval-ms N]");
    return 2;
  }
  const { exitCode, lines } = await waitForRelease({
    origin: args.origin,
    sha: args.sha,
    timeoutMs: args.timeoutMs,
    intervalMs: args.intervalMs,
  });
  for (const line of lines) (exitCode === 0 ? console.log : console.error)(line);
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(await main());
}
