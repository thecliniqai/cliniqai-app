---
phase: "13"
roadmap_id: V2-13
name: DPDP lifecycle
revision: "2026-11-28, first revision (CTO delegate; PO delegated approval of the retention schedule; deadline 6 Dec 2026)"
gate: "G4 (light, per PR) with an adversarial security review (roadmap §16: V2-13 is security-sensitive). One isolated reviewer (Sonnet) over the whole diff. One adversarial reviewer (Opus) over migrations 000170-000179, every retention, erasure and purge function, the RLS changes, storage deletion, the audit triggers and seals, and the staff UI, with the brief: can anything irreversible run without a reviewed dry run and an approval; can a restricted patient be seen or messaged by a non-owner; can an audit row be changed or removed outside the retention path; can a job run twice and do harm. One fix round (13-05a). Then the isolated reviewer checks the dry-run report before the approval record is written (roadmap acceptance 2)."
requirements: ["P1-17 retention policy + purge/anonymise jobs (dry run, approval) + restrict-vs-erase workflow + staff UI + storage deletion + erased rows hidden by RLS; machinery reused by SUB-07 (V2-13c)", "P1-12 consent v2 remainder (withdrawal from the patient record, guardian consent for minors, rights requests); data model shipped in 12A-03", "P1-11 staff UI for rights requests (access, correction, erasure, grievance) with SLA tracking; exports restricted to exports:create", "P2-11 tamper-evident audit", "ADR-018", "Hand-offs: 07 command_results 30-day purge and erasure; 05b N-4 PHI on terminal delivery rows; 12A/12B retention rows; 04 ops.error_events erasure if ids are ever filled"]
plans: ["13-01", "13-02", "13-03", "13-04", "13-05a", "close"]
order: "13-04 (audit triggers first, so every later step is audited under the new rules) -> 13-01 -> 13-02 -> 13-03 -> reviews -> 13-05a -> dry-run review and approval -> close"
preconditions: "12A merged (governance hook private.patient_is_restricted, consent v2 model). 12B merged or not: 13 does not depend on 12B code, only adds its retention rows (if 12B is not merged, the ai_calls rules are added by 12B's close instead)."
migrations: {"13-04": "000170_audit_tamper_evidence", "13-01": "000171_retention_registry", "13-02": "000172_privacy_requests_restriction", "13-03": "000173_purge_execution", "13-05a": "000179_review_fixes_13 (only if needed)"}
migrations_note: "Reserved range 000170-000179. Same registry rules as 12A (expected-migration, snapshot, db:types, pgTAP and Vitest REQUIRED_FILES/FLOOR)."
new_dependencies: {}
branch: "v2/phase-13-dpdp-lifecycle -> PR into feature/v2"
source: "docs/v2/DATA_HANDLING.md §1, §5, §6, §10, §11; roadmap §6 C28/C29, §10 P1-17, P2-11, §12 V2-13, R22; SECURITY_REMEDIATION_PLAN P1-11, P1-12; ARCHITECTURE_DECISIONS ADR-009, ADR-018; SUBSCRIPTIONS_AND_PLANS §6.4-§6.6; AI_STRATEGY §4.7; TARGET_ARCHITECTURE §8; 04/05b/07/09A/09C summaries; 09E shared rules"
must_haves:
  truths:
    - "One registry lists every retention rule (category, table, horizon, basis, action, mode); a rule in dry_run mode only counts; a rule runs live only after a dry run no older than 7 days was reviewed and approved by someone other than its proposer, and the approval names that run."
    - "Retention and purge jobs claim work atomically (V2-04 claim_jobs, FOR UPDATE SKIP LOCKED batches) and are idempotent: running a job twice, or two runners at once, deletes or anonymises exactly the same rows and objects once."
    - "A patient's erasure request is recorded, decided by the owner as restrict, erase or reject with a reason, and executed only after approval; until execution it can be withdrawn; execution deletes communication data, share tokens and storage objects outside the legal hold, restricts the clinical record and schedules its anonymisation at the end of its retention."
    - "A restricted or erased patient and their clinical rows are invisible to every non-owner role (RLS), are never messaged, never returned by search, Today, the schedule, the API or webhooks, and their record is read-only for the owner."
    - "No role, including service_role, can UPDATE, DELETE or TRUNCATE audit_logs or platform_audit_log; only the retention function deletes whole sealed days past their horizon; a daily seal chain detects any change made by a superuser."
  artifacts:
    - "supabase/migrations/000170..000173; supabase/tests/database/{audit_tamper,retention_registry,privacy_requests,patient_restriction_rls,purge_execution}.test.sql"
    - "lib/jobs/internal/handlers/{retention-sweep,storage-delete,audit-seal}.ts; features/privacy/{service,actions,schema}.ts; app/(dashboard)/settings/privacy/** (register) and the patient-record privacy section; scripts/dpdp/retention-report.mjs"
    - "tests/e2e/privacy/{erasure,restriction}.spec.ts; .planning/phases/13-dpdp-lifecycle/evidence/retention-dry-run.json (tool output) and 13-APPROVAL.md (approval record generated from the DB row)"
  key_links:
    - "private.retention_rules is the only list the sweep reads; each rule's executor is a named private function; the sweep never builds SQL from rule text."
    - "private.patient_is_restricted (body replaced here, created in 12A-03) is used by message_governance, the RLS predicates, search_patients, today_board, schedule_range, the API RPCs and webhook subject resolution."
    - "Seal triggers on clinical_notes, visit_revisions, prescriptions and lab documents, and the audit triggers, allow change only inside private.retention_execute (current_user = owner role and the transaction-local flag it sets); nothing else can set both."
