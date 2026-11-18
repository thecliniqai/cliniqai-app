/**
 * Restore-drill evidence checker (V2-04 04-05a; 04-P13 verification, rulings R-4, R-29).
 *
 * Re-validates an evidence file written by ops/restore-drill/run.sh: every key is in the allowed set, every value is a
 * number, a boolean, an ISO timestamp or a short enum/version string (so the file can carry counts and verdicts only,
 * never names or row data), every check is green, RPO <= 12 h and RTO <= 4 h (R-4).
 *
 * Usage: npx tsx ops/restore-drill/check-evidence.ts <evidence.json>
 * Exit 0 = pass, 1 = a rule failed (each printed), 2 = usage / unreadable file.
 */
import fs from "node:fs";
import path from "node:path";

export const RPO_MAX_SECONDS = 12 * 3600;
export const RTO_MAX_SECONDS = 4 * 3600;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const VERSION = /^v?\d+(\.\d+){1,3}(-[A-Za-z0-9.]+)?$/;

const REQUIRED_CHECKS = [
  // 04-07c (M-BACKUPAUTH): the archive's SHA-256 matched the digest recorded outside the bucket before decrypting, and
  // no SQL file held a psql meta-command.
  "archive_digest",
  "sql_guard",
  "decrypt",
  "wrong_key_refused",
  "restore",
  "migration_history",
  "objects_verified",
  "manifest_compare",
  "drill_checks_sql",
] as const;
const SELF_TEST_CHECKS = ["breakglass_decrypt", "failed_run_recorded", "tampered_archive_refused"] as const;
const ALL_CHECKS = new Set<string>([...REQUIRED_CHECKS, ...SELF_TEST_CHECKS]);

const COUNT_KEYS = new Set([
  "tables",
  "rows",
  "buckets",
  "objects",
  "object_bytes",
  "objects_excluded",
  "files_without_row",
  "policies",
  "functions",
  "auth_users",
  "rls_tables",
  "pgtap_tests",
  "migrations",
  "archive_bytes",
]);

type Rule = (e: Record<string, unknown>, fail: (m: string) => void) => void;

const TOP_LEVEL: Record<string, Rule> = {
  format_version: (e, fail) => e.format_version === 1 || fail("format_version must be 1"),
  kind: (e, fail) => e.kind === "restore-drill" || fail("kind must be restore-drill"),
  mode: (e, fail) => (e.mode === "self-test" || e.mode === "archive") || fail("mode must be self-test or archive"),
  environment: (e, fail) => ["local", "staging", "production"].includes(e.environment as string) || fail("environment must be local, staging or production"),
  result: (e, fail) => e.result === "pass" || fail("result is not pass"),
  dump_started_at: iso("dump_started_at"),
  drill_started_at: iso("drill_started_at"),
  checks_green_at: iso("checks_green_at"),
  rpo_seconds: (e, fail) => {
    const v = e.rpo_seconds;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return fail("rpo_seconds must be a non-negative number");
    if (v > RPO_MAX_SECONDS) fail(`RPO ${v} s exceeds ${RPO_MAX_SECONDS} s (12 h, R-4)`);
  },
  rto_seconds: (e, fail) => {
    const v = e.rto_seconds;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return fail("rto_seconds must be a non-negative number");
    if (v > RTO_MAX_SECONDS) fail(`RTO ${v} s exceeds ${RTO_MAX_SECONDS} s (4 h, R-4)`);
  },
  dump_age_h: (e, fail) => (typeof e.dump_age_h === "number" && e.dump_age_h >= 0) || fail("dump_age_h must be a non-negative number"),
  targets: (e, fail) => {
    const t = e.targets as Record<string, unknown> | undefined;
    if (!t || typeof t !== "object") return fail("targets missing");
    for (const k of Object.keys(t)) if (k !== "rpo_seconds_max" && k !== "rto_seconds_max") fail(`targets.${k} is not an allowed key`);
    if (t.rpo_seconds_max !== RPO_MAX_SECONDS || t.rto_seconds_max !== RTO_MAX_SECONDS) fail("targets must be the R-4 values");
  },
  checks: (e, fail) => {
    const c = e.checks as Record<string, unknown> | undefined;
    if (!c || typeof c !== "object") return fail("checks missing");
    for (const k of Object.keys(c)) {
      if (!ALL_CHECKS.has(k)) fail(`checks.${k} is not an allowed key`);
      else if (c[k] !== true) fail(`check ${k} is not green`);
    }
    for (const k of REQUIRED_CHECKS) if (!(k in c)) fail(`check ${k} missing`);
    if (e.mode === "self-test") for (const k of SELF_TEST_CHECKS) if (!(k in c)) fail(`check ${k} missing (self-test)`);
  },
  counts: (e, fail) => {
    const c = e.counts as Record<string, unknown> | undefined;
    if (!c || typeof c !== "object") return fail("counts missing");
    for (const [k, v] of Object.entries(c)) {
      if (!COUNT_KEYS.has(k)) fail(`counts.${k} is not an allowed key`);
      else if (typeof v !== "number" || !Number.isInteger(v) || v < 0) fail(`counts.${k} must be a non-negative integer`);
    }
  },
  versions: (e, fail) => {
    const v = e.versions as Record<string, unknown> | undefined;
    if (!v || typeof v !== "object") return fail("versions missing");
    for (const [k, val] of Object.entries(v)) {
      if (!["server", "cli", "age"].includes(k)) fail(`versions.${k} is not an allowed key`);
      else if (typeof val !== "string" || !VERSION.test(val.split(" ")[0])) fail(`versions.${k} is not a version string`);
    }
  },
};

function iso(name: string): Rule {
  return (e, fail) => (typeof e[name] === "string" && ISO.test(e[name] as string)) || fail(`${name} must be an ISO UTC timestamp`);
}

export function checkDrillEvidence(evidence: unknown): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const fail = (m: string) => {
    problems.push(m);
  };
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return { ok: false, problems: ["evidence is not a JSON object"] };
  const e = evidence as Record<string, unknown>;
  for (const k of Object.keys(e)) if (!(k in TOP_LEVEL)) fail(`${k} is not an allowed key`);
  for (const [k, rule] of Object.entries(TOP_LEVEL)) {
    if (!(k in e)) fail(`${k} missing`);
    else rule(e, fail);
  }
  if (problems.length === 0) {
    const started = Date.parse(e.drill_started_at as string);
    const green = Date.parse(e.checks_green_at as string);
    const dump = Date.parse(e.dump_started_at as string);
    if (Math.abs((green - started) / 1000 - (e.rto_seconds as number)) > 1) fail("rto_seconds does not match checks_green_at - drill_started_at");
    if (Math.abs((started - dump) / 1000 - (e.rpo_seconds as number)) > 1) fail("rpo_seconds does not match drill_started_at - dump_started_at");
  }
  return { ok: problems.length === 0, problems };
}

function main(argv: string[]): number {
  if (argv.length !== 1) {
    process.stderr.write("usage: check-evidence.ts <evidence.json>\n");
    return 2;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(argv[0], "utf8"));
  } catch {
    process.stderr.write("check-evidence: unreadable or invalid JSON\n");
    return 2;
  }
  const { ok, problems } = checkDrillEvidence(parsed);
  if (ok) {
    process.stdout.write("check-evidence: PASS\n");
    return 0;
  }
  process.stdout.write(`check-evidence: FAIL (${problems.length})\n`);
  for (const p of problems) process.stdout.write(`  - ${p}\n`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = main(process.argv.slice(2));
}
