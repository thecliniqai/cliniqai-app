---
phase: "15"
roadmap_id: V2-15
name: Production readiness & UAT launch preparation
revision: "2026-11-28, first revision (CTO under the PO's delegation; deadline 6 Dec 2026 for everything except go-live)"
gate: "Code/docs gate (G4-style, one PR): one isolated release reviewer (Sonnet) over the runbooks, scripts and CI changes; an adversarial reviewer (Opus) over the production env guards, the approval-gated migration workflow, the reference seed and the secret-rotation checklist. G6 (UAT start) itself is NOT part of this phase's done: it needs the PO's external actions listed below and the PO's go/no-go."
requirements: ["V2_MASTER_ROADMAP §12.2 V2-15 (scope, expected changes, plans 15-01..15-06), §17.1 UAT-start checklist, §9.1 free-tier mode, §16 G6", "P0-07 (secret rotation, C49), P1-35b, P0-16b, FT-02/03/04 live, FT-08 runbook, P1-25 (uptime, drain), P1-38 (incident runbook, security.txt), P1-41 (k6 + Lighthouse), I-10, AUTH-03 production, PWA-09 budgets blocking, PWA-10 final device run", "SUB §14.8, SUB-COUPON-08 first part (uat campaign, codes, invite text, comp fallback and slip runbooks)", "Items routed to V2-15 by earlier phases (see 'Inherited items')"]
plans: ["15-01", "15-02", "15-03", "15-04", "15-05", "15-06", "close"]
order: "15-01 -> 15-02 -> 15-03 -> 15-04 -> 15-05 -> 15-06 -> reviews -> one fix round -> close"
preconditions: "V2-14 merged (G5). Nothing in this phase touches a hosted project: every hosted step is a PO action with a script that prints or verifies, run by the PO."
migrations: {"15-01": "000205_production_guards (only DB-side guards, e.g. a refusal of test-mode plan ids when platform_settings.environment = 'production')", "15-06": "000206_uat_campaign_support (only if the uat runbook needs a helper RPC)", "spare": "000207-000209"}
migrations_note: "Reserved 000205-000209. No seed data with PO-specific values goes into migrations (dates, plan ids, admin ids are runbook SQL run by the PO)."
new_dependencies: "No npm dependency. k6 as a pinned, checksum-verified CI binary (scripts/ci/install-k6.sh), why: P1-41 load test at the PO-13 scale; @lhci/cli is already a dev dependency."
branch: "v2/phase-15-production-readiness -> PR into feature/v2"
---

# V2-15 Production readiness & UAT launch preparation: plan

## Goal

Everything that can be done in code, CI, scripts, runbooks and local drills before the PO's go/no-go for UAT start is
done, so that the PO's remaining work is a short, ordered list of account actions, each with a script that verifies it.
Production is a new Supabase Free project in Mumbai in its own organisation, built only from migrations, configured by
checked-in config and verified by scripts; live Razorpay, real email, uptime monitoring, backups and the UAT campaign are
switched on by the PO following runbooks Claude wrote and drilled locally. The phase ends with a generated §17.1
checklist in which every code-side line links to CI evidence and every PO line names its runbook and verification
command.

Tracer: 15-01 first ships `node scripts/prod/check-readiness.mjs --local`, which runs the production-tier checks against
the local stack and a production build (env schema, `/api/v1` 404, no `rzp_test_` in production, reference rows present,
`TEST_NOW`/Fake unreachable) and prints the §17.1 lines it can prove; each later plan adds its lines to it.

## Decisions (CTO)

