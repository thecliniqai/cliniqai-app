# V2-09a notes (executor record)

Branch `v2/phase-09a-clinical-immutability`. Evidence is tool output (the run logs, `evidence/command-latency.json`); nothing below is typed
evidence. Counts are from the runs named beside them.

## 09A-01 Seal the record for every writer (migration 000107_clinical_seal)

### What changed

- `supabase/migrations/000107_clinical_seal.sql` (`ls supabase/migrations | tail -3` showed 000106 as the newest, so 000107 was free; the 08-06a
  guard bodies were re-read first: 000106 does not touch `visits_integrity_guard`, so the latest body is still 000099:340-469).
  - `private.visits_integrity_guard`: the system-path block (R-5): a writer with no `auth.uid()` can no longer take `signed_at`/`signed_by` from
    NULL to a value, change them once signed, change `current_revision`, `created_by`, `created_at`, or change `status` of a signed visit; R-6
    adds `reason_for_visit` to the columns locked while sealed (both paths). The user-path logic is byte for byte the 000099 text (the R-6
    check keeps its place there; only its condition became `status IS DISTINCT FROM 'in_consultation'`, which is the same set).
  - New `visits_sealed_delete_guard` (BEFORE DELETE on `visits`, `VISIT_SIGNED_DELETE_FORBIDDEN`), R-4a exception: a writer with no session
    when no `tenants` row exists for the row's tenant.
  - `public.clinical_notes_guard` replaced (seal on every path, plus a new BEFORE DELETE trigger `clinical_notes_delete_guard` on the same
    function); the diagnosis, Rx item and follow-up guards apply the seal to INSERT, UPDATE and DELETE on every path; the follow-ups
    `ON DELETE SET NULL (visit_id)` carve-out is kept.
  - New `visit_revisions_append_only` (BEFORE UPDATE OR DELETE, `REVISION_IMMUTABLE`).
  - No data change, no grant or policy change. All new/replaced functions are INVOKER, `search_path = ''`, EXECUTE revoked from PUBLIC and the API roles.
- `features/consultation/record-state.ts` (`recordState`), `isDraftLocked` delegates to it (same truth table).
- `app/api/v1/appointments/[id]/route.ts` DELETE: a signed or completed appointment answers the fixed 409 `VISIT_LOCKED` (as PATCH on visits),
  and a 42501 from a race maps to the same 409.
- Fixtures (R-15): `signVisitAs` / `reopenVisitAs` in `tests/helpers/clinical-commands.ts` (plus `scheduledAt` on `seedClinicalVisit`); in pgTAP a
  `pg_temp.sign_visit` / `as_actor` helper that signs under the signer's own JWT claims (the same way a definer command does); e2e
  `seedPrescription` + `signSeededVisit` in `tests/e2e/support/m0-data.ts` (`seedSignedPrescription` is gone).

### Deviations from the plan, with reasons

1. **Tracer order.** The plan wants the tracer committed before the expansion. The migration is one file, so I wrote and ran the tracer Vitest
   case first (red on 000106: `expected undefined to be '42501'`), then wrote the whole migration; the tracer spec, the migration and the helpers
   are one commit (`9215079`). The proof is recorded here, not as a separate commit.
2. **System-path sealed predicate.** For a writer with no session the guards test `EXISTS (sealed visit)`; for a signed-in caller they keep
   `NOT EXISTS (open visit)` (fail closed). The plan's R-3 text says a visit the caller cannot see counts as sealed (that is the user path). A
   cascade from deleting an UNSIGNED visit finds the visit row already gone, and `NOT EXISTS (open visit)` would have refused the cascade for the
   system path, so a missing visit is "not sealed" there (the FK guarantees the visit exists for INSERT/UPDATE).
3. **R-7 DELETE.** The visit FK of `visit_revisions` is RESTRICT, so a visit with an amendment row cannot be deleted at all; the guard therefore
   admits a DELETE only for the tenant-purge cascade (no "visit gone" branch).
4. **R-4a held without the fallback.** The cascade-visibility assumption passed on the pinned stack: deleting a clinic as `postgres` and as
   `service_role` cascades through a sealed visit, notes, diagnoses, header, items, follow-up and revision (clinical_seal.test.sql). The
   `pg_trigger_depth()` fallback was not needed. A real tenant purge also ran in practice: the latency script's cleanup of a clinic with signed
   visits (deleted as postgres) succeeded.
