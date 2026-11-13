# Runbook: staging environment

V2-03 plan 03-08 (P1-35a, FT-01). Rulings R-9, R-13, R-16, R-19, R-20, R-21, R-26, R-30. The PO does every hosted step
in this runbook. Agents never run `staging.yml` or `drift.yml`, never run the staging scripts with real credentials,
and never change hosted settings (R-9).

## 1. What staging is

| Piece | Where | How it changes |
|---|---|---|
| App | Vercel project `clinicos-staging`, production branch `feature/v2`, functions in `bom1` (`vercel.json`) | Vercel Git integration on every push to `feature/v2` (R-26) |
| Database + Auth | Supabase project `clinicos-staging` (organisation `clinicos-staging`, Free plan, `ap-south-1`) | Migrations: `.github/workflows/staging.yml` job `migrate`, run in Environment `staging` after PO approval. Auth settings: applied by the PO from the checklist (R-20) |
| Demo data | The synthetic demo clinic (`scripts/seed/demo-clinic.ts`) | `staging.yml`, dispatched with task `seed` / `seed-reset` |
| Nightly checks | `.github/workflows/drift.yml` in Environment `staging-readonly` | Read-only: auth config, `public`/`ops`/`private` schema and privileges (03-13b), function region |

Staging holds synthetic data only. Never copy production or v1 data into it.

## 2. Create the Supabase project (PO action E2)

1. supabase.com → New organization `clinicos-staging` (Free) → New project `clinicos-staging`, region **South Asia
   (Mumbai) ap-south-1**, Postgres 17. Store the generated database password in your password manager. Turn on MFA
   for your Supabase account. Turn on SSL enforcement and network restrictions if the plan offers them.
2. Record the project ref (it is not a secret) in `docs/v2/VERIFICATION_LOG.md`.
3. Copy two connection strings from Dashboard → Connect → **Session pooler** (port 5432). GitHub-hosted runners
   have no IPv6, and the direct host `db.<ref>.supabase.co` is IPv6-only on the Free plan, so use the pooler:
   - owner URL: `postgresql://postgres.<ref>:<db password>@aws-<n>-ap-south-1.pooler.supabase.com:5432/postgres`
   - read-only URL: the same host and port with user `clinicos_drift_ro.<ref>` and that role's password (§3).
   Percent-encode any special characters in a password (the CLI requires it). `scripts/staging/target-guard.mjs`
   accepts only these two forms (or the direct host) for this ref. It refuses loopback addresses, IP literals and
   other projects. Paste the URL exactly as shown: no `?…` parameters other than `sslmode=require` (or
   `verify-full`), no `#…`. The CLI's driver applies `host`, `user`, `port`, `dbname`, `options` and `sslmode`
   parameters over the address, so the guard refuses them; the workflows then hand the CLI a copy rebuilt from the
   checked parts with `sslmode=require` (03-13b M-GUARD).
4. Apply the migrations once, through `staging.yml` (§6). Do not use the CLI from your machine.

## 3. Read-only database role for the nightly schema check

Run this in the staging SQL editor **after** the first migration run. It contains no password:

```sql
create role clinicos_drift_ro with login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls
  connection limit 2;
grant connect on database postgres to clinicos_drift_ro;
grant usage on schema public to clinicos_drift_ro;
alter role clinicos_drift_ro set default_transaction_read_only = on;
alter role clinicos_drift_ro set statement_timeout = '60s';
```

Then set the password yourself in the SQL editor with a value from your password manager
(`alter role clinicos_drift_ro with password '…';`). Do not paste it anywhere else. The role gets no table grants, so
it cannot read rows. `supabase db diff` and the privilege snapshot (`scripts/drift/schema-snapshot.mjs`) only read
the catalog, which every role can read. `default_transaction_read_only` is only a session default (any role can turn
it off); the real control is that the role holds no grants beyond `connect` and `usage`.

## 4. Vercel project (PO action E4)

