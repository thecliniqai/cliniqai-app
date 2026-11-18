---
phase: 05
plan: 05-01a
subsystem: test infrastructure (pgTAP lane, CI, evidence)
status: complete
requirements: [P1-01 (harness), roadmap V2-05 evidence "CI pgTAP report"]
plan_head_before: 998999a3e37a95e9fa6cd5151e45b735dc543e4f
commits: [0449dc2, 531a256, 9d15cda]
---

# 05-01a record: pgTAP harness, CI step, evidence

**Outcome:** done locally. `npm run test:pgtap` runs every `supabase/tests/database/*.test.sql` file against the local
stack under the test-run lock and writes a TAP report; `scripts/ci/assert-pgtap-report.mjs` gates it; the CI `test`
job runs both before Vitest and uploads the `pgtap-report` artifact; `scripts/phase-evidence.mjs` runs the lane on
every evidence run and downloads the CI artifact with `--ci-run`. The two legacy psql scripts are pgTAP now
(13 tests). Nothing hosted was contacted; every Supabase CLI call used `--local`; the stack was never reset by this plan.

## What shipped

| Commit | Content |
|---|---|
| `0449dc2` | `supabase/tests/{memberships_bounds_cleanup,search_medicines_extension_schema}.sql` → `supabase/tests/database/*.test.sql`, converted to pgTAP (same assertions and controls; 7 + 6 tests); 000021 §4/§6 inlined verbatim; `tests/ci/pgtap-legacy-inline.spec.ts` |
| `531a256` | `scripts/test-pgtap.mjs`, `scripts/ci/assert-pgtap-report.mjs` (FLOOR 13, REQUIRED_FILES = the two files), `package.json` `test:pgtap` + `authz:gen`, `.gitignore` `/pgtap-report.tap`, `lint-fixtures/pgtap-report/*.tap`, `tests/ci/pgtap-report.spec.ts`, `tests/ci/test-pgtap-script.spec.ts` |
| `9d15cda` | `.github/workflows/ci.yml` (`test` job: pre-pull `pg_prove:3.36` with bounded pull retries; `npm run test:pgtap -- pgtap-report.tap`, never retried; report gate; artifact `pgtap-report`, `if: always()`); `scripts/phase-evidence.mjs` (pgTAP per run + `--ci-run` artifact) |

## Evidence (tool output, `evidence/05a/05-01a/`)

