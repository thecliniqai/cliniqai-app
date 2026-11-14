/**
 * PWA e2e harness (V2-06 06-05 step 11; research A3, T-06-13). The only specs that let a service worker run: this
 * fixture sets `serviceWorkers: "allow"` (the config default stays "block"). It keeps the base fixture's loopback-only
 * network block and, because Chromium may send service-worker requests past `context.route`, it also records every
 * request the context sees (`context.on("request")`, service-worker requests included) and FAILS the test on any
 * non-loopback URL (the local Turnstile stub's script URL excepted: the base fixture answers it locally).
 *
 * Helpers read the device state the PWA specs assert on: every Cache Storage URL, storage keys, IndexedDB names.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, isAllowedBrowserUrl, isTurnstileScriptUrl, test as base } from "../fixtures";

interface PwaFixtures {
  /** Every URL a request was made for in this test's context, service-worker requests included. */
  requestedUrls: string[];
}

export const test = base.extend<PwaFixtures>({
  serviceWorkers: async ({}, provide) => {
    await provide("allow");
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

/** Reads Cache Storage, local/session storage and IndexedDB as the page's origin sees them. */
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
];

const AUTH_COOKIE = /^sb-[a-z0-9-]+-auth-token(?:\.\d+)?$/;
export async function authCookies(context: BrowserContext): Promise<string[]> {
  return (await context.cookies()).filter((c) => AUTH_COOKIE.test(c.name) && c.value).map((c) => c.name);
}