| # | Decision | Rationale |
|---|---|---|
| D-1 | Production email at UAT start uses **Resend** with its own production key and domain records; SES is switched in at V2-16 if wanted | PO decision 2026-11-13 ("Resend now, SES after go-live"); the provider seam exists (`lib/email`) |
| D-2 | Approval-gated migrations: a `production-migrate` GitHub workflow (manual dispatch, `production` environment with the PO as required reviewer, OIDC-less: the DB URL is an environment secret set by the PO) that runs `supabase db push --dry-run` output into the summary, waits for approval, takes an on-demand FT-02 dump, then applies. Agents never dispatch it | P1-35b; CLAUDE.md (agents never push to hosted DBs) |
| D-3 | Reference data on production comes from migrations (plans, prices without provider ids, entitlement keys, settings defaults: 000080-000086) plus one PO-run runbook SQL file `docs/runbooks/production-bootstrap.sql` (platform admin, live plan id, supplier facts, `uat` campaign) that calls only `platform.*` RPCs; the CDCI and diagnoses catalogues are loaded by the PO with the existing scripts pointed at production (PO action; agents never run `seed:cdci*`) | Inherited 09B/09C checklist lines; no PO-specific values in migrations |
| D-4 | k6 runs only against the local e2e server in CI (nightly) at the PO-13 scale (5 clinics × 3 users, think-time model from the RUM journeys) with the p95 targets from TEST_STRATEGY; a staging run is a PO-optional action | No tool targets hosted systems |
| D-5 | Lighthouse (LHCI) becomes blocking on Today and the consult (mobile, 4× CPU) with budgets recalibrated against the 128.8 kB framework floor (06-07 R-5) from three baseline runs; route-JS budgets blocking at measured ceilings | PWA-09, FE-9, P1-41; 09E kept ms report-only, LHCI is a separate deterministic-enough lane with 3 runs median |
| D-6 | Uptime: external monitors (PO account, e.g. UptimeRobot/Better Stack free) on `/api/health` and `/api/ready`; `/api/ready` gains provider checks (email, Razorpay key mode, messaging provider) without secrets in the body; rate-limited | P1-25; inherited `/api/ready` rate-limit item |
| D-7 | Log drain: none available on the free tiers at UAT; FT-07 in-app retention (≥ 180 days) is the record, the drain is a V2-16 item after the upgrade (R27 accepted in the risk register) | Free-tier reality; roadmap R27 |
| D-8 | Realtime sizing: a script computes signals/day and concurrent connections from clinics × devices × writes (RUM and 09E counts) against the Free limits and prints headroom; production RUM sampling 25 % | 09E hand-off |
| D-9 | `security.txt` at `/.well-known/security.txt` with the PO's security contact (placeholder until the PO supplies it; the readiness check fails while it is a placeholder) | P1-38 |
| D-10 | Release notes, in-app help (`/help`: role-based quick guides, support contact, UAT feedback channel link) and a rollback plan (Vercel instant rollback; forward-fix migrations; restore from the latest dump) are written here; the UAT feedback channel is a mailto/WhatsApp link set in `platform_settings` | §17.1 product and operations |

## CTO decisions needed

| # | Conflict | Source | Recommendation (default) |
|---|---|---|---|
| CTO-1 | The §17.1 restore drill restores "an FT-02 **production** dump into a local stack", but once UAT clinics enter real patient data that puts PHI on a workstation (04-PLAN R-42, open) | V2_MASTER_ROADMAP §17.1; 04-PLAN R-42; CLAUDE.md "treat every record as sensitive" | **Run the G6 drill on the production dump taken right after the production bootstrap (synthetic smoke data only, before any UAT clinic)**, which proves the full path with no PHI; from the first real clinic on, the monthly drills (V2-16) restore into an ephemeral, encrypted EC2 Docker host (no RDS) in AWS `ap-south-1` inside the backup account, destroyed after the drill, never on a laptop. 15-04 writes and drills that runbook locally |
| CTO-2 | Secret rotation (P0-07, C49) lists Gemini, Gupshup, Twilio and other `.env.example` names "if set"; agents may not read `.env*`, so Claude cannot know which are set | V2_MASTER_ROADMAP P0-07, §17.1 | **The PO runs `node scripts/prod/secret-inventory.mjs`, which reads only variable *names* from the PO's environment stores via their CLIs (never values) and prints the rotation checklist**; Claude never sees values. The checklist in `docs/ops/secret-rotation.md` is pre-filled from `.env.example` and the env schema |

## Inherited items (routed to V2-15)

| Item | Source | Plan |
|---|---|---|
| SES/Send Email hook in production; SES IAM keys → OIDC role (R-31) | 01-06, 03-11b | 15-02 (D-1: Resend now; the OIDC item moves to V2-16 with SES) |
| Production must not copy the synthetic-staging window pattern | 03 independent review | 15-01 readiness check (production tier refuses the staging-only switches) |
| Log drain, uptime monitor, production project | 03/04 research | 15-03 (D-6, D-7), 15-01 |
| Production FT-02 backups: AWS `ap-south-1`, object lock, IAM/OIDC, CloudFormation stack (`docs/ops/backup-aws-golive.md`, R-30 re-decided) | 04 | 15-04 (template + runbook; PO deploys) |
| R2 token can overwrite/delete (staging) | 04-07 | 15-04: production uses S3 with object lock and a write-only role; staging residual stays accepted |
| Production restore drill machine (R-42) | 04 | CTO-1 |
| Separate production `JOBS_RUNNER_SECRET` and secret pairs; `OPS_ALERT_EMAIL` required in production | 04-07c, 04-04 | 15-01 env schema (production tier requires them, refuses equality with staging-known values by hash list) |
| `/api/ready` rate limiting / WAF | 04 | 15-03 |
| `ops.error_events` DPDP erasure if ids are filled; MAU proxy | 04 wave notes | 15-03: assert ids stay null (test), else erase with the tenant (13C-04 map) |
| INT L-8: legacy lab object names > 255 chars check | 05a | moot for a new project; recorded as N/A in the checklist |
| LHCI/route-JS blocking, budget recalibration, Login LCP 3.6 s / Consult LCP 2.6 s, LHCI timeout | 06-07, 08 | 15-05 (D-5) |
| Skew Protection on the production plan (K-11) | 06 | 15-02 PO action (Vercel setting) with a verification step |
| PWA-10 final real-device run incl. R11, R12, R14, R15 | 08 device checklist | 15-06 (kit) + PO action |
| Real `opd_diagnoses` and the CDCI substance mapping on production | 09B, 09C | 15-01 (D-3) PO action with a row-count verification query |
| Realtime quota sizing; production RUM sampling | 09E | 15-03 (D-8) |

