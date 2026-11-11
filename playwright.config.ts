import { defineConfig, devices } from "@playwright/test";
import { assertLocalTestEnv, loadLocalStackKeys, loadTestEnv } from "./tests/setup/test-env";

// V2-01a: e2e runs use the same local-only lane as Vitest (no .env, local stack, offline providers).
// The app web server and its env wiring arrive with the Playwright scaffold (V2-02).
loadTestEnv(__dirname);
loadLocalStackKeys(__dirname);
assertLocalTestEnv();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
});
