/**
 * Lighthouse CI, report-only (V2-06 06-07 step 5; PWA-09, PWA_STRATEGY §3.9; ruling R-6; threats T-06-12, T-06-13).
 * Project `perf-lhci` only (`npm run perf:lhci`; nightly job `lhci`), never the PR lane.
 *
 * Runs inside the e2e run, so the guarded server on 127.0.0.1:3100, the run's seeded tenant and the signed-in storage
 * states exist and are torn down as usual. Four routes: Login (signed out), Today `/` and Patients `/patients` (owner),
 * Consult `/consultation/<run visit>` (doctor, as in the M0 baseline). For each group the config is built by
 * scripts/perf/lhci-config.mjs, written under this test's output directory and deleted afterwards; `lhci collect`,
 * `assert` and `upload` run with an explicit minimal environment. Chrome resolves only loopback names, so Turnstile
 * on /login loads nothing (its score is recorded with that note).
 *
 * The test fails only on a tool error or a broken measurement (missing report, a Lighthouse runtime error, a signed-in
 * route that landed elsewhere, a request that left the machine, a session value in a report); never on a score.
 * Output: test-results/lhci/ (scrubbed reports, manifest.json, assertion-results.json, summary.json, summary.md).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "@playwright/test";
import { expect, test } from "../fixtures";
import { E2E_BASE_URL, ROOT } from "../support/app-env";
import { readRunData, storageStatePath, type E2eRole } from "../support/run-data";
import {
  BASE_CONFIG_REL,
  buildLhciConfig,
  cookieHeaderFor,
  readBaseConfig,
  scrubReportDir,
  secretsOf,
  lhciFailureMessage,
  redactToolOutput,
} from "../../../scripts/perf/lhci-config.mjs";

const { isLoopbackHost } = createRequire(__filename)("../../setup/loopback.cjs") as {
  isLoopbackHost: (host: unknown) => boolean;
};

const OUT_DIR = path.join(ROOT, "test-results/lhci");
const LHCI_CLI = path.join(ROOT, "node_modules/@lhci/cli/src/cli.js");
const AUDITS = {
  lcpMs: "largest-contentful-paint",
  tbtMs: "total-blocking-time",
  cls: "cumulative-layout-shift",
} as const;

interface Group {
  name: string;
  role: E2eRole | null;
  paths: string[];
}

interface Lhr {
  requestedUrl: string;
  finalDisplayedUrl: string;
  lighthouseVersion: string;
  runtimeError?: { code: string; message: string };
  runWarnings: string[];
  categories: Record<string, { score: number | null }>;
  audits: Record<string, { numericValue?: number; details?: { items?: Array<Record<string, unknown>> } }>;
}

/** Only what Lighthouse and Chrome need; no Supabase keys, run password, proxies or tokens reach the tools. */
function minimalEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", LANG: "en_US.UTF-8" };
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  if (process.env.CI) env.CI = process.env.CI;
  return env as NodeJS.ProcessEnv;
}

/** Runs `lhci`; its output (returned or thrown) never carries a secret (06-09a C L-3). */
function lhci(args: string[], cwd: string, secrets: readonly string[]): string {
  const r = spawnSync(process.execPath, [LHCI_CLI, ...args], {
    cwd,
    env: minimalEnv(),
    encoding: "utf8",
    timeout: 8 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.error || r.status !== 0) {
    throw new Error(lhciFailureMessage(args[0], r.status, output, [...secrets], r.error?.message ?? null));
  }
  return redactToolOutput(output, [...secrets]);
}

function roleCookieHeader(role: E2eRole): string {
  const state = JSON.parse(fs.readFileSync(storageStatePath(role), "utf8")) as {
    cookies: Array<{ name: string; value: string; domain: string }>;
  };
  const header = cookieHeaderFor(state.cookies, E2E_BASE_URL);
  if (!header) throw new Error(`no cookies for ${E2E_BASE_URL} in the ${role} storage state`);
  return header;
}

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(abs) : [abs];
  });
}

