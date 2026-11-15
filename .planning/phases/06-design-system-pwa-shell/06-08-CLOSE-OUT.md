---
phase: 06
plan: 06-08
subsystem: V2-06 close-out (03-06 carry-over R-30, UI policy report, G3 screenshot set, report gate, nightly lanes)
status: complete (local)
plan_head_before: 136cd04
commits: [64822b4, 01e6dfc, ed550b6, 3133b98, 9367de9, 42ea198, 9858ec7, 2f74024, docs commit]
code_head_after: 2f74024
requirements: [R-30 (03-06 carry-over), roadmap V2-06 acceptance 1-3 evidence, roadmap evidence "the screenshot set", 06-PLAN phase close step 1]
---

# 06-08 record: React Compiler rules to error, policy report, G3 screenshot set, report gate

Plan: `06-PLAN.md` § 06-08 (Wave 11, after G2-D; tooling and evidence, one independent review plus the G3 design
reviewer, R-37). Branch `v2/phase-06-design-system-pwa-shell`, worktree `scratchpad/v206-worktree`, plan base
`136cd04` (every V2-06 plan through 06-04b and 06-06, plus the 05b gate tip). The local stack was at 000094, matching
the branch; it was not reset, stopped or reseeded. Builds and e2e ran under `scratchpad/e2e-lane.lock` (owner file
"06-08 executor", port 3100 checked free first, released after each run). Every number below is tool output: a file
in `evidence/06-08/` or the command named in the row. The phase gate evidence (`phase-evidence.mjs`), 06-SUMMARY,
06-VERIFICATION and the reviews are the orchestrator's (not run here).

## What changed

