---
phase: 04
plan: 04-05a
subsystem: ops/backup (FT-02 local half)
status: complete
requirements: [FT-02]
plan_head_before: d6777f445a81256490f9efcd0c2f5d70c0da5fa5
commits: [f5463ab, 9582da8, b956b09, 4ce7806]
---

# 04-05a record: backup and restore drill as code (R2 for staging)

**Outcome:** done locally. An age-encrypted backup of the local stack (dump + Storage objects + manifest) is uploaded
to the local Storage S3 endpoint (stand-in for the R2 bucket), restored into a second local stack (`clinicos-drill`,
ports 553xx) and passes the drill checks with RPO 16 s and RTO 32 s (`evidence/restore-drill-selftest.json`, tool
output at `4ce7806`). Nothing contacted AWS, R2, GitHub settings or a hosted Supabase project; no workflow was
dispatched; no real key was generated outside a temp dir (throwaway keys, deleted).

**PO decision 2026-11-13 (orchestrator, mid-plan):** staging backups go to **Cloudflare R2** from a GitHub Actions
workflow in Environment `staging`; AWS Mumbai is decided at go-live. The AWS CloudFormation design that was already
written (and passed `cfn-lint 1.59.0`, 42,849 bytes) moved to `docs/ops/backup-aws-golive.md`, not wired into CI.
Secret names are exactly `environment.txt.example` §E (`BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`,
`BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_AGE_RECIPIENTS`); added: `STAGING_STORAGE_S3_KEY_ID`,
`STAGING_STORAGE_S3_SECRET` (secrets) and `STAGING_STORAGE_S3_REGION` (variable) for the source Storage sync, written
into §E.

## What shipped

| Commit | Content |
|---|---|
| `f5463ab` | migration `000032_ops_backup_runs.sql` (`ops.backup_runs`, `ops.backup_runner_stale()`), `EXPECTED_MIGRATION = "000032"`, `scripts/drift/schema-snapshot.txt` regenerated after `db reset --local` (types unchanged, ops only), `tests/ops/backup-runs-db.spec.ts` |
| `9582da8` | `ops/bin/{pins.env,install-age.sh,aws-docker.sh,psql-docker.sh}`, `ops/backup/{backup.sh,evidence.ts}`, `ops/restore-drill/{supabase/config.toml,run.sh,compare-manifest.ts,check-evidence.ts}`, `supabase/tests/restore_drill_checks.sql`, ESLint `ops/**` tooling zone (+ lint-gate cases), `tests/helpers/sql.ts` `psqlFile`, `tests/ops/*` |
| `b956b09` | `.github/workflows/backup.yml` (Staging backup), `backup-alert.yml` (failure issue), `nightly.yml` job `backup-roundtrip`, `ci.yml` test job installs pinned age + images, `scripts/ci/pick-nightly-issue.mjs --title`, `environment.txt.example` §E, `.gitignore` |
| `4ce7806` | `docs/runbooks/backup-restore.md`, pointer pages `docs/ops/backup-restore.md` + `docs/operations/backups.md` (PITR/WAL/paid-plan claims removed), `docs/ops/backup-aws-golive.md` |

## Tests that fail without the change

