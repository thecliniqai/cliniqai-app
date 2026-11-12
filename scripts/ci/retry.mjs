#!/usr/bin/env node
/**
 * Bounded retry for a flaky CI step (V2-02 02-06, IR-F8): `npx supabase start` pulls the full image set and fails on
 * registry rate limits (`toomanyrequests`) or a half-started stack (port already bound).
 *
 * Runs the command; on a non-zero exit runs the cleanup command (e.g. `npx supabase stop --no-backup`), waits, and
 * tries again, up to --attempts times, with the delay doubling each time. Exits with the last attempt's status, so a
 * real failure still fails the job.
 *
 * Usage: node scripts/ci/retry.mjs [--attempts 3] [--delay <seconds, default 20>] [--cleanup "<command>"] -- <command> [args…]
 * --attempts is 1..5; the delay is capped at 120 s per wait.
 */
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep < 0 || sep === argv.length - 1) {
  console.error('usage: node scripts/ci/retry.mjs [--attempts n] [--delay s] [--cleanup "cmd"] -- <command> [args…]');
  process.exit(2);
}
const opts = argv.slice(0, sep);
const [command, ...args] = argv.slice(sep + 1);
const opt = (name, fallback) => {
  const i = opts.indexOf(name);
  return i > -1 ? opts[i + 1] : fallback;
};
const attempts = Number(opt("--attempts", "3"));
const delay = Number(opt("--delay", "20"));
const cleanup = opt("--cleanup", null);
if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5 || !Number.isFinite(delay) || delay < 0) {
  console.error("retry: --attempts must be 1..5 and --delay a non-negative number of seconds");
  process.exit(2);
}

const sleep = (s) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, s * 1000);

let status = 1;
for (let attempt = 1; attempt <= attempts; attempt++) {
  const r = spawnSync(command, args, { stdio: "inherit" });
  status = r.error ? 1 : (r.status ?? 1);
  if (status === 0) {
    if (attempt > 1) console.log(`retry: succeeded on attempt ${attempt}/${attempts}`);
    process.exit(0);
  }
  console.error(`retry: attempt ${attempt}/${attempts} exited ${status}${r.error ? ` (${r.error.message})` : ""}`);
  if (attempt === attempts) break;
  if (cleanup) spawnSync(cleanup, { stdio: "inherit", shell: true });
  const wait = Math.min(delay * 2 ** (attempt - 1), 120);
  console.error(`retry: waiting ${wait}s before attempt ${attempt + 1}`);
  sleep(wait);
}
process.exit(status);
