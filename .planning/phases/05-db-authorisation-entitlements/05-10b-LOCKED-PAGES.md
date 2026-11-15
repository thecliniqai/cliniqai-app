---
phase: 05
plan: 05-10b
part: 05b (wave 9)
subsystem: SUB-02 UX (dashboard layout redirect, functional /billing/locked, /billing/locked/staff, /onboarding/billing pages, locked-aware page loaders, e2e locked/onboarding fixtures)
status: complete (local)
migrations: []
plan_head_before: 5a1cc2b
commits: [bef19f4, docs commit]
code_head_after: bef19f4
requirements: [SUB-02 (layout redirects, functional locked pages), SUB §7.2 item 3 and item 5, PWA §9.1 spec 1 (non-redirect part; asset cases handed to V2-06), R-40]
acceptance: [SUB-02 "layout redirects, functional /billing/locked pages" (roadmap V2-05 scope); acceptance 11 kept (every lane green)]
---

# 05-10b record: layout redirects and functional locked pages

**Outcome:** done locally. A signed-in member of a clinic that is not `full` now sees only their clinic's locked or
onboarding page. The database stop of 05-10a is unchanged; this plan is the UX on top of it.
- **Owner/admin of a locked clinic** → `/billing/locked`: clinic, subscription status, when access ended (IST), "Your
  clinic's data is safe", "Renewal and export open with billing (V2-13b/V2-13c)", sign-out.
- **Any other role of a locked clinic** → `/billing/locked/staff`: "Your clinic's subscription is inactive; contact the
  owner", the clinic's name, sign-out. No subscription detail (staff cannot read it).
- **Any member of an onboarding (`incomplete`) clinic** → `/onboarding/billing` (interim page: the owner/admin reads
  that billing setup opens with AUTH-07/SUB-03 in V2-13b, staff "contact the owner"), sign-out.
- `none` (purged or an unreadable level) is treated as locked (fail closed).

No migration. Lanes: full Vitest 256 files / 5056 (gate PASS, floor re-measured to 4804), e2e PR lane
260 passed (8 of them the annotated known-bug failures), 9 skipped, 0 unexpected, 0 flaky, 0 retried; pgTAP
unchanged at 43 files / 7388; axe 0 serious/critical on the three pages at 360/820/1280 (desktop-chrome and pixel-7). Nothing hosted was
contacted.

## What shipped

