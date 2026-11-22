# 09C review triage (CTO delegate, 2026-11-22)

Inputs: `09C-REVIEW-A.md` (20: 1 High, 8 Medium, 11 Low) and `09C-REVIEW-SEC.md` (2 Medium, 4 Low, 3 Hardening).
One fix round, 09C-06a. Every Fix row needs a test that fails without the fix, recorded in NOTES.

## Rulings

- **R-W (WhatsApp at sign):** the 09C-05 change stands. The consolidated Rx and receipt message is opt-in (never pre-ticked), per Q-8 and
  PO-23(h). Goes to the PO as 09C-P5 with the one-line revert.
- **R-AL (allergy writes):** every allergy write is audited at the database. The fix is an `AFTER UPDATE OF allergies` trigger that writes a
  counts-only audit row for every writer, and the edit modal routes through `record_patient_allergies`. Column grants are
  not narrowed in this phase, because other writers (registration) would break.
- **Migration 000120** (`000120_rx_review_fixes`) carries S-1, S-2, S-5, S-6, S-7, S-8, with every registry bumped in the same
  commit.

## Fix

| ID | Fix |
|---|---|
| A-1 + A-11 | Reconcile an unknown Rx outcome: settle and re-read the lines after a timeout or lost response. Finish waits for in-flight or queued Rx commands. |
| A-2 | A failed read after Repeat keeps the current list and shows an error. It never blanks the list. |
| A-3 | `ALLERGY_MATCH` on a template, a multi-line tile or Undo leads to per-line recovery: add the safe lines, and flag the matched ones with "Prescribe anyway…". Undo keeps the override. |
| A-4 | Tiles are disabled while a command runs, and a double tap adds once. |
| A-5 | Roles without `prescriptions:edit` get a read-only Rx list: no entry row, no tiles. They get an honest empty state when the lines are hidden by RLS. |
| A-6 + S-4 | Every pass-through path strips metadata from raw bytes: JPEG APP1, APP13 and COM; PNG `eXIf`, `tEXt`, `iTXt` and `zTXt`; WebP `EXIF` and `XMP`. If it cannot strip, the file is refused. Fallbacks are counted on the server through the existing client-error path if one exists, otherwise noted. |
| A-7 + S-5 | `patients.allergies DEFAULT NULL`, and the v1 patient route uses `?? null`. |
| A-8 | `record_patient_allergies` takes the expected previous list (or a version) and refuses a stale write with `CONFLICT`. The editor reloads and tells the user. |
| A-9 | Print the age from the date of birth at the Rx date in the clinic zone. Fall back to the stored age only when there is no date of birth. Age 0 prints in months or days. |
| A-10 (Enter part) | Enter after a failed or empty search does not create a custom medicine from the prefix without an explicit "Add as custom" step. |
| A-12 | A polite live-region announcement for adds and removes. Tiles are plain buttons, not toggles. |
| A-19 | The success screen hides or disables WhatsApp for an opted-out patient or one with no phone, and never shows "Sent" for a suppressed message. |
| S-1 | `change_prescription` and `repeat_visit_plan`: a sent `cdci_brand_id` takes its name, generic and form from the catalogue, or is refused with `INPUT_INVALID`. The match is substance overlap OR name match, in SQL and in the TypeScript twin. |
| S-2 | See R-AL. Add `allergies` and `chronic_conditions` to `changedFields`. |
| S-6 | `record_patient_allergies` refuses erased or deleted patients with `PATIENT_NOT_FOUND`. |
| S-7 | Add `doctor_id = auth.uid()` to `doctor_custom_medicines_select` (verify no other reader needs the tenant-wide read). |
| S-8 | `FOR SHARE` on the patient row in both commands. |
| S-9 | PDF route errors carry `Cache-Control: private, no-store`; a locked clinic gets 403 `SUBSCRIPTION_LOCKED` like the other routes. |

## Accept or backlog

| ID | Disposition |
|---|---|
| S-3 | Accepted; owner V2-12 (the v1 API Rx writer is replaced there). Entry in the SECURITY.md accepted-risks log. |
| T-09C-13 | Rate limiting accepted (V2-12). Entry in the SECURITY.md accepted-risks log. |
| A-10 (shadowing part) | Backlog V2-14: show the catalogue row beside a same-named custom medicine. |
| A-13 | Backlog V2-14: keep the duration wording on a partial edit. |
| A-14 | Accepted: a removed line is no longer prescribed. The audit keeps counts by design (no PHI in audit). |
| A-15 | Accepted: browser header and footer lines are a browser setting. The device checklist covers it. |
| A-16 | Accepted: the archive stores the bytes rendered at first open (write-once). Goldens are pinned to the CI Node version, noted in NOTES. |
| A-17 | Declared, Q-14. |
| A-18 | Backlog V2-14: warn when the compressed result falls under the legibility floor. |
| A-20 | Backlog V2-14: only a signed line updates a custom medicine's stored dose. |

