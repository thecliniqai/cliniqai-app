# clinicOS v2.0 — Infrastructure, Deployment & Reliability Assessment (Workstream F)

> **Status:** Discovery and assessment only. No infrastructure, configuration or deployment was changed. No network connection was made to Supabase, Vercel or MSG91.
> **Author role:** DevOps / Production Reliability Engineer
> **Date:** 2026-11-10 · **Branch:** `feature/v2`
> Labels: **Fact**, **Problem**, **Risk**, **Assumption (validate)**, **Recommendation**. Priorities P0–P3. Sizing is relative (S/M/L/XL).

---

## 1. Executive summary

> Update (2026-11-10, PO round 3; roadmap C45, C46, PO-26, V2-16, gates G6/G7; VERIFICATION_LOG addendum 4). **This overrides the round-2 banner below where they disagree.**
> - **Vercel is handled by the PO personally** (PO-24 closed, R24 closed). This assessment carries no Vercel plan or terms item; only neutral technical notes remain: the scheduler is Supabase pg_cron + pg_net, functions in `bom1` are desirable, and Skew Protection and a log drain are used if available.
> - **Free tiers apply only to the real-world UAT stage** (roadmap V2-16) after all of v2 is built, where tester clinics use `uat` coupon codes. The FT-01…FT-08 compensating controls stay mandatory during UAT (UAT clinics may enter real patient data). **Paid launch follows UAT (gate G7)**; the Supabase Pro + PITR upgrade is a UAT exit criterion (default: at UAT exit, before the first full-price charge; PO confirms, PO-26). The "90 days after go-live" and "first paying clinic beyond the pilot" triggers are replaced by that planned upgrade; the remaining triggers are early-upgrade triggers during UAT (roadmap §9.1).

> Update (2026-11-10, PO round-2 decisions; roadmap PO-17 ✅, §9.1, FT-01…FT-08; VERIFICATION_LOG addendum 3). **This overrides the Pro-plan recommendations below for the UAT stage (scoped by round 3; originally "the first 2–3 months after go-live").**
> - **Budget (PO-17):** "For Budget currently for 2-3 months we are going live with Free Tiers of both Supabase & Vercel." Supabase Free is adopted for staging and production (Mumbai), each in its **own organisation** (2-active-free-project cap across organisations; production upgradable alone).
> - ~~Vercel plan terms (R24, PO-24)~~ **Closed in round 3: Vercel is handled by the PO** (see the update above).
> - **Supabase Free gaps and controls** (roadmap §9.1): no automatic backups or PITR → **twice-daily encrypted `supabase db dump` + Storage sync from a scheduled task in AWS `ap-south-1` to a versioned S3 bucket in `ap-south-1`**, 30-day retention, monthly restore drill into a local stack (FT-02; RPO ≤ 12 h). Pausing after a week of low activity → pg_cron heartbeat (FT-03). 500 MB DB / 1 GB Storage / 5 GB egress, with org-wide read-only or 402 restrictions after one grace period → weekly quota job with 60 %/70 % alerts (FT-04). No leaked-password check and no session time-box → app-side controls (FT-05, FT-06). Logs kept 1 hour to 1 day → in-app security/audit events ≥ 180 days (FT-07). Custom SMTP is allowed on Free.
> - **Scheduler:** pg_cron + pg_net only (C22). Check that both extensions are enabled on the Free project in V2-04.
> - **Upgrade timing** (round 3): planned Supabase Pro + PITR upgrade at UAT exit, before full-price charging (PO-26 default); **early-upgrade triggers during UAT** (any one → upgrade within 7 days, in place, no migration): any quota ≥ 60 %; any data-loss-intolerant use; two failed backups or a failed drill; an incident needing older platform logs; UAT extended or widened beyond the pilot. Runbook FT-08 written in V2-15, executed in V2-16.
> - **Error tracking** is the India-resident `ops.error_events` sink (roadmap C39), not Sentry.

clinicOS today is a **developer-laptop deployment model**: one hosted Supabase project, migrations pushed by hand from a laptop, and no CI/CD, observability, scheduler or verified backups. That was fine for proving the MVP. It is **not production-ready for clinical data**.

The right-sized v2 setup for a small team is:

- **Platform:** Vercel (plan handled by the PO, round 3) plus Supabase in **Mumbai (`ap-south-1`)**: Free during the UAT stage, Pro + PITR before paid launch (round 3).
- **Environments:** three — local (`supabase start`), staging, production — each with its own Supabase project.
- **Pipeline:** one GitHub Actions pipeline with PR gates and approval-gated production migrations.
- **Monitoring:** Sentry, an uptime monitor, and a log drain with ≥ 180-day retention (CERT-In).
- **Data protection:** PITR (after the Pro upgrade, PO-17; until then FT-02 dumps) plus a nightly logical backup kept in India, with quarterly restore drills.

