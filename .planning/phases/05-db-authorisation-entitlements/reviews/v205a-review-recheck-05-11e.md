# V2-05a adversarial re-check of the 05-11e fixes (NF-1, NF-2, NF-3)

- Commit: `d7e0501` (branch `v2/phase-05-db-authorisation-entitlements`). The local stack was already at `000077`
  (`select max(version) from supabase_migrations.schema_migrations`), so I did not reset it or run the seed.
- Method: I am an isolated re-checker with no implementer context. I re-ran the routes from
  `v205a-review-recheck-05-11d.md`, then looked for other ways to replace signed content without a faithful snapshot:
  - the order of amendment rows, and rows that are stale or unused;
  - concurrent amendments by two doctors (two real sessions);
  - forging `signed_at` and `signed_by`;
  - status tampering;
  - system-path rows;
  - deleting children and parents;
  - follow-ups;
  - visit-row attributes;
  - session time zones.

  I read `05-11e-AMENDMENT-SNAPSHOT-FIXES.md` only after my own probes.
- Every probe ran as `authenticated` on 127.0.0.1:54322. `request.jwt.claims` (`sub`, `role`) and `request.headers`
  (`x-clinicos-tenant`) were set the way PostgREST sets them. Single-session probes ran inside `BEGIN … ROLLBACK`.
  The concurrency races needed committed synthetic rows, which I removed afterwards with a scripted cleanup. Final
  check: 0 fixture users, tenants and visits.
- Synthetic fixture (ids `e11f…`):
  - Clinic: owner OA, doctors DR and DR2, receptionist RC and nurse NU; patients P1 and P2.
  - V1: DR's signed visit, with a note, Rx RX1 (Amoxicillin and Paracetamol), a diagnosis and a follow-up.
  - V3: DR's open visit for P2.
  - V4: DR's unsigned, open visit for P1 (Rx with Cetirizine).
  - V6: DR's signed visit (Doxycycline).
  - V7: DR's signed visit (Metformin and a follow-up).
- Scripts are in the session scratchpad, not the repo: `fx.sql`, `nf1.sql`, `nf2.sql`, `nf2b.sql`, `legit.sql`,
  `misc.sql`, `m2.sql`, `r1x/r1y`, `r2x/r2y`, `r3x/r3y.sql` and `cleanup.sql`.
- I did not run pgTAP. The `pgtap` extension is not installed on the shared stack, and I did not want to install it
  there.
- No source edits, commits or pushes. No `.env*` read. No hosted Supabase used.

## Summary

| ID | Status | One line |
|---|---|---|
| NF-1 | **CLOSED** | A row written before a signature, during another amendment, of an earlier signature, or by a concurrent transaction never reopens the current signature. The reopen needs the caller's database snapshot of exactly the current signature, written after the last reopen, and `current_revision` then moves past every row. |
| NF-2 | **CLOSED** | A decoy header on a signed visit is refused for every role. The snapshot holds every prescription with its items and the follow-ups. Header UPDATEs on a signed visit are still possible (known R-21), but they no longer hide signed medicines from the snapshot. |
| NF-3 | **CLOSED** | Re-keying, detaching, re-attaching, rescheduling, status changes, deletes and inserts on a signed visit's follow-up are refused. A patient mismatch is refused. Open visits and amendments still work. |

New findings: **0 High, 0 Medium, 2 Low** (NF-4, NF-5). Two informational notes for V2-09a. No regression on the
legitimate paths.

---

## NF-1 (CLOSED)

The original routes, re-run:

| Probe | Result |
|---|---|
| Route A: DR2 inserts an amendment row on unsigned V4 | `AMENDMENT_VISIT_NOT_SIGNED` (the owner gets the same) |
| DR writes the final note and signs V4; then DR2, and DR himself, reopen with no row | `VISIT_REOPEN_NEEDS_AMENDMENT` (both). V4 stays `completed`, `current_revision` 1, signed by DR. |
| Route B: DR amends V1 (row 1, reopen → `cur=2`); DR2 inserts a row while it is open | `AMENDMENT_VISIT_NOT_SIGNED` |
| DR edits and finalizes; DR2 reopens with no new row; DR reopens with his spent row | `VISIT_REOPEN_NEEDS_AMENDMENT` (both) |

Other routes tried:

