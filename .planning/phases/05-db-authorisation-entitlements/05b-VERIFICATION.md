---
phase: 05
part: 05b
roadmap_id: V2-05 (part 05b)
status: awaiting PO gate approval (05-P6); CI run pending (orchestrator)
verified_commit: 8c1f201 (local evidence; evidence/05b/commit.txt = 8c1f20117d38824d1560b8c11bb43a2d3e8248dc)
ci_run: "https://github.com/thecliniqai/cliniqai-app/actions/runs/43673223865 (head 67912b72ac80c8b3eecc41bd8b9211ba3c98eea9, success)"
---

# Phase 05, part 05b (V2-05b) — verification

Every figure comes from a tool output:
- `scripts/phase-evidence.mjs .planning/phases/05-db-authorisation-entitlements/evidence/05b 2`: two full Vitest runs
  (JSON reporter) and two pgTAP lane runs (`npm run test:pgtap`, gated by `scripts/ci/assert-pgtap-report.mjs`), tsc,
  ESLint, the inventory and the ESLint-computed counters (`summary.json`, `full-run-{1,2}.json`, `pgtap-run-{1,2}.tap`,
  `static-checks.json`, `commit.txt`). It ran 03:13:34Z–03:29:33Z under the test-run lock (nested TMPDIR for its own
  lanes, so no other worktree's run could interleave).
- `scripts/ci/assert-vitest-report.mjs` and `scripts/ci/assert-pgtap-report.mjs` on both runs
  (`close/{vitest,pgtap}-report-gate.txt`).
- The per-criterion extraction `close/acceptance-results.txt` (a counts-only reader of both runs' reports; source kept as
  text in `close/acceptance-extract.mjs.txt`, because the repo lints `.planning/` as app code).
- Gate negative proofs: two real pgTAP lane runs (`close/pgtap-gate-negative-*.txt`) and Vitest variants derived from
  the real run-1 report (`close/vitest-gate-negatives.txt`, source `close/vitest-gate-negatives.mjs.txt`).
- `npm run e2e:build && npm run e2e:pr -- --retries=0` (`close/e2e/`).
- `npm run db:diagnostics -- --label 05b-close` (`diagnostics/05b-close.json`), `node scripts/ci/local-drift.mjs`,
  `node scripts/drift/schema-snapshot.mjs --local --check`, `npx tsx scripts/gen-authz-pgtap.ts --check`,
  `pg_policies` per table, gitleaks (`close/`).
- The gate-close fixes' without/with runs (`close/pgtap-{without-000093,with-000094}-*.tap`,
  `close/vitest-without-000093-db.txt`, `close/vitest-without-app-actions.txt`,
  `close/vitest-mutant-ai-commit-clock-only.txt`, `close/vitest-with-000094.txt`).
- `scripts/phase-evidence.mjs … --ci-run <id>` for the GitHub Actions run (**placeholder below; the orchestrator fills
  it**).

Nothing is hand-typed from a run. Local stack only. `supabase db reset --local` ran once for the gate close
(2026-11-15T03:10:13Z, to apply 000094, under the test-run lock), followed by `npm run seed:local` (no `--reset`) and a
passing `schema-snapshot --local --check` (wave notes).

Local results at `8c1f201` (`evidence/05b/summary.json`, `close/`):
- **Vitest:** 260 files / 5080 tests, passed in both runs, 0 failed, 0 skipped; each teardown removed its run data and
  verified none remain (235 tenants, 465 auth users, 1546 storage objects per run).
- **Vitest report gate:** PASS for both runs (floor 4826 = 5080 × 0.95, 173 required files;
  `close/vitest-report-gate.txt`).
- **pgTAP lane:** 47 files / 7892 tests, passed in both runs; **pgTAP gate PASS** for both runs (floor 7892, 47 required
  files = every file in `supabase/tests/database`; `close/pgtap-report-gate.txt`).
