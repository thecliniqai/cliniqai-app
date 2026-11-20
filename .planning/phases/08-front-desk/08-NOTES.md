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

## 08-01b Visit state machine and start_consultation

Commits (branch `v2/phase-08-front-desk`, base ac4128d): 0bb57bc (migration 000100 + registries), dc81016 (app), a8dbb61 (specs);
the notes commit follows them.

### What changed

1. Migration `000100_visit_state_machine.sql`. (a) `private.visit_transition_allowed(from, to, signed)` IMMUTABLE = the R-7 table;
   trigger `visits_status_transition_guard` BEFORE UPDATE OF status ON `visits`, `WHEN (OLD.status IS DISTINCT FROM NEW.status)`,
   refuses every other change with `VISIT_TRANSITION_INVALID` (P0001) for every writer (service role included; no bypass flag).
   The trigger function is SECURITY DEFINER (see Deviations). (b) `private.step_check_in` replaced: R-8 `VISIT_NOT_TODAY`
   (clinic-local date through `public.tenant_local_date`, the `issue_queue_token` source) for a booked, confirmed or no-show visit
   that has an appointment time; a visit without one (walk-in) or already waiting or in consultation is not asked; a `no_show`
   visit is checked in (`no_show -> waiting`) and its `queue.check_in` audit row carries `late_arrival: true`. (c)
   `public.start_consultation(tenant, visit, request)`: definer, `consultations:edit` + `appointments:edit`, runs `step_check_in`
   for booked, confirmed, no_show and waiting (a waiting visit reuses its token, no second check-in audit row), then
   `waiting -> in_consultation`, `queue_tokens.called_at`, audit `visit.consultation_start`; an `in_consultation` visit answers
   `already_started` with no audit row. Result `visit_id, token_number, already_started, replayed`. (d)
   `public.complete_visit(tenant, visit, request)`: `appointments:edit`; unsigned waiting or in_consultation -> completed, token
   `completed_at`, audit `visit.complete_at_desk`; an already completed visit answers `already_completed` (stamps a missing
   `completed_at`, no audit row); booked, confirmed, no_show, cancelled and a reopened signed visit are
   `VISIT_NOT_COMPLETABLE`. (e) `private.log_command_audit` admits the two new command-only actions, `private.audit_metadata_keys`
   gains `late_arrival`.
2. Registries: `RPC_REASON_CODES` (`VISIT_TRANSITION_INVALID`, `VISIT_NOT_TODAY`, `VISIT_NOT_COMPLETABLE`, all CONFLICT),
   `COMMAND_ONLY_AUDIT_ACTIONS` and `AUDIT_METADATA_KEYS` (`lib/audit/audit.ts`), guard manifest
   (`startConsultation: consultations:edit`, `completeVisit: appointments:edit`; `transitionQueueState` removed) and the
   guard world (`startableVisit`, `completableVisit`), pgTAP definer registry (classification, grantees, access `refuses`, 4
   legs, plan 89 -> 93), `types/database.ts`, schema snapshot, `assert-pgtap-report.mjs` (FLOOR 8083 -> 8101, REQUIRED_FILES +
   `visit_state_machine.test.sql`), `assert-vitest-report.mjs` REQUIRED_FILES + 3 specs (238).
3. App. `features/visits/state-machine.ts`: `VISIT_STATUSES`, `VISIT_TRANSITIONS`, `canTransition(from, to, signed)`,
   `rowActions(permissions, visit, now, timeZone)` (check_in, start, record_vitals, collect, reschedule, no_show, cancel).
   `features/queue/service.ts`: `startConsultation` and `completeVisit` over `callCommand` with fixed messages;
   `transitionQueueState` (service, action, `QUEUE_OPEN_STATUSES`, `QueueTokenUpdate`) deleted. Actions `startConsultation`
   (`consultations:edit`) and `completeVisit` (`appointments:edit`). Callers rewired with `useCommand`:
   `components/queue/status-actions.tsx` (Start Consultation and Done), `components/cabin/my-queue-card.tsx` (a waiting visit
   starts through the command and the page does not open on a refusal; an in-consultation visit just opens),
   `components/queue/checkout-drawer.tsx` (the two completion calls, own `useCommand`).
4. Writers in tests that updated `visits.status` to a state the machine refuses now insert the target state
   (`seedVisit(t, doctorId, { status, scheduledAt, overbooked })`, `seedPatient(..., status)`, `seedClinicalVisit`), go through the
   allowed steps, or call the command: `tests/queue/check-in-rpc`, `tests/security/{review2-fixes-db, share-tokens,
   multi-clinic-tenant-filters, webhook-lockdown}`, `tests/jobs/enqueue-webhook-rpc-db`, `tests/messaging/inbound-retry-db`,
   `tests/integration/{cabin-consultation-launch, consultation-flow, prescription-versioning, queue-flow}`,
   `tests/consultation/sign-consultation-rpc` (through the helper), `supabase/tests/database/scheduling_exclusion`.

