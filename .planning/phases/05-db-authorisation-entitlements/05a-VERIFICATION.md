---
phase: 05
part: 05a
roadmap_id: V2-05 (part 05a)
status: awaiting PO gate approval (05-P6)
verified_commit: 4c46ec1 (local evidence; evidence/05a/commit.txt)
ci_run: "@@CI-PLACEHOLDER: the orchestrator fills this after pushing — `node scripts/phase-evidence.mjs .planning/phases/05-db-authorisation-entitlements/evidence/05a --ci-run <id>` writes evidence/05a/ci-run.json and ci-pgtap-report.tap"
---

# Phase 05, part 05a (V2-05a) — verification

Every figure comes from a tool output:
- `scripts/phase-evidence.mjs .planning/phases/05-db-authorisation-entitlements/evidence/05a 2`: two full Vitest runs
  (JSON reporter) and two pgTAP lane runs (`npm run test:pgtap`, gated by `scripts/ci/assert-pgtap-report.mjs`), tsc,
  ESLint, the inventory and the ESLint-computed counters (`summary.json`, `full-run-{1,2}.json`, `pgtap-run-{1,2}.tap`,
  `static-checks.json`, `commit.txt`).
- `scripts/ci/assert-vitest-report.mjs` and `scripts/ci/assert-pgtap-report.mjs` on both runs (`close/*-report-gate.txt`).
- The per-criterion extraction `close/acceptance-results.txt` (a counts-only reader of the two runs' reports; its source
  is `close/acceptance-extract.mjs.txt`, kept as text because the repo lints `.planning/` as app code).
- `npm run e2e:build && npm run e2e:pr` (`close/e2e-build.txt`, `close/e2e-pr.txt`, `playwright-results.json`,
  `close/playwright-summary.txt`).
- `npm run db:diagnostics -- --label 05a-close` (`diagnostics/05a-close.json`), `node scripts/ci/local-drift.mjs`,
  `node scripts/drift/schema-snapshot.mjs --local --check`, `npm run authz:gen` drift (`tests/authz/generator-drift.spec.ts`
  in both runs), `pg_policies` per table (`close/pg-policies-per-table.txt`), gitleaks (docker).
- `scripts/phase-evidence.mjs … --ci-run <id>` for the GitHub Actions run (**placeholder below; the orchestrator fills
  it**).