## Shared rules

09E and 13B shared rules apply. Additionally: every script that concerns a hosted system either prints commands for the
PO or reads PO-provided outputs; none connects to a hosted project from an agent session; scripts accept `--local` and
are exercised against the local stack in CI. Runbooks are written so any Claude session can follow them (R21), each with
a "verify" block whose output the PO pastes back (IDs only, never secrets or PHI).

## Plans

### 15-01 Production environment as code, guards, approval-gated migrations, readiness checker (tracer) · M · migration 000205_production_guards

Files: `lib/env.ts` (production tier: `BILLING_PROVIDER=razorpay` with `rzp_live_` keys only, `EMAIL_PROVIDER` real,
`OPS_ALERT_EMAIL`, `JOBS_RUNNER_SECRET` ≠ `CRON_SECRET`, `/api/v1` switch off (C50), no `TEST_NOW`, no dev routes),
`scripts/prod/{check-readiness.mjs,checks/*.mjs}`, `.github/workflows/production-migrate.yml`,
`docs/runbooks/{production-setup.md,production-bootstrap.sql,production-migrate.md}`, migration 000205
(`platform_settings.environment` and a trigger refusing `plan_test_`-looking provider ids in production),
`tests/prod/{env-production,readiness-local,api-v1-404}.spec.ts`.

1. Tracer (above).
2. Env schema production rules and their tests (each refusal case).
3. `production-migrate` workflow (D-2) with a `--dry-run` summary and the on-demand dump step; workflow-policy check
   passes; a local rehearsal job runs the same steps against a throwaway local stack.
4. `production-setup.md`: organisation (FT-01), project in Mumbai, network restrictions and SSL enforcement if offered,
   auth settings via `node scripts/ci/check-auth-config.mjs --print production`, storage buckets private, Realtime public
   access off, hooks, Vault secrets, pg_cron jobs present (verify query), catalogue loads (D-3) with row-count checks.
5. `production-bootstrap.sql`: platform admin row, `create_plan_price` with the live plan id, supplier legal name/state
   (GSTIN later, G7), `public_signup_open = false` (13B D-10), `uat` campaign creation (15-06 fills the date).

Tests: env refusals; readiness checker against the local stack passes its code-side lines and fails on a seeded
violation (a test plan id in production mode); production build returns 404 for every `/api/v1` route.
Done: `check-readiness --local` green; workflow rehearsed locally.

### 15-02 Live payments, production email, admin bootstrap, secret rotation · M · no migration

Files: `docs/runbooks/{razorpay-live.md,email-production.md,platform-admin-bootstrap.md}`, `docs/ops/secret-rotation.md`
(pre-filled checklist), `scripts/prod/{secret-inventory.mjs,verify-webhook-delivery.mjs,verify-email.mjs}`,
`.planning/phases/15-production-readiness-uat-launch/15-LIVE-PAYMENTS-CHECKLIST.md`.

1. Razorpay live: KYC done (PO), live keys and webhook secret into the production store, the live Standard plan for 176882
   paise, plan id via the bootstrap SQL, webhook URL + events list; `verify-webhook-delivery.mjs` reads the PO-pasted
   `provider_webhook_events` rows (event ids, `signature_valid`) and confirms; the live ₹5 mandate test (UPI app and card),
   auto-refund seen, cancel-at-period-end, and one live `uat` redemption by the PO's own test clinic (deferred `start_at`
   visible in the Razorpay Dashboard, no debit) recorded with IDs only. Comp fallback (SUB §14.8) documented if live mode
   is late.