### Tests

- pgTAP: new `visit_state_machine.test.sql` (14: trigger present and shaped, 7 x 7 x signed function table, 7 x 7 x signed
  trigger outcomes on real rows, unchanged-status writes, P0001 reason, a receptionist cannot revive a cancelled visit, a plain
  UPDATE still cannot reopen a signed visit without the amendment snapshot, grants and settings); `definer_functions` +4;
  `scheduling_exclusion` case 22 now rebooks a no-show into the taken slot (23P01), because nothing leaves `cancelled`.
  Total 8101 in 50 files.
- Vitest DB: `tests/queue/start-consultation-rpc.spec.ts` (23), `tests/queue/complete-visit-rpc.spec.ts` (21), both with
  catalog, happy path with audit and claim rows, fault injection on the second write (nothing persists, the same id then
  succeeds), replay, `IDEMPOTENCY_MISMATCH`, role matrix, anon, cross-tenant, dual-membership, one concurrency case, service
  texts; `tests/queue/check-in-rpc.spec.ts` (28: VISIT_NOT_TODAY for tomorrow and yesterday, today ok, late arrival with
  `late_arrival`, completed and cancelled still NOT_CHECKABLE); `tests/visits/state-machine.spec.ts` (8: parity of `canTransition`
  with the database function for all 98 combinations, `rowActions`). `tests/helpers/fault.ts` gained an optional second
  condition (`and`) so a fault can hit the move to `in_consultation` or `completed` only.
- E2E: `npx playwright test tests/e2e/m0 --project=desktop-chrome`: 18 passed (the P1-03 known-bug case is the expected failure).

### Deviations

- **Trigger function is SECURITY DEFINER.** The plan does not say; an invoker trigger function called the private
  `visit_transition_allowed`, which `authenticated` cannot execute (first pgTAP run: `permission denied for function`). The
  definer function has `search_path = ''` and is registered as `internal` with no API grant.
- **`complete_visit` on an already completed visit** is an idempotent success (`already_completed`) instead of a refusal: the
  checkout after a sign-off (checkout drawer, step 3) and the "Mark Visit Completed" button call it on a visit `sign_consultation`
  already completed, and the old `transitionQueueState` treated that as a no-op that stamped the token. Only unsigned waiting and
  in_consultation visits change state.
- **A visit state seeded by a test is inserted, not updated** (plan step 3 said so for writers; for the shared-fixture specs it
  needed two more shapes): `webhook-lockdown.spec.ts` `resetVisit` now gives the side a NEW booked visit and re-points its sent
  message (a visit never goes back to `booked`); `enqueue-webhook-rpc-db.spec.ts` uses a second booked visit for the cancel and
  reschedule events (a completed visit is never cancelled); `multi-clinic-tenant-filters.spec.ts` checks in a walk-in as the
  success control (its booking is days ahead, which a check-in now refuses).
- **Guard world** gained two queued walk-ins (`startableVisit`, `completableVisit`) and `checkInVisit` uses `waitingVisit`, since
  the booked `visit` is not for today (R-8).
- **`audit_metadata_keys` gained `late_arrival`** (the plan says "audit metadata `late_arrival`"); the TS list and the parity spec
  follow.
- **SaveStatus is not rendered** in the three rewired callers: they are queue rows and a checkout drawer, not forms; their
  inline error text stays. 08-03b's rewrite of the queue rows should render `saveStatusProps` where a form remains.
- `rowActions` offers one `start` action ("start or call in" in the plan): there is no separate call-in command, and a nurse's
  call-in needs none yet (no status change). 08-03b decides the label per mode.

### What the next plan must know

- `updateVisitStatus` (`features/visits/service.ts` and its action) is still there and is now bounded by the trigger. Its callers:
  none in `app/` or `components/`; tests: `tests/security/multi-clinic-tenant-filters.spec.ts`, the guard manifest and valid-inputs.
  `transitionQueueState` has no callers left (deleted). 08-04a deletes `updateVisitStatus`.
- `components/calendar/doctor-timeline.tsx` still links "Start Consultation" to `/consultation/<id>` for a booked visit (a plain
  link, no command), so that path still ends at a visit the sign-off refuses. 08-03b/08-04b replace it with `startConsultation`.
- A booking can only be checked in or started on its own clinic-local day (R-8, `VISIT_NOT_TODAY`); seeded test visits that need a
  check-in must be walk-ins or scheduled today (`seedVisit(..., { scheduledAt, overbooked: true })`).