---

# V2-13 DPDP lifecycle: plan

## Goal

Retention and erasure are lawful, reviewed and reversible until approved (roadmap). Nothing irreversible happens without a dry run, a
review and an approval; the audit trail cannot be rewritten; a patient who asks to be erased disappears from everyone but the owner,
stops receiving messages, and loses every piece of data the law does not require the clinic to keep.

## Current state (inventory 2026-11-28)

- `features/dpdp/erasure.ts`: soft flag (`status='erased'`, `is_deleted`, `erased_at`, `erasure_reason`, 000018); only caller was
  `DELETE /api/v1/patients/[id]` (removed in 12A-05). No staff UI; erased rows stay visible.
- `features/dpdp/export.ts`: patient dossier export, audited `dpdp.data_export`, needs `exports:create`.
- `audit_logs` (000003, v2 in 000060): no UPDATE/DELETE policy, but no trigger blocks `service_role`; `platform_audit_log` (000085).
- Seal triggers block UPDATE/DELETE on `clinical_notes`, `visit_revisions` (000107), `prescriptions` (000108-000111), lab documents
  (000110); comments defer erasure/retention to V2-13.
- `private.command_results` (000095) has no purge. `ops.cleanup()` (000122) purges ops tables (jobs 30 d, inbound events 30 d, resolved
  alerts 180 d, rum 90 d, ...). Storage buckets `prescriptions`, `clinic-records`. pg_cron schedules per 000042.
- 12A ships consent purposes and `private.patient_is_restricted` (stub reading `patients.status`).

## Retention schedule (proposed and adopted under the PO's delegation; DATA_HANDLING §5 is the single schedule, C28)

