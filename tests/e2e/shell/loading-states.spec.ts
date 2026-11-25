/**
 * Loading states for the pages 06-04a left without one (V2-06 06-04b; P1-28 M3 "loading for every route group";
 * 06-04a deviation 1): Today, Patients, a patient, the consult, the calendar and the
 * billing reports show the route skeleton during a slow client navigation, AND their full-page status codes are
 * unchanged by the new boundaries: a record that is not the caller's still answers 404 (journey-09's rule) and a role
 * redirect still answers 307 (the decisions run in the segment layouts above the boundaries). desktop-chrome.
 */
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { readRunData, storageStatePath } from "../support/run-data";
import AxeBuilder from "@axe-core/playwright";
import { clearSupabaseLatency, setSupabaseLatency } from "../support/latency";
import { clickNavLink, holdNavigation } from "./support/slow-navigation";

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "status codes and navigation are width-independent");
});

async function status(page: Page, url: string): Promise<{ status: number; location: string | null }> {
  const res = await page.request.get(url, { maxRedirects: 0 });
  const location = res.headers()["location"];
  return { status: res.status(), location: location ? new URL(location, "http://x").pathname : null };
}

test.describe("full-page status codes are kept", () => {
  test.describe("owner of clinic A", () => {
    test.use({ storageState: storageStatePath("owner") });

    test("another clinic's patient and visit, an unknown id and a malformed id answer 404", async ({ page }) => {
      const { tenantB } = readRunData();
      for (const url of [
        `/patients/${tenantB.patientId}`,
        `/patients/${randomUUID()}`,
        "/patients/not-a-uuid",
        `/consultation/${tenantB.visitId}`,
        `/consultation/${randomUUID()}`,
        "/consultation/not-a-uuid",
      ]) {
        expect((await status(page, url)).status, url).toBe(404);
      }
      const own = readRunData().tenantA;
      expect((await status(page, `/patients/${own.patientId}`)).status).toBe(200);
      expect((await status(page, `/consultation/${own.visitId}`)).status).toBe(200);
    });
  });

  test.describe("doctor", () => {
    test.use({ storageState: storageStatePath("doctor") });
    test("/ redirects to Today with 307 (R-14); billing reports to Today with 307", async ({ page }) => {
      expect(await status(page, "/")).toEqual({ status: 307, location: "/today" });
      expect(await status(page, "/billing/reports")).toEqual({ status: 307, location: "/today" });
    });
  });

  test.describe("receptionist", () => {
    test.use({ storageState: storageStatePath("receptionist") });
    test("the retired queue and cabin addresses redirect to Today with 308 (R-14, next.config.ts)", async ({ page }) => {
      expect(await status(page, "/queue")).toEqual({ status: 308, location: "/today" });
      expect(await status(page, "/cabin")).toEqual({ status: 308, location: "/today" });
    });
  });
});

test.describe("the skeleton shows during a slow client navigation", () => {
  test.use({ storageState: storageStatePath("owner") });

  for (const [name, path, from] of [
    ["Today", "/today", "/patients"],
    ["Patients", "/patients", "/today"],
    ["Schedule", "/schedule", "/today"],
    ["Billing & Reports", "/billing/reports", "/today"],
  ] as const) {
    test(`${name} (${path})`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const nav = await holdNavigation(page, path);
      await page.goto(from);
      await expect(page.getByRole("main")).toBeVisible();
      // 06-09e: wait for the page we start from to finish streaming (its own loading skeleton gone), so its content,
      // which can hold a link of the same name, is always on screen when
      // the nav link is clicked. Before, the click raced Today's render: locally (a busy shared stack) Today was still
      // its skeleton, on CI it had rendered, and the unscoped locator then matched two links (strict mode).
      await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0, { timeout: 15_000 });
      await clickNavLink(page, name, nav);
      await expect(page.getByRole("status", { name: "Loading" })).toBeVisible();
      nav.release();
      await page.waitForURL((url) => url.pathname === path);
      await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0, { timeout: 15_000 });
    });
  }

  test("a patient record opened from Patients (its links are not prefetched, R-9): the skeleton shows once the layout has answered, then the record", async ({ page, context }) => {
    const { tenantA } = readRunData();
    const path = `/patients/${tenantA.patientId}`;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/patients");
    await page.getByPlaceholder("Search by name, phone, or ABHA...").fill(tenantA.patientName);
    const link = page.getByRole("main").locator(`a[href="${path}"]`).first();
    await expect(link).toBeVisible();
    await setSupabaseLatency(context, 300);
    try {
      // 09E-14a (flake F3): the skeleton is on screen only while the page's own calls are pending (about 300 ms per call here), and a polling assertion can look
      // between two frames. A MutationObserver on this document (a client navigation keeps it) records that the status appeared, whatever the polling does.
      await page.evaluate(() => {
        const w = window as unknown as { __sawLoading: boolean };
        w.__sawLoading = false;
        const look = () => {
          if (document.querySelector('[role="status"][aria-label="Loading"]')) w.__sawLoading = true;
        };
        new MutationObserver(look).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      });
      await link.click();
      await page.waitForURL((url) => url.pathname === path);
      await expect.poll(() => page.evaluate(() => (window as unknown as { __sawLoading: boolean }).__sawLoading), { message: "the skeleton showed after the click" }).toBe(true);
      await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0, { timeout: 15_000 });
    } finally {
      clearSupabaseLatency();
    }
  });
});