- **Gates fail when they should:** pgTAP, real lane runs: `gate_close_05b.test.sql` removed → `total 7880 is below the
  floor 7892` + `required pgTAP file missing` (exit 1); one test dropped → `total 7891 is below the floor 7892` (exit 1).
  Vitest, derived from the real report: a required file removed → `required spec file missing` (exit 1); one test
  `it.skip`ped → `test skipped (0 skipped allowed)` (exit 1); every test of a required file dropped → `has no passed
  test` (exit 1); suite one below the floor → `total 4825 is below the floor 4826` (exit 1). By design (IR-F5 95 % rule)
  one passing test removed from a required file that keeps others still passes the Vitest gate (shown, exit 0); the
  pgTAP gate's exact floor catches that case.
- **Static checks:** typecheck exit 0; `eslint . --quiet` exit 0 (348 files); inventory exit 0 (0 flagged);
  `boundary_directives` `[]`, `p1_34_boundary_messages` 0, `utc_today_messages` 0, one service-role factory
  (`lib/supabase/system.ts`), exception register 2 entries, `cron_route_files` 0 (`static-checks.json`).
- **Playwright PR lane:** at `8c1f201`, fresh `e2e:build` (exit 0, output scan clean), `e2e:pr -- --retries=0` exit 0: **262 passed** (including the 8 KNOWN-BUG expected failures), 9 skipped by design (pixel-7), 0 failed, **0 flaky, 0 retried**; by project desktop-chrome 153, pixel-7 85, iphone-15 16, setup 8; teardown removed its run data and verified none remain (`close/e2e/playwright-summary.md`, `close/e2e/e2e-pr-tail.txt`, `close/e2e/playwright-results.json`, `close/e2e/sha.txt`).
- **Drift:** local drift PASS (0 statements); schema snapshot PASS (2650 lines); authz generator `--check` exit 0
  (`close/local-drift.txt`, `close/schema-snapshot-check.txt`, `close/authz-gen-check.txt`).
- **Diagnostics** (`diagnostics/05b-close.json`, counts only): `blocking_nonzero` `[]`; D0 = 94 migrations; D11n, D12z,
  D12c (both queues), D5s, D7i, D1p, D1f, D11r, D6d, D9t all 0 on the evidence stack.
- **Policies:** 122 policies in `public`/`storage`, 0 `FOR ALL` (`close/pg-policies-per-table.txt`).
- **Gitleaks** over the gate-close commits: see `close/gitleaks-commits.txt`.

## Acceptance (roadmap §12.2 V2-05, 05b rows; mapping in `05-PLAN.md` "Acceptance mapping (roadmap V2-05, binding)")
Per-criterion counts are read from both evidence runs by `close/acceptance-results.txt` (identical in run 1 and run 2).

