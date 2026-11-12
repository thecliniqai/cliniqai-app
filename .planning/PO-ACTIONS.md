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

## V2-04 Jobs reliability

Source: `.planning/phases/04-jobs-reliability/04-PLAN.md` §PO actions (verbatim). Plans are written; the phase is not started yet.

The orchestrator copies these into `.planning/PO-ACTIONS.md` under "V2-04 Jobs reliability". No secret value appears
here; secrets go only into the named store. Values in angle brackets are filled by the PO. **Order (lead times):** the
AWS track first — 04-P2 → P3 → P7 → P4 → P5 → P6 (can start before the merge; nothing in the repo waits on it); at the
gate 04-P14, P15; after the merge 04-P1 (before approving the staging migrate run) → P8 → P9 → P10 → ≥ 48 h of running
→ P11, P12, P13. None of these blocks local work or the gate except P15 (merge) — R-19 pattern from V2-03.

- [ ] **04-P1 · Confirm pg_cron, pg_net and Vault on the staging Free project**
  - *Do / where:* Supabase Dashboard → project `clinicos-staging` (03-E2) → SQL Editor → run
    `select name, default_version, installed_version from pg_available_extensions where name in ('pg_cron','pg_net','supabase_vault') order by 1;`
    and paste the output. Do not enable anything by hand; migration `<N+2>` does it.
  - *Values:* none.
  - *Why:* roadmap §9.1 — availability on Free is not stated by Supabase (A1). The migration fails loudly where an
    extension is missing (R-34).
  - *Unblocks:* approving the first `staging.yml` migrate run that contains `<N+2>_jobs_scheduler.sql`; acceptance 3,
    4, 7.
  - *Verify (Claude, read-only):* three rows in the pasted output; after the approved run, `gh run view <run id> --json
    conclusion,jobs` → success; recorded in VERIFICATION_LOG.

- [ ] **04-P2 · AWS account baseline in `ap-south-1` (shared with SES, 03-E6)**
  - *Do / where:* AWS console: root user MFA; an admin role or IAM Identity Center user for yourself (do not use root);
    default region **Asia Pacific (Mumbai) `ap-south-1`**; Billing → Budgets → monthly cost budget US$10 with an email
    alert to the ops inbox (04-P7).
  - *Why:* FT-02 runs in AWS `ap-south-1` (PO-23(h)); Claude never holds AWS credentials (R-14).
  - *Unblocks:* 04-P4, P5.
  - *Verify (you paste, read-only, CloudShell in Mumbai):* `aws sts get-caller-identity --query Arn --output text` (not
    a root ARN) and `aws budgets describe-budgets --account-id $(aws sts get-caller-identity --query Account --output
    text) --query 'Budgets[].BudgetName'`.

- [ ] **04-P3 · Two age key pairs for staging backups**
  - *Do / where:* on your machine: install age v1.3.2 (`brew install age`, or the release in `ops/bin/pins.env`); run
    `age-keygen -o clinicos-staging-primary.agekey` and `age-keygen -o clinicos-staging-breakglass.agekey`; store the
    primary file in your password manager and the break-glass file sealed offline; delete the local files.
  - *Values:* give Claude only the two **public** recipient lines (`age1…`, printed by `age-keygen`; public by design).
    Production gets separate pairs in V2-15.
  - *Why:* R-3 — losing one key never loses the backups.
  - *Unblocks:* 04-P5 (`AgeRecipients`), 04-P13.
  - *Verify (Claude):* `npx tsx ops/backup/render.ts --check-recipients <r1>,<r2>` (format, two distinct keys); the
    final proof is 04-P13 (decrypt with each key).

- [ ] **04-P4 · Staging backup credentials in SSM Parameter Store (+ S3 protocol check)**
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

- [ ] **04-P5 · Deploy the staging backup stack**
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

