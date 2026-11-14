/**
 * PWA spec 3 (PWA_STRATEGY §9.1, §3.7, §3.9, §5; V2-06 06-05; T-06-05). Signed in, the shell registers `/sw.js` with
 * scope `/` and it reaches `activated`; `/sw.js` is served `no-store` with the `script-src 'self'` CSP; the precache
 * holds exactly the five public URLs (≤ 150 kB together, PWA §3.9) plus, since 06-09a (M-OFFLINE), the stylesheets the
 * offline page links, in one cache per build (`shell-<stamp>`, the stamp `/sw.js` carries); the stored `/offline` has
 * no script. Before 06-05: no registration, `/sw.js` 404 (and signed out a 307 to /login).
 */
import { expect, shellCacheName, test, waitForServiceWorker, SHELL_URLS } from "./fixtures";
import { storageStatePath } from "../support/run-data";

test.use({ storageState: storageStatePath("owner") });

test("the shell registers /sw.js (scope /, update via cache: none) and it activates", async ({ page }) => {
  await page.goto("/");
  await waitForServiceWorker(page);
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration("/");
    return r ? { scope: new URL(r.scope).pathname, state: r.active?.state, script: new URL(r.active!.scriptURL).pathname, updateViaCache: r.updateViaCache } : null;
  });
  expect(reg).toEqual({ scope: "/", state: "activated", script: "/sw.js", updateViaCache: "none" });
});

test("/sw.js is served no-store with a same-origin-only CSP, signed in and signed out", async ({ page, playwright }) => {
  const anonymous = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  for (const res of [await page.request.get("/sw.js", { maxRedirects: 0 }), await anonymous.get("/sw.js", { maxRedirects: 0 })]) {
    expect(res.status()).toBe(200);
    const headers = res.headers();
    expect(headers["cache-control"]).toContain("no-store");
    expect(headers["content-security-policy"]).toBe("default-src 'self'; script-src 'self'");
    expect(headers["content-type"]).toBe("application/javascript; charset=utf-8");
  }
  await anonymous.dispose();
});

test("the precache holds the five public shell URLs (≤ 150 kB) and the offline page's stylesheets, in this build's cache", async ({ page }) => {
  await page.goto("/");
  await waitForServiceWorker(page);
  const name = await shellCacheName(page);
  const stamp = /const BUILD = "([^"]+)";/.exec(await (await page.request.get("/sw.js")).text())?.[1];
  expect(name, "the shell cache is named after the build /sw.js carries").toBe(`shell-${stamp}`);
  const shell = await page.evaluate(async (cacheName) => {
    const cache = await caches.open(cacheName);
    const out: Array<{ path: string; bytes: number; status: number; redirected: boolean }> = [];
    for (const request of await cache.keys()) {
      const res = (await cache.match(request))!;
      out.push({ path: new URL(request.url).pathname + new URL(request.url).search, bytes: (await res.blob()).size, status: res.status, redirected: res.redirected });
    }
    return out;
  }, name);
  const shellEntries = shell.filter((e) => SHELL_URLS.includes(e.path));
  const styles = shell.filter((e) => !SHELL_URLS.includes(e.path));
  expect(shellEntries.map((e) => e.path).sort()).toEqual([...SHELL_URLS].sort());
  expect(styles.length, "the offline page's stylesheet is precached with it").toBeGreaterThan(0);
  for (const style of styles) expect(style.path).toMatch(/^\/_next\/static\/.+\.css(\?.*)?$/);
  for (const entry of shell) expect(entry, entry.path).toMatchObject({ status: 200, redirected: false });
  const total = shellEntries.reduce((sum, e) => sum + e.bytes, 0);
  expect(total, `shell precache total ${total} bytes`).toBeLessThanOrEqual(150 * 1024);
  const styleBytes = styles.reduce((sum, e) => sum + e.bytes, 0);
  test.info().annotations.push({ type: "precache-bytes", description: `shell ${total}, stylesheets ${styleBytes}` });
  // The cached /offline is the public page, not a login page or a signed-in render; self-contained (no script).
  const offlineHtml = await page.evaluate(async (cacheName) => (await (await caches.open(cacheName)).match("/offline"))!.text(), name);
  expect(offlineHtml).toContain("Patient data isn");
  expect(offlineHtml).not.toContain("Sign in");
  expect(offlineHtml).not.toMatch(/<script/i);
  for (const style of styles) expect(offlineHtml).toContain(style.path);
});
