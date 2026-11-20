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