| Category | Tables / objects | Horizon | Action | Erasure before horizon |
|---|---|---|---|---|
| Clinical record | visits, clinical notes, revisions, diagnoses, prescriptions (+ PDFs), lab documents (+ files), referrals, vitals, allergies | **7 years after the last visit** (clinic may set 3-10; floor 3 years, IMC 2002 reg. 1.3.1, C29); for a patient under 18 at the last visit, also not before their 21st birthday | Anonymise the patient and delete storage objects; keep de-identified clinical rows for clinic statistics | Restrict (legal hold) with reason |
| Billing | invoices, items, payments, receipts | **8 years** after the invoice date (GST/IT) | Remove patient linkage (patient_id -> erased placeholder, name/phone snapshot nulled) | Restrict |
| Patient identity | patients row | Follows the clinical record | Anonymise (name "Erased patient", phone/email/address/guardian/ABHA nulled, DOB -> year) | Restricted; anonymised at horizon |
| Communications | communication_queue, in_app_notifications, appointment_reminders | **12 months**; PHI columns (`patient_name`, `recipient_phone`) on terminal rows nulled after **30 days** (05b N-4) | Delete / null | Delete immediately |
| Consent proof | consent_records | Life of the patient record + 1 year; after erasure a minimal tombstone (purpose, status, timestamps, no identity) | Delete after horizon | Keep tombstone |
| Share tokens | share links / tokens | Expiry + 30 days | Delete | Revoke and delete immediately |
| AI metadata | ai_calls 90 d (rolled up), ai_usage_monthly 13 months, ai_quota_reservations at expiry | as stated (AI §4.7) | Delete | Delete the patient's ai_calls visit links immediately |
| Command replay | private.command_results | **30 days** | Delete | Delete rows naming the patient |
| Rate limits / idempotency | rate_limit_buckets 1 d, idempotency_keys 24 h, api_key_usage_daily 13 months | as stated | Delete | n/a |
| Clinic audit log | audit_logs | **3 years** (>= 1 year required; aligned with the clinical floor) | Delete whole sealed days | Keep (security basis); actor and entity ids only |
| Platform/security logs | platform_audit_log, auth events (FT-07) | **1 year** (>= 180 days in India, CERT-In) | Delete whole sealed days | Keep |
| Error events | ops.error_events | 30 days (no PHI by design) | Delete | n/a |
| Removed staff | memberships/profiles of removed staff | Removal + 1 year | Anonymise profile; keep actor ids | n/a |
| Backups | FT-02 dumps / PITR | 30 days rolling | Bucket lifecycle (outside the DB) | Erasure reaches backups within 30 days (notice) |
| Tenant offboarding | whole clinic | expiry + 180 days (SUB §6) | V2-13c purge using these executors | n/a |

## Decisions (CTO delegate)

- D-1 **Schedule above** is adopted under the PO's delegation (PO-12: no counsel; R22 accepted). Clinical default 7 years: within the
  "7-10 years many clinics choose" band and above the IMC floor; clinics can lower to 3 or raise to 10 in privacy settings (owner only).
- D-2 **Two-person rule, sized for a two-person company.** Platform rules: proposer = the migration author (Claude, recorded as
  `proposed_by='migration:<file>'`), approver = a platform admin (the PO) via `platform.approve_retention_rule(rule, run_id)`; approver
  must differ from proposer. Clinic erasure: requested by any member with `privacy:request`; decided and approved by the owner; when the
  requester is the owner, execution waits a 24 h cool-off (solo clinics have no second person) and can be cancelled during it.
- D-3 **First live run of housekeeping rules** (communications, tokens, command_results, rate limits, AI metadata, error events) is
  approved at this gate after the isolated reviewer checks the dry-run report; the clinical, billing and identity anonymisation rules stay
  `dry_run` in production until the first patient reaches a horizon (no production data is older than days), and are approved then by the
  PO from the same report flow.
- D-4 **Restrict hides, does not delete.** A restricted patient is visible only to the owner, read-only, with a banner and the reason;
  lifting a restriction is an owner command with a reason (reversible). Erase = restrict + immediate deletion of the non-statutory
  categories + scheduled anonymisation at the clinical horizon.
