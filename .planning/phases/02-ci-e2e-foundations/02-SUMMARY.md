---
phase: 02
roadmap_id: V2-02
name: CI & e2e foundations
status: awaiting PO gate approval (G3-partial)
base_commit: 2695964 (V2-01 head, stacked)
head_commit: 004a2f3
---

# Phase 02 (V2-02) — summary

V2-02 makes every later phase produce CI evidence. It delivers P0-11, P0-13, P1-27, P1-41 (report-only part), PWA-08a and
the AI-06 L1 lane. The PO delegated decisions to the agent acting as CTO. Rulings RL-1…RL-23 (planner) and OA-1…OA-6
(orchestrator) are in `02-PLAN.md` with the review triage.

## What changed, by plan
| Plan | Outcome |
|---|---|
| 02-01 CI | `.github/workflows/ci.yml` runs on every PR. Five jobs: `static` (typecheck incl. tests, lint, server-action inventory, AI-06 L1 policy checks, env-file and doc-grep checks), `security` (audit gate with an expiring allowlist bound to severity, npm signatures, gitleaks over full history), `test` (full Vitest on a local Supabase stack in the runner, report gate, coverage, guard canary), `build` (production build with a loopback URL), `e2e` (Playwright). `nightly.yml` runs the full device matrix and files a bot-owned issue on failure. Every action is pinned to a commit SHA; no repository secrets; read-only token. CODEOWNERS added. Login-page and two deterministic-UI sparkle icons removed (OA-1). |
| 02-04 | Tests are type-checked (`tsconfig.tests.json`; 343 → 0 errors, one documented `TestDb` seam until generated types in V2-03). Three tautological/doc-grep specs deleted (one real case moved). Visit-history and visits-register tests rewritten against the local DB; the old ordering test never tested ordering. |
| 02-05 | Coverage (v8) report-only in the CI summary, with per-domain rows against the V2-14 targets. |
| 02-02 | P0-13 guard enumeration over all 110 server actions and 46 route methods (manifest checked against the inventory; per-category rules for public token, webhook, cron, `/api/v1`, health). Legs: no session, every role lacking the permission, no clinic, tenant B's ids (all at once and one reference at a time, with positive controls), a user in two clinics acting in one. A planted unguarded action makes the guard fail on every CI run (canary). |
| 02-03a | Playwright: a locked-down e2e server (allowlisted env, `.env` loading disabled and pinned by a test, build-output scan, build stamp, socket and DNS/UDP guard, port 3100), loopback-only browser, per-run seed and teardown, `seed:local` (R7), device projects (desktop, Pixel 7, iPhone 15 in the PR lane; full matrix nightly), unauth-page and R8 axe checks on login / forgot-password / join (0 serious/critical). |
| 02-03b | Six M0 characterisation flows (register, walk-in to token, book incl. overbook, cancel, consult → Rx → finish, checkout and collect) plus journeys 1, 8, 9, all asserting DB/UI outcomes. Known v1 bugs F-01, F-04, P1-03, P1-07 are asserted correct as expected failures that must fail on their own `KNOWN-BUG` assertion. M0 baseline report committed (`evidence/m0-baseline/`). |
| 02-06 | Review fixes (below) and the auth-form POST/hydration fix. |

## Defects found and fixed beyond the plan
- **Cross-tenant reference writes:** a clinic-A user could create A rows pointing at clinic B's patients, visits or users. Affected: visits/booking/waitlist promotion, waitlist, consents, follow-ups, diagnoses, referrals, invoices, schedule blocks, lab uploads. No B data was read or changed. Now refused by `lib/auth/tenant-refs.ts`; the DB constraint is V2-05 P1-02.
- **Users in two clinics acting with the wrong role:** by-id queue/visit/waitlist/referral reads and updates relied on RLS alone, which allows every clinic the user belongs to. They now filter on the active clinic.
- **Credentials could reach a URL:** the login and forgot-password forms had no `method` (default GET), so a click before hydration would submit email and password as query parameters (history, server and proxy logs). Found by root-causing a CI-only iPhone flake; forms are now POST and submit is enabled only after hydration, asserted in journey 1.
- Lockfile out of sync for CI's npm (regenerated with npm 11.19.1); a gitleaks false positive suppressed by exact fingerprint.

## Deleted tests (TEST_STRATEGY T-12 / E-5)
`tests/cabin/navigation-roles.spec.ts`, `tests/queue/status-actions.spec.ts` (tested helpers defined in the spec);
`tests/ops/backup-restore.spec.ts` (doc wording + insert/select; no backup or restore).

## Numbers
Vitest: 90 files / 1164 tests at the start of V2-02 → 102 files / 1899 tests (`evidence/summary.json`, two runs, 0 skipped).
Playwright PR lane 120 tests on three device projects. Coverage baseline: overall 36% lines; permissions 92%, prescriptions
81%, billing 78%, queue 75%, scheduling 58%. CI wall time ≈ 7–8 min (jobs in parallel).

## GitHub settings (orchestrator, evidence in `evidence/github-settings/`)
Applied: default branch `feature/v2` (nightly needs it; `main` untouched), secret scanning + push protection, SHA pinning
required, fork-PR workflow approval for all outside contributors. **Pending:** ruleset `feature-v2-ci` (required checks on
`feature/v2`, 0 approvals, merge commits only) must be applied after PR #3 merges and before PR #4 merges.

## Deferred, with owner
DB-level composite tenant FKs for every table in OA-4 → V2-05 P1-02 · signed-out dashboard pages log "Unauthenticated"
errors before the redirect (OA-5) → V2-03 · AI-06 L1 checks needing the env schema / `VITEST` branch removal → V2-03 ·
`/dev/ui`, design greps, bundle budgets → V2-06 · "AI voice agent" developer copy (allow-listed, expires) → V2-06 ·
`/api/v1` B-id leg with a valid key → P1-37 · coverage thresholds → V2-14 · nightly scheduled-run link (first scheduled
run after merge) → recorded at the next gate.

## Open for the PO
1. Merge PR #3 (V2-01) first; then the orchestrator applies the `feature-v2-ci` ruleset and PR #4 is retargeted.
2. Confirm the delegated rulings (RL-*, OA-*), especially the default-branch change and 0 required approvals.
3. Repository visibility: upgrade the org to GitHub Team before making the repo private, or rulesets stop enforcing.
4. CLAUDE.md "Commands" text is still stale (agent edit blocked) — it should describe the local lane and CI.
