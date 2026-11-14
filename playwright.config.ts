import { defineConfig, devices, type Project } from "@playwright/test";
import { assertLocalTestEnv, loadLocalStackKeys, loadTestEnv } from "./tests/setup/test-env";
import { E2E_BASE_URL } from "./tests/e2e/support/app-env";
import { DESIGN_WIDTHS, designProjectName } from "./tests/e2e/design/support/widths";

// V2-01a: the runner (global setup, seeding, specs) uses the same local-only lane as Vitest: `.env.test`, the local
// stack's keys, offline providers; it refuses to load anything else. The app server is separate (V2-02 02-03a,
// RL-16): `tests/e2e/support/serve.ts` starts it with an explicit, guarded env and only from `npm run e2e:build`'s
// output, on 127.0.0.1:3100 (never 3000, where a developer's `next dev` with `.env` may run).
loadTestEnv(__dirname);
loadLocalStackKeys(__dirname);
assertLocalTestEnv();

const setup = { dependencies: ["setup"] };
/** Specs that own their viewport (axe at 360/820/1280) run once, on desktop Chromium. */
const A11Y = /\/a11y\//;
/** M0 baseline-capture specs (02-03b) run only in the baseline lane. */
const BASELINE = /\/m0\/baseline\//;
/** Baseline screenshots: the vp-* projects. Baseline axe report: the m0-axe-* projects (the PR-lane devices). */
const BASELINE_SCREENSHOTS = /\/m0\/baseline\/screenshots\.spec\.ts$/;
const BASELINE_AXE = /\/m0\/baseline\/axe-routes\.spec\.ts$/;
const GOLDEN = /@golden/;
/** V2-06 design lane (06-01a): capture specs run only in the design-* projects, never in the PR/nightly lanes. */
const DESIGN = /\/design\//;
const DESIGN_CAPTURE = /\/design\/(neutral|screens)\//;
/** Keyboard and axe specs under design/ run in the PR lane on desktop-chrome, not in the design-* projects. */
const DESIGN_PR_ONLY = /\/design\/(keyboard\/|.*axe)/;

/** Custom Android tablet (PWA_STRATEGY §9.1): Chromium, Pixel 7 user agent, 800×1280, touch. */
const androidTablet800 = {
  ...devices["Pixel 7"],
  viewport: { width: 800, height: 1280 },
  screen: { width: 800, height: 1280 },
};
/** iPad mini (6th gen) 744×1133, WebKit (the Playwright "iPad Mini" descriptor is 768×1024). */
const ipadMini744 = {
  ...devices["iPad Mini"],
  viewport: { width: 744, height: 1133 },
  screen: { width: 744, height: 1133 },
};

// PR lane (RL-20): desktop-chrome runs everything; pixel-7 everything except the viewport-owning a11y specs (v1
// layout failures only as annotated test.fail()); iphone-15 the @golden paths only.
const prLane: Project[] = [
  { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] }, testIgnore: [BASELINE, DESIGN_CAPTURE], ...setup },
  { name: "pixel-7", use: { ...devices["Pixel 7"] }, testIgnore: [A11Y, BASELINE, DESIGN_CAPTURE], ...setup },
  {
    name: "iphone-15",
    use: { ...devices["iPhone 15"] },
    grep: GOLDEN,
    testIgnore: [A11Y, BASELINE, DESIGN_CAPTURE],
    ...setup,
  },
];

// Nightly lane: the rest of the PWA_STRATEGY §9.1 matrix, smoke + @golden.
const nightly = (name: string, use: Project["use"]): Project => ({
  name,
  use,
  grep: GOLDEN,
  testIgnore: [A11Y, BASELINE, DESIGN_CAPTURE],
  ...setup,
});
const nightlyLane: Project[] = [
  nightly("iphone-se-3", devices["iPhone SE (3rd gen)"]),
  nightly("galaxy-tab-s4", devices["Galaxy Tab S4"]),
  nightly("galaxy-tab-s4-landscape", devices["Galaxy Tab S4 landscape"]),
  nightly("android-tablet-800", androidTablet800),
  nightly("ipad-gen7", devices["iPad (gen 7)"]),
  nightly("ipad-gen7-landscape", devices["iPad (gen 7) landscape"]),
  nightly("ipad-mini-744", ipadMini744),
];

// M0 baseline lane (02-03b, `npm run e2e:baseline`): screenshots at fixed widths (Chromium), the axe report per route
// on the PR-lane devices (FRONTEND_MIGRATION_PLAN M0, erratum 2026-11-10), and the six flows on desktop-chrome for
// the interaction counts.
const baseline = (width: number, height: number): Project => ({
  name: `vp-${width}`,
  use: { ...devices["Desktop Chrome"], viewport: { width, height } },
  testMatch: BASELINE_SCREENSHOTS,
  ...setup,
});
const baselineAxe = (name: string, use: Project["use"]): Project => ({
  name: `m0-axe-${name}`,
  use,
  testMatch: BASELINE_AXE,
  ...setup,
});
const baselineLane: Project[] = [
  baseline(360, 780),
  baseline(768, 1024),
  baseline(1280, 800),
  baselineAxe("desktop-chrome", devices["Desktop Chrome"]),
  baselineAxe("pixel-7", devices["Pixel 7"]),
  baselineAxe("iphone-15", devices["iPhone 15"]),
];

// V2-06 design lane (06-01a, `npm run e2e:design`): Chromium at the four G2-D widths (360/820/1180/1280); runs the
// specs under tests/e2e/design/ except the keyboard and axe specs (PR lane, desktop-chrome).
const designLane: Project[] = DESIGN_WIDTHS.map((w) => ({
  name: designProjectName(w),
  use: { ...devices["Desktop Chrome"], viewport: { width: w.width, height: w.height } },
  testMatch: DESIGN,
  testIgnore: DESIGN_PR_ONLY,
  ...setup,
}));

export default defineConfig({
  testDir: "./tests/e2e",
  // One run lock per local stack (teardown deletes everything the run created): one worker, sequential files.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "playwright-report/results.json" }],
    ["html", { outputFolder: "playwright-report/html", open: "never" }],
  ],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // V2-06 PWA specs opt out explicitly; nothing else may register a service worker.
    serviceWorkers: "block",
  },
  webServer: {
    command: "node --import tsx tests/e2e/support/serve.ts",
    url: `${E2E_BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
  projects: [
    // Signs each seeded role in through the login UI (journey 1) and saves its storage state.
    { name: "setup", testMatch: /auth\.setup\.ts$/, use: { ...devices["Desktop Chrome"] } },
    ...prLane,
    ...nightlyLane,
    ...baselineLane,
    ...designLane,
  ],
});
