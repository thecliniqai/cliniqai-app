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

## 09A-03 Write-once, hashed prescription PDFs (migration 000109_rx_pdf_write_once)

### What changed

- `supabase/migrations/000109_rx_pdf_write_once.sql` (`ls supabase/migrations | tail -3` showed 000108 as the newest, so 000109 was free; the bodies replaced start from
  the latest definitions: `prescriptions_seal_guard` and `prescriptions_actor_guard` and `finalize_visit_amendment` from 000108, `audit_client_actions` from 000106,
  `audit_metadata_keys` from 000103 (the plan said 000100:152; 000103 is the latest). The line diff of each against its previous body is only what is named here).
  - `prescriptions.pdf_sha256 text` with `prescriptions_pdf_sha256_shape` and `prescriptions_pdf_hash_needs_path` (valid for every existing row).
  - `prescriptions_seal_guard` replaced: the 000108 seal rule is kept (letterhead_mode is now frozen with the rest), and the PDF pair has its own rules in EVERY state
    (the 000108 guard returned early for a draft or amending visit): NULL to a value once, only for a signed header of a sealed visit (`RX_PDF_NOT_SEALED`) at
    `<tenant>/<visit>/rx_v<version>.pdf` (`RX_PDF_PATH_INVALID`); an existing value never changes (`RX_PDF_WRITE_ONCE`) and is cleared only by a statement that raises
    `version` and clears both columns.
  - `prescriptions_actor_guard`: an INSERT carries no pair (`RX_PDF_NOT_SEALED`, every writer).
  - Grant replaced (REVOKE then GRANT): `UPDATE (pdf_storage_path, pdf_sha256, updated_at)`; `letterhead_mode` is set at INSERT only.
  - `finalize_visit_amendment`: the header UPDATE also sets `pdf_storage_path = NULL, pdf_sha256 = NULL`. The revision snapshot stores the whole header row
    (`to_jsonb(p)`), so the signed version's pair survives there without a snapshot change.
  - Storage: `prescriptions_rx_update` dropped; `prescriptions_rx_insert` replaced: prescriptions:edit AND a header named by the key's (tenant, visit, version) that is
    signed, has no hash, on a sealed visit. No DELETE policy exists for the class.
  - `private.audit_client_actions` gains `prescription.pdf_integrity_failed`, `private.audit_metadata_keys` gains `sha256` (TS lists in `lib/audit/audit.ts`).
- App: `lib/storage/supabase-provider.ts` (default `upsert` false); new `features/prescriptions/pdf/payload.ts` (`loadPrescriptionPdfSource`,
  `buildPrescriptionPdfPayload`: the one builder; the three private copies are gone); `features/prescriptions/pdf/generator.ts` (`renderPrescriptionPdf`,
  `archivePrescriptionPdf`, `readArchivedPrescriptionPdf`, `resolvePrescriptionPdf`, `isArchivable`, `prescriptionPdfPath`, `sha256Hex`;
  `generateAndArchivePrescriptionPdf` is removed); `app/api/visits/[id]/prescription-pdf/route.ts`; `features/prescriptions/service.ts`
  (`getPrescriptionPdfSignedUrl`); `features/consultation/service.ts` (`archiveSealedPrescriptionPdf` replaces `archiveInitialPrescriptionPdf`, reopen archives first,
  finalize archives the new version); `features/billing/service.ts` (calls the renamed function).
- Behaviour: sign-off, Sign & Bill and finalize archive after the commit with the caller's client, `upsert: false`; a duplicate object is adopted only while the header
  has no hash; a sealed Rx whose archive is missing is archived when it is opened; a draft, an open amendment, a print variant (another letterhead) and a header with no
  signature are rendered on demand (route `no-store`) and never stored; serving a sealed Rx downloads the object and compares its SHA-256, and on a mismatch (or a missing
  object) serves a fresh render of the sealed rows, audits `prescription.pdf_integrity_failed` and logs a tag.

### Deviations from the plan, with reasons

1. **Two guard rules the plan did not spell out.** (a) A first set of the pair also needs `NEW.signed_at IS NOT NULL` (a cancelled or never-signed header on a sealed
   visit cannot be archived either; the storage policy asks the same). (b) A statement that changes `version` must not carry a pair (`RX_PDF_PATH_INVALID`), so the
   pair is always the canonical key of the row's own version; without it the service role could raise `version` on an amending visit and keep the old path.