- `useCommand` callers for the new actions: `startConsultation(visitId, clientRequestId)` and `completeVisit(visitId,
  clientRequestId)` in `features/queue/actions.ts`; values `{ visitId, tokenNumber|null, alreadyStarted, replayed }` and
  `{ visitId, alreadyCompleted, replayed }`.
- `queue.transition` is still in `AUDIT_ACTIONS` (nothing writes it any more); it can go with a later registry cleanup.

### Commands run (counts)

- `npx supabase db reset --local`, `npm run db:types`; `npm run test:pgtap` (3 runs while fixing; final 8101 tests, 50 files, PASS);
  `node scripts/ci/assert-pgtap-report.mjs pgtap-report.tap`: PASS (floor 8101, 50 required).
- Vitest, affected files only (no full run): the 59 files that update visit status plus the four integration specs, guard specs,
  `tests/ci`, `tests/commands`, `tests/staff`: 2584 tests, 6 failures (guard positive controls for the three queue actions, fixed
  by the world change) then `tests/queue` + guard files 917 passed; `tests/queue tests/visits/state-machine.spec.ts` + the
  changed security, jobs, messaging, integration, audit and consultation specs: 346 passed.
- `npm run typecheck`: clean. `npx eslint .`: 0 errors (436 warnings; +1 is the `any` cast pattern in
  `webhook-lockdown.spec.ts`'s `resetVisit`, same style as the file's existing helpers). `npm run inventory`: exit 0, 0 flagged.
  `npm run ci:ui-policy` PASS (delta 0), `npm run ci:ai-l1` PASS.
- `node scripts/ci/local-drift.mjs`: PASS (0 statements). `node scripts/drift/schema-snapshot.mjs --local --write` then `--check`:
  PASS (2751 lines). `npm run db:types` produces no further diff.
- `npm run e2e:build`; `npx playwright test tests/e2e/m0 --project=desktop-chrome`: 18 passed.

## 08-02 Patient search, PatientPicker, QuickRegister, registration command

Commits (branch `v2/phase-08-front-desk`, base 7f1f4db): 8be80ed (migration 000101 + pgTAP + registries), 16b93ee (fix: EXPECTED_MIGRATION),
c0413ac (fix: ui-checks receptionist list), a7e6db8 (app), d502e0d (specs); the notes commit follows them.

### What changed

1. Migration `000101_patient_search_register.sql`. Trigram GIN indexes on `patients(full_name, phone, abha_id)` (pg_trgm schema resolved
   in a DO block, as 000021 does). `public.search_patients(query, limit)` STABLE INVOKER: minimal columns, two letters or three digits,
   `% _ * \ , ( )` become spaces (no wildcard oracle), rank 1 exact mobile / 2 digits contained / 3 name prefix / 4 trigram similarity
   (>= 0.4) / 5 substring or ABHA, then last visit (waiting, in consultation or completed), name; limit capped at 25. `public.find_patient_duplicates`
   STABLE INVOKER (same mobile; same name with the same dob or an age within 2), up to 10, reasons `same_mobile | same_name_dob | same_name_age`.
   `private.patient_input_normalize` and `private.step_create_patient` carry `ai_processing_objected` (stamp and audit come from the existing
   triggers). `public.register_patient(tenant, patient, request)` definer command, `patients:edit`, result `patient_id, replayed`.
   No `(tenant_id, patient_id, scheduled_at)` index: `idx_visits_tenant_patient` already serves the last-visit lookup.
2. App. `GET /api/patients/search` (`app/api/patients/search/route.ts`): 401, 403, 403 `SUBSCRIPTION_LOCKED`, 503, 500, `private, no-store`,
   `{ patients: [{ id, name, ageSex, phoneLast4, lastVisit }] }`. `features/patients/search.ts` (client-safe types and `fetchPatientHits`),
   service `searchPatients` (RPC) and `findDuplicates`, `register.ts` (`registerPatient` over `callCommand`), `register-input.ts` (form values to input),
   action `registerPatient`. `components/clinical/ai-objection-field.tsx` (interim notice, on the AI-02 label list), `QuickRegisterForm` (async
   `findDuplicates`, candidates with age and sex, objection field, `saveStatus`, `onEdit`, `defaultValues`), `components/front-desk/{patient-search,
   register-patient-sheet,front-desk-sheets,use-duplicate-lookup,legacy-patient-row}`; `FrontDeskSheets` mounted in the dashboard layout hosts `?new=1`
   (`phone`, `name` prefill). Palette patient group uses the route with an AbortController. Nav "Register patient", Today and Patients link `/patients?new=1`;
   `next.config.ts` redirects `/patients/new` (308) to it.
