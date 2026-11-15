---
phase: 06
roadmap_id: V2-06
status: awaiting PO gate approval (06-P6, 06-P7); CI run pending (orchestrator); G3 design review fixes 06-09e applied
verified_commit: f21a4b6 (local evidence; evidence/commit.txt = f21a4b6ab23110f0b04f06386570e61d16c3f058)
ci_run: "https://github.com/thecliniqai/cliniqai-app/actions/runs/43733539968 (head 6ea101579e20b199ee84e6faa5d4c34c0488ffe3, success)"
---

# Phase 06 (V2-06) — verification

Every figure comes from a tool output:
- `node scripts/phase-evidence.mjs .planning/phases/06-design-system-pwa-shell/evidence 2` (the path the plan's phase
  close step 2 prescribes): two full Vitest runs (JSON reporter), two pgTAP lane runs, tsc, ESLint, the inventory and
  the ESLint-computed counters (`evidence/{summary.json,full-run-1.json,full-run-2.json,pgtap-run-1.tap,pgtap-run-2.tap,static-checks.json,commit.txt}`).
  It ran 2026-11-15T10:22:52Z–10:43:55Z under the test-run lock.
- `scripts/ci/assert-vitest-report.mjs` and `scripts/ci/assert-pgtap-report.mjs` on both runs
  (`evidence/close/{vitest,pgtap}-report-gate.txt`).
- Gate negative proofs: Vitest variants derived from the real run-1 report (`evidence/close/vitest-gate-negatives.txt`,
  source `close/vitest-gate-negatives.mjs.txt`).
- `npm run e2e:build && npm run e2e:pr -- --retries=0` under the e2e lane lock (`evidence/close/e2e/`), and the
  per-criterion extraction `evidence/close/acceptance-results.txt` (a counts-only reader of the Playwright report and
  both Vitest runs; source `close/acceptance-extract.mjs.txt`).
- Static: `npm run ci:ui-policy` (+ `--json`), `npm run ci:ai-l1`, `npm run ci:audit` (`evidence/close/`).
- The gate close's fails-without runs (`evidence/close/fails-without-{vitest,e2e}.txt`) and with-fix run
  (`evidence/close/with-fix-vitest.txt`); the floor measurement (`evidence/close/vitest-full-measure.txt`).
- gitleaks over the gate-close commits (`evidence/close/gitleaks.txt`).
- `scripts/phase-evidence.mjs … --ci-run <id>` for the GitHub Actions run (**placeholder below; the orchestrator fills
  it**).

Nothing is hand-typed from a run. Local stack only (000094, shared; never reset, stopped or reseeded by V2-06).

Local results at `f21a4b6` (`evidence/summary.json`, `evidence/static-checks.json`, `evidence/close/`):
- **Vitest:** 306 files / 6300 tests, passed in both runs, 0 failed, 0 skipped; each teardown removed its run data and
  verified none remain (293 tenants, 549 auth users, 1568 storage objects per run).