2. **Hash on a legacy path needs the canonical path too.** A legacy header whose path is not `<tenant>/<visit>/rx_v<its version>.pdf` (a v2 header still pointing at
   `rx_v1.pdf`) cannot be adopted (the pair is write-once and canonical): `isArchivable` is false for it and the Rx is rendered on demand. No v2 database holds real data (PO-15).
3. **`archivePrescriptionPdf(ctx, payload, buffer?)`**: the buffer is optional so a repeat that finds a recorded hash renders nothing (the plan's signature takes the bytes).
   `buildPrescriptionPdfPayload` takes `{ prescriptionId?, letterhead?, version? }` (the preview names a header; `version` makes a replay of a superseded command a no-op); the
   plan's `amendmentReason` option is not needed (the header's own `amendment_reason`, written by the finalize, is what the amended PDF prints). `loadPrescriptionPdfSource`
   also returns the header and the visit state the policy needs.
4. **Doctor name.** The route used the signed-in caller's name when the membership had none; the two service copies printed the literal "Doctor". The builder prints the
   membership's `full_name` for the visit's doctor and falls back to "Doctor", never the caller (the bytes must not depend on who opens the PDF).
5. **Canonical letterhead = the header's own `letterhead_mode`** (frozen once sealed). A request for the other letterhead, in either direction, is a variant. The route now
   honours `?letterhead=blank_paper` for a header stored as preprinted (it used to win). The preview (`getPrescriptionPdfSignedUrl`) returns the archive's 5-minute signed URL
   for the canonical case and `/api/visits/<visit>/prescription-pdf?letterhead=<mode>` (a same-origin relative URL) for the on-demand cases; for a header that is not the
   visit's latest it still names that header for the archive case, but the route URL always shows the latest one.
6. **Sealed Rx with a missing object and a recorded hash** is treated as an integrity failure too (audited, fresh render): the object cannot be re-archived because the pair is write-once.
7. **`archiveInitialPrescriptionPdf` renamed `archiveSealedPrescriptionPdf`**, its `onlyIfMissing` option dropped (the archive is idempotent: a header with a hash is left alone, so a replay and a first call take the same step).
8. `patient_document.delete` and the lab audit action stay in the audit allow-lists (see 09A-04); only `prescription.pdf_integrity_failed` and `sha256` were added here.

### Affected-test discovery (grep first), with the fix

`grep -rlE "pdf_storage_path|generateAndArchivePrescriptionPdf|buildVisitPdfPayload|prescription-pdf|rx_v" tests supabase/tests scripts` plus the full affected-folder Vitest run found:
- Callers of the removed `generateAndArchivePrescriptionPdf`: `tests/integration/prescription-versioning.spec.ts` (tests 3 and 4 now assert the sign-off archive, the 5-minute archive URL and the
  route URL for a variant), `tests/labs/lab-documents.spec.ts` (pure `renderPrescriptionPdf`), `tests/compliance/dpdp-rights.spec.ts` (the payload builder carries the statutory fields; the
  render is pure).
- Specs that faked "the first call died after the commit" by UPDATE-ing `pdf_storage_path` to NULL (now refused, a silent no-op that would have left the assertions failing for the wrong
  reason; this is the hazard 09A-01 warned about): `tests/consultation/sign-consultation-rpc.spec.ts` and `amendment-rpc.spec.ts` (the loss is simulated by calling the command alone, then
  the service replays), `tests/billing/complete-and-bill-rpc.spec.ts` (the replay leaves the archived Rx alone and re-renders the missing receipt; the Rx loss is covered by the sign spec and
  `rx-pdf-archive.spec.ts`, which call the same function).
- Fixtures that wrote a PDF path on an unsigned header: `tests/dpdp/export-dto.spec.ts` (sign through `signVisitAs`, then set the path), `tests/subscriptions/lock-enforcement.spec.ts`
  (`seedClinicalVisit` + `signVisitAs`), `tests/security/review-fixes-db.spec.ts` (AR-M1) and `review2-fixes-db.spec.ts` (AR2-H1): a signed visit of their own; the foreign or encoded paths
  are now refused by the seal guard (`RX_PDF_PATH_INVALID`, 42501) before the 000022 CHECK, which stays behind it.
