#!/usr/bin/env node
/**
 * npm audit gate (V2-02 plan 02-01 step 4, ruling RL-7). No dependency beyond Node.
 *
 * Runs `npm audit --omit=dev --json` and fails when
 *   1. any high or critical advisory is not waived in .github/audit-allowlist.json (matched by GHSA id + package +
 *      the severity the waiver recorded: an advisory re-rated since, e.g. high → critical, is no longer covered and
 *      needs a fresh review, V2-02 02-06 AR-L3);
 *   2. a waiver is malformed, has expired, or expires more than MAX_WAIVER_DAYS after today (renewal = a reviewed
 *      PR with a fresh reason and a new date);
 *   3. a waiver no longer matches any high/critical advisory (stale waivers must be removed);
 *   4. the audit itself could not run (npm error, registry unreachable): the gate fails closed.
 *
 * Usage: node scripts/ci/audit-gate.mjs [--audit-json <file>] [--allowlist <file>] [--today YYYY-MM-DD]
 *   --audit-json reads a saved `npm audit --json` report instead of running npm (fixtures, tests/ci/).
 * Exit 0 = pass, 1 = policy violation, 2 = usage or input error. Prints advisory ids and package names only.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GATED = new Set(["high", "critical"]);
const MAX_WAIVER_DAYS = 90;
const REQUIRED = ["id", "package", "severity", "reason", "owner", "ruling", "expires"];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function fail(code, message) {
  console.error(`audit-gate: ${message}`);
  process.exit(code);
}

function readAudit(file) {
  let raw;
  if (file) {
    raw = readFileSync(resolve(file), "utf8");
  } else {
    // npm audit exits non-zero whenever it finds anything, so the exit code is not the signal; the JSON is.
    const r = spawnSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    raw = r.stdout;
    if (!raw) fail(2, `npm audit produced no output (exit ${r.status}); failing closed`);
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    fail(2, "npm audit output is not JSON; failing closed");
  }
  if (json.error) fail(2, `npm audit reported an error (${json.error.code ?? "unknown"}); failing closed`);
  if (!json.vulnerabilities || typeof json.vulnerabilities !== "object") {
    fail(2, "npm audit JSON has no `vulnerabilities` object (expected auditReportVersion 2); failing closed");
  }
  return json;
}

/** Every advisory object in the report (each `via` entry that is an object, not a package-name string). */
function advisories(audit) {
  const out = new Map();
  for (const vuln of Object.values(audit.vulnerabilities)) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== "object" || via === null) continue;
      const id = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(via.url ?? "")?.[0] ?? `npm-${via.source}`;
      const key = `${id}|${via.name}`;
      if (!out.has(key)) out.set(key, { id, package: via.name, severity: via.severity, title: via.title ?? "" });
    }
  }
  return [...out.values()];
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A waiver covers an advisory only at the severity it was reviewed at (AR-L3). */
const covers = (entry, a) => entry?.id === a.id && entry?.package === a.package && entry?.severity === a.severity;
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

function evaluate(audit, allowlist, today) {
  const problems = [];
  if (!Array.isArray(allowlist)) return { problems: ["allowlist must be a JSON array"], gated: [] };
  const todayMs = Date.parse(today);
  const gated = advisories(audit).filter((a) => GATED.has(a.severity));

  allowlist.forEach((entry, i) => {
    const label = `allowlist[${i}] ${entry?.id ?? "?"} (${entry?.package ?? "?"})`;
    const missing = REQUIRED.filter((k) => typeof entry?.[k] !== "string" || entry[k].trim() === "");
    if (missing.length) problems.push(`${label}: missing field(s) ${missing.join(", ")}`);
    if (entry?.severity && !GATED.has(entry.severity)) problems.push(`${label}: severity must be high or critical`);
    if (!isDate(entry?.expires)) {
      problems.push(`${label}: expires must be YYYY-MM-DD`);
    } else {
      const exp = Date.parse(entry.expires);
      if (exp < todayMs) problems.push(`${label}: waiver EXPIRED on ${entry.expires} (renew with a reviewed PR or fix)`);
      if (exp - todayMs > MAX_WAIVER_DAYS * DAY_MS) {
        problems.push(`${label}: expires ${entry.expires} is more than ${MAX_WAIVER_DAYS} days ahead`);
      }
    }
    const sameAdvisory = gated.filter((a) => a.id === entry?.id && a.package === entry?.package);
    const rerated = sameAdvisory.find((a) => a.severity !== entry?.severity);
    if (rerated) {
      problems.push(`${label}: advisory RE-RATED from ${entry?.severity} to ${rerated.severity}; the waiver no longer applies (re-review)`);
    } else if (sameAdvisory.length === 0) {
      problems.push(`${label}: STALE waiver, matches no high/critical advisory any more (remove it)`);
    }
  });

  for (const a of gated) {
    if (!allowlist.some((e) => covers(e, a))) {
      problems.push(`NOT ALLOWLISTED: ${a.severity} ${a.id} in ${a.package}${a.title ? ` (${a.title})` : ""}`);
    }
  }
  return { problems, gated };
}

function main() {
  const allowlistFile = resolve(arg("--allowlist") ?? ".github/audit-allowlist.json");
  const today = arg("--today") ?? new Date().toISOString().slice(0, 10);
  if (!isDate(today)) fail(2, "--today must be YYYY-MM-DD");
  let allowlist;
  try {
    allowlist = JSON.parse(readFileSync(allowlistFile, "utf8"));
  } catch {
    fail(2, `cannot read allowlist ${allowlistFile}`);
  }
  const audit = readAudit(arg("--audit-json"));
  const { problems, gated } = evaluate(audit, allowlist, today);
  console.log(
    `audit-gate: ${gated.length} high/critical advisor${gated.length === 1 ? "y" : "ies"} (production deps), ` +
      `${Array.isArray(allowlist) ? allowlist.length : 0} waiver(s), today ${today}`,
  );
  for (const a of gated) console.log(`  ${a.severity.padEnd(8)} ${a.id} ${a.package}`);
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    process.exit(1);
  }
  console.log("audit-gate: PASS");
}

main();
