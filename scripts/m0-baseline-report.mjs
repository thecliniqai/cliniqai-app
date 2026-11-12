#!/usr/bin/env node
/**
 * M0 baseline report (V2-02 plan 02-03b; FRONTEND_MIGRATION_PLAN M0 "baseline metrics"; roadmap V2-02 evidence
 * "the M0 baseline appendix (screenshots, axe reports, interaction counts)").
 *
 * Compiles the outputs of `npm run e2e:baseline` (the last step of that script) into one committed report. Every number
 * comes from a tool output; nothing is typed by hand:
 *   - interaction counts:  test-results/m0/counts/<flow>.json      (tests/e2e/support/ux-counter.ts, desktop-chrome)
 *   - axe (report-only):   test-results/m0/axe/<project>/<route>.json (tests/e2e/m0/baseline/axe-routes.spec.ts)
 *   - screenshots:         test-results/m0/screenshots/<vp>/*.jpg   (tests/e2e/m0/baseline/screenshots.spec.ts)
 *   - flow outcomes:       playwright-report/results.json           (Playwright JSON reporter)
 *   - route JS:            .next/app-build-manifest.json + .next/static (the guarded `npm run e2e:build` output)
 *
 * Output (default `.planning/phases/02-ci-e2e-foundations/evidence/m0-baseline/`, or `--out <dir>`):
 *   README.md, counts.json, route-js.json, flows.json, axe/<project>.json, screenshots/<vp>/*.jpg
 * `--update-fmp` also fills the "v1 actions / keystrokes" and "v1 time (synthetic)" cells of the
 * docs/v2/FRONTEND_MIGRATION_PLAN.md appendix rows that one measured flow matches exactly (FMP_ROWS below).
 *
 * Plain Node (no dependencies); never starts the app or a test runner; reads no `.env*` file.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const M0 = path.join(ROOT, "test-results/m0");
const DEFAULT_OUT = path.join(ROOT, ".planning/phases/02-ci-e2e-foundations/evidence/m0-baseline");
const FMP = path.join(ROOT, "docs/v2/FRONTEND_MIGRATION_PLAN.md");

/** The six M0 flows, in FRONTEND_MIGRATION_PLAN order. */
const FLOWS = [
  ["register-patient", "Register patient"],
  ["walk-in-token", "Walk-in to token"],
  ["book-appointment", "Book appointment"],
  ["cancel-appointment", "Cancel appointment"],
  ["consult-rx-finish", "Consult → Rx → finish"],
  ["checkout-collect", "Checkout and collect"],
];

/** FMP appendix rows that a measured flow matches exactly (only these cells are filled by --update-fmp). */
const FMP_ROWS = { "Walk-in, existing patient": "walk-in-token" };

const AXE_PROJECTS = ["m0-axe-desktop-chrome", "m0-axe-pixel-7", "m0-axe-iphone-15"];
const VIEWPORTS = ["vp-360", "vp-768", "vp-1280"];

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, updateFmp: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = path.resolve(argv[++i]);
    else if (argv[i] === "--update-fmp") args.updateFmp = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort();
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function packageVersion(name) {
  try {
    return readJson(path.join(ROOT, "node_modules", name, "package.json")).version;
  } catch {
    return "unknown";
  }
}

// --- Interaction counts -------------------------------------------------------------------------------------------
function collectCounts() {
  const dir = path.join(M0, "counts");
  return FLOWS.map(([id, label]) => {
    const file = path.join(dir, `${id}.json`);
    return { id, label, counts: fs.existsSync(file) ? readJson(file) : null };
  });
}