No Kubernetes, containers or self-hosting are needed at this scale (independent clinics at ₹1,000/month; PRD uptime target 99.5%, `docs/clinic-management-prd.md:187`).

**Top blockers:**

| ID | Blocker | Priority |
|---|---|---|
| F-1 | No environment separation (the test suite writes to the only known hosted project) | P0 |
| F-2 | No CI/CD at all | P0 |
| F-3 | Background jobs (messaging outbox, webhooks) have endpoints but **no scheduler**, and no atomic job claim | P0 |
| F-4 | Data residency and backup tier unverified; backup docs make unverified and contradictory claims (including a cross-region replica to Frankfurt) | P0 |
| F-5 | No error tracking or log retention (CERT-In expects 180 days) | P1 |
| F-6 | Known critical and high vulnerabilities in production dependencies, with no update process | P1 |

> Verification (2026-11-10): PARTIALLY_CONFIRMED — F-1: `.env` only fills unset variables and a local config exists but is unwired; whether the hosted project is production is unverifiable (OI-1). H (Cr if prod)/P0. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — F-2: no `.github/` or hooks confirmed; Vercel's build may catch type errors (unverifiable). H/P0. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — F-3a: no scheduler confirmed, but immediate messages are sent inline; delayed, retried and webhook-retry traffic is what is lost. H/P0. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — F-4: confirmed, except the KMS vs AES runbook "contradiction" (AES-256 with KMS-managed keys is consistent); the backup test also inserts/queries via the admin client. H/P0 (verify before GA). See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — F-5: confirmed; a static `/api/health` exists; log retention is host-configured (OI-8). H/P1. See VERIFICATION_LOG.md

---

## 2. Current state — facts

### 2.1 Hosting and deployment

| Aspect | Evidence | Finding |
|---|---|---|
| App hosting | No `vercel.json`, no `Dockerfile`, no IaC. `next.config.ts` only sets `serverExternalPackages: ["@react-pdf/renderer"]`. | **Fact:** No deployment configuration exists in the repo. Vercel is the *documented intent* (`docs/clinic-management-prd.md` §6; `.planning/PROJECT.md:68`), and the early codebase map says "Not deployed" (`.planning/codebase/INTEGRATIONS.md:91`). |
| Domain | `.env.example` comment: "production: https://app.thecliniqai.com". `docs/ops/backup-restore.md` uses `https://clinicos.in/api/health`. | **Problem:** Two different production domains are documented, and product naming is inconsistent (ClinicQ / CliniQ / clinicOS). |
| Runtime | No `engines` field in `package.json`, no `.nvmrc`. The local machine runs Node v24.13.0. | **Problem:** The Node version is not pinned, so CI, Vercel and local can drift. |
| Build | `npm run build` = `next build`. Installed `next` is 15.5.27, React 19.3. | **Fact:** The build was not run (to avoid reading `.env`). `tsc --noEmit` passes (coordinator). |
| Lint script | `"lint": "next lint"` | **Problem:** `next lint` is deprecated in Next 15.5 and removed in Next 16. Switch to the ESLint CLI. |

### 2.2 Environments and Supabase

| Aspect | Evidence | Finding |
|---|---|---|
| Supabase projects | `.env` (variable names only inspected) holds a single hosted `NEXT_PUBLIC_SUPABASE_URL`, plus the service-role key and a **personal access token** (`SUPABASE_ACCESS_TOKEN`). | **Fact:** One hosted project is used by local dev, the test suite (`vitest.config.ts:5-20` auto-loads `.env`) and seed scripts (`package.json` `seed:*` use `--env-file=.env`). **Assumption (validate):** the same project is, or will be, production. |
| Local stack | `supabase/config.toml` (23 lines): `project_id = "clinicos"`, ports, `enable_signup = true`, email confirmations off. No `[db] major_version`, storage, SMS/OTP or `[db.seed]` configuration. | **Problem:** The local stack is not configured to mirror production auth (the product uses OTP), and nobody uses it for tests. |
| Migrations | 18 SQL files in `supabase/migrations/`. Applied with `npx supabase db push` from a developer machine (`.planning/phases/01-foundation-tenant-isolation/01-02-PLAN.md`, `03.1-01-SUMMARY.md`). | **Problem:** There is no review gate, no staging-first rollout, no drift detection and no record of what was applied where. |
| Storage buckets | Created in migrations (`000008_prescriptions_storage.sql:8`, `000013_labs_and_referrals.sql:11`). The optional R2 provider is configured by env (`lib/storage`). | **Fact.** |
| Region / data residency | Not determinable from the repo. The PRD flags it as an open question (`docs/clinic-management-prd.md:235`). | **Outstanding investigation (P0).** |