5. **Owner DDL in two legacy pgTAP files.** `visit_state_machine.test.sql` proves the transition table for signed rows through a system-path status
   change, which `visits_integrity_guard` now refuses first, so that one statement runs with the integrity guard switched off (`ALTER TABLE ...
   DISABLE TRIGGER`, enabled right after, rolled back with the file); `migration_edge_cases_visit_integrity.test.sql` simulates a migration
   remedy that rewrites a signed row's signer (Q-12: a migration must say so and disable the guard). Both are commented in place.
6. **e2e fixture moved forward from 09A-05.** The P1-03 known-bug case seeded a signed visit and then a signed Rx item with the service role; the
   database refuses that now, and `knownBug` would have swallowed the fixture error only by turning the lane red. I changed the fixture in
   09A-01 (`signSeededVisit`), the case still fails for its real reason (builder editable). 09A-05 still turns it into a plain test.
7. `scripts/perf/command-latency.ts`: its `complete_visit` leg seeded an `in_consultation` visit, which 08-06a (S-4) made `VISIT_NOT_COMPLETABLE`
   (105 of 105 calls failed, exit 1 before any of my work). It seeds `waiting` now (one line).
8. The plan said `delete_rules.test.sql` would be extended for R-4a; it passes unchanged, and the R-4a cases live in `clinical_seal.test.sql`.

### Writer inventory checked (who can write the sealed tables)

- `visits`: definer commands under the caller's JWT (sign, reopen, finalize, check-in, start, complete, cancel, reschedule, no-show, confirm,
  waitlist; all reviewed in V2-07/V2-08 and unchanged), app services with the user client (column grant `specialty, metadata, updated_at` only, 000103),
  v1 API (`PATCH visits` filters signed rows and refuses clinical fields; `DELETE appointments` now refuses signed), the INSERT-only system
  writers (R-4c), test fixtures. No job writes `visits` after sign-off.
- `clinical_notes`: `lib/db/clinical-notes.ts` (user client), the visits trigger that creates the empty row (INSERT, not guarded).
- `consultation_diagnoses`: `features/terminology/service.ts`, `features/consultation/service.ts` (user clients).
- `prescription_items`: `features/prescriptions/service.ts` (user client), `app/api/v1/prescriptions/route.ts` (service role; the route refuses a
  sealed visit, it inserts items on an open visit and deletes its own just-created header on failure).
- `follow_ups`: `features/consultation/service.ts` only (user client). No job or reminder writes follow-ups. (Risk for a future reminder job:
  updating a follow-up of a signed visit is refused for every writer; model reminders on their own table.)
