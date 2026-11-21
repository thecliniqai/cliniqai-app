/**
 * The G3 screenshot set (V2-06 06-08 step 3; roadmap V2-06 acceptance 2 and evidence "the screenshot set"; PO action
 * 06-P6). Every screen of `g3-screens.json` at the width of the running design project (360/820/1180/1280): every
 * `/dev/ui` section, the shell routes for the owner, the receptionist and the doctor, the palette, account menu and
 * More sheet, Login, `/offline`, the install card and sheet, the update toast, and the error / not-found / loading
 * states. Each screen writes `evidence/06-08/screens/<width>/<id>.png` (committed: the G3 set is the one PNG evidence of
 * the phase) and `<id>.json` (axe in the screen's scope, the whole page for reference where the scope leaves out the
 * v1 content in `<main>`, horizontal scroll). The test fails on a serious or critical axe violation in the screen's
 * scope or on horizontal scroll. `scripts/design/screenshot-index.mjs` then writes the index against the G2-D
 * references and fails on a missing capture.
 *
 * Runs only in the design-* projects (`npm run e2e:design`, `npm run e2e:g3`; the PR and nightly device lanes ignore
 * `tests/e2e/design/screens/**`). The repository is public: the run's synthetic seed only, no cookie or storage state
 * is written, and ids in recorded paths are replaced by `<id>`.
 */
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { ROOT } from "../../support/app-env";
import { freezeClock } from "../../support/clock";
import { readRunData, storageStatePath, type E2eRole } from "../../support/run-data";
import { settleAnimations } from "../../support/settle";
import { clickNavLink, holdNavigation } from "../../shell/support/slow-navigation";
import catalogue from "./g3-screens.json";

const OUT = path.join(ROOT, ".planning/phases/06-design-system-pwa-shell/evidence/06-08/screens");
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING = new Set(["serious", "critical"]);
/** The gallery's date section shows "today": a fixed clinic morning keeps the set stable (11:30 IST, 12 Nov 2026). */
const GALLERY_CLOCK = new Date("2026-11-12T06:00:00Z");
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

interface Screen {
  id: string;
  title: string;
  role: E2eRole | null;
  axeScope: string;
  axeGate: boolean;
  widths?: number[];
}
const SCREENS = catalogue.screens as Screen[];

/** `shot`: "viewport" or the selector of the element to capture; `cleanup` runs after the capture (pass or fail). */
type Capture = (page: Page) => Promise<{ shot: "viewport" | string; cleanup?: () => Promise<void> }>;

async function openRoute(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole("main").first()).toBeVisible();
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
}

const gallery =
  (section: string): Capture =>
  async (page) => {
    await freezeClock(page, GALLERY_CLOCK);
    await page.goto("/dev/ui");
    await expect(page.getByRole("heading", { level: 1, name: "Component gallery" })).toBeVisible();
    await expect(page.locator(`#${section}`)).toBeVisible();
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    return { shot: `#${section}` };
  };

const route =
  (url: () => string): Capture =>
  async (page) => {
    await openRoute(page, url());
    return { shot: "viewport" };
  };

async function iosDevice(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "maxTouchPoints", { configurable: true, get: () => 5 });
    if (!sessionStorage.getItem("clinicos.pref.signedInSessions")) localStorage.setItem("clinicos.pref.signedInSessions", "1");
    localStorage.removeItem("clinicos.pref.installDismissedUntil");
  });
}