### 2.3 Configuration and secrets

- **Fact:** `lib/env.ts` validates only 3 variables (Supabase URL, anon key, optional service-role key). The code reads **~33 distinct `process.env.*` variables**: AI_*, MSG91_*, R2_*, CRON_SECRET, TWILIO_*, GUPSHUP_*, GEMINI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, STORAGE_PROVIDER, MESSAGING_PROVIDER, ENABLE_DEV_AUTH_LOGS, AI_EVAL_LIVE and others (grep across `app lib features middleware.ts`).
- **Problem (P1):** Missing variables fail at runtime deep in a request, not at boot. Unused provider variables (Twilio, Gupshup) widen the configuration surface.
- **Problem (P1):** `CRON_SECRET` is required by both cron routes (`app/api/cron/dispatch-communications/route.ts:5`, `app/api/cron/webhooks/route.ts:5`) but is absent from `.env.example`.
- **Fact:** `.env` is git-ignored and was never committed (coordinator). `.env.example` contains no secret values.
- **Risk (P1):** `SUPABASE_ACCESS_TOKEN` is a **personal account-level management token** kept in the app `.env`. It grants control over every project in the Supabase organisation. It does not belong in an application environment file, and the app code does not use it.
- **Risk:** The secret-read guard in the previous tooling (`.opencode/hooks/gsd-secret-read-guard.js`, `.agents/hooks/gsd-secret-read-guard.js`) has no Claude Code equivalent configured (there is no `.claude/settings.json` in the repo). See GSD_WORKFLOW_ASSESSMENT.

### 2.4 CI/CD

- **Fact:** There is no `.github/` directory: no workflows, no Dependabot, no CODEOWNERS, no PR template. No other CI configuration was found.
- **Problem (P0):** Nothing prevents a broken build, failing tests, a lint regression or a leaked secret from reaching `main` or production.

### 2.5 Background jobs (messaging outbox, webhooks, reminders)

| Aspect | Evidence | Finding |
|---|---|---|
| Endpoints | `app/api/cron/dispatch-communications/route.ts`, `app/api/cron/webhooks/route.ts`. Bearer `CRON_SECRET`, batch limit 50. | **Fact.** |
| Scheduler | No `vercel.json` `crons`, no `pg_cron` migration, no GitHub Actions schedule | **Problem (P0):** Nothing calls the endpoints, so queued WhatsApp/SMS and webhook deliveries are **never sent** in a deployed environment unless something external is configured. **Outstanding investigation.** |
| Job claim | `lib/messaging/dispatcher.ts:129-150` SELECTs pending rows, then UPDATEs each to `processing` with no status guard or `FOR UPDATE SKIP LOCKED` | **Problem (P0):** Overlapping invocations (cron retry, a slow run, manual trigger) can **send duplicate patient messages**. |
| Stuck jobs | Rows set to `processing` are never reclaimed if the function times out. | **Problem (P1).** |
| Reminders | Templates exist (`lib/messaging/templates/mapping.ts:36` `appointment_reminder`), but no code path was found that enqueues time-based reminders (24h/2h) as required by `.planning/REQUIREMENTS.md:38`. | **Assumption (validate):** reminders are not implemented. The backend workstream should confirm. |
| Vercel plan limits | — | *(Round 3: the Vercel plan is handled by the PO, roadmap C45.)* The scheduler is Supabase `pg_cron` + `pg_net` (C22), so no schedule depends on the Vercel plan. |

### 2.6 Monitoring, logging and error tracking

- **Fact:** There is no error-tracking SDK (no Sentry, Datadog, Axiom, Logtail, pino, winston or OpenTelemetry in `package.json` or the code).
- **Fact:** There are **191 `console.*` calls** across `app lib features middleware.ts`. Logs are unstructured, with no request or correlation ID, except `/api/ready`, which generates one (`app/api/ready/route.ts:13`).
- **Fact:** Health endpoints exist: `/api/health` (liveness, no dependencies, `app/api/health/route.ts`) and `/api/ready` (DB, storage, outbox checks, sanitised errors). Both are excluded from session middleware (`middleware.ts:6-12`).
- **Problem (P1):** No alerting, no uptime monitoring, no job-failure monitoring (dead-letter growth in `communication_queue` and `webhook_delivery_queue` is invisible), and no audit of who accessed production data.
- **Problem (P1):** The in-memory rate limiter (`lib/api/rate-limiter.ts:12`, a `Map` per process) is ineffective on serverless. Each instance has its own counter, and the counter resets on cold start.
- **Risk (P1, compliance):** CERT-In Directions (28 Apr 2022) require ICT system logs to be **kept for 180 days within Indian jurisdiction**, and cyber incidents to be **reported within 6 hours**. Default Vercel runtime logs and Supabase platform logs are retained only briefly on standard plans (**Assumption (validate):** hours to days depending on plan). The DPDP Rules 2025 also impose log-retention and breach-notification duties. **Validate both with counsel.**