| File | What it shows |
|---|---|
| `before-supabase-test-db.txt` | Before: `npx supabase test db --local` (default directory) → `Parse errors: No plan found in TAP output` for both psql scripts (their `\ir ../migrations/…` is not mounted in pg_prove's container), `Bad plan` for `restore_drill_checks.sql`, `Result: FAIL` |
| `after-pgtap.txt`, `after-pgtap-report.tap` | After, at `9d15cda` on the stack with 05-01b's `000046` applied: `Files=2, Tests=13 … Result: PASS`; gate `PASS`; `pg_extension` has 0 `pgtap` rows after the run; `npm run test:pgtap -- --linked` → refused, exit 1 |
| `gate-proof-failing.txt`, `gate-proof-failing.tap` | Plan step 4: a throwaway `zz_gate_proof_failing.test.sql` (one `is(1, 2)`) run through the real lane → CLI exit 1, gate exit 1 naming `zz_gate_proof_failing.test.sql > 2 - gate proof: deliberately failing assertion`; the file was deleted after the run (never committed) |
| `vitest-full-gate.txt` | Full Vitest lane at `9d15cda` (with 05-01b's uncommitted work in the tree): 4419 tests, 4412 passed, **7 failed, all from 05-01b's in-progress authz change** (below), 0 skipped; this plan's 24 new tests pass |

**Full-Vitest failures attributable to 05-01b (in progress, uncommitted migration `000046_authz_core.sql`, modified
`lib/permissions/matrix.ts`):** `tests/api/readiness-probe-db.spec.ts` (EXPECTED_MIGRATION not yet bumped to 000046);
`tests/auth/rbac.spec.ts` (doctor-not-superset-of-receptionist after PO-3 keys); `tests/jobs/enqueue-message-rpc-db.spec.ts`
(template `request_roles` vs the new permission set); `tests/security/guard-actions.spec.ts` ×2 (`shareReceiptViaWhatsApp`
least-privileged role now receptionist with `billing:view`); `tests/security/p0-01-forged-overrides.spec.ts`
(`toggleGlobalConsent`: receptionist now holds `patients:edit`); `tests/security/review-fixes-db.spec.ts` (invoice share
roles vs the app permission). None touches a 05-01a file; `npm run typecheck` likewise fails only in
`tests/authz/active-tenant-carrier.spec.ts` (05-01b). The 05-01b owner closes these.

Checks: `npx eslint` on every changed file 0 problems; `node scripts/ci/workflow-policy.mjs` PASS (7 workflows);
`rhysd/actionlint:1.7.7` on `ci.yml` exit 0; `scripts/ci/lock-linux-check.sh` PASS (scripts-only `package.json` change).

## Tests that fail without the change

- `tests/ci/pgtap-report.spec.ts` (11): clean → 0; one `not ok` → 1 naming file and test; `No plan found` → 1; `# SKIP`
  → 1; `# TODO` → 1; fewer tests than planned → 1; truncated report → 1; missing required file → 1 (fixture and
  `--require-files`); below floor → 1; unreadable/usage → 2.
- `tests/ci/test-pgtap-script.spec.ts` (10): `--linked`, `--db-url x`, `--db-url=x`, `--project-ref`, a trailing
  `--linked`, a bare connection string → exit 1 with no lock taken and no CLI spawned (injected spawn); two report paths
  refused; the CLI args are exactly `supabase test db --local --debug supabase/tests/database`; stdout teed to the report;
  CLI exit code returned; lock released; a held lock fails fast without spawning.
- `tests/ci/pgtap-legacy-inline.spec.ts` (3): the inlined 000021 blocks are byte-identical to the migration; no legacy
  psql script left at the top of `supabase/tests/` except the restore-drill file.

## Decisions and deviations

1. **`--debug` on the CLI.** CLI 2.120.0 runs `pg_prove --verbose` only with `--debug` (verified: without it the
   report has per-file summaries only, so a failing test could not be named and plans could not be checked). Its extra
   stderr is two lines (no credentials). The report is the CLI's stdout only.
2. **Lock reuse via `node --import tsx`.** The lock helper is TypeScript (`tests/setup/teardown.ts`), so `test:pgtap`
   is `node --import tsx scripts/test-pgtap.mjs` (plan text: `node scripts/test-pgtap.mjs`); the lock key comes from
   the test env (`loadTestEnv`) exactly as Vitest's, with a loopback check.
3. **Inline instead of `\ir`.** Both legacy scripts re-ran all of 000021 with `\ir`; pg_prove's container mounts only the
   test directory, so each file inlines only the section it exercises (§4 memberships bounds, §6 search_medicines),
   verbatim, pinned by a spec (rule 1, required to make the files runnable).
4. **No SKIP for the search_medicines control.** The legacy "control skipped when pg_trgm already lives in
   `extensions`" is a passing "not applicable" test, because the gate refuses SKIP; on local/CI stacks pg_trgm is in
   `public`, so the real control (`throws_ok … 42883`) runs.
5. **`supabase/tests/restore_drill_checks.sql` stays top-level** (V2-04 drill file with psql variables, run by
   `ops/restore-drill` and `tests/ops/*`, outside this plan's files). The lane targets `supabase/tests/database`, so it is
   green; plain `npx supabase test db --local` with **no path** still fails on the drill file. The plan's "no top-level
   `.sql`" predates V2-04's file; R-11 (05-01b) decides its future.
6. **Evidence paths** in the committed outputs have the checkout path replaced by `<repo>` / `<home>` (sed after capture).
7. CLAUDE.md "Commands" does not list `npm run test:pgtap` yet (research suggested it); not edited by an implementer —
   for the orchestrator/PO.

## Self-Check: PASSED

Files and commits verified present (`git merge-base --is-ancestor` for 0449dc2, 531a256, 9d15cda).