test("Lighthouse CI on Login, Today, Patients and Consult (report-only)", async ({}, testInfo) => {
  test.setTimeout(20 * 60_000);
  const run = readRunData();
  const groups: Group[] = [
    { name: "signed-out", role: null, paths: ["/login"] },
    { name: "owner", role: "owner", paths: ["/", "/patients"] },
    { name: "doctor", role: "doctor", paths: [`/consultation/${run.tenantA.visitId}`] },
  ];
  const expectedPaths = groups.flatMap((g) => g.paths);
  const chromePath = chromium.executablePath();
  const base = readBaseConfig(path.join(ROOT, BASE_CONFIG_REL));
  const workDir = testInfo.outputPath("lhci-work");
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  const secrets: string[] = [];
  let configFile = "";
  try {
    for (const [i, group] of groups.entries()) {
      const cookieHeader = group.role ? roleCookieHeader(group.role) : "";
      secrets.push(...secretsOf(cookieHeader));
      const config = buildLhciConfig({
        urls: group.paths.map((p) => `${E2E_BASE_URL}${p}`),
        chromePath,
        outputDir: OUT_DIR,
        base,
        cookieHeader,
        noSandbox: !!process.env.CI, // GitHub's ubuntu-24.04 runners restrict the user namespaces Chrome's sandbox needs
      });
      configFile = path.join(workDir, `lighthouserc.${group.name}.json`);
      fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
      // The first collect clears .lighthouseci/; the next ones add to it.
      lhci(["collect", `--config=${configFile}`, ...(i > 0 ? ["--additive"] : [])], workDir, secrets);
    }
    // Every assertion is `warn`, so `assert` exits 0 whatever the scores; a non-zero exit is a tool error.
    const assertOutput = lhci(["assert", `--config=${configFile}`], workDir, secrets);
    lhci(["upload", `--config=${configFile}`], workDir, secrets);
    fs.copyFileSync(path.join(workDir, ".lighthouseci/assertion-results.json"), path.join(OUT_DIR, "assertion-results.json"));
    await testInfo.attach("lhci-assert.txt", { body: assertOutput, contentType: "text/plain" });
  } finally {
    // The configs and .lighthouseci/ (unscrubbed results, Lighthouse's flags files) hold the Cookie header.
    fs.rmSync(workDir, { recursive: true, force: true });
    if (fs.existsSync(OUT_DIR)) scrubReportDir(OUT_DIR, secrets);
  }

  // No session value survives anywhere in the published output.
  const files = listFiles(OUT_DIR);
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const secret of secrets) expect(text.includes(secret), `session value in ${path.relative(ROOT, file)}`).toBe(false);
    expect(text, `extraHeaders in ${path.relative(ROOT, file)}`).not.toMatch(/"extraHeaders"\s*:/);
  }

  // One report per route, each a real measurement of the requested page.
  const lhrs = files
    .filter((f) => f.endsWith(".report.json"))
    .map((f) => JSON.parse(fs.readFileSync(f, "utf8")) as Lhr);
  expect(lhrs.map((l) => new URL(l.requestedUrl).pathname).sort()).toEqual([...expectedPaths].sort());
  const assertions = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "assertion-results.json"), "utf8")) as Array<{
    url: string;
    auditId: string;
    level: string;
    actual: number;
    expected: number;
  }>;

  const rows = lhrs.map((lhr) => {
    const requested = new URL(lhr.requestedUrl).pathname;
    expect(lhr.runtimeError, `Lighthouse runtime error on ${requested}`).toBeUndefined();
    // A signed-in route that ends on /login measured the login page: the Cookie header did not authenticate.
    expect(new URL(lhr.finalDisplayedUrl).pathname, `final URL of ${requested}`).toBe(requested);
    const requests = (lhr.audits["network-requests"]?.details?.items ?? []) as Array<{ url: string; statusCode: number }>;
    expect(requests.length, `network requests recorded for ${requested}`).toBeGreaterThan(0);
    const offMachine = requests.filter((r) => /^(https?|wss?):/.test(r.url) && !isLoopbackHost(new URL(r.url).hostname));
    // Chrome's resolver maps every other host to NOTFOUND: such a request may be attempted, never answered.
    expect(offMachine.filter((r) => r.statusCode > 0).map((r) => r.url), `answered off-machine requests on ${requested}`).toEqual([]);
    const fonts = (lhr.audits["resource-summary"]?.details?.items ?? []).find((i) => i.resourceType === "font") as
      | { requestCount: number }
      | undefined;
    return {
      // The visit id is per-run seed data; the summary names the route pattern.
      route: pattern(requested),
      role: groups.find((g) => g.paths.includes(requested))!.role ?? "signed out",
      performanceScore: lhr.categories.performance?.score ?? null,
      accessibilityScore: lhr.categories.accessibility?.score ?? null,
      lcpMs: Math.round(lhr.audits[AUDITS.lcpMs]?.numericValue ?? NaN),
      tbtMs: Math.round(lhr.audits[AUDITS.tbtMs]?.numericValue ?? NaN),
      cls: Number((lhr.audits[AUDITS.cls]?.numericValue ?? NaN).toFixed(3)),
      fontFiles: fonts?.requestCount ?? 0,
      blockedOffMachineRequests: offMachine.map((r) => new URL(r.url).host),
      warnings: assertions
        .filter((a) => new URL(a.url).pathname === requested)
        .map((a) => `${a.auditId}: ${a.actual} > ${a.expected}`),
    };
  });
  const order = expectedPaths.map(pattern);
  rows.sort((a, b) => order.indexOf(a.route) - order.indexOf(b.route));

  const summary = {
    tool: `@lhci/cli ${lhciVersion()} / lighthouse ${lhrs[0].lighthouseVersion}`,
    chromium: /chromium[-_][\w-]+/.exec(chromePath)?.[0] ?? "unknown",
    settings: "Lighthouse mobile defaults (simulated slow 4G, 4x CPU), 1 run per route, assertions at warn",
    budgets: "PWA_STRATEGY §3.9: LCP ≤ 2500 ms, TBT ≤ 300 ms, CLS ≤ 0.1, ≤ 2 font files",
    notes: [
      "Chrome runs with --host-resolver-rules mapping every non-loopback host to NOTFOUND: Turnstile on /login loads nothing.",
      "Signed-in routes carry the role's Cookie header (extraHeaders); it is removed from every report before upload.",
    ],
    routes: rows,
  };
  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, "summary.md"), summaryMarkdown(summary));
  await testInfo.attach("lhci-summary.json", { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
});