### 2.7 Backup and recovery

- **Fact:** There are **two overlapping runbooks**:
  - `docs/operations/backups.md` (122 lines, "Phase 1 baseline", authority `AGENTS.md`)
  - `docs/ops/backup-restore.md` (189 lines, "Last Verified 2026-11-09")

  They overlap and disagree:
  - On encryption: `backups.md` claims "customer-isolated KMS keys"; `backup-restore.md` claims AES.
  - On cadence: `backup-restore.md` claims daily/monthly `pg_dump`s to encrypted cold storage, and a "Cross-Region S3 Cold Replica" to **Frankfurt (`eu-central-1`)** or Singapore.
- **Fact:** The only restore drill is recorded as **"OPEN / NOT YET PERFORMED"** (`docs/operations/backups.md` §6, DR-001). The "Backup & Restore" automated test checks that the markdown contains certain strings (`tests/ops/backup-restore.spec.ts:17-30`). **No backup has ever been shown to restore.**
- **Problem (P0):** The claimed RPO (< 15 min) and RTO (< 2 h) need PITR. On Supabase, PITR is a **paid add-on** on top of Pro (Pro alone gives daily backups with 7-day retention). **Assumption (validate):** the current plan tier and add-ons are unknown.
- **Risk (P0, residency):** A cross-region replica outside India for clinical records conflicts with the residency intent in `docs/clinic-management-prd.md:197,235`. It is unclear whether this replica exists at all. **No `pg_dump` or `aws s3 sync` job exists in the repo**, so the documented automation is aspirational.
- **Fact:** `.env.example` names `R2_*` storage. Cloudflare R2 has no India-only jurisdiction option. **Assumption (validate):** if R2 is used for clinical documents, residency must be reviewed.

### 2.8 Incident response

- **Fact:** There is no incident-response runbook, on-call rota, status page or breach-notification procedure. The backup docs cover only restoration.
- **Problem (P1):** This is required for CERT-In 6-hour reporting and DPDP personal-data-breach notification to the Data Protection Board and affected principals.

### 2.9 Dependency management

- **Fact:** There is no Dependabot or Renovate configuration. `npm audit --omit=dev` reports 10 vulnerabilities (9 high, 1 critical), including `next` and `zod` (coordinator). Caret ranges in `package.json` plus a committed `package-lock.json` (good).
- **Problem (P1):** There is no update cadence and no automated security alerting.

### 2.10 Repository hygiene

| Item | Evidence | Finding |
|---|---|---|
| ESLint scope | `eslint.config.mjs` has no `ignores`. Coordinator: 2,544 errors / 6,818 warnings, almost all from `.agents/`, `.opencode/`, `.next/`. | **Problem (P1):** The lint signal is unusable. Add `ignores: [".next/**", ".agents/**", ".opencode/**", ".gsd/**", "docs/temp/**", "node_modules/**"]`. |
| `.gitignore` | Ignores `.agents/`, `.opencode/`, `.next/`, `tsconfig.tsbuildinfo`, `.DS_Store`, `.env*`, `.planning/dev-*.txt`. `git ls-files` shows no `.DS_Store` or `tsbuildinfo` tracked. | **Fact:** git hygiene is OK. `.DS_Store` and `tsconfig.tsbuildinfo` (332 KB) exist only in the working tree. `.gsd/` self-ignores (`.gsd/.gitignore` = `*`). |
| Vendored template | `docs/temp/free-nextjs-admin-dashboard-main` (TailAdmin source) | **Problem (P2):** Third-party source sits in `docs/`, which inflates lint, search and agent context. Archive or remove it once v2 has its own design system (needs product-owner approval). |
| `tsconfig.json` | `include: ["**/*.ts", ...]`, `exclude: ["node_modules","tests","docs"]` | **Problem (P1):** Tests are not type-checked. Tooling directories are only implicitly excluded (they are JS). |
| Dev log files | `lib/auth/dev-logger.ts:44` writes OTPs and invite links to `.planning/dev-auth-logs.txt`. The messaging dev logger writes `.planning/dev-messages.txt` (191 KB). | **Risk (P2):** OTPs on disk in the planning directory. Ignored by git, but present in agent context. Production is gated (`tests/security/dev-logger-lockout.spec.ts`). Move these files to an ignored `tmp/` directory. |