const CAPTURES: Record<string, Capture> = {
  "gallery-forms": gallery("forms"),
  "gallery-overlays": gallery("overlays"),
  "gallery-data": gallery("data"),
  "gallery-dates": gallery("dates"),
  "gallery-clinical-a": gallery("clinical-a"),
  "gallery-clinical-b": gallery("clinical-b"),
  "gallery-ai": gallery("ai"),
  "gallery-shell": gallery("shell"),

  "owner-today": route(() => "/today"),
  "owner-calendar": route(() => "/calendar"),
  "owner-patients": route(() => "/patients"),
  "owner-patient": route(() => `/patients/${readRunData().tenantA.patientId}`),
  "owner-billing": route(() => "/billing/reports"),
  "owner-settings": route(() => "/settings/clinic"),
  "owner-palette": async (page) => {
    await openRoute(page, "/today");
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox").fill(readRunData().tenantA.patientName.slice(0, 4));
    await expect(dialog.getByRole("option").first()).toBeVisible();
    return { shot: "viewport" };
  },
  "owner-account-menu": async (page) => {
    await openRoute(page, "/today");
    await page.getByRole("button", { name: /^Account menu/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    return { shot: "viewport" };
  },
  "owner-more-sheet": async (page) => {
    await openRoute(page, "/today");
    await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "More" }).click();
    await expect(page.locator("[data-more-sheet]")).toBeVisible();
    return { shot: "viewport" };
  },

  "receptionist-today": route(() => "/today"),
  "receptionist-calendar": route(() => "/calendar"),
  "receptionist-patients": route(() => "/patients"),

  "doctor-today": route(() => "/today"),
  "doctor-consult": route(() => `/consultation/${readRunData().tenantA.visitId}`),

  login: async (page) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    return { shot: "viewport" };
  },
  offline: async (page) => {
    await page.goto("/offline");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    return { shot: "viewport" };
  },

  "install-card": async (page) => {
    await iosDevice(page);
    await openRoute(page, "/today");
    const card = page.locator("[data-install-card]");
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    return { shot: "viewport" };
  },
  "install-sheet": async (page) => {
    await iosDevice(page);
    await openRoute(page, "/today");
    await page.locator("[data-install-card]").getByRole("button", { name: "Install app" }).click();
    await expect(page.getByRole("dialog", { name: "Install CliniQ AI on this device" })).toBeVisible();
    return { shot: "viewport" };
  },
  "update-toast": async (page) => {
    await page.route("**/api/session-status", async (r) => {
      const response = await r.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      await r.fulfill({ response, json: { ...body, deploymentId: "e2e-next-deployment" } });
    });
    await openRoute(page, "/today");
    await expect(page.locator("[data-update-toast]").getByText("A new version is ready")).toBeVisible();
    return { shot: "viewport" };
  },

  "state-dashboard-not-found": async (page) => {
    await page.goto(`/patients/${randomUUID()}`);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    return { shot: "viewport" };
  },
  "state-dashboard-error": async (page) => {
    await page.goto("/diag/client-error");
    await page.getByRole("button", { name: "Throw a render error" }).click();
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
    return { shot: "viewport" };
  },
  "state-dashboard-loading": async (page) => {
    const nav = await holdNavigation(page, "/visits");
    await openRoute(page, "/today");
    await clickNavLink(page, "Visits", nav);
    await expect(page.getByRole("status", { name: "Loading" })).toBeVisible();
    // Below 768 px "Visits" is in the More sheet, which closes on navigation: capture the skeleton after it has gone.
    await expect(page.locator("[data-more-sheet]")).toHaveCount(0);
    return {
      shot: "viewport",
      cleanup: async () => {
        nav.release();
        await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0, { timeout: 15_000 });
      },
    };
  },
  "state-root-not-found": async (page) => {
    await page.goto("/no-such-page");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    return { shot: "viewport" };
  },
};

type Violation = { id: string; impact: string | null | undefined; nodes: number };
const summarise = (vs: Array<{ id: string; impact?: string | null; nodes: unknown[] }>): Violation[] =>
  vs.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));

async function axe(page: Page, scope: string) {
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  if (scope === "page without #main") builder = builder.exclude("#main");
  else if (scope !== "page") builder = builder.include(scope);
  return builder.analyze();
}

