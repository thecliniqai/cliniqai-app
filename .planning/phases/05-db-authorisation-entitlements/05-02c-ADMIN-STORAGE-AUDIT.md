---
phase: 05
plan: 05-02c
subsystem: database authorisation (admin/system policies, storage, grants hardening, audit v2, definer sweep, lab keys)
status: complete
requirements: [P1-01, P1-04 (trigger part), SVP §6.1, BACKEND C9, PO-3, R-20, R-23, R-42, R-45, R-47, V2-03 handovers (active-tenant binding of every policy and definer function, record_payment has_permission + DB-checked p_tenant_id, lab storage keys without names, per-role statement timeouts)]
plan_head_before: 6cd02edc8bd85b47d1bbaa202be6599ca607d739
plan_head_after: 84328aa
commits: [287b070, 84328aa]
---

# 05-02c record: admin/system policies, storage, grants hardening, audit v2, definer sweep, lab keys

**Outcome:** done locally. Five migrations (000057-000061) close the authorisation matrix: every table, every storage
class and every SECURITY DEFINER function that authorises a user by clinic is on its target rule and bound to the
caller's **active** clinic (R-42). No policy in `public`/`storage` and no function calls a legacy "any membership"
helper (`current_user_tenant_ids`, `current_user_has_role`, `current_user_is_admin_or_owner`): asserted by the generated
completeness test and by `definer_functions.test.sql`. The legacy rule kinds are deleted from the matrix source, so a
leftover cannot compile. Nothing hosted was contacted; every Supabase CLI call used `--local`; resets ran under the
test-run lock.

## What shipped

| Commit | Content |
|---|---|
| `287b070` (feat) | migrations 000057-000061; `EXPECTED_MIGRATION = "000061"`; schema snapshot; `types/database.ts` (`log_audit`); matrix source (legacy kinds deleted, admin/system/storage targets on final rules, `none` → `rpc_only` on tables, storage `row`/`insertRow` for own-visit receipts, malformed-key classes), generator (no legacy kinds or C9 outcome; grants expectation and legacy-policy check in the completeness test), regenerated `authz_matrix.test.sql` (2332 cells) + `authz_completeness.test.sql` (6) + `AUTHZ-MATRIX.md`; `lib/audit/audit.ts` (user path → `log_audit`); labs (`labs:*` guards, id-only keys, `upsert: false`, readable name only as the download name, labs tab notice); `SHARE_LINK_PERMISSIONS`; guard manifest; existing specs adapted (deviation 6) |
| `84328aa` (test) | `supabase/tests/database/{admin_policies (32), storage_policies (46), grants (15), audit_v2 (24), definer_functions (34)}.test.sql`; `tests/storage/storage-policies-jwt.spec.ts` (8), `tests/labs/lab-storage-key.spec.ts` (4), `tests/audit/audit-actor.spec.ts` (5), `tests/e2e/a11y/lab-reports-screens.spec.ts` (6); `tests/ci/schema-snapshot.spec.ts` case (changed storage policy = drift) |
| docs | this record, wave notes, evidence |

### Migrations

