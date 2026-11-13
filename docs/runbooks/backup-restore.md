# Runbook: backup and restore (FT-02)

V2-04 plan 04-05a (review fixes 04-07c); rulings R-3, R-4, R-10, R-11, R-29, R-31, R-41, R-48. PO decision
2026-11-13: staging backups go to **Cloudflare R2** through GitHub Actions; AWS `ap-south-1` is decided at go-live (design kept in
[`docs/ops/backup-aws-golive.md`](../ops/backup-aws-golive.md)). Synthetic staging data only; production backups are
V2-15.

## 1. What runs

| Piece | Where | What it does |
|---|---|---|
| `.github/workflows/backup.yml` ("Staging backup") | GitHub Actions, Environment `staging-backup` (no reviewer, R-48), `feature/v2` only | 02:00 and 14:00 IST: `ops/backup/backup.sh` with `BACKUP_ENV=staging`, then a names-and-sizes listing of `staging/` as the `backup-evidence` artifact |
| `ops/backup/backup.sh` | the workflow; locally with `BACKUP_ENV=local` | validates config (exit 2 on anything unsafe, naming the variable only) → `supabase db dump` (roles, schema, data with `cron.job`, `cron.job_run_details`, `net.*` queues and vector tables excluded, migration history) + `storage_policies.sql` (the CLI's schema dump skips the `storage` schema) → `aws s3 sync` of every Storage bucket → `manifest.json` (row counts from the dump, per-object size and SHA-256) → `tar` → `age` to every recipient → header check → upload `staging/<UTC yyyy-mm-ddTHHMMSSZ>.tar.age` → the archive's **SHA-256** in the job summary and the `backup-evidence` artifact (`archive-digest.json`, 04-07c) → `ops.backup_runs` row (counts and the digest) → dead-man check |
| `.github/workflows/backup-alert.yml` | GitHub Actions on `workflow_run` of "Staging backup" | any non-success run of this repository's `.github/workflows/backup.yml` on `feature/v2` from a schedule or a dispatch (04-07c: matched by path, repository and event, not by the copyable name; re-checked case-sensitively in the step) → opens or comments on the bot's **"Staging backup failing"** issue (GitHub emails watchers) |
| `ops.backup_runs` (migrations 000032, 000042) | staging and local DB | one row per run: `ok` with key/size/duration/counts and `archive_sha256` (000042), or `failed` with a machine code (`dump_failed`, `storage_failed`, `encrypt_failed`, `upload_failed`, …); read by 04-04's `backup_stale` alert and 04-06's report |
| `ops/restore-drill/run.sh` | the PO's machine (staging archive), nightly CI and locally (`--self-test`, synthetic) | archive SHA-256 = the digest the green GitHub `backup.yml` run recorded (`--expect-sha256`, else refused before decrypting) → decrypt → `sql-guard.ts` (no psql meta-command in any SQL file; writes the restore copies) → second local stack `clinicos-drill` (ports 553xx) → restore with psql in restricted mode (`ops/bin/psql-restricted.sh`: every meta-command refused, 04-07d) → verify → evidence JSON (counts, verdicts, RPO, RTO) → stack stopped with `--no-backup`, plaintext deleted |
| `nightly.yml` job `backup-roundtrip` | GitHub runner, local synthetic data | `run.sh --self-test`: backup → encrypt → local Storage S3 stand-in → restore into the drill stack → checks |

Pinned tools (`ops/bin/pins.env`, PO confirms in 04-P15): age v1.3.2 (SHA-256 per platform, `ops/bin/install-age.sh`),
`postgres:17.11` image (psql 17; host psql is 14), `amazon/aws-cli:2.39.3` image (every S3 call), Supabase CLI = the
repo pin. Encryption: age to two recipients (primary in the PO's password manager, break-glass sealed offline, R-3);
R2 additionally encrypts at rest. Names carry no tenant or patient data.

## 2. PO setup (once; values never in git, never in chat)

1. **age keys (04-P3).** Install age v1.3.2; `age-keygen -o clinicos-staging-primary.agekey` and
   `age-keygen -o clinicos-staging-breakglass.agekey`; store the primary in the password manager, the break-glass file
   sealed offline; delete the local files. Only the two public `age1…` lines go anywhere else.
2. **R2 bucket.** Cloudflare → R2 → Create bucket `clinicos-staging-backups` (location hint Asia-Pacific). Bucket →
   Settings → Object lifecycle rules → add: delete objects **30 days** after upload (whole bucket). Leave public access
   off (no r2.dev URL, no custom domain).
3. **R2 token.** R2 → Manage API tokens → Create: name `clinicos-staging-backup`, permission **Object Read & Write**,
   **only** bucket `clinicos-staging-backups`, no IP filter needed. Copy the access key id, the secret and the S3
   endpoint `https://<account-id>.r2.cloudflarestorage.com`.
4. **Supabase Storage S3 access (staging).** Supabase staging → Storage → S3 Connection: enable, create an access key;
   note the region shown.
5. **GitHub Environment `staging-backup`** (ruling R-48; repo → Settings → Environments → New environment): **no**
   required reviewer, deployment branches **`feature/v2` only**. Secrets: `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`
   (= `clinicos-staging-backups`), `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_AGE_RECIPIENTS`
   (the two `age1…` lines, space separated), `STAGING_STORAGE_S3_KEY_ID`, `STAGING_STORAGE_S3_SECRET`,
   `STAGING_BACKUP_DB_URL` (same value as `STAGING_DB_URL`: the session pooler URL for `postgres.<ref>`; a read-only
   role cannot run `supabase db dump`, which issues `SET ROLE postgres`, nor write the `ops.backup_runs` row).
   Variables: `STAGING_STORAGE_S3_REGION`, `SUPABASE_PROJECT_REF_STAGING` (Environment variables are per Environment).
   See `environment.txt.example` §E. `workflow-policy.mjs` refuses `staging-backup` in any workflow but `backup.yml`,
   in any spelling (Environment names are case-insensitive), and refuses a computed Environment name, a computed
   `secrets[…]` index and a `workflow_run`/PR trigger next to any Environment (04-07c, M-POLICY). Every staging job
   starts with a case-sensitive `feature/v2` ref check (GitHub's `==` ignores case).
6. **Why no reviewer (R-48).** Scheduled backups must not wait for a human. The job reads synthetic staging data and
   writes age-encrypted objects; migrations and seeds stay behind the reviewed `staging` Environment.
7. **Ops inbox (04-P7).** Watch the repository (or at least Issues) with the ops inbox account so the
   "Staging backup failing" issue reaches email.

Verify (Claude, read-only, after the merge): `gh run list --workflow backup.yml --limit 4 --json conclusion,createdAt,url`;
`gh run download <id> -n backup-evidence`; `npx tsx ops/backup/evidence.ts --check backup-evidence.json --require
keys_ok,retention_ok,twice_daily_ok` (two full IST days after the first scheduled runs).

## 3. Schedule and on-demand backups

Cron `30 20 * * *` and `30 8 * * *` UTC = 02:00 and 14:00 IST. Schedules run only from the default branch, so they
start once the default branch is `feature/v2` (RL-3). **On demand** (before a staging migration with data risk or a
purge batch): Actions → Staging backup → Run workflow (branch `feature/v2`, `force_fail` off).

## 4. Failed-run drill (04-P11)

After two days of scheduled runs: Actions → Staging backup → Run workflow with **`force_fail` = true**. The run is named
"Staging backup (forced failure drill)", exits 64 before any connection, and backup-alert.yml opens/comments on the
"Staging backup failing" issue. Then Claude verifies with
`gh run list --workflow backup.yml --json databaseId,conclusion,createdAt,displayTitle > runs.json`,
`gh run list --workflow backup-alert.yml --json databaseId,conclusion,createdAt,displayTitle > alerts.json`,
the latest listing artifact, and `npx tsx ops/backup/evidence.ts --listing <listing> --runs runs.json --alert-runs
alerts.json --out e.json && npx tsx ops/backup/evidence.ts --check e.json` (all four verdicts true). Close the issue
after the drill.

## 5. Alerts

| Signal | Path |
|---|---|
| a run fails (any step, exit 64 drill, exit 3 stale job runner), times out or is cancelled | backup-alert.yml → "Staging backup failing" issue (email to watchers); GitHub also emails the workflow's last editor about failed scheduled runs |
| no successful backup for 13 h (schedule not firing, every run failing) | 04-04 `backup_stale` rule on `ops.backup_runs` → `alert.notify` email to `OPS_ALERT_EMAIL` |
| the job runner is configured but has no ok pass in 15 min | `ops.backup_runner_stale()` → backup exits 3 after uploading → failed run → issue (R-41: independent of the app) |

## 6. When the alert fires

1. Open the run from the issue; read the `backup.*` lines (`backup.failed error_code=<step>_failed`). Logs never hold
   a URL, key or password.
2. `config` refusals (exit 2): fix the named secret or variable. `connect`/`dump_failed`: check the session pooler URL
   (`STAGING_DB_URL`) and that staging is not paused. `storage_failed`: Storage S3 key revoked or region wrong.
   `upload_failed`: R2 token expired or scoped to another bucket. Exit 3: the job runner is down (see
   `docs/runbooks/jobs.md`), the backup itself was uploaded.
3. Re-run (Run workflow). Close the issue when a run is green. Two consecutive failed runs or a failed drill is an
   early-upgrade trigger (roadmap §9.1 item 3, R-4): tell the PO.

## 7. Monthly restore drill (04-P13 first, then monthly)

On the PO's machine (Docker running, repo at `feature/v2`, never inside an agent session, R-29):

1. Download the newest `staging/*.tar.age` from R2 (dashboard → bucket → object → Download) to a folder **outside**
   the repository; export the primary key from the password manager to a file outside the repository.
2. Take its digest **only** from GitHub (04-07c M-BACKUPAUTH, 04-07d N-2): open the green "Staging backup" run whose
   job summary names that object key (Actions → Staging backup → the run → Summary, table "Backup archive"), or
   `gh run download <id> -n backup-evidence` and read `archive-digest.json`. Check the run is
   `.github/workflows/backup.yml` on `feature/v2` and green. Never take it from the bucket (age gives confidentiality
   only, and the R2 token can replace an object) and never from `ops.backup_runs.archive_sha256` (the `staging-backup`
   Environment's `postgres` URL can write that table, so whoever can plant an archive could plant its digest there; the
   row is a record, not an authority).
3. `ops/restore-drill/run.sh --dump <archive> --identity <primary key> --expect-sha256 <digest> --evidence
   .planning/phases/04-jobs-reliability/evidence/restore-drill-staging.json` (refused before decrypting if the archive
   is not the recorded one; refused before restoring if any SQL file holds a psql meta-command; the restore itself runs
   psql in restricted mode, so a meta-command the guard missed is refused by psql)
4. `ops/restore-drill/run.sh --dump <archive> --identity <break-glass key> --expect-sha256 <digest> --decrypt-only`
5. Delete the archive and key files. Claude verifies with `npx tsx ops/restore-drill/check-evidence.ts <evidence>`
   (all checks green, RPO ≤ 12 h, RTO ≤ 4 h, counts only) and records it in VERIFICATION_LOG.

What the drill checks (`supabase/tests/restore_drill_checks.sql`, pgTAP in `BEGIN … ROLLBACK`; V2-05 swaps in its
generated matrix, R-11): RLS on every public table; policy (public + storage), function (public, private, ops) and
`auth.users` counts equal the manifest; `cron.job` and `net.http_request_queue` empty; `ops.ensure_schedules()` then
re-creates exactly the nine schedules with `jobs-kick` inactive (§8 step 4; rolled back, so the drill stack never
schedules anything; 04-07c, M-RESTORE); a tenant-isolation probe (a restored member sees no row of a synthetic second
clinic in any table with `tenant_id`). Before any of that, the archive digest and the SQL guard (evidence checks
`archive_digest`, `sql_guard`; the self-test also proves a tampered copy is refused, `tampered_archive_refused`). Plus `compare-manifest.ts`
(every table's row count; every object's size and SHA-256 against the archive; every restored `storage.objects` row
has its file) and a refusal by an unrelated age key.

The drill stack runs db, auth, storage and realtime only (realtime creates `supabase_realtime_admin`, which role dumps
grant to). Parameter grants to Supabase-managed roles in `roles.sql` are skipped on restore (platform state; only a
superuser may grant them). **Version skew (K-6):** if a COPY into `auth`/`storage` fails on a hosted dump, align the
drill stack's service versions with staging's by writing them to `ops/restore-drill/supabase/.temp/*-version`
(git-ignored) and re-run.

## 8. Real restore into a new Supabase project

1. Create the project (same region); note its session pooler URL and enable Storage S3 access.
2. Authenticate the archive before anything reads it (04-07c M-BACKUPAUTH, 04-07d N-2): `shasum -a 256 <archive>` must
   equal the digest of the green GitHub `backup.yml` run, taken exactly as in §7 step 2 (its job summary or
   `archive-digest.json`; **never** from the bucket or from `ops.backup_runs`); stop on any difference. Decrypt outside
   the repository, then `npx tsx ops/restore-drill/sql-guard.ts --emit-dir restore roles.sql schema.sql
   storage_policies.sql data.sql history_schema.sql history_data.sql` must print PASS (no psql meta-command such as
   `\!` or `\copy`, no change of `standard_conforming_strings` / `client_encoding`) and writes the restore copies to
   `restore/` (pg_dump's own `\restrict` lines as comments). Restore **those copies** with psql in restricted mode
   (`ops/bin/psql-restricted.sh`, which takes `PSQL_DB_URL` and first runs `\restrict` with a fresh random key, so psql
   refuses every meta-command), in Supabase's documented order in one transaction, with `-X` (no `psqlrc`), from inside
   `restore/`: `ops/bin/psql-restricted.sh -X --single-transaction -v ON_ERROR_STOP=1 -f roles.sql -f schema.sql -f
   storage_policies.sql -c 'SET session_replication_role = replica' -f data.sql` (skip the managed-role parameter grants
   as the drill does), then `ops/bin/psql-restricted.sh -X … -f history_schema.sql -f history_data.sql`. Never feed the
   archive's SQL to a plain `psql`.
3. Objects: `aws s3 sync storage/<bucket> s3://<bucket> --endpoint-url https://<new-ref>.storage.supabase.co/storage/v1/s3`
   per bucket (buckets already exist from `storage.buckets` in `data.sql`).
4. Re-create the schedules (04-07c, M-RESTORE): `cron.job` is not in the dump and the restored migration history
   means no migration re-runs its `cron.schedule` call, so the project would otherwise send nothing and alert on
   nothing. SQL editor: `select ops.ensure_schedules();` re-creates the nine schedules (`jobs-kick`, `jobs-reap`,
   `cron-history-cleanup`, `delivery-reap`, `ops-evaluate-alerts`, `ops-heartbeat`, `ops-quota-snapshot`,
   `ops-quota-weekly-summary`, `ops-cleanup`) with **`jobs-kick` inactive**; it is idempotent and reports what it
   created. Check: `select jobname, active from cron.job order by 1;` (9 rows).
5. Re-create Vault secrets (Vault is not in dumps): `jobs_runner_url`, `jobs_runner_secret` (the environment's own
   value, never another environment's: `docs/runbooks/jobs.md` §2), `ops_error_ingest_key_sha256`
   (`environment.txt.example` §C). Review pending `ops.jobs` older than the dump (no duplicate patient messages), then
   `select ops.ensure_schedules(true);` activates `jobs-kick`.
6. Point the app at the new project (Vercel env), run `staging.yml` migrate if newer migrations exist, check
   `/api/ready`.

## 9. Key rotation

New pair → add its `age1…` line to `BACKUP_AGE_RECIPIENTS` next to the old ones → after 30 days (every retained
archive is readable by the new key) remove the old line and destroy the old key. Losing one key never loses backups:
every archive is encrypted to both (R-3). Rotate the R2 token yearly or on suspicion (update the two secrets).

## 10. Targets and limits

RPO ≤ 12 h (twice-daily), RTO ≤ 4 h (drill measures it), retention 30 days (R2 lifecycle; `retention_ok` in the
evidence).

**Accepted risks (R-48; owner V2-15 / go-live; staging holds synthetic data only):** R2 has no object versioning; the
R2 token (Object Read & Write) can delete or overwrite backups (no bucket lock yet: evaluated with the production
backup target, 04-07 triage); R2 has no India region. An overwritten or planted archive is **detected**, not prevented:
a restore refuses any archive whose SHA-256 differs from the digest the green GitHub backup run recorded (04-07c,
M-BACKUPAUTH; `ops.backup_runs` holds a copy for the record, never the authority: 04-07d, N-2), and runs the archive's
SQL only through the guard and psql in restricted mode. The reviewer-free `staging-backup` Environment holds a `postgres` database URL
for staging, limited to `feature/v2` and to `backup.yml` by the workflow policy, which since 04-07c also refuses the
review's bypasses (computed or differently spelled Environment names, computed secret names, `workflow_run` next to an
Environment) and requires a case-sensitive ref check in every staging job. Go-live moves production backups to the AWS design
(`docs/ops/backup-aws-golive.md`: versioned SSE-KMS bucket in `ap-south-1`, writer without Delete, no GitHub runner).

## 11. Local commands (agents may run)

- `ops/bin/install-age.sh` · `ops/restore-drill/run.sh --self-test [--evidence <file>]` (primary stack running; seeds
  synthetic data; uses the drill stack on 553xx and stops it) · `npx vitest run tests/ops`.
- `npx tsx ops/restore-drill/sql-guard.ts [--emit-dir <dir>] <file.sql> …` (reads files; with `--emit-dir`, writes the
  restore copies there).
- Never: `ops/backup/backup.sh` with `BACKUP_ENV` other than `local`; dispatching `backup.yml`; any R2/AWS call with
  real credentials.
