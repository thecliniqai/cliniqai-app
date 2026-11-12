# Phase V2-03: Platform hygiene - Research

**Researched:** 2026-11-13 (branch `v2/phase-03-platform-hygiene`, base `e66edf9`)
**Domain:** configuration, DB boundary and types, schema drift, time zones, observability, staging, Supabase Auth hardening
**Confidence:** HIGH for the code inventory (commands run this session); MEDIUM for hosted/external behaviour (docs only, staging does not exist yet)

All counts below come from commands run in this session against the working tree (`git grep` over tracked files in
`app/ features/ lib/ components/ middleware.ts`), the local stack (`npx supabase` CLI 2.120.0, Postgres 17.11), or the
npm registry. No `.env*` file was read (CLAUDE.md); the env-var inventory is taken from code reads only.

## Summary

V2-03 is twelve plans of mostly local work plus one external-account track. The local work is better prepared than the
roadmap counts suggest. Three of the five service-role factories were removed in V2-01, so two remain:
`lib/supabase/admin.ts` and the service-role fallback in `lib/storage/supabase-provider.ts`. A fresh `db reset` plus
`db diff --local` is clean apart from one known false positive (`drop extension if exists "pg_net"`). Swapping the
hand-written `Database` type for the generated one gives **0** app type errors and **32** test type errors. There are
**25** live sites of the `toISOString().split("T")[0]` "today" pattern, not 29. There are also 9 more sites that split a
UTC timestamp into a date, 9 UTC day-window sites (`T00:00:00.000Z`), and 2 SQL `DEFAULT CURRENT_DATE` defaults on a UTC
database. A lint rule must cover all of these families, not only the one the roadmap names.

The real risk sits in four places. (1) External accounts (staging Supabase, Vercel, AWS SES, DNS, Cloudflare,
GitHub Environment) gate the acceptance items for 03-08, 03-11 and 03-12. The DNS and SES steps have lead time, so the
PO track must start on day 1. (2) Making production fail closed (P1-15) breaks the CI `build` job and the e2e server,
which run `NODE_ENV=production` with `MESSAGING_PROVIDER=dev` (risk K-6). A deployment-tier variable separate from
`NODE_ENV` is required. (3) New Supabase projects created since November 2025 have **no legacy anon/service_role keys**,
so the staging project will only issue `sb_publishable_…`/`sb_secret_…` keys. That affects env names, the ESLint
identifier ban and the e2e build scan, which currently rejects `sb_…` keys. (4) Next 15 security support ends
**2027-01-31** (nextjs.org support policy), which is before UAT. The Next 16 "decision" (03-06) should therefore be an
upgrade PR now, not a deferral.

**Primary recommendation:** start the PO external track on day 1. Locally, run the Next 16 + `@supabase/ssr` upgrade
first as its own PR, then the env schema with an `APP_ENV` tier, then the logger and request IDs, then the
factory/lint/types work, then the D1 spike, error sink and auth work. Staging items close last. Every external piece sits
behind an interface with a local implementation (Mailpit, Turnstile test keys, Postgres sink), and its flag defaults to
off.

<user_constraints>
## User Constraints

No `03-CONTEXT.md` exists (`init.phase-op 03` → `has_context: false`). The binding constraints are the approved docs
(CLAUDE.md "Sources of truth"). The locked decisions that bind this phase, quoted from source:

### Locked decisions (from approved docs)
- **Scope / plans / acceptance:** roadmap §12.2 V2-03 (plans 03-01…03-12; acceptance list quoted per plan below). [CITED: docs/v2/V2_MASTER_ROADMAP.md:762-770]
- **ADR-0005 (Accepted):** "`getSystemDb(reason)` lives in `lib/supabase/system.ts` (`import "server-only"`), replaces all five factories, and is importable only from `lib/jobs/**` (internal part, below), `features/*/system.ts` and `app/api/{jobs,webhooks}/**`"; "Every call emits one structured log line with the reason code and the calling module"; register: "`lib/messaging/dispatcher.ts`, `lib/webhooks/**` and `app/api/cron/**`: until V2-04" and "`app/api/v1/**` and `lib/api/**` … until P1-37"; "**Readiness** (`/api/ready`) uses one SECURITY DEFINER health RPC returning counts only, with no bucket check (V2-03, P1-15)"; enforcement "ESLint only"; "`tests/**` and `scripts/**` are excepted from both rules". Amendment A1 (Proposed) lists the 5 public routes allowed to import `features/sharing/system.ts`. [VERIFIED: docs/adr/0005-confine-service-role-client.md:22-55,86-103]
- **C18 RPC-per-flow:** "one atomic command end to end as a `SECURITY INVOKER` plpgsql function called through the user-scoped supabase-js client (`.rpc()`)… audit and outbox rows are written in the same transaction, and raised errors map to `AppError`". [CITED: docs/v2/BACKEND_MIGRATION_PLAN.md:169]
- **C39 / PO-12:** "India-resident error sink (`ops.error_events` in the Mumbai project + the India log drain); no error-tracking vendor outside India." [CITED: docs/v2/V2_MASTER_ROADMAP.md:597]
- **C23 / P1-43:** "Remove the R2/S3 storage provider; Supabase Storage only". [CITED: V2_MASTER_ROADMAP.md:466]
- **C43:** Turnstile, Managed mode, on every endpoint Supabase's single CAPTCHA switch enforces. [CITED: docs/v2/AUTH_REDESIGN.md §0]
- **PO-A3:** "Email provider **Amazon SES ap-south-1**, via the Send Email hook (SMTP as fallback)". [CITED: AUTH_REDESIGN.md §10]
- **PO-23(d):** minimum password length 10. **AUTH-D2:** 7 d inactivity / 14 d time-box (Pro; FT-06 is V2-11, not V2-03).
- **FT-01:** staging = Supabase **Free** in its **own organisation**, Mumbai; "v1 test project paused or deleted before staging is created"; Vercel staging set up by the PO (PO-24 closed). [CITED: V2_MASTER_ROADMAP.md:569]
- **FT-05:** "if the API is unreachable it allows the password and logs a warning". [CITED: V2_MASTER_ROADMAP.md:573]
- **FE-6 / C25:** "`lib/datetime` (tenant TZ, default Asia/Kolkata)"; DB money stays `NUMERIC(10,2)`. [CITED: V2_MASTER_ROADMAP.md FE-6 row]
- **V2-01 R1:** `config.toml` `[auth] enable_signup = false` until AUTH-07 (V2-13b). [CITED: .planning/phases/01-security-containment/01-PLAN.md:73]

### Claude's discretion (CTO delegation, PO confirms at the gate)
Everything listed under "Open questions / rulings" below, including the A00-1…A00-5 rulings and P2-01.

### Deferred (out of scope for V2-03)
FT-02/03/04 (V2-04), dead-letter/queue-lag alerts (V2-04), FT-06 session time-box (V2-11), AUTH-05/06/07/08/09, log drain (V2-15), production project (V2-15), structural composite FKs (V2-05 P1-02), queue-token counter and IST token date in SQL (V2-05 05-08), FY invoice numbering (V2-10 P1-06).
</user_constraints>

## Project Constraints (from CLAUDE.md)

| Directive | Effect on V2-03 plans |
|---|---|
| Never read/print `.env*`; never run tests, seeds or scripts against hosted Supabase; never `--linked`, never `db push` | Every hosted step (staging migrations, auth config push, seeding, hosted drift read) is a **PO action or a PO-approved GitHub Environment workflow**, never an agent command. Note: `npx supabase status` shows this checkout is still **linked** to the v1 hosted project (`project_name: "TheCliniQ"`), so a CLI command without `--local` can hit hosted. |
| Every tenant table has `tenant_id` + RLS; no service-role client on request paths unless the plan says so; tenant always from the session | `ops.error_events` is not a tenant table (ops schema, not exposed). Error-sink writes must not use the service role from request paths (see 03-09). |
| Schema changes only via new migration files (expand → migrate → contract); never edit an applied migration | 03-03 adds the immutability CI check. All V2-03 migrations are additive. |
| Background jobs idempotent, claim atomically | Error-event purge function only; scheduling is V2-04. |
| No new dependency without stating why in the plan | Candidate deps listed with reasons in Standard Stack. |
| DoD: real-outcome tests (no source-grep tests); typecheck + lint + tests; CI green with 0 retried tests; 360px/tablet/desktop + axe for UI; tool-produced evidence; isolated reviewer + adversarial review for migrations/RLS/auth/middleware | 03-01, 03-02, 03-04, 03-09, 03-11 and 03-12 are all security-sensitive, so each needs an adversarial second review. |
| Branch `v2/phase-03-platform-hygiene` → PR into `feature/v2`; never touch `main` | P2-01 (Next 16) is a **separate PR** (roadmap FE-1); recommend a stacked branch `v2/phase-03-next16` with OA-2 CI on `v2/**`. |
| Delete `.planning/dev-messages.txt` if a run recreates it | The dev messaging provider writes it (`lib/messaging/dev-logger.ts`). |

<phase_requirements>
## Phase Requirements

| ID | Description (roadmap) | Research support |
|---|---|---|
| P1-15 / I-07 | Fail-closed env schema; prod forbids dev messaging + mock AI; `/api/ready` via one SECURITY DEFINER health RPC, counts only | §03-01 (46 `process.env` reads in 23 files, 26 var names; APP_ENV design; K-6) |
| P1-34 | Single service-role factory; generated types; migration immutability + drift baseline (B1); ESLint boundary rules + register + bypass fixtures; tooling ignores | §03-02, §03-03, §03-04 |
| P1-21 | `lib/datetime` + replace UTC "today" sites + lint ban | §03-05 (25 + 9 + 9 + 2 + 1 sites) |
| P2-01 | Next 16 decision (PR or written deferral) | §03-06 (recommend upgrade; 15.x security ends 2027-01-31) |
| C18 D1 spike | One atomic RPC end to end | §03-07 (recommend `record_payment`) |
| P1-35a / FT-01 | Staging Supabase (Free, own org, Mumbai) + Vercel staging + `bom1` | §03-08, External register |
| P1-25 / FT-07 | Error tracking to `ops.error_events`, structured logger, request IDs | §03-09 (214 `console.*` lines in 78 files) |
| P1-43 / P2-03 | R2/S3 removal; `VITEST`/`NODE_ENV` branch removal; live AI eval lane | §03-10 |
| AUTH-02 / AUTH-03 | Auth config as code + drift check; SES + Send Email hook on staging | §03-11 |
| AUTH-04b / FT-05 / AUTH-00 re-check | Change password, error mapping, safe `next`, `POST /auth/signout`, Turnstile; Pwned Passwords; hosted re-check | §03-12 |
| Carry-overs | OA-5 middleware redirect; AI-06 L1 env-schema checks; A00 rulings | §Carry-overs, §Rulings |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary tier | Secondary tier | Rationale |
|---|---|---|---|
| Env validation / fail-closed boot | Frontend server (Next config + `instrumentation.register`) | CI build job | Must fail at `next build` and `next start` before any request |
| Service-role confinement | API/Backend (`lib/supabase/system.ts`) | ESLint (static) | ADR-0005 D2/D4 |
| Readiness probe | Database (SECURITY DEFINER RPC) | API route | C50(g): no service role, counts only |
| Tenant-local dates | Shared lib (`lib/datetime`, isomorphic) | Database (`AT TIME ZONE tenant_tz`) | ADR-016; server and browser must agree |
| Atomic command (spike) | Database (plpgsql INVOKER RPC) | API/Backend (zod-parse result, error map) | C18 |
| Request IDs | Frontend server (middleware/proxy) | Logger, error envelope | BACKEND H2 |
| Error capture | Frontend server (`onRequestError`) | Database sink (`ops.error_events`) | C39 India-resident |
| Auth policy | Supabase Auth config (`config.toml` / hosted) | CI drift check | AUTH-02 |
| CAPTCHA | Browser (Turnstile widget → token) | Supabase Auth (verifies) | C43, no app siteverify needed for sign-in/reset |
| Pwned-password check | API/Backend (server action) | — | FT-05; k-anonymity call from the server |
| Sign-out | Frontend server (`POST /auth/signout` route) | Browser (cache purge later, PWA-02) | AUTH §3.6 |
| Auth email | Supabase Auth → Send Email hook route → SES API | Mailpit locally | PO-A3 |

## Standard Stack