- `tests/consultation/rx-seal.spec.ts` (letterhead_mode is no longer writable), `tests/observability/no-raw-error-logging.spec.ts` (the route no longer calls `auth.getUser`: the exception is
  thrown from the visit read), `tests/authz/table-matrix.ts` and `table-matrix.spec.ts` (rx INSERT and UPDATE are `none`),
  pgTAP `prescription_seal`, `grants`, `storage_policies` (+11), `authz_matrix` (regenerated).

### Tests added or changed (file: name)

- `supabase/tests/database/rx_pdf_write_once.test.sql` (28): 10 operations x 5 states (draft, sealed, sealed and archived, amending with its pair, sealed with a legacy path) x 9 roles
  (7 aggregate checks, each failing with the offending `operation/state/role => outcome`), the column and both CHECKs (shape, upper case, hash without a path with the guard off), the column
  grant, INSERT carries no pair, lifecycle through the commands (sign, archive once, a second archiver's `UPDATE ... WHERE pdf_sha256 IS NULL` matches no row, reopen, finalize clears the pair,
  the snapshot holds the v1 pair, the old key cannot be written back onto version 2, version 2 is archived once, its hash cannot be replaced). Red on 000108 (the file errors on the missing column).
- `supabase/tests/database/storage_policies.test.sql` section 2b (11): draft and amending refused, sealed unarchived admitted for the doctor and the owner, a future version, an archived header,
  a nurse, another clinic and a key with no visit refused, no DELETE; the catalogue loses the rx UPDATE policy; the two old rx cases change. Red on 000108 (1, 10, 11 fail and the file errors on the column).
- `tests/prescriptions/rx-pdf-archive.spec.ts` (15): "stores the PDF at the canonical key, records its SHA-256 (equal to the stored bytes), and audits it"; "a second archive is a no-op"; "a draft
  visit: a render, no object, no pair; the preview link is the route's"; "a sealed visit at another letterhead: a render, the archive and the header are untouched"; "a sealed Rx whose archive was
  lost is archived once when it is opened"; "an object that exists with no recorded hash ... is adopted"; "a legacy header ... gets its hash recorded on the first read"; "keeps rx_v1.pdf and
  its hash, snapshots them, clears the pair on the header until rx_v2.pdf is archived, then records its own hash"; "the service path (reopen, finalize) archives the signed version first and
  the amended version after"; "upsert, update and remove of an archived object fail"; "a PDF cannot be planted ahead of the seal ..."; "another clinic's member cannot plant"; "the PDF route returns
  the archived bytes: their SHA-256 equals the stored hash"; "a tampered object ... is never served"; the pure render.
- `tests/security/ac6-rewrite-signed-rx.spec.ts` storage legs (+7): sealed and amending, as owner and doctor, upsert/update/remove fail and the bytes and hash are unchanged, planting at the next
  version and at a draft's key fails; the service role cannot move, change or clear the recorded pair (`42501`).
- `tests/storage/storage-provider.spec.ts` (+1): the provider writes once by default and upserts only when asked. `tests/consultation/sign-consultation-rpc.spec.ts` (+1: a first call signs and
  archives once, the replay does not repeat it). `tests/e2e/m0/consult-rx-finish.spec.ts` (first test): the stored `pdf_storage_path` is `rx_v1.pdf` and `pdf_sha256` equals the SHA-256 of the bytes
  the route served and of the stored object (read from the database).
