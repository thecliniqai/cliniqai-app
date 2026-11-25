/**
 * V2-09e 09E-09 (R-5, R-6, B-4; C-2): the allergy editor answers from the device. The doctor's tab downloads the substance catalogue after first paint
 * (`GET /api/reference/manifest`, one shard), holds it in IndexedDB `cliniq-reference` (catalogue rows only) and in memory, and each keystroke is answered
 * by the twin of `search_substances`: no Supabase call while typing (Kong's access log, server and browser), even with 300 ms added to every Supabase
 * call; offline it still answers; with IndexedDB refused it keeps the catalogue in memory for the tab; with the reference routes unreachable it falls back
 * to the search route and still works; what it stores is catalogue rows of a known shape; a sign-out leaves no database.
 *
 * One own doctor and one patient (allergies not recorded) per test; synthetic `test-ref-sub-e2e-*` substances (global fixtures, upserted, never deleted).
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
import { referenceDbAudit, storageDump } from "../support/storage-dump";
import { getAdminClient } from "../../helpers/supabase-admin";

test.use({ storageState: storageStatePath("doctor") });

const admin = getAdminClient();
const SUBSTANCES = [
  { id: "test-ref-sub-e2e-1", substance_name: "Qzxdevsub Alpha" },
  { id: "test-ref-sub-e2e-2", substance_name: "Alpha Qzxdevsub" },
  { id: "test-ref-sub-e2e-3", substance_name: "Qzxdevsub Beta" },
  { id: "test-ref-sub-e2e-4", substance_name: "Ödevqzxdevsub" },
];

let doctor: RunUser | null = null;
test.afterEach(async () => {
  clearSupabaseLatency();
  if (doctor) await retireOwnDoctor(doctor);
  doctor = null;
});

/** A consult of the test's own doctor on a new patient whose allergies are not recorded; the allergy editor open. */
async function openEditor(page: Page, label: string): Promise<{ patientName: string }> {
  const up = await admin.from("cdci_substances").upsert(SUBSTANCES, { onConflict: "id" });
  if (up.error) throw new Error(up.error.message);
  const { tenantA } = run();
  const own = await seedOwnDoctor(label);
  doctor = own;
  const patientName = `E2E Synthetic ${label} ${testTag()}`;
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, patientName);
  await admin.from("patients").update({ allergies: null }).eq("id", patient.id).throwOnError();
  const visitId = await seedVisit({ tenantId: tenantA.id, patientId: patient.id, doctorId: own.id, createdBy: tenantA.users.receptionist.id, status: "in_consultation" });
  await signInAsOwnDoctor(page, own);
  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByLabel("History of Present Illness & Clinical Notes")).toBeVisible();
  await awaitHydrated(page);
  await page.locator("[data-allergy-strip]").getByRole("button", { name: "Record now" }).click();
  await expect(page.getByRole("dialog", { name: "Allergies" })).toBeVisible();
  return { patientName };
}

const sheet = (page: Page) => page.getByRole("dialog", { name: "Allergies" });
const field = (page: Page) => sheet(page).getByRole("combobox");
const options = (page: Page) => sheet(page).getByRole("option");

async function expectDevice(page: Page) {
  await expect(page.locator('[data-allergy-search][data-search-source="device"]')).toBeAttached({ timeout: 30_000 });
}

/** The server has been quiet for a moment (the page's own loads, the sync and any beacon are over). */
async function serverQuiet() {
  await expect.poll(async () => (await countKongCalls(async () => undefined, 600)).server, { timeout: 20_000, message: "the server is quiet" }).toBe(0);
}