| Spec | Proves |
|---|---|
| `tests/ops/backup-roundtrip-db.spec.ts` | real `backup.sh` run (local): archive starts with the age header, holds no plaintext SQL or object bytes, an unrelated key cannot open it, both recipient keys can; manifest counts = live DB; one `ok` row (counts only); a failed step (wrong Storage secret) exits ≠ 0, writes `failed`/`storage_failed`, uploads nothing |
| `tests/ops/backup-script-guards.spec.ts` | `local` + non-loopback `DB_URL` → 2 naming it; `staging` + loopback (4 forms) → 2; one/duplicate/private-key recipients → 2; R2 endpoint http/loopback/= source Storage → 2; `FORCE_FAIL=1` → 64 with no docker/npx/aws/psql/age call; no password, S3 or R2 secret, or URL ever printed |
| `tests/ops/restore-drill-checks-db.spec.ts` | drill checks pass on the primary stack with live manifest values (10 ok, nothing persists); RLS off on `patients` → fails naming `patients` (and the isolation probe fails); a seeded `cron.job` row → fails; wrong counts → fail |
| `tests/ops/manifest-compare.spec.ts` | equal → pass; a table's count differs or is missing → fail naming the table; object size/SHA-256 mismatch → fail naming the bucket (never the object); restored row without a file → fail |
| `tests/ops/backup-evidence.spec.ts` | listing verdicts: `twice_daily_ok` (missing 14:00, out-of-window, zero-size → false), `retention_ok` (> 31 days → false), `keys_ok`, `failed_run_alerted` (failed drill run + later successful alert run); `--check` refuses extra keys and tampered verdicts |
| `tests/ops/backup-runs-db.spec.ts` | `ops.backup_runs` closed to anon/authenticated/service_role; constraint names for missing key/code, free-text error, non-timestamp key; `backup_runner_stale()` false without Vault URL, true with no ok pass in 15 min, false with a recent ok pass; no API role may execute it |
| `tests/ops/drill-evidence-and-workflows.spec.ts` | `check-evidence.ts`: RPO > 12 h / RTO > 4 h fail, red/missing checks fail, names or free text refused; `backup.yml` passes the policy as a staging workflow and each staging rule bites on a bypass; `backup-alert.yml` and `nightly.yml` pass |
| `tests/ci/ci-scripts.spec.ts` (+1) | `pick-nightly-issue --title` picks only the bot's own "Staging backup failing" issue |
| `tests/security/p1-34-lint-gates.spec.ts` (+3) | `ops/x.ts` may read `process.env`/console; `lib/x.ts` still fails |

Scripted drill (roadmap "the scripted restore drill"): `ops/restore-drill/run.sh --self-test` →
`evidence/restore-drill-selftest.json` (decrypt, wrong key refused, restore, history, objects verified, manifest
compare, 10 pgTAP checks, break-glass decrypt, failed run recorded: all true; 82 tables, 1 synthetic object, drill
stack stopped with `--no-backup`). Run log: `evidence/04-05a/selftest-run.txt`.

## Evidence (tool output)

| Check | Result | File |
|---|---|---|
| Full Vitest lane (shared stack) | 175 files, 3686 passed, 0 failed, 0 skipped | `evidence/04-05a/full-vitest.txt` |
| `npm run typecheck` · `npx eslint .` · `npm run inventory` | pass · 0 errors (422 warnings, pre-existing) · exit 0 | (run before commit) |
| `node scripts/ci/workflow-policy.mjs` | PASS (6 workflows, no policy change needed) | — |
| `npm run db:drift:local` | PASS (only the documented pg_net allowlist line) | — |
| Restore drill self-test at `4ce7806` | pass, RPO 16 s, RTO 32 s | `evidence/restore-drill-selftest.json` |
| Pins (age SHA-256 vs publisher digests; image digests vs registry; CLI = package.json) | all match | `evidence/pins.json` |
| gitleaks v8.30.1 after committing | no leaks found (589 commits) | — |

## Deviations

1. **[PO decision] R2 instead of AWS for staging** (orchestrator, 2026-11-13): EventBridge + CodeBuild + SNS replaced by
   `backup.yml` (Environment `staging`) + `backup-alert.yml` (issue → email); the OIDC evidence workflow is replaced by a
   names-and-sizes listing artifact produced by the backup run itself (the R2 token can list); `render.ts`,
   `stack.template.ts`, `stack.json`, the stack policy and render specs and the CI `render --check` step were removed;
   the design lives in `docs/ops/backup-aws-golive.md`. R2 has no object versioning and no `ap-south-1`; the bucket
   lifecycle (30 days) is a PO console setting verified indirectly by `retention_ok`.
