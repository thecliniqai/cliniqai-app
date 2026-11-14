#!/usr/bin/env node
/**
 * First-load JS per app route from a Next 16 Turbopack build (V2-06 06-07; P2-02, PWA_STRATEGY §3.9; rulings R-5).
 *
 * Next 16 prints no Size / First Load JS column and Turbopack writes no `app-build-manifest.json`, so this reads the
 * manifests the build does write:
 *   - framework root = `rootMainFiles` of `<next>/build-manifest.json` (loaded on every app route);
 *   - per app route  = root ∪ every `entryJSFiles` list of the route's
 *     `<next>/server/app/<segments>/page_client-reference-manifest.js` (root layout, nested layouts, the page, the
 *     built-in error boundaries). That file is a script assigning `globalThis.__RSC_MANIFEST[...]`; it is evaluated in
 *     a `node:vm` sandbox with a fresh `__RSC_MANIFEST` object and no `require`, `process` or module scope.
 * Each distinct file is counted once; its size is gzip level 9 of the bytes under `<next>/`.
 *
 * Budgets come from `scripts/ci/route-js-budgets.json` (kB = 1024 bytes, gzip -9). Report-only: exit 0 whatever the
 * sizes. `--enforce` (for V2-15) exits 1 if any route is `over`. Exit 2 if a manifest or a referenced chunk is missing,
 * naming the file (a broken build never reports as small).
 *
 * Usage: node scripts/ci/route-js.mjs [--next <dir>] [--budgets <file>] [--out <dir>] [--summary <file>] [--enforce]
 *   --out      writes <dir>/route-js.json and <dir>/route-js.md
 *   --summary  appends the markdown table to <file> (CI: "$GITHUB_STEP_SUMMARY")
 *
 * Plain Node, no dependency; reads only files under the build directory and the budgets file.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_BUDGETS = path.join(ROOT, "scripts/ci/route-js-budgets.json");
export const METHOD =
  "Turbopack manifests (build-manifest.json rootMainFiles ∪ each page_client-reference-manifest.js entryJSFiles), " +
  "gzip -9 per distinct file, kB = 1024 bytes; not comparable 1:1 with the M0 webpack numbers " +
  "(app-build-manifest.json page + enclosing layouts)";

/** A manifest or chunk the build should have written is missing or unreadable (exit 2). */
export class BuildInputError extends Error {
  constructor(file, problem = "missing") {
    super(
      problem === "missing"
        ? `route-js: missing ${file} (run \`npm run build\` or \`npm run e2e:build\` first)`
        : `route-js: cannot read ${file}: ${problem}`,
    );
    this.file = file;
  }
}

/** `/(dashboard)/consultation/[id]/page` → `/consultation/[id]`; route groups and parallel slots dropped. */
export function routeOf(manifestKey) {
  const segments = manifestKey.split("/").filter(Boolean);
  if (segments.at(-1) === "page") segments.pop();
  const visible = segments.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@"));
  return `/${visible.join("/")}`;
}

function listClientManifests(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listClientManifests(abs));
    else if (entry.name === "page_client-reference-manifest.js") found.push(abs);
  }
  return found;
}

/** Evaluates one client-reference manifest script in an empty sandbox and returns its `__RSC_MANIFEST` entries. */
export function readClientManifest(file) {
  const sandbox = { __RSC_MANIFEST: {} };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  try {
    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file, timeout: 1000 });
  } catch (err) {
    throw new BuildInputError(file, String(err?.message ?? err)); // vm errors come from another realm
  }
  return sandbox.__RSC_MANIFEST;
}

function loadBudgets(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    defaultKb: raw.defaultKb,
    routes: raw.routes ?? {},
    exclude: new Set(raw.exclude ?? []),
  };
}

/**
 * Measures every app route of the build at `nextDir`. Throws {@link BuildInputError} when `build-manifest.json`,
 * every client-reference manifest, or a referenced chunk is missing, or a manifest does not evaluate.
 */
