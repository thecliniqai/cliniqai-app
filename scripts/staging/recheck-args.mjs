#!/usr/bin/env node
/**
 * Runs the AUTH-00 staging re-check with the PO's optional dispatch inputs (V2-03 03-13b, for 03-13a's kit items 10 and
 * 11). `.github/workflows/staging.yml` job `auth00-recheck` passes the `workflow_dispatch` inputs through `env` only
 * (never `${{ inputs.* }}` inside `run:`); this script validates them and starts
 * `npx tsx scripts/staging/auth00-recheck.ts --target staging --out <file> [--stale-wait-seconds <n>] [--email-cap-probe <n>]`
 * with an argument array (no shell), so an input can never become a command.
 *
 *   PO_STALE_WAIT_SECONDS  ""  = item 10's stale-session probe off; else an integer 601..890 (seconds to wait past the
 *                                600 s emailed-code bound before calling GoTrue directly)
 *   PO_EMAIL_CAP_PROBE     ""  = item 11's hook-vs-cap probe off; else an integer 1..70 (sends to the SES simulator)
 * The ranges equal the kit's own (`STALE_WAIT_RANGE`, `MAX_EMAIL_CAP_PROBE` in auth00-recheck-lib.ts; a spec keeps them
 * equal), and the kit re-checks them. Anything else is refused before the kit starts (exit 2). The rest of the job's
 * environment (target, keys, database URL) reaches the kit unchanged; the kit applies its own guards.
 *
 * Usage: node scripts/staging/recheck-args.mjs --out <file>
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const STALE_WAIT_SECONDS = { min: 601, max: 890 };
export const EMAIL_CAP_PROBE_MAX = 70;

/** Optional integer input: "" / unset = off; otherwise plain digits within [min, max]. */
function intInput(value, min, max) {
  if (value === undefined || value.trim() === "") return { off: true };
  if (!/^[0-9]{1,4}$/.test(value.trim())) return { problem: "must be a whole number" };
  const n = Number(value.trim());
  if (n < min || n > max) return { problem: `must be ${min}..${max}` };
  return { value: String(n) };
}

/**
 * The kit's arguments for these inputs, or the problems that refuse the run. Problems never echo the input.
 * @param {Record<string, string | undefined>} env
 * @param {string} out
 * @returns {{ args: string[], problems: string[] }}
 */
export function recheckArgs(env, out) {
  const problems = [];
  const args = ["tsx", "scripts/staging/auth00-recheck.ts", "--target", "staging", "--out", out];
  const stale = intInput(env.PO_STALE_WAIT_SECONDS, STALE_WAIT_SECONDS.min, STALE_WAIT_SECONDS.max);
  if (stale.problem) problems.push(`stale_wait_seconds ${stale.problem} (or empty to skip item 10)`);
  else if (!stale.off) args.push("--stale-wait-seconds", stale.value);
  const cap = intInput(env.PO_EMAIL_CAP_PROBE, 1, EMAIL_CAP_PROBE_MAX);
  if (cap.problem) problems.push(`email_cap_probe ${cap.problem} (or empty to skip item 11)`);
  else if (!cap.off) args.push("--email-cap-probe", cap.value);
  return { args, problems };
}

function main(argv) {
  const i = argv.indexOf("--out");
  const out = i > -1 ? argv[i + 1] : undefined;
  if (!out || !/^[A-Za-z0-9._/-]+$/.test(out) || argv.length !== 2) {
    console.error("usage: node scripts/staging/recheck-args.mjs --out <file>");
    return 2;
  }
  const { args, problems } = recheckArgs(process.env, out);
  if (problems.length) {
    for (const p of problems) console.error(`recheck-args: REFUSED ${p}`);
    return 2;
  }
  const r = spawnSync("npx", args, { stdio: "inherit", env: process.env });
  return r.status ?? 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2)));
}
