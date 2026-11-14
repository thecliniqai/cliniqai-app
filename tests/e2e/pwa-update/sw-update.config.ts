import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { assertLocalTestEnv, loadLocalStackKeys, loadTestEnv } from "../../setup/test-env";

// V2-06 06-09a (M-OFFLINE): `npm run e2e:sw-update`. Two real builds and a server restart in one test, so this lane has
// no webServer and no global setup (it needs no seeded data: it only uses the public `/offline` and `/sw.js`). It runs
// `npm run e2e:build` twice and `tests/e2e/support/serve.ts` itself, on the same guarded loopback env and port 3100 as
// the PR lane: run it under the e2e lane lock, never next to another e2e run. Not in the PR lane (two builds take
// minutes); the main playwright.config.ts ignores tests/e2e/pwa-update/.
const ROOT = path.resolve(__dirname, "../../..");
loadTestEnv(ROOT);
loadLocalStackKeys(ROOT);
assertLocalTestEnv();

export default defineConfig({
  testDir: __dirname,
  testMatch: /sw-update\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15 * 60_000,
  outputDir: path.join(ROOT, "test-results/sw-update"),
  reporter: [["list"], ["json", { outputFile: path.join(ROOT, "playwright-report/sw-update.json") }]],
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
  projects: [{ name: "sw-update-chromium", use: { ...devices["Desktop Chrome"] } }],
});