| Area | Change | Files |
|---|---|---|
| React Compiler rules (step 1, R-30) | `react-hooks/set-state-in-effect`, `purity`, `immutability` are `error` again. The tree had **33** sites at the plan base (V2-03 counted 35; V2-06 code that replaced v1 removed 2): set-state-in-effect 27, purity 5, immutability 1 (`evidence/06-08/react-compiler-sites.json`, ESLint JSON before and after). **13 fixed**, **20 waived** in 11 files. An inline `eslint-disable` naming one of the three rules fails the new `clinicos/no-compiler-rule-directive` (waivers go through the register only) | `eslint.config.mjs` |
| Fixes (13 sites) | *purity 5:* the consult's age in months and the "Last seen N days ago" banner count **clinic calendar days** with the new `daysBetweenYmd(from, to)` against the clinic's today (`todayInTz`), not a render-time `Date.now()` (a hydration hazard; "today" now means the same clinic date rather than "less than 24 h"); two id helpers (`Math.random`, `Date.now` in event handlers) moved to module level, values unchanged; the server-only `/settings/billing` comp-period check moved to a module-level helper (a server component: the clock read is correct there, the rule cannot tell). *immutability 1:* the public reschedule page's effect now sits after the `loadSlots` it calls. *set-state-in-effect 7:* reset-on-open and sync-from-props moved from effects into render with the same triggers ("adjusting state when a prop changes", react.dev): Sign & Bill (`isOpen`, `canCollect`), amendment (`isOpen`), triage vitals (`isOpen`, `existingVitals`), edit patient (`patient`), calendar view (`visits`), age/DOB input (`dobValue`, `ageValue` ×2) | `components/consultation/{consultation-workspace,returning-patient-catchup,chief-complaints-section,diagnosis-section,sign-and-bill-modal,amendment-modal}.tsx`, `components/queue/triage-vitals-modal.tsx`, `components/patients/{edit-patient-modal,age-dob-input}.tsx`, `components/calendar/calendar-view.tsx`, `app/(dashboard)/settings/billing/page.tsx`, `app/reschedule/[token]/page.tsx`, `lib/datetime/index.ts` |
| Waivers (20 sites, 11 files) | `scripts/ci/react-compiler-waivers.json`: per entry `file`, `rule`, exact `sites` (a ratchet), `owner`, `added` 2026-11-15, `expires` 2027-02-13 (90 days), `reason`. Applied as per-file `warn` overrides (literal globs, so `app/(dashboard)/…` matches); **an expired entry is no longer applied**, so its file fails lint again. Owners: V2-08 (`patients/new/page.tsx` 1, `booking-drawer` 4, `waitlist-drawer` 2, `walk-in-drawer` 3), V2-09b (`diagnosis-section` 2, `frequent-rx-chips` 1), V2-09c (`prescription-builder` 2), V2-10 (`checkout-drawer` 2), V2-11 (`patient-directory-table` 1, `patient-lab-documents` 1, `use-notifications` 1). Why not fixed now: every one is a debounced search, a fetch-on-mount or several coupled reset effects in a v1 drawer that its owner phase replaces; changing their timing in v1 would change behaviour the M0 specs characterise (booking, walk-in, checkout amounts) for code that is about to be deleted. `node scripts/ci/react-compiler-waivers.mjs` checks the register (`evidence/06-08/react-compiler-waivers.txt`: 11 entries, 20 sites, PASS) | `scripts/ci/react-compiler-waivers.{json,mjs}` |
| Policy report (step 2) | `raw-palette` also reports the **approved raw CliniQ AI names** everywhere, primitives included (`mineral-*`, `primary-*`, `brass-*`, `teal-550`, `success\|warning\|danger\|info-50/600`, `focus`, `focus-halo`; the 06-01b wave note: `RAW_V1` matched nothing any more); semantic look-alikes (`success-bg`, `danger-solid`, `ring-halo`, `focus-ring`) are not findings. 0 such uses in the tree. Final counts → `evidence/06-08/ui-policy.json` (every finding, deltas against the old baseline); the baseline is refreshed to them and gains the enforced `signout-guard` key (06-05 hand-over) | `scripts/ci/ui-policy/rules/raw-palette.mjs`, `lint-fixtures/ui-policy/raw-approved/**`, `scripts/ci/ui-policy-baseline.json` |
| G3 screenshot set (step 3) | `tests/e2e/design/screens/screenshot-set.spec.ts` captures the 33 screens of `g3-screens.json` at 360/820/1180/1280 (the More sheet at 360 only): the 8 `/dev/ui` sections (element captures, browser clock frozen at 12 Nov 2026 11:30 IST), the shell routes for the owner (Today, Live Queue, Calendar, Patients, a patient, Billing & Reports, Clinic Profile, palette open, account menu open, More sheet), the receptionist (Today, Live Queue, Calendar, Patients) and the doctor (Cabin, the consult in focus mode), Login, `/offline`, the install card and the iOS install sheet, the update toast, and the four route states. axe (M0 tags) runs in each screen's scope (the section, the overlay, the shell without `<main>`, `#main` for in-shell states, the page for standalone ones); the test fails on a serious/critical violation there or on horizontal scroll; for shell routes the whole page is recorded for reference. `scripts/design/screenshot-index.mjs` writes `screens/README.md` (a summary and one table per width: capture, the G2-D reference at `3a78a5d` linked by commit and path, what to compare, axe, scroll) and fails on a missing capture, an orphan file or a reference missing at `3a78a5d`. `npm run e2e:g3` runs both | `tests/e2e/design/screens/{screenshot-set.spec.ts,g3-screens.json}`, `scripts/design/screenshot-index.mjs`, `package.json` (script) |
| Report gate (step 4) | `REQUIRED_FILES` gains the 40 Vitest specs V2-06 added outside `tests/e2e` (213 in total; list from `git diff --diff-filter=A 57824b0 HEAD -- tests` minus the 05b specs); FLOOR 4826 → **5872**: the full suite at the 06-08 tree had 6181 tests in 300 files, 0 skipped; 6181 × 0.95 = 5871.95 → 5872 (file header; `vitest-report-gate.spec.ts` follows the default) | `scripts/ci/assert-vitest-report.mjs`, `tests/ci/vitest-report-gate.spec.ts` |
| Nightly lanes | `design`: `npm run e2e:design` (the whole design lane, the G3 set included) then the index; artifact `g3-screens`. `sw-update`: `npm run e2e:sw-update` (06-09a hand-over: two builds, too slow for the PR lane). Both feed `report-failure`. `workflow-policy.mjs` PASS | `.github/workflows/nightly.yml` |
| Design lane runs anywhere | The operator-only captures (`neutral/capture.spec.ts`, `screens/shell-capture.spec.ts`) skip when their label file is absent instead of throwing, so `npm run e2e:design` (phase close step 2, nightly) runs without setup; the operator path always writes the label first | `tests/e2e/design/{neutral/capture,screens/shell-capture}.spec.ts` |
| Wave-note items | `freezeClock()` moved to `tests/e2e/support/clock.ts` (second user: the G3 set); the `/offline` comment names the `/sw.js` route (`app/sw.js/route.ts` → `lib/pwa/service-worker-source.ts`), not `public/sw.js` | `tests/e2e/support/clock.ts`, `tests/e2e/design/keyboard/data-and-dates.spec.ts`, `app/offline/page.tsx` |
| v1 Live Queue at 360 px | Found by the G3 set: the queue card was 8 px wider than the viewport (its action row could not wrap, the list's implicit grid column took the card's min-content width). CSS only: the action row wraps and the list is `grid-cols-1` | `components/queue/{queue-card,queue-view}.tsx` |

