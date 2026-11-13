#!/usr/bin/env node
/**
 * Local auth policy check (V2-03 03-11a, AUTH-02; runs in the CI `static` job).
 *
 * Compares the `local` column of `supabase/auth-policy.json` with `supabase/config.toml` and exits 1 naming every
 * mismatched key. It also fails on:
 *   - an `[auth]` key in config.toml that no policy row governs (so a setting cannot be added outside the policy),
 *   - a policy row whose local value is null (hosted-only or "off locally") while config.toml sets the key,
 *   - a template or notification body that is not code-only (a link marker, a missing `{{ .Token }}`, or a code in a
 *     notification);
 *   - 03-13a: a security floor broken in ANY environment column (local, staging, production), see {@link FLOORS}.
 *     The floors also apply to `--print`, so the PO checklist can never carry a value below them.
 *
 * Usage:
 *   node scripts/ci/check-auth-config.mjs [--policy <file>] [--config <file>] [--root <dir>]
 *   node scripts/ci/check-auth-config.mjs --print <staging|production|local>   PO checklist (dashboard label + value)
 * Exit codes: 0 match, 1 mismatch, 2 usage error or invalid policy. Reads files only; no network.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import {
  ENVIRONMENTS,
  PolicyError,
  deepEqual,
  flattenAuth,
  formatValue,
  hostedValue,
  readPolicy,
  readTemplate,
  templateProblems,
} from "./auth-policy-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseArgs(argv) {
  const opts = {
    policy: path.join(REPO_ROOT, "supabase/auth-policy.json"),
    config: path.join(REPO_ROOT, "supabase/config.toml"),
    root: REPO_ROOT,
    print: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new PolicyError(`${a} needs a value`);
      return v;
    };
    if (a === "--policy") opts.policy = path.resolve(next());
    else if (a === "--config") opts.config = path.resolve(next());
    else if (a === "--root") opts.root = path.resolve(next());
    else if (a === "--print") opts.print = next();
    else throw new PolicyError(`unknown argument ${a}`);
  }
  if (opts.print !== null && !ENVIRONMENTS.includes(opts.print)) {
    throw new PolicyError(`--print takes one of ${ENVIRONMENTS.join(", ")}`);
  }
  return opts;
}

function printChecklist(policy, env) {
  const lines = [`Supabase Auth settings for ${env} (from supabase/auth-policy.json; apply in the dashboard, R-20):`];
  for (const row of policy.settings) {
    const applies = env === "local" ? row.toml !== null : row.hosted !== null;
    if (!applies) continue;
    const value = row[env];
    const shown =
      row.transform === "file_content"
        ? `contents of ${value}`
        : formatValue(env === "local" ? value : hostedValue(row, value));
    const field = env === "local" ? row.toml : row.hosted;
    lines.push(`- ${row.dashboard}`);
    lines.push(`    ${field} = ${value === null ? "(not set)" : shown}${row.deviation_reason ? `   [deviation: ${row.deviation_reason}]` : ""}`);
    lines.push(`    source: ${row.source}`);
  }
  if (env !== "local") {
    lines.push("Secrets (CAPTCHA secret key, Send Email hook secret) are set in the dashboard and never written here.");
    lines.push("Verify afterwards with the read-only drift workflow (scripts/drift/auth-config-hosted.mjs).");
  }
  return lines;
}

/**
 * Security floors every environment must meet (03-13a). `email_otp_length` >= 8 (ruling R-36, review D M-1: a 10^6
 * code space is within reach of a distributed guesser while `/verify` is limited per IP only); `email_otp_expiry` <=
 * 600 s (AR-L6, the window the 8-digit arithmetic assumes).
 */
export const FLOORS = [
  { id: "email_otp_length", test: (v) => Number.isInteger(v) && v >= 8, rule: ">= 8 (R-36)" },
  { id: "email_otp_expiry", test: (v) => Number.isInteger(v) && v > 0 && v <= 600, rule: "<= 600 s (AR-L6)" },
];

/** Problem lines for every floor broken in any environment column (a missing row is a problem too). */
export function checkFloors(policy) {
  const problems = [];
  for (const floor of FLOORS) {
    const row = policy.settings.find((r) => r.id === floor.id);
    if (!row) {
      problems.push(`${floor.id}: policy row missing (floor ${floor.rule})`);
      continue;
    }
    for (const env of ENVIRONMENTS) {
      if (!floor.test(row[env])) problems.push(`${floor.id} (${env}): ${formatValue(row[env])} breaks the floor ${floor.rule}`);
    }
  }
  return problems;
}

/** Returns problem lines; empty means config.toml matches the local column. */
export function checkLocal(policy, config, root) {
  const problems = [];
  const leaves = flattenAuth(config);
  const governed = new Set();
  for (const row of policy.settings) {
    if (row.toml === null) continue;
    governed.add(row.toml);
    const present = leaves.has(row.toml);
    const actual = leaves.get(row.toml);
    if (row.local === null) {
      if (present) problems.push(`${row.toml}: config.toml sets ${formatValue(actual)}, policy (local) wants it absent`);
      continue;
    }
    if (!present) {
      problems.push(`${row.toml}: missing from config.toml, policy (local) wants ${formatValue(row.local)}`);
      continue;
    }
    if (!deepEqual(actual, row.local)) {
      problems.push(`${row.toml}: config.toml has ${formatValue(actual)}, policy (local) wants ${formatValue(row.local)}`);
      continue;
    }
    if (row.transform === "file_content") {
      let body;
      try {
        body = readTemplate(root, row.local);
      } catch (e) {
        problems.push(`${row.toml}: template ${row.local} cannot be read (${e instanceof Error ? e.message : String(e)})`);
        continue;
      }
      problems.push(...templateProblems(row, body));
    }
  }
  for (const key of leaves.keys()) {
    if (!governed.has(key)) problems.push(`${key}: set in config.toml but not governed by supabase/auth-policy.json`);
  }
  return problems;
}

function main() {
  let opts;
  let policy;
  try {
    opts = parseArgs(process.argv.slice(2));
    policy = readPolicy(opts.policy);
  } catch (e) {
    console.error(`auth-policy: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const floorProblems = checkFloors(policy);
  if (floorProblems.length) {
    for (const p of floorProblems) console.error(`auth-policy: FLOOR ${p}`);
    console.error(`auth-policy: FAIL (${floorProblems.length} security floor(s) broken in supabase/auth-policy.json)`);
    return 1;
  }
  if (opts.print) {
    console.log(printChecklist(policy, opts.print).join("\n"));
    return 0;
  }
  let config;
  try {
    config = parseToml(fs.readFileSync(opts.config, "utf8"));
  } catch (e) {
    console.error(`auth-policy: cannot parse ${opts.config}: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const problems = checkLocal(policy, config, opts.root);
  if (problems.length) {
    for (const p of problems) console.error(`auth-policy: MISMATCH ${p}`);
    console.error(`auth-policy: FAIL (${problems.length} problem(s); fix config.toml or the policy row and its source)`);
    return 1;
  }
  const checked = policy.settings.filter((r) => r.toml !== null).length;
  console.log(`auth-policy: PASS (${checked} config.toml settings match the local policy column)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
