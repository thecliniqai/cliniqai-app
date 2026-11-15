---
phase: 06
roadmap_id: V2-06
name: Design system, frontend foundation & PWA shell
status: awaiting PO gate approval (06-P6 screenshot set, 06-P7 errata and rulings); CI run pending (orchestrator)
base_commit: 57824b0 (05a tip on v2/phase-05-db-authorisation-entitlements)
head_commit: f21a4b6 (verified; later commits are docs and evidence only)
branch: v2/phase-06-design-system-pwa-shell (PR #9; base the 05a branch while open; stacked on #10 = 05b; retargets as each merges, R-25)
---

# Phase 06 (V2-06) — summary

V2-06 gives the app one visual and interaction system and makes it an installable PWA. Every colour, radius and font
comes from semantic tokens in `app/globals.css`, set to the approved CliniQ AI brand theme (V2-DX `3a78a5d`). Inter and
Manrope load from local files. The primitives, the clinical patterns and the `/dev/ui` gallery follow G2-D. A new shell
replaces the v1 sidebar: Sidebar, Rail, BottomBar, a command palette and toasts. A hand-written service worker caches
only static assets. Every exit path goes through one `hardSignOut()` that purges the device. A session-status poll
handles updates, locks, expiry and removal, and an Auth outage is never treated as a sign-out.

Two waves were reviewed: Wave A (PWA, sign-out, client errors) and Wave B (UI, session status, palette). Each wave had
its own fix rounds and re-verifications, and every High and Medium is closed. The PO delegated rulings to the agent
acting as CTO (PO ruling "delivery speed", 2026-11-14); the rulings are listed below for 06-P7. Every number below is
copied from a tool output under `evidence/` or from a plan record that cites one.

## What changed, by plan
| Plan | Outcome (record) |
|---|---|
| 06-01a tokens, codemod, policy | Raw → semantic → structural token layers in `app/globals.css` (v1-equivalent values); value-neutral colour codemod (≤ 0.5 % pixels per screen at four widths, every collapse listed); UI policy framework in report mode; design lanes (`06-01a-TOKENS-CODEMOD.md`) |
| 06-07 route JS, LHCI | `scripts/ci/route-js.mjs` (Turbopack route manifests; M0 report fixed); Lighthouse CI report-only, nightly, loopback only, cookie scrub; `@lhci/cli` 0.15.1 (`06-07-ROUTE-JS-LHCI.md`) |
| 06-04a route states, client errors | `loading`/`error`/`not-found` states; `dvh`/safe-area utilities (`screen-height` enforced); client render-error capture through a member-guarded action, class name + route pattern only (R-3) (`06-04a-ROUTE-STATES-CLIENT-ERRORS.md`) |
| 06-05 PWA shell, sign-out | Manifest, icons, `/offline`, the allowlist service worker, `no-store` on signed-in pages (R-20), public PWA assets, `hardSignOut(reason)` with purge, the enforced `signout-guard` rule (`06-05-PWA-SHELL-SIGNOUT.md`) |
| 06-06 session status, lock, install | `GET /api/session-status`; update toast with a safe point (R-28); skew guard; D-8 lock client; install UX; the 05-10b handover and the spec 1 locked-user leg (`06-06-SESSION-STATUS-LOCK-INSTALL.md`) |
| 06-09a / 06-09b Wave A fixes | H-WEBKIT, M-EVERYWHERE, M-TABS, M-ERRCAP, M-OFFLINE, M-GUARD and cheap Lows; then the re-verification's N-1 (5-minute document links, `no-store` PDFs), N-2, N-7 and two CI items (`06-09a-REVIEW-FIXES.md`, `06-09b-REVERIFY-FIXES.md`) |
| 06-01b brand tokens, fonts | Approved CliniQ AI values (244 names compared with `3a78a5d`), local Inter + Manrope, AI-02 labels, brand mark, icon set, manifest name "CliniQ AI" (`06-01b-BRAND-TOKENS-FONTS.md`) |
| 06-02a / 06-02b / 06-02c primitives | Form primitives and input kinds (PWA-07); overlays, menus, tabs, toast, command; data display, dates, identity inputs; `/dev/ui` gallery with keyboard specs in a real browser (R-14) (`06-02a…`, `06-02b…`, `06-02c…` records) |
| 06-03a / 06-03b clinical patterns | Status (`lib/visit-status.ts`), identity, vitals, allergy; Rx entry, patient picker, dose grammar (`06-03a-CLINICAL-IDENTITY-STATUS.md`, `06-03b-CLINICAL-ENTRY.md`) |
| 06-04b shell, navigation, palette | App shell (Sidebar ≥ 1280, Rail 768–1279, BottomBar < 768), `navForRole`, command palette with a server-side four-field patient projection, toasts, More sheet, Back and keyboard-aware bars; v1 shell removed (`06-04b-SHELL-NAV-PALETTE.md`) |
| 06-08 close-out | React Compiler rules back to `error` (13 sites fixed, 20 waived with owner and expiry), UI policy report and baseline, the G3 screenshot set (33 screens, 129 captures), report gate (`06-08-CLOSE-OUT.md`) |
| 06-09c / 06-09d Wave B fixes | H-AUTHOUT, M-REMOVED, M-VITALS, M-RXKEYS, M-PICKER, M-DATE, M-INFANTAGE and cheap Lows; then the re-verification's H-AUTHOUT-R1 (the Auth transport: only a definitive GoTrue answer signs out), M-REMOVED-R1 (the device is pinned to its clinic) and L-R1…L-R4 (`06-09c-REVIEW-FIXES.md`, `06-09d-REVERIFY-FIXES.md`) |
| Gate close (this document) | The re-check's four Lows L-N1…L-N4 (`5197b1a`), each with a test that fails without it; report gate + 1 spec, FLOOR 5985 (`9cf851d`); e2e harness fix (`f21a4b6`); evidence (`evidence/`, `evidence/close/`) |

No migration in V2-06 (R-33). No new runtime dependency outside the plan's list (`radix-ui`, `cmdk`, `sonner`,
`react-day-picker`; devDependency `@lhci/cli`; `evidence/package-legitimacy.json`).

