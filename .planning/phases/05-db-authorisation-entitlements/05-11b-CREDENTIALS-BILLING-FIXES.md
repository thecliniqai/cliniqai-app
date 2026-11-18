---
phase: 05
plan: 05-11b
subsystem: 05a review fixes — invitations, billing, API keys, notices, consent/referral actors, audit allow-lists, template roles
status: complete
findings: [H-INVITE, M-ACTOR (consents, referrals), M-INVOICE (billing part), M-NOTICE, M-APIKEY, INT L-5, RLS L-3, IND L6, IND L4]
plan_head_before: d0abfee
commits: [a0ef88d, f4bc053, 69eda1f, 80d1e2c, 6f8bf76, docs commit]
note: 05-11a and 05-11c ran in parallel in the same tree and on the same local stack; their commits interleave with these. Every 05-11b commit was built in a private index on top of the then-current HEAD (only 05-11b paths and hunks) and moved HEAD with a compare-and-swap, so no other agent's file or hunk is in a 05-11b commit.
---

# 05-11b record: credentials, billing, notices, audit and referral fixes

**Outcome:** done locally. Every 05-11b row of `05a-REVIEW-TRIAGE.md` is fixed with a regression test that fails
without the fix (tool output below). Migrations `000071`-`000074` (new files only, expand-safe for the running app).
Nothing hosted was contacted; every Supabase CLI call used `--local`; resets ran under the test-run lock.

## What shipped