- [ ] **04-P6 · GitHub variables for backup evidence**
  - *Do / where:* repo `thecliniqai/cliniqai-app` → Settings → Environments → `staging-readonly` (03-E10) → Variables
    (not secrets): `AWS_BACKUP_EVIDENCE_ROLE_ARN` = output `EvidenceRoleArn`, `AWS_REGION=ap-south-1`, `BACKUP_BUCKET` =
    output `BucketName`, `BACKUP_PROJECT=clinicos-staging-backup`, `BACKUP_TOPIC_ARN` = output `TopicArn`.
  - *Why:* tool-produced bucket listing (names and sizes) without AWS keys anywhere.
  - *Unblocks:* acceptance 5 evidence.
  - *Verify (Claude):* `gh variable list --env staging-readonly -R thecliniqai/cliniqai-app`; after the next scheduled
    run `gh run list --workflow backup-evidence.yml --limit 1 --json conclusion,url,headSha` and `gh run download <id>
    -n backup-evidence`, then `npx tsx ops/backup/evidence.ts --check <file>`.

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
    `feature/v2`): `JOBS_RUNNER_SECRET` = output of `openssl rand -hex 32` (sensitive; the same value goes to Vault in
    04-P9); `OPS_ALERT_EMAIL=<04-P7 address>`; `MESSAGING_PROVIDER=sink` (replaces `disabled`, R-9);
    `JOBS_DRILL_ENABLED=false`; `EMAIL_PROVIDER=ses` once 03-E6/E8 are done (until then alerts stay visible in the
    report only). Keep `CRON_SECRET` (diag route, R-27). Redeploy.
  - *Why:* R-9, R-17, R-32.
  - *Unblocks:* 04-P9, P12; acceptance 3, 4.
  - *Verify (Claude, read-only):* `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://staging.<domain>/api/jobs/run`
    → `401` (no secret, no side effect); `curl -s https://staging.<domain>/api/ready` → `"status":"ok"` with the job
    counts present.

- [ ] **04-P9 · Scheduler secrets in staging Vault + answer OI-3**
  - *Do / where:* after the approved migrate run with `<N+2>`: staging SQL Editor:
    `select vault.create_secret('<the 04-P8 JOBS_RUNNER_SECRET value>', 'jobs_runner_secret');` and
    `select vault.create_secret('https://staging.<domain>/api/jobs/run', 'jobs_runner_url');`. OI-3: Vercel (v1 and
    staging projects) → Settings → Cron Jobs — any entries? any external pinger calling `/api/cron/*`? (those routes
    now answer 404).
  - *Why:* C22; secrets never in migrations or git.
  - *Unblocks:* acceptance 3, 4, 7 (runner traffic, alert delivery).
  - *Verify (you paste, read-only):* `select name, created_at, updated_at from vault.secrets where name like 'jobs_runner_%';`
    → 2 rows, no values. Claude, after 04-P10: `ops-report` artifact shows ≥ 50 ok runner runs in the last hour.

- [ ] **04-P10 · Read-only grants for the ops report**
  - *Do / where:* staging SQL Editor: the two statements in `docs/runbooks/jobs.md` §"Ops report" (`grant usage on schema
    ops to <read-only role from docs/runbooks/staging.md>; grant execute on function ops.report_all(integer) to <same
    role>;`). Then GitHub → Actions → `ops-report` → Run workflow (or wait for the daily run).
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

- [ ] **04-P14 · Confirm the V2-04 rulings** — the rulings table below (R-1…R-42), in particular R-6 (the ADR-0005 A2
  clarification in `04-ADR0005-A2-PROPOSAL.md`), R-7 (TARGET §8 erratum: `dedupe_key` NOT NULL), R-26 (test ping
  becomes queued; event data built in SQL), R-27 (CRON_SECRET kept), R-34 (pg_cron confirmation at the staging apply),
  R-38 (contract in the same PR), R-40 (SES bounce webhook moves to V2-12). *Verify:* your confirmation recorded in
  VERIFICATION_LOG's gate section.
- [ ] **04-P15 · Confirm the pinned artefacts** — `msw@3.0.3` (research verdict SUS "too-new", older pin taken),
  age v1.3.2 SHA-256 values, the `postgres:17` and `amazon/aws-cli` digests, the `configure-aws-credentials` SHA.
  Review `evidence/package-legitimacy.json` and `evidence/pins.json`. Blocks the **merge**, not local work (V2-03
  R-23 pattern). *Verify:* confirmation recorded.

**No PO action needed for:** the queue, scheduler and alert code and their local tests, the MSG91 MSW contracts, the
local backup self-test and drill, the template and its policy checks, the workflows' code.


## V2-05 Database authorisation & entitlements

Source: `.planning/phases/05-db-authorisation-entitlements/05-PLAN.md` §PO actions (verbatim). Plans are written; the phase is not started yet.