## Outcome

Fix round 09C-06a, 2026-11-22, on `v2/phase-09c-rx-builder-pdf`. "Fails without" = the change alone reverted (SQL: in `000120`, then `db reset`; app: the
source file; UI: the source file, then `npm run e2e:build`), the named test run red, the file restored byte for byte (`cmp`, and `git diff --quiet`), the
stack reset or the build redone. Every red below is tool output from that run (logs in the session scratchpad); `09C-NOTES.md` 09C-06a has the detail.

| ID | Commit | Fails-without test (red when the fix alone is reverted) | Result |
|---|---|---|---|
| A-1 + A-11 | 1ddf3960 | e2e `rx-keyboard` "A-1: every attempt aborted after the commit…" (reconcile read skipped: the committed line never reaches the list, 30 s timeout); e2e `rx-keyboard` "A-11: Finish waits for an Rx command still queued…" (the wait and re-read removed: the remove runs after the sign, the signed Rx keeps the removed line) | Fixed. An outcome-unknown Rx failure re-reads the lines (a server action, so after the stalled request), shows them, settles the id and answers ok when the change landed; Finish waits for the hook's queue and re-reads before the review. |
| A-2 | 1ddf3960 | Vitest `rx-review-fixes-db` "A-2: … null, never an empty list" (service back to `[]`) | Fixed: the service answers `null` for a failed read-back; the hook keeps its list (or reads again) and the workspace replaces the diagnoses only with a read that succeeded. The hook's keep-the-list branch has no unit harness (Vitest runs in node, no hook renderer); covered by reading. |
| A-3 | 1ddf3960, c3da1057 | e2e `rx-allergy` "A-3: a template with an allergen line…" and "A-3: Undo … keeps the override" (per-line fallback and the Undo reason removed: the template is refused whole; Undo fails with the allergy text) | Fixed. Templates, tiles and Undo add per line; a line the screen or the database matches waits in the dose builder flagged "Prescribe anyway…"; Undo resends the stored reason. Self-review follow-up c3da1057: an undone line is not marked "Repeated". |
| A-4 | 1ddf3960 | e2e `rx-assist` "A-4: a double tap on a favourite tile adds its line once…" (`unique` and the busy-disable removed: two lines) | Fixed: tiles disabled while a command runs; a line already on the Rx when the command starts is left out. No server-side duplicate refusal (not in the row). |
| A-5 | 1ddf3960 | e2e `journey-08` "A-5: the nurse gets no Rx builder…" (the permission gate removed: the entry row is back) | Fixed: `canEditRx` / `canViewRx` from the page; no entry row, tiles, Templates or "Repeat this Rx" without `prescriptions:edit`; "The prescription is written by the doctor…" without `prescriptions:view`. |
| A-6 + S-4 | 243c4a2a | Vitest `compress-image` 4 cases (undecodable JPEG with Exif GPS, PNG text chunks, WebP EXIF/XMP, an unwalkable picture refused) (pass-through back to the original bytes) | Fixed: every pass-through strips the raw bytes by signature or refuses; `FileDrop` never falls back to an original picture. Fallbacks are NOT counted on the server: `reportClientError` is a no-op in production and the only server path (`reportClientRenderError`) takes allow-listed render-error class names; noted. The desktop lane then found the 09B upload spec's unwalkable JPEG fixture refused; fixture made walkable (76c5d181). |
| A-7 + S-5 | 21da40df | S-5: pgTAP `rx_review_fixes` 22, 23 (the DROP DEFAULT removed); A-7: Vitest `v1-crud` "POST /api/v1/patients without allergies stores … null" (route back to `\|\| []`) | Fixed: `patients.allergies` has no default; the v1 route stores `null`. Test fixtures that relied on the default now name `[]` (e2e seed, global setup, guard world). |
| A-8 | 21da40df, 5dfc69b4 | pgTAP `rx_review_fixes` 32 to 35 (the comparison removed); Vitest `rx-review-fixes-db` two A-8 cases; e2e `rx-allergy` "A-8: a save from a stale editor is refused…" (the editor's reload removed) | Fixed: `record_patient_allergies(…, p_expected, …)`; a different stored list is `ALLERGIES_CHANGED` (CONFLICT); the editor reloads the stored list and says so; the patient edit sends the list it opened on. The 4-argument function is dropped (no unguarded variant). |
| A-9 | 96b0a258 | Vitest `rx-pdf-content` 4 "printed age" cases (DOB path and the 0 fix reverted) | Fixed: age from the DOB at the Rx date in the clinic zone (y, m below 2 years, d below 1 month); stored age only without a DOB; a stored 0 prints "under 1y". Goldens unchanged (their payloads have no DOB); no new golden file. |
| A-10 (Enter part) | 1ddf3960 | e2e `rx-keyboard` "A-10: Enter on a search with no listed medicine creates nothing…" (the refusal removed: Enter opens a builder for the prefix) | Fixed: with no listed row (an empty or failed search) Enter shows "No listed medicine matches…" and opens nothing; the Add row needs an arrow key or a tap. The e2e helper and three specs now press ArrowDown once on a lone Add row. |
| A-12 | 1ddf3960 | e2e `rx-keyboard` "A-12: an added and a removed line are announced…" (the live region emptied) | Fixed: polite live region (outside the section, so the section's own text stays the lines'); tiles are plain buttons (asserted in the A-4 case: no `aria-pressed`, no toggle group). The tile half has no separate revert proof (the revert would be the old ChipGroup). |
| A-19 | bdac708a | e2e `finish-review` opt-out case (the success-screen gate removed: the WhatsApp sends are offered); Vitest `tokenized-sharing` "queues nothing … for an opted-out patient" (the service check removed) | Fixed: both success-screen WhatsApp sends disabled with the reason; the service refuses an opted-out patient before a token or a queue row. The "unsigned header" refusal the review mentioned was NOT added (not in the row; the guard positive control and two specs share an unsigned header). |
| S-1 | 21da40df | pgTAP `rx_review_fixes` 1, 3, 4, 5, 7, 9, 10, 11 and Vitest `allergy-match` 4 SQL-side cases (rule, brand check and repeat id reverted together); Vitest `allergy-match` 4 TS-side cases (the twin reverted alone) | Fixed: substance OR name in SQL and TS; a sent `cdci_brand_id` must carry its brand's name (INPUT_INVALID) and stores the catalogue's name, generic and form; `repeat_visit_plan` drops a stored id whose brand name differs. Two case-table rows that pinned "by id, not by name" now expect the match. |
| S-2 | 21da40df | pgTAP `rx_review_fixes` 13, 16, 17, 18, 20 (the trigger removed); Vitest `rx-review-fixes-db` S-2 case (the trigger removed, and separately the service's routing and `changedFields` reverted: 2 cases) | Fixed per R-AL: `patients_allergies_audit` writes a counts-only `patient.allergies_change` row for every writer (actor or system); the edit modal goes through `record_patient_allergies`; `changedFields` names `allergies` and `chronic_conditions`. The command path now leaves two rows (the command's and the trigger's), by design. |
| S-6 | 21da40df | pgTAP `rx_review_fixes` 24 to 26 (the erased/deleted filter removed) | Fixed: PATIENT_NOT_FOUND for an erased or deleted patient. |
| S-7 | 21da40df | pgTAP `rx_review_fixes` 27 to 29 and `authz_matrix` 2401, 2404, 2405, 2411 (the policy reverted) | Fixed: `doctor_id = auth.uid()` added; the only reader (`search_medicines`, INVOKER) already filters on the caller; the matrix regenerated. |
| S-8 | 21da40df | Vitest `rx-review-fixes-db` two S-8 cases (FOR SHARE removed: the commands no longer wait for a held FOR NO KEY UPDATE) | Fixed: both commands read the allergies FOR SHARE (a held allergy record makes them wait, then LOCK_TIMEOUT after 2 s). |
| S-9 | 96b0a258 | Vitest `pdf-route-guards` "S-9: every refusal … no-store, a locked clinic 403" (locked branch and a no-store header reverted) | Fixed: every answer `private, no-store`; locked clinic 403 `SUBSCRIPTION_LOCKED`. |
| S-3, T-09C-13 | (docs) | n/a | Recorded in `09C-SECURITY.md` Accepted Risks Log (AR-09C-01, AR-09C-02), owner V2-12, PO to confirm at the gate. |
