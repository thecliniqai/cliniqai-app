# Runbook: PWA service worker, offline page and sign-out purge

Owner: V2-06 (06-05, revised by 06-09a; 06-06 adds the update toast, `/api/session-status` and the install UX). Source rules:
`docs/v2/PWA_STRATEGY.md` §3.1, §3.6, §4 (D-1…D-8), §5. Threats T-06-01…T-06-06, T-06-20.

## What the service worker may store (the allowlist)

The worker is hand-written plain JS (no imports, no build step) kept as a string in
`lib/pwa/service-worker-source.ts` and served by `app/sw.js/route.ts` with this build's stamp (06-09a M-OFFLINE: the
stamp, `CLINICOS_BUILD_STAMP` from `next.config.ts`, changes the bytes of `/sw.js` on every deploy, so every browser
installs the new worker; 06-05's static `public/sw.js` never changed, so a device kept its first `/offline`). It stores
only:

| Cache | Contents | How |
|---|---|---|
| `shell-<build>` | `/offline`, `/manifest.webmanifest`, `/icon-192.png`, `/icon-512.png`, `/icon-maskable-512.png`, and the `/_next/static/**.css` stylesheets `/offline` links | Precached at `install`, fetched with `credentials: "omit"` and `cache: "no-store"`; install **fails** on a non-200, redirected or non-`basic` answer (a login redirect is never cached). `/offline` is stored without its scripts (it needs none), with `data-sw-build` on `<html>`; its stylesheets are answered from this cache, so offline it renders styled after any deploy. One cache per build: `activate` deletes the others |
| `static-v1` | `/_next/static/**` (content-hashed build output; the key keeps `?dpl=`) | Cache-first; at most 200 entries, oldest evicted; only plain 200 `basic` answers without `private`/`no-store` |

Navigations go to the network (navigation preload) and are **never stored**; when the network fails, the precached
`/offline` page answers. Every other request gets no `respondWith`: RSC payloads (`?_rsc=`, `RSC: 1`), Server
Action POSTs, `/api/**`, `/auth/**`, `/r/**`, `/reschedule/**`, `/reports/**`, `/_next/image`, anything cross-origin
(Supabase, storage, providers) and anything that is not GET.

Proof: `tests/pwa/sw-allowlist.spec.ts` (the worker in a `node:vm` sandbox), `tests/e2e/pwa/05-cache-audit.spec.ts`
(a real browser: after browsing Today, a patient, a consult and the billing register, every cached URL is on the
allowlist) and `tests/e2e/pwa-update/sw-update.spec.ts` (`npm run e2e:sw-update`: two real builds; after the second
the installed worker serves the second build's `/offline`, styled, and the first build's cache is gone).

Headers (the route, and `next.config.ts` on the path): `/sw.js` is served `application/javascript; charset=utf-8`,
`Cache-Control: no-cache, no-store, must-revalidate`, `Content-Security-Policy: default-src 'self'; script-src 'self'`. The worker is registered
with `updateViaCache: "none"` from the authenticated shell only (`components/shell/pwa-runtime.tsx`), and never in
`APP_ENV=development` (`next dev` chunks are not content-hashed).

Authenticated pages and RSC responses carry `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`
from `proxy.ts` (D-4), so the browser's HTTP cache does not keep them either.

## Changing the worker

1. Edit the worker in `lib/pwa/service-worker-source.ts`. The shell cache is renamed by every build already; if what
   `static-v1` stores changes, **bump its name** (`static-v2`, and `STATIC_CACHE_NAME` in `lib/pwa/purge.ts`):
   `activate` deletes every cache whose name is not current, so old entries go with the old worker.
2. Keep `tests/pwa/sw-allowlist.spec.ts` green and extend it for the new behaviour. Never add a cache for navigations,
   RSC, `/api` or anything cross-origin (D-1).
3. Every `sw.js` diff gets the adversarial security review (T-06-01).
4. Clients pick the new worker up on their next navigation check (`updateViaCache: "none"`, `no-store` on `/sw.js`).
   It waits until 06-06's update toast posts `{ type: "SKIP_WAITING" }` at a safe point (no unsaved input).