- **Vitest report gate:** PASS for both runs (floor 5985 = 6300 × 0.95, 219 required files; `close/vitest-report-gate.txt`).
  Every Vitest spec V2-06 added outside `tests/e2e` (46, the gate close's included) is a required file
  (`close/required-files-coverage.txt`: "added but not required: 0").
- **Gates fail when they should** (variants of the real run-1 report, `close/vitest-gate-negatives.txt`): a required V2-06
  file removed (`session-auth-close-db`, `approved-tokens`, `hard-sign-out`) → `required spec file missing` (exit 1); one
  test `it.skip`ped → `test skipped (0 skipped allowed)` (exit 1); every test of a required file dropped → `has no passed
  test` (exit 1); the suite one below the floor → `total 5984 is below the floor 5985` (exit 1). By design (IR-F5 95 %
  rule) one passing test deleted from a required file that keeps others still passes (shown, exit 0), as at V2-05b.
- **pgTAP lane** (unchanged by V2-06, the 05b gate's 000094): 47 files / 7892 tests, passed in both runs; gate PASS (floor
  7892, 47 required; `close/pgtap-report-gate.txt`).
- **Static checks:** typecheck exit 0; `eslint . --quiet` exit 0; inventory exit 0; `p1_34_boundary_messages` 0,
  `boundary_directives` `[]`, `utc_today_messages` 0, one service-role factory (`lib/supabase/system.ts`), exception
  register 2 entries, `cron_route_files` 0; Next 16.4.6 declared and installed (`static-checks.json`). UI policy PASS
  (report rules at baseline, delta 0; enforced rules 0), AI-L1 PASS, audit gate PASS (2 high advisories, both waived,
  `close/{ui-policy,ai-l1,audit-gate}.txt`).
- **Playwright PR lane:** fresh `e2e:build` of the gate-close code (build `NUmOe3OYyaVFWnZ4cr4VU`, output scan clean), then
  `e2e:pr -- --retries=0`:
  - run 1 at `9cf851d`: 585 passed, **5 failed** (the two M-REMOVED cases of `pwa/09-outage-and-removal` on desktop-chrome,
    pixel-7 and iphone-15). Root cause: the harness planted the clinic pin before the sign-in, which L-N4 now (correctly)
    expires on the signed-out `/login` load; fixed in `f21a4b6` (pin set once signed in), targeted re-run 16/16
    (`close/e2e/run1-summary.txt`, `close/e2e/root-causes.txt`);
  - run 2 at `f21a4b6`: **590 passed, 0 failed, 0 flaky, 0 retried**, 196 skipped by project filters; desktop-chrome 391,
    pixel-7 146, iphone-15 38, pwa-ipados 7, setup 8; the 8 KNOWN-BUG markers fail with their markers; teardown removed
    its run data and verified none remain (`close/e2e/playwright-summary.md`, `close/e2e/e2e-pr-tail.txt`). The JSON
    report itself is not committed (it carries server log output).
- **Gate-close fixes, without → with:** `close/fails-without-vitest.txt` (10 of 20 fail at `e7d99ce`),
  `close/fails-without-e2e.txt` (L-N3: cookies deleted on mount, desktop-chrome and pixel-7), `close/with-fix-vitest.txt`
  (77/77).
- **Gitleaks** over the gate-close commits: `close/gitleaks.txt`.

## Acceptance (roadmap §12.2 V2-06; mapping in `06-PLAN.md` "Acceptance mapping (roadmap V2-06, binding)")
Per-criterion counts are read from the PR-lane report (run 2, `f21a4b6`, `--retries=0`) and both evidence Vitest runs
by `close/acceptance-results.txt`. In Playwright's terms "expected" = passed as expected (the 8 KNOWN-BUG `test.fail`
markers fail with their marker, as designed).