Nothing is hand-typed from a run. Local stack only; `supabase db reset --local` ran at 2026-11-14T08:30Z (000078) and
again at 09:47:46Z right before the final evidence (leftover data of another worktree's stopped runs; wave notes), each
followed by `npm run seed:local` (no `--reset`) and a passing `schema-snapshot --local --check`.

Local results at `4c46ec1` (`evidence/05a/summary.json`, `close/`):
- **Vitest:** 248 files / 4876 tests, passed in both runs, 0 failed, 0 skipped; each teardown removed its run data and
  verified none remain (`summary.json`, `full-run-{1,2}.json`).
- **Vitest report gate:** PASS for both runs (floor 4633, 155 required files; `close/vitest-report-gate.txt`).
- **pgTAP lane:** 31 files / 3343 tests, passed in both runs; **pgTAP gate PASS** for both runs (floor 3343, 31 required
  files; `pgtap-run-{1,2}.tap`, `close/pgtap-report-gate.txt`). The gate fails on a removed required file (total 3317,
  `close/pgtap-gate-negative-file-removed.txt`) and on one dropped test (total 3342,
  `close/pgtap-gate-negative-test-dropped.txt`), both from real lane runs.
- **Static checks:** typecheck exit 0; `eslint . --quiet` exit 0 (333 files linted); inventory exit 0; `boundary_directives`
  `[]`, `p1_34_boundary_messages` 0, `utc_today_messages` 0, one service-role factory (`lib/supabase/system.ts`), exception
  register 2 entries, `cron_route_files` 0 (`static-checks.json`).
- **Playwright PR lane** (at `4d25b33`; the only later code commit, `4c46ec1`, changes one Vitest spec): 220 passed
  (including the 8 KNOWN-BUG expected failures), 9 skipped by design (pixel-7), 0 failed, 0 flaky, 0 retried; by
  project: desktop-chrome 136, pixel-7 70, iphone-15 9, setup 5 (`close/playwright-summary.txt`, `close/e2e-pr.txt`,
  `playwright-results.json`). The 5 web-server `ECONNRESET: aborted` lines are the benign WebKit client aborts
  root-caused in 04-03b.
- **Drift:** local drift PASS (0 statements); schema snapshot PASS (2197 lines) (`close/local-drift.txt`,
  `close/schema-snapshot-check.txt`).
- **Diagnostics** (`diagnostics/05a-close.json`, counts only): `blocking_nonzero` `[]`; D0 = 78 migrations; D5s, D7i,
  D1p, D11n, D11r, D1f, D6d, D9t all 0 on the evidence stack.
- **Policies:** 118 policies in `public`/`storage`, 0 `FOR ALL` (`close/pg-policies-per-table.txt`).
- **000078 regression:** `signed_visit_fields.test.sql` 13 of 26 fail at 000077 and 26/26 pass at 000078
  (`close/pgtap-signed_visit_fields-{without,with}-000078.tap`).
- **Gitleaks** over the 05a close commits: no leaks (`close/gitleaks-commits.txt`).

## Acceptance (roadmap §12.2 V2-05, 05a rows; mapping in `05-PLAN.md` "Acceptance mapping (roadmap V2-05, binding)")
Per-criterion counts are read from both evidence runs by `close/acceptance-results.txt`.

| # | Criterion | Evidence (tool output) | Result |
|---|---|---|---|
| 1 | the pgTAP matrix covers 100% of tenant tables and passes — **05a part: roles × `full`** | `authz_completeness` 6/6 (catalogue `set_eq`: every tenant table and bucket has a matrix row, RLS on, no legacy helper in a policy), `authz_matrix` 2376/2376, `authz_helpers` 77/77, `delete_rules` 35/35, `domain_policies` 42/42, `admin_policies` 32/32, `storage_policies` 46/46, `grants` 15/15, `definer_functions` 40/40 in both runs; `table-matrix.spec.ts` 21/21, `generator-drift.spec.ts` 4/4; pgTAP gate PASS both runs | **Met for roles** (status and access levels in 05b, by plan) |
| 2 | a receptionist PostgREST read of `clinical_notes` is denied (PO-3) | `clinical_notes` 53/53, `clinical_notes_backfill` 9/9; `tests/security/role-rls.spec.ts` 15/15 (real JWT) in both runs | **Met** (contract drop of the old columns in 05-b0) |
| 3 | a cross-tenant child insert fails | `composite_fks` 105/105, `migration_edge_cases_fk` 21/21; `tests/security/cross-tenant-refs.spec.ts` 12/12 in both runs | **Met** |
| 5 | a receptionist can register a patient | `tests/patients/receptionist-registration.spec.ts` 7/7; matrix cell in `authz_matrix` (2376/2376) in both runs | **Met** |
| 6 | two overlapping non-overbooked appointments cannot both be inserted | `scheduling_exclusion` 26/26, `migration_edge_cases_overlap` 9/9; `no-double-booking.spec.ts` 4/4, `create-visit-slot-race.spec.ts` 4/4, `v1-slot-conflict.spec.ts` 4/4 in both runs | **Met** |
| 7 | 50 parallel check-ins produce 50 distinct tokens with the IST date | `tests/integration/queue-token-concurrency.spec.ts` 2/2; `queue_tokens` 34/34, `tenant_local_dates` 20/20 in both runs | **Met** |

Rows 4 and 8–13 and the "note" row are 05b by the plan's split (`05-PLAN.md` § Acceptance mapping) and are not claimed
here.

## Roadmap tests and evidence (05a share)
| Item | Evidence | Result |
|---|---|---|
| Generated pgTAP matrix, roles × access levels | 05a share: roles × `full` (row 1); access levels in 05b | Met for 05a |
| `has_permission` parity unit test | `tests/permissions/has-permission-parity.spec.ts` 8/8, `authz_helpers` 77/77, both runs | Met |
| Concurrency tests for check-in and booking | rows 6 and 7 | Met (`ai_reserve` is 05b) |
| Migration tests on a copy seeded with the diagnostics' edge cases | `migration_edge_cases_fk` 21/21, `_overlap` 9/9, `_visit_integrity` 17/17; `diagnostics-script.spec.ts` 15/15, `fk-edge-cases-inline.spec.ts` 1/1, `visit-integrity-inline.spec.ts` 11/11, both runs | Met |
| P1-08 RESTRICT + DELETE policies | `delete_rules` 35/35, `composite_fks` 105/105, `delete-paths.spec.ts` 8/8 | Met |
| P1-10 / P1-11 referrals + exports | `referrals_rules` 48/48, `export-dto.spec.ts` 7/7, `export-scope.spec.ts` 6/6, `referral-consent-write.spec.ts` 3/3 | Met |
| P1-04 trigger part, audit v2 | `audit_v2` 24/24, `actor_bindings_audit` 34/34, `audit-actor.spec.ts` 5/5, `log-audit-allowlist.spec.ts` 7/7 | Met (in-transaction part V2-07) |
| V2-03 handovers (active tenant + multi-membership leg, `record_payment`, lab keys, statement timeouts) | `definer_functions` 40/40, `grants` 15/15, `storage_policies` 46/46, `billing_rpc_only` 25/25; `active-tenant-carrier.spec.ts` 7/7, `record-payment-rpc.spec.ts` 36/36, `collect-permission.spec.ts` 12/12, `lab-storage-key.spec.ts` 4/4, `storage-policies-jwt.spec.ts` 8/8 | Met |
| P2-08 FK indexes, V2-03 R-33 | `fk_indexes` 4/4, `tenant_local_dates` 20/20 | Met |
| Evidence: CI pgTAP report | CI step + `pgtap-report` artifact + gate exist (05-01a); the run on this commit is the placeholder below | **Pending CI (orchestrator)** |
| Evidence: diagnostics report | `evidence/05a/diagnostics/*.json` (before/after each integrity migration, `05a-close.json`), `05-03/replay-on-seeded-data.txt` | Met locally; staging diagnostics before the migrate (05-P8) |
| Evidence: `/gsd-secure-phase` output | not produced | **Not met — see below (owner: orchestrator / PO)** |
| Evidence: independent reviewer sign-off | `reviews/v205a-review-independent.md` plus the re-verification and two re-checks; the final re-check at `d7e0501` leaves 0 High / 0 Medium | Met |

## Reviews (CLAUDE.md DoD 6) — reports in `reviews/`
| Range | Reviewer | Severity (H/M/L/I) | Outcome |
|---|---|---|---|
| `v2/phase-04-jobs-reliability...8bda1c6` | Independent | 0/5/8/6 | M1–M5 fixed (05-11a/b/c); L1, L2, L4, L6, L7, L8 fixed; L3 ruled; L5 → V2-11 |
| same | Adversarial A, authorisation/RLS | 1/3/3/4 | H-1 (H-INVITE) and M-1…M-3 fixed (05-11a/b); L-1…L-3 fixed |
| same | Adversarial B, integrity | 1/3/8/5 | H-1 (H-VISIT) and M-1…M-3 fixed (05-11a); L-1, L-3…L-6 fixed; L-2 → P1-37, L-7 → V2-09a/V2-09c, L-8 → V2-15 |
| `505d10e` | Re-verification (adversarial) | Highs CLOSED; new N-1, N-2, N-3, N-6 (M), N-4, N-5, N-7, N-8 (L), N-9 (I) | N-1…N-3, N-5…N-8 fixed in 05-11d; N-4 → V2-09a/V2-08; N-9 → V2-09a/P1-37 |
| `903df53` | Re-check of 05-11d | N-1, N-3, N-6 CLOSED, N-2 partial; new NF-1, NF-2 (M), NF-3 (L) | All fixed in 05-11e |
| `d7e0501` | Final re-check of 05-11e | NF-1…NF-3 CLOSED; new 0 H / 0 M; NF-4, NF-5 (L); I-1, I-2 | NF-4, NF-5 fixed in 000078 (no extra round, PO speed ruling); I-1, I-2 → V2-09a |

Accepted items (reason and owner) are in `05a-REVIEW-TRIAGE.md`. Every fix has a regression test that fails without
it; the without-fix runs are in `evidence/05a/05-11{a..e}/` and `evidence/05a/close/pgtap-signed_visit_fields-without-000078.tap`
(13 of 26 fail at 000077). **All Highs and Mediums are closed.**

No test was retried to green. Both Vitest runs and the Playwright lane ran with `retries: 0` and show 0 flaky results.
Two earlier close attempts failed and were root-caused, not retried (`close/evidence-attempt-1-failure.txt`: a spec that
pins the Vitest floor, fixed in `4d25b33`; `close/evidence-attempt-2-failures.txt`: a 1 MiB buffer in
`backup-roundtrip-db.spec.ts`, fixed in `4c46ec1`, and leftover data from another worktree's aborted runs on the shared
stack, removed by `db reset --local` before the final run).

## Not yet verifiable or not met (owner)
- **CI run on the verified commit — placeholder.** The orchestrator pushes and runs
  `node scripts/phase-evidence.mjs .planning/phases/05-db-authorisation-entitlements/evidence/05a --ci-run <id>`, which
  writes `evidence/05a/ci-run.json` (five jobs, run URL, head SHA) and `ci-pgtap-report.tap` with its gate result; then
  fills `ci_run` in the front matter. Roadmap evidence "CI pgTAP report" closes with it.
- **`/gsd-secure-phase` over T-05-01…T-05-23 (`reviews/v205a-secure-phase.md`) — not run.** Gate step 4 plans it after
  the adversarial reviews; the three reviews, the re-verification and two re-checks cover the same threat register by
  hand but are not that tool's output. Owner: orchestrator, before the PO approves the gate (05-P6), or the PO accepts
  the review set in its place.
- **Hosted:** the staging migrate of 05a (05-P8 diagnostics, then 05-P2) after merge; "Confirm email" stays on (05-P9).
- **Merge order (R-1):** V2-04 merges first (merge commit), then this PR is retargeted to `feature/v2`.

## CI run
@@CI-PLACEHOLDER: `evidence/05a/ci-run.json` and `evidence/05a/ci-pgtap-report.tap` do not exist yet. The orchestrator
runs `node scripts/phase-evidence.mjs .planning/phases/05-db-authorisation-entitlements/evidence/05a --ci-run <id>` after
pushing and replaces this section with the run URL, head SHA, the five job conclusions, retried tests (must be 0) and the
pgTAP gate line from `ci-run.json`.@@
