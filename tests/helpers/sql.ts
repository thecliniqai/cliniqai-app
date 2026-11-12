/**
 * Superuser SQL against the local stack's Postgres container (`docker exec … psql`), for tests that must read the
 * live catalog or install a fault (a temporary trigger) that no API role can. Loopback only by construction: it
 * talks to the container named after `supabase/config.toml`'s `project_id`, never to a URL.
 *
 * Factored from tests/setup/teardown.spec.ts (V2-03 03-07). Synthetic SQL only; never interpolate row data.
 */
import { execFile, execFileSync } from "node:child_process";
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
