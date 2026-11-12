import { defineConfig, devices, type Project } from "@playwright/test";
import { assertLocalTestEnv, loadLocalStackKeys, loadTestEnv } from "./tests/setup/test-env";
import { E2E_BASE_URL } from "./tests/e2e/support/app-env";

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
const GOLDEN = /@golden/;

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
  { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] }, testIgnore: BASELINE, ...setup },
  { name: "pixel-7", use: { ...devices["Pixel 7"] }, testIgnore: [A11Y, BASELINE], ...setup },
  { name: "iphone-15", use: { ...devices["iPhone 15"] }, grep: GOLDEN, testIgnore: [A11Y, BASELINE], ...setup },
];

// Nightly lane: the rest of the PWA_STRATEGY §9.1 matrix, smoke + @golden.
const nightly = (name: string, use: Project["use"]): Project => ({
  name,
  use,
  grep: GOLDEN,
  testIgnore: [A11Y, BASELINE],
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

// M0 baseline lane (02-03b): screenshots at fixed widths, Chromium.
const baseline = (width: number, height: number): Project => ({
  name: `vp-${width}`,
  use: { ...devices["Desktop Chrome"], viewport: { width, height } },
  testMatch: BASELINE,
  ...setup,
});
const baselineLane: Project[] = [baseline(360, 780), baseline(768, 1024), baseline(1280, 800)];

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
  ],
});
