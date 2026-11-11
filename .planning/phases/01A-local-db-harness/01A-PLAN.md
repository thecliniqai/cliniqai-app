---
phase: 01A
roadmap_id: V2-01a
name: Local DB harness
gate: G3-partial
requirements: [P0-10, AUTH-00]
plans: [01a-01, 01a-02, 01a-03, 01a-04]
source: docs/v2/V2_MASTER_ROADMAP.md §12.2 (V2-01a); docs/v2/TEST_STRATEGY.md §6.2, T-01, T-02, T-06
---

# Phase 01A (V2-01a): Local DB harness — plan

The scope, plans, acceptance, tests and evidence are fixed by the approved roadmap (§12.2). The PO directed
execution on 2026-11-11 without a separate discuss/plan round; this file records how each roadmap plan was
executed. No app code changes.

**Objective:** an executable regression net on a local stack before any auth refactor.

## 01a-01 Harness + non-local-URL guard
- `vitest.config.ts` stops reading `.env`; loads committed `.env.test` (local values, no keys) and the local
  stack's `supabase-demo` keys from `npx supabase status`.
- `tests/setup/test-env.ts` guard: loopback-only Supabase/app URLs; offline providers pinned; real-credential
  variables refused; keys must be local-issuer with the right role; hosted markers refused in any variable.
  Enforced at config load, in globalSetup and in every worker (also after spec imports).
- Workers refuse any non-loopback `fetch`. Playwright config uses the same guard.
- Test: `tests/setup/test-env-guard.spec.ts`, including an end-to-end `vitest run` pointed at a hosted URL.

## 01a-02 Run and stabilise the existing DB suites locally
- All existing spec files run **unchanged**. Environment fixes only, outside spec files:
  `scripts/msg91-sync-templates.ts` loaded `.env` at import time (now CLI-only).

## 01a-03 Teardown
- `tests/setup/teardown.ts` via globalSetup teardown: storage objects → tenants (cascade) → leak check over the
  NO ACTION `auth.users` columns (fails loudly) → auth users → verification that nothing created since run
  start remains → removal of dev-log side-effect files created by the run. Derived from the migration FK graph.

## 01a-04 AUTH-00 spike note
- Local-only spike on a separate stack (scratch config, own ports, no repo config change, no migrations):
  `01A-04-AUTH00-SPIKE.md`. Hosted-only and external-network items deferred to the V2-03 staging re-check.

## Acceptance (roadmap, verbatim)
all 69 files run locally with 0 failures attributable to the environment; 0 skipped in the DB lane; the guard
aborts a run pointed at any non-local URL; zero tests reach a hosted URL.

## Evidence (roadmap)
the local run log (counts produced by the runner, not hand-typed) and the guard test output. CI links become
available in V2-02. → `01A-VERIFICATION.md` and `evidence/`.
