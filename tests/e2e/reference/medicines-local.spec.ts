/**
 * V2-09e 09E-11 (R-5, R-7, R-8, B-4): the Rx field answers from the device. The doctor's tab downloads the medicine catalogue after first paint (the
 * generics shard, then the brand shards), holds it in IndexedDB `cliniq-reference` and builds the columnar index in a Web Worker; each keystroke is answered
 * there (ranks 1 to 4 of `search_medicines`, the doctor's own custom medicines from the consult's query first, with their stored dose).
 *   - When the device's rows fill the limit (15): no Supabase call while typing (Kong's access log, server and browser), even with 300 ms added to every call.
 *   - When they do not (the trigram tail is the server's): the device's rows are on screen at once, and the route is asked exactly once for the settled
 *     query; its answer replaces the list.
 *   - Offline the device's ranks are still shown.
 *
 * One own doctor per test (with one custom medicine of its own) and one patient; synthetic `test-cdci-e11-*` brands (global fixtures, upserted, never
 * deleted; consistent generics and brands). desktop-chrome, pixel-7 and iphone-15 (`@golden`), no retries.
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
import { upsertCdciRows, type CdciFixture } from "../support/cdci-fixtures";
import { rxField } from "../support/rx-entry";
import { getAdminClient } from "../../helpers/supabase-admin";

test.use({ storageState: storageStatePath("doctor") });

const admin = getAdminClient();
/** 16 brands that share a prefix (more than the limit of 15), and one brand only a trigram match finds. */
const ROWS: CdciFixture[] = [
  ...Array.from({ length: 16 }, (_, i): CdciFixture => ({
    id: `test-cdci-e11-${String(i).padStart(2, "0")}`,
    brand_name: `Qzxdevmed ${String(i).padStart(2, "0")}`,
    generic_name: `Qzxdevmedol ${i} mg`,
    dose_form: "Tablet",
  })),
  { id: "test-cdci-e11-tail", brand_name: "Zqvdevtyporow", generic_name: "Zqvdevgen", dose_form: "Syrup" },
];
const OWN = { medicine_name: "Qzxdevmed Mine", default_dosage: "1-0-1", default_timing: "After food", default_duration: "5 days" };

let doctor: RunUser | null = null;
test.afterEach(async () => {
  clearSupabaseLatency();
  if (doctor) await retireOwnDoctor(doctor);
  doctor = null;
});

/** A consult of the test's own doctor (who has one custom medicine) on a new patient. */
async function openConsult(page: Page, label: string): Promise<void> {
  await upsertCdciRows(ROWS);
  const { tenantA } = run();
  const own = await seedOwnDoctor(label);
  doctor = own;
  const custom = await admin.from("doctor_custom_medicines").insert({ tenant_id: tenantA.id, doctor_id: own.id, ...OWN, use_count: 3 });
  if (custom.error) throw new Error(custom.error.message);
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, `E2E Synthetic ${label} ${testTag()}`);
  const visitId = await seedVisit({ tenantId: tenantA.id, patientId: patient.id, doctorId: own.id, createdBy: tenantA.users.receptionist.id, status: "in_consultation" });
  await signInAsOwnDoctor(page, own);
  await page.goto(`/consultation/${visitId}`);
  await expect(page.getByLabel("History of Present Illness & Clinical Notes")).toBeVisible();
  await awaitHydrated(page);
}

const rx = (page: Page) => page.locator("#prescription");
const field = (page: Page) => rxField(rx(page));
/** The names of the listed medicines, in order (the "Add …" row is not one). */
const names = (page: Page) =>
  rx(page)
    .getByRole("option")
    .locator("[data-rx-hit]")
    .allTextContents()
    .then((t) => t.map((s) => s.trim()));

async function expectDevice(page: Page) {
  await expect(rx(page).locator('[data-rx-search][data-search-source="device"]')).toBeAttached({ timeout: 45_000 });
}

