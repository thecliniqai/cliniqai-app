/**
 * Playwright run summary (V2-02 02-03a; TEST_STRATEGY §8 "report the retries"): proves
 * scripts/ci/playwright-summary.mjs lists retried (flaky) and failed tests per project from a JSON report, and never
 * fails the job itself (the Playwright exit code is the gate). Report fixture: lint-fixtures/playwright-summary/.
 */
import { describe, expect, it } from "vitest";
import { runNodeChecker } from "./run-checker";

describe("playwright run summary", () => {
  it("counts outcomes per project and names retried and failed tests", () => {
    const r = runNodeChecker("playwright-summary.mjs", ["lint-fixtures/playwright-summary/results.json"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("| desktop-chrome | 2 | 0 | 0 | 0 |");
    expect(r.stdout).toContain("| pixel-7 | 0 | 1 | 0 | 0 |");
    expect(r.stdout).toContain(
      "- [pixel-7] smoke.spec.ts › owner session › owner opens the app on its landing page (passed on attempt 2)",
    );
    expect(r.stdout).toContain("**Failed: 1**");
    expect(r.stdout).toContain("- [iphone-15] smoke.spec.ts › owner session › owner opens the app on its landing page");
  });

  it("lists each expected failure with its reason and the first line of its error (IR-F4)", () => {
    const r = runNodeChecker("playwright-summary.mjs", ["lint-fixtures/playwright-summary/results.json"]);
    expect(r.stdout).toContain("**Expected failures (known bugs): 1**");
    expect(r.stdout).toContain(
      "- [desktop-chrome] m0/register-patient.spec.ts › receptionist registers a patient (known v1 bug F-01) — F-01: receptionists cannot register patients in v1",
    );
    expect(r.stdout).toContain("failed with: `Error: KNOWN-BUG F-01: the new patient's record opens`");
  });

  it("exits 0 with a warning when the report is missing", () => {
    const r = runNodeChecker("playwright-summary.mjs", ["lint-fixtures/playwright-summary/missing.json"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("cannot read lint-fixtures/playwright-summary/missing.json");
  });
});