## Evidence (tool output)

| Check | Result | File |
|---|---|---|
| ESLint React Compiler sites, before (rules at warn) → after (rules at error) | 33 (27/5/1) → 20 set-state-in-effect, all in waived files at warn; `npx eslint .` 0 errors (440 warnings) | `react-compiler-sites.json` |
| Waiver register | 11 entries, 20 sites, PASS | `react-compiler-waivers.txt` |
| UI policy, final | ai-sdk-import 0, arbitrary-color 2, brand-utility 0 (enforce), link-wraps-button 31, px-font 266, raw-palette 3346, screen-height 0 (enforce), signout-guard 0 (enforce), window-dialog 27; PASS | `ui-policy.json`, `ui-policy-before-baseline.txt`, `ui-policy-after-baseline.txt` |
| G3 set | 33 screens, 129 captures; axe in scope 0 serious/critical on all 129; no horizontal scroll; whole-page serious/critical nodes recorded for reference 153 (v1 content in `<main>` on shell routes) | `screens/README.md`, `screens/<width>/<id>.{png,json}` |
| Full Vitest (`npx vitest run`, stack 000094 = branch) | 300 files, 6181 tests passed, 0 failed, 0 skipped (465 s) | `vitest-full-summary.txt` |
| Report gate on that report (new FLOOR and REQUIRED_FILES) | `files=300 tests=6181 passed=6181 failed=0 skipped/todo=0 floor=5872 required=213`, PASS | `vitest-gate.txt` |
| e2e PR lane (`npm run e2e:pr`: desktop-chrome, pixel-7, iphone-15, pwa-ipados) on the e2e build of `9858ec7` | 555 passed, **0 retried**, 0 unexpected, 185 skipped (project filters), 8 expected failures (the known-bug markers P1-07, F-04, P1-03 and the network-block self-test, each failing with its marker); 11.4 min. The server log's `ECONNRESET: aborted` lines are client-aborted requests (held navigations), not failures | `e2e-pr-summary.txt` (`playwright-summary.mjs`) |
| gitleaks | TBD-GITLEAKS | `gitleaks.txt` |

## Tests that fail without the change

- `tests/ci/react-compiler-waivers.spec.ts` (17): the three fixtures are errors at three unwaived app paths (route
  group included); a waiver downgrades only its own rule in its own file (a sibling path and the other two rules stay
  errors); an expired entry is not applied (a copy of the config in a temp dir: the expired file errors, a live one
  warns); an inline directive fails `clinicos/no-compiler-rule-directive`; the real register is in its time box and
  neither stale nor miscounted (sites measured with the rule at error); the checker rejects expired, over-90-day,
  future, stale, lowered, raised, ownerless, unknown-rule and duplicate entries. Mutants: the three rules back at `warn`
  → 5 tests fail; the expiry filter removed from the config → the expiry test fails.
- `tests/ci/ui-policy.spec.ts` + 1: the approved raw names are reported, primitives included, and the semantic
  look-alikes are not. Mutant: the new pattern removed → the test fails.
- `tests/utils/datetime.spec.ts` + 1: `daysBetweenYmd` across months, years and leap days; null for a timestamp or
  text.
- The G3 set: `screenshot-set.spec.ts` fails on serious/critical axe in scope or horizontal scroll (it failed the
  v1 Live Queue at 360 before the CSS fix); the index fails on a missing capture (`--check` before the commit: 129, 0
  problems).

## UI checks (DoD 3)

The set itself is the check: 129 captures at 360/820/1180/1280, axe 0 serious/critical in every scope, no horizontal
scroll. Looked at by eye: Today (1280), the palette (360), the install sheet (820), the loading skeleton (360), the
gallery dates (1280, frozen clock: Today is Thu 12 Nov) and the fixed Live Queue (360). The fixes touch no markup the
set does not cover except the reschedule page (public token page, logic order only) and `/settings/billing` (server
helper only).

## Deviations

1. **`package.json`** is not in 06-08's file list: one script, `e2e:g3` (the set plus the index), so the set is one
   command. No dependency change.
2. **v1 component files** outside the file list (the 13 fixes, the queue CSS): step 1 says each site is "fixed or
   listed", and the queue overflow was found by step 3's own check (Rule 1). `lib/datetime/index.ts` gains
   `daysBetweenYmd` (shared helper, unit-tested).