| # | Criterion | Evidence (tool output) | Result |
|---|---|---|---|
| 1 | the pgTAP matrix covers 100% of tenant tables and passes — **05b part: status and access levels** | `authz_matrix` 6240/6240 (roles × `active`/`removed`/`suspended` × `full`/`locked`/`onboarding`, incl. the dual member acting in a locked clinic), `authz_completeness` 6/6 (catalogue `set_eq`: every tenant table and bucket has a row), `authz_helpers` 77/77, `definer_functions` 71/71 (access classification legs), `access_lock_rls` 26/26, `remove_member` 81/81, `grants` 15/15; `table-matrix.spec.ts` 32/32, `generator-drift.spec.ts` 5/5; pgTAP gate PASS both runs | **Met** (05a: roles × `full`; 05b: status × access levels) |
| 4 | a removed member reads 0 rows with a still-valid JWT | `remove-member.spec.ts` 15/15 ("the still-valid JWT now reads 0 rows from every tenant table of the matrix"; sessions deleted in-RPC, API key 401), `membership-guard.spec.ts` 26/26; `remove_member` 81/81, matrix `removed` principal in `authz_matrix` 6240/6240 | **Met locally**; hosted session delete pending PO confirmation (05-P4; fallback: the 900 s token lifetime, RLS stops access at once) |
| 8 | with `p_now` past `access_ends_at`, a locked tenant gets 0 rows from every clinical table and storage bucket | `billing_access` 45/45 (time travel: "trialing exactly at `access_ends_at` → locked", "past_due → locked at grace_until"), `access_lock_rls` 26/26 (every role, locked and onboarding: only `memberships`/`tenants` (+ subscription rows for owner/admin), no storage object, every storage class refuses an upload), `authz_matrix` locked/onboarding cells, `definer_functions` 71/71; `lock-enforcement.spec.ts` 13/13, `locked-redirects.spec.ts` 48/48 | **Met** |
| 9 | `authenticated` cannot execute any `billing_internal.*` function | `billing_grants` 24/24 ("authenticated cannot execute any billing_internal function (acceptance 9)", catalogue loop) | **Met** |
| 10 | one invite sends exactly one email under retry | `invite-delivery.spec.ts` 5/5 (5 parallel runner passes → exactly one message in Mailpit; a transport failure → retried, still exactly one; resend → exactly one more), `email-invite-handler.spec.ts` 5/5, `accept-invite.spec.ts` 9/9, `turnstile-verify.spec.ts` 12/12, `invite.spec.ts` 8/8, `invite-token-lockout.spec.ts` 4/4, `reinvite-role.spec.ts` 2/2, `invite-dedupe-role.spec.ts` 2/2; `invitations_v2` 75/75, `invitation_accept_context` 17/17, `invitation_binding` 14/14 | **Met locally** (Mailpit); optional staging check 05-P5 |
| 11 | after 05-10 every existing DB suite stays green, with all test tenants seeded `trialing` or comped | the whole suites at the gate SHA, twice: Vitest 5080/5080, pgTAP 7892/7892, e2e PR lane (above); `subscription_invariant` 14/14, `drop_v1_subscriptions` 4/4; `helpers/subscription.spec.ts` 10/10, `integration/subscription.spec.ts` 5/5, `demo-clinic-seed.spec.ts` 5/5, `cross-tenant.spec.ts` 21/21; `seed:local` after the reset printed `access summary: full=1 locked=0 onboarding=0` | **Met locally**; staging re-seed with comp pending PO (05-P3) |
| 12 | the seeded Standard price derives a 176882-paise charge from base 149900 and 1800 bp | `billing_catalogue` 30/30 ("Standard: base 149900 paise, 1800 bp, GST-exclusive → charge 176882 paise (acceptance 12)") | **Met** |
| 13 | no product purchasable except Standard; `set_product_availability` refuses `purchasable = true` without an active provider price; `trialing` has `ai.scribe` 1,500, `active` Standard none | `billing_catalogue` 30/30 ("no product is purchasable except Standard (acceptance 13)"), `platform_rpcs` 80/80 ("set_product_availability(ai_assist, true, public) … refused: no active price with a provider plan id (acceptance 13)"), `billing_entitlements` 30/30 ("trialing: ai.scribe.monthly_drafts limit 1,500", "active Standard: ai.scribe off (PO-25 default)", "0 drafts"), `ai_gating_l2` 115/115 | **Met** |
| note | `create_clinic_with_owner` creates `incomplete` tenants; seeds set a subscription row | `subscription_invariant` 14/14; `helpers/subscription.spec.ts` 10/10 | **Met locally**; staging re-seed (05-P3) |

Rows 2, 3, 5, 6, 7 were met at 05a (`05a-VERIFICATION.md`); 05-b0's contract step for row 2 is proven by
`contract_05a` 18/18, `clinical_notes` 53/53 and `role-rls.spec.ts` 15/15 in both runs.