/** The server has been quiet for a moment (the page's own loads, the sync and any beacon are over). */
async function serverQuiet() {
  await expect.poll(async () => (await countKongCalls(async () => undefined, 600)).server, { timeout: 20_000, message: "the server is quiet" }).toBe(0);
}

test("@golden the limit filled on the device: 0 Supabase calls with 300 ms added to every call, the doctor's own first with its dose", async ({ page, context }) => {
  const holds = await holdBackground(page);
  await page.route("**/api/rum", (route) => route.fulfill({ status: 204, body: "" }));
  const routeCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/prescriptions/medicines")) routeCalls.push(r.url());
  });
  await openConsult(page, "MedLocal");
  await expectDevice(page);
  await page.waitForLoadState("networkidle");
  await serverQuiet();
  await setSupabaseLatency(context, 300);
  holds.status = true;
  const window = await countKongCalls(async () => {
    await field(page).click();
    await field(page).pressSequentially("qzxdevmed");
    // 1 custom + 16 catalogue rows match: the first 15 are the answer (custom first, then the brands by name).
    await expect.poll(() => names(page)).toEqual(["Qzxdevmed Mine", ...Array.from({ length: 14 }, (_, i) => `Qzxdevmed ${String(i).padStart(2, "0")}`)]);
  });
  holds.status = false;
  expect(window.calls, JSON.stringify(window.calls)).toEqual([]);
  expect(routeCalls, "no request to the search route").toEqual([]);
  // The custom medicine carries its stored dose into the builder (09C R-2).
  await field(page).press("Enter");
  await expect(rx(page).locator("[data-dose-summary]")).toContainText("1-0-1");
  await expect(rx(page).locator("[data-dose-summary]")).toContainText("5 days");
});

test("@golden the tail: the device's rows at once, then exactly one route call whose answer replaces the list", async ({ page }) => {
  await openConsult(page, "MedTail");
  await expectDevice(page);
  await page.waitForLoadState("networkidle");
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const routeCalls: string[] = [];
  await page.route("**/api/prescriptions/medicines**", async (route) => {
    routeCalls.push(route.request().url());
    await held;
    await route.fallback();
  });
  await field(page).click();
  await field(page).pressSequentially("qzxdevmed 0");
  // Ranks 1 to 4 and the doctor's own (trigram-similar) are on screen while the route is held: 11 rows < 15.
  await expect.poll(() => names(page)).toEqual(["Qzxdevmed Mine", ...Array.from({ length: 10 }, (_, i) => `Qzxdevmed 0${i}`)]);
  await expect.poll(() => routeCalls.length).toBe(1);
  release();
  // The route's answer (the same rows here, plus any trigram row) replaces the list; still one call for the settled query.
  await expect.poll(() => names(page)).toContain("Qzxdevmed 09");
  expect(routeCalls).toHaveLength(1);
  expect(new URL(routeCalls[0]!).searchParams.get("q")).toBe("qzxdevmed 0");

  // A query only the trigram tail finds: nothing on the device, the route answers.
  await field(page).fill("");
  await field(page).pressSequentially("zqvdevtyporaw");
  await expect.poll(() => names(page), { timeout: 15_000 }).toContain("Zqvdevtyporow");
  // One call for the settled query (a prefix the device answered in full asked nothing).
  expect(routeCalls.filter((u) => new URL(u).searchParams.get("q") === "zqvdevtyporaw")).toHaveLength(1);
});

test("@golden offline, the device's ranks are still shown", async ({ page, context }) => {
  await openConsult(page, "MedOffline");
  await expectDevice(page);
  await context.setOffline(true);
  try {
    await field(page).click();
    await field(page).pressSequentially("qzxdevmed 1");
    await expect.poll(() => names(page)).toEqual(expect.arrayContaining(["Qzxdevmed 10", "Qzxdevmed 15"]));
    await expect(rx(page).getByText("Couldn't search medicines")).toHaveCount(0);
  } finally {
    await context.setOffline(false);
  }
});
