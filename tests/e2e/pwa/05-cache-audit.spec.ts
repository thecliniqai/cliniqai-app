/**
 * PWA spec 5 (PWA_STRATEGY §4 "Verification", §9.1; V2-06 06-05; roadmap acceptance "the cache-audit spec finds no
 * authenticated response in Cache Storage" and "every sign-out path clears caches and storage"; T-06-01, T-06-03).
 *
 * Browse: signed in as the owner with the worker active, open Today, the seeded patient, the seeded consult, the billing
 * reports and fetch an invoice's receipt PDF; then every URL in every cache is on the D-2 allowlist (and the static
 * cache really is in use), IndexedDB is empty, local/session storage keys are D-3 preferences only, the patient page's
 * title does not carry the patient's name (D-7), and authenticated HTML and an RSC fetch are `private`/`no-store` (D-4).
 *
 * Exit paths (each with a fresh synthetic nurse, so the shared seeded sessions are never ended): sign out, sign out of
 * all devices (a second device loses its session), switch user, and offline sign-out (the server call fails, the
 * browser signs out locally, the purge runs and the navigation lands on the precached /offline; back online no auth
 * cookie is left). Before each exit the device is dirtied the way a careless library would: a session key, an unknown
 * local key, a non-allowlisted cache entry, a stray cache and an IndexedDB database, plus a preference key that must
 * survive. After each exit: caches hold only allowlisted URLs, sessionStorage is empty, only the `clinicos.pref.*` key
 * remains, IndexedDB is empty, no Supabase auth cookie remains, and Back shows no patient data. Before 06-05 (plain form
 * POST): caches, storage and Back were untouched. Expired and removed sessions: 06-06; idle: V2-11.
 */
import type { Page } from "@playwright/test";
import { allowlisted, authCookies, deviceState, expect, PREF_KEYS, test, waitForServiceWorker } from "./fixtures";
import { readRunData, storageStatePath } from "../support/run-data";
import { freshMember, otherDevice, uiSignIn, expectSignedOut } from "../support/password-journeys";
import { run, seedPatient, seedVisit, testTag } from "../support/m0-data";
import { getAdminClient } from "../../helpers/supabase-admin";
import { logOffset, readLogFrom, SERVER_STDOUT_LOG } from "../support/server-log";

const NO_STORE = /^(?=.*\bprivate\b)(?=.*\bno-store\b)/;

function expectAllowlistedOnly(cacheUrls: string[]) {
  expect(cacheUrls.filter((u) => !allowlisted(u)), "cache entries outside the D-2 allowlist").toEqual([]);
}

test.describe("browse as owner", () => {
  test.use({ storageState: storageStatePath("owner") });

  test("Today, a patient, a consult, billing and a receipt: nothing authenticated is cached or stored", async ({ page, context }) => {
    const data = run();
    const owner = data.tenantA.users.owner;
    // An invoice of this test's own completed visit (the shared seeded visit stays untouched).
    const patient = await seedPatient(data.tenantA.id, owner.id, `E2E Synthetic Cache Audit ${testTag()}`);
    const visitId = await seedVisit({
      tenantId: data.tenantA.id,
      patientId: patient.id,
      doctorId: data.tenantA.users.doctor.id,
      createdBy: owner.id,
      status: "completed",
    });
    const { data: invoice, error } = await getAdminClient()
      .from("invoices")
      .insert({
        tenant_id: data.tenantA.id,
        visit_id: visitId,
        patient_id: patient.id,
        invoice_number: `INV-PWA-${testTag()}`,
        subtotal: 300,
        total_amount: 300,
        status: "issued",
      })
      .select("id")
      .single();
    expect(error).toBeNull();

    const today = await page.goto("/");
    expect(today!.headers()["cache-control"]).toMatch(NO_STORE);
    await waitForServiceWorker(page);
    await page.reload();

    await page.goto(`/patients/${data.tenantA.patientId}`);
    await expect(page.getByText(data.tenantA.patientName).first()).toBeVisible();
    expect(await page.title()).not.toContain(data.tenantA.patientName);
    expect(await page.title()).not.toContain("E2E Synthetic");

    await page.goto(`/consultation/${data.tenantA.visitId}`);
    // Rendered (patient data is on the device in memory); v1's consult header is hidden at phone width (M0 layout).
    await expect(page.getByText(data.tenantA.patientName).first()).toBeAttached();
    expect(await page.title()).not.toContain(data.tenantA.patientName);

    await page.goto("/billing/reports");
    await expect(page.getByRole("main")).toBeVisible();
    const pdf = await page.evaluate(async (id) => {
      const res = await fetch(`/api/invoices/${id}/receipt-pdf`);
      return { status: res.status, type: res.headers.get("content-type") };
    }, (invoice as { id: string }).id);
    expect(pdf.status).toBe(200);

    // An RSC request with the session (what a client navigation sends) is private/no-store too.
    const rsc = await page.request.get(`/patients/${data.tenantA.patientId}?_rsc=pwa05`, { headers: { RSC: "1" } });
    expect(rsc.status()).toBe(200);
    expect(rsc.headers()["cache-control"]).toMatch(NO_STORE);

    const state = await deviceState(page);
    expectAllowlistedOnly(state.cacheUrls);
    expect(state.cacheUrls.some((u) => u.startsWith("static-v1:/_next/static/")), "the static cache is in use").toBe(true);
    expect(state.cacheUrls.filter((u) => u.startsWith("shell-v1:"))).toHaveLength(5);
    expect(state.indexedDbNames).toEqual([]);
    expect(state.localKeys.filter((k) => !PREF_KEYS.includes(k))).toEqual([]);
    expect(state.sessionKeys.filter((k) => !PREF_KEYS.includes(k))).toEqual([]);
    expect(await authCookies(context), "still signed in (browsing only)").not.toEqual([]);
  });
});

