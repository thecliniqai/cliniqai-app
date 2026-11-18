# V2-04 adversarial review, group C: ops (backups, alerts, heartbeat/quota, ops report, staging workflows, 04-00 carry-over)

- Reviewer: isolated Claude reviewer (fresh context, hostile stance); implementer records not read before the findings.
- Scope: `git diff origin/feature/v2...0dc606b` for `ops/**`, migrations 000032, 000039, 000040, `.github/workflows/{backup,
  backup-alert,ops-report,staging,drift,ci,nightly}.yml`, `scripts/ci/workflow-policy.mjs`, `scripts/staging/**`,
  `scripts/ops/ops-report.mjs`, `lib/env.ts`, `lib/env-server.ts`, `tests/setup/test-env.ts`, runbooks
  `backup-restore.md`, `jobs.md` §13, `staging.md`, `lib/jobs/internal/handlers/alert-notify.ts`.
- Requirements read: CLAUDE.md; `04-PLAN.md` (revision, 04-00, 04-05a, rulings R-46…R-51, T-04-26); V2-03 review A L-1…L-8.
- Method: code reading; `workflow-policy.mjs` run against crafted fixtures (scratchpad only); probes on the **local** stack
  inside `BEGIN … ROLLBACK` (no reset, nothing committed); `isLoopbackUrl`/`isBareOrigin` fed odd URL forms; actionlint
  1.7.12 and zizmor 1.32.0 via Docker. Nothing hosted was contacted, no workflow dispatched, no code changed.

## Summary

| Id | Severity | Title |
|----|----------|-------|
| M-1 | Medium | `workflow-policy.mjs` can be bypassed: a workflow on `feature/v2` can reach the reviewer-free `staging-backup` secrets (the `postgres` staging URL, R2 token) from a `workflow_run` trigger |
| M-2 | Medium | Backup archives are not authenticated: a restore runs whatever SQL the newest object in R2 holds, and the R2 token that can replace it sits in the reviewer-free Environment |
| L-1 | Low | The alert cooldown applies per episode, not per rule: a flapping condition (one a tenant can cause) bypasses it. Proved locally |
| L-2 | Low | `backup-alert.yml` matches the triggering workflow by **name** and branch only, so other runs can fake (or flood) the backup alert |
| L-3 | Low | The `feature/v2` job guard depends on `==`, which GitHub compares case-insensitively |
| L-4 | Low | R-51 retries a notification that cannot be delivered (`alert_channel_unconfigured`) every 15 minutes, with no end |
| L-5 | Low | The R2 token can read, overwrite and delete, but the job needs only put and list. A cheap R2-side lock is not used |
| I-1…I-7 | Info | Quota sum overflow and no "snapshot stale" rule; gaps in the ops-report guard; L-1/L-2 edge forms; `db dump` + `PGPASSWORD` path not proven; restore error lines; L-7 residual |

What held up (checked, no finding): the `ops.report_all` grant model (a throwaway role given exactly the runbook's 04-P10
grants can execute `report_all` and nothing else in `ops`, and select from no `ops` table); no `ops`/`private` function or
table is granted to PUBLIC; `report_all` returns counts, kinds, rule names, codes and timestamps only (no tenant or
alert `details`); alert email rendering prints only numbers, booleans, UUIDs, ISO timestamps and the four quota level
words; `backup.sh` validation, `umask 077`, trap cleanup, URL redaction, values passed by name into Docker; `install-age.sh`
SHA-256 pin; the restore drill's repo-path refusal and `--no-backup` teardown; the retention newest-row guards (heartbeat,
quota snapshot, ok runner run, backup run per environment); `quota_level` exact numeric math (no rounding, no overflow
for realistic inputs); `migration-plan.mjs` (no URL in argv, read-only transaction, file names only); 04-00 L-1/L-2/L-3/
L-5/L-6/L-7/L-8 closed as specified (residuals in I-4, I-5, I-7). actionlint: only SC2016 info (intentional single quotes);
zizmor: one `dangerous-triggers` on `backup-alert.yml` (see L-2).

---

## M-1 · Medium · `workflow-policy.mjs` can be bypassed to reach the `staging-backup` secrets