The orchestrator copies these into `.planning/PO-ACTIONS.md` under "V2-05 Database authorisation, integrity &
entitlements". No secret value appears here. Nothing below blocks local work; 05-P1 blocks the merges; 05-P2…05-P5 are
hosted steps that run after a merge (V2-03 R-19 pattern). They assume V2-03's staging items (E2, E4, E10) are done; if
staging is not live yet, 05-P2/05-P3 are moot until it is (the first bring-up applies every migration).

- [ ] **05-P1 · Confirm the V2-05 rulings**
  - *Do / where:* read the rulings table at the end of this plan and confirm or overturn them in chat. In particular:
    **R-1** (stacked PRs: 05a's PR targets the V2-04 branch and 05b's targets 05a, a deviation from CLAUDE.md's "branches
    off `feature/v2`"); **R-2/R-3** (schema change: clinical notes **and vitals** move from `visits` to a new
    `clinical_notes` table); **R-6/R-7/R-8/R-9** (receptionist: register, `billing:view`, `billing:collect`; doctors and
    nurses stop collecting; doctors keep own-visit invoices and Sign & Bill "send to reception"; receptionists/admins
    edit patient demographics only but still **see** allergies on the patient record; admins have no clinical access);
    **R-10** (`saas_*`, `billing_profiles`, `provider_webhook_events` created in V2-13b); **R-15** (diagnostics on the
    local stack only, replacing the roadmap's test-project run); **R-31** (J-A6/J-A2 Playwright move to V2-11); PO-25
    (still open: the default "AI preview ends with the trial" is what acceptance 13 tests; changing it is one seed row);
    the CLAUDE.md Commands proposal (05b close step 6); the doc errata list (R-38).
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
    conclusion,headSha,url` → `success` at the 05a merge SHA; `curl -s https://staging.<domain>/api/ready` →
    `latest_migration` equals the newest 05a migration file name.

- [ ] **05-P3 · Approve the staging migration run for 05b, then re-seed staging**
  - *Do / where:* after the 05b PR merges: approve the `staging.yml` run for the merge commit as in 05-P2; then Actions →
    `staging.yml` → "Run workflow" on `feature/v2` with task `seed` → approve Environment `staging`.
  - *Why:* 05b makes access subscription-aware. Existing staging clinics are backfilled `incomplete` (onboarding only);
    the idempotent seed sets the synthetic clinics to `active` with `comp_until` one year ahead (R-24, R-25).
  - *Unblocks:* using staging after V2-05; G3 evidence.
  - *Verify (Claude, read-only):* both runs `success` (`gh run list --workflow staging.yml --limit 2 --json
    conclusion,displayTitle,url`); `gh run view <seed run id> --log` contains `access summary: full=<n> locked=0
    onboarding=0` (counts only); `/api/ready` `latest_migration` = newest 05b file. You confirm one sign-in on staging lands
    on the dashboard, not `/billing/locked`.

- [ ] **05-P4 · Confirm the hosted result for deleting `auth.sessions` rows**
  - *Do / where:* nothing new to run: confirm the AUTH-00 staging re-check result recorded by V2-03 (03-12c kit, the
    `auth.sessions` delete item). If it shows the delete is **denied** on hosted Supabase, accept the documented
    fallback for staff removal: data access stops immediately through membership status in RLS, and the session ends
    within the 900 s access-token lifetime (AUTH §3.6).
  - *Why:* `revoke_user_sessions` (05-05) is proven locally only (research A9).
  - *Unblocks:* closing acceptance 4's hosted note.
  - *Verify (Claude):* the V2-03 re-check entry in `docs/v2/VERIFICATION_LOG.md`; your acceptance of the fallback (if
    needed) recorded next to it.

- [ ] **05-P5 · (Optional, not gating) One staff invite on staging**
  - *Do / where:* after 05-P3, sign in on staging as the seeded owner, invite your own SES-verified address once (staff
    invite server action through the existing staff page or the runbook command), and open the email.
  - *Why:* acceptance 10 is proven locally with Mailpit; this shows the same path through SES.
  - *Verify:* you confirm exactly one email arrived and paste its `Authentication-Results` line (`dkim=pass`); Claude
    checks nothing else on the hosted project.

- [ ] **05-P6 · Gate approvals** — approve the 05a gate and then the 05b gate (reviews, evidence and
  `05a-VERIFICATION.md` / `05-VERIFICATION.md` links). *Verify:* recorded in VERIFICATION_LOG.
