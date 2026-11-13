# PO actions — single checklist

Everything that needs the PO (accounts, consoles, credentials, paid services, confirmations). Agents never wait on
these: the code ships behind interfaces with local/offline implementations and flags that default **off**.
Never put a secret value in this file. Secrets go into the named secret store only.

**How an item closes:** the PO does the step and says so → Claude verifies it (read-only API/CLI check or a test run)
→ ticks it with the evidence (command + result, date, commit SHA or CI link).

Legend: `[ ]` open · `[~]` PO says done, Claude verifying · `[x]` verified (evidence inline) · `[d]` delegated to CTO, deferred or superseded (reason inline)

---

## ▶ NEEDS YOU: shortlist (2026-11-13)

The PO asked for only the items that need a decision or money; Claude handles the rest.

**Decisions or money (answer these first)**
- **B-1 · Vercel plan for staging.** **Answered (PO, 2026-11-13): Hobby until go-live; staging is a new Hobby project. Upgrade to Pro at go-live (commercial use).** v1 is on Vercel. The Hobby plan does not allow commercial use, so a staging
  project for ClinicQ belongs on a Pro team. Question: is the team that hosts app.thecliniqai.com on Pro? If yes,
  staging costs nothing extra. If no, decide: upgrade (~$20/month per member) or run staging only locally until go-live.
- **B-2 · Supabase project slots.** **Answered (PO, 2026-11-13): nobody uses the v1 test project. Create one new staging project. CTO: skip the v1 schema dump (03-E1a) because production is built from migrations (C26); pausing TheCliniQ (03-E1b) is optional; Claude does the local unlink (03-E1c).** Free allows 2 active projects. Question: does app.thecliniqai.com (v1) use the
  "TheCliniQ" project, and do people still use v1? If yes, do not pause it (03-E1b becomes "skip"); staging takes the
  second free slot, provided no other free project is active.
- **B-3 · Staging backups (FT-02): AWS vs Cloudflare R2.** **Answered (PO, 2026-11-13): Cloudflare R2 for staging; AWS Mumbai decided at go-live.** AWS S3 in Mumbai with a KMS key costs about $1–2/month.
  Cloudflare R2 costs $0 at this size and is already in your Cloudflare account. Staging holds synthetic data only.
  Claude recommends R2 for staging now and AWS Mumbai for production at go-live. The code is S3-compatible, so only
  the endpoint changes.
- **B-4 · Resend plan and domain.** **Answered (PO, 2026-11-13): auth.thecliniqai.com added in Resend. dig confirms DKIM (`resend._domainkey.auth`) plus SPF/MX via `send.auth` → Resend.** Question: is auth.thecliniqai.com a free domain slot on your Resend plan? If v1
  already uses Resend, which domain does it send from? (If the plan has no free slot, either upgrade or send staging
  mail from the domain v1 already verified.)
- **D-1 · Design sign-off (G2-D).** Claude will hand you the V2-DX proposal when it is ready (about 45–60 min of review).

**Clicks only, after B-1…B-4 (exact steps are in each item below):**
03-E1a dump the v1 schema → 03-E2 staging Supabase project (Mumbai) → 03-E6R Resend domain auth.thecliniqai.com →
03-E4 Vercel staging + staging.thecliniqai.com → 03-E7 Turnstile widget → 03-E3 auth settings + hooks → 03-E10/E11
GitHub Environments. Everything else is post-merge drills that Claude runs or asks for when ready.

**Delegated or deferred:** rulings confirmations (C-2, 03-E13/E14/E15, 04-P14/P15, 05-P1) are delegated to the CTO;
C-1 (private repo) is deferred to go-live; SES (03-E5/E6) is replaced by Resend until go-live.

- [~] **03-E6R · Resend sending domain `auth.thecliniqai.com`** — replaces 03-E5/E6 until go-live
  - *Do / where:* resend.com → Domains → Add domain `auth.thecliniqai.com` (region: the one closest to India that
    Resend offers, e.g. Tokyo `ap-northeast-1`). Resend shows 3 records. Add them in Cloudflare → thecliniqai.com →
    DNS → Records, all **DNS only** (grey cloud):
    `TXT resend._domainkey.auth` = the DKIM value Resend shows; `MX send.auth` = the feedback-smtp host Resend shows,
    priority 10; the `send.auth` SPF/MX records Resend shows (copy them exactly). No DMARC
    record is needed: the root `_dmarc.thecliniqai.com` (p=none) already covers the subdomain. Then click Verify in
    Resend. Next: Resend → API Keys → create `clinicos-staging`, permission **Sending access**, domain
    `auth.thecliniqai.com` → paste it into Vercel staging as `RESEND_API_KEY` (Production scope only). Set
    `EMAIL_PROVIDER=resend` and `EMAIL_FROM=no-reply@auth.thecliniqai.com` (plain address — the schema refuses a display name). Supabase keeps the Send Email
    hook (03-E8) pointing at the app; the app sends through Resend.
  - *Why:* AUTH-03 (code-only emails, magiclink dropped, dedupe) using the provider you already have; SES after go-live.
  - *Unblocks:* acceptance 9 (reset email with DKIM pass); 03-E8.
  - *Verify (Claude):* `dig +short TXT resend._domainkey.auth.thecliniqai.com`; `dig +short MX send.auth.thecliniqai.com`;
    after 03-E8, you paste the reset mail's `Authentication-Results` line (expect `dkim=pass header.d=auth.thecliniqai.com`).
  - *Code:* the Resend sender is added in V2-04 plan 04-00b (HTTP API, no SDK, timeout, idempotency key).

---

## Carried over from V2-01 / V2-02

- [d] **C-1 · Make the GitHub repo private (after upgrading the org to GitHub Team)** — phase V2-01/V2-02
  - **Deferred by the PO on 2026-11-13: the repo stays public until go-live or after UAT (no paid GitHub plan now). Keep it free of secrets and PHI (gitleaks and push protection enforce this).**
  - *Do:* github.com/organizations/thecliniqai/settings/billing → upgrade to **Team**; then repo
    `thecliniqai/cliniqai-app` → Settings → General → Danger zone → Change visibility → Private.
  - *Why:* the repo is PUBLIC (checked 2026-11-13: `visibility: PUBLIC`, org plan `free`). Security docs and review
    reports describe defences and deferred weaknesses. On the Free plan a private repo loses ruleset enforcement, so
    upgrade first (OA-3).
  - *Unblocks:* go-live checklist; safe publication of review reports.
  - *Verify:* `gh repo view thecliniqai/cliniqai-app --json visibility` → `PRIVATE`; `gh api orgs/thecliniqai -q .plan.name`
    → `team`; `gh api repos/thecliniqai/cliniqai-app/rulesets/27150224 -q .enforcement` → `active`.

- [d] **C-2 · Confirm delegated rulings for V2-01 and V2-02** — phase V2-01/V2-02
  - **Delegated to CTO by the PO on 2026-11-13 ("for the rest, I trust your judgement"); the rulings stand as written. Revisit at go-live if needed.**
  - *Do:* read and confirm (or overturn) D1–D12, R1–R17, F-rulings in `.planning/phases/01-security-containment/01-PLAN.md`
    and RL-1…RL-23, OA-1…OA-6 in `.planning/phases/02-ci-e2e-foundations/02-PLAN.md`; ADR-0005 amendment A1.
  - *Why:* the PO delegated these to Claude as CTO; the PO approves every gate.
  - *Verify:* PO's written confirmation recorded in `docs/v2/VERIFICATION_LOG.md` gate section.