2. **[Rule 2] Storage policies travel with the backup.** The CLI's schema dump excludes the `storage` schema, so the 7
   `storage.objects` policies from 000008/000013 would be lost on a restore; `backup.sh` writes them to
   `storage_policies.sql` from `pg_policies` and the drill restores them (policy count includes `storage`).
3. **[Rule 1] Restore fixes found by the self-test:** the drill stack also runs realtime (it creates
   `supabase_realtime_admin`, which `roles.sql` grants to); `run.sh` skips parameter grants to Supabase-managed roles in
   `roles.sql` (platform state, superuser-only). `backup.sh`'s bucket loop feeds `/dev/null` to the containerised CLI
   (it swallowed the rest of the bucket list).
4. **[Rule 2] Extra specs:** `backup-roundtrip-db.spec.ts` (real encrypt/decrypt and failed-run row), `backup-runs-db`,
   `drill-evidence-and-workflows`. The CI test job now installs the pinned age release and pulls the two pinned images
   before the lane (Docker Hub pull inside CI, like the stack images).
5. Hosted dump uses the target-guard password-free URL + `PGPASSWORD` (04-00 L-7 proved the CLI honours it); psql in
   the pinned image gets `PGPASSWORD`/`PGSSLMODE` by name.

## Open points for the orchestrator / PO

- **Environment `staging` has a required reviewer**, so each scheduled backup waits for approval (twice a day). Either
  the PO approves each run, or the backup secrets (+ a copy of `STAGING_DB_URL` and the project ref) go into a separate
  Environment without a reviewer (e.g. `staging-backup`, feature/v2 only) and `backup.yml` names it (one line; the
  policy treats any `staging*` Environment the same). Not changed here: the brief said Environment `staging`.
- R2 token holds Object Write, so whoever holds it could delete backups (no versioning). Option: an R2 bucket lock
  (retention rule) on `staging/`, which may conflict with the 30-day lifecycle; residual for review C.
- `backup-alert.yml` (workflow_run) and the schedules fire only once the default branch is `feature/v2` (RL-3).
- Review C (backups/IaC/keys/drill) scope now: `backup.sh`, `run.sh`, the two workflows, the R2 token scope.

## PO steps for R2 (for PO-ACTIONS; runbook §2)

1. age: two key pairs (`age-keygen`), primary → password manager, break-glass → sealed offline; only the two `age1…`
   lines are shared (04-P3).
2. Cloudflare → R2 → create bucket `clinicos-staging-backups` (location hint Asia-Pacific, no public access).
3. Bucket → Settings → Object lifecycle rules → delete objects 30 days after upload.
4. R2 → Manage API tokens → `clinicos-staging-backup`, **Object Read & Write**, scoped to that bucket only; note access
   key id, secret, endpoint `https://<account-id>.r2.cloudflarestorage.com`.
5. Supabase staging → Storage → S3 Connection → enable, create an access key, note the region.
6. GitHub → Environment `staging` → secrets `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`,
   `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_AGE_RECIPIENTS` (space separated), `STAGING_STORAGE_S3_KEY_ID`,
   `STAGING_STORAGE_S3_SECRET`; variable `STAGING_STORAGE_S3_REGION` (decide the reviewer question above first).
7. Watch the repository's Issues with the ops inbox (alert email).
8. After merge + 2 days: Run workflow "Staging backup" with `force_fail` (04-P11); then the first restore drill on the
   PO's machine (04-P13, runbook §7).

Claude verifies (read-only): `gh run list --workflow backup.yml`, `gh run download <id> -n backup-evidence`,
`npx tsx ops/backup/evidence.ts --check <file>`; after 04-P11 with `--runs`/`--alert-runs`; after 04-P13
`npx tsx ops/restore-drill/check-evidence.ts <file>`.

## Known stubs

None. Staging-only acceptance (twice-daily objects in R2, failed-run alert, staging restore drill) is pending PO,
post-merge (R-19 pattern).
