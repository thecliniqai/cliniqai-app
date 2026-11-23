# PO actions

Only what needs you, as of 23 Nov 2026. Claude checks each step after you say it's done and ticks it here. Never put a
secret value in this file: secrets go only into the store named in the step. The previous long version is in git
history (commit before this one).

---

## 1. Get staging running (do this first)

**Where it stands (checked 23 Nov, 20:13 IST):** done by the PO on 23 Nov. The Staging runs at 12:55 and 13:10 IST succeeded,
and `/api/ready` reports ready (database ok, schema current). 1.5 not yet confirmed.

- [x] **1.1 Create the read-only database user** (staging Supabase → SQL Editor, run once):
  ```sql
  create role clinicos_drift_ro with login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls
    connection limit 2;
  grant connect on database postgres to clinicos_drift_ro;
  grant usage on schema public to clinicos_drift_ro;
  alter role clinicos_drift_ro set default_transaction_read_only = on;
  alter role clinicos_drift_ro set statement_timeout = '60s';
  grant usage on schema supabase_migrations to clinicos_drift_ro;
  grant select on supabase_migrations.schema_migrations to clinicos_drift_ro;
  ```
  Then set its password (generate one in your password manager):
  `alter role clinicos_drift_ro with password '<password>';`
  The user can read only the list of applied migrations, no patient or clinic rows.

- [x] **1.2 Fill the `staging-readonly` GitHub environment** (GitHub → repo → Settings → Environments →
  `staging-readonly`; it exists but is empty):
  - Deployment branches: `feature/v2` only. No required reviewer.
  - Secret `STAGING_DB_URL_RO`: copy the **Session pooler** URL from Supabase (Connect → Session pooler, port 5432).
    Change the user to `clinicos_drift_ro.rzxgkbznyjwrirlufzdw` and the password to the one from 1.1 (percent-encode
    special characters, e.g. `@` → `%40`). `?sslmode=require` at the very end is optional (TLS is enforced anyway);
    add no other `?…` parameter. Shape:
    `postgresql://clinicos_drift_ro.rzxgkbznyjwrirlufzdw:<password>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=require`
  - Variables: `SUPABASE_PROJECT_REF_STAGING` = `rzxgkbznyjwrirlufzdw`, `STAGING_ORIGIN` =
    `https://staging.thecliniqai.com`. These match the `staging` environment.

- [x] **1.3 Run the migrations** (GitHub → Actions → Staging → Run workflow → branch `feature/v2`, task `migrate`):
  - The `plan` job lists what it will apply. Expect 90 files, `000031` to `000120`.
  - If the list is right, click "Review deployments" and approve `staging`. Tell Claude if `plan` fails; Claude reads the log.
  - The run finishes when staging reports "ready". Claude confirms with `/api/ready`.
  - If it stops at `000033`, the project lacks the `pg_cron` or `pg_net` extension; tell Claude.

- [x] **1.4 Re-seed the demo clinic** (Actions → Staging → Run workflow, task `seed`, approve `staging`). This brings
  the synthetic clinic and its 5 logins up to date with the new schema.

- [ ] **1.5 Turn off Realtime public access** (Supabase staging → Realtime → Settings → "Allow public access" off).
  Today's live board uses a private channel.

## 2. Make staging behave like production (after section 1)

- [ ] **2.1 Background jobs** (reminders, messages, alerts all run through this):
  - Vercel → `clinicos-staging` → Environment Variables, **Production** scope only, then redeploy:
    - `JOBS_RUNNER_SECRET`: new random value (`openssl rand -hex 32`), Sensitive. It must differ from `CRON_SECRET`.
    - `MESSAGING_PROVIDER` = `sink`. The queue runs but nothing is sent.
    - `OPS_ALERT_EMAIL`: an inbox you read daily.
    - `JOBS_DRILL_ENABLED` = `false`.
  - Supabase staging → SQL Editor:
    - `select vault.create_secret('<the same JOBS_RUNNER_SECRET>', 'jobs_runner_secret');`
    - `select vault.create_secret('https://staging.thecliniqai.com/api/jobs/run', 'jobs_runner_url');`