async function record(page: Page, screen: Screen, width: number, shot: string, testInfo: TestInfo): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await settleAnimations(page);
  const results = await axe(page, screen.axeScope);
  const blocking = results.violations
    .filter((v) => BLOCKING.has(v.impact ?? ""))
    .map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(" ")) }));
  const wholePage = screen.axeScope === "page without #main" ? summarise((await axe(page, "page")).violations) : undefined;
  const horizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  // On horizontal scroll, name the deepest elements that cross the right edge (diagnosis; recorded in the JSON).
  const overflowing = horizontalScroll
    ? await page.evaluate(() => {
        const edge = document.documentElement.clientWidth;
        const wide = [...document.querySelectorAll<HTMLElement>("body *")].filter(
          (el) => el.getBoundingClientRect().right > edge + 1 && getComputedStyle(el).position !== "fixed",
        );
        return wide
          .filter((el) => !wide.some((other) => other !== el && el.contains(other)))
          .slice(0, 5)
          .map((el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).slice(0, 6).join(".")}` : ""} right=${Math.round(el.getBoundingClientRect().right)}`);
      })
    : [];

  const dir = path.join(OUT, String(width));
  fs.mkdirSync(dir, { recursive: true });
  const png = path.join(dir, `${screen.id}.png`);
  if (shot === "viewport") await page.screenshot({ path: png, animations: "disabled", caret: "hide" });
  else await page.locator(shot).screenshot({ path: png, animations: "disabled", caret: "hide" });
  const summary = {
    id: screen.id,
    width,
    path: new URL(page.url()).pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>"),
    capture: shot === "viewport" ? "viewport" : `element ${shot}`,
    axe: { scope: screen.axeScope, gate: screen.axeGate, violations: summarise(results.violations), seriousOrCritical: blocking.length },
    ...(wholePage ? { wholePageForReference: wholePage } : {}),
    horizontalScroll,
    ...(overflowing.length ? { overflowing } : {}),
  };
  fs.writeFileSync(path.join(dir, `${screen.id}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  await testInfo.attach(`${screen.id}-${width}.json`, { body: JSON.stringify(summary, null, 2), contentType: "application/json" });

  if (screen.axeGate) expect(blocking, `${screen.id} at ${width}px: serious/critical axe violations in ${screen.axeScope}`).toEqual([]);
  expect(horizontalScroll, `${screen.id} at ${width}px: horizontal scroll`).toBe(false);
}

const ROLES: Array<E2eRole | null> = [...new Set(SCREENS.map((s) => s.role))];

for (const role of ROLES) {
  test.describe(role ?? "signed out", () => {
    test.use({ storageState: role ? storageStatePath(role) : { cookies: [], origins: [] } });

    for (const screen of SCREENS.filter((s) => s.role === role)) {
      test.describe(screen.id, () => {
        if (screen.id.startsWith("install-")) test.use({ userAgent: IPHONE_UA });

        test(`${screen.id}: ${screen.title}`, async ({ page }, testInfo) => {
          const width = testInfo.project.use.viewport?.width ?? 0;
          test.skip(!testInfo.project.name.startsWith("design-"), "the G3 set runs in the design-* projects only");
          test.skip(
            Boolean(screen.widths && !screen.widths.includes(width)),
            `${screen.id} exists only at ${screen.widths?.join("/")} px`,
          );
          const capture = CAPTURES[screen.id];
          if (!capture) throw new Error(`g3-screens.json lists ${screen.id} but the spec has no capture for it`);
          const { shot, cleanup } = await capture(page);
          try {
            await record(page, screen, width, shot, testInfo);
          } finally {
            await cleanup?.();
          }
        });
      });
    }
  });
}

test("every capture in the spec is listed in g3-screens.json", ({}, testInfo) => {
  test.skip(testInfo.project.name !== "design-1280", "checked once");
  expect(Object.keys(CAPTURES).sort()).toEqual(SCREENS.map((s) => s.id).sort());
});