- D-5 **RLS via one indexed lookup.** `private.restricted_patients(tenant_id, patient_id)` (primary key) maintained by the privacy
  commands; `private.patient_is_restricted(tenant, patient)` is a STABLE SQL lookup; policies on patients, visits, clinical notes,
  prescriptions, lab documents, referrals, invoices and appointments add `NOT private.patient_is_restricted(...) OR is_owner`. The latency
  lane rows must keep calls and depth; ms is reported (index-only anti-join).
- D-6 **Audit tamper evidence by daily seals, not a per-row hash chain.** A per-row `prev_hash` serialises every audited write per clinic
  (lock contention on every command). Instead each row gets `row_hash` (BEFORE INSERT), and a daily job writes
  `ops.audit_seals(scope, day, count, first_id, last_id, root_hash, prev_seal_hash)`; `ops.verify_audit_seals(scope, from, to)` recomputes.
  P2-11 calls the chain optional; this keeps the write path cheap.
- D-7 **Audit deletion only by whole sealed days past the horizon**, only inside `private.retention_execute`; the trigger refuses all other
  UPDATE/DELETE/TRUNCATE for every role including `service_role`.
- D-8 **Storage deletion is a queue.** Executors insert object paths into `ops.storage_deletions(bucket, path, reason, status)`; job
  `storage.delete` (service-role storage client inside `lib/jobs/internal`, ADR-0005 register row added) deletes in batches, treats 404 as
  done, marks rows; re-runs are harmless.
- D-9 **Rights requests SLA:** acknowledgement immediate, decision due **30 days** after receipt (DPDP Rules grievance window is longer;
  30 days is the conservative default); overdue requests show on the owner's Today and in the register.
- D-10 **Access requests** are fulfilled with the existing patient export (owner or doctor with `exports:create`, reason required);
  correction requests open the patient edit form; grievance is free text kept 1 year.
- D-11 **Guardian consent** for a patient under 18: the consent checkbox (12A-03) records `evidence='staff_attestation'` plus
  `guardian_name` and relation; required for reminders to a minor's number.
- D-12 **"Discard an open amendment"** (09A hand-off to V2-13) is not a DPDP item; re-homed to the V2-14 backlog.

## CTO decisions needed

- **C-1 Seal triggers vs anonymisation.** ADR-015 says signed clinical records are immutable in the database; anonymising a patient at the
  horizon must change sealed rows (names in notes are free text and are not rewritten; identity lives on `patients`). **Recommend:**
  anonymise only `patients` identity columns and delete storage objects; sealed clinical rows are not changed (they hold no identity
  columns; free text is retained as part of the record until the tenant purge). The seal-trigger bypass in `retention_execute` is then
  needed only for tenant purge (V2-13c) and audit day deletion. Alternative: a full clinical delete at the horizon (larger ADR-015
  exception).

## Shared rules

As 12A "Shared rules for every plan" (09E conventions). In addition: every irreversible executor has a dry-run twin that returns the same
row set as counts (same WHERE, one function with `p_mode`); each executor processes `LIMIT p_batch` rows selected `FOR UPDATE SKIP
LOCKED` and records progress so a crash resumes; jobs are enqueued with a dedupe key `retention:<rule>:<IST date>`; time-travel tests use
`TEST_NOW`; synthetic patients only; nothing runs against hosted Supabase.

## Security-sensitive files

`supabase/migrations/000170..000179`; `lib/jobs/internal/handlers/{retention-sweep,storage-delete,audit-seal}.ts`; `features/privacy/**`;
`app/(dashboard)/settings/privacy/**`; the patient-record privacy section; every RLS policy changed in 000172; `docs/adr/0005*` register;
`scripts/dpdp/retention-report.mjs`.

## Plans

### 13-04 Audit tamper evidence · M · migration 000170_audit_tamper_evidence

Goal: P2-11. Audit rows cannot be changed or removed, and a change by a superuser is detectable.

