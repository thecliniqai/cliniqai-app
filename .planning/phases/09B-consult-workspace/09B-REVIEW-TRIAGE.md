# V2-09b review triage (CTO delegate, 2026-11-21)

Sources: `09B-REVIEW-A.md` (isolated, Sonnet) and `09B-REVIEW-SEC.md` (adversarial, Opus); both static, whole phase
(`f15fa25..9cfd5102`). No Critical. Lean process: one fix round (09B-06a). Every fix needs a test that fails without it,
measured, not assumed.

## Ruling R-U (upload body size), CTO delegate

Production runs on Vercel (`vercel.json`, TARGET §3.9 "Unchanged Vercel deployment"). Vercel refuses request bodies over
4.5 MB, and with `proxy.ts` in place Next cuts bodies at 10 MB, so the 26 MB server-action limit cannot deliver 25 MB uploads
in production; it only widens the pre-authentication memory surface (S-1 / A-5).

- `bodySizeLimit` goes to `"4mb"`. The client and server lab-file limit becomes 4 MB with the existing refusal text pattern
  ("larger than 4 MB"). Before 09B the limit was effectively 1 MB (a defect), so 4 MB is still a gain.
- `proxy.ts` answers 413 to any non-GET/HEAD request whose `content-length` is over 1 MB or missing, unless the caller has
  a session and the path starts with `/consultation/` or `/patients/`. Spec in Vitest on the proxy function.
- **PO decision:** uploads up to 25 MB need a direct-to-Storage upload (signed upload URL under the existing storage RLS,
  plus a small finalize action). That changes the upload path in the architecture, so it is the PO's call; proposed for
  V2-14 or earlier if clinics need large scans.

## Rows

| ID | Sev | Decision | Fix (09B-06a) |
|---|---|---|---|
| S-1 / A-5 | Med | Fix (R-U) | As R-U |
| A-1 | High | Fix | Unsent edits flush on in-app navigation and unmount (flush, then dispose; Next router navigation and Back). Tile taps arm the save like typing. e2e: tap tiles, navigate away within 5 s, the DB holds them |
| A-2 | High | Fix | Applying an exam template when legacy free-text `systemic` (or any exam text) has content asks for confirmation and never silently replaces typed findings; cancel keeps the text. e2e or Vitest on real rows |
| A-3 | Med | Fix | No preselected follow-up: the 5-day option is shown as a suggestion and is not stored until the doctor taps it (consistent with "no default value is invented"). Spec: an unrelated edit stores no follow-up |
| A-4 | Med | Fix | Upload idempotency: the client generates a request id per file; the server derives the storage key from it and the insert is unique on `(tenant_id, client_request_id)` (migration 000116), so a retry after a lost response stores one row and one object. Spec simulates a lost response after commit |
| S-2 / A-8 | Med | Fix | Uploads refused on a signed, completed or cancelled visit on every path: service check plus a BEFORE INSERT trigger on `patient_documents` in 000116 (visit-linked rows only; a patient-record upload with no visit stays allowed). pgTAP and Vitest |
| S-3 | Low | Fix if no request-path writer remains | Revoke direct UPDATE of `clinical_notes.vitals` from `authenticated` when every writer is a definer command (inventory in the notes); otherwise defer to V2-14 with the inventory. pgTAP grants |
| S-4 | Low | Fix (part) | `save_consultation_draft` (replaced in 000116) checks vitals ranges equal to the zod schema, follow-up date within today..+366 days, complaint objects' keys and types. `specialty_data` catch-all deferred to V2-14 (backlog row). pgTAP |
| A-6 | Low | Fix | The saver recreated after Amend or Finalize starts from the server's current values, not the mount-time snapshot. Vitest |
| A-7 | Low | Fix | An out-of-range or half-typed vital is held back (marked invalid in place) and does not block saving the other dirty fields. Vitest plus e2e |
| A-9 | Low | Accept | Macro expansion before parsing is by design: the preview shows the result and nothing is inserted without a tap. Note in 09B-NOTES |
| S-5 | Hard | Accept / V2-12 | Search term in a GET query string: the term is a diagnosis word, not a patient identifier; rate limit is V2-12. PO informed |
| S-6 | Hard | Fix (cheap part) | Storage extension from the verified type, not the client name; PDF/JPEG/PNG signature bytes checked server-side; stored file name stripped of control and bidi characters and capped. Vitest |
| S-7 | Hard | Fix | Revoke EXECUTE from PUBLIC on the two 000115 trigger functions (in 000116). pgTAP |

## Other close items

- Consult route JS 368 kB against the 200 kB report-only budget: V2-14 performance backlog.
- 09B-P3 (staging): duplicate follow-ups per visit check before 000112 (query in `09B-NOTES.md`).

## 09B-06a outcome (executor, 2026-11-21)

