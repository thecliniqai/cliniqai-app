#!/usr/bin/env node
/**
 * OSV-Scanner gate (V2-14 14-02, SVP §3). No dependency beyond Node; reads files only (no network).
 *
 * Input: the JSON report of `osv-scanner scan source --lockfile package-lock.json --format json` and package-lock.json.
 * Fails (exit 1) when
 *   1. a PRODUCTION dependency (a package-lock entry without `dev`/`devOptional`, the scope of `npm audit --omit=dev`)
 *      has a high or critical advisory with a fixed version published, and the advisory is not waived in
 *      .github/audit-allowlist.json (the npm audit gate's expiring allowlist: same id + package + severity; that gate
 *      owns expiry and staleness, so an expired waiver already fails the job there);
 *   2. any package, production or dev, matches a `MAL-` (malicious package) entry;
 *   3. the report is missing or not an OSV-Scanner JSON report (fail closed).
 * Development-only findings and findings with no fix yet are listed (report only): dev tools run in CI, never in the
 * shipped app; an advisory without a fix has no action but a waiver, and is triaged in 14-TRIAGE.md.
 *
 * Severity: the GitHub-reviewed rating (`database_specific.severity`) when present, else the group's highest CVSS base
 * score (>= 9 critical, >= 7 high). An advisory with neither counts as high (fail closed).
 *
 * Usage: node scripts/ci/osv-gate.mjs --report osv.json [--lockfile package-lock.json] [--allowlist <file>]
 *        [--summary <file>]   (appends a markdown table, e.g. $GITHUB_STEP_SUMMARY)
 * Exit 0 = pass, 1 = policy violation, 2 = usage or input error. Prints advisory ids and package names only.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function fail(code, message) {
  console.error(`osv-gate: ${message}`);
  process.exit(code);
}

function readJson(file, what) {
  try {
    return JSON.parse(readFileSync(resolve(file), "utf8"));
  } catch {
    return fail(2, `cannot read ${what} ${file}; failing closed`);
  }
}

const RANK = { low: 1, moderate: 2, medium: 2, high: 3, critical: 4 };

function severityOf(vuln, groupMax) {
  const rated = String(vuln?.database_specific?.severity ?? "").toLowerCase();
  if (RANK[rated]) return rated === "medium" ? "moderate" : rated;
  const score = Number.parseFloat(groupMax);
  if (Number.isFinite(score)) return score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "moderate" : "low";
  return "high";
}

function hasFix(vuln) {
  return (vuln?.affected ?? []).some((a) => (a?.ranges ?? []).some((r) => (r?.events ?? []).some((e) => typeof e?.fixed === "string")));
}

/** name@version → true when every package-lock entry of that name and version is development-only. */
function devOnlyIndex(lock) {
  const index = new Map();
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    if (!key.includes("node_modules/")) continue;
    const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    const id = `${name}@${entry?.version}`;
    const dev = entry?.dev === true || entry?.devOptional === true;
    index.set(id, (index.get(id) ?? true) && dev);
  }
  return index;
}

function main() {
  const reportFile = arg("--report");
  if (!reportFile) fail(2, "--report <osv.json> is required");
  const report = readJson(reportFile, "report");
  const lock = readJson(arg("--lockfile") ?? "package-lock.json", "lockfile");
  const allowlist = readJson(arg("--allowlist") ?? ".github/audit-allowlist.json", "allowlist");
  if (!report || !Array.isArray(report.results)) fail(2, "the report has no `results` array (not an OSV-Scanner JSON report)");
  if (!Array.isArray(allowlist)) fail(2, "the allowlist must be a JSON array");

  const devOnly = devOnlyIndex(lock);
  const findings = [];
  for (const result of report.results) {
    for (const pkg of result?.packages ?? []) {
      const name = pkg?.package?.name;
      const version = pkg?.package?.version;
      const vulns = new Map((pkg?.vulnerabilities ?? []).map((v) => [v.id, v]));
      for (const group of pkg?.groups ?? []) {
        const ids = group?.ids ?? [];
        const vuln = ids.map((id) => vulns.get(id)).find(Boolean);
        const id = ids.find((x) => /^GHSA-/.test(x)) ?? ids[0];
        if (!id) continue;
        findings.push({
          id,
          ids,
          name,
          version,
          severity: severityOf(vuln, group?.max_severity),
          fix: hasFix(vuln),
          dev: devOnly.get(`${name}@${version}`) ?? false,
          malicious: ids.some((x) => /^MAL-/.test(x)),
        });
      }
    }
  }

  const waived = (f) => allowlist.some((e) => e?.id === f.id && e?.package === f.name && e?.severity === f.severity);
  const problems = [];
  const rows = [];
  for (const f of findings) {
    const gatedSeverity = RANK[f.severity] >= RANK.high;
    let status;
    if (f.malicious) status = "FAIL (malicious package)";
    else if (!gatedSeverity) status = "report";
    else if (f.dev) status = "report (dev only)";
    else if (!f.fix) status = "report (no fix yet)";
    else if (waived(f)) status = "waived";
    else status = "FAIL";
    if (status.startsWith("FAIL")) problems.push(`${f.malicious ? "malicious package: " : ""}${f.severity} ${f.id} in ${f.name}@${f.version}`);
    rows.push({ ...f, status });
  }

  const order = (r) => (r.status.startsWith("FAIL") ? 0 : 1) * 10 - RANK[r.severity];
  rows.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  console.log(`osv-gate: ${findings.length} finding(s); ${problems.length} blocking`);
  for (const r of rows) console.log(`  ${r.severity.padEnd(8)} ${r.id.padEnd(20)} ${r.name}@${r.version}  ${r.status}`);

  const summary = arg("--summary");
  if (summary) {
    const lines = ["### OSV-Scanner (package-lock.json)", "", "| Severity | Advisory | Package | Scope | Fix | Status |", "|---|---|---|---|---|---|"];
    for (const r of rows) lines.push(`| ${r.severity} | ${r.id} | ${r.name}@${r.version} | ${r.dev ? "dev" : "prod"} | ${r.fix ? "yes" : "no"} | ${r.status} |`);
    appendFileSync(summary, `${lines.join("\n")}\n\n`);
  }

  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    process.exit(1);
  }
  console.log("osv-gate: PASS");
}

main();
