---
phase: 05
plan: 05-11e
subsystem: amendment snapshot integrity (re-check of the 05-11d fixes)
status: complete
findings: [NF-1, NF-2, NF-3]
migrations: [000077_amendment_snapshot_integrity]
plan_head_before: 903df53
commits: [2a7b1b9, 2c01544, 6f1e624, docs commit]
code_head_after: 6f1e624
---

# 05-11e record: a signed visit is replaced only after a faithful snapshot

**Outcome:** done locally. The re-checker's report at `903df53` (`reviews/v205a-review-recheck-05-11d.md`) found 2
Medium (NF-1, NF-2) and 1 Low (NF-3). All three are fixed in one migration, `000077`. No 000078 was needed: it adds
guards only, with no constraint to validate and no data to move (a report-only diagnostic, D1f, covers legacy
follow-ups). Every fix has a pgTAP regression test built from the re-checker's own probes, and those tests fail at
`000076`. Every probe in the report was re-run at `000077`; the results are below and in
`evidence/05a/05-11e/probes-recheck-at-000077.txt`. Nothing hosted was contacted, and every Supabase CLI call used
`--local`.

## Finding → fix → test → fails without

| Finding (re-check probe) | Fix (000077) | Regression test (`amendment_snapshot.test.sql`) | At 000076 |
|---|---|---|---|
| **NF-1** route A (`n2.sql`): an amendment row written on an **unsigned** visit later reopens the signed version, which is then replaced and never snapshotted | (a) `private.visit_revisions_actor_guard`: a signed-in caller writes an amendment row only on a visit that is signed and `completed`, checked under the visit row lock (42501 `AMENDMENT_VISIT_NOT_SIGNED`); (b) `private.visits_integrity_guard`: `completed → in_consultation` needs the caller's row whose **database** snapshot is of the current signature (snapshot status `completed`, `signed_at` and `signed_by` equal the visit's), numbered at or after `current_revision`. `current_revision` then moves past every amendment row of the visit | 1 (row refused), 4 (a system-path row taken before the signature does not reopen), 5-7 (so the signed note and Rx item stay), 8-10 (a row written after the signature is a snapshot of the signed note and reopens) | 1, 4-9 fail (the row is admitted, the reopen succeeds, the note is replaced) |
| **NF-1** route B (`n2b.sql`): a row written while another doctor's amendment is open reopens the re-signed version | same | 13 (row refused while open), 16 (a system-path row taken while open does not reopen), 17-20 (a row of the re-signed version holds the final note and reopens); 22-25 (two rows of one signature: either reopens, the unused one is then spent); 26 (a malformed legacy snapshot never matches and never raises 22007) | 13, 16, 18, 22, 25, 26 fail |
| **NF-2** route C (`n2d.sql`): a decoy prescription header on a signed visit steers the snapshot away from the signed medicines, which are then deleted | (a) the snapshot holds `prescriptions`: every prescription of the visit with its items (ordered by version, created_at, id), and `follow_ups`; the 05-11d key `prescription` (latest) is kept for its readers; (b) `private.prescriptions_actor_guard`: a signed-in caller inserts a header only while the visit is unsigned or reopened (42501 `PRESCRIPTION_VISIT_SIGNED`) | 27 (decoy refused), 29-30 (with a system-path decoy present, the snapshot still holds both headers and the signed medicine), 33 (after the signed medicine is deleted in the amendment, a snapshot still holds it), 34-35 (a header can be added while reopened, and on an open visit) | 27, 29, 30, 33 fail (decoy admitted; the snapshot holds only the empty decoy) |
| **NF-3** (`n1.sql` R7, R7b): a signed visit's follow-up is moved to another patient or rescheduled | new `private.follow_ups_integrity_guard` (BEFORE INSERT/UPDATE/DELETE, INVOKER), the `consultation_diagnoses` pattern: keys (`id`, `tenant_id`, `patient_id`, `visit_id`) never change on any path, except that the system path may clear `visit_id` once its visit is gone (the FK's `ON DELETE SET NULL (visit_id)`); a signed-in caller ties a follow-up only to a visit of the same patient, and writes (insert, update, delete) the follow-up of a signed visit only while it is reopened. A visit the caller cannot see counts as locked. 42501 `FOLLOW_UP_KEY_IMMUTABLE` / `FOLLOW_UP_PATIENT_MISMATCH` / `FOLLOW_UP_VISIT_SIGNED` | 36-38 (re-key, reschedule, delete on a signed visit), 41 (insert on a signed visit), 42 (patient mismatch), 43 (system-path patient change); 39-40, 44-48 controls (amendment, open visit, front desk, no-visit follow-up, "None" clears) | 36-38, 41-43 fail |