### Already present (versions from `package-lock.json`, read this session)
| Package | Installed | Registry latest (npm view, 2026-11-13) | Note |
|---|---|---|---|
| next | 15.5.28 | latest 16.4.6; backport 15.5.29 (2026-11-03) | P2-01. Even if Next 16 is deferred, 15.5.29 is a pending patch |
| react / react-dom | 19.3.0 | 19.3.1 | Next 16 peer `^18.2.0 \|\| ^19.0.0` [VERIFIED: npm registry] |
| @supabase/ssr | 0.5.2 (`^0.5.2`, cannot reach 0.6+) | 0.12.7, peer `@supabase/supabase-js ^2.114.0` | AUTH §4.2 upgrade; installed supabase-js 2.117.2 satisfies the peer |
| @supabase/supabase-js | 2.117.2 | 2.119.0 | — |
| zod | 3.25.76 | 4.6.7 | zod 4 is B7/FE-4, **not** V2-03 |
| supabase (CLI) | 2.120.0 | 3.1.0 (v2.stable 2.122.1) | Keep 2.x in V2-03; a major CLI bump changes `config.toml` semantics mid-phase |
| typescript | 5.9.3 | 7.0.2 | Do not bump in V2-03 |
| @aws-sdk/client-s3, s3-request-presigner | ^3.1155.0 | — | **Removed** by P1-43 (only importer: `lib/storage/r2-provider.ts:6-7`) |

### New dependencies (each needs a "why" in the plan)
| Package | Pin | Purpose | Why not hand-roll |
|---|---|---|---|
| `date-fns` + `@date-fns/tz` | 4.4.0 / 1.5.0 | `lib/datetime` arithmetic in an IANA zone (`TZDate`) | Midnight-in-zone to UTC needs per-instant offsets; recommended in FRONTEND_TECHNOLOGY_ASSESSMENT:181. `Intl.DateTimeFormat` stays for display (DESIGN_SYSTEM:396) |
| `standardwebhooks` | 1.1.1 | Verify the Supabase Send Email hook signature (`webhook-id/-timestamp/-signature`, `v1,whsec_…`) | Timing-safe compare + timestamp tolerance + multi-signature parsing; spike E3 confirmed standard-webhooks headers |
| `@aws-sdk/client-sesv2` | **3.1155.0** (same train as the removed S3 SDK, published 2026-10-21; latest is 1 day old → SUS "too-new") | SES `SendEmail` from the hook route and later the outbox | SigV4 signing must never be hand-rolled |
| `@marsidev/react-turnstile` | **1.6.2** (2026-10-11; 1.6.3 is < 30 days → SUS "too-new") | Turnstile widget lifecycle (explicit render, reset after each submit, expiry) | It is the component Supabase's CAPTCHA guide uses [CITED: supabase.com/docs/guides/auth/auth-captcha] |
| `smol-toml` (dev) | 1.9.1 | Parse `supabase/config.toml` in the AUTH-02 policy check | Avoids a hand-written TOML subset parser |

Not recommended: `pino` (see 03-09 ruling: typed allow-list logger instead), `@sentry/*` (C39), `nodemailer` (Mailpit HTTP send API and the SES SDK cover both senders).

## Package Legitimacy Audit

`gsd-tools query package-legitimacy check --ecosystem npm …` run 2026-11-13; postinstall via `npm view <pkg> scripts.postinstall`.

| Package | Registry | Last publish | Weekly downloads | Source repo | Verdict | Disposition |
|---|---|---|---|---|---|---|
| date-fns | npm | 2026-05-29 | 117.3M | github.com/date-fns/date-fns | OK | Approved |
| @date-fns/tz | npm | 2026-05-21 | 42.4M | github.com/date-fns/date-fns | OK | Approved |
| standardwebhooks | npm | 2026-08-28 | 56.2M | github.com/standard-webhooks/standard-webhooks | OK | Approved |
| smol-toml | npm | 2026-10-09 | 65.1M | github.com/squirrelchat/smol-toml | OK | Approved (dev) |
| @aws-sdk/client-sesv2 | npm | 2026-11-12 | 9.0M | github.com/aws/aws-sdk-js-v3 | SUS (too-new) | Flagged. Pin 3.1155.0; planner adds `checkpoint:human-verify` |
| @marsidev/react-turnstile | npm | 2026-10-21 | 3.5M | github.com/marsidev/react-turnstile | SUS (too-new) | Flagged. Pin 1.6.2; planner adds `checkpoint:human-verify` |
| pino | npm | 2026-10-02 | 75.9M | github.com/pinojs/pino | OK | Not recommended (design choice) |

No postinstall script on any candidate. **Removed (SLOP):** none. **SUS:** `@aws-sdk/client-sesv2`, `@marsidev/react-turnstile`. Both are SUS only because of recent publishes, and the older pins avoid that.
`date-fns`, `@date-fns/tz` and `standardwebhooks` are named in repo docs or official docs and passed the seam, but the
planner should still state the dependency rationale (CLAUDE.md).

---

## Plan-by-plan findings

### 03-01 Env schema + fail-closed providers (P1-15, I-07, AI-06 L1 carry-over)

**Current state**
- `lib/env.ts` validates 5 keys: `NODE_ENV`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (`z.string().optional()`), `API_V1_ENABLED` (`z.enum(["true", "false"]).default("false")`, refused with `NODE_ENV === "production"`). [VERIFIED: lib/env.ts:3-26] It parses when the module is first imported (`export const env = parseEnv({...})`, :48-56), not at boot. The only importers are `lib/supabase/{admin,server,client}.ts` and `lib/storage/supabase-provider.ts`. `middleware.ts:29-30` reads `process.env.NEXT_PUBLIC_SUPABASE_URL!` directly.
- **46 `process.env` reads outside `lib/env.ts` in 23 files, 26 distinct names** (`git grep -nE 'process[.]env'`). By name: NEXT_PUBLIC_APP_URL 6, R2_ACCOUNT_ID 5, R2_ACCESS_KEY_ID 5, SUPABASE_SERVICE_ROLE_KEY 3, STORAGE_PROVIDER 3, NODE_ENV 3, VITEST 2, R2_SECRET_ACCESS_KEY 2, MSG91_SENDER_ID 2, MSG91_INTEGRATED_NUMBER 2, MSG91_AUTH_KEY 2, CRON_SECRET 2, plus 1 each for TWILIO_{WHATSAPP_FROM,FROM_PHONE,AUTH_TOKEN,ACCOUNT_SID}, R2_BUCKET_NAME, NEXT_PUBLIC_SUPABASE_{URL,ANON_KEY}, MSG91_WEBHOOK_SECRET, MSG91_DLT_TE_ID, MESSAGING_PROVIDER, GUPSHUP_{SRC_PHONE,APP_NAME,API_KEY}, API_V1_ENABLED. In addition, `lib/ai/client.ts:41,58` default their `env` parameter to `process.env` and read `AI_ENABLED`, `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL_NAME`, `AI_BASE_URL`. **Total: ~31 names.**
- Silent fallbacks: `NEXT_PUBLIC_APP_URL || "http://localhost:3000"` ×6 (`features/appointments/system.ts:214`, `features/billing/service.ts:1174,1351`, `features/labs/service.ts:453`, `features/prescriptions/service.ts:743`, `features/referrals/service.ts:606`). These build patient-facing share links, so in production a missing value would send links pointing at `localhost`.
- Messaging fails open to dev: `lib/messaging/index.ts:21-31`: `process.env.MESSAGING_PROVIDER || "dev"`, and `msg91` without `MSG91_AUTH_KEY` "seamlessly fall back to DevLoggerProvider". The dev provider `console.log`s recipient, template and params (PHI) and appends them to `.planning/dev-messages.txt` (`lib/messaging/dev-logger.ts:31,68`).
- **Name mismatch:** the code reads `MSG91_WEBHOOK_SECRET` (`lib/messaging/webhook-helpers.ts:41`), while `.planning/PO-ACTIONS.md` C-3 tells the PO to set `MESSAGING_WEBHOOK_SECRET`. One of the two names must change, and the env schema fixes the canonical one.
- `/api/ready` (`app/api/ready/route.ts`) calls `getAdminClient()` three times (lines 21, 38, 69): tenants count, `storage.getBucket("clinic-records")`, and an outbox select. It also reads the R2 vars (52-54) and logs raw error objects (`console.error(... errors)`, :106).
- **K-6 (V2-02):** the CI `build` job runs `NODE_ENV: production` with a placeholder anon key and `MESSAGING_PROVIDER: dev` (`.github/workflows/ci.yml` build step). The e2e server (`tests/e2e/support/app-env.ts` `buildAppServerEnv`) sets `NODE_ENV: "production"`, `MESSAGING_PROVIDER: "dev"`, `AI_PROVIDER: "mock"`, `MSG91_AUTH_KEY: "x"`, `CRON_SECRET: "e2e-not-real"`. A schema keyed on `NODE_ENV` alone would fail both lanes.

**What the docs require.** P1-15: "production forbids the dev messaging provider and mock AI; `/api/ready` checks providers through one SECURITY DEFINER health RPC returning counts only". BACKEND B5: "complete zod `env` (all about 30 vars, no silent fallbacks)". AI_STRATEGY §4.6/AI-P0: "`next build` with `NODE_ENV=production` and `AI_ENABLED=true` fails when the provider config is incomplete" (deferred to P1-15 by V2-02 RL-12). ADR-0005 §17.1 / C50(f): `API_V1_ENABLED` forced off in production. Acceptance: "production boot fails without real providers".

**Recommended design (local, no external dependency)**
1. Add `APP_ENV` ∈ `development | test | e2e | ci | staging | production`, required whenever `NODE_ENV=production`. Rules: staging and production forbid `MESSAGING_PROVIDER=dev`, `AI_PROVIDER=mock`, loopback/placeholder Supabase URL or key, a missing `NEXT_PUBLIC_APP_URL`, a missing `CRON_SECRET`, a missing webhook secret, and `API_V1_ENABLED=true`. `ci` and `e2e` allow offline providers but require loopback URLs; `tests/setup/test-env.ts` already enforces loopback for those lanes. **Do not key on `VERCEL_ENV`**, because staging may be a Vercel "production" deployment of a separate project.
2. Validate in **`next.config.ts`** (runs on `next build`, `next start` and `next dev`) and in `instrumentation.ts` `register()` (runs once per server instance before it serves). Both call one `assertDeployEnv(process.env)`. Server-only vars go into a separate `serverEnv` module with `import "server-only"`. `NEXT_PUBLIC_*` keys stay as explicit `process.env.X` reads, which Next needs in order to inline them (the existing comment at `lib/env.ts:47`).
3. Replace every `process.env` read in app code with typed accessors. Remove the 6 `localhost:3000` fallbacks and the msg91→dev fallback.
4. `/api/ready` calls one migration-defined `public.readiness_probe()` RPC (SECURITY DEFINER, `search_path=''`, returns counts/booleans only, granted to `anon`), with no bucket check (C50 g). AI status reports "disabled/configured" from the schema, never by calling the provider.
5. Generate `.env.example` from the schema (closes I-07 "add CRON_SECRET to .env.example"), checked in `static`. **The agent must not open `.env.example` (CLAUDE.md `.env*`).** The generated file overwrites it, and the PO reviews the diff.
6. Update the CI build job (`APP_ENV=ci`), `buildAppServerEnv` (`APP_ENV=e2e`) and `tests/setup/test-env.ts` PINNED rules in the same PR.

**Tests:** a unit matrix on `assertDeployEnv` (each forbidden combination → named key in the error, values never echoed), plus a boot test that imports `next.config.ts` via `tsx` with a production env missing providers and asserts a throw. A CI `build` negative step is optional (it adds about 2 min). AI-06 L1: "`AI_ENABLED=true` + incomplete Vertex/provider config fails build" becomes a unit case of the same schema.

**Local vs external:** fully local. The staging/production values are entered by the PO in Vercel (External E4).

**Size / risk:** S-M. Risk: missing a read and breaking the e2e lane. Mitigation: an ESLint `no-restricted-syntax` ban on `MemberExpression[object.name='process'][property.name='env']` outside `lib/env*.ts`, `next.config.ts`, `instrumentation.ts`, `tests/**` and `scripts/**`.

### 03-02 Single system DB factory (P1-34 / ADR-0005 D2, B8)

**Current state (factories and importers)**
| Item | Location | Disposition |
|---|---|---|
| Factory 1 `getAdminClient()` | `lib/supabase/admin.ts:13-29` (reads `process.env.SUPABASE_SERVICE_ROLE_KEY` at :14) | Becomes `lib/supabase/system.ts` `getSystemDb(reason)` + `import "server-only"` + one log line |
| Factory 2 (fallback) | `lib/storage/supabase-provider.ts:27-46`: on `createClient()` failure, "Fallback for non-cookie contexts (tests/scripts) if service role key is present" → `createSupabaseClient(..., process.env.SUPABASE_SERVICE_ROLE_KEY)` | **Delete** (ADR D2 "Request-path code never falls back to the service role on error") |
| Factories 3-5 (`features/appointments/actions.ts`, `features/auth/dev-actions.ts`, `lib/messaging/dispatcher.ts`) | — | Already gone (V2-01). `features/appointments/` now holds only `system.ts`, and `features/auth/` holds `password-flows.ts`, `schemas.ts` |

