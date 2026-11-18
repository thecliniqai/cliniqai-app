# 06-09c record: Wave B review fixes

Plan: `06-09c-REVIEW-TRIAGE.md` (scope: H-AUTHOUT, M-REMOVED, M-VITALS, M-RXKEYS, M-PICKER, M-DATE, M-INFANTAGE and
the listed cheap Lows; the Accepted/assigned items are recorded, not fixed). Reviews:
`reviews/v206b-review-{independent,adversarial-session-palette}.md` (IND, B; reviewed commit `136cd04`). Branch
`v2/phase-06-design-system-pwa-shell`, private worktree, base `735e558`. Application only: no migration, no new
dependency. Every number below comes from a tool output in `evidence/06-09c/` (file named per row) or the command
named in the row.

## Commits

| Commit | Findings |
|---|---|
| `4e5a4fc` | H-AUTHOUT, M-REMOVED, IND L-1 |
| `33b2e76` | IND L-3, IND L-4 + B L-1 |
| `c52e00b` | IND L-2, IND L-5 |
| `d7c384d` | M-VITALS, M-RXKEYS, M-PICKER, M-DATE, M-INFANTAGE, IND L-6, IND L-7 |
| `bb16e06` | M-REMOVED on a client navigation (`withPageAuth`) and in server actions; two e2e harness corrections |
| `a27e8b1` | e2e harness: WebKit hydration before typing; the clinic name is out of view on phones (root causes below) |
| `c493d40` | e2e harness: `05-cache-audit` offline sign-out on WebKit waits for the page's own reconnect departure (root cause below) |
| `5050e07` | Report gate: REQUIRED_FILES + 3 specs (216), FLOOR 5909 |
| `38b614c` | G3 screenshot set regenerated |

## How "fails without" was measured

The new and changed specs were copied into a detached worktree at `735e558` (the code before 06-09c; the three gallery
section files were copied too, so the new specimens exist there with the old components) and run there: Vitest
against the shared local stack, and the e2e specs against an `npm run e2e:build` of `735e558` on 127.0.0.1:3100 under
the lane lock. `fails-without-vitest.txt`: 31 failed, 168 passed (the tracers and the unchanged cases pass).
`fails-without-e2e.txt`: 16 failed, 32 passed; every 06-09c e2e case fails except the H-AUTHOUT client case, which
passes on `735e558` too (the client already ignored a 503; the defect was the route answering 401, which the Vitest
proof shows).

## Findings → fix → test → fails without → reviewer reproduction

