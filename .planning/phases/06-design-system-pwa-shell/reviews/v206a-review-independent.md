---
phase: 06-design-system-pwa-shell
scope: V2-06 Wave A (git log --first-parent 745a6b7..HEAD, merge ba69ebd excluded) - plans 06-01a, 06-07, 06-04a, 06-05
reviewed_at_commit: ef24000
reviewed: 2026-11-14
reviewer: independent Claude reviewer (fresh context; per-plan records and wave notes not read)
depth: deep on the service worker, hardSignOut, purge, proxy no-store, client error capture and the sign-out guard; standard on the rest
findings:
  high: 0
  medium: 4
  low: 6
  info: 8
  total: 18
status: issues_found
---

# V2-06 Wave A: independent review

## Summary

There are no High findings. The riskiest code is the service worker, `hardSignOut`, the device purge, the proxy
`no-store` marking and the client render-error capture. Each of them holds its main promise: no authenticated response
goes into Cache Storage, every exit through the user menu clears the device, and no message, stack or concrete path
reaches `ops.error_events`. I found four Medium issues:

1. **"Sign out of all devices" can fail without any sign.** When GoTrue fails, the user is told it worked, but the
   other devices stay signed in.
2. **The client error sink can be flooded.** Its per-day cap is counted per server instance, so it does not protect
   the database's shared daily cap on serverless.
3. **The precached `/offline` page never refreshes.** It is tied to the first build's CSS and text, because `sw.js`
   never changes between deploys.
4. **The enforced `signout-guard` rule has a blind spot.** It wrongly assumes that any `features/auth/` file without
   "use client" is server code. `password-flows.ts` runs in the browser and calls `auth.signOut`.

The 06-01a codemod lists its colour collapses as the plan requires, and I found no leftover references to the deleted
`--brand-*` or `:root` variables. The CI wiring is correct as far as I could check. One title regression and a few
robustness gaps are listed as Low.

## Verified by running

- Ran 14 Wave A unit spec files with a scratch Vitest config that has no DB global setup. Another run held the
  local-stack lock, and I did not touch the stack. Result: 14 files, 171 tests, all pass. The files:
  `tests/pwa/{sw-allowlist,purge,hard-sign-out,device-prefs,icons}.spec.ts`,
  `tests/ci/{ui-policy,ui-policy-signout-guard,route-js,lhci-config}.spec.ts`,
  `tests/observability/client-render-event.spec.ts`, `tests/errors/client-error-kind.spec.ts` and `tests/design/*`.
- `node scripts/ci/ui-policy.mjs`: PASS. The enforced rules (`brand-utility`, `screen-height`, `signout-guard`) have
  0 findings. That result is itself the evidence for M-4: `features/auth/password-flows.ts:221` calls
  `client.auth.signOut` in the browser and is not flagged.
- `npx playwright test --list --project=pixel-7 --project=iphone-15`: `design/route-states-axe.spec.ts` is listed on
  pixel-7 but skips itself outside desktop-chrome. The design-capture and perf specs are not listed in the PR lanes.
- In the local build `.next/server/app/offline.html`, the precached `/offline` HTML references build-hashed assets,
  for example `/_next/static/chunks/44rvfy7cy9h1e.css` and the turbopack runtime chunk. This supports M-3.
- Grep found no `var(--brand-*)`, `--canvas-bg`, `--text-primary` or `brand-<step>` users left in
  app/components/features/lib.

Not run: the Playwright e2e specs (they need the local stack, which another run was using) and `npm run typecheck` or
lint.

## Medium

### M-1: "Sign out of all devices" reports success when the global revocation failed

- **Where:** `lib/auth/hard-sign-out.ts:67-70` (`serverSignedOut`), `:90-110`; `app/auth/signout/route.ts:79-101`
  (V2-03 route, but 06-05 makes its 303 the success signal).
- **Failure scenario:** A doctor's phone is lost, so they press "Sign out of all devices" on the clinic PC. GoTrue
  times out or answers 5xx. The route sets `failed = true`, deletes this device's cookies and still answers
  `303 /login`. `hardSignOut` treats any opaque redirect as success, purges this device and lands on `/login`. The
  doctor believes every device is signed out, but the lost phone's refresh token is still valid and keeps PHI access.
  The same thing happens when the POST fails outright (403 on an Origin mismatch, offline, timeout). The fallback is
  hard-coded to `auth.signOut({ scope: "local" })` (`:54`), so an "everywhere" request silently becomes a local-only
  sign-out with no message. `tests/pwa/hard-sign-out.spec.ts` only checks that `scope=global` is posted.