## Kill switch

If a deployed worker misbehaves (serves something it must not, or breaks navigation), deploy
`scripts/pwa/kill-switch-sw.js` **unchanged** as `public/sw.js`, in place of the `/sw.js` route (Next refuses a public
file and a route at the same path, so the route goes in the same commit):

```sh
git rm -r app/sw.js && cp scripts/pwa/kill-switch-sw.js public/sw.js   # then commit, review and deploy as usual
```

Browsers fetch `/sw.js` with no HTTP cache, install it at once, and it deletes every cache, unregisters itself and
reloads open windows so they run without a worker. Keep it deployed until the fixed worker is ready (at least one full
working day, so long-open tablets pick it up), then restore the route with the fixed worker (a new build stamp).
`tests/pwa/sw-allowlist.spec.ts` runs the kill-switch file in a `node:vm` sandbox (takes over at once, deletes every
cache, unregisters, reloads windows, answers nothing).

## Sign-out and the device purge

Every exit path calls `hardSignOut(reason)` (`lib/auth/hard-sign-out.ts`; reasons `user`, `everywhere`, `switch`,
`expired`, `removed`, `idle`, and `recovery` for the forgot-password page, which does not navigate). Order (06-09a: no
step can hold the exit; every await is raced against a real timer and steps 1 to 4 share an 8 s deadline):

1. `runCleanups("signout")` (`lib/pwa/cleanup.ts`): Realtime unsubscribes, in-flight aborts, in-memory state.
2. `announceSignOut()` (`lib/pwa/auth-broadcast.ts`): every other open tab of the device hides its content, purges and
   goes to `/login` (BroadcastChannel `clinicos-auth`, with a `storage` event fallback; no server call from those tabs).
3. `POST /auth/signout` as a fetch caller (header `x-clinicos-signout: fetch`, 5 s cap; `scope=global` only for "Sign
   out of all devices"): GoTrue revokes the session, the auth cookies are deleted, `Clear-Site-Data: "cache"`. The
   route answers fetch callers JSON (200 revoked, 502 not revoked but this device signed out), never a redirect:
   WebKit never settles a `redirect: "manual"` fetch of a 303 carrying `Clear-Site-Data` (06-09a H-WEBKIT).
4. If that call failed (offline, timeout): the browser client's `auth.signOut` with the same scope, and the Supabase
   auth cookies are expired in the browser. This is the only client `signOut` call allowed (`signout-guard` UI-policy
   rule, enforced in CI).
5. Always: `purgeDeviceState()` (`lib/pwa/purge.ts`; 3 s cap): Cache Storage entries outside the allowlist above (and
   caches with other names) deleted, `sessionStorage` cleared, `localStorage` keys outside `lib/pwa/device-prefs.ts`
   removed, every IndexedDB database deleted. Then `location.replace("/login")`: a hard navigation, so no React tree
   with patient data survives (offline: the worker answers with `/offline`).

"Sign out of all devices" lands on `/login?signout=partial`, with a notice that the other devices are still signed in,
whenever neither the route nor the browser client got GoTrue to revoke every session; the no-JavaScript form gets the
same target from the route. The plain form POST to `/auth/signout` stays in the user menu as the no-JavaScript
fallback.

Sessions the server ends without `hardSignOut()` (the proxy's H-AUTH revocation, the global sign-out after a password
reset, signing in on `/login` over a live session) are purged when `/login` is reached (`lib/pwa/session-arrival.ts`):
with no session cookie left, the login page purges the device and sends the other tabs away; a sign-in that replaced a
live session does the same before the new user's pages load.

`localStorage` may hold only the `clinicos.pref.*` keys listed in `lib/pwa/device-prefs.ts` (D-3): no identifiers, no
patient data. Adding a key means adding it there, with a reason.

## Checking a device by hand

Chrome DevTools → Application: **Service workers** shows `/sw.js` activated; **Cache storage** shows only one
`shell-<build>` and `static-v1` with the URLs above; **Local storage** only `clinicos.pref.*`; **IndexedDB** empty. After
sign-out the same, with `sessionStorage` empty and no `sb-*-auth-token` cookie.
