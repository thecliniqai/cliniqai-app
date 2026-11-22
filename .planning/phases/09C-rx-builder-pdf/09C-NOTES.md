# V2-09c notes (executor record)

Branch `v2/phase-09c-rx-builder-pdf`. Evidence is tool output (the run logs, `evidence/` at the close); nothing below is typed evidence. Counts are from the runs
named beside them. Commit trailer: `Co-Authored-By: Claude Sonnet 5.5` (the model that ran; the launching message named Opus 5.5, which would be untrue).

## 09C-01 Rx line command, medicine search route, keyboard builder (migration 000117_rx_lines_command)

### What changed

- `000117_rx_lines_command.sql` (`ls supabase/migrations | tail -3` showed 000116 as the newest, so 000117 was free; `EXPECTED_MIGRATION`, the schema snapshot,
  `types/database.ts`, the pgTAP FLOOR and REQUIRED_FILES, the audit lists and the authz matrix moved in the same commit):
  - `tenants.rx_paper_size`, `tenants.rx_letterhead_mode` (CHECKs), margin CHECKs 0 to 300, `prescriptions.paper_size` (no UPDATE privilege on it: frozen after INSERT),
    `cdci_generics.substance_ids text[]` with a GIN index.
  - `public.search_medicines(uuid, text, integer)`: INVOKER, STABLE, `prescriptions:edit`, the doctor is `auth.uid()`; the 4-argument DEFINER function is dropped.
    The rows carry no invented dose. See "Deviations" 4 for how it is planned.
  - `public.change_prescription(p_tenant_id, p_visit_id, p_changes, p_client_request_id)`: DEFINER, the V2-07 pattern; add / update / remove, the header created
    once with the clinic's print settings, `DRAFT_LOCKED` for a sealed, an unsigned completed and a cancelled visit, `ITEM_NOT_FOUND` (P0002) for an item that is not
    on the visit's latest header, custom medicine upsert with `use_count + 1`, audit `prescription.lines_change` (counts only).
  - Audit lists (bodies from 000112): `prescription.lines_change` command-only; `prescription.item_add` and `prescription.item_remove` leave `audit_client_actions`;
    keys `added`, `updated`, `removed`.
  - Contract: `INSERT, UPDATE, DELETE` on `prescription_items`, `INSERT` on `prescriptions`, `INSERT, UPDATE` on `doctor_custom_medicines` revoked from `authenticated`.
- App: `GET /api/prescriptions/medicines` (guard-manifest kind `session-medicine-search` with its engine leg), `features/prescriptions/{lines.ts,search.ts}`,
  `changePrescription` service and `changePrescriptionAction`, `lib/clinical/rx.ts` (`DEFAULT_DOSE` removed), `RxEntryRow` (async `search`, no prefilled dose,
  "Adding…", error kept in the builder, "Other frequency" field), `RxLineItem` (`readOnly`, notes), `components/consultation/workspace/{use-rx-lines.ts,rx-templates-sheet.tsx,
  sections/prescription-section.tsx}`; `consult-workspace.tsx` owns the hook (`rx`), so the strip, the summary pane and Sign & Bill read the server's lines.
  Deleted: `components/consultation/{prescription-builder.tsx,frequent-rx-chips.tsx}` and their two React Compiler waivers (the file shrank by two entries).
  `getFrequentPrescriptionsAction` and `lib/ai/prescription-suggestions.ts` stay until 09C-03 (they have no caller left).

### v1 builder inventory (M4 criterion 1): where each capability went

| v1 capability | New home | Test |
|---|---|---|
| Medicine search (server action, 120 ms debounce) | GET route, `RxEntryRow` async `search` (150 ms, aborted per keystroke) | `medicine-search-route.spec`, `rx-keyboard` |
| Staged drug with a prefilled 1-0-1, After food, 5d | Gone (R-4): the builder opens with the doctor's own stored dose (custom medicine) or nothing; Enter says "Choose a frequency (1 to 5) and a duration such as 5d" | `rx.spec`, `rx-keyboard` (stored dose; no usual dose) |
| Nine frequency chips and a free custom frequency | Five presets with keys 1 to 5, and an "Other frequency" field (so 1-0-2 and the like can still be written); the other four chips (1-0-1-0, 0-1-0, 1-1-1-1, Stat) are the typed field | `rx-lines.spec` (stored non-preset frequencies are kept) |
| Food-timing chips | Four timing presets, optional (a null timing stays null) | `change-prescription-rpc` |
| Duration chips and a free text duration | Duration tiles, stepper, typed `5d`/`2w`/`1m`; a stored text such as "Continue" is kept as text (`durationText`) | `rx-lines.spec` |
| Special instructions | The dose builder's Instruction field, edit in place | `rx-keyboard` (edit) |
| Remove with a confirm dialog | Remove with an 8 s Undo toast (CD-34); Undo re-adds through one command | `rx-keyboard` (remove, Undo) |
| Save as template; Protocol Templates drawer; apply = client loop + `window.location.reload()` | "Templates" `ResponsiveSheet`; apply is one `change_prescription` call, no reload | `change-prescription-rpc` (multi-line add), manual |
| Frequent Rx chips (SA-02: any doctor, unsigned visits, invented doses) | Removed (PO-15); favourites and "your usual" arrive in 09C-03 | none |
| Amber allergy banner in the builder | The consult's allergy strip (unchanged) until 09C-02 replaced the builder text with the check | `rx-allergy` |
| Repeat Last Rx and the history list's "Repeat this Rx" (client loop) | One `change_prescription` call; the registered exception is gone from `no-client-command-chains.spec.ts` | `no-client-command-chains`, `consult-rx-finish` |
| Read-only on a sealed or completed record (disabled controls) | No entry row, no pills, no remove, no Templates: the lines are text (the record-state contract) | `workspace-sealed`, `rx-keyboard` (sealed), `consult-rx-finish` |
| B-1: a staged drug does not survive the sign-off refresh | Kept: the section remounts on the record state (`editorKey`) | `amendment-screens` B-1 |
| A custom medicine saved `dose_form` "Tablet" | Saved with no form (a form the doctor did not choose is not invented) | `change-prescription-rpc` |