3. Deleted: `app/(dashboard)/patients/new/**`, `createPatient` and `searchPatients` and `searchPatientsForPalette` actions, the select-star
   `findPotentialDuplicates` path, `duplicate-warning-banner.tsx`, the directory table's remote search (it already held the whole list), waivers
   for `patients/new/page.tsx` and the directory table (the waitlist drawer's went from 2 sites to 1). `age-dob-input.tsx` stays (the v1 walk-in, booking
   and waitlist drawers use it). `createPatient` (service) stays for `/api/v1`, with `buildPatientSearchFilter` (the v1 list and the visits register use it).
4. Registries: pgTAP definer registry (+2, plan 95), `assert-pgtap-report.mjs` (FLOOR 8101 -> 8143, `patient_search.test.sql`), `assert-vitest-report.mjs`
   REQUIRED_FILES + 4 specs (242), guard manifest (`registerPatient`; new route kind `session-search` with its engine legs in `tests/security/guard/engine.ts`),
   `types/database.ts`, schema snapshot (2760 lines), `lib/observability/client-routes.ts`, `EXPECTED_MIGRATION` = 000101.

### Tests

- pgTAP: new `patient_search.test.sql` (40: indexes, EXPLAIN uses each trigram index on 5,000 rows with sequential scans off, catalog and grants, ranking, minimal
  columns, no-oracle queries, tenant isolation, locked clinic, duplicates, register_patient with objection stamp/audit/replay/refusals); `definer_functions` +2.
  Full pgTAP: 8143 in 51 files, PASS; gate PASS.
- Vitest: `tests/patients/search-patients-db.spec.ts` (7), `search-route.spec.ts` (8), `find-duplicates-db.spec.ts` (7), `register-patient-rpc.spec.ts` (33: catalog, one
  transaction, objection, rollback fault on the audit row, replay, concurrency, IDEMPOTENCY_MISMATCH per field, input matrix, role matrix, anon, cross-tenant,
  dual membership, service, form mapping: age 34 gives 1 January of the birth year, 8 months an exact date). Updated: guard manifest/routes/valid-inputs, nav, locked
  redirects, dpdp-rights, p0-01 forged overrides (now `registerPatient`), phone-search, palette-search-db (queue part only), dedup (age/phone part), ai-l1 and waiver specs.
  Affected set run: `tests/patients tests/ci tests/nav tests/observability tests/commands tests/pwa tests/audit`, the three guard specs, p0-01 specs, dpdp-rights,
  v1-crud, readiness probe, locked redirects: green (1260 + 2180 in two runs after the one waiver failure was fixed).
- E2E (desktop-chrome, pixel-7, plus iphone-15 for the journey): `journeys/journey-03-register-patient.spec.ts` (@golden; registers with the objection, DB row and stamp,
  axe on the sheet, duplicate banner with age and sex, "Use this patient", one row), `m0/register-patient.spec.ts`, `shell/palette.spec.ts`, `shell/nav-per-role`,
  `shell/ui-checks`, journeys, `design/keyboard/clinical-b` and `review-fixes-06-09c`, `pwa/04-offline`, `09`, `11`: all passed.

### Deviations

- **Route guard kind.** The `session` kind assumes an `[id]` resource and a 404 leg; a search route has neither, so the manifest gained `session-search` (denial legs reused,
  plus: tenant B's patient searched by name and number gives an empty list, tenant A's own is listed with exactly the keys, no full number, `no-store`).
- **Duplicate lookup stays a server action** (`findPotentialDuplicates`, `dedup.ts`, as the plan keeps `dedup*.ts`). It queues behind other actions (R-20); it is advisory and debounced 400 ms.
- **`patientSchema` gained optional `ai_processing_objected`** and `newPatientPayload` always sends it (false by default), so walk-in and booking commands carry it too.
  The normalised patient (and so the request hash) now includes the key.
- **PatientSearch is used in the waitlist drawer** (no e2e covers it); the walk-in and booking drawers keep their markup and search through the route with
  `legacy-patient-row.ts` (masked mobile, `42 y`); they leave in 08-03b and 08-04b. Their search needs two letters or three digits now.
- **Waiver spec** `a waiver downgrades only its own rule...` now builds a copy of the register with a virtual `app/(dashboard)/...` entry (the last real route-group waiver left with its page).
- **`pwa/04-offline`**: the sheet slides in (transition starts after first paint), and on a phone the offline banner overlays the foot of the bottom sheet, so a forced click on the
  button landed on the banner and dismissed the sheet. The spec waits for the sheet to be on screen and presses Enter and Space on the focused button instead. (UI note for later: the
  offline banner covers the bottom of a bottom sheet.)
