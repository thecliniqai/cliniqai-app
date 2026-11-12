/**
 * M0 baseline accessibility report (V2-02 plan 02-03b; FRONTEND_MIGRATION_PLAN M0 "axe report per route on the
 * PWA_STRATEGY §9.1 PR-lane projects"). REPORT-ONLY (RL-17): axe findings never fail a test; a test fails only when its
 * page cannot be reached. Runs only in the baseline lane on m0-axe-desktop-chrome / m0-axe-pixel-7 / m0-axe-iphone-15.
 *
 * Each route's violations (rule, impact, help, node count; WCAG 2.0/2.1/2.2 A+AA tags) are written to
 * `test-results/m0/axe/<project>/<route>.json` for `scripts/m0-baseline-report.mjs` and attached to the test.
 */
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { test } from "../../fixtures";
import { ROOT } from "../../support/app-env";
import { storageStatePath } from "../../support/run-data";
import { BASELINE_ROUTES, settle } from "./baseline-routes";

const AXE_DIR = path.join(ROOT, "test-results/m0/axe");
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const SIGNED_OUT = { cookies: [], origins: [] };

for (const route of BASELINE_ROUTES) {
  test.describe(`${route.pattern}`, () => {
    test.use({ storageState: route.role ? storageStatePath(route.role) : SIGNED_OUT });

    test(`axe (report-only) ${route.pattern}`, async ({ page }, testInfo) => {
      await page.goto(route.url());
      await settle(page);
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

      const report = {
        route: route.pattern,
        role: route.role,
        project: testInfo.project.name,
        url: new URL(page.url()).pathname,
        tags: TAGS,
        violations: results.violations.map((v) => ({
          id: v.id,
          impact: v.impact ?? null,
          help: v.help,
          helpUrl: v.helpUrl,
          nodes: v.nodes.length,
        })),
        passes: results.passes.length,
        incomplete: results.incomplete.length,
      };
      const dir = path.join(AXE_DIR, testInfo.project.name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${route.slug}.json`), `${JSON.stringify(report, null, 2)}\n`);
      await testInfo.attach(`axe-${route.slug}.json`, { body: JSON.stringify(report, null, 2), contentType: "application/json" });

      const serious = report.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      testInfo.annotations.push({
        type: "axe-report-only",
        description: `${route.pattern}: ${report.violations.length} rule(s) violated, ${serious.length} serious/critical`,
      });
    });
  });
}