## Roadmap tests and evidence (05b share)
| Item | Evidence | Result |
|---|---|---|
| Generated pgTAP matrix, roles × access levels | `authz_matrix` 6240/6240 (05a roles × `full` + 05b status × access levels) | Met |
| `has_permission` parity unit test | `has-permission-parity.spec.ts` 8/8, `authz_helpers` 77/77 | Met (05a; re-run green) |
| Time-travel pgTAP for trial, grace, expiry and archive | `billing_access` 45/45 | Met |
| Concurrency tests for `ai_reserve` | `ai-reserve-concurrency.spec.ts` 4/4 (8 rounds at limit − 1: one id, one `AI_OVER_QUOTA`), `ai-commit-expiry-race.spec.ts` 2/2 (N-1), `ai_quota` 41/41, `gate_close_05b` 12/12 | Met |
| Invite pgTAP cases | `invitations_v2` 75/75, `invitation_accept_context` 17/17 | Met |
| Migration tests on a copy seeded with the diagnostics' edge cases | 05a files re-run green (`migration_edge_cases_*`); 05b's contract steps stop on D11n (000079) and D12z (000093), both 0 locally; 05-09c flip dry run (`evidence/05b/05-09c-flip-dry-run/`) | Met locally |
| Evidence: CI pgTAP report | CI step + `pgtap-report` artifact + gate exist (05-01a); the run on this commit is the placeholder below | **Pending CI (orchestrator)** |
| Evidence: diagnostics report | `diagnostics/05b-close.json`; `05-12/diagnostics/05-12-after-000093.json` (D12z, D12c) | Met locally; staging diagnostics before the migrate (05-P10) |
| Evidence: `/gsd-secure-phase` output | not produced — CTO ruling below | **Not run (CTO ruling; PO may ask at 05-P6)** |
| Evidence: independent reviewer sign-off | `reviews/v205b-review-independent.md` + two adversarial reviews + `v205b-review-reverify.md` (0 new High / 0 new Medium) | Met |
| `explain-rls.txt`, 05-09c dry-run reports, `AUTHZ-MATRIX.md` at the gate SHA | `evidence/05b/explain-rls.txt`, `evidence/05b/05-09c-flip-dry-run/`; `AUTHZ-MATRIX.md` regenerated by `authz:gen` (`--check` exit 0 at `8c1f201`) | Met |

## Reviews (CLAUDE.md DoD 6) — reports in `reviews/`
| Range | Reviewer | Severity (H/M/L/I) | Outcome |
|---|---|---|---|
| `d670b62...5e9d1df` | Independent | 0/2/7/7 | M-1 (M-CANCEL), M-2 (M-REINVITE) fixed in 05-12; L-2…L-7 fixed; L-1 → V2-12; I-5, I-6, I-7 fixed; I-1 runbook; I-2 accepted; I-3, I-4 → V2-13c/V2-14 |
| same | Adversarial, access/membership/invitations/platform | 0/1/4/6 | M-1 (= H-AITZ) fixed; L-1…L-4 fixed in 05-12; Info → V2-13c/V2-14 |
| same | Adversarial, AI/quota/subscriptions/billing | 1/1/3/7 | H-1 (H-AITZ), M-1 (M-AIEXP) fixed; L-1 (with M-CANCEL), L-3 fixed; L-2 → V2-13b; I-2 → V2-12, I-3 → V2-13b, I-5 accepted, others → V2-13c/V2-14 |
| `3b869a9` | Re-verification (adversarial) | H-AITZ and 3 Mediums CLOSED; 0 new H/M; new N-1, N-2 (L); N-3, N-4, A13 (I) | N-1, N-2 fixed in 000094 (no extra round, PO speed ruling); N-3 accepted (V2-11), N-4 → V2-13 retention/purge, A13 accepted (V2-13b) |

**All Highs and Mediums are closed** (H-AITZ, M-AIEXP, M-CANCEL, M-REINVITE re-verified CLOSED in
`v205b-review-reverify.md`). Every fix has a regression test that fails without it: 05-12 in `evidence/05b/05-12/`
(`review_fixes_05b` 35 of 42 fail at 000091; app mutants); the gate close in `evidence/05b/close/`:
- `gate_close_05b.test.sql` at 000093: tests 1–3 (N-1: `have: 1500`), 6–8 (N-2: `no-role`), 9–10 (owner clear refused)
  fail, 8 of 12; the guards 4, 5, 11, 12 pass before and after; 12/12 at 000094.
- `review_fixes_05b` 40 fails at 000093 (the owner was refused); 42/42 at 000094 after 27 and `invitations_v2` 13 follow
  the answer's new `role` key.
- Vitest at 000093 (app fixed, DB not): the N-1 race test and both N-2 tests fail (3 of 4; the N-1 control passes).
  App half: `features/staff/actions.ts` reverted to `3b869a9` at 000094 → both N-2 tests fail. Clock-only `ai_commit`
  (no usage-row lock first) installed as a mutant → the N-1 race test still fails (`AI_RESERVATION_EXPIRED` expected,
  commit landed); restored, `schema-snapshot --check` PASS.

No test was retried to green. Both Vitest runs, both pgTAP lanes and the Playwright lane ran with `retries: 0`.

