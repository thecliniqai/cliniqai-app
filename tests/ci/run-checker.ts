/**
 * Runs a CI policy checker as a child process (the way the `static`/`security`/`test` jobs run it) and returns its
 * exit code and output. The checkers read only files passed to them; none touches the network or the database.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

export const ROOT = path.resolve(__dirname, "../..");

export interface CheckerResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function runChecker(command: string, args: string[], cwd = ROOT): CheckerResult {
  const r = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** `node scripts/ci/<script>.mjs ...args` from the repo root. */
export function runNodeChecker(script: string, args: string[]): CheckerResult {
  return runChecker(process.execPath, [path.join(ROOT, "scripts/ci", script), ...args]);
}