- [ ] **C-3 · MSG91 console: send the webhook secret as a header** — phase V2-01 (P0-03)
  - *Do:* MSG91 dashboard → WhatsApp → Webhooks → the clinicOS inbound URL: remove the `?secret=` query string; add
    header `x-webhook-secret: <secret>`; method POST. If the secret ever appeared in a URL or log, rotate it and update
    the deployment's `MSG91_WEBHOOK_SECRET` (name only here).
  - *Why:* the app now only accepts the header (constant-time compare); a query-string secret is rejected with 401.
  - *Unblocks:* inbound WhatsApp replies on any deployed environment.
  - *Verify:* send a test reply from a synthetic number to staging; `ops`/webhook log row with status 200, no secret in URL.

- [ ] **C-4 · Rename the two Supabase keys in your local `.env.local`** — phase V2-03 (03-01, R-K)
  - *Do:* in your own `.env.local` (Claude never opens it): rename `NEXT_PUBLIC_SUPABASE_ANON_KEY` →
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEY` (values unchanged),
    and add `APP_ENV=development`.
  - *Why:* the env schema rejects the legacy names; `npm run dev` stops at boot and names the rename.
  - *Unblocks:* local `npm run dev` on the V2-03 branch.
  - *Verify:* you run `npm run dev` and see the app start; Claude checks nothing in that file.

---

## V2-06 Design system & PWA shell (flagged early)

- [ ] **D-1 · G2-D design sign-off (V2-DX has not run)** — phase V2-06 (blocks plans 06-01…06-04 being final)
  - *Do:* review the palette, icon/theme colour and Today/Consult mock-ups Claude will produce as a V2-DX proposal
    (location recorded here when ready) and approve or request changes.
  - *Why:* roadmap R5: no primitives are built before the design direction is approved from rendered evidence.
  - *Unblocks:* 06-01 tokens, 06-02 primitives, 06-03 clinical components, 06-04 shell being merged as final.
  - *Verify:* PO sign-off recorded in `docs/v2/VERIFICATION_LOG.md` (G2-D row).

## V2-03 Platform hygiene

Source: `.planning/phases/03-platform-hygiene/03-PLAN.md` §PO actions. IDs are prefixed `03-`. No secret value appears
here; secrets go only into the named store. **Order (lead times):** 03-E0 → 03-E1a → 03-E1b → 03-E1c → 03-E2 → 03-E5 + 03-E6 (in parallel;
DKIM and production access take hours to days) → 03-E4 → 03-E7, 03-E8, 03-E9 → 03-E10, 03-E11 → 03-E3. Hosted verifications that use
`staging.yml`/`drift.yml` run after the phase PR merges into `feature/v2` (R-19); none blocks the gate.

- [x] **03-E0 · Decide the final domain**
  - **Done on 2026-11-13: the PO chose thecliniqai.com. Verified with `dig +short NS thecliniqai.com`, which returns Cloudflare (venus/viddy.ns.cloudflare.com). v1 runs at app.thecliniqai.com (Vercel). Staging will be staging.thecliniqai.com; auth email will send from auth.thecliniqai.com.**
  - *Do / where:* choose the product domain for "ClinicQ" (PO-19) at your registrar; note whether DNS is hosted at the
    registrar or Cloudflare.
  - *Values:* `<domain>`; derived names `auth.thecliniqai.com` (email), `staging.thecliniqai.com` (staging app).
  - *Why:* PO-19 fixed the name and the `auth.` pattern but no domain is recorded (R-13).
  - *Unblocks:* 03-E4, 03-E5, 03-E6, 03-E7, 03-E8; the `{{STAGING_ORIGIN}}` value in `supabase/auth-policy.json`.
  - *Verify (Claude, read-only):* `dig +short NS <domain>`; record the domain in `docs/v2/VERIFICATION_LOG.md`.

- [d] **03-E1a · Schema-only snapshot of the v1 test project (before pausing it)**
  - *Do / where:* on your machine, outside any agent session:
    `npx supabase db dump --schema-only --db-url "<v1 database URL from Dashboard → Connect>" -f <path outside the repo>/clinicq-v1-schema.sql`.
    Schema only, no data. Tell Claude the file path. Do not commit it.
  - *Why:* B1 requires a read-only drift report against the hosted project; a paused project cannot be dumped
    (pitfall 6).
  - *Unblocks:* acceptance item 3 hosted half; 03-E1b.
  - *Verify (Claude):* `node scripts/drift/hosted-dump-diff.mjs <path>` (local scratch DB only) → writes
    `.planning/phases/03-platform-hygiene/evidence/b1/hosted-drift.{txt,json}`; drift is documented, not reconciled
    (production is built from migrations, C26).

- [d] **03-E1b · Pause the v1 test project "TheCliniQ"**
  - *Do / where:* Supabase Dashboard → project "TheCliniQ" → Project Settings → General → Pause project (or delete it
    if nothing else needs it).
  - *Why:* FT-01; the Free plan allows two active projects.
  - *Unblocks:* 03-E2.
  - *Verify (Claude):* `curl -s -o /dev/null -w "%{http_code}\n" "https://$(cat supabase/.temp/project-ref).supabase.co/auth/v1/health"`
    is not 200 (paused projects do not serve; assumption, confirmed by your screenshot of the paused state).

- [x] **03-E1c · Unlink the local CLI from the v1 project**
  - **Done by Claude on 2026-11-13: `npx supabase unlink`, then `test ! -e supabase/.temp/project-ref` → `unlinked`.**
  - *Do / where:* repo root: `npx supabase unlink` (after 03-E1a and 03-E1b).
  - *Why:* any CLI call without `--local` can otherwise target the hosted project (R-12, pitfall 2).
  - *Verify (Claude):* `test ! -e supabase/.temp/project-ref && echo unlinked`.

- [x] **03-E2 · Staging Supabase organisation and project**
  - **Verified 2026-11-13: staging project ref `rzxgkbznyjwrirlufzdw` (Mumbai); `/api/ready` returns `"database":"ok","schema":"current"`.**
  - *Do / where:* supabase.com → New organization `clinicos-staging` (plan **Free**) → New project
    `clinicos-staging`, region **South Asia (Mumbai) ap-south-1**, Postgres 17, a generated database password stored in
    your password manager. Enable MFA on your Supabase account. Enable SSL enforcement / network restrictions if the
    Free plan offers them. Record the project ref (not secret) in VERIFICATION_LOG.
  - *Why:* FT-01, P1-35a. New projects issue only `sb_publishable_…`/`sb_secret_…` keys (R-K).
  - *Unblocks:* 03-E3, 03-E4, 03-E8, 03-E9, 03-E10, 03-E11; acceptance 7, 12, 14.
  - *Verify (Claude):* `curl -s -o /dev/null -w "%{http_code}\n" -H "apikey: <publishable key>" https://<staging-ref>.supabase.co/auth/v1/health`
    → 200 (the publishable key is public by design); region from your Settings → General screenshot.