**Where:** `scripts/ci/workflow-policy.mjs:79` (`STAGING_SECRET` matches only literal `secrets.NAME` / `secrets['NAME']`),
`:397` (the environment name is the raw scalar, often an unexpanded `${{ … }}`), `:400-401` (`isStaging` = file name,
literal STAGING secret or an environment scalar containing "staging"), `:421` and `:430` (exact, case-sensitive name
comparisons). The accepted risk in `docs/runbooks/backup-restore.md:141-144` and R-48 depend on this rule ("limited to
`feature/v2` and to `backup.yml` by the workflow policy").

**Exploit:** each of these fixtures **passes** the policy (exit 0):

1. `environment: ${{ vars.BK_ENV }}` (or `${{ matrix.e }}` with `e: [staging-backup]`), `on: workflow_run`, no job `if:`,
   a step `env:` with `${{ secrets[matrix.n] }}` (`n: [STAGING_BACKUP_DB_URL]`) or
   `${{ secrets[format('{0}_{1}', 'STAGING', 'SECRET_KEY')] }}`. The environment scalar does not contain "staging" and
   no literal `secrets.<…STAGING…>` appears, so `isStaging` is false. That turns off `staging-no-pr-trigger`,
   `staging-read-only-token`, `staging-secret-step-scope`, `staging-feature-v2-only` and
   `staging-backup-environment-scope`.
2. `environment: Staging-Backup` (GitHub Environment names are case-insensitive) with `secrets.BACKUP_S3_SECRET_ACCESS_KEY`
   in any workflow other than `backup.yml`. This passes `staging-backup-environment-scope`. Likewise
   `environment: STAGING-READONLY` with `secrets.STAGING_DB_URL` passes `staging-readonly-secrets-ro`.

A `workflow_run` (or `schedule`) run executes with `GITHUB_REF` = the default branch, so the Environment's own
"`feature/v2` only" rule is satisfied. The Environment has no reviewer, so nothing stops the job. Case 1 gives a job that
any fork PR's CI run can trigger the `postgres` staging pooler URL and the R2 read/write token. If that job also checks
out or downloads PR artefacts (the classic pwn-request pattern), it runs attacker code next to those secrets. The
precondition is that such a workflow gets merged into `feature/v2`, which is exactly the review miss this policy exists
to catch.

**Fix:**
- Fail closed on dynamic forms: refuse `secrets[` followed by anything other than a quoted literal, and refuse any
  `environment:` (scalar or `name:`) that contains `${{`.
- Compare Environment names case-insensitively (`toLowerCase()`) in the scope, read-only and `ops-report-read-only`
  rules.
- Treat every job with an `environment:` as staging for the trigger rule. Better still, require that every Environment
  name used is in an allowlist keyed by file: `backup.yml` → `staging-backup`; `staging.yml`/`drift.yml`/`ops-report.yml`
  → `staging`/`staging-readonly`.
- Also refuse `workflow_run` anywhere a job has an environment.
- Add each fixture above as a failing case in `tests/ci/workflow-policy.spec.ts`.
- Optionally, in GitHub, restrict `staging-backup` with a custom deployment protection rule or a
  `job_workflow_ref`-pinned OIDC claim. Environment branch rules alone cannot tell workflows apart.

## M-2 · Medium · Backup archives are not authenticated; a restore runs their SQL as `postgres`

**Where:**
- `ops/backup/backup.sh:377` (the archive SHA-256 is only logged) and `:207-209` (`ops.backup_runs` stores the key and
  the byte count, no digest); `supabase/migrations/000032_ops_backup_runs.sql:15-35` (no digest column).
- `ops/restore-drill/run.sh:131` (`age -d | tar -xf`) and `:157-160` (`psql -f roles.restore.sql -f schema.sql -f
  storage_policies.sql … -f data.sql`).
- `docs/runbooks/backup-restore.md` §8 step 2 (a real restore runs the same files against the new project).

**Exploit:** age gives confidentiality only. Anyone holding the two recipients (public keys, stored next to the R2 token
in `BACKUP_AGE_RECIPIENTS`) and R2 write access can build a valid `.tar.age` whose `roles.sql`/`schema.sql` contain
arbitrary SQL, such as a backdoor login role, `ALTER ROLE … SUPERUSER` where allowed, or definer functions. It can also
contain psql meta-commands (`\! …`, `\copy … to`), which run in the `psql` container with `$WORK` mounted. They can
upload it with a newer timestamped key, or overwrite an existing key, since R2 has no versioning (R-48). The R2 token
is in the reviewer-free `staging-backup` Environment, and M-1 shows how other workflows can reach it.

Nothing in the drill or the runbook checks the archive against an independent record. The drill's manifest checks
compare the archive with itself, and `check-evidence.ts` validates the drill's output, not the input. A drill, or a real
restore under pressure, would run the attacker's SQL as `postgres` on the restore target. Today that is synthetic
staging; at go-live the same tooling restores production. The dump is also the only source for the role definitions.

**Fix:**
- Add `archive_sha256 text check (archive_sha256 ~ '^[0-9a-f]{64}$')` to `ops.backup_runs` (new migration), written by
  `backup.sh`.
- Also put the digest in the `backup.yml` job summary and the `backup-evidence` artifact. GitHub is a channel the R2
  token cannot write.
- Make `run.sh` require `--expect-sha256 <hex>` for `archive` and `decrypt-only` modes and refuse a mismatch before
  `age -d`. The runbook step 1 (§7/§8) should read the digest from the run's summary or artifact, not from the bucket.
- Run restores with `psql -X` and refuse an archive whose SQL files contain a line starting with `\` other than the
  `\.` COPY terminator (`grep -nE '^\\\\[^.]'`) before executing them.
- Longer term, sign the manifest and archive digest with a key held outside GitHub, such as minisign/age-plugin or an
  SSH signature.

## L-1 · Low · The alert cooldown is per episode, so a flapping rule bypasses it (proved)

**Where:** `supabase/migrations/000039_ops_alerts.sql:490-494` (a new row → `v_new := true`), `:499-506` (resolve after 2
clean evaluations), `:512-519` (a new alert is notified immediately, with no per-rule cooldown).

**Exploit (local, rolled back):**
1. Enable only `dead_letter` and insert one dead `drill.probe` job, then evaluate. The alert opens and notification
   job 1 is queued.
2. Delete the row and evaluate twice. The alert resolves.
3. Insert the row again and evaluate. A **second** alert opens and a second `alert.notify` job is queued, inside the
   60-minute cooldown. Result: `alerts|2|1`, `notify_jobs|2`.

In real time the minimum cycle is the rule window plus about 10 minutes (about 25-30 minutes for `dead_letter`). That
is 2-3 emails per hour per flapping rule. A tenant owner can drive `dead_letter` by pointing a webhook at an endpoint
that fails intermittently (`webhook_delivery_queue.status = 'failed'`). `error_burst` and `lease_expiry` flap the same way.

Alert email shares `EMAIL_PROVIDER` with the auth Send Email hook. Resend's free tier is 100 emails a day, so alert
volume can starve auth email (sign-in OTP, resets) for **every** tenant. Severity depends on the provider plan; on the
free tier it is an availability issue across tenants.

**Fix:**
- Apply the cooldown per rule: before opening a new alert, look up the rule's most recent `notified_at` across episodes
  (an index on `(rule, notified_at)`), and do not notify a re-opened alert inside the cooldown. Notify it at the next
  evaluation after the cooldown if it is still open.
- Add a hard daily cap on `alert.notify` sends (for example 20 a day per environment) with a final "alerts suppressed"
  notice.
- Consider a separate sending domain or API key for ops mail so auth email has its own quota.
- Add a flapping spec next to the cooldown spec.

## L-2 · Low · `backup-alert.yml` trusts any run named "Staging backup"

**Where:** `.github/workflows/backup-alert.yml:13-14` (`workflows: [Staging backup]`) and `:23` (filters
`head_branch == 'feature/v2'` and `event != 'pull_request'`).

**Exploit:** `workflow_run` matches workflows by `name:`. A fork PR can add a workflow with `name: Staging backup` that
fails on purpose under `pull_request_review` or `pull_request_review_comment`. Those events run the PR's workflow
definition, and their `event` is not `pull_request`. If the fork's branch is named `feature/v2`, `head_branch` matches.
When a maintainer reviews the PR, the bot comments a fake "Staging backup failing" with a run URL that points at the
fork's run. Repeated, this trains the PO to ignore the real alert. zizmor flags the trigger (`dangerous-triggers`, high).

**Fix:** also require `github.event.workflow_run.path == '.github/workflows/backup.yml'`,
`github.event.workflow_run.head_repository.full_name == github.repository` and
`contains(fromJSON('["schedule","workflow_dispatch"]'), github.event.workflow_run.event)`. Add a policy rule that pins
these three conditions for any `workflow_run` workflow.

## L-3 · Low · The `feature/v2` guard is a case-insensitive comparison

**Where:** `scripts/ci/workflow-policy.mjs:96` (`FEATURE_V2_GUARD`); every staging job's `if:`, for example
`.github/workflows/backup.yml:47`, `ops-report.yml:36` and `staging.yml` `plan`/`migrate`.

**Exploit:** GitHub expressions compare strings case-insensitively, so
`github.ref == 'refs/heads/feature/v2'` is also true for a separately created branch `Feature/V2` or `FEATURE/v2`. Git
refs are case-sensitive. Anyone with push access can create that branch and dispatch `backup.yml` from it. Only the
Environments' deployment-branch rules remain (their pattern matching is case-sensitive as far as is documented). The
policy rule that is supposed to be the in-repo half of this control does not do what its doc comment says.

**Fix:**
- Make the first step of each staging job `[ "$GITHUB_REF" = "refs/heads/feature/v2" ] || { echo "wrong ref" >&2; exit 1; }`
  (bash `=` is case-sensitive), and have the policy require that step.
- Add a repository ruleset that blocks creating branches matching `[Ff][Ee][Aa][Tt][Uu][Rr][Ee]/*` other than
  `feature/v2`.

## L-4 · Low · R-51 keeps retrying a notification that cannot be delivered

**Where:** `lib/jobs/internal/handlers/alert-notify.ts:218` (no `OPS_ALERT_EMAIL`, or `disabled` → dead
`alert_channel_unconfigured`); `supabase/migrations/000039_ops_alerts.sql:521-528` (retry every 15 minutes while
unsent, no limit and no reason check).

**Exploit / impact:** staging may run without `OPS_ALERT_EMAIL` (`lib/env.ts`, "optional elsewhere"). Each open alert
then produces about 96 dead `alert.notify` jobs a day, indefinitely (about 2,900 rows per alert at the 30-day dead
retention), and `notify_tries` grows without limit. This is not dangerous, but it is constant queue churn on the 500 MB
Free database, and the report's `dead_last_24h` gets noisy. It also hides real deaths by volume (they are excluded from
`dead_letter`, R-36).

**Fix:**
- Do not retry while the last try died with `alert_channel_unconfigured`. Record the reason, for example
  `notify_last_code`, or join `ops.jobs.last_error`.
- Or back off exponentially (15 min, 30 min, … capped at 24 h), and cap `notify_tries`. Above the cap, the report
  should show the alert as `unsent`.

## L-5 · Low · The R2 token has more privilege than the job needs, and the cheap lock is unused

**Where:** `docs/runbooks/backup-restore.md:32` ("Object Read & Write"), `:141-144` (R-48 accepts "can delete or
overwrite"); `ops/backup/backup.sh:21`.

**Impact:** the upload needs `PutObject` and the evidence step needs `ListBucket`. The token can also `GetObject`
(ciphertext only) and **delete or overwrite** every archive, so one leaked token (see M-1) erases RPO. R-48's premise
"no R2 versioning" is true, but R2 does offer bucket lock rules (retention-based object lock). A lock of 30 days, equal
to the lifecycle, would make delete and overwrite impossible for any token at no cost.

**Fix:** add a bucket lock rule (prefix `staging/`, 30 days) in runbook §2 step 2, and record it in the evidence
(`retention_ok`). If R2 permission groups allow it, use a separate list-only token for the evidence step. Re-state R-48
with the lock in place.

---

## Info

- **I-1 Quota.** `000040:204-205`: `sum(... ::bigint)` of per-object sizes is assigned to `BIGINT v_storage`. Sizes are
  limited to 18 digits each, but the sum can exceed bigint and abort `ops.quota_snapshot()`. Separately, no rule fires
  when the newest `quota_snapshots` row is older than about 26 h. A failing quota job (overflow, lock timeout, a removed
  cron row) leaves `quota_*` rules judging stale data, and `heartbeat_gap` does not cover it. Fix: `numeric` arithmetic
  plus a `least(…, 9223372036854775807)` clamp, and a `quota_snapshot_stale` rule.
- **I-2 Ops-report guard.** `scripts/ops/ops-report.mjs:59-70` checks table-level `INSERT/UPDATE/DELETE/TRUNCATE` only.
  Column-level `UPDATE`/`INSERT`, sequence `USAGE/UPDATE` (`setval`) and `EXECUTE` on writing definer functions are not
  checked. The read-only transaction still blocks all of them during the report, so this is a completeness gap in "a
  role able to write anything", not a bypass. Add `has_any_column_privilege(c.oid, 'INSERT, UPDATE')` and sequences
  (`relkind 'S'`, `UPDATE`).
- **I-3 Info disclosure (ruled).** `/api/ready` is unauthenticated and now reports `alertsCriticalOpen` and `runnerStale`
  (R-41, M-PROBE). Approved, but note it tells an outsider when ops is blind. Consider dropping `alertsCriticalOpen` from
  the public body.
- **I-4 L-1 residual.** `lib/env.ts:451` uses `String.prototype.trim()`, which does not strip U+200B (zero-width space),
  U+2060 or U+180E. A pasted `CRON_SECRET`, `MSG91_WEBHOOK_SECRET` or `ERROR_INGEST_KEY` with a trailing zero-width
  space boots. `JOBS_RUNNER_SECRET` is safe because its pattern is ASCII-only. Fix: also refuse
  `/[​-‍⁠﻿᠎]/` in secret names.
- **I-5 L-2 edge forms.** `https://[::127.0.0.1]` canonicalises to `[::7f00:1]` (IPv4-compatible, deprecated) and is not
  classed as loopback by `lib/env.ts:323`. Linux does not route it to loopback, so it cannot be exploited today. List it
  for completeness, or refuse every IPv6 literal in deploy-tier origins (they are hostnames in practice).
- **I-6 `db dump` + `PGPASSWORD` unproven.** `ops/backup/backup.sh:191` relies on the CLI's `db dump --db-url <no
  password>` taking `PGPASSWORD` (the L-7 evidence covers `db diff` only). I tried it on the local stack: it dumps with
  **and without** `PGPASSWORD` (local trust auth), so a local run cannot prove it, and the nightly self-test uses
  `--local`. The first scheduled staging run is the first real test. Also, hosted mode does not assert that `DB_URL`
  has no password (it relies on the workflow). Fix: in `staging`/`production` mode, refuse a `DB_URL` with a userinfo
  password, and document that the first scheduled run is the proof.
- **I-7 L-7 residual and error echo.** `backup.yml:71` and `staging.yml` still give the full secret URL to the step's
  environment, so it is inherited by every child process. It is not in argv: `/proc/<pid>/environ` is owner-only, and
  the runner is single-tenant. This is acceptable, but dropping `STAGING_*_DB_URL` from the step `env` after deriving
  `DB_URL`/`PGPASSWORD`, or deriving them in a prior step to `$GITHUB_ENV`-free files, would make the "never in argv"
  claim hold for the environment too. `ops/restore-drill/run.sh:160,163` print up to three `ERROR` lines of a failed
  restore. With `VERBOSITY=terse` these can still carry a value (for example `invalid input syntax for type uuid:
  "…"`). Harmless on synthetic staging; for a production restore, print the SQLSTATE only.

## Verdict

No Critical or High. **M-1** should be fixed before R-48's accepted risk is confirmed at the gate (04-P14), because that
acceptance names the policy as the control. **M-2** should be fixed before the first staging restore drill (04-P13)
uses a real archive. L-1…L-5 can be handled through V2-04 triage.