- **Coordinator fixes folded in** (CI 44819102045): `EXPECTED_MIGRATION` bump (16b93ee) and the receptionist's consult page removed from `shell/ui-checks` (c0413ac).
  No other e2e spec opens `/consultation/` as a receptionist or admin (checked every storage state).

### What the next plan must know

- **Every new migration must bump `app/api/ready/expected-migration.ts` in the same commit** (000102 next); `tests/api/readiness-probe-db.spec.ts` fails otherwise.
- `PatientSearch` (`components/front-desk/patient-search.tsx`) and `registerHref(query)` are ready for the walk-in and booking sheets; `RegisterPatientSheet` takes `onRegistered(patientId)` to continue
  with the new patient instead of opening the profile. `QuickRegisterForm` returns `aiObjected`; `enqueueWalkIn` / `register_and_book` take it in `new_patient.ai_processing_objected`.
- `find_patient_duplicates` and `searchPatients` share the shape `PatientHit`; 08-05 replaces the duplicate function body (AI-14), keep its columns.
- The search needs two letters or three digits (client mirror: `isSearchableQuery`). The palette's Today-queue group is still a server action.
- A `?new=1` link on any dashboard page opens the sheet; `phone` and `name` prefill it.

### Commands run (counts)

- `npx supabase db reset --local`, `npm run db:types`; `npm run test:pgtap` (8143, 51 files, PASS), `node scripts/ci/assert-pgtap-report.mjs`: PASS.
- `node scripts/ci/local-drift.mjs`: PASS (0 statements); `node scripts/drift/schema-snapshot.mjs --local --write` then `--check`: PASS (2760 lines).
- `npm run typecheck`: clean. `npx eslint .`: 0 errors (430 warnings, 6 fewer than 08-01b). `npm run inventory`: exit 0. `npm run ci:ui-policy`: PASS (delta negative). `npm run ci:ai-l1`: PASS.
- `npm run e2e:build`; the e2e lanes above (no retries; each failure root-caused).

## 08-03a Today board, live updates

Commits (branch `v2/phase-08-front-desk`, base 5347098): 576f30d (migration 000102 + pgTAP + the Realtime spec), bafe4c1 (app), ce12174 (Vitest specs),
e226f65 (fix: clinical-b gallery checkbox, coordinator item), the e2e specs and the notes commit follow them.

### Realtime spike (R-10 gate): PASS, design A

On the pinned local stack (`supabase db reset --local` applies the migration cleanly): `realtime.send` and a SELECT policy on `realtime.messages` work from
a migration run as `postgres` (the table is owned by `supabase_realtime_admin`; `CREATE POLICY` is allowed). `tests/realtime/today-signals.spec.ts` (10 cases)
proves over a real socket: delivery to a receptionist and a nurse of the clinic within 2 s; nothing to clinic B's own subscriber; B's member, an unauthenticated
socket, a member of a locked clinic, a removed member, and every other topic shape (upper case, `today:*`, suffix, other prefix) cannot join `today:<A>`; a
browser cannot send on the channel (no INSERT policy). Fallback B was not needed. The Vitest loopback guard allows the WebSocket (loopback host).
Two facts the plan did not know: (1) a Realtime socket carries no `x-clinicos-tenant` header, so `authz.tenant_ids_with` (active clinic) cannot gate the
policy: the new `authz.today_topic_allowed(topic)` reads the clinic from the topic and checks an active membership of exactly that clinic, `appointments:view`
and access level `full`. (2) `realtime.send` adds the message's own random `id` to the payload; the trigger sends `kind` and `visit_id` only (pgTAP reads
the stored rows). A join is acknowledged before the read authorization is certainly effective for broadcasts: once a change committed in the first
milliseconds after SUBSCRIBED was missed under load; the spec now waits for a first delivered signal (`joined()`), and the board refreshes on every
(re)subscription, which closes the same gap in production.

### What changed

1. Migration `000102_today_realtime.sql`: `authz.today_topic_allowed(text)` (definer, EXECUTE authenticated only), policy `today_signals_select` on `realtime.messages`
   (broadcast only, no INSERT policy), `private.today_signal_send` (the one caller of `realtime.send`), `private.today_signal()` (definer trigger function, every
   error swallowed so a Realtime fault never rolls back a clinical write) and triggers on `visits` (insert; update of status, scheduled_at, doctor_id),
   `queue_tokens` (insert, update), `payments` (insert; the visit through the invoice) and the vitals of `clinical_notes`. `EXPECTED_MIGRATION` = 000102, schema
   snapshot (2769 lines), pgTAP registry rows (definer_functions, authz_helpers exact grant list), FLOOR 8143 -> 8174, REQUIRED_FILES + `today_signals.test.sql`.