| Commit | Content |
|---|---|
| `a0ef88d` (fix) | H-INVITE: `000071_invitation_token_binding`; `invitation_binding.test.sql` (14); `features/staff/actions.ts` (accept-invite texts for the two new refusals); `tests/auth/invite.spec.ts` (consume legs invite the redeemer's own address; three PostgREST H-INVITE cases); `tests/security/cross-tenant.spec.ts` reads the granted columns |
| `f4bc053` (fix) | M-INVOICE billing: `000072_billing_totals_rpc_only`; `billing_rpc_only.test.sql` (25); `features/billing/service.ts` (charge add/remove no longer recompute the invoice in the app); `tests/billing/invoice-totals-db.spec.ts` (6); definer/domain catalogue rows + two dual-member `record_payment` legs; matrix rules and spec; adapted specs (below) |
| `69eda1f` (fix) | M-APIKEY + M-NOTICE: `000073_api_keys_notices_columns`; `api_keys_notices_columns.test.sql` (26); `delete_rules` (no `api_keys_delete`), `referrals_rules` scope cases, matrix rows |
| `80d1e2c` (fix) | M-ACTOR (consents, referrals), RLS L-3, IND L6, INT L-5, IND L4: `000074_actor_bindings_audit_templates`; `actor_bindings_audit.test.sql` (34); `lib/audit/audit.ts` exports `AUDIT_ACTIONS` / `AUDIT_METADATA_KEYS`; `tests/audit/log-audit-allowlist.spec.ts` (7, parity + PostgREST); adapted specs (below) |
| `6f8bf76` (chore) | Shared generated artefacts from the full on-disk migration set (000001-000074): `EXPECTED_MIGRATION = "000074"`, schema snapshot, `types/database.ts`, `authz_matrix` / `authz_completeness` / `AUTHZ-MATRIX.md` |
| docs | this record, wave-note rows, evidence |

## Finding → fix → test → fails-without proof

Evidence is under `evidence/05a/05-11b/`. "Without" = the local stack reset to `--version 000070` (every migration
before 05-11b's, the 05-11b code and tests in place); "with" = reset to 000074.

| Finding | Fix (migration) | Regression tests | Without 000071-000074 |
|---|---|---|---|
| **H-INVITE** (RLS H-1): an admin read the owner invitation's `token_hash` and redeemed it from a second account, which became an owner | 000071: `invitations` SELECT is a column grant without `token_hash` (INSERT keeps it); `consume_invitation` (same signature, still definer, `search_path ''`) needs the caller's **confirmed** email to equal `invited_address` (trimmed, case-insensitive) under the row lock, else 42501 `INVITATION_EMAIL_MISMATCH` / `INVITATION_EMAIL_UNCONFIRMED`; the old texts stay for the app's mapping | `invitation_binding.test.sql` 1-14; `invite.spec.ts` "H-INVITE" (3) | pgTAP **7/14 fail** (hash read by admin and owner, hash filter, catalogue, the second account redeems → clinic id, the admin's own account → 23505 instead of a refusal, unconfirmed redeems); specs **3 fail** |
| **M-INVOICE** billing (IND M2, RLS L-1, IND Info 3): the visit's doctor set the invoice `paid` / zero; a collector inserted payments directly | 000072: UPDATE on `invoices` revoked, `invoices_update` dropped; `invoices_insert_guard` (user INSERT only `draft`/`issued`, no negative amounts, `total_amount` stamped by the formula); `invoice_items_sync_invoice` (definer, every writer) recomputes subtotal/total/paid-issued status under the invoice lock; INSERT on `payments` revoked, `payments_insert` dropped; `record_payment` SECURITY DEFINER (system path = `current_setting('role') = 'service_role'`) | `billing_rpc_only.test.sql` 1-25; `invoice-totals-db.spec.ts` (6: PostgREST repros + the app's add/remove charge and pay paths); `payment-actor-guards.spec.ts` H-PAY (2); `table-matrix.spec.ts` example cells | pgTAP **13/25 fail** (doctor/collector/owner invoice UPDATE, paid INSERT, negative discount, stamped total, direct payment, totals/status not following items, catalogue); specs **8 fail** |
| **M-APIKEY** (RLS M-1, IND M4, INT L-6): an admin re-keyed / un-revoked / re-attributed the owner's export-scoped key; DELETE erased audit attribution | 000073: UPDATE only `name`, `revoked_at`, `updated_at`; DELETE revoked, `api_keys_delete` dropped; `api_keys_scope_guard` now BEFORE INSERT OR UPDATE (any column): `created_by` = caller on INSERT, `id`/`tenant_id`/`key_hash`/`key_prefix`/`created_by`/`created_at` immutable (`API_KEY_IMMUTABLE`), a revoked key stays revoked at its time (`API_KEY_REVOKED`), scope adds still need the permission | `api_keys_notices_columns.test.sql` 1-18 (incl. the guard on a privileged path: run as `postgres` with the session's claims) | pgTAP **12 of the 18 key cases fail** (19/26 in the file) |
| **M-NOTICE** (RLS M-2, IND M3): any recipient rewrote a broadcast/role notice's title, message, link | 000073: UPDATE only `is_read`, `read_at`; `in_app_notifications_update` WITH CHECK = USING; `link_url` CHECK `^/([^/\\]\|$)` (NOT VALID) | `api_keys_notices_columns.test.sql` 19-26 | **7 of the 8 notice cases fail** |
| **M-ACTOR** consents (RLS M-3): a receptionist recorded a consent as given by the owner | 000074: `consent_records_actor_guard` (BEFORE INSERT): with a session `recorded_by` = caller, else 42501 `ACTOR_INVALID` | `actor_bindings_audit.test.sql` 1-3 | case 1 fails |
| **M-ACTOR** referrals (RLS M-3): a doctor sent / took over / closed a referral as another doctor | 000074 (`referrals_directory_consent_guard`, now every INSERT/UPDATE): user path `referring_doctor_id` = caller on INSERT and immutable; a set/changed `closed_by` = caller | `actor_bindings_audit.test.sql` 4-9 (incl. the app's close and the target clinic's acknowledge still work on an older row) | cases 4, 6, 7 fail |
| **RLS L-3**: `referrals.target_doctor_id` unconstrained | 000074: must be a member of the target clinic whose role holds consultations:edit there (owner/doctor), else P0001 `REFERRAL_TARGET_DOCTOR_INVALID` | `actor_bindings_audit.test.sql` 10-13 | cases 10-12 fail |
| **IND L6**: consent covered only the history snapshot | 000074: an in-network referral (target set) carrying a summary, diagnosis, medications, investigations or snapshot needs `patient_consents_history_sharing` (`REFERRAL_CONSENT_REQUIRED`); checked on INSERT and when one of them, the target or the flag changes | `actor_bindings_audit.test.sql` 14-20 | cases 14-17, 20 fail |
| **INT L-5**: any member planted any audit action (a "completed" DPDP export) and 4 KiB of free text | 000074 `log_audit`: action ∈ `private.audit_client_actions()` (= `AUDIT_ACTIONS` without reserved prefixes) else P0001 `INPUT_INVALID`; `dpdp.`/`auth.`/`billing.`/`ops.` → 42501 `AUDIT_ACTION_FORBIDDEN` except `dpdp.data_export` (exports:create) and `dpdp.patient_erasure` (patients:edit and the patient IS erased); `invoice.payment_recorded` only inside `record_payment` (its payment marker); metadata keys ∈ `private.audit_metadata_keys()`, ≤ 20 keys, strings ≤ 500 chars, no objects, arrays ≤ 50 scalars, ≤ 4 KiB | `actor_bindings_audit.test.sql` 21-33; `log-audit-allowlist.spec.ts` (parity + PostgREST); `payment-actor-guards.spec.ts` M-AUDITSYS | pgTAP cases 21, 23, 25-32 fail (22, 24, 33 are the app's writes, passing before and after); specs **5 + 1 fail** |
| **IND L4**: template `request_roles` wider than the call sites | 000074: prescription_ready / consultation_documents → owner, doctor (prescriptions:view); lab_report_uploaded / referral_letter_issued → owner, doctor, nurse (labs:view / consultations:view) | `actor_bindings_audit.test.sql` 34; `enqueue-message-rpc-db.spec.ts` parity map now names each call site's real key (+4 refusal legs) | case 34 and **2 specs fail** |

Totals without the migrations: pgTAP **62 of 99** new cases fail (`pgtap-*-without-000071-000074.tap`; the rest are
controls that pass before and after, e.g. "the app's write still works"); specs **19 fail**
(`specs-without-000071-000074.txt`). With them: 99/99 (`pgtap-*-with-000071-000074.tap`).

## App paths checked and adapted

- **Billing.** `createVisitInvoice` (Sign & Bill and checkout) INSERTs `issued` with the formula's total: unchanged and
  accepted. `addInvoiceItem` / `deleteInvoiceItem` no longer UPDATE the invoice (the update result was never checked;
  it would now be a silent 42501): the trigger recomputes subtotal, total and paid/issued, proven through the real
  services in `invoice-totals-db.spec.ts` and the existing `delete-paths.spec.ts` ("the totals follow"). `recordPayment`
  / `recordPaymentAsSystem` call the same RPC (now definer): `record-payment-rpc.spec.ts` (role matrix, races, replay,
  system path, fault rollback) passes unchanged except the catalog line (DEFINER). No app path voids an invoice; the
  review3 spec's void is now the service role's.
- **Invitations.** `inviteStaff` inserts with `.select("id")` (only the id is returned): unchanged. The staff page reads
  granted columns. `acceptInvite` maps the two refusals to fixed texts.
- **API keys / notices.** `createApiKey` inserts with `created_by = ctx.userId`; `revokeApiKey` sets `revoked_at`,
  `updated_at`; the notification service sets `is_read`, `read_at`: all inside the grants (pgTAP cases 9-12, 22).
- **Audit.** Every `recordAudit` call site uses `AUDIT_ACTIONS` and the allow-listed metadata keys (filtered before the
  RPC); the full Vitest run exercises them (a failed audit aborts the action, so a gap would fail its spec).

## Specs and pgTAP files adapted (behaviour changed on purpose)

`payment-actor-guards.spec.ts` (direct payment INSERT → 42501; a nurse's `invoice.payment_recorded` through log_audit →
`AUDIT_ACTION_FORBIDDEN`; probes use allow-listed actions), `record-payment-rpc.spec.ts` (catalog DEFINER),
`review3-fixes-db.spec.ts` (void by the service role; receptionist messages use `receipt_issued`),
`enqueue-message-rpc-db.spec.ts` / `queue-grants-db.spec.ts` (receptionist default template `receipt_issued`, the nurse's
params case names `lab_report_uploaded`), `review-fixes-db.spec.ts` (in-network referral fixture with consent),
`schema-snapshot.spec.ts` (samples `memberships.full_name UPDATE`, since `payments.amount INSERT` is gone),
`cross-tenant.spec.ts` (granted invitation columns), `invite.spec.ts` (invite the redeemer's own address);
`audit_v2` / `definer_functions` (allow-listed actions; `record_payment` and `invoice_items_sync_invoice` classified,
two dual-member legs), `delete_rules`, `domain_policies`, `referrals_rules` (scope updates are no longer a member path;
the receiver-guard case uses the consented referral), `tests/authz/table-matrix.ts` and `.spec.ts`.

## Decisions and deviations

1. **[Rule 1/2] `dpdp.patient_erasure` is permission- and state-bound, not refused.** The triage says log_audit refuses
   `dpdp.`; `erasePatientRecord` supports staff sessions and audits through `log_audit` (`dpdp-rights.spec.ts` failed on
   a plain refusal). Accepting it only from a patients:edit holder for a patient that is already erased keeps the
   reviewer's point (no planted compliance events) without breaking erasure. Same for `dpdp.data_export` (exports:create).
2. **`record_payment` became SECURITY DEFINER** rather than keeping INSERT on `payments` behind a marker: the triage asks
   for the privilege to be revoked, and the invoker version needed both payments INSERT and invoices UPDATE. Its body is
   unchanged except the service-role test (`current_setting('role')`, since `current_user` is the owner in a definer).
3. **Notices: role/broadcast read state stays shared.** UPDATE is limited to `is_read`/`read_at` of notices the caller
   receives (own, role, broadcast), matching `admin_policies.test.sql`; one recipient marking a shared notice read marks
   it for all (pre-existing). A per-user read table is a new table (Rule 4): raised in the wave notes, not built.
4. **Totals recompute on every writer.** `invoice_items_sync_invoice` also fires for the service role and `postgres`, so
   an invoice always equals its items (draft and cancelled invoices keep their status). Fixtures that seed an invoice
   total and then items get the items' sum.
5. **`reason_for_referral` is not consent-gated** (NOT NULL; the purpose of the referral). The four clinical fields the
   reviewer named and the snapshot are.
6. **Scopes are no longer member-updatable.** Per the triage (update only `name` and `revoked_at`), an owner creates a
   scoped key (guarded INSERT) but cannot add a scope to an existing one; no app path did.
7. **`link_url` CHECK is NOT VALID** (expand only; VALIDATE is a 05-b0 contract step after a diagnostic).
8. **Commit mechanics.** Three agents shared one working tree and index. Each 05-11b commit was built with a private
   `GIT_INDEX_FILE` from HEAD plus only 05-11b paths and, for shared files, only 05-11b's replacements applied to
   HEAD's blob; HEAD moved by `git update-ref` compare-and-swap; the real index was re-synced for those paths only.

## Suite results (tool output, `evidence/05a/05-11b/`)

All runs on the shared tree with the local stack at 000074 (05-11a's and 05-11c's committed and uncommitted work
present); each file records the HEAD it ran at.

| Lane | Result | File |
|---|---|---|
| pgTAP lane + gate | 28 files, **3196/3196 pass**, gate PASS (FLOOR/REQUIRED_FILES are the 05a gate's to raise) | `pgtap-lane.tap`, `pgtap-lane.txt` |
| New pgTAP files with / without 000071-000074 | 99/99 with; 62 fail without | `pgtap-*-with-*.tap`, `pgtap-*-without-*.tap` |
| Vitest, full | **4862 passed, 1 failed** (247 files). The failure is `review2-fixes-db.spec.ts` "AR2-Info (I2) v1 visit PATCH" (403 instead of 500): its probe PATCHes `investigations_advised`, which 05-11c's `0f404cb` (M-APINOTES) now refuses before the database; not a 05-11b file or behaviour (handed to 05-11c in the wave notes). The route returns that 403 (`CLINICAL_ACCESS_DENIED`, `app/api/v1/visits/[id]/route.ts:129`) from the request body alone, so no 05-11b grant or trigger is reached. | `vitest-full.txt` |
| Changed/new specs without 000071-000074 | 19 fail | `specs-without-000071-000074.txt` |
| e2e PR lane (desktop, Pixel 7, iPhone 15), fresh `e2e:build` | **220 passed, 9 skipped, 0 retried**, exit 0 (the `[WebServer] ECONNRESET` lines are client aborts, present in 05-11a's run too) | `e2e-build.txt`, `e2e-pr.txt` |
| typecheck (app + tests), eslint, inventory | all exit 0 (eslint 0 errors; inventory 0 flagged) | `static-checks.txt` |
| gitleaks (repo config) over `d0abfee..6f8bf76` | 5 commits, no leaks | `gitleaks.txt` |

## Open items

- `review2-fixes-db.spec.ts` AR2-Info probe needs a non-clinical field (05-11c, wave notes).
- Register `REFERRAL_TARGET_DOCTOR_INVALID` in `lib/db/errors.ts` `RPC_REASON_CODES` (05-11c owns `lib/db/**`; no app
  path sends `target_doctor_id` today).
- 05a gate: add the four new pgTAP files to `REQUIRED_FILES` and raise `FLOOR`; 05-b0: VALIDATE
  `in_app_notifications_link_url_relative`.
- Product (V2-11 / V2-08 / PO): referral consent copy now gates all clinical fields; shared read state of role and
  broadcast notices (per-user read table would be a new table).