- **Fix:**
  - Make the outcome visible. The route should answer differently when `scope=global` failed, for example
    `303 /login?signout=partial`, or a 200 or 409 for the `fetch` path. `hardSignOut("everywhere")` should then
    report it to the user, for example a notice on `/login` saying "Other devices could not be signed out; try again".
  - In the fallback, pass the reason through: `signOutLocally(scope)` with `scope: "global"` for "everywhere" while
    online.
  - Add a unit case: "everywhere" plus a failing server leads to a global client sign-out attempt and a reported
    partial outcome.

### M-2: Client error sink flood bound is per server instance; one member can use up the shared daily fingerprint cap

- **Where:** `lib/observability/client-render-event.ts:80-103` (`admitClientKey`, module-level `Set`);
  `features/observability/actions.ts:31-47`; DB cap in `supabase/migrations/000028_ops_error_events.sql:77-90,223-230`.
- **Failure scenario:** Any signed-in member, including a nurse or receptionist, can call `reportClientRenderError`
  directly with made-up names (any `[A-Za-z0-9_.$-]{1,80}`) and made-up lowercase route slugs. Each one is a new
  fingerprint. The cap is 50 keys "per server instance and UTC day", but on Vercel each warm instance has its own
  counter, so concurrent calls spread across N instances allow 50·N new fingerprints. The database cap
  (`ops.error_sink_daily_cap()`, 500 per day, shared with server errors) is reached, and real server errors only
  increment the overflow counter for the rest of the day. That blinds ops, which is exactly what the module docstring
  says this prevents. There is also no limit on repeating an already-admitted key: every call does a `log.warn` and an
  RPC round trip to `ops.ingest_error_event`, so one member can generate unbounded log and DB write volume.
- **Fix:**
  - Enforce the client bound where it is shared. Give client events their own sub-cap inside the ingest RPC, for
    example new `client.*` fingerprints at most 50 per day in the DB. Alternatively, rate-limit per user or tenant
    with the existing rate-limit table.
  - Add a per-session or per-user throttle on the action, for example at most N reports per minute, and drop
    repeats without logging.

### M-3: The precached `/offline` page never refreshes after deploys, and its CSS is not precached

- **Where:** `public/sw.js:18-39` (fixed `SHELL_CACHE = "shell-v1"`, filled only on `install`); `:95-105` (FIFO
  eviction); `lib/pwa/register-sw.ts:9-10` (fixed `/sw.js` URL).
- **Failure scenarios:**
  1. Browsers reinstall a worker only when the bytes of `/sw.js` change. The file has no build stamp, so after the
     first install, shell-v1 keeps the `/offline` HTML of that first deployment forever. 06-01b will change the brand
     name, colours and `globals.css`; every device that installed the Wave A worker keeps showing "ClinicQ" and the
     old markup offline until someone remembers to edit `sw.js`. The header comment only says "bump the cache names"
     when this file changes, not when `/offline` or the CSS changes.
  2. The cached HTML references build-hashed CSS and JS (verified in `.next/server/app/offline.html`). Those assets
     are not precached; they are in `static-v1` only if a controlled page load happened to fetch them. Eviction is
     FIFO, and cache hits never move an entry to the back, so the root CSS (cached first) is the first entry evicted
     once 200 entries build up over a few deploys. `Clear-Site-Data: "cache"` on every sign-out also clears the HTTP
     cache that could otherwise serve it. Result: an unstyled `/offline` page, which is also where an offline sign-out
     lands.
- **Fix:**
  - Stamp the build into the worker: generate `public/sw.js` at build time with `const BUILD = "<buildId>"` and cache
    names `shell-<BUILD>`, or register `/sw.js?v=<release>`.
  - At install, precache the `/offline` page's CSS. Parse the `<link rel="stylesheet">` URLs from the fetched HTML,
    or make `/offline` self-contained with inline critical CSS and no client JS.
  - In `cacheFirst`, re-`put` on a hit, or keep shell assets in shell-v1, so the shell's dependencies are never
    evicted first.

### M-4: `signout-guard` (enforced) exempts browser code under `features/auth/`

