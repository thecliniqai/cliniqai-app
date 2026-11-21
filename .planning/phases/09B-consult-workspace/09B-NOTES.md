# V2-09b notes (executor record)

Branch `v2/phase-09b-consult-workspace`. Evidence is tool output (the run logs, `evidence/` at the close); nothing below is typed evidence. Counts are from the
runs named beside them.

## 09B-01 Save model: versioned draft, one save command, autosave, conflict prompt, unload guard (migration 000112_consult_draft_save)

### What changed

- `supabase/migrations/000112_consult_draft_save.sql` (`ls supabase/migrations | tail -3` showed 000111 as the newest, so 000112 was free; `EXPECTED_MIGRATION` is
  bumped in the same commit). Replaced bodies started from their latest definitions: `start_consultation` 000100:235, `private.log_command_audit` 000106:93,
  `private.audit_client_actions` 000109:312, `private.audit_metadata_keys` 000109:340.
  - `clinical_notes.draft_version integer NOT NULL DEFAULT 0` (CHECK >= 0) and `private.clinical_notes_version_bump` (BEFORE UPDATE, INVOKER, name sorts after
    `clinical_notes_guard`, so a sealed row is refused before any bump; a caller value is overwritten with old + 1).
  - `private.step_start_consultation(p_tenant_id, p_visit_id)`: the body of `start_consultation`, statement for statement; `start_consultation` now claims,
    calls the step and completes. Result keys unchanged (`visit_id, token_number, already_started, replayed`).
  - `public.save_consultation_draft(p_tenant_id, p_visit_id, p_expected_version, p_patch jsonb, p_client_request_id)`: definer, V2-07 pattern. Guard block, patch
    validation (keys, jsonb types, 256 kB, list sizes, vitals keys, provenance keys, follow-up shape and calendar date), claim (hash over visit, version and
    patch), visit lock (`FOR NO KEY UPDATE`) then notes lock (`FOR UPDATE`), `DRAFT_LOCKED` (sealed, or unsigned completed or cancelled), `DRAFT_CONFLICT`, then
    only the keys present: notes columns (vitals attribution moved into SQL: unchanged measurements keep the stored recorder, changed ones record the actor, a
    caller `recorded_by` is dropped), `visits.specialty` when it differs, provenance merged into `visits.metadata`, the visit's one follow-up (upsert, null
    deletes), the start step for a `waiting` visit when the caller also holds `appointments:edit` (a P0001 refusal of the step is swallowed in a
    sub-block, as the old best-effort start was; its writes roll back with it), audit `consultation.draft_save` (`fields_changed`, `draft_version`,
    `conflict_overwrite`), result `{visit_id, draft_version, started, replayed}`.
  - `follow_ups_one_per_visit` (partial unique index on `(tenant_id, visit_id) WHERE visit_id IS NOT NULL`).
  - Contract: `REVOKE UPDATE ON clinical_notes FROM authenticated; GRANT UPDATE (vitals)`; `REVOKE INSERT, UPDATE, DELETE ON follow_ups FROM authenticated`.
  - Audit lists: `consultation.draft_save` is command-only (`log_command_audit` accepts it, `audit_client_actions` and the TS `AUDIT_ACTIONS` lose it and
    `follow_up.record`); metadata keys `draft_version`, `conflict_overwrite` added (SQL and `AUDIT_METADATA_KEYS`). Reason codes `DRAFT_CONFLICT`,
    `DRAFT_LOCKED` (`RPC_REASON_CODES`: CONFLICT).
- App: `features/consultation/{draft.ts,draft-rebase.ts,draft-saver.ts}` (pure; injected clock and transport), `components/consultation/{use-consult-draft.ts,
  draft-conflict-dialog.tsx}`, `consultation-workspace.tsx` (wiring only), `features/consultation/{service,actions,schema}.ts` (`saveConsultationDraft` is the
  command client; `getConsultationDraft` is new; `recordFollowUp`, `attributeVitals`, `isDraftLocked` and the five-statement path are deleted), the page loader
  reads `draft_version` (`clinicalNotesEmbed(fields, withDraftVersion)`), `lib/db/types.ts` (`ClinicalNotes.draft_version`).
