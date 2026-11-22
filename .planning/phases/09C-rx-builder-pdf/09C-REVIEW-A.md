# V2-09c review A (isolated reviewer, correctness and requirement gaps)

Scope: `git diff 02b2f49e..HEAD` on `v2/phase-09c-rx-builder-pdf` (09B evidence files ignored). Read: migrations 000117 to 000119, the Rx service, actions, lines, allergy rule,
use-rx-lines, prescription section, RxEntryRow, RxLineItem, templates sheet, allergy editor, finish review and sign modal, share button, compression, PDF
payload/content/document/generator/route, print view, settings card, both routes. `09C-NOTES.md` was read only after the findings were formed; a finding that the
notes already declare is marked "declared" and kept only where the notes do not cover the consequence.

Counts: 0 Critical, 1 High, 8 Medium, 11 Low (20 findings).

What held up (not findings): the SQL command guards (tenant, permission, closed key sets, item ids of the visit's header, visit lock, replay and mismatch), the grant
narrowing (no remaining request-path writer of `prescription_items`; the v1 API uses the service role as ruled), the allergy rule parity (one case table against SQL and
TS), favourites and "your usual" (the calling doctor's own signed, completed visits only, stored values, no ids in the output), the search routes' fixed bodies and
escaping, no patient name in the PDF title or file name, clinic-zone dates through a fixed month table, the write-once archive untouched, WhatsApp off by default
(Q-8) with the server gate on the input key.

---

## High

### A-1: An Rx command whose outcome is unknown is never reconciled with the server, so a committed line can be signed without the doctor seeing it
**File:** `components/consultation/workspace/use-rx-lines.ts:97-113` (`failure`), `:165-209` (`send`); `components/consultation/workspace/sections/prescription-section.tsx:176-182`
**Scenario:** The doctor adds a medicine; the response is lost or the 15 s `useCommand` timeout fires after the command committed (the Next action queue makes this
more likely when the allergy-context re-read or a draft save is ahead of it). `failure()` returns the "may have been saved" text and keeps the request id, but the Rx
hook never calls `settle()` and never re-reads the visit's lines (grep: only the amendment dialogs offer Start over). The line stays in the dose builder with an
error. If the doctor presses Escape or edits something else, `local items` do not contain a line that the database has. The next different change reuses the held
id (`reset()` is a no-op while unresolved), the server answers `IDEMPOTENCY_MISMATCH` ("Refresh and try again"), and nothing refreshes the list. The doctor then
opens Finish: the review and the summary read the local list, the sign command seals the header including the invisible line, and the patient receives a medicine the
doctor never saw on screen. The e2e "lost response" case only proves the happy retry (Enter again with the same payload).
**Fix:** On an outcome-unknown failure, re-read the visit's lines (`getVisitPrescription`) and replace `items` before anything else runs (call `command.settle()`
after the read), or keep a visible "unconfirmed" pending line that blocks Finish until it is confirmed or discarded. Add a spec: commit-then-abort, press Escape,
assert the line is shown in the list (fails today).

---

## Medium

### A-2: A failed read after "Same as last visit" blanks the visible Rx and diagnoses
**File:** `features/prescriptions/service.ts:244-259`; `components/consultation/workspace/use-rx-lines.ts:149-151`; `components/consultation/workspace/consult-workspace.tsx:548`
**Scenario:** `repeatVisitPlan` commits, then reads the Rx and diagnoses back. If either read fails (`success: false`) the service answers `items: []` or `diagnoses: []`
as if they were the truth. The hook `commit(value.items)` replaces the local lines with an empty list and `runRepeat` calls `setDiagnoses([])` (an empty array is
truthy). The screen shows an empty prescription and no diagnoses while the database holds both; the doctor re-adds by hand (duplicates, because only repeat dedupes by
name) or signs without seeing them.
**Fix:** Return `items: null` / `diagnoses: null` on a failed read and have the caller keep its local state (or refetch); never map a failed read to an empty list.

### A-3: `ALLERGY_MATCH` is a dead end on every path except the single-line dose builder (templates, multi-line tiles, Undo)
**File:** `components/consultation/workspace/rx-templates-sheet.tsx:57-73`; `components/consultation/workspace/sections/prescription-section.tsx:151-174`, `:213-229`
**Scenario (a):** A template with one line that matches the patient's allergy. `apply` sends all lines in one command, the database refuses all of them with "Review it
and give a reason to prescribe it", and the sheet has no reason field, no per-line control and no way to leave the line out. The doctor cannot use the template at all.
**(b):** A bundle or a multi-entry tap where the screen's rule and the database's differ (stale `allergyContext` after an allergy was recorded elsewhere, or a name
the client missed): with more than one direct line, `addEntries` falls to `setListError(sent.error)` and adds nothing, with no hint which line.
**(c):** Undo of a removed line re-adds it with no reason (`rx.add([itemToAdd(item)])`). A line that had been confirmed with a reason (or that now matches) fails
with the allergy text in a toast, so the removal cannot be undone and the override is lost.
**Fix:** Make the three paths per-line: drop matching lines from a template/bundle/undo add, report them ("2 added, Augmentin 625 left for you"), and open the dose
builder flagged for each (the same `RxLeftOut` mechanism already used by "Same as last visit"). For Undo, send the stored override reason again.

### A-4: Tapping a favourite or "your usual" tile twice adds the lines twice
**File:** `components/consultation/workspace/sections/prescription-section.tsx:151-174`, `:298-312`, `:322-336`
**Scenario:** The tiles are a `ChipGroup type="multiple" value={[]}`; nothing disables them while a command is in flight and nothing remembers the tap. A second
tap (common on a phone) calls `addEntries` again: the hook queues a second command with a fresh request id (the first one succeeded and cleared `lastKey`), and
`change_prescription` has no duplicate-medicine check, so the bundle's three lines become six on the signed Rx. Only `repeat_visit_plan` skips by name.
**Fix:** Disable the tiles (and ignore taps) while `rx.busy`, and/or skip entries already on the Rx inside `addEntries` using the current `rx.items` at send time; consider
a server-side "medicine already on this Rx" refusal for `add` (the repeat command already has the rule).

### A-5: Roles without `prescriptions:edit` get a live-looking Rx builder and an empty, misleading list (declared as open, still a defect)
**File:** `components/consultation/workspace/sections/prescription-section.tsx:260-268`, `:341-347`; `components/consultation/workspace/consult-workspace.tsx:254`, `:285-291`
**Scenario:** `readOnly` depends only on the record state. A nurse (consultations:view, no prescriptions:view or edit) opens a draft consult: she sees the entry row,
Templates, "Same as last visit" and the allergy tiles, every control fails (search 403 shows "Couldn't search medicines", the command is refused), and because RLS hides
the items she sees "No medicines yet. Type a medicine above" even when the doctor has already prescribed three. `journey-08` characterises this instead of preventing it.
Notes list it as "open for the fix round".
**Fix:** Pass `canEditRx` (prescriptions:edit) and `canViewRx` from the page; render the section read-only for a role without edit, and say "Prescription is written by the doctor" (not "No medicines yet") for a role without view. Update journey-08 to assert no entry row.

### A-6: Several compression paths upload the original photo with its GPS metadata
**File:** `lib/files/compress-image.ts:152-160`, `:170`, `:178`, `:182`, `:189`; `components/ui/file-drop.tsx:100`
**Scenario:** `passThrough()` returns the untouched original (within 4 MB) when decode fails, the 2D context is missing, `toBlob` returns null, the smallest result is
over the limit, or any exception is caught; `FileDrop` also falls back to `row.file` if `prepare` throws. The acceptance is "no location metadata before upload", but
every fallback skips `stripJpegMetadata`. A phone JPEG under 4 MB that the engine cannot decode (progressive, CMYK, memory pressure on a low-end Android) reaches
Storage with its Exif GPS, for a patient's report photographed at home. The notes declare the pass-through, not the privacy consequence.
**Fix:** In `passThrough()` run `stripJpegMetadata` on the bytes of a JPEG original (cheap, no decode), and refuse (or strip the `eXIf`/XMP chunks of) a PNG/WEBP original instead of sending it as is. Add a unit case: undecodable JPEG with an APP1 segment leaves the module without APP1.

### A-7: Registration still writes "No known allergies" by default through the public API and the column default
**File:** `app/api/v1/patients/route.ts:141` (`allergies: input.allergies || []`); `supabase/migrations/000006_appointments_queue_waitlist.sql:7` (`DEFAULT '{}'`, never dropped)
**Scenario:** The R-8 safety defect is fixed in `patient_input_normalize` and `newPatientPayload` only. A patient created through the v1 API (service role, still live
until V2-12) with no allergies is stored as `{}` and the consult shows "No known allergies" for a patient nobody asked, and the allergy check then runs against an empty
list. Any other insert that omits the column also gets `{}`. The plan's truth says registration "no longer records 'no known allergies' by default".
**Fix:** `allergies: input.allergies ?? null` in the v1 route (and its Zod default), and a migration `ALTER COLUMN allergies DROP DEFAULT` (expand/contract: no writer relies on it any more). Add a test on the v1 route.

### A-8: Recording allergies overwrites the whole list from a possibly stale snapshot
**File:** `components/clinical/allergy-editor.tsx:93-96`, `:118-129`; `supabase/migrations/000118_rx_allergy_check.sql:561-566`
**Scenario:** A consult page stays open for an hour. A nurse records "Penicillin" from the profile (or another consult tab). The doctor opens the strip's Edit, the
editor starts from `allergies` captured at page load (`initial`), the doctor adds "Sulfa" and saves: `record_patient_allergies` writes exactly that list, silently
removing "Penicillin". No version check, no merge, no audit of what was removed (the audit has counts only). Allergy data is the one list where a lost update is a
patient-safety event; a replacement of `[]` over a list is also possible by removing every entry (saved as "No known allergies" without the explicit button).
**Fix:** Send the list the editor was opened from (`p_expected`), refuse with a conflict that reloads when the stored list differs, or make the command additive/removal-specific. Require the explicit "No known allergies" choice to write `[]` over a non-empty list.

### A-9: The printed patient age comes from a stored integer: stale, missing for infants and for DOB-only patients
**File:** `features/prescriptions/pdf/payload.ts:165` (`age: patient?.age || null`); `features/prescriptions/pdf/content.ts:58`, `:65`
**Scenario:** `patients.age` is computed once at registration and never updated; `0` (a baby under one) is falsy and prints no age, and `patientLine` then reads
"Patient: Name (MALE)". The screen uses `formatAge(dob, today)`; the Rx does not. A three-year-old registration prints the registration-day age on today's Rx, and an
infant's prescription carries no age at all (dose is age/weight dependent). Pre-existing source, but this phase rewrote the content builder and the goldens freeze it.
**Fix:** Select `date_of_birth`, compute the age in the clinic zone with `formatAge`, print years/months, and treat `0` as a value. Add a golden case for an infant.

---

## Low

### A-10: A custom medicine named like a catalogue brand hides the catalogue row, and Enter on a failed search creates a custom medicine from the typed prefix
**File:** `supabase/migrations/000117_rx_lines_command.sql:154` (`NOT EXISTS (… custom … = c.brand_name)`); `components/clinical/rx-entry-row.tsx:537-548`, `:211-222`
**Scenario:** While the search route is failing (503/offline) "Add “amox”" is the only row, `waiting` is false, so Enter stores a custom medicine named `amox`. The
allergy rule can match it only by the word `amox`; an allergy "Amoxicillin" does not match. The row also joins the doctor's list and, once its name equals a
catalogue brand, the custom row replaces the catalogue row in every later search (no `cdci_brand_id`, no substance ids). Declared in part (NOTES 09C-01 #3).
**Fix:** Do not offer the create row (or do not let Enter pick it) while the search has failed; show custom and catalogue rows both when names collide.

### A-11: The Finish button does not wait for an in-flight or queued Rx command
**File:** `components/consultation/workspace/consult-workspace.tsx:524-527`; `components/consultation/workspace/use-rx-lines.ts:115-122`
**Scenario:** The hook serialises commands in a client chain; a command still waiting in that chain when Finish is pressed can run after the sign and fail with
`DRAFT_LOCKED` under the success sheet. The doctor thinks the last medicine was added. `rx.busy` exists but is not used.
**Fix:** Disable "Finish visit" (or await `rx` idle) while `rx.busy`; show the failed add in the sheet.

### A-12: Screen-reader users get no confirmation of adds and removes; tiles are toggle buttons that never toggle
**File:** `components/consultation/workspace/sections/prescription-section.tsx:298-336`, `:354-407`; `components/clinical/rx-entry-row.tsx:554-592`
**Scenario:** After Enter the dose builder (which holds the `role="status"` summary) unmounts and focus returns to the search field; the new line is added to a plain
`<ol>` with no live region. A tile tap adds three lines silently. The bundle/favourite `ChipGroup type="multiple" value={[]}` is announced as pressable toggles that
stay "not pressed".
**Fix:** One polite live region ("Paracetamol 650 added, 5 days" / "3 medicines added") fed by `useRxLines`; render the tiles as buttons, not a toggle group.

### A-13: Editing one field rewrites the stored duration wording
**File:** `features/prescriptions/lines.ts:14-21`, `:136-144`
**Scenario:** A stored "1 week" or "2 weeks" is read as 7/14 days; any edit (for example only the frequency) makes `lineToUpdate` compare `daysToDuration(7)` = "7 days" with
"1 week" and send a duration change the doctor did not make. Same value, different text on the printed Rx.
**Fix:** Compare by parsed days, and send `duration` only when the parsed days differ.

### A-14: The override evidence disappears with the line and the audit row cannot say what was overridden
**File:** `supabase/migrations/000118_rx_allergy_check.sql:338-341`, `:401-403`; `:316-317` (DELETE)
**Scenario:** `allergy_override` lives only on the item row; `prescription.lines_change` holds a count. Remove the line (or Undo fails per A-3) and the reason, the matched
allergen and the medicine are gone; the audit shows "allergy_overrides: 1" with no item or medicine reference. A later review cannot reconstruct which allergy was overridden.
**Fix:** Keep the reason out of audit metadata as ruled, but add the matched allergen count/ids or a separate append-only override log row (medicine, allergens, actor, time).

### A-15: The print view leaves the browser's own header and footer in the margins; the checklist says the stylesheet cannot fix this
**File:** `components/prescriptions/rx-print-view.tsx:196-204`; `.planning/phases/09C-rx-builder-pdf/09C-DEVICE-CHECKLIST.md:49-50`
**Scenario:** With non-zero `@page` margins Chrome prints its page title, date and the page URL (which contains the visit id) in the margin of the Rx handed to the
patient, and over the clinic's letterhead on pre-printed paper. The stylesheet can avoid it (`@page { margin: 0 }` with padding on the content, page numbers dropped or drawn in content).
**Fix:** Use zero `@page` margin and pad the article by the same lengths; keep headers/footers off by construction instead of asking the user.

### A-16: "Byte for byte" goldens depend on the zlib/Node/`@react-pdf` runtime; the archive holds whatever was rendered at first open
**File:** `tests/prescriptions/rx-golden.spec.ts:96-100`; `features/prescriptions/pdf/generator.ts:150-163`
**Scenario:** Compressed content streams can differ across Node majors (zlib builds), so a runtime bump turns every golden red with no template change (the notes
acknowledge the `@react-pdf` case). Separately, the archive is written when the signer first opens the record (or best-effort after sign), reading the clinic address,
margins and doctor name at that moment; an archive written a week later contains today's clinic details with `creationDate = signed_at`.
**Fix:** Pin the compare to the text goldens plus a structural check (page size, fonts, object count) and keep the byte compare only as `UPDATE_GOLDEN`-reviewed; document that the archive reflects the clinic details at archive time or snapshot them on the header at sign.

### A-17: "Same as last visit" and "Repeat this Rx" copy another doctor's signed Rx (declared, Q-14)
**File:** `supabase/migrations/000119_rx_assist.sql:344-351`; `components/consultation/workspace/consult-workspace.tsx:557`
**Scenario:** The brief for this review says own doctor only; the plan's R-10/Q-14 allows any doctor of the clinic. The copied lines then join this doctor's custom list and,
once signed, their favourites. Raised for the PO's attention only.
**Fix:** If own-doctor-only is the intent, add `v.doctor_id = v_uid` (or the visit's doctor) to the source predicate and the UI `lastSigned` filter.

### A-18: Compressed reports can become illegible without telling the doctor
**File:** `lib/files/compress-image.ts:36-46`, `:164-186`
**Scenario:** A noisy photo of a lab report is reduced to 0.64 x 2,000 = 1,280 px at quality 0.5 and accepted silently when it is under the server limit; small print and
radiograph detail can be lost, and the doctor sees only the file size. The result is stored as the patient's document.
**Fix:** Show the output size/dimensions on the row and warn when the last step was needed; offer "send original" for files that still fit the 4 MB limit (after stripping metadata).

### A-19: The success screen offers WhatsApp for an opted-out patient and shows "WhatsApp Sent" for a message the governance layer will suppress
**File:** `components/consultation/sign-and-bill-modal.tsx:~228-258` (`handleSendPrescriptionWhatsApp`); `features/prescriptions/service.ts:464-545`
**Scenario:** The review disables the checkbox for an opted-out patient, but the manual "WhatsApp" button on the success screen is always offered and `sharePrescriptionViaWhatsApp`
does not check `whatsapp_opt_out` or a draft/unsigned header; the enqueue succeeds, the UI says "WhatsApp Sent", and `message-send` later cancels it for the opt-out.
**Fix:** Pass `whatsapp.available` to the success screen and disable the button with the reason; check the opt-out in the service before enqueueing.

### A-20: A removed or mistaken line still becomes the doctor's "stored dose" for that custom medicine
**File:** `supabase/migrations/000117_rx_lines_command.sql:386-399` (same in 000118 and 000119)
**Scenario:** The custom-medicine upsert runs at add time with `default_* = EXCLUDED.*` (last used wins), not at sign and not "most frequent". A 10x typo that is removed one
second later is still the prefilled dose the next time that custom medicine is picked, and Enter, Enter adds it. R-4 says "has prescribed before", but the favourites use
the most frequent signed triple; the two "usual" notions disagree. `generic_name` is also overwritten with NULL when a later line omits it.
**Fix:** Update the stored defaults only when the visit is signed (or derive the custom row's prefill from the same signed-history source as favourites); keep `COALESCE(EXCLUDED.generic_name, existing)`.

---

_Reviewer: isolated Claude reviewer A. Read-only; no code, migration or database was changed._
