# V2-08 executor notes

Evidence is not typed here (R-21); this file records what each plan changed, deviations and the commands run.

## 08-01a Command client, doctor picker, consult gate, report floor

Commits (branch `v2/phase-08-front-desk`, base 15237e9): f64b1a0 (lab key test fix), 71be43d (floor), 1966c83 (useCommand),
5cbbbfb (spec 7 payment leg), 9bcdc4c (doctor picker), fb8070d (consult gate).

### What changed

1. Vitest floor (R-3). Full run at the V2-07 merge tree: 6721 tests, 320 files, 0 skipped. `FLOOR = ceil(0.95 x 6721) = 6385`
   (was 5992), history line in `scripts/ci/assert-vitest-report.mjs`, default-floor strings in
   `tests/ci/vitest-report-gate.spec.ts`. V2-07 added 13 specs outside `tests/e2e` since the V2-06 head (d86b332); all were
   already in REQUIRED_FILES, so none added for V2-07. REQUIRED_FILES + `tests/commands/save-state.spec.ts` and
   `tests/staff/doctor-picker.spec.ts` (235). A second full run after the plan's changes: 6750 tests, 322 files, 0 failed,
   0 skipped; the gate passes (`vitest-report-gate: PASS`, floor 6385).
2. `useCommand` (F-9, PWA-06b, R-20). `lib/commands/use-command.ts`: `COMMAND_TIMEOUT_MS = 15_000`,
   `COMMAND_RETRY_DELAY_MS = 1_000`; one automatic retry with the same id for a thrown error, a timeout (reason `TIMEOUT`)
   or `DEPENDENCY_FAILED`; every other code is final. A late answer of a timed-out attempt is ignored (the attempt settles
   once). Offline at submit (`navigator.onLine === false`) sends nothing, spends no id, reports `DEPENDENCY_FAILED` with
   reason `OFFLINE`. Busy registration covers the pause and the retry. Hook adds `saveState`, `savedAt` (clinic `HH:mm`
   from `useClinicTimeZone`), `retry()` (runs the last call again, same id). New `lib/commands/save-state.ts`
   (`saveStateOf`, `isOfflineError`, `saveStatusProps`). The header comment records the Next action-queue limit.
   Runner deps gained optional `isOnline`, `schedule`, `sleep` (an injected clock for the unit tests). The five existing
   forms were not touched; none passes the new fields yet (their error banners stay as they are).
3. Spec 7 harness. `tests/e2e/support/commit-then-abort.ts` (`commitThenAbort(page, {first: n | "all", matches?})`:
   `route.fetch()` then `route.abort("connectionreset")` for Server Action POSTs) and
   `tests/e2e/pwa/13-idempotent-retry.spec.ts` payment leg (two tests, see below). Walk-in and booking legs: 08-03b, 08-04b.
4. Doctor picker (R-2). `getActiveClinicDoctors` (`features/visits/service.ts`) and `getTenantDoctorDirectory`
   (`features/staff/service.ts`): `doctor` and a practising `owner` only; the admin branch and the now unused
   `qualifications` / `medical_council_reg_no` columns are gone from the directory select.
5. Consult gate (P1-07). `app/(dashboard)/consultation/[id]/layout.tsx` checks `consultations:view` before it reads the
   visit; `page.tsx` repeats the check; a refused role is redirected to `navForRole(role).home`.

### Tests

- Vitest: `tests/commands/use-command.spec.ts` (extended: 16 new cases, the eight never-retried codes counted one each: constants, timeout then success with one id used twice,
  two transport failures unresolved and re-run reusing the id, two timeouts reason TIMEOUT, eight never-retried codes, late
  answer ignored, answer between timeout and retry ignored, offline sends nothing, busy for the whole span),
  `tests/commands/save-state.spec.ts` (new, 10), `tests/staff/doctor-picker.spec.ts` (new, 3), `tests/ci/vitest-report-gate.spec.ts`.
- E2E: `tests/e2e/pwa/13-idempotent-retry.spec.ts` ("lost once: the automatic retry succeeds with exactly one invoice and one
  payment"; "lost on every attempt: the form keeps its values and shows an error; a manual retry after the route is cleared
  gives one invoice and one payment"); `journey-08-role-restrictions.spec.ts` (receptionist and admin "direct URL to a
  consultation is not served (P1-07)", plain assertions); `clinical-split-screens.spec.ts` (receptionist URL not served).

### Deviations

- **Existing `use-command.spec.ts` cases changed.** The plan says the existing forms' specs pass unchanged (they do:
  checkout, sign-and-bill, amendment, `tests/commands/command-results.spec.ts`). Four cases of `use-command.spec.ts`
  itself asserted the old no-retry behaviour (a `DEPENDENCY_FAILED` or a thrown error was sent once); their expected call
  counts now include the automatic retry. `setup()` injects an instant retry pause and a never-firing timeout unless a test
  passes the manual clock.
- **`retry()` return.** Returns `Promise<Result<unknown>>`; with no call made yet it returns a failed `INTERNAL` result.
  `saveStatusProps` offers Retry only in the `error` state (the offline state has no link, per the component).