export function measureRouteJs(nextDir, { budgetsFile = DEFAULT_BUDGETS } = {}) {
  const buildManifestFile = path.join(nextDir, "build-manifest.json");
  if (!fs.existsSync(buildManifestFile)) throw new BuildInputError(buildManifestFile);
  const rootFiles = JSON.parse(fs.readFileSync(buildManifestFile, "utf8")).rootMainFiles ?? [];

  const appDir = path.join(nextDir, "server/app");
  const manifests = listClientManifests(appDir);
  if (manifests.length === 0) throw new BuildInputError(path.join(appDir, "**/page_client-reference-manifest.js"));

  const gzipCache = new Map();
  const gz = (rel) => {
    if (!gzipCache.has(rel)) {
      const abs = path.join(nextDir, rel);
      if (!fs.existsSync(abs)) throw new BuildInputError(abs);
      gzipCache.set(rel, zlib.gzipSync(fs.readFileSync(abs), { level: 9 }).length);
    }
    return gzipCache.get(rel);
  };
  const sum = (files) => [...files].reduce((total, f) => total + gz(f), 0);

  const budgets = loadBudgets(budgetsFile);
  const rootSet = new Set(rootFiles.filter((f) => f.endsWith(".js")));
  const rootGzipBytes = sum(rootSet);

  const routes = [];
  for (const file of manifests) {
    for (const [key, manifest] of Object.entries(readClientManifest(file))) {
      const route = routeOf(key);
      if (budgets.exclude.has(route) || route.startsWith("/api/")) continue;
      const files = new Set(rootSet);
      for (const list of Object.values(manifest.entryJSFiles ?? {})) for (const f of list) if (f.endsWith(".js")) files.add(f);
      const totalGzipBytes = sum(files);
      const budgetKb = budgets.routes[route] ?? budgets.defaultKb;
      routes.push({
        route,
        entry: key,
        totalGzipBytes,
        routeSpecificGzipBytes: totalGzipBytes - rootGzipBytes,
        files: files.size,
        budgetKb,
        status: totalGzipBytes > budgetKb * 1024 ? "over" : "ok",
      });
    }
  }
  routes.sort((a, b) => a.route.localeCompare(b.route));
  return {
    method: METHOD,
    budgetsFile: path.relative(ROOT, budgetsFile) || budgetsFile,
    frameworkRoot: { files: [...rootSet], gzipBytes: rootGzipBytes },
    routes,
  };
}

const kb = (bytes) => (bytes / 1024).toFixed(1);

export function toMarkdown(report) {
  const over = report.routes.filter((r) => r.status === "over").length;
  const lines = [
    "### Route JS (first load, gzip -9; report-only)",
    "",
    `Method: ${report.method}. Budgets: \`${report.budgetsFile}\` (PWA_STRATEGY §3.9; blocking from V2-15).`,
    "",
    `Framework root (\`rootMainFiles\`, every route): **${kb(report.frameworkRoot.gzipBytes)} kB** in ${report.frameworkRoot.files.length} file(s). Routes over budget: **${over}** of ${report.routes.length}.`,
    "",
    "| Route | Total (kB gz) | Route-specific (kB gz) | Files | Budget (kB) | Status |",
    "|---|---|---|---|---|---|",
    ...report.routes.map(
      (r) =>
        `| \`${r.route}\` | ${kb(r.totalGzipBytes)} | ${kb(r.routeSpecificGzipBytes)} | ${r.files} | ${r.budgetKb} | ${r.status} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = { next: path.join(ROOT, ".next"), budgets: DEFAULT_BUDGETS, out: null, summary: null, enforce: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--next") args.next = path.resolve(argv[++i]);
    else if (a === "--budgets") args.budgets = path.resolve(argv[++i]);
    else if (a === "--out") args.out = path.resolve(argv[++i]);
    else if (a === "--summary") args.summary = path.resolve(argv[++i]);
    else if (a === "--enforce") args.enforce = true;
    else throw new Error(`route-js: unknown argument ${a}`);
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  let report;
  try {
    report = measureRouteJs(args.next, { budgetsFile: args.budgets });
  } catch (err) {
    if (err instanceof BuildInputError) {
      console.error(err.message);
      return 2;
    }
    throw err;
  }
  const md = toMarkdown(report);
  if (args.out) {
    fs.mkdirSync(args.out, { recursive: true });
    fs.writeFileSync(path.join(args.out, "route-js.json"), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(args.out, "route-js.md"), md);
  }
  if (args.summary) fs.appendFileSync(args.summary, md);

  const over = report.routes.filter((r) => r.status === "over");
  console.log(`route-js: framework root ${kb(report.frameworkRoot.gzipBytes)} kB gz (${report.frameworkRoot.files.length} files)`);
  for (const r of report.routes) {
    console.log(`route-js: ${r.route} ${kb(r.totalGzipBytes)} kB gz (route-specific ${kb(r.routeSpecificGzipBytes)}; budget ${r.budgetKb}) ${r.status}`);
  }
  console.log(`route-js: ${report.routes.length} route(s), ${over.length} over budget${args.enforce ? " (enforced)" : " (report-only)"}`);
  if (args.enforce && over.length > 0) {
    for (const r of over) console.error(`route-js: OVER ${r.route} ${kb(r.totalGzipBytes)} kB > ${r.budgetKb} kB`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
