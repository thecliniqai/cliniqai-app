# V2-06 Wave A: adversarial review A (PWA: service worker, public paths, no-store, hardSignOut, signout-guard)

- Reviewer: adversarial reviewer A (fresh context; did not read the 06-0* records or 06-WAVE-NOTES until the findings below were established)
- Branch / HEAD: `v2/phase-06-design-system-pwa-shell` @ `ef24000`
- Build served: the existing e2e build (`.next/e2e-build-stamp.json`, build `o0ABh4Pfeip8Tzfvjl7YD`, 08:05Z). Since that build, only `app/offline/page.tsx` and `components/shell/offline-banner.tsx` changed (a CSS utility class each), so the build matches the reviewed code.
- Scope read: `public/sw.js`, `proxy.ts`, `lib/auth/public-paths.ts`, `lib/api/enabled.ts` (normaliser), `next.config.ts`, `lib/auth/hard-sign-out.ts`, `lib/pwa/{purge,cleanup,register-sw,device-prefs}.ts`, `app/auth/signout/route.ts`, `components/layout/user-dropdown.tsx`, `components/shell/pwa-runtime.tsx`, `app/{offline/page,manifest,layout}.tsx`, `scripts/ci/ui-policy/rules/signout-guard.mjs`, `scripts/pwa/kill-switch-sw.js`, `tests/e2e/pwa/{fixtures,05-cache-audit}.spec.ts`. Requirements: `06-PLAN.md` §06-05 and `docs/v2/PWA_STRATEGY.md` §3.6, §3.7, §4, §5.
- Method: static reading, then live probes against the e2e server (127.0.0.1:3100, local stack, synthetic users from global setup, all removed by the run teardown), run under the shared `e2e-lane.lock`. The probe specs were temporary and lived outside the repo afterwards (copied to the session scratchpad `adv-pwa-probe-copy/`). Logs: scratchpad `adv-pwa-run1.log` … `adv-pwa-run5-*.log`. I made no source edits.
- Note for the orchestrator: while this review ran, uncommitted 06-01b brand changes appeared in the same worktree (`app/icon.svg`, `public/icon-*.png`, `lib/design/tokens.ts`, `components/brand/` …). They are not mine, and they did not affect the probes, which used the pre-built `.next`.

## Summary

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 2 |
| Low | 3 |
| Info | 4 |

---

## High

### H-1 · On WebKit (iPhone, iPad, Safari) `hardSignOut()` never finishes: no purge, no `location.replace`, and the patient screen stays up showing "Signing out…"

**Where:** `lib/auth/hard-sign-out.ts` `run()` step 2. Interaction with `app/auth/signout/route.ts`, which answers `303` + `Clear-Site-Data: "cache"`.

