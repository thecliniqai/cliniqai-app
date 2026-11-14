# Runbook: PWA service worker, offline page and sign-out purge

Owner: V2-06 (06-05; 06-06 adds the update toast, `/api/session-status` and the install UX). Source rules:
`docs/v2/PWA_STRATEGY.md` §3.1, §3.6, §4 (D-1…D-8), §5. Threats T-06-01…T-06-06, T-06-20.

## What the service worker may store (the allowlist)

`public/sw.js` is hand-written plain JS (no imports, no build step). It stores only:

| Cache | Contents | How |
|---|---|---|
| `shell-v1` | `/offline`, `/manifest.webmanifest`, `/icon-192.png`, `/icon-512.png`, `/icon-maskable-512.png` | Precached at `install`, fetched with `credentials: "omit"` and `cache: "no-store"`; install **fails** on a non-200, redirected or non-`basic` answer (a login redirect is never cached) |
| `static-v1` | `/_next/static/**` (content-hashed build output; the key keeps `?dpl=`) | Cache-first; at most 200 entries, oldest evicted; only plain 200 `basic` answers without `private`/`no-store` |

Navigations go to the network (navigation preload) and are **never stored**; when the network fails, the precached
`/offline` page answers. Every other request gets no `respondWith`: RSC payloads (`?_rsc=`, `RSC: 1`), Server
Action POSTs, `/api/**`, `/auth/**`, `/r/**`, `/reschedule/**`, `/reports/**`, `/_next/image`, anything cross-origin
(Supabase, storage, providers) and anything that is not GET.

Proof: `tests/pwa/sw-allowlist.spec.ts` (the worker in a `node:vm` sandbox) and `tests/e2e/pwa/05-cache-audit.spec.ts`
(a real browser: after browsing Today, a patient, a consult and the billing register, every cached URL is on the
allowlist).

Headers (`next.config.ts`): `/sw.js` is served `application/javascript; charset=utf-8`, `Cache-Control: no-cache,
no-store, must-revalidate`, `Content-Security-Policy: default-src 'self'; script-src 'self'`. The worker is registered
with `updateViaCache: "none"` from the authenticated shell only (`components/shell/pwa-runtime.tsx`), and never in
`APP_ENV=development` (`next dev` chunks are not content-hashed).

Authenticated pages and RSC responses carry `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`
from `proxy.ts` (D-4), so the browser's HTTP cache does not keep them either.

## Changing the worker

1. Edit `public/sw.js`. If what is stored changes, **bump the cache names** (`static-v2`, `shell-v2`): `activate`
   deletes every cache whose name is not current, so old entries go with the old worker.
2. Keep `tests/pwa/sw-allowlist.spec.ts` green and extend it for the new behaviour. Never add a cache for navigations,
   RSC, `/api` or anything cross-origin (D-1).
3. Every `sw.js` diff gets the adversarial security review (T-06-01).
4. Clients pick the new worker up on their next navigation check (`updateViaCache: "none"`, `no-store` on `/sw.js`).
   It waits until 06-06's update toast posts `{ type: "SKIP_WAITING" }` at a safe point (no unsaved input).

## Kill switch

If a deployed worker misbehaves (serves something it must not, or breaks navigation), deploy this body as
`public/sw.js` **verbatim**. Browsers fetch `/sw.js` with no HTTP cache, install it at once, and it deletes every cache,
unregisters itself and reloads open windows so they run without a worker. Keep it deployed until the fixed worker is
ready (at least one full working day, so long-open tablets pick it up), then deploy the fixed worker with bumped cache
names. `tests/pwa/sw-allowlist.spec.ts` parses and runs the block between the markers; do not edit it here without
keeping that test green.

<!-- kill-switch:begin -->
```js
/* clinicOS service worker KILL SWITCH (docs/runbooks/pwa.md). Deletes every cache and unregisters itself. */
"use strict";
self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) await caches.delete(name);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
    })(),
  );
});
```
<!-- kill-switch:end -->

## Sign-out and the device purge

Every exit path calls `hardSignOut(reason)` (`lib/auth/hard-sign-out.ts`; reasons `user`, `everywhere`, `switch`,
`expired`, `removed`, `idle`). Order:

1. `runCleanups("signout")` (`lib/pwa/cleanup.ts`): Realtime unsubscribes, in-flight aborts, in-memory state.
2. `POST /auth/signout` (`redirect: "manual"`, 5 s timeout; `scope=global` only for "Sign out everywhere"): GoTrue
   revokes the session, the auth cookies are deleted, `Clear-Site-Data: "cache"`.
3. If that call failed (offline, timeout): the browser client's `auth.signOut({ scope: "local" })` and the Supabase auth
   cookies are expired in the browser. This is the only client `signOut` call allowed (`signout-guard` UI-policy rule,
   enforced in CI).
4. `purgeDeviceState()` (`lib/pwa/purge.ts`): Cache Storage entries outside the allowlist above (and caches with other
   names) deleted, `sessionStorage` cleared, `localStorage` keys outside `lib/pwa/device-prefs.ts` removed, every
   IndexedDB database deleted.
5. `location.replace("/login")`: a hard navigation, so no React tree with patient data survives (offline: the worker
   answers with `/offline`).

The plain form POST to `/auth/signout` stays in the user menu as the no-JavaScript fallback.

`localStorage` may hold only the `clinicos.pref.*` keys listed in `lib/pwa/device-prefs.ts` (D-3): no identifiers, no
patient data. Adding a key means adding it there, with a reason.

## Checking a device by hand

Chrome DevTools → Application: **Service workers** shows `/sw.js` activated; **Cache storage** shows only
`shell-v1` and `static-v1` with the URLs above; **Local storage** only `clinicos.pref.*`; **IndexedDB** empty. After
sign-out the same, with `sessionStorage` empty and no `sb-*-auth-token` cookie.
