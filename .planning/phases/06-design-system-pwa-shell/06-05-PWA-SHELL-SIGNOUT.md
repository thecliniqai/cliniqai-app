# 06-05 record: manifest, provisional icon, service worker, `/offline`, `hardSignOut()`, `no-store`, public PWA assets

Plan: `06-PLAN.md` § 06-05 (Wave 2, no G2-D; security-sensitive, adversarial review A). Branch
`v2/phase-06-design-system-pwa-shell`, worktree execution alongside 06-07 and 06-04a. Plan base `ba69ebd` (06-01a done
+ 05a tip merged). The locked-user leg of spec 1 is **not** in this plan: the 2026-11-14 revision moves it to 06-06
(it needs V2-05b's locked fixtures). Every number below comes from a tool output in `evidence/06-05/` (file named per
row) or from the command named in the row.

## What changed

| Area | Change | Files |
|---|---|---|
| Public PWA assets (PWA §3.1, T-06-04) | `/manifest.webmanifest`, `/sw.js`, `/offline` added to `PUBLIC_PAGE_PREFIXES` (default deny unchanged; whole-segment match on raw and normalised paths). Icons stay single-segment image files the proxy matcher already skips. The public-paths spec now enumerates `app/manifest.ts`, the `app/` icon files and every `public/**` file, requires each to be reachable signed out (public prefix or matcher-skipped, checked through Next's own `unstable_doesMiddlewareMatch`), requires `public/` to stay one segment deep, and adds look-alikes (`/sw.jsx`, `/sw`, `/offlinex`, `/offline-patients`, `/manifest.webmanifestx`, `/manifest`) and encoded traversals (`/offline/..%2Fpatients`, `/offline%2F..%2Fpatients`, `/sw.js/..%2F..%2Fpatients`, `/manifest.webmanifest/..%2Fqueue`) as protected. `public/icons.json` (renderer record, not fetched by browsers) is the one public file left default-denied signed out. | `lib/auth/public-paths.ts`, `tests/auth/public-paths.spec.ts` |
| Manifest + root metadata (PWA §3.1, D-7) | `app/manifest.ts`: `id "/"`, name/short_name "ClinicQ" (Wave A working name), `start_url "/?source=pwa"`, `scope "/"`, `standalone`, no `orientation`, no `shortcuts`, colours from the token mirror, icons 192/512 `any` + 512 `maskable`. Root layout: title `{ default: "ClinicQ", template: "%s · ClinicQ" }`, `appleWebApp` (capable, title, `default` bar), `viewport` (`themeColor` from the mirror, `viewportFit: cover`, `interactiveWidget: resizes-content`, `colorScheme: light`, no zoom lock), `<html lang="en-IN">`. No page sets a title with a patient name (all static). | `app/manifest.ts`, `app/layout.tsx` |
| Icons (R-24) | Outlined master `app/icon.svg` (tile `#tile` = `iconTile`, glyph paths = `iconGlyph`, no font). `scripts/design/render-icons.mjs` renders it with Playwright's Chromium (`file:` only, every other request aborted) to `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png` and `app/apple-icon.png` (180, opaque); maskable and Apple use the master with the tile's rounding removed (full bleed; the glyph sits inside the 80 % safe zone). `--check` re-renders to a temp dir and fails on a missing PNG, a wrong IHDR size, or a master SHA-256 different from `public/icons.json`. | `app/icon.svg`, `app/apple-icon.png`, `public/icon-*.png`, `public/icons.json`, `scripts/design/render-icons.mjs`, `tests/pwa/icons.spec.ts` |
| `/offline` (PWA §3.6) | Static (`force-static`), outside every group, public, semantic tokens only, `min-h-app`: brand word, "You're offline", "Patient data isn't stored on this device. Reconnect to continue.", and a plain `<a href="/">Retry</a>` (works offline and without JavaScript). No user, clinic or session reference. | `app/offline/page.tsx` |
| Service worker (PWA §4 D-1/D-2, §5; T-06-01, T-06-02, T-06-05, T-06-20) | Hand-written `public/sw.js` (plain JS, no imports). `install` fetches all five shell URLs with `credentials: "omit"`, `cache: "no-store"` and refuses any non-200, redirected or non-`basic` answer before writing anything. `activate` deletes every cache except `static-v1`/`shell-v1`, enables navigation preload, claims clients. `fetch`: non-GET or cross-origin → nothing; navigation → preload or network, never stored, `/offline` from `shell-v1` on failure; `/_next/static/**` without `_rsc` → cache-first (key keeps `?dpl=`), stores only plain 200 `basic` answers without `private`/`no-store`, 200-entry cap evicting the oldest; everything else → no `respondWith`. `message {type: "SKIP_WAITING"}` → `skipWaiting()` (for 06-06's safe-point update). `next.config.ts` `headers()` for `/sw.js`: JS content type, `no-cache, no-store, must-revalidate`, `default-src 'self'; script-src 'self'`. | `public/sw.js`, `next.config.ts` |
| Registration + runtime | `registerServiceWorker()` (`scope "/"`, `updateViaCache: "none"`) only from `PwaRuntime`, which `app/(dashboard)/layout.tsx` mounts with `swEnabled = APP_ENV !== "development"`. `PwaRuntime` also renders the offline banner. | `lib/pwa/register-sw.ts`, `components/shell/pwa-runtime.tsx`, `app/(dashboard)/layout.tsx` |
| Online state + banner (§3.6) | `useOnlineStatus()` / `useStaleSince()` through `useSyncExternalStore` (no effect state); the stale time is formatted in the clinic's zone (`useClinicTimeZone`). Banner: an always-present `role="status"` live region (`[data-offline-banner]`) that holds "You're offline · showing data from 10:42 am. Changes are disabled until you reconnect." only while offline; Midnight-style `bg-fg text-surface`, `pb-safe`. | `lib/pwa/online.ts`, `components/shell/offline-banner.tsx` |
| `no-store` (D-4, R-20) | `proxy.ts` sets `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Expires: 0`, `Pragma: no-cache` on every signed-in GET/HEAD outside `/api` (pages and RSC), unless `setAll` already put a no-store header there (a refreshed session keeps `@supabase/ssr`'s). `/api` handlers and Server Action POSTs untouched. | `proxy.ts`, `tests/pwa/proxy-no-store-db.spec.ts`, `tests/api/proxy-session.spec.ts` (one assertion updated: the valid-session case now expects the D-4 header) |
| `hardSignOut(reason)` (D-5, R-18, R-19; T-03-13, T-06-03) | `lib/auth/hard-sign-out.ts`, reasons `user · everywhere · switch · expired · removed · idle`, one run at a time: (1) `runCleanups("signout")`; (2) `fetch("/auth/signout", POST, scope form, redirect: "manual", same-origin, 5 s timeout)`, success = opaque redirect or 303; (3) only on failure: the browser client's `auth.signOut({ scope: "local" })` (loaded on demand, 3 s cap) **and** every `sb-*-auth-token*` cookie expired in the browser; (4) `purgeDeviceState()`; (5) `location.replace("/login")`. Cleanup registry with a 2 s cap per cleanup (`signout` / `lock` kinds). Purge: caches not named `static-v1`/`shell-v1` deleted, entries outside the D-2 allowlist deleted, `sessionStorage.clear()`, `localStorage` minus the four `clinicos.pref.*` keys, every IndexedDB database; each step runs even if another fails. | `lib/auth/hard-sign-out.ts`, `lib/pwa/{cleanup,purge,device-prefs}.ts` |
| User menu | Both sign-out forms keep `method="post" action="/auth/signout"` (no-JS fallback); `onSubmit` → `preventDefault()` + `hardSignOut("user" \| "everywhere")`. New "Switch user" item → `hardSignOut("switch")` (plain `/login`, nothing prefilled). | `components/layout/user-dropdown.tsx` |
| Sign-out guard (spec 11, R-19, T-06-06) | `signout-guard` UI-policy rule, **enforced**: a `signOut` property access, element access (`auth["signOut"]`) or destructuring (`{ signOut }`) in `app\|components\|features\|lib` fails unless the file is `lib/auth/hard-sign-out.ts`, `app/auth/signout/route.ts` or a non-`"use client"` file under `features/auth/`. Repository: 0 findings. | `scripts/ci/ui-policy/rules/signout-guard.mjs`, `lint-fixtures/ui-policy/signout-guard/**`, `tests/ci/ui-policy-signout-guard.spec.ts` |
| PWA e2e harness (step 11, A3, T-06-13) | `tests/e2e/pwa/fixtures.ts`: `serviceWorkers: "allow"` (only here; config default stays `block`), base loopback block kept, plus an auto fixture recording every `context.on("request")` URL (service-worker requests included) that fails the test on any non-loopback URL. Helpers read Cache Storage, storage keys and IndexedDB. | `tests/e2e/pwa/fixtures.ts` |
| Runbook + kill switch | Allowlist, headers, how to change the worker and bump cache names, the **kill switch** (deploy `scripts/pwa/kill-switch-sw.js` unchanged as `public/sw.js`; `sw-allowlist.spec.ts` executes that file), the sign-out order, the D-3 keys, a manual device check. | `docs/runbooks/pwa.md`, `scripts/pwa/kill-switch-sw.js` |

## Commits

| Commit | What |
|---|---|
| `52ce6a8` | Tracer: `app/manifest.ts`, `/manifest.webmanifest` public, spec 1 first case, public-paths enumeration of assets |
| `1425f62` | `signout-guard` rule (enforced), fixtures, spec 11 |
| `a92a4d0` | `/sw.js` and `/offline` public; root metadata; icons + renderer; `/offline`; `public/sw.js` + headers; runtime, banner; PWA fixture; specs 1-4 |
| `9e622d7` | Proxy `private`/`no-store` on signed-in pages and RSC (D-4, R-20) |
| `24e8a62` | `hardSignOut()`, purge, prefs, cleanup registry; user menu (Switch user); spec 5; UI checks |
| `3029320` | Sign-out e2e reads the server outcome (V2-03 `signout.spec.ts` adapted); spec 4 order-independent; 06-04a utilities |
| `c7ee1d9` | Kill switch moved to `scripts/pwa/kill-switch-sw.js` (doc-grep gate) |

## Acceptance (plan § 06-05 "Tests that fail without the change" and "Acceptance mapping")

| Criterion | Result | Proof |
|---|---|---|
| Spec 1 (signed-out leg): manifest, `/sw.js`, `/offline`, every manifest icon, `/icon.svg`, `/apple-icon.png` answer 200 with no redirect and the right type; manifest §3.1 fields; 192/512/maskable 512 with matching PNG IHDR sizes | Met (desktop-chrome, pixel-7) | `tests/e2e/pwa/01-manifest.spec.ts`; `evidence/06-05/e2e-pr.json`. Before: no manifest/worker/page, and the proxy answered 307 (`public-paths-on-plan-base.txt`, `proxy-no-store-on-plan-base.txt` last case: `/offline` 307) |
| Spec 1 locked-user leg | **Moved to 06-06** (plan revision 2026-11-14; needs 05b fixtures) | — |
| Spec 2: Chrome reports the app installable | Met: `installabilityErrors: []`, `manifestErrors: []` on desktop-chrome and pixel-7 | `evidence/06-05/installability-{desktop-chrome,pixel-7}.json` |
| Spec 3: worker registers (scope `/`, `updateViaCache: none`) and activates; `/sw.js` `no-store` + `script-src 'self'` CSP signed in and out; precache exactly the five URLs, ≤ 150 kB | Met | `tests/e2e/pwa/03-sw.spec.ts` |
| Spec 4 part 1: offline navigation shows `/offline`; Today keeps its on-screen rows and shows the banner; online removes it | Met | `tests/e2e/pwa/04-offline.spec.ts` (write-button part: 06-02a, R-32) |
| Spec 5 browse: every cached URL on the D-2 allowlist (static cache in use, 5 shell entries), IndexedDB empty, storage keys ⊆ D-3, patient/consult titles without the patient name, HTML and RSC `private`/`no-store` | Met (desktop-chrome, pixel-7) | `tests/e2e/pwa/05-cache-audit.spec.ts` (Today, patient, consult, billing reports, a receipt PDF fetch) |
| Spec 5 exit paths: sign out, sign out of all devices (second device loses its session), switch user, offline sign-out | Met for all four, on both projects: caches allowlisted only (a planted `static-v1:/patients` entry, a rogue cache and a rogue IndexedDB are gone), `sessionStorage` empty, only the planted `clinicos.pref.density` survives, no auth cookie, Back shows no patient data; offline lands on `/offline` and no cookie is back online | same spec; server-side scope from the e2e server log (`auth.signout.done`) |
| Expired / removed / idle exit paths | 06-06 (expired, removed), V2-11 (idle), per plan | — |
| Spec 11: `signout-guard` enforced, fixtures reported with file:line and exit 1, allowed files pass, repository 0 | Met | `tests/ci/ui-policy-signout-guard.spec.ts`; `evidence/06-05/signout-guard-fixtures.txt`; `evidence/06-05/ui-policy.json` |
| `public-paths.spec.ts` extended (three prefixes public; look-alikes and encoded traversals protected; every prefix matches a file; assets reachable) | Met; 3 cases fail on the plan base | `evidence/06-05/public-paths-on-plan-base.txt` |
| D-4 `no-store` from the proxy | Met; 7 of 8 cases fail on the plan base | `tests/pwa/proxy-no-store-db.spec.ts`; `evidence/06-05/proxy-no-store-on-plan-base.txt` |
| Unit: purge allowlist, pref keys, sw.js in a VM (respondWith matrix, redirected precache aborts install, kill switch) | Met | `tests/pwa/{purge,device-prefs,sw-allowlist,hard-sign-out,icons}.spec.ts`; `evidence/06-05/vitest.txt` |
| UI checks: `/offline`, the banner, the user menu with "Switch user" at 360/820/1180/1280; axe 0 serious/critical; no horizontal scroll | Met: 12 axe reports, 0 serious/critical | `tests/e2e/pwa/ui-checks.spec.ts`; `evidence/06-05/axe-ui-checks.json` (screenshots in git-ignored `design-captures/06-05/`) |
| Icons reproducible | `render-icons --check` PASS | `evidence/06-05/render-icons-check.txt` |

## Suite results (local)

| Lane | Result |
|---|---|
| `npm run typecheck` | pass |
| `npx eslint .` | 0 errors (warnings: none in 06-05 files) |
| `npm run inventory` | exit 0, 0 flagged |
| `npm run ci:ui-policy` | PASS; `signout-guard` [enforce] 0; every report-mode count at its baseline (delta 0) |
| `npm run ci:ai-l1`; doc-grep gate | PASS; PASS (after the kill-switch move, below) |
| 06-05 Vitest specs + doc-grep gate | 9 files, 173 tests pass (`evidence/06-05/vitest.txt`) |
| Full Vitest lane (`npx vitest run`, shared stack) | 263 files, 5062 / 5067 pass. Failures: doc-grep gate (fixed by `c7ee1d9`, rerun green) and 4 tests in 3 files that **fail identically on the plan base `ba69ebd`** on the same stack: `tests/ci/hosted-dump-diff.spec.ts` (2), `tests/ops/drill-lib-db.spec.ts` (`drill_authz_matrix`: patients insert denied), `tests/billing/invoice-totals-db.spec.ts` (M-INVOICE). The stack carries V2-05 migrations up to 000076, ahead of this branch (expected while 05b is not merged in; recorded, not changed). |
| `npm run e2e:build && npm run e2e:pr` | 287 passed, 38 skipped, 0 failed, 0 flaky, 0 retried (desktop-chrome, Pixel 7, iPhone 15), `evidence/06-05/e2e-pr.json`. The first full run (before the fixes in `3029320`) had 6 failures of 06-05's own making, root-caused below, and 2 in 06-04a's route-state specs (green in the second run). |
| gitleaks (docker `zricethezav/gitleaks:v8.30.1`, whole history) | no leaks found |

## Deviations

1. **Icon tile colour.** The plan text says tile `#0E716B` "from the token mirror"; the mirror's `iconTile` is
   `--color-accent` = v1 `#1769e0` (06-01a, value-neutral). The master uses the mirror, and `icons.spec.ts` pins
   tile/glyph to it. 06-01b replaces the icon with the approved CliniQ AI masters anyway.
2. **Kill switch location.** The plan keeps the kill-switch body "verbatim in the runbook and checked by
   `sw-allowlist.spec.ts`". The doc-grep gate (TEST_STRATEGY §9.6) forbids tests that read `docs/`, so the body is the
   file `scripts/pwa/kill-switch-sw.js`; the runbook says to deploy it unchanged, and the spec executes it.
3. **Sign-out assertions read the server log.** `hardSignOut`'s `fetch(redirect: "manual")` resolves as an opaque
   redirect and its cookie deletions apply (research A4 / risk K-4: confirmed, `evidence/06-05/signout-fetch-probe.txt`),
   but Playwright reports the request as `requestfailed` (`net::ERR_ABORTED`) with no response event. Spec 5 and V2-03's
   `tests/e2e/auth/signout.spec.ts` (adapted: its locator flow now asserts the posted scope and the server's
   `auth.signout.done` scope) read the outcome from the e2e server log. The route's own 303 + `Clear-Site-Data: "cache"`
   is asserted on a direct same-origin POST (the no-JS fallback) at the end of `signout.spec.ts`. Whether Chromium
   applies `Clear-Site-Data` to the opaque-redirect `fetch` is not observable from Playwright; it is defence in depth
   (D-5): the purge is the real control and authenticated pages are `no-store`.
4. **Offline local sign-out.** The browser client is loaded on demand (keeps supabase-js out of the dashboard bundle);
   offline its chunk may not load, so `hardSignOut` also expires every `sb-*-auth-token*` cookie itself. Offline the
   server session cannot be revoked by either path (research A7); the device holds no token afterwards (spec 5).
5. **Proxy no-store keeps an existing no-store header.** When `@supabase/ssr`'s `setAll` already set its no-store
   cache headers (a refreshed session), the proxy leaves them (keeps `tests/observability/request-id.spec.ts` as is);
   `tests/api/proxy-session.spec.ts`'s valid-session case now expects the D-4 header.
6. **`sw.js` handles `SKIP_WAITING`** now (06-06 posts it at the safe point), so 06-06 does not need to edit `sw.js`.
7. **Added beyond the plan's test list:** `tests/pwa/hard-sign-out.spec.ts` (order, fallbacks, timeouts, single run),
   `tests/pwa/icons.spec.ts`, `tests/pwa/proxy-no-store-db.spec.ts`, `tests/e2e/pwa/ui-checks.spec.ts`.
8. Spec 4 compares the `main` region's text before and after going offline (Today lists many rows from earlier specs,
   so a single seeded row is not always on screen); spec 5's consult check is `toBeAttached` (v1's consult header is
   hidden at phone width).

## Open (owner)

- Locked-user leg of spec 1, expired/removed legs of spec 5, `update()` on resume: **06-06**.
- `scripts/ci/ui-policy-baseline.json` has no `signout-guard` key (enforced, 0): **06-08** `--write-baseline`.
- Adversarial review A of the worker, public paths, proxy headers, `hardSignOut`/purge and the guard: **Wave A review
  checkpoint (06-09a)**.
- App CSP `worker-src`/`manifest-src`: **V2-14 (P1-18)**, unchanged.
- Data on the shared stack: the e2e and Vitest lanes seed their own synthetic tenants per run, so the V2-05 resets did
  not require `seed:local`; nothing was reset or reseeded by 06-05.