Follow E4 in `.planning/phases/03-platform-hygiene/03-PLAN.md`. In short: a new project from the repository, named
`clinicos-staging`, with production branch `feature/v2`, the custom domain `staging.<domain>` and the functions
region `bom1` (`vercel.json` pins it too). Turn Deployment Protection off for the production domain, because the Send
Email hook must reach it. Disable preview deployments. Use the environment variables listed in E4, and scope **every**
variable to the **Production** environment only (not Preview, not Development): a preview build would otherwise run
any pushed branch with the staging secrets and no approval. The app refuses to build or boot with `APP_ENV=staging`
when Vercel reports `VERCEL_ENV` other than `production` or a branch other than `feature/v2` (03-13b M-PREVIEW). Paste
the publishable key (`sb_publishable_…`) and the secret key (`sb_secret_…`) into the right fields: the schema
refuses a secret key in `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Next would inline it into every page) and the
reverse, in every tier (03-13b H-ENV). The env schema
rejects `R2_*`, `STORAGE_PROVIDER`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and
`MESSAGING_WEBHOOK_SECRET`, and the build fails if any of them is set. On the old v1 Vercel project, stop building
`v2/**` and `feature/v2` (K-9).

## 5. GitHub Environments (PO actions E10, E11)

Repository → Settings → Environments:

| Environment | Protection | Secrets | Variables |
|---|---|---|---|
| `staging` | required reviewer: the PO; deployment branches: `feature/v2` only | `STAGING_DB_URL` (owner URL, §2), `STAGING_SECRET_KEY` (`sb_secret_…`), `STAGING_SEED_PASSWORD` (at least 16 characters) | `SUPABASE_PROJECT_REF_STAGING`, `STAGING_ORIGIN` (`https://staging.<domain>`, no trailing slash) |
| `staging-readonly` | no reviewer; deployment branches: `feature/v2` only | `SUPABASE_ACCESS_TOKEN_STAGING_RO` (E11: fine-grained token, "Auth config: read", organisation `clinicos-staging`, 90-day expiry), `STAGING_DB_URL_RO` (read-only URL, §3) | `SUPABASE_PROJECT_REF_STAGING`, `STAGING_ORIGIN` |

**If Supabase does not offer a scoped read-only token (E11 fallback, 03-13b M-TOKEN):** do **not** create a classic
personal access token for `staging-readonly`. A classic token carries full Management API rights over every
organisation of your account (including the future production project), and `staging-readonly` has no reviewer.
The fallback is: the `auth-config` drift job runs in the **`staging`** Environment (required reviewer: you) with the
token stored there, so every run waits for your approval. That is a reviewed one-job change to `drift.yml`
(`environment: staging`, secret read from `staging`) that an agent prepares when you report the token is not offered;
until it merges, leave the `auth-config` job failing and record "no scoped token available" in
`docs/v2/VERIFICATION_LOG.md`. Never store an account-wide token in an Environment without a required reviewer.

No repository-level secret is used. `ci.yml` stays secret-free. `scripts/ci/workflow-policy.mjs` (in the `static`
job) fails the build if a staging workflow gains any trigger other than `push`, `schedule` or `workflow_dispatch`
(in any YAML form), a `write` permission or `write-all`, a staging secret outside a step's `env` of a job with an
`environment`, a cache restore, an install without `--ignore-scripts`, a checkout that persists credentials, or a
`${{ … }}` inside a `run:` script; and in every workflow if a `uses:` is not pinned to a commit SHA. YAML it cannot
read completely fails closed (03-13b M-POLICY).

## 6. Deploying (migrations)

**Order: expand, then migrate, then contract.** Vercel deploys a push to `feature/v2` straight away, while
`staging.yml` waits for your approval before it migrates. For a short time, then, the new app can run against the
old schema, or the old app against the new schema. That window is safe only when:

- an **expand** migration (new tables, columns, functions; nothing removed or renamed) merges **before or with** code
  that tolerates its absence. Code that requires the new object merges after the migration has run on staging;
- a **contract** migration (drop or rename) merges only after no deployed code uses the old object.

`supabase/migrations` is append-only (`scripts/ci/migration-immutability.mjs`), so there are no down migrations.

**Run:** a push to `feature/v2` that touches `supabase/migrations/**` starts `staging.yml`. You can also start it
yourself: Actions → Staging → Run workflow → branch `feature/v2`, task `migrate`. Approve the `staging` deployment.
The `migrate` job then:

1. checks `STAGING_DB_URL` with the target guard (and masks the password for the rest of the job);
2. `supabase db push --db-url … --dry-run` (lists what would be applied), then the same without `--dry-run`. It never
   uses `--include-seed`;
3. `scripts/staging/wait-for-release.mjs`: polls `/api/health` until `release` equals the commit (10 minutes at
   most), then requires `/api/ready` to answer 200, `status: "ready"`, with `latestMigration` equal to the newest file
   in `supabase/migrations`.

A green run, together with the Vercel deployment link for the same commit, is the evidence for "staging deploys from
CI" (acceptance item 7). Record both in `docs/v2/VERIFICATION_LOG.md`.

## 7. Seeding and demo-data reset

Actions → Staging → Run workflow → branch `feature/v2`, task `seed` (create or refresh) or `seed-reset` (remove).
Approve the deployment. `scripts/seed-staging.ts` refuses to run unless `APP_ENV=staging`, the URL is
`https://<ref>.supabase.co`, the key is an `sb_secret_…` key and the password has at least 16 characters. It creates
"Synthetic Demo Clinic" with five logins (`owner@`, `admin@`, `doctor@`, `nurse@`, `reception@demo-clinic.example.test`),
all with password `STAGING_SEED_PASSWORD`, and three synthetic patients. It prints emails and counts only.

The patients' numbers come from the project's synthetic block `+91 90000 000xx` (`lib/messaging/synthetic-numbers.ts`).
Every real messaging provider refuses to send to that block on every tier, so the seed cannot message a stranger even
after staging switches from `MESSAGING_PROVIDER=disabled` to a real provider (03-13b/03-13d M-SEEDPHONE). To test real
delivery, add a patient with your own handset's number; never reuse a seeded patient for it.

**Full reset** (schema and data): there is no link-based `db reset` (R-9, R-12). Create a fresh project (§2),
update the secrets and variables (§5), then run `migrate` and `seed`. Staging holds only synthetic data, so nothing is
lost.

## 8. Key rotation

| Credential | Rotate | Then update |
|---|---|---|
| `sb_secret_…` key | Dashboard → Project Settings → API Keys → create a new secret key, then delete the old one | Vercel `SUPABASE_SECRET_KEY`, GitHub `staging` → `STAGING_SECRET_KEY`; redeploy |
| Database password | Dashboard → Database → Reset password | `staging` → `STAGING_DB_URL` |
| `clinicos_drift_ro` password | `alter role … with password` in the SQL editor | `staging-readonly` → `STAGING_DB_URL_RO` |
| Read-only access token (90 days) | Account → Access Tokens → new fine-grained token (same scope), then revoke the old one | `staging-readonly` → `SUPABASE_ACCESS_TOKEN_STAGING_RO` |
| `CRON_SECRET`, `SEND_EMAIL_HOOK_SECRET`, `ERROR_INGEST_KEY`, SES IAM keys | per E4, E8, E9 and E6 | Vercel; for the ingest key, also the vault hash (E9) |
| `STAGING_SEED_PASSWORD` | new value in `staging` | dispatch `seed` (it sets the password on all five users) |

Rotate at once if a value may have leaked (in a log, a screenshot or a chat), and on the 90-day expiry.

## 9. Pause cap and limits (FT-01)

The Free plan allows two active projects and pauses a project after a period of inactivity. The nightly `drift.yml`
queries the database every day, but do not rely on that to keep it awake. When staging is paused, `wait-for-release`
times out and the drift jobs fail with connection errors. Restore the project from the Dashboard (Restore project),
then re-run the failed workflow. Keep the v1 project paused (E1b) so it does not count against the cap.

## 10. Region check (`bom1`)

The nightly `region` job runs `scripts/staging/check-region.mjs`. `/api/health` must report `region` equal to the one
region pinned in `vercel.json` (`bom1`). The job also prints the region segments of `x-vercel-id` as a second signal
(R-30). If it fails, either move the functions back (Vercel → Settings → Functions → Region, and check `vercel.json`)
or record the deviation (FT-01) in `docs/v2/VERIFICATION_LOG.md`.

## 11. Rollback

- **App:** Vercel → Deployments → the previous production deployment → Instant Rollback (or Promote). Expand and
  contract (§6) keep the previous app compatible with the migrated schema.
- **Schema:** forward-fix only. Add a new migration that reverses the change, merge it, and let `staging.yml` apply it.
  Applied migration files are never edited.
- **Data:** synthetic only. Run `seed-reset` + `seed`, or do a full reset (§7).

## 12. Nightly drift: reading a failure

| Job | Exit | Meaning | Action |
|---|---|---|---|
| `auth-config` | 1 | a hosted Auth setting differs from the `staging` column of `supabase/auth-policy.json`, or a field is missing | Fix the dashboard setting (`node scripts/ci/check-auth-config.mjs --print staging` is the checklist). For a MISSING field, pin its real API name in the policy row (A4) |
| `auth-config` | 2 | refused (token, ref or origin missing or malformed) or an API error (status only) | check `staging-readonly` secrets/variables; renew the token |
| `schema` | 1 | the staging `public`/`ops`/`private` schema differs from what `supabase/migrations` builds, or a grant, policy or RLS flag differs from `scripts/drift/schema-snapshot.txt` (lines `+` = only on staging, `-` = missing on staging) | find who changed staging outside a migration; reverse it, or capture it in a new migration. A platform-owned difference (e.g. on the first run) is recorded and fixed in a reviewed change; the snapshot has no allowlist |
| `schema` | 2 | target refused, or the CLI could not connect | check `STAGING_DB_URL_RO`, the role password, the pause state |
| `region` | 1 | functions are not in `bom1` | §10 |

Reports are uploaded as workflow artifacts (`auth-config-drift`, `schema-drift`). They contain field names, policy
values and schema statements, never a secret.

## 13. Who may do what

- **PO:** everything hosted. Approves every `staging` run, dispatches `seed`/`seed-reset`, owns every secret.
- **Agents:** may read workflow results (`gh run list/view`) and run the verify commands in PO-ACTIONS. Agents never
  dispatch `staging.yml` or `drift.yml`, never run `scripts/seed-staging.ts`, `scripts/staging/*` or
  `scripts/drift/auth-config-hosted.mjs` with real values, and never use `--linked` or `db push` from a workstation.