/**
 * V2-09e 09E-06 (R-9, B-2): every main screen shows a skeleton of its own layout while its calls are pending: 0.7 s is added to every Supabase call
 * (workers: 1, so no other spec sees it; cleared after each test), the screen is entered by a client navigation, the skeleton is there (its kind is the
 * screen's), axe finds nothing on it, and the screen's content replaces it. At 360, 820 and 1280.
 */
const SKELETON_PAGES = [
  { name: "Today", path: "/today", from: "/patients", kind: "today" },
  { name: "Schedule", path: "/schedule", from: "/today", kind: "schedule" },
  { name: "Patients", path: "/patients", from: "/today", kind: "list" },
  // Not prefetched (R-9), so its layout answers first and the record's own reads run beside it (one round trip): the record has no gap to fill with a route
  // skeleton; what is pending when it first paints is the history (streamed), which has its own.
  { name: "a patient (history streams)", path: () => `/patients/${readRunData().tenantA.patientId}`, from: "/patients", kind: "patient-history" },
  { name: "Visits", path: "/visits", from: "/today", kind: "list" },
  { name: "Billing reports", path: "/billing/reports", from: "/today", kind: "list" },
  { name: "Settings, clinic", path: "/settings/clinic", from: "/today", kind: "settings" },
  { name: "Settings, subscription", path: "/settings/billing", from: "/today", kind: "settings" },
  { name: "Settings, developer", path: "/settings/developer", from: "/today", kind: "settings" },
  { name: "Staff", path: "/staff", from: "/today", kind: "list" },
  { name: "Profile", path: "/profile", from: "/today", kind: "settings" },
  { name: "Referrals", path: "/referrals", from: "/today", kind: "list" },
] as const;

test.describe("every main screen shows its own skeleton while its calls are pending (300 ms and more per call)", () => {
  test.use({ storageState: storageStatePath("owner") });
  test.afterEach(() => clearSupabaseLatency());

  for (const width of [360, 820, 1280]) {
    for (const def of SKELETON_PAGES) {
      test(`${def.name} at ${width} px`, async ({ page, context }) => {
        test.setTimeout(120_000);
        const path = typeof def.path === "function" ? def.path() : def.path;
        await page.setViewportSize({ width, height: 900 });
        await page.goto(def.from);
        await expect(page.getByRole("main")).toBeVisible();
        await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0, { timeout: 20_000 });
        if (def.kind !== "patient-history") {
          // The loading boundary is prefetched before the click (see slow-navigation.ts: a prefetch still in flight at the click hides the skeleton); at 360 px
          // the link may be in the More sheet, so the prefetch is asked for explicitly and awaited.
          const prefetched = page.waitForResponse((r) => new URL(r.url()).pathname === path && r.request().headers()["next-router-prefetch"] !== undefined && r.request().headers()["next-router-segment-prefetch"] !== "/_tree", { timeout: 15_000 }).catch(() => null);
          await page.evaluate((href) => (window as unknown as { next: { router: { prefetch(h: string): void } } }).next.router.prefetch(href), path);
          await prefetched;
          await page.waitForTimeout(500);
        }
        // The history is the quick part to catch: it gets a longer wait, so axe can run while its skeleton is up.
        await setSupabaseLatency(context, def.kind === "patient-history" ? 1_800 : 700);
        await page.evaluate((href) => (window as unknown as { next: { router: { push(h: string): void } } }).next.router.push(href), path);
        const history = def.kind === "patient-history";
        // 09E-14a (B): the record's first paint waits for its `patient.view` audit row again (fail-closed), beside the history's own chain, so the two finish about
        // together and the history skeleton may never show on its own. What a person sees after the layout has answered is the patient's route skeleton, then the
        // record (and the history's skeleton when the history is the slower of the two): either is a skeleton, and both are checked when they show.
        const skeleton = history ? page.getByRole("status", { name: /^Loading/ }).first() : page.locator(`[data-route-skeleton="${def.kind}"]`);
        await expect(skeleton).toBeVisible({ timeout: 10_000 });
        // The skeleton's own region (the shell around it has its own axe specs).
        const axe = await new AxeBuilder({ page }).include(history ? '[role="status"][aria-label^="Loading"]' : '[role="status"][aria-label="Loading"]').analyze();
        expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`), "axe on the skeleton").toEqual([]);
        await page.waitForURL((url) => url.pathname === path);
        await expect(page.getByRole("status", { name: /^Loading/ })).toHaveCount(0, { timeout: 30_000 });
      });
    }
  }
});