### 2.11 Availability and performance

- **Fact:** The PRD targets 99.5% uptime and 1–2 s core actions on Indian 3G/4G (`docs/clinic-management-prd.md:170,187`). No measurement exists. `tests/api/v1-performance.spec.ts` times remote calls from a laptop and is not a load test.
- **Assumption (validate):** The Vercel function region is not configured (`next.config.ts` and the absent `vercel.json`). If functions run in `iad1` (the US default) while the DB is in Mumbai, every query crosses continents. Set the function region to **`bom1` (Mumbai)**, co-located with Supabase `ap-south-1`.
- **Fact:** PDF generation (`@react-pdf/renderer`) runs in route handlers (`app/api/visits/[id]/prescription-pdf/route.ts`, `app/api/invoices/[id]/receipt-pdf/route.ts`). Watch function memory and duration limits.

---

## 3. Risk register (summary)

| ID | Risk | Likelihood | Impact | Priority |
|---|---|---|---|---|
| F-1 | Tests, seeds and development write to the same project as production; orphan test users with a known password | High | High | **P0** |
| F-2 | No CI: regressions and vulnerable or broken builds reach production | High | High | **P0** |
| F-3 | Outbox never dispatched (no scheduler), or dispatched twice (no atomic claim) → missed or duplicate patient messages | High | High | **P0** |
| F-4 | Data stored or replicated outside India; backup tier unknown; restore never tested | Medium | Critical | **P0** |
| F-5 | No error tracking or log retention → incidents go unnoticed and CERT-In 180-day logs cannot be produced | High | High | P1 |
| F-6 | Critical and high CVEs in `next` and `zod` with no update process | High | High | P1 |
| F-7 | Org-level Supabase access token in the app `.env` | Medium | High | P1 |
| F-8 | Rate limiting ineffective on serverless | High | Medium | P1 |
| F-9 | Function region far from the DB → slow core actions | Medium | Medium | P2 |
| F-10 | Duplicate, contradictory runbooks → wrong procedure during an incident | Medium | Medium | P2 |

> Verification (2026-11-10): PARTIALLY_CONFIRMED — F-7: present and unused by the app but deliberately templated for the CLI; its scope is the whole account, broader than org-level. M-H/P1. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — F-8: limiter is per-instance (not unlimited) and applies after API-key auth; the OTP part is refuted (OTP goes through Supabase Auth; no app throttle on `requestOtpAction`). Limiter M/P2; OTP throttle P1. See VERIFICATION_LOG.md

---

## 4. Recommended target setup (right-sized for a small team)

### 4.1 Environments

| Env | App | Database | Data | Access |
|---|---|---|---|---|
| **Local** | `next dev` | `supabase start` (Docker), migrations + synthetic seed | Synthetic only | Developers |
| **Preview** | Vercel preview per PR | **Staging** Supabase project (shared by previews) | Synthetic only | Team |
| **Staging** | Vercel `staging` branch/env | Staging Supabase project, Mumbai | Synthetic only; restore-drill target | Team |
| **Production** | Vercel production (set up by the PO, roadmap C45), function region `bom1` | Production Supabase project, **Mumbai `ap-south-1`**, **Free during the UAT stage (V2-16), then Pro + PITR in place at UAT exit, before paid launch** (PO-17 as scoped by round 3, PO-26, roadmap §9.1), Network Restrictions and SSL enforcement if available on Free (**Unconfirmed**), MFA on every account | Real data | 1–2 named owners, MFA, break-glass procedure |

- **Recommendation (P0):** Create a **new** production Supabase project in Mumbai. Do not promote the current shared project, given its test pollution and unknown region. **Assumption (validate):** unless it already holds real clinic data, in which case plan a migration.
- Supabase Branching is optional (P3). A single staging project is simpler for a small team. *(Round 2: Branching is not on Free; staging is a Free project in its own organisation and previews share it.)*

### 4.2 Configuration and secrets

- **Recommendation (P1):** Extend `lib/env.ts` into a complete zod schema with server and client split. Make it fail at boot. Only allow provider-specific variables when that provider is selected. Delete unused providers (Twilio, Gupshup) unless the roadmap needs them.
- **Recommendation (P1):** Secrets live only in Vercel environment variables (per environment) and GitHub Environments (`staging`, `production` with required reviewers). Remove `SUPABASE_ACCESS_TOKEN` from the app `.env`; CI uses a separate token scoped to deploying migrations. Rotate the service-role key, the MSG91 key and the AI key once environments are split (they have lived in a multi-tool agent workspace).
- **Recommendation (P2):** Add gitleaks (pre-commit and CI).

### 4.3 CI/CD pipeline (GitHub Actions)