| File | What |
|---|---|
| `000057_policies_admin_system` | S/I/U of tenants (S member helper: switcher; U clinic:manage), memberships (S own rows anywhere or staff:view; U active clinic: self or clinic:manage), invitations (S staff:invite; I staff:invite + created_by = caller + owner-only for owner/admin roles), api_keys / api_key_usage_daily / webhook_subscriptions (clinic:manage), webhook_delivery_queue (S clinic:manage), tenant_messaging_config (S clinic:view, I/U clinic:manage), in_app_notifications (S/U: addressed to the caller, or unaddressed to their role / everyone, owners/admins also admin/owner/receptionist notices — the service's own rule; I none), document_share_tokens (S by resource type), patient_documents (labs:view / labs:edit; 05-02b handover a), v1 subscriptions / payment_records (S clinic:manage). `memberships_profile_update_guard`: owner exemption bound to the active clinic |
| `000058_storage_policies` | the 7 bucket-wide policies replaced by 13 per-class policies: prescriptions **rx** (S prescriptions:view, I/U prescriptions:edit), prescriptions **receipt** (S billing:view or own visit, I/U billing:collect or own visit), clinic-records **lab** (S labs:view, I/U/D labs:edit; id-only and legacy names), clinic-records **referral_letter** (S consultations:view, I/U consultations:edit). Full-key regexes, tenant compared as text with `authz.tenant_ids_with(...)::text` (no `::uuid` on a key, C9); any other key denied |
| `000059_grants_hardening` | TRUNCATE/REFERENCES/TRIGGER/MAINTAIN revoked from anon/authenticated on every public table; anon holds no table or sequence privilege in public; authenticated loses every DML privilege no policy admits (26 tables, explicit list); default privileges for `postgres`: new tables/sequences/functions in public grant nothing to anon/authenticated, new functions get no PUBLIC EXECUTE (global). No statement_timeout value changes (R-47) |
| `000060_audit_v2` | `public.log_audit(...)` (definer; session actor, active clinic, bounded input; EXECUTE authenticated only); `private.log_system_audit(...)` (definer; service_role only; closed system-actor set); `audit_logs` INSERT revoked from authenticated/anon (+ the id sequence), "any member inserts" policy dropped, SELECT clinic:manage; `private.audit_logs_actor_guard` refuses an API-role row whose tenant is not the active clinic; `record_payment`: active-clinic + `has_permission(p_tenant_id, 'billing:collect')` before the invoice read, user audit via `log_audit`, system audit via `log_system_audit`; replay rules and the outbox marker unchanged |
| `000061_definer_active_tenant` | sweep: enqueue_message, enqueue_webhook_event (+ ping clinic:manage), private.outbox_payment_recorded, create/revoke_share_token (+ `share_type_roles` follows the resources' RLS keys; invoice links without billing:view only for the doctor's own visit, `private.share_invoice_allowed`), change_member_role, referral_source_clinics, generate_daily_queue_token, search_medicines, communication_queue_claim/finish (session branch), and the bodies of `current_user_has_role` / `current_user_is_admin_or_owner` bound to the active clinic; `get_tenant_table_rls_policies` search_path gets `pg_temp` last |

### The SECURITY DEFINER catalogue (pinned by `definer_functions.test.sql`)

56 definer functions in `public` and `private`, each classified with a reason: 14 **bound** (user-authorised, each with
a dual-member leg: acting in A on a B subject refused, acting in B allowed), 1 **member** helper
(`current_user_tenant_ids`, the switcher, no remaining user), 7 **exempt** (invitation token, onboarding, the anon
reschedule/share tokens, readiness probe, error ingest), 29 **service_role-only**, 5 **internal** (no API grant). The
exact EXECUTE grantee list of all 56 is `set_eq`-pinned; every definer function in `public`, `private`, `authz` and `ops`
has `search_path` `''` or ending in `pg_temp`.

## Tests that fail without the change (tool output, `evidence/05a/05-02c/`)

Runs against the same stack reset to 000056 (the five files held back), then the full chain restored:

- **pgTAP** (`pgtap-without-05-02c.tap`, 7 files, 2478 tests): regenerated `authz_matrix` **769 of 2332 cells fail**
  (every legacy-rule cell of the admin/system tables and storage classes, the dual member acting in B on clinic-A
  rows, the `none` → revoked operations, the C9 22P02 cells); `authz_completeness` 2 of 6 (legacy-helper policies,
  grants set); `admin_policies` 20 of 32; `storage_policies` 31 of 46 (incl. the receptionist reading an Rx PDF, B's
  prefix, the malformed key raising 22P02, the doctor writing a colleague's receipt); `grants` 10 of 15 (TRUNCATE etc.
  held, anon privileges, default ACLs, audit_logs INSERT); `audit_v2` aborts after 13 (no `log_audit`);
  `definer_functions` 17 of 34 (catalogue, grants, every dual-member refusal leg).
- **Vitest** (`specs-without-05-02c-migrations.txt`, 7 files): **26 fail** — `storage-policies-jwt` 6 of 8 (every
  class x principal x operation grid, the plan's key cells, the colleague's receipt archive admitted, the malformed key
  error); `audit-actor` 4 of 5 (direct inserts admitted, no `log_audit`); `record-payment-rpc` doctor/nurse (NOT_FOUND
  instead of FORBIDDEN); the enqueue dual-member legs (acting in A naming B was admitted); `review-fixes-db` share
  links by role (a nurse minting a prescription link, a receptionist a lab or referral link) and two cases that need
  `log_audit`. The doctor's own Sign & Bill receipt archive passes before too (the legacy rule admitted any member):
  it is the legitimate path that must keep working, not a refusal.
- **Lab keys** (`specs-without-lab-key-change.txt`, migrations in place, the pre-change `features/labs/service.ts`):
  3 of 4 fail — the key holds the name and date, the second same-name upload overwrites the first (same key), the
  signed URL's path names the patient.

## Decisions and deviations

1. **[Rule 1] Five migrations, not four.** The plan's file list names five labels (`policies_admin_system`,
   `storage_policies`, `grants_hardening`, `audit_v2`, `definer_active_tenant`); each got its own file.