- **Where:** `scripts/ci/ui-policy/rules/signout-guard.mjs:9,17-29`; the unflagged call is in
  `features/auth/password-flows.ts:219-225` (`abandonReset`). That file is imported by the "use client" page
  `app/(auth)/forgot-password/page.tsx:8,75,157,170,178`, and its own docstring says it "run[s] in the browser".
- **Failure scenario:** The rule treats "no `"use client"` directive" as "server module". In the App Router, a module
  without the directive that is imported by a client component is bundled and run in the browser. Today
  `password-flows.ts` (listed in the rule's docstring as a "server sign-out") calls `client.auth.signOut` in the
  browser without the device purge. Any future browser helper added under `features/auth/` without the directive can
  likewise call `signOut` and skip `hardSignOut()`, and the enforced T-06-06 guard stays green. I confirmed this by
  running it: the repository reports 0 findings. The direct PHI impact today is small, because the recovery flow runs
  before any dashboard page. The weakness is in the guard's logic.
- **Fix:**
  - Exempt a `features/auth/` file only when it has `import "server-only"`, as `service.ts` does.
  - Add `features/auth/password-flows.ts` to an explicit, commented allowlist for the recovery-session
    `abandonReset`, or route that call through a purge.
  - Add a fixture: a directive-less module under `features/auth/` imported by a client page is a finding.

## Low

### L-1: Older Safari (iOS 15 and below) never reaches the server sign-out

- **Where:** `lib/auth/hard-sign-out.ts:96`.
- **Scenario:** `AbortSignal.timeout` is missing before Safari 16. Many low-cost and older iPhones in the target
  market are capped at iOS 15. On those devices the call throws inside the `try`, `serverOk` stays `false`, and every
  sign-out takes the local path. GoTrue is never told, and "everywhere" never revokes other devices (compounds M-1).
- **Fix:** Use an `AbortController` plus `setTimeout`, or feature-detect `AbortSignal.timeout`.

### L-2: Page titles carry the brand twice after the new title template

- **Where:** `app/layout.tsx:12` (`template: "%s · ClinicQ"`) combined with
  `app/(dashboard)/settings/developer/page.tsx:9` ("Developer Settings | ClinicQ"), `referrals/page.tsx:12`,
  `profile/page.tsx:7` and `billing/reports/page.tsx:12` (each with "ClinicOS").
- **Scenario:** The template wraps those page titles, so they render as "Developer Settings | ClinicQ · ClinicQ" and
  "My Profile · ClinicOS · ClinicQ": a visible v1 regression in the tab and app-switcher title.
- **Fix:** Strip the brand suffix from those four page titles (the plain words "Developer Settings" and so on).

### L-3: `viewport-fit=cover` on v1 screens that have no safe-area padding

- **Where:** `app/layout.tsx:20-27`. The only safe-area user is `components/shell/offline-banner.tsx:17`.
- **Scenario:** With `cover`, iPhone content goes under the notch in landscape and behind the home indicator in
  standalone mode. The v1 fixed sidebar (`components/layout/app-sidebar.tsx:148`), the right-side drawers
  (`components/calendar/booking-drawer.tsx:233`) and the bottom footers of modals and drawers have no `px-safe` or
  `pb-safe`. The plan prescribes `viewportFit: "cover"` in 06-05, but the shell that uses the insets is 06-04b.
- **Fix:** Defer `viewportFit: "cover"` to 06-04b, or add `px-safe`/`pb-safe` to the v1 shell, drawers and footers
  now. Check on a notched iPhone in landscape and installed (standalone) mode.

### L-4: The offline banner can show a stale "showing data from …" time

- **Where:** `lib/pwa/online.ts:29-43`.
- **Scenario:** `offlineSince` is module state. While no component listens, `online` events are not tracked, so a
  device that went offline, unmounted the banner and came back online keeps the old timestamp. `subscribe` only sets
  it when offline and never clears it. The next `offline` event then keeps the old value (`??=`), and the banner shows
  the wrong time.
- **Fix:** In `subscribe`, `offlineSince = navigator.onLine ? null : (offlineSince ?? Date.now());`.

### L-5: The dashboard layout calls `serverEnv()` unguarded

- **Where:** `app/(dashboard)/layout.tsx` (the `swEnabled={serverEnv().APP_ENV !== "development"}` line).
- **Scenario:** Every other Wave A caller wraps `serverEnv()` because "an environment the schema refuses" throws
  (`features/observability/actions.ts:38-42`, `app/(dashboard)/diag/client-error/page.tsx:16-21`). Here a refused
  environment now takes down every dashboard page, not only the worker registration.
- **Fix:** Wrap it in a `try` and default `swEnabled` to `false`.

### L-6: Server-side sign-outs do not purge the device

- **Where:** `proxy.ts:138-146` (H-AUTH forced sign-out, then redirect to `/login`) and any session the server ends.
- **Scenario:** These paths reach `/login` without `purgeDeviceState()`, so `sessionStorage` and non-preference
  `localStorage` written by the dashboard stay on the device. Expired and removed sessions are scheduled for 06-06;
  the H-AUTH path is not listed there.
- **Fix:** Have `/login` (or the 06-06 session-status reaction) run the purge when it is reached by a server-ended
  session, for example with a `?ended=1` marker from the proxy redirect.

## Info

- **I-1:** `scripts/ci/ui-policy-baseline.json` has no `signout-guard` entry, so the run prints "no baseline".
  Regenerate the baseline.
- **I-2:** `app/globals.css` (structural layer) defines `--ease-out: cubic-bezier(0.2, 0, 0, 1)`, which overrides
  Tailwind's default `--ease-out`. This contradicts the comment that the structural names "collide with no Tailwind
  default". There are no `ease-out` users today, so nothing renders differently yet.
- **I-3:** Some codemod collapses are visible changes, not near-identical ones:
  - `bg-brand-600` becomes `bg-accent` (#0f5ab8 to #1769e0), 3 to 4 sites;
  - `hover:bg-[#0F5AB8]` becomes `accent-hover` (#155cc0), in the Button primitive;
  - `text-brand-950` becomes `accent-fg`;
  - `text-[#16A34A]` becomes `success-fg`.
  They are listed in `evidence/06-01a/codemod-report.json` as the plan requires, and are within the 0.5 % budget
  only if the neutral diff says so. The PO should know that the Button hover colour changed.
- **I-4:** `public/icons.json` is served publicly, and because it is not an image, a signed-out request for it gets a
  307 to `/login`. It is a build manifest; move it out of `public/` (for example to `scripts/design/`).
- **I-5:** `app/global-error.tsx:16` uses `lang="en"`, while the root layout now uses `lang="en-IN"`.
- **I-6:** `/manifest.webmanifest` and the three icons are precached in shell-v1, but the worker never answers those
  requests (no `respondWith`). The precache only costs install time and gives a second way to fail install. Either
  serve them from shell-v1 or drop them from `PRECACHE`.
- **I-7:** `hardSignOut` purges only the tab that signed out. Other open tabs keep patient data in memory until they
  navigate. Consider a `BroadcastChannel("auth")` so they hard-navigate too (likely 06-06).
- **I-8:** If a second `hardSignOut` call arrives while one is running, it returns the first promise. "everywhere"
  arriving after "user" is therefore downgraded to local. The menu prevents this today (`signingOut` state); other
  callers (06-06, V2-11) should know.

## Checked with no issue found

- `public/sw.js`:
  - never responds to non-GET, cross-origin, RSC (`_rsc` or `RSC: 1`), `/api`, `/auth`, share-token or `/_next/image`
    requests;
  - navigations are never stored;
  - `storable()` refuses `private` and `no-store` responses, which covers encoded-path tricks under `/_next/static/`;
  - the precache refuses redirected, opaque and non-200 answers.
- `lib/pwa/purge.ts` uses the same allowlist and cache names as the worker. Each purge step runs on its own, and no
  stored value is reported.
- `proxy.ts` marks signed-in pages and RSC responses no-store without changing `/api`, Server Actions or the signed-out
  public assets. `/api` PDF and export routes set their own cache headers.
- `reportClientRenderError`:
  - membership-only, and in the guard manifest;
  - the schema strips extra fields;
  - message and frames are never sent;
  - routes with a UUID, 6+ digit or `@` segment are stored as `/`;
  - public, auth and onboarding boundaries never report.
- The error and not-found states never echo the message or the id. Focus moves to the error heading. The loading
  status is announced once. The offline banner's live region is always in the DOM.
- The Lighthouse CI scrub removes `extraHeaders` and Cookie values and fails if any survive. The artifact is uploaded
  only after the scrub. The tools get a minimal environment.
- CI: the UI-policy step is in `static`, and route-js is in `build` (it exits 2 on a broken build). The nightly
  `lhci` job is skipped on the m0-baseline lane, and `report-failure` handles that. The PR lanes ignore the
  design-capture and perf specs.