Totals: `amendment_snapshot.test.sql` has 60 cases. At `000076` 27 fail and 33 pass
(`pgtap-amendment_snapshot-without-000077.tap`). 23 of the failures are the NF cases above. The other 4 are
legitimate-path cases: 50, 51 and 56 read the new snapshot keys (`prescriptions`, `follow_ups`), and 53 finds the
follow-up already deleted by the attack that 000076 admitted (case 38). The 33 that pass are controls and
legitimate-path steps. With `000077` all 60 pass
(`pgtap-amendment_snapshot-with-000077.tap`). Both runs were one rolled-back transaction on the shared stack, under the
test-run lock.

## Legitimate paths

| Path | Where proven |
|---|---|
| Amend a signed visit twice; each snapshot is the previous signed version with **every** Rx item and the follow-up | pgTAP 49-60 (revision 1 holds both signed items, the signed note and follow-up; revision 2 holds the amended note, both dosages, Rx v2 and the moved follow-up; revision 1 is unchanged afterwards); re-checker `n2c.sql` at 000077 (revs 1 and 2 as before) |
| The app's latest-version read (`order by version desc limit 1`: `buildVisitPdfPayload`, `finalizeVisitAmendment`) | pgTAP 60 (after two amendments it finds the amended prescription); no app read changed. Decoys can no longer be added on a signed visit, so the read cannot be steered by a new header |
| Doctor sign and Sign & Bill | re-checker `legit.sql` at 000077 (S1-S11, O1-O3 as in the report); full Vitest (`consultation-service-guards`, `collect-permission`, `review3-fixes-db`); e2e PR lane |
| App amendment flow (reopen, edit items, finalize) | `tests/integration/prescription-versioning.spec.ts` (now also asserts `snapshot.prescriptions`); `consultation-service-guards.spec.ts` (reopen a signed visit). There is **no mounted UI amendment flow**: `components/consultation/amendment-modal.tsx` is not used by any page, and no e2e spec amends (see Open items) |
| Follow-up scheduling | pgTAP 39-40, 44-48; `tests/integration/consultation-flow.spec.ts` (doctor records a follow-up), `tests/security/cross-tenant-refs.spec.ts` (recordFollowUp), `delete_rules.test.sql`, `composite_fks.test.sql` (SET NULL on visit delete keeps working) |

## Probes of the re-check report, re-run at 000077

All eight scripts (`fx.sql` fixture plus `n1`, `n2`, `n2b`, `n2c`, `n2d`, `n3`, `legit`) were run unchanged, each in
`BEGIN … ROLLBACK`; afterwards 0 fixture users and tenants remained.

| Probe | At 903df53 (report) | At 000077 |
|---|---|---|
| `n2` A1: DR2 writes an amendment row on unsigned V4 | INSERT 1 | `AMENDMENT_VISIT_NOT_SIGNED` |
| `n2` A4: DR2 reopens the signed V4 with no new row | UPDATE 1 | `VISIT_REOPEN_NEEDS_AMENDMENT` |
| `n2` A5/A5b/A6: rewrite the note, delete the item, finalize | UPDATE/DELETE/UPDATE 1 | `CLINICAL_NOTES_VISIT_SIGNED` / `PRESCRIPTION_ITEM_VISIT_SIGNED` / `VISIT_SIGNOFF_FORBIDDEN` |
| `n2b` B1: DR2 writes a row during DR's open amendment | INSERT 1 (number 2) | `AMENDMENT_VISIT_NOT_SIGNED` |
| `n2b` B2: DR2 reopens the re-signed V1 with no new row | UPDATE 1 | `VISIT_REOPEN_NEEDS_AMENDMENT` |
| `n2d` C1: DR2 inserts a decoy Rx v99 on signed V1 | INSERT 1 | `PRESCRIPTION_VISIT_SIGNED` |
| `n2d` C2/C5: snapshot after the decoy; any snapshot with the signed medicine | v99, 0 items; 0 | v1, 1 item; 1 |
| `n1` R3: decoy header (v2) | INSERT 1 | `PRESCRIPTION_VISIT_SIGNED` (R3b: the latest Rx is still the signed one, 1 item) |
| `n1` R7: follow-up re-keyed to P2/V3 | UPDATE 1 | `FOLLOW_UP_KEY_IMMUTABLE` |
| `n1` R7b: receptionist reschedules a signed visit's follow-up | UPDATE 1 | `FOLLOW_UP_VISIT_SIGNED` |
| `n1` R4: lower the signed Rx header's version / cancel it | UPDATE 1 | UPDATE 1 (unchanged: header UPDATE locking stays with V2-09a, R-21; the snapshot now holds every header, so this no longer hides anything from the amendment record) |
| `n1` N1a-N1i, R1, R2, R5, R6, R8, R9, L1, L2 | as in the report | unchanged (all refused; controls admitted) |
| `n2` N2a-N2e | as in the report | unchanged (database snapshot and number; UPDATE/DELETE denied; receptionist and forged author refused) |
| `n2c` (legitimate, twice) | revs 1 and 2 faithful | unchanged |
| `n3` (N-3 invoice probes) | as in the report | unchanged (MI5/MI6/MI7 refused or recomputed; legitimate collection paths admitted) |
| `legit` (Sign & Bill, checkout) | as in the report | unchanged |