`getAdminClient` importers: **19 files** (`git grep -l getAdminClient`, excluding the factory).
| Importer | Count | ADR-0005 status |
|---|---|---|
| `app/api/v1/**/route.ts` | 14 | Register until P1-37 |
| `app/api/cron/{dispatch-communications,webhooks}/route.ts` | 2 | Register until V2-04 |
| `app/api/webhooks/messaging/[provider]/route.ts` | 1 | Allowed (`app/api/webhooks/**`) |
| `features/sharing/system.ts` | 1 | Allowed (`features/*/system.ts`; importers per A1) |
| `app/api/ready/route.ts` | 1 | **Must leave** → readiness RPC (C50 g) |
| `features/referrals/service.ts:334` **dynamic** `await import("@/lib/supabase/admin")` for originating clinic names (R15) | 1 | **Must leave**. Dynamic import is banned (C50 d). Replace with a SECURITY DEFINER `referral_source_clinics(p_ids uuid[])` that returns `id, name, phone` only for tenants that sent an RLS-visible referral to the caller's tenant |
Tests importing `@/lib/supabase/admin`: 5 files (`tests/api/health-probes.spec.ts`, `tests/messaging/msg91-webhook.spec.ts`, `tests/security/ai-containment.spec.ts`, `tests/security/share-path-encoding.spec.ts`, `tests/security/webhook-lockdown.spec.ts`). Tests have their own `tests/helpers/supabase-admin.ts`.

`features/*/system.ts` importers today: `app/api/{r/[token],reports/view,reschedule/[token]}/route.ts`, `app/{r/[token],reports/view}/page.tsx` (A1 list, all 5 present), `app/api/webhooks/messaging/[provider]/route.ts` and `features/sharing/system.ts` (→ `features/appointments/system.ts`).

**Docs:** ADR-0005 D2/V4: "a unit test shows `getSystemDb(reason)` emits one PHI-free log line with the reason". The reason should be a closed union (e.g. `'cron.dispatch' | 'webhook.inbound' | 'share.sign' | 'api_v1' | …`) so the log line is PHI-free by type.

**Dependency:** needs the 03-09 logger (or a minimal `lib/log` stub landed first). **Local only. Size S. Risk:** low. The readiness and referral RPCs need migrations, plus pgTAP-style privilege tests (`has_function_privilege`).

### 03-03 Drift baseline (B1) + migration immutability (B2) + generated types (B4)

**Current state (measured)**
- 24 migrations, `000001_foundation.sql` … `000024_queue_payload_and_live_invoice.sql`. `npx supabase db reset --local` applies all 24 cleanly in about 26 s ("Finished supabase db reset").
- `npx supabase db diff --local` (migra engine) reports exactly one statement: `drop extension if exists "pg_net";`. The local DB has no `pg_net` (`pg_extension`: pg_stat_statements, pg_trgm, pgcrypto, plpgsql, supabase_vault, uuid-ossp) but the CLI's shadow DB does. **This is a CLI false positive, so drift = 0 with one documented exception.** Both `pg_cron` and `pg_net` are *available* locally (`pg_available_extensions` count 2), which matters for V2-04.
- **Pitfall found:** `db diff --local -f /dev/null` *creates* `supabase/migrations/<timestamp>_/dev/null.sql`. Use stdout (`npx supabase db diff --local`) or `-f` with a name and delete the file. (The artefact this session created was removed; the tree is clean.)
- Migrations changed after creation (`git log --follow`): `000007` (2026-10-15, before V2), `000014` (2026-10-26, before V2), `000021`/`000022` (2026-11-12, V2-01 review fixes before merge). Roadmap R3 names 000007/000014 as edited on the hosted project. That is the B1 risk.
- Types: **`types/database.ts` does not exist.** `lib/db/types.ts` (1,612 lines) is hand-written (`export interface Database {` at :537). The vitest coverage config already excludes it as "Generated by `supabase gen types`", which is inaccurate. `npx supabase gen types typescript --local --schema public` produced 1,253 lines with 43 `Row:` types (43 public tables, 64 public functions).
- **Experiment (scratch copy, repo untouched):** replacing `Database` with the generated type gives **0 app errors** (`tsc -p tsconfig.json`) and **32 test errors** in `tsconfig.tests.json` once `tests/helpers/db.ts` `TestDb` is switched back to `SupabaseClient<Database>` as RL-13b requires (17 in tests/security, 7 in tests/compliance, 3 visits, 3 patients, 2 helpers; mostly TS2769/TS2345/TS2339). App code compiles because of **333 `as any` casts in 52 files** (308 `eslint-disable-next-line @typescript-eslint/no-explicit-any`).
- DB `TimeZone` = `UTC` (`show timezone`).

**Docs:** B1 "diff of a fresh build against production is empty except for documented exceptions"; B2 "CI job fails if any file under `supabase/migrations/` that exists on `main` is modified" (read: on `feature/v2`); B4 "keep `lib/db/types.ts` as domain aliases only; CI diff check" (B4 says `lib/db/generated.ts`, roadmap §12.2 says `types/database.ts`; **the roadmap wins**). Roadmap evidence: "the drift report (read-only against the hosted project)".