3. **Capture specs of 06-01a and 06-04b** skip without their label file (was: throw), so the plan's phase-close
   command `npm run e2e:design` and the nightly design job can run. Their operator paths are unchanged.
4. **Committed PNGs:** the G3 set is committed (14 MB, 129 PNGs), as the plan's invariant allows ("not the PNGs,
   except the G3 set") and as V2-DX did for its references (15.6 MB). Every other capture stays git-ignored.
5. **Spec location:** `tests/e2e/design/screens/screenshot-set.spec.ts` (the plan's § 06-08 file list; its order
   table says `tests/e2e/design/screenshot-set.spec.ts`). `screens/` is the folder the PR and nightly device lanes
   ignore.
6. **`2f74024`** wraps four comment lines after the e2e build and the G3 capture (comments only). The G3 set was
   captured on a build of the `ed550b6` tree and the PR lane ran on a build of `9858ec7`; the commits between them
   change no app code except one comment (`9367de9`).
7. **Root not-found** is captured signed in: signed out, the proxy's default deny sends `/no-such-page` to `/login`
   (as in 06-04a's own spec).

## Deferred, with owner (for 06-SUMMARY)

- **20 React Compiler sites** in 11 v1 files: owners V2-08, V2-09b, V2-09c, V2-10, V2-11 (register above), expiry
  2027-02-13. A phase that rebuilds one of these files drops its entry in the same commit.
- **Hand-rolled v1 dialogs without a focus trap (06-02b open item; 15 files):** 13 with `role="dialog"` outside
  `components/ui/` and 2 drawers with no dialog role. V2-08: `calendar/booking-drawer`, `calendar/waitlist-drawer`,
  `queue/walk-in-drawer` (no role). V2-09a: `consultation/amendment-modal`. V2-09b: `consultation/sign-and-bill-modal`.
  V2-09c: `consultation/pdf-preview-modal`. V2-10: `queue/checkout-drawer` (no role), `billing/receipt-modal`. V2-11:
  `staff/edit-staff-modal`, `referrals/{close-loop-modal,create-referral-modal,referrals-register}`,
  `notifications/notification-drawer`. V2-12: `consultation/ai-scribe-modal`,
  `settings/developer/webhook-delivery-logs-drawer`. Each moves onto `Dialog`/`ResponsiveSheet` with its screen.
- **v1 content axe debt** on shell routes (whole page 153 serious/critical nodes over 129 captures, in `<main>`):
  the owner phase of each screen (V2-08 Today/queue/calendar, V2-09b consult, V2-10 billing, V2-11 patients and
  settings). Outside the V2-06 gate (shell scope), recorded per capture.
- **Nightly `design` and `sw-update` first runs:** after the merge (schedules run on the default branch).

## Doc errata proposals (for the PO; not applied)

From 06-PLAN phase close step 5 and the CTO ruling "Doc errata (DESIGN_SYSTEM, PWA_STRATEGY, PO-19): proposed at
phase close, as planned" (VERIFICATION_LOG, G2-D addendum 2026-11-14). Each is a dated erratum note to add to the
approved document if the PO agrees; none changes scope.

| # | Document and place | Today it says | Proposed erratum | Basis |
|---|---|---|---|---|
| E-1 | DESIGN_SYSTEM §1, §2.1–§2.4 | "Brand: Clinic Teal" palette, teal accent, its raw scale and Tailwind block | The approved palette is the CliniQ AI brand theme: CliniQ Blue `#246BCE` accent (hover `#1D58AB`, pressed `#1B4A8C`, subtle `#EEF5FD`), Midnight `#0B1A42` text, slate neutrals under the old `mineral-*` names, white canvas and surface, focus `#3A80D9` on a 2 px white halo, a hue per visit status (none the primary blue; With doctor Care Teal with border `teal-550` `#11998D`; Cancelled an outlined grey pill). Source of truth: `app/globals.css` (= V2-DX `3a78a5d` `clinic-paper.css` + `cliniq-ai.css`, 244 names compared by `tests/design/approved-tokens.spec.ts`) | G2-D addendum 2026-11-14; 06-01b |
| E-2 | DESIGN_SYSTEM §3.1 | IBM Plex Sans (+ Devanagari, Mono) | Inter (body and UI) and Manrope (titles, display text, prices, token numbers), both variable woff2, Latin + Latin Extended, loaded with `next/font/local` (no network at build); no Devanagari face loads in v2.0 (no Hindi UI) | G2-D 2026-11-13 (Inter), brand theme 2026-11-14 (Manrope) |
| E-3 | DESIGN_SYSTEM §4.3 | radius-sm/md/lg/xl 4/6/10/14 px | 6/10/14/20 px (`rounded-sm/md/lg/xl`), pill 999 px | `cliniq-ai.css` at `3a78a5d` |
| E-4 | DESIGN_SYSTEM §4.6 (update note) | App icon "a teal tile with the brand glyph (working name "ClinicQ", a "Q" glyph)"; `themeColor` "follows the surface token in light and dark" | The icon is the CliniQ AI mark on a white tile (masters `app/icon.svg`, `scripts/design/brand/icon-maskable.svg`; PNGs rendered by `render-icons.mjs`); the favicon below 32 px is the small mark; `themeColor` is `#FFFFFF`, light only (no dark `themeColor`, the app is light-theme only per §2.4) | G2-D addendum (CTO rulings: theme colour, favicon); R-42 |
| E-5 | PWA_STRATEGY §3.1 manifest table | `name`/`short_name` placeholder "ClinicQ"; `background_color` `#F6F5F1` (`paper`) | `name` and `short_name` "CliniQ AI"; `background_color` `#FFFFFF` (the canvas is white); `theme_color` unchanged `#FFFFFF` | PO ruling "CliniQ AI is a fixed brand name" 2026-11-14; 06-01b |
| E-6 | PWA_STRATEGY D1 (decisions table) and D-7 example | D1 "ClinicQ" working name, teal "Q" tile; D-7 "use "Patient · ClinicQ"" | D1 settled: "CliniQ AI", the brand mark on a white tile; D-7 example "Patient · CliniQ AI" (the root title template names the product once, 06-09a) | as E-5 |
| E-7 | V2_MASTER_ROADMAP PO-19 | "working name "ClinicQ", a teal tile with a "Q" glyph" | Name and icon superseded by the CliniQ AI brand (2026-11-14); the `auth.` email subdomain part of PO-19 is unchanged | as E-5 |
| E-8 | PWA_STRATEGY §3.9 budgets table, "Applies to" of First-load JS | "`next build` output" | Measured by `node scripts/ci/route-js.mjs` from the build's route manifests (Next 16 with Turbopack no longer prints First Load JS); framework root and per-route totals, gzip -9 | 06-07 |
| E-9 | DESIGN_SYSTEM §4.6 / PWA §3.1 (same note as E-4) | dark `themeColor` | Removed: light only | R-42; 06-05/06-01b |
| E-10 | FRONTEND_MIGRATION_PLAN M3 (redirect map v1 → v2 URLs) and the `ui_v2` / `ui_v2.<workflow>` flag (§ rollout, rollback) | per-tenant `ui_v2` flag and URL redirects | Superseded by R-8 and PO-15 (big-bang, no flags, no URL renames in V2-06; IA URLs arrive with each workflow phase) | R-8, PO-15 |
| E-11 | FRONTEND_MIGRATION_PLAN M2 2d/2e | MoneyInput (2d) and InvoiceLines (2e) in the V2-06 primitive set | Moved to V2-10 with `lib/money` | R-15 |
| E-12 | INFORMATION_ARCHITECTURE §3.3 (tree and redirect table) | "Plan & billing `/settings/plan`"; `/settings/billing` → `/settings/plan` | The subscription page stays `/settings/billing` ("Subscription & Billing") | R-34 |
| E-13 | INFORMATION_ARCHITECTURE §3.7 palette groups | "Assist: Ask Copilot: … (opens the AI panel)" | Removed (the copilot drawer was removed by AI-01 in V2-01); groups are Patients, Today queue, Actions, Navigate | AI-01; 06-04b |

## Threats

- **T-06-12 (public repository):** the committed set uses the e2e run's synthetic seed only (synthetic clinic,
  patient and user names and addresses), no cookie, header or storage state is written, record ids in the
  JSON paths are replaced by `<id>`, and the nightly artifact is the same folder.
- **R-30 bypass:** waivers are counted and time-boxed; inline directives on the three rules fail lint.
- No new route, action, env key, migration or dependency.

## Open items

- **06-P6 (PO):** approve `evidence/06-08/screens/README.md`. If 06-09b changes UI, re-run `npm run e2e:g3` under the
  lane lock and commit the regenerated set first; the approval records the SHA of the set.
- **Doc errata E-1…E-13:** PO decision (06-P7), then the orchestrator adds the dated erratum notes.
- **Phase close (orchestrator):** the gate evidence runs, reviews (one independent review of 06-08's diff plus the G3
  design reviewer on the set, R-37), 06-SUMMARY (deviations, the deferred rows above), 06-VERIFICATION.