Files: `000170_audit_tamper_evidence.sql`: BEFORE UPDATE/DELETE and BEFORE TRUNCATE (statement) triggers on `audit_logs` and
`platform_audit_log` raising `AUDIT_IMMUTABLE` unless `current_user` is the function owner role and `current_setting('clinicos.retention',
true) = 'on'` (set only by `private.retention_execute`, created here as the single entry point, EXECUTE for nobody but `postgres`/cron);
`row_hash` column filled BEFORE INSERT (sha256 of a canonical jsonb of the row); `ops.audit_seals`; `ops.seal_audit_day(scope, day)` and
`ops.verify_audit_seals(scope, from, to)`; job `audit.seal` daily 00:30 IST (dedupe per day); `/api/ready` and the ops alert rule raise on a
verify mismatch.

1. Tracer: `service_role` `DELETE FROM audit_logs WHERE ...` fails with `AUDIT_IMMUTABLE`.
2. Triggers, hashes, seals, job, alert.

Tests: pgTAP `audit_tamper.test.sql` (UPDATE/DELETE/TRUNCATE refused for authenticated, service_role and a definer function that is not
`retention_execute`; the flag alone without the owner role refused; seal and verify; a row altered with triggers disabled as postgres makes
verify report the day). **Fails-without (High: audit deletion):** with the trigger dropped, the service-role delete succeeds; recorded,
restored. Vitest DB: the seal job is idempotent (two runs, one seal row).
Run: pgTAP file + `grants`, Vitest `tests/jobs`.
Done: P2-11 met.

### 13-01 Retention registry and dry-run reports · M · migration 000171_retention_registry

Goal: one registry, dry runs for every rule, a report the reviewer reads.

Files: `000171_retention_registry.sql`: `private.retention_rules(key, category, description, horizon interval, basis, executor regproc,
mode dry_run|live, proposed_by, approved_run_id, approved_by, approved_at)` seeded from the schedule (all `dry_run`);
`public.tenant_retention_settings(tenant_id, clinical_years int CHECK 3..10 DEFAULT 7)` with an owner command; `ops.retention_runs(id,
rule_key, mode, started_at, finished_at, tenant_count, row_count, object_count, status)` (counts only, no ids of patients);
executors `private.ret_<rule>(p_mode, p_now, p_batch)` for each rule; `private.retention_sweep(p_now)` iterating the registry; `ops.retention_dry_run_all()` (platform admin: one dry run per rule, returns the
run ids);
`ops.cleanup()` loses the parts now owned by rules (no rule runs twice); job `retention.sweep` daily 02:00 IST.
`scripts/dpdp/retention-report.mjs` (local stack only: seeds the synthetic retention fixture, time-travels, runs every rule in dry run, writes
`evidence/retention-dry-run.json` and a generated table).

1. Tracer: rule `command_results_30d` in dry run reports the fixture's 3 old rows and deletes nothing.
2. Registry, settings, executors in dry-run form (live branches are added in 13-03 but the WHERE is shared now).
3. Report script.

Tests: pgTAP `retention_registry.test.sql` (seed rows match the schedule; every rule's dry run equals its live candidate set — asserted by
running live inside a rolled-back transaction; clinic setting bounds; grants: no tenant writes, settings owner-only; minors rule).
Run: pgTAP file, `node scripts/dpdp/retention-report.mjs`.
Done: every category has a rule and a dry-run count.

### 13-02 Privacy requests, restriction and the staff UI · L · migration 000172_privacy_requests_restriction · split point after step 3

Goal: P1-11 UI, P1-17 restrict-vs-erase, P1-12 remainder.

