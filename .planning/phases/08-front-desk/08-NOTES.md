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

## 08-03b Walk-in, vitals, nurse and doctor modes, cut-over

Commits (branch `v2/phase-08-front-desk`, base 429a20b): listed by the orchestrator report; the notes commit follows them.

### What changed

1. Walk-in sheet (`?walkin=1`, shortcut W): `components/front-desk/walk-in-sheet.tsx`, hosted by `FrontDeskSheets` (now also `canWalkIn`). Find stage:
   `PatientSearch`; Enter picks the patient and moves focus to "Add to queue" (W, Enter, Enter besides the typing); confirm stage: doctor
   select (only when the clinic has more than one doctor; the last one used in this browser session is preselected), priority
   (Normal, Urgent, VIP); "Register as new patient" opens `QuickRegisterForm` inline (submit label "Register and add to queue",
   `onUseExisting` goes to the confirm stage). Submit is `enqueueWalkIn` through `useCommand` with `SaveStatus` and "Start over" after
   an unknown outcome. Doctors come from the existing `getActiveClinicDoctors` action (no new action).
2. Shortcuts: `components/front-desk/shortcuts.ts` (pure: `shortcutsEnabled`, `shortcutFor`), `components/today/shortcut-sheet.tsx` (list and the
   per-device switch, key `clinicos.pref.shortcuts` added to `DEVICE_PREF_KEYS`). W and N follow the switch (default on for a fine pointer at
   1024 px and up); `?` always opens the list.
3. Vitals: `components/today/vitals-sheet.tsx` (`VitalsForm` in a `ResponsiveSheet`, `recordVisitVitals`, not a command). `features/visits/vitals-input.ts`
   maps the form's reading to the stored v1 shape (`temperature` in F, `respiratory_rate`); `sugar` and `sugar_type` were added to the vitals
   schema (the form collects them; they were silently dropped before). `VitalsForm.onSave` may resolve `false` (then it does not say "Saved").