## Deviations

1. **The reopen rule is "at or after `current_revision`", not "equal to".** The brief and the re-checker's fix (a)
   name `revision_number = OLD.current_revision`. With amendment rows now written only on a signed, completed visit,
   two rows can still be written of the same signature (two doctors open the amendment dialog). Under an equality rule
   the first, unused row would take the number, and every other doctor's row would be numbered after it, so nobody
   else could ever reopen the visit (only the first writer). Both rows are snapshots of the same signed state, so
   either is faithful. The security property the finding needs, "the row was written for this signature", is carried
   by the snapshot match (status `completed`, `signed_at`, `signed_by`) plus "written after the last reopen" (number
   at or after `current_revision`). After a reopen, `current_revision` moves past **every** amendment row of the
   visit (the 05-11a guard moved it past the caller's own rows only), so no existing row can reopen a later
   signature. pgTAP 22-25.
2. **`signed_by` is compared as well as `signed_at`.** A finalize must change the signature, but `signed_at` is
   supplied by the client, so a finalizer could repeat an earlier `signed_at` with a different signer. Comparing both
   ties the row to the exact signature. A malformed legacy snapshot (a client snapshot from before 000075) never
   matches and cannot raise: the cast runs inside an exception block (pgTAP 26).
3. **The amendment-row rule applies to signed-in callers only**, like every other guard of 05-11a/05-11d. A system-path
   row is still numbered and snapshotted by the database, but it can reopen nothing unless its snapshot is of the
   current signature (pgTAP 4, 16). The authz matrix's `visit_revisions` INSERT cells now use a new signed, completed
   fixture visit (`FX.visitSigned`); the expected outcomes are unchanged.
4. **[Rule 2] `POST /api/v1/prescriptions` applies the header rule itself.** It writes with the system client, so the
   database guard does not apply to it, and it added a new version on any visit. It now answers 409 `VISIT_LOCKED`
   ("Signed visits cannot be modified.") for a signed visit that is not reopened, the text and code of the v1 visit
   PATCH. Spec: `tests/api/v1-doctor-guard.spec.ts` (refused, no header written; admitted once reopened). v1 is off in
   every tier (PO-16); the route stays on the P1-37 list.
5. **[Rule 2] `reopenVisitForAmendment` refuses an unsigned visit up front** ("Only signed, completed consultations can
   be reopened for amendment."), instead of surfacing the database refusal as "Failed to create audit revision
   record.". Before 000077 a front-desk-completed, unsigned visit could be "amended": the row was written, the reopen
   was a plain status change, and finalize signed it. That path now ends at the first step. It was never offered in
   the UI (no amendment UI is mounted), and whether the doctor may sign a front-desk-completed visit is N-4's open
   question (V2-09a with V2-08).
6. **NF-3 locks status as well.** The re-checker suggested leaving `follow_up_date` and `status` editable; the brief
   asks for the full child-row rule ("writes on a signed visit only while reopened"), which is what is implemented. No
   app path writes a signed visit's follow-up today (the doctor's `recordFollowUp` runs in the draft and in an
   amendment; no front-desk reschedule or "mark attended" path exists). A future front-desk reschedule or attendance
   status needs a carve-out (V2-08); recorded in the wave notes.
7. **The snapshot also holds `follow_ups`**, because the prescription PDF prints the follow-up date (part of what
   was signed).

## Shared artefacts (commit `6f1e624`)

`EXPECTED_MIGRATION = "000077"`; `scripts/drift/schema-snapshot.txt` (after `supabase db reset --local`,
000001-000077: three replaced guards and the new trigger); `authz_matrix.test.sql` / `AUTHZ-MATRIX.md`
(`authz:gen`: the signed fixture visit and notes); `types/database.ts` unchanged (no column change; `db:types` was
re-run with no diff).

## Local evidence (tool output, `evidence/05a/05-11e/`)

| Check | Result | File |
|---|---|---|
| typecheck, `eslint .` (0 errors, 386 warnings as before), inventory (0 flagged), schema snapshot `--check`, `db:drift:local`, `authz:gen --check`, `db:types` (no diff) | all exit 0 | `static-checks.txt` |
| new pgTAP file at 000076 / with 000077 | 27 of 60 fail / 60/60 | `pgtap-amendment_snapshot-without-000077.tap`, `-with-000077.tap` |
| pgTAP lane + gate (db 000077 after `db reset --local`) | 30 files, **3317/3317**, gate PASS | `pgtap-lane.tap`, `pgtap-lane.txt` |
| re-check probes (all eight scripts) at 000077 | as tabled above; 0 fixture rows left | `probes-recheck-at-000077.txt` |
| full Vitest (db 000077) | **248 files, 4874/4874 passed, 0 retried**; teardown removed 208 run tenants and verified none remain | `vitest-full.txt` |
| e2e PR lane (desktop, Pixel 7, iPhone 15), fresh `e2e:build` at `6f1e624` | **220 passed, 9 skipped, 0 retried**, exit 0 (the 8 ✘ lines are the existing `knownBug` expected failures and the network-block self-test, as in 05-11d) | `e2e-build.txt`, `e2e-pr.txt` |
| gitleaks (repo config) over `903df53..HEAD` | no leaks | `gitleaks.txt` |

Not run: a "without the fix" Vitest run of the new v1 spec case. The route writes with the system client, which the
database guard does not cover by design; pgTAP shows the database admits such a header on the system path (the
"system path" decoy before case 28), so the route check is the only refusal. The diagnostics were not re-run: the
stack was freshly reset, so D1f would count seed data only.

The local stack is shared with V2-06's worktree. Every recorded run took the shared test-run lock, waiting for V2-06's
runs to finish first, and the e2e run took the e2e lane lock with an owner file. `supabase db reset --local` ran once
(07:53Z), followed by `npm run seed:local`.

## Threats

No new table, grant or policy. One new INVOKER trigger function (`follow_ups_integrity_guard`) and three replaced
guard functions; the definer `visit_revisions_actor_guard` keeps its catalogue entry in `definer_functions.test.sql`
(no EXECUTE grant, `search_path ''`, qualified names) and still checks permission and author before it reads or locks
anything. The new refusal `AMENDMENT_VISIT_NOT_SIGNED` tells a consultations:edit holder of the row's own clinic
whether a visit there is signed, which that caller can already read. Every refusal is a fixed 42501 with no row data.
The v1 change only narrows what a key can write.

## Open items

- **Prescription header UPDATE** on a signed visit (`version`, `status`, `signed_at`) is still writable by
  prescriptions:edit holders (re-check probe R4) → V2-09a (R-21), as before. With every header in the snapshot this
  no longer changes the amendment record, but it still changes what the record and a regenerated PDF show as the
  latest version.
- **No UI amendment flow is mounted** (`AmendmentModal` has no consumer; no e2e journey amends). The brief's "consultation
  UI amendment flow (e2e)" therefore has nothing to run; the app flow is covered at the service layer. Owner: V2-09a
  (amendment RPC) with V2-08 (UI).
- **N-4** (front-desk completion of unsigned visits) still open → V2-09a with V2-08; 05-11e makes such a visit
  un-amendable (Deviation 5).
- **N-9**: service-role writers are not bound by the amendment rules; the v1 prescription route now applies the header
  rule itself (Deviation 4).
- **05-b0:** run D1f (report only) with the other diagnostics.
- **05a gate:** add `amendment_snapshot` (60) to the pgTAP `REQUIRED_FILES` (lane now 30 files, 3317 tests).
- Fresh re-check of NF-1 and NF-2 (Mediums), per the triage rules.