## Gate close: the re-check's four Lows (`reviews/v206d-review-recheck.md`)
| Low | Fix | Test (fails without the fix: `evidence/close/fails-without-*.txt`) |
|---|---|---|
| L-N1 the Auth budget also cut non-session calls (a slow `PUT /user` reported a password change as failed after GoTrue applied it) | `lib/supabase/auth-transport.ts`: the per-client budget and abort cover only the session calls (`GET /user`, the refresh grant, the JWKS fetch). `PUT /user`, sign-in and OTP calls are never cut or refused; `POST /logout` has its own 3.5 s bound | `session-auth-close-db.spec.ts`: `PUT /user` answered after 4.5 s (applied at once) after a 1.5 s breached-password check → `{ ok: true, otherSessionsSignedOut: true }`, the new password signs in, the old one is refused. Before: `{ ok: false, code: 'unknown' }` while the password had changed. `auth-failure.spec.ts` +3 transport cases |
| L-N2 a slow but working GoTrue made the app unavailable | The proxy's session budget is 5.5 s (`PROXY_AUTH_REQUEST_BUDGET_MS`, hard stop 5.75 s); routes, pages and actions keep 3.5 s, so proxy + route stay under the client's 10 s | A refresh answered after 4.5 s: the proxy answers signed in with the rotated session (before: marked `unavailable`); a refresh that never answers ends at 5.5 s in the proxy and 3.5 s in the route (`RV timing token=hang -> proxy 5506 ms, route 3506 ms`, `evidence/close/with-fix-vitest.txt`) |
| L-N3 the browser client on `/forgot-password` could refresh and delete the session cookies on a 429 | `createAuthPageClient()` (`lib/supabase/client.ts`), created at the first submit, works on a cookie view without the device's session: it never refreshes it or deletes it, and what it writes (PKCE verifier, recovery session) goes to the real cookies; the first session it stores replaces the old session cookies | e2e `tests/e2e/pwa/12-forgot-password-refresh.spec.ts` (desktop-chrome, pixel-7): server and browser refresh both 429 → no browser refresh, cookies unchanged, a code request works; a signed-in user completes a reset (ends signed out, R-35). Before: the cookies were deleted on mount. **Deviation:** the re-check's suggested fix (lazy creation + `autoRefreshToken: false`) was not enough; supabase-js reads the session for its INITIAL_SESSION event and so refreshed at the submit, and this spec caught it |
| L-N4 the pin survived the proxy's definitive sign-out | `proxy.ts` expires the HttpOnly `clinic_active_tenant` on any request it finds definitively signed out (the 307 to `/login`, public pages, Server Actions); an Auth outage keeps it; the stale comment in `lib/auth/hard-sign-out.ts` is corrected | `session-auth-close-db.spec.ts`: revoked session → 307 with the pin expired; signed-out `/login` and action POST expire it; a signed-in request and an outage keep it; D5: device pinned to A, session revoked, a user of B only signs in on it → 200 (B), not 403 |