- [ ] **03-E3 · Staging Auth settings (applied by you, checked by the drift job)**
  - *Do / where:* Claude gives you the output of `node scripts/ci/check-auth-config.mjs --print staging` (dashboard
    label → value). Apply it in Dashboard → Authentication: signups **off**; confirm email **on**; secure email change
    **on**; secure password change **off**; email OTP expiry 600 s, **length 8** (ruling R-36; apply before or with the deploy carrying ff38b2b — the reset form accepts only 8 digits); minimum password length 10; **Require
    current password when updating: on**; access-token (JWT) expiry 900 s; rate limits email sent 60/h, sign-ups and
    sign-ins 30, token refreshes 150, token verifications 30; MFA TOTP on; Site URL `https://staging.thecliniqai.com`, no
    extra redirect URLs; security notification "password changed" on; email templates pasted from
    `supabase/templates/*.html` (used only by the SMTP fallback); CAPTCHA after 03-E7; Send Email hook after 03-E8.
  - *Access-token hook (03-13e, H-AUTH):* **only after migration 000030 is applied on staging** (a hook pointing at a
    missing function blocks every sign-in): Authentication → Hooks → Customize Access Token (JWT) Claims → Postgres,
    schema `private`, function `session_age_token_hook` (`pg-functions://postgres/private/session_age_token_hook`).
    *Verify (Claude):* `node scripts/ci/check-auth-config.mjs --print staging`; drift `auth-config` job green; AUTH-00
    kit item 10 with `stale_wait_seconds` shows the stale refresh refused (403).
  - *Why:* AUTH-02/03, A00-1, A00-4, A00-5; settings are applied by you, not pushed from CI (R-20).
  - *Unblocks:* acceptance 10, 12; AUTH-00 re-check.
  - *Verify (Claude):* after merge, `gh run list --workflow drift.yml --limit 1 --json conclusion,url,headSha` → the
    `auth-config` job is green; `gh run view <id> --log --job <auth-config job id>` shows 0 diffs.