**Reproduction (WebKit, Playwright "iPhone 15", local e2e server):**
1. Sign in as a fresh synthetic nurse. Copy the storage state into a context with **no request interception** (this rules out a Playwright-routing artefact), and open `/profile`.
2. Open the account menu and choose **Sign out**.
3. Separately, run these in the page with a race timer: `fetch("/auth/signout", {method:"POST", body: scope=local, redirect:"manual", credentials:"same-origin", signal: AbortSignal.timeout(5000)})`; the same fetch with `redirect:"follow"`; and a control, `POST /profile/` with `redirect:"manual"` (Next's 308, no Clear-Site-Data).

**Observed (`adv-pwa-run4.log`, `adv-pwa-run5-*.log`):**
- Chromium: the menu sign-out lands on `/login` and leaves 0 `sb-*` cookies.
- WebKit: after 15 s the page is still at `/profile`, the menu shows "Signing out…" (all items disabled), and the dashboard with the user's data is still on screen. The `sb-*` cookies are gone, because the server ran and its `Set-Cookie` deletions applied.
- WebKit primitives: `POST /auth/signout` with `redirect:"manual"` is still **HUNG after 8 s**, so the 5 s `AbortSignal.timeout` never rejected it. With `redirect:"follow"` it settles (`basic 200`). The control `POST /profile/` manual 308 settles (`opaqueredirect 0`). The stall is specific to the sign-out route's manual redirect: 303 + `Clear-Site-Data` under `redirect:"manual"`. I did not isolate which of the two triggers it.
- The first probe (in the PWA fixture, with interception on) shows the same stall: `menuitem "Signing out…" [disabled]` until the 30 s test timeout.

**Impact:**
- `await deps.fetch(...)` never settles, so steps 3 to 5 never run: no local fallback, no `purgeDeviceState()`, no `location.replace("/login")`.
- On every iOS/iPadOS device (the PWA's main tablet target) and on Safari desktop:
  - every exit path (`user`, `everywhere`, `switch`, and later `expired`, `removed`, `idle`) leaves the signed-in React tree with patient data on screen;
  - storage and Cache Storage are not purged;
  - the in-flight lock (`inFlight`) stays held for the life of the page, so every later `hardSignOut()` call returns the same stuck promise.
- The next person at a shared front-desk iPad sees the previous user's screen. The cookies being gone limits what further requests can fetch, but not what is already rendered or held in memory.
- CI cannot catch this: `05-cache-audit.spec.ts` has no `@golden` tag, so it runs on `desktop-chrome` and `pixel-7` only. `iphone-15` (WebKit) runs only `@golden` specs.

**Fix:**
1. Do not rely on `AbortSignal` alone. Race the server fetch with a timer (the file already has `withTimeout`), and run purge + `replace` in a `finally`, under an overall deadline, so no step can block the exit.
2. Make the fetch answer settle on WebKit. Either give fetch callers a non-redirect answer (e.g. `204` + `Clear-Site-Data` when the request says `Accept: application/json` or carries a header the helper sets; the no-JS form keeps the 303), or use `redirect:"follow"` and treat a final `/login` URL as success.
3. Run the exit-path half of `05-cache-audit.spec.ts` on `iphone-15` (tag those tests `@golden`, or add a WebKit project for `tests/e2e/pwa/`).

---

## Medium

### M-1 · "Sign out of all devices" quietly becomes a this-device-only sign-out, and the user is not told

**Where:** `hard-sign-out.ts` (fallback is `signOut({ scope: "local" })` whatever the reason), and `app/auth/signout/route.ts` (always `303`, even when `signOut({ scope: "global" })` failed).

**Reproduction:**
1. Fresh synthetic nurse signed in on device 1 and device 2.
2. On device 1, abort the `POST /auth/signout` request (`page.route(... abort("timedout"))`). This stands in for a 5 s timeout on a slow 4G link, or for being offline.
3. Choose **Sign out of all devices**.

**Observed (`adv-pwa-run1.log`, `everywhere-fallback`):**
- Device 1 lands on `/login` with no message of any kind (`device1ToldOfFailure: false`).
- Device 2 then opens `/patients` and stays there, still signed in (`device2Url: /patients`).

The same silent outcome happens online: if GoTrue's global sign-out errors, the route logs a warning, drops only this device's cookies and still sends the 303, and `serverSignedOut()` counts that as success.

**Impact:** this is the control a user reaches for after losing a phone or tablet. It can fail silently, and the lost device keeps a valid session and refresh token for patient data.

**Fix:**
- For `everywhere`, do not treat the local fallback as success. Land on `/login?signout=partial` (or similar) with "We couldn't sign out your other devices. Try again when you're online."
- Have the route tell the client whether the global revocation succeeded, e.g. a non-303 answer or a header such as `x-signout-scope: local` when global failed.
- Consider retrying the global revocation once the device is back online, since the session cookie is already gone; a queued server call keyed by user would do it.

### M-2 · Signing out in one tab or window leaves the other tabs showing patient data indefinitely, still interactive

**Where:** `hard-sign-out.ts` / `purge.ts`. Nothing tells the other browsing contexts of the origin: no `BroadcastChannel`, no `storage` event, no SW `postMessage`.

**Reproduction:**
1. Fresh synthetic nurse. Tab 1 is on Today; tab 2 is on `/patients/<seeded id>`.
2. Choose **Sign out** in tab 1.
3. Bring tab 2 to the front, dispatch `visibilitychange` and `focus`, and wait 17 s.

**Observed (`multi-tab`):** tab 2 is still at the patient URL and the patient name is still visible (`patientNameStillVisible: true`), while the context has 0 auth cookies.

**Impact:**
- A desktop front desk and a PWA window next to a browser tab are common. After "Sign out" or "Switch user", the next person finds the previous user's patient record open in the other tab.
- If that next person signs in (in any tab), the stale tab's client navigations and Server Actions run with the new user's cookies under the old user's UI, mixing two identities.
- 06-06's session-status poll (on resume, every 5 min) would narrow the window but does not close it.

**Fix:** have `hardSignOut()` post a `signout` message on a `BroadcastChannel("clinicos-auth")` (with `localStorage` write/remove as a fallback for older Safari). Every tab's `PwaRuntime` listens and runs the same cleanup → purge → `location.replace("/login")` without the server call. Add a two-page case to spec 5.

---

## Low

### L-1 · The `signout-guard` exemption is unsound: a browser-run module under `features/auth/` may call `auth.signOut`

**Where:** `scripts/ci/ui-policy/rules/signout-guard.mjs` (`allowed()`); 06-PLAN §06-05 step 10.

**Evidence:**
- The rule exempts any `features/auth/**` file without a `"use client"` directive, on the premise that such files are server code. The plan's step 10 names `password-flows.ts` as one of "today's server calls".
- In fact, `features/auth/password-flows.ts` has no directive and is imported by the `"use client"` pages `app/(auth)/forgot-password/page.tsx` and `app/(auth)/login/page.tsx`. Its `abandonReset()` calls `client.auth.signOut({ scope: "local" })` in the browser (`password-flows.ts:221`).
- So the guard already lets a browser-side `signOut` through, and any new helper placed in `features/auth/` would pass too.
- The rule can also be evaded with:
  - a computed name (`` auth[`sign${"Out"}`]() ``, `auth["sign" + "Out"]`);
  - `Reflect.get(auth, "signOut")`;
  - a direct `fetch(`${url}/auth/v1/logout`)`.
- `proxy.ts` (root) is outside the scanned roots (it signs out server-side, which is acceptable).

**Impact today:** low. `abandonReset` ends a recovery session on `/forgot-password`, where there is no PHI. But the control does not enforce what it claims.

**Fix:**
- Exempt files by explicit name, not by directory plus directive.
- Treat files imported by a client module as client code. At minimum, flag `features/auth/password-flows.ts` explicitly and list it as an allowed client exception with a reason.
- Add a fixture for a directive-less `features/auth/` file imported from a client page.
- Also flag string literals `"signOut"` / `"/auth/v1/logout"` outside the allowed files.

### L-2 · `hardSignOut()` has no overall deadline; any purge step that never settles blocks the exit

**Where:** `run()`: `deps.purge()` has no timeout.

- `purgeIndexedDb` awaits `indexedDB.databases()` and each `deleteDatabase`; a `blocked` event resolves, but a request that fires neither `success`, `error` nor `blocked` waits forever. `caches.*` has no timeout either.
- H-1 shows a browser primitive can hang in practice.

**Fix:** one deadline (e.g. 8 s) around steps 1 to 4, with `replace("/login")` in `finally`. This is the same fix as H-1 point 1.

### L-3 · A second `hardSignOut()` call with a stronger reason is silently dropped

**Where:** `hardSignOut()`: `inFlight ??= run(reason, …)`.

- A call with `everywhere` while a `user`/`idle`/`expired` run is in flight returns the first promise, so the global revocation never happens.
- The menu disables its items, but 06-06 (expired/removed) and V2-11 (idle) add callers that can overlap with a user click.

**Fix:** if the new reason is `everywhere` and the running one is not, chain a global revocation after the current run, or record the strongest pending scope and use it.

---

## Info

- **I-1 · Exits that skip the purge by design (for the 06-06 / V2-11 owners):**
  - the proxy's H-AUTH revocation (`continueSignedOut`);
  - `setNewPasswordAction`'s global sign-out after a reset;
  - signing in on `/login` over an existing session (replaces user A's cookies with user B's without purging A's device state).

  None leaves PHI on the device today, because nothing PHI-bearing is stored, but none goes through `hardSignOut()`. If `/login` and `/forgot-password` stay reachable while signed in, consider `hardSignOut("switch")` before a sign-in that would replace a live session.
- **I-2 · `static-v1` outlives users.** It keeps route chunks (for example `/settings/developer`'s chunk), which reveal which screens were opened on a shared device. This is not PHI, and it is allowed by D-2.
- **I-3 · Next 16 RSC requests without `_rsc`** answer `307` (cache-busting enforcement) with `private, no-store`. Signed-out `/offline` is `s-maxage=31536000` (static, PHI-free), and signed-in it is `private, no-store`. Both fine.
- **I-4 · Harness:** on WebKit, the PWA fixture's `requestedUrls` check fails on the login page's Turnstile sub-requests (`challenges.cloudflare.com/...` are recorded, then blocked by the route). If WebKit is added to the PWA lane (H-1 fix 3), the Turnstile stub must also answer WebKit's sub-frame requests.

---

## Attacks that failed (the controls held)

1. **Public-path tricks, signed out:**
   - Tried: `/offline/..%2Fpatients`, `/offline/..%2fpatients`, `/offline/%2e%2e/patients`, `/offline/.%2e/patients`, `/offline%2F..%2Fpatients`, `/offline;/patients`, `/OFFLINE`; `/sw.js/..%2Fpatients`, `/sw.js%2F..%2Fpatients`; `/manifest.webmanifest/..%2Fpatients` and its `%2F` form; `/offline/..%2Fpatients%2F<id>`; `/icon-192.png/..%2Fpatients`; `/patients%2F<id>.png`.
   - Result: all `307 → /login`. `/offline/` gives `308 → /offline`; `/offline?x=/patients` gives the static offline page; none returned dashboard content or PHI.
2. **Matcher-excluded prefixes:** `/_next/static/..%2F..%2Fpatients%2F<id>`, `/_next/static/..%2fpatients`, `/_next/static/chunks/..%2F..%2F..%2Fpatients`, `/favicon.ico/..%2Fpatients`, `/x.png`, `/patients.png` all answer `404` with `private, no-store`. `/_next/image?url=/patients/...` answers `500` with no content (images config).
3. **Proxy-skip headers:** `x-middleware-subrequest` set to `proxy`/`src/proxy`/`middleware` ×5 (CVE-2025-29927 shape) and `RSC: 1`, signed out: `307 → /login`.
4. **`private, no-store` on signed-in responses, GET and HEAD:**
   - Checked: `/`, `/patients/<id>`, `/patients/<id>?x=1`, `/consultation/<id>`, unknown patient id (404), `/does-not-exist` (404), traversal variants that normalise to `/api` (`/patients/..%2F..%2Fapi%2Fx`: 404, still `private, no-store` from Next's own default), `/offline`, `/login`, `/clinic/new` (prerendered), `/manifest.webmanifest`, `/sw.js`.
   - All carry `private, no-cache, no-store, must-revalidate, max-age=0`. The trailing slash gives a 308 with no body.
   - RSC, prefetch and segment-prefetch headers also carry `private, no-store`. `/api/patients/<id>/export` gives `no-store`.
5. **Service worker cache scope:**
   - From a controlled page, fetched `/_next/static/..%2F..%2Fpatients%2F<id>` (404, not stored), `/_next/static/%2e%2e/%2e%2e/patients/<id>` (the URL parser normalises it to `/patients/<id>`, so it never matched `/_next/static/`; 200 `private, no-store`, not stored), `/_next/static/x/..%2F..%2F..%2Fpatients%2F<id>` (404) and a nonexistent chunk (404).
   - Afterwards, every Cache Storage entry outside `/_next/static/{chunks,css,media}` was exactly the five shell URLs.
   - Static reading: cross-origin and non-GET requests return before `respondWith`; `storable()` refuses non-`basic`, redirected, `private` or `no-store` responses; `install` refuses redirected or non-200 precache answers; the precache uses `credentials:"omit"`. An `RSC: 1` request under `/_next/static/` is not cached.
6. **Registering a different worker:** the scope is capped by the script path and no `Service-Worker-Allowed` header is sent, so a root-scope worker needs a same-origin JS response at `/`, which needs XSS.
7. **Back after sign-out (Chromium), stronger than spec 5:**
   - Steps: patient page, then a `pushState` entry on the same document, then a second full document (`/profile`), then sign out, then Back ×3.
   - Every entry went to `/login?next=…`; no PHI.
8. **Cookie purge on the Chromium paths:** 0 `sb-*` cookies after sign-out (chunked names are covered by the regex).