| Probe | Result |
|---|---|
| **Stale row of an earlier signature** (V7): DR2 writes row 1 of signature S1 and does not use it; DR writes row 2, reopens (`cur=3`), edits and re-signs as S2; DR2 then reopens with row 1 | `VISIT_REOPEN_NEEDS_AMENDMENT` |
| Replaying a signature: DR finalizes with `signed_at` equal to S1's value and no signer change | `VISIT_SIGNED_STATUS_FORBIDDEN` (with no signature change, finalize is impossible) |
| DR2 finalizes with `signed_by = DR` | `VISIT_SIGNOFF_FORBIDDEN` |
| Reopen and re-sign in one statement | `VISIT_SIGNOFF_FORBIDDEN` |
| Re-sign without a reopen; clear the signature | `VISIT_SIGNOFF_FORBIDDEN` (both) |
| A signed visit set to `cancelled` (RC, DR, or DR2 while reopened) | `VISIT_SIGNED_STATUS_FORBIDDEN` |
| Write `current_revision` | `VISIT_REVISION_FORBIDDEN` |
| A client snapshot that claims `captured_by: database` with fake notes, `revision_number = 99` | Ignored: number 1, and the snapshot holds the real signed note |
| UPSERT (`ON CONFLICT DO UPDATE`) on `visit_revisions`; DELETE of revisions, visits, clinical_notes, prescriptions, patients | `permission denied` (no grant) |
| Clinical notes on a signed visit (DR2), and vitals (nurse) | `CLINICAL_NOTES_VISIT_SIGNED` |
| Legacy `visits.clinical_notes` columns (RC) | `23514 visits_clinical_content_moved` |
| Time zone: the row is written in an `Asia/Kolkata` session and the reopen runs in `America/Los_Angeles` | Reopen admitted (`cur=2`). The `signed_at` round trip is exact (`2030-01-07T10:00:00+05:30`). |
| Definer RPCs that `authenticated` can execute and that touch these tables (`consume_reschedule_token`, `issue_queue_token`, `create_share_token`, …) | None changes a signed visit's status or content. Reschedule acts only on `booked` and `confirmed` visits. |

**Concurrency** (two real sessions, committed synthetic rows, then removed):

| Race | Result |
|---|---|
| R1: DR2's transaction inserts a row and holds the visit lock for 3 s. DR's reopen with his own committed row starts 1 s later. | DR's reopen waits for the lock. Then `cur=3`, past DR2's concurrent row 2, so row 2 is spent. Later, after DR finalizes, DR2 reopening with row 2 gets `VISIT_REOPEN_NEEDS_AMENDMENT`. |
| R2: DR's amend and reopen are in flight, holding the lock. DR2 inserts a row 1 s later. | DR2 waits, then `AMENDMENT_VISIT_NOT_SIGNED` (the locking read sees the reopened version). |
| R3: DR and DR2 each hold a fresh row of the same signature. DR reopens, edits and re-signs in one transaction. DR2's reopen arrives during it. | DR2 waits, then `VISIT_REOPEN_NEEDS_AMENDMENT`: the trigger re-reads the new signature and the bumped `current_revision`. |

A user path cannot produce a row with `revision_number >= current_revision` unless it was written after the last
reopen while the visit was `completed` and signed. The signature cannot change without a reopen, which bumps the
counter. So every admissible row is a snapshot of the signed state being replaced. What could still differ between
the snapshot and the reopen is the Rx **header** fields (R-21, known), plus the visit attributes in NF-4.

## NF-2 (CLOSED)

| Probe | Result |
|---|---|
| Route C: DR2 inserts a decoy header `version = 99` on signed V6 | `PRESCRIPTION_VISIT_SIGNED` (the owner, and DR on his own visit, get the same) |
| Known R-21: DR2 sets RX6 to `version = 0, status = 'cancelled'` (UPDATE 1), then amends | The snapshot has 1 header, the item "Synthetic Doxycycline", and the follow-ups |
| DR2 reopens and deletes the signed medicine; adds a header while reopened | Both admitted (a legitimate amendment). 1 revision still holds Doxycycline. |
| A second header on an **unsigned** visit, added by another doctor before the signature (V4) | INSERT 1. After DR signs and amends, the snapshot holds **both** headers and Cetirizine. Faithful. See the informational note I-1 for what the app displays. |

## NF-3 (CLOSED)

| Probe | Result |
|---|---|
| DR2 moves V1's follow-up to P2 and V3; changes `visit_id` only; sets it to NULL | `FOLLOW_UP_KEY_IMMUTABLE` (all) |
| RC reschedules a signed visit's follow-up; sets `status = 'attended'` | `FOLLOW_UP_VISIT_SIGNED` (both) |
| DR deletes it; RC inserts a second follow-up on signed V1 | `FOLLOW_UP_VISIT_SIGNED` (both) |
| DR inserts a follow-up on V3 with patient P1 | `FOLLOW_UP_PATIENT_MISMATCH` |
| RC inserts a follow-up with no visit (admitted), then attaches it to signed V1 | `FOLLOW_UP_KEY_IMMUTABLE` |
| System path re-keys a follow-up | `FOLLOW_UP_KEY_IMMUTABLE` |
| Controls on open V3: DR inserts, RC reschedules, DR deletes | All admitted |

Locking `status` on a signed visit breaks no current app path: only `features/consultation/service.ts` writes
follow-ups. A future front-desk "attended" or reschedule path needs a carve-out (05-11e Deviation 6, V2-08).

## Legitimate paths