2. Email: Resend production key and domain (DKIM/SPF/DMARC), Send Email hook to production, `verify-email.mjs` checks the
   hook health route and a delivered signup code (PO pastes the message id).
3. Admin bootstrap: dedicated identity, two TOTP factors, break-glass drill once on production (13C runbook).
4. Secret rotation (CTO-2): inventory by names, rotate or revoke each (incl. `SUPABASE_ACCESS_TOKEN` revoked, MSG91 key and
   webhook secret, AI key), dates and smoke checks recorded; production secrets only in platform stores and the PO's
   password manager.

Tests: the verification scripts' parsers unit-tested with sample pasted outputs; no script accepts or prints a secret
value (test with a fake secret-shaped value → refused).
Done: runbooks complete and reviewed; checklists generated.

### 15-03 Uptime, alerts, incident response, observability for production · S-M · no migration

Files: `app/api/ready/route.ts` (provider checks, rate limit), `docs/runbooks/{incident.md,uptime.md,alerts.md}` (CERT-In
6-hour and DPDP breach templates, roles, comms), `public/.well-known/security.txt` (D-9), `scripts/prod/realtime-sizing.mjs`
(D-8), `scripts/ops/alert-drill.mjs --local` (queue lag, dead letter, backup failure, billing divergence,
`debit_without_gstin`), `tests/ops/{ready-providers,alert-drill,error-events-no-ids}.spec.ts`.

1. `/api/ready` reports real providers without secrets; rate-limited.
2. Alert drill on the local stack fires each alert once and clears it (tool output in evidence); production drill is a PO
   action with the same script in `--print` mode.
3. Incident runbook + templates; security.txt; uptime monitor setup steps (PO).
4. FT-03 heartbeat and FT-04 quota alerts verified for production configuration (local test with production settings).

Done: drill evidence; runbooks reviewed.

### 15-04 Backups, restore drill, runbooks (FT-02, P0-16b, FT-08, UAT) · M · no migration

Files: `ops/backup/production/*` (CloudFormation or Terraform-free shell + JSON policy: S3 `ap-south-1` with versioning and
object lock, write-only task role, 30-day retention, the scheduled task twice daily, on-demand trigger for
`backup_requests` from 13C D-5), `docs/ops/{backup-restore.md,backup-aws-golive.md}` merged into one truthful runbook,
`docs/runbooks/{free-tier-upgrade.md,uat.md,restore-drill-aws.md}`, `scripts/ops/restore-drill.mjs --local`,
`tests/ops/restore-drill.spec.ts` (runs in the nightly lane).

1. Local restore drill: dump the local stack (synthetic data), restore into a second local stack, run the pgTAP RLS suite
   green on it, record RPO/RTO from timestamps (tool output).
2. Production backup task definition and runbook (PO deploys); the G6 drill per CTO-1 default; the AWS ephemeral drill
   runbook for V2-16.
3. `free-tier-upgrade.md` (FT-08): triggers (§9.1), the upgrade steps, PITR drill, hosted-settings drift check.
4. `uat.md`: codes and invite text, comp fallback, the **G7-slip runbook** (comp + cancel before T-3; no debit without a
   GSTIN), the refund exception path, the UAT exit checklist (feeds V2-16).

Done: local drill evidence with RPO/RTO; runbooks reviewed.

### 15-05 k6 load test and blocking Lighthouse/route budgets (P1-41, PWA-09) · M · no migration

Files: `scripts/ci/install-k6.sh`, `perf/k6/{journeys.js,thresholds.json}`, `.github/workflows/nightly.yml` (k6 against the
local e2e server), `lighthouserc.*` (blocking budgets), `scripts/ci/route-js.mjs --enforce` ceilings,
`tests/perf/k6-thresholds.spec.ts` (threshold file shape).

1. k6 journeys at the PO-13 scale (Today board polling + heartbeat, check-in, consult save, Rx add, payment), p95
   thresholds from TEST_STRATEGY, run nightly on the local server; report artefact.
2. LHCI blocking (D-5) after three baseline runs; Login LCP and Consult LCP improvements only if cheap (preload fonts,
   defer non-critical JS); else budgets set at measured + margin and the gap listed in the release notes.
3. Route-JS budgets blocking at measured ceilings (consult ceiling from 14-05 kept).

Done: nightly k6 green; LHCI and route budgets blocking in CI.

### 15-06 UAT kit: campaign and codes, real-device run kit, release docs, in-app help, G6 checklist · M · migration 000206_uat_campaign_support (if needed)