## Deviations
- **Branch and PR shape (R-25, R-39):** branched from the 05a tip `57824b0`; the 05a and 05b tips were merged in six
  times with merge commits (`ba69ebd`, `1d7651f`, `f555819`, `7136686`, `b2380b9`, `136cd04`; conflicts and
  resolutions in each record and `06-WAVE-NOTES.md`). The shared stack ran 000094 (= the branch) for every gate run.
- **Review set (R-37):** the planned `v206-review-independent.md` / `…-shell-palette.md` are
  `reviews/v206b-review-independent.md` and `reviews/v206b-review-adversarial-session-palette.md`. Wave A got its own
  three reviews before Wave B (`reviews/v206a-*`). Fix plans 06-09a…06-09d replace the single planned 06-09b.
- **The isolated G3 design reviewer (`reviews/v206-review-design.md`) has not run** (see "Not met" in
  `06-VERIFICATION.md`).
- **Gate close, two defects found by the gate's own runs (Rule 1, fixed with the close):** `tests/ci/vitest-report-gate.spec.ts`
  still pinned the old default floor 5909 after 06-09d's `b11e398` raised it to 5974, so it failed from `b11e398` on
  (floor-measurement run, `close/vitest-full-measure.txt`; fixed in `9cf851d`); and the `09-outage-and-removal` e2e
  harness planted the clinic pin before the sign-in, which L-N4 now expires (PR-lane run 1, 5 failures, one root cause,
  `close/e2e/root-causes.txt`; fixed in `f21a4b6`).
- Per-plan deviations: see each record (06-01a radii/fonts kept for 06-01b; 06-05 `lang`/`color-scheme`; 06-09a `/sw.js`
  as a route and the precached offline stylesheet; 06-08 committed PNGs and the `e2e:g3` script; 06-09d the pinned
  cookie; gate close L-N3 above).

## Review outcome (CLAUDE.md DoD 6)
Severity counts are copied from each report (`reviews/`).