2. **[Rule 2] Receipt class own-visit rule (05-02b handover b).** The contract's receipt INSERT `billing:collect` would
   have refused the doctor's Sign & Bill archive (`compileAndArchiveReceiptPdf(ctx)` on the doctor's client, a warn-only
   failure today). The class mirrors the invoices table (R-7): S billing:view or, with consultations:edit, the key's
   invoice belongs to the caller's own visit; I/U billing:collect or the same own-visit test. Proven by the real
   generator in `storage-policies-jwt.spec.ts` (object archived, real signed URL) and refused for a colleague's visit.
3. **[Rule 2] Notifications keep role and broadcast notices.** "Own rows only" would have hidden the role-addressed
   and clinic-wide notices `features/notifications/service.ts` shows today (a product change the invariants forbid).
   The policy encodes the service's rule (addressed to the caller; else the caller's role or everyone; owners/admins
   also admin/owner/receptionist notices) and closes the actual gap: no one reads a notice addressed to a colleague.
4. **[Rule 2] No branding class.** No builder writes a branding object (no upload path exists), so there is no class to
   bind; it is added with its first writer. Unknown keys are denied.
5. **[Rule 1] Grants: `none` became `rpc_only` on tables.** "Re-grant only what each table's matrix row needs" revokes
   every DML privilege no policy admits, so those operations now fail with 42501 instead of affecting 0 rows. The
   generator emits the expected per-table set into `authz_completeness.test.sql` (rather than `grants.test.sql`, which
   holds the matrix-independent catalogue loops); `table-matrix.spec.ts` refuses `none` on a table. Specs that
   expected a silent 0-row delete now expect 42501 (`cross-tenant` patients, `visits`, `delete_rules.test.sql` 4 cases).
