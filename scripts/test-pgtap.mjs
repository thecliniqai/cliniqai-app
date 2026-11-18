#!/usr/bin/env node
/**
 * pgTAP lane (V2-05 plan 05-01a; P1-01 harness, roadmap V2-05 evidence "CI pgTAP report").
 *
 * Runs every pgTAP file in supabase/tests/database against the LOCAL stack only:
 *   npx supabase test db --local --debug supabase/tests/database
 * and tees the CLI's stdout (the TAP stream plus pg_prove's summary) to a report file for
 * scripts/ci/assert-pgtap-report.mjs. Exits with the CLI's exit code.
 *
 * - `--debug` is what makes CLI 2.120.0 run pg_prove with `--verbose`, i.e. print every `ok N - name` line and each
 *   file's `1..N` plan; without it only per-file summaries are printed and the gate could not name a failing test.
 *   Its extra stderr output is a few connection lines (no credentials; the local stack uses fixed local defaults).
 * - Takes the same test-run lock as Vitest and Playwright (tests/setup/teardown.ts `acquireRunLock`, keyed on the
 *   test env's loopback Supabase URL): a pgTAP file may take ACCESS EXCLUSIVE locks (ALTER TABLE in a rolled-back
 *   transaction) and must not interleave with a Vitest run. A held lock fails fast, like the other lanes.
 * - Refuses any flag (`--linked`, `--db-url`, `--project-ref`, …) before taking the lock or spawning anything: nothing
 *   is passed through to the CLI, so the target is always `--local`.
 * - `supabase test db` installs pgtap for the run and removes it afterwards (research A.6, verified in 05-01a).
 *
 * Usage: npm run test:pgtap [-- <report.tap>]      (default pgtap-report.tap; runs as `node --import tsx`, because
 *        the lock helper is TypeScript)
 * Exit: the CLI's exit code; 1 for a refused argument or a spawn failure.
 */
import { spawn as nodeSpawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PGTAP_DIR = "supabase/tests/database";
export const DEFAULT_REPORT = "pgtap-report.tap";
export const CLI_ARGS = ["supabase", "test", "db", "--local", "--debug", PGTAP_DIR];

const REFUSED_HINT = /^--?(linked|db-url|project-ref|workdir)\b/;

/**
 * Accepts at most one positional argument (the report path). Every flag is refused; `--linked` / `--db-url` /
 * `--project-ref` are named explicitly because they would point the CLI at a hosted project.
 * @param {string[]} argv
 * @returns {{ ok: true, report: string } | { ok: false, error: string }}
 */
export function parseArgs(argv) {
  const positional = [];
  for (const arg of argv) {
    if (arg.startsWith("-")) {
      const reason = REFUSED_HINT.test(arg)
        ? `refusing \`${arg}\`: the pgTAP lane runs only against the local stack (--local); no target flag is passed through`
        : `refusing \`${arg}\`: test:pgtap takes no flags (usage: npm run test:pgtap [-- <report.tap>])`;
      return { ok: false, error: reason };
    }
    if (/(^|\s)(postgres(ql)?:\/\/)/i.test(arg)) {
      return { ok: false, error: "refusing a connection string argument: the pgTAP lane runs only against the local stack" };
    }
    positional.push(arg);
  }
  if (positional.length > 1) {
    return { ok: false, error: `test:pgtap takes one report path, got ${positional.length} arguments` };
  }
  return { ok: true, report: positional[0] ?? DEFAULT_REPORT };
}

/** The production lock: the Vitest/Playwright test-run lock, keyed on the test env's loopback URL. */
async function defaultAcquireLock() {
  const { loadTestEnv } = await import("../tests/setup/test-env.ts");
  const { acquireRunLock } = await import("../tests/setup/teardown.ts");
  const env = { ...process.env };
  loadTestEnv(ROOT, env);
  const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid").hostname;
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
    throw new Error("refusing: the test env's NEXT_PUBLIC_SUPABASE_URL is not a loopback URL");
  }
  return acquireRunLock(env);
}

async function defaultReleaseLock(lockFile) {
  const { releaseRunLock } = await import("../tests/setup/teardown.ts");
  releaseRunLock(lockFile);
}

/**
 * @param {string[]} argv
 * @param {{ spawn?: typeof nodeSpawn, acquireLock?: () => Promise<string> | string,
 *   releaseLock?: (lock: string) => Promise<void> | void, openReport?: (file: string) => NodeJS.WritableStream,
 *   stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream, cwd?: string }} [deps]
 * @returns {Promise<number>}
 */
export async function runPgTap(argv, deps = {}) {
  const {
    spawn = nodeSpawn,
    acquireLock = defaultAcquireLock,
    releaseLock = defaultReleaseLock,
    openReport = (file) => createWriteStream(file),
    stdout = process.stdout,
    stderr = process.stderr,
    cwd = ROOT,
  } = deps;

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    stderr.write(`[test:pgtap] ${parsed.error}\n`);
    return 1;
  }

  let lock;
  try {
    lock = await acquireLock();
  } catch (e) {
    stderr.write(`[test:pgtap] ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  try {
    const report = openReport(path.resolve(cwd, parsed.report));
    const code = await new Promise((resolve) => {
      let child;
      try {
        child = spawn("npx", CLI_ARGS, { cwd, stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        stderr.write(`[test:pgtap] could not start the Supabase CLI: ${e instanceof Error ? e.message : String(e)}\n`);
        resolve(1);
        return;
      }
      child.stdout.on("data", (chunk) => {
        stdout.write(chunk);
        report.write(chunk);
      });
      child.stderr.on("data", (chunk) => stderr.write(chunk));
      child.on("error", (e) => {
        stderr.write(`[test:pgtap] could not start the Supabase CLI: ${e.message}\n`);
        resolve(1);
      });
      child.on("close", (status) => resolve(status ?? 1));
    });
    await new Promise((resolve) => report.end(resolve));
    stdout.write(`[test:pgtap] report: ${parsed.report} (exit ${code})\n`);
    return code;
  } finally {
    await releaseLock(lock);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await runPgTap(process.argv.slice(2));
}
