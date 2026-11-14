/**
 * Value-neutral capture (V2-06 plan 06-01a step 7). Captures every M0 baseline route (BASELINE_ROUTES: the auth pages
 * plus every dashboard page) and the key screen of each M0 flow (FLOW_SCREENS: drawers and the Sign & Bill modal) as a
 * full-page PNG at the four design widths, with the M0 clock freeze, so `scripts/design/neutral-diff.mjs compare` can
 * prove the token layer and the colour codemod changed no screen by more than 0.5 % of its pixels.
 *
 * Runs only in the design lane (projects design-360/820/1180/1280); the PR lane ignores this folder. The output folder
 * label ("before" / "after") comes from `design-captures/neutral/label.json`, which `neutral-diff.mjs capture`
 * writes before it starts Playwright (specs never read the environment).
 *
 * Run-specific text is normalised in the DOM before each screenshot, so two runs of the same build render the same
 * pixels and only the build may differ: the run tag in tenant and patient names, the per-run user emails, the record
 * ids (full and the 8-character prefixes some screens show) and the random synthetic phone digits of global setup
 * (`+91 90000 xxxxx`) are replaced with fixed text of the same shape. Synthetic data only; nothing is submitted.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test } from "../../fixtures";
import { ROOT } from "../../support/app-env";
import { istDate } from "../../support/m0-data";
import { readRunData, storageStatePath } from "../../support/run-data";
import { BASELINE_ROUTES, FLOW_SCREENS, settle } from "../../m0/baseline/baseline-routes";

const NEUTRAL_DIR = path.join(ROOT, "design-captures/neutral");
const LABEL_FILE = path.join(NEUTRAL_DIR, "label.json");

function captureLabel(): string {
  if (!fs.existsSync(LABEL_FILE)) {
    throw new Error(`${path.relative(ROOT, LABEL_FILE)} is missing: run \`node scripts/design/neutral-diff.mjs capture --label <label>\``);
  }
  const { label } = JSON.parse(fs.readFileSync(LABEL_FILE, "utf8")) as { label?: unknown };
  if (typeof label !== "string" || !/^[a-z0-9-]+$/.test(label)) throw new Error(`invalid capture label in ${LABEL_FILE}`);
  return label;
}

/** Literal replacements for every run-specific string the screens can show. */
function runReplacements(): Array<[string, string]> {
  const run = readRunData();
  const ids = [
    run.tenantA.id,
    run.tenantA.patientId,
    run.tenantA.visitId,
    ...Object.values(run.tenantA.users).map((u) => u.id),
    run.tenantB.id,
    run.tenantB.patientId,
    run.tenantB.visitId,
    run.tenantB.owner.id,
    run.tenantB.invoiceId,
  ];
  const fixedId = "00000000-0000-4000-8000-000000000000";
  return [
    ...ids.flatMap((id): Array<[string, string]> => [
      [id, fixedId],
      [id.slice(0, 8), "00000000"],
      [id.slice(0, 8).toUpperCase(), "00000000"],
    ]),
    [run.runTag, "00000000"],
    [run.runTag.toUpperCase(), "00000000"],
  ];
}

/** Rewrites run-specific text in the page (text nodes, form values, titles) to fixed text of the same shape. */
async function normaliseRunText(page: Page): Promise<void> {
  await page.evaluate((replacements) => {
    const fix = (text: string) => {
      let out = text;
      for (const [from, to] of replacements) out = out.split(from).join(to);
      return out
        .replace(/[\w.+-]+@example\.(com|test)/g, "user@example.com")
        .replace(/(90000[\s-]?)\d{5}/g, (_m, head: string) => `${head}00000`);
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const next = fix(node.nodeValue ?? "");
      if (next !== node.nodeValue) node.nodeValue = next;
    }
    for (const el of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")) {
      const next = fix(el.value);
      if (next !== el.value) el.value = next;
    }
    for (const el of document.querySelectorAll<HTMLElement>("[title], [aria-label]")) {
      for (const attr of ["title", "aria-label"]) {
        const value = el.getAttribute(attr);
        if (value !== null && fix(value) !== value) el.setAttribute(attr, fix(value));
      }
    }
  }, runReplacements());
}

const SIGNED_OUT = { cookies: [], origins: [] };

async function shoot(page: Page, project: string, name: string): Promise<void> {
  const dir = path.join(NEUTRAL_DIR, captureLabel(), project);
  fs.mkdirSync(dir, { recursive: true });
  await normaliseRunText(page);
  await page.screenshot({
    path: path.join(dir, `${name}.png`),
    type: "png",
    fullPage: true,
    animations: "disabled",
    caret: "hide",
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
