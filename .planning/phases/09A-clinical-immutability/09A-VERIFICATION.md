# V2-09a Clinical integrity (DB): verification

Gate: **G4** (per PR). Approved under the PO's delegation of 2026-11-21; the PO reviews in the morning. All results below
come from tool output in `evidence/`.

## Runs

| Run | Commit | Result | Source |
|---|---|---|---|
| Local evidence run (1 run, lean process) | `a7188a4f62b736c47574c940b21985edf1c8072f` | Vitest 362 files, 7270/7270 passed, 0 skipped; pgTAP 60 files, 8494/8494, gate PASS; typecheck, eslint and inventory exit 0; static checks clean, service-role factory only `lib/supabase/system.ts` | `evidence/summary.json`, `full-run-1.json`, `pgtap-run-1.tap`, `static-checks.json` |
| CI run [44890747932](https://github.com/thecliniqai/cliniqai-app/actions/runs/44890747932) | `a7188a4` | static, security, test, build and e2e all success; pgTAP 60 files, 8494, gate PASS; e2e 766 passed, **1 retried** (below) | `evidence/ci-run.json`, `ci-pgtap-report.tap` |

**The retried test.** `shell/clinic-switcher.spec.ts:120` (desktop-chrome) failed once with `net::ERR_ABORTED` on
`page.goto("/today")`. Root cause: a test race in a V2-08 spec, unrelated to V2-09a. The shell's session-status watch
noticed the removed membership and navigated to /login itself, aborting the test's navigation; the app's outcome
(signed out on /login) was correct. Merged on the V2-07 precedent (one explained test race, fixed in the next phase's
first commit). Fixed in `60a9fd4` on `v2/phase-09b-consult-workspace`; the V2-09b CI run is its proof. The `✘` on
`security/network-block.spec.ts` is a declared expected failure.

## Acceptance (roadmap §12 V2-09a, mapping in `09A-PLAN.md`)

| Criterion | Evidence | Result |
|---|---|---|
| UPDATE of a signed row blocked except through amendment | pgTAP `clinical_seal`, `prescription_seal`, `clinical_review_fixes`; `seal-system-path.spec.ts`; AC-6 spec; `amendment-rpc.spec.ts` | **Met** |
| Amendment creates a new version with audit | `amendment-rpc.spec.ts`; journey 6 reads revision, version 2, audit and `...:v2` outbox rows | **Met** |
| A finalised PDF cannot be overwritten | `rx-pdf-archive.spec.ts`, `rx-archive-signer.spec.ts`, pgTAP `rx_pdf_write_once`, `storage_policies`, AC-6 storage legs | **Met** |
| PDF hashes stored and checked | hash equals served bytes (spec and e2e), share link check (`share-verification`), integrity-failure cases | **Met** |
| No member DELETE (or UPDATE) on lab documents | `lab-documents-append-only.spec.ts`, pgTAP `lab_documents_append_only`, `clinical_review_fixes` S-1 | **Met** |
| BACKEND A6 full | `v1-doctor-guard.spec.ts`; A-7 409 on reschedule | **Met** |
| Known-bug e2e plain | `consult-rx-finish.spec.ts`; no `knownBug("P1-03"` | **Met** |
| Journey 6 and T-08 | e2e amend journey (desktop, pixel-7); `workspace-sealed.spec.ts` | **Met** |
| Definer commands do not slow the app | `evidence/command-latency.json`, every p95 under 5 ms locally (target 150) | **Met** |
| Teardown and tenant purge | pgTAP R-4a; every Vitest and e2e run purges its tenants through the cascade | **Met** |

## Reviews

| Review | Scope | Result |
|---|---|---|
| Isolated (Sonnet) | 09A-01..04 | 1 High, 3 Medium, 3 Low (`09A-REVIEW-A.md`) |
| Adversarial security (Opus) | 09A-01..04 | 2 High, 3 Medium, 3 Low, 2 Hardening; no cross-tenant path (`09A-REVIEW-SEC.md`) |
| Isolated (Sonnet) | 09A-05 | 1 Blocker, 6 Warning (`09A-REVIEW-B.md`) |
| Fix round 09A-06a | every "Fix" row and B-1..B-7 | Fixed; each row's commit, test and failed-without proof in `09A-REVIEW-TRIAGE.md` "09A-06a outcome". Deferred: S-6 (V2-12) |

## PO items (morning)

1. **R-A residual:** accept signer-only Rx archiving for v2.0, or schedule the trusted `rx.archive` job (V2-14). The
   job also closes "the signer left before the archive": such a prescription is then only ever a labelled regenerated
   copy and the visit cannot be amended.
2. **Q-5:** lab documents cannot be deleted until V2-11's void, wrong-patient uploads included.
3. **ADR-015 erratum** (Q-1 in `09A-PLAN.md`).
4. Staging: apply 000107–000111 (09A-P2).

## Gate decision (2026-11-21)

Approved by Claude as CTO delegate under the PO's delegation (CI green, one retried test root-caused as an unrelated test
race and fixed in `60a9fd4`, on the V2-07 precedent). PR #15 merged into `feature/v2` as
`f15fa252f5452351366cc641250bf12166f3e776`. The PO reviews in the morning (09A-P1).