/** Puts on the device what a careless page or library could leave behind, plus one preference that must survive. */
async function dirtyDevice(page: Page) {
  await page.evaluate(async () => {
    localStorage.setItem("clinicos.pref.density", "compact");
    localStorage.setItem("recentPatient", "synthetic");
    sessionStorage.setItem("draftNote", "synthetic");
    await (await caches.open("static-v1")).put("/patients", new Response("synthetic page"));
    await (await caches.open("rogue-cache")).put("/api/patients", new Response("synthetic api"));
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("rogue-db", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("rows");
      open.onsuccess = () => {
        open.result.close();
        resolve();
      };
      open.onerror = () => reject(open.error);
    });
  });
  const dirty = await deviceState(page);
  expect(dirty.cacheUrls).toEqual(expect.arrayContaining(["static-v1:/patients", "rogue-cache:/api/patients"]));
  expect(dirty.indexedDbNames).toContain("rogue-db");
}

async function expectPurged(page: Page) {
  const state = await deviceState(page);
  expectAllowlistedOnly(state.cacheUrls);
  expect(state.cacheNames.filter((n) => n !== "static-v1" && n !== "shell-v1")).toEqual([]);
  expect(state.sessionKeys).toEqual([]);
  expect(state.localKeys).toEqual(["clinicos.pref.density"]);
  expect(state.indexedDbNames).toEqual([]);
}

async function openPatient(page: Page) {
  const { patientId, patientName } = readRunData().tenantA;
  await page.goto(`/patients/${patientId}`);
  await expect(page.getByText(patientName).first()).toBeVisible();
}

/**
 * The scopes of the `POST /auth/signout` calls the server completed after `offset` (its `auth.signout.done` log lines).
 * Read from the e2e server's log: `hardSignOut`'s POST is a `fetch` with `redirect: "manual"`; the page sees the 303 as
 * an opaque redirect (and the cookie deletions apply), but Playwright reports the request as failed (`net::ERR_ABORTED`)
 * and emits no response event (probe: evidence/06-05/signout-fetch-probe.txt).
 */
function serverSignOuts(offset: number): string[] {
  return readLogFrom(SERVER_STDOUT_LOG, offset)
    .split("\n")
    .filter((line) => line.includes('"event":"auth.signout.done"'))
    .map((line) => (JSON.parse(line) as { reason: string }).reason);
}

async function menuItem(page: Page, name: string) {
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  return page.getByRole("menuitem", { name, exact: true });
}

async function expectBackShowsNoPatient(page: Page) {
  await page.goBack();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByText(readRunData().tenantA.patientName)).toHaveCount(0);
}

test.describe("exit paths (fresh nurse each)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  async function signInFresh(page: Page) {
    const user = await freshMember();
    await uiSignIn(page, user);
    await waitForServiceWorker(page);
    await openPatient(page);
    await dirtyDevice(page);
    return user;
  }

  test("Sign out: purged, no auth cookie, Back shows no patient data", async ({ page, context }) => {
    await signInFresh(page);
    const offset = logOffset(SERVER_STDOUT_LOG);
    await (await menuItem(page, "Sign out")).click();
    await page.waitForURL((url) => url.pathname === "/login");
    await expect.poll(() => serverSignOuts(offset)).toEqual(["local"]);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expectPurged(page);
    expect(await authCookies(context)).toEqual([]);
    await expectBackShowsNoPatient(page);
  });

  test("Sign out of all devices: purged here, the second device loses its session", async ({ page, context, browser }) => {
    const user = await signInFresh(page);
    const device2 = await otherDevice(browser, user);
    const offset = logOffset(SERVER_STDOUT_LOG);
    await (await menuItem(page, "Sign out of all devices")).click();
    await page.waitForURL((url) => url.pathname === "/login");
    await expect.poll(() => serverSignOuts(offset)).toEqual(["global"]);
    await expectPurged(page);
    expect(await authCookies(context)).toEqual([]);
    await expectBackShowsNoPatient(page);
    await expectSignedOut(device2.page);
    expect(device2.blocked).toEqual([]);
    await device2.context.close();
  });

  test("Switch user: purged, plain login page with nothing prefilled", async ({ page, context }) => {
    await signInFresh(page);
    const offset = logOffset(SERVER_STDOUT_LOG);
    await (await menuItem(page, "Switch user")).click();
    await page.waitForURL((url) => url.pathname === "/login" && url.search === "");
    await expect.poll(() => serverSignOuts(offset)).toEqual(["local"]);
    await expect(page.getByLabel(/^Email/)).toHaveValue("");
    await expect(page.getByLabel(/^Password/)).toHaveValue("");
    await expectPurged(page);
    expect(await authCookies(context)).toEqual([]);
    await expectBackShowsNoPatient(page);
  });

  test("Offline sign-out: signed out locally, purged, lands on /offline; back online no auth cookie", async ({ page, context }) => {
    await signInFresh(page);
    const item = await menuItem(page, "Sign out");
    const offset = logOffset(SERVER_STDOUT_LOG);
    await context.setOffline(true);
    await item.click();
    await page.waitForURL((url) => url.pathname === "/login");
    expect(serverSignOuts(offset), "offline: the server was never reached").toEqual([]);
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    await expectPurged(page);
    expect(await authCookies(context)).toEqual([]);
    await expectBackShowsNoPatient(page);
    await context.setOffline(false);
    expect(await authCookies(context)).toEqual([]);
    await page.goto("/patients");
    await expect(page).toHaveURL((url) => url.pathname === "/login");
    await expect(page.getByText(readRunData().tenantA.patientName)).toHaveCount(0);
  });
});