| # | Criterion | Evidence (tool output) | Result |
|---|---|---|---|
| 1 | axe shows 0 serious or critical issues on the gallery | `design/gallery-axe.spec.ts` 5/5 and every `design/*-axe.spec.ts` 41/41 on desktop-chrome (the PR-lane project for axe, R-27; skipped on pixel-7 by the project filter), 0 retried; the G3 set's axe column: 129 captures, 0 serious/critical in scope (`evidence/06-08/screens/README.md`, set `38b614c`) | **Met** |
| 2 | screenshots at 360/820/1180/1280 match the G2-D direction and are approved by the PO | The set: 33 screens, 129 captures, each next to its G2-D reference at `3a78a5d` (`evidence/06-08/screens/README.md`), **regenerated after the design review fixes in `4e4c89b4cf58ce215a1f0449b62805cb82f095c7`** (`npm run e2e:g3` on the build of `2a23550`: 138 passed, index "129 capture(s) … 0 problems", axe serious/critical 0 in every screen's scope, no horizontal scroll; `evidence/06-09e/g3-run.txt`). The isolated G3 design reviewer's notes: `reviews/v206-review-design.md` (approve with changes; outcome below) | **Pending PO (06-P6)** on set `4e4c89b`; design reviewer **run**, all 5 Mediums fixed (06-09e) |
| 3 | the grep guards, including the AI-02 "AI" copy grep, are in report mode | `npm run ci:ui-policy`: 6 report rules (counts = baseline, delta 0), 3 enforced rules at 0 (`brand-utility`, `screen-height`, `signout-guard`), PASS (`close/ui-policy.txt`, every finding in `close/ui-policy.json`); `npm run ci:ai-l1` PASS (`close/ai-l1.txt`; the L1 AI grep stays blocking, R-13) | **Met** (L1 stricter than report mode, R-13) |
| 4 | v1 screens still work (M0 e2e green) | The whole PR lane at `f21a4b6`: 590 passed, 0 failed, 0 flaky, 0 retried (desktop-chrome 391, pixel-7 146, iphone-15 38, pwa-ipados 7, setup 8; 196 skipped by project filters), incl. `m0/*.spec.ts` 22/22 (desktop-chrome 10, pixel-7 10, iphone-15 2) and the 8 KNOWN-BUG markers failing with their markers (`close/e2e/playwright-summary.md`) | **Met locally**; CI pending |
| 5 | Chrome reports the app installable | `pwa/02-installable.spec.ts` desktop-chrome and pixel-7 passed; `installabilityErrors: []`, `manifestErrors: []` on both (`close/e2e/installability-{desktop-chrome,pixel-7}.json`, checked 2026-11-15 in run 2) | **Met** |
| 6 | the cache-audit spec finds no authenticated response in Cache Storage | `pwa/05-cache-audit.spec.ts` "Today, a patient, a consult, billing and a receipt: nothing authenticated is cached or stored" passed on desktop-chrome and pixel-7 | **Met** |
| 7 | every sign-out path clears caches and storage | `pwa/05-cache-audit.spec.ts` exit-path legs: Sign out, Sign out of all devices, Switch user, Expired, Removed, Offline sign-out, and the held-open server call, each passed on desktop-chrome, pixel-7 and iphone-15 (WebKit) (21 runs); plus `06-tabs-and-devices` 12/12, `09-outage-and-removal` 8/8, `11-refresh-outage-and-pin` 8/8, `12-forgot-password-refresh` 4/4 | **Met** for the paths that exist; idle sign-out is V2-11 (AUTH-09); real iOS offline → 06-P8 |

Gate-close specs and the V2-06 security specs in both evidence runs (`close/acceptance-results.txt`, identical in run 1
and run 2): `session-auth-close-db` 9/9, `session-auth-reverify-db` 57/57, `auth-failure` 11/11, `auth-outage-db` 16/16,
`active-clinic-removed-db` 8/8, `session-status-db` 10/10, `session-status` 28/28, `hard-sign-out` 36/36, `purge` 24/24,
`sw-allowlist` 35/35, `proxy-no-store-db` 8/8, `palette-search-db` 6/6, `nav-for-role` 30/30, `approved-tokens` 248/248,
`contrast` 247/247, `ui-policy` 14/14, `ui-policy-signout-guard` 4/4, `react-compiler-waivers` 17/17.

## Roadmap tests and evidence
| Item | Evidence | Result |
|---|---|---|
| Playwright screenshot + axe on `/dev/ui` | The G3 set (129 captures, axe in scope 0 serious/critical) and the `design/*-axe.spec.ts` PR-lane specs 41/41 (above) | Met (approval: 06-P6) |
| Keyboard and focus tests per primitive (R-14: real browser on `/dev/ui`, Vitest for the pure mappings) | `design/keyboard/*.spec.ts` 66/66 on desktop-chrome, 0 retried; Vitest `tests/design/{input-kind,gallery,age}.spec.ts`, `tests/clinical/{visit-status,vitals,rx}.spec.ts` in both evidence runs (`close/acceptance-results.txt`) | Met |
| The M0 characterisation suite | `m0/*.spec.ts` 22/22 in the PR lane (above) | Met locally; CI pending |
| PWA_STRATEGY §10 V2-06 row: specs 1–6, 8, 10, 11 | 1 `pwa/01-manifest` 14/14; 2 `pwa/02-installable` 2/2; 3 `pwa/03-sw` 6/6; 4 `pwa/04-offline` 4/4 (+ Button's offline guard, 06-02a); 5 `pwa/05-cache-audit` 23/23; 6 `pwa/06-update` 17/17, `pwa/06-tabs-and-devices` 12/12; 8 `pwa/08-layout` 6 passed / 6 skipped by viewport (`shell/*` 69 passed); 10 `pwa/10-ipados` 7/7; 11 the enforced `signout-guard` rule, 0 findings (`close/ui-policy.txt`), `tests/ci/ui-policy-signout-guard.spec.ts` | Met (spec 7 → V2-07/V2-08, spec 9 → V2-13b) |
| 0 `min-h-screen`/`h-screen` | `screen-height` enforced, 0 findings (`close/ui-policy.txt`) | Met |
| Bundle report (P2-02, report-only) | `evidence/06-07/route-js/`, `m0-route-js-before-after.md`; CI `route-js` artifact | Met (report-only; blocking at V2-15) |
| LHCI report published (PWA-09, report-only) | `evidence/06-07/lhci-summary.json` (local run, 06-07); nightly job after the merge | Met locally; first nightly after merge |
| Evidence: CI links | Placeholder below | **Pending CI (orchestrator)** |
| Evidence: design review notes | `reviews/v206-review-design.md` (committed `2fc51b3`); fixes `06-09e-DESIGN-FIXES.md` | **Met** |
| Evidence: `/gsd-secure-phase` | not produced (CTO ruling) | **Not run (CTO ruling; PO may ask at 06-P7)** |

## Reviews (CLAUDE.md DoD 6) — reports in `reviews/`
| Range / commit | Reviewer | Severity (H/M/L/I) | Outcome |
|---|---|---|---|
| Wave A, `ef24000` | Independent | 0/4/6/8 | M-1…M-4 fixed in 06-09a (M-EVERYWHERE, M-ERRCAP, M-OFFLINE, M-GUARD); Lows fixed or assigned |
| Wave A, `ef24000` | Adversarial A (PWA, sign-out) | 1/2/3/4 | H-1 = H-WEBKIT, M-EVERYWHERE, M-TABS fixed in 06-09a |
| Wave A, `ef24000` | Adversarial C (client errors, reports) | 0/2/3/6 | M-ERRCAP fixed; I-2 → V2-14 |
| `4a4c796` | Re-verification (adversarial) | H-WEBKIT CLOSED; M-EVERYWHERE, M-ERRCAP, M-GUARD CLOSED, M-OFFLINE CLOSED (Chromium), M-TABS PARTIAL → N-1 (M); N-2, N-3 (L); N-4…N-7 (I) | N-1, N-2, N-7 fixed in 06-09b (N-1: 5-minute links + `no-store` PDFs; residual open tab → V2-09c viewer, CTO); N-3 → V2-14; iOS offline → 06-P8 |
| Wave B, `136cd04` | Independent | 1/5/7/3 | H-1 = H-AUTHOUT; M-VITALS, M-RXKEYS, M-PICKER, M-DATE, M-INFANTAGE and L-1…L-7 fixed in 06-09c; I-1 ruling; I-2, I-3 → V2-08 |
| Wave B, `136cd04` | Adversarial B (session status, palette, nav) | 1/1/2/5 | H-AUTHOUT, M-REMOVED, L-1 fixed in 06-09c; L-2 → V2-12 |
| `de553cd` | Re-verification (adversarial) | H-AUTHOUT PARTIAL → H-AUTHOUT-R1 (H); M-REMOVED PARTIAL → M-REMOVED-R1 (M); L-R1…L-R4 | All fixed in 06-09d |
| `f9298e0` | Second re-verification (adversarial) | H-AUTHOUT-R1 CLOSED, M-REMOVED-R1 CLOSED, 0 new H/M; L-N1…L-N4; 1 Info | L-N1…L-N4 fixed at the gate close (`5197b1a`), no further round (PO speed ruling) |
| G3 set `38b614c` | Isolated G3 design reviewer (`v206-review-design.md`) | 0/5/12/8 (H/M/L/Polish) | **Approve with changes.** M1-M5 fixed in 06-09e with browser tests; 17 Lows/Polish fixed, checked or ruled, 4 deferred (below); one independent check by the orchestrator (UI, speed ruling) |

**All Highs and Mediums are closed:** H-WEBKIT and H-AUTHOUT (→ H-AUTHOUT-R1, closed after two re-verification
rounds), M-EVERYWHERE, M-TABS (→ N-1), M-ERRCAP, M-OFFLINE, M-GUARD, M-REMOVED (→ M-REMOVED-R1), M-VITALS, M-RXKEYS,
M-PICKER, M-DATE, M-INFANTAGE. Every fix has a regression test that fails without it: each record's fails-without
evidence (`evidence/06-09a/`, `06-09b/`, `06-09c/`, `06-09d/`), and for the gate close:
- `close/fails-without-vitest.txt` (the close specs at `e7d99ce`, the code before the four Lows): 10 of 20 fail. L-N1:
  `{ ok: false, code: 'unknown' }` instead of `{ ok: true, … }` (the password had changed); the two transport cases.
  L-N2: the 4.5 s refresh is marked `unavailable`; the bound constants are missing. L-N4: the pin is not expired in the
  revoked, signed-out page and action cases, and D5 keeps A's pin. The controls (an outage and a signed-in request keep
  the pin) and the unchanged transport cases pass before and after.
- `close/fails-without-e2e.txt` (L-N3, the page at `e7d99ce` on a fresh build): on desktop-chrome and pixel-7 the auth
  cookies are deleted when `/forgot-password` mounts (expected the device's cookie, received none).
- `close/with-fix-vitest.txt`: the same specs plus the 06-09d re-verification spec at the fixed tree, 77/77.

No test was retried to green: Vitest has no retries, and the Playwright lane ran with `--retries=0`.

## CTO rulings recorded at this gate
See `06-SUMMARY.md` § "CTO rulings made in V2-06" (plan rulings R-1…R-43; the G2-D addendum items; Lighthouse CI
0.15.1 accepted, the 06-P4 confirmation; the offline stylesheet in the shell cache; document links 5 minutes; admins
without Doctor's Cabin; a forged clinic cookie signs out only the forger; Auth outage ≠ sign-out; the proxy's 5.5 s
budget). The PO confirms or overturns them at 06-P7.

## Not yet verifiable or not met (owner)
- **06-P6 (PO): the G3 screenshot set** (`evidence/06-08/screens/README.md`, set commit
  `4e4c89b4cf58ce215a1f0449b62805cb82f095c7`, regenerated after the design review fixes; the set the reviewer read was
  `38b614c`). Pending approval.
- **06-P7 (PO):** doc errata E-1…E-13 (`06-08-CLOSE-OUT.md`) and the CTO rulings; proposed CLAUDE.md Commands update
  (phase close step 6).
- ~~06-P5~~ **accepted by CTO ruling (2026-11-15, PO delegation)**: see "CTO ruling: 06-P5" below.
- **`/gsd-secure-phase` over T-06-01…T-06-21 and T-06-SC (`reviews/v206-secure-phase.md`) — not run.** CTO ruling
  (2026-11-15), as at V2-05a and 05b: the review set (two independent reviews, three adversarial reviews and three
  adversarial re-verification rounds, `reviews/v206*-*.md`) covers the security-sensitive rows (service worker, public
  paths, no-store, sign-out and purge, client errors, session status, the palette's PHI projection, navigation by role,
  the Auth transport and the clinic pin) and stands in its place under the PO's speed ruling. The PO may still ask for
  it at 06-P7.
- **Real iPhone (06-P8):** the offline sign-out landing and other-tab behaviour on iOS Safari and the Home Screen app;
  Playwright WebKit cannot run a worker offline. When staging is live.
- **After merge (plan phase close step 7):** the read-only staging `curl` checks of the public PWA assets and the
  nightly `design`/`sw-update`/LHCI first runs.
- **Merge order:** #6 → #8 → #10 → #9, each retargeted to `feature/v2` as the one below merges, merge commits only
  (`06-SUMMARY.md` § Merge order).

## G3 design review outcome (06-09e)
`reviews/v206-review-design.md` (isolated reviewer; read the set at `38b614c` against `3a78a5d` and `06-UI-SPEC.md`):
**approve with changes**, High 0 · Medium 5 · Low 12 · Polish 8. Record: `06-09e-DESIGN-FIXES.md` (per-finding table,
before = set `38b614c`, after = set `4e4c89b`).
- **Fixed (all Mediums):** M1 one Back control (the v1 in-page arrows on the consult and the record removed); M2 queue
  rows keep their actions in a right-hand column below 1280 px (~80 px rows, 44 px targets); M3 one-line BottomBar
  captions with aligned icons (visible "Cabin", "Queue", "Calendar"; the v1 names stay the accessible names); M4 no
  monospace on product screens or login (`tabular-nums` Inter; new enforced UI-policy rule `mono-font`, Developer
  settings excepted); M5 install card, `/offline` and route-state headings in the Manrope hierarchy, `/offline` with
  the WifiOff glyph and Retry's RefreshCw.
- **Fixed (Lows/Polish):** L1 (product name line removed), L3, L4, L6, L7 (v1 With-doctor pills teal), L8, L10, L11,
  P1, P3, P4, P5, P6, P7, P8. **Checked:** L12 (one h1 per shell route, tested). **Ruled:** L5 (artefact of the e2e-only
  diagnostic route), L9 (the Rx "M" hint arrives with the shortcut in V2-09, CD-18; noted in the UI-SPEC).
- **Deferred:** L1 place line and L2 display name → V2-11; P2 typographic apostrophes (one sweep of copy and specs) →
  V2-11; v1 status labels onto StatusChip → V2-08/V2-11.
- **Tests (tool outputs, `evidence/06-09e/`):** `tests/e2e/shell/design-review-09e.spec.ts` 35 passed (desktop-chrome 33,
  pixel-7 2) and the whole PR lane `npm run e2e:pr -- --retries=0` on the build of `2a23550`: **625 passed, 0 failed,
  0 flaky, 0 retried**, 229 skipped by project filters (desktop-chrome 424, pixel-7 148, iphone-15 38, pwa-ipados 7,
  setup 8; the 8 KNOWN-BUG markers fail with their markers; `e2e/playwright-summary.txt`). Static: typecheck, `eslint .
  --quiet`, inventory, `ci:ai-l1`, contrast (242 pairs, 0 fail), `ci:ui-policy` (mono-font enforced, 0) all exit 0
  (`static.txt`). Full Vitest: 307 files / 6307 tests passed, 0 failed, 0 skipped (`vitest-full-summary.txt`); report
  gate PASS with FLOOR 5992 (6307 × 0.95) and 220 required files (+ `tests/design/design-review-09e.spec.ts`;
  `vitest-report-gate.txt`). pgTAP not re-run (no SQL in 06-09e).
- **CI run 43705726084 at `bab829e` (2 failures, `loading-states.spec.ts`, Live Queue and Calendar):** root cause and
  fix in `06-09e-DESIGN-FIXES.md`: `clickNavLink` matched Today's own links once Today had streamed in, which CI's fresh
  stack did before the click and the busy local stack did not (a race, not data). Locators scoped to the navigation;
  the spec now waits for the source page to finish, so the condition is deterministic; fails without the scope fix
  (`evidence/06-09e/loading-states-fails-without.txt`), passes in the PR lane above (desktop-chrome 10/10, the
  project the spec runs on).

## CTO ruling: 06-P5 (2026-11-15, PO delegation)
The CTO, acting under the PO's delegation (PO ruling "delivery speed", 2026-11-14), accepts **06-P5**, the plan's merge
blocker for the Wave B packages and the font and icon files (`06-PLAN.md` "New dependencies and pinned artefacts";
`evidence/package-legitimacy.json`):
- **npm packages, exact pins:** `radix-ui` 1.8.1 (06-02a), `cmdk` 1.1.1 and `sonner` 2.0.8 (06-02b), `react-day-picker`
  10.0.2 (06-02c), each with the reason and the research audit recorded in the plan (no install scripts; `cmdk`'s
  dialog dependency dedupes under `radix-ui`; `react-day-picker`'s `date-fns` / `@date-fns/tz` ranges satisfied by the
  existing pins).
- **Fonts, local files:** Inter (variable woff2, Latin + Latin Extended) and Manrope (variable woff2, Latin + Latin
  Extended), both under the SIL Open Font License 1.1 (`app/fonts/Inter-OFL.txt`, rsms/inter's own licence;
  `app/fonts/Manrope-OFL.txt`), SHA-256 and provenance in `app/fonts/PROVENANCE.md`.
- **Brand kit:** the CliniQ AI icon masters (`icon.svg`, `icon-maskable.svg`) and the favicon and PNG icons rendered from
  them (R-24), from the PO's CliniQ AI brand kit v1.0, applied verbatim (V2-DX `d2e399f`, copied at `3a78a5d`).
The PO may overturn this at 06-P7.

## CI run
Source: `evidence/ci-run.json` and `evidence/ci-pgtap-report.tap` (written by `scripts/phase-evidence.mjs --ci-run 43733539968`).

- Run: https://github.com/thecliniqai/cliniqai-app/actions/runs/43733539968 (pull_request, branch `v2/phase-06-design-system-pwa-shell`)
- Head SHA: `6ea101579e20b199ee84e6faa5d4c34c0488ffe3`; conclusion: **success**
- pgTAP gate (CI): `{"artifact": "ci-pgtap-report.tap", "gate": "PASS", "files": 47, "total": 7892, "passed": 7892, "failed": 0, "skipped": 0, "per_file": [{"name": "supabase/tests/database/access_lock_rls.test.sql", "planned": 26, "ran": 26, "passed": 26}, {"name": "supabase/tests/database/actor_bindings_audit.test.sql", "planned": 34, "ran": 34, "passed": 34}, {"name": "supabase/tests/database/admin_policies.test.sql", "planned": 32, "ran": 32, "passed": 32}, {"name": "supabase/tests/database/ai_gating_l2.test.sql", "planned": 115, "ran": 115, "passed": 115}, {"name": "supabase/tests/database/ai_quota.test.sql", "planned": 41, "ran": 41, "passed": 41}, {"name": "supabase/tests/database/amendment_snapshot.test.sql", "planned": 60, "ran": 60, "passed": 60}, {"name": "supabase/tests/database/api_keys_notices_columns.test.sql", "planned": 26, "ran": 26, "passed": 26}, {"name": "supabase/tests/database/audit_v2.test.sql", "planned": 24, "ran": 24, "passed": 24}, {"name": "supabase/tests/database/authz_completeness.test.sql", "planned": 6, "ran": 6, "passed": 6}, {"name": "supabase/tests/database/authz_helpers.test.sql", "planned": 77, "ran": 77, "passed": 77}, {"name": "supabase/tests/database/authz_matrix.test.sql", "planned": 6240, "ran": 6240, "passed": 6240}, {"name": "supabase/tests/database/billing_access.test.sql", "planned": 45, "ran": 45, "passed": 45}, {"name": "supabase/tests/database/billing_catalogue.test.sql", "planned": 30, "ran": 30, "passed": 30}, {"name": "supabase/tests/database/billing_entitlements.test.sql", "planned": 30, "ran": 30, "passed": 30}, {"name": "supabase/tests/database/billing_grants.test.sql", "planned": 24, "ran": 24, "passed": 24}, {"name": "supabase/tests/database/billing_rpc_only.test.sql", "planned": 25, "ran": 25, "passed": 25}, {"name": "supabase/tests/database/clinical_notes.test.sql", "planned": 53, "ran": 53, "passed": 53}, {"name": "supabase/tests/database/clinical_notes_backfill.test.sql", "planned": 9, "ran": 9, "passed": 9}, {"name": "supabase/tests/database/composite_fks.test.sql", "planned": 105, "ran": 105, "passed": 105}, {"name": "supabase/tests/database/contract_05a.test.sql", "planned": 18, "ran": 18, "passed": 18}, {"name": "supabase/tests/database/definer_functions.test.sql", "planned": 71, "ran": 71, "passed": 71}, {"name": "supabase/tests/database/delete_rules.test.sql", "planned": 35, "ran": 35, "passed": 35}, {"name": "supabase/tests/database/domain_policies.test.sql", "planned": 42, "ran": 42, "passed": 42}, {"name": "supabase/tests/database/drop_v1_subscriptions.test.sql", "planned": 4, "ran": 4, "passed": 4}, {"name": "supabase/tests/database/fk_indexes.test.sql", "planned": 4, "ran": 4, "passed": 4}, {"name": "supabase/tests/database/gate_close_05b.test.sql", "planned": 12, "ran": 12, "passed": 12}, {"name": "supabase/tests/database/grants.test.sql", "planned": 15, "ran": 15, "passed": 15}, {"name": "supabase/tests/database/invitation_accept_context.test.sql", "planned": 17, "ran": 17, "passed": 17}, {"name": "supabase/tests/database/invitation_binding.test.sql", "planned": 14, "ran": 14, "passed": 14}, {"name": "supabase/tests/database/invitations_v2.test.sql", "planned": 75, "ran": 75, "passed": 75}, {"name": "supabase/tests/database/memberships_bounds_cleanup.test.sql", "planned": 7, "ran": 7, "passed": 7}, {"name": "supabase/tests/database/migration_edge_cases_fk.test.sql", "planned": 21, "ran": 21, "passed": 21}, {"name": "supabase/tests/database/migration_edge_cases_overlap.test.sql", "planned": 9, "ran": 9, "passed": 9}, {"name": "supabase/tests/database/migration_edge_cases_visit_integrity.test.sql", "planned": 17, "ran": 17, "passed": 17}, {"name": "supabase/tests/database/platform_rpcs.test.sql", "planned": 80, "ran": 80, "passed": 80}, {"name": "supabase/tests/database/queue_tokens.test.sql", "planned": 34, "ran": 34, "passed": 34}, {"name": "supabase/tests/database/referrals_rules.test.sql", "planned": 48, "ran": 48, "passed": 48}, {"name": "supabase/tests/database/remove_member.test.sql", "planned": 81, "ran": 81, "passed": 81}, {"name": "supabase/tests/database/reverify_integrity.test.sql", "planned": 61, "ran": 61, "passed": 61}, {"name": "supabase/tests/database/review_fixes_05b.test.sql", "planned": 42, "ran": 42, "passed": 42}, {"name": "supabase/tests/database/scheduling_exclusion.test.sql", "planned": 26, "ran": 26, "passed": 26}, {"name": "supabase/tests/database/search_medicines_extension_schema.test.sql", "planned": 6, "ran": 6, "passed": 6}, {"name": "supabase/tests/database/signed_visit_fields.test.sql", "planned": 26, "ran": 26, "passed": 26}, {"name": "supabase/tests/database/storage_policies.test.sql", "planned": 46, "ran": 46, "passed": 46}, {"name": "supabase/tests/database/subscription_invariant.test.sql", "planned": 14, "ran": 14, "passed": 14}, {"name": "supabase/tests/database/tenant_local_dates.test.sql", "planned": 20, "ran": 20, "passed": 20}, {"name": "supabase/tests/database/visit_integrity.test.sql", "planned": 45, "ran": 45, "passed": 45}], "problems": []}`
- Retried tests: 0 (CI e2e job "Run summary": "Retried to pass (flaky): 0"; 629 passed)
- Earlier red/flaky runs on the way (43705726084, 43712054628, 43724590429, 43728153203) were root-caused and fixed
  (records in `evidence/06-09e/` and `06-WAVE-NOTES.md`): Live Queue/Calendar locator scope, a second `<main>` on the
  consult, clinic-zone dates on the calendar and patient record (a real production bug), overlays-axe time budget,
  IND L-6 goto racing the app's own redirect, and the skew spec counting the bell's Server Actions.

| Job | Conclusion |
|---|---|
| e2e | success |
| build | success |
| static | success |
| test | success |
| security | success |
