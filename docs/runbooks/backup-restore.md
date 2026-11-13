# Runbook: backup and restore (FT-02)

V2-04 plan 04-05a; rulings R-3, R-4, R-10, R-11, R-29, R-31, R-41. PO decision 2026-11-13: staging backups go to
**Cloudflare R2** through GitHub Actions; AWS `ap-south-1` is decided at go-live (design kept in
[`docs/ops/backup-aws-golive.md`](../ops/backup-aws-golive.md)). Synthetic staging data only; production backups are
V2-15.

## 1. What runs

| Piece | Where | What it does |
|---|---|---|
| `.github/workflows/backup.yml` ("Staging backup") | GitHub Actions, Environment `staging-backup` (no reviewer, R-48), `feature/v2` only | 02:00 and 14:00 IST: `ops/backup/backup.sh` with `BACKUP_ENV=staging`, then a names-and-sizes listing of `staging/` as the `backup-evidence` artifact |
| `ops/backup/backup.sh` | the workflow; locally with `BACKUP_ENV=local` | validates config (exit 2 on anything unsafe, naming the variable only) → `supabase db dump` (roles, schema, data with `cron.job`, `cron.job_run_details`, `net.*` queues and vector tables excluded, migration history) + `storage_policies.sql` (the CLI's schema dump skips the `storage` schema) → `aws s3 sync` of every Storage bucket → `manifest.json` (row counts from the dump, per-object size and SHA-256) → `tar` → `age` to every recipient → header check → upload `staging/<UTC yyyy-mm-ddTHHMMSSZ>.tar.age` → `ops.backup_runs` row (counts only) → dead-man check |
| `.github/workflows/backup-alert.yml` | GitHub Actions on `workflow_run` of "Staging backup" | any non-success run on `feature/v2` → opens or comments on the bot's **"Staging backup failing"** issue (GitHub emails watchers) |
| `ops.backup_runs` (migration 000032) | staging and local DB | one row per run: `ok` with key/size/duration/counts, or `failed` with a machine code (`dump_failed`, `storage_failed`, `encrypt_failed`, `upload_failed`, …); read by 04-04's `backup_stale` alert and 04-06's report |
| `ops/restore-drill/run.sh` | the PO's machine (staging archive), nightly CI and locally (`--self-test`, synthetic) | decrypt → second local stack `clinicos-drill` (ports 553xx) → restore → verify → evidence JSON (counts, verdicts, RPO, RTO) → stack stopped with `--no-backup`, plaintext deleted |
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
   See `environment.txt.example` §E. `workflow-policy.mjs` refuses `staging-backup` in any workflow but `backup.yml`.
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
2. `ops/restore-drill/run.sh --dump <archive> --identity <primary key> --evidence
   .planning/phases/04-jobs-reliability/evidence/restore-drill-staging.json`
3. `ops/restore-drill/run.sh --dump <archive> --identity <break-glass key> --decrypt-only`
4. Delete the archive and key files. Claude verifies with `npx tsx ops/restore-drill/check-evidence.ts <evidence>`
   (all checks green, RPO ≤ 12 h, RTO ≤ 4 h, counts only) and records it in VERIFICATION_LOG.

What the drill checks (`supabase/tests/restore_drill_checks.sql`, pgTAP in `BEGIN … ROLLBACK`; V2-05 swaps in its
generated matrix, R-11): RLS on every public table; policy (public + storage), function (public, private, ops) and
`auth.users` counts equal the manifest; `cron.job` and `net.http_request_queue` empty; a tenant-isolation probe (a
restored member sees no row of a synthetic second clinic in any table with `tenant_id`). Plus `compare-manifest.ts`
(every table's row count; every object's size and SHA-256 against the archive; every restored `storage.objects` row
has its file) and a refusal by an unrelated age key.

The drill stack runs db, auth, storage and realtime only (realtime creates `supabase_realtime_admin`, which role dumps
grant to). Parameter grants to Supabase-managed roles in `roles.sql` are skipped on restore (platform state; only a
superuser may grant them). **Version skew (K-6):** if a COPY into `auth`/`storage` fails on a hosted dump, align the
drill stack's service versions with staging's by writing them to `ops/restore-drill/supabase/.temp/*-version`
(git-ignored) and re-run.

## 8. Real restore into a new Supabase project

1. Create the project (same region); note its session pooler URL and enable Storage S3 access.
2. Decrypt the archive outside the repository; restore in Supabase's documented order in one transaction:
   `psql --single-transaction -v ON_ERROR_STOP=1 -f roles.sql -f schema.sql -f storage_policies.sql -c 'SET
   session_replication_role = replica' -f data.sql` (skip the managed-role parameter grants as the drill does), then
   `-f history_schema.sql -f history_data.sql`.
3. Objects: `aws s3 sync storage/<bucket> s3://<bucket> --endpoint-url https://<new-ref>.storage.supabase.co/storage/v1/s3`
   per bucket (buckets already exist from `storage.buckets` in `data.sql`).
4. Re-create Vault secrets (Vault is not in dumps): `jobs_runner_url`, `jobs_runner_secret`,
   `ops_error_ingest_key_sha256` (`environment.txt.example` §C). Pause the `jobs-kick` cron job and review pending
   `ops.jobs` older than the dump before resuming (no duplicate patient messages).
5. Point the app at the new project (Vercel env), run `staging.yml` migrate if newer migrations exist, check
   `/api/ready`.

## 9. Key rotation

New pair → add its `age1…` line to `BACKUP_AGE_RECIPIENTS` next to the old ones → after 30 days (every retained
archive is readable by the new key) remove the old line and destroy the old key. Losing one key never loses backups:
every archive is encrypted to both (R-3). Rotate the R2 token yearly or on suspicion (update the two secrets).

## 10. Targets and limits

RPO ≤ 12 h (twice-daily), RTO ≤ 4 h (drill measures it), retention 30 days (R2 lifecycle; `retention_ok` in the
evidence).

**Accepted risks (R-48; owner V2-15 / go-live; staging holds synthetic data only):** R2 has no object versioning; the
R2 token (Object Read & Write) can delete or overwrite backups; R2 has no India region. The reviewer-free
`staging-backup` Environment holds a `postgres` database URL for staging, limited to `feature/v2` and to
`backup.yml` by the workflow policy. Go-live moves production backups to the AWS design
(`docs/ops/backup-aws-golive.md`: versioned SSE-KMS bucket in `ap-south-1`, writer without Delete, no GitHub runner).

## 11. Local commands (agents may run)

- `ops/bin/install-age.sh` · `ops/restore-drill/run.sh --self-test [--evidence <file>]` (primary stack running; seeds
  synthetic data; uses the drill stack on 553xx and stops it) · `npx vitest run tests/ops`.
- Never: `ops/backup/backup.sh` with `BACKUP_ENV` other than `local`; dispatching `backup.yml`; any R2/AWS call with
  real credentials.