**Local vs external**
- Local: the immutability check (`git diff --name-status origin/feature/v2...HEAD -- supabase/migrations` allows only `A`; runs in `static`); `types/database.ts` generation plus a freshness check (in the `test` job, which has the stack: `supabase gen types --local` then `git diff --exit-code`); the local drift check (`db diff --local` must print nothing except the allowlisted pg_net line); removal of the `TestDb` seam and the 32 test fixes; `lib/db/types.ts` re-exporting `Database` from `types/database.ts` and keeping domain aliases.
- **External (B1 hosted half):** the only hosted DB is the v1 test project ("TheCliniQ"). FT-01 requires it to be **paused before staging is created**, so the hosted schema snapshot must be taken **first**. The PO runs a schema-only dump (`supabase db dump --schema-only` with the project's DB URL, outside the agent session, no data). The agent then restores it into a scratch local database and diffs it against a fresh reset. **Ordering dependency: E1a (dump) → E1b (pause) → E2 (staging).** Because production is created fresh from migrations (C26), any drift is *documented*, not reconciled (R3 "Low").

**Size:** M (most of the effort is the 32 test fixes). **Risk:** CLI version drift changes generated output. Pin the CLI (`supabase` devDependency `^2.15.8` resolves to 2.120.0 now). Recommend pinning an exact version so `gen types` is reproducible in CI.

### 03-04 ESLint boundaries + tooling ignores (P1-34, ADR-0005 D4, C50 d)

**Current state.** `eslint.config.mjs` already has `no-restricted-syntax` gates (AUTH-01, P0-01, P0-13) with fixtures in `lint-fixtures/{auth-01,p0-01,p0-13,…}` proven by `tests/security/*-lint-gates.spec.ts`. The tooling ignores asked for in P1-34 **already exist** (`.next/**`, `.claude/**`, `.agents/**`, `.opencode/**`, `.gsd/**`, `coverage/**`, `playwright-report/**`, `supabase/.temp/**`, etc.), so that part is done and only needs to be noted. Baseline: `npx eslint .` → 447 files, **0 errors, 400 warnings** (252 `no-explicit-any`, 119 `no-unused-vars`, 1 `import/no-anonymous-default-export`, 28 with null rule id). Note the comment in the config: "Flat-config `no-restricted-syntax` options do not merge across config objects: each file set gets one combined list." **`no-restricted-imports` behaves the same way.**

**To build (all local)**
| Rule | Selector / config | Allowed paths |
|---|---|---|
| `no-restricted-imports` `@/lib/supabase/system` | paths + patterns (`**/lib/supabase/system`) | `lib/jobs/**` (internal), `features/*/system.ts`, `app/api/{jobs,webhooks}/**`, register: `app/api/v1/**`, `lib/api/**` (P1-37), `app/api/cron/**`, `lib/messaging/dispatcher.ts`, `lib/webhooks/**` (V2-04) |
| `no-restricted-imports` `@/features/*/system` | patterns | same allow-list; `features/sharing/system` only from the 5 A1 routes (A1 verification: "a fixture proves an import from any other route fails lint") |
| value import `createClient` from `@supabase/supabase-js`, `createServerClient`/`createBrowserClient` from `@supabase/ssr` | `importNames` | `lib/supabase/{system,server,client}.ts`, `middleware.ts` (or `proxy.ts` after Next 16) |
| `no-restricted-syntax` identifier/string `SUPABASE_SERVICE_ROLE_KEY` (and `SUPABASE_SECRET_KEY` if renamed, Ruling R-K) | `Identifier[name=…]`, `Literal[value=…]` | `lib/supabase/system.ts`, `lib/env*.ts` |
| dynamic `import()`/`require()` of the factory | `ImportExpression[source.value=/supabase\/system/]`, `CallExpression[callee.name='require'][arguments.0.value=/…/]` | none |
| UTC-date ban (P1-21) | `CallExpression[callee.property.name='split'][callee.object.callee.property.name='toISOString']`, `…slice/substring` with `0,10`, template `T00:00:00.000Z` literal | `lib/datetime/**` |
| `no-console` (P1-25) | `no-console: error` | `lib/log/**`, `scripts/**`, `tests/**` |
| `process.env` confinement (03-01) | `MemberExpression[object.name='process'][property.name='env']` | `lib/env*.ts`, `next.config.ts`, `instrumentation.ts` |
`tests/**` and `scripts/**` are excepted (ADR D4). A fixture per bypass goes in `lint-fixtures/p1-34/`, including "an action importing a `lib/jobs` internal". `lib/jobs/**` does not exist yet, so its fixture creates the path in the fixture tree. **Acceptance counting** ("ESLint finds 1 service-role factory and 0 service-role imports outside the allow-list and the register") is best done by a spec that lints the repo with the ESLint Node API and asserts 0 messages for these rule IDs, plus fixtures that assert ≥1.

**Size:** S-M. **Risk:** the combined-list override pattern. Each `files:` block must spread every base gate, or a later block silently drops earlier bans. Add a self-test fixture that checks the AUTH-01 ban still fires inside a register path.

### 03-05 `lib/datetime` + replace the UTC "today" sites (P1-21, ADR-016)

**Measured inventory (HEAD).** The roadmap says 29. The v1 tag had 26 single-line sites (`git grep` at `v1.0-mvp-baseline`); HEAD has **25**.

A. `….toISOString().split("T")[0]` (25 sites):
| # | Site | Kind |
|---|---|---|
| 1-5 | `app/(dashboard)/billing/reports/page.tsx:20`, `cabin/page.tsx:33`, `calendar/page.tsx:29`, `page.tsx:59`, `queue/page.tsx:28` | server "today" (dashboard shows yesterday 00:00-05:29 IST) |
| 6-7 | `app/api/reschedule/[token]/route.ts:66`, `app/reschedule/[token]/page.tsx:112` | next-N-days list |
| 8-9 | `components/billing/collection-reports-view.tsx:41` (toYmd), `:150` | report ranges / today |
| 10-14 | `components/calendar/block-time-modal.tsx:33`, `booking-drawer.tsx:55`, `calendar-view.tsx:119,129,246` | default date, navigation, today |
| 15-16 | `components/consultation/consultation-workspace.tsx:158,386` | follow-up date (+N days) |
| 17-19 | `components/patients/age-dob-input.tsx:91` (max=today), `patient-lab-documents.tsx:63,170` | form defaults |
| 20-22 | `components/queue/queue-view.tsx:49,62,94` | navigation / today |
| 23 | `components/referrals/close-loop-modal.tsx:22` | default |
| 24 | `features/labs/service.ts:61` | server default `report_date` |
| 25 | `features/queue/service.ts:28` | **server check-in: queue-token date (most severe)** |

B. UTC timestamp split into a date (9 sites): `app/api/visits/[id]/prescription-pdf/route.ts:156`, `features/consultation/service.ts:579`, `features/prescriptions/service.ts:641` (Rx `visit_date`), `features/referrals/service.ts:118`, `features/visits/scheduling-service.ts:270`, `features/visits/service.ts:371`, `components/calendar/doctor-timeline.tsx:170-171`, `features/billing/pdf/receipt-document.tsx:346` (printed receipt date), `lib/api/auth.ts:122` (API daily-usage bucket).
C. UTC day windows `${date}T00:00:00.000Z` / `T23:59:59.999Z` (9 sites, 17 lines): `app/(dashboard)/cabin/page.tsx:64-65`, `app/api/reschedule/[token]/route.ts:68-69`, `features/billing/reports-service.ts:57-58`, `features/queue/service.ts:255-256`, `features/visits/scheduling-service.ts:207-208,271-272`, `features/visits/schema.ts:66,70`, `features/visits/service.ts:140-141`, `lib/utils/filter-values.ts:16`. These shift the clinic day by 5h30 (an appointment at 02:00 IST lands in the previous day's list).
D. SQL defaults on a UTC database: `supabase/migrations/000006_appointments_queue_waitlist.sql:46` `date DATE NOT NULL DEFAULT CURRENT_DATE` (queue_tokens) and `000013_labs_and_referrals.sql:93` `report_date DATE NOT NULL DEFAULT CURRENT_DATE`. Recommend that the app always passes the tenant date in V2-03, and the SQL default/counter fix is V2-05 05-08 (which owns "tokens with the IST date").
E. `features/billing/service.ts:141` `new Date().getFullYear()` (invoice-number year; FY is P1-06/V2-10, note only). `features/patients/schema.ts:19-31` age from server-UTC today (minor).
Already correct: `components/calendar/block-time-modal.tsx:71-81` uses `+05:30` literals (a hard-coded zone, should move to `lib/datetime`). `app/reschedule/[token]/page.tsx:123,177,244`, `features/appointments/system.ts:65` and `features/visits/scheduling-service.ts:487` pin `timeZone: "Asia/Kolkata"`. Tenant TZ source: `tenants.timezone` (default `Asia/Kolkata`, `features/clinics/profile.ts:15`, `features/settings/schema.ts:54`).

**Docs:** ADR-016: one helper module, `(now() AT TIME ZONE tenant_tz)::date` in SQL, lint ban; DESIGN_SYSTEM:398 names `todayInClinicTz()`; roadmap names the module `lib/datetime/**` (ADR-016 says `lib/core/time`, and the **roadmap wins**). Acceptance: "0 UTC 'today' sites". Tests: "IST boundary tests at 00:00–05:30".

**Design:** isomorphic `lib/datetime` API: `todayInTz(tz, now?)`, `addDays(ymd, n)`, `dayWindowUtc(ymd, tz) → {startIso, endIsoExclusive}` (half-open, so no `23:59:59.999`), `ymdOf(instant, tz)`, `isYmd()`. The tenant TZ comes from the server context and is passed to client components as a prop. Never use the browser zone. Tests use `vi.setSystemTime` at 2026-11-12T18:29:59Z / 18:30:00Z / 23:59:59Z (00:00-05:29 IST) and run independent of `process.env.TZ`. Run one CI step with `TZ=America/New_York` to catch accidental local-zone use.

**Local only. Size:** S-M (about 45 sites across A-C; the UI sites need a `timeZone` prop threaded through). **Risk:** the DB-side `CURRENT_DATE` defaults; covered by passing explicit dates and the V2-05 follow-up.

### 03-06 Next 16 decision (P2-01, FE-1 / C24)

**Facts**
- The official support policy table shows 16.x "Active LTS" (released Oct 21, 2025) and 15.x "Maintenance LTS". Callout: "Maintenance LTS for Next.js 15 has been extended beyond its original end date of Oct. 21, 2026. We'll continue publishing security releases for Next.js 15 through Jan. 31, 2027." [CITED: nextjs.org/support-policy]
- Registry: next latest 16.4.6 (2026-11-09); 16.0.0 dates from 2025-10-22, so it has been GA for about 13 months. Next 16 peer react `^18.2.0 || 19.0.0-rc… || ^19.0.0`, engines node `>=20.9.0` [VERIFIED: npm registry]. Repo: node `>=24 <25`, `.nvmrc` 24, React 19.3.0. Compatible.
- @supabase/ssr official guidance for Next 16: `proxy.ts`, which refreshes via `supabase.auth.getClaims()`. "On Next.js 15 and earlier, a `proxy.ts` file is never called"; return the `supabaseResponse` that `setAll` last built; refreshing in two places can trigger refresh-token reuse sign-outs. [CITED: supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs]
- Breaking changes relevant here [CITED: nextjs.org/docs/app/guides/upgrading/version-16]:
  | Change | Exposure in this repo (scanned) |
  |---|---|
  | `middleware` → `proxy` (file + export rename; **proxy runtime is `nodejs`, not configurable**) | `middleware.ts` (API_V1 gate, session refresh, matcher). No edge-only APIs. `export const config` matcher carries over |
  | Sync Request APIs removed | 0 non-awaited `cookies()`/`headers()` found; `params`/`searchParams` already typed async (tsc passes on 15.5) |
  | Turbopack default for `next build` | `next.config.ts` has no custom webpack config. **Risk:** `tests/e2e/support/build-scan.ts` scans `.next/static` + `.next/server`, and Turbopack's output layout differs, so re-run the scan on the new layout |
  | `next lint` removed; `eslint-config-next@16` flat config | Repo already runs `eslint .`. `eslint.config.mjs` uses `FlatCompat` + `compat.extends("next/core-web-vitals", "next/typescript")`, which must switch to the native flat export |
  | `next/image` default changes | 0 `next/image` imports |
  | `revalidateTag` 2-arg, `unstable_*` | none found |
  | `__NEXT_PROCESSED_ENV` internal flag (K-2) | `tests/setup/next-env-flag.spec.ts` pins it, so it must pass on 16 |
  | `instrumentation.ts` `onRequestError` `routeType` includes `'proxy'` | Used by 03-09 |
- `eslint-config-next` must move in lockstep (currently pinned `15.5.28`).

**Recommendation (ruling R-1):** **Upgrade in V2-03** as its own stacked PR, landed **before** 03-01/03-09/OA-5, all of which edit `middleware.ts` and would otherwise be written twice. Scope: `next@16.4.x`, `eslint-config-next@16.4.x`, `@supabase/ssr@0.12.x` (AUTH §4.2), rename `middleware.ts`→`proxy.ts`, `getUser()`→`getClaims()` in the proxy, update the CI cache key glob (`middleware.ts` appears in `ci.yml` `hashFiles`), CODEOWNERS (`/middleware.ts`), the ADR-0005 D4 owner list (`middleware.ts` → `proxy.ts`), and the AUTH-01/P0-13 lint selectors if they reference the file. Evidence: full Vitest lane, the Playwright PR lane, and the M0 characterisation suite green on the same commit. Also take `next@15.5.29` only if the upgrade slips. A written deferral would leave the app on an unsupported framework at G6 (security releases end 2027-01-31).

**Local only. Size:** M. **Risk:** Turbopack output differences in the build scan, and cookie `setAll` signature changes in ssr 0.12 (it now passes cache headers). Both are caught by the e2e lane.

### 03-07 D1 confirmation spike (C18)

**Current state.** There is no atomic multi-step RPC. `recordPayment` (`features/billing/service.ts:242-372`) is non-atomic: it selects the invoice, inserts the payment, re-reads all payments, updates status if paid, and calls `recordAudit` separately. **Overpayment is allowed.** The catch block returns `err.message` to the client (:366), which violates AD-7. Check-in (`features/queue/service.ts`) uses `generate_daily_queue_token` = `MAX(token_number)+1` (DEFINER, race-prone; V2-05 05-08). There is no `has_permission()` yet (V2-05 05-01). Available helpers: `current_user_tenant_ids()`, `current_user_has_role()` (DEFINER). Audit table `audit_logs(id bigint, tenant_id, actor_id, actor_role, action, entity_type, entity_id, occurred_at, metadata jsonb, actor_type, api_key_id)`, with RLS policies INSERT/SELECT for `authenticated`. Outbox tables: `webhook_delivery_queue` (ALL for authenticated) and `communication_queue` (INSERT/SELECT). `AppError`/`Result` do not exist yet (TARGET_ARCHITECTURE §6 defines them).

**Recommendation (ruling R-2): spike `record_payment`** (P1-05 lists "payment" and "collect"). It exercises `SELECT … FOR UPDATE` on the invoice, an invariant raised as `P0001` with reason `OVERPAYMENT` → `CONFLICT`, an RLS denial `42501` → `FORBIDDEN`, a status transition, audit with `actor_id = auth.uid()`, and an outbox row (a `payment.recorded` webhook fan-out, or a receipt `communication_queue` row) in one transaction. It does not depend on the V2-05 counter/date rework. Deliverables: a migration with `public.record_payment(p_invoice_id uuid, p_amount numeric, p_method text, p_reference text, p_command_id uuid)` (`SECURITY INVOKER`, `SET search_path = ''`, `statement_timeout`), the `lib/db/errors.ts` SQLSTATE→`AppError` mapper (TARGET §6 table), zod-parse of the RPC result, `recordPayment` rewired to it, and the spike report. Also prove the **system path** (TARGET §7.1: "under the service role `auth.uid()` is null … explicit system-actor argument; the system path is confirmed in the D1 spike"): call via `getSystemDb` with a `p_system_actor`, rejected when `auth.uid()` is non-null.
**Tests (roadmap):** DB integration via the user-scoped client (happy path, cross-tenant denial, receptionist vs doctor per PO-3 matrix, **rollback when a later statement fails**, e.g. a deferred constraint or a forced exception after the audit insert → 0 payment rows and 0 audit rows, audit actor = caller, idempotent `p_command_id` replay). There is no pgTAP runner in CI today: `supabase/tests/*.sql` (2 files) run manually via `psql`, and nothing in `.github` or `scripts` references them. Write the spike tests as Vitest DB specs, or add `supabase test db` to the `test` job (an extra decision; Vitest is the established lane).
**Local only. Size:** S-M. **Dependency:** 03-03 generated types (the RPC signature typed), 03-09 logger.

### 03-08 Staging environment (P1-35a, FT-01)

**Current state.** No staging exists. No `vercel.json`, no `.vercel/`, no `ops/`, no `docs/runbooks/`. The CLI link points at the v1 hosted project "TheCliniQ" (from `supabase status` → `linked_project`). Staging must be a **new Free project in its own organisation**, Mumbai, created **after** the v1 project is paused (2-active-free-project cap).

**Key external facts**
- **New projects have no legacy keys:** "since November 2025, new projects no longer get the legacy anon and service_role keys"; replacements `sb_publishable_…` / `sb_secret_…`; legacy keys deprecated "by the end of 2026". [CITED: supabase.com/docs/guides/api/api-keys; supabase.com/changelog/29260 (search digest, MEDIUM)] Consequences: (a) env names (Ruling R-K); (b) `tests/e2e/support/build-scan.ts` rejects any `sb_(publishable|secret)_…` string in output, and the local stack also prints `sb_publishable_…`/`sb_secret_…` keys, so the scan needs a local-key allowlist if locals switch formats; (c) the AUTH-00 E10 finding ("service-role key bypasses CAPTCHA on public `/signup` and `/token`") must be re-checked for `sb_secret_` keys on staging.
- "Staging deploys from CI" (acceptance). Vercel is PO-owned (PO-24), so app deploys come from the Vercel Git integration on `feature/v2`. **DB migrations** to staging need a workflow. CLAUDE.md forbids agents from `db push`/`--linked`, so the standard pattern is a separate `.github/workflows/staging.yml`: `push: feature/v2` + `workflow_dispatch`, `environment: staging` with the **PO as required reviewer**, running `supabase db push --db-url "$STAGING_DB_URL"` (no link state) and then the read-only drift checks. `ci.yml` stays secret-free (its header rule RL-2/RL-8). This needs ruling R-9 because it touches the CLAUDE.md wording.
- Staging data: synthetic only. `npm run seed:local` is loopback-only by design. A staging seed must be a PO-run or gated-workflow step (same ruling).
- `bom1`: set in `vercel.json` `{"regions":["bom1"]}` or the project settings. Read-only verification: `curl -sI https://<staging>/api/health` and check that the `x-vercel-id` header contains `bom1` [ASSUMED header format]; otherwise record the deviation (FT-01 acceptance allows "or the deviation is recorded").
- Vercel deployment protection: if staging is a *preview* deployment protected by Vercel Authentication, Supabase's Send Email hook (server-to-server) gets 401. Recommend a separate Vercel project (or the production environment of a staging project) on a custom domain `staging.<domain>` [ASSUMED Vercel protection semantics; PO verifies].

**Local deliverables:** `vercel.json` (regions), `staging.yml` (gated), the drift workflow (read-only, nightly + dispatch), `docs/runbooks/staging.md` (create/rotate/seed/reset), and an env-schema `APP_ENV=staging` profile. **External:** E1-E5, E10, E11. **Size:** S-M local; the calendar time is set by the PO track.

### 03-09 Error tracking + structured logger + request IDs (P1-25, FT-07 sink, BACKEND H1-H2)

**Current state.** `console.*` in app code: error 180, warn 32, log 2 (both in `lib/messaging/dev-logger.ts`), info/debug 0. **214 lines in 78 files** (app 29, components 24, features 144, lib 17). About 83 `console.error/warn` lines pass a raw error object (regex estimate). Postgres/PostgREST messages can carry row values ("Key (phone)=(…)"). Only 10 use the log-safe `errorTag()` from `lib/errors/client-message.ts:15-22` ("its code (database errors) or name, never its message"). There is no request ID: middleware sets none, and `lib/api/envelope.ts:14` has an optional `correlation_id`, while `/api/ready` invents one per call. There is no `instrumentation.ts`, no `ops` schema (`pg_namespace` list has none) and no `lib/log`. A text PII stripper exists: `lib/ai/sanitizer.ts` (`INDIAN_MOBILE_PII_REGEX`, `AADHAAR_REGEX`, `ABHA_REGEX`, `stripPiiFromText`).

**Docs:** C39 sink `ops.error_events` in the Mumbai project. FT-07: "≥ 180 days, in India, within a size budget". TARGET §3.8: child loggers carrying `requestId`, `tenantId`, `actorType`, `userId` (UUID only), `route/action`, `jobId`. H2: "`x-request-id` from middleware into the context, logs, error envelopes and job payloads". Acceptance: "a thrown server error appears in the India-resident error sink with PII scrubbed". Tests: "a scrubber test". Evidence: "an `ops.error_events` row export with scrubbed fields".

**Recommended design**
1. `lib/log`: JSON-lines logger whose API takes a **closed, typed field set** (`event`, `level`, `requestId`, `tenantId`, `userId`, `route`, `action`, `code`, `durationMs`, `reason`) and **no free-form object**. PHI safety then holds by type rather than by a redaction deny-list (ruling R-6: no pino). `no-console` becomes an error in app code.
2. Request ID: the middleware/proxy generates `crypto.randomUUID()`, overwrites any inbound `x-request-id` (anti-spoofing; keep `x-vercel-id` as a separate field), forwards it via `NextResponse.next({ request: { headers } })`, and echoes it on the response. It must also apply on the early-return paths (`/api/v1`, `/api/health`, `/api/ready` currently return before the session code). Server code reads it with `headers()`, and the v1 envelope sets `correlation_id = requestId`.
3. Capture: `instrumentation.ts` `onRequestError(err, request, context)` (stable since v15.0.0, covering `render | route | action | proxy`) [CITED: nextjs.org/docs/app/api-reference/file-conventions/instrumentation]. The official example sends `err.message`, which **must** be scrubbed first. Fields kept: error name, SQLSTATE/code, digest, scrubbed message (≤ 500 chars, after `stripPiiFromText` + email, PAN, `Key (…)=(…)` detail, long digit runs and UUID-in-text rules), stack frames as `file:line` only, `routePath`, `routeType`, method, requestId, environment, release (git SHA), and `tenant_id`/`user_id` UUIDs when known. No headers, cookies, bodies or query strings (`request.path` includes `?query`, so strip it).
4. Sink write path (ruling R-7): a migration creates `ops` (not in `[api] schemas`), `ops.error_events` (bigserial id, `fingerprint` + `occurred_on date` unique → upsert increments `count`, so storms do not grow the table), and `public.ops_ingest_error(p_ingest_key text, p_event jsonb)` SECURITY DEFINER with `search_path=''` and execute granted to `anon, authenticated`. It checks `p_ingest_key` against a hash stored in `vault`, enforces field lengths, and enforces a daily row cap. Purge function `ops.purge_error_events(p_older_than interval default '180 days')` and a size check; **scheduling the purge is V2-04** (pg_cron). This keeps the service role off request paths without amending ADR-0005. The alternative (`getSystemDb('error_sink')` from `instrumentation.ts`) would need an ADR amendment, because `instrumentation.ts` is not on the allow-list.
5. Client errors: out of scope (route `error.tsx` states are V2-06). Note this as a gap.

**Local vs external:** fully local (local stack vault + loopback). External: the staging ingest key (E9). **Size:** M-L (214 console lines). **Risk:** `onRequestError` receives React-processed errors for RSC renders (it "might not be the original error instance … use `digest`"). The scrubber test must cover Postgres detail strings.

### 03-10 R2/S3 removal + test-env branch removal (P1-43, P2-03)

**Current state**
- R2: `lib/storage/r2-provider.ts` (118 lines; `@aws-sdk/client-s3`, `s3-request-presigner`). Selection logic `STORAGE_PROVIDER === "r2" || Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID)` is duplicated in `lib/storage/index.ts:75-77,100-102` and `features/sharing/system.ts:78`, plus the `/api/ready` R2 branch (`app/api/ready/route.ts:51-59`). `lib/storage/index.ts:16` `export * from "./r2-provider"`. Tests: `tests/storage/storage-provider.spec.ts` (R2 selection cases), `tests/api/health-probes.spec.ts:67` (R2 readiness). The `tests/setup/test-env.ts` `FORBIDDEN_VARS` include `R2_*` and `PINNED_IF_SET` `STORAGE_PROVIDER: ["supabase"]`, and `tests/e2e/support/app-env.ts` sets `STORAGE_PROVIDER: "supabase"`. These can be removed or kept as a deny rule (keep `R2_*` forbidden so stale hosted config fails loudly).
- Test-env branches in production code (**2 sites**; `git grep -nE "VITEST|NODE_ENV"` over app code): `lib/webhooks/dispatcher.ts:94` `const isTest = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);` → `allowHttp: isTest`; `lib/webhooks/ssrf.ts:103` `isTestEnv` → allows `http:` and **skips DNS resolution for `.test`/`.example.com` hosts** (:133, TEST_STRATEGY E-6 "SSRF DNS bypass"). Fix: explicit options injected by callers (`validateWebhookEndpoint(url, { allowHttp, allowTestDomains })` already exist as parameters at :80-81). Production callers pass nothing, and tests pass options. Dispatcher test: `tests/api/webhooks-outbox.spec.ts`. `lib/api/enabled.ts:9` `NODE_ENV !== "production"` is a **legitimate** production guard (PO-16), not a test branch; it moves to the env schema accessor. The AI branch (`soap-generator` VITEST) is already gone (V2-01 AI-01).
- AI-06 L1 carry-over: `scripts/ci/ai-l1-greps.mjs:145` scopes rule L1-R3 to `^(lib\/ai|features\/ai)\//`. Widen it to all of `lib/` once the two webhook branches are gone (RL-12), and extend the fixture in `lint-fixtures/ai-l1/`.
- "Live AI eval lane" (P2-03 / T-16): there is no AI provider in v2 until V2-12 (AI-04 Vertex `asia-south1`, PO-21). **Ruling R-8: defer the live lane to V2-12 (AI-06 L3)** and record the deferral.
- Runtime state after removal: `R2_*` and `STORAGE_PROVIDER` may still be set in the PO's existing Vercel project env (v1). After the env schema lands, a stale `R2_*` in staging/production should fail boot (deny-list), or the PO deletes the values (E4 checklist).

**Local only. Size:** S. Test FLOOR (`scripts/ci/assert-vitest-report.mjs:32` `const FLOOR = 1805;`) must be lowered with the arithmetic in the same commit if tests are deleted.

### 03-11 AUTH-02 config as code + drift check; AUTH-03 SES + Send Email hook (staging)

**Current `supabase/config.toml` auth state** [VERIFIED: supabase/config.toml:13-34]: `site_url = "http://localhost:3000"`, `additional_redirect_urls = ["https://localhost:3000"]`, `jwt_expiry = 3600`, `[auth] enable_signup = false`, `minimum_password_length = 10`, `[auth.email] enable_signup = true`, `double_confirm_changes = true`, `enable_confirmations = false`, `otp_expiry = 600`, `[auth.email.template.recovery]` (`subject = "Your ClinicOS password reset code"`, `content_path = "./supabase/templates/recovery.html"`). Absent: `[auth.captcha]`, `[auth.hook.*]`, `[auth.rate_limit]`, `[auth.mfa]`, `[auth.sms] enable_confirmations`, notifications, the signup/email-change templates, and `secure_password_change`. Mailpit is the CLI default (local API `http://127.0.0.1:54324`, v1.31.3; `POST /api/v1/send` exists: an empty body returns 400, not 404). The CLI 2.120.0 binary contains `notification.password_changed` and `auth.captcha` config strings, and `security_update_password_require_current_password` only as a hosted (Management API) field (spike E0/E5).

**Policy deltas to encode (AUTH §4.1 table vs current)**
| Key | Current | Target | Note |
|---|---|---|---|
| `jwt_expiry` | 3600 | 900 | AUTH-D2 table |
| `[auth.email] enable_confirmations` | false | true | §4.1 "Confirm email ON". Harmless while signup is off; seeds use `admin.createUser` |
| `[auth.email] max_frequency` | default | 60s | Existing integration tests that request two codes quickly may need a fresh address per request |
| `[auth.email] otp_length` | default 6 | 6 (explicit) | |
| `secure_password_change` | absent | false (explicit) | §3.5 |
| `[auth.rate_limit]` | absent | `email_sent = 60`, `sign_in_sign_ups = 30`, `token_refresh = 150`, `token_verifications = 30` | E9: CLI enforces no per-IP limit; still encode for the drift check |
| `[auth.captcha]` | absent | local: `enabled = false` (documented deviation); staging/prod: Turnstile | Local GoTrue would call Cloudflare `siteverify` (network) |
| `[auth.hook.send_email]` | absent | local: off (Mailpit SMTP); staging: on | On Linux CI the GoTrue container cannot reach a loopback-only app server |
| `[auth.mfa.totp]` | absent | enroll/verify true | AUTH §4.1 "Enabled (free on all plans)"; no UI until V2-11 |
| notifications `password_changed` | absent | enabled + template | §4.1 security notification emails |
| templates | recovery only | + confirmation (signup code), email_change, password_changed | code-only `{{ .Token }}` |
| `site_url` / redirects | localhost | per environment | staging: `https://staging.<domain>` only |
| `[auth] enable_signup` | false | false until V2-13b | R1 |

**Drift check (AUTH §7):** (1) `scripts/check-auth-config.ts` compares `supabase/auth-policy.json` (one policy table with per-environment deviations: local captcha off, hook off) with `config.toml`, in the `static` job. (2) A read-only hosted check: `GET /v1/projects/{ref}/config/auth` using a fine-grained token with `auth_config_read` [CITED: supabase.com/docs/reference/api/v1-get-auth-service-config; search digest]. It runs in a separate workflow with `environment: staging` (nightly + dispatch) and fails on any diff, including `security_update_password_require_current_password`, `rate_limit_*`, `mailer_otp_exp`, `password_min_length`, `external_email_enabled`, `disable_signup`, captcha and hook enabled flags (exact field names to be pinned from the first real response). Apply settings on staging via `supabase config push --project-ref <staging-ref>` from the gated workflow (PO approval), or by the PO in the dashboard.

**Send Email hook route** `app/api/auth/send-email/route.ts` (AUTH §4.1). Verify the standard-webhooks signature (`SEND_EMAIL_HOOK_SECRET`, `v1,whsec_…`). **Drop `magiclink`** (closes the A00-1 mailbox password bypass for existing users; spike E2 d). Pass `signup`, `recovery`, `invite` and `email_change`. Render the code-only template and send through an `EmailSender` interface: `SesEmailSender` (SESv2 `SendEmail`, `ap-south-1`, from `no-reply@auth.<domain>`) and `MailpitEmailSender` (loopback `POST /api/v1/send`, test/dev only, refused by the env schema in staging/prod). Return 200 only after the provider accepts the message; otherwise return non-2xx so Supabase surfaces an error. It needs a guard-manifest entry: it is a public route authenticated by signature, not by session. Tests: pinned test 13 from the spike (bad signature rejected, magiclink dropped, the others passed), using synthetic payload fixtures with the E3 key lists and a fake sender. **SMTP fallback** stays "configured-ready" in the runbook (Supabase dashboard SMTP to `email-smtp.ap-south-1.amazonaws.com:587`, SES SMTP credentials).

**Local vs external:** local (policy file, config.toml, check script, hook route, senders, tests); external (E5 domain/DNS, E6 SES, E8 hook secret, E3 staging apply, E11 token). Acceptance "staging sends a password-reset code through SES with DKIM passing" **can pass in the SES sandbox** if the recipient is a PO-verified address. The production-access request should still be filed early (AR-4). **Bounce/complaint webhook** (AUTH-03 row): rely on the SES account-level suppression list in V2-03, and build SNS→webhook with the V2-04 outbox (ruling R-10). **Size:** M. **Risk:** DNS propagation and the SES verification lead time.

### 03-12 AUTH-04b + FT-05 + AUTH-00 staging re-check (+ OA-5)

**Current state**
- `features/auth/password-flows.ts` (AUTH-04a) runs **in the browser** through `lib/supabase/client.ts` ("so Supabase's per-IP limits see the user's IP", :14-17). It maps `invalid_credentials`, `email_not_confirmed`, `over_request_rate_limit`, `over_email_send_rate_limit`, `otp_expired`, `weak_password`, `same_password` (:72-99). Missing codes per spike pinned unit 1: `captcha_failed`, `current_password_required`, `current_password_invalid`, `user_already_exists`, `otp_disabled`, `signup_disabled`, `session_not_found`. There is no `errors.ts` and no `messages/en.ts`.
- Change password: **does not exist** (no UI, no action; `features/settings/service.ts:135,292` call `updateUser` for metadata only).
- Sign-out: `components/layout/user-dropdown.tsx:24` `await supabase.auth.signOut();`. Client-side, default scope = global, which signs out every device (the v1 defect AUTH §3.6 fixes). There is no `/auth/signout` route.
- Safe `next`: `app/(auth)/login/page.tsx:39` always `router.replace("/")`. No `next` support exists, which is safe today. AUTH §4.2 validator: `^/(?![/\\])`.
- Turnstile: none.
- OA-5: `app/(dashboard)/layout.tsx` redirects to `/login` when `getUser()` returns null, but pages load data in parallel and throw "Unauthenticated". `middleware.ts` only refreshes the session. `tests/e2e/security/unauth-pages.spec.ts` already enumerates every dashboard page and asserts it ends on `/login`.

**Design**
- Change password: a server action `changePassword({currentPassword, newPassword})` on the cookie client: zod (10-72 bytes), **FT-05 check**, `updateUser({ password, current_password })`, then `signOut({ scope: "others" })`. Gate it with an **app-side bound for A00-5**: reject when the session's `amr` contains `otp`/`recovery` older than 10 min, because Supabase exempts those sessions from require-current-password at any age (E5). The UI lives at `/profile` (restyle in V2-11). It needs a guard-manifest entry plus the inventory rules (no `*Override` params).
- Reset completion: keep `verifyOtp({type:'recovery'})` in the browser (CAPTCHA/IP semantics). Move `updateUser` for the new password into a **server action** `setNewPasswordAction(newPassword)` that runs FT-05 first. **Residual:** a user can call `updateUser` directly with their own session and skip FT-05. That affects only their own account and closes when Supabase HIBP is enabled at the Pro upgrade. Record it (ruling R-5).
- FT-05 `lib/auth/pwned.ts`: SHA-1 (node:crypto), `GET https://api.pwnedpasswords.com/range/{5}` with `Add-Padding: true` ("Padded entries always have a password count of 0"), no API key, "no rate limit" [CITED: haveibeenpwned.com/API/v3]. Inject `fetch` and a timeout (≈1.5 s). Fail open + `log.warn({event:'pwned.unavailable'})` (FT-05). Never log the prefix. Unit tests per the roadmap: hit, miss, API down, padded zero-count lines ignored, timeout. The test lane's network guards block non-loopback (`tests/setup/loopback.cjs`, `dns-udp-guard.cjs`), so the fetcher **must** be injected.
- `POST /auth/signout` (`app/auth/signout/route.ts`): POST only, `Origin` check (SameSite=Lax already blocks cross-site cookies on POST), scope `local` default / `global` from a form field, `supabase.auth.signOut({scope})` on the cookie client, response `Clear-Site-Data: "cache"` + 303 to `/login`. The user dropdown posts to it. `hardSignOut()` is V2-06 (PWA-02).
- Turnstile: the `@marsidev/react-turnstile` widget on `/login` and `/forgot-password` passes `options: { captchaToken }` to `signInWithPassword` and `resetPasswordForEmail`, and resets after every attempt (tokens are single-use, a hosted re-check item). Site key `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: locally the Cloudflare **test key `1x00000000000000000000AA`** (always passes) with Supabase CAPTCHA off. CI uses the same; one negative unit test uses `2x00000000000000000000AB` (AUTH §7 note). The secret lives only in the Supabase dashboard (no app siteverify needed in V2-03).
- OA-5: middleware/proxy **default-deny** for pages: if there are no claims and the path is not public, redirect `307 → /login?next=<path>`. Public prefixes from the tree: `/login`, `/forgot-password`, `/join`, `/r/`, `/reports/view`, `/reschedule/`, `/api/` (handlers authenticate themselves), `/auth/` (signout). `/clinic/new` (onboarding) stays protected. Test: extend `unauth-pages.spec.ts` to assert the **raw** response is a 307 from the proxy (`maxRedirects: 0`), plus a unit test over `dashboardRoutes()` so every enumerated page is protected and every public prefix is reachable.
- AUTH-00 hosted re-check list (spike "Deferred to V2-03", 9 items): verifyOtp type matrix; Turnstile token-accepted path + single-use; require-current-password incl. OTP/recovery exemption; `postgres` DELETE on `auth.sessions`; signup response for an existing email; per-IP rate limits (key mapping, burst, 429 code); auth log retention for failed sign-ins on Free; `amr` shape; `@supabase/ssr` target version (resolved by 03-06). Items 1-5, 6 (single probe) and 8 can be scripted read-mostly against **staging with synthetic users** by a PO-approved workflow or PO session. Results go to VERIFICATION_LOG.

**Size:** M-L (UI + server + e2e J-A3/J-A4/J-A5 at 360 px and 1280 px + axe). **External:** E3 (CAPTCHA on), E7 (Turnstile), staging users for the re-check.

---

## Carry-overs from V2-02 / earlier

| Item | Source | Where it lands | Notes |
|---|---|---|---|
| OA-5 middleware redirect for signed-out `(dashboard)` hits | 02-PLAN.md:493 | 03-12 (proxy default-deny) | Write it in `proxy.ts` after 03-06 |
| AI-06 L1 checks needing the env schema | 02-PLAN RL-12 | 03-01 (build fails with `AI_ENABLED=true` + incomplete config), 03-10 (L1-R3 over all of `lib/`) | `scripts/ci/ai-l1-greps.mjs:145` |
| `VITEST`/`NODE_ENV` branch removal | 02-SUMMARY Deferred | 03-10 (2 sites) | |
| AUTH-02 config as code | 01-PLAN D4 | 03-11 | |
| AUTH-04b | roadmap | 03-12 | |
| A00-1…A00-5 rulings | VERIFICATION_LOG:716-720; 01-PLAN D11 "PO ruling still needed before V2-03" | Rulings below | |
| K-2 `__NEXT_PROCESSED_ENV` | 02-PLAN K-2 | 03-06 | |
| K-6 prod build vs offline providers | 02-PLAN K-6 | 03-01 `APP_ENV` | |
| RL-13b `TestDb` seam | `tests/helpers/db.ts` "Owner: V2-03 plan 03-03" | 03-03 | 32 test type errors to fix |
| ADR-0005 R15 referral clinic names; storage SR fallback | 01-PLAN R15 | 03-02 | |
| PO-ACTIONS C-3 env name mismatch | `.planning/PO-ACTIONS.md` vs `lib/messaging/webhook-helpers.ts:41` | 03-01 | Pick one canonical name |

## Rulings and open questions (recommended answers)

| ID | Question | Recommended ruling | Basis |
|---|---|---|---|
| **A00-1** | `/otp` signup is indistinguishable from `/signup` at the Send Email hook | Keep `enable_signup = false` on **every** environment (local, staging, production) until AUTH-07 (V2-13b); with signups off `/otp` cannot create users (E2: 422 `signup_disabled`). The hook drops `magiclink`, which closes the existing-user mailbox bypass. Before V2-13b, re-decide with: the post-verify `updateUser` + `signOut('others')` fix (E4), CAPTCHA, a 7-day purge of unconfirmed users, and the hook passing `signup` only for addresses with a pending app-side signup intent | Default deny; OWASP ASVS V2 (no unintended account creation paths) |
| **A00-2** | Before User Created cannot identify the endpoint | Do not build the hook-based filter. Accept it: same mitigation as A00-1, and remove AUTH §4.1 mitigation 2 in the doc erratum | Measured E3 |
| **A00-3** | Signup response not identical for an existing email | Accept that GoTrue's raw API reveals existence (422 `user_already_exists` or `identities: []`). The app's signup action (V2-13b) returns one uniform response and sends an "account exists" email instead (OWASP Authentication Cheat Sheet pattern). CAPTCHA + per-IP limits bound scraping. Erratum to AUTH §4.4 | Industry norm: signup enumeration cannot be fully hidden; mitigate by uniform UX + rate limits |
| **A00-4** | Rate-limit test design | (1) Unit tests map `over_request_rate_limit`/`over_email_send_rate_limit` to the "wait a minute" copy; (2) the hosted drift check asserts the configured `rate_limit_*` values; (3) one recorded staging burst probe (synthetic user, ≤ 40 requests, once) in VERIFICATION_LOG. **No side-GoTrue in CI** (fragile, tests GoTrue rather than the app) | E9 (burst ~30, refill semantics) |
| **A00-5** | Require-current-password exempts OTP/recovery sessions at any age | Enable `security_update_password_require_current_password` on staging/prod (drift-checked). The app always sends `current_password` on change-password and adds a **server-side bound**: change-password from a session whose `amr` is `otp`/`recovery` is allowed only within 10 min of that `amr` timestamp; otherwise re-authenticate | E5; NIST 800-63B re-auth guidance; AUTH §3.5 10-min window |
| **R-1 / P2-01** | Next 16 now or written deferral | **Upgrade now** (separate stacked PR, first in the phase). Next 15 security releases end **2027-01-31**; 16.x is Active LTS (16.4.6); exposure scan shows a small change set | nextjs.org/support-policy |
| R-2 | D1 spike flow | `record_payment` (lock, invariant, audit, outbox, rollback, system path) | §03-07 |
| R-3 | Types location | `types/database.ts` (roadmap) with `lib/db/types.ts` re-exporting `Database` + domain aliases; fix the inaccurate coverage-exclude comment | Roadmap §12.2 over BACKEND B4 |
| R-4 | Migration naming going forward | Keep the zero-padded sequence (`000025_…`); immutability enforced by CI. (B2's "timestamp names" protects multi-developer collisions, which do not apply with one developer; ordering is safe either way because `0…` < `2…`) | CLI orders by filename |
| R-5 | FT-05 placement given browser-side auth flows | Server actions wrap the password set (reset completion, change password); `verifyOtp` stays in the browser. Accept and record the self-only bypass residual until the Pro HIBP switch | §03-12 |
| R-6 | Logger | In-house typed allow-list logger (`lib/log`), no pino | PHI safety by type; volume is low; the edge/proxy runtime is irrelevant after Next 16 |
| R-7 | Error-sink write path | `public.ops_ingest_error` SECURITY DEFINER with an ingest key (hash in `vault`), fingerprint/day upsert, daily cap; no service role; no ADR change | ADR-0005 allow-list unchanged |
| R-8 | P2-03 "live AI eval lane" | Defer to V2-12 (AI-06 L3, Vertex `asia-south1`); V2-03 only removes branches and widens L1-R3 | No provider exists before AI-04 |
| R-9 | Staging migrations/seed/config push vs CLAUDE.md "never `db push`" | Allowed only through `.github/workflows/staging.yml` under GitHub Environment `staging` with the PO as required reviewer, using `--db-url` (never link state); the agent never runs it. **Needs explicit PO confirmation** (CLAUDE.md wording) | Industry standard approval-gated deploys (roadmap §9 CI/CD row) |
| R-10 | SES bounce/complaint webhook in V2-03 | Use SES account-level suppression now; SNS → webhook with the V2-04 outbox | AUTH-03 row vs V2-03 acceptance (no bounce item) |
| R-K | Key naming with new-format keys | Rename to `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` (accept legacy JWT values for the local stack during transition); ban both identifiers in ESLint; allowlist the **local** `sb_publishable_`/`sb_secret_` values in `build-scan.ts` | New projects have no legacy keys; legacy deprecated end-2026 |
| R-11 | `APP_ENV` tier variable | Adopt (§03-01) | K-6 |
| R-12 | Unlink the CLI from the v1 hosted project | PO runs `npx supabase unlink` (or deletes the link state) before staging exists, so no CLI default can target hosted | `supabase status` shows `linked_project` |
| R-13 | Product domain | PO supplies the final domain (PO-19 fixed the name and the `auth.` pattern, but no domain is recorded in the docs) | Blocks E5/E6 |

## External dependency register (ready for `.planning/PO-ACTIONS.md` "V2-03")

Format follows `.planning/PO-ACTIONS.md`. No secret values. Each item lists Do / Why / Unblocks / Verify (read-only).

| # | Item | Do (console steps, non-secret values) | Why / unblocks | Verify (read-only) |
|---|---|---|---|---|
| E0 | Decide the final domain | Name it (e.g. the `ClinicQ` domain); confirm DNS host (registrar or Cloudflare) | PO-19 `auth.` email subdomain; staging hostname; unblocks E5/E6/E7 | Recorded in VERIFICATION_LOG |
| E1a | Hosted v1 schema snapshot (B1) | PO runs a **schema-only** dump of project "TheCliniQ" (`supabase db dump --schema-only --db-url <url>` outside the agent session), commits nothing, and hands the `.sql` file to the agent via the scratch path | B1 drift report must happen before pausing | Agent restores into a scratch local DB and diffs; report in `03-…/evidence/` |
| E1b | Pause (or delete) the v1 test project | Dashboard → project "TheCliniQ" → Settings → General → Pause project | FT-01, 2-active-free-project cap | `supabase projects list` (PO) shows it inactive; agent sees the PO's screenshot or the CLI output |
| E1c | Unlink local CLI | `npx supabase unlink` in the repo | Prevents accidental hosted targeting (R-12) | `npx supabase status` → no `linked_project` |
| E2 | Staging org + project | supabase.com → New organization "clinicos-staging" (Free) → New project, region **South Asia (Mumbai) ap-south-1**, Postgres 17, strong DB password (password manager). Enable MFA on the account | FT-01, P1-35a | Management API `GET /v1/projects/{ref}` (region `ap-south-1`); org plan `free` |
| E3 | Staging auth settings | Apply via the gated workflow (`supabase config push`) or dashboard: Site URL `https://staging.<domain>`, no extra redirect URLs, signups **off**, confirm email on, OTP 600 s / 6 digits, min password 10, JWT 900 s, **Require current password ON**, secure password change off, rate limits per AUTH §4.1, email rate 60/h, CAPTCHA (E7), Send Email hook (E8) | AUTH-02/03, A00-5 | Drift workflow green (`GET /v1/projects/{ref}/config/auth`) |
| E4 | Vercel staging | Separate project (or a production environment of a staging project) on `feature/v2`, custom domain `staging.<domain>`, function region `bom1`, env vars by name: `APP_ENV=staging`, `NEXT_PUBLIC_SUPABASE_URL`, publishable key, secret key, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, messaging webhook secret, `SEND_EMAIL_HOOK_SECRET`, `AWS_REGION=ap-south-1` + SES credentials (or Vercel OIDC role), `EMAIL_FROM`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `ERROR_INGEST_KEY`, `AI_ENABLED=false`, `MESSAGING_PROVIDER` (a real provider or a disabled mode, never `dev`); remove stale `R2_*`/`STORAGE_PROVIDER` | P1-35a, FT-01 `bom1` | `curl -sI https://staging.<domain>/api/health` (200, `x-vercel-id` contains `bom1`); `/api/ready` 200 |
| E5 | DNS for `auth.<domain>` | Add the 3 SES Easy-DKIM CNAMEs `<token>._domainkey.auth.<domain>`; custom MAIL FROM `mail.auth.<domain>` (MX `feedback-smtp.ap-south-1.amazonses.com` priority 10, TXT `v=spf1 include:amazonses.com ~all`); DMARC TXT `_dmarc.auth.<domain>` `v=DMARC1; p=none; rua=mailto:<PO inbox>` (tighten to `quarantine` after a clean week); staging CNAME to Vercel | AUTH-03 DKIM pass | `dig +short CNAME <token>._domainkey.auth.<domain>`; `dig TXT _dmarc.auth.<domain>` |
| E6 | AWS SES (ap-south-1) | AWS console, region Mumbai → SES → Identities → Create identity → Domain `auth.<domain>`, Easy DKIM RSA 2048; Configuration → Account dashboard → **Request production access** (transactional, low volume, describe auth codes); while in sandbox, verify the PO's test recipient address; IAM: a sender principal limited to `ses:SendEmail` on that identity ARN (prefer Vercel OIDC role over static keys); SMTP credentials only if the fallback is enabled | AUTH-03; staging reset email; AR-4 lead time | `aws sesv2 get-email-identity --email-identity auth.<domain> --region ap-south-1` → DKIM `SUCCESS`, verified; `aws sesv2 get-account` → `ProductionAccessEnabled`; received mail header `dkim=pass header.d=auth.<domain>` |
| E7 | Cloudflare Turnstile | Cloudflare dashboard → Turnstile → Add widget "clinicos-staging", hostnames `staging.<domain>` (later production), **Managed** mode, no pre-clearance; site key → Vercel `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; secret → Supabase staging Auth → Bot and Abuse Protection → Enable CAPTCHA → Turnstile → secret | C43; AUTH-04b acceptance | Sign-in on staging without a token fails with `captcha_failed`; with the widget it succeeds (re-check item 2) |
| E8 | Send Email hook | Supabase staging → Authentication → Hooks → Send Email → HTTPS `https://staging.<domain>/api/auth/send-email` → generate secret → Vercel `SEND_EMAIL_HOOK_SECRET` | AUTH-03; magiclink drop | Request a reset for the verified recipient; mail arrives with DKIM pass; hook route log line `auth.email.sent` with request id |
| E9 | Error-sink ingest key | PO generates a random key; stores it in Vercel `ERROR_INGEST_KEY`; runs one SQL in the staging SQL editor to put its **hash** into `vault` (statement supplied by the plan; it contains no secret if the hash is computed client-side) | 03-09 acceptance on staging | Trigger the synthetic error route; `select count(*) … from ops.error_events where request_id = …` via the PO, or a read-only RPC |
| E10 | GitHub Environment `staging` | Repo → Settings → Environments → New "staging"; required reviewer = PO; deployment branch `feature/v2`; secrets `STAGING_DB_URL`, `SUPABASE_ACCESS_TOKEN_STAGING_RO` (E11), `SUPABASE_PROJECT_REF_STAGING` | R-9 gated migrations + drift check | `gh api repos/thecliniqai/cliniqai-app/environments/staging -q '.protection_rules'` |
| E11 | Supabase fine-grained token | Account → Access Tokens → fine-grained, permission **Auth Config: Read** (`auth_config_read`) (+ schema read if available) scoped to the staging org | AUTH-02 hosted drift | Drift workflow run green; a write call with it returns 403 |
| E12 | Repo visibility | C-1 already listed (GitHub Team before private) | — | — |

**Lead times (order of starting):** E0 → E1a → E1b/E1c → E2 → E5+E6 in parallel (DKIM propagation and the production-access review can take hours to days) → E4 → E7/E8/E9 → E10/E11.

## Suggested execution order and dependencies

| Wave | Plans | Depends on | Why this order |
|---|---|---|---|
| 0 (PO, parallel from day 1) | E0-E11 | — | Lead time |
| 1 | **03-06** Next 16 + ssr 0.12 (separate stacked PR) | — | Every later plan edits `middleware.ts`/proxy and the ESLint config |
| 2 | **03-01** env schema + `APP_ENV` + readiness RPC; **03-09a** `lib/log` + request IDs | 03-06 | Logger needed by 03-02 (factory log line), 03-07, 03-12 (FT-05 warn) |
| 3 | **03-02** system factory + referral RPC; **03-03** types + immutability + local drift; **03-10** R2 + test branches + L1-R3 | 03-01, 03-09a | 03-02 needs the env accessor; 03-03 is independent but sizes the test fixes |
| 4 | **03-04** ESLint boundaries (incl. no-console, process.env, UTC ban) ; **03-05** `lib/datetime` + sites | 03-02, 03-09a, 03-05 partial | Lint rules must land after the sites they ban are cleaned (or in the same PR) |
| 5 | **03-07** D1 spike; **03-09b** error sink + `onRequestError` + scrubber | 03-03 types, 03-09a | |
| 6 | **03-11** local half (policy, config.toml, hook route, senders); **03-12** local half (change password, FT-05, signout, safe next, Turnstile with test keys, OA-5, error catalogue) | 03-01, 03-09a | |
| 7 (needs E2-E11) | **03-08** staging deploy + `bom1`; 03-11 staging (SES, hook, drift green); 03-12 staging (CAPTCHA live, AUTH-00 hosted re-check); 03-09 staging sink row export; B1 hosted drift report | External | Gate evidence |

**Size:** M-L overall (roadmap). Heaviest: 03-09 (214 console lines), 03-12 (UI + e2e + auth), 03-03 (32 test fixes), 03-06 (framework). **Critical-path risk:** E5/E6 (DNS + SES) and the R-9 ruling.

## Test conventions the planner must follow

- **Vitest** (`vitest.config.ts`): `include: ["tests/**/*.spec.ts"]`, excludes `tests/e2e/**`, node environment, `fileParallelism: false`, `globalSetup: tests/setup/global-setup.ts`, `setupFiles: tests/setup/worker-guard.ts`. Config load calls `loadTestEnv` + `loadLocalStackKeys` + `assertLocalTestEnv`. `envDir: false` (never reads `.env`). The `server-only` alias points at Next's empty module. DB tests need the stack (`npm run test:db`).
- **Env guard** (`tests/setup/test-env.ts`): PINNED `MESSAGING_PROVIDER: ["dev"]`, `AI_PROVIDER: ["mock"]`; PINNED_IF_SET `STORAGE_PROVIDER`, `AI_EVAL_LIVE`, `NODE_ENV: ["test"]`, `ENABLE_DEV_AUTH_LOGS`, `AI_ENABLED`; `FORBIDDEN_VARS` (incl. `SUPABASE_ACCESS_TOKEN`, `DATABASE_URL`, `R2_*`, provider keys); `HOSTED_MARKERS`. New env vars (`APP_ENV`, Turnstile site key, ingest key, hook secret, SES vars) must be added here with local-safe pins, and the SES/AWS credential names go to `FORBIDDEN_VARS`.
- **Network:** non-loopback is blocked (`tests/setup/loopback.cjs`, `dns-udp-guard.cjs`; e2e `server-net-guard.cjs`). HIBP, SES and Cloudflare calls must be injected or faked.
- **Helpers:** `tests/helpers/` (`supabase-admin.ts` test-only service client, `context.ts` builds a `ServiceContext`, `tenants.ts`/`fixtures.ts` synthetic tenants, `rls.ts`, `db.ts` `TestDb` seam (to be removed in 03-03)).
- **Guard manifest:** every new `"use server"` export and every new `route.ts` (`/auth/signout`, `/api/auth/send-email`, any error route) needs an entry in `tests/security/guard-manifest.ts`, or `guard-actions.spec.ts`/`guard-routes.spec.ts` fail. `scripts/ci/guard-canary.mjs` copies `lint-fixtures/p0-13/unguarded-action.ts` into `features/__guard_canary__/` and expects the guard spec to fail. Do not name a directory `__guard_canary__`.
- **Inventory:** `npm run inventory` (`scripts/inventory-server-actions.ts`) exits 1 on banned acting-principal params, inline `"use server"`, or non-`.ts` route handlers. `D1_NON_ACTION_MODULES` must stay accurate if `features/*/system.ts` or `lib/storage` change.
- **Lint-gate pattern:** fixtures in `lint-fixtures/<id>/`, asserted by `tests/security/*-lint-gates.spec.ts` (checker outcome, not source grep; RL-11).
- **Report gate:** `scripts/ci/assert-vitest-report.mjs` `FLOOR = 1805` (≥ 95%), plus `REQUIRED_FILES`. Update it with arithmetic when deleting R2 tests. 0 skipped/todo.
- **AI-L1:** `scripts/ci/ai-l1-greps.mjs` + `tests/ci/ai-l1-greps.spec.ts` + `lint-fixtures/ai-l1/`.
- **Playwright PR lane:** `npm run e2e:build` then `npm run e2e:pr` (desktop-chrome, pixel-7, iphone-15). The server runs only on `127.0.0.1:3100` via `buildAppServerEnv()` (explicit allowlisted env, `__NEXT_PROCESSED_ENV=true`, build stamp + output scan). New env vars must be added there. Known-bug `test.fail()` only with allowed IDs. A test that passes only on retry is a defect.
- **DoD tooling:** `scripts/ci/assert-no-doc-grep-tests.mjs` bans doc-grep tests; evidence via `node scripts/phase-evidence.mjs <phase>/evidence 2`.
- **Current suite:** 102 Vitest spec files, 14 Playwright spec files; typecheck green; lint 0 errors / 400 warnings.

## CI integration (existing `.github/workflows/ci.yml` jobs; names are required checks)

| Job | Today | Add in V2-03 |
|---|---|---|
| `static` | no-env-files, typecheck, doc-grep ban, lint, inventory, AI-L1 | migration immutability (03-03), auth policy vs `config.toml` (03-11), `.env.example` generated-sync (03-01), new lint rules (03-04) |
| `security` | audit gate, npm signatures, gitleaks | none required |
| `test` | local stack, Vitest + coverage, report gate, guard canary | `supabase gen types --local` freshness diff, `supabase db diff --local` = only the allowlisted pg_net line, spike DB tests, `TZ=America/New_York` datetime unit run |
| `build` | `next build` with `NODE_ENV=production`, placeholder key, `MESSAGING_PROVIDER=dev` | `APP_ENV=ci`; optional negative boot step |
| `e2e` | local stack, guarded build, PR lane | `APP_ENV=e2e`; Turnstile test site key; OA-5 raw-307 assertions; J-A3/4/5 |
| **new** `staging.yml` | — | `environment: staging` (PO approval): `db push --db-url`, `config push`, smoke `/api/ready`. Never on `pull_request` |
| **new** `drift.yml` | — | nightly + dispatch, `environment: staging`: auth config read (E11), schema diff vs migrations, `bom1` header probe |
Pin every `uses:` to a full SHA (ci.yml header rule) and keep `permissions: contents: read`.

## Common Pitfalls

1. **`db diff -f /dev/null` writes a migration directory** (`supabase/migrations/<ts>_/dev/null.sql`). Use stdout. The pg_net drop line is a CLI shadow-DB false positive; allowlist exactly that line.
2. **Linked CLI**: this checkout is linked to the v1 hosted project. Any CLI call without `--local` can target it. Fix: E1c + a CI assertion that `supabase/.temp/project-ref` is absent.
3. **Prod-mode lanes**: CI build and e2e use `NODE_ENV=production` with offline providers. Without `APP_ENV`, P1-15 breaks both (K-6).
4. **Flat-config rule lists do not merge**: every `files:` override must spread all base gates, or bans silently disappear in register paths.
5. **New-format keys**: staging issues only `sb_publishable_`/`sb_secret_`. The build scan rejects them, so allowlist only the local values. Re-check the CAPTCHA bypass with `sb_secret_`.
6. **B1 ordering**: the hosted schema snapshot must precede pausing the v1 project. A paused project cannot be diffed.
7. **Vercel deployment protection** blocks the Supabase hook on protected preview URLs, so use a custom-domain staging production environment.
8. **SES sandbox** only delivers to verified identities. Fine for the staging acceptance; production access needs lead time.
9. **`onRequestError` messages** are not scrubbed, and `request.path` includes the query string. Scrub, and drop query strings.
10. **Browser-side auth flows** bypass server checks. FT-05 placement must wrap `updateUser` server-side, and the residual must be recorded.
11. **`max_frequency = 60s`** will break tests that request two codes for one address within a minute. Use fresh synthetic addresses.
12. **CAPTCHA locally**: enabling `[auth.captcha]` on the CLI stack makes GoTrue call Cloudflare (network). Keep it off locally and prove the missing-token behaviour from E10's record plus the staging check.
13. **Turbopack output** changes file layout under `.next/`, so re-verify `build-scan.ts` after 03-06.
14. **`.planning/dev-messages.txt`** reappears whenever the dev messaging provider runs. Delete it (CLAUDE.md).

## Don't Hand-Roll

| Problem | Don't build | Use |
|---|---|---|
| Webhook signature verification | HMAC + timestamp parsing | `standardwebhooks` |
| AWS request signing | SigV4 | `@aws-sdk/client-sesv2` |
| TZ midnight→UTC | offset arithmetic | `@date-fns/tz` `TZDate` |
| Turnstile lifecycle | script injection + reset logic | `@marsidev/react-turnstile` (Supabase docs) |
| TOML parsing | regex reader | `smol-toml` |
| Generated DB types | hand-maintained `Database` | `supabase gen types` |
| CAPTCHA verification for sign-in/reset | app-side `siteverify` | Supabase's CAPTCHA switch |

## Security Domain

| ASVS | Applies | Control in V2-03 |
|---|---|---|
| V2 Authentication | yes | password policy 10-72 bytes, FT-05 blocklist, CAPTCHA, require-current-password + A00-5 bound, generic errors |
| V3 Session | yes | server-side `POST /auth/signout` (local/global), JWT 900 s, proxy refresh via `getClaims`, `Clear-Site-Data` |
| V4 Access control | yes | single system factory + ESLint allow-list; OA-5 default-deny; readiness/referral/ingest RPCs DEFINER with `search_path=''` and explicit grants |
| V5 Validation | yes | zod env schema; zod on actions; hook payload verified before parse |
| V6 Cryptography | yes | node:crypto SHA-1 for k-anonymity only; standard-webhooks HMAC; no custom crypto |
| V7 Errors/logging | yes | typed logger, scrubbed sink, request IDs, no PHI in logs |
| V14 Config | yes | fail-closed env, config-as-code + drift check, secrets only in Vercel/GitHub Environments |

| Threat | STRIDE | Mitigation |
|---|---|---|
| Service role reachable from a request path | Elevation | ESLint confinement + fixture proofs; fallback deleted |
| Error sink spam (public anon key) | DoS | ingest key, fingerprint/day upsert, daily cap, size purge |
| PHI in logs / error rows | Info disclosure | typed fields; scrubber tests with Indian PII corpus (`lib/ai/sanitizer.ts` patterns) |
| Open redirect via `next` | Spoofing | `^/(?![/\\])` validator + unit cases from AUTH §7 |
| Forged Send Email hook calls | Spoofing | standard-webhooks signature + timestamp tolerance |
| Mailbox password bypass via `/otp` magiclink | Elevation | hook drops `magiclink`; signups off (A00-1) |
| Request-ID spoofing | Repudiation | proxy overwrites inbound `x-request-id` |
| Stale R2/legacy env in hosted config | Tampering | env schema deny-list fails boot |

## Validation Architecture

| Property | Value |
|---|---|
| Framework | Vitest 3.2.x (unit + DB lane), Playwright 1.5x (PR lane) |
| Config | `vitest.config.ts`, `playwright.config.ts` |
| Quick run | `npx vitest run tests/<area>` (stack up for DB specs) |
| Full suite | `npm run test:db` then `npm run e2e:build && npm run e2e:pr` |

| Plan | Behaviour | Type | Command | Exists? |
|---|---|---|---|---|
| 03-01 | forbidden prod combos throw, values not echoed; next.config throws | unit | `npx vitest run tests/config/env-schema.spec.ts` | ❌ Wave 0 |
| 03-01 | readiness RPC counts only, anon-executable, no service role | DB | `npx vitest run tests/api/health-probes.spec.ts` | ✅ (rewrite) |
| 03-02 | `getSystemDb(reason)` logs one PHI-free line; referral RPC scope | unit + DB | `tests/security/system-db.spec.ts` | ❌ |
| 03-03 | immutability check fails on an edited migration (fixture) | unit (checker) | `tests/ci/migration-immutability.spec.ts` | ❌ |
| 03-04 | each boundary bypass fixture fails lint; repo has 0 hits | lint-gate | `tests/security/p1-34-lint-gates.spec.ts` | ❌ |
| 03-05 | IST boundary 00:00-05:30, half-open windows, zone-independent | unit | `tests/utils/datetime.spec.ts` | ❌ |
| 03-06 | M0 + PR lane + full Vitest green on Next 16 | e2e/unit | full suite | ✅ |
| 03-07 | happy/denied/rollback/actor/idempotent/system path | DB | `tests/billing/record-payment-rpc.spec.ts` | ❌ |
| 03-09 | scrubber corpus; `onRequestError` → row with scrubbed fields; request id round-trip | unit + DB | `tests/observability/*.spec.ts` | ❌ |
| 03-10 | SSRF rejects http and skips no DNS without explicit options | unit | `tests/api/webhooks-outbox.spec.ts` + new ssrf spec | ✅ partial |
| 03-11 | policy check fixture; hook signature/action filter | unit | `tests/auth/send-email-hook.spec.ts`, `tests/ci/auth-policy.spec.ts` | ❌ |
| 03-12 | FT-05 hit/miss/down; safe next; signout headers + session revoked; OA-5 raw 307; J-A3/4/5 | unit + integration + e2e | `tests/auth/*.spec.ts`, `tests/integration/auth/*.spec.ts`, `tests/e2e/journeys/*` | ✅ partial (`password-auth.spec.ts`, `unauth-pages.spec.ts`) |

Sampling: per task, the quick run of the touched area; per wave, the full Vitest lane; phase gate: `phase-evidence.mjs` two full runs + CI link.

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | `x-vercel-id` reveals the function region (`bom1`) | 03-08/E4 | Need another region proof (Vercel dashboard screenshot) |
| A2 | Vercel Standard Protection does not cover a production custom domain, so the Supabase hook can reach it | 03-08/E8 | Hook 401s; needs a bypass |
| A3 | Supabase Free supports Send Email hook + custom SMTP + CAPTCHA (cited in roadmap addendum 3, not re-fetched) | 03-11 | Email design changes |
| A4 | Exact hosted auth-config JSON field names | 03-11 drift | Pin from the first real response |
| A5 | `sb_secret_` keys behave like service_role for CAPTCHA bypass (E10) | 03-08 | Re-check on staging |
| A6 | SES sandbox + verified recipient satisfies "DKIM passing" acceptance | 03-11 | Needs production access first |
| A7 | Legacy-key removal for new projects (changelog via search digest) | R-K | If legacy keys exist, renaming is optional, not required |
| A8 | `@marsidev/react-turnstile` 1.6.2 and `@aws-sdk/client-sesv2` 3.1155.0 are API-compatible with current docs | Stack | Minor code changes |

## Sources

### Primary (HIGH)
- Repo files read this session: `docs/v2/V2_MASTER_ROADMAP.md` (§1.2, §9, §9.1, §10.1-10.3, §12.2), `docs/adr/0005-confine-service-role-client.md`, `docs/v2/AUTH_REDESIGN.md` (§0, §3.3-3.6, §4.1-4.4, §5, §7-§11), `docs/v2/VERIFICATION_LOG.md` (:690-741, addendum 3), `.planning/phases/01A-local-db-harness/01A-04-AUTH00-SPIKE.md`, `.planning/phases/02-ci-e2e-foundations/02-PLAN.md` (:440-500), `02-SUMMARY.md`, `.planning/phases/01-security-containment/01-PLAN.md`, `briefs/01-06-auth.md`, `docs/v2/BACKEND_MIGRATION_PLAN.md` (B1-B8, D1-D2, H1-H4), `docs/v2/TARGET_ARCHITECTURE.md` (§3.8, §6, §7), `docs/v2/ARCHITECTURE_DECISIONS.md` (ADR-016), `.planning/PO-ACTIONS.md`, code paths cited inline.
- Commands: `git grep` inventories; `npx supabase db reset --local`, `db diff --local`, `gen types --local`, `status`; `psql` catalogue queries; scratch-copy `tsc` experiment; `npm run typecheck`; `npx eslint . -f json`; `npm view`; `gsd-tools query package-legitimacy check`.
- [Next.js support policy](https://nextjs.org/support-policy); [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16); [instrumentation.js reference](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation).
- [Supabase SSR client (Next.js)](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs); [Supabase Auth CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha); [HIBP API v3 (Pwned Passwords)](https://haveibeenpwned.com/API/v3).

### Secondary (MEDIUM)
- [Supabase API keys](https://supabase.com/docs/guides/api/api-keys), [changelog 29260](https://supabase.com/changelog/29260-upcoming-changes-to-supabase-api-keys), [GitHub discussion 40300](https://github.com/orgs/supabase/discussions/40300) (search digest).
- [Management API get auth config](https://supabase.com/docs/reference/api/v1-get-auth-service-config), [access tokens](https://supabase.com/docs/guides/platform/access-tokens), [OAuth scopes](https://supabase.com/docs/guides/platform/oauth-apps/oauth-scopes) (search digest).
- Next 15 EOL commentary: [digitalapplied](https://www.digitalapplied.com/blog/nextjs-15-end-of-support-october-21-upgrade-options), [endoflife.ai](https://endoflife.ai/nextjs/15) (superseded by the official extension to 2027-01-31).

## Metadata
- Standard stack: HIGH (registry + lockfile). Architecture: HIGH for in-repo patterns, MEDIUM for hosted pieces. Pitfalls: HIGH (most reproduced this session).
- Research date 2026-11-13; valid ~30 days (Next/Supabase move fast; re-check key-deprecation and Next patch levels at plan time).
