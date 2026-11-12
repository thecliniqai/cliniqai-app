#!/usr/bin/env node
/**
 * Hosted staging schema drift (V2-03 03-08, B1 for staging; ruling R-21). Runs nightly in `drift.yml` (`schema` job,
 * GitHub Environment `staging-readonly`).
 *
 *   1. `target-guard`: `STAGING_DB_URL_RO` must be the staging project (`SUPABASE_PROJECT_REF_STAGING`); loopback,
 *      IP literals and other projects are refused before anything runs.
 *   2. `supabase db diff --db-url <STAGING_DB_URL_RO> --schema public --agent no --output-format json`: the CLI builds
 *      a shadow database from `supabase/migrations` in the runner's Docker and diffs it against the staging database.
 *      The CLI only reads the target (catalog queries); the URL's role is the read-only `clinicos_drift_ro`
 *      (`default_transaction_read_only`, no table grants; docs/runbooks/staging.md), so a write would fail anyway.
 *   3. The diff is judged by `scripts/ci/local-drift.mjs --input` (the same allowlist as the local gate, 03-03).
 * The database URL and its password are removed from every line the CLI prints before it is shown.
 *
 * Usage: node scripts/staging/schema-drift.mjs [--out <dir>]
 * Exit 0 = no drift beyond the allowlist, 1 = drift, 2 = refused or the diff could not be produced.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REF_VAR, redactUrl, stagingTargetProblems } from "./target-guard.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DB_URL_VAR = "STAGING_DB_URL_RO";

/** The CLI arguments of the read-only diff (exported for the spec). */
export function diffArgs(url) {
  return ["supabase", "db", "diff", "--db-url", url, "--schema", "public", "--agent", "no", "--output-format", "json"];
}

/**
 * @param {{ vars?: Record<string, string | undefined>, out?: string,
 *   spawnImpl?: (cmd: string, args: string[], opts: object) => { status: number | null, stdout: string, stderr: string, error?: Error } }} [options]
 * @returns {{ exitCode: number, lines: string[] }}
 */
export function runSchemaDrift({ vars = process.env, out, spawnImpl = spawnSync } = {}) {
  const url = vars[DB_URL_VAR];
  const problems = stagingTargetProblems({ url, ref: vars[REF_VAR], kind: "db" });
  if (problems.length) return { exitCode: 2, lines: problems.map((p) => `schema-drift: REFUSED ${DB_URL_VAR}: ${p}`) };

  const diff = spawnImpl("npx", diffArgs(url), {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, [DB_URL_VAR]: undefined },
  });
  if (diff.error || diff.status !== 0) {
    const stderr = redactUrl(String(diff.stderr ?? ""), url).trim();
    return {
      exitCode: 2,
      lines: [`schema-drift: \`supabase db diff --db-url <staging>\` failed (exit ${diff.status})`, ...(stderr ? [stderr] : [])],
    };
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-drift-"));
  const input = path.join(dir, "staging-diff.json");
  fs.writeFileSync(input, redactUrl(String(diff.stdout ?? ""), url));
  const judge = spawnImpl(process.execPath, [path.join(REPO_ROOT, "scripts/ci/local-drift.mjs"), "--input", input, ...(out ? ["--out", out] : [])], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  fs.rmSync(dir, { recursive: true, force: true });
  const lines = [String(judge.stdout ?? "").trim(), String(judge.stderr ?? "").trim()].filter(Boolean).map((l) => redactUrl(l, url));
  return { exitCode: judge.status === 0 ? 0 : judge.status === 1 ? 1 : 2, lines };
}

function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--out");
  const out = i > -1 ? path.resolve(argv[i + 1]) : undefined;
  if (argv.some((a, idx) => a.startsWith("--") && a !== "--out" && idx !== i + 1)) {
    console.error("usage: node scripts/staging/schema-drift.mjs [--out <dir>]");
    return 2;
  }
  const { exitCode, lines } = runSchemaDrift({ out });
  for (const line of lines) (exitCode === 0 ? console.log : console.error)(line);
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main());
}
