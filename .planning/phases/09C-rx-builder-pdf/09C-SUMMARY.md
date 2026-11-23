# V2-09c Rx builder & PDF: summary

**Outcome:** prescribing is rebuilt for keyboard and tap speed, and the database now enforces its safety:
- Every line goes through one command, and a recorded allergy blocks a matching line unless the doctor gives a reason.
- Suggestions come only from the doctor's own signed history, and no dose is ever invented.
- The PDF and print copy follow the clinic's paper and stationery settings.

Branch `v2/phase-09c-rx-builder-pdf`, PR #17 into `feature/v2`, merged as `7160fc1`.

## What shipped

| Plan | Migration | Changes |
|---|---|---|
| 09C-01 | 000117 | `change_prescription` definer command (direct DML on `prescription_items` revoked); `search_medicines` invoker plus a GET route; keyboard Rx builder (cmdk); the v1 builder and chips deleted |
| 09C-02 | 000118 | Allergy check before any write (`ALLERGY_MATCH`, override reason stored); `record_patient_allergies`; substance typeahead; three allergy states (not recorded, none, list) |
| 09C-03 | 000119 | Own-doctor favourites and "your usual" in `consult_assist_context`; `repeat_visit_plan` ("Same as last visit") skips allergy matches; the old frequent-Rx path deleted (SA-02) |
| 09C-04 | — | Shared PDF and print content; A4/A5, blank or pre-printed, margins; clinic-zone dates; no patient name in the file name; deterministic bytes; print stylesheet; "Prescription printing" settings card |
| 09C-05 | — | Finish review (Sign disabled on an unresolved match), Print and Share PDF, camera capture with compression and metadata strip, WhatsApp at sign opt-in, PO kit |
| 09C-06a | 000120 | Review fixes: catalogue name binding plus name-or-substance match (S-1), audit trigger on every allergy write (S-2), allergies default NULL, no writes to erased patients, own custom medicines only, `FOR SHARE` lock, stale-list conflict; UI reconciliation after lost responses, per-line allergy recovery, read-only Rx for non-prescribers |
| CI fixes | — | `today-signals` waits for the Realtime event quota; a design spec follows the 09C-02 message; the `commitThenAbort` harness no longer unroutes |

## Behaviour changes users may notice

- New patients show "Allergies not recorded" until someone records allergies.
- Signing no longer sends WhatsApp automatically. The doctor ticks the box, and the manual buttons still work.
- A prescription line that matches a recorded allergy needs a reason of at least 5 characters.
- Enter alone no longer creates a custom medicine when nothing matches.
- The PDF file name is `Prescription-{date}-v{n}.pdf`.
- Babies' ages print in months or days.

## Backlog added (owner)

| Item | Owner |
|---|---|
| Today board silently stale while the Realtime event quota is tripped (bulk writes); slow refresh while live | PO decision (09C-P7); V2-14 |
| Two doctors with visits today overflow Today by 10 px at 820×1180 | V2-14 |
| Custom medicine named like a catalogue brand hides the catalogue row (A-10) | V2-14 |
| A partial edit rewrites the duration wording (A-13) | V2-14 |
| Warn when compression drops a report below legibility (A-18) | V2-14 |
| Only a signed line should update a custom medicine's stored dose (A-20) | V2-14 |
| Receipt WhatsApp share: opt-out is checked on screen only; manual Rx share does not check the Rx is signed | V2-10 |
| Allergy saves write two audit rows (command and trigger); reports must pick one | V2-13 (reports) |
| Devanagari names in the PDF (standard fonts) | P3 Hindi printing |
| Consult route JS 387.7 kB (budget 200 kB, report-only) | V2-14 |
| v1 API Rx writer (AR-09C-01) and route rate limits (AR-09C-02) | V2-12 |
