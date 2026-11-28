# PO actions

Only what needs you, as of 23 Nov 2026. Claude checks each step after you say it's done and ticks it here. Never put a
secret value in this file: secrets go only into the store named in the step. The previous long version is in git
history (commit before this one).

---

## 1. Staging (done)

Done by the PO on 23 Nov 2026: staging moved to a new Supabase project in **Mumbai** (ref `vhazryrgpgygduskkrqp`;
the Vercel functions were already in Mumbai, `bom1`). Migrated, seeded, auth settings and hooks set, Realtime public
access off, schema and grants match the snapshot (Drift `schema` job passed). `/api/ready`: ready, schema current.

- [x] **1.6 Critical alert**: cleared by itself (no open alerts; /api/ready all clear, 23 Nov).
- [ ] **1.7 Retire Sydney** (`rzxgkbznyjwrirlufzdw`): pause it after a few days with no issues, then delete it.

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

- [x] **2.3 Bot check (Turnstile)**: done 23 Nov (Supabase side, then Vercel `TURNSTILE_SECRET_KEY`; an invite was accepted on staging).
  - Cloudflare → Turnstile → Add widget `clinicos-staging`, hostname `staging.thecliniqai.com`, mode Managed.
  - Site key → Vercel `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
  - Secret key → Vercel `TURNSTILE_SECRET_KEY`, and also Supabase → Authentication → Bot and Abuse Protection →
    CAPTCHA → Turnstile.

- [x] **2.4 Auth settings**: Claude prints the exact list (`node scripts/ci/check-auth-config.mjs --print staging`)
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
- [x] **4.3 Medicine catalogue on staging:** loaded by the PO into Mumbai on 23 Nov (CDCI and OPD diagnoses, with
  the fixed `scripts/seed-cdci.ts`).
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

---

## 6. V2-15: production readiness and UAT start (ordered; target 6 Dec for everything except go-live)

Runbooks written by Claude; each has a "verify" block whose output you paste back (ids and counts only, never secrets
or patient data). Steps 1 to 3 wait on the code part of V2-15 (production env guards, the migrate workflow, the
bootstrap SQL); the others can start now.

- [ ] **6.1 Names-only secret inventory (do first, 15 minutes).** On your machine:
  `node scripts/prod/secret-inventory.mjs --vercel --github-secrets` (add `--supabase-ref <ref>` for the production
  project). It prints names only. Then rotate or revoke each line and fill `docs/ops/secret-rotation.md`
  (see its "Production rotation checklist"). Revoke `SUPABASE_ACCESS_TOKEN`.
- [ ] **6.2 Supabase production.** New organisation and Free project in Mumbai, settings per
  `docs/runbooks/production-setup.md` (code part, coming). Run the approval-gated migrate workflow, then the
  bootstrap SQL.
- [ ] **6.3 Vercel production.** Project in `bom1`, environment variables per the env schema, Skew Protection on, domain.
- [ ] **6.4 Email.** `docs/runbooks/email-production.md`: Resend domain (SPF, DKIM, DMARC), production key, Send Email
  hook, one signup code received. Paste the verify block.
- [ ] **6.5 Platform admin.** `docs/runbooks/platform-admin-bootstrap.md`: dedicated identity, two TOTP factors,
  break-glass drill once.
- [ ] **6.6 Razorpay live.** `docs/runbooks/razorpay-live.md`: KYC, live keys and webhook, live plan (176882 paise),
  Rs 5 UPI and card tests, cancel test, one `uat` redemption by your test clinic. Fill
  `.planning/phases/15-production-readiness-uat-launch/15-LIVE-PAYMENTS-CHECKLIST.md`. If KYC is late, tell Claude
  in writing that you choose the comp fallback.
- [ ] **6.7 Backups and restore drill.** Deploy the AWS `ap-south-1` backup stack (code part, coming); two consecutive
  dumps and a failure-alert test; then the G6 restore drill on the post-bootstrap dump (`docs/runbooks/restore-drill.md`,
  decision CTO-1: synthetic data only, before any UAT clinic). Later monthly drills: `docs/runbooks/restore-drill-aws.md`.
- [ ] **6.8 Monitoring.** `docs/runbooks/uptime.md` (two or three monitors) and the alert drill in production
  (`docs/runbooks/alerts.md`).
- [ ] **6.9 Security contact.** Replace the placeholders in `public/.well-known/security.txt` (contact, expiry, domain);
  publish Terms, Privacy, Refund and Cancellation, Pricing and Contact pages; approve the retention schedule;
  confirm the CERT-In channel in `docs/runbooks/incident.md` section 8.
- [ ] **6.10 UAT.** Decide the UAT exit date (SUB-D11) and put the upgrade date and the T-10 slip check on your calendar
  (`docs/runbooks/free-tier-upgrade.md`, `docs/runbooks/uat-slip.md`); recruit the clinics; run `uat-campaign.sql`
  (coming); send invites with `docs/uat/invite-*.md`; MSG91 reminder templates approved.
- [ ] **6.11 Devices.** Run `.planning/phases/15-production-readiness-uat-launch/15-DEVICE-RUN.md` (R1 to R15 on four
  devices); give Claude the folder of notes and screenshots for scoring.
- [ ] **6.12 Go or no-go.** Generate and read the checklist:
  `node scripts/prod/g6-checklist.mjs --ci-run <id> --sha <commit> --verified <your-pasted-results.json> --out .planning/phases/15-production-readiness-uat-launch/G6-CHECKLIST.md`,
  then decide UAT start.
