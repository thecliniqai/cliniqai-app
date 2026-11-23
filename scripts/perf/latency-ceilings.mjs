#!/usr/bin/env node
/**
 * V2-09e 09E-01 (R-2): writes the blocking ceilings of the latency lane from a lane summary, so no number is typed by hand.
 *
 *   node scripts/perf/latency-ceilings.mjs <summary.json> [--write] [--allow-raise]
 *
 * For every row of the summary (a `perf:latency` run at 300 ms): maxCalls = the largest call count of any of its samples, maxDepth = the
 * largest depth, `source` = the summary file and the row id they came from. Without --write it prints what it would change. A new ceiling
 * HIGHER than the one in the file is refused (a raise is a PO question: plan 09E, "Ceilings may be lowered within a plan; raising one is a PO
 * question"); --allow-raise is only for the first baseline of a row that had no ceiling.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const args = process.argv.slice(2);
const summaryArg = args.find((a) => !a.startsWith("--"));
if (!summaryArg) {
  console.error("usage: latency-ceilings.mjs <summary.json> [--write] [--allow-raise]");
  process.exit(2);
}
const write = args.includes("--write");
const allowRaise = args.includes("--allow-raise");
const target = path.join(root, "tests/e2e/perf/latency-ceilings.json");
const summaryPath = path.resolve(summaryArg);
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
if (!(summary.latencyMs > 0)) {
  console.error(`latency-ceilings: ${summaryArg} is a reference run (${summary.latencyMs} ms): ceilings come from a run with latency injected`);
  process.exit(1);
}
const source = path.relative(root, summaryPath).split(path.sep).join("/");
const current = JSON.parse(fs.readFileSync(target, "utf8"));
const next = { baselineSource: source, latencyMs: summary.latencyMs, rows: {} };
const problems = [];
for (const row of summary.rows) {
  const maxCalls = Math.max(...row.samples.map((s) => s.calls));
  const maxDepth = Math.max(...row.samples.map((s) => s.depth ?? 0));
  const before = current.rows[row.id];
  if (before && !allowRaise && (maxCalls > before.maxCalls || maxDepth > before.maxDepth)) {
    problems.push(`${row.id}: calls ${before.maxCalls} -> ${maxCalls}, depth ${before.maxDepth} -> ${maxDepth} (a raise)`);
    continue;
  }
  next.rows[row.id] = { maxCalls, maxDepth, source: `${source}#${row.id}` };
}
if (problems.length) {
  console.error(`latency-ceilings: refused, a ceiling would rise:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
const sorted = Object.fromEntries(Object.entries(next.rows).sort(([a], [b]) => a.localeCompare(b)));
const out = `${JSON.stringify({ ...next, rows: sorted }, null, 2)}\n`;
if (write) {
  fs.writeFileSync(target, out);
  console.log(`latency-ceilings: wrote ${Object.keys(sorted).length} rows to ${path.relative(root, target)} from ${source}`);
} else {
  console.log(out);
}