Files: `docs/runbooks/uat-campaign.sql` (create the `uat` campaign with `free_until` = SUB-D11 date, generate assigned
single-use codes, export CSV), `docs/uat/{invite-email.md,invite-whatsapp.md,tester-guide.md}`, `app/(dashboard)/help/**`,
`docs/release-notes/v2.0.md`, `.planning/phases/15-production-readiness-uat-launch/{15-DEVICE-RUN.md,G6-CHECKLIST.md}`
(generated by `scripts/prod/g6-checklist.mjs` from the readiness checker, CI links and the PO's pasted verifications),
`tests/e2e/help/help.spec.ts`.

1. UAT campaign SQL and invite texts (codes never in logs or the repo; CSV only in the PO's download).
2. Device run kit: R1-R15 on 4 devices (incl. one low-end Android), each item with steps and expected result, scored later
   by an isolated reviewer agent from the PO's notes and screenshots.
3. Release notes, `/help` (axe at 360/820/1280), support contact and feedback channel (D-10), rollback plan.
4. G6 checklist generator: every §17.1 line with its status (code-proved with CI link / PO action pending with runbook and
   verify command / N/A with reason).

Done: G6 checklist generated with every code-side line proved.

### Close

1. Reviews: isolated release reviewer (Sonnet) over runbooks, scripts and the checklist; adversarial (Opus) over env
   guards, the migrate workflow, the bootstrap SQL, the rotation checklist and every script that touches PO outputs.
   One fix round.
2. Evidence: `npm run stack:recycle`; `node scripts/phase-evidence.mjs .planning/phases/15-production-readiness-uat-launch/evidence 1`;
   push; CI green with 0 retried; `--ci-run <id>`; nightly run ids for k6, LHCI and the restore drill.
3. Docs (Haiku): `15-SUMMARY.md`, `15-VERIFICATION.md`, roadmap status, VERIFICATION_LOG entry, PO-ACTIONS rewritten as the
   ordered G6 list below.
4. Gate: the code/docs gate by the PO or delegation; **G6 remains the PO's go/no-go** after the external actions.

## PO actions (ordered; each has a runbook and a verify step)

1. **Supabase production**: new organisation and project in Mumbai (Free), settings per `production-setup.md`; run the
   `production-migrate` workflow and approve it; run `production-bootstrap.sql` (admin row, supplier facts); load CDCI and
   diagnoses with the existing scripts pointed at production; paste the verify queries' output.
2. **Front end**: Vercel production project (`bom1`), environment variables per the env schema, Skew Protection check,
   domain.
3. **Secrets (C49)**: run `secret-inventory.mjs`, rotate/revoke each, record in `docs/ops/secret-rotation.md`.
4. **Email**: Resend production key and DNS records, Send Email hook, one signup code received.
5. **Razorpay live**: KYC complete, live keys/webhook secret, live plan (176882 paise) and its id via the bootstrap SQL,
   live ₹5 mandate test (UPI + card), cancel test, one live `uat` redemption by the PO's test clinic. If KYC is late:
   choose the comp fallback in writing.
6. **Backups**: deploy the AWS `ap-south-1` backup stack; two consecutive dumps and a failure alert test; the G6 restore
   drill per CTO-1.
7. **Monitoring**: uptime monitors on `/api/health` and `/api/ready`; the alert drill in production.
8. **Admin**: dedicated admin identity with two TOTP factors; break-glass drill once.
9. **UAT**: set SUB-D11 (UAT exit date), recruit the UAT clinics (PO-13), run `uat-campaign.sql`, send invites; MSG91
   appointment-reminder templates approved and the production messaging provider configured.
10. **Devices**: R1-R15 on 4 devices (incl. the R12 installed-PWA mandate check) with notes and screenshots.
11. **Policies**: Terms, Privacy, Refund & Cancellation, Pricing, Contact pages published (SUB-10); sub-processor register
    and AI terms; the retention schedule approved; the security contact for `security.txt`.
12. **Go/no-go**: review the generated `G6-CHECKLIST.md` and decide UAT start.

## Out of scope

G6 itself, V2-16 (UAT operation, Supabase Pro + PITR, GSTIN, paid launch), SES switch-over and its OIDC role, log drains,
any hosted run by an agent.

## Execution (lean process)

- Executors: Sonnet for 15-01..15-06 (Opus for the env-guard and workflow parts of 15-01 and the review); Haiku for
  runbooks' copy-edit and docs. Never set a mode on a subagent. Affected tests only; the nightly lane carries k6, LHCI and
  the restore drill; CI runs everything.
- Fails-without: 15-01 production env accepts a test key (refusal removed → passes; recorded, restored).
- Target calendar: 5 Dec, buffer 6 Dec.
