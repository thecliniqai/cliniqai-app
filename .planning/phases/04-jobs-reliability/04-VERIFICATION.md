---
phase: 04
roadmap_id: V2-04
status: awaiting PO gate approval (G3-partial)
verified_commit: 2260c64 (local evidence; evidence/commit.txt)
ci_run: <filled by orchestrator>
---

# Phase 04 (V2-04) — verification

Every figure comes from a tool output:
- `scripts/phase-evidence.mjs`: two full Vitest runs (JSON reporter), tsc, ESLint, the inventory and the ESLint-computed
  counters (`summary.json`, `full-run-{1,2}.json`, `static-checks.json`).
- `scripts/ci/assert-vitest-report.mjs`: the report gate on both runs.
- `scripts/ci/playwright-summary.mjs`: the Playwright PR lane summary (`playwright-results.json`).
- `scripts/ci/local-drift.mjs`, `scripts/drift/schema-snapshot.mjs --local --check`.
- `ops/restore-drill/run.sh --self-test` (`restore-drill-selftest.json`), `scripts/ops/scheduler-local-e2e.ts`
  (`scheduler-local-e2e.json`, macOS, 04-02).
- `scripts/ci/package-legitimacy.mjs` (`package-legitimacy.json`), `pins.json` (04-05a), gitleaks (docker).
- `scripts/phase-evidence.mjs --ci-run <id>` for the GitHub Actions run (the orchestrator fills `ci_run`).

Nothing is hand-typed from a run. Local stack only; `supabase db reset --local` ran before the evidence.

| File | Content |
|---|---|
| `evidence/commit.txt`, `summary.json`, `full-run-{1,2}.json`, `static-checks.json` | Two consecutive full Vitest runs and the static checks at the verified commit |
| `evidence/close/` | Phase-close tool outputs: `typecheck.txt`, `eslint.txt`, `inventory.txt`, `ai-l1.txt`, `audit.txt`, `workflow-policy.txt`, `vitest-report-gate.txt`, `local-drift.txt`, `schema-snapshot-check.txt`, `e2e-build.txt`, `e2e-pr.txt`, `playwright-summary.txt`, `restore-drill-selftest-run.txt`, `package-legitimacy.txt`, `gitleaks.txt` |
| `evidence/playwright-results.json` | Playwright PR lane JSON report (desktop-chrome, Pixel 7, iPhone 15) |
| `evidence/restore-drill-selftest.json` | Restore drill self-test at close (counts, verdicts, RPO and RTO only) |
| `evidence/scheduler-local-e2e.json` | The real pg_cron → pg_net → app path on macOS (04-02; CI cannot run it, R-21) |
| `evidence/package-legitimacy.json` | `plans.04-03a` and `plans.phase-close` (every lockfile entry added or re-versioned since `90e8fc8`) |
| `evidence/pins.json` | age release digests and image digests (04-05a) |
| `evidence/04-*/` | Per-plan evidence, including every without-fix (negative proof) run of 04-07a…e |

Local results at `2260c64`:
- **Vitest:** 211 files / 4399 tests, passed in both runs, 0 failed, 0 skipped. Teardown left nothing behind.
- **Report gate:** PASS for both runs (floor 4180, 118 required files).
- **Static checks:** typecheck exit 0; `eslint . --quiet` exit 0 (`npx eslint .`: 0 errors, 382 warnings); inventory exit
  0; `ci:ai-l1` PASS; `ci:audit` PASS (two waived highs); workflow policy PASS (7 workflows); every boundary message id
  0 incl. `P0-12`; `boundary_directives` `[]`; `cron_route_files` 0.
- **Playwright PR lane:** 196 passed (including 10 KNOWN-BUG expected failures), 9 skipped by design, 0 failed, 0 flaky,
  0 retried.
- **Drift:** local drift PASS (0 statements); schema snapshot PASS (2520 lines).
- **Restore drill self-test:** pass, RPO 18 s, RTO 32 s, 12/12 checks.
- **Close-run failure, root-caused:** the first evidence attempt at `3888219` failed one test
  (`tests/jobs/alert-notify-db.spec.ts`, order-dependent: its message runner dead-lettered other files' pending
  messages after its own job). Reproduced, fixed in `2260c64` with a without-fix run
  (`evidence/close/alert-notify-isolation.txt`); the evidence above was then re-run from a fresh `db reset --local`.

