/**
 * The user (account) menu by keyboard (V2-06 06-02b; 03-12b carry-over: "user-menu dropdown focus management"; PWA D-5).
 * Before 06-02b the v1 Dropdown had no `aria-expanded`, no arrow keys, no Escape and no focus return: the menu was a
 * mouse widget with a keyboard-reachable button.
 *
 * As a fresh synthetic nurse (sign-out ends the session, so the shared seeded sessions are never used):
 * 1. Enter on the account button opens the menu (`aria-expanded="true"`) on its first item; ArrowDown walks every item
 *    in order and wraps; ArrowUp goes back; Escape closes it (`aria-expanded="false"`) with focus back on the button.
 * 2. Keyboard only, "Sign out" runs `hardSignOut()`: the server revokes the session (`auth.signout.done` with scope
 *    local in the server log), the device is purged (session storage, a stray cache, an IndexedDB database, a
 *    non-preference local key; the `clinicos.pref.*` key survives), no auth cookie remains, and the browser lands on
 *    /login.
 *
 * PR lane, desktop-chrome only (a keyboard spec; the pointer exit paths run on every project in pwa/05-cache-audit).
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { authCookies, deviceState } from "../pwa/fixtures";
import { freshMember, uiSignIn } from "../support/password-journeys";
import { logOffset, readLogFrom, SERVER_STDOUT_LOG } from "../support/server-log";

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "keyboard spec, desktop Chromium");
});

/** The scopes of the sign-outs the server completed after `offset` (its `auth.signout.done` log lines). */
function serverSignOuts(offset: number): string[] {
  return readLogFrom(SERVER_STDOUT_LOG, offset)
    .split("\n")
    .filter((line) => line.includes('"event":"auth.signout.done"'))
    .map((line) => (JSON.parse(line) as { reason: string }).reason);
}

async function dirtyDevice(page: Page) {
  await page.evaluate(async () => {
    localStorage.setItem("clinicos.pref.density", "compact");
    localStorage.setItem("recentPatient", "synthetic");
    sessionStorage.setItem("draftNote", "synthetic");
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
  expect(dirty.cacheNames).toContain("rogue-cache");
  expect(dirty.indexedDbNames).toContain("rogue-db");
  // 06-06: the shell also keeps the install card's per-session marker (a D-3 preference name) in sessionStorage.
  expect(dirty.sessionKeys.filter((k) => !k.startsWith("clinicos.pref."))).toEqual(["draftNote"]);
}

test("account menu: Enter opens it, arrows move through the items, Escape returns focus; Sign out by keyboard signs out and purges", async ({
  page,
  context,
}) => {
  await uiSignIn(page, await freshMember());
  const button = page.getByRole("button", { name: /^Account menu/ });
  await expect(button).toHaveAttribute("aria-haspopup", "menu");
  await expect(button).toHaveAttribute("aria-expanded", "false");

  await button.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(button).toHaveAttribute("aria-controls", (await menu.getAttribute("id"))!);

  // A nurse sees no "Clinic Profile"; the items in order, then ArrowDown wraps to the first.
  const order = ["My Profile", "Switch user", "Sign out", "Sign out of all devices"];
  await expect(menu.getByRole("menuitem")).toHaveText(order);
  for (const [i, name] of [...order, order[0]].entries()) {
    if (i > 0) await page.keyboard.press("ArrowDown", { delay: 50 });
    await expect(menu.getByRole("menuitem", { name, exact: true }), `item ${i + 1}`).toBeFocused();
  }
  await page.keyboard.press("ArrowUp", { delay: 50 });
  await expect(menu.getByRole("menuitem", { name: "Sign out of all devices" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute("aria-expanded", "false");

  // Keyboard-only sign-out.
  await dirtyDevice(page);
  await button.focus();
  const offset = logOffset(SERVER_STDOUT_LOG);
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "My Profile" })).toBeFocused();
  await page.keyboard.press("ArrowDown", { delay: 50 });
  await page.keyboard.press("ArrowDown", { delay: 50 });
  await expect(menu.getByRole("menuitem", { name: "Sign out", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");

  await page.waitForURL((url) => url.pathname === "/login");
  await expect.poll(() => serverSignOuts(offset)).toEqual(["local"]);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  const after = await deviceState(page);
  expect(after.sessionKeys).toEqual([]);
  // Device preferences only (D-3): the planted density and, from 06-06, the install card's session count.
  expect(after.localKeys.filter((k) => k !== "clinicos.pref.signedInSessions")).toEqual(["clinicos.pref.density"]);
  expect(after.cacheNames).not.toContain("rogue-cache");
  expect(after.indexedDbNames).toEqual([]);
  expect(await authCookies(context)).toEqual([]);
});
