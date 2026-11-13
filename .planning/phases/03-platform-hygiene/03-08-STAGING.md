# 03-08 record: staging environment as code (P1-35a, FT-01, R-9, R-19, R-21, R-26, R-30)

**Outcome:** done locally. Nothing in this plan contacted a hosted service. The workflows run only from
`feature/v2` after the phase PR merges (R-19), inside the PO-approved GitHub Environments. The first approved
`staging.yml` run, the Vercel deploy link and the first `drift.yml` run are **pending PO (E1b, E2, E4, E10, E11, E3)**.
**Evidence:** `evidence/03-08/` (tool output only; `commit.txt` is the SHA the checks ran on).

## Commits

| SHA | Subject |
|---|---|
| `f677ab9` | feat: staging scripts (target guard, release wait, region check, read-only schema drift); `vercel.json` pins `bom1` |
| `cbdbdfc` | feat: shared demo clinic seed core; guarded staging seed |
| `edf4fc5` | ci: `staging.yml`, `drift.yml` and the workflow policy check in `static` |
| `6d33343` | ci: exact-fingerprint gitleaks suppression for the synthetic JWT-shaped refusal fixture |
| (next) | docs: runbook, this record, evidence and wave notes |

## What shipped

- **`vercel.json`**: `regions: ["bom1"]` (FT-01). `check-region.mjs` reads the expected region from this file, so the
  pin and the nightly check cannot disagree.
- **`.github/workflows/staging.yml`**
  - Triggers: `push` to `feature/v2` (paths `supabase/migrations/**`) and `workflow_dispatch` with `task` =
    `migrate` | `seed` | `seed-reset`. There is no PR trigger. `permissions: contents: read`.
    `concurrency: staging`, never cancelled.
  - Job `migrate` (Environment `staging`, plus its own `github.ref == refs/heads/feature/v2` check):
    `npm ci --ignore-scripts` → `target-guard.mjs --var STAGING_DB_URL --mask` → `supabase db push --db-url … --dry-run`
    → `supabase db push --db-url … --yes` → `wait-for-release.mjs "$STAGING_ORIGIN" "$GITHUB_SHA"`.
  - Job `seed` (dispatch only, Environment `staging`): `scripts/seed-staging.ts` (`--reset` for `seed-reset`).
- **`.github/workflows/drift.yml`**
  - Triggers: `schedule` `0 21 * * *` (02:30 IST) and `workflow_dispatch`. Environment `staging-readonly`, ref check
    on every job.
  - `auth-config`: `node scripts/drift/auth-config-hosted.mjs --out drift-report/auth-config-drift.json`, as the
    03-11a handoff specified; the report is uploaded as an artifact.
  - `schema`: target guard, then `scripts/staging/schema-drift.mjs --out drift-report`.
  - `region`: sparse checkout, then `check-region.mjs "$STAGING_ORIGIN"`.
- **Rules in both files.** Secrets appear only in the `env` of the step that needs them, never at job or workflow
  level. Every `uses:` reuses the SHAs already pinned in `ci.yml`. `persist-credentials: false`. No npm cache restore
  and `npm ci --ignore-scripts` wherever a staging secret is present (no install script or restored cache runs next
  to a credential).
- **`scripts/staging/target-guard.mjs`** accepts only the staging project:
  - `https://<ref>.supabase.co` (bare origin);
  - `db.<ref>.supabase.co` (direct database host);
  - `aws-<n>-<region>.pooler.supabase.com` with the user name ending in `.<ref>` (session pooler).
  It refuses loopback addresses, any IP literal, `localhost`, `*.local`, `*.internal`, `host.docker.internal`,
  single-label names, other refs, look-alike hosts and unknown schemes. Refusals name the rule and at most the host.
  `--mask` emits `::add-mask::` for the decoded and the raw password, and only on a GitHub runner.
- **`scripts/staging/wait-for-release.mjs`**: polls `/api/health` until `release` equals the commit (default 10 min,
  15 s interval). Then `/api/ready` must return 200 with `status: "ready"` and `latestMigration` equal to the newest
  `NNNNNN_*.sql`. The origin must be a bare https origin. Readiness bodies are never echoed.
- **`scripts/staging/check-region.mjs`**: `/api/health` `region` must equal the `vercel.json` pin. The region segments
  of `x-vercel-id` are printed as the secondary signal (R-30). On a mismatch the message says "record the deviation
  (FT-01)".