// --- Flow outcomes from the Playwright JSON report -----------------------------------------------------------------
function collectOutcomes() {
  const file = path.join(ROOT, "playwright-report/results.json");
  if (!fs.existsSync(file)) return [];
  const report = readJson(file);
  const rows = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const specFile = (spec.file ?? suite.file ?? "").replace(/\\/g, "/");
      if (!/(^|\/)m0\/[^/]+\.spec\.ts$/.test(specFile)) continue;
      for (const t of spec.tests ?? []) {
        const annotations = [...(t.annotations ?? []), ...(t.results?.at(-1)?.annotations ?? [])];
        const known = annotations.find((a) => a.type === "fail")?.description ?? null;
        rows.push({
          file: specFile,
          title: spec.title,
          project: t.projectName,
          expected: t.expectedStatus,
          outcome: t.status,
          result: t.results?.at(-1)?.status ?? "not run",
          knownBug: known,
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return rows;
}

// --- Route JS from the build manifests ----------------------------------------------------------------------------
function routeJs() {
  const manifestFile = path.join(ROOT, ".next/app-build-manifest.json");
  if (!fs.existsSync(manifestFile)) return { available: false, routes: [] };
  const pages = readJson(manifestFile).pages ?? {};
  const gzipCache = new Map();
  const gz = (rel) => {
    if (!gzipCache.has(rel)) {
      const abs = path.join(ROOT, ".next", rel);
      gzipCache.set(rel, fs.existsSync(abs) ? zlib.gzipSync(fs.readFileSync(abs), { level: 9 }).length : 0);
    }
    return gzipCache.get(rel);
  };
  const routes = [];
  for (const key of Object.keys(pages).sort()) {
    if (!key.endsWith("/page") || key.startsWith("/api/") || key.includes("/_not-found")) continue;
    // First-load JS = the page entry's chunks plus every enclosing layout's chunks (as `next build` reports it).
    const segments = key.split("/").slice(1, -1);
    const entries = ["/layout"];
    for (let i = 1; i <= segments.length; i++) entries.push(`/${segments.slice(0, i).join("/")}/layout`);
    entries.push(key);
    const files = new Set();
    for (const entry of entries) for (const f of pages[entry] ?? []) if (f.endsWith(".js")) files.add(f);
    const pageOnly = (pages[key] ?? []).filter((f) => f.includes("/app/")).reduce((sum, f) => sum + gz(f), 0);
    const route = `/${segments.filter((s) => !/^\(.*\)$/.test(s)).join("/")}`;
    routes.push({
      route,
      entry: key,
      firstLoadGzipBytes: [...files].reduce((sum, f) => sum + gz(f), 0),
      routeChunkGzipBytes: pageOnly,
      chunks: files.size,
    });
  }
  return { available: true, method: "app-build-manifest.json: page + enclosing layouts, gzip -9 per chunk", routes };
}

// --- axe summaries --------------------------------------------------------------------------------------------------
function collectAxe() {
  const out = {};
  for (const project of AXE_PROJECTS) {
    const dir = path.join(M0, "axe", project);
    out[project] = listFiles(dir, ".json").map((f) => readJson(path.join(dir, f)));
  }
  return out;
}

function axeTotals(reports) {
  const byRule = new Map();
  for (const r of reports) {
    for (const v of r.violations) {
      const row = byRule.get(v.id) ?? { id: v.id, impact: v.impact, help: v.help, routes: 0, nodes: 0 };
      row.routes += 1;
      row.nodes += v.nodes;
      byRule.set(v.id, row);
    }
  }
  const rank = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  return [...byRule.values()].sort((a, b) => (rank[a.impact] ?? 9) - (rank[b.impact] ?? 9) || b.routes - a.routes);
}

// --- Screenshots ----------------------------------------------------------------------------------------------------
function copyScreenshots(outDir) {
  const copied = {};
  let bytes = 0;
  for (const vp of VIEWPORTS) {
    const src = path.join(M0, "screenshots", vp);
    const dst = path.join(outDir, "screenshots", vp);
    copied[vp] = [];
    for (const f of listFiles(src, ".jpg")) {
      fs.mkdirSync(dst, { recursive: true });
      fs.copyFileSync(path.join(src, f), path.join(dst, f));
      bytes += fs.statSync(path.join(dst, f)).size;
      copied[vp].push(f);
    }
  }
  return { copied, bytes };
}

// --- FMP appendix -----------------------------------------------------------------------------------------------------
function cellsFor(counts, sha) {
  return {
    actions: `${counts.actions} actions / ${counts.keystrokes} keystrokes (M0 run ${sha.slice(0, 7)})`,
    time: counts.durationMs === null ? "n/a" : `${(counts.durationMs / 1000).toFixed(1)} s (local stack)`,
  };
}

function updateFmp(flows, sha) {
  const text = fs.readFileSync(FMP, "utf8");
  const start = text.indexOf("## Appendix — Baseline measurements");
  if (start < 0) throw new Error("FRONTEND_MIGRATION_PLAN.md: appendix heading not found");
  const head = text.slice(0, start);
  const lines = text.slice(start).split("\n");
  const filled = [];
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split("|");
    if (cells.length < 7) continue;
    const name = cells[1].trim();
    const flowId = FMP_ROWS[name];
    if (!flowId) continue;
    const counts = flows.find((f) => f.id === flowId)?.counts;
    if (!counts) continue;
    const c = cellsFor(counts, sha);
    cells[2] = ` ${c.actions} `;
    cells[3] = ` ${c.time} `;
    lines[i] = cells.join("|");
    filled.push(name);
  }
  fs.writeFileSync(FMP, head + lines.join("\n"));
  return filled;
}

// --- README -----------------------------------------------------------------------------------------------------------
const kb = (bytes) => (bytes / 1024).toFixed(1);

function readme({ meta, flows, outcomes, js, axe, shots }) {
  const L = [];
  L.push("# M0 baseline report (v1)", "");
  L.push(
    "Generated by `scripts/m0-baseline-report.mjs` from the outputs of `npm run e2e:baseline` " +
      "(V2-02 plan 02-03b; FRONTEND_MIGRATION_PLAN M0). Every figure below is tool output. Synthetic data only " +
      "(per-run seeded tenants on the local Supabase stack).",
    "",
  );
  L.push("| Field | Value |", "|---|---|");
  L.push(`| Commit | \`${meta.sha}\`${meta.dirty ? " (working tree had uncommitted changes)" : ""} |`);
  L.push(`| Generated | ${meta.generatedAt} |`);
  L.push(`| Run | ${meta.runUrl ?? "local run (no CI run URL in the environment)"} |`);
  L.push(`| Playwright / Next.js / axe-core | ${meta.playwright} / ${meta.next} / ${meta.axe} |`, "");

  L.push("## 1. Characterisation flows (outcome-asserting specs on v1)", "");
  if (outcomes.length === 0) L.push("_No Playwright JSON report found._", "");
  else {
    L.push("| Spec | Test | Project | Expected | Result | Known v1 bug |", "|---|---|---|---|---|---|");
    for (const o of outcomes)
      L.push(`| \`${path.basename(o.file)}\` | ${o.title} | ${o.project} | ${o.expected} | ${o.outcome} | ${o.knownBug ?? ""} |`);
    L.push("");
  }

  L.push("## 2. Interaction counts (desktop-chrome)", "");
  L.push(
    "Counting rules (tests/e2e/support/ux-counter.ts): click, select and checkbox toggle = 1 action; a field fill = " +
      "1 action plus one keystroke per character; navigation by URL is setup and not counted. Time is wall-clock " +
      "from the first counted action to the asserted visible outcome on the local stack (synthetic).",
    "",
  );
  L.push("| Flow | What was measured | Actions | Keystrokes | Clicks | Fills | Selects | Toggles | Time (s) |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const f of flows) {
    const c = f.counts;
    if (!c) {
      L.push(`| ${f.label} | not measured (no passing desktop-chrome run) | | | | | | | |`);
      continue;
    }
    const t = c.durationMs === null ? "n/a" : (c.durationMs / 1000).toFixed(1);
    L.push(`| ${f.label} | ${c.description} | ${c.actions} | ${c.keystrokes} | ${c.clicks} | ${c.fills} | ${c.selects} | ${c.toggles} | ${t} |`);
  }
  L.push("", "Step-by-step actions per flow: `counts.json`.", "");

  L.push("## 3. Route JS (first load, gzip)", "");
  if (!js.available) L.push("_`.next/app-build-manifest.json` not found: run `npm run e2e:build` first._", "");
  else {
    L.push(`Method: ${js.method}.`, "");
    L.push("| Route | First-load JS (kB gz) | Route chunk (kB gz) | Chunks |", "|---|---|---|---|");
    for (const r of js.routes)
      L.push(`| \`${r.route}\` | ${kb(r.firstLoadGzipBytes)} | ${kb(r.routeChunkGzipBytes)} | ${r.chunks} |`);
    L.push("");
  }

  L.push("## 4. Accessibility (axe, report-only, RL-17)", "");
  L.push("Tags: wcag2a, wcag2aa, wcag21aa, wcag22aa. Per-route detail: `axe/<project>.json`.", "");
  for (const project of AXE_PROJECTS) {
    const reports = axe[project];
    L.push(`### ${project}`, "");
    if (reports.length === 0) {
      L.push("_No axe output._", "");
      continue;
    }
    L.push("| Route | Violated rules | Serious/critical rules | Rule ids |", "|---|---|---|---|");
    for (const r of reports) {
      const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      L.push(`| \`${r.route}\` | ${r.violations.length} | ${serious.length} | ${r.violations.map((v) => v.id).join(", ")} |`);
    }
    L.push("", "| Rule | Impact | Routes | Nodes | Help |", "|---|---|---|---|---|");
    for (const t of axeTotals(reports)) L.push(`| ${t.id} | ${t.impact ?? ""} | ${t.routes} | ${t.nodes} | ${t.help} |`);
    L.push("");
  }

  L.push("## 5. Screenshots (frozen clock 10:00 IST, JPEG q70, full page)", "");
  L.push(`Total size: ${kb(shots.bytes)} kB.`, "");
  for (const vp of VIEWPORTS) {
    const files = shots.copied[vp];
    L.push(`- **${vp}** (${files.length}): ${files.map((f) => `[${f.replace(/\.jpg$/, "")}](screenshots/${vp}/${f})`).join(", ") || "none"}`);
  }
  L.push("");

  L.push("## 6. FRONTEND_MIGRATION_PLAN appendix", "");
  L.push(
    "`--update-fmp` fills the v1 cells only for appendix rows that a measured flow matches exactly: " +
      Object.entries(FMP_ROWS)
        .map(([row, id]) => `"${row}" ← \`${id}\``)
        .join("; ") +
      ". The other appendix rows describe interactions the six M0 flows do not isolate (check-in of a booked " +
      "patient, walk-in with a new patient, booking from the patient profile, reschedule, three Rx lines, a single " +
      "collection); their v1 figures stay with the M4 workstreams that build those screens.",
    "",
  );
  return L.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sha = git(["rev-parse", "HEAD"]) ?? "unknown";
  const dirty = (git(["status", "--porcelain", "--untracked-files=no"]) ?? "") !== "";
  const runUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null;
  const meta = {
    sha,
    dirty,
    runUrl,
    generatedAt: new Date().toISOString(),
    playwright: packageVersion("@playwright/test"),
    next: packageVersion("next"),
    axe: packageVersion("axe-core"),
  };

  const flows = collectCounts();
  const outcomes = collectOutcomes();
  const js = routeJs();
  const axe = collectAxe();

  fs.rmSync(args.out, { recursive: true, force: true });
  fs.mkdirSync(path.join(args.out, "axe"), { recursive: true });
  const shots = copyScreenshots(args.out);

  const write = (rel, data) => fs.writeFileSync(path.join(args.out, rel), `${JSON.stringify(data, null, 2)}\n`);
  write("counts.json", { commit: sha, flows: flows.map((f) => ({ id: f.id, label: f.label, ...(f.counts ?? { measured: false }) })) });
  write("flows.json", { commit: sha, tests: outcomes });
  write("route-js.json", { commit: sha, ...js });
  for (const project of AXE_PROJECTS) write(path.join("axe", `${project}.json`), { commit: sha, project, routes: axe[project] });
  fs.writeFileSync(path.join(args.out, "README.md"), `${readme({ meta, flows, outcomes, js, axe, shots })}\n`);

  const measured = flows.filter((f) => f.counts).length;
  console.log(
    `[m0-baseline] wrote ${args.out.startsWith(ROOT) ? path.relative(ROOT, args.out) : args.out}: ${measured}/${flows.length} flows counted, ` +
      `${outcomes.length} flow test result(s), ${js.routes.length} route(s) sized, ` +
      `${AXE_PROJECTS.map((p) => `${p}=${axe[p].length}`).join(" ")}, ` +
      `${Object.values(shots.copied).flat().length} screenshot(s) (${kb(shots.bytes)} kB)`,
  );
  if (args.updateFmp) {
    const filled = updateFmp(flows, sha);
    console.log(`[m0-baseline] FRONTEND_MIGRATION_PLAN appendix rows filled: ${filled.join(", ") || "none"}`);
  }
  if (measured < flows.length) {
    console.warn("[m0-baseline] WARNING: not every flow has counts (a flow failed or did not run on desktop-chrome)");
  }
}

main();