```
PR → feature/v2 or main
  1. setup        Node pinned via .nvmrc; npm ci (cache)
  2. static       tsc --noEmit (incl. tests) · eslint (tooling dirs ignored) · prettier --check
  3. secrets/deps gitleaks · npm audit --omit=dev (fail on high/critical) · (optional) OSV-Scanner
  4. unit         vitest run --project unit
  5. db           supabase/setup-cli → supabase start → db reset (all migrations) → supabase test db (pgTAP)
                  → vitest run --project db   (0 skipped enforced)
  6. build        next build with dummy/public env only
  7. e2e-smoke    next start + Playwright smoke + axe (against local stack)
  ── Vercel builds preview automatically → Playwright smoke vs preview URL (staging DB)

merge → main
  8. migrate-staging   supabase db push --linked (staging), then smoke
  9. deploy-staging    Vercel staging promotion
 10. migrate-prod      GitHub Environment "production" (manual approval by a 2nd person)
                        → pre-migration backup check (PITR window OK / logical dump) → supabase db push
 11. deploy-prod       Vercel production promotion; post-deploy /api/ready check; auto-rollback = Vercel instant rollback
nightly: full Playwright, live AI evals (sandbox key), ZAP baseline vs staging, dependency audit
```

- **Recommendation (P0):** Protect `main`: require PR, green checks and 1 review (the independent reviewer agent plus a human for P0 areas). Add CODEOWNERS for `supabase/migrations/**`, `lib/permissions/**`, `middleware.ts` and `lib/supabase/**`.

### 4.4 Database migration workflow

1. Write the migration in `supabase/migrations/` with a timestamped name. The current `000001…000018` sequence is fine to continue, but adopt the Supabase CLI timestamp convention for new files to avoid merge collisions.
2. CI applies **all** migrations from zero and runs pgTAP. This catches non-replayable migrations and drift.
3. Use the **expand → migrate → contract** pattern for destructive changes. Never drop or rename in the same release that changes code.
4. Staging gets the migration automatically on merge. Production gets it only through an approval-gated job, after confirming the backup window.
5. Run a weekly drift check: `supabase db diff --linked` against staging and production; any diff fails the job.
6. Each migration has a written rollback note (forward-fix is preferred; PITR is the last resort).

### 4.5 Background jobs

> Update (2026-11-10, PO decisions): Hosting stays on Vercel + Supabase (PO-6/7). Defaults: Vercel with `bom1` functions (plan handled by the PO, round 3); a **new** Supabase Pro production project in `ap-south-1` with PITR at 7-day retention (worst-case RPO about 2 min). Production is built only at V2-15 (PO-15); it runs on Supabase Free during UAT and is upgraded to Pro + PITR before paid launch (round 3). New infrastructure items:
> - **Email provider:** Amazon SES `ap-south-1` through the Supabase Send Email hook (custom SMTP as fallback) for signup and reset codes, plus an SES API sender for invites and billing notices. DKIM, SPF and DMARC on an `auth.` subdomain. Sandbox exit is requested in V2-03 (AUTH-03).
> - **Payment webhooks:** `app/api/webhooks/razorpay` with HMAC verification, `x-razorpay-event-id` dedupe and processing through the job queue; Razorpay test mode on staging, live mode only in production (SUB-03).
> - **Lifecycle cron (pg_cron, defined in migrations):** `lifecycle_tick`, daily `reconcile` with a divergence alert, `notify_upcoming`, the export job, archive and purge (dry-run, then admin approval), `retention_sweep` and `ai.reservations_cleanup`. Access never depends on a job having run (SUBSCRIPTIONS_AND_PLANS §6.2).
> - **Reminders:** appointment reminders only in v2.0 (PO-8); vaccine reminders in v2.1.

- **Recommendation (P0):** First fix the atomic claim. Use an `UPDATE … SET status='processing', locked_at=now() WHERE id IN (SELECT id … FOR UPDATE SKIP LOCKED LIMIT n) RETURNING *` RPC, plus an idempotency key per message. Then add a reaper that resets `processing` rows older than N minutes.
- **Recommendation (P0):** Schedule the dispatchers. Two options:
  - **Vercel Cron** (requires Pro) every 1–5 minutes, sending `CRON_SECRET` in the `Authorization` header. This is the simplest option and keeps everything in one place. *(Not used: the roadmap fixes pg_cron + pg_net, C22.)*
  - **Supabase `pg_cron` + `pg_net`** calling the endpoints. Use this if the team prefers DB-side scheduling, or if the app stays on a plan without frequent cron.