Files: `000172_privacy_requests_restriction.sql`: permissions `privacy:request` (owner, admin, doctor, receptionist) and `privacy:decide`
(owner) in the matrix (000046 pattern); `public.privacy_requests(id, tenant_id, patient_id, kind access|correction|erasure|grievance|
consent_withdrawal, status received|decided|scheduled|executed|withdrawn|rejected, decision restrict|erase|reject, reason, requested_by,
decided_by, received_at, due_at, cooloff_until, executed_at)` with RLS; commands `privacy_request_create`, `privacy_request_decide`,
`privacy_request_withdraw`, `patient_restriction_lift` (V2-07 guard block, request-id replay); `private.restricted_patients` and the real
body of `private.patient_is_restricted`; RLS policy changes (D-5) on the listed tables; `search_patients`, `today_board`, `schedule_range`,
`find_patient_duplicates`, `api_v1_patient_lookup`, webhook subject resolution and the MSG91 inbound phone match exclude restricted
patients; writes to a restricted patient's records refused with `PATIENT_RESTRICTED` in the commands; consent withdrawal command from the
record; guardian fields (D-11). App: `features/privacy/*`; patient record "Privacy" section (consents with history, withdraw, "Record a
request"); `/settings/privacy` register (owner/admin: open, overdue, decided; filters in the URL; paginated server-side) and the clinic
retention setting; decide dialog (restrict / erase / reject with reason, the 24 h cool-off note for owner-requested erasure); restricted
banner; delete `features/dpdp/erasure.ts` if still present.

1. Tracer: receptionist records an erasure request; owner decides "restrict"; the receptionist's search, Today and schedule no longer show
   the patient; the owner still does, read-only.
2. Migration and commands; RLS; reads.
3. Exclusions in search/Today/schedule/API/webhooks/inbound. (split point)
4. UI.

Tests: pgTAP `privacy_requests.test.sql` (permission matrix, cross-tenant refusal, cool-off, withdraw before execution, decided ->
scheduled) and `patient_restriction_rls.test.sql` (each role x each table: restricted rows invisible to non-owners, visible to owner;
commands refuse writes; governance blocks messages). **Fails-without (High: restricted patient visible):** with the visits policy change
reverted, a doctor reads the restricted patient's visit; recorded, restored. e2e `tests/e2e/privacy/restriction.spec.ts` and the request
part of `erasure.spec.ts` (desktop-chrome, pixel-7, iphone-15; axe at 360/820/1280). Latency lane: Today, schedule, patient search and
consult rows keep calls and depth (`npm run perf:latency`).
Run: Vitest `tests/privacy tests/patients`, pgTAP files + RLS matrix, e2e `tests/e2e/privacy tests/e2e/today tests/e2e/schedule`.
Done: requests tracked with SLA; restriction effective everywhere.

### 13-03 Purge and anonymise execution with approval · L · migration 000173_purge_execution

Goal: P1-17 irreversible part. Live executors, approval, storage deletion, erasure execution.

Files: `000173_purge_execution.sql`: live branches of every executor; `platform.approve_retention_rule(p_rule, p_run_id, p_note)`
(platform admin; run must be a dry run of that rule, finished, < 7 days old, approver <> proposer; writes `platform_audit_log`; flips
`mode` to live); `platform.suspend_retention_rule` (back to dry run, instant); `private.execute_privacy_request(p_request)` called by job
`privacy.execute` once `cooloff_until` has passed (dedupe per request): deletes the patient's communication rows, reminders, share tokens,
non-proof consents (tombstone kept), `command_results` naming the patient, the patient's `ai_calls` visit links; queues storage objects
outside the legal hold (none for a restrict decision); marks the request executed; anonymisation at the clinical horizon is the
`patient_identity` rule (D-1, C-1); `ops.storage_deletions` and job `storage.delete` (D-8); `retention_execute` is the only caller of
executors in live mode; alert rule for a failed or stuck run.

1. Tracer: an approved `communications_12m` rule deletes the fixture's old queue rows; a second run deletes nothing; two concurrent runs
   delete each row once.
2. Approval function, live executors, privacy execution, storage queue.
3. Approval record: `scripts/dpdp/retention-report.mjs --approval` renders `13-APPROVAL.md` from the DB rows (never typed).

Tests: pgTAP `purge_execution.test.sql` (live refused without approval; approval refused for a stale or foreign run or by the proposer;
suspend works; each executor live == its dry-run count; idempotent rerun; erasure execution removes exactly the listed categories and
keeps clinical rows, billing and the consent tombstone; restricted-only decision deletes nothing). Vitest DB: `storage.delete` against the
local Storage API (objects gone, 404 tolerated, rerun harmless); two runners concurrently through `claim_jobs`. **Fails-without (High:
irreversible without approval):** with the mode check removed, the sweep deletes in dry-run mode; recorded, restored. **Fails-without
(High: double execution):** without SKIP LOCKED, the concurrent test processes a batch twice (counted by a probe table); recorded, restored.
e2e `tests/e2e/privacy/erasure.spec.ts` end to end on a synthetic patient: request -> owner erase -> `TEST_NOW` + 25 h -> job run through
`/api/jobs/run` -> the patient's messages and share link are gone (DB and the public link 404), files deleted from Storage, clinical record
still visible to the owner and invisible to others.
Run: Vitest `tests/jobs tests/privacy tests/storage`, pgTAP files, e2e `tests/e2e/privacy`.
Done: irreversible paths gated, idempotent and proven.

### 13-05a Review fixes · S-M

As 12A-06a, with the adversarial brief in the frontmatter gate.

### Dry-run review and approval

1. `npm run stack:recycle`; `node scripts/dpdp/retention-report.mjs` on the local stack with the synthetic fixture -> `retention-dry-run.json`.
2. Isolated reviewer (fresh context, read-only): checks every rule's counts against the fixture's expected counts and the schedule table.
3. Approval (D-3) of the housekeeping rules on the local stack by a synthetic platform admin; `--approval` renders `13-APPROVAL.md`. The
   production approval is the same RPC run by the PO after deploy (PO action), from a production dry run.

### Close

As 12A close (evidence dir `evidence`), plus the dry-run report, `13-APPROVAL.md`, and the retention schedule adoption recorded in
VERIFICATION_LOG ("approved by delegation", schedule table copied by script from `private.retention_rules`).

## Threat register (short)

| Threat | Control | Proof |
|---|---|---|
| Irreversible run without review (T/legal) | mode + approval naming a fresh dry run, approver <> proposer | fails-without 13-03 |
| Double delete / partial run (integrity) | SKIP LOCKED batches, dedupe keys, resumable progress | fails-without 13-03 |
| Restricted patient seen by staff (I) | RLS via restricted_patients; read paths exclude | fails-without 13-02 |
| Restricted patient messaged (I) | governance hook | patient_restriction_rls.test.sql |
| Audit rewrite (R/T) | triggers for every role; seals detect superuser edits | fails-without 13-04 |
| Storage objects left behind (I) | deletion queue with status; alert on stuck rows | Vitest storage |
| Owner erases to hide evidence (R) | audit kept 3 years; requests and decisions audited; clinical record kept under legal hold | privacy_requests.test.sql |

## Doc amendments (at the close)

DATA_HANDLING §5 (schedule table replaced by the adopted one, minors rule, consent tombstone, command_results, rate limits), ADR-018
(registry and approval model), ADR-015 (retention_execute exception, C-1), roadmap P2-11 (daily seals), TARGET §8 job kinds.

## PO actions (external)

1. None external for the code. After production deploy: run the production dry run (`select ops.retention_dry_run_all()`), read the
   report, and approve the housekeeping rules with `platform.approve_retention_rule` (SQL in the runbook). Clinical, billing and identity
   rules are approved when the first horizon approaches (years away).
2. Confirm or change the adopted schedule (delegated default applies).

## Hand-offs

- V2-13c: tenant archive and purge (SUB-07) call the executors with a tenant filter, the storage queue and `retention_execute`; deletion
  certificate counts come from `ops.retention_runs`.
- V2-14: verify seals in the security verification; the "discard amendment" item (D-12).
- V2-15: pre-purge on-demand dump (FT-02) before the first live production run.

## Out of scope

Physical archive tier, per-export encryption, FHIR export, automated breach notification.