## CTO rulings recorded at this gate
- **R-38 (SUB §8.1 actor block)** and **R-44 (ADR-0005 amendment A4)** applied with dated erratum notes
  (`docs/v2/SUBSCRIPTIONS_AND_PLANS.md` §8.1, `docs/adr/0005-confine-service-role-client.md` "Amendment A4") and recorded
  in `docs/v2/VERIFICATION_LOG.md` ("V2-05b CTO rulings applied to approved docs").
- **Objection clear (2026-11-15):** an owner who holds the doctor permissions may clear a patient's AI objection,
  audited; admins and nurses may not (000094; `gate_close_05b` 9–12).
- R-46 (server Turnstile), owner-of-a-locked-clinic removal (IND L-5) and copy without phase ids: 05-12, see
  `05b-SUMMARY.md`.

## Not yet verifiable or not met (owner)
- **CI run:** placeholder below (orchestrator).
- **`/gsd-secure-phase` over the 05b threat rows (T-05-24…T-05-38, T-05-42, T-05-43; `reviews/v205b-secure-phase.md`) —
  not run.** CTO ruling (2026-11-15), as at 05a: the review set (independent + two adversarial reviews + the
  adversarial re-verification; `reviews/v205b-*.md`) covers that register and stands in its place under the PO's speed
  ruling. The PO may still ask for it at 05-P6.
- **Hosted:** 05-P10 diagnostics (D12z/D12c and the 05a set) → 05-P3 staging migrate + re-seed → 05-P7 Turnstile
  secret → optional 05-P5; 05-P4 hosted session delete; 05-P9 Confirm email stays on.
- **Merge order (R-1, R-37):** 05a merges first (merge commit) and its staging migrate is verified (05-P2), then this PR
  is retargeted to `feature/v2`.

## CI run
Source: `evidence/05b/ci-run.json` and `evidence/05b/ci-pgtap-report.tap` (written by `scripts/phase-evidence.mjs --ci-run 43673223865`).

