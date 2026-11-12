# PO actions — single checklist

Everything that needs the PO (accounts, consoles, credentials, paid services, confirmations). Agents never wait on
these: the code ships behind interfaces with local/offline implementations and flags that default **off**.
Never put a secret value in this file. Secrets go into the named secret store only.

**How an item closes:** the PO does the step and says so → Claude verifies it (read-only API/CLI check or a test run)
→ ticks it with the evidence (command + result, date, commit SHA or CI link).

Legend: `[ ]` open · `[~]` PO says done, Claude verifying · `[x]` verified (evidence inline)

---

## Carried over from V2-01 / V2-02

- [ ] **C-1 · Make the GitHub repo private (after upgrading the org to GitHub Team)** — phase V2-01/V2-02
  - *Do:* github.com/organizations/thecliniqai/settings/billing → upgrade to **Team**; then repo
    `thecliniqai/cliniqai-app` → Settings → General → Danger zone → Change visibility → Private.
  - *Why:* the repo is PUBLIC (checked 2026-11-13: `visibility: PUBLIC`, org plan `free`). Security docs and review
    reports describe defences and deferred weaknesses. On the Free plan a private repo loses ruleset enforcement, so
    upgrade first (OA-3).
  - *Unblocks:* go-live checklist; safe publication of review reports.
  - *Verify:* `gh repo view thecliniqai/cliniqai-app --json visibility` → `PRIVATE`; `gh api orgs/thecliniqai -q .plan.name`
    → `team`; `gh api repos/thecliniqai/cliniqai-app/rulesets/27150224 -q .enforcement` → `active`.

- [ ] **C-2 · Confirm delegated rulings for V2-01 and V2-02** — phase V2-01/V2-02
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

- [ ] **03-E0 · Decide the final domain**
  - *Do / where:* choose the product domain for "ClinicQ" (PO-19) at your registrar; note whether DNS is hosted at the
    registrar or Cloudflare.
  - *Values:* `<domain>`; derived names `auth.<domain>` (email), `staging.<domain>` (staging app).
  - *Why:* PO-19 fixed the name and the `auth.` pattern but no domain is recorded (R-13).
  - *Unblocks:* 03-E4, 03-E5, 03-E6, 03-E7, 03-E8; the `{{STAGING_ORIGIN}}` value in `supabase/auth-policy.json`.
  - *Verify (Claude, read-only):* `dig +short NS <domain>`; record the domain in `docs/v2/VERIFICATION_LOG.md`.

- [ ] **03-E1a · Schema-only snapshot of the v1 test project (before pausing it)**
  - *Do / where:* on your machine, outside any agent session:
    `npx supabase db dump --schema-only --db-url "<v1 database URL from Dashboard → Connect>" -f <path outside the repo>/clinicq-v1-schema.sql`.
    Schema only, no data. Tell Claude the file path. Do not commit it.
  - *Why:* B1 requires a read-only drift report against the hosted project; a paused project cannot be dumped
    (pitfall 6).
  - *Unblocks:* acceptance item 3 hosted half; 03-E1b.
  - *Verify (Claude):* `node scripts/drift/hosted-dump-diff.mjs <path>` (local scratch DB only) → writes
    `.planning/phases/03-platform-hygiene/evidence/b1/hosted-drift.{txt,json}`; drift is documented, not reconciled
    (production is built from migrations, C26).

- [ ] **03-E1b · Pause the v1 test project "TheCliniQ"**
  - *Do / where:* Supabase Dashboard → project "TheCliniQ" → Project Settings → General → Pause project (or delete it
    if nothing else needs it).
  - *Why:* FT-01; the Free plan allows two active projects.
  - *Unblocks:* 03-E2.
  - *Verify (Claude):* `curl -s -o /dev/null -w "%{http_code}\n" "https://$(cat supabase/.temp/project-ref).supabase.co/auth/v1/health"`
    is not 200 (paused projects do not serve; assumption, confirmed by your screenshot of the paused state).

