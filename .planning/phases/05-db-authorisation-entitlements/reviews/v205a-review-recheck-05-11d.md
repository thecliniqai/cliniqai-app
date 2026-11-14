# V2-05a adversarial re-check of the 05-11d fixes (N-1, N-2, N-3, N-6)

- Commit: `903df53` (branch `v2/phase-05-db-authorisation-entitlements`). Local stack at `000076`
  (`select max(version) from supabase_migrations.schema_migrations` → `000076`). No reset was needed or run.
- Method: isolated re-checker with no implementer context. For each finding I re-ran the original reproduction from
  `v205a-review-reverify.md`, then looked for a different route to the same outcome: other columns, other tables,
  INSERT vs UPDATE vs DELETE, NULLs, trigger order, definer RPCs, multi-row statements and lock order. I read
  `05-11d-REVERIFY-FIXES.md` only after the probes.
- Every probe ran on 127.0.0.1:54322 as `authenticated`, with `request.jwt.claims` (`sub`, `role`) and `request.headers`
  (`x-clinicos-tenant`) set the way PostgREST sets them, inside `BEGIN … ROLLBACK`.
- Synthetic fixture (ids `e0de…`): clinic A with owner OA, admin AD, doctors DR and DR2, receptionist RC and nurse NU;
  patients P1 and P2.
  - V1: DR's signed, completed visit for P1, with a note, Rx RX1 (one item), a diagnosis, a follow-up and invoice I1
    (₹500).
  - V3: DR's open visit for P2, with Rx RX3.
  - V4: DR's open, unsigned visit for P1, with Rx RX4 and invoice I4 (₹300).
- Afterwards no fixture rows were left (0 users, tenants and visits).
- Probe scripts are in the session scratchpad, not in the repo: `fx.sql`, `n1.sql`, `n2.sql`, `n2b.sql`, `n2c.sql`,
  `n2d.sql`, `n3.sql`, `legit.sql`.
- N-6 was re-run with `npx vitest run tests/api/v1-patients-no-clinical.spec.ts`: 5/5 passed. The first attempt hit
  the shared run lock held by another agent. The retry passed, and I did not change anything in between.
- No source edits, commits or pushes. No `.env*` read. No hosted Supabase used.

## Summary

| ID | Status | One line |
|---|---|---|
| N-1 | **CLOSED** | Re-keying, editing, deleting and inserting Rx items and diagnoses on a signed visit are all refused, on every path for keys. Sibling gaps: the Rx header (known, V2-09a) and `follow_ups` (new Low, NF-3). |
| N-2 | **PARTIAL** | The client snapshot and number are ignored, and the snapshot is faithful when it is taken. But the reopen gate accepts an amendment row written **before** the signature it reopens, so a signed version can be replaced and never snapshotted (NF-1). A decoy Rx header also steers the snapshot away from the signed medicines (NF-2). |
| N-3 | **CLOSED** | MI5, MI6 and MI7 are refused, and the forged `total_price` is recomputed. I found no other route to "paid" or to "zero balance after collection". The legitimate billing paths work. |
| N-6 | **CLOSED** | `PUT /api/v1/patients/:id` refuses `allergies` and `chronic_conditions` with 403. POST at creation and GET reads are on the P1-37 list. They match the app's UPDATE-only guard. |

