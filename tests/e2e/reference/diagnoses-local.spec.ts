/**
 * V2-09e 09E-10 (R-5, R-6, R-8, B-4): the consult's diagnosis search answers from the device. The doctor's tab downloads the diagnosis catalogue after first
 * paint (one shard), holds it in IndexedDB `cliniq-reference` and in memory, and each keystroke is answered by the twin of `search_diagnoses` with the
 * doctor's own custom diagnoses from the consult's query first: no Supabase call while typing (Kong's access log, server and browser), even with 300 ms
 * added to every Supabase call; offline it still answers; with the reference routes unreachable it falls back to the search route and still works.
 *
 * One own doctor per test (with one custom diagnosis of its own) and one patient; synthetic `e10e…e2e` diagnoses (global fixtures, upserted, never deleted).
 * desktop-chrome, pixel-7 and iphone-15 (`@golden`), no retries.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { awaitHydrated } from "../support/hydrated";
import { run, seedPatient, seedVisit, testTag } from "../support/m0-data";
import { storageStatePath, type RunUser } from "../support/run-data";
import { retireOwnDoctor, seedOwnDoctor, signInAsOwnDoctor } from "../support/own-doctor";
import { countKongCalls } from "../support/kong-calls";
import { clearSupabaseLatency, setSupabaseLatency } from "../support/latency";
import { holdBackground } from "../perf/latency-run";
import { getAdminClient } from "../../helpers/supabase-admin";

test.use({ storageState: storageStatePath("doctor") });

const admin = getAdminClient();
const DIAGNOSES = [
  { id: "e10e0000-0000-4000-8000-0000000e2e01", name: "Qzxdevdx Alpha", synonyms: ["Qzxdevdx Synonym"], icd11_code: "QD01" },
  { id: "e10e0000-0000-4000-8000-0000000e2e02", name: "Alpha Qzxdevdx", synonyms: [], icd11_code: null },
  { id: "e10e0000-0000-4000-8000-0000000e2e03", name: "Qzxdevdx Beta", synonyms: [], icd11_code: "QD03" },
  { id: "e10e0000-0000-4000-8000-0000000e2e04", name: "Ödevqzxdevdx", synonyms: [], icd11_code: null },
];
const OWN_CUSTOM = "Qzxdevdx My Own";

let doctor: RunUser | null = null;
test.afterEach(async () => {
  clearSupabaseLatency();
  if (doctor) await retireOwnDoctor(doctor);
  doctor = null;
});

/** A consult of the test's own doctor (who has one custom diagnosis) on a new patient. */
async function openConsult(page: Page, label: string): Promise<void> {
  const up = await admin
    .from("opd_diagnoses")
    .upsert(DIAGNOSES.map((d) => ({ ...d, specialties: ["general_physician"], is_chronic: false })), { onConflict: "id" });
  if (up.error) throw new Error(up.error.message);
  const { tenantA } = run();
  const own = await seedOwnDoctor(label);
  doctor = own;
  const custom = await admin.from("doctor_custom_diagnoses").insert({ tenant_id: tenantA.id, doctor_id: own.id, diagnosis_name: OWN_CUSTOM, use_count: 2 });
  if (custom.error) throw new Error(custom.error.message);
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic ${label} ${testTag()}`);
  const visitId = await seedVisit({ tenantId: tenantA.id, patientId: patient.id, doctorId: own.id, createdBy: tenantA.users.receptionist.id, status: "in_consultation" });
  await signInAsOwnDoctor(page, own);
  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByLabel("History of Present Illness & Clinical Notes")).toBeVisible();
  await awaitHydrated(page);
}

const field = (page: Page) => page.getByPlaceholder(/Search diagnosis name/);
const options = (page: Page) => page.locator("[data-diagnosis-search]").getByRole("option");
/** The names of the listed diagnoses, in order (the "Add …" row has none). */
const hitNames = (page: Page) => page.locator("[data-diagnosis-search] [data-diagnosis-hit]").allTextContents().then((t) => t.map((s) => s.trim()));

async function expectDevice(page: Page) {
  await expect(page.locator('[data-diagnosis-input][data-search-source="device"]')).toBeAttached({ timeout: 30_000 });
}

/** The server has been quiet for a moment (the page's own loads, the sync and any beacon are over). */
async function serverQuiet() {
  await expect.poll(async () => (await countKongCalls(async () => undefined, 600)).server, { timeout: 20_000, message: "the server is quiet" }).toBe(0);
}

test("@golden typing answers from the device: 0 Supabase calls with 300 ms added to every call, the doctor's own first, ranked as SQL ranks", async ({ page, context }) => {
  const holds = await holdBackground(page);
  await page.route("**/api/rum", (route) => route.fulfill({ status: 204, body: "" }));
  await openConsult(page, "DxLocal");
  await expectDevice(page);
  await page.waitForLoadState("networkidle");
  await serverQuiet();
  await setSupabaseLatency(context, 300);
  holds.status = true;
  const window = await countKongCalls(async () => {
    await field(page).click();
    await field(page).pressSequentially("qzxdevdx");
    // The doctor's own first; then the name prefixes in code point order, the word prefix, the term inside a word (then trigram-only rows of other
    // fixtures, if any, and "Add …").
    await expect.poll(async () => (await hitNames(page)).slice(0, 5)).toEqual([OWN_CUSTOM, "Qzxdevdx Alpha", "Qzxdevdx Beta", "Alpha Qzxdevdx", "Ödevqzxdevdx"]);
    await field(page).fill("");
    await field(page).pressSequentially("qzxdevdx syn");
    // The doctor's own (trigram-similar), then the synonym's row.
    await expect.poll(async () => (await hitNames(page)).slice(0, 2)).toEqual([OWN_CUSTOM, "Qzxdevdx Alpha"]);
  });
  holds.status = false;
  expect(window.calls, JSON.stringify(window.calls)).toEqual([]);
  // A pick adds the catalogue diagnosis with its code (one command, after the measured window).
  await options(page).filter({ has: page.locator("[data-diagnosis-hit]", { hasText: /^\s*Qzxdevdx Alpha\s*$/ }) }).click();
  await expect(page.getByRole("list", { name: "Diagnoses" })).toContainText("Qzxdevdx Alpha");
  await expect(page.getByRole("list", { name: "Diagnoses" })).toContainText("ICD-11 QD01");
});

test("@golden offline, the device still answers", async ({ page, context }) => {
  await openConsult(page, "DxOffline");
  await expectDevice(page);
  await context.setOffline(true);
  try {
    await field(page).click();
    await field(page).pressSequentially("qzxdevdx be");
    await expect.poll(async () => (await hitNames(page)).slice(0, 2)).toEqual([OWN_CUSTOM, "Qzxdevdx Beta"]);
  } finally {
    await context.setOffline(false);
  }
});

test("@golden with the reference routes unreachable the section searches through the route and still works", async ({ page }) => {
  await page.route("**/api/reference/**", (route) => route.abort());
  const searches: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/terminology/diagnoses")) searches.push(r.url());
  });
  await openConsult(page, "DxFallback");
  await expect(page.locator('[data-diagnosis-input][data-search-source="server"]')).toBeAttached();
  await field(page).click();
  await field(page).pressSequentially("qzxdevdx al");
  await expect.poll(async () => (await hitNames(page)).slice(0, 2), { timeout: 15_000 }).toEqual([OWN_CUSTOM, "Qzxdevdx Alpha"]);
  expect(searches.length).toBeGreaterThan(0);
  await expect(page.locator('[data-diagnosis-input][data-search-source="server"]')).toBeAttached();
});