### Writer inventory (before the grant narrowing)

`grep -rn 'from("prescription_items")\|from("prescriptions")\|from("doctor_custom_medicines")' app features lib components` (writes only): `features/prescriptions/service.ts`
(`getOrCreateDraftPrescription`, `addPrescriptionItem`, `removePrescriptionItem`: all deleted in this plan); `features/consultation/service.ts` and
`features/prescriptions/pdf/generator.ts` update the header's PDF pair and `updated_at` (the column grant stays, R-A); `app/api/v1/prescriptions/**` write with the
service role (ADR-0005 register, V2-12). SQL writers (`grep -in "insert into public.prescription_items\|update public.prescription_items\|delete from public.prescription_items"`
over the migrations): the sign and amendment commands touch the header only. No job writes Rx rows. So all three revocations went in.

### Affected-test grep (09C-PLAN shared rules) and the fixes

`grep -rln "addPrescriptionItem\|removePrescriptionItem\|getOrCreateDraftPrescription\|searchMedicines\|search_medicines\|PrescriptionBuilder\|prescription-builder\|FrequentRxChips\|getFrequentPrescriptionsAction\|prescription_items\|doctor_custom_medicines" tests supabase/tests scripts`:

- Unit and DB specs moved to the command through `tests/helpers/rx-lines.ts` (`changeRxAs`, `rxLine`): `integration/{consultation-flow,prescription-versioning,delete-paths}`,
  `consultation/sealed-refusal-messages`, `jobs/enqueue-webhook-rpc-db`, `security/p0-01-forged-overrides` (the action is `changePrescriptionAction`).
  `delete-paths` asserts the new audit action (`prescription.lines_change`) and the command's refusals (FORBIDDEN, VISIT_NOT_FOUND from the other clinic).
- Specs whose meaning changed with the grants: `security/ac6-rewrite-signed-rx` (a member's item insert, update and delete are refused by privilege in every state; the command is
  asserted instead: admitted on a draft and an amending record, `DRAFT_LOCKED` on a sealed one), `consultation/rx-seal` (a direct second header is refused by privilege; the
  command creates version 1 once), `integration/cdci-search` and `security/{membership-guard,review-fixes-db}` (the INVOKER search, no doctor parameter),
  `authz/table-matrix{,.spec}` (+ `npm run authz:gen`: the item INSERT/UPDATE/DELETE, header INSERT and custom-medicine INSERT/UPDATE cells are `rpc_only`),
  `consultation/workspace-sealed` (the entry row is absent on a read-only record), `tests/ci/pgtap-legacy-inline.spec.ts` (the pg_trgm file inlines the 000117 block).
- pgTAP files that build fixtures as a member widen the Rx grants inside their own transaction (as 09A-06a and 09B-01 did): `amendment_snapshot`, `clinical_seal`,
  `delete_rules`, `prescription_seal`, `reverify_integrity`, `rx_pdf_write_once`, `visit_integrity`. `definer_functions` swaps the `search_medicines` rows for
  `change_prescription`; `search_medicines_extension_schema` is re-pointed at the new function (same 6 assertions).
- e2e: `m0/consult-rx-finish`, `journeys/journey-06`, `journey-08`, `a11y/amendment-screens`, `consult/workspace-layout` moved to `tests/e2e/support/rx-entry.ts`
  (`addCustomMedicine`, `rxField`): selectors and steps only, outcome assertions unchanged. The M0 steps use the keys 1 and `5d`, which is exactly the dose the v1 builder
  prefilled, so the stored lines are the same.
- Latency: `scripts/perf/command-latency.ts` times `change_prescription` and `search_medicines` (20,000 synthetic CDCI rows, pseudo-random names, removed in `finally`).

### Deviations from the plan, with reasons

