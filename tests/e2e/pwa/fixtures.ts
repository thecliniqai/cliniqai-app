/**
 * PWA e2e harness (V2-06 06-05 step 11; research A3, T-06-13). The only specs that let a service worker run: this
 * fixture sets `serviceWorkers: "allow"` (the config default stays "block"). It keeps the base fixture's loopback-only
 * network block and, because Chromium may send service-worker requests past `context.route`, it also records every
 * request the context sees (`context.on("request")`, service-worker requests included) and FAILS the test on any
 * non-loopback URL (the local Turnstile stub's script URL excepted: the base fixture answers it locally).
 *
 * 06-09a: on WebKit, a page the worker controls sends its subresource requests through the worker, and those requests
 * are NOT seen by `context.route`/`page.route` (probe: evidence/06-09a/webkit-sw-routing-probe.txt). After a sign-out
 * the worker controls `/login`, so its Turnstile script went to the real Cloudflare (and loaded its challenge frame)
 * instead of the local stub. Every PWA context therefore also gets a dead proxy with a loopback bypass: a request the
 * route never saw fails on this machine instead of leaving it. A spec that must intercept the app's own requests
 * (`page.route` aborts) does not need the worker and turns it off (`test.use({ serviceWorkers: "block" })`).
 *
 * Helpers read the device state the PWA specs assert on: every Cache Storage URL, storage keys, IndexedDB names.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, isAllowedBrowserUrl, isTurnstileScriptUrl, test as base } from "../fixtures";

interface PwaFixtures {
  /** Every URL a request was made for in this test's context, service-worker requests included. */
  requestedUrls: string[];
}

/** A proxy nothing listens on (port 9, discard): every non-loopback request that escaped routing fails locally. */
export const DEAD_PROXY = { server: "http://127.0.0.1:9", bypass: "127.0.0.1,localhost" };

export const test = base.extend<PwaFixtures>({
  serviceWorkers: async ({}, provide) => {
    await provide("allow");
  },
  proxy: async ({}, provide) => {
    await provide(DEAD_PROXY);
  },
  requestedUrls: [
    async ({ context }, provide) => {
      const urls: string[] = [];
      const onRequest = (request: { url(): string }) => {
        urls.push(request.url());
      };
      context.on("request", onRequest);
      await provide(urls);
      context.off("request", onRequest);
      const offsite = [...new Set(urls.filter((u) => !isAllowedBrowserUrl(u) && !isTurnstileScriptUrl(u)))];
      expect(offsite, "a page or service-worker request left the machine (PWA specs stay on loopback)").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Waits until a service worker controls `page` (installed, activated, `clients.claim()` done). */
export async function waitForServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15_000 });
}

export interface DeviceState {
  /** `<cache name>:<path + query>` for every entry of every cache (same-origin entries shown as paths). */
  cacheUrls: string[];
  cacheNames: string[];
  localKeys: string[];
  sessionKeys: string[];
  indexedDbNames: string[];
}

/**
 * Reads Cache Storage, local/session storage and IndexedDB as the page's origin sees them.
 *
 * Read it on a SETTLED device, never while a purge may still be deleting caches: `caches.open()` is open-or-create, so a
 * cache that `caches.keys()` listed and a purge deleted a moment later comes back, empty, under the same name (flake
 * l6-webkit-cache-internal-error: IND L-6 saw its `rogue-cache` "survive" that way on Linux WebKit). Wait for the purge
 * with {@link storageKeys} (no Cache Storage access), then read this once.
 */
export async function deviceState(page: Page): Promise<DeviceState> {
  return page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const cacheUrls: string[] = [];
    for (const name of cacheNames) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const url = new URL(request.url);
        cacheUrls.push(`${name}:${url.origin === location.origin ? `${url.pathname}${url.search}` : url.href}`);
      }
    }
    const keys = (s: Storage) => Array.from({ length: s.length }, (_, i) => s.key(i) ?? "");
    const dbs = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
    return {
      cacheUrls,
      cacheNames,
      localKeys: keys(localStorage),
      sessionKeys: keys(sessionStorage),
      indexedDbNames: dbs.map((d) => d.name ?? ""),
    };
  });
}

/**
 * `localStorage` and `sessionStorage` keys only: no Cache Storage access, so it can poll while a purge runs. The purge
 * (lib/pwa/purge.ts) empties Cache Storage first, then sessionStorage, then localStorage: once the keys show the purge,
 * its Cache Storage step has finished (or failed, which {@link deviceState} afterwards reveals).
 */
export async function storageKeys(page: Page): Promise<{ localKeys: string[]; sessionKeys: string[] }> {
  return page.evaluate(() => {
    const keys = (s: Storage) => Array.from({ length: s.length }, (_, i) => s.key(i) ?? "");
    return { localKeys: keys(localStorage), sessionKeys: keys(sessionStorage) };
  });
}

/**
 * The purge's LAST steps, read without touching Cache Storage: `sessionStorage` keys and IndexedDB database names. The
 * purge runs Cache Storage, then sessionStorage, then localStorage, then IndexedDB, one after the other, so once the
 * keys and databases a spec planted are gone every step has run and {@link deviceState} may read the settled device.
 * For a page the purge does not navigate away from (WebKit offline sign-out), where no URL change marks the end.
 * Flake pwa05-offline-signout-webkit: polling deviceState instead re-created, empty, the `rogue-cache` the purge deleted
 * while that poll was reading.
 */
export async function purgeProgress(page: Page): Promise<{ sessionKeys: string[]; indexedDbNames: string[] }> {
  return page.evaluate(async () => {
    const dbs = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
    return {
      sessionKeys: Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i) ?? ""),
      indexedDbNames: dbs.map((d) => d.name ?? ""),
    };
  });
}

/** The D-2 allowlist as the specs state it (independent of lib/pwa/purge.ts, so a wrong allowlist there is caught). */
export const SHELL_URLS = ["/offline", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];
/** 06-09a (M-OFFLINE): one shell cache per build, `shell-<stamp>`. */
export const SHELL_CACHE = /^shell-[A-Za-z0-9_-]{1,64}$/;
const isStatic = (url: string) => url.startsWith("/_next/static/") && !url.includes("_rsc=");
export function allowlisted(entry: string): boolean {
  const [name, ...rest] = entry.split(":");
  const url = rest.join(":");
  // The shell cache also holds the stylesheets the offline page links (06-09a: /offline is self-contained).
  if (SHELL_CACHE.test(name ?? "")) return SHELL_URLS.includes(url) || isStatic(url);
  if (name === "static-v1") return isStatic(url);
  return false;
}

/** The name of the worker's current shell cache on `page`'s origin (there is exactly one after activate). */
export async function shellCacheName(page: Page): Promise<string> {
  const names = (await page.evaluate(() => caches.keys())).filter((n) => SHELL_CACHE.test(n));
  expect(names, "exactly one shell cache").toHaveLength(1);
  return names[0]!;
}

/** D-3: the only localStorage keys allowed (lib/pwa/device-prefs.ts, restated). */
export const PREF_KEYS = [
  "clinicos.pref.installDismissedUntil",
  "clinicos.pref.signedInSessions",
  "clinicos.pref.density",
  "clinicos.pref.lastLane",
  "clinicos.pref.shortcuts",
];

const AUTH_COOKIE = /^sb-[a-z0-9-]+-auth-token(?:\.\d+)?$/;
export async function authCookies(context: BrowserContext): Promise<string[]> {
  return (await context.cookies()).filter((c) => AUTH_COOKIE.test(c.name) && c.value).map((c) => c.name);
}
