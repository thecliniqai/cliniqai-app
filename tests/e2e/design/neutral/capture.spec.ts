/**
 * Value-neutral capture (V2-06 plan 06-01a step 7). Captures every M0 baseline route (BASELINE_ROUTES: the auth pages
 * plus every dashboard page) and the key screen of each M0 flow (FLOW_SCREENS: drawers and the Sign & Bill modal) as a
 * full-page PNG at the four design widths, with the M0 clock freeze, so `scripts/design/neutral-diff.mjs compare` can
 * prove the token layer and the colour codemod changed no screen by more than 0.5 % of its pixels.
 *
 * Runs only in the design lane (projects design-360/820/1180/1280); the PR lane ignores this folder. The output folder
 * label ("before" / "after") comes from `test-results/design/neutral/label.json`, which `neutral-diff.mjs capture`
 * writes before it starts Playwright (specs never read the environment).
 *
 * Run-specific text (the run tag in tenant and patient names, the per-run user emails) is masked with one fixed
 * colour, so two runs of the same build compare equal: only the build may differ, never the seeded data. Synthetic
 * data only; nothing is submitted.
 */
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test } from "../../fixtures";
import { ROOT } from "../../support/app-env";
import { istDate } from "../../support/m0-data";
import { readRunData, storageStatePath } from "../../support/run-data";
import { BASELINE_ROUTES, FLOW_SCREENS, settle } from "../../m0/baseline/baseline-routes";

const NEUTRAL_DIR = path.join(ROOT, "test-results/design/neutral");
const LABEL_FILE = path.join(NEUTRAL_DIR, "label.json");
/** The mask colour: a fixed value no v1 screen uses, identical in every run. */
const MASK_COLOR = "#ff00ff";

function captureLabel(): string {
  if (!fs.existsSync(LABEL_FILE)) {
    throw new Error(`${path.relative(ROOT, LABEL_FILE)} is missing: run \`node scripts/design/neutral-diff.mjs capture --label <label>\``);
  }
  const { label } = JSON.parse(fs.readFileSync(LABEL_FILE, "utf8")) as { label?: unknown };
  if (typeof label !== "string" || !/^[a-z0-9-]+$/.test(label)) throw new Error(`invalid capture label in ${LABEL_FILE}`);
  return label;
}

/** Every element showing text that differs between two runs of the same build. */
function runSpecificText(page: Page): Locator[] {
  const run = readRunData();
  return [page.getByText(run.runTag), page.getByText(/@example\.(com|test)/)];
}

const SIGNED_OUT = { cookies: [], origins: [] };

async function shoot(page: Page, project: string, name: string): Promise<void> {
  const dir = path.join(NEUTRAL_DIR, captureLabel(), project);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: path.join(dir, `${name}.png`),
    type: "png",
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    mask: runSpecificText(page),
    maskColor: MASK_COLOR,
  });
}

const freezeClock = (page: Page) => page.clock.setFixedTime(new Date(`${istDate(0)}T10:00:00+05:30`));

for (const route of BASELINE_ROUTES) {
  test.describe(route.pattern, () => {
    test.use({ storageState: route.role ? storageStatePath(route.role) : SIGNED_OUT });

    test(`capture ${route.pattern}`, async ({ page }, testInfo) => {
      await freezeClock(page);
      await page.goto(route.url());
      await settle(page);
      await shoot(page, testInfo.project.name, `route-${route.slug}`);
    });
  });
}

for (const screen of FLOW_SCREENS) {
  test.describe(screen.name, () => {
    test.use({ storageState: storageStatePath(screen.role) });

    test(`capture ${screen.name}`, async ({ page }, testInfo) => {
      await freezeClock(page);
      await screen.open(page);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      await shoot(page, testInfo.project.name, screen.name);
    });
  });
}