"Failed without" was measured, not assumed. Database rows: `000116_consult_review_fixes.sql` moved out, `db reset` to 000115, `consult_review_fixes.test.sql` run (40 of 48 assertions failed; the 8 that passed
are controls: boundaries accepted, valid complaints and follow-ups accepted, the closed-visit count, and the two S-7 grant assertions, see S-7); then 000116 restored without its S-2 block and reset again (assertions 13-22
failed, the controls 8-12 passed). The migration was restored byte for byte (`cmp` against a saved copy) and the stack reset. App rows: each fix reverted in the working tree by a scripted edit, the specs run, then
`git checkout` of those files; for the UI rows the app was rebuilt (`npm run e2e:build`) and the e2e run on desktop-chrome: one build with A-1, A-2, A-3, A-7 and the A-4 client reverted together (each test fails on
its own row), and one build with A-6 alone (A-3 reverted too would have put the follow-up in its audit row). pgTAP numbers are the assertions of `consult_review_fixes.test.sql`.

| Row | Commit(s) | Test(s) | Failed without the fix |
|---|---|---|---|
| S-1 / A-5 (R-U) | ba6e23b, 9a73d60, 98a7e15 | Vitest `proxy-body-limit` (413 for a signed-out 2 MB POST to `/login` and to the consult, an unsized body, a signed-in 2 MB POST to `/today`; a signed-in 4 MB POST to `/consultation/…` and `/patients/…` passes); `file-drop.spec` "accepts … up to exactly 4 MB"; e2e `upload` "a 5 MB file and an .exe are refused …" | yes (proxy gate off: 4 of 7 failed, the 3 pass-through controls passed) |
| A-1 | 41cca25, 87c1585 | e2e `review-fixes` A-1 "a link to Today …" and "a history step …"; Vitest `draft-saver` "A-1: release() saves what is unsent at once …" | yes (both e2e: the advice stayed unsaved; Vitest: no request) |
| A-2 | 95398e2 | e2e `review-fixes` A-2 (the ask, Keep keeps the text and the row's version, Switch applies) | yes (no dialog; the legacy text replaced) |
| A-3 | 41cca25, 3e844cb | e2e `review-fixes` A-3 (no tile checked, an unrelated edit stores no follow-up, a tap stores 5 days); Vitest `workspace-sealed` (no date field on a sealed visit without a follow-up) | yes (both) |
| A-4 | 9561fd2, 98a7e15, 491a736 | pgTAP #1-#7; Vitest `lab-upload-review-fixes` A-4 (a retry after a lost answer, three parallel sends, an orphan object adopted only with the same bytes, the id reused for another patient); e2e `upload` "A-4: an upload whose answer is lost …" (Chromium; skipped on WebKit, see notes) | yes (DB run: #1-#7; service revert: 4 of 4; client not sending the id: the e2e stored two rows) |
| S-2 / A-8 | 9561fd2, 98a7e15, 8b1b4f3, 16b29c4 | pgTAP #13-#22 (sealed, completed, cancelled refused for doctor, nurse, service role, owner; catalog); controls #8-#12; Vitest `lab-upload-review-fixes` S-2 (refused with no row and no object; draft and amending take one) | yes (migration without S-2: #13-#22; service check off: the object was stored before the trigger refused the row) |
| S-3 | not fixed (deferred to V2-14) | inventory in 09B-NOTES 09B-06a: `recordVisitVitals` still writes `clinical_notes.vitals` with the caller's JWT | n/a |
| S-4 | 9561fd2, a69f07c, 16b29c4 | pgTAP #25-#48 (16 refusals, 5 acceptance controls, the stored-date exception and its control) | yes (#25-#32, #35-#42, #44, #45, #48 failed; the controls #33, #34, #43, #46, #47 passed) |
| A-6 | 41cca25 | e2e `review-fixes` A-6 (Amend, edit, Finalize, Amend, one tap: `fields_changed` is `["chief_complaints"]`) | yes (`clinical_notes` was in `fields_changed`) |
| A-7 | 41cca25 | Vitest `draft-saver` "A-7: an out-of-range vital is held back …" and "… systolic not above diastolic and a fractional pulse …"; e2e `review-fixes` A-7 (marked in place, the complaint saved, vitals not, corrected then saved) | yes (Vitest 2 of 2; e2e, saver hold-back off: the whole save was refused, so no "saved" state and the complaint not stored) |
| A-9 | not changed (accepted) | note in 09B-NOTES 09B-06a | n/a |
| S-5 | not changed (accepted, V2-12) | none | n/a |
| S-6 | 98a7e15 | Vitest `lab-upload-review-fixes` S-6 (HTML declared PNG refused, nothing stored; a PNG named `.html` stored as `.png`; bidi and control characters stripped; 255 cap); `file-drop.spec` S-6 helper cases | yes (service revert: 2 of 2) |
| S-7 | 9561fd2 | pgTAP #23, #24 | no: the defect did not exist on this database. Migration 000059's `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` already left both functions with `{postgres=X/postgres}`; the REVOKE is kept as the checklist statement and the assertions guard against a regression |

Specs whose meaning changed with the new rules were adapted, not deleted (09B-NOTES 09B-06a, deviation 8). Counts: pgTAP 8824 (65 files, FLOOR 8824); Vitest affected 288 files, 5677 tests (5674 passed, 3
skipped, 0 failed); e2e desktop-chrome 242 passed, pixel-7 and iphone-15 102 passed and 1 skipped, iphone-15 without the golden filter 20 passed and 1 skipped; 0 retries everywhere.