6. **[Rule 3] Existing specs adapted** (each failed for the intended reason on the first full run, 33 failures in 22
   files): direct `audit_logs` inserts → `log_audit` (`audit-logging`, `payment-actor-guards` M-AUDITSYS: the direct
   insert is now refused and the same claims through `log_audit` are the nurse's); mocked clients gain an `rpc` stub
   (`doctor-availability`, `calendar-scheduling-ux`, `visit-service-guards`, `tokenized-sharing`); `record-payment-rpc`
   (doctor/nurse FORBIDDEN from the function, the role-list grep test replaced by the behaviour, new dual-member leg);
   dual-member enqueue legs act through `signInActingIn`; lab specs (id-only key, download name, labs:* holders:
   `lab-documents`, `ist-boundaries`, `review2` AR2-H1/AR2-L1, `review3` AR3-N1 now the nurse with the receptionist
   refused); share-link parity (`review-fixes-db`: a doctor's invoice link needs their own visit; prescription revoke
   by the doctor, nurse refused).
7. **[Rule 1] PostgreSQL checks EXECUTE on every function of an expression at executor start.** The first version of
   `memberships_profile_update_guard` put `authz.active_tenant_id()` in the same IF as `auth.uid() IS NULL`; every
   service-role membership update failed ("permission denied for function active_tenant_id": seeds, the guard world,
   demo seed). The active-clinic test is now its own statement; the same rule is followed in `record_payment` and the
   audit guard (wave note).
8. **[Rule 2] `private.log_system_audit`.** The plan's catalogue rule "no SECURITY INVOKER function inserts into
   audit_logs" would have flagged `record_payment`'s system branch (invoker, run by service_role); a service_role-only
   definer writer keeps the rule exact.
9. **[Rule 2] Share links follow the resources' read keys.** `create_share_token` bound to the active clinic would still
   have let a nurse mint a prescription link (the role list predates 05-02b's RLS). `share_type_roles` and
   `SHARE_LINK_PERMISSIONS` now follow the keys (prescription prescriptions:view; invoice billing:view or the doctor's
   own visit; patient_document labs:view; referral consultations:view).
10. **`record_payment`'s dual-member leg passes before and after.** With 05-02b's invoices RLS bound to the active
    clinic, a dual member acting in A naming B's invoice already got NOT_FOUND from the RLS-filtered lookup; the new
    DB-side `p_tenant_id` check is defence in depth. What fails without 000060 is the permission check itself (doctor
    and nurse: NOT_FOUND/42501 from RLS before, FORBIDDEN from the function now) and the audit path.
11. **[Rule 2] UI: the labs tab.** Receptionists and admins hold no `labs:view`; the tab shows a fixed notice instead of a
    refused read, and `canEdit` follows `labs:edit` (the 05-04 admin delete-button note). Screens at 360/820/1280 + axe
    (`lab-reports-screens.spec.ts`).
12. **Generated-type casts in `lib/audit/audit.ts`.** `gen types` marks every RPC argument non-null; `p_entity_id` and
    `p_metadata` are passed as `null` when absent (SQL accepts it), with a cast and a comment.

## Product effects to note for the gate (from the plan's target matrix)

- Receptionists and admins no longer see lab reports (patient Lab Reports tab: notice, no upload; server and Storage
  refuse); they cannot share lab reports or referral letters.
- Nurses no longer share prescription or receipt links; a doctor shares a receipt link only for their own visit.
- In-app notices addressed to a user are theirs alone (role and broadcast notices unchanged).
- Webhook delivery logs and audit rows: owners/admins of the active clinic only (as before, now bound).
- Lab report keys hold ids only; a re-upload with the same name and date no longer replaces the earlier report. The
  signed URL still carries the readable name in its `download` query parameter (the plan's R-45 design: the object
  path never does) — flagged for the gate reviewer.

## Lanes (final, tool output in `evidence/05a/05-02c/`)

Code at `84328aa` (migrations unchanged since the lane runs):
- `npm run typecheck` clean; `npx eslint .` 0 errors (387 warnings, the pre-existing count); `npm run inventory`
  exit 0 (0 flagged); `npm run authz:gen -- --check` clean; `npm run db:drift:local` PASS; schema snapshot `--check`
  PASS (2099 lines) (`static-checks.txt`).
- pgTAP lane: **16 files, 2842 tests, PASS**; report gate PASS (`pgtap-lane.tap`). 2601 + 88 matrix cells (53 targets x
  4 x 11; was 51 targets) + 2 completeness + 151 in the five new files. `delete_rules.test.sql` (05-04) now expects
  42501 instead of 0 rows for the four "no member deletes" cases (deviation 5).
- Full Vitest: **228 files, 4554 tests, 4554 passed, 0 failed** (`vitest-full.txt`). The first full run (before the
  adaptations in deviation 6 and the guard fix in deviation 7) had 33 failures in 22 files, all of the kinds listed.
- E2E PR lane (desktop-chrome, Pixel 7, iPhone 15): **220 passed, 9 skipped** (pre-existing project-scoped skips),
  **0 retried / 0 flaky** (`e2e-pr.txt`); the expected-failure knownBug tests (P1-07, F-04, P1-03, the network-block
  negative) behave as before. Web server log: the known `/patients` `request.error` lines (revoked-session pages, 05a
  fix plan) and the deliberate `/api/diag/error`. The labs-tab screens were re-run alone after scrolling the asserted
  element into view for the screenshot (`e2e-lab-screens.txt`, 11 passed incl. setup).
- Screens (`screens/`): Lab Reports tab for the receptionist (notice, no upload) and the doctor (upload) at
  360/820/1280; axe: only `color-contrast`, the M0 baseline rule of `/patients/[id]`, nothing in the 05-02c notice.
- `types/database.ts`: `log_audit` added by `npm run db:types`. gitleaks: see the docs commit.

## Self-Check

PASSED. Files present: the five migrations, the five new pgTAP files, `storage-policies-jwt.spec.ts`,
`lab-storage-key.spec.ts`, `audit-actor.spec.ts`, `lab-reports-screens.spec.ts`, evidence (`static-checks.txt`,
`pgtap-lane.tap`, `pgtap-without-05-02c.tap`, `specs-without-05-02c-migrations.txt`, `specs-without-lab-key-change.txt`,
`vitest-full.txt`, `e2e-pr.txt`, `e2e-lab-screens.txt`, `screens/`); commits `287b070`, `84328aa` are ancestors of HEAD
(`git rev-list --count 6cd02ed..84328aa` = 2); the local stack is back at 000061 (`db reset --local` after the
without-migrations runs).