- [ ] **03-E1c · Unlink the local CLI from the v1 project**
  - *Do / where:* repo root: `npx supabase unlink` (after 03-E1a and 03-E1b).
  - *Why:* any CLI call without `--local` can otherwise target the hosted project (R-12, pitfall 2).
  - *Verify (Claude):* `test ! -e supabase/.temp/project-ref && echo unlinked`.

- [ ] **03-E2 · Staging Supabase organisation and project**
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
    **on**; secure password change **off**; email OTP expiry 600 s, length 6; minimum password length 10; **Require
    current password when updating: on**; access-token (JWT) expiry 900 s; rate limits email sent 60/h, sign-ups and
    sign-ins 30, token refreshes 150, token verifications 30; MFA TOTP on; Site URL `https://staging.<domain>`, no
    extra redirect URLs; security notification "password changed" on; email templates pasted from
    `supabase/templates/*.html` (used only by the SMTP fallback); CAPTCHA after 03-E7; Send Email hook after 03-E8.
  - *Why:* AUTH-02/03, A00-1, A00-4, A00-5; settings are applied by you, not pushed from CI (R-20).
  - *Unblocks:* acceptance 10, 12; AUTH-00 re-check.
  - *Verify (Claude):* after merge, `gh run list --workflow drift.yml --limit 1 --json conclusion,url,headSha` → the
    `auth-config` job is green; `gh run view <id> --log --job <auth-config job id>` shows 0 diffs.

- [ ] **03-E4 · Vercel staging project**
  - *Do / where:* Vercel → New Project from `thecliniqai/cliniqai-app`, name `clinicos-staging`; Production Branch
    `feature/v2`; custom domain `staging.<domain>` (DNS record from Vercel at your DNS host); Functions region `bom1`
    (also set by `vercel.json`); Deployment Protection off for the production domain (the Send Email hook must reach it;
    assumption A2) and preview deployments disabled. Environment variables (names; values from your secret stores):
    `APP_ENV=staging`, `NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (sensitive), `NEXT_PUBLIC_APP_URL=https://staging.<domain>`,
    `CRON_SECRET` (random, ≥ 32 chars), `MESSAGING_PROVIDER=disabled` (until MSG91 staging credentials exist),
    `AI_ENABLED=false`, `API_V1_ENABLED=false`, `EMAIL_PROVIDER=disabled` (switch to `ses` after 03-E6/03-E8),
    `EMAIL_FROM=no-reply@auth.<domain>`, `AWS_REGION=ap-south-1`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` of the 03-E6 IAM
    user, `SEND_EMAIL_HOOK_SECRET` (03-E8), `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (03-E7), `ERROR_INGEST_KEY` (03-E9),
    `PWNED_CHECK=on`, `DIAG_ERROR_ROUTE_ENABLED=false` (true only during 03-E9). Do **not** set `R2_*`,
    `STORAGE_PROVIDER`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (the schema rejects them). On the
    existing v1 Vercel project, stop building `v2/**` and `feature/v2` previews (or set `APP_ENV` there), because v2
    builds now fail without `APP_ENV`.
  - *Why:* P1-35a, FT-01 `bom1`, acceptance 1, 7, 13, 14.
  - *Unblocks:* 03-E8, 03-E9; acceptance 7, 8, 13, 14.
  - *Verify (Claude):* `curl -sI https://staging.<domain>/api/health` → 200 with `x-request-id`;
    `curl -s https://staging.<domain>/api/health` → `"region":"bom1"` and `"release"` equal to
    `git rev-parse origin/feature/v2`; `curl -s https://staging.<domain>/api/ready` → `"status":"ok"`.