| Path | Result |
|---|---|
| Doctor signs V3 after writing a note, an Rx item and a follow-up; the app seals the Rx header | All admitted |
| **An unused row does not block another doctor**: DR2 writes row 1 on V1 and does not use it; DR writes row 2 and reopens | `cur=3`. DR's edits (note, dosage, follow-up date, Rx v2) and finalize are admitted. DR2's unused row 1 is then spent (`VISIT_REOPEN_NEEDS_AMENDMENT`). |
| **Second amendment by the other doctor**: DR2 writes row 3, reopens (`cur=4`), edits the note, deletes Paracetamol, moves the follow-up, sets Rx v3, finalizes | All admitted. The visit ends `completed`, signed by DR2. |
| Snapshot contents | Revision 1 (DR2, unused) and revision 2 (DR) both hold the original signed version: signed by DR, the note "Synthetic signed note V1", Rx v1 with Amoxicillin 1-0-1 and Paracetamol 0-0-1, the diagnosis, and the follow-up of 2030-01-10. Revision 3 (DR2) holds DR's signed amendment: "Synthetic amended note 1", Rx v2 with Amoxicillin 1-1-1 and Paracetamol 0-0-1, the diagnosis, and the follow-up of 2030-01-20. So every replaced signed version is captured, with every Rx item and the follow-up. |

## New findings

### NF-4 (Low) The front desk can change a signed visit's specialty and visit date with no amendment

`visits_integrity_guard` locks a signed visit's keys, doctor, signature and status. Every other column stays
writable by any `appointments:edit` holder (`visits_update`), including the receptionist. Two of those columns are
printed on the signed record:

- `specialty` is part of the amendment snapshot, so 05-11e itself treats it as signed content. It is printed on the
  Rx PDF and in `read-only-encounter-modal`, and it selects how `specialty_data` is read.
- `scheduled_at` is the Rx PDF's `visit_date` (`buildVisitPdfPayload`: `scheduled_at || created_at`). It is **not**
  in the snapshot.

Reproduction (`m2.sql`), as RC on DR's signed V6:
1. `update visits set scheduled_at = '2029-06-01 09:00+05:30'` gives UPDATE 1.
2. `update visits set specialty = 'dental'` gives UPDATE 1.
3. No amendment row is needed, no reopen happens, and no audit row is written on the Data-API path.

Impact:
- The date printed on a signed prescription can be moved, and the visit can be relabelled under another specialty.
  A regenerated PDF then backdates the prescription or mislabels it, and nothing records the change.
- No medicine, note or diagnosis changes, so this is Low. It sits close to document forgery: a prescription's date
  matters for certificates and for controlled medicines.

Fix: in `visits_integrity_guard`, on the user path, when `OLD.signed_at IS NOT NULL AND OLD.status = 'completed'`,
refuse changes to `specialty` and `scheduled_at` (`VISIT_SIGNED_FIELD_IMMUTABLE`). Allow them only while the visit is
reopened, and add `scheduled_at` to the snapshot's `visit` object. Front-desk rescheduling only ever applies to
unsigned visits (`booked` and `confirmed`), so no legitimate path is affected. Consider doing the same for
`reason_for_visit` if the record view shows it.

### NF-5 (Low) The signature time is supplied by the caller, so a signature can be backdated

Both at first sign-off and at finalize, the guard checks that `signed_at` is not NULL and changes. It never checks
the value. In probe `nf1.sql` C11, DR2 finalizes his amendment of V7 with `signed_at = '1999-01-01'` and gets
UPDATE 1. The Rx PDF prints `rx.signed_at || visit.signed_at`.

- This does not allow replacing content without a snapshot: the revision row still carries the database's
  `amended_at`.
- But the visible signature time of a signed record is whatever the signer wants, in the past or the future.
- 05-11e Deviation 2 notes that `signed_at` comes from the client, and the fix works around it by also comparing
  `signed_by`. The timestamp itself stays forgeable.

Fix: in `visits_integrity_guard`, when the signature changes on the user path, set `NEW.signed_at := now()`. The app
already sends `new Date()`, so nothing visible changes. The Rx header's `signed_at` goes to V2-09a (R-21) with the
header lock.

### Informational (V2-09a, not new findings)

- **I-1. Another doctor's empty header becomes "the" Rx of an unsigned visit.** `prescriptions_insert` needs only
  `prescriptions:edit`, and the guard requires `doctor_id = caller`, not the visit's doctor. So DR2 can add an empty
  `version = 99` header to DR's unsigned V4 (`nf2b.sql` E9). After DR signs, the app's latest-version read (record,
  PDF, finalize) returns DR2's empty v99 header (E13: v99, doctor DR2, 0 items). The snapshot is faithful (it holds
  both headers), so this is the header-display problem of R-21. V2-09a's header RPC should also bind header creation
  to the visit's doctor, or to the amendment author.
- **I-2. Legacy 05-11d rows.** A database that ran 000075–000076 with real users could hold a 05-11d row taken of
  the current signature after an NF-2 decoy. Such a row still opens the visit under 000077 (status, `signed_at` and
  `signed_by` match), with a snapshot that lacks `prescriptions`. No v2 production database exists, so this is
  informational only. If one is ever migrated, bump `current_revision` past existing rows once in 05-b0.

## Already-known items seen again (not re-reported)

- Rx header UPDATE on a signed visit (`version`, `status`): V2-09a R-21.
- Service-role and system-path writers, including system-path amendment rows: N-9, V2-09a and P1-37.
- Front-desk completion of unsigned visits: N-4.
- No mounted amendment UI.