- Run: https://github.com/thecliniqai/cliniqai-app/actions/runs/43673223865 (pull_request, branch `v2/phase-05b-membership-entitlements`)
- Head SHA: `67912b72ac80c8b3eecc41bd8b9211ba3c98eea9`; conclusion: **success**
- pgTAP gate (CI): `{"artifact": "ci-pgtap-report.tap", "gate": "PASS", "files": 47, "total": 7892, "passed": 7892, "failed": 0, "skipped": 0, "per_file": [{"name": "supabase/tests/database/access_lock_rls.test.sql", "planned": 26, "ran": 26, "passed": 26}, {"name": "supabase/tests/database/actor_bindings_audit.test.sql", "planned": 34, "ran": 34, "passed": 34}, {"name": "supabase/tests/database/admin_policies.test.sql", "planned": 32, "ran": 32, "passed": 32}, {"name": "supabase/tests/database/ai_gating_l2.test.sql", "planned": 115, "ran": 115, "passed": 115}, {"name": "supabase/tests/database/ai_quota.test.sql", "planned": 41, "ran": 41, "passed": 41}, {"name": "supabase/tests/database/amendment_snapshot.test.sql", "planned": 60, "ran": 60, "passed": 60}, {"name": "supabase/tests/database/api_keys_notices_columns.test.sql", "planned": 26, "ran": 26, "passed": 26}, {"name": "supabase/tests/database/audit_v2.test.sql", "planned": 24, "ran": 24, "passed": 24}, {"name": "supabase/tests/database/authz_completeness.test.sql", "planned": 6, "ran": 6, "passed": 6}, {"name": "supabase/tests/database/authz_helpers.test.sql", "planned": 77, "ran": 77, "passed": 77}, {"name": "supabase/tests/database/authz_matrix.test.sql", "planned": 6240, "ran": 6240, "passed": 6240}, {"name": "supabase/tests/database/billing_access.test.sql", "planned": 45, "ran": 45, "passed": 45}, {"name": "supabase/tests/database/billing_catalogue.test.sql", "planned": 30, "ran": 30, "passed": 30}, {"name": "supabase/tests/database/billing_entitlements.test.sql", "planned": 30, "ran": 30, "passed": 30}, {"name": "supabase/tests/database/billing_grants.test.sql", "planned": 24, "ran": 24, "passed": 24}, {"name": "supabase/tests/database/billing_rpc_only.test.sql", "planned": 25, "ran": 25, "passed": 25}, {"name": "supabase/tests/database/clinical_notes.test.sql", "planned": 53, "ran": 53, "passed": 53}, {"name": "supabase/tests/database/clinical_notes_backfill.test.sql", "planned": 9, "ran": 9, "passed": 9}, {"name": "supabase/tests/database/composite_fks.test.sql", "planned": 105, "ran": 105, "passed": 105}, {"name": "supabase/tests/database/contract_05a.test.sql", "planned": 18, "ran": 18, "passed": 18}, {"name": "supabase/tests/database/definer_functions.test.sql", "planned": 71, "ran": 71, "passed": 71}, {"name": "supabase/tests/database/delete_rules.test.sql", "planned": 35, "ran": 35, "passed": 35}, {"name": "supabase/tests/database/domain_policies.test.sql", "planned": 42, "ran": 42, "passed": 42}, {"name": "supabase/tests/database/drop_v1_subscriptions.test.sql", "planned": 4, "ran": 4, "passed": 4}, {"name": "supabase/tests/database/fk_indexes.test.sql", "planned": 4, "ran": 4, "passed": 4}, {"name": "supabase/tests/database/gate_close_05b.test.sql", "planned": 12, "ran": 12, "passed": 12}, {"name": "supabase/tests/database/grants.test.sql", "planned": 15, "ran": 15, "passed": 15}, {"name": "supabase/tests/database/invitation_accept_context.test.sql", "planned": 17, "ran": 17, "passed": 17}, {"name": "supabase/tests/database/invitation_binding.test.sql", "planned": 14, "ran": 14, "passed": 14}, {"name": "supabase/tests/database/invitations_v2.test.sql", "planned": 75, "ran": 75, "passed": 75}, {"name": "supabase/tests/database/memberships_bounds_cleanup.test.sql", "planned": 7, "ran": 7, "passed": 7}, {"name": "supabase/tests/database/migration_edge_cases_fk.test.sql", "planned": 21, "ran": 21, "passed": 21}, {"name": "supabase/tests/database/migration_edge_cases_overlap.test.sql", "planned": 9, "ran": 9, "passed": 9}, {"name": "supabase/tests/database/migration_edge_cases_visit_integrity.test.sql", "planned": 17, "ran": 17, "passed": 17}, {"name": "supabase/tests/database/platform_rpcs.test.sql", "planned": 80, "ran": 80, "passed": 80}, {"name": "supabase/tests/database/queue_tokens.test.sql", "planned": 34, "ran": 34, "passed": 34}, {"name": "supabase/tests/database/referrals_rules.test.sql", "planned": 48, "ran": 48, "passed": 48}, {"name": "supabase/tests/database/remove_member.test.sql", "planned": 81, "ran": 81, "passed": 81}, {"name": "supabase/tests/database/reverify_integrity.test.sql", "planned": 61, "ran": 61, "passed": 61}, {"name": "supabase/tests/database/review_fixes_05b.test.sql", "planned": 42, "ran": 42, "passed": 42}, {"name": "supabase/tests/database/scheduling_exclusion.test.sql", "planned": 26, "ran": 26, "passed": 26}, {"name": "supabase/tests/database/search_medicines_extension_schema.test.sql", "planned": 6, "ran": 6, "passed": 6}, {"name": "supabase/tests/database/signed_visit_fields.test.sql", "planned": 26, "ran": 26, "passed": 26}, {"name": "supabase/tests/database/storage_policies.test.sql", "planned": 46, "ran": 46, "passed": 46}, {"name": "supabase/tests/database/subscription_invariant.test.sql", "planned": 14, "ran": 14, "passed": 14}, {"name": "supabase/tests/database/tenant_local_dates.test.sql", "planned": 20, "ran": 20, "passed": 20}, {"name": "supabase/tests/database/visit_integrity.test.sql", "planned": 45, "ran": 45, "passed": 45}], "problems": []}`
- Retried tests: 0 (CI e2e job "Run summary": "Retried to pass (flaky): 0"; 262 passed)

| Job | Conclusion |
|---|---|
| e2e | success |
| build | success |
| test | success |
| security | success |
| static | success |