| Review | Commit | High | Medium | Low | Info | Outcome |
|---|---|---|---|---|---|---|
| Wave A independent (`v206a-review-independent.md`) | `ef24000` | 0 | 4 | 6 | 8 | M-1…M-4 → M-EVERYWHERE, M-ERRCAP, M-OFFLINE, M-GUARD fixed in 06-09a; Lows fixed or assigned (`06-09a-REVIEW-TRIAGE.md`) |
| Wave A adversarial A, PWA (`v206a-review-adversarial-pwa.md`) | `ef24000` | 1 | 2 | 3 | 4 | **H-WEBKIT** (WebKit sign-out never finished), M-EVERYWHERE, M-TABS fixed in 06-09a |
| Wave A adversarial C, client errors (`v206a-review-adversarial-client-errors.md`) | `ef24000` | 0 | 2 | 3 | 6 | M-ERRCAP fixed in 06-09a; C Info I-2 → V2-14 |
| Wave A re-verification (`v206a-review-reverify.md`) | `4a4c796` | H-WEBKIT **CLOSED** | M-EVERYWHERE, M-ERRCAP, M-GUARD **CLOSED**; M-OFFLINE **CLOSED** (Chromium); M-TABS **PARTIAL** → new **N-1** (Medium) | N-2, N-3 | N-4…N-7 | N-1 fixed in 06-09b (every view link 5 minutes, PDF routes `private, no-store`; residual open document tab → V2-09c viewer, CTO); N-2 fixed; N-3 → V2-14; iOS offline → 06-P8 |
| Wave B independent (`v206b-review-independent.md`) | `136cd04` | 1 | 5 | 7 | 3 | H-1 = **H-AUTHOUT**; M-VITALS, M-RXKEYS, M-PICKER, M-DATE, M-INFANTAGE fixed in 06-09c; L-1…L-7 fixed; I-1 ruling, I-2/I-3 → V2-08 (`06-09c-REVIEW-TRIAGE.md`) |
| Wave B adversarial B, session/palette (`v206b-review-adversarial-session-palette.md`) | `136cd04` | 1 | 1 | 2 | 5 | **H-AUTHOUT**, **M-REMOVED** fixed in 06-09c; L-1 fixed; L-2 rate limits → V2-12 |
| Wave B re-verification (`v206c-review-reverify.md`) | `de553cd` | H-AUTHOUT **PARTIAL** → **H-AUTHOUT-R1** | M-REMOVED **PARTIAL** → **M-REMOVED-R1** | 4 (L-R1…L-R4) | — | All fixed in 06-09d |
| Wave B second re-verification (`v206d-review-recheck.md`) | `f9298e0` | H-AUTHOUT-R1 **CLOSED**; 0 new | M-REMOVED-R1 **CLOSED**; 0 new | L-N1…L-N4 | 1 | L-N1…L-N4 fixed at the gate close (above), no further round (PO speed ruling) |

**All Highs and Mediums are closed:** H-WEBKIT (closed at `4a4c796`), H-AUTHOUT → H-AUTHOUT-R1 (closed at
`f9298e0`, after two re-verification rounds), M-EVERYWHERE, M-ERRCAP, M-OFFLINE, M-GUARD (closed at `4a4c796`), M-TABS
(→ N-1, fixed in 06-09b, residual assigned by CTO ruling), M-REMOVED → M-REMOVED-R1 (closed at `f9298e0`), M-VITALS,
M-RXKEYS, M-PICKER, M-DATE, M-INFANTAGE (fixed in 06-09c with tests that fail without them; UI, so no re-check round,
R-37). Every fix has a test that fails without it (each record's "fails without" evidence; the gate close's in
`evidence/close/`).

