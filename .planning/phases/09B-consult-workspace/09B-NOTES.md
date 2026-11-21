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

## 09B-02a Workspace frame: regions, sections, sealed contract, Sign & Bill sheet, cut-over (no migration)

09B-02b was executed in the same session on the same working tree, so the frame and the context panes landed together in one code commit (`8efcb69`; the
split is by file in the sections below). `ls supabase/migrations | tail -3` showed 000112 as the newest: neither plan adds a migration, `EXPECTED_MIGRATION`
is unchanged.

### v1 behaviour inventory (M4 criterion 1; V2-DX-R2-V1-CONSULT-ANALYSIS §3 and the deleted file)

| v1 capability | New home | Plan | Test |
|---|---|---|---|
| Vitals tiles, BMI, flags, record or edit vitals (`vitals-block.tsx`) | Examination section (body unchanged); a read-only grid with flags in the patient column | 02a, 02b (flags `assist.vitals`) | `amendment-screens` B-1 (`#vitals`), `workspace-layout` (vitals flags, grid) |
| 12 complaint chips, durations, custom complaint, per-complaint note, HPI textarea | Complaints section (body unchanged) | 02a; tiles and ranking 09B-03 | `workspace-sealed`, `workspace-review-fixes`, `draft-persistence` (notes) |
| PICCLE signs, systemic texts, dental odontogram, paediatrics tools | Examination section (bodies unchanged) | 02a; templates 09B-03 | `workspace-review-fixes` (all three specialties read-only) |
| Header specialty `<select>` (desktop and mobile copies) | One `NativeSelect` "Specialty" in Examination until the template tiles replace it (see deviation 2) | 02a; removal 09B-03 | `workspace-sealed` (disabled when sealed) |
| Diagnosis chips, search, custom, chronic, note, remove | Diagnosis section (body unchanged) | 02a; search route 09B-04a | `workspace-review-fixes`, `amendment-screens` |
| Medicine search, staging, presets, Rx lines, protocol templates, allergy warning in the builder, Repeat last Rx | Prescription section (builder unchanged; it now reports its items through `onItemsChange`, so the strip count, the summary and Sign & Bill's medicine count are live) | 02a; V2-09c | `consult-rx-finish`, `amendment-screens` |
| 14 investigation chips, 10 advice chips, custom test and advice | Plan section (tiles are `aria-pressed` toggles on the design-system tile look; texts verbatim, the "+ " and "✓ " prefixes kept) | 02a; catalogue 09B-03 | `draft-persistence` (advice tile), `workspace-sealed` (30 tiles disabled) |
| Follow-up interval chips, date, instructions, the 5-day default | Plan section (same state, same default; saved with the first edit, Save draft or Finish) | 02a | `workspace-review-fixes` B-5, `draft-persistence` |
| Referral card, create modal, print letter | Plan section | 02a | `workspace-review-fixes` (the referral stays available when read-only) |
| Attachments dropzone (a no-op) | Plan section, unchanged placeholder | 09B-05 | none (see Known stubs) |
| Allergy chip in the header and the amber alert card | The allergy strip (`AllergyBanner`, three states), sticky, on sealed records too | 02a | `workspace-layout`, `consult-screens` |
| Identity, token badge, status badge, UHID, phone | Top bar (compact identity as the page's `h1`, `TokenChip`, `StatusChip`) | 02a | `consult-rx-finish` (name in the `h1`), `design-review-09e` (one Back) |
| History drawer, Repeat this Rx, Copy notes | Patient column (1180 and up) and Patient sheet; same actions, clinic-zone dates | 02b | `workspace-layout`, `no-client-command-chains` (Repeat Rx exception) |
| Autosave text, Save Draft, Ctrl/Cmd+S | `SaveStatus` slot, "Save draft" (kept for the amending contract) | 09B-01 | `draft-persistence` |
| Complete & Sign (hand-rolled modal) | "Finish visit" opens the Sign & Bill `ResponsiveSheet` (same commands and copy) | 02a | `sign-and-bill-screens`, `consult-rx-finish`, `journey-08` |
| WhatsApp Rx & Bill, Print Rx, Receipt on a completed visit | A record bar at the top of the note (visible at every width) | 02a | `workspace-sealed` |
| Signed chip, Amend, amending banner, Finalize amendment | Same logic: chip and Amend in the top bar (Amend in the Finish bar on a phone), banner gains "opened {date}" | 02a | `workspace-sealed`, `amendment-screens`, `consult-rx-finish`, `consult-screens` |
| Section jump bar (7 anchors) | Section strip (phones) and Alt+1 to Alt+5 | 02a | `workspace-layout` |
| Returning-patient catch-up card (LLM) | Removed from the workspace; the patient column shows the last visit from `pastEncounters` until the snapshot of 09B-04a (the file and its action stay until then) | 04a | none |
| AI scribe modal | Removed with the v1 workspace (C37); `generateSoapAction` and `lib/ai/soap-generator.ts` untouched for V2-12 | V2-12 | `ai-labels` (the case that rendered the modal is deleted) |

### What changed

- New `components/consultation/workspace/`: `consult-workspace.tsx` (record state, draft hook, dialogs, section refs; the draft block of 09B-01 re-hosted
  verbatim), `consult-top-bar.tsx`, `allergy-strip.tsx`, `amending-banner.tsx`, `consult-section.tsx`, `section-strip.tsx`, `finish-bar.tsx`,
  `sections/plan-section.tsx`, `format.ts` (clinic-zone dates; the v1 history used the browser's zone).
- Layout: the root is the shell's `main` content at `100dvh - bar` from 768 px with `overflow-clip`; the header (top bar, allergy strip, strip) is sticky below
  768 and a fixed row above; the note scrolls on its own (`data-note-scroll`). Label column 96 px at 768 to 1179, 120 px from 1180 (custom property
  `--label-col`), one column and the label above the body below 768.
- `SignAndBillModal` moved onto `ResponsiveSheet` (`size="lg"`): the hand-rolled dialog and scroll lock are gone; Close on the success screen still goes to
  `/today?mode=doctor`; Escape and outside click are held while the sign-off runs.
- `app/(dashboard)/consultation/[id]/page.tsx`: `allergies` is passed as stored (`null` = not recorded, `[]` = none), `amendment_opened_at` (the latest
  `visit_revisions.amended_at`), the `assist` map (every `assist.*` key from `activeEntitlements()`, empty when the clinic is not `full`). `loading.tsx` is a
  skeleton of the new regions.
- Deleted: `consultation-workspace.tsx`, `ai-scribe-modal.tsx`. `PatientIdentityHeader` compact gains `nameHeading` (the consult's name is the page's `h1`,
  which `consult-rx-finish` and `design-review-09e` assert).

### Deviations from the plan, with reasons

1. **One Back control, in the shell's top bar.** R-7 lists "Back to My queue" in the consult top bar. `design-review-09e.spec.ts` (06-09e M1) asserts exactly one
   Back on the consult, in the shell's bar, and the shell's Back already returns to the queue through the in-app history; a second one would break an approved
   assertion. The consult bar has none.
2. **The specialty select stays, inside Examination.** The plan removes the header select in favour of the template tiles of 09B-03, which do not exist yet;
   removing it now would leave dentists and paediatricians no way to switch. It is a labelled `NativeSelect` (disabled when read-only) until 09B-03.
3. **"Finish visit" starts the flush and opens the sheet; it does not wait.** The sheet's own sign-off flushes again before the command, and a refusal
   (a conflict, a role that may not save) shows inside the sheet, which is what `journey-08` asserts for a nurse. Waiting first would have kept the sheet
   closed on a refusal and hidden the reason.
4. **Alt+n does nothing behind an open dialog or sheet** (the overlay holds focus); the plan says "always". Moving focus out of a modal would fight its trap.
5. **The sealed spec's tile selector** is `data-state` (the Plan tiles), not the old v1 class names; the assertion (every tile disabled, more than 20) is the same.
6. **Counts and summary use live state**: the builder's items (`onItemsChange`) feed the strip, the summary and Sign & Bill's medicine count (before, the
   Sign & Bill count was the page's stale `prescription_items.length`).
7. **The e2e a11y consult specs run desktop-chrome only** (the config ignores `a11y/` on the other projects); the widths are set in the specs.
8. A Chromium quirk cost two iterations and is recorded here for 09B-03: sticky section labels inside the scrolling note added their range to the *document's*
   scroll height, so `scrollIntoView` scrolled the page under the fixed header. The note container is `relative` now. Separately, Tailwind v4 orders
   `min-[1180px]:` before `md:`, so two classes that set the same property at both breakpoints resolve to `md:`; the label column uses one custom property
   and non-overlapping ranges, and `max-[1180px]:` means `< 1180px`.

### Known stubs

- The Plan section's attachment dropzone is the v1 no-op placeholder (`components/consultation/workspace/sections/plan-section.tsx`, "Upload lab report or
  radiograph"); 09B-05 builds `FileDrop` and the upload. (`.planning/WINDOWS.md` does not exist in this repo, so the broken-windows ledger entry was not written.)

### Tests added or changed (file: what)

- `tests/e2e/consult/workspace-layout.spec.ts` (new, 17 tests, `@golden`): 360 px strip, Finish bar, allergy strip and no BottomBar; the allergy strip after
  scrolling to Plan at 360 and 1280; the strip follows the scroll; Alt+1 to Alt+5 at 360, 820 and 1280, in the note field too; the section order; label
  columns 120, 96 and stacked; no horizontal scroll at 360, 375, 744, 800, 820, 1180, 1280 (also scrolled to Plan); every frame control at least 44 px at 360, 744
  and 820 (the 02b cases are listed below).
- `tests/e2e/a11y/consult-screens.spec.ts` (new, 16 tests): zero serious or critical axe violations on the **whole page, with no M0 baseline allowance**, for the
  draft, the sealed record, the amending record and the Sign & Bill sheet open, at 360, 820, 1180 and 1280, plus no horizontal scroll.
- Re-pointed (selectors only): `workspace-sealed`, `workspace-review-fixes`, `consult-rx-finish`, `amendment-screens`, `sign-and-bill-screens`, `v2-01-screens`,
  `clinical-split-screens`, `journey-08`, `baseline-routes`, `no-client-command-chains`, `ai-labels`, `g3-screens.json` (comment).

### Counts

See the end of the 09B-02b section (one e2e lane covers both).

## 09B-02b Context panes, history, shortcuts, tablet layouts (no migration)

### What changed

- `patient-context.tsx` (shared content), `patient-column.tsx` (264 px, `surface-soft`, right hairline, scrolls on its own, `min-[1180px]:block`),
  `patient-sheet.tsx` (`ResponsiveSheet`, opened from the top bar at 768 to 1179 and from the Finish bar below 768), `history-list.tsx` (the drawer's content:
  Repeat this Rx and Copy notes only while editable, clinic-zone dates), `summary-pane.tsx` (the read-only draft "as the patient will see it": complaints,
  findings, diagnoses, medicines, tests, advice, follow-up with weekday; 272 px from 1280; `SummarySheet` below). The Summary toggle is `aria-pressed`, closed by
  default to 1439 and open from 1440 (`useMinWidth`); a phone opens the drawer from a "Summary" pill at the end of the section strip. `patient-history-drawer.tsx`
  is deleted.
- Vitals grid: BP, pulse, temperature, SpO₂, weight, resp. rate; with `assist.vitals` a flagged value is `danger-fg` with its word ("· high"), from
  `lib/clinical/vitals.ts` (`flagOf`); without it the values are plain.
- Shortcuts (`use-consult-shortcuts.ts`): `createShortcutHandler` (pure, the hook adds the listener). Alt+1 to Alt+5 always; M (medicine search) and F (Finish
  visit) behind `clinicos.pref.shortcuts` with no modifier, no field and no dialog; `/` is reported as `command` and ignored until 09B-04b; `?` opens the existing
  `ShortcutSheet`, which gained optional `shortcuts` and `note` props so the consult lists its own keys.
- `lib/pwa/device-prefs.ts` unchanged (reuse only).

### Deviations

1. **Commits are by file, not by plan** (one working tree): `ed08464` (Sign & Bill sheet), `8efcb69` (frame and panes together), `62164f64` (re-pointed
   specs), `7b667c5e` (new specs), then this notes commit and the tag fix.
2. **The Summary drawer's entry on a phone** is a "Summary" pill after the section pills (the plan says "Patient and Summary as drawers" and gives the Finish
   bar only the Patient button). There is no Summary at 768 to 1279: the plan has the pane from 1280 only.
3. **The summary shows the preselected 5-day follow-up** from the first render (it is part of the draft on screen, as in Plan), so the drawer is never empty.
4. **The patient column is in the DOM but not drawn below 1180** (CSS), so `clinical-split-screens` reads the first visible copy of the vitals text.
5. **Route weight** (`npm run ci:route-js`, report-only): `/consultation/[id]` is **353.7 kB gz (route-specific 225.2)** against the 200 kB budget; 27 of 28
   routes are over their budget on this base (`/patients` 293.4, `/today` 320.7). At V2-06 the same route measured 213.0 kB and `/patients` 161.7, so the whole
   app grew about 130 kB since (shared code); the consult grew about 140. Not met as written; the budget is report-only. The v1 bodies are still in the
   route (09B-03 and 09B-04a replace them), so the number is recorded here for the close, not fixed here.
6. **The tablet captures** are written by `tablet-captures.spec.ts` (tagged `@golden` so the nightly projects pick it up).

### Tests added or changed

- `workspace-layout.spec.ts` (+9): the patient column (264 px, six sections, no Patient button or Summary at 1180), its own scroll and absence below 1180, the
  Patient sheet at 820 with Escape and focus return, the Finish bar's Patient drawer and the Summary drawer at 360 (settled box 360 wide at the bottom edge), the
  summary pane at 1280 (272 px, closed, `aria-pressed`, shows an advice tile tapped a moment ago and the follow-up weekday, toggles closed), 1440 open, vitals
  flags (BP "· high", pulse not), and M, F, ? behind the switch (and with it off).
- `tests/consultation/consult-shortcuts.spec.ts` (new, 20): the handler with a fake document: Alt+digit in a field and with the switch off, `code` not `key`,
  not behind a dialog, Alt+6 / Ctrl / Cmd / Shift variants; M, F, `/`, `?` with the switch on and off, in a field, behind a dialog, with modifiers and during IME
  composition.
- `tests/e2e/consult/tablet-captures.spec.ts` (new, 12): draft and amending at 360, 744, 820, 1180, 1280 and 1440: which regions exist, the label column, the
  summary default, no horizontal scroll, and a capture in `.planning/phases/09B-consult-workspace/evidence/screens/`.

### Counts (tool output of the runs named; one lane covers 09B-02a and 09B-02b)

- Vitest, affected (`tests/consultation tests/design tests/ci tests/components tests/pwa tests/today`): 80 files, 1533 tests, all pass (run before the last
  spec-only edits; `consult-shortcuts`, `workspace-sealed`, `workspace-review-fixes` re-run after them: 35 tests, pass).
- `npm run typecheck` clean; `npx eslint .` 0 errors, 406 warnings (the baseline was 413); `npm run inventory` exit 0 (no action or route added or removed);
  `npm run ci:ui-policy` and `npm run ci:ai-l1` PASS; the React Compiler waiver file did not change.
- e2e, after `npm run e2e:build`: `npx playwright test tests/e2e/consult tests/e2e/m0 tests/e2e/journeys tests/e2e/a11y/{consult-screens,amendment-screens,
  sign-and-bill-screens,clinical-split-screens}.spec.ts tests/e2e/pwa/05-cache-audit.spec.ts --project=desktop-chrome --project=pixel-7 --project=iphone-15
  --retries=0`: **277 passed, 0 failed, 0 retries** (8.6 min; the a11y files run on desktop-chrome only, the other projects run the `@golden` tests).
- Tablet projects, once: `tablet-captures.spec.ts` and `workspace-layout.spec.ts` on `ipad-mini-744`, `android-tablet-800`, `ipad-gen7`, `ipad-gen7-landscape`,
  `galaxy-tab-s4-landscape`: **208 passed, 0 failed** (3.3 min). The captures of the desktop-chrome run (12 PNGs: draft and amending at the six widths) are in
  `.planning/phases/09B-consult-workspace/evidence/screens/`; the per-device copies the tablet run wrote (96 files, 32 MB) were not kept.
- Earlier runs of the same lane failed for causes fixed in the tree, none by retry: sticky labels scrolling the document (deviation 8 of 02a), the Tailwind
  ordering of `md:` and `min-[1180px]:` (label column, the Patient button at exactly 1179 px), the `h1` for the patient's name, "Finish visit" waiting on the
  flush (journey-08), and, on iphone-15 only, a click or key press before React had hydrated (WebKit hydrates later): `tests/e2e/support/hydrated.ts` waits
  for it, and the focus-return case opens the sheet by keyboard because Safari does not focus a button on click.
- Route weight: see deviation 5 of 02b (353.7 kB gz, not under 200).

### Flakes

None: no test passed only on retry (retries 0 throughout). The iphone-15 failures above were reproducible (a hydration race, not a flake) and are fixed at the root.

### Hand-offs for 09B-03 (and later)

- The Examination section hosts the v1 vitals block, the specialty `NativeSelect` (id `workspace-specialty`) and the specialty panels; 09B-03 replaces the select
  with the template tiles and may delete the select with its `workspace-sealed` selector. Complaints, Diagnosis and Prescription are `flat` v1 bodies inside
  `ConsultSection`; the Plan section is `sections/plan-section.tsx` (constants `COMMON_INVESTIGATIONS`, `COMMON_ADVICE_CHIPS`, `FollowUpIntervalChoice`): the
  catalogue of 09B-03 replaces them and the `OptionTile` helper can move to `ChipGroup`.
- `ConsultWorkspaceProps.assist` is the `assist.*` map (key to boolean) resolved in the page; `assist.vitals` already gates the flags in the patient column.
  `summaryContent` (draft on screen) is the one place the summary reads; add the structured exam there when `specialty_data.exam` exists (`findingLines`).
- `use-consult-shortcuts.ts`: `singleKeyShortcut` already returns `command` for `/` (the host ignores it); 09B-04b adds its handler in `onAction`.
  `ShortcutSheet` takes `shortcuts` and `note`.
- Layout rules to keep: `data-note-scroll` is `relative` (see deviation 8); header is `<header>` sticky below 768; do not set the same property with `md:` and a
  `min-[..]:` variant. New specs that click or type right after `goto` call `awaitHydrated(page)`.
- The Finish bar holds Patient plus the primary action; the strip's "Summary" pill opens the drawer; the record bar (WhatsApp, Print Rx, Receipt) is in the note.
- `amendment_opened_at` and `allergies: null | []` are new page props; the allergy strip shows "Allergies not recorded" for null.
- `LLM_FEATURE_FILES` in `scripts/ci/ai-l1-greps.mjs` still names the deleted `ai-scribe-modal.tsx` (its fixtures use the path); `returning-patient-catchup.tsx`
  and its action are unreferenced by the workspace and go in 09B-04a.


## 09B-03 Tap-first entry: complaints, exam templates, plan tiles, learned order (migration 000113_consult_assist_context)

`ls supabase/migrations | tail -3` showed 000112 as the newest, so 000113 was free; `EXPECTED_MIGRATION` is bumped in the migration's commit.

### What changed

- `supabase/migrations/000113_consult_assist_context.sql`: `public.consult_assist_context(p_tenant_id)` (INVOKER, STABLE, `search_path = ''`, EXECUTE for authenticated
  only). The calling doctor's own last 300 signed visits in the active full clinic (`doctor_id = auth.uid()`, `signed_at IS NOT NULL`, newest first), as one jsonb of
  names and counts: `visits`, `complaints` (frequency, case-insensitive), `complaint_pairs`, `pairs` (complaint to diagnosis), `diagnoses` (30 most recent, each with
  ICD-11, SNOMED, chronic and custom flags, the usual tests and advice, top 8 each, and the usual follow-up gap in days), `last_exam_template` (a validated id).
  No patient id, no visit id, no note text. A caller without `consultations:edit` in `p_tenant_id` (a forged tenant, a nurse, a receptionist, an admin) gets the empty
  result (the keys with zero and empty lists). No index: the plan is an index scan on `visits` by doctor; the measurement is below.
- `features/consultation/{catalogue,exam-templates,exam-text,assist-ranking}.ts`: the static lists with their sources in the header (v1 strings verbatim plus the
  approved V2-DX ones that have no v1 equivalent), the six prototype templates verbatim (`for`, systems, normal texts, finding lists), the pure edit and mirror
  functions of `specialty_data.exam`, and the pure ranking (complaints, templates, plan tiles, the usual follow-up). `schema.ts` gains `exam` on the GP schema,
  `gen` and `ent` in `systemic`, and the `1_month` interval; `service.ts` gains `getConsultAssistContext`; the consult page reads it only for an editable record and
  only when `assist.terminology` is entitled (`activeEntitlements()` from the session).
- Sections: `workspace/sections/{complaints-section,examination-section,remove-button}.tsx` (new), `plan-section.tsx` (rewritten around `ChipGroup`). Complaints: tiles
  that leave the group when tapped, the v1 default duration (3 days) with option pills, the v1 note, free entry and the HPI note; focus moves to the new row's
  duration pills. Examination: template tiles (single choice), Normal/Abnormal per system, finding tiles, a side where it matters, a note, the general signs as tiles;
  Dental and Child switch the specialty to the existing odontogram and paediatrics tools; switching with data entered asks first (AlertDialog "Keep what I entered" /
  "Switch"). Plan: investigation, advice and follow-up tiles, "usual for {diagnosis} first" and "your usual" on the matching interval, the date hint with the weekday.
- Removed: the header specialty `NativeSelect`, `chief-complaints-section.tsx`, `specialty/gp-systemic-review.tsx`.

### Affected-test grep and fixes

`grep -rln "chief-complaints-section\|gp-systemic-review\|ChiefComplaintsSection\|GPSystemicReview\|workspace-specialty\|COMMON_INVESTIGATIONS\|COMMON_ADVICE_CHIPS\|FollowUpIntervalChoice" app features lib components tests`
(narrowed to code; `.planning` evidence JSON names the deleted files and is not touched). Hits: `workspace-sealed.spec.ts` (the select assertion; the new one asserts the six
template tiles are disabled on a sealed record, the "every input and chip is disabled" assertions are unchanged), `workspace-layout.spec.ts` (the advice tile is now named by
its text without the "+ " prefix; the 1180 px column test names "Snapshot", see 09B-04a). `draft-persistence.spec.ts` needed nothing (its regex still matches the tile).
`workspace-review-fixes.spec.ts` (all three specialties sealed) passes unchanged: a GP record with free `systemic` text and no exam shows those texts, disabled.

### Deviations from the plan, with reasons

1. **`complaint_pairs` is a sixth key of the context.** R-12 lists complaint frequencies and complaint-to-diagnosis pairs, and step 4 asks for "co-occurrence with those
   already added", which needs complaint-to-complaint pairs; the alternative is the Claude-authored association lists of the prototype, which Q-8 and PO-22 rule out. The
   key is the doctor's own data, counted per visit (top 200).
2. **Ranking reading.** "Frequency, then co-occurrence, then catalogue order" is applied as: nothing added yet, frequency then catalogue order; once something is added,
   co-occurrence with what is added first, then frequency, then catalogue order (otherwise co-occurrence would only break ties between equal frequencies and the chain of the
   prototype would not work). Pinned by `assist-ranking.spec.ts`.
3. **The `has_permission` guard is defence in depth.** Removing it does not fail any test: `doctor_id = auth.uid()` and RLS already return nothing to a role that has no signed
   visits. The doctor-scope mutant fails 13 assertions (below).
4. **`gen` and `ent` in `systemic`.** The Fever, Abdomen and Respiratory templates have systems with no key in the old `systemic` object; without them zod would strip the
   mirrored text. Optional strings, no migration. The Dental template's `oral` system and the Child template's systems are kept verbatim in the file but not rendered:
   those two templates hand over to the existing tools (R-9).
5. **Legacy free text stays visible.** A record with `systemic` text and no `exam` shows those texts (disabled when sealed, editable on a draft) until a template is chosen;
   choosing one mirrors over the keys it covers and keeps the others. The general signs moved to tiles over the same `general_exam` booleans; "Lymphadenopathy" reads "Lymph
   nodes" as in the prototype.
6. **One month is 30 days** (the prototype's own count). The interval word is not stored (09B-01), so a follow-up read back after a refresh shows "Custom date" with the date, as
   before for every interval.
7. **Tile text lost its "+ " and "✓ " prefixes.** The tile look and `aria-pressed` carry the state now (the ChipGroup tile).
8. **Fails-without for the entitlement gate** is an e2e mutation, not a unit: see the proofs.

### Tests added or changed (file: what)

- pgTAP `consult_assist_context.test.sql` (29): catalog and grants (anon refused), own aggregates (case-insensitive complaints, complaints recorded together, pairs, recent
  diagnoses, the usual tests, advice and follow-up gap, the last valid template id), unsigned and cancelled not counted, another doctor of the clinic, the owner with no signed
  visits, nurse, receptionist, admin, a forged and a null tenant, the other clinic's owner, exact keys and no uuid anywhere, the 300 window (the five oldest of 305 fall out).
- `tests/consultation/{exam-text (50),assist-ranking (25 at this plan),catalogue (12),assist-context-service (7, database: own aggregates, another doctor, owner, nurse and
  receptionist, another clinic, a forged tenant through the RPC, no identifier)}.spec.ts`.
- `tests/e2e/consult/tap-entry.spec.ts` (7, with the `ux` counter): three complaints with durations in 3 actions and 0 keystrokes; a respiratory template with crepts on the right
  in 3 actions and 0 keystrokes; one follow-up tap; the exam, its `systemic` mirror and the follow-up date after a refresh; the switch confirmations (keep, and Dental); the learned
  order with the Smart Assist label, the usual test and the "your usual" interval; and the same tiles in catalogue order with no label under an `assist.terminology` override off.

### Fails-without proofs

- **Doctor scope** (`AND v.doctor_id = v_uid` removed, function re-created on the stack, files re-run, then restored byte for byte): pgTAP `consult_assist_context` fails 13
  assertions (the aggregates, the other doctor, the owner).
- **Entitlement gate on the page** (`assist["assist.terminology"] === true` removed, rebuild, `tap-entry` "switched off" case): fails (`data-smart-assist` "on", expected "off"); restored and rebuilt.
- The tap-count and exam cases have nothing to fail against on the previous build (the tiles, radios and groups they address did not exist).

### Counts and checks

See the end of the 09B-04a section (one set of runs covers both plans).

## 09B-04a Smart Assist read side: diagnosis search, likely diagnoses, patient snapshot, open amendments (migration 000114_diagnosis_search_snapshot)

`ls supabase/migrations | tail -3` showed 000113 as the newest; 000114 was free.

### What changed

- `supabase/migrations/000114_diagnosis_search_snapshot.sql`:
  - `public.search_diagnoses(p_tenant_id, p_terms text[], p_specialty, p_limit)` (INVOKER, STABLE): the calling doctor's own custom diagnoses first (`doctor_id = auth.uid()`:
    the table's SELECT policy would show every doctor's), then the catalogue by rank 1 exact, 2 prefix, 3 synonym, 4 word prefix, 5 inside, 6 trigram 0.3 on the name or a
    synonym; `%`, `_` and `\` in a term are escaped; at most 8 terms of 2 to 100 characters; a custom row repeating a catalogue name is listed once; no permission or a forged
    tenant returns nothing. The pg_trgm schema is resolved at creation, as 000104 does.
  - `public.patient_snapshot(p_tenant_id, p_patient_id, p_exclude_visit_id)` (INVOKER, STABLE, jsonb): signed visits only, the last 5 other than the current one, with the
    clinic-zone date, the doctor's display name, diagnoses and the SIGNED Rx version's lines; allergies and chronic conditions; follow-ups due before the clinic's today with no attended visit since (waiting, in consultation or completed; the visit on screen is excluded;
    the follow-up's own visit is not "since"); the latest measured vitals among those visits, measurements only (no recorder id). NULL for a role without consultations:view,
    another clinic or an unknown patient.
  - No index and no table or policy change.
- `GET /api/terminology/diagnoses` (`app/api/terminology/diagnoses/route.ts`): session context with `consultations:view`, the read on the caller's own client, 401/403/403
  `SUBSCRIPTION_LOCKED`/503/500 with fixed bodies, `private, no-store`, keys `id, name, icd11, snomed, chronic, custom`, at most 12 rows; the abbreviation expansion only with
  `assist.terminology` (resolved from the session in the route); control characters in `q` become spaces (a NUL was a 500 in my first spec run: the fix is `cleanQuery`, used by the
  route, the service and `expandQuery`). The `searchDiagnoses` server action and its guard-manifest row are deleted; the service function stays (`expand` input).
- `features/terminology/{abbreviations,search,quick-diagnoses}.ts`: 48 abbreviations (42 diagnosis, 6 history markers for 09B-04b) mapped to expansion text, `expandQuery`; the
  browser fetch and the shared shapes; the v1 specialty chips moved out of the component unchanged.
- `workspace/sections/diagnosis-section.tsx` replaces the v1 section and its React Compiler waiver (removed from `scripts/ci/react-compiler-waivers.json`; the file only
  shrank). The list is the workspace's own state (no prop-to-state copy) and the search runs from the input's change handler (timer and abort in refs), so no effect sets state.
  "Likely from the complaints" and "Your recent" tiles from `rankDiagnoses` (the doctor's own history only, Smart Assist label); the specialty chips are always below them; a cmdk
  combobox over the route (aborts per keystroke, 200 ms debounce, "ICD-11" labels, the doctor's own diagnosis as the last row); add, remove and note keep their actions and texts.
- `features/consultation/snapshot.ts` (zod shape, `snapshotText`), `getPatientSnapshot` in the consultation service, `components/clinical/{patient-snapshot.tsx,vital-cells.ts}`
  (the vitals cells moved out of `patient-context.tsx`). The consult's patient column and sheet show "Snapshot" in place of "Last visit" when `assist.snapshot` is on.
- Today doctor mode: `components/today/{patient-snapshot-panel,open-amendments}.tsx`, `getOpenAmendments` in `features/today/queries.ts`, the page loader reads the Next
  patient's snapshot (the server's `nextUp`; the panel is drawn only when the client's Next is the same patient) and the open amendments. 768 px and up; "Open amendments (n)"
  lists the doctor's own signed visits that are in consultation again, each a link with "opened {date}".
- Deleted: `components/consultation/returning-patient-catchup.tsx`, `getPatientCatchUpSummaryAction`, `lib/ai/catch-up-summary.ts` and its export, their specs and manifest rows, the L1
  entry and the non-action-module entry. `generateSoapAction` and `soap-generator.ts` stay for V2-12.

### Affected-test grep and fixes

`grep -rln "searchDiagnoses\|getPatientCatchUpSummary\|catch-up-summary\|returning-patient-catchup\|ReturningPatientCatchup\|diagnosis-section" app features lib components tests scripts supabase/tests`:
`tests/security/{guard-manifest.ts,guard/engine.ts,p0-01-action-sweep.spec.ts,ai-containment.spec.ts}` (the catch-up and `searchDiagnoses` rows and cases go; the diagnosis
route gets a new guard kind `session-diagnosis-search` with its legs), `tests/ai/prescription-suggestions.spec.ts` (the two catch-up cases go), `scripts/{inventory-server-actions.ts,
ci/ai-l1-greps.mjs}`. `tests/integration/consultation-flow.spec.ts` and `tests/security/no-raw-error-responses.spec.ts` call the service `searchDiagnoses` with `{query, limit}`
and pass unchanged (the input type is `z.input`). `workspace-sealed` and `workspace-review-fixes` (the diagnosis input is still disabled by its placeholder) pass unchanged.
`m0/consult-rx-finish` clicks the "Viral Fever" quick chip: it failed once in the first run with a learned history present (the chips were hidden behind the learned groups),
which is why the chips are always shown now (see deviation 2).

### Deviations from the plan, with reasons

1. **Snapshot and the Next card.** The panel is computed on the server from the same `nextUp(groupIntoLanes(rows, "doctor"))`; while a filter is active or an optimistic check-in
   changes the client's Next, the panel is not drawn (it carries only the patient the server saw as Next).
2. **The specialty chips are not only a fallback.** The plan says "the specialty's fixed chips as the fallback"; they are shown always, under the learned groups. A doctor with
   history may still want a diagnosis the history does not hold, and the M0 consult flow (an approved baseline) clicks one.
3. **`patient_snapshot` takes the doctor's display name from `memberships.full_name`** (a name of staff, not of a patient); there is no other source of it.
4. **"Open amendments" reads the visit's `updated_at` for order** and the latest `visit_revisions.amended_at` for the date; both under RLS in the Today loader, 20 at most. Discard
   stays out (Q-5).
5. **The abbreviation table has 48 entries**, six of them history markers (c/o, k/c/o, o/e, h/o, f/u, adv) that the diagnosis search never expands; 09B-04b's parser reads them.
6. **`command-latency.ts` waits 75 s before timing the reads.** A freshly seeded table has no planner statistics: the first measurement of `consult_assist_context` was 98 ms
   (a degenerate nested loop on `consultation_diagnoses`), and 9 ms once autovacuum had analyzed the tables (and with `ANALYZE` in psql: 5 to 9 ms). The reads are measured as a
   clinic's tables are. Two infra notes: back-to-back runs of the script fail with `fetch failed` at their first call (the local API gateway drops connections for a while after a
   long run); a pause fixes it. A failed run leaves a "Synthetic Latency Clinic" and catalogue rows: remove them with SQL.
7. **`search_diagnoses` is the slowest read** (p95 39 ms against the 50 ms target on 2,000 catalogue rows: the trigram similarity is computed per row for the name and each synonym,
   which no index serves inside a CASE). Within the target; a `WHERE`-level prefilter on the existing trigram index is the first thing to do if the real catalogue (about 1,550
   rows) or a slower host pushes it over.

### Tests added or changed (file: what)

- pgTAP `diagnosis_search_snapshot.test.sql` (49): catalog and grants, no session; the ranking (custom first by use_count, exact, prefix, synonym, word prefix, inside, a one-letter
  typo, expansions, case, the limit, the dedupe of a custom row and a catalogue name, the specialty filter), wildcards and escapes (`x_y`, `100%`, `%%`), clamping, nurse, receptionist,
  admin, forged tenant, another clinic; the snapshot (five newest signed visits, newest first, the oldest of six out, a booked, waiting, cancelled or unsigned completed visit is not
  history, the visit on screen excluded, doctor, diagnoses and codes, the signed Rx version only, allergies and conditions, the due follow-up and its three exclusions, the latest
  measured vitals without the recorder, exact keys, no uuid, NULL for receptionist, admin, another clinic, an unknown patient).
- `tests/terminology/diagnosis-search.spec.ts` (37: `expandQuery` and the table, then the ranking table over `searchDiagnoses` with synthetic catalogue rows), `diagnosis-search-route.spec.ts`
  (12: 401, 403 no clinic, locked, receptionist, the exact keys and `no-store`, the session's clinic whatever the query string says, another clinic's owner, the expansion with and
  without the entitlement, the specialty parameter, hostile input as data, empty input, the limit of 12), `tests/consultation/snapshot.spec.ts` (14: database and template),
  `assist-ranking.spec.ts` (+9: `rankDiagnoses`); the guard legs for the route (`session-diagnosis-search`: denial legs, a synthetic catalogue row with exact keys, four hostile queries).
- `tests/e2e/consult/smart-assist.spec.ts` (7, serial, `platform_settings.ai_features` all off for the file and restored, catalogue rows seeded and removed): AI is off and no AI control
  is on the consult; the likely tile adds the diagnosis in 1 action and 0 keystrokes (the row has its ICD-11 code); "htn" finds the hypertension entry and Enter adds it with BA00; a
  diagnosis not in the catalogue is added as the doctor's own from the last row; the snapshot on the consult (the column at 1280, the Patient sheet at 820: last seen, the Rx line, the
  due follow-up); Today doctor mode at 820 (the panel beside the Next card, hidden at 600); an amended visit under Open amendments with "opened" and a working link.

### Fails-without proofs

- **Custom scope** (`AND c.doctor_id = v_uid` removed): pgTAP fails 7 (own custom first, never another doctor's or clinic's, another doctor, expansions, the limit, a limit of 0, the nurse).
- **Wildcard escaping** (the three `replace`s removed): fails 2 (`x_y`, `%%`).
- **Signed-only history** (`signed_at IS NOT NULL` replaced by `status <> 'cancelled'`): fails 5 (the last five, the excluded visit, the first diagnosis, the doctor, the signed Rx).
- **The NUL fix** (`cleanQuery`): the route spec returned 500 for `"\u0000ab"` before it, 200 after.
- Each function was re-created from the migration file after each mutant and the file re-run green; `git status` clean on the migration.

### Counts and checks (09B-03 and 09B-04a together)

- pgTAP, full (`npm run test:pgtap`): **8632 tests, 63 files, all pass**; `assert-pgtap-report.mjs` PASS at FLOOR 8632 (8554 + 29 + 49; the arithmetic is in the gate header;
  REQUIRED_FILES gains the two files). No other pgTAP file changed its count.
- Vitest, affected (`tests/terminology tests/consultation tests/today tests/ai tests/security tests/ci tests/design tests/components tests/authz`, the two integration files from the
  grep and `tests/api/readiness-probe-db`): 115 files, 3020 tests, all pass. Vitest REQUIRED_FILES gains the seven new files; FLOOR stays 6455 (re-measured at the close).
- e2e after `npm run e2e:build`, desktop-chrome, `--retries=0`: `npx playwright test tests/e2e/consult tests/e2e/m0 tests/e2e/journeys tests/e2e/today tests/e2e/a11y/{consult-screens,amendment-screens,sign-and-bill-screens,clinical-split-screens}.spec.ts
  tests/e2e/pwa/05-cache-audit.spec.ts --project=desktop-chrome --retries=0`: **182 passed, 1 failed** (5.8 min): `draft-persistence` "the unload guard exists only while the draft is dirty" (a 09B-01 spec). Root cause,
  not a retry: the spec typed the note before React had hydrated (the guard is registered by the hook once it runs, so no `beforeunload` fired when the page closed); it is the race 09B-02b found on
  iphone-15, here under the load of a long lane. All nine `goto`-then-type sites of that file now call `awaitHydrated`; the file passes 3 of 3 runs (18 passed each, setup included). The
  lane was not re-run whole after that fix. Earlier runs of subsets in this plan: `tap-entry` (7) and `smart-assist` (7) green; `consult` + `today` + `consult-screens` 116 passed with the two
  failures named under Flakes (fixed); `m0` + `journeys` + the a11y files + `pwa/05` 105 passed with the one `consult-rx-finish` failure named under Flakes (fixed). The whole-page axe
  specs (draft, sealed, amending, Sign & Bill sheet at 360, 820, 1180, 1280) are green with the new tiles, the combobox and the snapshot, no baseline allowance.
- `npm run typecheck` clean; `npx eslint .` 0 errors, 403 warnings (406 before: the removed files); `npm run inventory` exit 0 (0 flagged: `searchDiagnoses` and
  `getPatientCatchUpSummaryAction` left, the diagnosis route is a new route with its manifest row); `ci:ui-policy` and `ci:ai-l1` PASS; schema snapshot `--check` and `npm run
  db:drift:local` PASS (the snapshot written once per migration).
- Latency (`npx tsx scripts/perf/command-latency.ts --calls 100`, local stack, tables analyzed): `save_consultation_draft` p95 3.1 ms; reads on the R-18 seed (2,000 catalogue rows, 300
  signed visits of one doctor, 50 for one patient): `consult_assist_context` p50 6.6 / p95 9.2 ms, `search_diagnoses` p50 37.6 / p95 39.3 ms, `patient_snapshot` p50 2.5 / p95 3.6 ms
  (targets: 150 ms for a command, 50 ms for a read). The JSON is not committed (evidence is produced at the close).
- Route weight (`npm run ci:route-js`, report-only): not re-measured here (the 09B-02b figure of 353.7 kB gz stands; the v1 diagnosis and complaint bodies are gone and new
  tiles and a combobox arrived, so the number moves little; the close re-measures).

### Flakes and infra

- No test passed only on retry (retries 0). Failures during the plan, each root-caused (the last one is the unload-guard hydration race in the counts above): the `ai_features` kill-switch spec's Today case failed because a second visit opened for the same
  patient counts as "a visit since" (the snapshot rule, correct): one history patient per test now; `tap-entry`'s learned-order case failed in a combined run because another spec's
  history (three Fever visits) tied with its three Knee pain visits and the catalogue order won: it seeds six now; `workspace-layout` 1180 px asserted the "Last visit" heading
  which the snapshot replaces; `m0/consult-rx-finish` needed the specialty chips always shown (see 09B-04a deviation 2).
- `fetch failed` from the local API gateway between back-to-back runs of `command-latency.ts` (infra, see deviation 6); not a test.

### Hand-offs for 09B-04b (and later)

- `abbreviations.ts` has the history markers (`kind: "history"`) and `lookupAbbreviation`; the shorthand parser reads them. Frequency words (OD, BD, TDS, ...) go next to the parser.
- `ComplaintsSection` adds a complaint with the v1 default duration (3 days); 04b makes `duration_val` optional (schema, the PDF, `history-list.tsx`, `summary-pane.tsx`, `durationIdOf`
  here: a complaint with no duration selects no pill). The tiles and the command bar both go through `onComplaintsChange`.
- `PlanSection` takes `context` and `diagnosisNames`; the follow-up suggestion chip of 04b sits next to the interval tiles and sets the interval through `onFollowUpInterval`
  (`1_month` exists) or the date through `onFollowUpDate`. The hint line (`[data-follow-up-hint]`) already names the weekday and "the front desk books it when you finish".
- `use-consult-shortcuts.ts` still ignores `/`; the command bar registers it in `onAction`. The Examination, Complaints and Diagnosis sections each take the doctor's own learned
  context (`assistContext`); 04b needs only `assist.shorthand` and `assist.followup` from `ConsultWorkspaceProps.assist`.
- Today rows: `TodayRowView` has no "Book follow-up" action yet; `OpenAmendments` and `PatientSnapshotPanel` show where doctor-mode additions go (`today-board.tsx`).
- The M0 consult flow and every consult e2e that adds a diagnosis by a quick chip rely on the specialty chips staying; keep them.
- Registries touched and current: `expected-migration.ts` 000114, schema snapshot, `types/database.ts`, pgTAP FLOOR 8632 and REQUIRED_FILES, Vitest REQUIRED_FILES, guard manifest and
  engine (new kind `session-diagnosis-search`), `react-compiler-waivers.json` (the diagnosis entry gone), `ai-l1-greps.mjs`, `inventory-server-actions.ts`. No audit action, reason code or
  `authz:gen` output changed (no table, policy or grant).
