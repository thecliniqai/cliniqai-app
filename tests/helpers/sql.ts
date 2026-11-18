/**
 * Superuser SQL against the local stack's Postgres container (`docker exec … psql`), for tests that must read the
 * live catalog or install a fault (a temporary trigger) that no API role can. Loopback only by construction: it
 * talks to the container named after `supabase/config.toml`'s `project_id`, never to a URL.
 *
 * Factored from tests/setup/teardown.spec.ts (V2-03 03-07). Synthetic SQL only; never interpolate row data.
 */
import { execFile, execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/** `supabase_db_<project_id>`: the local stack's Postgres container. */
export function localDbContainer(): string {
  const toml = fs.readFileSync(path.join(ROOT, "supabase/config.toml"), "utf8");
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (!projectId) throw new Error("project_id not found in supabase/config.toml");
  return `supabase_db_${projectId}`;
}

function psqlArgs(sql: string): string[] {
  return ["exec", localDbContainer(), "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", sql];
}

/** Runs `sql` as the local superuser and returns the unaligned, tuples-only output lines. Throws on any SQL error. */
export function psql(sql: string): string[] {
  // stderr is captured (and part of the thrown error's message), not echoed into the test output.
  const out = execFileSync("docker", psqlArgs(sql), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return out.trim().split("\n").filter(Boolean);
}

/**
 * Starts `sql` without waiting (e.g. a transaction that holds a row lock for a while). Resolves with the output lines
 * when psql exits; rejects on a SQL error.
 */
export function psqlAsync(sql: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile("docker", psqlArgs(sql), { encoding: "utf8" }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim().split("\n").filter(Boolean));
    });
  });
}

/**
 * Runs `statements` in order in ONE psql session (each its own `-c`), so a `begin` … `rollback` pair brackets a
 * temporary change (V2-03 03-09b: lowering the error-sink cap or removing the vault secret for one probe) that no other
 * session ever sees. Returns the output lines of every statement; command tags are suppressed. Throws on any SQL error.
 */
export function psqlSession(statements: string[]): string[] {
  const args = ["exec", localDbContainer(), "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"];
  for (const s of statements) args.push("-c", s);
  const out = execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return out.trim().split("\n").filter(Boolean);
}

/**
 * Plants a row the composite tenant FKs (V2-05 05-03) now refuse, as such a row could exist before 05-03 (a legacy
 * cross-tenant reference), so a spec can prove that a downstream defence (a handler's tenant check, a token or
 * reply lookup) still holds for it. One superuser session; FK triggers are off for this transaction only
 * (`session_replication_role = replica`, which also skips every other trigger of the statement), then committed.
 * The planted row belongs to the run's tenant, so the run teardown removes it. Returns the statement's output lines
 * (e.g. a `returning id`). Synthetic SQL only; never interpolate row data.
 */
export function plantLegacyRow(sql: string): string[] {
  return psqlSession(["begin", "set local session_replication_role = replica", sql, "commit"]);
}

export interface PsqlFileOptions {
  /** Container to run in (default: the primary stack's `localDbContainer()`). */
  container?: string;
  /** Statements run first in the same session, each its own `-c` (e.g. `begin` and a fault to install). */
  before?: string[];
}

export interface PsqlFileResult {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs a SQL file (e.g. supabase/tests/restore_drill_checks.sql, V2-04 04-05a) as the local superuser with psql
 * variables (`-v name=value`), feeding the file on stdin so it need not exist inside the container. Statements in
 * `before` run first in the same session: wrap with `begin` there and the file's own `rollback` (or the session's end
 * on an error) undoes them. Never throws on a SQL failure: returns psql's exit status and output (ON_ERROR_STOP on).
 */
export function psqlFile(file: string, vars: Record<string, string | number> = {}, options: PsqlFileOptions = {}): PsqlFileResult {
  const args = ["exec", "-i", options.container ?? localDbContainer(), "psql", "-U", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"];
  for (const [name, value] of Object.entries(vars)) args.push("-v", `${name}=${value}`);
  for (const s of options.before ?? []) args.push("-c", s);
  args.push("-f", "-");
  const r = spawnSync("docker", args, { input: fs.readFileSync(file), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