- **Floor measured once on a tree under edit.** The plan's full run was started on the clean tree, but I edited
  `use-command.ts` and its spec while it ran (a full run takes about 10 min), so that report held 5 failures: 4 in
  `use-command.spec.ts` (old expectations against the new runner) and 1 in `tests/labs/lab-storage-key.spec.ts`. Its count
  (6721, equal to the V2-07 evidence run) is the one the floor uses; a second full run at the final tree is green (6750).
- **Fix outside the plan's files: `tests/labs/lab-storage-key.spec.ts`** (Rule 1, blocked a green report). The test asserted the
  storage key does not match `/asha|testpatient|cbc/i`, but the key holds three random uuids and "cbc" occurs in hex by
  chance (about 2 percent of runs). It now removes the three ids from the key before the name check (commit f64b1a0).
  Root cause, not a retry.
- **Journey 8: the receptionist sign-refusal case moved to the nurse.** The receptionist no longer reaches the consultation
  page, so "signing from the direct URL is refused by the server" now runs as the nurse (holds `consultations:view`, not
  `consultations:edit`); the nurse's dialog button reads "Sign & Route to Reception" (no `billing:collect`), so the locator is
  `/Sign & (Collect|Route)/`. An admin "not served" case was added next to the receptionist's.
- **Journey 9 helper widened by one line.** A receptionist opening clinic B's consultation URL is now redirected to `/` before
  the visit is read; that landing document's body is unreadable to the capture like the probed document's, so
  `unreadableIsAcceptable` accepts the non-RSC `/` document (the final DOM and the server HTML of B's URL are still checked
  for B's markers). No clinic B data can be on that page.
- **`clinical-split-screens.spec.ts`**: the receptionist consult case now asserts the URL is not served (no axe pass on a page
  the user never sees), at 360, 820 and 1280.

### What the next plan must know

- Forms do not show `SaveStatus` yet: `useCommand` exposes `saveState`, `savedAt`, `retry`; render with
  `<SaveStatus {...saveStatusProps(command)} />`. New forms (08-02 onward) should.
- The spec 7 payment leg cuts the payment POST by matching its UTR in the request body (`matches`), and in the "every
  attempt" case cuts every Server Action (the payment, its retry and the reload that follows), so the drawer shows
  "Could not confirm whether the payment was saved". The same helper serves the walk-in and booking legs.
- The retry costs a visible 1 s pause (plus up to 15 s per attempt); e2e `toBeVisible` waits around a lost response need a
  20 to 30 s timeout.
- `getTenantDoctorDirectory({includeInactive: true})` (past-record name lookups) no longer returns an admin who was once
  recorded as a visit's doctor in old data; the name falls back as for any unknown member. The local suite had no case for it.
- Receptionist and admin are redirected from `/consultation/[id]` to their home (`/` today), so any later spec or link that
  sends them to a consult must be removed (08-03b removes the cabin links).

### Commands run (counts)

- `npx vitest run --reporter=json --outputFile=<scratchpad>/vitest.json` (V2-07 tree + edits): 6721 tests, 320 files, 6716
  passed, 5 failed (see Deviations), 0 skipped. `node scripts/ci/assert-vitest-report.mjs`: floor 6385 required 235.
- `npx vitest run tests/commands tests/labs/lab-storage-key.spec.ts tests/staff/doctor-picker.spec.ts
  tests/visits/clinic-visits-register.spec.ts tests/integration/auth/remove-member.spec.ts`: green after the fixes
  (`tests/commands` 66 = use-command 32, save-state 10, command-results 24; doctor-picker 3).
- `npx vitest run tests/ci/vitest-report-gate.spec.ts`: 9 passed.
- Final `npx vitest run --reporter=json ...`: 6750 passed of 6750, 322 files; gate PASS (floor 6385).
- `npm run typecheck`: clean. `npx eslint .`: 0 errors (435 warnings, none from this plan's files except existing-style `any`
  warnings in files it touched). `npm run inventory`: exit 0.
- `npm run e2e:build`: ok. `npx playwright test tests/e2e/pwa/13-idempotent-retry.spec.ts --project=desktop-chrome`: 2 passed.
  `npx playwright test tests/e2e/journeys tests/e2e/pwa/13-idempotent-retry.spec.ts tests/e2e/a11y/clinical-split-screens.spec.ts
  --project=desktop-chrome --project=pixel-7`: 44 passed, 4 failed on the first run (journey 8 nurse sign locator, journey 9
  receptionist redirect landing; both fixed as above); `npx playwright test tests/e2e/journeys --project=desktop-chrome
  --project=pixel-7` afterwards: 32 passed. `tests/e2e/subscriptions/locked.spec.ts tests/e2e/shell/nav-per-role.spec.ts
  tests/e2e/shell/loading-states.spec.ts --project=desktop-chrome` (other specs that open the consult URL): 45 passed.
  No test passed only on retry (retries are 0 outside CI; each failure above was root-caused).
