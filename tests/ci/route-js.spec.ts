/**
 * Route-JS report (V2-06 06-07 steps 1-2; P2-02, PWA_STRATEGY §3.9; scripts/ci/route-js.mjs). Runs the script the way
 * the CI `build` job does, on the `.next`-shaped fixture in lint-fixtures/route-js/build (gzip -9 sizes listed in its
 * README): framework root counted once, per-route totals, budgets from a file, report-only exit 0, `--enforce` exit 1,
 * a missing or unreadable build input exit 2 naming the file.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { measureRouteJs } from "../../scripts/ci/route-js.mjs";
import { routeJs as m0RouteJs } from "../../scripts/m0-baseline-report.mjs";
import { ROOT, runNodeChecker } from "./run-checker";

const FIXTURE = path.join(ROOT, "lint-fixtures/route-js/build");
const BUDGETS = path.join(ROOT, "lint-fixtures/route-js/budgets.json");
const GZ = {
  rootFramework: 2237,
  rootRuntime: 801,
  layout: 898,
  shared: 1135,
  today: 1020,
  login: 2835,
  consult: 1586,
};
const ROOT_BYTES = GZ.rootFramework + GZ.rootRuntime;

interface RouteRow {
  route: string;
  totalGzipBytes: number;
  routeSpecificGzipBytes: number;
  files: number;
  budgetKb: number;
  status: "ok" | "over";
}
interface Report {
  method: string;
  frameworkRoot: { files: string[]; gzipBytes: number };
  routes: RouteRow[];
}

const tmpDir = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

function run(next: string, ...extra: string[]) {
  const out = tmpDir("route-js-out-");
  const r = runNodeChecker("route-js.mjs", ["--next", next, "--budgets", BUDGETS, "--out", out, ...extra]);
  const jsonFile = path.join(out, "route-js.json");
  const report = fs.existsSync(jsonFile) ? (JSON.parse(fs.readFileSync(jsonFile, "utf8")) as Report) : null;
  const md = fs.existsSync(path.join(out, "route-js.md")) ? fs.readFileSync(path.join(out, "route-js.md"), "utf8") : null;
  return { ...r, report, md };
}

/** A writable copy of the fixture build, for the broken-build cases. */
function fixtureCopy(): string {
  const dir = path.join(tmpDir("route-js-build-"), "build");
  fs.cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

describe("route-js report", () => {
  it("counts the framework root once and adds each route's entry files (gzip -9 of the fixture's chunks)", () => {
    const r = run(FIXTURE);
    expect(r.status).toBe(0);
    const report = r.report!;
    expect(report.frameworkRoot).toEqual({
      files: ["static/chunks/root-framework.js", "static/chunks/root-runtime.js"],
      gzipBytes: ROOT_BYTES,
    });
    const byRoute = Object.fromEntries(report.routes.map((row) => [row.route, row]));
    // /_not-found is excluded by the budgets file; route groups are dropped from the route name.
    expect(Object.keys(byRoute)).toEqual(["/", "/consultation/[id]", "/login"]);
    // root-runtime.js and layout.js are listed in several entries of `/`: each is counted once.
    expect(byRoute["/"]).toMatchObject({
      totalGzipBytes: ROOT_BYTES + GZ.layout + GZ.shared + GZ.today,
      routeSpecificGzipBytes: GZ.layout + GZ.shared + GZ.today,
      files: 5,
    });
    expect(byRoute["/login"]).toMatchObject({
      totalGzipBytes: ROOT_BYTES + GZ.layout + GZ.login,
      routeSpecificGzipBytes: GZ.layout + GZ.login,
      files: 4,
    });
    expect(byRoute["/consultation/[id]"]).toMatchObject({
      totalGzipBytes: ROOT_BYTES + GZ.layout + GZ.shared + GZ.consult,
      files: 5,
    });
  });

  it("marks a route over its budget as `over` and still exits 0 (report-only)", () => {
    const r = run(FIXTURE);
    expect(r.status).toBe(0);
    const statuses = Object.fromEntries(r.report!.routes.map((row) => [row.route, [row.budgetKb, row.status]]));
    expect(statuses).toEqual({
      "/": [6, "ok"], // 6091 B ≤ 6 kB
      "/login": [6, "over"], // 6771 B > 6 kB
      "/consultation/[id]": [7, "ok"], // per-route override
    });
    expect(r.stdout).toContain("route-js: 3 route(s), 1 over budget (report-only)");
    expect(r.md).toContain("not comparable 1:1 with the M0 webpack numbers");
    expect(r.md).toContain("| `/login` | 6.6 | 3.6 | 4 | 6 | over |");
  });

  it("--enforce exits 1 naming the route over budget", () => {
    const r = run(FIXTURE, "--enforce");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("route-js: OVER /login 6.6 kB > 6 kB");
  });

  it("--summary appends the markdown table to the given file (the CI job summary)", () => {
    const summary = path.join(tmpDir("route-js-summary-"), "summary.md");
    fs.writeFileSync(summary, "existing line\n");
    const r = run(FIXTURE, "--summary", summary);
    expect(r.status).toBe(0);
    const text = fs.readFileSync(summary, "utf8");
    expect(text.startsWith("existing line\n### Route JS")).toBe(true);
    expect(text).toContain("| `/` | 5.9 |");
  });

  it("a missing build-manifest.json exits 2 naming the file", () => {
    const build = fixtureCopy();
    fs.rmSync(path.join(build, "build-manifest.json"));
    const r = run(build);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`route-js: missing ${path.join(build, "build-manifest.json")}`);
    expect(r.report).toBeNull();
  });

  it("a chunk named by a manifest but absent from the build exits 2 instead of counting it as 0", () => {
    const build = fixtureCopy();
    fs.rmSync(path.join(build, "static/chunks/consult.js"));
    const r = run(build);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`route-js: missing ${path.join(build, "static/chunks/consult.js")}`);
  });

  it("evaluates a client-reference manifest without Node globals: a script that reaches for `process` exits 2", () => {
    const build = fixtureCopy();
    const file = path.join(build, "server/app/(auth)/login/page_client-reference-manifest.js");
    fs.writeFileSync(file, `process.exit(0);\n${fs.readFileSync(file, "utf8")}`);
    const r = run(build);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`route-js: cannot read ${file}: process is not defined`);
  });

  it("the repository budgets are PWA_STRATEGY §3.9: 200 kB Today and Consult, 150 kB every other route", () => {
    const report = measureRouteJs(FIXTURE) as Report;
    const budgets = Object.fromEntries(report.routes.map((row) => [row.route, row.budgetKb]));
    expect(budgets).toEqual({ "/": 200, "/consultation/[id]": 200, "/login": 150 });
  });
});

describe("M0 baseline report: route JS on a Turbopack build", () => {
  it("returns available: true with every app route, read through the route-JS manifests", () => {
    const js = m0RouteJs(FIXTURE) as { available: boolean; routes: RouteRow[]; frameworkRoot: Report["frameworkRoot"] };
    expect(js.available).toBe(true);
    expect(js.frameworkRoot.gzipBytes).toBe(ROOT_BYTES);
    expect(js.routes.map((row) => [row.route, row.totalGzipBytes])).toEqual([
      ["/", ROOT_BYTES + GZ.layout + GZ.shared + GZ.today],
      ["/consultation/[id]", ROOT_BYTES + GZ.layout + GZ.shared + GZ.consult],
      ["/login", ROOT_BYTES + GZ.layout + GZ.login],
    ]);
  });

  it("returns available: false with the missing file when the build is absent", () => {
    const missing = path.join(tmpDir("route-js-none-"), "next");
    const js = m0RouteJs(missing) as { available: boolean; reason: string; routes: RouteRow[] };
    expect(js).toEqual({
      available: false,
      reason: expect.stringContaining(`missing ${path.join(missing, "build-manifest.json")}`),
      routes: [],
    });
  });
});