| Area | Contents | Plan step |
|---|---|---|
| `lib/auth/access-redirect.ts` (new, pure, isomorphic) | The single rule `accessRedirect(role, level)`: `full` → `null`; `onboarding` → `/onboarding/billing`; `locked`/`none` → `/billing/locked` for owner/admin, `/billing/locked/staff` for others. Constants `LOCKED_OWNER_PATH`, `LOCKED_STAFF_PATH`, `ONBOARDING_BILLING_PATH`, `ACCESS_DESTINATIONS`. This is the function V2-06 06-06 planned to extract from the layout; it now exists, so 06-06 imports it | 1 |
| `app/(dashboard)/layout.tsx` | After the membership resolves: `accessRedirect(role, await getTenantAccessLevel(tenantId))` → `redirect(destination)`. The level comes from `my_tenant_access` (member-bound, works for a locked clinic, R-40); a lookup error throws (fail closed). The proxy is unchanged and still never queries the database (SUB §7.2 item 5) | 1, 2 |
| `lib/auth/page.ts` | `withPageAuth` also turns `TenantLockedError` (05-10a's guard refusal) into the member's destination (`redirectIfTenantLocked`, role read again; staff page if unreadable). Needed because Next renders the page segment concurrently with the layout and **only** the page on a client navigation (the layout does not run again), so a page loader would otherwise surface the lock as a server error (`request.error`) | 1 |
| Six page loaders with a catch-all | `calendar`, `cabin`, `queue` (previously `/login` for any error), `billing/reports` (`/`), `settings/developer` ("Access Denied" card), `patients/[id]` (logged `patients.detail_load.failed` + 404): each now calls `redirectIfTenantLocked(err)` first. Found by the new Vitest page-loader sweep (first run: three pages sent a locked member to `/login`) and the e2e server log | 1 |
| `lib/auth/access-page.ts` (new, server-only) | `requireAccessDestination(path)`: the loader of the three pages. No session → `/login`; no clinic → `/clinic/new`; the member's destination is another page → that page; a `full` clinic → `/`. Every destination maps to itself for its own members, so the rule cannot loop | 1 |
| `app/billing/locked/page.tsx`, `app/billing/locked/staff/page.tsx`, `app/(onboarding)/onboarding/billing/page.tsx` (new) | Outside the `(dashboard)` group (no shell, no redirect loop), `force-dynamic`, existing primitives only (`Button`), shared frame `components/subscription/access-page-shell.tsx` (`<main>`, `<h1>`, facts `<dl>`, sign-out = plain form POST to `/auth/signout`, scope `local`). Reads only what a locked member may read: `tenants` (member helper) and, for owner/admin, `getSubscriptionOverview()` (`access: "billing"`) | 1 |
| `messages/en.ts` | `subscription.{status,locked,locked_staff,onboarding,sign_out}`: fixed texts, no AI wording | 1 |
| `lib/auth/public-paths.ts`, `tests/auth/public-paths.spec.ts` | **Unchanged** (plan requirement): the three pages are protected by the 03-12b default deny; the existing enumeration spec now covers them (+1 case: the onboarding page is in a protected directory) | — |
| `tests/helpers/tenants.ts` | `seedAccessFixtureClinic(level, name, roles)` (admin API only; checks the level with `tenant_access_for_system` and fails at seed time if it drifted) and `signInSeededUser(email)` | fixtures |
| e2e fixtures (`tests/e2e/global-setup.ts`, `support/run-data.ts`, `auth.setup.ts`) | The run seeds a locked clinic (expired; owner + receptionist) and an onboarding clinic (owner), no patient data. `RunData.access`, `ACCESS_USERS`, `ACCESS_LANDING`, `accessStatePath()`, `accessRunUser()`; the setup project signs the three users in through the login UI and asserts the landing page (first redirect proof), saving their storage states for every device project and for V2-06 06-05 spec 1. Their clinic names and emails join `tenantDataMarkers` | fixtures |

## Tests that fail without the change

| File / spec | Cases | Without (evidence) | With |
|---|---|---|---|
| `tests/subscriptions/locked-redirects.spec.ts` (new, local stack, real sessions and real levels) | 47: the role × level table (20 + 1); the layout for locked owner/admin/doctor/nurse/receptionist, onboarding owner/receptionist and a full owner (8); every wrapped dashboard page loader for a locked owner, receptionist and doctor (3 sweeps, 15 pages each); the destination pages for their own and for wrong members, incl. full → `/` (14); page content (1) | mutants (`evidence/05b/05-10b/vitest-mutants-summary.txt`): layout without the redirect → 7 fail; `withPageAuth` without the lock redirect → 3 fail; the six page catches without it → 3 fail; destination pages without canonicalisation → 8 fail; `none` treated as `full` → 5 fail | 47/47 |
| `tests/e2e/subscriptions/locked.spec.ts` (new; @golden legs on desktop-chrome, pixel-7, iphone-15; axe on the first two) | per device: locked owner `/`, `/patients`, `/patients/<id>`, `/settings/billing`, `/billing/reports`, `/queue` → `/billing/locked`; locked receptionist `/`, `/queue`, `/calendar`, `/consultation/<id>`, `/staff` → `/billing/locked/staff`; onboarding owner `/`, `/patients`, `/calendar`, `/settings/clinic` → `/onboarding/billing`; **no `request.error` line** for any of those requests; `/api/health` 200, the user's own page 200 with `maxRedirects: 0` (no loop), the PWA asset paths never 3xx; signed out the three pages 307 → `/login?next=<path>`; a locked receptionist signs out from the page → `/login`, and `/queue` asks for sign-in again; axe 0 serious/critical at 360/820/1280, no horizontal scroll at 360, screenshots attached | layout mutant build (`evidence/05b/05-10b/e2e-mutant-layout-no-redirect.txt`): the three access users' setup sign-ins land on `/` instead of their page (3 failed, the 11 dependent tests did not run) | 29/29 (11 desktop-chrome, 11 pixel-7, 7 iphone-15) |
| `tests/e2e/auth.setup.ts` | +3 (access users land on their page) | same mutant: 3 fail | pass |

## Decisions and deviations

1. **The rule is a module, not layout code** (`lib/auth/access-redirect.ts`). Next forbids extra exports from a layout,
   and V2-06 06-06 needs the same rule for `/api/session-status`. 06-PLAN names the file as 06-06's extraction; it now
   exists with that name and contract, so 06-06 only imports it (recorded in the wave notes for V2-06).
2. **Locked-aware page loaders** (not in the plan's file list): the layout alone does not cover a client navigation
   (Next re-renders only the page segment), and Next renders the page concurrently with the layout on a full load, so
   a guard-backed loader would throw `TenantLockedError` as a server error or send the member to `/login`. `withPageAuth`
   and the six catch-all loaders now redirect to the member's page. Pages whose loaders read through RLS only
   (`/`, `/patients`, `/visits`, `/staff`, `/profile`, `/settings/billing`) render empty on a client navigation (the
   database returns nothing, 05-10a); the installed-PWA reaction for every screen is V2-06 06-06's poll.
3. **Onboarding applies to every role**, as the plan states; the page's text differs for owner/admin and staff.
4. **`none` is treated as `locked`** (fail closed): a purged clinic's member reaches the locked page, whose owner view
   omits the subscription facts it cannot read.
5. **The three pages are not under `(dashboard)`** and there is no `app/billing/layout.tsx`: `/billing/locked` and
   `/billing/reports` live in different route trees (verified by `next build`'s route list).
6. **e2e fixtures beyond `tests/helpers/tenants.ts`:** the plan names only the helper; the run's global setup,
   run data and setup project also changed so the locked/onboarding sessions exist once per run (one UI sign-in each;
   the local auth rate limit is 30 sign-ins per 5 minutes). V2-06 06-05 spec 1 reuses those storage states.
7. **The page copy names V2 phases** ("Renewal and export open with billing (V2-13b/V2-13c)", "AUTH-07/SUB-03 in
   V2-13b") because the plan specifies that text; V2-13b (SUB-08) replaces both pages.
8. **Product effect to note for the PO:** a clinic created through `/clinic/new` (`create_clinic_with_owner`, status
   `incomplete`) now lands on `/onboarding/billing` instead of an empty dashboard, until V2-13b's trial checkout.

## Local evidence (tool output, `evidence/05b/05-10b/`)

| Check | Result | File |
|---|---|---|
| Full Vitest (05-10b tree) | **256 files, 5056/5056**, 0 failed, 0 skipped; gate PASS (floor 4804, 162 required) | `vitest-summary.json`, `vitest-report-gate.txt` |
| e2e PR lane, fresh `e2e:build` | **260 passed** (incl. the 8 annotated known-bug failures), 9 skipped, **0 unexpected, 0 flaky, 0 retried** (228 at 05-10a + 29 locked-spec tests + 3 setup legs) | `playwright-summary.json`, `e2e-pr-tail.txt` |
| Vitest mutants (5) | each fails named cases | `vitest-mutants-summary.txt`, `vitest-mutant-*.txt`, `vitest-mutants.py` |
| e2e mutant (layout without the redirect) | 3 setup legs fail | `e2e-mutant-layout-no-redirect.txt` |
| pgTAP lane (no schema change) | 43 files, **7388/7388**; gate PASS | `pgtap-report-gate.txt` |
| typecheck, `eslint --quiet`, inventory, ai-l1, `authz:gen --check`, `schema-snapshot --check` | exit 0 / PASS | `static-checks.txt` |

**Shared stack:** no `db reset` for 05-10b (no migration). Runs took the test-run lock; e2e builds and runs took the
e2e lane lock (`scratchpad/e2e-lane.lock`, owner file) after port 3100 was free.

## Threats

- **T-05-31 / T-05-33:** the redirect is UX only; the control stays the database stop (05-10a). A locked owner keeps
  the session and reaches the page that reads the subscription (billing helper), never a clinical page.
- New surface: three authenticated pages that read `tenants` (member helper) and, for owner/admin, the clinic's own
  subscription row. No input is taken; the destination is computed from the session only. Sign-out reuses the 03-12b
  route (same-origin POST).

## Open items

- **V2-06 06-05:** PWA asset paths (`/manifest.webmanifest`, `/sw.js`, `/offline`, icons) do not exist yet; for a locked
  user they answer 404 today, never a redirect. 06-05 makes them 200 (spec 1, using the `locked-owner` /
  `locked-receptionist` storage states) and should tighten `locked.spec.ts`'s "not 3xx" assertion to 200.
- **V2-06 06-05/06-06:** `hardSignOut()` should replace the plain sign-out form of `AccessPageShell`; 06-06's
  `/api/session-status` returns `accessRedirect(...)`; client `SUBSCRIPTION_LOCKED` hard navigation.
- **V2-13b (SUB-08):** styled locked pages with renewal and export; the onboarding billing profile and trial checkout.

## Addendum (after 05-10c's first full Vitest run)

`tests/ci/vitest-report-gate.spec.ts` pinned the old default floor (4633) in its expected message; 05-10b's floor
change was measured before that spec could see it, and 05-10c's first full run reported 1 failure (5062/5063,
`evidence/05b/05-10c/vitest-first-run-gate-spec-failure.json`). Fixed in `a7a0dae`; 05-10c then raised the floor to
4810 and the final full run is 5063/5063.

gitleaks (`v8.30.1`, repo config) over `5a1cc2b..cf819cb` (5 commits, 05-10b and 05-10c): **no leaks found**.