| ID | Fix | Test | Fails without the fix | Reviewer reproduction, before → after |
|---|---|---|---|---|
| **H-AUTHOUT** (IND H-1, B H-1) | `lib/auth/tenant.ts` `isDefinitiveAuthRejection()`: only `AuthSessionMissingError`, or a GoTrue 4xx other than 408/429, is "no session". Any other `auth.getUser()` error (`AuthRetryableFetchError`: network, timeout, 502/503/504; another 5xx; 429; 408; `AuthUnknownError`) throws the new `AuthUnavailableError` (log `auth.get_user.unavailable`, code only). The classifier reads auth-js's own fields (`__isAuthError`, `name`, `status`), because a value import from `@supabase/*` is not allowed there (P1-34). `/api/session-status` answers it **503** `{ error: "unavailable" }`. The `(dashboard)` layout throws it (error boundary, Retry) instead of `redirect("/login")`, `withPageAuth` passes it through, and `resolveServiceContext` answers its generic failure: never `reason: "unauthenticated"`, whose `UNAUTHENTICATED` code makes the client `hardSignOut("expired")`. Client (`lib/pwa/session-status.ts`): no answer is the reaction `failed`, with no page reaction; a retry follows on the back-off `RETRY_DELAYS_MS` (15 s, 30 s, 1 min, 2 min, then 5 min), reset by an answer, skipped while hidden, cancelled by `stop()` | `tests/auth/auth-outage-db.spec.ts` (16 tests). A real owner session whose `/auth/v1/user` fails on demand (`tests/helpers/blip-client.ts`): 503, 502 (HTML), 500, 429, 408, network error, timeout and an unreadable answer each give 503, no-store. GoTrue 401 and 403 give 401, and a session revoked for real (admin global sign-out) gives 401. The spec also checks the error types, server actions (never `unauthenticated`), the layout (throws `AuthUnavailableError`, no redirect digest) and a wrapped page (not sent to `/login`). `tests/pwa/session-status.spec.ts` (+4): 503, 429, network and 502 bring no reaction, and the retries come exactly at 15, 30, 60, 120, 300 and 300 s. A 200 then clears the retry, and a later 401 still signs out. A timed-out check is `failed`; `stop()` cancels the retry; a hidden page skips it. e2e `tests/e2e/pwa/09-outage-and-removal.spec.ts` `@golden` (desktop, Pixel 7, iPhone 15): a resume answered 503, 429, 504 or a network error leaves the URL, the typed Full Name, the visible page and the auth cookies, with no `auth.signout.done` on the server. Control: 401 lands on `/login` | `fails-without-vitest.txt`: all 8 retryable modes `expected 401 to be 503`; actions under a 503 `expected 'unauthenticated' not to be 'unauthenticated'`; the back-off cases (no retry was scheduled: `expected [] to have a length of 1`) | IND probe (`getUser` → `AuthRetryableFetchError("fetch failed", 0)`) and B probe (`BLIP mode=503 / network`): **before** `401 {"error":"unauthenticated"}` (the `network` and `503` rows of `fails-without-vitest.txt`); **after** `503 {"error":"unavailable"}` (same spec, `vitest-full`) |
| **M-REMOVED** (B M-1) | `getActiveMembership`: when an active-clinic cookie (UUID shape; any other value is ignored) names a clinic that is not one of the user's **active** memberships, it throws `ActiveClinicMembershipEndedError`, whatever the number of clinics left. It never falls back to the remaining clinic. The route answers 403 `no_membership`, so the client runs `hardSignOut("removed")`. On a full load the `(dashboard)` layout renders `MembershipEnded` (no clinic data; it runs `hardSignOut("removed")`). On a client navigation `withPageAuth` renders it as well, and server actions answer `no_membership`. Every sign-out now expires the cookie: the route through `response.cookies` (request cookies, not `cookies()`) and the client fallback through `expireAuthCookies`. The next sign-in therefore never resolves the ended clinic (no loop) | `tests/auth/active-clinic-removed-db.spec.ts` (8): a dual member with cookie = A, removed from (or suspended in) A with B left → 403; the layout returns `MembershipEnded`; a wrapped page returns `MembershipEnded`; an action answers `no_membership`; no cookie → B; a non-UUID cookie → B; sign-out expires the cookie. `signout-route.spec.ts` (+1, fetch and form, revoked or not). e2e `09-outage-and-removal.spec.ts` (real sessions): on resume the page lands on `/login`, sessionStorage and local keys are purged, no auth cookie or active-clinic cookie is left, and the server ended the session. Signing in again opens B. A full page load after the removal reaches `/login` and never shows B's name | Vitest: removed and suspended `expected 200 to be 403`; the layout rendered `ClinicTimeZoneProvider` (B's shell); sign-out left the cookie. e2e: the resume never reached `/login`, and neither did the full load (20 s) | B probe P1 (route): **before** `200 {"accessLevel":"full"}` (B's level); **after** 403. B probe H5 (built server, `/patients` lists B's patient with B's name in the shell): **before** the e2e full-load case times out on B's page; **after** `/login`, B's name never rendered |
| **M-VITALS** (IND M-1) | `summarizeVitals` ranks critical, then flagged, then normal, and shows every critical reading even above `max`. `VitalsSummary` draws a critical reading inline with OctagonAlert, the words "· critical" and a `danger-bg` tint, so it differs from "high" in icon, words and colour (danger-fg on danger-bg is an approved pair: `Alert` danger) | `tests/clinical/vitals.spec.ts` (+2: the reviewer's four-item case; more than three criticals). e2e `review-fixes-06-09c` (new gallery specimen "Critical behind three high"): order `SpO₂ 84% low · critical`, `BP 150/95 high`, `P 110 high`; one icon; tint differs from "high" (transparent); popover lists 4 | Vitest `expected [ [ 'BP 150/95', 'high' ], …]`; e2e the flagged items did not match | IND probe `summarizeVitals({150/95, 110, 100.8, 84})`: **before** shown = BP, P, °F (SpO₂ in the popover only); **after** shown = SpO₂ critical, BP, P |
| **M-RXKEYS** (IND M-2) | `RX_KEY_HELP` is built from `FREQUENCY_PRESETS` ("1 for 1-0-1 … 5 for SOS"), and each frequency tile shows its key (`keyHints`, only in RxEntryRow; the edit sheet's builder reads no keys). Rules: a lone digit followed by a unit is a duration ("3d" = 3 days; the frequency returns to what it was). Enter right after a lone frequency digit adds nothing and says what the digit picked. Enter, or "Add", with digits that have no unit adds nothing and asks for the unit. Any change made in the builder (a tile, the stepper, the instruction) clears unfinished typed digits. After dose keys, any other character is refused with a hint, and the line is kept (Escape still searches again). Backspace undoes a lone frequency digit. The five-key path Enter, 2, 5, d, Enter is unchanged | e2e `review-fixes-06-09c` (3): the help pairs equal the tiles' keys, and each key picks its tile. "5"+Enter adds nothing (alert); "5d" gives `1-0-1 · 5 days`; "25"+Enter asks for the unit. "2","1" then a tap on "7 days" saves 7 days; "3","1" then "+" saves 4 days; "2","x" is refused and the line kept. The existing `clinical-b` Rx cases pass unchanged | e2e: the help had no mapping; "5"+Enter added an SOS line (no alert); a tap after "1" left the stepper at `1…` | IND scenario 1 ("5"+Enter on Paracetamol): **before** `SOS · After food · 3 days` was added; **after** nothing is added (alert), and "5d" gives 1-0-1 · 5 days. Scenario 2 (type "2","1", tap "7 days"): **before** 1 day was saved; **after** 7 days |
| **M-PICKER** (IND M-3) | Results are kept with the query that produced them and rendered only while the field holds that query. Enter while not settled is prevented at the `Command` root (before cmdk's handler). The search is debounced by 200 ms. `try/catch/finally` means a rejected or throwing `search` ends loading and shows "Couldn't search patients. Try again." (`role="alert"`, outside the listbox). Reporting a failure is left to the caller (the palette reports its own) | e2e `review-fixes-06-09c` (2): type "9000000" (5 rows), then "3" and Enter at once: nothing; then 1 row (Patient 03) and Enter adds it. "zz-fail" (gallery's failing query) shows the alert and no progressbar; Enter does nothing; a new search clears it. The existing `clinical-b` picker case passes unchanged | e2e: Enter added **Synthetic Patient 01** (the old query's first row); the failed search showed no alert (endless loading row) | IND scenario ("98765" → two rows → "4" + Enter): **before** the first row of the old query was added; **after** nothing until the new answer, then the right patient |
| **M-DATE** (IND M-4) | `DateField`: an error reading on blur, Enter or a four-digit year clears the value (`onValueChange(null)`). So does an edit that makes the text stop showing the picked date, before blur. A form can no longer submit the old date behind the error | e2e `data-and-dates.spec.ts` (changed: its old line "keeps the old value until it is fixed" asserted the defect): an edit to 31/02/2026 gives the value `none`; a partial edit (a digit deleted) clears the value at once and is invalid on blur | e2e `Expected "none" Received "2026-02-01"` | IND scenario (12/11/1984 edited to 31/02/1985): **before** the value stayed 1984-11-12; **after** null (QuickRegisterForm's `age: !age.dob` blocks the submit) |
| **M-INFANTAGE** (IND M-5) | `dobFromAge`: 1 year is 12 months (the same day a year ago), and 0 years has no DOB. Years from 2 keep the server's 1 Jan convention, under which the display already reads back `n y`. `AgeOrDobInput`: "0" in years switches the unit to months, empties the box and asks "Below 1 year, enter the age in months". The hint is month-precise below 2 years | `tests/design/age.spec.ts` (+2): the reviewer's probe; a round trip on every day of 2024 (leap year) plus five more dates: years 1–130 and months 0–23 read back as entered (`12 m` for 1 year, `0 d` for 0 months), and `ageEntryFor` returns the same entry. e2e `review-fixes-06-09c`: "0" years switches to months and asks; 8 months gives 2026-03-12; 1 year gives 2025-11-12 ("Born about Nov 2025"); the DOB 12/11/2025 reads "12 m" | Vitest `expected '2026-01-01' to be null`; e2e the unit stayed `y` | IND probe on 15 Nov 2026: **before** `dobFromAge(0,"y")` = 2026-01-01 (shown "10 m"), `(1,"y")` = 2025-01-01 ("22 m"); **after** null (months asked) and 2025-11-15 ("12 m") |

### Lows

| ID | Fix | Test | Fails without |
|---|---|---|---|
| IND L-1 | The reaction `failed` for no answer; the More sheet shows `CHECK_FAILED_TEXT` for it | `session-status.spec.ts` (`checkSessionNow` → `failed`); e2e `toasts.spec.ts` (+2: network error, 503 → "Couldn't check for updates", never "latest", still on `/`) | Vitest `expected 'none' to be 'failed'`; e2e the toast was missing |
| IND L-2 | Record layouts: a malformed id is 404 before any lookup; a lookup error throws `RecordLookupError` (no database text); every other error is rethrown to the route error boundary | `tests/nav/record-layouts-db.spec.ts` (4): own records render; another clinic's, unknown and malformed ids are 404 (clinic isolation unchanged); 500 and network failures are errors (postgrest-js retries a network error for about 14 s before it gives up) | `expected { kind: 'notFound' } to deeply equal { kind: 'error', … }` |
| IND L-3 | Palette: Enter while the answer to what is typed is loading opens nothing | e2e `palette.spec.ts` (+1, search held at the route): Enter keeps `/` and the dialog; after the answer Enter acts | `Expected "/" Received "/patients/new"` |
| IND L-4 + B L-1 | `buildPatientSearchFilter` also removes `%`, `_`, `*`, `\`; the palette's minimum counts letters and digits only (server and client) | `palette-search-db.spec.ts` (+1: `%%`, `__`, `**`, `%_`, `_%_`, `\%`, `% %`, `*_` → []; `Me%na` and `M_ena` match nothing); `phone-search.spec.ts` (no wildcard in any pattern) | `%%: expected [ {…}, {…} ] to deeply equal []` |
| IND L-5 | Button: no `type` inside a form is a submit button: `requiresNetwork` defaults to true for it (form owner read in the ref callback), and the click handler also checks the real type and form at click time | e2e `review-fixes-06-09c` (gallery: a form whose Button has no type): offline it is `aria-disabled`, and a click or Enter in the field saves nothing; back online it saves | `Expected "true" Received ""` (no aria-disabled) |
| IND L-6 | QuickRegisterForm: the age check runs only when focus leaves the age group (its popover counts as inside); a failing `onSubmit` shows "Couldn't register the patient. Try again." and keeps the input | e2e `review-fixes-06-09c`: Tab from the toggle into the box and the unit shows no error; leaving shows it; the gallery's failing save ("Fail" in the name) shows the alert, the button is not busy, the name is kept | `Expected 0 Received 1` (error shown inside the group) |
| IND L-7 | AgeOrDobInput fills the age box from an outside value (on mount and when it changes), as DateField does | e2e `review-fixes-06-09c` (gallery "Editing a patient"): 1984-01-01 shows 42 years; "Load another patient" (8 months) shows 8 months | `Expected "42" Received ""` |

### Accepted / assigned (recorded, not fixed, per the triage)

| Item | Ruling | Owner |
|---|---|---|
| B L-2: no server rate limit on `/api/session-status` and the palette actions | Shared rate limiter. The client treats 429 as "no answer" (no sign-out, back-off); see the H-AUTHOUT row | V2-12 |
| IND I-1: admins no longer see Doctor's Cabin | R-9 (admins hold no clinical access) | ruling |
| IND I-2 / B I-3: the doctor's palette searches the whole clinic queue | No new exposure | V2-08 |
| IND I-3: DOB calendar pages month by month | Typing is the fast path | V2-08 |
| B I-1, I-4, I-5: deployment id, suspended = removed, `/SW.JS` header | Recorded | V2-14 |

## Deviations

1. **The active-clinic cookie is now cleared on sign-out** (route and client fallback). M-REMOVED needs it: without
   it, a removed dual member who signs in again would still carry clinic A's cookie, and every page would sign them
   out again (a loop). No app code sets the cookie today (the v2 clinic chooser is not built). The
   `ActiveClinicMembershipEndedError` rule also applies to a single-clinic user whose cookie names another clinic;
   before, B's "attacks that held" list said such a cookie was ignored. It now signs that device out, so a forged
   cookie can only end the forger's own session. A non-UUID cookie is still ignored.
2. **`MembershipEnded`** (`components/shell/membership-ended.tsx`) is a small new screen: a status line, rendered by
   the layout and `withPageAuth` while `hardSignOut("removed")` conceals and leaves. It shows no clinic data. It is not
   in the G3 set (it is visible only for the moment before the conceal).
3. **Gallery hooks for failure states:** the picker's search fails for "zz-fail", and the quick-registration save
   fails for a name containing "Fail". Both are named in the gallery notes. There is also an "Editing a patient" age
   specimen, a critical vitals specimen and an implicit-submit form.
4. **The picker does not report its own failures** (`reportClientError`). The caller owns the search and reports it,
   as the palette already does. Reporting from the component would add a second client-error key on every failed
   search.

## e2e harness root causes (PR-lane runs 1 and 2; `e2e-root-causes.txt`)

No test was retried (0 retries in every run). Every failure was root-caused from its trace and fixed in the spec, and
none of them was an app defect. Run 1 (`e2e-pr-run1-summary.txt`) failed 4 tests, all in 06-09c's new spec
`09-outage-and-removal`; the fix is `a27e8b1`:
- **iPhone 15, H-AUTHOUT:** Full Name read `""` with the first (503) answer. The trace shows one document load of
  `/patients/new`, its two server actions, then the 503, and no reload. The text had been typed into the server HTML
  before the form hydrated (WebKit fires `load` first; the same pattern is in 06-update's skew case). The spec now
  types once the page is idle, and checks that the text stays before any status answer. Result: 16/16 on three
  projects, then 28/28 with `--repeat-each=4` on Pixel 7 and iPhone 15.
- **Pixel 7 and iPhone 15, M-REMOVED:** the clinic name is in the sidebar, out of view on phones. The spec asserts
  that it is attached.

Run 2 (`e2e-pr-run2-summary.txt`) failed 1 test, on iPhone 15: 06-05/06-09a's `05-cache-audit` "Offline sign-out",
where `page.goto("/patients")` was "interrupted by another navigation to /login". The trace shows the sequence.
Offline, WebKit under a service worker cannot navigate, so the concealed page stays and its runtime keeps running.
Back online, the runtime's `online` status check answers 401, `hardSignOut` runs again (`POST /auth/signout` 200) and
the page replaces to `/login`, racing the spec's `goto`. Landing on `/login` is the designed outcome; the race was in
the spec. Its WebKit branch now waits for that departure (`c493d40`): 5/5 with `--repeat-each=5` on iPhone 15. The
race predates 06-09c: the `online` check and its 401 reaction are 06-06's. Run 1 and the 06-08 runs passed it by
timing.

## Results (tools)

| Check | Result | Evidence |
|---|---|---|
| Full Vitest (shared stack 000094) | 303 files, 6219 tests, 6219 passed, 0 failed, 0 skipped | `vitest-full-summary.txt` |
| Report gate | PASS: floor 5909 (6219 × 0.95 = 5908.05 → 5909), required 216 | `vitest-gate.txt` |
| e2e PR lane run 3, all projects (`npm run e2e:pr` at `5050e07`'s code, which is `bb16e06`'s app build) | desktop-chrome 386 passed / 5 skipped; iphone-15 36; pixel-7 141 / 191 skipped; pwa-ipados 7; setup 8; **0 failed, 0 retried**; the 8 expected failures are the known-bug cases | `e2e-pr-run3-summary.txt` |
| e2e runs 1 and 2 | 4 and 1 failures, each root-caused above, 0 retried | `e2e-pr-run{1,2}-summary.txt`, `e2e-root-causes.txt` |
| Fails without (735e558) | Vitest 31 failed / 168 passed; e2e 16 failed / 32 passed | `fails-without-{vitest,e2e}.txt` |
| typecheck, eslint, inventory, ui-policy, ai-l1, React Compiler waivers, contrast | exit 0; eslint 0 errors, 440 warnings (in app, components, lib, features, scripts and proxy.ts: 276, the same count as at `735e558`); inventory exit 0; ui-policy PASS (every delta 0); ai-l1 PASS; waivers PASS (11 entries, 20 sites); contrast spec 247 passed | `static-checks.txt` |
| G3 set (`npm run e2e:g3`) | 138 passed, 129 captures, index 0 problems; every JSON (axe in scope, horizontal scroll) and the README unchanged; gallery clinical-b, dates and forms changed size (the 06-09c specimens); the other PNGs differ only by run-specific text | `g3-regenerated.txt`, `evidence/06-08/screens/` |
| gitleaks (every 06-09c commit, `--redact`) | no leaks found (gitleaks counts 9 commits: the G3 commit `38b614c` has PNGs only) | `gitleaks.txt` |

UI at 360, 820/1180 and 1280 px: the G3 set's gallery captures (clinical-b, dates, forms) at the four widths, axe 0
serious/critical in scope and no horizontal scroll (unchanged JSON). `MembershipEnded` is not captured (deviation 2).

## Open items

- **PO (raised by IND M-5):** the server's age-only convention (`features/patients/schema.ts` `calculateDobFromAge`,
  1 Jan of the birth year) still turns an age of 0 or 1 entered through the v1 form or the API into a DOB months
  away from the truth. The new input never sends it (months below 1 year, 12 months for 1 year). Changing the server
  convention is a V2-08 registration decision.
- **V2-11 (clinic chooser):** set `clinic_active_tenant` only to an active membership; M-REMOVED treats any other
  value as removal (wave note).
- **Orchestrator:** a fresh re-verification of the session/auth items (security-sensitive per the triage) and the PO's
  re-approval of the regenerated G3 set (06-P6).
- **Lane note:** `before09c` (the detached worktree at `735e558` used for the fails-without runs) is removed after
  the evidence was written.