- Fails without the migration (previous migration set, 000108; the rest of the tree unchanged): pgTAP `rx_pdf_write_once` errors on the missing column; `storage_policies` fails 1, 10, 11 and errors on
  the column; Vitest `rx-pdf-archive.spec.ts` 13 of 15 fail (the two that pass do not depend on the migration), AC-6 storage legs 7 of 7 fail, the rx class of `storage-policies-jwt.spec.ts` fails.
  The DRAFT-planting cases of the storage legs do not depend on the new column and fail on the policy alone (an upload under a draft's final key succeeds on 000108).

### Counts

- pgTAP full run: 8430 tests, 58 files, all pass (FLOOR 8391 -> 8430: rx_pdf_write_once 28 + storage_policies 11; the arithmetic is in the gate header).
- Vitest affected folders (`tests/prescriptions storage consultation security audit api ci integration labs compliance billing dpdp subscriptions pwa observability referrals authz`): 3761 tests in 180
  files, 8 failed (the specs listed above: 7 behaviour changes and the readiness probe, which only failed because the 000110 file already sat in the tree), all fixed and re-run green; the last
  full affected run at the final tree is in 09A-04 (163 files, 3514 tests, 0 failed).
- `npm run typecheck` clean; `npx eslint .` 0 errors (413 warnings; the two warnings this plan introduced, unused imports in `features/consultation/service.ts`, were removed); `npm run inventory` exit 0
  (0 flagged); schema snapshot `--check` PASS; `npm run db:drift:local` PASS; `db:types` adds `pdf_sha256`; `authz:gen` regenerated.
- e2e: see 09A-04 (one lane for both plans).

### Notes for 09A-04..05

- 09A-05: `getPrescriptionPdfSignedUrl` returns a relative route URL for a draft, an amending visit or a variant; the PDF preview modal puts it in an iframe and `window.open`, which works because the
  route is same-origin. While a visit is amending, "Print Rx" renders the current rows on demand (version 1 label, no archive); after finalize it is the archived v2.
- 09A-05: the `finalizeVisitAmendment` service archives version 2 before it returns, so the e2e can read `rx_v1.pdf` and `rx_v2.pdf` and their hashes from the database right after the UI action; a
  command-only finalize (RPC) leaves the header with no pair until the next open or archive.
- 09A-05: the WhatsApp share link for a prescription resolves the stored `pdf_storage_path`; between a finalize and the v2 archive (a few hundred ms in the same request) the link has no object.
- Residual risks (T-09A-06, recorded): a prescriptions:edit holder can archive a forged PDF in the window between the seal and the archive; the service role bypasses storage RLS and could overwrite an
  object (it is never used in a request path, and the hash check on read catches it, `rx-pdf-archive.spec.ts`); no digital signature (integrity after archive, not authenticity of origin).

## 09A-04 Lab documents are append-only (migration 000110_lab_documents_append_only)

### What changed

- `supabase/migrations/000110_lab_documents_append_only.sql` (`ls supabase/migrations | tail -3` showed 000109 as the newest, so 000110 was free).
  - `DROP POLICY patient_documents_delete`; `REVOKE DELETE ON public.patient_documents FROM authenticated`.
  - `private.patient_documents_no_delete` + trigger `patient_documents_no_delete` (BEFORE DELETE FOR EACH ROW, INVOKER, `search_path ''`, EXECUTE revoked): `LAB_DOCUMENT_DELETE_FORBIDDEN` (42501) for every
    writer including the service role and postgres; the one exception is R-4a (a writer with no session when the clinic's `tenants` row is gone: the tenant purge and the run teardown). The visit FK's
    `ON DELETE SET NULL` is an UPDATE and is unaffected (pgTAP case).
  - `DROP POLICY clinic_records_lab_update` and `clinic_records_lab_delete` on `storage.objects`. SELECT and INSERT, and the receipt, referral letter and Rx classes, are untouched.
- App: `deleteLabDocument` is gone from `features/labs/service.ts` and `actions.ts`, with `DeleteLabDocumentResult`, its row in `tests/security/guard-manifest.ts`, and in
  `components/patients/patient-lab-documents.tsx` the Delete button, the confirmation dialog and its state; a note under the list says "Uploaded documents are part of the patient's record and cannot be
  removed." Uploads and signed links are unchanged.
- **Q-5 settled with the plan's default**: nobody can delete a lab document, including the owner, until V2-11's documents UI adds a void (reason, `voided_at`, share tokens revoked in the same
  transaction, hidden by default). A wrong-patient upload therefore stays on that patient's record until then (T-09A-11, accepted); the PO is to confirm at the gate (`09A-P2`).

### Deviations from the plan, with reasons

1. The `patient_document.delete` audit action stays in `AUDIT_ACTIONS` and in `private.audit_client_actions()`: nothing writes it any more, and removing it needs a migration with no benefit
   (the allow-list parity spec compares the two). Clean it with the next migration that touches the list.
2. `delete_rules.test.sql` needed the catalogue row removed (`patient_documents_delete`), not the plan's "extend"; the tenant-purge section of that file already covers the cascade of documents.
3. The "removed member would otherwise be admitted" sanity bound in `tests/authz/table-matrix.spec.ts` went from 100 to 90 (the live cells fell below 100 with the Rx and lab cells that became `none`; the bound only keeps the denial from being vacuous).
4. `tests/observability/no-raw-error-logging.spec.ts` lost its labs write case with the function; `generateDocumentShareToken` takes its place (same assertions: fixed result, one tagged line, no raw text).

### Affected-test discovery (grep first), with the fix

`grep -rn "deleteLabDocument\|patient_documents.*delete\|Delete document\|Delete Permanently" app components features lib tests scripts docs` found:
- `tests/labs/lab-documents.spec.ts` ("Tenant B cannot delete Tenant A documents": the row delete by tenant B's JWT is refused 42501 and the row stays), `tests/security/review2-fixes-db.spec.ts` (AR2-L5
  rewritten: owner and doctor refused 42501, the service role refused by the trigger, row and object remain, no `patient_document.delete` audit row; the foreign-key-never-passed-to-storage case is
  removed with the function), `tests/security/no-raw-error-responses.spec.ts` (the case is removed), `tests/observability/no-raw-error-logging.spec.ts` (replaced, see above),
  `tests/security/guard-manifest.ts` (row removed; `npm run inventory` exports 122 -> 121, 0 flagged), `tests/e2e/a11y/lab-reports-screens.spec.ts` (new case at 360, 820 and 1280: an uploaded
  document is listed with View and Share, the record note is shown, no Delete control and no dialog; axe baseline check as for the other cases).
- `docs/v2/SECURITY_ASSESSMENT.md` mentions the old action as a finding (history, left as is).
- "No Delete control or delete code path remains": `grep -rn "deleteLabDocument\|Delete Lab Document\|Delete Permanently\|handleDeleteConfirm" app components features lib tests/security/guard-manifest.ts`
  returns nothing; `patient_document.delete` appears once, as an allow-listed audit action string (`lib/audit/audit.ts`, deviation 1).

### Tests added or changed (file: name)

- `supabase/tests/database/lab_documents_append_only.test.sql` (24): catalogue (policies, privilege, trigger, function shape, storage class), DELETE as all nine roles (nobody deletes; the request path by
  privilege, the service role and postgres by `LAB_DOCUMENT_DELETE_FORBIDDEN`; a bulk DELETE too), controls (a nurse inserts, a doctor updates, a receptionist updates nothing), storage (nurse and doctor
  upload new objects, nobody updates or deletes one, the doctor still reads), R-4a (negative while the clinic exists, purge as postgres and as service_role), the visit FK's SET NULL.
  All 24 fail on 000109 (catalogue cases and the DELETE matrix).
- `tests/labs/lab-documents-append-only.spec.ts` (11): a doctor and a nurse still upload (row, object, signed link); owner, doctor, nurse, receptionist and another clinic's owner cannot delete a row
  (42501, the row stays); owner, doctor and nurse cannot remove, upsert or update an object (bytes unchanged); the service role's DELETE is refused by the trigger; deleting a clinic as the service
  role cascades through its documents. 9 of 11 fail on 000109 (the upload control and the purge pass, as they should).
- `tests/authz/table-matrix.ts` / `table-matrix.spec.ts`: patient_documents DELETE is `rpc_only`; the lab storage class has no UPDATE and no DELETE (`none`); `authz:gen` regenerated the pgTAP matrix and AUTHZ-MATRIX.md.

### Counts

- pgTAP full run: 8454 tests, 59 files, all pass (FLOOR 8430 -> 8454: lab_documents_append_only 24).
- Vitest affected folders at the 000110 tree (`tests/labs security observability storage ci authz dpdp compliance api prescriptions consultation integration billing clinical`): 3514 tests in 163 files, all pass, none retried.
- e2e (after `npm run e2e:build`): `npx playwright test tests/e2e/m0 tests/e2e/a11y/lab-reports-screens.spec.ts tests/e2e/a11y/sign-and-bill-screens.spec.ts tests/e2e/journeys/journey-09-clinic-isolation.spec.ts
  --project=desktop-chrome --retries=0`: 36 passed in 50.4 s, 0 retries; the P1-03 known-bug case is the expected failure until 09A-05. Only desktop-chrome was run (instruction: one lane).
- `npm run typecheck` clean; `npx eslint .` 0 errors (413 warnings, none new); `npm run inventory` exit 0 (0 flagged, 121 exports); schema snapshot `--check` PASS; `npm run db:drift:local` PASS.

### Notes for 09A-05

- Nothing in 09A-04 touches the consultation workspace. The workspace's "Print Rx" and the sign modal's PDF link use the route, which serves the archive for a sealed Rx and a render otherwise.
- A lab document can no longer be deleted by tests either: a fixture that needs to remove one must delete the clinic (the cascade is allowed) or use a unique patient per case.
- `tests/e2e/a11y/amendment-screens.spec.ts` (09A-05) can reuse the `check()` pattern of `lab-reports-screens.spec.ts`.

## 09A-05 Amend from the workspace; journey 6 (no migration)

### What changed

- `features/consultation/record-state.ts`: now also holds `SIGNED_CONSULTATION_MESSAGE` (moved out of `consultation/service.ts`, same text) and `isSealedRefusal(err)` (SQLSTATE 42501 plus one of the nine fixed guard
  names; a plain privilege error is not one). The diagnosis (add, remove, note), Rx item (add, remove, the header insert) and follow-up services answer a sealed refusal with the fixed text and never the driver message (R-17).
- `app/(dashboard)/consultation/[id]/page.tsx`: also selects `signed_at`, `current_revision`, the latest header's `version` and, only while amending, the latest `visit_revisions.amendment_reason`; passes `canAmend`
  (consultations:edit, prescriptions:edit and appointments:edit, i.e. owner and doctor: the two commands check all three).
- `components/consultation/consultation-workspace.tsx`: `state = recordState(visit)`. Read-only = sealed, or a visit completed unsigned, or cancelled. `disabled` goes to the vitals block, the complaints and notes, the three specialty
  panels, the diagnosis section, the Rx builder, the investigation and advice chips and inputs, the follow-up chips and inputs, the specialty selects and the attachment input; the AI catch-up is hidden and the history drawer's Repeat Rx
  and Copy notes are not passed. Sealed: chip "Signed {clinic-zone date, time} · Rx v{n}", WhatsApp, Print Rx, Receipt and Amend. Amending: a `Banner` "Amending a signed consultation (v{n} to v{n+1}): {reason}", Save draft and
  Finalize amendment, no Complete and Sign. Draft: unchanged. `prescription-builder.tsx`: the Protocol Templates button is disabled and the save-as-template row is hidden when `disabled`.
- `components/consultation/amendment-modal.tsx` rebuilt on the V2-06 `Dialog` (same props; reason 10 to 500 characters with the counter, `useCommand`, `Alert` for the error, the UI-SPEC strings kept; the discard guard asks before a typed
  reason is thrown away). New `components/consultation/finalize-amendment-dialog.tsx`: the confirmation for `finalizeVisitAmendment` (saves the form first, stops if the save fails, `useCommand`, `router.refresh()` on success).
- No migration, no registry change except `scripts/ci/assert-vitest-report.mjs` REQUIRED_FILES (+2 specs; FLOOR unchanged, re-measured once at the close). The waiver file did not change.

### Deviations from the plan, with reasons

1. **"Re-sign / Bill" is deleted, not renamed.** `complete_and_bill` on a signed visit has one billing-only branch (a visit this same user signed that has no live invoice resumes at billing), but the app never reaches it: Sign & Bill
   always creates the invoice, so a signed visit either has one (ALREADY_BILLED) or was signed by someone else (ALREADY_SIGNED). The modal is titled "Complete & Sign", so offering it on a signed visit would mislead. Billing a signed visit
   stays at the desk (checkout); the Receipt link remains.
2. **Read-only for unsigned completed and cancelled visits too.** The plan names the sealed state; R-11 says an unsigned completed visit is terminal and read-only in the app, and `isDraftLocked` already refused its saves. Its inputs were
   live before (the save failed afterwards); they are disabled now. A cancelled visit shows no Complete and Sign or Save Draft (it showed them before).
3. **Banner tone.** `Banner` has three tones (trial, past-due, offline); `past-due` (warning) is the nearest, used with `role="status"` and a pencil icon. A dedicated amendment tone would be a V2-09b design-system call.
4. **The finalize confirmation is a `Dialog`, not a sheet** (the plan allows either): a short confirmation, like the amendment dialog. "Print Rx" is not offered while amending (the plan's amending action list has none; the PDF of a draft or open
   amendment is an on-demand render, so it stays reachable from the preview elsewhere).
5. **Signed version shown.** The chip and the banner use the header's `version` when there is a header, else `current_revision` (+1 when sealed); an Rx-less consultation shows no "Rx v" part in the chip.
6. **Accessibility baseline.** `/consultation/[id]` is the v1 workspace V2-09b rebuilds and carries M0 baseline debt. The amendment-screens spec therefore asserts ZERO serious/critical violations on the new surfaces (header and chip, the
   dialogs, the banner, scoped with `include`) and, for the page as a whole, no rule id outside the M0 baseline (the rule of the other consult screens). While doing it: the WhatsApp Rx & Bill button was white on emerald-600 (failed
   color-contrast at 820 and 1280): now emerald-700; the mobile specialty select had no name: `aria-label`; the header action buttons and the two specialty selects are 44 px; the icon-only Save draft has a name.
7. **Fixtures.** The e2e fixture had already moved to `signSeededVisit` in 09A-01 (deviation 6 there); this plan adds `seedSignedConsultation(label)` (waiting visit, note, one unsigned item, the doctor's `sign_consultation`; every service-role
   write error-checked, the note write must affect exactly one row) and uses it in the plain P1-03 test, the journey and the screens. The command-only sign leaves no archive; the reopen archives `rx_v1.pdf` first as the signer
   (09A-03). The journey's subscription is created after the seed sign, so only the `...:signed:v2` event is expected.

### Grep (before and after)

- `grep -rn 'knownBug("P1-03"' tests app components features lib docs scripts` returns nothing (the word survives in the 08 verification note and the plan text, which are history). `knownBug` itself stays (register-patient, the matcher spec).
- `grep -rn "Re-sign" app components features tests docs` returns nothing.
- `grep -rln "AmendmentModal\|amendment-modal"`: the workspace only (the modal had no consumer before).
- Callers of the three services whose refusal text changed: the diagnosis, prescription and follow-up actions and `saveConsultationDraft` (which ignores the follow-up result: a sealed visit is refused earlier by `isDraftLocked`).

### Tests added or changed (file: name)

- `tests/consultation/sealed-refusal-messages.spec.ts` (9): a signed consultation answers add and remove diagnosis, edit a diagnosis note, add and remove a medication and change the follow-up date with `SIGNED_CONSULTATION_MESSAGE`, rows unchanged;
  `isSealedRefusal` ignores a plain privilege error; the same writes succeed on a draft and on a reopened visit (controls).
- `tests/consultation/workspace-sealed.spec.ts` (9): the workspace rendered with react-dom/server from real props, asserting the markup's own attributes. Draft: inputs live, Complete and Sign, no Amend. Sealed: notes, medicine search, diagnosis
  search, remove control, every investigation, advice and follow-up chip, the custom inputs, the specialty selects and Protocol Templates disabled; signed chip "Signed 15 Jan 2031, 3:42 pm · Rx v1" for 10:12Z (clinic zone); Print Rx, WhatsApp, Receipt
  present; Complete and Sign and Re-sign / Bill absent; Amend for a user who may amend and not for one who may not (nurse). Amending: banner "(v1 to v2): reason" (a second amendment "v2 to v3"), editable, Save draft and Finalize amendment, no Complete and
  Sign, no Amend. Unsigned completed: read-only, no Amend.
- `tests/e2e/m0/consult-rx-finish.spec.ts`: the second test is a plain test (no `knownBug`): medicine search, "Remove medication", notes, diagnosis search disabled, no vitals editor, no Complete and Sign, chip "Rx v1", Amend visible. New
  "journey 6 tail" test: Amend, confirm disabled at 9 characters and enabled at 10+, banner with the reason, add a medicine, Finalize amendment (dialog), chip "Rx v2", then from the database: status `completed`, `signed_at` changed; ONE
  `visit_revisions` row (number 1, the reason, `captured_by` database, `prescription.version` 1 with the v1 item and the v1 PDF pair); the same header at version 2 with both items; one `visit.reopen_for_amendment` and one `visit.amend_finalized` audit
  row; one `prescription.issued` outbox row `...:signed:v2` with `version: 2`; `rx_v1.pdf` and `rx_v2.pdf` each downloaded and hashed (the v1 hash equals the snapshot's, the v2 hash equals the header's, they differ); the route returns `%PDF-`
  whose SHA-256 equals the stored hash. The first test's text is unchanged.
- `tests/e2e/a11y/amendment-screens.spec.ts` (9 = 3 screens x 360, 820, 1280): sealed workspace; amend dialog (keyboard open, focus lands on the reason, Escape asks before discarding a typed reason, Escape closes and focus returns to Amend, a keyboard press
  on the confirm button reopens); amending banner, header buttons at least 44 px, the finalize confirmation (keyboard, Escape, focus return). Axe as in deviation 6.

### Acceptance items to tests

- Known-bug e2e becomes a plain assertion: `consult-rx-finish.spec.ts` second test (desktop-chrome, pixel-7); grep clean.
- Journey 6 tail (sealed read-only, the amendment needs a justification) and T-08: the journey test (desktop-chrome, pixel-7), `workspace-sealed.spec.ts`.
- An amendment creates a new version with an audit row, from the UI: the same journey reads the revision, the version 2 header, both audit rows and the event from the database.
- PDFs write-once and hashed, from the UI: the journey checks both objects and hashes and the served bytes.
- Amendment dialog on the V2-06 `Dialog` (07 hand-off, 06-08 row): `amendment-screens.spec.ts`, the journey.
- Messages (task 5): `sealed-refusal-messages.spec.ts`.

### Counts

- Vitest affected folders (`tests/consultation prescriptions terminology components ui design ci security clinical integration`; `terminology` and `ui` do not exist as folders): 2919 tests in 120 files, all pass, none retried. `tests/ci/vitest-report-gate.spec.ts` (9) passes with the new REQUIRED_FILES.
  Before the first full run the two new specs ran alone: 9 and 9 pass.
- e2e after `npm run e2e:build`: `npx playwright test tests/e2e/m0 tests/e2e/a11y/amendment-screens.spec.ts tests/e2e/a11y/clinical-split-screens.spec.ts tests/e2e/a11y/sign-and-bill-screens.spec.ts --project=desktop-chrome --project=pixel-7
  --project=iphone-15 --retries=0`: 59 passed in 1.5 min (8 auth setup, 51 specs: desktop-chrome 39, pixel-7 10, iphone-15 2, as each project's testMatch selects), 0 retries, 0 failed. The journey ran on desktop-chrome and pixel-7 (the projects the plan names).
  The same spec file had one failure in my first runs, both mine and both real: the journey's event assertion expected the v1 key although the subscription came after the seed sign, and the sealed-screen axe found the white-on-emerald-600 WhatsApp label.
- `npm run typecheck` clean; `npx eslint .` 0 errors (413 warnings, unchanged; none new in files this plan created); `npm run inventory` exit 0 (0 flagged, 121 exports); `npm run ci:ui-policy` PASS and `npm run ci:ai-l1` PASS (no delta).

### Notes for the close and for 09A-06a / V2-09b

- 09A-06a (triage A-3): the e2e fixtures sign through the command only, so the first Amend reopens a visit whose signed Rx has no archive yet; the reopen service archives it first as the signer. If the fix round makes the reopen refuse
  with `RX_ARCHIVE_PENDING` unless the signer's self-heal worked, these fixtures stay valid because the doctor who signs is the doctor who amends; an owner amending a colleague's visit would be refused until the signer opens it.
- 09A-06a (R-A, S-5): the workspace's Print Rx link and the finalize hand-off assume the route serves the archive after finalize; keep `rx_v2.pdf` archived before `finalizeVisitAmendment` returns (the journey reads it from the database right after).
- V2-09b must keep `recordState`, the sealed read-only contract (every input disabled, Amend for owner and doctor) and the two flows (reopen with a 10 to 500 character reason, finalize with the form saved first) as its contract; the specs above are the check.
- The page now makes two extra reads (latest header version; the latest revision reason only while amending).
