/**
 * V2-06 06-04a UI checks (CLAUDE.md DoD 3; plan "UI checks"): the error, not-found and loading states inside the
 * dashboard and the root not-found, at the four design widths (360/820/1180/1280). Each: 0 serious or critical axe
 * violations (wcag2a, wcag2aa, wcag21aa, wcag22aa: the M0 tags) in what 06-04a adds (inside the dashboard: the state
 * in `<main>`; the v1 sidebar and header around it are the M0 axe report's and 06-04b's; at the root: the whole page),
 * no horizontal scroll, and a full-page screenshot plus the axe results (scoped, and the whole page for reference)
 * written to `design-captures/06-04a/` (git-ignored; the summary JSON becomes the plan's evidence).
 *
 * PR lane, desktop-chrome only (an `*axe*` spec under design/ sets its own viewport; playwright.config.ts).
 */
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { ROOT } from "../support/app-env";
import { storageStatePath } from "../support/run-data";
import { DESIGN_WIDTHS } from "./support/widths";
import { clickNavLink, holdNavigation } from "../shell/support/slow-navigation";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING = new Set(["serious", "critical"]);
const OUT = path.join(ROOT, "design-captures/06-04a");

test.use({ storageState: storageStatePath("owner") });

type Scope = "main" | "page";

async function check(page: Page, state: string, width: number, scope: Scope): Promise<void> {
  const results = await (scope === "main" ? new AxeBuilder({ page }).include("main") : new AxeBuilder({ page }))
    .withTags(TAGS)
    .analyze();
  const wholePage = scope === "main" ? await new AxeBuilder({ page }).withTags(TAGS).analyze() : results;
  const blocking = results.violations
    .filter((v) => BLOCKING.has(v.impact ?? ""))
    .map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(" ")) }));
  const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${state}-${width}.png`), fullPage: true });
  fs.writeFileSync(
    path.join(OUT, `axe-${state}-${width}.json`),
    JSON.stringify(
      {
        state,
        width,
        scope,
        path: new URL(page.url()).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/i, "[id]"),
        horizontalScroll: scrolls,
        seriousOrCritical: blocking,
        violations: results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
        wholePageForReference: wholePage.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
      },
      null,
      2,
    ),
  );
  expect(blocking, `serious/critical axe violations (${state} at ${width}px)`).toEqual([]);
  expect(scrolls, `horizontal scroll (${state} at ${width}px)`).toBe(false);
}

for (const size of DESIGN_WIDTHS) {
  test.describe(`route states at ${size.width}px`, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop-chrome", "sets its own viewport; desktop Chromium only");
      await page.setViewportSize(size);
    });

    test(`dashboard not-found at ${size.width}px`, async ({ page }) => {
      await page.goto(`/patients/${randomUUID()}`);
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await check(page, "dashboard-not-found", size.width, "main");
    });

    test(`dashboard error at ${size.width}px`, async ({ page }) => {
      await page.goto("/diag/client-error");
      await page.getByRole("button", { name: "Throw a render error" }).click();
      await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
      await check(page, "dashboard-error", size.width, "main");
    });

    test(`dashboard loading at ${size.width}px`, async ({ page }) => {
      const nav = await holdNavigation(page, "/visits");
      await page.goto("/");
      await expect(page.getByRole("main")).toBeVisible();
      await clickNavLink(page, "Visits", nav);
      await expect(page.getByRole("status", { name: "Loading" })).toBeVisible();
      // Below lg the navigation is a drawer that closes on navigation: capture the skeleton after its slide-out.
      if (size.width < 1024) await expect(page.locator("aside")).not.toBeInViewport();
      await check(page, "dashboard-loading", size.width, "main");
      nav.release();
      await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0, { timeout: 15_000 });
    });

    test(`root not-found at ${size.width}px`, async ({ page }) => {
      await page.goto("/no-such-page");
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await check(page, "root-not-found", size.width, "page");
    });
  });
}