- [x] **03-E4 · Vercel staging project**
  - **Verified 2026-11-13: `https://staging.thecliniqai.com/api/health` returns `"region":"bom1"`, `"release":"b70cdb4…"` = `origin/feature/v2`, with an `x-request-id` header. Email provider stays `disabled` until PR #6 (Resend) merges.**
  - *Do / where:* Vercel → New Project from `thecliniqai/cliniqai-app`, name `clinicos-staging`; Production Branch
    `feature/v2`; custom domain `staging.thecliniqai.com` (DNS record from Vercel at your DNS host); Functions region `bom1`
    (also set by `vercel.json`); Deployment Protection off for the production domain (the Send Email hook must reach it;
    assumption A2) and preview deployments disabled. Environment variables (names; values from your secret stores):
    `APP_ENV=staging`, `NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (sensitive), `NEXT_PUBLIC_APP_URL=https://staging.thecliniqai.com`,
    `CRON_SECRET` (random, ≥ 32 chars), `MESSAGING_PROVIDER=disabled` (until MSG91 staging credentials exist),
    `AI_ENABLED=false`, `API_V1_ENABLED=false`, `EMAIL_PROVIDER=disabled` (switch to `ses` after 03-E6/03-E8),
    `EMAIL_FROM=no-reply@auth.thecliniqai.com`, `SES_ACCESS_KEY_ID`/`SES_SECRET_ACCESS_KEY` of the 03-E6 IAM user (region is
    fixed to ap-south-1 in code; **corrected by 03-11b: Vercel reserves the `AWS_*` names**), `SEND_EMAIL_HOOK_SECRET` (03-E8), `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (03-E7), `ERROR_INGEST_KEY` (03-E9),
    `PWNED_CHECK=on`, `DIAG_ERROR_ROUTE_ENABLED=false` (true only during 03-E9). Do **not** set `R2_*`,
    `STORAGE_PROVIDER`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (the schema rejects them). On the
    existing v1 Vercel project, stop building `v2/**` and `feature/v2` previews (or set `APP_ENV` there), because v2
    builds now fail without `APP_ENV`.
  - *Scope (03-13b, M-PREVIEW):* scope **every** Vercel variable to **Production only** (never Preview/Development). The
    build refuses `APP_ENV=staging` on a preview or a non-`feature/v2` branch, and refuses swapped or legacy JWT keys.
  - *Why:* P1-35a, FT-01 `bom1`, acceptance 1, 7, 13, 14.
  - *Unblocks:* 03-E8, 03-E9; acceptance 7, 8, 13, 14.
  - *Verify (Claude):* `curl -sI https://staging.thecliniqai.com/api/health` → 200 with `x-request-id`;
    `curl -s https://staging.thecliniqai.com/api/health` → `"region":"bom1"` and `"release"` equal to
    `git rev-parse origin/feature/v2`; `curl -s https://staging.thecliniqai.com/api/ready` → `"status":"ok"`.

- [d] **03-E5 · DNS records for `auth.thecliniqai.com`**
  - **Superseded on 2026-11-13: the PO chose Resend for now, with SES after go-live. See 03-E6R. Kept for the post-go-live SES switch.**
  - *Do / where:* at your DNS host: the 3 SES Easy-DKIM CNAMEs `<token>._domainkey.auth.thecliniqai.com` (values from 03-E6);
    custom MAIL FROM `mail.auth.thecliniqai.com`: MX `10 feedback-smtp.ap-south-1.amazonses.com` and TXT
    `v=spf1 include:amazonses.com ~all`; DMARC TXT at `_dmarc.auth.thecliniqai.com`:
    `v=DMARC1; p=none; rua=mailto:<your inbox>` (tighten to `quarantine` after a clean week); the `staging` CNAME Vercel
    gives you.
  - *Why:* AUTH-03 DKIM pass.
  - *Unblocks:* acceptance 9.
  - *Verify (Claude):* `dig +short CNAME <token>._domainkey.auth.thecliniqai.com`; `dig +short MX mail.auth.thecliniqai.com`;
    `dig +short TXT mail.auth.thecliniqai.com`; `dig +short TXT _dmarc.auth.thecliniqai.com`.

- [d] **03-E6 · Amazon SES in ap-south-1**
  - **Superseded on 2026-11-13: the PO chose Resend for now, with SES after go-live. See 03-E6R. Kept for the post-go-live SES switch.**
  - *Do / where:* AWS console, region Mumbai → SES → Identities → Create identity → Domain `auth.thecliniqai.com`, Easy DKIM
    RSA 2048, custom MAIL FROM `mail.auth.thecliniqai.com`; Account dashboard → **Request production access** (transactional,
    low volume, authentication codes); while in the sandbox, verify your own test recipient address; account-level
    suppression list on for bounces and complaints (R-10); IAM user `clinicos-staging-ses` with only `ses:SendEmail` on
    the identity ARN and condition `ses:FromAddress = no-reply@auth.thecliniqai.com`; its access key goes to Vercel (03-E4) only.
  - *Why:* AUTH-03, PO-A3; production access has lead time (AR-4).
  - *Unblocks:* acceptance 9; `EMAIL_PROVIDER=ses` on staging.
  - *Verify:* you paste the output of the read-only `aws sesv2 get-email-identity --email-identity auth.thecliniqai.com
    --region ap-south-1 --query "{verified:VerifiedForSendingStatus,dkim:DkimAttributes.Status}"` and
    `aws sesv2 get-account --region ap-south-1 --query ProductionAccessEnabled`; Claude checks the 03-E5 records with `dig`.

- [ ] **03-E7 · Cloudflare Turnstile widget**
  - *Do / where:* Cloudflare dashboard → Turnstile → Add widget `clinicos-staging`, hostname `staging.thecliniqai.com`, mode
    **Managed**, no pre-clearance. Site key → Vercel `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (03-E4). Secret key → Supabase
    staging → Authentication → Bot and Abuse Protection → Enable CAPTCHA → Turnstile → secret.
  - *Why:* C43; acceptance 10.
  - *Unblocks:* AUTH-00 re-check item 2.
  - *Verify (Claude):* the `drift.yml` `auth-config` job confirms CAPTCHA enabled with provider Turnstile;
    `curl -s -o /dev/null -w "%{http_code}\n" https://staging.thecliniqai.com/login` → 200. You confirm one browser sign-in on
    staging succeeds with the widget (recorded with re-check item 2).
    Then dispatch `staging.yml` (Actions → staging → Run workflow) with task `recheck`, inputs
    `captcha_browser_check` and `auth_log_retention` (AUTH-00 staging re-check kit, 03-12c); approve the `staging`
    environment run. *Verify (Claude):* `gh run view <id> --json conclusion,jobs` → `auth00-recheck` green; the job
    summary lists all nine re-check items.

- [ ] **03-E8 · Send Email hook on staging**
  - *Do / where:* Supabase staging → Authentication → Hooks → Send Email → HTTPS
    `https://staging.thecliniqai.com/api/auth/send-email` → generate the secret → Vercel `SEND_EMAIL_HOOK_SECRET`; set
    `EMAIL_PROVIDER=ses` in Vercel and redeploy. Then request a password reset on staging for your SES-verified address.
  - *Why:* AUTH-03; the magiclink drop (A00-1).
  - *Unblocks:* acceptance 9.
  - *Verify:* the `drift.yml` `auth-config` job shows the hook enabled with that URI; you paste the received mail's
    `Authentication-Results` line (expect `dkim=pass header.d=auth.thecliniqai.com`; the message holds only a synthetic code).

- [ ] **03-E9 · Error-sink ingest key on staging + one diag error**
  - *Do / where:* generate a key locally (`openssl rand -hex 32`) → Vercel `ERROR_INGEST_KEY`; compute its hash locally
    (`printf %s "<key>" | shasum -a 256`) and run in the staging SQL editor
    `select vault.create_secret('<sha256 hex>', 'ops_error_ingest_key_sha256');` (hash only). Set
    `DIAG_ERROR_ROUTE_ENABLED=true`, redeploy, run `curl -s -X POST -H "authorization: Bearer <CRON_SECRET>"
    -D - https://staging.thecliniqai.com/api/diag/error` (note `x-request-id`), run the export query from
    `docs/runbooks/error-sink.md` for that request id, save it as JSON, then set the flag back to `false`.
  - *Why:* acceptance 8 on staging; evidence "an `ops.error_events` row export with scrubbed fields".
  - *Verify (Claude):* `node scripts/ops/check-error-export.mjs <export file>` passes (allowed columns only, no
    scrub pattern); the export is committed under `evidence/`.

- [x] **03-E10 · GitHub Environments `staging` and `staging-readonly`**
  - **Verified 2026-11-13: Environment `staging` has rules `branch_policy` + `required_reviewers`. migrate run 43391525651 is green (000001…000030 applied). seed run 43403553111 is green: "Synthetic Demo Clinic", 3 synthetic patients, 5 logins `*@demo-clinic.example.test`. Still open: `staging-readonly` (drift job) and `staging-backup` (04-R2), both later.**
  - *Do / where:* repo `thecliniqai/cliniqai-app` → Settings → Environments. `staging`: required reviewer = you,
    deployment branches `feature/v2` only; secrets `STAGING_DB_URL` (direct/session URL with the DB password),
    `STAGING_SECRET_KEY`, `STAGING_SEED_PASSWORD`; variables `SUPABASE_PROJECT_REF_STAGING`, `STAGING_ORIGIN`
    (`https://staging.thecliniqai.com`), `STAGING_PUBLISHABLE_KEY` (the staging `sb_publishable_…` key; added by 03-12c). `staging-readonly`: no reviewer, branch `feature/v2`; secrets
    `SUPABASE_ACCESS_TOKEN_STAGING_RO` (03-E11), `STAGING_DB_URL_RO` (the read-only role from `docs/runbooks/staging.md`,
    password set by you); same variables.
  - *Values (correction from 03-08):* `STAGING_DB_URL` must be the **Session pooler** URL (Dashboard → Connect → Session
    pooler: user `postgres.<ref>`, port 5432, password percent-encoded; no `?…` parameter except `sslmode=require` — the target guard refuses others) — GitHub runners have no IPv6 and the Free-plan
    direct host is IPv6-only. `STAGING_DB_URL_RO` = same host, user `clinicos_drift_ro.<ref>` (create the role with the
    SQL in `docs/runbooks/staging.md` §3, after the first migrate). `STAGING_SECRET_KEY` must be an `sb_secret_…` key;
    `STAGING_SEED_PASSWORD` ≥ 16 characters.
  - *Why:* R-9, R-21: migrations, seed and re-check only after your approval; nightly drift reads with read-only
    credentials.
  - *Unblocks:* acceptance 7, 12, 14; AUTH-00 re-check.
  - *Verify (Claude):* `gh api repos/thecliniqai/cliniqai-app/environments --jq '.environments[] | {name, rules: [.protection_rules[].type]}'`;
    `gh secret list --env staging` and `--env staging-readonly` (names only); `gh variable list --env staging`.

- [ ] **03-E11 · Supabase fine-grained read-only token**
  - *Do / where:* Supabase → Account → Access Tokens → fine-grained token `clinicos-staging-drift-ro`, permission
    **Auth config: read** (plus project metadata read if offered), scoped to organisation `clinicos-staging`, 90-day
    expiry → GitHub Environment `staging-readonly` secret `SUPABASE_ACCESS_TOKEN_STAGING_RO`.
  - *If no scoped read-only token is offered:* do **not** create a classic (account-wide) token. Tell Claude; the
    `auth-config` drift job moves to the approved `staging` Environment in a reviewed change, and until then it stays
    failing and is recorded in VERIFICATION_LOG.
  - *Why:* AUTH-02 hosted drift without a write-capable token.
  - *Unblocks:* acceptance 12.
  - *Verify (Claude):* the `drift.yml` `auth-config` job runs green after merge (`gh run view <id> --json jobs`).

- [d] **03-E13 · Confirm the V2-03 rulings** — also the review rulings in `.planning/phases/03-platform-hygiene/03-13-REVIEW-TRIAGE.md`: **R-35** password reset ends signed out (deviates from AUTH_REDESIGN), **R-36** email OTP length 8, and the accepted-risk table; read the rulings table at the end of this plan (A00-1…A00-5, R-1…R-34,
  - **Delegated to CTO by the PO on 2026-11-13 ("for the rest, I trust your judgement"); the rulings stand as written. Revisit at go-live if needed.**
  R-K) and confirm or overturn them; in particular **R-9** (CLAUDE.md says "never `db push`"; staging migrations would run
  only in the PO-approved `staging` Environment workflow that agents never dispatch) and the proposed CLAUDE.md Commands
  update (phase close step 6). *Verify:* your confirmation recorded in VERIFICATION_LOG's gate section.
- [d] **03-E14 · Confirm two flagged packages** — `@aws-sdk/client-sesv2@3.1155.0` and `@marsidev/react-turnstile@1.6.2`
  - **Delegated to CTO by the PO on 2026-11-13 ("for the rest, I trust your judgement"); the rulings stand as written. Revisit at go-live if needed.**
  (research verdict SUS "too-new", older pins taken). Review `evidence/package-legitimacy.json` (registry metadata,
  integrity, `npm audit signatures`). Blocks the merge, not local work (R-23). *Verify:* confirmation recorded.
- [d] **03-E15 · Confirm the Next 16 outcome** — the upgrade record `03-06-NEXT16.md`, or, if the fallback ran, the
  - **Delegated to CTO by the PO on 2026-11-13 ("for the rest, I trust your judgement"); the rulings stand as written. Revisit at go-live if needed.**
  deferral `03-06-NEXT16-DEFERRAL.md` with its 2026-12-14 re-check. *Verify:* confirmation recorded.
- (03-E12 = existing C-1, repo visibility; no new action.)

## V2-04 Jobs reliability

Source: `.planning/phases/04-jobs-reliability/04-PLAN.md` §PO actions (verbatim, revised 2026-11-13 post V2-03). Phase in progress.

The orchestrator copies these into `.planning/PO-ACTIONS.md` under "V2-04 Jobs reliability". No secret value appears
here; secrets go only into the named store. Values in angle brackets are filled by the PO. **Order (lead times):** the
AWS track first — 04-P2 → P3 → P7 → P4 → P5 → P6 (can start before the merge; nothing in the repo waits on it); at the
gate 04-P14, P15; 04-P16 any time before the merge (else right after it); after the merge 04-P1 (before approving
the staging migrate run) → P8 → P9 → P10 → ≥ 48 h of running → P11, P12, P13. None of these blocks local work or the gate except P15 (merge) — R-19 pattern from V2-03.

- [ ] **04-P1 · Confirm pg_cron, pg_net and Vault on the staging Free project**
  - *Do / where:* Supabase Dashboard → project `clinicos-staging` (03-E2) → SQL Editor → run
    `select name, default_version, installed_version from pg_available_extensions where name in ('pg_cron','pg_net','supabase_vault') order by 1;`
    and paste the output. Do not enable anything by hand; migration `000033_jobs_scheduler.sql` does it. Then approve
    the `staging.yml` `migrate` run for the V2-04 merge commit **right away**: V2-04's code needs its own migrations
    (R-38), so until the run finishes staging answers `/api/ready` 503 with `checks.schema: "behind"` (runbook
    `docs/runbooks/staging.md` §6, "migrate before promote").
  - *Values:* none.
  - *Why:* roadmap §9.1 — availability on Free is not stated by Supabase (A1). The migration fails loudly where an
    extension is missing (R-34).
  - *Unblocks:* approving the first `staging.yml` migrate run that contains `000033_jobs_scheduler.sql`; acceptance 3,
    4, 7.
  - *Verify (Claude, read-only):* three rows in the pasted output; after the approved run, `gh run view <run id> --json
    conclusion,jobs` → success (its `wait-for-release` step requires `checks.schema: "current"`); recorded in
    VERIFICATION_LOG.

- [d] **04-P2 · AWS account baseline in `ap-south-1` (shared with SES, 03-E6)**
  - **Superseded by B-3 (R2 for staging): see environment.txt.example §E. The R2 steps replace this item when 04-05a is switched to R2.**
  - *Do / where:* AWS console: root user MFA; an admin role or IAM Identity Center user for yourself (do not use root);
    default region **Asia Pacific (Mumbai) `ap-south-1`**; Billing → Budgets → monthly cost budget US$10 with an email
    alert to the ops inbox (04-P7).
  - *Why:* FT-02 runs in AWS `ap-south-1` (PO-23(h)); Claude never holds AWS credentials (R-14).
  - *Unblocks:* 04-P4, P5.
  - *Verify (you paste, read-only, CloudShell in Mumbai):* `aws sts get-caller-identity --query Arn --output text` (not
    a root ARN) and `aws budgets describe-budgets --account-id $(aws sts get-caller-identity --query Account --output
    text) --query 'Budgets[].BudgetName'`.

- [d] **04-P3 · Two age key pairs for staging backups**
  - **Superseded by B-3 (R2 for staging): see environment.txt.example §E. The R2 steps replace this item when 04-05a is switched to R2.**
  - *Do / where:* on your machine: install age v1.3.2 (`brew install age`, or the release in `ops/bin/pins.env`); run
    `age-keygen -o clinicos-staging-primary.agekey` and `age-keygen -o clinicos-staging-breakglass.agekey`; store the
    primary file in your password manager and the break-glass file sealed offline; delete the local files.
  - *Values:* give Claude only the two **public** recipient lines (`age1…`, printed by `age-keygen`; public by design).
    Production gets separate pairs in V2-15.
  - *Why:* R-3 — losing one key never loses the backups.
  - *Unblocks:* 04-P5 (`AgeRecipients`), 04-P13.
  - *Verify (Claude):* `npx tsx ops/backup/render.ts --check-recipients <r1>,<r2>` (format, two distinct keys); the
    final proof is 04-P13 (decrypt with each key).

- [d] **04-P4 · Staging backup credentials in SSM Parameter Store (+ S3 protocol check)**
  - **Superseded by B-3 (R2 for staging): see environment.txt.example §E. The R2 steps replace this item when 04-05a is switched to R2.**
  - *Do / where:* Supabase staging → Connect → **Session pooler** URI (port 5432, includes the DB password) and Storage →
    Settings → S3 connection (enable the S3 protocol, create an access key; note the endpoint and region). AWS console
    (Mumbai) → Systems Manager → Parameter Store → create, Standard tier: SecureString
    `/clinicos/staging/backup/db_url`, `/clinicos/staging/backup/storage_s3_key_id`,
    `/clinicos/staging/backup/storage_s3_secret`; String `/clinicos/staging/backup/storage_s3_endpoint`
    (`https://<ref>.storage.supabase.co/storage/v1/s3`) and `/clinicos/staging/backup/storage_s3_region`.
  - *Why:* FT-02; the session pooler works from CodeBuild without IPv6 (A4); the S3 keys are used read-only by the sync.
  - *Unblocks:* the first backup run (04-P5).
  - *Verify (you paste):* `aws ssm describe-parameters --parameter-filters Key=Name,Option=BeginsWith,Values=/clinicos/staging/backup/ --query 'Parameters[].[Name,Type]' --output text`
    → five names, no values. If Storage offers no S3 protocol on Free, say so (risk K-5).

- [d] **04-P5 · Deploy the staging backup stack**
  - **Superseded by B-3 (R2 for staging): see environment.txt.example §E. The R2 steps replace this item when 04-05a is switched to R2.**
  - *Do / where:* CloudShell (Mumbai): upload `ops/backup/stack.json` from `feature/v2`; `aws cloudformation
    validate-template --template-body file://stack.json`; `aws cloudformation deploy --stack-name
    clinicos-staging-backup --template-file stack.json --capabilities CAPABILITY_NAMED_IAM --parameter-overrides
    Environment=staging AgeRecipients=<age1…>,<age1…> AlertEmail=<04-P7 inbox> GitHubRepository=thecliniqai/cliniqai-app
    GitHubEnvironment=staging-readonly CreateGitHubOidcProvider=true` (set `false` if the account already has the GitHub
    OIDC provider); confirm the SNS subscription email; start one build: `aws codebuild start-build --project-name
    clinicos-staging-backup`.
  - *Why:* FT-02 (R-14).
  - *Unblocks:* acceptance 5, 6; 04-P6, P11, P13.
  - *Verify (you paste, read-only):* `aws cloudformation describe-stacks --stack-name clinicos-staging-backup --query
    'Stacks[0].[StackStatus,Outputs]'`; `aws s3api get-bucket-versioning --bucket <BucketName>`; `aws s3api
    get-bucket-lifecycle-configuration --bucket <BucketName>`; `aws s3api get-bucket-encryption --bucket <BucketName>`;
    `aws s3api get-public-access-block --bucket <BucketName>`; `aws s3api get-bucket-location --bucket <BucketName>`;
    `aws scheduler get-schedule --name clinicos-staging-backup --query
    '{e:ScheduleExpression,tz:ScheduleExpressionTimezone,state:State}'`; `aws sns list-subscriptions-by-topic
    --topic-arn <TopicArn> --query 'Subscriptions[].SubscriptionArn'` (not `PendingConfirmation`); `aws codebuild
    batch-get-builds --ids <id> --query 'builds[0].buildStatus'` → `SUCCEEDED`. From 04-P6 on Claude reads the same
    through the `backup-evidence` artifact.

- [d] **04-P6 · GitHub variables for backup evidence**
  - **Superseded by B-3 (R2 for staging): see environment.txt.example §E. The R2 steps replace this item when 04-05a is switched to R2.**
  - *Do / where:* repo `thecliniqai/cliniqai-app` → Settings → Environments → `staging-readonly` (03-E10) → Variables
    (not secrets): `AWS_BACKUP_EVIDENCE_ROLE_ARN` = output `EvidenceRoleArn`, `AWS_REGION=ap-south-1`, `BACKUP_BUCKET` =
    output `BucketName`, `BACKUP_PROJECT=clinicos-staging-backup`, `BACKUP_TOPIC_ARN` = output `TopicArn`.
  - *Why:* tool-produced bucket listing (names and sizes) without AWS keys anywhere.
  - *Unblocks:* acceptance 5 evidence.
  - *Verify (Claude):* `gh variable list --env staging-readonly -R thecliniqai/cliniqai-app`; after the next scheduled
    run `gh run list --workflow backup-evidence.yml --limit 1 --json conclusion,url,headSha` and `gh run download <id>
    -n backup-evidence`, then `npx tsx ops/backup/evidence.ts --check <file>`.

- [ ] **04-R2 · Staging backups on Cloudflare R2 (replaces 04-P2…P6; PO decision B-3; ruling R-48). Low priority: only after staging exists**
  - *Do / where:* (1) Cloudflare → R2 → create bucket `clinicos-staging-backups` (no public access; location hint
    Asia-Pacific) → Settings → Object lifecycle: delete objects 30 days after upload. (2) R2 → Manage API tokens →
    `clinicos-staging-backup`, **Object Read & Write**, this bucket only. (3) Supabase staging → Storage → S3 connection
    → enable and create an access key. (4) GitHub → Settings → Environments → **`staging-backup`**: no required
    reviewer, deployment branches `feature/v2` only. Secrets: `BACKUP_S3_ENDPOINT`
    (`https://<account-id>.r2.cloudflarestorage.com`), `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`,
    `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_AGE_RECIPIENTS` (two age public keys, 04-P3), `STAGING_STORAGE_S3_KEY_ID`,
    `STAGING_STORAGE_S3_SECRET`, `STAGING_BACKUP_DB_URL` (same value as `STAGING_DB_URL`). Variables:
    `STAGING_STORAGE_S3_REGION`, `SUPABASE_PROJECT_REF_STAGING`. (5) Make the two age key pairs (04-P3; private keys
    stay offline). (6) Watch repo Issues from the ops inbox ("Staging backup failing").
  - *Why:* FT-02 twice-daily encrypted backups without paying for AWS before go-live.
  - *Verify (Claude):* `gh api repos/thecliniqai/cliniqai-app/environments --jq '.environments[].name'` includes
    `staging-backup`; `gh secret list --env staging-backup` (names only); after merge, the first scheduled `backup.yml`
    run is green and the drills follow (04-P11, 04-P13; runbook `docs/runbooks/backup-restore.md` §7).
  - *Accepted risks until go-live (owner V2-15):* no R2 versioning, the token can delete, no India region, a
    `postgres` URL in an Environment with no reviewer. Staging data is synthetic.

- [ ] **04-P7 · Monitored ops inbox**
  - *Do / where:* choose an address you read daily (e.g. `ops@<domain>` from 03-E0). (a) Supabase organisation
    `clinicos-staging` → Settings → billing/notification email = this address (pause and quota warnings, FT-03);
    (b) SES (03-E6): while in the sandbox, verify it as a recipient; (c) use it for `AlertEmail` (04-P5) and
    `OPS_ALERT_EMAIL` (04-P8).
  - *Why:* R-1 (email only); FT-03 pause warnings.
  - *Unblocks:* acceptance 4; backup failure emails.
  - *Verify (you paste):* `aws sesv2 get-email-identity --email-identity <address> --region ap-south-1 --query
    VerifiedForSendingStatus` → `true` (sandbox); receipt of the SNS confirmation (04-P5) and the drill email (04-P12).

- [ ] **04-P8 · Vercel staging environment for jobs**
  - *Do / where:* Vercel → `clinicos-staging` → Settings → Environment Variables (the environment that serves
    `feature/v2`): `JOBS_RUNNER_SECRET` = output of `openssl rand -hex 32` (sensitive; a new value, never the
    `CRON_SECRET`: the app refuses to boot when they are equal; the same value goes to Vault in 04-P9; it is never sent
    over the wire, the scheduler sends a 2-minute HMAC token derived from it, R-49); `OPS_ALERT_EMAIL=<04-P7 address>`; `MESSAGING_PROVIDER=sink` (replaces `disabled`, R-9);
    `JOBS_DRILL_ENABLED=false`; `EMAIL_PROVIDER=ses` once 03-E6/E8 are done (until then alerts stay visible in the
    report only). Keep `CRON_SECRET` (diag route, R-27). Redeploy.
  - *Why:* R-9, R-17, R-32.
  - *Unblocks:* 04-P9, P12; acceptance 3, 4.
  - *Verify (Claude, read-only):* `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://staging.thecliniqai.com/api/jobs/run`
    → `401` (no secret, no side effect); `curl -s https://staging.thecliniqai.com/api/ready` → `"status":"ready"`,
    `checks.schema` `"current"`, `providers.messaging` `"disabled"` (sink) and a `jobs` block of four booleans (no
    counts: V2-03 M-PROBE).

- [ ] **04-P9 · Scheduler secrets in staging Vault + answer OI-3**
  - *Do / where:* after the approved migrate run with `000033` and `000034`: staging SQL Editor:
    `select vault.create_secret('<the 04-P8 JOBS_RUNNER_SECRET value>', 'jobs_runner_secret');` and
    `select vault.create_secret('https://staging.thecliniqai.com/api/jobs/run', 'jobs_runner_url');`. OI-3: Vercel (v1 and
    staging projects) → Settings → Cron Jobs — any entries? any external pinger calling `/api/cron/*`? (those routes
    now answer 404).
  - *Why:* C22; secrets never in migrations or git.
  - *Unblocks:* acceptance 3, 4, 7 (runner traffic, alert delivery).
  - *Verify (you paste, read-only):* `select name, created_at, updated_at from vault.secrets where name like 'jobs_runner_%';`
    → 2 rows, no values. Claude, after 04-P10: `ops-report` artifact shows ≥ 50 ok runner runs in the last hour.

- [ ] **04-P10 · Read-only grants for the ops report**
  - *Do / where:* staging SQL Editor: the two statements in `docs/runbooks/jobs.md` §"Ops report" (`grant usage on schema
    ops to clinicos_drift_ro; grant execute on function ops.report_all(integer) to clinicos_drift_ro;` — the read-only
    role from `docs/runbooks/staging.md` §3, already used by `STAGING_DB_URL_RO` in Environment `staging-readonly`).
    Then GitHub → Actions → `ops-report` → Run workflow (or wait for the daily run; schedules fire only once the
    default branch is `feature/v2`, RL-3).
  - *Why:* R-28 — staging evidence produced by a tool with a role that can read counts only.
  - *Unblocks:* evidence for acceptance 3, 4, 7, 8.
  - *Verify (Claude):* `gh run list --workflow ops-report.yml --limit 1 --json conclusion,url,headSha`; `gh run download
    <id> -n ops-report`; `npx tsx scripts/ops/check-ops-report.ts <file> --require heartbeat,quota`.

- [ ] **04-P11 · Backup failed-run drill**
  - *Do / where:* after ≥ 2 days of scheduled runs, CloudShell: `aws codebuild start-build --project-name
    clinicos-staging-backup --environment-variables-override name=FORCE_FAIL,value=1,type=PLAINTEXT`; confirm the SNS
    "FAILED" email arrives (forward its subject line).
  - *Why:* acceptance 5 ("a deliberately failed run raises an alert").
  - *Unblocks:* acceptance 5.
  - *Verify (Claude):* the next `backup-evidence` artifact shows that build `FAILED` with the `FORCE_FAIL` override name,
    `failed_run_alerted = true` (SNS delivered count in that window) and `twice_daily_ok = true`.

- [ ] **04-P12 · Staging alert drill and lag load**
  - *Do / where:* after 04-P8…P10 and ≥ 24 h of runner traffic: (1) Vercel `JOBS_DRILL_ENABLED=true`, redeploy; (2) SQL
    Editor: `select ops.drill_enqueue('drill.noop', 300, interval '6 hours');` and `select
    ops.drill_enqueue('drill.always_fail', 1, interval '0', 2);`; (3) within about 15 min an email
    "[clinicos staging] WARN dead_letter" arrives; (4) after 6 h set `JOBS_DRILL_ENABLED=false`, redeploy, run
    `ops-report`.
  - *Why:* acceptance 3 and 4.
  - *Unblocks:* acceptance 3, 4; evidence "the staging alert-drill record".
  - *Verify (Claude):* `npx tsx scripts/ops/check-ops-report.ts <ops-report file> --require lag,alert-drill` passes (lag
    p95 < 120 s with ≥ 100 samples; a notified `dead_letter` alert with a provider id); recorded in VERIFICATION_LOG.

- [ ] **04-P13 · First restore drill from a staging backup**
  - *Do / where:* on your machine (Docker running, repo at `feature/v2`): S3 console → backup bucket → `staging/` →
    download the newest `.tar.age` to a folder outside the repo; export the primary key from your password manager to
    a file outside the repo; run `ops/restore-drill/run.sh --dump <file> --identity <primary key file> --evidence
    .planning/phases/04-jobs-reliability/evidence/restore-drill-staging.json`; then once `ops/restore-drill/run.sh
    --dump <file> --identity <break-glass key file> --decrypt-only`; delete the archive and key files afterwards.
  - *Why:* acceptance 6; keys and real dumps never enter an agent session (R-29).
  - *Unblocks:* acceptance 6; evidence "the restore-drill record in VERIFICATION_LOG".
  - *Verify (Claude):* `npx tsx ops/restore-drill/check-evidence.ts .planning/phases/04-jobs-reliability/evidence/restore-drill-staging.json`
    → pass (all checks green, RPO ≤ 12 h, RTO ≤ 4 h, counts only); VERIFICATION_LOG entry written from the file.

- [d] **04-P14 · Confirm the V2-04 rulings** — the rulings table below (R-1…R-47), in particular R-6 (revised: the
  - **Delegated to CTO by the PO on 2026-11-13 ("for the rest, I trust your judgement"); the rulings stand as written. Revisit at go-live if needed.**
  enqueue RPCs take the session's active tenant as a constraint; ADR-0005 amendment A2 in `04-ADR0005-PROPOSALS.md`
  replaces D3's "accepts no tenant argument"), R-7 (TARGET §8 erratum: `dedupe_key` NOT NULL), R-26 (test ping
  becomes queued; event data built in SQL), R-27 (CRON_SECRET kept), R-34 (pg_cron confirmation at the staging apply),
  R-38 (contract in the same PR), R-40 (SES bounce webhook moves to V2-12), R-41 (revised: `/api/ready` gains four
  booleans, no counts), R-43 (Send Email hook dedupe through the system client; ADR-0005 amendment A3), R-44 (`private`
  definer writers), R-47 (04-00 hardening choices). *Verify:* your confirmation recorded in VERIFICATION_LOG's gate section.
- [d] **04-P15 · Confirm the pinned artefacts** — `msw@3.0.3` (research verdict SUS "too-new", older pin taken),
  - **Delegated to CTO by the PO on 2026-11-13 ("for the rest, I trust your judgement"); the rulings stand as written. Revisit at go-live if needed.**
  age v1.3.2 SHA-256 values, the `postgres:17` and `amazon/aws-cli` digests, the `configure-aws-credentials` SHA.
  Review `evidence/package-legitimacy.json` and `evidence/pins.json`. Blocks the **merge**, not local work (V2-03
  R-23 pattern). *Verify:* confirmation recorded.

- [ ] **04-P16 · Read grant on the migration history for the `plan` job (04-00, review A L-5)**
  - *Do / where:* any time (best before the V2-04 merge; moot until staging is live), staging SQL Editor: the two
    statements in `docs/runbooks/staging.md` §3 (`grant usage
    on schema supabase_migrations to clinicos_drift_ro; grant select on supabase_migrations.schema_migrations to
    clinicos_drift_ro;`). Nothing else changes for the role (still no table or function grant in `public`).
  - *Values:* none.
  - *Why:* the new `plan` job (Environment `staging-readonly`) lists the pending migrations from the read-only URL before
    you approve `migrate`, so the approval is no longer blind (review A L-5).
  - *Unblocks:* the `plan` job on every `staging.yml` run from the V2-04 merge on; without the grant `plan` fails and
    `migrate` (which `needs: plan`) does not start.
  - *Verify (Claude, read-only):* `gh run view <staging.yml run id> --json jobs` → `plan` success; its summary lists
    migration file names and a count only; recorded in VERIFICATION_LOG.

**No PO action needed for:** the queue, scheduler and alert code and their local tests, the MSG91 MSW contracts, the
local backup self-test and drill, the template and its policy checks, the workflows' code.

## V2-05 Database authorisation & entitlements

Source: `.planning/phases/05-db-authorisation-entitlements/05-PLAN.md` §PO actions (verbatim, revised 2026-11-13 post V2-03). Plans written; not started.

The orchestrator copies these into `.planning/PO-ACTIONS.md` under "V2-05 Database authorisation, integrity &
entitlements". No secret value appears here. Nothing below blocks local work; 05-P1 blocks the merges; 05-P2…05-P5
and 05-P7 are hosted steps that run after a merge (V2-03 R-19 pattern). They assume V2-03's staging items (E2, E4, E10) are done; if
staging is not live yet, 05-P2/05-P3 are moot until it is (the first bring-up applies every migration).

- [d] **05-P1 · Confirm the V2-05 rulings**
  - **Delegated to CTO by the PO on 2026-11-13 ("for the rest, I trust your judgement"); the rulings stand as written. Revisit at go-live if needed.**
  - *Do / where:* read the rulings table at the end of this plan and confirm or overturn them in chat. In particular:
    **R-1** (stacked PRs: 05a's PR targets the V2-04 branch and 05b's targets 05a, a deviation from CLAUDE.md's "branches
    off `feature/v2`"); **R-2/R-3** (schema change: clinical notes **and vitals** move from `visits` to a new
    `clinical_notes` table); **R-6/R-7/R-8/R-9** (receptionist: register, `billing:view`, `billing:collect`; doctors and
    nurses stop collecting; doctors keep own-visit invoices and Sign & Bill "send to reception"; receptionists/admins
    edit patient demographics only but still **see** allergies on the patient record; admins have no clinical access);
    **R-10** (`saas_*`, `billing_profiles`, `provider_webhook_events` created in V2-13b); **R-15** (diagnostics on the
    local stack only, replacing the roadmap's test-project run); **R-31** (J-A6/J-A2 Playwright move to V2-11); PO-25
    (still open: the default "AI preview ends with the trial" is what acceptance 13 tests; changing it is one seed row);
    the CLAUDE.md Commands proposal (05b close step 6); the doc errata list (R-38). **Added 2026-11-13 (post V2-03):**
    **R-42** (RLS helpers and RPCs bind the session's **active** clinic through a request header the server sets from
    the clinic cookie — a multi-clinic user sees one clinic's data at a time; fallback carrier is a JWT claim from the
    existing token hook); **R-43** (staff removal deletes the user's sessions inside the removal RPC; a hosted refusal
    leaves the 900 s token expiry as the bound); **R-44** (ADR-0005 amendment A4: the invite-acceptance module may call
    the Auth admin system module); **R-45** (lab file keys carry ids only, no patient names; no overwrite);
    **R-46** (server-side Turnstile check for invite acceptance; new env `TURNSTILE_SECRET_KEY`, 05-P7); **R-47**
    (per-role statement timeouts pinned by test).
  - *Why:* the PO delegated these to Claude as CTO; CLAUDE.md requires raising schema and role changes.
  - *Unblocks:* merging 05a (R-1…R-9, R-15) and 05b (the rest).
  - *Verify (Claude):* the confirmation is recorded in `docs/v2/VERIFICATION_LOG.md` (V2-05 gate section) with the date.

- [ ] **05-P2 · Approve the staging migration run for 05a**
  - *Do / where:* after the 05a PR merges into `feature/v2`: GitHub → `thecliniqai/cliniqai-app` → Actions → workflow
    `staging.yml` → the run for the merge commit → "Review deployments" → approve Environment `staging`.
  - *Values:* none (the workflow uses the Environment's secrets).
  - *Why:* staging must run the switched app (clinical notes read from `clinical_notes`, tokens from `next_queue_token`)
    before 05b drops the old columns and function (R-37).
  - *Unblocks:* merging 05b (05-b0 precondition).
  - *Verify (Claude, read-only):* `gh run list --workflow staging.yml --branch feature/v2 --limit 1 --json
    conclusion,headSha,url` → `success` at the 05a merge SHA (its `plan` job lists the 05a files; its `wait-for-release`
    step requires `checks.schema: "current"`); `curl -s https://staging.thecliniqai.com/api/ready` → `"status":"ready"` and
    `checks.schema` `"current"` (since V2-03 03-13c the probe returns no migration version: the deployed build reports
    whether its own `EXPECTED_MIGRATION`, the newest 05a file, is applied).

- [ ] **05-P3 · Approve the staging migration run for 05b, then re-seed staging**
  - *Do / where:* after the 05b PR merges: approve the `staging.yml` run for the merge commit as in 05-P2; then Actions →
    `staging.yml` → "Run workflow" on `feature/v2` with task `seed` → approve Environment `staging`.
  - *Why:* 05b makes access subscription-aware. Existing staging clinics are backfilled `incomplete` (onboarding only);
    the idempotent seed sets the synthetic clinics to `active` with `comp_until` one year ahead (R-24, R-25).
  - *Unblocks:* using staging after V2-05; G3 evidence.
  - *Verify (Claude, read-only):* both runs `success` (`gh run list --workflow staging.yml --limit 2 --json
    conclusion,displayTitle,url`); `gh run view <seed run id> --log` contains `access summary: full=<n> locked=0
    onboarding=0` (counts only); `/api/ready` → `checks.schema` `"current"` for the 05b merge build. You confirm one
    sign-in on staging lands on the dashboard, not `/billing/locked`.

- [ ] **05-P4 · Confirm the hosted result for deleting `auth.sessions` rows**
  - *Do / where:* nothing new to run: confirm the AUTH-00 staging re-check result recorded by V2-03 (03-12c kit
    `scripts/staging/auth00-recheck.ts`, **item 4** "postgres DELETE privilege on auth.sessions", dispatched as
    `staging.yml` task `recheck`). If it shows the delete is **denied** on hosted Supabase, accept the documented
    fallback for staff removal: `remove_member` still removes the membership (its session delete is fail-soft and
    records `sessions_revoked: null`), data access stops immediately through membership status in RLS, and the session
    ends within the 900 s access-token lifetime (AUTH §3.6).
  - *Why:* the in-RPC session delete (05-05, R-43) is proven locally only (research A9).
  - *Unblocks:* closing acceptance 4's hosted note.
  - *Verify (Claude):* the V2-03 re-check entry in `docs/v2/VERIFICATION_LOG.md`; your acceptance of the fallback (if
    needed) recorded next to it.

- [ ] **05-P5 · (Optional, not gating) One staff invite on staging**
  - *Do / where:* after 05-P3 and 05-P7, sign in on staging as the seeded owner, invite your own SES-verified address once (staff
    invite server action through the existing staff page or the runbook command), and open the email.
  - *Why:* acceptance 10 is proven locally with Mailpit; this shows the same path through SES.
  - *Verify:* you confirm exactly one email arrived and paste its `Authentication-Results` line (`dkim=pass`); Claude
    checks nothing else on the hosted project.

- [ ] **05-P6 · Gate approvals** — approve the 05a gate and then the 05b gate (reviews, evidence and
  `05a-VERIFICATION.md` / `05-VERIFICATION.md` links). *Verify:* recorded in VERIFICATION_LOG.

- [ ] **05-P7 · Turnstile secret for the app on staging (05-07b, R-46)**
  - *Do / where:* Vercel → `clinicos-staging` → Settings → Environment Variables (Production scope only, as 03-E4):
    `TURNSTILE_SECRET_KEY` = the **secret key** of the Turnstile widget `clinicos-staging` you created in 03-E7 (the
    same value already pasted into Supabase Auth's CAPTCHA settings; sensitive). Redeploy.
  - *Values:* the existing widget secret; no new widget.
  - *Why:* invite acceptance creates the account through the Auth admin API, which skips Supabase's CAPTCHA, so the
    app verifies the Turnstile token itself (AUTH §3.2). Without the value staging refuses every invite acceptance.
  - *Unblocks:* 05-P5 (the optional staging invite) and any invite acceptance on staging after the 05b merge.
  - *Verify (Claude, read-only):* `curl -s https://staging.thecliniqai.com/api/health` → 200 (the env schema accepted the
    value at boot); the acceptance itself is checked in 05-P5.