test("@golden typing answers from the device: 0 Supabase calls with 300 ms added to every call, ranked as SQL ranks", async ({ page, context }) => {
  const holds = await holdBackground(page);
  await page.route("**/api/rum", (route) => route.fulfill({ status: 204, body: "" }));
  await openEditor(page, "RefLocal");
  await expectDevice(page);
  await page.waitForLoadState("networkidle");
  await serverQuiet();
  await setSupabaseLatency(context, 300);
  holds.status = true;
  const window = await countKongCalls(async () => {
    await field(page).pressSequentially("qzxdevsub");
    await expect(options(page).first()).toHaveText("Qzxdevsub Alpha");
    // The twin's order: the prefix matches by name (code point order), then the word prefix, then the term inside.
    await expect(options(page)).toHaveText(["Qzxdevsub Alpha", "Qzxdevsub Beta", "Alpha Qzxdevsub", "Ödevqzxdevsub", /Add/]);
    await field(page).fill("");
    await field(page).pressSequentially("ödev");
    await expect(options(page).first()).toHaveText("Ödevqzxdevsub");
  });
  holds.status = false;
  expect(window.calls, JSON.stringify(window.calls)).toEqual([]);
  // A pick is stored as the substance's exact name and says it is checked against medicines.
  await options(page).first().click();
  await expect(sheet(page).locator('[data-allergy-entry="Ödevqzxdevsub"]')).toContainText("Checked against medicines");
});

test("@golden offline, the device still answers", async ({ page, context }) => {
  await openEditor(page, "RefOffline");
  await expectDevice(page);
  await context.setOffline(true);
  try {
    await field(page).pressSequentially("qzxdevsub be");
    await expect(options(page).first()).toHaveText("Qzxdevsub Beta");
  } finally {
    await context.setOffline(false);
  }
});

test("@golden with IndexedDB refused the catalogue is held in memory for the tab: it answers, and no database is created", async ({ page }) => {
  await page.addInitScript(() => {
    // On the prototype (WebKit ignores an own property assigned on the factory object).
    Object.defineProperty(IDBFactory.prototype, "open", {
      configurable: true,
      value: () => {
        throw new DOMException("refused by the test", "SecurityError");
      },
    });
  });
  await openEditor(page, "RefNoIdb");
  await expectDevice(page);
  await field(page).pressSequentially("alpha qzxdev");
  await expect(options(page).first()).toHaveText("Alpha Qzxdevsub");
  const names = await page.evaluate(async () => (typeof indexedDB.databases === "function" ? (await indexedDB.databases()).map((d) => d.name) : []));
  expect(names).not.toContain("cliniq-reference");
});

test("@golden with the reference routes unreachable the editor searches through the route and still works", async ({ page }) => {
  await page.route("**/api/reference/**", (route) => route.abort());
  const searches: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/terminology/substances")) searches.push(r.url());
  });
  await openEditor(page, "RefFallback");
  await expect(page.locator('[data-allergy-search][data-search-source="server"]')).toBeAttached();
  await field(page).pressSequentially("qzxdevsub al");
  await expect(options(page).first()).toHaveText("Qzxdevsub Alpha", { timeout: 15_000 });
  expect(searches.length).toBeGreaterThan(0);
  await expect(page.locator('[data-allergy-search][data-search-source="server"]')).toBeAttached();
});

test("@golden the device holds catalogue rows only, and a sign-out leaves no database", async ({ page }) => {
  const { patientName } = await openEditor(page, "RefAudit");
  await expectDevice(page);
  await expect.poll(async () => (await referenceDbAudit(page)).records, { timeout: 20_000 }).toBeGreaterThan(0);
  const audit = await referenceDbAudit(page);
  expect(audit.problems).toEqual([]);
  expect(audit.databases).toEqual(["cliniq-reference"]);
  expect(audit.stores).toEqual(["meta", "rows"]);
  // Nothing of the patient on screen is in any storage API.
  const dump = await storageDump(page);
  expect(dump.indexedDb).toContain("Qzxdevsub Alpha");
  expect(dump.indexedDb).not.toContain(patientName);
  expect(dump.indexedDb).not.toContain(run().tenantA.id);

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/login");
  await expect
    .poll(async () => page.evaluate(async () => (typeof indexedDB.databases === "function" ? (await indexedDB.databases()).map((d) => d.name ?? "") : [])), { timeout: 15_000 })
    .toEqual([]);
});