- Latency: `scripts/perf/command-latency.ts` gains the `save_consultation_draft` leg. Same file: the reopen and finalize legs archived nothing before the reopen,
  so since 09A-06a (`RX_ARCHIVE_PENDING`) every call failed and the script exited before reaching V2-08 (pre-existing, found when I ran it); they call
  `archiveRxAs` first now.

### Writer inventory (done before the grant narrowing)

`grep -rn "updateClinicalNotes\|from(\"clinical_notes\")\|from(\"follow_ups\")" app features lib components` before the change:
- `clinical_notes` writers: `features/consultation/service.ts` (the draft, deleted), `features/visits/service.ts:600` (`recordVisitVitals`, vitals only, keeps
  its privilege), `lib/db/clinical-notes.ts` (the helper). Reads only: the consult page, `payload.ts`, `features/today/queries.ts`, DPDP export, history.
- `follow_ups` writers: `features/consultation/service.ts` (`recordFollowUp` and the draft's delete; both deleted). Reads: the consult page, the Rx PDF payload.
- SQL writers (`grep -n -i "update public.clinical_notes|insert into public.follow_ups|delete from public.follow_ups|update public.follow_ups"` over the
  migrations): none after 000053 (the notes row is created by the visits trigger; 000077, 000078, 000111 only read follow-ups). The v1 API routes use the
  service role and do not touch either table. No job writes either.
- So both revocations went in. `visits` UPDATE for authenticated stays `(specialty, metadata, updated_at)` (000103): nothing on a request path uses it any more
  (the draft command is a definer), a later contract plan can narrow it.

### Affected-test grep (09B-PLAN shared rules) and the fixes

`grep -rln "saveConsultationDraft\|recordFollowUp\|clinical_notes\|follow_ups\|ConsultationWorkspace\|consultation-workspace\|searchDiagnoses\|ReturningPatientCatchup\|getPatientCatchUpSummaryAction\|AiScribeModal\|SignAndBillModal\|duration_val" tests supabase/tests scripts`,
narrowed to what 09B-01 touches (the Smart Assist and catch-up names belong to later plans). Callers of the old action signature moved to the new input through
`tests/helpers/consult-draft.ts` (`saveDraftAs(ctx, visit, patch)`, `saveLegacyDraft` for the old object shape; both read the current `draft_version`):
`integration/{consultation-flow,consultation-service-guards,cabin-consultation-launch,delete-paths,prescription-versioning}`, `security/{review-fixes-app,
review2-fixes-db,review3-fixes-db,cross-tenant-refs,p0-01-forged-overrides}`, `labs/lab-documents`, `billing/collect-permission`, `jobs/enqueue-webhook-rpc-db`,
`consultation/{sealed-refusal-messages,workspace-review-fixes}`; `security/guard-manifest.ts` and `guard/valid-inputs.ts` (recordFollowUp gone, getConsultationDraft
added, new draft input). Specs whose meaning changed with the grants: `security/ac6-rewrite-signed-rx` (a member's direct note and follow-up writes are refused by
privilege in every state; the draft command is asserted instead, DRAFT_LOCKED on the sealed record; the follow-up writes run update, delete, insert for the
one-per-visit index), `security/role-rls` (a receptionist's note update is 42501, vitals matches 0 rows), `consultation/record-state-parity` (the owner leg writes
`vitals`), `integration/delete-paths` (a patch must name `follow_up: null` to clear it), `authz/table-matrix{,.spec}` (follow_ups INSERT, UPDATE, DELETE become
rpc_only; `npm run authz:gen`), `security/guard-canary` with `lint-fixtures/p0-13-leg3/actions.ts` (the deliberately defective canary inserted follow-ups as the
member; it inserts a diagnosis now, the planted-row detector still plants a follow-up with the FK triggers off). pgTAP files that write notes or follow-ups as a
member widen the two grants inside their own transaction, as 09A-06a did: `amendment_snapshot`, `clinical_notes`, `clinical_seal`, `composite_fks`,
`delete_rules`, `visit_integrity`; `composite_fks` clones the three follow-up cases onto a free visit; `clinical_seal` probes the follow-up insert as an upsert;
`definer_functions` registers the two functions. Test files that only read `clinical_notes` or write as the service role needed nothing.
`no-client-command-chains` now scans `components/consultation` (see Tests).

### Deviations from the plan, with reasons

1. **Tracer order.** The tracer spec was written first and run RED against the old build (before any migration): both cases failed (0 saves while typing for 12 s;
   no "saved" within 9 s). The slice itself was not built note-only: the migration is one file with the whole command, so the command, service, saver and
   workspace wiring landed in one commit (`2e27820`) after the proof. The proof is recorded here, not as a red commit.
2. **`page.clock` is not used.** `tests/e2e/support/clock.ts` records that Playwright's fake `Date` breaks `TZDate`, which the consult renders; the kill-the-tab
   and cadence specs use real time (about 6 s and 17 s). The saver's own timing is covered with a fake clock in `draft-saver.spec.ts`.
3. **`conflict_overwrite` is a patch key** (boolean, audited, written to no table). R-3 names the audit field but no source for it; the smallest one that keeps the
   five-argument signature. It is part of the hashed patch.
4. **`finalize-amendment-dialog.tsx` and `sign-and-bill-modal.tsx` are unchanged.** Their props (`onBeforeFinalize`, `onSaveDraftBeforeSign`) already take a
   `() => Promise<{success, error?}>`; the workspace's `handleSaveDraft` now does `updateDraft(currentFields)` then `flush()` and maps a failed, offline,
   conflicting or locked result to that shape with fixed texts. Both stop on a failed save, as before.
5. **Defaults kept, not invented.** An empty patch is `INPUT_INVALID`. `DRAFT_LOCKED` carries `SIGNED_CONSULTATION_MESSAGE` for every locked state (sealed,
   unsigned completed, cancelled), as `isDraftLocked` did. The preselected 5-day follow-up is not sent on mount: the workspace hands the saver the draft only after
   the doctor changes something (compared with the first render), and "Save draft", Ctrl/Cmd+S and Sign always hand it over, so the v1 behaviour (the default
   follow-up is saved with the first save or the sign-off) is kept without a save at page open.
6. **Provenance is not in the client draft.** The page never read `visits.metadata` and nothing edits the AI provenance in this plan (the scribe leaves in 02a), so
   the saver does not carry it; the command accepts it for V2-12.
7. **A fixed-width SaveStatus slot.** The first e2e lane run failed `amendment-screens` B-1 (the "Edit vitals" click missed): the status text appearing after the
   blur-triggered save grew the wrapping header by a row between mouse down and up. Root cause, not a retry; the status sits in a `md:min-w-40` slot now.
8. **Unit tests of the workspace** (`workspace-sealed`, `workspace-review-fixes`) needed no change beyond the follow-up case: they render the new hook with
   `renderToStaticMarkup`.

### Tests added or changed (file: what)

- pgTAP `consult_draft_save.test.sql` (60): column default and CHECK; the bump as the owner, the service role and the nurse (authenticated), a caller value
  ignored, a sealed row refused first and unbumped; the column and follow-up grants; the unique index; command catalog and grants; save, audit row, stale
  version, only the keys present, replay, mismatch (visit-independent: version and patch varied), follow-up set/change/clear, a waiting visit started once,
  vitals attribution, the nurse's vitals write making a stale doctor save conflict, roles, another clinic, sealed/completed/cancelled DRAFT_LOCKED, amending
  admitted, eleven INPUT_INVALID cases, specialty and provenance, a fault after the notes write (all or nothing).
- `tests/consultation/draft-save-rpc.spec.ts` (36): the shared command rules (catalog, happy path with audit and data-only stored result, fault rollback and
  retry with the same id, replay, mismatch for the visit, the expected version and the patch, parallel saves, parallel same-id submits, role matrix, cross-clinic,
  locked states with the fixed text, input limits) and the service (`saveConsultationDraft`, `getConsultationDraft`).
- `tests/consultation/draft-saver.spec.ts` (26, fake clock and server), `tests/consultation/draft-rebase.spec.ts` (28: 24 merge cases plus the equality rules).
- `tests/e2e/consult/draft-persistence.spec.ts` (10): kill the tab, cadence, overlap with both choices, disjoint merge, the nurse's vitals, offline, lost once, lost
  on every attempt, the unload guard. `tests/e2e/pwa/05-cache-audit.spec.ts` (+1): a typed and saved note is in no storage API.
- `tests/ci/no-client-command-chains.spec.ts` (+1): `components/consultation` imports no removed writer; `addPrescriptionItem` only in the prescription builder and the
  workspace's Repeat Rx loop, a named exception owned by V2-09c (an entry that no longer matches fails the spec).

### Fails-without proofs (High controls)

- **The tracer** (`draft-persistence.spec.ts`, first two cases): red on the old build, 2 of 2 (`Received: 0` saves in 12 s of typing); green on the slice.
- **The version check** (migration with `IF v_notes.draft_version <> p_expected_version` replaced by `IF false`, DB reset, files re-run): pgTAP
  `consult_draft_save` fails 9 assertions (stale version, row unchanged, only-keys, replay, follow-up, the nurse's vitals); `draft-save-rpc.spec.ts` fails 5
  (stale, ahead, parallel saves, the nurse's vitals, the service mapping); the e2e overlap cases ("Use the other version", "Keep mine") fail (no prompt, a
  silent overwrite). The disjoint-field and nurse e2e cases pass without the check by design: the saver sends only changed fields.
- **The bump trigger** (`NEW.draft_version := OLD.draft_version`): pgTAP fails the bump assertions and most of the command section; the Vitest spec fails 12 cases.
- The migration was restored byte for byte (`diff` against a saved copy, `git status` clean) and the stack reset after each run.

### Counts (tool output of the runs named)

- pgTAP full run (`npm run test:pgtap`): 8554 tests, 61 files, all pass; `assert-pgtap-report.mjs` PASS at FLOOR 8554 (arithmetic in the gate header: 8494 + 60).
  The legacy files kept their plans (the follow_ups matrix cells are `rpc_only` but the cell count is unchanged).
- Vitest, affected: `tests/consultation tests/clinical tests/integration tests/security tests/visits tests/today tests/audit tests/authz tests/commands tests/ci`
  plus the other files from the grep (`tests/api/{v1-doctor-guard,v1-visits-no-clinical,readiness-probe-db}`, `billing/collect-permission`,
  `compliance/dpdp-rights`, `dpdp/export-dto`, `jobs/enqueue-webhook-rpc-db`, `labs/lab-documents`, `patients/visit-history`, `referrals/referrals-flow`):
  148 files, 2975 tests, all pass. The first run of the main set had 14 failures, all the grant and signature changes listed above, all fixed. Vitest FLOOR
  stays 6455 (REQUIRED_FILES gains the three new files; re-measured once at the close).
- e2e (`npm run e2e:build`, then `npx playwright test tests/e2e/consult tests/e2e/m0 tests/e2e/journeys tests/e2e/a11y/amendment-screens.spec.ts
  tests/e2e/a11y/sign-and-bill-screens.spec.ts tests/e2e/pwa/05-cache-audit.spec.ts tests/e2e/pwa/13-idempotent-retry.spec.ts --project=desktop-chrome --retries=0`):
  76 passed (8 auth setup, 68 specs) in 3.5 min, 0 retries, 0 failed, at the final tree. (`tests/e2e/journeys` holds journeys 1 to 5; journey 6 is 09B-05.)
  The first run of this lane had 75 passed and the one failure of deviation 7.
- `npm run typecheck` clean; `npx eslint .` 0 errors, 413 warnings (the baseline; my first count was 417, four unused names in the workspace, removed);
  `npm run inventory` exit 0 (0 flagged; `recordFollowUp` gone, `getConsultationDraft` added); `ci:ui-policy` and `ci:ai-l1` PASS; schema snapshot `--check` PASS
  (`--write` done once); `npm run db:drift:local` PASS.
- Latency (`npx tsx scripts/perf/command-latency.ts --calls 100`, local stack): `save_consultation_draft` p50 2.2 ms, p95 3.8 ms, p99 5.4 ms (condition: p95
  under 150 ms); `start_consultation` p95 3.0 ms after its body moved into the shared step. The JSON is not committed (evidence is produced at the close).

### Flakes and infra

- `amendment-screens` B-1 failed once in the first lane run: a real layout shift (deviation 7), fixed and re-run green (19 of 19 in the file).
- Two commits of the orchestrator (`60a9fd4`, `bc988bf`) landed on the branch while I worked; neither touches a file I changed.

### Notes for 09B-02a (the frame) and later

- The hook and its contract: `useConsultDraft({visitId, enabled, resetKey, serverFields, serverVersion, onRebased})` returns `{state, update, flush,
  resolveConflict, saveStatusProps}`. `enabled` is `!readOnly`; `resetKey` is today's `editorKey` (a new saver per record state). In the old workspace the block
  "The draft (V2-09b R-2 to R-5)" builds `currentFields` from the state variables, `serverFields` from the first render plus the visit's own follow-up, applies
  arrived fields (`applyArrived`) and feeds `update` from an effect once something differs from the first render. `consult-workspace.tsx` re-hosts that block.
- Fields of the draft (`DRAFT_FIELD_KEYS`): vitals, chief_complaints, clinical_notes, specialty_data, investigations_advised, advice, specialty, follow_up. The
  structured exam of 09B-03 lives inside `specialty_data` (`draftFieldEqual` compares it as a whole; a finer rebase needs a new key). The page passes
  `visit.draft_version`.
- Global listeners live in the hook: `focusout` (capture) saves a dirty draft, `visibilitychange` hidden, `pagehide`, `online`, and `beforeunload` only while
  `state.unsaved`. A new top bar must keep `SaveStatus` in a fixed-width slot from md up and keep `data-save-status` (the e2e specs read it).
- `handleSaveDraft()` returns `{success, error?}` for Sign & Bill, Finalize, "Save draft" and Ctrl/Cmd+S; the 09A amending contract (Save draft while amending) holds.
- Selectors the e2e specs use: the notes label "History of Present Illness & Clinical Notes", `[data-save-status="saved|offline|error"]`, the alertdialog named
  "This consultation was changed in another tab or device" with "Use the other version" and "Keep mine", the advice chip "+ Steam inhalation twice daily",
  "Edit vitals". Only selectors may change in 02a.
- `getConsultationDraft(visitId)` (consultations:view) is available for a resume refetch (PWA §3.8): it returns fields, version and the record state.
- The old specs that render the workspace server-side (`workspace-sealed`, `workspace-review-fixes`) import the hook, which imports the two actions: keep that
  import chain loadable under `vi.mock("next/navigation")` when the component is replaced.
- For the PO at the staging migrate (09B-P3): `follow_ups_one_per_visit` fails on a database that already holds two follow-ups for one visit. The app never wrote
  two, but check first: `select tenant_id, visit_id, count(*) from public.follow_ups where visit_id is not null group by 1, 2 having count(*) > 1`.
- Registries touched and current: `expected-migration.ts` 000112, schema snapshot, `types/database.ts`, `authz:gen` outputs, pgTAP FLOOR 8554 and REQUIRED_FILES,
  Vitest REQUIRED_FILES, `RPC_REASON_CODES`, `AUDIT_ACTIONS` / `COMMAND_ONLY_AUDIT_ACTIONS` / `AUDIT_METADATA_KEYS` with the SQL lists, the definer registry and the
  not-full-clinic classification in `definer_functions.test.sql`, the guard manifest and valid inputs.
