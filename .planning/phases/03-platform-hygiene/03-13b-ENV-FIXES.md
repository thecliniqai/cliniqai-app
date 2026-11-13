# 03-13b record: env, staging and CI review fixes (H-ENV, M-GUARD, M-POLICY, M-PREVIEW, M-SEEDPHONE, M-TOKEN, M-DRIFT, 03-13b Lows)

**Outcome:** done locally. Nothing contacted a hosted service; no workflow was dispatched. Every fixed item has a
test that fails without the fix (tool output in `evidence/03-13b/*.without-fix.txt` and `*.with-fix.txt`; the
without-fix runs swap only the named files back to the previous commit and restore them).
Sources: `reviews/v203-review-adversarial-env-staging.md` (A), `reviews/v203-review-independent.md` (IND), triage
`03-13-REVIEW-TRIAGE.md`.

## Triage ID → commit → test

| ID | Finding | Commit | Test (fails without the fix) | Evidence |
|---|---|---|---|---|
| **H-ENV** | A H-1: secret key accepted in `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (and the reverse) | `0492938` | `tests/config/env-schema.spec.ts` "a Supabase key in the other key's variable" (8 swap forms × 6 tiers, both at once, deploy-tier prefixes); `tests/config/env-boot.spec.ts` "the secret key in the publishable variable stops the build" | `h-env-m-preview.*` (57 failed → 188 passed, shared with M-PREVIEW) |
| **M-PREVIEW** | A M-4: preview deployments run with staging secrets | `0492938` (code), `84c7477` (runbook) | `env-schema.spec.ts` "deploy tiers only in a Vercel production deployment"; `env-boot.spec.ts` "a staging profile on a Vercel preview deployment stops the build" | `h-env-m-preview.*` |
| **M-GUARD** | A M-1: DB-URL query parameters re-target pgx; TLS not required | `1a32b7c` | `tests/ci/staging-scripts.spec.ts` "refuses a database URL with …" (10 forms incl. the review's 4 probes), canonical URL + `--print-db-url` CLI, schema-drift refusal | `m-guard.*` (14 failed → 53 passed) |
| **M-POLICY** | A M-3 + IND L-5: workflow-policy fails open | `a7e3b51` | `tests/ci/workflow-policy.spec.ts` "enforces every rule the staging/drift headers claim" (the review's bypass fixture in flow and block style; 15 regressions of the real workflows; untrusted `run:` contexts in ci.yml) | `m-policy.*` (17 failed → 33 passed); `workflows-actionlint-zizmor.txt` |
| **M-SEEDPHONE** | A M-5: seeded phones may be real numbers | `7c44dfe`, then `85e5e9e` (aligned to 03-13d's guard range) | `tests/utils/synthetic-phones.spec.ts` (every `DEMO_PATIENTS` number is `isSyntheticPhone` of the guard's own module); `tests/integration/demo-clinic-seed.spec.ts` (every row the seed writes on the local stack) | `m-seedphone.*` (mutation run: one seed number outside the range → 2 failed) |
| **M-TOKEN** | A M-6: no fallback when no scoped token exists | `84c7477` | doc only (runbook §5); PO-ACTIONS text below | — |
| **M-DRIFT** | IND M-2: drift covers only `public`, no privileges; the CI step compares migrations with themselves | `58a8100` | `tests/ci/schema-snapshot.spec.ts`: on the live stack (begin/rollback) an anon EXECUTE grant on `private.outbox_payment_recorded`, table INSERT on `payments`, an `ops` column, RLS off and a storage policy are each drift; CLI and hosted (psql, PG* env) paths; `staging-scripts.spec.ts` diff covers `public,ops,private` | `m-drift.*` |
| **Low (IND L-4)** | immutability gate compares a feature/v2 push with itself | `168b6e8` (+ `6928904` typecheck) | `tests/ci/migration-immutability.spec.ts` "on pushes to feature/v2": the old self-compare passes the edit (the gap), `--base auto` with the push's `before` (and the HEAD~1 fallback) fails it; PR mode uses `origin/<base>` | `lows-immutability.*` |
| **Low** | two branches use the same migration number | `168b6e8` | `migration-immutability.spec.ts` "collisions against origin/feature/v2": same number, a lower number after the branch moved, same file (stacked) passes, unresolvable ref exits 2 | `lows-immutability.*` |
| Orchestrator add-on | `/api/ready` returns booleans only since 03-13c M-PROBE (`latestMigration` gone) | `5dad2a0` | `staging-scripts.spec.ts` "wait-for-release": ready needs `checks.schema` = `current`; `behind`, a pre-03-13c body and an odd value fail unechoed | `ready-schema-current.without-fix.txt`, `ready-and-recheck.with-fix.txt` |
| Orchestrator add-on | `staging.yml` recheck inputs for 03-13a items 10/11 | `494ad20` | `tests/ci/recheck-args.spec.ts`: inputs reach the kit's argv (fake `npx`), out-of-range/shell values refused unechoed, ranges equal the kit's, an `inputs.*` in `run:` fails the policy | `recheck-inputs.without-fix.txt` |

## What changed

- **`lib/env.ts`** (every tier): the publishable variable refuses `sb_secret_…` (any case, padded) and JWTs whose
  `role` is not `anon`; the secret variable refuses `sb_publishable_…` and JWTs whose `role` is not `service_role`.
  Staging/production also require the `sb_publishable_` / `sb_secret_` prefixes (R-K). With `APP_ENV` staging or
  production, `VERCEL_ENV` (when set) must be `production`; staging also requires `VERCEL_GIT_COMMIT_REF=feature/v2`
  when set. The tier is still never inferred from `VERCEL_ENV` (R-11). Messages name keys, never values.
  `.env.example` regenerated (two new platform names documented as comments).
- **`scripts/staging/target-guard.mjs`**: a database URL may carry only `sslmode=require|verify-full` (once), no
  fragment, a single-segment database name. `canonicalDbUrl()` rebuilds the URL from the checked parts with TLS
  required; `--print-db-url` prints it (stdout only) for `DB_URL="$(…)"`. `staging.yml` `db push` and
  `schema-drift.mjs` pass that URL (plus `PGSSLMODE=require`), never the raw secret.
- **`scripts/ci/workflow-policy.mjs`**: a small fail-closed block-YAML reader (no new dependency: `yaml` is not
  installed; `js-yaml` is only a transitive eslint dependency). New rules: `parseable-yaml`, `no-write-all`,
  `staging-read-only-token`, `staging-secret-step-scope`, `privileged-no-cache`, `privileged-ignore-scripts`,
  `privileged-checkout-no-persist`, `run-no-untrusted-expression`; the staging trigger rule is an allow-list (push,
  schedule, workflow_dispatch). Line scans now include block scalars raw (a `${{ secrets.X }}` in a shell comment
  still interpolates). The four repo workflows pass; actionlint/zizmor (offline, docker) clean on staging/drift/ci.
- **Seed phones**: `scripts/seed/demo-clinic.ts` builds the three demo numbers from 03-13d's
  `SYNTHETIC_PHONE_PREFIX` (`lib/messaging/synthetic-numbers.ts`). See deviation 1.
- **`scripts/drift/schema-snapshot.mjs`** + committed **`scripts/drift/schema-snapshot.txt`** (2207 lines at
  `000029`): relations/RLS flags, columns, constraints, indexes, triggers, policies (incl. `storage.objects`/`buckets`),
  functions (config, body md5), enums, views, and grants to `anon`/`authenticated`/`service_role`/`PUBLIC` on schemas,
  tables, columns, sequences, functions and default privileges, in `public`/`ops`/`private`; extension objects and
  owners excluded. CI `test` job: new step "Schema and privileges match the committed snapshot"; the migra step is
  renamed to what it proves ("Migrations are deterministic"). Hosted: `schema-drift.mjs` diffs `public,ops,private`
  and runs the same query read-only via the runner's `psql`.
- **`scripts/ci/migration-immutability.mjs`**: `--base auto` (PR → `origin/<base>`; push → the event's `before`,
  else `HEAD~1`) and `--against <ref>`; CI runs `--base auto --against origin/feature/v2`.
- **`scripts/staging/wait-for-release.mjs`**: readiness = 200, `status: ready`, `checks.schema: current` (no
  version number since 03-13c); `--migrations-dir` and `newestMigration` removed.
- **`staging.yml` recheck**: optional inputs `stale_wait_seconds` (601..890) and `email_cap_probe` (1..70) via `env`;
  `scripts/staging/recheck-args.mjs` validates them and starts the kit with `--stale-wait-seconds` /
  `--email-cap-probe` as an argument array. (The kit's `--email-cap-probe` takes a send count, not a boolean.)
- **`docs/runbooks/staging.md`**: §1, §2 (URL parameters), §3 (read-only role wording, IND/A L-9), §4 (Production-only
  scoping, key fields), §5 (E11 fallback, policy rules), §7 (seed range), §12 (schema job reading).

## Deviations

1. **Seed range = 03-13d's range, not a new file of mine.** The brief asked me to create the shared constant. 03-13d
   committed the provider guard first (`a69fa3f`) with `SYNTHETIC_PHONE_PREFIX = "+9190000000"` (`+91 90000 000xx`,
   100 numbers, real providers only) in `lib/messaging/synthetic-numbers.ts`. My first commit (`7c44dfe`) had used
   `+91 60000 000NN` in `lib/utils/synthetic-phones.ts`; `85e5e9e` removes that file and makes the seed import the
   guard's constant, so there is one range and one module. The three demo numbers are therefore unchanged
   (`+919000000001..3`, inside the guarded block); the regression protection is the binding test.
2. **Snapshot must be regenerated whenever a migration changes schema or grants.** It was generated after verifying
   the local stack carries exactly the committed migrations (migra PASS; applied `000029` statements equal the file).
   Any later migration (or a change to `000029` before merge) needs
   `npx supabase db reset --local && node scripts/drift/schema-snapshot.mjs --local --write` in the same commit, or
   CI `test` fails; also bump `app/api/ready/expected-migration.ts` (03-13c spec). **Pending:** the local stack already
   carries `private.session_age_token_hook` (03-13a's coming migration 000030, referenced by `supabase/config.toml`
   but not committed when this ran), so `--local --check` reports that one line now; regenerate when 000030 lands.
3. **Hosted snapshot not exercised against Supabase-hosted.** Default privileges or platform-owned grants on hosted
   may differ from the local stack; the first nightly `schema` run may report such lines. They are recorded and fixed
   in a reviewed change (runbook §12); the tool has no allowlist.
4. **Verification:** full Vitest at `168b6e8` (shared tree): 3374 passed, 10 failed, none in 03-13b files (logger,
   system-db, no-raw-error-logging, guard-actions, p0-01 sweep: other plans' in-progress `features/**`/`lib/log`
   work). All 03-13b specs pass (env, staging-scripts, workflow-policy, schema-snapshot, migration-immutability,
   recheck-args, synthetic-phones, demo-clinic-seed). typecheck, eslint (owned files), inventory, `e2e:build` green;
   `e2e:pr` not run (the boot path is covered by env-boot with the e2e server env; the shared tree had other plans'
   work in progress).
5. **Not done (outside 03-13b's assigned items):** A Lows L-1 (whitespace values), L-2 (loopback forms), L-3 (CLI
   opaque local keys), L-5 (dry-run gate), L-6, L-7, L-8 (`STAGING_*` in the test-lane guard); the optional
   build-scan `postbuild` step; adding zizmor to the `static` job.

## PO-ACTIONS text changes (for the orchestrator; PO-ACTIONS not edited here)

- **03-E4:** add "Scope every Vercel variable to **Production** only (not Preview / Development). The app refuses to
  build or boot with `APP_ENV=staging` on a preview (`VERCEL_ENV`≠`production`) or on a branch other than
  `feature/v2`. Paste `sb_publishable_…` into `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `sb_secret_…` into
  `SUPABASE_SECRET_KEY`; a swapped or legacy JWT key fails the build."
- **03-E10:** "`STAGING_DB_URL` / `STAGING_DB_URL_RO` exactly as the dashboard shows them: no `?…` parameters except
  `sslmode=require`, no `#…` (the target guard refuses them)."
- **03-E11:** add the fallback: "If no scoped read-only token is offered, do not create a classic token in
  `staging-readonly`. Tell Claude: the `auth-config` drift job moves to the `staging` Environment (your approval on
  every run) with the token stored there, in a reviewed change; until then the job stays failing and you record
  'no scoped token available' in VERIFICATION_LOG."