1. **The `M` shortcut and the field id.** The plan keeps `M` focusing the medicine field. cmdk overrides an `id` prop on its input, so the section is found by
   `#prescription [data-rx-search]` (the workspace's `focusMedicineSearch` and three specs changed; `#medicine-search-input` is gone).
2. **Enter before the answer arrives picks the top row when it does.** A fast typist's Enter while the search is on its way would have created a custom medicine from
   the typed text (the "Add" row is the only row then). `RxEntryRow` holds the Enter (`pickWhenReady`) and picks the first result when the answer for what was typed
   arrives; with no result it does nothing.
3. **A failed search still offers "Add “name”".** The v1 behaviour (a nurse with no `prescriptions:edit` types a name and the server refuses) is characterised by
   `journey-08`; the list shows "Couldn't search medicines" and the Add row, and the command's FORBIDDEN is what the nurse sees. The screen does not yet hide the entry row
   for a role without `prescriptions:edit` (the database refuses; hiding it is a UI choice for the fix round or V2-11).
4. **`search_medicines` planning.** The plan's ranking is implemented as written, but a single `WHERE` with four `OR`ed conditions was a scan of the whole catalogue
   (98.8 ms p95 at 20,000 rows; the plan's budget is 50). It now builds the candidates from four index-friendly branches (the GIN trigram indexes of 000007 serve `ILIKE` and
   `%`), reads each candidate by key with a LATERAL join, runs as `EXECUTE ... USING` (a plan for the typed words) and sets `enable_seqscan = off` and
   `pg_trgm.similarity_threshold = '0.3'` on the function: the planner's cost model prefers four sequential scans of a 20,000-row catalogue (66 ms, measured) to the indexes
   (5 ms). With no index to use a scan is still chosen. p95 37 ms.
5. **Duration text.** `RxLine` gains `durationText` (a stored duration the days cannot express, such as "Continue", is kept and shown as it is) and `days: 0` means
   "none chosen yet"; `doseSummary` and the pill read `lineDuration`.
6. **The result's `added_item_ids` is a list.** `expectDataOnlyStoredResult` (F-5) now accepts a list whose elements are tokens (a shared helper, one branch added).
7. **The command accepts the top-level key `allergy_override_reason` only from 000118.** In 000117 the key set is `add`, `update`, `remove`.

### Tests added or changed (file: what)

- pgTAP `rx_lines_command` (64): columns and CHECKs, `paper_size` frozen, the old search gone, the new search's grants and rows (stored dose, no dose, other doctor, `%` and `_`),
  the command catalog and grants, the header with the clinic's print settings, audit counts, custom medicine `use_count`, replay and mismatch, update, remove, sort order, the role matrix,
  other clinic, sealed / completed / cancelled, 12 malformed change sets, the revoked privileges, and a definer body still meeting the integrity guard on a sealed visit.
- `tests/prescriptions/change-prescription-rpc.spec.ts` (40): catalog, happy path with the data-only stored result, two rollback cases under scoped faults, sort orders,
  parallel adds on a fresh visit (one header), update, custom medicine, item-belongs-to-the-visit (another visit, another clinic, no header), replay, mismatch with the visit and
  the changes varied, concurrent submits of one id, the role matrix, cross-clinic, the three locked states and amending, 17 input cases, the contract (direct JWT writes are 42501).
- `tests/prescriptions/medicine-search-route.spec.ts` (23): 401, 403 (no clinic, locked, nurse, receptionist), 503, exact keys, no-store, own custom medicines first and never another
  doctor's, no dose on a catalogue row, `%` `_` `\` literal, hostile input, the cap, similarity.
- `tests/prescriptions/rx-lines.spec.ts` (42), `tests/clinical/rx.spec.ts` (+3: no default dose, no "0 days").
- `tests/e2e/consult/rx-keyboard.spec.ts` (10 cases): the tracer; three medicines with the keyboard only (`ux` 0 clicks, 0 fills); the custom medicine's stored dose with Enter, Enter; no usual
  dose says what to choose and stores nothing; edit a line's duration in 3 taps (same id); remove then Undo; a lost response retried (one line); every attempt aborted, the line stays in the
  builder and Enter stores exactly one; a sealed consult; 360 px with no horizontal scroll and a phone adds a line by tapping.

### Fails-without proofs (High controls)

- **The tracer** (`rx-keyboard`, "tracer"): red on the v1 build (`npm run e2e:build` on the unchanged tree, then the spec: the medicine was listed, Enter did not open a dose builder:
  `expect(locator('[data-dose-builder]')).toBeVisible()` timed out at 4 s), green on the slice.
- **The narrowing** (the three `REVOKE` statements removed from the migration, `db reset`, files re-run): pgTAP `rx_lines_command` fails 6 assertions (57, 59 to 63: the privileges and the three
  direct writes); `change-prescription-rpc.spec.ts` fails the contract case; the generated `authz_matrix.test.sql` fails 78 cells. The migration was restored byte for byte (`cmp` against a saved
  copy) and the stack reset.

### Flakes and infra

- No test passed only on retry (retries 0 throughout). Root causes found on the way:
  - `journey-06` on pixel-7 failed once in three runs: step 6 read `clinical_notes` after `[data-save-status='saved']` appeared, but the status can still show an earlier save while the last edit waits for
    its autosave; the keyboard builder made steps 4 and 5 faster than the debounce. The step polls the note now (same assertions). Stable in 3 runs on desktop-chrome, pixel-7 and iphone-15.
  - The first desktop lane had three failures with one cause in the helper: the doctor's own similar medicine ("Med A") was the top row, so Enter picked it instead of the "Add" row. `addCustomMedicine`
    walks to the Add row with ArrowDown before Enter.
  - `tsc -p tsconfig.tests.json` errors in other specs after the types regeneration (`Tenant` gained the two print columns in `lib/db/types.ts`).

### Notes for 09C-02 and later

- `use-rx-lines.ts` hands back `code`/`reason` of a refusal; the entry row opens the allergy reason on `ALLERGY_MATCH`.
- `rx-entry.ts` (e2e) is the one way specs add a medicine; `cdci-fixtures.ts` holds the synthetic catalogue rows (`test-cdci-09c-*`, never deleted).

## 09C-02 Allergy check, allergy recording, safe defaults (migration 000118_rx_allergy_check)

### What changed

- `000118_rx_allergy_check.sql` (`ls supabase/migrations | tail -3` showed 000117 as the newest):
  - `prescription_items.allergy_override jsonb` with a shape CHECK built from jsonb operators only (a CHECK cannot hold a subquery or call a function the service role may not execute);
    an index on `lower(btrim(cdci_substances.substance_name))`.
  - Helpers `private.allergy_substance_ids`, `private.rx_line_substance_ids`, `private.rx_allergy_matches` (one SQL source of the rule). `change_prescription` replaced from its 000117
    body: the optional `allergy_override_reason` key, `ALLERGY_MATCH` (P0001) before any write, the override stored on a matching add, an update with a reason confirms, the audit counts
    `allergy_overrides` (never the text), the entitlement read in SQL (`billing_internal.has_entitlement`).
  - `public.rx_allergy_context(uuid, uuid)` (INVOKER, `consultations:view`), `public.search_substances(uuid, text, integer)` (INVOKER, `consultations:view`),
    `public.record_patient_allergies(uuid, uuid, jsonb, uuid)` (DEFINER; `patients:edit` AND `consultations:view`).
  - `private.patient_input_normalize` and `private.step_create_patient` replaced from 000101: an absent or null `allergies` is NULL ("not recorded"); `[]` stays `[]`.
  - Audit: `patient.allergies_record` command-only; keys `allergies_count`, `coded_count`, `allergy_overrides`. Reason code `ALLERGY_MATCH` (CONFLICT).
- App: `features/prescriptions/allergy.ts` (the TypeScript twin), `service.getRxAllergyContext` and `getRxAllergyContextAction`, `features/patients/allergies.ts` and
  `recordPatientAllergies`, `GET /api/terminology/substances` (guard-manifest kind `session-substance-search`), `features/terminology/{substances.ts,service.searchSubstances}`,
  `components/clinical/allergy-editor.tsx` (typeahead, chips, "No known allergies", one command), the strip's "Record now" and "Edit", the dose builder's "Matches allergy: …" and
  "Prescribe anyway" with a reason, the result chip, line states ("Prescribed despite allergy: …", "Checked by name only", "Allergies not recorded · Record now"), `updatePatient`
  (allergies only when changed; NULL and `[]` differ), `newPatientPayload` (null), the edit modal (omits `allergies` for a not-recorded patient), `scripts/seed/cdci-parse.ts` and
  `scripts/seed-cdci.ts` (loads `substance_ids`; never run here).

### Deviations from the plan, with reasons

1. **The helpers are executable by `authenticated`** (the plan says revoked from everyone). The INVOKER read `rx_allergy_context` returns what each line matches and must call
   `rx_allergy_matches`; they are pure reads of the public catalogue (RLS `true`) and `private` is a schema `authenticated` already uses for `command_claim`. The anon and PUBLIC grants are revoked.
2. **Name matching also covers an allergy that is not coded when the line HAS substances** (the plan's rule (b) applies to lines with none). A brand or free-text allergy ("Augmentin") can only be
   checked by name; without this, "Augmentin" would not flag a catalogue brand whose generic has substance ids. A coded allergy against a line with ids is compared by substance only, as planned.
   The shared case table has both cases.
3. **`allergy_override_reason` is a top-level key of `p_changes`** (the plan says "an optional key"): one reason covers the matching lines of that change; lines that match nothing store none.
4. **`rx_allergy_context` also returns `override_reason`** (the line must show "its reason"); it is the doctor's own text, read by `consultations:view` roles of the same clinic.
5. **The reason field opens on the first Enter or tap** ("Prescribe anyway…"), and the next one sends; a server `ALLERGY_MATCH` for a line the screen did not flag opens it too.
6. **The action `recordPatientAllergies` is gated by `consultations:view`** in `resolveServiceContext`; the service and the command also require `patients:edit` (the guard engine's control leg runs a valid
   call as the least privileged holder of the manifest permission).
7. **Pre-filled allergies of existing patients are untouched** (no data change): patients registered before this plan with `{}` keep it.

### Tests added or changed (file: what)

- pgTAP `rx_allergy_check` (43): the CHECK with seven malformed overrides, the index, the helper grants, the rule, the command refusal as doctor and owner (nothing written), the override stored
  and counted without the text, the update confirmation, the kill switch, `record_patient_allergies` (catalog, list, `[]`, audit, roles, other clinic, 51 strings), the normaliser, the two reads across clinics.
- `tests/prescriptions/allergy-match.spec.ts` (31): 28 cases run against the TypeScript function and `private.rx_allergy_matches` with identical results, plus words and states.
- `tests/prescriptions/allergy-check-rpc.spec.ts` (14), `tests/patients/record-allergies-rpc.spec.ts` (20), `tests/patients/allergy-states.spec.ts` (7),
  `tests/terminology/substance-search-route.spec.ts` (7), `tests/prescriptions/cdci-generic-substances.spec.ts` (7).
- `tests/e2e/consult/rx-allergy.spec.ts` (5): acceptance 3 end to end (the chip, the notice, no reason stores nothing, "Prescribe anyway" with a reason stores the line and its override), a
  free-text allergy by name, a line confirmed after the allergy was recorded, "not recorded" then "No known allergies", the typeahead codes a substance.

### Fails-without proofs (High controls)

- **`ALLERGY_MATCH`** (the `RAISE` replaced by `NULL` in the migration, `db reset`, files re-run): pgTAP `rx_allergy_check` fails 13 to 15; `allergy-check-rpc.spec.ts` fails 7 cases.
  Restored byte for byte (`cmp`), stack reset.
- **Default fix 1, the registration commands** (the normaliser's `coalesce(..., '[]')` and the insert's `ARRAY(...)` put back): pgTAP fails 37 and 38; `allergy-states.spec.ts` fails the `register_patient`,
  walk-in and QuickRegister cases. Restored and reset.
- **Default fix 2, the app** (`newPatientPayload` back to `?? []`, `updatePatient` back to writing the allergies on every edit): `allergy-states.spec.ts` fails the QuickRegister payload case, the doctor's
  edit that sends no allergies, and the front-desk edit case. Restored from saved copies.

### Notes for 09C-03

- `PrescriptionSection` takes `allergy` (state, entitlement, entries, per-item info); a favourite or "your usual" tile adds through `rx.add(lines, reason?)` and must pre-check with
  `allergyMatches` (leave a matching line to the dose builder, flagged).
- `change_prescription` is the base for `repeat_visit_plan`'s allergy rule: call `private.rx_allergy_matches` with the line's `private.rx_line_substance_ids`.
- Registries touched and current: `expected-migration.ts` 000118, schema snapshot, `types/database.ts`, pgTAP FLOOR 8931 and REQUIRED_FILES, `RPC_REASON_CODES`, `AUDIT_ACTIONS` /
  `COMMAND_ONLY_AUDIT_ACTIONS` / `AUDIT_METADATA_KEYS` with the SQL lists, the definer registry, the guard manifest (`session-substance-search`, three actions) and valid inputs.

## 09C-03 Rx Smart Assist: favourites, your usual, Same as last visit (migration 000119_rx_assist)

Executed by Claude Sonnet 5.5 (trailer `Co-Authored-By: Claude Opus 5.5` per the launching message). `ls supabase/migrations | tail -3` showed 000118 as the newest, so 000119 was free.

### What changed

- `000119_rx_assist.sql`:
  - `public.consult_assist_context` replaced from its 000113 body (every old key unchanged) with `rx_favourites` (the calling doctor's 12 most prescribed medicines over their own last 300
    signed visits, ranked by the sum of 0.5 ^ (age in days / 90), ties to the most recent then the name) and, per diagnosis, `rx` (medicines in at least 40 % of the doctor's signed visits with
    it, at least 2 such visits, at most 6). Each entry: name, generic, form, catalogue brand id, `substance_ids` (for the screen's allergy pre-check), count and `usual` = the most frequent exact
    (dosage, timing, duration) of that doctor's own lines (ties to the most recent; a stored null timing stays null; `usual` is null when that triple has no dosage or no duration). "Signed version
    only" means: the visit is completed and signed (an open amendment is out) and its latest header is signed and active (a header that is not `active` is out). No patient, visit or item id.
  - `public.repeat_visit_plan(p_tenant_id, p_visit_id, p_source_visit_id, p_parts, p_client_request_id)`: DEFINER, V2-07 pattern, `prescriptions:edit` AND `consultations:edit`. Source = a completed, signed
    visit of the same patient in the same clinic (else `VISIT_NOT_FOUND`, so another clinic's or patient's visit says nothing); parts a subset of {diagnoses, prescription}, each once; same lock and
    refusals as `change_prescription` (`DRAFT_LOCKED`); diagnoses copied by name with their codes (a name already on the visit skipped, the source diagnosis note not copied); lines copied with their
    stored values (a medicine already on the Rx skipped, case-insensitive; a null timing stays null); with `assist.allergy_check` entitled and allergies recorded, a line that matches
    (`private.rx_allergy_matches` over `private.rx_line_substance_ids`, the rule `change_prescription` uses) is NOT copied and its source item id is returned in `skipped_item_ids`; a custom medicine joins
    the doctor's own list as a line they add does. Audit `visit.repeat_plan` (command-only; keys `added`, `skipped`, `diagnoses_added`). Result `prescription_id` (null when no header), `added_item_ids`,
    `skipped_item_ids`, `diagnoses_added`, `replayed`.
  - Audit lists replaced from the 000118 bodies (`log_command_audit` allows `visit.repeat_plan`; metadata keys `skipped`, `diagnoses_added`).
- App: `repeatVisitPlan` (service) and `repeatVisitPlanAction` (the service also reads the visit's lines, diagnoses and the skipped source lines back, so the screen shows what the database holds),
  `useRxLines.repeat` / `repeated` / `markRepeated` / `touch`, `RxEntryRow` `handleRef.prefill(medicine, {allergy?})`, `PrescriptionSection` (suggestion row: "Same as last visit · {date}", "Your usual for
  {diagnosis}" tiles, favourite tiles, the list of medicines left to the doctor, the "Repeated" marker until a line is touched), `assist-ranking.ts` (`rxBundlesFor`, `rxFavouritesFor`,
  `rankProtocolTemplates`), `features/prescriptions/lines.ts` (`rxEntryToAdd`, `rxEntryToMedicine`, `pastItemToMedicine`), the Templates sheet ranked (specialty, then a diagnosis in the name, then newest),
  the history list's "Repeat this Rx" (signed visits only: `PastVisitEncounter.signedAt`), the page reading the context for `assist.terminology` OR `assist.frequent_rx` (each part handed only to what it is
  entitled to).
- Deleted as replaced (PO-15): `getFrequentPrescriptionsAction`, `lib/ai/prescription-suggestions.ts`, `PrescriptionSuggestion`, `tests/ai/prescription-suggestions.spec.ts` (4 cases), their guard-manifest
  row and inventory entry; the 09C-01 client repeat payload (`handleRepeatRx`) and the section's "Repeat last Rx" button (the tile replaces it). Grep after: `grep -rn "getFrequentPrescriptionsAction\|prescription-suggestions\|PrescriptionSuggestion" app features lib components tests scripts` is empty.

### SA-02 baseline (the retired library on the same rows, run once before its deletion)

A temporary spec (not kept) seeded doctor B with one signed and one unsigned Viral fever visit with B-only medicines and called `getDoctorFrequentPrescriptions` as doctor A for "Viral fever". Output (`SA02-BASELINE`):
`[{"drug_name":"SA02 Doctor B Signed Syrup","dosage":"1-0-0","frequency":"1-0-1","duration":"3 days",...},{"drug_name":"SA02 Doctor B Unsigned Syrup","dosage":"1-0-0","frequency":"1-0-1","duration":"3 days",...}]`:
another doctor's signed AND unsigned medicines reached A, and the stored null timing came back as an invented "1-0-1". The new specs assert the opposite on the same shape of rows.

### Decisions where the plan left a choice

1. **Favourites are the doctor's own across all their patients** (not per patient); the `Other Patient Medicine` case in pgTAP pins it.
2. **`usual` null opens the dose builder with nothing filled in** (the blank-dosage case): `RxEntryRow.prefill` takes the stored parts only. A medicine whose usual duration is text ("Continue") keeps it as `durationText`.
3. **A left-out line is opened with a fixed notice** ("Matches allergy: a recorded allergy (see the allergy strip)") because the database returns ids, not the matching strings; the reason typed there goes to `change_prescription`,
   which computes and stores the real allergens in `allergy_override`. A bundle or favourite the screen's own rule flags names the allergy itself.
4. **"Same as last visit" offers only what is still missing** (a part with nothing to add is dropped; no tile when nothing is left), and only for the patient's last signed visit. "Repeat this Rx" appears only for a signed visit.
5. **Template ranking** is applied in the sheet from the visit's specialty and its diagnoses; the saved templates carry no usage data, so "newest" is `created_at`.

### Deviations from the plan, with reasons

1. **The command also returns nothing about "already present" lines** (the result holds only added and skipped ids, plus counts): the screen re-reads the visit after the command (`items`, `diagnoses`), so a replayed
   or concurrent run shows the database's state and the tile logic needs no second source of truth.
2. **The diagnosis note and the chronic-condition sync of the original add are not copied**: the source note is clinical free text of another visit, and a copied chronic diagnosis was already synced to the
   patient's profile when it was first added (a removed chronic condition is not resurrected).
3. **`consult_assist_context` is read when either `assist.terminology` or `assist.frequent_rx` is entitled**, and each key is handed only to what it is entitled to (`assistContext` / `rxAssistContext`).
4. **The existing pgTAP `consult_assist_context.test.sql` changed** (its empty result and key lists name the new keys); its 29 assertions are otherwise the same.
5. **No index was added**: `consult_assist_context` on the R-17 seed (300 signed visits of three lines, 25 distinct medicines, one doctor) measured p95 14.1 ms.
6. **The custom-medicine upsert runs for a repeated custom line**, as it does for a line the doctor adds (the doctor prescribed it now); the stored values become the line's.

### Tests added or changed (file: what)

- pgTAP `rx_assist` (55): ranking by recent use, the signed version only (unsigned, header not active, open amendment out), SA-02 (A2 and clinic B never in A1's and the reverse), `usual` (most frequent, tie to the most recent,
  null timing, null usual), catalogue ids and substance ids, the key set, 12 cap, bundle thresholds (40 % exactly, 33 % out, one visit out), no uuid in the output, the empty result for nurse / receptionist / admin / owner / another clinic;
  `repeat_visit_plan` catalog and grants, the role matrix, the copy with stored values, replay, a second run copying nothing, the counts-only audit row, the allergy skip reported by source item id, the refused sources and targets.
- `tests/prescriptions/rx-favourites-db.spec.ts` (6): SA-02 through the service on rows the command wrote. `tests/prescriptions/repeat-visit-plan-rpc.spec.ts` (28): catalog, happy path with audit and data-only stored result, null timing,
  parts, skipped duplicates, allergy skip with the kill switch, the service's read-back, fault injection (nothing persists), replay, IDEMPOTENCY_MISMATCH with visit, source and parts varied, parts order, two concurrency cases, the role matrix
  (5), cross-clinic, source of another patient / unsigned, sealed target and an amending one, 5 input cases, the service's refusals.
- `tests/consultation/assist-ranking.spec.ts` +25 (64 in the file): the Rx keys' parsing, favourites, bundles, the entry-to-line mapping, template ranking.
- `tests/e2e/consult/rx-assist.spec.ts` (8): your usual in 1 tap with 0 typed (`ux`), three favourites in 3 taps, a favourite with no complete usual, Same as last visit in 1 tap, an allergy-matching line left out of Same as last visit,
  of a bundle, "Repeat this Rx" (prescription only), `assist.frequent_rx` off. All with AI fully disabled (platform kill switch off for the file).
- Registries: `EXPECTED_MIGRATION` 000119, schema snapshot, `types/database.ts`, pgTAP FLOOR 8986 and REQUIRED_FILES, vitest REQUIRED_FILES (two files), `AUDIT_ACTIONS`/`COMMAND_ONLY_AUDIT_ACTIONS`/`AUDIT_METADATA_KEYS` with the SQL lists, the definer
  registry (`definer_functions`), the guard manifest and valid inputs (`repeatVisitPlanAction`), the latency script.

### Fails-without proof (High control: SA-02)

The doctor filter of `consult_assist_context` (`AND v.doctor_id = v_uid` in the `vs` CTE of 000119) removed, `db reset`: pgTAP `rx_assist` failed 9 assertions (1, 4, 5, 9, 10, 12, 17, 23, 25: favourites and bundles hold other doctors'
medicines) and `rx-favourites-db.spec.ts` failed 3 cases (A's favourites hold B's `Doctor B Only Delta`, and B's hold A's). The migration was restored byte for byte (`cmp` against the saved copy), the stack reset, `rx_assist` 55/55 again.

### Latency (`npx tsx scripts/perf/command-latency.ts --calls 100`, local stack, 75 s autovacuum wait; the script removes its synthetic rows)

`repeat_visit_plan` (a diagnosis and three lines onto a fresh draft, allergies recorded) p50 5.7, p95 6.3, p99 7.1 ms (condition p95 under 150 ms); `consult_assist_context` with the Rx keys (300 signed visits of three lines) p50 13.1, p95 14.1, p99 14.7 ms
(under 50 ms; 09C-02 had 6.5 ms without the Rx keys); `change_prescription` p95 2.6; `record_patient_allergies` p95 2.4; `search_medicines` p95 35.4; `search_substances` p95 1.8; `rx_allergy_context` p95 8.1 ms.

### Flakes and infra

- Playwright (desktop-chrome and pixel-7, `--retries=0`): the first run of the new spec had one failure, my own assertion (a favourite with a blank stored dosage has `usual` null, so the dose builder opens with nothing, not with the stored duration);
  fixed in the test. No retry anywhere. After a `db reset` the Vitest run failed once with "Could not query the database for the schema cache": PostgREST was not ready yet (about 15 s); not a product issue.

## Counts and checks (tool output of the runs named)

Both plans, at the final tree (`v2/phase-09c-rx-builder-pdf` after the 09C-02 commit and its follow-up):

- **pgTAP** (`npm run test:pgtap`, full): 67 files, 8931 tests, all pass; `assert-pgtap-report.mjs` PASS at FLOOR 8931 (arithmetic in its header: 8824 + 64 for `rx_lines_command` = 8888, + 43 for
  `rx_allergy_check` = 8931). Run on a database the Vitest and e2e lanes had used and on a freshly reset one (the `%` and `_` assertions of `rx_lines_command` now look only at their own
  rows: another lane's global fixture rows matched `50%` on the polluted database, the first form of the assertion failed there).
- **Vitest**, affected: `tests/prescriptions tests/clinical tests/consultation tests/security tests/audit tests/authz tests/commands tests/ci tests/integration tests/patients tests/terminology
  tests/today tests/dpdp tests/ai tests/api tests/compliance tests/jobs tests/visits tests/labs tests/billing`: 240 files, 4642 tests, all pass (the stack up). The first run of this set had one
  failure: two audit rows read in an order `auditRows` does not promise (a spec bug of mine, fixed: compared as a set). New specs per plan are listed above; `REQUIRED_FILES` of
  `assert-vitest-report.mjs` gains the nine (FLOOR unchanged, re-measured once at the close).
- **e2e**, `--retries=0`, local stack:
  - desktop-chrome, `tests/e2e/consult tests/e2e/m0 tests/e2e/journeys tests/e2e/a11y`: 249 passed, 1 skipped, 0 failed (7.6 min).
  - pixel-7, `rx-keyboard rx-allergy workspace-layout journey-03 journey-06 journey-08 consult-rx-finish`: 54 passed, 8 skipped (desktop-only cases), 0 failed.
  - iphone-15 (a temporary config without the `@golden` filter, deleted after): the same files, 40 + 22 passed, 0 failed. Its first run found three failures that are not product defects of
    the keyboard builder: `journey-08` (nurse) typed and `consult-rx-finish` (amend) clicked before WebKit had hydrated the workspace (both specs now `awaitHydrated`), and the allergy editor
    labelled a reopened list "Not a listed substance" until the context was read again (a real race: the editor now tells the workspace which entries it coded, and the workspace labels
    them at once).
  - 09C-02 lane (`rx-allergy rx-keyboard workspace-layout consult-screens journey-03 today` on desktop-chrome and pixel-7): 172 passed, 20 skipped, 0 failed.
  - `ux` counts (desktop-chrome): `consult-rx-three` 0 clicks, 0 fills, 0 selects; `consult-rx-edit` 3 clicks, 0 keystrokes; `consult-rx-tracer` 0 clicks, 0 fills.
- `npm run typecheck` clean; `npx eslint .` 0 errors, 391 warnings (the 09B baseline was 413: the deleted v1 files); `npm run inventory` exit 0 (0 flagged; 27 `use server` modules, 122 exports, 34 route
  modules); `ci:ui-policy` and `ci:ai-l1` PASS; schema snapshot `--check` PASS (2860 lines); `npm run db:drift:local` PASS.
- **Latency** (`npx tsx scripts/perf/command-latency.ts --calls 100`, local stack, after the 75 s autovacuum wait): `change_prescription` (three lines, a patient with three recorded allergies) p50 2.3 ms, p95 4.2 ms,
  p99 6.3 ms; `record_patient_allergies` p50 2.0, p95 2.4, p99 2.6 ms (condition: p95 under 150 ms); `search_medicines` (20,000 synthetic CDCI rows) p50 12.5, p95 34.2, p99 36.2 ms;
  `search_substances` (2,000 rows) p95 2.1 ms; `rx_allergy_context` p95 7.5 ms; `consult_assist_context` p95 6.5 ms (condition for reads: p95 under 50 ms). Before the planning change in deviation 4
  `search_medicines` measured p95 98.8 ms. The script removes its synthetic rows in `finally` (no "Synthetic Latency Clinic" left).
- **Route JS** (`npm run ci:route-js`, report-only): `/consultation/[id]` 376.4 kB gz, route-specific 247.9 (09B: 368.0), budget 200. The v1 builder and chips left the route; the allergy editor, the Templates
  sheet and the section's states came in (+8.4 kB). The V2-14 backlog row stands.
- **`tests/ci` once failed, not reproduced**: one run of the whole directory failed `hosted dump drift tool > names a column the dump has and the migrations do not` (440 of 441; the test builds scratch databases from the
  migrations and takes about 5 s). It passed alone, as its file, and in four further runs of the whole directory (441 of 441 each), with no other lane running. The failure text was not kept, so the cause is
  not established; the likeliest is a scratch database left or created by another lane running at the same moment (the test asserts `scratchDatabases()` is empty). Not caused by 000117 or 000118 as far as the
  repeated runs show; it is logged here for the PO, not closed.
- Tracked evidence PNGs rewritten by the a11y runs were restored (`git checkout`), `.planning/dev-messages.txt` deleted, `npm run seed:local` run last.

## Hand-offs

- **09C-03**: `PrescriptionSection` `allergy` view and `rx.add(lines, reason?)`; `repeat_visit_plan` should call `private.rx_allergy_matches` with `private.rx_line_substance_ids` and report skipped items; the favourites
  and usual tiles pre-check with `allergyMatches` and leave a matching line to the dose builder (`openBuilder` for a line is not exposed yet: a favourite without a complete usual dose needs a small
  `RxEntryRow` handle, e.g. an imperative `prefill(medicine)`); `getFrequentPrescriptionsAction` and `lib/ai/prescription-suggestions.ts` are unreferenced and go there.
- **The screen does not hide the entry row from a role without `prescriptions:edit`** (a nurse sees it and the command refuses): a UI choice for the fix round.
- **PO actions** (not done here): `09C-P3` (staging migrate of 000117 and 000118 after `09B-P4`; the pg_trgm placeholder GUC on `search_medicines` is accepted by Postgres 15 and later) and `09C-P4` (the CDCI
  reload with `substance_ids`: until it runs, CDCI lines are checked against allergies by name only, which the line says).
- **Q-6** is in force in the code: new patients show "Allergies not recorded". The M0 and journey specs that registered patients assert nothing on the allergy state.