- `visit_revisions`: the two commands (INSERT only).
- Grep for hits across tests: `grep -rlE "signed_at|signed_by" tests scripts` (40 files). Outcome per file:
  changed: `tests/queue/complete-visit-rpc.spec.ts` (also fixed a silent failure: a service-role "sign" by UPDATE whose error was never checked, so the
  test seeded nothing and passed vacuously), `tests/api/v1-doctor-guard.spec.ts`, `tests/security/review-fixes-app.spec.ts`,
  `tests/security/front-desk-direct-writes.spec.ts` (not on the plan's list), `tests/jobs/enqueue-webhook-rpc-db.spec.ts`;
  unchanged because they only INSERT a signed visit (allowed, R-4c) or assert a refusal: `tests/visits/{signed-visit-integrity,cancel-visit-rpc,slot-suggestion-context-db,clinic-visits-register}.spec.ts`,
  `tests/security/{review2-fixes-db,p0-01-action-sweep}.spec.ts`, `tests/security/guard/world.ts`, `tests/compliance/dpdp-rights.spec.ts`,
  `tests/patients/visit-history.spec.ts`, `tests/billing/*`, `tests/integration/*`, `tests/consultation/{sign-consultation-rpc,amendment-rpc}.spec.ts` (sign through the command),
  `tests/e2e/*` other than the consult case; `tests/authz/table-matrix.ts` is regenerated in 09A-02.
  pgTAP changed: `signed_visit_fields`, `amendment_snapshot`, `reverify_integrity`, `visit_integrity`, `command_review_fixes`,
  `migration_edge_cases_visit_integrity`, `visit_state_machine`; unchanged and passing: `clinical_notes`, `delete_rules`.

### Tests added or changed (file: name)

- `tests/clinical/seal-system-path.spec.ts`: "a sealed visit refuses the service-role UPDATE with CLINICAL_NOTES_VISIT_SIGNED and the note is
  unchanged"; "a draft visit admits the same service-role UPDATE (control...)"; "an amending visit (reopened) admits it as well". Red on 000106, green on 000107.
- `tests/consultation/record-state-parity.spec.ts`: "seeded one visit per status, unsigned and signed (14 rows)"; "classifies every combination as the plan's R-2
  says"; "a note write is refused (42501 CLINICAL_NOTES_VISIT_SIGNED) if and only if recordState is sealed, as the service role and as the owner".
- `tests/api/v1-doctor-guard.spec.ts`: "with the route's own filter bypassed, the service-role client cannot change, un-sign or delete a signed visit";
  "DELETE /api/v1/appointments/[id] of a signed appointment is 409 VISIT_LOCKED and the visit is unchanged".
- `supabase/tests/database/clinical_seal.test.sql` (31): 23 operations x 3 states x 9 roles (asserted as 11 aggregate checks, each failing with the offending
  `operation/role => outcome`), the throwaway SECURITY DEFINER function as the doctor and as service_role plus its control, the R-4a purge as postgres
  and as service_role plus the negative case, R-4c (insert a signed visit; a child row and the note stay refused), object checks. Red on 000106 (the
  file errors on the missing function, and every sealed assertion fails), green on 000107.
- pgTAP legacy: `signed_visit_fields` (+2: the N-9 case flips to `VISIT_SIGNED_FIELD_IMMUTABLE`), `visit_integrity` (+1) and
  `migration_edge_cases_visit_integrity` (+1) (the signer-FK case splits into the system-path UPDATE refusal and the system-path INSERT that still meets the FK).

### Counts

- pgTAP full run (`npm run test:pgtap`): 8356 tests, 56 files, all pass (FLOOR 8321 -> 8356, arithmetic in the gate header).
- Vitest affected folders at the 000107 tree (`tests/clinical consultation visits queue security api integration billing jobs compliance patients authz ci`):
  3815 tests in 187 files, 7 failed before the fixture fixes (5 files); after them the 6 touched files pass (113 tests) and `tests/dpdp labs prescriptions audit storage ci` pass (573 tests, 48 files).
- e2e lane (`npx playwright test tests/e2e/m0 tests/e2e/journeys --project=desktop-chrome --retries=0`): 33 passed in 49.8 s, 0 retries; the P1-03 known-bug
  case is the expected failure (it fails on the disabled-builder assertions).
- `npm run typecheck` clean; `npx eslint .` 0 errors (413 warnings, none in files this plan created; the `no-explicit-any` warnings in the touched route are pre-existing);
  `npm run inventory` exit 0 (no action changed); schema snapshot `--check` PASS; `npm run db:drift:local` PASS.

### Notes for 09A-02..05

- Until 000108 the prescription header was unguarded: a system-path DELETE of a draft/sealed header cascaded to its items with the header already gone
  (the item guard sees no visit). 000108 closes it (header DELETE refused when sealed).
- A pgTAP file is ONE transaction, so `now()` is the same instant at sign-off and at a later finalize in the same file, and the guard (which stamps
  `now()`) then sees no signature change. Re-sign with `clock_timestamp()` in the supplied value (the guard replaces it with `now()` but compares the
  supplied value), or back-date the signature as 09A-02's pgTAP does.
- Service-role `.update()` calls whose error is never read are a false-green hazard now (see `complete-visit-rpc.spec.ts`): check the error in any fixture.
- `recordState` is the contract V2-09b must keep (`features/consultation/record-state.ts`), parity-tested on real rows.

## 09A-02 Seal the prescription header, finish the amendment commands (migration 000108_prescription_seal)

### What changed

- `supabase/migrations/000108_prescription_seal.sql` (newest was 000107; `private.step_sign_consultation`, `public.finalize_visit_amendment` start from 000099,
  `private.webhook_event_subject` from 000041, `prescriptions_actor_guard` from 000077; none was redefined by 000100-000107):
  - `prescriptions_actor_guard`: INSERT refused on a sealed visit for every writer (`PRESCRIPTION_VISIT_SIGNED`); on the request path `version` must be 1
    (`PRESCRIPTION_VERSION_FORBIDDEN`, I-1). The UPDATE key check is unchanged (still signed-in only).
  - New `prescriptions_seal_guard` (BEFORE UPDATE OR DELETE, every writer, `RX_SEALED`): while the visit is sealed only `updated_at`, `letterhead_mode`,
    `pdf_storage_path` change (compared with a `to_jsonb` diff, so a later column is covered automatically); DELETE refused except the tenant-purge cascade.
  - `REVOKE UPDATE ... FROM authenticated; GRANT UPDATE (letterhead_mode, pdf_storage_path, updated_at)`.
  - `step_sign_consultation`: the seal UPDATE of the active headers runs before the visit UPDATE; nothing else changed.
  - `finalize_visit_amendment`: after the visit UPDATE, `webhook_event_subject('prescription.issued')` + `enqueue_webhook_internal` in the same transaction
    (skipped when there is no header, or when the latest header is not active; a subject of another tenant raises `OUTBOX_SUBJECT_INVALID`).
  - `webhook_event_subject`: `prescription.issued` data gains `version`; the key gains `:v<n>` for n greater than 1.
- Docs: `docs/runbooks/jobs.md` (event keys and data), `components/settings/developer/create-webhook-modal.tsx` (event description).

### Deviations from the plan, with reasons

1. **Key suffix on a first issue of version 2.** `:v<n>` follows the header's version, not "is this a re-issue". A visit signed with two active headers (versions
   1 and 2) therefore queues `...:signed` and `...:signed:v2` at sign-off. It matches R-10 ("n greater than 1") and keeps one event per version; `sign-consultation-rpc.spec.ts`
   asserts both keys.
