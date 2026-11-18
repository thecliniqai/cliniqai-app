---
phase: 05
part: 05a
roadmap_id: V2-05 (part 05a, "Role RLS & integrity")
name: Database authorisation, integrity & entitlements — part 05a
status: awaiting PO gate approval (05-P6); G3 also needs 05b and V2-06
base_commit: 998999a (V2-04 branch tip `v2/phase-04-jobs-reliability`, merge base of this branch)
head_commit: 4c46ec1 (verified; later commits are docs and evidence only)
branch: v2/phase-05-db-authorisation-entitlements (the plan's `v2/phase-05a-db-authz-integrity` was not created; 05b continues here or branches from the 05a merge)
---

# Phase 05, part 05a (V2-05a) — summary

05a makes the database the last line of defence for **roles**. Every tenant table, storage class and user-facing
SECURITY DEFINER function is bound to the session's **active** clinic and to a permission key from one matrix
(`lib/permissions/matrix.ts` ⇄ `authz.role_has_permission`, parity-tested). Clinical content moved to its own table
so a receptionist's PostgREST read is denied (PO-3). A child row can reference a parent only in its own clinic
(composite FKs). Double booking, queue-token races and SQL `CURRENT_DATE` defaults are closed in the schema. Three
reviews, a re-verification and two re-checks hardened column-level authority (actor columns, signed visits, billing totals, API
keys, notices, invitations). Status and access levels (removed members, subscriptions, AI gating) are 05b. The PO
delegated decisions to the agent acting as CTO (05-P1); rulings R-1…R-47 are in `05-PLAN.md` § Rulings, review rulings
in `05a-REVIEW-TRIAGE.md`. Every number below is copied from a tool output under `evidence/05a/` or from a plan record
that cites one.

## What changed, by plan
| Plan | Outcome (record) |
|---|---|
| 05-01a pgTAP harness | `npm run test:pgtap` runs every `supabase/tests/database/*.test.sql` against the local stack under the test-run lock; `scripts/ci/assert-pgtap-report.mjs` gates the report (no skip/todo, plan = ran, floor, required files); CI `test` job runs it before Vitest and uploads `pgtap-report`; the two legacy psql scripts converted (`05-01a-PGTAP.md`). |
| 05-01b authz core | `authz` schema (fixed-signature helpers, `active_tenant_id()` from the `x-clinicos-tenant` header set by the server from the clinic cookie, R-42), `public.has_permission`, `permission_matrix()`; PO-3 keys (`billing:collect`; receptionist registers patients, M0 F-01 fixed); parity spec; generated matrix (`authz_matrix.test.sql`, `authz_completeness.test.sql`, `AUTHZ-MATRIX.md`) from `tests/authz/table-matrix.ts`; restore drill runs the matrix (V2-04 R-11); migration 000046 (`05-01b-AUTHZ-CORE.md`). |
| 05-03 Composite FKs | 38 composite FKs `<child>_tenant_<ref>_fkey` (expand NOT VALID → validate → contract), `prescription_items.tenant_id`, doctor columns bound to clinic members, webhook queue → subscription (M-XTENANT-WH); counts-only diagnostics tool `npm run db:diagnostics` (local only); migrations 000047–000051 (`05-03-COMPOSITE-FKS.md`). |
| 05-04 DELETE policies | Every DELETE policy final, RESTRICT on clinical/financial children proven, `visits_delete_member` dropped, the 8 `FOR ALL` policies split, silent no-op deletes now FORBIDDEN in the services; migration 000052 (`05-04-DELETE-POLICIES.md`). |
| 05-02a Clinical split | `public.clinical_notes` (1:1 with visits, created by trigger), backfill, VALID "moved" CHECK on the six `visits` columns, ~26 app files switched; SELECT `consultations:view`, UPDATE `consultations:edit`/`vitals:edit`; migration 000053 (`05-02a-CLINICAL-SPLIT.md`). |
| 05-02b Domain policies | Clinical, front-desk and financial S/I/U policies on 20 tables bound to the active clinic; doctors see invoices of their own visits only; R-8 allergy guard; billing guards on `billing:collect`; migrations 000054–000056 (`05-02b-DOMAIN-POLICIES.md`). |
| 05-02c Admin, storage, grants, audit | Admin/system policies, per-class storage policies (lab keys hold ids only, R-45), closed-by-default grants (R-13), audit v2 (`log_audit`, no user INSERT on `audit_logs`), definer-function sweep with dual-member legs, `record_payment` on `has_permission` with a DB-checked tenant, per-role statement timeouts pinned; migrations 000057–000061 (`05-02c-ADMIN-STORAGE-AUDIT.md`). |
| 05-06 Referrals + exports | Opt-in referral directory (`tenants.referral_directory_listed`), consent guard, `referral_directory_search`; `exports:create` on both export paths with allow-list DTOs; `api_keys.scopes` with a scope guard; migrations 000062, 000067 (`05-06-REFERRALS-EXPORTS.md`). |
| 05-08 Integrity | `visits_no_double_booking` exclusion constraint (23P01 → CONFLICT, deadlock retry), queue-token counter table (50 parallel check-ins → 50 distinct tokens), clinic-local dates in SQL with app parity (V2-03 R-33), FK index sweep; migrations 000063–000066 (`05-08-INTEGRITY.md`). |
| 05-11a Visit integrity fixes | H-VISIT, M-ACTOR (visits, prescriptions, amendments), M-SIGNED, M-DURATION, M-TOKEN (`issue_queue_token`, `next_queue_token` dropped), doctor reassignment; migrations 000068–000070 (`05-11a-INTEGRITY-FIXES.md`). |
| 05-11b Credentials, billing fixes | H-INVITE (`token_hash` unreadable, redemption bound to the confirmed invited email), M-INVOICE (totals and payments RPC-only, `record_payment` definer), M-APIKEY, M-NOTICE, consent/referral actors, `log_audit` allow-lists; migrations 000071–000074 (`05-11b-CREDENTIALS-BILLING-FIXES.md`). |
| 05-11c App fixes | M-APINOTES (no clinical content on `/api/v1/visits`), shared deadlock retry, fixed v1 error texts, DPDP export fails closed, referral consent write checked, revoked-session pages redirect (`withPageAuth`); application only (`05-11c-APP-FIXES.md`). |
| 05-11d Re-verification fixes | N-1 (Rx items and diagnoses of a signed visit), N-2 (database-built amendment snapshot and number), N-3 (invoice items lock and recompute), N-5, N-6, N-7, N-8; migrations 000075–000076 (`05-11d-REVERIFY-FIXES.md`). |
| 05-11e Amendment snapshot fixes | NF-1 (reopen only with a snapshot of the current signature), NF-2 (every Rx header and item in the snapshot, no new header on a signed visit), NF-3 (follow-up guard); migration 000077 (`05-11e-AMENDMENT-SNAPSHOT-FIXES.md`). |
| 05a close | NF-4 and NF-5 (the final re-check's two Lows) fixed in 000078 with `signed_visit_fields.test.sql` (13 of 26 fail at 000077, `evidence/05a/close/pgtap-signed_visit_fields-{without,with}-000078.tap`); pgTAP gate: 31 required files, floor 3343, with two real-run negative proofs; Vitest gate: 37 new required specs (155), floor 4633; triage, wave notes and PO actions updated. |

## Migrations (000046–000078, thirty-three files, immutability-gated)
| # | File | Plan |
|---|---|---|
| 000046 | `authz_core` | 05-01b |
| 000047 | `tenant_parent_keys` | 05-03 |
| 000048 | `prescription_items_tenant_id` | 05-03 |
| 000049 | `composite_fks_expand` | 05-03 (expand, NOT VALID) |
| 000050 | `composite_fks_validate` | 05-03 (validate) |
| 000051 | `composite_fks_contract` | 05-03 (contract) |
| 000052 | `delete_policies` | 05-04 |
| 000053 | `clinical_notes_expand` | 05-02a (expand + migrate; contract in 05-b0) |
| 000054 | `policies_clinical` | 05-02b |
| 000055 | `policies_front_desk` | 05-02b |
| 000056 | `policies_financial` | 05-02b |
| 000057 | `policies_admin_system` | 05-02c |
| 000058 | `storage_policies` | 05-02c |
| 000059 | `grants_hardening` | 05-02c |
| 000060 | `audit_v2` | 05-02c |
| 000061 | `definer_active_tenant` | 05-02c |
| 000062 | `referrals_directory_consent` | 05-06 |
| 000063 | `visits_no_double_booking` | 05-08 |
| 000064 | `queue_token_counters` | 05-08 |
| 000065 | `tenant_local_dates` | 05-08 |
| 000066 | `fk_indexes` | 05-08 |
| 000067 | `api_key_scope_guard` | 05-06 |
| 000068 | `visit_integrity_expand` | 05-11a |
| 000069 | `visit_integrity_migrate` | 05-11a (stops on D5s > 0) |
| 000070 | `visit_integrity_contract` | 05-11a (after the `issue_queue_token` app serves) |
| 000071 | `invitation_token_binding` | 05-11b |
| 000072 | `billing_totals_rpc_only` | 05-11b |
| 000073 | `api_keys_notices_columns` | 05-11b (`link_url` CHECK NOT VALID) |
| 000074 | `actor_bindings_audit_templates` | 05-11b |
| 000075 | `reverify_integrity_expand` | 05-11d |
| 000076 | `reverify_integrity_migrate` | 05-11d (stops on D7i > 0) |
| 000077 | `amendment_snapshot_integrity` | 05-11e |
| 000078 | `signed_visit_fields` | 05a close (NF-4, NF-5) |

Every migration commit carried the `EXPECTED_MIGRATION` bump, the schema snapshot and `db:types` (V2-04 R-45).

## Deploy notes (05-b0 and the staging migrate, 05-P2 / 05-P8)
- **Diagnostics before the migrate.** Run `scripts/db/diagnostics.sql` (counts only) on the target before applying
  05a; its blocking set must be 0 or each row explained. The D-series that gate a migration: **D1/D1x and D5x**
  (cross-tenant references and non-member doctors: 000050's VALIDATE fails on any), **D6/D6d** (overlaps and
  durations outside 5–480: 000063's constraint and 000069's clamp), **D9t** (tokens outside 1–9999, renumbered by
  000069), **D5s** (visits signed by a non-member: **000069 stops**, no automatic remedy — a signature is never
  rewritten), **D7i** (invoice items with a negative price or a wrong line total: **000076 stops if D7i > 0**; correct the
  line with the clinic, then re-run). Report-only before 000076/000077: **D1p** (diagnoses on another patient), **D11r**
  (amendment numbers above 10000), **D1f** (follow-ups on another patient). On the local stack the tool refuses any
  non-loopback target; a hosted run goes through the PO-approved staging workflow only (05-P8).
- **000070 after the `issue_queue_token` app is serving.** 000070 revokes the members' INSERT on `queue_tokens` and drops
  `next_queue_token`; an older build that checks in by inserting tokens fails at check-in. On a database with live users
  split the run: 000046–000069, deploy this app, then 000070 onwards. Staging (synthetic data, migrate-before-promote)
  takes the short gap between migrate and promote, as already ruled for 000053 (IND L3).
- **000075 before the 05-11d app** (`reopenVisitForAmendment` no longer sends `snapshot`/`revision_number`).
- **`link_url` VALIDATE (05-b0).** 000073 adds `in_app_notifications_link_url_relative` NOT VALID (tightened by 000075);
  05-b0 runs **D11n** and then `VALIDATE CONSTRAINT` once it is 0.
- **05-b0 contract steps:** drop `visits_clinical_content_moved` and the six moved `visits` columns, drop
  `generate_daily_queue_token` (and its `definer_functions.test.sql` row); I-2 only if a v2 database with real users is
  ever migrated (bump `current_revision` past existing rows once).
- **Hosted Auth "Confirm email" must stay ON** (staging and production). H-INVITE binds invitation redemption to the
  caller's **confirmed** email; with confirmations off, any address would count as confirmed. Already set by 03-E3 and
  checked by the drift `auth-config` job (`supabase/auth-policy.json` row `email_confirmations`); 05-P9.
- No new dependency in 05a (`package.json` gains only the scripts `db:diagnostics`, `test:pgtap`, `authz:gen`).

## Deviations (detail in each record's "Decisions and deviations" section)
- **Branch and PR shape (R-1):** one branch `v2/phase-05-db-authorisation-entitlements` instead of the planned
  `v2/phase-05a-db-authz-integrity`; base = the V2-04 branch at `998999a` (merge base).
- **Review reports:** the authorisation adversarial review is `reviews/v205a-review-adversarial-rls.md` (planned name
  `…-authz.md`). The fix plan `05a-fix` became five plans (05-11a…05-11e) plus the 05a-close fix (000078).
- **Scope pulled forward from 05b:** H-INVITE's minimal invitation binding (05-07a still delivers invitations v2);
  `next_queue_token` replaced by `issue_queue_token` (000070) instead of the planned 05-08 function.
- **Not fixed locally, assigned:** N-4 (front-desk completion of unsigned visits) → V2-09a with V2-08; N-9 (service-role
  writers can reopen a signed visit) → V2-09a / P1-37; Rx header UPDATE on a signed visit (R-21) → V2-09a.
- **05a close:** `signed_at` = `now()` (transaction time, as `visit_revisions.amended_at`), not `clock_timestamp()`; the
  signature identity check also compares `signed_by` and `current_revision` (05-11e Deviation 2), so two signatures inside
  one transaction stay distinguishable. `reason_for_visit` is not locked (re-checker's optional suggestion) → V2-09a.
- Per-plan deviations: 05-01b (owner true only for known keys; service_role USAGE on `authz`; PO-3 SQL knock-ons;
  a cross-clinic share link found by guard leg 3b), 05-08 (`scheduled_at IS NOT NULL` in the predicate; 23P01 on every
  slot writer; deadlock retry), 05-11a (strict prescriber rule; signer FK without automatic remedy), 05-11c (v1 PATCH
  refuses `completed`; referral consent by compensation), 05-11d (child keys immutable on every path; SECURITY DEFINER
  amendment guard; harness fixes), 05-11e ("at or after" `current_revision`; follow-up status locked).

## Review outcome (CLAUDE.md DoD 6)
Three isolated reviews of the 05a diff at `8bda1c6` (`v2/phase-04-jobs-reliability...8bda1c6`), one re-verification
and two re-checks (reports in `reviews/`). Severity counts are copied from each report:

| Review | High | Medium | Low | Info |
|---|---|---|---|---|
| Independent (`v205a-review-independent.md`) | 0 | 5 | 8 | 6 |
| Adversarial A, authorisation/RLS (`v205a-review-adversarial-rls.md`) | 1 | 3 | 3 | 4 |
| Adversarial B, integrity (`v205a-review-adversarial-integrity.md`) | 1 | 3 | 8 | 5 |
| Re-verification at `505d10e` (`v205a-review-reverify.md`) | H-VISIT, H-INVITE CLOSED | 5 triaged CLOSED, 3 partial; new N-1, N-2, N-3, N-6 (latent) | new N-4, N-5, N-7, N-8 | N-9 |
| Re-check of 05-11d at `903df53` (`v205a-review-recheck-05-11d.md`) | 0 | N-1, N-3, N-6 CLOSED, N-2 partial; new NF-1, NF-2 | new NF-3 | 0 |
| Final re-check of 05-11e at `d7e0501` (`v205a-review-recheck-05-11e.md`) | 0 | NF-1, NF-2 CLOSED; 0 new | NF-3 CLOSED; new NF-4, NF-5 | I-1, I-2 |

Triage (`05a-REVIEW-TRIAGE.md`):
- **Highs (2): H-VISIT (05-11a) and H-INVITE (05-11b), both re-verified CLOSED.**
- **Mediums: all closed.** Triage rows M-ACTOR, M-SIGNED, M-DURATION, M-TOKEN, M-INVOICE, M-NOTICE, M-APIKEY,
  M-APINOTES (05-11a/b/c); the re-verification's follow-ons N-1, N-2, N-3, N-6 (05-11d); the 05-11d re-check's NF-1, NF-2
  (05-11e). The final re-check found NF-1 and NF-2 **CLOSED** and no new High or Medium.
- **Lows fixed:** INT L-1, L-3, L-4, L-5, L-6; RLS L-1, L-2, L-3; IND L1, L2, L4, L6, L7, L8 (05-11a/b/c); N-5, N-7, N-8
  (05-11d); NF-3 (05-11e); NF-4, NF-5 (000078, no extra review round under the PO delivery-speed ruling of 2026-11-14).
- **Accepted or assigned, with reason and owner:** INT L-2 (v1 PATCH not atomic) → P1-37; INT L-7 (storage tampering
  inside a clinic) → V2-09a/V2-09c; INT L-8 (legacy lab object names) → V2-15; IND L3 (000053 blocking CHECK) → ruling,
  expand/contract from here on; IND L5 (lookalike directory listing; the triage row calls it "RLS L-5", the RLS report has L-1…L-3 only) → V2-11; doctor memberships RESTRICT →
  05-05; N-4 → V2-09a with V2-08; N-9 → V2-09a / P1-37; I-1, I-2 → V2-09a; v1 clinical content on `/prescriptions`,
  `/referrals`, `/lab-orders`, `/patients` → P1-37 (v1 off in every tier, PO-16); shared read state of role/broadcast
  notices → V2-11.
- Every fix has a regression test that fails without it; the without-fix runs are in `evidence/05a/05-11{a..e}/` and
  `evidence/05a/close/`.

## Deferred, with owner
- Status and access levels in the matrix (removed members, `locked`/`onboarding`), subscriptions, invitations v2, AI
  gating → **05b** (acceptance 4, 8–13).
- Contract steps (clinical columns, `generate_daily_queue_token`, `link_url` VALIDATE) → **05-b0**.
- Record immutability (Rx header lock R-21, `reason_for_visit`, sign-off/amendment RPC, N-4, N-9, I-1, I-2) → **V2-09a**.
- UI that still offers what the database refuses (05-02a/b/c, 05-11a, 05-11e wave notes) → **V2-08**; referrals UI,
  directory verification, per-user notice read state → **V2-11**; v1 clinical content → **P1-37**.
- `/gsd-secure-phase` over T-05-01…T-05-23 → `v205a-secure-phase.md` was planned (gate step 4) and is **not yet run**
  (see `05a-VERIFICATION.md` § Not yet verifiable).

## Proposed CLAUDE.md change — PO approves (05-P1 lists the Commands proposal; not applied)
Proposed text for `## Commands`, after the Vitest line:
- pgTAP: `npm run test:pgtap` (with the stack up; runs every `supabase/tests/database/*.test.sql` on the local stack
  under the test-run lock; never alongside a Vitest or e2e run), then `node scripts/ci/assert-pgtap-report.mjs
  pgtap-report.tap` (the gate: no skip/todo, required files, floor). `npm run authz:gen` regenerates the authorisation
  matrix after a change to `tests/authz/table-matrix.ts`. `npm run db:diagnostics -- --label <x>` (counts only, local
  stack only).

## Numbers
- Vitest: 211 files / 4399 tests at the end of V2-04 → **248 files / 4876 tests**, two consecutive runs at `4c46ec1`, 0
  failed, 0 skipped; each teardown verified none of its run data remains (`evidence/05a/summary.json`,
  `full-run-{1,2}.json`). Report gate: floor 4633, 155 required spec files, PASS for both runs
  (`evidence/05a/close/vitest-report-gate.txt`).
- pgTAP: 2 legacy files / 13 tests before 05a → **31 files / 3343 tests**, both runs, 0 failed; gate floor 3343, 31
  required files, PASS for both runs (`pgtap-run-{1,2}.tap`, `close/pgtap-report-gate.txt`). The generated matrix alone
  is 2376 cells. Negative proofs (real lane runs): one required file removed → `total 3317 is below the floor 3343` +
  `required pgTAP file missing`; one test dropped → `total 3342 is below the floor 3343`
  (`close/pgtap-gate-negative-*.txt`).
- Per-criterion counts for every 05a acceptance item in both runs: `close/acceptance-results.txt` ("every named spec
  and pgTAP file passed in every run").
- Playwright PR lane (at `4d25b33`): 220 passed (including the 8 KNOWN-BUG expected failures), 9 skipped by design, 0
  failed, 0 flaky (retried); desktop-chrome 136, pixel-7 70, iphone-15 9, setup 5 (`close/playwright-summary.txt`).
- Static: typecheck, `eslint . --quiet` (333 files) and inventory exit 0; boundary messages 0, `boundary_directives` `[]`,
  one service-role factory, exception register 2 entries, `cron_route_files` 0 (`static-checks.json`).
- Drift: local drift PASS (0 statements); schema snapshot PASS (2197 lines). Diagnostics on the evidence stack:
  `blocking_nonzero` `[]`, D0 = 78 (`diagnostics/05a-close.json`). Policies: 118 in `public`/`storage`, 0 `FOR ALL`.
- Close-run failures, root-caused (never retried to green): attempt 1 at `961ba82` — the vitest-report-gate spec pinned
  the old floor (fixed `4d25b33`); attempt 2 at `4d25b33` — `backup-roundtrip-db.spec.ts` ENOBUFS (1 MiB listing buffer,
  fixed `4c46ec1`) and `migration_edge_cases_fk` #16 on cross-tenant rows another worktree's stopped runs left on the
  shared stack (stack reset; `close/evidence-attempt-{1,2}-*.txt`).
- Gitleaks over the 05a close commits: `close/gitleaks-commits.txt`.

## Pending PO (ids in `.planning/PO-ACTIONS.md` § "V2-05 Database authorisation & entitlements")
- **Before merge:** 05-P6 (approve the 05a gate). 05-P1 is delegated to the CTO.
- **After merge:** 05-P8 (diagnostics, delegated) then 05-P2 (approve the staging migrate). 05-P9 is a standing rule
  (Confirm email ON).