2. Read model `features/today/{schema,queries}.ts`: `getTodayBoard(ctx, {doctorId, mode, date, now})`, explicit columns, one visits select with the patient, token
   and (for `consultations:view`) vitals embedded, invoices and payments only for completed visits and only with `billing:view`. Allergy flag only with `vitals:view` or
   `consultations:view`. The clinic day: a booking belongs to the day of its appointment time, a walk-in to the day it was created, both in the clinic zone.
3. UI `components/today/*` and `app/(dashboard)/today/{page,loading}.tsx` (see below); `/today` is in `LIVE_VIEWS` and has the title "Today". A doctor sees their own queue.
4. Live: `use-today-live.ts` (pure `createTodayLive` + hook), `announcer.ts`, `lib/pwa/safe-refresh.ts`, `lib/supabase/client.ts` (`realtimeClient`, `accessTokenFromCookie`).
5. Carried item 1 (no full navigation when the network drops during a refresh): `refreshWhenReachable` refreshes only when `navigator.onLine` AND `/api/health` answers;
   Today's poll, its signal refresh and the shell's resume refresh (`app-shell.tsx`) all use it.
6. Carried item 2 (offline banner over the foot of a bottom sheet): the banner publishes its distance from the viewport bottom as `--offline-banner-h` on the root
   (ResizeObserver, resize, and the shell's `data-bottom-bar` attribute); the bottom, responsive and right placements of `components/ui/sheet.tsx` stop that far above
   the bottom. `pwa/04-offline` clicks the sheet button again and asserts the hit target and that the sheet ends above the banner.
7. Coordinator item (CI 44824834302, `design/clinical-b-axe` 16x16 BUTTON): the AI-objection checkbox of the register form (a 08-02 component) was the only
   checkbox in a gallery form. The `Checkbox` label row (the documented target: 24 px fine pointer, 44 px touch) now carries `data-control-box`, which the spec reads
   as the measured target, and the hidden `aria-hidden` input Radix draws inside a form is 16 px (`app/globals.css`), which cleared the next check ("text under 16 px").
   The spec and its thresholds are unchanged. clinical-a, clinical-b and gallery axe specs: desktop-chrome and pixel-7 green.

### UI notes

- Lanes: Booked, Waiting, With doctor, To bill, Done. No-show and cancelled sit in Done with their own chip (as in the prototype), so the day reconciles.
  A no-show or booked row offers Check in (R-8) when its appointment is today; the row's only action in this plan.
- Below 768: lane switch with counts, one lane, row tap opens a bottom drawer. 768-1279: two panes (`minmax(320px, 44%)` list pane, the visit on the right).
  1280+: four lanes + Done as a 44 px column that expands. The detail has Visit, Vitals, Timeline (booked, arrived, seen) and Bill sections and a link to the record.
- Optimistic check-in: the row moves to Waiting at once (`withPendingCheckIns`, applied only while the server row still has the old status), rolled back with a
  toast ("Couldn't check in ... Retry", same `client_request_id`) when refused. Announcements: "Token 14, Name, checked in" composed from refreshed rows, 5 s throttle.
- `getTodayBoard` has no cap on rows (a clinic day is a few hundred at most); revisit with pagination only if a clinic reports it.

### Deviations

- **List pane `minmax(320px, 44%)`, not 330.** The shell's 24 px main padding leaves a 716 px board at 820 px wide; 330 px is 46.09 percent, over the acceptance bound
  of 46 (38 to 46), 320 px is 44.7 percent. The structural spec pins the range at 820 and 1180.
- **Realtime client without an auth client.** The plan says "subscribes with `private: true`"; a normal browser client would refresh (and on some failures delete) the session
  cookies (06-09d). `realtimeClient()` uses `createBrowserClient` with the `accessToken` option and no cookie access, reading the access token from the session cookie.
  It is a lazy chunk (`import()` in the hook), so it is not in `/today`'s first-load JS. The policy stays on the lint rule P1-34 (no new factory).
- **Realtime fault test.** A failing `realtime.send` cannot be forced from pgTAP (the schema is not writable), so `private.today_signal_send` is a separate function that
  the test replaces (inside its rolled-back transaction) with one that raises; the visit insert and the status change still commit.
- **Literal "network drops during an in-flight refresh" cannot be prevented**, because Next turns a failed RSC fetch into a navigation inside its own code. The guard makes
  the window a few milliseconds (probe, then refresh) and the specs prove both entries: offline (no request, no navigation, rows identical) and a server that does not
  answer the probe while the browser says online (no render request, no navigation); each fails when the guard is removed (checked by mutation).
- **Delivery of the payload `id`**: see the spike notes; the spec filters the key `id` out, the pgTAP file pins the stored rows to `id`, `kind`, `visit_id`.
- **Detail "Timeline"** shows booked and arrived times from the row (no event table is read); Consult times arrive with 08-03b's doctor mode.
- **Design capture** `design/screens/today-board.spec.ts` captures at the project width and, from the 820 project, the 744 case by resizing (the nightly `ipad-mini-744` project
  ignores `design/screens`).

### v1 behaviour inventory (M4 criterion 1; the screens are deleted in 08-03b)

Written from `app/(dashboard)/(today)/page.tsx`, `queue/page.tsx`, `cabin/page.tsx`, `components/queue/*`, `components/cabin/*`. "Test" = where the outcome is asserted after the cut-over.

| v1 behaviour | Where it goes | Test / approved removal |
|---|---|---|
| Dashboard counters (waiting, with doctor, completed, registered patients) | Lane heads show the counts; Registered-patients count is removed (the Patients list has it) | `front-desk-screens.spec.ts` (counts in the lane switch); removal approved by the Today design (no counter cards) |
| Dashboard "Today's Active Patients" table (8 rows, status badge, Consult / Resume / Review) | Lanes; Consult/Resume are 08-03b's doctor-mode actions (`startConsultation`) | 08-03b journey 5 |
| Dashboard doctor redirect to `/cabin` | `/today?mode=doctor` default for the doctor role (R-14); 08-03a already scopes a doctor to their own queue | `get-today-board.spec.ts` (doctor filter), 08-03b |
| Install card on the dashboard | Rendered above the board on `/today` (08-03a) | existing `06-06` specs move with the route in 08-03b |
| Queue: day list with date switcher (previous, next, today) | Today shows the clinic's today only; other days are the Schedule (08-04b) | approved removal (R-14: Today is today) |
| Queue: doctor filter | Doctor select in the head when the day has more than one doctor (08-03a) | `today-board` structure spec (select present), `get-today-board.spec.ts` |
| Queue: status sort (in consultation first), waiting by token | Lane order: waiting urgent, vip, then token; booked by time; done newest first | `schema.spec.ts` |
| Queue card: token number, priority, patient, age/sex, doctor, scheduled time or walk-in | `QueueRow` (TokenChip, meta line, appointment time in the token column) | `get-today-board.spec.ts`, `front-desk-screens.spec.ts` |
| Urgent / VIP tokens | Priority is read and sorts the Waiting lane; the visible urgent/vip badge on the row is 08-03b (walk-in sets priority) | `schema.spec.ts` (ordering); badge: 08-03b |
| Vitals summary / "Vitals pending" on the card | `VitalsSummary` on waiting and with-doctor rows for roles that read vitals | `get-today-board.spec.ts` (role differences), `front-desk-screens.spec.ts` |
| Triage button (record vitals modal) | Row action "Record vitals" in 08-03b (nurse mode) | 08-03b |
| Check In button on a booked card | Check in on the row: one command, optimistic, `useCommand` | `today-live.spec.ts` (one action) |
| Start Consultation / Resume on the card | 08-03b (doctor mode, `startConsultation`) | 08-03b |
| Checkout (drawer, collect) on a completed card | To-bill lane row; Collect opens `CheckoutDrawer` in 08-03b | 08-03b (`checkout-collect.spec.ts`) |
| Walk-in drawer (`+ Add Walk-In`) | 08-03b walk-in sheet (`?walkin=1`) | 08-03b |
| Cancelled and no-show visits shown at the bottom of the queue | Done lane with their chip | `get-today-board.spec.ts` |
| Cabin: pinned active consultation, waiting list, completed list, owner doctor switch | 08-03b doctor mode (Next card, Waiting mine, With me, Seen today; owner toggle) | 08-03b |
| Cabin: "Token #07" large label, empty copy | Empty-lane copy of 06-UI-SPEC | `schema.spec.ts` (copy) |
| Realtime / polling | none in v1 (F-02) | 08-03a: `today-live.spec.ts`, `today-signals.spec.ts` |

### Tests

- pgTAP: new `today_signals.test.sql` (31: helper and trigger shapes, grants, policy shape and no INSERT policy, topic matrix incl. dual member without header, suspended, removed, locked, stored payload keys per trigger, no signal for unwatched columns, failing send does not abort the write). Full pgTAP: 8174 in 52 files, PASS; gate PASS.
- Vitest DB: `tests/realtime/today-signals.spec.ts` (10, real socket), `tests/today/get-today-board.spec.ts` (12). Unit: `tests/today/{live,announcer,schema}.spec.ts` (7, 6, 10), `tests/pwa/safe-refresh.spec.ts` (4), `tests/supabase/realtime-token.spec.ts` (4); `tests/pwa/shell-runtime.spec.ts` gained `/today`. Affected set (`tests/today pwa supabase realtime ci observability nav`, readiness probe, check-in rpc, lint gates, locked redirects, api, commands): green, 1151 + 1993 in two runs.
- E2E: `today/today-live.spec.ts` (4 tests + 2 in the offline describe, desktop-chrome, pixel-7; the one-action check-in and the two-browser spec are `@golden`, also iphone-15), `a11y/front-desk-screens.spec.ts` (axe at 360/820/1280, no sideways scroll at 7 widths, bottom bar below 768, lane switch, 38-46 percent list pane, side sheet at 1280, filter), `design/screens/today-board.spec.ts` (`npm run e2e:design`: 12 passed; PNGs in `evidence/screens/today/` at 360, 744, 820, 1180, 1280). `pwa/04-offline` (sheet click), `shell/nav-per-role` (`/today` listed), `design/clinical-{a,b}-axe` and `gallery-axe`: green. Full `npm run e2e:pr` at the end: 658 passed, 3 failed, 233 skipped (the failures: nav-per-role listing `/today`, fixed, and the check-in spec on pixel-7 and iphone-15 clicking before hydration, fixed with a hydration wait: `boardHydrated` reads React's fiber key on the board, nothing was added to the app); the failing specs re-run green on desktop-chrome, pixel-7 and iphone-15 (50 passed). Expected failures (known P1-03, network-block) are unchanged. No test passed only on retry.
- Mutation check: with `refreshWhenReachable` reduced to `refresh()`, both "connection drops" specs fail (10 and 5 render requests); restored.

### Commands run (counts)

- `npx supabase db reset --local`, `npm run db:types` (no diff); `npm run test:pgtap` (8174, 52 files, PASS), `node scripts/ci/assert-pgtap-report.mjs`: PASS; `node scripts/ci/local-drift.mjs`: PASS; `node scripts/drift/schema-snapshot.mjs --local --write` then `--check`: PASS (2769 lines); `npx supabase db diff --local`: empty.
- `npm run typecheck`: clean. `npx eslint .`: 0 errors (430 warnings, unchanged). `npm run inventory`: exit 0, 0 flagged. `npm run ci:ui-policy`: PASS (deltas non-positive). `npm run ci:ai-l1`: PASS. `react-compiler-waivers`: PASS (no new waiver).
- `npm run ci:route-js`: `/today` 290.3 kB gz (route-specific 161.8; layout is 128). The 200 kB target of the plan is not met by any dashboard route today (the next smallest, `/patients`, is 280.5; `/queue` 307.9); the Supabase client, the first thing that took `/today` to 369.9, is a lazy chunk now. Report-only; the budget is enforced in V2-15.
- `npm run e2e:build` (several times), the e2e lanes above.

### What 08-03b must know

- `/today` exists beside the v1 `/`, `/queue`, `/cabin`; the navigation, titles of other pages, `isRootPath` and `next.config.ts` redirects are untouched (the page shows a Back arrow until the nav model has Today). `nav-per-role.spec.ts` lists `/today` in `NOT_IN_NAV`: delete that entry when the nav carries it.
- Row actions: `TodayRow.actions` is `rowActions(...)` computed on the server for the caller's role; only `check_in` is rendered (`today-row.tsx`). 08-03b adds `start`, `record_vitals`, `collect`, `reschedule`, `no_show`, `cancel` there (the optimistic pattern is `withPendingCheckIns` + `useCommand` in the row, with the toast Retry).
- Urgent/VIP badge, Record vitals, Call in / Open consult, Collect (open `CheckoutDrawer` from a To-bill row) and the walk-in sheet are not in the board yet (see the inventory table). `TodayBoardOptions.mode` is accepted and ignored: shape the lanes per mode in `getTodayBoard`/`today-board.tsx`; a doctor already sees only their own queue (page passes `doctorId`).
- To bill needs `billing:view`: a doctor and a nurse never see To bill (completed visits are Done for them). The doctor mode in 08-03b should say so or show the bill state another way.
- The live hook refreshes with `router.refresh()` guarded by `refreshWhenReachable`; actions that change a visit should call `revalidatePath("/today")` (`checkInVisit` does; the old `/queue`, `/calendar` strings are 08-03b's cut-over list) and the board's `live.refreshNow()` after a success.
- E2E helpers: `tests/e2e/support/today-data.ts` (`seedBookedToday`, `seedWaitingToday`, `seedFullDay`), `today-page.ts` (`openToday` waits for hydration, `showLane`, `rowOf`, `rowInLane`). Wait for hydration before a click on server-rendered controls on a phone.
- Any new `?x=` sheet is hosted by `FrontDeskSheets`; the Today board uses `?visit=` for its own selection.
- pgTAP floor is 8174 (52 files); Vitest REQUIRED_FILES 249; `EXPECTED_MIGRATION` is 000102 (000103 next, bump it in the same commit).