- **Recommendation (P1):** Add appointment-reminder scheduling (enqueue at booking with `next_retry_at = start − 24h / − 2h`; cancel on reschedule) once confirmed with the product owner.
- **Recommendation (P1):** Alert when the dead-letter count is > 0 or the oldest pending message is > 15 minutes old.

### 4.6 Observability

| Need | Recommendation | Priority |
|---|---|---|
| Error tracking | **Sentry** (Next.js SDK) for client, server and edge, with **PII scrubbing** (`beforeSend` drops request bodies; tag only `tenant_id`, never patient fields), source maps uploaded in CI, and release tagging. **Assumption (validate):** a Sentry data region that is acceptable for residency; send no PHI. | P1 |
| Structured logs | A small `lib/log.ts` wrapper (JSON: level, ts, request_id, tenant_id, user_id, route, duration, error code) replacing the 191 `console.*` calls over time. Never log patient content. | P1 |
| Log retention | Vercel **Log Drain**, plus Supabase log export to a store **in India with ≥ 180-day retention** (CERT-In). For example, a provider with an India region, or a low-cost bucket in `ap-south-1` with lifecycle rules. Application `audit_logs` stay in Postgres under the retention policy. | P1 |
| Uptime | An external monitor (Better Stack, UptimeRobot or similar) on `/api/health` (1 min) and `/api/ready` (5 min), plus a synthetic login check. A status page is optional. | P1 |
| Metrics | Vercel Analytics / Speed Insights for Web Vitals, Supabase reports for DB. Add a custom metric only when an SLO needs it. | P2 |
| Distributed rate limiting | Supabase-table or Upstash Redis based limiter for the `/api/v1` and OTP endpoints. | P1 |
| SLOs | Availability 99.5% monthly; p95 core action < 1.5 s; outbox delivery latency < 5 min. Review monthly. | P2 |

### 4.7 Backup and recovery

> Update (2026-11-10, PO round 2; scoped by round 3 to the UAT stage): while production is on **Supabase Free** (UAT only) there are **no Supabase backups and no PITR**. Items 2 and 4 below apply after the upgrade at UAT exit, before paid launch. Until then (roadmap FT-02):
> - `supabase db dump` (schema, data, roles) plus a Storage object sync, **twice a day** (02:00 and 14:00 IST), run by a scheduled task **in AWS `ap-south-1`** (for example EventBridge Scheduler with a small container task), **not on a GitHub-hosted runner**, because GitHub runners are outside India and PO-23(h) allows GitHub only synthetic data. Connect through Supabase's session pooler if direct IPv4 is unavailable (**Assumption (validate)**).
> - Encrypt each dump with **age** before upload; the bucket uses SSE-KMS, versioning and a 30-day lifecycle; the private key is held offline by the PO (password manager) with a second copy for break-glass.
> - An **on-demand dump** before every production migration and every purge batch.
> - A **monthly restore drill** into a local stack (no spare hosted project under the 2-project cap), running the pgTAP RLS suite and recording RPO and RTO in VERIFICATION_LOG; one drill must pass before UAT start (G6), and a PITR drill before paid launch (G7).
> - Targets: **RPO ≤ 12 h, RTO ≤ 4 h** (**Assumption (validate)**). After the Pro upgrade, PITR (7 days) adds an RPO of about 2 minutes and the dumps continue as the off-platform copy.

1. **Merge the two runbooks into one** (`docs/ops/backup-restore.md`). Remove unverified claims (KMS, cross-region Frankfurt replica, "Last Verified"), and state the actual plan tier and add-ons. (P1, S)
2. Production: Supabase Pro daily backups. **Decide on the PITR add-on** based on the RPO the business needs. **Outstanding investigation:** the product owner must state the acceptable data loss.
3. Run a **nightly logical backup** (`pg_dump` custom format of `public` plus `auth` metadata as needed) from GitHub Actions or a scheduled function into an **encrypted bucket in India** (for example AWS S3 `ap-south-1` with SSE-KMS, versioning and Object Lock). Retain 35 days daily and 12 months monthly; align with the clinical retention policy (NMC 3-year guidance cited in `docs/ops/backup-restore.md:12`; validate). Storage objects (`clinic-records`) are synced the same way. (P1, M)
4. Run **quarterly restore drills**: restore the latest logical dump and a PITR point into the staging project, run pgTAP RLS plus smoke E2E against it, and record RTO and RPO in the drill log. A drill must pass before go-live. (P0 before launch, then P1 recurring)
5. Restore access needs MFA plus two-person approval.

### 4.8 Incident response (minimal)