/** The visit id is per-run seed data; summaries name the route pattern. */
function pattern(p: string): string {
  return p.startsWith("/consultation/") ? "/consultation/[id]" : p;
}

function lhciVersion(): string {
  return (JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/@lhci/cli/package.json"), "utf8")) as { version: string })
    .version;
}

function summaryMarkdown(summary: {
  tool: string;
  settings: string;
  budgets: string;
  notes: string[];
  routes: Array<Record<string, unknown> & { warnings: string[] }>;
}): string {
  const pct = (v: unknown) => (typeof v === "number" ? String(Math.round(v * 100)) : "n/a");
  return [
    "### Lighthouse CI (report-only)",
    "",
    `${summary.tool}. ${summary.settings}. Budgets: ${summary.budgets}.`,
    "",
    "| Route | Role | Perf | A11y | LCP (ms) | TBT (ms) | CLS | Fonts | Warnings |",
    "|---|---|---|---|---|---|---|---|---|",
    ...summary.routes.map(
      (r) =>
        `| \`${r.route}\` | ${r.role} | ${pct(r.performanceScore)} | ${pct(r.accessibilityScore)} | ${r.lcpMs} | ${r.tbtMs} | ${r.cls} | ${r.fontFiles} | ${r.warnings.join("; ") || "none"} |`,
    ),
    "",
    ...summary.notes.map((n) => `- ${n}`),
    "",
  ].join("\n");
}
