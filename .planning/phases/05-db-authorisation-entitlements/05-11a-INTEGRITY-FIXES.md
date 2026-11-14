---
phase: 05
plan: 05-11a
subsystem: visits and clinical integrity (05a review fix plan)
status: complete
findings: [H-VISIT, M-ACTOR (visits, prescriptions, amendments), M-SIGNED, M-DURATION (database), M-TOKEN, M-INVOICE (doctor_id)]
migrations: [000068_visit_integrity_expand, 000069_visit_integrity_migrate, 000070_visit_integrity_contract]
plan_head_before: 7f65021
plan_head_after: 69a362f
commits: [f07fcb5, d0abfee, 69a362f]
---

# 05-11a record: visits and clinical integrity

**Outcome:** done locally. Every 05-11a row of `05a-REVIEW-TRIAGE.md` is fixed in the database, each reviewer
reproduction now fails with a named 42501 (or 23514 / 23503), and each fix has a regression test that was run against
the tree without 000068-000070 and failed there (tool output in `evidence/05a/05-11a/`). Root cause, as the triage
says: the row policies were right, but table-wide write grants let a role write columns that belong to the clinician
or to an RPC. The fix is guard triggers that bind actor and sign-off columns to `auth.uid()`, plus a column grant and a
definer RPC for queue tokens. Nothing hosted was contacted; every Supabase CLI call used `--local`; resets ran under
the test-run lock while 05-11b and 05-11c worked in the same tree.

## Finding → fix → test → fails without

