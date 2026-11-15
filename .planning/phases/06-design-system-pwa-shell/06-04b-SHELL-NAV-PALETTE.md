---
phase: 06
plan: 06-04b
subsystem: P1-28 M3 (shell, navigation model, command palette, toasts), PWA-03 shell part (Back, keyboard-aware bars, refresh on resume), PWA-08b spec 8, PWA-04 (More-sheet install entry)
status: complete (local)
plan_head_before: b2380b9
commits: [3d779c9, d610d9d, d2def21, a7b64c5, b9f8a36, 0e95669, docs commit]
code_head_after: 0e95669
requirements: [P1-28 M3, PWA-03 (shell), PWA-04 (More sheet), PWA-08b spec 8, IA §3.2 §3.5 §3.7, R-8, R-29, R-34, R-35]
---

# 06-04b record: app shell, `navForRole`, command palette, toasts, Back, keyboard-aware bars, refresh on resume

Plan: `06-PLAN.md` § 06-04b (Wave 10, after G2-D; the palette patient search and the server-side nav role resolution
are security-sensitive and get the adversarial review, R-37). Design contract: `06-UI-SPEC.md` §6 and CTO defaults
CD-02 (top bar 52 / sidebar 216 / rail 56 / bottom bar 60, from tokens), CD-03, CD-04, CD-12, CD-18…CD-23, CD-30,
CD-33, CD-35, CD-37. Visual reference: the approved shell at `3a78a5d` (`shared/proto.js` `shell()`,
`shared/sketch.css` `.topbar/.nav-side/.nav-rail/.bottombar`). Branch `v2/phase-06-design-system-pwa-shell`, worktree
`scratchpad/v206-worktree`, plan base `b2380b9` (everything so far + the 05b tip incl. 05-12 + 06-06). Every number
below is tool output: a file in `evidence/06-04b/` or the command named in the row. Builds and e2e ran under the shared
lane lock (`scratchpad/e2e-lane.lock` with an owner file, port 3100 checked, the stack's test-run lock waited for); the
local stack was not reset or stopped.

## What changed

| Area | Change | Files |
|---|---|---|
| Navigation model (step 1-2, T-06-16) | `navForRole(role, permissions = ROLE_PERMISSIONS[role])`: twelve v1 destinations with their **v1 URLs and v1 names** (R-8, CD-30; "My Calendar" for the doctor as in v1; `/settings/billing` "Subscription & Billing", R-34), each with its required permission and its IA §3.2 audience (Today = Dashboard + Live Queue for the front desk, Doctor's Cabin for the doctor and the practising owner; Schedule = Calendar, a nurse only views it; Reports = Billing & Reports for admin/owner; Records and Settings secondary, IA §3.3). A destination is offered only when the role is in its audience **and** holds its permission. Also: the BottomBar's four (by rank, home first, Patients always), the palette Actions (Register patient, Add walk-in, Book appointment, Invite staff; only with a v1 target among the role's destinations), `newActions: []` (CD-21), `home`, static `screenTitle`, `isRootPath`, `navParent`, `isFocusMode`, `LIVE_VIEWS`. Plain data; the **server layout** resolves it from the session's membership and passes it down | `lib/nav/nav-for-role.ts`, `app/(dashboard)/layout.tsx` |
| App shell (step 3) | `AppShell` replaces v1's `AppLayoutShell`: skip link "Skip to content" (first Tab stop) → `main#main[tabindex=-1]`; **Sidebar ≥ 1280** (216 px: BrandMark 36 decorative beside the clinic name and "CliniQ AI", primary, hairline, secondary, user block), **Rail 768–1279** (56 px, BrandMark 36, 44×44 items named by destination with a Tooltip to the right, scrolls, CD-22), **BottomBar < 768** (60 px + safe area, ≤ 4 destinations + More, label under icon, wraps to two lines rather than truncating), **TopBar** (52 px + `pt-safe`; Back on non-root screens below 1280 and always in focus mode; on the phone home a 28 px BrandMark; the screen title in Manrope 20/700; the palette field ≥ 768 with Kbd "⌘K"/"Ctrl K" ≥ 1024 on fine pointers, or the Search button < 768; the v1 NotificationBell; the account menu). Active item = `--nav-active-*` + 3 px `--nav-active-indicator` bar + `aria-current="page"`. One `nav "Primary"` visible per width (the others `display: none`). **Focus mode** (the consult): the Rail at every width ≥ 768, no BottomBar, Back always, and the top bar not sticky so the consult's own workspace header sticks (as v1 did). No "+ New" (CD-21) | `components/shell/{app-shell,top-bar,sidebar,rail,bottom-bar,back-button,nav-icon,shell-user}.tsx` |
| More sheet (PWA-04) | A bottom Drawer: every destination without a BottomBar cell, then "Install app" / "Open in Chrome" / "Open in Safari" (06-06's `installEntryLabel`/`runInstallAction`; hidden when installed or standalone), then "Check for updates" with "Version {deployment id}": asks the worker update and a session-status check now; another deployment → the update toast, otherwise "You're on the latest version" | `components/shell/more-sheet.tsx`, `components/shell/pwa-runtime.tsx` (`checkForUpdatesNow`), `lib/pwa/session-status.ts` (`checkSessionNow`, trigger `manual`) |
| Command palette (step 4, T-06-17, R-35) | ⌘K/Ctrl+K anywhere (a chord, CD-18; the v1 `/` shortcut is gone with the v1 header), the palette field, the phone Search button. 06-02b's `CommandDialog` skin (full screen < 768 with Close). Groups in order: **Patients** (`searchPatientsForPalette`), **Today queue** (`searchTodayQueueForPalette`: "Token 14 · name · Waiting", opens the role's queue view), **Actions**, **Navigate**; no Assist/AI group. Empty query: Actions + Navigate only; nothing stored (query and results in component state, cleared on close, CD-19); 200 ms debounce, late answers dropped; the first row of the newest answer stays active until the user moves the selection; result count announced politely; "No results for “…”" + "Try a mobile number, token or name" (CD-20); Escape returns focus to the opener; the input is `data-dirty-guard="ignore"` (06-06) | `components/shell/command-palette.tsx` |
| Palette server actions | `searchPatientsForPalette(query)`: `patients:view` via `resolveServiceContext`, tenant from the session, ≥ 2 characters, the same matching as `searchPatients` (name, mobile, ABHA), 8 rows, **exactly `id, name, ageSex {age, sex}, phoneLast4`** (age from the date of birth in the clinic's zone, else the stored age); deleted patients left out. `searchTodayQueueForPalette(query)`: `appointments:view`, today in the clinic's zone (reuses `getQueueForDate` server-side), token (`14`, `#14`, `T14`, `token 14`), name or mobile; cancelled visits left out; 5 rows of `visitId, token, name, status`. Both answer `{ ok: false }` when refused; guard-manifest entries | `features/patients/{actions,service}.ts`, `features/queue/{actions,service}.ts`, `tests/security/guard-manifest.ts` |
| Toasts (step 5, R-29) | 06-02b's `Toaster` mounted once by the shell (`ShellToaster`): above the BottomBar on phones, bottom-right ≥ 768, lifted over the offline banner while offline (CD-23). The **update toast moved onto sonner**: `notify.sticky("app-update", …)` with `role="status"`, "A new version is ready" / "This app was updated. Reload to continue.", "Reload" (06-06's texts, `data-update-toast` kept), no timer and no Dismiss | `components/shell/{toaster,update-toast}.tsx`, `components/ui/toast.tsx` (`sticky`, `data`, `raisedBy`) |
| Offline banner (CD-23) | `--banner-offline-*` (Midnight); above the BottomBar on phones while the shell shows one, at the viewport bottom otherwise; copy unchanged | `components/shell/offline-banner.tsx` |
| Back, keyboard-aware bars, resume (PWA-03) | Back: `router.back()` when this tab has an earlier in-app screen (an in-memory path stack), else the nav parent (`/patients/x` → Patients; consult → the role's home), so a fresh standalone launch or a deep link never leaves the app. Keyboard: a focused text field hides the BottomBar at once; `visualViewport` brings it back when the keyboard closes while focus stays (Safari ignores `interactive-widget`); leaving the field shows it after 350 ms (so a tap on a button below the field lands on the button; deviation 10b). Resume: `router.refresh()` on `visibilitychange` → visible and `online`, live views only (`/`, `/queue`, `/calendar`, `/cabin`), one refresh per 2 s | `lib/nav/back-stack.ts`, `lib/pwa/{keyboard-aware,resume}.ts` |
| Loading states (06-04a hand-over) | Skeletons for Today, Patients, a patient, the consult, the Live Queue, the cabin, the calendar and the billing reports **without turning their 404s and 307s into streamed 200s**: each segment's decision moved into its own layout above its `loading.tsx` (`(today)` doctor → /cabin; `cabin` receptionist/nurse → /queue; `billing/reports` no `billing:view` → /; `patients/[id]` and `consultation/[id]` another clinic's or an unknown record → `notFound()`, ids only, no audit row). Today and the patient list moved into route groups (`(today)`, `patients/(list)`) so their boundaries do not wrap `/patients/[id]` and `/patients/new`; URLs unchanged. `/billing/register` (a pure redirect) has none on purpose. The layouts are wrapped in `withPageAuth` (05-12's access check); `/patients/new/layout.tsx` is unchanged | `app/(dashboard)/**/{layout,loading}.tsx`, the two moved pages |
| Account menu | `components/layout/user-dropdown.tsx` → `components/shell/user-menu.tsx`: a 36 px (44 touch) avatar button "Account menu"; v1 items and names; sign-out through `hardSignOut()` and the submit-item behaviour of 06-02b unchanged. **No tooltip on menu triggers** (06-02b open item): Escape returns focus to the trigger, and a tooltip opening then only repeats its name | `components/shell/user-menu.tsx` |
| v1 shell removed | `app-layout-shell`, `app-sidebar` (with its 11 px "ClinicOS Console" contrast debt), `app-header`, `backdrop` (a `backdrop-blur`), `global-search-modal`, `sidebar-context`. Safe areas (IND L-3): top bar `pt-safe`, BottomBar safe-area height, Sidebar/Rail top inset, drawer footers (06-02b) | `components/layout/**` (deleted) |
| Brand and titles | BrandMark in the Sidebar and Rail (36), the phone home (28); titles in `font-display`. **"CliniQ AI" on the login surfaces** (the hand-over): "Sign in to CliniQ AI", the mobile brand row and the showcase panel use `BrandMark` + `PRODUCT_NAME` | `app/(auth)/login/page.tsx`, `components/auth/{auth-form-parts,clinic-showcase-panel}.tsx` |
| v1 overflow at 360 (spec 8) | CSS only: the patient header actions and the DPDP export pair wrap, the patient tabs strip scrolls, the consult workspace header wraps its actions (at 360 the v1 header pushed "Complete & Sign" off screen) | `components/patients/{patient-detail-view,dpdp-export-actions}.tsx`, `components/consultation/consultation-workspace.tsx` |
| NotificationBell | Re-homed unchanged in behaviour; shell target size (36, 44 touch), focus ring, 11 px badge (was 10 px) | `components/notifications/notification-bell.tsx` |
| Gallery | `/dev/ui` "App shell": Sidebar and Rail (owner), BottomBar (receptionist), palette field, Search, Back, title; landmarks named "… specimen" so the page has no second "Primary" | `app/dev/ui/sections/shell.tsx`, `app/dev/ui/page.tsx` |

## Commits

| Commit | What |
|---|---|
| `3d779c9` | `navForRole`, back stack, resume, keyboard-aware, manual status check; unit specs |
| `d610d9d` | App shell, palette + its two server actions (guard manifest, db spec), toasts, More sheet, offline banner, account menu re-home, v1 shell removed, gallery section |
| `d2def21` | Loading states with guard layouts; Today and the patient list into route groups (two Vitest imports follow the move) |
| `a7b64c5` | "CliniQ AI" on the login surfaces; v1 overflow at 360 px |
| `b9f8a36` | Shell e2e specs, spec 8, capture spec; locators adapted where the shell moved an element |
| `0e95669` | Fixes from the first full PR-lane run (root causes in deviation 10): BottomBar `z-30`; the bar comes back 350 ms after a field loses focus; constant bottom padding; four spec adaptations |
| (docs) | This record, evidence, wave notes |

## Acceptance (plan § 06-04b "Tests that fail without the change", "UI checks", "Acceptance mapping")

| Criterion | Result | Proof | Fails without |
|---|---|---|---|
| Tracer: `navForRole` + the Sidebar at 1280 for the owner, every item visited | Met | `tests/nav/nav-for-role.spec.ts`; `tests/e2e/shell/nav-per-role.spec.ts` owner | no `lib/nav` before 06-04b |
| `nav-for-role.spec`: per role every destination's permission is held; owner/admin see Settings, receptionist/nurse (and doctor) do not; the result equals the IA §3.2 table restricted to v1 URLs (written out in the spec); actions need a held permission and a reachable target; permission sets only remove | Met: 30/30 | `tests/nav/nav-for-role.spec.ts` | Vitest mutants: permission check removed; receptionist offered Billing & Reports (holds `billing:view`, IA hides it); doctor offered the front-desk Dashboard (`vitest-mutants.json`) |
| `nav-per-role.spec` (each seeded role): exactly `navForRole`'s destinations in the Sidebar; each opens with 200, stays on its URL (no /login, no redirect), no refusal text, `aria-current="page"` on it and on nothing else; the Rail (820) and BottomBar + More (360) offer the same set; every dashboard page is in some role's nav or listed with where it is reached from (6 listed) | Met (5 roles) | `tests/e2e/shell/nav-per-role.spec.ts` | — (new surface) |
| Landmarks and keyboard: one banner, one visible Primary nav, one `main#main`; the skip link is the first Tab stop, visible on focus, Enter moves focus to `main`; Tab order skip → nav → top bar (Back first on phones) | Met at 360/820/1280 | `nav-per-role.spec` "landmarks and skip link" | — |
| `palette.spec`: Ctrl/⌘K → the seeded patient's 10-digit mobile → the patient row (masked phone, never the full number) is active → Enter opens the record; **presses after typing ≤ 3** (UX counter: 1); the Server Action answers carry exactly `ageSex, id, name, phoneLast4` and no full number; a receptionist sees Register patient / Add walk-in / Book appointment and no settings action or destination; empty query = Actions + Navigate, no AI group; a queue token (`T14`) row opens the Live Queue; Escape returns focus; storage keys unchanged (only `clinicos.pref.*`); full screen with Close at 360; axe 0 serious/critical on the open palette at 1280 and 360 | Met; ×10 repeat 0 failures | `tests/e2e/shell/palette.spec.ts`; `tests/patients/palette-search-db.spec.ts` (5/5: four keys, last four only, DOB age, stored age, deleted left out, one-character refusal, queue token/name/phone, cancelled left out) | Vitest mutants: projection adds `phone`; deleted patients kept; cancelled visits kept. **Equivalent (missed) mutant:** dropping the explicit `tenant_id` filter changes nothing, because the user-JWT client's RLS already confines reads to the active clinic (a second membership makes RLS return nothing without an active-clinic choice); the filter stays as defence in depth |
| Guard legs for the two new actions (unauthenticated, lacking role, no membership, cross-tenant, positive control) | Met | `tests/security/guard-actions.spec.ts`, `guard-canary`, `guard-routes` (1400 tests in the targeted run) | the manifest completeness check fails without the entries |
| `08-layout.spec` (spec 8): no horizontal scroll at 360/375/744/800/820/1180 on Today, Patients, a patient, the consult and Settings; BottomBar visible < 768 (not in focus mode), absent ≥ 768; every interactive element of the top bar and the visible nav ≥ 44×44 | Met on pixel-7 (coarse pointer); desktop 1280 fine pointer: ≥ 24 px (WCAG 2.5.8), no BottomBar | `tests/e2e/pwa/08-layout.spec.ts` | before the v1 CSS fixes: a patient (scrollWidth 533 at 360) and the consult (402) failed (`e2e-shell-2` run, probe in deviation 6) |
| `back-resume-keyboard.spec`: Back on a patient opened from Patients at 360 and 820 returns to Patients; a deep link's Back goes to the nav parent; at 1280 Back hidden on a record and shown in the consult (Rail, no Sidebar); at 360 a focused text field hides the BottomBar and leaving brings it back; `visibilitychange` on Today → exactly one RSC refresh (a second within 2 s none), on Patients none | Met on desktop-chrome and pixel-7 | `tests/e2e/shell/back-resume-keyboard.spec.ts`, `tests/pwa/shell-runtime.spec.ts` (11/11) | Vitest mutants: no coalescing; refresh on every screen; bars never come back; Back always via browser history |
| `toasts.spec`: the update toast (mocked status) appears inside sonner's live region (`section[aria-live=polite]` "Notifications"), `role="status"`, "A new version is ready" + Reload, one status with that text, above the BottomBar at 360; "Check for updates" with no new version → "You're on the latest version" | Met (desktop-chrome, pixel-7) | `tests/e2e/shell/toasts.spec.ts`; 06-06's `06-update.spec`, `ui-checks-06-06` still green on the sonner toast | — |
| Loading states keep status codes | Met: B's patient/visit, an unknown id and a malformed id 404; doctor `/` 307 → /cabin, doctor `/billing/reports` 307 → /, receptionist `/cabin` 307 → /queue; skeleton visible during a held navigation to each of the eight pages | `tests/e2e/shell/loading-states.spec.ts`, `journeys/journey-09-clinic-isolation.spec.ts` | **e2e mutant** (the patient and Today guard layouts removed, own build): journey-09 ×3, the 404 and 307 cases and 06-04a's not-found case fail with 200 (`e2e-mutant-guard-layouts.txt`) |
| UI checks: the shell on Today, Patients, a patient, the consult, Settings for owner and receptionist at 360/820/1180/1280: right nav per width, title in Manrope, no horizontal scroll, axe 0 serious/critical on the shell | Met: 40 shell scans (owner and receptionist × 5 screens × 4 widths) + 2 palette scans, **0 serious/critical**; the right nav per width, the title in Manrope, no horizontal scroll in every case. Whole page (non-gating, v1 content in `<main>`): 24 serious/critical in 40 scans, all inside `<main>`: `select-name` on the consult's v1 specialty select (< 1280) and `label`/`select-name` on the v1 clinic settings form | `tests/e2e/shell/ui-checks.spec.ts`; `axe-summary.json` | — |
| Step 6: every v1 page renders in the new shell; M0 green; locators adapted only where an element moved | Met (list in "Adapted locators") | e2e PR lane below | — |
| P1-28 M3 (shell, IA nav model, palette, toasts; route states now on every dashboard page that can have one); PWA-03 shell; spec 8; M0 still passes | Met as above | | |

### Adapted locators (only where the shell moved an element)

- `tests/e2e/shell/support/slow-navigation.ts` `clickNavLink`, `tests/e2e/pwa/06-update.spec.ts` `navigate`: the v1
  "Open mobile navigation menu" drawer is gone; a destination without a BottomBar cell is opened from More.
- `tests/e2e/design/route-states-axe.spec.ts`: waited for the v1 drawer (`aside`) to slide out < 1024; now waits for
  the More sheet to close < 768.
- `tests/e2e/a11y/{turnstile,v2-01}-screens.spec.ts`: the login heading reads "Sign in to CliniQ AI" (the hand-over).
- `tests/e2e/pwa/06-update.spec.ts`: the navigation helper leaves the focused field before tapping the BottomBar (the
  bar steps aside while typing on phones), and the skew case clicks "Edit Details" until the streamed record has
  hydrated (deviation 10f).
- `tests/e2e/design/keyboard/forms.spec.ts`: "Search" scoped to `#forms` (the gallery's shell section adds a Search
  button; 06-03b's rule "scope gallery locators to their section").
- `tests/auth/page-revoked-session.spec.ts`, `tests/subscriptions/locked-redirects.spec.ts`: import paths of the two
  moved pages. No assertion changed anywhere.

## Before / after (DoD 3)

`design-captures/06-04b/{before,after}/design-{360,820,1180,1280}/{login,today,patients,consult,queue}.png` (git-ignored;
before = the plan base build `b2380b9`, after = the build of `b9f8a36`'s sources; `0e95669` changes no pixel of these viewport captures, only the bar's stacking and timing), contact sheets
`design-captures/06-04b/contact-sheet-{360,820,1180,1280}.png`; the UI-check screenshots (owner and receptionist ×
5 screens × 4 widths) in `design-captures/06-04b/ui-checks/`. Visible: the CliniQ AI mark and name on login; the
v1 hamburger drawer and "ClinicOS Console" sidebar replaced by the BottomBar / Rail / Sidebar per width; titles in
Manrope; the consult's actions reachable at 360.

## Suite results (local)

| Lane | Result | File |
|---|---|---|
| typecheck, `eslint .` (0 errors; 453 warnings, none from a 06-04b line), inventory (0 flagged), ui-policy (PASS; enforced rules 0; raw-palette 3530 → 3346, px-font 282 → 266, arbitrary-color 4 → 2), ai-l1 (PASS), contrast (242 pairs, 0 fail) | all exit 0 / PASS | `static-checks.txt` |
| Plan Vitest specs | nav-for-role 30/30, shell-runtime 11/11, palette-search-db 5/5; guard-actions 661 incl. the two new actions | `vitest-full-summary.txt` |
| Vitest mutants (one edit at a time, restored) | **10 of 11 caught**; the missed one is equivalent (the explicit tenant filter under RLS's active-clinic rule) | `vitest-mutants.json` |
| e2e mutant (two guard layouts removed, own build) | journey-09 ×3, the 404/307 status cases and 06-04a's not-found case fail with 200 | `e2e-mutant-guard-layouts.txt` |
| Full Vitest (tree `0e95669`) | 297 files, **6156/6158**; the 2 failures are `ci/hosted-dump-diff` (schema-coupled: the shared stack is at 000094, applied by another lane; the branch ends at 000093; recorded, not changed) | `vitest-full-summary.txt` |
| e2e PR lane run 1 (`--retries=0`) | 543 expected, **12 unexpected**, 0 flaky: root-caused and fixed (deviation 10) | `e2e-pr-run1-failures.txt` |
| e2e PR lane run 2, final (build of `0e95669`'s sources, `--retries=0`, the four `e2e:pr` projects) | **555 passed, 185 skipped, 0 unexpected, 0 flaky, 0 retried** (desktop-chrome 370, pixel-7 136, iphone-15 34, pwa-ipados 7, setup 8); M0 journeys green | `e2e-pr-run2-summary.txt` |
| Targeted repeats | palette ×10: 0 failures; 06-update ×3 on three projects: 59/59 | `e2e-targeted.txt` |
| UI checks + palette axe | 42 scans on the shell, 0 serious/critical | `axe-summary.json` |
| gitleaks (06-04b commits, `b2380b9..HEAD`) | run after the record commit; result in `gitleaks.txt` (separate commit) | `gitleaks.txt` |

The pixel-7 "skipped" are the viewport-owning specs (they run once on desktop-chrome), as before.

## Deviations

1. **Top-bar title is a `<p>`, not an `h1`.** Every v1 page keeps its own `h1` (step 6, "renders unchanged"); a second
   `h1` would break "one h1 per page". Screens rebuilt in V2-08+ without a content `h1` make the title the heading.
2. **Admin has no Doctor's Cabin in the nav** (v1 showed it). IA §3.2 gives the admin the front-desk board; the plan's
   test is "equals the IA table restricted to v1 URLs". The page still opens for an admin by URL (unchanged guard).
   Likewise a nurse's Calendar is secondary (IA ○) and Billing & Reports is offered to owner/admin only although a
   receptionist holds `billing:view` since PO-3 (IA: Reports "–" for the receptionist; Collections has no v1 page).
3. **A second palette action, `searchTodayQueueForPalette`, in `features/queue/{actions,service}.ts`** (outside the
   plan's file list): the plan's "Today queue matches" group needs data, and the patient projection must stay four
   patient fields. Guarded (`appointments:view`), four fields, guard-manifest entry, db spec (Rule 2).
4. **Spec 8's 44 px check runs on pixel-7 (coarse pointer) at all six widths.** 1180 is a tablet width; on a fine
   pointer the approved system keeps the dense 36/32 px controls (CD-04), so desktop-chrome at 1280 checks WCAG 2.5.8's
   24 px instead.
5. **Segment layouts and two route groups for the loading states** (the 06-04a hand-over's first option). Files beyond
   the plan's list: `app/(dashboard)/{(today),cabin,billing/reports,patients/[id],consultation/[id]}/layout.tsx`, the
   eight `loading.tsx`, and the moves of `page.tsx` → `(today)/page.tsx`, `patients/page.tsx` →
   `patients/(list)/page.tsx` (URLs, `client-routes.ts` and `dashboardRoutes()` unchanged).
6. **v1 CSS touched for spec 8** (`patient-detail-view`, `dpdp-export-actions`, `consultation-workspace`): wrap and
   scroll classes only. A probe (`overflow-probe.txt`) found the page-level overflow at 360 in exactly these three
   places; tables already scroll inside their cards.
7. **Focus mode keeps the top bar static** (not sticky), as v1's header was on the consult, because the consult's own
   workspace header is sticky at `top: 0`; two sticky bars would overlap.
8. **`components/ui/toast.tsx` gained `notify.sticky`, `data-*` passthrough and `Toaster raisedBy`** (06-02b's file)
   for the update toast and the offline banner (CD-23).
9. **Palette e2e reads the Server Action answers through `page.route` + `route.fetch()`.** Reading `response.text()`
   of the page's own responses failed 1 in 3 (`Network.getResponseBody: No data found`): Chrome does not always keep
   the body of a streamed RSC response for CDP. Root-caused with a probe (`palette-flake.txt`), fixed, then ×10 green.
10. **First full PR-lane run: 12 unexpected failures, all root-caused before the evidence run** (`e2e-pr-run1-failures.txt`):
    (a) the BottomBar (`z-40`, later in the DOM) covered the v1 drawers' footers (`z-40`): booking, cancel and the overbook
    flows timed out on pixel-7 with "nav … intercepts pointer events" → the bar is `z-30` like the top bar (v1's sticky
    header tier); (b) the bar reappeared on `focusout`, which fires on the `pointerdown` of a button below a field, so the
    bar slid under the pointer before `click` (register patient, change password: the submit never fired) → it now
    comes back after 350 ms unless a text field takes focus again, and `<main>` keeps its bottom padding so the page
    never changes height (a real-phone defect as much as a test one; unit-tested); (c) the gallery's page-wide "Search"
    label in `forms.spec` met the shell section's Search button → scoped to `#forms`; (d) `loading-states` polled for
    the prefetch of a patient link below the fold (Next prefetches in the viewport) → scrolled into view; (e) `06-update`
    tapped the bar while the field still had focus (the bar steps aside while typing) → the helper leaves the field
    first; (f) `06-update` skew on iphone-15 clicked "Edit Details" before the streamed record had hydrated (the record
    now renders behind its loading boundary; WebKit's `load` can precede that hydration) → clicks until the modal opens.
    (f) is a risk for people too only if a tap lands in the few ms before hydration; React replays discrete events on
    dehydrated boundaries, so the residual is a Playwright/WebKit timing. Re-runs: the affected specs on three projects
    126 passed / 0 unexpected (known-bug expected failures excluded), `06-update` ×3 on three projects 59/59.
11. **Two gallery tooltips and the Back/Search buttons have `tooltip={false}`** (menu/overlay triggers, see Account
    menu row); the Rail keeps its tooltips (they carry the name the icon-only item lacks visually).

## Threats

- **T-06-16 (nav shows what a role cannot use, or the client derives the role):** the model is computed in the server
  layout from the session's membership; destinations need the role's permission and its IA audience; unit table +
  per-role e2e (200, no redirect, no refusal text) + mutants. The pages' own guards are unchanged.
- **T-06-17 (palette over-fetch or persistence):** two server actions with permission + session tenant + fixed
  projections (four fields; last four digits only); the e2e asserts the answer keys and that the full number never
  reaches the browser; no query or result is stored (storage keys unchanged in the spec).
- **Status-code downgrade by loading boundaries (journey-09 class):** decisions in segment layouts; spec + mutant.
- New surface: two Server Actions (guard-manifest entries). No route, env or schema change. No new dependency.

## Open items

- **Reviews (R-37):** adversarial review of the palette search actions and the server-side nav resolution; one
  independent review of the rest; the G3 design reviewer (06-08's screenshot set uses this shell).
- **06-08:** add `tests/nav/nav-for-role.spec.ts`, `tests/pwa/shell-runtime.spec.ts`,
  `tests/patients/palette-search-db.spec.ts` to `REQUIRED_FILES`; refresh the ui-policy baseline (counts fell:
  raw-palette 3530 → 3346, px-font 282 → 266, arbitrary-color 4 → 2); the shell captures for owner/receptionist.
- **V2-08/V2-09:** "+ New" actions (`newActions`), the consult's own Back ("Back to Cabin" sits next to the shell's
  Back in focus mode until the consult is rebuilt), Today's two-pane layouts; per-visit deep links for the palette's
  queue rows (today they open the queue view).
- **Whole-page axe** (v1 content inside `<main>`, outside this plan's gate): `axe-summary.json` "whole_page".
- **PO:** none new.
