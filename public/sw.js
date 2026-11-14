/*
 * clinicOS service worker (V2-06 06-05; PWA_STRATEGY §4 D-1/D-2, §5; ruling R-12). Plain JS, no imports, no build step.
 *
 * NO PHI ON THE DEVICE. This worker stores only a positive allowlist:
 *   shell-v1   /offline, /manifest.webmanifest and the three manifest icons, precached at install, fetched signed out
 *              (credentials "omit"); install FAILS on a non-200 or redirected answer, so a login page is never cached.
 *   static-v1  /_next/static/** (content-hashed build output, PHI-free), cache-first, at most 200 entries.
 * Navigations go to the network (navigation preload when enabled) and are never stored; on a network failure the
 * precached /offline page is shown. Every other request (RSC payloads `?_rsc=` / `RSC: 1`, Server Action POSTs, /api,
 * /auth, share-token pages, /_next/image, anything cross-origin or not GET) gets no respondWith and goes straight to
 * the network.
 *
 * Changing this file: bump the cache names (old caches are deleted on activate), keep tests/pwa/sw-allowlist.spec.ts
 * green, and get the adversarial review (T-06-01). Kill switch and runbook: docs/runbooks/pwa.md.
 */
"use strict";

const STATIC_CACHE = "static-v1";
const SHELL_CACHE = "shell-v1";
const STATIC_MAX_ENTRIES = 200;
const PRECACHE = ["/offline", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
});

async function precache() {
  // Fetch everything first: a refused answer aborts install before anything is written.
  const responses = [];
  for (const url of PRECACHE) {
    const response = await fetch(url, { credentials: "omit", cache: "no-store" });
    if (!response.ok || response.redirected || response.type !== "basic") {
      throw new Error(`sw: precache refused ${url} (status ${response.status})`);
    }
    responses.push([url, response]);
  }
  const cache = await caches.open(SHELL_CACHE);
  for (const [url, response] of responses) await cache.put(url, response);
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
    event.respondWith(cacheFirst(request)); // D-2; the key keeps the query (`?dpl=`).
  }
  // Everything else: no respondWith (the browser fetches it as if there were no worker).
});

async function networkThenOffline(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    const offline = await caches.match("/offline", { cacheName: SHELL_CACHE });
    return offline || Response.error();
  }
}

function storable(response) {
  if (!response.ok || response.type !== "basic" || response.redirected) return false;
  const cacheControl = (response.headers.get("Cache-Control") || "").toLowerCase();
  return !cacheControl.includes("no-store") && !cacheControl.includes("private");
}

async function cacheFirst(request) {
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
