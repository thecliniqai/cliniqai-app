# 04-00 record: V2-03 carry-over hardening (review A Lows L-1, L-2, L-3, L-5, L-6, L-7, L-8; R-47)

**Outcome:** done locally. All seven Lows are fixed (none accepted: L-7's CLI check passed). Nothing contacted a
hosted service; no workflow was dispatched; no `db push`, no `--linked`; the primary stack was never reset (04-01 is
wave 1's resetter). Every fix has a test that fails without it: the "before" runs execute the 04-00 specs against the
pre-plan code (`118b3ae`, a throwaway git worktree) and are tool output in `evidence/04-00/`.
Sources: `03-platform-hygiene/reviews/v203-review-adversarial-env-staging.md` §Low (A), `03-13-REVIEW-TRIAGE.md`
(owner "V2-04 (04-00)"), plan `04-PLAN.md` §04-00.

## Low → commit → test

| ID | Finding (A) | Commit | Test that fails without the fix | Before (evidence) |
|---|---|---|---|---|
| **L-1** | whitespace-only env values count as present | `a1e5202` | `tests/config/env-schema.spec.ts` "blank and padded secrets": `CRON_SECRET` of 32 spaces and `SUPABASE_SECRET_KEY` / `MSG91_AUTH_KEY` / `MSG91_WEBHOOK_SECRET` = `" "` refused as missing; 7 secrets with a trailing newline / tab / space refused naming the key; the rule in the test tier; the name list | `before-a-vitest.txt`: all 13 L-1 cases failed (the values booted) |
| **L-2** | odd loopback forms and non-origin URLs pass in deploy tiers | `a1e5202` | `env-schema.spec.ts` "loopback forms and bare origins": `https://localhost./`, `https://0.0.0.0`, `https://[::ffff:127.0.0.1]`, `https://127.0.0.2`, `[::]`, `app.localhost.` refused; Supabase URL with userinfo / path / query / lone `?` / fragment refused (synthetic ref); bare origins pass; test/e2e/ci still accept `http://127.0.0.1:54321`; `isLoopbackHost` table | `before-a-vitest.txt`: 34 L-2 cases failed (refusals and the host table; only `https://127.1`, already folded to 127.0.0.1, was refused before) |
| **L-3** | the CLI's fixed opaque local keys are not "local-stack keys" | `a1e5202` | `tests/config/env-boot.spec.ts` (instrumentation `register()`): a staging and a production profile carrying the **live** local stack's opaque keys (read from `npx supabase status -o env` by the spec, never committed or printed) → refused "must not be a local-stack key", naming both keys and no value; `serverEnv()` refuses too; run-time-built prefixed keys boot; ci tier keeps working with the local keys | `before-a-vitest.txt`: the refusal case failed (the profile booted) |
| **L-5** | the dry run gates nothing (approval precedes the listing) | `bc8bbb1` | `tests/ci/staging-scripts.spec.ts` "migration-plan": two files ahead → both names + count, exit 0, summary holds names only; none ahead → `0 pending`; an applied version with no file → exit 1; out-of-order file → exit 1; URL/password never in psql argv or output, psql env = PATH + PG*; loopback / `?host=` refused before psql; psql failure → exit 2 redacted. `tests/ci/workflow-policy.spec.ts`: committed `staging.yml` has `plan` in `staging-readonly` and `migrate` `needs: plan`; removing `needs`, moving `plan` to `staging`, deleting `plan` → `staging-plan-before-migrate` | `before-a-vitest.txt`: staging-scripts fails at import (no `migration-plan.mjs`); 6 workflow-policy L-5 cases failed (+ the M-POLICY bypass fixture, deviation 4) |
| **L-6** | `wait-for-release` false-fails when a newer commit deployed | `bc8bbb1` | `staging-scripts.spec.ts` "wait-for-release": a descendant release (injected git answers "ancestor") + ready → exit 0 naming both SHAs; descendant with schema `behind` → exit 1; non-descendant → timeout exit 1, git asked once per release; equal SHA → exit 0 without git; a malformed release is never handed to git or echoed; `gitIsAncestor` on this repository's real history | `before-b-vitest.txt`: the 5 L-6 cases failed (descendant timed out) |
| **L-7** | DB passwords in argv of `npx supabase …` | `bc8bbb1` | `staging-scripts.spec.ts`: `target-guard --print-db-url --no-password` prints the URL without a password, `--print-pgpassword` prints only the decoded password, modes do not combine; `canonicalDbUrl({ password: false })`; schema-drift `diffArgs()` holds no password and the CLI spawn env carries `PGPASSWORD`. `workflow-policy.spec.ts`: `--print-db-url` without `--no-password` in `staging.yml` or `drift.yml` → `staging-db-url-no-password` (not in `ci.yml`) | `before-b-vitest.txt`: the 3 L-7 cases failed (password in argv); `before-a-vitest.txt`: 2 policy cases failed |
| **L-8** | the test-lane guard misses staging names and opaque hosted keys | `3576a1d` | `tests/setup/test-env-guard.spec.ts`: `STAGING_SECRET_KEY`, `STAGING_SEED_PASSWORD`, `STAGING_PUBLISHABLE_KEY`, `STAGING_DB_URL_RO`, any later `STAGING_*` → refused naming the variable, value not echoed; run-time-built `sb_secret_…` / `sb_publishable_…` (and upper case) in an unrelated variable → refused as hosted; blank `STAGING_*` and `MY_STAGING_NOTE` pass | `before-a-vitest.txt`: the 8 refusal cases failed |

**L-7 local CLI check (plan step 7).** `evidence/04-00/l7-cli-pgpassword.txt`: with the pinned CLI 2.120.0 against the
**local** stack only, `PGPASSWORD=<local password> npx supabase db diff --db-url postgresql://postgres@127.0.0.1:54322/postgres
--schema public` exits 0 ("No schema changes found"); the same with a wrong random `PGPASSWORD` exits 1 with
`password authentication failed` (so the value really comes from the environment, including the migra step); the
read-only `migration list --db-url` (the history connection `db push` uses) exits 0 with the password-free URL and 1
with the wrong password (SQLSTATE 28P01). So the fix stands and L-7 is **closed, not accepted**. Agents never run
`db push`; the hosted `db push` path is proved on the first post-merge `staging.yml` run.

## What changed

- **`lib/env.ts`** (isomorphic): `present()` trims; `normalise()` drops blank-after-trim values and keeps every other
  value as given; `SECRET_ENV_NAMES` (`isSecretEnvName`: `*_SECRET`, `*_KEY`, `*_TOKEN`, `*_PASSWORD`, never
  `NEXT_PUBLIC_*`) refused with surrounding whitespace in every tier ("must not have leading or trailing whitespace").
  `isLoopbackHost` on the WHATWG-canonical host: IPv4 127/8 and 0.0.0.0, IPv6 `::1`, `::`, `::ffff:7f00:0/104`,
  `::ffff:0:0`, `localhost`, `localhost.`, `*.localhost`, `*.localhost.` (no `node:` import; `lib/webhooks/ssrf.ts` not
  imported). Deploy tiers: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_APP_URL` must be bare https origins
  (`isBareOrigin`: no userinfo, path other than `/`, query or fragment, lone `?`/`#` included). No env name added or
  renamed; `ENV_DOCS` unchanged (`node scripts/ci/env-example.mjs --check` passes).
- **`lib/env-server.ts`**: `LOCAL_STACK_OPAQUE_DIGESTS` (two SHA-256 hex constants of the CLI 2.120.0 local opaque
  keys, computed by piping `npx supabase status -o env` into `shasum -a 256`; no key literal), `localStackKeyIssues`,
  `parseServerEnv` (= `parseEnv` + the digest check, deploy tiers only), `assertServerEnv`. `serverEnv()` uses
  `parseServerEnv`. **`instrumentation.ts`** `register()` calls `assertServerEnv` (deviation 1).
- **`tests/setup/test-env.ts`**: `FORBIDDEN_VAR_PREFIXES = ["STAGING_"]`; `HOSTED_MARKERS` gains `sb_secret_` and
  `sb_publishable_` (assembled at run time).
- **`scripts/staging/migration-plan.mjs`** (new): target guard on `STAGING_DB_URL_RO`; `psql -qAt` (`begin read only`,
  `select version from supabase_migrations.schema_migrations`, `rollback`) with PATH + `PG*` only; compares with
  `supabase/migrations/<digits>_*.sql`; pending names + count to stdout and `GITHUB_STEP_SUMMARY`; exit 0 / 1 (drift) /
  2 (refused or unreadable).
- **`scripts/staging/wait-for-release.mjs`**: `gitIsAncestor` (40-hex only, argv array, no shell) and an injectable
  `isAncestor`; a descendant release passes step 1; readiness unchanged; the timeout line never echoes a malformed
  release.
- **`scripts/staging/target-guard.mjs`**: `--print-db-url --no-password`, `--print-pgpassword`,
  `canonicalDbUrl(url, { password })`; unknown flags and combined modes are usage errors (exit 2).
  **`scripts/staging/schema-drift.mjs`**: the CLI gets the password-free URL and `PGPASSWORD` in its env.
- **`.github/workflows/staging.yml`**: new job `plan` (Environment `staging-readonly`, checkout without credentials,
  target guard `--mask`, `migration-plan.mjs`); `migrate` `needs: plan`, checkout `fetch-depth: 0`, dry-run and apply
  export `PGPASSWORD` from `--print-pgpassword` and pass the `--no-password` URL. `drift.yml` unchanged (the script
  carries the change). actionlint 1.7.7 and zizmor 1.32.0 (offline): no findings (`workflows-actionlint-zizmor.txt`).
- **`scripts/ci/workflow-policy.mjs`**: rules `staging-plan-before-migrate` and `staging-db-url-no-password`.
- **`docs/runbooks/staging.md`**: §3 the 04-P16 grant SQL; §6 "Plan first" with its exit table, the password-free CLI
  URL, the descendant-release rule; §12 a `plan` row.

## Deviations

1. **`instrumentation.ts` edited** (not in the 04-00 file list; no wave-1 plan owns it). The plan puts the L-3 check
   "on the server parse path (`lib/env-server.ts`, … the same function the boot check in `instrumentation.ts` runs)";
   that requires `register()` to call the `lib/env-server` function. `next.config.ts` is unchanged: it loads outside
   Next's bundler, where `import "server-only"` would throw, so the build-time check stays schema-only and the digest
   check runs at every server instance's boot (which refuses to serve, review A I-2) and on every `serverEnv()`.
   `npm run e2e:build` + `e2e:pr` prove Next bundles `register()` with the `server-only` import (see Verification).
2. **`migration-plan.mjs` also exits 1 for an out-of-order pending file** (older than the newest applied version).
   Not in the plan's list, but `db push` without `--include-all` refuses exactly that case, so a plan that exits 0
   would show a list `migrate` then fails on; failing at `plan` keeps the approval meaningful.
3. **`target-guard.mjs` now refuses unknown flags** (exit 2) instead of ignoring them, so a typo such as
   `--no-pasword` cannot silently print a URL with its password.
4. **The 03-13b M-POLICY bypass fixture now also names `staging-plan-before-migrate`** (its `migrate` job has no
   `plan`): expected list in `workflow-policy.spec.ts` updated.

## Residuals (not blocking)

- **L-6:** a release that deployed *after* the `migrate` job's checkout is not in the clone, so it is treated as "not
  a descendant" and the run times out as before (safe failure). The case the review describes (a commit landing while
  the run waits for approval, i.e. before the job starts) is covered by `fetch-depth: 0`. Fetching later commits would
  need credentials in the job (the checkout persists none, by policy).
- **L-5 staging half:** the first real `plan` output is verified post-merge after PO action **04-P16**; until the grant
  exists `plan` exits 2 and `migrate` does not start (fail-closed).
- **L-3:** the digests track the CLI pin; a CLI upgrade that changes the local defaults fails `env-boot.spec.ts` until
  they are recomputed in the same commit.

## Verification (tool output in `evidence/04-00/`)

| Check | Result | Evidence |
|---|---|---|
| The 04-00 specs on the pre-plan code (`118b3ae` worktree) | run (a): env-schema 47 failed, env-boot 1, test-env-guard 8, workflow-policy 9, staging-scripts fails at import; run (b) (+ only `migration-plan.mjs`): staging-scripts 8 failed (L-6, L-7) | `before-a-vitest.txt`, `before-b-vitest.txt` (fixture password redacted) |
| Full Vitest lane after (`npx vitest run`, shared stack) | 3581 passed, **1 failed, not 04-00's**: `tests/api/readiness-probe-db.spec.ts` "EXPECTED_MIGRATION is the newest migration file" (expected `000032`, got `000031`) because 04-05a's uncommitted `supabase/migrations/000032_ops_backup_runs.sql` is in the shared tree while 04-01's committed bump is `000031` (R-45, reconciled at the wave-1 merge). All five 04-00 spec files pass (env-schema 228, env-boot 12, test-env-guard 76, staging-scripts 67, workflow-policy 41) | `after-full-vitest.txt` |
| `npm run e2e:build` + `npm run e2e:pr` (env boot changed) | build exit 0, output scan clean; 188 passed, 7 skipped (the lane's standing skips), 0 failed, 0 retried | `after-e2e.txt` |
| L-7 CLI check (local stack only) | password-free `--db-url` + `PGPASSWORD`: `db diff` 0, `migration list` 0; wrong `PGPASSWORD`: both 1 (28P01) | `l7-cli-pgpassword.txt` |
| actionlint 1.7.7, zizmor 1.32.0 (offline), workflow-policy | no findings; PASS | `workflows-actionlint-zizmor.txt` |
| `npm run typecheck` | exit 0 | run before each commit |
| `npx eslint .` | 0 errors in 04-00 files; the 9 errors in the tree are in 04-05a's uncommitted `ops/restore-drill/*.ts` (its lint zone is pending) | run at `bc8bbb1` |
| `npm run inventory` | exit 0, 0 flagged | run at `bc8bbb1` |
| `node scripts/ci/env-example.mjs --check` | `.env.example` matches `lib/env.ts` (no env name added) | run at `bc8bbb1` |
| gitleaks v8.30.1 (`git --redact`, after committing) | two `generic-api-key` false positives on the run-time-joined synthetic markers of the L-8 spec (`3576a1d`, lines 126 and 128) → exact-fingerprint lines with a reason in `.gitleaksignore` (no quote of the string); rescan "no leaks found" | `.gitleaksignore` |

Not done by 04-00 (orchestrator): STATE.md / ROADMAP.md updates (shared files in a parallel wave); PO actions 04-P14
(confirm R-47) and 04-P16 (the grant); the post-merge first `plan` output on staging.
