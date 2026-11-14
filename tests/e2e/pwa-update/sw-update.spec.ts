/**
 * V2-06 06-09a M-OFFLINE (independent review M-3): a second build replaces the installed service worker and its
 * precached `/offline`, which renders styled offline. Run with `npm run e2e:sw-update` (own config, under the e2e lane
 * lock; see playwright.sw-update.config.ts).
 *
 * One persistent Chromium profile (a device that keeps its worker) against two real builds of this tree served in turn
 * on 127.0.0.1:3100:
 *   build A: the device registers `/sw.js` exactly as the shell does; offline, a navigation shows A's `/offline`
 *            (`data-sw-build` = A's stamp), styled from the shell cache, with no script;
 *   build B: `/sw.js` carries a different stamp; the device's update check installs B's worker; once A's page is
 *            closed B activates, A's shell cache is gone, and offline the navigation shows B's `/offline`, styled.
 * Before 06-09a: `public/sw.js` was byte-identical across builds, so the update check found nothing and the device kept
 * build A's `/offline` for ever; its stylesheet lived in the FIFO static cache (evicted first).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { E2E_BASE_URL, ROOT } from "../support/app-env";
import { routeLoopbackOnly } from "../fixtures";

function build(label: string): void {
  const r = spawnSync("npx", ["tsx", "tests/e2e/support/build.ts"], { cwd: ROOT, stdio: "inherit" });
  expect(r.status, `e2e build ${label}`).toBe(0);
}

async function serve(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["--import", "tsx", "tests/e2e/support/serve.ts"], { cwd: ROOT, stdio: "inherit" });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`serve.ts exited (${child.exitCode})`);
    try {
      if ((await fetch(`${E2E_BASE_URL}/api/health`)).ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill("SIGTERM");
  throw new Error("the e2e server did not answer /api/health within 120 s");
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise((r) => child.once("exit", r));
  child.kill("SIGTERM");
  await exited;
}

async function stampOfServedWorker(): Promise<string> {
  const source = await (await fetch(`${E2E_BASE_URL}/sw.js`)).text();
  const stamp = /const BUILD = "([^"]+)";/.exec(source)?.[1];
  expect(stamp, "/sw.js carries a build stamp").toBeTruthy();
  return stamp!;
}

/** Offline, a navigation to a dashboard URL shows the precached /offline of `stamp`, styled, without scripts. */
async function expectStyledOffline(context: BrowserContext, page: Page, stamp: string): Promise<void> {
  await context.setOffline(true);
  await page.goto("/patients");
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  const view = await page.evaluate(() => {
    const main = document.querySelector("main")!;
    const retry = document.querySelector('a[href="/"]')!;
    return {
      build: document.documentElement.dataset.swBuild ?? null,
      scripts: document.scripts.length,
      sheets: document.styleSheets.length,
      mainDisplay: getComputedStyle(main).display,
      retryBackground: getComputedStyle(retry).backgroundColor,
    };
  });
  expect(view.build, "the served /offline is the one this build's worker precached").toBe(stamp);
  expect(view.scripts, "the offline document carries no script").toBe(0);
  expect(view.sheets, "its stylesheet loaded offline").toBeGreaterThan(0);
  expect(view.mainDisplay, "styled: the layout utilities applied").toBe("flex");
  expect(view.retryBackground, "styled: the accent button").not.toBe("rgba(0, 0, 0, 0)");
  await context.setOffline(false);
}

test("a second build installs a new worker whose /offline is served offline, styled; the old shell cache is gone", async () => {
  test.setTimeout(15 * 60_000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sw-update-"));
  let server: ChildProcess | null = null;
  let context: BrowserContext | null = null;
  try {
    build("A");
    server = await serve();
    const stampA = await stampOfServedWorker();
    context = await chromium.launchPersistentContext(profile, { baseURL: E2E_BASE_URL, serviceWorkers: "allow" });
    const blocked: string[] = [];
    await routeLoopbackOnly(context, blocked);
    let page = await context.newPage();
    await page.goto("/offline");
    // The same call the shell makes (lib/pwa/register-sw.ts).
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15_000 });
    expect(await page.evaluate(() => caches.keys())).toContain(`shell-${stampA}`);
    await expectStyledOffline(context, page, stampA);

    await stop(server);
    server = null;
    build("B");
    server = await serve();
    const stampB = await stampOfServedWorker();
    expect(stampB, "the second build has its own stamp").not.toBe(stampA);

    // The device's update check (as on a navigation, or 06-06's update() on resume) finds new bytes and installs B.
    await page.goto("/offline");
    await page.evaluate(async () => {
      const registration = (await navigator.serviceWorker.getRegistration("/"))!;
      await registration.update();
    });
    await expect
      .poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration("/"))?.waiting)), { timeout: 30_000 })
      .toBe(true);
    // A waiting worker takes over once no page uses the old one (06-06's update toast posts SKIP_WAITING instead).
    const next = await context.newPage();
    await page.close();
    page = next;
    await page.goto("/offline");
    await expect
      .poll(() => page.evaluate(async () => (await caches.keys()).filter((n) => n.startsWith("shell-")).sort()), { timeout: 30_000 })
      .toEqual([`shell-${stampB}`]);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15_000 });
    await expectStyledOffline(context, page, stampB);
    expect(blocked, "the device never left the machine").toEqual([]);
  } finally {
    await context?.close();
    if (server) await stop(server);
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