2. **Finalize skips instead of faulting when the header is not active.** The sign step raises `OUTBOX_SUBJECT_INVALID` for a subject not in the event's state;
   for finalize a non-active latest header (status `cancelled`/`amended`) would otherwise block an amendment, so it queues nothing. A subject of another tenant still raises.
3. **grants.test.sql** gets one assertion (the column grant); `definer_functions.test.sql` is unchanged (both commands keep their registry rows, the new
   function is INVOKER and not a definer). The full column-grant proof is in `prescription_seal.test.sql`.
4. **Legacy pgTAP files widen the prescriptions UPDATE grant inside their own transaction** (`visit_integrity`, `amendment_snapshot`), exactly as they already do for `visits` (000103):
   they prove the guards, independent of the column grant. `amendment_snapshot`'s NF-2 decoy header is now written while the visit is a draft (a system-path INSERT on
   a signed visit is refused), and its version-100 / version-2 header cases become `PRESCRIPTION_VERSION_FORBIDDEN` cases plus one "first header of an open visit" control.
5. **pgTAP finalize needs a back-dated signature** (see the 09A-01 note on `now()`): `prescription_seal.test.sql` back-dates visits 31 and 32 with the integrity guard
   disabled around that one UPDATE (owner DDL, rolled back), then reopens/finalizes through the commands.
6. Latency script fix: see 09A-01 deviation 7.

### Writer inventory checked

- Header INSERT: `features/prescriptions/service.ts` (user client, version 1), `app/api/v1/prescriptions/route.ts` (service role, later versions on an open or amending visit),
  `finalize_visit_amendment` (UPDATE of the same row). Header UPDATE: the PDF generator (`pdf_storage_path`, `letterhead_mode`, `updated_at`: exactly the granted columns), the two commands.
  Header DELETE: only the v1 route's rollback of its own new header (open visit). Reads elsewhere (`features/dpdp/export.ts`, patient/visit history, referrals).
- `grep` for `UPDATE ... prescriptions` in migrations: only `step_sign_consultation` and `finalize_visit_amendment`.

### Tests added or changed

- `supabase/tests/database/prescription_seal.test.sql` (33): 10 operations x 3 states x 9 roles (9 aggregate checks), the column grant (+ table privileges + trigger/function shape),
  sign-order (two active headers sealed, keys `...:signed` and `...:signed:v2`, payload version, second sign refused), reopen + finalize (version 2, same header row,
  keys per version, version in the data, replay queues nothing, one revision row), a visit whose only header is cancelled (seals nothing, finalize still works, no event).
  Red on 000107 (the guard function does not exist; 6 of the first 14 assertions fail before the file errors), green on 000108.