New findings: **2 Medium** (NF-1, NF-2; both reopen N-2's outcome) and **1 Low** (NF-3). No legitimate-path regression.
One behaviour change is documented and intended: a charge can no longer be added to a fully paid invoice.

---

## N-1: children of a signed encounter (CLOSED)

Original reproduction, as DR2 on DR's signed V1:

| Probe | Result |
|---|---|
| `update prescription_items set prescription_id = RX3 where prescription_id = RX1` | `42501 PRESCRIPTION_ITEM_KEY_IMMUTABLE` |
| `update consultation_diagnoses set visit_id = V3` | `42501 DIAGNOSIS_KEY_IMMUTABLE` |
| the same with `patient_id = P2` | `42501 DIAGNOSIS_KEY_IMMUTABLE` |
| `update prescription_items set medicine_name, dosage` (signed RX1) | `42501 PRESCRIPTION_ITEM_VISIT_SIGNED` |
| `delete from prescription_items` (RX1) | `42501 PRESCRIPTION_ITEM_VISIT_SIGNED` |
| update and delete of the signed diagnosis | `42501 DIAGNOSIS_VISIT_SIGNED` (both) |

Other routes tried:

| Probe | Result |
|---|---|
| INSERT an item into signed RX1 | `PRESCRIPTION_ITEM_VISIT_SIGNED` |
| the same with an explicit `tenant_id = NULL` (the fill-tenant trigger runs first, by name order) | `PRESCRIPTION_ITEM_VISIT_SIGNED` |
| INSERT a diagnosis on signed V1 | `DIAGNOSIS_VISIT_SIGNED` |
| INSERT a diagnosis with `patient_id = NULL` on open V3 | `DIAGNOSIS_PATIENT_MISMATCH` |
| Re-key the Rx header (`visit_id`, `patient_id`) | `PRESCRIPTION_KEY_IMMUTABLE` (05-11a) |
| Receptionist or nurse edits a signed item | 0 rows (RLS) |
| System path: move an item | `PRESCRIPTION_ITEM_KEY_IMMUTABLE` |
| `has_permission` vs `authz.tenant_ids_with` (could a guard's admission check differ from the policy?) | Same function underneath, so no divergence |

Controls:

| Control | Result |
|---|---|
| DR edits an item on open V4 | UPDATE 1 |
| DR adds a diagnosis for V4's own patient | INSERT 1 |
| During a legitimate amendment, items and diagnoses are editable, and locked again after finalize | yes (`n2b`/`n2c`) |

Not N-1 itself, but on the same surface:
- **Rx header on a signed visit.** Any `prescriptions:edit` holder can still update a signed header (`version`,
  `status = 'cancelled'`; probe R4: UPDATE 1). DR2 can also INSERT a second, empty header on DR's signed V1 with
  `version = 2` (probe R3: INSERT 1). The app reads the latest version (`buildVisitPdfPayload`, `order version desc
  limit 1`), so V1's record and any regenerated PDF now show DR2's empty Rx instead of the signed medicines. The
  signed rows still exist. Deviation 5 of 05-11d sends header locking to V2-09a (R-21). The INSERT variant belongs
  with it, and V2-09a must also refuse a **new** header on a signed visit, not only edits. Its effect on N-2 is NF-2.
- **`follow_ups`** is a child of the visit with no guard (NF-3).

## N-2: amendment snapshot (PARTIAL)

Original reproduction, as DR2 on V1:

| Probe | Result |
|---|---|
| `insert visit_revisions(snapshot = '{}', revision_number = 2147483647)` | INSERT 1. Returns `revision_number = 1` and `captured_by = database`. The snapshot holds the signed note, 1 Rx item and 1 diagnosis. The client values are ignored. |
| UPDATE or DELETE `visit_revisions` | `permission denied` |
| Receptionist INSERT | `AMENDMENT_FORBIDDEN` |
| Forged `amended_by` | `AMENDMENT_AUTHOR_NOT_CALLER` |

Legitimate path: DR amends V1 twice in the app's order (insert the revision, reopen, edit the note, item and
diagnosis, bump the Rx version, finalize; then again). It works. Revision 1's snapshot is the original signed
content: note "Synthetic signed note", dosage 1-0-1, Rx v1. Revision 2's snapshot is the amended, re-signed content:
"Synthetic amended note 2", dosage 1-1-1, Rx v2. `current_revision` goes 1 → 2 → 3.

The gap is in the reopen gate, not in the snapshot. See NF-1 and NF-2.

### NF-1 (Medium) A pre-positioned amendment row reopens a later signature, so that signed version is never snapshotted

`visits_integrity_guard` admits `completed → in_consultation` when the caller has **any** own revision with
`revision_number >= OLD.current_revision`. It does not check that the row was written for this signature.
`visit_revisions_actor_guard` accepts a row on a visit in any state, and `current_revision` does not change at
sign-off. So a row written while the visit is unsigned, or while it is open for someone else's amendment, later
reopens the newly signed version. That version is never captured.

Route A (`n2.sql`, V4 unsigned):
1. DR2 inserts an amendment row on unsigned V4. It gets number 1. Its snapshot holds status `in_consultation`,
   unsigned, and the draft note.
2. DR writes "Synthetic FINAL signed note V4" and signs V4 (`completed`, `signed_by` DR).
3. DR2 sets `status = 'in_consultation'` with **no new amendment row**. UPDATE 1, `current_revision` → 2.
4. DR2 rewrites the note and deletes the Rx item (UPDATE 1, DELETE 1). DR2 then finalizes, signed by DR2 (UPDATE 1).
5. Result: the only revision of V4 is 1, with status `in_consultation`, unsigned, and the draft note. No snapshot
   contains DR's signed note or his Rx item. No audit row exists: a direct Data-API run writes none.

Route B (`n2b.sql`, V1 during DR's legitimate amendment):
1. While V1 is reopened (`current_revision` 2), DR2 inserts a row. It gets number 2, with status `in_consultation`.
2. DR makes his final edit ("… FINAL") and finalizes.
3. DR2 reopens V1 with no new row. UPDATE 1, `current_revision` → 3.
4. No snapshot holds DR's final amended content.

Impact: the N-2 outcome. Any `consultations:edit` holder (any doctor, or the owner) can replace a signed note, Rx
items and diagnoses, and leave no faithful record of what was signed. The row is attributed to the attacker, so it
can be detected, but it records the wrong content. 05-11d Deviation 4 says "a row on an unsigned visit opens
nothing, because reopen is gated on signed visits only". That reasoning does not hold: the row opens the visit
**after** it is signed.

Fix (local, no matrix flip needed). Do either or both:
- **(a) In `visits_integrity_guard`, tie the reopen to the signature.** Require a caller's revision whose snapshot was
  taken of this signed state:
  - `revision_number = OLD.current_revision`;
  - `snapshot->'visit'->>'status' = 'completed'`;
  - `(snapshot->'visit'->>'signed_at')::timestamptz = OLD.signed_at`.
- **(b) In `visit_revisions_actor_guard`, refuse a user-path row unless the locked visit is signed and `completed`.**
  This needs the authz matrix fixture to use a signed visit for the `visit_revisions` INSERT cells.

(a) alone closes both routes and keeps Deviation 4. Add a pgTAP case for each route.

### NF-2 (Medium) A decoy Rx header steers the amendment snapshot away from the signed medicines

The snapshot records only `the latest prescription` (`ORDER BY version DESC LIMIT 1`), and a header can still be
inserted or re-versioned on a signed visit (see N-1, Deviation 5). Route C (`n2d.sql`), as DR2 on DR's signed V1:
1. DR2 inserts an empty prescription for V1 with `version = 99`. INSERT 1.
2. DR2 inserts an amendment row. The snapshot holds `prescription.version = 99` with 0 items.
3. DR2 reopens V1 and deletes RX1's items: "Synthetic Amoxicillin", the signed medicine. DELETE 1.
4. No revision snapshot contains the signed medicine.

The same works by lowering RX1's `version` below a second header.

Impact: the amendment history of a signed prescription, the part of the record with the most patient-safety weight, is
whatever the amending doctor arranges. Same severity as N-2.

Fix (cheap, independent of V2-09a): snapshot **every** prescription of the visit with its items
(`jsonb_agg(... ORDER BY version, created_at, id)` under the visit lock), not only the latest one. Header locking stays
with V2-09a. That RPC must also refuse a new header on a signed, not-reopened visit, because a decoy also changes what
the record and PDF show (N-1 note above).

## N-3: invoice settled or zeroed through items (CLOSED)

Original reproduction, on I1 (₹500), after RC records an advance of ₹200 through `record_payment`:

| Probe | Result |
|---|---|
| MI5: DR (the visit's doctor) sets the item to 200 (= collected) | `INVOICE_BELOW_COLLECTED` |
| the same at 150 | `INVOICE_BELOW_COLLECTED` |
| `quantity = 0` | `INVOICE_BELOW_COLLECTED` |
| MI7: DR sets `total_price = 0` | UPDATE 1, but `total_price` is recomputed to 500.00 |
| MI6: a negative item | `23514 invoice_items_unit_price_nonnegative` |
| `unit_price 0` with a forged `total_price -300` | Stored as 0.00 |

Other routes tried:

| Probe | Result |
|---|---|
| RC deletes the item, leaving the bill below the collected amount | `INVOICE_BELOW_COLLECTED` |
| DR moves the item to another invoice | `INVOICE_ITEM_KEY_IMMUTABLE` |
| DR2, not the visit's doctor, lowers the item | 0 rows (RLS) |
| Direct `invoices.status` update; INSERT, UPDATE or DELETE on payments | `permission denied` |
| Two items lowered in one statement (CTE UPDATE) to a total equal to the amount collected (the second row's trigger sees the first row's new value) | `INVOICE_BELOW_COLLECTED` |
| Adding to or lowering the items of a paid invoice | `INVOICE_ITEMS_LOCKED` |
| NULL handling | `unit_price`, `quantity` and `total_price` are NOT NULL; `quantity > 0` and the two new CHECKs are validated |

Write paths into `invoices`:
- Only `record_payment` and the definer sync trigger write the table. The sync trigger can only demote `paid` to
  `issued`.
- `invoices_insert_guard` refuses a `paid` INSERT and recomputes the total.

Lock order: the guard takes `invoices FOR UPDATE` before it reads payments, and `record_payment` takes the same lock
first, so a concurrent payment and reduction serialise.

Residual, by design (05-11d "N-3 rule"): before anything is collected, the doctor can still set their own visit's fee
to 0, or give a discount at Sign & Bill. I4 → 0.00/issued, and `record_payment` then answers `OVERPAYMENT`. That is
the PO-3 own-visit carve-out, not a collection bypass. One wording point: the 000075 header says a zero-balance
`issued` invoice "cannot be produced through items". That holds only once money has been collected.

## N-6: `/api/v1/patients` clinical fields (CLOSED)

- `PUT /api/v1/patients/:id` checks `hasPatientClinicalField(body)` (an own property, `null` included) before parsing.
  It answers 403 `CLINICAL_ACCESS_DENIED`, and the zod schema no longer contains the fields.
  `tests/api/v1-patients-no-clinical.spec.ts`: 5/5 pass, covering 403, an unchanged row, no audit row, and
  demographics still updating. The test drives the real route handler.
- No PATCH handler exists. No other `/api/v1` route writes the fields:
  - POST writes them at creation, matching the app's registration (`patients_clinical_fields_guard` is BEFORE UPDATE
    only).
  - GET returns them.
  - Both are recorded on the P1-37 list in the 05-11d hand-off.

## Legitimate paths (no regression)

| Path | Result |
|---|---|
| Doctor Sign & Bill on V3 | All four steps succeed: sign, seal the Rx header, insert the invoice (subtotal 650, discount 50), insert 2 items. Result: 650/600/issued. A doctor without `billing:collect` calling `record_payment` gets `FORBIDDEN`, as PO-3 requires. |
| Receptionist checkout with an advance | RC pays ₹100 (issued). DR adds a ₹200 charge while a balance is due (850/800/issued). RC collects ₹700 → `paid`. On I1, RC also lowers an item while a balance remains (₹400 total > ₹200 collected), and OA collects the remaining ₹200 → `paid`. |
| Adding a charge after signing while a balance is due | INSERT 1, and the totals follow. |
| Owner records a payment | OA pays I4 in full → `paid`. |
| Amending a signed visit twice | Works, and each snapshot is the previous signed content (see N-2). |

Documented behaviour change, not a regression: after an invoice is fully paid, the front desk can no longer add a
charge (`INVOICE_ITEMS_LOCKED`; 05-11d "N-3 rule", V2-10). The drawer must show that refusal clearly.

## NF-3 (Low) `follow_ups` of a signed visit can be moved to another patient and edited

`follow_ups` has no guard. Its `patient_id` is not tied to its visit's patient, and its keys are mutable:
- As DR2: `update follow_ups set visit_id = V3, patient_id = P2` on V1's follow-up gives UPDATE 1.
- As RC: changing V1's `follow_up_date` gives UPDATE 1.

`buildVisitPdfPayload` prints the follow-up date on the prescription PDF, which is regenerated at amendment. So
patient One's follow-up can show up on patient Two's prescription. This is scheduling data rather than a clinical
finding, and the front desk legitimately reschedules follow-ups, so it is Low.

Fix: make `id`, `tenant_id`, `visit_id` and `patient_id` immutable, and on INSERT require `patient_id` to equal the
visit's patient (the `consultation_diagnoses` pattern). Leave `follow_up_date` and `status` editable.