- One-page runbook: severity levels, who is on call (a named founder or engineer), first-hour checklist, Vercel instant rollback, maintenance mode, and contacts for Supabase, Vercel and MSG91 support.
- **CERT-In:** report reportable incidents within 6 hours (validate the categories with counsel); keep 180-day logs; synchronise clocks (both platforms use NTP/UTC; record this in the runbook).
- **DPDP:** breach assessment and notification template for the Data Protection Board and affected principals (clinic owners are fiduciaries; clinicOS is likely the processor; confirm the contractual position).
- A blameless post-incident review within 5 working days.

### 4.9 Dependency updates

- **Recommendation (P1):** Dependabot (simplest, native). Weekly grouped minor and patch PRs, **immediate** security PRs, a monthly major-version review. Each PR passes the full CI before merge.
- **Recommendation (P1, immediate):** Upgrade `next` to the latest patched 15.x line and `zod` to a patched release (coordinate with SECURITY_ASSESSMENT). Pin Node LTS in `.nvmrc` and `engines`.

---

## 5. Prioritised infrastructure backlog

| ID | Item | Priority | Size |
|---|---|---|---|
| I-01 | Confirm the current project's region, plan, PITR and data content (see §6); decide on a new production project in Mumbai | **P0** | S (decision) |
| I-02 | Create staging and production Supabase projects (Mumbai); move dev and tests to `supabase start` | **P0** | M |
| I-03 | GitHub Actions PR pipeline (static, unit, DB on local Supabase, build) + branch protection + CODEOWNERS | **P0** | M |
| I-04 | Atomic job claim + reaper + scheduler (Vercel Cron or `pg_cron`) for both outboxes | **P0** | M |
| I-05 | Restore drill on staging; consolidate the backup runbooks; remove unverified claims | **P0** | M |
| I-06 | Approval-gated migration jobs (staging auto, production manual) + drift check | P1 | M |
| I-07 | Complete env schema in `lib/env.ts`; add `CRON_SECRET` to `.env.example`; remove the access token from the app env; rotate keys | P1 | S |
| I-08 | Sentry with PII scrubbing + uptime monitor + dead-letter alert | P1 | S–M |
| I-09 | Log drain to India-region storage with 180-day retention; structured logger | P1 | M |
| I-10 | Nightly logical backup to an encrypted India bucket + storage sync (round 2: **P0**, twice daily, from AWS `ap-south-1`, as roadmap FT-02, because Supabase Free has no backups) | P1 → **P0** | M |
| I-11 | Dependabot + patch `next`/`zod` + pin Node | P1 | S |
| I-12 | Distributed rate limiter | P1 | S–M |
| I-13 | ESLint ignores; replace `next lint`; type-check tests | P1 | S |
| I-14 | Incident-response and breach-notification runbook | P1 | S |
| I-15 | Vercel function region `bom1`; check PDF route limits | P2 | S |
| I-16 | Move dev log files out of `.planning/`; archive `docs/temp` vendored template | P2 | S |
| I-17 | Status page, SLO reviews, Supabase Branching | P3 | S |

---

## 6. Outstanding investigations (exact questions for the product owner)

1. **Which Supabase project does `.env` point to (production, staging or sandbox)? Does it contain any real clinic or patient data? Is any clinic using the system today?**
2. **What region is that project in?** (Supabase dashboard → Project Settings → General → Region.) Is Mumbai (`ap-south-1`) acceptable or required for v2?
3. **What is the Supabase plan, and is the PITR add-on enabled?** What is the maximum acceptable data loss (RPO) and downtime (RTO) for a clinic during OPD hours?
4. **Is the app deployed anywhere today?** Which Vercel team and plan? *(Round 3: the Vercel plan is handled by the PO.)* Which domain is canonical: `app.thecliniqai.com` or `clinicos.in`? What is the product name for v2?
5. Does the "Cross-Region S3 Cold Replica (Frankfurt/Singapore)" in `docs/ops/backup-restore.md` exist? Is R2 or S3 in use for clinical documents, and in which region or jurisdiction?
6. Is anything external currently calling `/api/cron/dispatch-communications` or `/api/cron/webhooks`? Has `CRON_SECRET` been set in any environment?
7. Who besides the founder has access to the Supabase org, Vercel, MSG91 and the AI-provider accounts? Is MFA enforced?
8. ~~Is there budget for Vercel Pro, Supabase Pro + PITR, Sentry Team and a log-retention store (rough order: low hundreds of USD/month)? This determines whether to use Vercel Cron or `pg_cron`.~~ **Answered 2026-11-10 (PO-17, scoped by round 3): Supabase Free during the real-world UAT stage only, Pro + PITR before paid launch (PO-26); `pg_cron`; Vercel handled by the PO (PO-24 closed); Sentry is not used (C39).**
9. Has counsel confirmed the CERT-In and DPDP obligations (log retention, incident reporting, fiduciary vs processor role)?