4. Modes (R-14): `features/today/schema.ts` gained `TODAY_MODES`, `modesOf(role)`, `resolveMode`, `lanesOf(mode)`, `rowButtons(mode, row, canConsult)`,
   `nextUp`; `laneOf` and `groupIntoLanes` take the mode (doctor: To bill folds into "Seen today"; triage: waiting rows with vitals pending first).
   `/today?mode=front|triage|doctor`: default by role (doctor: doctor, nurse: triage, others: front); owner toggles front and "My queue"
   (`components/today/doctor-mode.tsx`); doctor mode (doctor and owner) reads only that doctor's visits. `components/today/next-patient-card.tsx` is the
   pinned "Next" card with Call in; row buttons are `use-row-commands.ts` (`useCheckIn`, `useStart`: `start_consultation`, then the consult opens).
   Collect opens the existing `CheckoutDrawer` (lazy chunk with the vitals sheet), built from the row by `components/today/checkout-target.ts`
   (the drawer's `QueueItem` type left with the v1 queue card; it now has its own `CheckoutTarget`). Row flags show Urgent / VIP.
5. Cut-over (R-14): `navForRole` has one primary destination Today (`/today`) for every operational role, `newActions` = Add walk-in and Register patient,
   `LIVE_VIEWS` = `/today`, `/calendar`; `/` is a page that redirects (307) to `/today` (the dashboard layout above it still signs the visitor in);
   `/queue` and `/cabin` redirect (308) from `next.config.ts` (`/cabin` to `/today?mode=doctor`); manifest `start_url` `/today?source=pwa`; login, join, clinic/new,
   access and not-found/error/offline links go to `/today`; `revalidatePath` strings, notification links, `sign-and-bill-modal`, patient and visits links moved.
   `getQueueForDate` (service and action, `select *` with `patients(*)`) is gone: the palette's `searchTodayQueueForPalette` selects three columns itself;
   `tests/integration/{queue-flow,ist-boundaries}` and `tests/security/role-rls` read `getTodayBoard` instead.
6. Deleted: `app/(dashboard)/{(today),queue,cabin}/**`, `components/queue/{walk-in-drawer,queue-view,queue-card,status-actions,triage-vitals-modal}.tsx`,
   `components/cabin/**`, `components/dashboard/nav.tsx`, the walk-in drawer's waiver entry (waivers 9 -> 8). `components/queue/checkout-drawer.tsx` stays.
7. `tests/ci/no-client-command-chains.spec.ts` (M4 criterion 7): `components/today`, `components/front-desk` (and `components/schedule` from 08-04b) import none of the
   legacy multi-step writers.

### Deviations

- **No `B` shortcut.** The plan lists W, B, N and `?`; the booking sheet (`?book=1`) does not exist until 08-04b, so a B key would do nothing. 08-04b adds it to `SHORTCUTS`
  and `FrontDeskSheets` (one line each).
- **Last doctor used is kept in memory, not in `localStorage`.** `DEVICE_PREF_KEYS` says a preference may never be an identifier (a doctor's user id is one), so the
  preselection lasts for the browser session only.
- **Walk-in visit duration** is the command's default (15 minutes): `getActiveClinicDoctors` does not return the doctor's default slot length, which the v1 drawer
  passed. A walk-in has no slot, so nothing else reads it.
- **Walk-in reason** is the fixed text "Walk-in consultation" (the v1 drawer had a free "Reason / Symptoms" box; the plan's sheet has none, to keep W, Enter, Enter).
- **Collect is on every completed visit** (`rowActions`' `collect`): "Collect ₹X" when money is due (To bill lane), "Bill" otherwise (Done lane). A visit
  with no invoice yet is Done with balance 0, and the v1 checkout was how that invoice was created, so hiding the button would have removed the only path.
- **Vitals blood sugar** is stored (schema extended, see 3). The Today vitals summary reads it back.
- **`Billing & Reports` caption in the phone bar** is "Reports": Today replaced three destinations, so the owner and the admin now have four primaries and Reports
  reached the BottomBar, where its name was clipped (found by `design-review-09e`).
- **Sheet "Retry" fix (found by the spec 7 walk-in leg).** The `SaveStatus` Retry of a `useCommand` form re-ran the call but not what follows a success (close the
  sheet, open the profile): after a lost response the sheet showed "Saved" and stayed open. The walk-in sheet and the 08-02 register sheet now retry through their own
  submit (same request id). Not covered by a spec for the register sheet.
- **Specs changed with the cut-over** (all outcome assertions kept): `m0/{walk-in-token,checkout-collect,consult-rx-finish}`, `pwa/{04-offline,13-idempotent-retry,01-manifest,06-update,
  02..10, ui-checks*}`, `shell/*`, `journeys/{journey-08,journey-09}`, `a11y/clinical-split-screens` (Today rows, zero tolerated axe baseline), `design/screens/*` (the queue
  and cabin captures are Today captures; `g3-screens.json` ids `owner-queue`, `receptionist-queue` removed, `doctor-cabin` -> `doctor-today`), `m0/baseline/baseline-routes`
  (the checkout flow seeds its own completed visit: the run's visit is in consultation), `LANDING` in `support/run-data.ts` (every role lands on `/today`), unit specs for nav,
  live views, bottom-bar captions, notification fixtures and the `/queue` route fixtures of the proxy, public paths, SW and client-error specs.

### v1 behaviour inventory: where the rows of 08-03a's table ended up

Every row of the 08-03a table is either in `/today` (counters as lane counts, doctor filter, sorting, tokens with the Urgent / VIP flag, vitals summary, Check in, Start / Call in,
Collect, walk-in sheet, doctor mode with Next and Seen today, the owner's doctor switch as the mode toggle) or an approved removal (day switcher, registered-patients counter).
Not in the 08-03a table, found while deleting the cabin: its WhatsApp prescription and receipt buttons (`sharePrescriptionViaWhatsApp`, `shareReceiptViaWhatsApp`) and its
printer link. Both shares remain on the patient's visit history and the Visits register (the receipt share also in the checkout drawer); no action lost its other callers.
Recorded as an approved removal of a duplicate entry point.

### Tests

- Vitest (unit, no stack needed): `tests/today/modes.spec.ts` (13: modes by role, `?mode=` resolution, row buttons per mode from the real permission matrix for every role x status,
  no consult action for a role without `consultations:edit`, no button the state machine did not list, the doctor's lanes, triage order, the stored vitals shape, the checkout
  target, the typed query to register fields), `tests/today/shortcuts.spec.ts` (4), `tests/ci/no-client-command-chains.spec.ts` (3, M4 criterion 7). Updated: `tests/nav/nav-for-role`
  (Today for every role, `newActions`), `tests/pwa/{shell-runtime,device-prefs}`, `tests/design/design-review-09e`, the guard manifest (`getQueueForDate` removed), `tests/auth/*` and
  `tests/subscriptions/locked-redirects` (the Today page replaces the dashboard, cabin and queue pages), `tests/integration/{queue-flow,ist-boundaries}`,
  `tests/security/role-rls`, `tests/visits/visit-service-guards`, notification and route fixtures. Affected set (`tests/security auth subscriptions observability notifications
  integration api visits queue ci patients commands pwa today nav design staff appointments consultation`): 218 files, 4902 tests; 9 failed on the first run (a blanket `/queue`
  replace had renamed `features/queue/actions.ts` keys in `guard/valid-inputs.ts`: 6; the locked-page redirect now goes to `/today`: 3), both fixed, the two files re-run green (706).
- E2E: new `today/front-desk.spec.ts` (19 per device: nurse vitals and no consult action; doctor start from a booking = one token and `in_consultation`, the Next card, own queue only,
  Call in; owner toggle; receptionist has no consult action and registers a new patient inside the walk-in sheet; keyboard W, Enter, Enter = exactly 3 key presses; the `?` list and the
  switch; axe at 360, 820, 1280 on the walk-in sheet (find and confirm), the vitals sheet and each mode), `journeys/journey-05-walk-in.spec.ts` (@golden, the receptionist adds a walk-in,
  the doctor's browser shows it under Waiting (mine), Call in opens the consult, axe on the sheet), `pwa/13-idempotent-retry.spec.ts` walk-in leg (a NEW patient: response lost once, and
  lost on every attempt: still one patient, one visit, one token, no orphan; "Retry" then closes the sheet). `m0/{walk-in-token,checkout-collect,consult-rx-finish}` keep their outcome
  assertions on the new selectors and record `ux` counts (walk-in-token now counts the sheet's keyboard path).
- Final `npm run e2e:build` then `npm run e2e:pr`: 685 passed, 240 skipped, 2 failed, 0 retried. The two failures were `pwa/04-offline` first test on desktop-chrome and pixel-7: (1) a `Check in`
  button on Today offline carries its screen-reader reason, which the "rows unchanged" text comparison counted (only visible once earlier specs left a booked row), (2) the first
  "E2E Synthetic" in the DOM sat in a hidden lane on a phone. Both are assertion brittleness, not UI defects (the offline reason is Button's rule; lanes are one at a time below 1280): the spec now
  seeds its own waiting patient and ignores the reason text; re-run green on desktop-chrome, pixel-7 and iphone-15. The expected failures (known P1-03, network-block self-test) are unchanged.
  Earlier full runs found and fixed: every `"/"` landing assertion (turnstile, sign-in helpers, 06-update, 09e Back, journey 09), the manifest start URL, `Go to Today` hrefs, `Male`
  matching `Female`, the bottom-bar caption for Reports, and the Retry defect above. `npm run e2e:nightly -- tests/e2e/today` (ipad-mini-744, ipad-gen7, galaxy-tab-s4 landscape and the
  other nightly devices): 22 passed.
- `npm run ci:route-js`: `/today` 298.0 kB gz (08-03a: 290.3; the checkout drawer and the vitals sheet are lazy chunks: without them it was 318.7). Report-only (budget enforced in V2-15).

### Commands run (counts)

- No migration, no SQL touched: no `db reset`, no pgTAP, no schema snapshot step (`EXPECTED_MIGRATION` stays 000102).
- `npm run typecheck`: clean. `npx eslint .`: 0 errors (418 warnings, 12 fewer than 08-03a). `npm run inventory`: exit 0, 0 flagged. `npm run ci:ui-policy`: PASS (deltas non-positive). `npm run ci:ai-l1`: PASS.
  `node scripts/observability/client-routes.mjs --write` (`/queue` and `/cabin` left the list), `tests/ci/react-compiler-waivers.spec.ts` green (no new waiver, one fewer).
- `npm run e2e:build` (several times), the lanes above.

### What 08-04a and 08-04b must know

- `/today`, `?walkin=1`, `?new=1` exist; `FrontDeskSheets` takes `canRegister` and `canWalkIn`; add `?book=1` and `?reschedule=` there and a `B` entry to `SHORTCUTS` (`components/front-desk/shortcuts.ts`)
  and the key map in `front-desk-sheets.tsx`. `rowActions` already lists `reschedule`, `no_show` and `cancel`; `rowButtons` (`features/today/schema.ts`) does not render them yet: add their kinds there
  when the commands of 000103 exist. `components/schedule` is already covered by `no-client-command-chains.spec.ts`.
- `/calendar` still exists (redirect in `next.config.ts` and the Schedule nav label are 08-04b's); `LIVE_VIEWS` is `/today`, `/calendar` (rename with the route). The palette's "Book appointment" still links `/calendar`.
- `updateVisitStatus` still has only test callers (08-01b note); `getQueueForDate` is gone.
- A booked visit's `Start consultation` in the calendar's `doctor-timeline.tsx` is still a plain link to `/consultation/<id>` (08-01b note): replace it with `startConsultation` or remove it with that screen.
- `SaveStatus` Retry of a `useCommand` form must go through the form's own submit (see the Retry fix); `command.retry()` alone does not run what follows a success.
- Tests that need a visible row below 1280 px must use the Waiting lane (the default) or `showLane`; Done is a collapsed column at 1280 and up (`showLane(page, "Done")` expands it); `openBill(page, name, ux?)` opens the checkout from Today.
- `tests/e2e/support/run-data.ts` `LANDING` is `/today` for every role; `/` redirects there.

## 08-04a Staff scheduling commands, slot rules, patient self-reschedule

Commits (branch `v2/phase-08-front-desk`, base 96067db): 9abfa02 (migration 000103, registries, pgTAP), 4adb006 (app: commands, route, page), 0c738e0 (specs); the notes commit follows them.

### What changed

1. Migration `000103_staff_scheduling_commands.sql` (`EXPECTED_MIGRATION` is 000103, bumped in the same commit).
   - **R-9 / G-3.** `private.default_weekly_schedule()` (a pgTAP check proves it equals the column default of `memberships.availability_schedule`; Mon-Sat
     10:00-13:00 and 17:00-21:00, Sunday off) and `private.effective_schedule(jsonb)` (NULL reads as the default). `private.slot_conflicts` (booking, staff
     reschedule) and the slot list read the schedule through it; `slot_conflicts` gained `p_exclude_visit_id` (the 5-argument signature is dropped; the
     argument defaults to NULL, so `register_and_book` is unchanged). `private.available_slots_core(tenant, doctor, date, exclude_visit)` holds the grid;
     `public.available_slots(doctor, date, exclude_visit default null)` is its wrapper (the 2-argument signature is dropped).
   - **R-15 commands**, V2-07 pattern (definer, guard block, claim, lock, invariants, in-transaction audit through `log_command_audit`, `command_complete`):
     `reschedule_visit`, `cancel_visit`, `mark_no_show`, `confirm_appointment`, `add_to_waitlist`, `promote_waitlist_entry`. Reschedule: booked, confirmed
     and no-show only, the booking's slot rules with the visit excluded (`SLOT_TAKEN`/`SLOT_OFF_DUTY`/`SLOT_BLOCKED`, the two overrides and `p_overbook` as in
     `register_and_book`), `SLOT_IN_PAST`, status back to `booked`, confirmation metadata cleared, `visit.reschedule` audit (old and new times), optional
     `appointment_rescheduled` message, `appointment.rescheduled` webhook. Cancel: booked, confirmed, waiting; closed reason set; code in
     `metadata.cancellation_reason` (the webhook payload reads it), note in `metadata.cancellation_note` only; promotion through
     `private.step_promote_waitlist` (D-08: same clinic-local date, this doctor or any, priority then age, `FOR UPDATE SKIP LOCKED`, an entry that cannot take
     a visit is skipped); optional `appointment_cancelled` message; `appointment.cancelled` webhook. No-show only once the appointment time has passed;
     confirm answers `already_confirmed` without a second audit row; promote checks the slot like a booking.
   - **R-16.** `get_reschedule_context` adds `clinic.timezone`; new anon-callable, token-scoped `get_reschedule_slots(token, date)`; `consume_reschedule_token`
     validates shifts, blocks, the visit's own duration and the exclusion constraint (`slot_unavailable`, `slot_taken`; a refused move leaves the link usable)
     and clears `is_overbooked` on a successful move.
   - **Audit.** `visit.reschedule`, `visit.no_show` (new) and `visit.cancel`, `visit.confirm`, `visit.auto_promoted_from_waitlist`, `waitlist.add`,
     `waitlist.promote` are command-only now (out of `private.audit_client_actions()`, into `log_command_audit`); metadata keys `old_scheduled_at`,
     `new_scheduled_at`.
   - **Contract.** `REVOKE UPDATE ON public.visits FROM authenticated; GRANT UPDATE (specialty, metadata, updated_at)`.
2. Writer inventory of `visits` (status, scheduled_at, doctor_id, is_overbooked, estimated_duration_minutes, location_id). Request paths (user client) before: `updateVisitStatus`
   (status), `confirmAppointment` (status, metadata), `cancelVisit` (status), `saveConsultationDraft` (status waiting to in_consultation, specialty, metadata),
   `consume_reschedule_token` (definer: scheduled_at). Definer commands (unaffected by the grant): `check_in_visit`, `start_consultation`, `complete_visit`, the
   sign-off and amendment commands, `enqueue_walk_in`, `register_and_book`, the six new ones. `service_role` (keeps UPDATE): `/api/v1/appointments`, `/api/v1/visits`,
   `features/appointments/system.ts` (cancel, webhook bot confirm), the messaging webhook. After: no authenticated path writes a revoked column.
3. App. `updateVisitStatus`, the multi-statement `cancelVisit` and `confirmAppointment` (service and actions) are deleted. New in `features/visits/scheduling-service.ts` and
   `scheduling.ts`: `rescheduleVisit(input, id)`, `cancelVisit(input, id)`, `markNoShow(visitId, id)`, `confirmAppointment(visitId, id)`; in `features/waitlist`:
   `addToWaitlist(input, id)`, `promoteWaitlistEntry(input, id)` (all `Result<...>` over `callCommand`, fixed texts in `SCHEDULING_COMMAND_MESSAGES` and
   `WAITLIST_COMMAND_MESSAGES`). `getAvailableSlots(ctx, doctor, date, excludeVisitId?)`. `saveConsultationDraft` no longer writes `status`: a waiting visit is started through
   `start_consultation` after the draft is saved (best effort, a fresh id). The calendar's cancel and confirm and the waitlist drawer call the new actions through `useCommand`
   (a calendar cancel is reason `other`, no message, until 08-04b's dialog). Patient link: `app/api/reschedule/[token]/route.ts` no longer builds slots (the UTC loop and
   `DEFAULT_SCHEDULE` are gone): it reads the context, then `getRescheduleSlots`; it answers `timezone`, the page names dates and times in it.
4. Registries: `RPC_REASON_CODES` (+7), `AUDIT_ACTIONS` / `COMMAND_ONLY_AUDIT_ACTIONS` / `AUDIT_METADATA_KEYS`, guard manifest and valid inputs (four scheduling actions, the two waitlist actions
   with request ids), guard world (`noShowableVisit`), pgTAP definer registry (8 rows, grantees, access classes, legs), schema snapshot, `types/database.ts`, FLOOR and REQUIRED_FILES of both
   report gates.

### Deviations

- **Parameter order.** PostgreSQL allows no required parameter after a default, so the plan's `(…, p_notify, p_client_request_id)` orders are `(required…, p_client_request_id, optional…)`, as in
  `register_and_book`. `p_notify` defaults to false in SQL (the UI box that is on by default is 08-04b's).
- **`public.available_slots` is a SECURITY DEFINER wrapper, not INVOKER.** An invoker wrapper cannot call the private core (`authenticated` has no EXECUTE on `private`). Its guard is the session's
  active full clinic plus `appointments:view`; registered in the definer registry (bound, refuses a locked clinic).
- **Template `request_roles` are not widened** (the plan allowed adding the receptionist). `private.step_enqueue_visit_message` goes through `private.enqueue_message_internal`, which already enforces
  the template row and the parameter allow-list and the patient's own number; the two templates stay system-only for `public.enqueue_message`. Nothing to flag for the adversarial review there; the
  step itself is the surface (definer, no grant, fixed template ids, the actor's own dedupe namespace).
- **Waitlist promotion only for a slot that lies ahead** (`scheduled_at > now()`) and only from a booked or confirmed visit; the old service promoted into past slots too. The spec that used a fixed
  past date (`tests/scheduling/calendar-waitlist.spec.ts`) now uses a relative one.
- **`consume_reschedule_token` keeps the visit's status** (a confirmed visit stays confirmed when the patient moves it) and resets `is_overbooked`. The context still returns `booked` and
  `availability_schedule` (now the effective schedule) although the route no longer reads them: dropping the two fields is a cleanup for 08-05 (anon-visible data that nothing uses).
- **Legacy pgTAP files that prove guards by updating `visits` as `authenticated`** (`amendment_snapshot`, `reverify_integrity`, `signed_visit_fields`, `visit_integrity`, `visit_state_machine`,
  `command_review_fixes`) widen the UPDATE grant inside their own transaction (documented at the top of each): they test the triggers and policies, not the grant. `authz_matrix` instead updates
  `updated_at` (`tests/authz/table-matrix.ts`, regenerated), so its grant rows stay meaningful. The narrowing is proven in the new `staff_scheduling.test.sql`.
- `checkSlotAvailability` (the booking drawer's client pre-check) still reads a NULL schedule as "no restriction"; the commands decide, and 08-04b replaces the pre-check with `available_slots`.
- `visit.status_update` stays in the client allow-list (`/api/v1/visits/[id]` writes it), `queue.transition` likewise (stale, as noted in 08-01b).

### Tests

- pgTAP: new `staff_scheduling.test.sql` (49: default equals the column default, NULL schedule in booking and in the list, 21:00 evening end, 28 slots, IST date line (00:30 IST slot), exclusion of the visit
  itself, wrapper guard, column privileges both ways incl. refused updates per revoked column and kept columns working, grants, audit lists, `get_reschedule_slots` and `consume_reschedule_token` outcomes);
  `definer_functions` +14 (six commands x acting-in-A and locked, `get_reschedule_slots` locked and full). Full pgTAP: 8237 in 53 files, PASS; gate PASS (floor 8237).
- Vitest DB: `tests/visits/{reschedule-visit-rpc (36), cancel-visit-rpc (29), no-show-confirm-rpc (25)}.spec.ts`, `tests/waitlist/waitlist-commands-rpc.spec.ts` (17),
  `tests/scheduling/patient-reschedule.spec.ts` (11): catalog, happy path with audit, outbox and message rows, fault injection (nothing persists, the same id then succeeds), replay,
  `IDEMPOTENCY_MISMATCH` per hashed input, role matrix, anon, cross-tenant, dual membership, concurrency (two reschedules into one slot give one winner and `SLOT_TAKEN`; two cancels with one entry give
  one promotion; two promotes give `WAITLIST_ENTRY_CLOSED`; two patients on one slot), slot rules (blocks, off duty, overbooking, NULL schedule, the visit's own time), service texts.
  Changed: `available-slots` (definer signature, NULL schedule, IST date line, exclude argument, service), `register-and-book-rpc` (NULL schedule is the default hours, 6-argument `slot_conflicts`),
  `share-tokens` (the concurrent POSTs use two free default-hour slots), `integration/visits` (status through `check_in_visit`, a refused direct write), `signed-visit-integrity`,
  `multi-clinic-tenant-filters`, `cross-tenant-refs`, `calendar-waitlist`, `no-client-command-chains` (the three names now belong to commands), `readiness-probe-db` (anon allow-list),
  `calendar-scheduling-ux` and `no-raw-error-responses` (the mock-based confirm and the two raw-error cases went with the deleted services; the commands are proven against the real database).
  Affected set (`tests/security auth subscriptions observability notifications integration api visits queue ci patients commands pwa today nav design staff appointments consultation scheduling waitlist
  audit db billing jobs messaging realtime labs referrals prescriptions`): 288 files, 6035 tests; 6 failed on the first run (anon allow-list of the new token function, authz generator drift, two
  direct status writes in `integration/visits`, the no-show guard control at a past time that the growing seed offset had overtaken), all fixed, the files re-run green.
- E2E (after `npm run e2e:build`): `tests/e2e/m0 tests/e2e/journeys` on desktop-chrome 32 passed (the P1-03 known-bug case is the expected failure); `m0 journeys today` on pixel-7 45 passed, 11 skipped;
  `shell today` on desktop-chrome 119 passed, 1 skipped. No retry.

### Commands run (counts)

- `npx supabase db reset --local`, `npm run db:types`; `npm run test:pgtap` (8237, 53 files, PASS), `node scripts/ci/assert-pgtap-report.mjs pgtap-report.tap`: PASS; `node scripts/ci/local-drift.mjs`: PASS;
  `node scripts/drift/schema-snapshot.mjs --local --write` then `--check`: PASS (2793 lines); `npx supabase db diff --local`: empty; `npm run authz:gen`.
- `npm run typecheck`: clean. `npx eslint .`: 0 errors (418 warnings, unchanged). `npm run inventory`: exit 0, 0 flagged. `npm run ci:ui-policy`: PASS. `npm run ci:ai-l1`: PASS.

### What 08-04b must know

- Actions (all take a request id; use `useCommand`): `rescheduleVisit({ visit_id, new_scheduled_at, doctor_id?, estimated_duration_minutes?, is_overbooked, override_off_duty, override_block, notify }, id)`,
  `cancelVisit({ visit_id, reason_code, reason_note?, notify, promote_waitlist }, id)` (`CANCEL_REASON_CODES` in `features/visits/schema.ts`), `markNoShow(visitId, id)`, `confirmAppointment(visitId, id)` in
  `features/visits/scheduling.ts`; `addToWaitlist(input, id)` and `promoteWaitlistEntry({ entry_id, scheduled_at, doctor_id?, estimated_duration_minutes, is_overbooked }, id)` in `features/waitlist/actions.ts`.
  Refusals are `CONFLICT` with the reasons `SLOT_TAKEN`, `SLOT_OFF_DUTY`, `SLOT_BLOCKED` (offer the overbook or override confirmation, as the booking drawer does), `SLOT_IN_PAST`,
  `VISIT_NOT_RESCHEDULABLE`, `VISIT_NOT_CANCELLABLE`, `VISIT_NOT_MARKABLE`, `NO_SHOW_TOO_EARLY`, `VISIT_NOT_CONFIRMABLE`, `WAITLIST_ENTRY_CLOSED`.
- `rowActions` lists `reschedule`, `no_show`, `cancel`; `rowButtons` (`features/today/schema.ts`) still renders only check in, start, vitals and collect: add the three kinds. `getAvailableSlots(ctx, doctorId, date, excludeVisitId?)`
  is the slot list for the sheets (the visit being moved is passed as `excludeVisitId`).
- `components/calendar/calendar-view.tsx` cancels with reason `other` and no message (placeholder until the cancel dialog), confirms with `confirmAppointment`; the waitlist drawer still registers then adds (two commands,
  its own rewrite is 08-04b). `doctor-timeline.tsx`'s booked "Start Consultation" link and `checkSlotAvailability` are still the v1 pieces.
- The guard world has `noShowableVisit`; `tests/helpers/scheduling-commands.ts` has the arg builders and `ist(week, dow, h, mm)` for March 2031 slots (the patient link, unlike staff, takes nothing beyond 90 days).
- pgTAP floor is 8237 (53 files); Vitest REQUIRED_FILES 257; `EXPECTED_MIGRATION` is 000103 (000104 next, Smart Assist).

## 08-04b Schedule and booking UI

Commits (branch `v2/phase-08-front-desk`, base 0dcaccf): listed by the orchestrator report; the notes commit follows them.

### v1 behaviour inventory (M4 criterion 1): the calendar and its drawers, and where each behaviour went

| v1 behaviour (`/calendar`, `components/calendar/*`) | New home |
|---|---|
| Doctor filter pills (shift-click for several doctors) | Schedule head: doctor chips, one doctor or "All doctors" (a doctor opens on their own day). **Approved removal:** the multi-select of several doctors |
| Soft-block override with a free-text "emergency" note (`[EMERGENCY OVERRIDE]` in the reason) | `SlotConflictDialog` (off duty or blocked) with "Book anyway"; the visit is flagged overbooked. **Approved removal:** the emergency note |
| Overbook dialog with the cause (G-4: taken, off duty, blocked) | `SlotConflictDialog`, the same cause texts (`overbookCauseText`), in the booking and in the move |
| Waitlist drawer (add; the new-patient tab) and the "N on waitlist" pill and strip | `WaitlistSheet` ("Waitlist (n)" in the head): the day's entries, Add to waitlist (`add_to_waitlist`), Book a slot per entry (`promote_waitlist_entry`). **Approved removal:** registering a new patient inside the waitlist form (a waitlist entry needs a patient; "Register as new patient" opens the register sheet) |
| Waitlist auto-promotion notice on cancel | Toast "A waitlisted patient was booked into the vacated slot" from `CancelDialog` (the result of `cancel_visit`) |
| Block time (time window, full day, date range, reason presets) | `BlockTimeDialog` on `Dialog` (Schedule head and the profile's availability card), the same `createScheduleBlock` action |
| Confirm (soft-booked card) | Confirm button on the appointment card, one command (`confirm_appointment`) |
| Slot click prefilled the booking drawer (doctor, time) | Free-slot chips on the day view: links `?book=1&doctor&date&time` (R-13) |
| `?patientId=` on the calendar link (ignored by v1, UX_AUDIT F-07) | `?book=1&patient=<id>` opens the sheet on that patient (patient record, visit history) |
| Patient context in the drawer (search, selected patient card, New patient tab) | `PatientSearch` or `QuickRegisterForm` inside the sheet; `register_and_book` registers and books in one command |
| Cancel through `confirm()` / `alert()` | `CancelDialog` (reason, note, "Tell the patient"), ⋯ menu |
| Date navigator (previous, today, next) | Schedule head (a week at a time in the week view) plus a "Go to date" field |
| 15-minute timeline with multi-slot spans and an "in progress" marker | Day view: one column per doctor, a chronological list of appointments (start to end), blocks and runs of free slots. **Approved change:** no hour grid |
| Off-duty cells and "Off Duty / Emergency" hover labels | Absence of free slots (the list is `available_slots`, the one the command checks); "Pick another time" reaches any time and the command asks |
| Duration select (15 to 90 minutes) | The visit's length is the chosen slot's length (`end - start` of `available_slots`); 15 minutes for a time typed by hand. **Approved removal:** the free duration choice |
| "Start Consultation" link on a booked card (`/consultation/<id>`, which failed at sign-off for a booked visit, 08-01b) | Removed with the card: a consultation starts from Today (`start_consultation`, R-1) |
| Horizontal timeline of at least 780 px on a phone | Agenda below 768 px (day view from 768 px) |

### What changed

1. **Slot adapter** `components/front-desk/slot-adapter.ts` (`toPickerSlots`, `slotInstant`, `slotLengths`, `earliestSlot`): the one place that turns `available_slots` instants into clinic `HH:mm` and
   back, through the clinic zone only.
2. **Shared slot choice** `SlotSection` (doctor, `DayStrip`, `SlotPicker`, "Pick another time"; free slots through the new `getAvailableSlots` action; slots that have started are not offered) used by the booking
   sheet, the move sheet and the waitlist promotion. `SlotConflictDialog` is the one overbook / override question.
3. **Sheets** hosted in `FrontDeskSheets` (dashboard layout, R-13): `BookingSheet` (`?book=1&patient&doctor&date&time`, existing patient or QuickRegister, `register_and_book` through `useCommand`, SaveStatus, Retry through the sheet's own
   send, the earliest slot preselected) and `RescheduleSheet` (`?reschedule=<visitId>`, `reschedule_visit`, "Tell the patient" on by default, own slot listed again, nothing preselected). B opens the booking sheet
   (`shortcuts.ts`). `CancelDialog` (`cancel_visit`: reason, optional note, "Tell the patient" on, promotion notice) and `NoShowDialog` (`mark_no_show`) sit behind `RowMenu`, the ⋯ menu of an appointment
   row: Move appointment, Mark as no-show, Cancel appointment, only what the state machine's `actions` list for the role (`rowMenuItems`). The menu is on Today's rows (not in the doctor's own queue) and on the Schedule's cards.
4. **Schedule** `/schedule` (`?date&view=day|agenda|week&doctor`): `features/schedule/{schema,queries}.ts` (explicit columns, free slots from `available_slots`, week counts), `components/schedule/{schedule-view,schedule-head,
   day-grid,agenda,week-overview,appointment-card,waitlist-sheet,block-time-dialog}.tsx`. Agenda below 768 px, day view from 768 px unless `view` says otherwise.
5. **Cut-over**: nav destination `schedule` (label Schedule, "My Schedule" for a doctor, BottomBar caption "Schedule"), `newActions` + palette Book appointment (`/schedule?book=1`), `LIVE_VIEWS` `/today`, `/schedule`,
   `/calendar` redirects (308) to `/schedule` from `next.config.ts`, every `revalidatePath("/calendar")`, notification and webhook `link_url`, patient record and visits links, the client-route list (regenerated).
6. **Deleted**: `app/(dashboard)/calendar/**`, `components/calendar/**` (7 files, 2,511 lines), the two waivers (`booking-drawer`, `waitlist-drawer`; waivers 8 -> 6), the `checkSlotAvailability` server **action** (no caller left; the service stays for
   `/api/v1/appointments`, see Deviations), the guard-manifest entry of the action.
7. Two read actions were added for the sheets: `getAvailableSlots(doctorId, date, excludeVisitId?)` and `getRescheduleTarget(visitId)` (patient name, doctor, current slot; explicit columns, `appointments:view`), both in the guard manifest with valid inputs.

### Deviations

- **`getRescheduleTarget` is a new server action** (the plan names none): the sheet is hosted once in the layout (R-13) and needs the visit's name and slot, which only a read can give. It is a plain read on the caller's session (RLS), in the guard manifest.
- **The patient of `?patient=<id>` is read with the existing `getPatient` action** (`patients:view`), not a new minimal route.
- **Overbook confirmation is one dialog**: confirming sends `is_overbooked: true` plus the matching override (off duty or blocked), so the visit is flagged overbooked; the command clears all conflicts of an overbooking. v1's two dialogs and
  the emergency note are gone.
- **"A doctor with no free slot says why"** says it generically ("off duty, blocked or fully booked"): `available_slots` returns free slots only, and the cause would need a second query per doctor and day.
- **Day view is a chronological column list per doctor**, not an hour grid, so overbooked visits (two in one slot) never overlap. The 744 px iPad mini portrait gets the agenda (the doctor columns start at 768, as the plan says).
- **`date` and `doctor` stay in the address when a sheet closes**: the Schedule uses both for its own view. A free-slot link therefore also narrows the Schedule to that doctor.
- **Cancel always asks for promotion** (`promote_waitlist: true`); there is no switch. The waitlist sheet lists the day shown, not "today" as v1's pill did.
- **Reschedule's "Tell the patient" is on by default** (the plan says it for the cancel dialog; the same box is on the move).
- **`checkSlotAvailability` (service) is unchanged**: `/api/v1/appointments` still calls it and still reads a NULL schedule as "no restriction". The rule of R-9 for the public API belongs to V2-12 (it owns `/api/v1`).
- **Migration 000104 (the plan says "no migration")**: the first full e2e lane failed two walk-in specs on pixel-7 (they passed alone and on desktop-chrome). Root cause: `search_patients` (000101) read every digit of a typed
  name as a mobile fragment, so "E2E Synthetic Walk-in dcc7a1" (digits 2, 7, 1) also matched any mobile containing "271" at rank 2, above the exact name (rank 3), and "Register as new patient" (offered only
  when nothing matches) did not appear. The chance grows with the patients in the clinic, so it hit once this plan's specs had added enough. Fix, not a test workaround: digits are a mobile fragment only when the query
  has no letters (`000104_search_patients_name_queries.sql`, same signature and grants; `EXPECTED_MIGRATION` 000104; case in `tests/patients/search-patients-db.spec.ts`). **08-05's migration is therefore 000105.**
- **The calendar deletions are in commit 716067e** (the orchestrator's CI commit, made while my deletions were staged); the code that replaced them is in the commits of this plan.
- **Route JS**: `/schedule` 310.3 kB gz and `/today` 319.2 kB gz (08-03b: 298.0). The booking and move sheets are in the dashboard layout and load on every dashboard route; making them lazy chunks is an option if V2-15's budget needs it.

### Tests

- Vitest (unit, no stack): `tests/schedule/slot-adapter.spec.ts` (11: 04:30Z shows 10:00 and 10:00 sends 04:30Z with the process zone UTC, America/Los_Angeles and Asia/Kolkata, the IST date line, round trips, slot lengths),
  `tests/schedule/schedule-model.spec.ts` (8: a doctor's day merges appointments, blocks and runs of free slots, the week starts on Monday, addresses, agenda order, the row menu from the real permission matrix).
  Updated: `tests/nav/nav-for-role` (Schedule, Book in `newActions`), `tests/today/shortcuts` (B), `tests/pwa/shell-runtime`, `tests/design/design-review-09e` (caption "Schedule"), `tests/auth/page-revoked-session` and
  `tests/subscriptions/locked-redirects` (the Schedule page), the guard manifest and valid inputs (`getAvailableSlots`, `getRescheduleTarget` in, `checkSlotAvailability` out), `tests/patients/search-patients-db` (+1).
- Affected sets: `tests/visits scheduling waitlist today nav pwa design integration notifications patients staff commands messaging api queue` 136 files, 2310 tests, 1 failed at first (the BottomBar caption of "My Schedule", fixed); `tests/security/guard-actions`
  668 and `guard-routes`; `tests/ci` and `tests/auth/page-revoked-session`, `tests/subscriptions/locked-redirects` 1231; pgTAP full (8237 in 53 files, PASS, floor unchanged).
- E2E: new `journeys/journey-04-book-appointment` (@golden: book into a free slot, the patient is on the Schedule, the same slot for another patient asks and writes nothing, another slot books; axe on the sheet, find and plan stages),
  `schedule/schedule.spec.ts` (16 per device: move with its own slot listed and the `ux` count, a taken slot asks first, cancel with a waitlist promotes and says so, no-show only after the time has passed, Confirm, the Today row's menu, day, agenda and week
  views and the week counts, free-slot links, axe and no sideways scroll on every view and on the move sheet and cancel dialog, the patient's own reschedule page in the clinic's zone with the browser in New York, a link's doctor, day and time, Book Slot from the
  patient record, B, keyboard only B-name-Enter-Enter), `pwa/13-idempotent-retry` booking leg (a NEW patient inside the booking sheet: lost once, and lost on every attempt with Retry through the sheet's own send: one patient, one visit),
  `shell/clinic-zone-hydration` (browser in New York and in UTC), `m0/{book,cancel}-appointment` rewritten on the new UI with the same outcome assertions, `design/screens/schedule` (captures at 360, 744, 820, 1180, 1280 to `evidence/screens/schedule/`).
  Interaction counts (`test-results/m0/counts`, desktop-chrome): move 4 actions (target 4); booking an existing patient 5 actions in the spec, of which one is choosing the non-default doctor (4 with the default doctor; target 4), and
  keyboard only (B, name, Enter, Enter) 1 action and 3 key presses; cancel with the dialog 3 actions; Confirm 1.
- Final `npm run e2e:build` then `npm run e2e:pr`: 725 passed, 243 skipped, 4 failed, 0 retried. The four are the two expected failures on each of desktop-chrome and pixel-7 (known P1-03 `consult-rx-finish`, and the `network-block` self-test): unchanged.
  The first full lane had two further real failures (the palette's expected options still said "Calendar"; the search ranking above), both fixed before this run. `npm run e2e:nightly -- tests/e2e/schedule`: 22 passed (ipad-mini-744, ipad-gen7 and landscape, galaxy-tab-s4 and landscape,
  android-tablet-800, iphone-se-3).

### Commands run (counts)

- `npx supabase db reset --local`, `npm run db:types` (no change), `npm run test:pgtap` (8237, 53 files, PASS) and `node scripts/ci/assert-pgtap-report.mjs pgtap-report.tap` PASS, `node scripts/drift/schema-snapshot.mjs --local --write` then `--check` PASS,
  `node scripts/ci/local-drift.mjs` PASS, `npx supabase db diff --local` empty. `node scripts/observability/client-routes.mjs --write` (`/calendar` -> `/schedule`).
- `npm run typecheck`: clean. `npx eslint .`: 0 errors (407 warnings, 11 fewer than 08-04a). `npm run inventory`: exit 0, 0 flagged. `npm run ci:ui-policy`: PASS. `npm run ci:ai-l1`: PASS. `npm run ci:route-js`: `/schedule` 310.3 kB gz, `/today` 319.2.

### What 08-05 must know

- Its migration is **000105** (000104 is the search fix above); `EXPECTED_MIGRATION` is 000104 now. Registries: `tests/security/guard-manifest.ts` has `getAvailableSlots` and `getRescheduleTarget`; REQUIRED_FILES of the Vitest gate is 259 files; pgTAP floor 8237.
- `components/front-desk/booking-sheet.tsx` is where AI-13's chips go: it renders `SlotSection` (`components/front-desk/slot-section.tsx`; `preselect` chooses the earliest free slot). `suggestSlots` should feed `SlotSection` an optional `suggestions` list (it does not exist yet)
  or replace the preselection there; the slot list and the adapter (`slot-adapter.ts`, `earliestSlot`, `slotLengths`) are the one place that converts. QuickRegister in the booking sheet is `QuickRegisterForm` with `findDuplicates` from `use-duplicate-lookup.ts`.
- `FrontDeskSheets` takes `canBook`; the clinic switcher's hard navigation to `/today` tears down the sheets with the layout. The Schedule's data is `getSchedule` (`features/schedule/queries.ts`); `/schedule`'s waitlist and week read call `getAvailableSlots` (service) once per doctor and day.
- This plan added no command; the latency script's list is 08-04a's. `getAvailableSlots` (the database's `available_slots`) is already one of its baselines.
- Data-dependent search flakes are root-caused (000104); any spec that types a synthetic name with digits is safe from the mobile-fragment rule now.

## Orchestrator note (2026-11-21)

Commit `716067e` ("ci(v2-08): test job limit 45 min") also carries the deletion of `components/calendar/**` that 08-04b
had staged with `git rm` at that moment; the replacement code is in `412ae60`. History was not rewritten.
The walk-in flake of CI 44851237140 (`pwa/13-idempotent-retry`, "Register as new patient" never shown) was root-caused by
08-04b: `search_patients` (000101) read the digits of a run-tagged name as a mobile fragment; fixed in 000104.

## Flake: 05-cache-audit offline sign-out on WebKit (2026-11-21)

CI run 44851237140 failed once on iphone-15 and passed on retry: `pwa/05-cache-audit.spec.ts` "Offline sign-out", at
`expectPurged` (`cacheNames` was `["rogue-cache"]`). Fix commit `7754407`. Debug session: `.planning/debug/pwa05-offline-signout-webkit.md`.

- **Root cause (the test, not the product).** On WebKit the page stays after an offline sign-out, because Playwright's
  WebKit refuses the offline navigation under the worker. So the spec polled `deviceState()` while `hardSignOut`'s purge
  was running. `deviceState` calls `caches.keys()` and then `caches.open()` on each name it got, and `caches.open` creates
  the cache if it does not exist. One poll listed `rogue-cache` before the purge deleted it, then opened it after the
  delete, and so re-created it empty. That same poll already saw `sessionStorage` cleared, so the poll passed and
  `expectPurged` found the re-created cache. This is the mechanism `dbed175` fixed for IND L-6. The poll in spec 5 was
  older than that fix and was never migrated.
- **Evidence.**
  - Trace of the CI failure, and the same signature in a local failing trace: the poll that passed overlapped the purge.
    `rogue-cache` was still listed, but its seeded `/api/patients` entry was gone, as were `static-v1:/patients`,
    sessionStorage and IndexedDB. The purge never deletes a non-worker cache's entries one at a time, only the whole
    cache, so the purge had deleted it.
  - The whole sign-out took about 650 ms. The purge is awaited before `location.replace`, and its 3 s cap was not reached.
  - App-free probe (WebKit and Chromium): `keys()` stops listing a cache as soon as it is deleted, and a later `open()`
    brings it back empty.
  - Amplified A/B with 60 padding caches: the old probe re-created `rogue-cache` in 4 of 10 runs, the new probe in 0 of 10.
- **Fix (`7754407`).** `tests/e2e/pwa/fixtures.ts` gains `purgeProgress(page)`, which reads sessionStorage keys and
  IndexedDB names and never touches Cache Storage. The WebKit branch now polls it until both are empty. IndexedDB is the
  last purge step, so `expectPurged` then reads a settled device. `expectPurged` is unchanged and still strict: with a
  purge mutant that keeps non-worker caches, the fixed spec failed 6 of 6 runs on iphone-15 and desktop-chrome. No
  product code changed.
- **Repeat counts** (`--repeat-each=20 --retries=0`, whole spec file):
  - Before: iphone-15 1 failed out of 148 (the offline test failed 1 of 20).
  - After: iphone-15 148 of 148 (offline 20 of 20) and desktop-chrome 168 of 168 (offline 20 of 20).
  - Also run: 05 + 06 on iphone-15 and desktop-chrome 31 of 31, `npm run typecheck` clean, `npx eslint .` 0 errors
    (407 warnings, unchanged).
- **For the PO (not changed here).** `hardSignOut` limits the purge to `PURGE_TIMEOUT_MS` (3 s) before
  `location.replace`. This follows the 06-09a design rule that no step may hold up the exit. A purge slower than 3 s
  would therefore be cut off by the navigation. Online, `/login` purges again on arrival. Offline, the script-less
  `/offline` page does not purge, so the leftovers stay until the next `/login` visit. Not involved in this flake.