## CTO rulings made in V2-06 (PO may overturn at 06-P7)
| Ruling | What | Where recorded |
|---|---|---|
| R-1…R-43 | The plan's rulings (R-37…R-43 from the 2026-11-14 revision: review depth, Lows, the 05b overlap, shared lanes, product-name scope, icon/theme colour source, per-subset font calls) | `06-PLAN.md` § Rulings |
| G2-D addendum items (2026-11-14) | Approved state = V2-DX `3a78a5d`; theme colour `#FFFFFF`; favicon below 32 px = the kit's small mark; "ClinicOS"/"ClinicQ" strings outside V2-06 renamed by their owner phases; Inter licence = rsms/inter's own text; doc errata proposed at the close | `docs/v2/VERIFICATION_LOG.md` "G2-D addendum"; `06-01b-BRAND-TOKENS-FONTS.md`; `app/fonts/PROVENANCE.md` |
| UI defaults CD-01…CD-37 | The UI contract's open defaults | `06-UI-SPEC.md` |
| Lighthouse CI pin | `@lhci/cli` 0.15.1 accepted (deprecated transitive packages only; 912/912 signatures verified; 0.16.x is the research audit's too-new pin). This is the 06-P4 confirmation, taken by the CTO | `06-07-ROUTE-JS-LHCI.md`; `evidence/package-legitimacy.json` §06-07 |
| Offline stylesheet in the shell cache | `/offline` is self-contained by precaching the app's one stylesheet (about 150 kB), not by inlining CSS; PWA §3.9's "offline page + icons only" is read with this | `06-09a-REVIEW-FIXES.md` deviation 2 |
| Document links 5 minutes (N-1) | Every signed view link lives 300 s and inline PDFs are `private, no-store`; a document tab already open stays until closed (the in-app viewer in V2-09c reaches it) | `06-09a-REVIEW-TRIAGE.md` re-verification table; `06-09b-REVERIFY-FIXES.md` |
| Admins without Doctor's Cabin (IND I-1) | Consistent with R-9 (admins hold no clinical access); the URL still opens for roles that can use it | `06-09c-REVIEW-TRIAGE.md` |
| A forged clinic cookie signs out only the forger | A forged or foreign `clinic_active_tenant` (or shell header) answers 403 for that device alone; it never reads another clinic (`getActiveMembership` and `authz.active_tenant_id()` match only the caller's active memberships); the pin is HttpOnly | `06-09d-REVERIFY-FIXES.md`; `reviews/v206d-review-recheck.md` (D3, D4) |
| Auth outage ≠ sign-out | Only GoTrue's definitive codes sign out; 429/408/5xx/network/uncoded 4xx keep the session (H-AUTHOUT-R1) | `06-09c-REVIEW-TRIAGE.md`; `lib/auth/auth-failure.ts` |
| Proxy Auth budget 5.5 s (L-N2) | Chosen so proxy (5.75 s hard stop) + route (3.5 s) stay under the client's 10 s; a page's own `/user` keeps 3.5 s | this gate close; `lib/supabase/auth-transport.ts` |
| `/gsd-secure-phase` (2026-11-15) | Not run for V2-06. The review set (two independent reviews, three adversarial reviews and three adversarial re-verification rounds over the security-sensitive rows T-06-01…T-06-21 and T-06-SC) stands in its place under the PO speed ruling, as for V2-05a and 05b | `06-VERIFICATION.md` |

## Accepted or assigned, with owner
| Item | Reason | Owner |
|---|---|---|
| Hand-rolled v1 dialogs without a focus trap (15 files) | Each moves onto `Dialog`/`ResponsiveSheet` with its screen | V2-08 (booking, waitlist, walk-in), V2-09a (amendment), V2-09b (sign & bill), V2-09c (PDF preview), V2-10 (checkout, receipt), V2-11 (staff, referrals, notifications), V2-12 (AI scribe, webhook logs) (`06-08-CLOSE-OUT.md`) |
| v1 content axe debt on shell routes (153 serious/critical nodes over 129 captures, inside `<main>`) | Outside the shell scope of the G3 gate; recorded per capture | owner phase of each screen: V2-08, V2-09b, V2-10, V2-11 |
| 20 React Compiler sites waived (11 files), expiry 2027-02-13 | v1 drawers their owner phase replaces | V2-08, V2-09b, V2-09c, V2-10, V2-11 (`scripts/ci/react-compiler-waivers.json`) |
| Age-only DOB convention (`calculateDobFromAge`, 1 Jan of the birth year) | The new input never sends it for infants; changing the server convention is a registration decision | V2-08 (`06-09c-REVIEW-FIXES.md`) |
| Clinic switcher contract | Write `clinic_active_tenant` HttpOnly, `SameSite=Lax`, `Path=/`, 400 days, only to an active membership; M-REMOVED treats any other value as removal | V2-11 (`06-09d-REVERIFY-FIXES.md`) |
| Rate limits on session status and the palette actions (B L-2) | Shared rate limiter | V2-12 |
| `requireAccessDestination` on the locked/onboarding pages throws `ActiveClinicMembershipEndedError` to the error page | Outside the shell; the next dashboard load signs out | V2-13b |
| Doctor's palette searches the whole clinic queue (IND I-2); DOB calendar pages month by month (IND I-3) | No new exposure; typing is the fast path | V2-08 |
| Sign-out guard vs deliberate obfuscation (N-3); decoded session tokens in the LHCI scrub list (C I-2); deployment-id exposure, suspended = removed, `/SW.JS` header quirk (B Info) | Lint aid, not a boundary; recorded | V2-14 |
| Static cache keeps route chunks across users (A Info); Lighthouse reports embed synthetic screenshots (C Info) | No PHI | accepted |
| Real-iPhone offline sign-out and other tabs (M-OFFLINE / M-TABS on iOS) | Playwright WebKit cannot run a worker offline | PO device check 06-P8 |

## Deferred, with owner (06-PLAN phase close step 5)
Idle sign-out spec leg → V2-11 (AUTH-09); spec 7 → V2-07/V2-08; spec 9 and the billing-page Coming soon row → V2-13b;
tablet two-pane → V2-08/V2-09b; MoneyInput, InvoiceLines and `lib/money` → V2-10 (R-15); AI-16 → V2-09b (R-10); LHCI
and bundle budgets blocking, Skew Protection check → V2-15; CSP `worker-src`/`manifest-src` → V2-14; palette reset and
9–11 px text → M5/V2-11 (R-31); Profile "Install app"/"Check for updates" → V2-11; product-name strings outside V2-06 →
owner phases (G2-D addendum); nightly `design` and `sw-update` first runs → after the merge (schedules run on the
default branch).

## Merge order (R-25, merge commits only, never rebase)
1. #6 V2-04 → `feature/v2`.
2. #8 V2-05a: retarget to `feature/v2`, merge.
3. #10 V2-05b: retarget to `feature/v2`, merge (after 05-P6).
4. #9 V2-06 is stacked on #10 (it contains every 05b commit through the 05b gate tip, merge `136cd04`). Retarget it to
   the branch below it as each one merges, and to `feature/v2` after #10. Merge with a merge commit after 06-P6/06-P7
   and a green CI run on the retargeted head.

#7 V2-DX (`feature/v2`) is independent: V2-06 copied its approved files (SHA-256 list in the plan's revision note).

## Numbers
- Vitest: 300 files / 6181 tests at 06-08 → 305 / 6288 at 06-09d → **306 files / 6300 tests**, two consecutive runs at
  `f21a4b6`, 0 failed, 0 skipped; each teardown verified none of its run data remains (`evidence/summary.json`,
  `full-run-{1,2}.json`). Report gate: floor 5985 (6300 × 0.95), 219 required spec files (every Vitest spec V2-06 added:
  46), PASS for both runs (`close/vitest-report-gate.txt`, `close/required-files-coverage.txt`). Negative proofs:
  required file removed, a test skipped, a required file emptied, the suite one below the floor → each exit 1
  (`close/vitest-gate-negatives.txt`).
- pgTAP (no V2-06 migration): 47 files / 7892 tests, both runs, gate PASS (`close/pgtap-report-gate.txt`).
- Playwright PR lane, `--retries=0`, run 2 at `f21a4b6`: 590 passed, 0 failed, 0 flaky, 0 retried (desktop-chrome 391,
  pixel-7 146, iphone-15 38, pwa-ipados 7, setup 8); run 1 at `9cf851d` had 5 failures from one harness root cause
  (`close/e2e/`).
- Static: typecheck, `eslint . --quiet`, inventory exit 0; UI policy PASS (report rules at baseline, enforced rules 0);
  AI-L1 PASS; audit gate PASS (`static-checks.json`, `close/`).
- UI policy at the close: raw-palette 3346, px-font 266, link-wraps-button 31, window-dialog 27, arbitrary-color 2,
  ai-sdk-import 0; enforced brand-utility, screen-height, signout-guard 0 (`close/ui-policy.txt`).
- G3 set: 33 screens, 129 captures, axe 0 serious/critical in scope, no horizontal scroll (`evidence/06-08/screens/`,
  set commit `38b614c`).
- Gate-close Lows without → with: 10 of 20 Vitest cases fail at `e7d99ce` → 77/77 with the fix; L-N3 e2e fails on
  desktop-chrome and pixel-7 with the old page → 4/4 (`close/fails-without-*.txt`, `close/with-fix-vitest.txt`).

## Pending PO (ids in `.planning/PO-ACTIONS.md` § "V2-06 Design system & PWA shell")
- **Gate:** 06-P6 (approve the G3 screenshot set: `evidence/06-08/screens/README.md`, set commit
  `38b614cf3cb68ee7ffc7e34cbeb00db93c41c6ea`, unchanged at the gate commit), 06-P7 (doc errata E-1…E-13 and the
  rulings above).
- **When staging is live:** 06-P8 (one real-iPhone offline sign-out check).