## Acceptance (roadmap §12.2 V2-04, mapping in `04-PLAN.md` "Acceptance mapping (roadmap V2-04, binding)")
| # | Criterion | Evidence (tool output) | Result |
|---|---|---|---|
| 1 | the parallel-dispatcher test shows 0 duplicate sends | `tests/jobs/parallel-dispatch-db.spec.ts` 12/12 in both runs (8 runners × 200 messages, each sent once; `full-run-{1,2}.json`); `claim-grants-db.spec.ts` 11/11; `runner-review-fixes-db.spec.ts` 7/7 (fair batch through the real runner); N-1b re-check P6: 6 concurrent runners, 0 duplicates (`reviews/v204-review-n1b-n2b-recheck.md`) | Met |
| 2 | a stuck `processing` row is reclaimed | `tests/jobs/reaper-db.spec.ts` 11/11 (expired lease reclaimed, fenced, finishes once), `tests/jobs/delivery-reap-db.spec.ts` 5/5 (stuck delivery rows) | Met |
| 3 | queue lag p95 < 2 min in staging (**Assumption (validate)**) | `evidence/scheduler-local-e2e.json`: real pg_cron → pg_net → app on macOS, 5/5 jobs done, lag p95 42.212 s; lag computed by `ops.report_all` (`tests/ops/ops-report-db.spec.ts` 16/16); `queue_lag` rule in `tests/jobs/alerts-db.spec.ts` 35/35 | Local met; staging `ops-report` lag (≥ 100 samples) **pending PO (04-P1, P8, P9, P10, P12)**, post-merge |
| 4 | an alert fires in the staging drill | `tests/jobs/alert-drill-db.spec.ts` 1/1 (`drill.always_fail` → dead → `dead_letter` → `alert.notify` → one Mailpit message); `alert-notify-db.spec.ts` 10/10; `alert-review-fixes-db.spec.ts` 7/7 | Local met; staging drill email + notified `dead_letter` in the `ops-report` artifact **pending PO (04-P7, P8, P9, P10, P12, P17)**, post-merge |
| 5 | an encrypted dump of staging lands in the staging R2 bucket (erratum 2026-11-14) twice a day and a deliberately failed run raises an alert | `restore-drill-selftest.json` (age-encrypted backup of the local stack via `ops/backup/backup.sh`, uploaded to the local S3 stand-in); `tests/ops/backup-script-guards.spec.ts` 12/12, `backup-evidence.spec.ts` 9/9, `backup-roundtrip-db.spec.ts` 2/2, `backup-runs-db.spec.ts` 15/15, `drill-evidence-and-workflows.spec.ts` 9/9; `backup_stale` on a failed run (R-50) in `alerts-db.spec.ts`; workflow policy PASS | Code met; twice-daily R2 objects and the failed-run alert **pending PO (04-R2, 04-P11)**, post-merge |
| 6 | the first restore drill rebuilds staging data in a local stack and passes the pgTAP RLS suite, with RPO and RTO recorded | `evidence/restore-drill-selftest.json`: pass, RPO 18 s, RTO 32 s, 13 drill pgTAP tests, 43 RLS tables, digest and SQL guard checked, tampered archive refused; `tests/ops/restore-drill-checks-db.spec.ts` 5/5, `restore-guards.spec.ts` 55/55, `manifest-guard.spec.ts` 22/22, `restore-psql-restricted-db.spec.ts` 3/3, `ensure-schedules-db.spec.ts` 5/5 | Mechanics met locally; staging drill **pending PO (04-P13)** |
| 7 | the heartbeat row is written every 6 h | `tests/ops/heartbeat-quota-db.spec.ts` 14/14 (function + schedule + `heartbeat_gap`); `ops-cleanup-db.spec.ts` 10/10 (newest row kept) | Local met; staging heartbeat gap over ≥ 24 h **pending PO (04-P1, P8…P10)** |
| 8 | the quota job reports database, Storage and MAU usage against the 60 %/70 % thresholds | `tests/ops/quota-level-db.spec.ts` 18/18, `heartbeat-quota-db.spec.ts` 14/14, `quota-alert-email.spec.ts` 4/4, `check-ops-report.spec.ts` 36/36 | Local met; staging quota block **pending PO (04-P1, P8…P10)** |

Roadmap tests:
- concurrency T-07 subset: `parallel-dispatch-db.spec.ts` (8 runners × 200 messages)
- reaper: `reaper-db.spec.ts`, `delivery-reap-db.spec.ts`
- MSW contract for MSG91: `msg91-contract.spec.ts`
- scheduler migration test on the local stack: `scheduler-migration-db.spec.ts`
- the scripted restore drill: `restore-drill-selftest.json` (local); `backup-roundtrip-db.spec.ts`
- quota-threshold unit test: `quota-level-db.spec.ts`