- `tests/consultation/rx-seal.spec.ts` (10): per-role PostgREST UPDATE of version/status/signed_at/amendment_reason refused 42501 on a signed and a draft header
  (owner, doctor, admin, nurse, receptionist, other clinic's owner), the PDF columns still writable, a doctor's second header refused, the first header admitted,
  service role UPDATE/DELETE of a sealed header `RX_SEALED`, INSERT into a signed visit refused, draft UPDATE admitted (control). 12 of the 19 cases in this file and the AC-6 file fail on 000107.
- `tests/security/ac6-rewrite-signed-rx.spec.ts` (9): AC-6 database legs as owner, doctor and service role, on sealed (every write refused 42501, snapshot unchanged),
  draft (content writes admitted) and amending (content admitted; signature, status, delete, and for members the commands' columns refused) records.
- `tests/consultation/amendment-rpc.spec.ts` (flipped): the "no webhook" assertions become one `prescription.issued ...:signed:v2` row with `version: 2` in the data, `:v3` on the second
  cycle, nothing on replay, nothing after a faulted finalize.
- Payload `version` asserted in `sign-consultation-rpc.spec.ts`, `enqueue-webhook-rpc-db.spec.ts` (3 places) and `webhooks-outbox.spec.ts`.
- `tests/authz/table-matrix.ts` (regenerated `authz_matrix.test.sql`, `AUTHZ-MATRIX.md`): the prescriptions INSERT cell frees the fixture header and writes version 1; the UPDATE cell sets `letterhead_mode`.

### Counts

- pgTAP full run: 8391 tests, 57 files, all pass (FLOOR 8356 -> 8391: prescription_seal 33 + grants 1 + amendment_snapshot 1).
- Vitest affected folders at the 000108 tree (`tests/consultation billing api security jobs prescriptions audit ci integration authz clinical queue visits compliance patients`): 3871 tests in 192
  files, 4 failed (all exact-payload assertions that lacked `version`, fixed); re-runs of the six touched files, `tests/ci authz audit`: pass (127 + 555 tests).
- Final affected-folder Vitest run at the committed tree (`tests/clinical consultation visits queue security api integration billing jobs compliance patients authz ci prescriptions audit dpdp labs storage`): 3972 tests in 203 files, all pass, none retried.
- e2e lane (same command as 09A-01, after `npm run e2e:build`): 33 passed, 0 retries, the known-bug case still the expected failure.
- Latency (`evidence/command-latency.json`, 100 calls, local stack, node v24.13.0, 10 CPUs, `passed: true`): sign_consultation p50 2.7 / p95 3.6 / p99 5.4 ms; reopen_visit_for_amendment
  2.5 / 2.8 / 3.0; finalize_visit_amendment 2.7 / 3.3 / 5.5; complete_and_bill 4.0 / 4.4 / 4.5; complete_visit 1.9 / 2.4 / 4.1; baseline visits select 1.4 / 1.7 / 1.7. The 08-05 table had
  6.2 / 5.7 / 4.6 / 5.9 for the first four, so the guards did not slow them (the two runs are not the same load; both are far under the 150 ms target). One earlier attempt hit a Docker
  port-proxy glitch (`fetch failed`, the stack answered again after ~1 minute); it was re-run, and the failed run's leftover clinic was deleted as postgres.
- `npm run typecheck` clean; `npx eslint .` 0 errors; `npm run inventory` exit 0; schema snapshot PASS; `db:drift:local` PASS; `db:types` produced no diff (no table or column change).

### Notes for 09A-03..05

- 09A-03: the seal guard returns early for a visit that is not sealed, but R-12 binds the PDF pair on every path (set only while sealed: `RX_PDF_NOT_SEALED`; cleared only
  by a statement that raises `version`). The 000109 guard therefore needs a pair branch that also runs on a draft/amending visit; `finalize_visit_amendment` must clear the pair in the
  same UPDATE (the header row is updated while the visit is amending, so the seal guard does not engage there). Replace the `GRANT UPDATE` list (it is column-level now:
  `REVOKE UPDATE` then `GRANT UPDATE (pdf_storage_path, pdf_sha256, updated_at)`), and note `prescriptions_pdf_storage_path_shape` accepts only the canonical key.
  The generator still writes `letterhead_mode` (allowed until 000109 freezes it): the letterhead variant must stop being archived in the same plan.
- 09A-04: lab documents are not touched yet; `patient_documents_delete` and the lab storage policies are as in 000052/000058.
- 09A-05: `signSeededVisit` / `seedPrescription` exist in `tests/e2e/support/m0-data.ts`; the known-bug wrapper in `consult-rx-finish.spec.ts` is the only thing left to remove,
  and a note must be written to the visit's `clinical_notes` before `sign_consultation` (it refuses a visit with no diagnosis and no note). The doctor's workspace after a sign shows "Re-sign / Bill".
- `recordState` is not used by the workspace yet; the sealed/amending UI is 09A-05.
- Webhook consumers see `version` and a `:v<n>` key suffix from version 2 (documented in `docs/runbooks/jobs.md`).
