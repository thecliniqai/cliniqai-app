/**
 * The consultation and queue screens after the clinical split (V2-05 plan 05-02a; CLAUDE.md DoD 3; rulings R-2, R-3).
 *
 * 05-02a moved a visit's vitals and clinical notes from `visits` into `public.clinical_notes` (RLS: consultations:view)
 * without touching any screen markup. At 360, 820 and 1280 px this spec checks, through the real app:
 *   - the doctor's consultation workspace shows the seeded note and vitals (the page reads the new table);
 *   - the nurse's queue card shows the seeded vitals summary; the receptionist's card for the same visit does not;
 *   - the receptionist's consultation URL (still served, known gap P1-07, V2-08) renders without the note and without
 *     a literal "undefined"/"null";
 *   - no serious/critical axe rule appears that the M0 baseline (02-03b, committed reports) did not already have on
 *     these routes on a PR-lane device (the v1 a11y debt is owned by V2-06…V2-11): BLOCKING on new rule ids; the
 *     counts are attached as a report.
 * Screenshots and the axe JSON go to test-results/clinical-split/ for the 05-02a evidence. Runs on desktop-chrome
 * only (a11y specs own their viewport). Synthetic data only.
 */
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "../fixtures";
import { ROOT } from "../support/app-env";
import { run, seedPatient, seedVisit, testTag } from "../support/m0-data";
import { storageStatePath, type E2eRole } from "../support/run-data";
import { seedClinicalNotes } from "../../helpers/clinical-notes";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);
/** The M0 baseline axe reports (V2-02 02-03b), one per PR-lane device: the v1 debt each route already had. */
const BASELINE_DIR = path.join(ROOT, ".planning/phases/02-ci-e2e-foundations/evidence/m0-baseline/axe");

/** Serious/critical rule ids the M0 baseline recorded on `route` on any PR-lane device (desktop, Pixel 7, iPhone 15). */
function baselineRules(route: "/consultation/[id]" | "/queue"): Set<string> {
  const ids = new Set<string>();
  for (const file of fs.readdirSync(BASELINE_DIR).filter((f) => f.endsWith(".json"))) {
    const report = JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, file), "utf8")) as {
      routes: Array<{ route: string; violations: Array<{ id: string; impact: string | null }> }>;
    };
    for (const r of report.routes.filter((x) => x.route === route)) {
      for (const v of r.violations) if (BLOCKING_IMPACTS.has(v.impact ?? "")) ids.add(v.id);
    }
  }
  if (ids.size === 0) throw new Error(`no M0 baseline axe entry for ${route}`);
  return ids;
}
const WIDTHS = [
  { width: 360, height: 780 },
  { width: 820, height: 1180 },
  { width: 1280, height: 800 },
];
const NOTES_LABEL = "History of Present Illness & Clinical Notes";
const NOTE = "E2E synthetic clinical note (05-02a screens).";
const VITALS = { systolic: 128, diastolic: 84, pulse: 76 };
const VITALS_SUMMARY = "BP 128/84";
const OUT_DIR = path.join(ROOT, "test-results/clinical-split");

async function seededVisit(tag: string): Promise<string> {
  const { tenantA } = run();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic Split ${tag}`);
  const visitId = await seedVisit({
    tenantId: tenantA.id,
    patientId: patient.id,
    doctorId: tenantA.users.doctor.id,
    createdBy: tenantA.users.receptionist.id,
    status: "waiting",
    scheduledAt: new Date().toISOString(),
  });
  await seedClinicalNotes(visitId, { clinical_notes: NOTE, vitals: VITALS });
  return visitId;
}

async function check(page: Page, testInfo: TestInfo, name: string, route: "/consultation/[id]" | "/queue"): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true, animations: "disabled", caret: "hide" });
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ""));
  const summary = {
    screen: name,
    baseline_rules: [...baselineRules(route)].sort(),
    serious_or_critical: blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
    horizontal_scroll: await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
  };
  fs.writeFileSync(path.join(OUT_DIR, `${name}.axe.json`), JSON.stringify(summary, null, 2));
  await testInfo.attach(`axe-${name}.json`, { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
  const baseline = baselineRules(route);
  const newRules = blocking.map((v) => v.id).filter((id) => !baseline.has(id));
  expect(newRules, `serious/critical axe rules not in the M0 baseline on ${name}`).toEqual([]);
}

function bodyText(page: Page): Promise<string> {
  return page.locator("main").first().innerText();
}

const as = (role: E2eRole) => ({ storageState: storageStatePath(role) });

for (const size of WIDTHS) {
  test.describe(`clinical split screens at ${size.width}px`, () => {
    test.describe("doctor", () => {
      test.use(as("doctor"));

      test(`consultation shows the note and vitals from clinical_notes (${size.width}px)`, async ({ page }, testInfo) => {
        const visitId = await seededVisit(testTag());
        await page.setViewportSize(size);
        await page.goto(`/consultation/${visitId}`);
        await expect(page.getByLabel(NOTES_LABEL)).toHaveValue(NOTE);
        await expect(page.getByText("Vital Signs")).toBeVisible();
        await expect(page.getByText(/128\s*\/\s*84/).first()).toBeVisible();
        await check(page, testInfo, `consultation-doctor-${size.width}`, "/consultation/[id]");
      });
    });

    test.describe("nurse", () => {
      test.use(as("nurse"));

      test(`queue card shows the vitals summary (${size.width}px)`, async ({ page }, testInfo) => {
        const tag = testTag();
        await seededVisit(tag);
        await page.setViewportSize(size);
        await page.goto("/queue");
        await expect(page.getByText(`E2E Synthetic Split ${tag}`).first()).toBeVisible();
        await expect(page.getByText(VITALS_SUMMARY).first()).toBeVisible();
        await check(page, testInfo, `queue-nurse-${size.width}`, "/queue");
      });
    });

    test.describe("receptionist", () => {
      test.use(as("receptionist"));

      test(`queue shows the visit without its vitals (${size.width}px)`, async ({ page }, testInfo) => {
        const tag = testTag();
        await seededVisit(tag);
        await page.setViewportSize(size);
        await page.goto("/queue");
        await expect(page.getByText(`E2E Synthetic Split ${tag}`).first()).toBeVisible();
        expect(await bodyText(page)).not.toContain(VITALS_SUMMARY);
        await check(page, testInfo, `queue-receptionist-${size.width}`, "/queue");
      });

      test(`consultation URL renders no note and no "undefined" (P1-07 open) (${size.width}px)`, async ({ page }, testInfo) => {
        const visitId = await seededVisit(testTag());
        await page.setViewportSize(size);
        const response = await page.goto(`/consultation/${visitId}`);
        expect(response?.status()).toBeLessThan(500);
        const text = await page.locator("body").innerText();
        expect(text).not.toContain(NOTE);
        expect(text).not.toMatch(/\bundefined\b/);
        const notes = page.getByLabel(NOTES_LABEL);
        if (await notes.count()) await expect(notes).toHaveValue("");
        await check(page, testInfo, `consultation-receptionist-${size.width}`, "/consultation/[id]");
      });
    });
  });
}