| Finding (review source) | Fix (migration) | Regression test | Without the fix |
|---|---|---|---|
| **H-VISIT** re-key a signed visit to another patient (INT H-1, RLS M-3) | `private.visits_integrity_guard`: `id`, `tenant_id`, `patient_id` immutable on **every** path (000068 §1) | `visit_integrity.test.sql` 1-3; `signed-visit-integrity.spec.ts` "a receptionist cannot move…" (PostgREST, receptionist JWT) | UPDATE 1 (pgTAP not ok 1-3; spec fails: `error` undefined, row re-keyed) |
| **H-VISIT** forge `signed_by` / mark signed as a doctor (INT H-1, RLS M-3, IND M1) | guard: sign-off columns change only with `consultations:edit`, only to `signed_by = auth.uid()`, `signed_at` set, status `completed` | pgTAP 4, 8, 23 (the doctor's own sign-off still works); spec "a receptionist cannot sign an open visit…" | admitted |
| **H-VISIT** un-sign and reopen without an amendment (IND M1, RLS M-3) | guard: a signature is never cleared; a signed visit's status changes only with `consultations:edit` and only reopen (`completed → in_consultation`, needs a `visit_revisions` row by the caller numbered ≥ `current_revision`, which the guard then advances) or finalize (`in_consultation → completed`, re-signed by the caller); an existing signature is replaced only when finalizing | pgTAP 5-7, 9-19 (incl. "another doctor's amendment row does not let this doctor reopen", "a second reopen needs a new amendment row") | admitted |
| **H-VISIT** `signed_by` any auth user (IND M1) | `visits_tenant_signed_by_fkey (signed_by, tenant_id) → memberships` NOT VALID (000068), D5s diagnostic, VALIDATE (000069) | pgTAP 22 (23503 on a system path), `migration_edge_cases_visit_integrity` 4, 11-13, 16 | non-member signer stored |
| **M-INVOICE** doctor takes a colleague's visit → its invoice (IND M2, RLS L-1) | guard: `doctor_id` of a signed visit never changes (every path); of an unsigned visit, not by a caller who holds `consultations:edit` without `billing:view` (a doctor) | pgTAP 20-21, 24-25; spec "a doctor cannot take a colleague's visit…" | UPDATE 1 |
| **M-ACTOR** visits `created_by` | guard: INSERT `created_by = auth.uid()`, not inserted signed, `current_revision` 1; UPDATE never changes `created_by`/`created_at`/`current_revision` | pgTAP 26-30 | admitted |
| **M-ACTOR** prescription in another doctor's name (IND L2) | `private.prescriptions_actor_guard`: INSERT `doctor_id = auth.uid()` and `patient_id` = the visit's patient; UPDATE never changes doctor/visit/patient | pgTAP 31-34 | admitted |
| **M-ACTOR** amendment attributed to another doctor (RLS M-3) | `private.visit_revisions_actor_guard`: `amended_by = auth.uid()`; `amended_at` = database clock | pgTAP 35-36 | admitted; backdated time stored |
| **M-SIGNED** notes/vitals of a signed visit rewritable (INT M-3) | `clinical_notes_guard` (replaced): a signed-in caller writes notes only while the visit is unsigned or reopened (`status = 'in_consultation'`) | pgTAP 16 (reopened: allowed), 37-39 | UPDATE 1 for doctor and nurse |
| **M-DURATION** 0 / negative / 2e9 minutes (INT M-1, IND L1) | `visits_duration_range CHECK (5..480)` NOT VALID (000068); D6d; shrink, then lengthen-and-mark-overbooked, then VALIDATE (000069) | pgTAP 40-43; `migration_edge_cases_visit_integrity` 2, 5-6, 10, 14, 17 | zero-length slot stored; 2e9 stored |
| **M-TOKEN** member inserts token 2147483647 → day's check-in dead (INT M-2) | `queue_tokens_token_range CHECK (1..9999)` (000068/000069, D9t, renumbering); `issue_queue_token` (definer) writes the row; 000070 revokes INSERT and the table UPDATE, grants UPDATE (priority, called_at, completed_at), drops `queue_tokens_insert` and `next_queue_token` | `queue_tokens.test.sql` 7-9, 15-16, 31-34; `visit_integrity` 44-45; `migration_edge_cases_visit_integrity` 3, 7-10, 15 | insert and token_number rewrite admitted; overflow error |
| **M-TOKEN / INT I-4** repeat check-in burns a number / fails | `issue_queue_token` locks the visit and returns its existing token (`reused`) | `queue_tokens.test.sql` 19-20; `queue-token-concurrency.spec.ts` "a repeat check-in of the same visit (two desks at once) reuses the visit's token" | one desk gets "Failed to register queue entry"; counter +2 |
| app: `cancelVisit` on a signed visit (surfaced by H-VISIT) | `features/visits/service.ts`: refuse a signed visit; a failed cancel write stops before audit and waitlist promotion | `signed-visit-integrity.spec.ts` "cancelVisit refuses a signed consultation…" | visit cancelled, `visit.cancel` audited, waitlist promoted into the slot |

Fails-without evidence: `evidence/05a/05-11a/fails-without-pgtap.txt` (the three 05-11a pgTAP files on the stack
reset without 000068-000070) and `fails-without-vitest.txt` (the two Vitest specs on that stack with the pre-fix app
files, in a clean worktree at HEAD).

Note on the fails-without pgTAP file: `visit_integrity` ran 45 with 36 not ok (the 9 that pass are the positive
controls, e.g. "a doctor signs an open visit as itself"); `migration_edge_cases_visit_integrity` and `queue_tokens`
abort at their first statement that needs a 05-11a object (1 of 17 and 6 of 34 run). pg_prove counts a short plan as
a failure. Vitest without the fix: 6 of 6 cases fail (`fails-without-vitest.txt`).

## What shipped

| Commit | Content |
|---|---|
| `f07fcb5` | migrations 000068-000070; `features/queue/service.ts` (`checkInVisit` → `issue_queue_token`), `features/visits/service.ts` (`cancelVisit`), `features/consultation/service.ts` (reopen/finalize report a refused write); diagnostics D6d/D9t/D5s; matrix rows (visits/visit_revisions/prescriptions INSERT as `auth.uid()`, `queue_tokens` INSERT `rpc_only`); pgTAP kept green: `queue_tokens` (26 → 34), `definer_functions` (`issue_queue_token` replaces `next_queue_token`), `domain_policies`, `composite_fks` (+ signer FK, 103 → 105), `migration_edge_cases_fk` (D1 repair disables the guard), `tenant_local_dates`; `queue-token-concurrency.spec.ts` (+ concurrent repeat check-in) |
| `d0abfee` | new regressions: `visit_integrity.test.sql` (45), `migration_edge_cases_visit_integrity.test.sql` (17), `tests/ci/visit-integrity-inline.spec.ts` (11), `tests/visits/signed-visit-integrity.spec.ts` (4) |
| `69a362f` | `tests/integration/visits.spec.ts` checks in through `issue_queue_token` (a member's forged token row → 42501); `tests/authz/table-matrix.spec.ts` pin |
| shared artefacts | `EXPECTED_MIGRATION`, schema snapshot, `types/database.ts`, authz outputs were regenerated from the full migration set and committed by 05-11b's chore `6f8bf76` (they include 000068-000070); re-checked after: `authz:gen` and the snapshot `--check` show no diff |
| docs | this record, wave notes, evidence `evidence/05a/05-11a/`, diagnostics `before-05-11a.json` / `after-05-11a.json` |

## Deviations and decisions

1. **[Rule 1] The NOT VALID check applies to the migrate step's own writes.** A first draft of 000069 marked short
   slots overbooked and clamped them in two statements; the edge-case replay proved the mark step itself violates
   `visits_duration_range` (a new row version with 0 minutes). The final 000069 writes each row once with its final
   value: shrink (> 480) first, then lengthen to 5 with the overbooked mark in the same write. A planted case (a huge
   slot followed the next morning by a zero-length one) pins that no intermediate state overlaps.
2. **Prescription actor rule.** The triage text for prescriptions is ambiguous; implemented the strict reading
   (INSERT `doctor_id = auth.uid()`, never changed; plus `patient_id` must be the visit's patient, which keeps the Rx
   on the visit's patient now that the visit cannot be re-keyed). The app always prescribes as `ctx.userId`.
3. **`doctor_id` reassignment rule.** "Front desk only" is implemented as: refused for a caller who holds
   `consultations:edit` without `billing:view` (doctors). That is exactly the set the invoice own-visit carve-out
   serves; owners, admins and receptionists already read every invoice, and nurses have no carve-out. No in-app path
   changes `visits.doctor_id` today (v1 PATCH uses the service role); a signed visit's doctor is frozen on every path.
4. **Patient immutability on every path.** Including the service role and migrations: a D1-style data repair
   (05-03 runbook) now disables `visits_integrity_guard` for the one correcting statement (shown in
   `migration_edge_cases_fk.test.sql`).
5. **`next_queue_token` dropped (contract, 000070).** Without the INSERT privilege it could only burn numbers up to
   the 9999 ceiling. Deploy order: 000070 after the `issue_queue_token` app is serving (wave note, 05-b0).
6. **[Rule 1/2] App writes that ignored a refused update.** `cancelVisit` audited and promoted the waitlist even when
   the visit write failed; reopen/finalize returned success on a failed visit write. With the guard these became
   reachable, so each now stops and reports (lane note in the wave notes).
7. **Signer FK has no automatic remedy.** Rewriting a signature would forge one; 000069 stops with 23503 on D5s > 0.

## Local evidence (tool output, `evidence/05a/05-11a/`)

| Check | Result | File |
|---|---|---|
| typecheck, `eslint .` (0 errors), inventory (0 flagged), schema snapshot `--check`, `db:drift:local` | pass | `static-checks.txt` |
| full Vitest, first run (before `69a362f`) | 5 failed: 3 in `visits.spec.ts` and 1 matrix pin (05-11a, fixed in `69a362f`), 1 `review2-fixes-db` (05-11c, below) | `vitest-full-first-run.txt` |
| full Vitest at `57824b0` | 247 files, 4862 passed, 1 failed: `review2-fixes-db.spec.ts` AR2-Info (I2) expects 500 for a v1 PATCH of `investigations_advised`, and since 05-11c's M-APINOTES (`0f404cb`) the route refuses clinical fields with 403. That is 05-11c's change, not 05-11a's; open item for 05-11c | `vitest-full.txt` |
| `npm run test:pgtap` + gate | 28 files, 3196 tests, 0 failed, gate PASS | `pgtap-run.tap`, `pgtap-run.txt`, `pgtap-gate.txt` |
| `npm run e2e:build && npm run e2e:pr` | 220 passed, 9 skipped, 0 flaky, 0 retried (the ✘ lines are pre-existing `knownBug` expected failures) | `e2e-build.txt`, `e2e-pr.txt` |
| fails-without (stack reset without 000068-000070; pre-fix app files in a clean worktree) | pgTAP 36/45 not ok + 2 files aborted; Vitest 6/6 failed | `fails-without-pgtap.txt`, `fails-without-vitest.txt` |
| diagnostics | D6d = D9t = D5s = 0 before and after. The local database held no visits after the run teardowns, so the legacy-row behaviour is proven by the edge-case replay, as in 05-08 | `../diagnostics/before-05-11a.json`, `../diagnostics/after-05-11a.json` |
| gitleaks v8.30.1 (repo config) over `f07fcb5^..` | no leaks | `gitleaks.txt` |

Earlier, during an ad-hoc run outside the test-run lock, `migration_edge_cases_fk` case 16 failed once while another
agent's Vitest run was using the stack. It did not recur in 3 direct re-runs or in either locked lane run. Cause:
running outside the lock, not the test. Every recorded run above was taken under the lock.

## Threats

No new surface beyond the plan: `issue_queue_token` is a definer RPC with the same authorisation as the function it
replaces (active clinic, appointments:edit, no existence oracle) and EXECUTE for `authenticated` only. The three
guard functions are invoker trigger functions with no EXECUTE grant. Every refusal is a fixed 42501 message with no
row data.

## Open

- 05-11c: `tests/security/review2-fixes-db.spec.ts` AR2-Info (I2) needs to follow M-APINOTES (assert the 403 for a
  clinical field, or move the DB-error probe to a non-clinical field).
- 05a gate: the `REQUIRED_FILES` / FLOOR additions are in the wave notes.