- [ ] **03-E5 · DNS records for `auth.<domain>`**
  - *Do / where:* at your DNS host: the 3 SES Easy-DKIM CNAMEs `<token>._domainkey.auth.<domain>` (values from 03-E6);
    custom MAIL FROM `mail.auth.<domain>`: MX `10 feedback-smtp.ap-south-1.amazonses.com` and TXT
    `v=spf1 include:amazonses.com ~all`; DMARC TXT at `_dmarc.auth.<domain>`:
    `v=DMARC1; p=none; rua=mailto:<your inbox>` (tighten to `quarantine` after a clean week); the `staging` CNAME Vercel
    gives you.
  - *Why:* AUTH-03 DKIM pass.
  - *Unblocks:* acceptance 9.
  - *Verify (Claude):* `dig +short CNAME <token>._domainkey.auth.<domain>`; `dig +short MX mail.auth.<domain>`;
    `dig +short TXT mail.auth.<domain>`; `dig +short TXT _dmarc.auth.<domain>`.

- [ ] **03-E6 · Amazon SES in ap-south-1**
  - *Do / where:* AWS console, region Mumbai → SES → Identities → Create identity → Domain `auth.<domain>`, Easy DKIM
    RSA 2048, custom MAIL FROM `mail.auth.<domain>`; Account dashboard → **Request production access** (transactional,
    low volume, authentication codes); while in the sandbox, verify your own test recipient address; account-level
    suppression list on for bounces and complaints (R-10); IAM user `clinicos-staging-ses` with only `ses:SendEmail` on
    the identity ARN and condition `ses:FromAddress = no-reply@auth.<domain>`; its access key goes to Vercel (03-E4) only.
  - *Why:* AUTH-03, PO-A3; production access has lead time (AR-4).
  - *Unblocks:* acceptance 9; `EMAIL_PROVIDER=ses` on staging.
  - *Verify:* you paste the output of the read-only `aws sesv2 get-email-identity --email-identity auth.<domain>
    --region ap-south-1 --query "{verified:VerifiedForSendingStatus,dkim:DkimAttributes.Status}"` and
    `aws sesv2 get-account --region ap-south-1 --query ProductionAccessEnabled`; Claude checks the 03-E5 records with `dig`.

- [ ] **03-E7 · Cloudflare Turnstile widget**
  - *Do / where:* Cloudflare dashboard → Turnstile → Add widget `clinicos-staging`, hostname `staging.<domain>`, mode
    **Managed**, no pre-clearance. Site key → Vercel `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (03-E4). Secret key → Supabase
    staging → Authentication → Bot and Abuse Protection → Enable CAPTCHA → Turnstile → secret.
  - *Why:* C43; acceptance 10.
  - *Unblocks:* AUTH-00 re-check item 2.
  - *Verify (Claude):* the `drift.yml` `auth-config` job confirms CAPTCHA enabled with provider Turnstile;
    `curl -s -o /dev/null -w "%{http_code}\n" https://staging.<domain>/login` → 200. You confirm one browser sign-in on
    staging succeeds with the widget (recorded with re-check item 2).

- [ ] **03-E8 · Send Email hook on staging**
  - *Do / where:* Supabase staging → Authentication → Hooks → Send Email → HTTPS
    `https://staging.<domain>/api/auth/send-email` → generate the secret → Vercel `SEND_EMAIL_HOOK_SECRET`; set
    `EMAIL_PROVIDER=ses` in Vercel and redeploy. Then request a password reset on staging for your SES-verified address.
  - *Why:* AUTH-03; the magiclink drop (A00-1).
  - *Unblocks:* acceptance 9.
  - *Verify:* the `drift.yml` `auth-config` job shows the hook enabled with that URI; you paste the received mail's
    `Authentication-Results` line (expect `dkim=pass header.d=auth.<domain>`; the message holds only a synthetic code).