- **`scripts/staging/schema-drift.mjs`**: runs
  `npx supabase db diff --db-url <STAGING_DB_URL_RO> --schema public --agent no --output-format json` and judges the
  output with `scripts/ci/local-drift.mjs --input` (03-03's allowlist, unchanged). The URL and password are redacted
  from the CLI's stdout and stderr. The URL is removed from the child's environment.
- **`scripts/seed/demo-clinic.ts`**: the seeding core extracted from `seed-local-dev.ts`, with clinic name and email
  domain as parameters. `seed-local-dev.ts` now calls it. Its guard (`loadTestEnv` → `loadLocalStackKeys` →
  `assertLocalTestEnv`), output and password handling are unchanged.
- **`scripts/seed-staging.ts`** refuses (exit 1, before any request) unless all of these hold:
  - `APP_ENV=staging`;
  - `STAGING_SUPABASE_URL` passes the target guard as an API URL;
  - `STAGING_SECRET_KEY` starts with `sb_secret_`;
  - `STAGING_SEED_PASSWORD` has at least 16 characters.
  It never prints the key or the password.
- **`scripts/ci/workflow-policy.mjs`** (in `static`, after the auth-config step). Its rules are `uses-pinned`,
  `top-level-permissions`, `no-pull-request-target`, `staging-no-pr-trigger` (`pull_request`, `pull_request_target`,
  `workflow_run`), `staging-secret-needs-environment` (including workflow-level references) and `no-secrets-dump`.
  A workflow counts as staging when its file name is `staging.yml`/`drift.yml`, when it references any
  `secrets.*STAGING*`, or when it uses a `staging*` Environment. The checker is line-based; its documented limits are
  in its header.
- **`docs/runbooks/staging.md`**:
  - create (E2) and the read-only role SQL (`clinicos_drift_ro`, no password, read-only default, no table grants);
  - Vercel (E4) and the Environments table (E10/E11);
  - deploy order (expand → migrate → contract);
  - migrate, seed, demo and full reset, key rotation;
  - pause cap (FT-01), `bom1` check, rollback, drift failure guide, who may do what.

## Tests (fail without the change)

| Spec | Cases | Proves |
|---|---|---|
| `tests/ci/workflow-policy.spec.ts` | 14 | The repo's 4 workflows → 0. Each of 6 fixtures → exit 1 with exactly one finding, naming the rule and line. A clean fixture whose comments mention a tag pin and `pull_request_target` → 0. Regressions applied to the **real** files: `staging.yml` + `pull_request` (file-name rule), `drift.yml` + `workflow_run`, `migrate` without `environment` (one finding per `STAGING_DB_URL` reference), a staging secret at workflow level, `ci.yml` with a tag pin and no `permissions` |
| `tests/ci/staging-scripts.spec.ts` | 40 | **target-guard:** 11 refusals and 4 acceptances; kind enforcement; the CLI with `--mask` masks decoded and raw passwords and prints them nowhere else; a refusal prints no password; redaction. **wait-for-release:** injected fetch and clock; 0 when `release` matches on the 3rd poll; 1 on timeout without calling `/api/ready`; 1 on 503 or an older migration; 2 on http, path or short SHA before any request; `newestMigration`. **check-region:** `vercel.json` pins `bom1`; an ambiguous pin throws; pass; fail with the FT-01 note. **schema-drift:** a loopback URL is refused with no CLI call; the exact read-only argv (`--db-url`, `--schema public`, no `-f`); pass and drift through the real `local-drift.mjs`; a failing CLI's stderr is redacted. **seed-staging:** 7 refusals (no `APP_ENV`, `APP_ENV=test`, 127.0.0.1, localhost, other ref, JWT key, short password), each with the reason, no stdout and no password echoed. **seed-local-dev:** still refuses `https://staging.invalid` |
| `tests/integration/demo-clinic-seed.spec.ts` (DB lane) | 3 | The extracted core on the local stack, using its own clinic name and domain (the PO's demo logins are untouched): clinic, 5 roles, 3 patients and owner sign-in; second run is idempotent and switches the password; reset removes exactly 1 clinic and 5 users, and a second reset removes 0 |

The specs fail at the base commit because none of the scripts, fixtures or `vercel.json` exist there. Further
negative proofs against copies of the real workflows are in `workflow-policy-negative.txt`: a PR trigger, a missing
`environment` and a tag pin each exit 1.

## Checks (on the SHA in `evidence/03-08/commit.txt`)

| Check | Result | Evidence |
|---|---|---|
| `npm run typecheck` | exit 0 | `typecheck.txt` |
| `npx eslint .` | 0 errors, 427 warnings (unchanged) | `eslint-summary.json` |
| `npm run inventory` | exit 0 | `inventory.txt` |
| `node scripts/ci/workflow-policy.mjs` | PASS (4 workflows); fixtures 1 pass, 6 fail as designed | `workflow-policy.txt`, `workflow-policy-negative.txt` |
| actionlint 1.7.7 (docker) on `staging.yml`, `drift.yml`, `ci.yml` | exit 0, no findings (`nightly.yml` has one pre-existing shellcheck info, out of scope) | `actionlint.txt` |
| `npm ci --ignore-scripts` in `node:24` (Linux) | exit 0; `supabase` 2.120.0, `tsx` 4.23.15 and esbuild all work | `npm-ci-ignore-scripts-linux.txt` |
| New specs (in the full lane) | `staging-scripts` 40, `workflow-policy` 14, `demo-clinic-seed` 3: 57 passed | `vitest-full.json` |
| Full Vitest lane (`npx vitest run`, stack already up) | 124 files, 2186 tests, 2186 passed, 0 failed, 0 skipped; report gate PASS (floor 1805) | `vitest-full.json`, `vitest-report-gate.txt` |
| gitleaks 8.30.1 (docker, full history, after committing) | one finding of mine (the JWT-shaped refusal fixture in `cbdbdfc`), suppressed by exact fingerprint with a reason in `6d33343`; then "no leaks found" | `gitleaks.txt` |
| e2e | not run: 03-08 touches no proxy, env schema, auth page, route or UI file | |

`commit.txt` is `fc374cf`: HEAD once 03-09c, which shared the tree, had committed all its code. The
full lane ran on the same code (it started after 03-09c's last code commit `f166341`; `fc374cf` is docs only).

## Deviations and interpretations

1. **Target guard is stricter than "host contains the ref" (Rule 2).** A host-substring rule accepts look-alikes
   (`<ref>.supabase.co.evil.example`, refused here) and refuses the session pooler, whose host carries no ref.
   GitHub-hosted runners have no IPv6, and the Free-plan direct host is IPv6-only, so the pooler is the URL the PO
   will use. The guard therefore matches exact host forms, and for the pooler it checks the ref in the user name.
2. **Two extra scripts under `scripts/staging/`** (owned path): `check-region.mjs` and `schema-drift.mjs`, instead of
   inline YAML. Both are testable, and `schema-drift.mjs` adds redaction. `local-drift.mjs` (03-03) is reused through
   `--input`, unchanged.
3. **`seed-reset` dispatch task** added for the runbook's "reset" (demo data only). A full reset is a re-create,
   because there is no linked `db reset` (R-9, R-12).
4. **Policy rules beyond the plan:** `pull_request_target` is banned in every workflow; `workflow_run` counts as a
   PR trigger for staging workflows; staging secrets at workflow level fail; `toJSON(secrets)` and
   `secrets: inherit` fail.
5. **Hardening not in the plan:**
   - `npm ci --ignore-scripts` and no npm cache restore in every staging/drift job (verified on Linux);
   - `github.ref` checks in the job `if:` on top of the Environment branch policy;
   - `STAGING_SEED_PASSWORD` must have at least 16 characters, and `STAGING_SECRET_KEY` must be `sb_secret_…`.
6. **`STAGING_SUPABASE_URL` is derived in the workflow** (`https://${{ vars.SUPABASE_PROJECT_REF_STAGING }}.supabase.co`),
   so the PO does not need a new variable. The seed checks it against the ref.
7. **Readiness field name.** `/api/ready` returns `latestMigration` (camelCase, the 03-01 route); the plan wrote
   `latest_migration`.
8. **New spec not in the file list:** `tests/integration/demo-clinic-seed.spec.ts`. It is the local dry run of the
   extracted seed core. It replaces running `npm run seed:local`, which would have reset the PO's local demo
   password.
9. **`db push` was never run, not even `--help`** (CLAUDE.md; the permission system denied `db push --help`). The push
   flags were read from the CLI 2.120.0 binary's help strings: `--db-url` ("must be percent-encoded"), `--dry-run`, and
   `--include-seed` (opt-in, so the seed stays off). `--yes` comes from `supabase --help`, and `db diff --db-url` and
   `--schema` from `supabase db diff --help`.
   **K-8:** that `db diff --db-url` only reads the hosted target cannot be shown without the hosted project. The
   `clinicos_drift_ro` role (read-only default transaction, no table grants) makes any write fail. The first real
   run is the check.

## PO-ACTIONS corrections (for the orchestrator)

- **E10 `STAGING_DB_URL`:** use the **Session pooler** URL (port 5432, user `postgres.<ref>`), not the direct URL.
  GitHub runners lack IPv6. Percent-encode the password.
- **E10 `STAGING_DB_URL_RO`:** the same pooler host with user `clinicos_drift_ro.<ref>`. Create the role with the SQL
  in `docs/runbooks/staging.md` §3 after the first `migrate` run, and set its password yourself.
- **E10 `STAGING_SECRET_KEY`:** must be an `sb_secret_…` key. **`STAGING_SEED_PASSWORD`:** at least 16 characters.
- No new secret or variable names. The dispatch tasks are `migrate`, `seed` and `seed-reset`.
- **Phase close step 6 (CLAUDE.md never-run list):** add `scripts/staging/*` (target-guard, wait-for-release,
  check-region, schema-drift) and `scripts/seed-staging.ts`.
