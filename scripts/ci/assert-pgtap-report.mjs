#!/usr/bin/env node
/**
 * pgTAP report gate (V2-05 plan 05-01a; roadmap V2-05 evidence "CI pgTAP report", acceptance 1 "… and passes").
 * Same shape as scripts/ci/assert-vitest-report.mjs.
 *
 * Reads the report written by `npm run test:pgtap -- <report.tap>` (scripts/test-pgtap.mjs: the stdout of
 * `supabase test db --local --debug`, i.e. pg_prove --verbose: a `<file> ..` header per file, its TAP stream, then the
 * harness summary) and fails when
 *   - any test is `not ok` (named with its file and description);
 *   - any test carries a `# SKIP` or `# TODO` directive, or a file plans `1..0` (a skipped file): the lane runs everything;
 *   - pg_prove reports a parse error ("No plan found", "Bad plan", …), a dubious exit, or `Result:` is not PASS / absent;
 *   - a file has no plan, or did not run exactly its planned tests in order 1..N (a test that died mid-file);
 *   - the per-file counts disagree with the harness summary `Files=…, Tests=…` (truncated or hand-edited report);
 *   - the total is below the floor (a silently shrinking suite);
 *   - a REQUIRED_FILES entry is missing or has no passed test.
 *
 * FLOOR rule: as the Vitest gate, at least the measured total at each part close (later plans raise it with the
 * arithmetic in the same commit).
 * FLOOR history:
 *   13 — V2-05 05-01a: the two converted legacy files (memberships_bounds_cleanup 7, search_medicines_extension_schema 6).
 *   3343 — V2-05 05a gate close (000078): the full lane at the close had 31 files / 3343 tests, all required:
 *          legacy 13 (memberships_bounds_cleanup 7, search_medicines_extension_schema 6)
 *          + 05-01b authz_helpers 77, authz_matrix 2376, authz_completeness 6
 *          + 05-03 composite_fks 105, migration_edge_cases_fk 21 + 05-04 delete_rules 35
 *          + 05-02a clinical_notes 53, clinical_notes_backfill 9 + 05-02b domain_policies 42
 *          + 05-02c admin_policies 32, storage_policies 46, grants 15, audit_v2 24, definer_functions 40
 *          + 05-06 referrals_rules 48 + 05-08 scheduling_exclusion 26, migration_edge_cases_overlap 9, queue_tokens 34,
 *            tenant_local_dates 20, fk_indexes 4
 *          + 05-11a visit_integrity 45, migration_edge_cases_visit_integrity 17
 *          + 05-11b invitation_binding 14, billing_rpc_only 25, api_keys_notices_columns 26, actor_bindings_audit 34
 *          + 05-11d reverify_integrity 61 + 05-11e amendment_snapshot 60 + 05a close signed_visit_fields 26
 *          = 3343. The floor is the measured total (not 95 %): one dropped test, or one dropped file, fails the gate.
 *   3355 — V2-05 05b 05-b0 (000079 contract_05a): 3343 − 6 definer_functions legs of the three dropped functions
 *          (generate_daily_queue_token, current_user_has_role, current_user_is_admin_or_owner; 40 → 34)
 *          + contract_05a 18 = 3355 (32 files).
 *   3850 — V2-05 05b 05-09a (000080-000084 SUB-01): 3355 + authz_matrix 352 (2376 → 2728: 8 new tables x 4 ops x 11
 *          principals) + billing_access 45 + billing_entitlements 30 + billing_catalogue 30 + billing_grants 24
 *          + subscription_invariant 14 = 3850 (37 files).
 *   4018 — V2-05 05b 05-09b (000085 platform_admin_rpcs): 3850 + authz_matrix 88 (2728 → 2816: platform_admins and
 *          platform_audit_log x 4 ops x 11 principals) + platform_rpcs 80 = 4018 (38 files).
 *   3934 — V2-05 05b 05-09c (000086 drop_v1_subscription_tables): 4018 − authz_matrix 88 (2816 → 2728: the dropped
 *          subscriptions and payment_records x 4 ops x 11 principals) + drop_v1_subscriptions 4 = 3934 (39 files).
 *   4513 — V2-05 05b 05-05 (000087 membership_status): 3934 + authz_matrix 496 (2728 → 3224: 62 targets x 4 ops x 2 new
 *          principals, removed and suspended) + definer_functions 2 (34 → 36: remove_member legs) + remove_member 81
 *          = 4513 (40 files).
 *   4592 — V2-05 05b 05-07a (000088 invitations_v2): 4513 + definer_functions 4 (36 → 40: invite_staff, resend and
 *          revoke legs) + invitations_v2 75 = 4592 (41 files; the matrix keeps 3224 cells, invitations INSERT → rpc_only).
 *   4609 — V2-05 05b 05-07b (000089 invitation_accept_context): 4592 + invitation_accept_context 17 = 4609 (42 files;
 *          definer_functions keeps 40 cases, its classification and grant lists gain the new service-role function).
 *   7388 — V2-05 05b 05-10a (000090 access_enforcement): 4609 + authz_matrix 2728 (3224 → 5952: 62 targets x 4 ops x 11
 *          access-level principals, every A role locked and onboarding plus the dual member acting in a locked A)
 *          + definer_functions 25 (40 → 65: the access classification and its legs) + access_lock_rls 26 = 7388 (43 files).
 *   7838 — V2-05 05b 05-10c (000091 ai_gating): 7388 + authz_matrix 288 (5952 → 6240: 3 new targets x 4 ops x 24
 *          principals) + definer_functions 6 (65 → 71: 2 dual-member and 4 access-level legs for the AI RPCs)
 *          + ai_gating_l2 115 + ai_quota 41 = 7838 (45 files).
 *   7880 — V2-05 05b 05-12 (000092 review fixes, 000093 time-zone contract): 7838 + review_fixes_05b 42 = 7880 (46 files;
 *          ai_quota, definer_functions, invitations_v2, remove_member and tenant_local_dates keep their counts).
 *   7892 — V2-05 05b gate close (000094 gate_close_05b): 7880 + gate_close_05b 12 = 7892 (47 files, every one required;
 *          review_fixes_05b and invitations_v2 keep their counts: two expectations follow the answer's new `role` key and
 *          the objection ruling). The floor is the measured total: one dropped test, or one dropped file, fails the gate.
 *   8036 — V2-07 07-00 (000095 clinic_locations): 7892 + authz_matrix 96 (the clinic_locations target x 4 ops x 24
 *          principals) + composite_fks 6 (the three location FKs, case and control) + definer_functions 4 (the claim
 *          helpers: 3 dual-member and 1 locked leg) + clinic_locations 38 = 8036 (48 files, every one required).
 *   8040 — V2-07 07-02 (000096 billing_commands): 8036 + definer_functions 4 (create_invoice and collect_payment: 1 acting-in-A
 *          and 1 locked-clinic leg each) = 8040 (48 files).
 *   8048 — V2-07 07-01 (000097 clinical_commands): 8040 + definer_functions 8 (sign_consultation, reopen_visit_for_amendment,
 *          finalize_visit_amendment and check_in_visit: 1 acting-in-A and 1 locked-clinic leg each) = 8048 (48 files).
 *   8054 — V2-07 07-03 (000098 front_desk_commands): 8048 + definer_functions 6 (enqueue_walk_in, register_and_book and
 *          complete_and_bill: 1 acting-in-A and 1 locked-clinic leg each) = 8054 (48 files).
 *   8083 — V2-07 07-04a (000099 command_review_fixes): 8054 - 4 definer_functions (the claim helpers lost their API grant, so
 *          their 4 legs go) + 4 clinic_locations (command_hash_key and the keyed hash; the claim leg now asserts the
 *          refusal) + 31 command_review_fixes (new file) - 2 billing_rpc_only (the three insert-guard cases and the formula case go: nobody inserts an invoice as an API role
 *          now; the direct-insert refusal and the definer-role insert replace them) = 8083 (49 files, every one required).
 *   8101 — V2-08 08-01b (000100 visit_state_machine): 8083 + definer_functions 4 (start_consultation and complete_visit: 1
 *          acting-in-A and 1 locked-clinic leg each) + visit_state_machine 14 (new file, every one required);
 *          scheduling_exclusion keeps its 26 (the restore case now uses the no-show rebook) = 8101 (50 files).
 *   8143 — V2-08 08-02 (000101 patient_search_register): 8101 + definer_functions 2 (register_patient: 1 acting-in-A and 1
 *          locked-clinic leg) + patient_search 40 (new file, every one required) = 8143 (51 files).
 *   8174 — V2-08 08-03a (000102 today_realtime): 8143 + today_signals 31 (new file, every one required); the two private
 *          functions and the authz helper add rows to existing exact sets (definer_functions, authz_helpers), no test
 *          = 8174 (52 files).
 *   8237 — V2-08 08-04a (000103 staff_scheduling_commands): 8174 + definer_functions 14 (the six commands: 1 acting-in-A and 1
 *          locked-clinic leg each; get_reschedule_slots: 1 locked and 1 full leg) + staff_scheduling 49 (new file, every one
 *          required; the authz and integrity files keep their counts, they widen the visits UPDATE grant inside their own
 *          transaction) = 8237 (53 files).
 *   8267 — V2-08 08-05 (000105 smart_assist): 8237 + smart_assist 30 (new file, every one required); patient_search keeps its 40
 *          (two assertions changed: the definer read and the strength column) and definer_functions its 109 (find_patient_duplicates
 *          is a row in three exact sets, no test) = 8267 (54 files).
 *   8321 — V2-08 08-06a (000106 front_desk_review_fixes): 8267 + front_desk_review_fixes 54 (new file, every one required); the
 *          authz matrix keeps its cell count (the revoked operations become rpc_only cells), the visit, patient, signal and
 *          scheduling files keep theirs (they widen the INSERT grant inside their own transaction or change an assertion) = 8321
 *          (55 files).
 *   8356 — V2-09a 09A-01 (000107 clinical_seal): 8321 + clinical_seal 31 (new file, every one required) + signed_visit_fields 2 (the N-9
 *          "system path unchanged" case flips to a refusal and two controls follow) + visit_integrity 1 (the signer-FK case is split in
 *          two: the system-path UPDATE is refused, the system-path INSERT of a signed visit still meets the FK) + migration_edge_cases_visit_integrity
 *          1 (same split) = 8356 (56 files). The other changed legacy files (amendment_snapshot, reverify_integrity, command_review_fixes,
 *          visit_state_machine) keep their counts: they only seed signed rows the way production does (R-15).
 *   8391 — V2-09a 09A-02 (000108 prescription_seal): 8356 + prescription_seal 33 (new file, every one required) + grants 1 (the
 *          prescriptions column grant) + amendment_snapshot 1 (the header version rule: a request path writes version 1 only, and
 *          the first header of an open visit is admitted) = 8391 (57 files). authz_matrix keeps its cell count (the prescriptions INSERT
 *          cell frees the fixture header and writes version 1; the UPDATE cell sets letterhead_mode); visit_integrity and
 *          amendment_snapshot widen the prescriptions UPDATE grant inside their own transaction, like they do for visits.
 *   8430 — V2-09a 09A-03 (000109 rx_pdf_write_once): 8391 + rx_pdf_write_once 28 (new file, every one required) + storage_policies 11 (46 -> 57) (the Rx INSERT cases
 *          of section 2b: draft, amending, sealed unarchived as doctor and as owner, a future version, an archived header, a nurse, another clinic, a key with
 *          no visit, no DELETE; the two old Rx cases change their expectation and the catalogue loses the Rx UPDATE policy) = 8430 (58 files). prescription_seal
 *          and grants keep their counts (the column list and two expectations change); authz_matrix keeps its cell count (the rx INSERT and UPDATE cells become
 *          `none`).
 *   8454 — V2-09a 09A-04 (000110 lab_documents_append_only): 8430 + lab_documents_append_only 24 (new file, every one required); delete_rules and
 *          storage_policies keep their counts (the DELETE catalogue loses patient_documents_delete, the lab storage catalogue loses its UPDATE and DELETE
 *          policies, and the doctor's lab delete now affects 0 rows); authz_matrix keeps its cell count (patient_documents DELETE becomes `rpc_only`, the lab
 *          UPDATE and DELETE storage cells become `none`) = 8454 (59 files).
 *   8494 — V2-09a 09A-06a (000111 clinical_review_fixes, the review fix round): 8454 + clinical_review_fixes 40 (new file, every one required) = 8494
 *          (60 files). The changed files keep their counts: rx_pdf_write_once (the matrix gains state X and the owner/doctor split, same 28 assertions),
 *          storage_policies (the owner's Rx upload flips to refused), lab_documents_append_only (the UPDATE controls flip to refused), prescription_seal
 *          (the signer archives before the reopen), admin_policies / domain_policies / authz_completeness (two policies and two grants fewer in their
 *          catalogues); amendment_snapshot, reverify_integrity, signed_visit_fields and visit_integrity restore the member INSERT on visit_revisions inside
 *          their own transaction (they prove the guards); authz_matrix keeps its cell count (visit_revisions INSERT and patient_documents UPDATE
 *          become `rpc_only`).
 *   8554 — V2-09b 09B-01 (000112 consult_draft_save): 8494 + consult_draft_save 60 (new file, every one required) = 8554 (61 files). The changed files keep their
 *          counts: definer_functions (two registry rows: save_consultation_draft and private.step_start_consultation), authz_matrix and authz_completeness
 *          (generated: the follow_ups INSERT, UPDATE and DELETE cells become `rpc_only`; the cell count is unchanged), composite_fks (the three follow_ups
 *          clones go to a free visit), clinical_seal (the follow-up insert probe is the upsert), and amendment_snapshot, clinical_notes, delete_rules,
 *          visit_integrity, clinical_seal and composite_fks widen the clinical_notes UPDATE and follow_ups write grants inside their own transaction.
 *   8583 — V2-09b 09B-03 (000113 consult_assist_context): 8554 + consult_assist_context 29 (new file, every one required) = 8583 (62 files). No other file changes
 *          its count (a new INVOKER read function: no table, policy or grant change).
 *   8632 — V2-09b 09B-04a (000114 diagnosis_search_snapshot): 8583 + diagnosis_search_snapshot 49 (new file, every one required) = 8632 (63 files). No other
 *          file changes its count (two new INVOKER read functions: no table, policy or grant change).
 *   8776 — V2-09b 09B-04b (000115 doctor_text_macros): 8632 + doctor_text_macros 46 (new file, every one required) + authz_matrix 96 (the new tenant table: 4 operations x 24
 *          principals, generated) + composite_fks 2 (the doctor_text_macros FK: the refusal and the control) = 8776 (64 files). authz_completeness, access_lock_rls and
 *          delete_rules keep their counts (set comparisons and a sweep over the catalogue).
 *   8824 — V2-09b 09B-06a (000116 consult_review_fixes): 8776 + consult_review_fixes 48 (new file, every one required) = 8824 (65 files). consult_draft_save
 *          (follow-up dates relative to the clinic's today), clinical_review_fixes (the fixture document on the draft visit) and tenant_local_dates (the new
 *          BEFORE INSERT trigger is not a date filler) keep their counts.
 *   8888 — V2-09c 09C-01 (000117 rx_lines_command): 8824 + rx_lines_command 64 (new file, every one required) = 8888 (66 files). The changed files keep their
 *          counts: definer_functions (the search_medicines registry rows are replaced by change_prescription's; its three assertions now read the INVOKER
 *          function), search_medicines_extension_schema (re-pointed to the new function, same 6), authz_matrix and authz_completeness (generated: the
 *          prescription_items INSERT, UPDATE and DELETE, the prescriptions INSERT and the doctor_custom_medicines INSERT and UPDATE cells become `rpc_only`;
 *          the cell count is unchanged), and amendment_snapshot, clinical_seal, delete_rules, prescription_seal, reverify_integrity, rx_pdf_write_once and
 *          visit_integrity widen the Rx grants inside their own transaction.
 *   8931 — V2-09c 09C-02 (000118 rx_allergy_check): 8888 + rx_allergy_check 43 (new file, every one required) = 8931 (67 files). The changed files keep
 *          their counts: definer_functions (one registry row, record_patient_allergies), authz_matrix and authz_completeness (no table or policy change).
 *   8986 — V2-09c 09C-03 (000119 rx_assist): 8931 + rx_assist 55 (new file, every one required) = 8986 (68 files). consult_assist_context keeps its 29 (its empty
 *          result and its key list name the two new keys), definer_functions (one registry row, repeat_visit_plan) its count; no table, column or policy changed.
 *   9025 — V2-09c 09C-06a (000120 rx_review_fixes): 8986 + rx_review_fixes 39 (new file, every one required) = 9025 (69 files). The changed files keep their
 *          counts: rx_allergy_check (record_patient_allergies takes p_expected), definer_functions (one registry row, the allergy audit trigger),
 *          authz_matrix and access_lock_rls (regenerated: the doctor_custom_medicines select cells follow the caller's own rows, S-7).
 *   9088 — V2-09e 09E-02 (000122 rum_daily): 9025 + rum_daily 63 (new file, every one required) = 9088 (70 files). definer_functions keeps its count (three
 *          registry rows for the one new function, ops_ingest_rum); no table or policy of `public` changed (the new tables are in `ops`, unserved).
 *   9291 — V2-09e 09E-04 (000123 clinic_versions): 9088 + clinic_versions 107 (new file, every one required) + the regenerated authz files (the new table's cells in
 *          authz_matrix, access_lock_rls and authz_completeness) + today_signals (+0) and front_desk_review_fixes (+0, A-5 reworded) = 9291 (71 files).
 *   9364 — V2-09e 09E-05 (000124 consult_screen): 9291 + consult_screen 73 (new file, every one required) = 9364 (72 files). No table, policy or definer function
 *          changed, so the authz files and definer_functions keep their counts.
 *   9426 — V2-09e 09E-06 (000125 today_board): 9364 + today_board 62 (new file, every one required) = 9426 (73 files). One new INVOKER function and no table, policy
 *          or definer function, so the authz files and definer_functions keep their counts.
 *   9505 — V2-09e 09E-07 (000126 stale_write_refusal): 9426 + stale_write_refusal 79 (new file, every one required) = 9505 (74 files). Ten definer commands are replaced
 *          with the same name, checks and grants (one parameter more); the signature pins in staff_scheduling, visit_state_machine and billing_rpc_only changed text, not count.
 *   9559 — V2-09e 09E-14a (000127 review_fixes_09e): 9505 + review_fixes_09e 54 (new file, every one required) = 9559 (75 files). rum_daily keeps its 63 (its caller
 *          now has a membership); definer_functions and today_signals keep their counts (four classified functions; 22 statement triggers became 27).
 * REQUIRED_FILES: the converted legacy files (05-01a) and every 05a file (05a gate close); each 05b plan appends its
 * files and raises the floor in the same commit (05b execution rule).
 *
 * Usage: node scripts/ci/assert-pgtap-report.mjs <report.tap> [--min-total <n>] [--require-files <a,b,…|none>]
 *   --require-files replaces REQUIRED_FILES (repo-relative paths); `none` disables the check (gate fixtures only).
 * Exit 0 = pass, 1 = gate failure, 2 = usage or unreadable report.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const FLOOR = 9559;

export const REQUIRED_FILES = [
  // 05-01a: the converted legacy files.
  "supabase/tests/database/memberships_bounds_cleanup.test.sql",
  "supabase/tests/database/search_medicines_extension_schema.test.sql",
  // V2-05 05a (gate close): every 05a file, by plan.
  // 05-01b
  "supabase/tests/database/authz_helpers.test.sql",
  "supabase/tests/database/authz_matrix.test.sql",
  "supabase/tests/database/authz_completeness.test.sql",
  // 05-03
  "supabase/tests/database/composite_fks.test.sql",
  "supabase/tests/database/migration_edge_cases_fk.test.sql",
  // 05-04
  "supabase/tests/database/delete_rules.test.sql",
  // 05-02a
  "supabase/tests/database/clinical_notes.test.sql",
  "supabase/tests/database/clinical_notes_backfill.test.sql",
  // 05-02b
  "supabase/tests/database/domain_policies.test.sql",
  // 05-02c
  "supabase/tests/database/admin_policies.test.sql",
  "supabase/tests/database/storage_policies.test.sql",
  "supabase/tests/database/grants.test.sql",
  "supabase/tests/database/audit_v2.test.sql",
  "supabase/tests/database/definer_functions.test.sql",
  // 05-06
  "supabase/tests/database/referrals_rules.test.sql",
  // 05-08
  "supabase/tests/database/scheduling_exclusion.test.sql",
  "supabase/tests/database/migration_edge_cases_overlap.test.sql",
  "supabase/tests/database/queue_tokens.test.sql",
  "supabase/tests/database/tenant_local_dates.test.sql",
  "supabase/tests/database/fk_indexes.test.sql",
  // 05-11a
  "supabase/tests/database/visit_integrity.test.sql",
  "supabase/tests/database/migration_edge_cases_visit_integrity.test.sql",
  // 05-11b
  "supabase/tests/database/invitation_binding.test.sql",
  "supabase/tests/database/billing_rpc_only.test.sql",
  "supabase/tests/database/api_keys_notices_columns.test.sql",
  "supabase/tests/database/actor_bindings_audit.test.sql",
  // 05-11d
  "supabase/tests/database/reverify_integrity.test.sql",
  // 05-11e
  "supabase/tests/database/amendment_snapshot.test.sql",
  // 05a gate close (000078)
  "supabase/tests/database/signed_visit_fields.test.sql",
  // V2-05 05b, per plan.
  // 05-b0
  "supabase/tests/database/contract_05a.test.sql",
  // 05-09a
  "supabase/tests/database/billing_access.test.sql",
  "supabase/tests/database/billing_entitlements.test.sql",
  "supabase/tests/database/billing_catalogue.test.sql",
  "supabase/tests/database/billing_grants.test.sql",
  "supabase/tests/database/subscription_invariant.test.sql",
  "supabase/tests/database/platform_rpcs.test.sql",
  "supabase/tests/database/drop_v1_subscriptions.test.sql",
  // 05-05
  "supabase/tests/database/remove_member.test.sql",
  // 05-07a
  "supabase/tests/database/invitations_v2.test.sql",
  // 05-07b
  "supabase/tests/database/invitation_accept_context.test.sql",
  // 05-10a
  "supabase/tests/database/access_lock_rls.test.sql",
  // 05-10c
  "supabase/tests/database/ai_gating_l2.test.sql",
  "supabase/tests/database/ai_quota.test.sql",
  // 05-12
  "supabase/tests/database/review_fixes_05b.test.sql",
  // 05b gate close (000094: re-verification N-1, N-2; objection ruling)
  "supabase/tests/database/gate_close_05b.test.sql",
  // V2-07 07-00 (000095: clinic locations, command_results)
  "supabase/tests/database/clinic_locations.test.sql",
  // V2-07 07-04a (000099: command review fixes)
  "supabase/tests/database/command_review_fixes.test.sql",
  // V2-08 08-01b
  "supabase/tests/database/visit_state_machine.test.sql",
  // V2-08 08-02
  "supabase/tests/database/patient_search.test.sql",
  "supabase/tests/database/today_signals.test.sql",
  // V2-08 08-04a
  "supabase/tests/database/staff_scheduling.test.sql",
  // V2-08 08-05
  "supabase/tests/database/smart_assist.test.sql",
  // V2-08 08-06a
  "supabase/tests/database/front_desk_review_fixes.test.sql",
  // V2-09a 09A-01
  "supabase/tests/database/clinical_seal.test.sql",
  // V2-09a 09A-02
  "supabase/tests/database/prescription_seal.test.sql",
  // V2-09a 09A-03
  "supabase/tests/database/rx_pdf_write_once.test.sql",
  // V2-09a 09A-04
  "supabase/tests/database/lab_documents_append_only.test.sql",
  // V2-09a 09A-06a
  "supabase/tests/database/clinical_review_fixes.test.sql",
  // V2-09b 09B-01
  "supabase/tests/database/consult_draft_save.test.sql",
  // V2-09b 09B-03
  "supabase/tests/database/consult_assist_context.test.sql",
  // V2-09b 09B-04a
  "supabase/tests/database/diagnosis_search_snapshot.test.sql",
  // V2-09b 09B-04b
  "supabase/tests/database/doctor_text_macros.test.sql",
  // V2-09b 09B-06a
  "supabase/tests/database/consult_review_fixes.test.sql",
  // V2-09c 09C-01
  "supabase/tests/database/rx_lines_command.test.sql",
  // V2-09c 09C-02
  "supabase/tests/database/rx_allergy_check.test.sql",
  // V2-09c 09C-03
  "supabase/tests/database/rx_assist.test.sql",
  // V2-09c 09C-06a
  "supabase/tests/database/rx_review_fixes.test.sql",
  // 09E-02
  "supabase/tests/database/rum_daily.test.sql",
  // 09E-04
  "supabase/tests/database/clinic_versions.test.sql",
  // V2-09e 09E-05
  "supabase/tests/database/consult_screen.test.sql",
  // V2-09e 09E-06
  "supabase/tests/database/today_board.test.sql",
  "supabase/tests/database/stale_write_refusal.test.sql",
  // V2-09e 09E-14a
  "supabase/tests/database/review_fixes_09e.test.sql",
];

/** `/abs/path/supabase/tests/database/x.test.sql ..` (pg_prove prints the dots as one run, then a space). */
const FILE_HEADER = /^(\S+\.(?:sql|pg))\s+\.{2,}\s*(?:ok)?\s*$/;
const PLAN = /^1\.\.(\d+)(?:\s*#\s*(.*))?$/;
/** `ok 3 - description # SKIP reason` (pgTAP escapes a `#` inside a description as `\#`). */
const TEST = /^(not )?ok (\d+)\b(.*)$/;
const SUMMARY = /^Files=(\d+),\s*Tests=(\d+)/;
const RESULT = /^Result:\s*(\S+)/;

/** Repo-relative path (`supabase/tests/…`) whatever the checkout directory was. */
export function shortName(file) {
  const i = file.indexOf("supabase/tests/");
  return i > -1 ? file.slice(i) : file;
}

/**
 * @param {string} text the report
 * @param {{ floor?: number, required?: string[] }} [opts]
 * @returns {{ problems: string[], counts: { files: number, total: number, passed: number, failed: number, skipped: number },
 *   files: Array<{ name: string, planned: number | null, ran: number, passed: number }> }}
 */
export function checkPgTapReport(text, { floor = FLOOR, required = REQUIRED_FILES } = {}) {
  const problems = [];
  const files = [];
  let current = null;
  let summary = null;
  let result = null;
  let inSummaryReport = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const header = FILE_HEADER.exec(line);
    if (header && !inSummaryReport) {
      current = { name: shortName(header[1]), planned: null, skipAll: false, ran: 0, passed: 0, numbers: [] };
      files.push(current);
      continue;
    }
    if (/^Test Summary Report/.test(line) || /^All tests successful/.test(line)) {
      inSummaryReport = true;
      current = null;
      continue;
    }
    const s = SUMMARY.exec(line);
    if (s) {
      summary = { files: Number(s[1]), tests: Number(s[2]) };
      current = null;
      continue;
    }
    const r = RESULT.exec(line);
    if (r) {
      result = r[1];
      continue;
    }
    if (/Parse errors?:/i.test(line)) problems.push(`pg_prove parse error: ${line.trim()}`);
    if (/^Dubious, test returned/.test(line.trim())) problems.push(`pg_prove: ${line.trim()} (${current?.name ?? "unknown file"})`);
    if (!current) continue;

    const p = PLAN.exec(line);
    if (p) {
      current.planned = Number(p[1]);
      if (current.planned === 0 || /^skip/i.test(p[2] ?? "")) {
        current.skipAll = true;
        problems.push(`file skipped (1..0 / SKIP plan; 0 skipped allowed): ${current.name}`);
      }
      continue;
    }
    const t = TEST.exec(line);
    if (t) {
      const notOk = Boolean(t[1]);
      const num = Number(t[2]);
      const hash = t[3].search(/(?<!\\)#/);
      const desc = (hash > -1 ? t[3].slice(0, hash) : t[3]).replace(/^\s*-?\s*/, "").trim() || "(no description)";
      const directive = hash > -1 ? t[3].slice(hash + 1).trim() : "";
      current.ran += 1;
      current.numbers.push(num);
      if (/^skip\b/i.test(directive)) {
        problems.push(`test skipped (0 skipped allowed): ${current.name} > ${num} - ${desc} (# ${directive})`);
      } else if (/^todo\b/i.test(directive)) {
        problems.push(`test todo (0 todo allowed): ${current.name} > ${num} - ${desc}`);
      } else if (notOk) {
        problems.push(`test failed: ${current.name} > ${num} - ${desc}`);
      } else {
        current.passed += 1;
      }
    }
  }

  const counts = { files: files.length, total: 0, passed: 0, failed: 0, skipped: 0 };
  for (const f of files) {
    counts.total += f.ran;
    counts.passed += f.passed;
    if (f.planned === null) problems.push(`no plan found: ${f.name}`);
    else if (!f.skipAll && f.ran !== f.planned) problems.push(`planned ${f.planned} tests but ran ${f.ran}: ${f.name}`);
    if (f.numbers.some((n, i) => n !== i + 1)) problems.push(`test numbers are not 1..${f.ran} in order: ${f.name}`);
  }
  counts.failed = problems.filter((p) => p.startsWith("test failed")).length;
  counts.skipped = problems.filter((p) => p.startsWith("test skipped") || p.startsWith("test todo")).length;

  if (files.length === 0) problems.push("no pgTAP file in the report (did `supabase test db` run?)");
  if (result === null) problems.push("no `Result:` line (report truncated?)");
  else if (result !== "PASS") problems.push(`Result: ${result}`);
  if (summary === null) problems.push("no `Files=…, Tests=…` summary line (report truncated?)");
  else {
    if (summary.files !== files.length) problems.push(`summary Files=${summary.files} but the report has ${files.length} files`);
    if (summary.tests !== counts.total) problems.push(`summary Tests=${summary.tests} but the report has ${counts.total} test lines`);
  }
  if (counts.total < floor) problems.push(`total ${counts.total} is below the floor ${floor} (suite shrank?)`);
  for (const req of required) {
    const f = files.find((x) => x.name === req || x.name.endsWith(`/${req}`));
    if (!f) problems.push(`required pgTAP file missing: ${req}`);
    else if (f.passed === 0) problems.push(`required pgTAP file has no passed test: ${req}`);
  }
  return { problems, counts, files: files.map(({ name, planned, ran, passed }) => ({ name, planned, ran, passed })) };
}

function main(argv) {
  const file = argv[0];
  if (!file || file.startsWith("--")) {
    console.error("usage: node scripts/ci/assert-pgtap-report.mjs <report.tap> [--min-total <n>] [--require-files <a,b|none>]");
    return 2;
  }
  const minIdx = argv.indexOf("--min-total");
  const floor = minIdx > -1 ? Number(argv[minIdx + 1]) : FLOOR;
  if (!Number.isInteger(floor) || floor < 0) {
    console.error("pgtap-report-gate: --min-total must be a non-negative integer");
    return 2;
  }
  const reqIdx = argv.indexOf("--require-files");
  const reqArg = reqIdx > -1 ? argv[reqIdx + 1] : undefined;
  if (reqIdx > -1 && (reqArg === undefined || reqArg === "")) {
    console.error("pgtap-report-gate: --require-files needs a comma-separated list or `none`");
    return 2;
  }
  const required =
    reqArg === undefined ? REQUIRED_FILES : reqArg === "none" ? [] : reqArg.split(",").map((s) => s.trim()).filter(Boolean);

  let text;
  try {
    text = readFileSync(resolve(file), "utf8");
  } catch {
    console.error(`pgtap-report-gate: cannot read a report at ${file}`);
    return 2;
  }
  const { problems, counts } = checkPgTapReport(text, { floor, required });
  console.log(
    `pgtap-report-gate: files=${counts.files} tests=${counts.total} passed=${counts.passed} failed=${counts.failed} ` +
      `skipped/todo=${counts.skipped} floor=${floor} required=${required.length}`,
  );
  if (problems.length) {
    const shown = problems.slice(0, 200);
    for (const p of shown) console.error(`FAIL ${p}`);
    if (problems.length > shown.length) console.error(`FAIL ... and ${problems.length - shown.length} more`);
    return 1;
  }
  console.log("pgtap-report-gate: PASS");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
