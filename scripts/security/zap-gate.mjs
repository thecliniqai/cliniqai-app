#!/usr/bin/env node
/**
 * ZAP baseline gate (V2-14 14-02, SVP §7; plan D-1). No dependency beyond Node; reads one file.
 *
 * Input: the traditional JSON report of `zap-baseline.py -J` (scripts/security/zap-local.mjs). Fails (exit 1) on any
 * alert with risk High (riskcode 3) unless ZAP itself rated it a false positive (confidence 0). Medium, Low and
 * Informational alerts are listed and triaged in 14-TRIAGE.md, never blocking here. Fails closed (exit 2) on a missing or
 * malformed report, or one with no scanned site (the scan did not reach the server).
 *
 * Usage: node scripts/security/zap-gate.mjs <zap-report.json> [--summary <file>]
 * Prints alert names, plugin ids, counts and URL paths (the scan is signed out on synthetic data; no query strings).
 */
import { appendFileSync, readFileSync } from "node:fs";

const RISK = { 0: "Informational", 1: "Low", 2: "Medium", 3: "High" };

function fail(code, message) {
  console.error(`zap-gate: ${message}`);
  process.exit(code);
}

function pathOf(uri) {
  try {
    return new URL(uri).pathname;
  } catch {
    return "?";
  }
}

function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) fail(2, "usage: zap-gate.mjs <zap-report.json> [--summary <file>]");
  let report;
  try {
    report = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    fail(2, `cannot read the ZAP report ${file}; failing closed`);
  }
  const sites = Array.isArray(report?.site) ? report.site : null;
  if (!sites || sites.length === 0) fail(2, "the report names no scanned site (the scan never reached the server); failing closed");

  const alerts = [];
  for (const site of sites) {
    for (const a of site?.alerts ?? []) {
      const risk = Number(a?.riskcode);
      if (!Number.isInteger(risk) || !(risk in RISK)) fail(2, `alert ${a?.pluginid ?? "?"} has no valid riskcode; failing closed`);
      const instances = Array.isArray(a?.instances) ? a.instances : [];
      alerts.push({
        plugin: String(a?.pluginid ?? "?"),
        name: String(a?.name ?? a?.alert ?? "?"),
        risk,
        falsePositive: String(a?.confidence) === "0",
        count: Number(a?.count ?? instances.length) || instances.length,
        paths: [...new Set(instances.map((i) => pathOf(i?.uri)))].slice(0, 5),
      });
    }
  }
  alerts.sort((x, y) => y.risk - x.risk || x.plugin.localeCompare(y.plugin));
  const blocking = alerts.filter((a) => a.risk === 3 && !a.falsePositive);

  console.log(`zap-gate: ${sites.length} site(s), ${alerts.length} alert type(s), ${blocking.length} blocking (High)`);
  for (const a of alerts) {
    console.log(`  ${RISK[a.risk].padEnd(13)} ${a.plugin.padEnd(6)} ${a.name} (${a.count}) ${a.paths.join(" ")}${a.falsePositive ? " [false positive]" : ""}`);
  }
  const summaryIndex = process.argv.indexOf("--summary");
  if (summaryIndex > -1 && process.argv[summaryIndex + 1]) {
    const lines = ["### ZAP baseline (local e2e server, signed out)", "", "| Risk | Plugin | Alert | Count | Paths |", "|---|---|---|---|---|"];
    for (const a of alerts) lines.push(`| ${RISK[a.risk]} | ${a.plugin} | ${a.name} | ${a.count} | ${a.paths.join(" ")} |`);
    appendFileSync(process.argv[summaryIndex + 1], `${lines.join("\n")}\n\n`);
  }
  if (blocking.length) {
    for (const a of blocking) console.error(`FAIL High ${a.plugin} ${a.name} at ${a.paths.join(" ")}`);
    process.exit(1);
  }
  console.log("zap-gate: PASS (no High)");
}

main();