- [ ] **2.2 Sign-in emails through Resend** (password reset, invites). Your `auth.thecliniqai.com` domain is already
  verified in Resend.
  - Resend → API Keys: create `clinicos-staging`, Sending access, domain `auth.thecliniqai.com`.
  - Vercel (Production scope):
    - `RESEND_API_KEY` = that key.
    - `EMAIL_FROM` = `no-reply@auth.thecliniqai.com`.
    - `EMAIL_PROVIDER` = `resend`.
  - Supabase staging → Authentication → Hooks → Send Email → HTTPS
    `https://staging.thecliniqai.com/api/auth/send-email` → generate the secret → put it in Vercel as
    `SEND_EMAIL_HOOK_SECRET`. Redeploy.
  - Request a password reset on staging for your own address and tell Claude it arrived.

- [ ] **2.3 Bot check (Turnstile)**:
  - Cloudflare → Turnstile → Add widget `clinicos-staging`, hostname `staging.thecliniqai.com`, mode Managed.
  - Site key → Vercel `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
  - Secret key → Vercel `TURNSTILE_SECRET_KEY`, and also Supabase → Authentication → Bot and Abuse Protection →
    CAPTCHA → Turnstile.

- [ ] **2.4 Auth settings**: Claude prints the exact list (`node scripts/ci/check-auth-config.mjs --print staging`)
  when you are ready. You apply it in Supabase → Authentication. It takes about 10 minutes of clicks.

## 3. Decisions (answer in chat, one line each is enough)

1. **V2-10 (billing and collections):** go ahead? And for its gate: do you approve, or does Claude approve and merge?
2. **WhatsApp at sign-off:**
   - Now: opt-in. The doctor ticks a box to send the prescription and receipt links.
   - Before: it sent automatically on every sign-off.
   - Keep opt-in, or restore automatic?
3. **Lab uploads:**
   - Now: limited to 4 MB, because Vercel caps the request size.
   - 25 MB needs a different upload design.
   - Is 4 MB acceptable for now?
4. **Two accepted risks until V2-12:**
   - the old v1 API can write a prescription without the allergy check;
   - the new medicine and allergy search routes have no rate limit.
   - Accept?
5. **Today board:** it can stop updating for about a minute after a bulk change, without showing it. Add a quiet
   refresh every 1–2 minutes?
6. **CI time:** the browser-test lane now takes up to 85 minutes. Split it into parallel jobs to roughly halve that?

## 4. Try it on staging (after sections 1 and 2)

- [ ] **4.1 Walkthroughs** (each about 15 minutes, synthetic data, logins from the seed):
  - front desk: `.planning/phases/08-front-desk/08-PO-WALKTHROUGH.md`
  - consult: `.planning/phases/09B-consult-workspace/09B-PO-WALKTHROUGH.md`
  - prescription: `.planning/phases/09C-rx-builder-pdf/09C-PO-WALKTHROUGH.md`
- [ ] **4.2 Device checks** on a real phone and tablet:
  - `08-DEVICE-CHECKLIST.md`, `09B-DEVICE-CHECKLIST.md` and `09C-DEVICE-CHECKLIST.md`, in the same folders.
  - On an iPhone, also: sign in, turn on Airplane mode, sign out. The patient screen must disappear, and Back must show no patient data.
- [ ] **4.3 Medicine catalogue on staging:** Claude will prepare a staging-only load command for the CDCI catalogue
  (today's script only targets your local `.env` project). You run it once, so allergy checks can match medicines by
  substance.
- [ ] **4.4 Approve the merged phases:** V2-05 to V2-09c are merged. Each has a `*-VERIFICATION.md` in its
  `.planning/phases/` folder. Say "approved", or list what to change.

## 5. Later (not needed now)

- **Nightly checks of staging settings:** a Supabase read-only access token for the `staging-readonly` environment
  (`SUPABASE_ACCESS_TOKEN_STAGING_RO`). If Supabase offers only an account-wide token, don't create it; tell Claude.
- **Staging backups to Cloudflare R2** (bucket, API token, the `staging-backup` GitHub environment), then the backup
  and restore drills.
- **MSG91 (WhatsApp) webhook:** send the secret as an `x-webhook-secret` header instead of in the URL. Needed before
  WhatsApp is switched on anywhere.
- **At go-live:**
  - make the GitHub repo private (after upgrading to GitHub Team);
  - Vercel Pro;
  - production gets its own separately generated secrets;
  - AWS Mumbai backups.