Scope items without an acceptance row:
- P0-12 "no request path dispatches": `tests/security/p0-12-lint-gates.spec.ts` 53/53 (provider factory and webhook
  deliverer importable only from `lib/jobs/internal/**`, incl. dynamic `import()`); enqueue RPCs
  `enqueue-message-rpc-db.spec.ts` 24/24 and `enqueue-webhook-rpc-db.spec.ts` 23/23 (dual-member cases, ADR-0005 A2);
  member writes revoked `queue-grants-db.spec.ts` 10/10; handlers `message-send-handler-db.spec.ts` 6/6,
  `webhook-deliver-handler-db.spec.ts` 15/15; H-SMS `sms-recipient-exploit-db.spec.ts` 4/4.
- RL-23 constant-time runner auth: `tests/jobs/runner-auth.spec.ts` 31/31, `run-route.spec.ts` 29/29,
  `scheduler-migration-db.spec.ts` 29/29; e2e `security/cron-routes-removed.spec.ts` and `jobs/run-route.spec.ts` in the
  PR lane; `static-checks.json` `cron_route_files` 0.
- MSG91 contract (T-09, MSW): `tests/messaging/msg91-contract.spec.ts` 24/24; inbound idempotency
  `inbound-dedupe-db.spec.ts` 21/21, `inbound-retry-db.spec.ts` 13/13.
- ADR-0005 register shrink and A3: `static-checks.json` `exception_register_entries` 2; `tests/security/p1-34-lint-gates.spec.ts`
  150/150; `tests/integration/auth/send-email-hook-dedupe-db.spec.ts` 6/6.
- `/api/ready` job flags (R-41): `tests/api/readiness-probe-db.spec.ts` 8/8.
- 04-00 carry-over (V2-03 review A Lows): `tests/config/env-schema.spec.ts` 256/256, `env-boot.spec.ts` 12/12,
  `tests/ci/staging-scripts.spec.ts` 67/67, `workflow-policy.spec.ts` 72/72, `tests/setup/test-env-guard.spec.ts` 83/83.
- 04-00b Resend: `tests/auth/resend-sender.spec.ts` 24/24.
- Not applicable: `npx tsx ops/backup/render.ts --check` (R-30 not built, erratum 2026-11-14; the AWS design is
  `docs/ops/backup-aws-golive.md`, V2-15).

## Reviews (CLAUDE.md DoD 6) — reports in `reviews/`
| Range | Reviewer | Severity (C/H/M/L/I) | Outcome |
|---|---|---|---|
| `origin/feature/v2...0dc606b` | Independent | 0/0/5/7/5 | M1–M5 fixed (04-07a/b/c); L2, L3, L4, L7 fixed; L1, L5, L6 open without a triage row (`04-SUMMARY.md`) |
| same | Adversarial A queue/runner | 0/0/1/5/4 | M-1 (= M-FAIR) and L-1…L-5 fixed in 04-07b |
| same | Adversarial B messaging/webhooks | 0/1/3/6/0 | H-1 (H-SMS) and M-1…M-3 fixed in 04-07a; L-4 accepted (AUTH-00 re-check kit) |
| same | Adversarial C ops | 0/0/2/5/7 | M-1, M-2 and L-1…L-4 fixed in 04-07c; L-5 accepted (V2-15) |
| `635cd5d` | Re-verification 1 | H-SMS and 8 Mediums CLOSED; new 2 M / 3 L / 2 I | N-1, N-2, L-A, L-C, Info fixed in 04-07d; L-B accepted (V2-12) |
| `3947174` | Re-verification 2 | N-1, N-2 OPEN; new 2 M (N-1b, N-2b) / 3 L | All fixed in 04-07e |
| `b5c9e11` | Re-verification 3 | N-1b, N-2b CLOSED; 1 Info (I-1) | I-1 fixed at close (`fceeda2`, `evidence/04-07e/i1-negative-proof.txt`) |

Accepted items (reason and owner) are in `04-07-REVIEW-TRIAGE.md`. Every fix has a regression test that fails without
it; the without-fix runs are in `evidence/04-07{a..e}/`.

No test was retried to green. Both Vitest runs and the Playwright lane ran with `retries: 0` locally and show 0 flaky
results.

## Not yet verifiable (owner)
- Acceptance 3-8, hosted halves: pending the PO actions named in the table; they close after merge (R-19 pattern).
  Claude runs each verify command (`.planning/PO-ACTIONS.md` § V2-04) and updates this file and VERIFICATION_LOG.
- CI run on the verified commit: the orchestrator records it with `scripts/phase-evidence.mjs --ci-run <id>` and fills
  `ci_run`. The nightly `backup-roundtrip` job runs on `feature/v2` once merged (schedules run on the default branch);
  until its first green run the local self-test stands.
- Merge blockers: none open (04-P14 and 04-P15 delegated to the CTO by the PO on 2026-11-13).
