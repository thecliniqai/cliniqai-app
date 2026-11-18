/**
 * The clinicOS service worker's source (V2-06 06-05, moved here from `public/sw.js` by 06-09a M-OFFLINE; PWA_STRATEGY
 * §4 D-1/D-2, §5; ruling R-12). `app/sw.js/route.ts` serves {@link serviceWorkerSource} with this build's stamp, so
 * every deploy changes the bytes of `/sw.js` and every browser installs the new worker on its next update check (06-05's
 * static file never changed, so a device kept the first deploy's `/offline` for ever). The worker itself is plain JS in
 * a string: no imports, no build step, run by tests/pwa/sw-allowlist.spec.ts in a `node:vm` sandbox.
 *
 * NO PHI ON THE DEVICE. The worker stores only a positive allowlist:
 *   shell-<build>  /offline, /manifest.webmanifest and the three manifest icons, precached at install, fetched signed out
 *                  (credentials "omit"); install FAILS on a non-200 or redirected answer, so a login page is never
 *                  cached. `/offline` is stored as a self-contained document: the stylesheets it links (public,
 *                  content-hashed `/_next/static/**.css`) are precached with it, and its scripts are removed, so offline
 *                  it renders styled and never tries to hydrate against chunks a later deploy no longer has. One cache
 *                  per build; `activate` deletes every other.
 *   static-v1      /_next/static/** (content-hashed build output, PHI-free), cache-first, at most 200 entries.
 * Navigations go to the network (navigation preload when enabled) and are never stored; on a network failure the
 * precached /offline page is shown. Every other request (RSC payloads `?_rsc=` / `RSC: 1`, Server Action POSTs, /api,
 * /auth, share-token pages, /_next/image, anything cross-origin or not GET) gets no respondWith and goes straight to
 * the network.
 *
 * Changing the worker: keep tests/pwa/sw-allowlist.spec.ts green and get the adversarial review (T-06-01); the build
 * stamp already renames the shell cache. Kill switch and runbook: docs/runbooks/pwa.md.
 */
export const BUILD_PLACEHOLDER = "__CLINICOS_BUILD__";
/** The headers `/sw.js` is served with (the route; `next.config.ts` sets the same on the path). */
export const SW_HEADERS = {
  "Content-Type": "application/javascript; charset=utf-8",
  "Cache-Control": "no-cache, no-store, must-revalidate",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'",
} as const;

/** A stamp the worker accepts as part of a cache name; anything else is refused by {@link serviceWorkerSource}. */
export const BUILD_STAMP_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const SOURCE = String.raw`"use strict";

const BUILD = "${BUILD_PLACEHOLDER}";
const STATIC_CACHE = "static-v1";
const SHELL_CACHE = "shell-" + BUILD;
const STATIC_MAX_ENTRIES = 200;
const PRECACHE = ["/offline", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];
const OFFLINE = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
});

async function fetchPublic(url) {
  const response = await fetch(url, { credentials: "omit", cache: "no-store" });
  if (!response.ok || response.redirected || response.type !== "basic") {
    throw new Error("sw: precache refused " + url + " (status " + response.status + ")");
  }
  return response;
}

// Same-origin /_next/static/ stylesheets linked by the offline page (public, content-hashed, PHI-free).
function stylesheetsOf(html) {
  const out = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (!/\brel=["']?stylesheet\b/i.test(tag)) continue;
    const href = /\bhref=["']([^"']+)["']/i.exec(tag);
    if (!href) continue;
    const url = new URL(href[1].replace(/&amp;/g, "&"), self.location.origin);
    if (url.origin !== self.location.origin || !url.pathname.startsWith("/_next/static/")) continue;
    if (url.searchParams.has("_rsc")) continue;
    if (!out.includes(url.pathname + url.search)) out.push(url.pathname + url.search);
  }
  return out;
}

// The offline document needs no JavaScript (Retry is a plain link): its scripts and script preloads are removed.
function withoutScripts(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b[^>]*\bas=["']?script\b[^>]*>/gi, "")
    .replace(/<html\b/i, '<html data-sw-build="' + BUILD + '"');
}

async function precache() {
  // Fetch everything first: a refused answer aborts install before anything is written.
  const entries = [];
  for (const url of PRECACHE) entries.push([url, await fetchPublic(url)]);
  const html = await entries[0][1].text();
  for (const href of stylesheetsOf(html)) entries.push([href, await fetchPublic(href)]);
  entries[0][1] = new Response(withoutScripts(html), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
  const cache = await caches.open(SHELL_CACHE);
  for (const [url, response] of entries) await cache.put(url, response);
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== STATIC_CACHE && name !== SHELL_CACHE) await caches.delete(name);
      }
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

// 06-06's update toast applies a waiting worker at a safe point (no unsaved input) by posting this message.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isRsc(request, url) {
  return url.searchParams.has("_rsc") || request.headers.get("RSC") === "1";
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return; // D-1: Server Actions and every write go to the network.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // D-1: Supabase, storage, providers: never touched.

  if (request.mode === "navigate") {
    event.respondWith(networkThenOffline(event));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") && !isRsc(request, url)) {
    event.respondWith(cacheFirst(request)); // D-2; the key keeps the query (?dpl=).
  }
  // Everything else: no respondWith (the browser fetches it as if there were no worker).
});

async function networkThenOffline(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    const offline = await caches.match(OFFLINE, { cacheName: SHELL_CACHE });
    return offline || Response.error();
  }
}

function storable(response) {
  if (!response.ok || response.type !== "basic" || response.redirected) return false;
  const cacheControl = (response.headers.get("Cache-Control") || "").toLowerCase();
  return !cacheControl.includes("no-store") && !cacheControl.includes("private");
}

async function cacheFirst(request) {
  // The offline page's stylesheets live with it in the shell cache (never evicted by the static cap).
  const shellHit = await caches.match(request, { cacheName: SHELL_CACHE });
  if (shellHit) return shellHit;
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (storable(response)) {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - STATIC_MAX_ENTRIES; i++) await cache.delete(keys[i]); // oldest first
  }
  return response;
}
`;

/** The worker script for `build` (a stamp matching {@link BUILD_STAMP_PATTERN}). */
export function serviceWorkerSource(build: string): string {
  if (!BUILD_STAMP_PATTERN.test(build)) throw new Error("service worker: invalid build stamp");
  return SOURCE.replace(BUILD_PLACEHOLDER, build);
}
