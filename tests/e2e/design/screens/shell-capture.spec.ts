/**
 * Shell before/after captures (V2-06 06-04b, DoD 3): Login, Today, Patients, the consult and the Live Queue at the four
 * design widths, as the role that uses each screen, into the git-ignored `design-captures/06-04b/<label>/<project>/`.
 * Runs only in the design-* projects (the PR and nightly lanes ignore `tests/e2e/design/screens/**`). The label
 * ("before" on the plan base build, "after" on the 06-04b build) comes from `design-captures/06-04b/label.json`,
 * written by the operator before the run (specs never read the environment). Synthetic data only; nothing is submitted.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test } from "../../fixtures";
import { ROOT } from "../../support/app-env";
import { istDate } from "../../support/m0-data";
import { readRunData, storageStatePath, type E2eRole } from "../../support/run-data";
import { settle } from "../../m0/baseline/baseline-routes";

const OUT = path.join(ROOT, "design-captures/06-04b");

// V2-06 06-08: without the operator's label file the captures skip (the design lane runs everywhere, nightly included).
test.beforeEach(() => {
  test.skip(!fs.existsSync(path.join(OUT, "label.json")), "design-captures/06-04b/label.json is absent: not a 06-04b capture run");
});

function label(): string {
  const file = path.join(OUT, "label.json");
  const { label: value } = JSON.parse(fs.readFileSync(file, "utf8")) as { label?: unknown };
  if (typeof value !== "string" || !/^[a-z0-9-]+$/.test(value)) throw new Error(`invalid label in ${file}`);
  return value;
}

const SIGNED_OUT = { cookies: [], origins: [] };

const SCREENS: Array<{ name: string; role: E2eRole | null; url: () => string }> = [
  { name: "login", role: null, url: () => "/login" },
  { name: "today", role: "owner", url: () => "/" },
  { name: "patients", role: "owner", url: () => "/patients" },
  { name: "consult", role: "doctor", url: () => `/consultation/${readRunData().tenantA.visitId}` },
  { name: "queue", role: "receptionist", url: () => "/queue" },
];

async function shoot(page: Page, project: string, name: string): Promise<void> {
  const dir = path.join(OUT, label(), project);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), type: "png", animations: "disabled", caret: "hide" });
}

for (const screen of SCREENS) {
  test.describe(screen.name, () => {
    test.use({ storageState: screen.role ? storageStatePath(screen.role) : SIGNED_OUT });

    test(`capture ${screen.name}`, async ({ page }, testInfo) => {
      await page.clock.setFixedTime(new Date(`${istDate(0)}T10:00:00+05:30`));
      await page.goto(screen.url());
      await settle(page);
      await shoot(page, testInfo.project.name, screen.name);
    });
  });
}