- [ ] **03-E9 · Error-sink ingest key on staging + one diag error**
  - *Do / where:* generate a key locally (`openssl rand -hex 32`) → Vercel `ERROR_INGEST_KEY`; compute its hash locally
    (`printf %s "<key>" | shasum -a 256`) and run in the staging SQL editor
    `select vault.create_secret('<sha256 hex>', 'ops_error_ingest_key_sha256');` (hash only). Set
    `DIAG_ERROR_ROUTE_ENABLED=true`, redeploy, run `curl -s -X POST -H "authorization: Bearer <CRON_SECRET>"
    -D - https://staging.<domain>/api/diag/error` (note `x-request-id`), run the export query from
    `docs/runbooks/error-sink.md` for that request id, save it as JSON, then set the flag back to `false`.
  - *Why:* acceptance 8 on staging; evidence "an `ops.error_events` row export with scrubbed fields".
  - *Verify (Claude):* `node scripts/ops/check-error-export.mjs <export file>` passes (allowed columns only, no
    scrub pattern); the export is committed under `evidence/`.

- [ ] **03-E10 · GitHub Environments `staging` and `staging-readonly`**
  - *Do / where:* repo `thecliniqai/cliniqai-app` → Settings → Environments. `staging`: required reviewer = you,
    deployment branches `feature/v2` only; secrets `STAGING_DB_URL` (direct/session URL with the DB password),
    `STAGING_SECRET_KEY`, `STAGING_SEED_PASSWORD`; variables `SUPABASE_PROJECT_REF_STAGING`, `STAGING_ORIGIN`
    (`https://staging.<domain>`). `staging-readonly`: no reviewer, branch `feature/v2`; secrets
    `SUPABASE_ACCESS_TOKEN_STAGING_RO` (03-E11), `STAGING_DB_URL_RO` (the read-only role from `docs/runbooks/staging.md`,
    password set by you); same variables.
  - *Why:* R-9, R-21: migrations, seed and re-check only after your approval; nightly drift reads with read-only
    credentials.
  - *Unblocks:* acceptance 7, 12, 14; AUTH-00 re-check.
  - *Verify (Claude):* `gh api repos/thecliniqai/cliniqai-app/environments --jq '.environments[] | {name, rules: [.protection_rules[].type]}'`;
    `gh secret list --env staging` and `--env staging-readonly` (names only); `gh variable list --env staging`.

- [ ] **03-E11 · Supabase fine-grained read-only token**
  - *Do / where:* Supabase → Account → Access Tokens → fine-grained token `clinicos-staging-drift-ro`, permission
    **Auth config: read** (plus project metadata read if offered), scoped to organisation `clinicos-staging`, 90-day
    expiry → GitHub Environment `staging-readonly` secret `SUPABASE_ACCESS_TOKEN_STAGING_RO`.
  - *Why:* AUTH-02 hosted drift without a write-capable token.
  - *Unblocks:* acceptance 12.
  - *Verify (Claude):* the `drift.yml` `auth-config` job runs green after merge (`gh run view <id> --json jobs`).

- [ ] **03-E13 · Confirm the V2-03 rulings** — read the rulings table at the end of this plan (A00-1…A00-5, R-1…R-34,
  R-K) and confirm or overturn them; in particular **R-9** (CLAUDE.md says "never `db push`"; staging migrations would run
  only in the PO-approved `staging` Environment workflow that agents never dispatch) and the proposed CLAUDE.md Commands
  update (phase close step 6). *Verify:* your confirmation recorded in VERIFICATION_LOG's gate section.
- [ ] **03-E14 · Confirm two flagged packages** — `@aws-sdk/client-sesv2@3.1155.0` and `@marsidev/react-turnstile@1.6.2`
  (research verdict SUS "too-new", older pins taken). Review `evidence/package-legitimacy.json` (registry metadata,
  integrity, `npm audit signatures`). Blocks the merge, not local work (R-23). *Verify:* confirmation recorded.
- [ ] **03-E15 · Confirm the Next 16 outcome** — the upgrade record `03-06-NEXT16.md`, or, if the fallback ran, the
  deferral `03-06-NEXT16-DEFERRAL.md` with its 2026-12-14 re-check. *Verify:* confirmation recorded.
- (03-E12 = existing C-1, repo visibility; no new action.)
