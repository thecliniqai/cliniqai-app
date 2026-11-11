# clinicOS v2.0: Target Backend Architecture

**Workstream:** C, consolidated into prompt §10 items 4–9, 12 and 13 (backend, data access, authN/Z, tenant isolation, API contracts, integrations, CI/CD and deployment, monitoring and observability). Items 1–3, 10 and 11 belong to Workstreams B, E and D and are referenced only where they touch the backend.
**Date:** 2026-11-10 · **Status:** Proposed. Decisions are recorded in `ARCHITECTURE_DECISIONS.md` and sequenced in `BACKEND_MIGRATION_PLAN.md`.

---

## 1. Guiding constraints

- **Scale reality.** **Assumption (validate):** small independent clinics in India. Expect hundreds of tenants in year one and tens of thousands of visits per month in total, a team of 1–3 engineers, and ₹1,000/month pricing. This argues against new infrastructure and new vendors and for strong defaults.
- **Healthcare data.** Correctness, isolation, auditability and retention matter more than throughput.
- **Keep what works.** Next.js App Router, Supabase Postgres, RLS and Auth, the outbox concept, the webhook signing scheme, the provider abstractions and the domain vocabulary all stay.
- **Change what is structurally unsafe:**
  - no service layer
  - no transactions
  - service-role sprawl
  - test seams in public signatures
  - hand-written types
  - application-only invariants
  - opportunistic jobs
  - no observability

---

## 2. Target in one picture

```
                         ┌─────────────────────────────────────────────────────────┐
 Browser (RSC + client)  │                 Next.js (single deployable)             │
 ───────────────────────►│  ADAPTERS (thin, no business rules)                     │
   server actions        │   app/**/page.tsx (RSC reads via query services)        │
   fetch /api/v1         │   features/<d>/actions.ts  "use server"  ──┐            │
 External systems ──────►│   app/api/v1/**  withApi(...)  ────────────┤            │
 MSG91 / Twilio ────────►│   app/api/webhooks/**  withWebhook(...) ───┤            │
 Scheduler (cron) ──────►│   app/api/jobs/run     withSystem(...) ────┤            │
                         │                                            ▼            │
                         │  APPLICATION / DOMAIN  (features/<d>/)                  │
                         │   policy.ts  → can(ctx, action, resource)               │
                         │   service.ts → use-cases; one DB tx per command         │
                         │                (one RPC call): audit + outbox in it     │
                         │   schema.ts  → zod contracts (input/output/events)      │
                         │                                            │            │
                         │  INFRASTRUCTURE                            ▼            │
                         │   repo.ts (supabase-js + generated DB types; one        │
                         │            plpgsql RPC per atomic command)              │
                         │   lib/db: user client · getSystemDb: lib/supabase       │
                         │   lib/core: Result, AppError, RequestContext, logger    │
                         │   lib/integrations: messaging, ai, pdf, storage,        │
                         │                     payments                            │
                         │   lib/jobs: claim/dispatch handlers registry            │
                         └───────────────┬───────────────────────────┬─────────────┘
                                         │ supabase-js (user JWT):   │ supabase-js
                                         │ PostgREST reads + .rpc()  │ (Auth, Storage)
                                         │ → RLS applies             │
                                         ▼                           ▼
                         ┌─────────────────────────────────────────────────────────┐
                         │ Supabase: Postgres 15+ (RLS role-aware, composite       │
                         │ tenant FKs, CHECK/EXCLUDE constraints, immutability     │
                         │ triggers, outbox/jobs tables, pg_cron) · Auth · Storage │
                         │ SECURITY INVOKER plpgsql RPC per atomic command;        │
                         │ has_permission() in RLS                                 │
                         └─────────────────────────────────────────────────────────┘
   Observability: pino → platform logs/drain · Sentry (errors, traces) · /api/ready + queue-lag metrics
```

Data path (erratum 2026-11-10, C18): request-path code reaches Postgres only through the **user-scoped supabase-js client** (the caller's JWT, so RLS and `has_permission()` apply). Each multi-step write is **one `SECURITY INVOKER` plpgsql function per command**, called with `.rpc()`, that writes its audit and outbox rows in the same transaction. There is no `pg` pool, no `DATABASE_URL`, no Kysely and no `withTenantTx` (ADR-003 superseded). Jobs and webhooks use the confined `getSystemDb(reason)` (ADR-005). DB types are generated with `supabase gen types` (ADR-013, P1-34).

### Module dependency rules (enforced by ESLint `no-restricted-imports` or `eslint-plugin-boundaries`)

```mermaid
flowchart LR
  A[app/** pages & routes] --> B[features/*/actions.ts & api handlers]
  B --> C[features/*/service.ts]
  C --> D[features/*/policy.ts]
  C --> E[features/*/repo.ts]
  C --> F[lib/integrations/*]
  C --> G[lib/jobs (enqueue only)]
  E --> H[lib/db]
  C --> I[lib/core]
  B --> I
  X[features/A/service.ts] -. "public API only (index.ts)" .-> Y[features/B/service.ts]
```

- `app/**` may import only `features/*/actions.ts`, `features/*/queries.ts` (read models) and `lib/core`.
- `repo.ts` is the only code allowed to import `lib/db`. `getSystemDb()` lives in its own module, `lib/supabase/system.ts`, and is importable only from `lib/jobs/**`, `features/*/system.ts` and `app/api/{jobs,webhooks}/**`; sites not yet moved sit on the time-boxed exception register of `docs/adr/0005-confine-service-role-client.md` (erratum 2026-11-10, C50) Services import only the `lib/jobs` **enqueue surface** (user client or the SECURITY DEFINER enqueue RPC, never `getSystemDb`); the internal part (claim, handlers, runner) may call `getSystemDb` and is importable only from `app/api/jobs/**` (erratum 2026-11-11, C50).
- Cross-domain calls go through the other domain's `index.ts`, which exposes service functions, never its repo.
- `"use server"` files export only action functions with **exactly one** zod-validated input parameter.

---

## 3. Technology decisions (§10 format)

### 3.1 Backend architecture (§10.4)
| | |
|---|---|
| **Current** | Next.js 15 monolith. Logic lives in `"use server"` files with direct PostgREST calls. The REST API duplicates logic. No layers. |
| **Recommended** | **Modular monolith** on Next.js (retain), with the per-domain contract in §4 and enforced boundaries. A single deployable plus a scheduler. No separate worker service until job volume or latency proves it necessary (re-evaluate when any job takes >60 s or the queue lags >5 min at p95). |
| **Reason** | Real problems are layering, transactions and duplication, not deployment topology. Microservices would multiply the tenancy, auth and transaction problems. |
| **Advantages** | One codebase and one deploy. Services are reusable by UI, REST, webhooks and jobs. Unit-testable domain logic. |
| **Disadvantages** | Needs discipline (lint rules) to keep boundaries. Serverless time limits constrain heavy jobs. |
| **Migration complexity** | L. Incremental, domain by domain (strangler pattern inside the repo). |
| **Operational implications** | Unchanged deployment model. Add a scheduler (§3.6). No new database URL secret: data access stays on supabase-js and RPCs (erratum 2026-11-10, C18). |

### 3.2 Database and data-access approach (§10.5)
| | |
|---|---|
| **Current** | supabase-js (PostgREST) everywhere, hand-written types, 387 `as any`, no transactions, invariants in TypeScript. |
| **Recommended** | **Postgres stays the system of record. Supabase SQL migrations stay the single source of schema truth.** Application data access stays on **supabase-js with the user-scoped client** (the caller's session JWT), so **RLS and `has_permission()` (ADR-006) apply to every request-path query**. Each **atomic multi-step write is one plpgsql function per command, `SECURITY INVOKER`** (it runs under the caller's RLS, with `auth.uid()` as the actor), called through `.rpc()`; it does the reads, locks, writes, audit row and outbox/job rows in one transaction. Single-statement writes and reads stay on PostgREST. **DB types are generated with `supabase gen types`** (ADR-013, roadmap P1-34), which removes most `as any` casts without a second data layer. SECURITY DEFINER functions stay limited to security primitives (role change, share-token resolution, `api_authenticate()`, counters, amendment unlock). The service role is used only through the confined `getSystemDb(reason)` in jobs and webhooks (ADR-005). Invariants move into constraints and triggers (DATABASE_ASSESSMENT §5). A **D1 confirmation spike** (roadmap V2-03 plan 03-07, before V2-05) proves one flow end to end: RLS, `auth.uid()` as actor, audit and outbox in one transaction, and error mapping to `AppError`. (erratum 2026-11-10, C18) |
| **Reason** | Multi-step clinical and financial writes need real transactions. PostgREST cannot span statements except inside a function, and a plpgsql function per atomic command gives that without a new privileged secret, pooler constraints or a second data layer. Only about 8 commands need it (roadmap P1-05), so the plpgsql surface stays small. (erratum 2026-11-10, C18) |
| **Alternatives considered** | **(a) Kysely + `pg` through the Supavisor transaction pooler, with `withTenantTx` setting `ROLE authenticated` and `request.jwt.claims` per transaction** (the original ADR-003 proposal). Typed SQL and app-side transactions, but adds a high-privilege `DATABASE_URL`, pooler constraints and a second data layer. **Superseded**; revisited only through a new ADR if RPCs prove unmaintainable. **(b) Drizzle ORM.** Wants to own the schema and migrations (drizzle-kit), which conflicts with the SQL-first RLS-heavy migrations. **(c) Prisma.** Heavier runtime and poor fit with RLS session variables. Rejected. (erratum 2026-11-10, C18) |
| **Advantages** | Real transactions inside Postgres with the caller's identity. RLS retained everywhere, no new secret, no connection pool to run on serverless. One data client (supabase-js) for data, Auth, Storage and Realtime. Compile-time types generated from the real schema. (erratum 2026-11-10, C18) |
| **Disadvantages** | Business logic for the atomic commands lives in plpgsql: it needs pgTAP coverage (happy path, RLS denial, constraint violations, rollback on failure) and careful review. RPC argument and return payloads are typed only as far as `supabase gen types` allows; zod parses the result at the service boundary. Errors raised in plpgsql need a stable mapping to `AppError` (§6). (erratum 2026-11-10, C18) |
| **Migration complexity** | M–L, done per flow. Generated types (V2-03) and the D1 confirmation spike land first; the atomic-command RPCs follow in V2-07 (P1-05). (erratum 2026-11-10, C18) |
| **Operational implications** | Set `statement_timeout` for the `authenticated` role and per function where needed. Functions use `SET search_path = ''` and schema-qualified names. **Assumption (validate):** the region is ap-south-1 for latency and residency. (erratum 2026-11-10, C18) |

### 3.3 Authentication and authorisation (§10.6)
| | |
|---|---|
| **Current** | Supabase Auth with email OTP (dev magic-link helper). Cookie session through `@supabase/ssr` 0.5.2. Membership and role resolved per call. RBAC matrix in TypeScript only. RLS is tenant-only. Memberships can self-escalate (P0). |
| **Recommended** | **Retain Supabase Auth.** Upgrade `@supabase/ssr`. Add phone OTP through an MSG91 SMS hook if product needs it (Workstream A/D). Authorisation in **two layers from one source of truth**: a STABLE `has_permission(tenant, perm)` SQL function with a hard-coded `CASE` over the 5 fixed roles, used by RLS, and the TypeScript `policy.ts` / `lib/permissions/matrix.ts`, kept in parity by a unit test (no `role_permissions` table unless custom roles are approved) (erratum 2026-11-10, C19). Resolve `RequestContext {userId, tenantId, role, permissions, actorType, requestId}` once per request, memoised with `React.cache`. Lock down `memberships` columns, and make role changes go through an RPC. |
| **Reason** | Auth itself is not the problem. The gaps are authorisation enforcement and duplication. Replacing the IdP would add migration risk (existing users) for no benefit. |
| **Advantages** | No user migration. RLS enforces RBAC even if a code path forgets to. A single matrix. |
| **Disadvantages** | Role-aware RLS policies are more complex; this needs pgTAP tests and the performance pattern `(select auth.uid())`. |
| **Migration complexity** | M. |
| **Operational implications** | Permission changes become migrations (auditable). Optionally move tenant and role into JWT custom claims later, through a Supabase access-token hook, but only if multi-clinic switching UX is solved (claims go stale on switch). Not required now. |

### 3.4 Tenant isolation (§10.7)
| | |
|---|---|
| **Current** | Shared schema, `tenant_id` columns, tenant-only RLS. Service role in about 35 files. Cross-tenant FKs possible. Server-action overrides bypass everything (P0). |
| **Recommended** | **Shared-schema multi-tenancy (retain)** with layered defence: (1) RLS on every table, role-aware for clinical data; (2) composite `(tenant_id, id)` foreign keys so references cannot cross tenants; (3) all request-path DB access through the user-scoped supabase-js client under the user's JWT (atomic writes as `SECURITY INVOKER` RPCs), and API-key traffic through explicit RPCs or a short-lived principal JWT (ADR-011) (erratum 2026-11-10, C18); the service role only in a `system` context (jobs, public-token RPCs) with a reason code and a log line; (4) public patient links resolved by SECURITY DEFINER RPCs that return only the needed fields after token-hash lookup; (5) CI pgTAP suite asserting cross-tenant denial for every table and RPC; (6) an ESLint rule banning `getSystemDb` outside allowed paths. |
| **Reason** | Schema-per-tenant or DB-per-tenant is unjustified at this scale and would break cross-clinic referrals and operations. |
| **Advantages** | Isolation no longer depends on every developer remembering `.eq("tenant_id")`. |
| **Disadvantages** | More SQL to maintain. Composite FKs need `UNIQUE (tenant_id, id)` on parents (cheap). |
| **Migration complexity** | M. |
| **Operational implications** | A read-only diagnostic query set runs before constraint validation (BACKEND_MIGRATION_PLAN §3). |

### 3.5 API contracts (§10.8)
| | |
|---|---|
| **Current** | Server actions with ad hoc `{success,error}`. REST v1 with a good envelope but duplicated logic, no scopes, no idempotency, in-memory rate limits and a hand-written OpenAPI that has drifted. |
| **Recommended** | **Contract-first with zod v4.** Each domain's `schema.ts` defines inputs, outputs (DTOs) and events. Server actions return `ActionResult<T>` (§6). REST v1 handlers are generated from a `withApi` pipeline that calls the same services. OpenAPI 3.1 is generated from the zod schemas and webhook event schemas, with CI checks. API keys become scoped principals under RLS, with Postgres-backed rate limiting and an `Idempotency-Key` table (API_ASSESSMENT §6). |
| **Reason** | One contract source removes drift and the duplicate rules. |
| **Advantages** | Typed end to end. Docs always match. Safer integrations for partners. |
| **Disadvantages** | Zod 3→4 upgrade work (also needed for the security advisory). Generated docs need curation for examples. |
| **Migration complexity** | M. |
| **Operational implications** | Versioning and deprecation policy documented. Usage analytics from the `api_usage` table. |

### 3.6 Integrations and background jobs (§10.9)
| | |
|---|---|
| **Current** | Two outbox tables. Dispatch is inline in requests (cross-tenant), fire-and-forget, or via cron routes with no scheduler in the repo. No claiming. Governance unused. PDFs synchronous. Dual storage providers. AI with no quota. |
| **Recommended** | **Transactional outbox plus a Postgres job queue, driven by a scheduler; no new broker.** Add a generic `jobs` table (`id, tenant_id, kind, payload jsonb, run_at, attempts, max_attempts, status, locked_until, last_error, dedupe_key UNIQUE NULLS NOT DISTINCT`). Keep the existing `communication_queue` and `webhook_delivery_queue` as domain "delivery" tables, now **inserted inside the business transaction**. Claim with an RPC `claim_jobs(kinds, batch, lease_seconds)` using `FOR UPDATE SKIP LOCKED` and setting `locked_until`; expired leases become claimable again. **Trigger:** a Supabase `pg_cron` job every minute calls `/api/jobs/run` through `pg_net`, authenticated by a rotating secret; Vercel Cron is an alternative depending on the plan (**Assumption (validate)** with Workstream F). Handlers are idempotent (dedupe keys, provider message IDs). Governance (quiet hours, quota, opt-out, consent) is applied at enqueue and re-checked at send. Archival PDFs, retention purges, AI quota-reservation clean-up and webhook deliveries become job kinds (there is no AI summary job: the LLM catch-up is replaced by the deterministic patient snapshot, SA-04) (erratum 2026-11-10, AI §11.2). Consider **pgmq** (Supabase Queues) as a drop-in for the claim mechanics if preferred. |
| **Reason** | Correct delivery semantics (at-least-once with dedupe), no lost events, no request-path latency, and no new infrastructure. |
| **Advantages** | One mechanism for every async concern. Queue state is queryable. Transactional with business writes. |
| **Disadvantages** | Polling latency of up to about 60 s for non-urgent messages (urgent sends can still be kicked opportunistically **after commit**, through `after()` in Next 15). Serverless duration limits cap batch size. |
| **Migration complexity** | M. |
| **Operational implications** | Alert on queue lag, dead letters and lease expiries. A runbook for replaying dead letters. **Single storage provider:** choose Supabase Storage (RLS-integrated, same region and vendor, simplest) unless egress cost analysis favours R2. Remove the other path (ADR-014). **AI:** one AI gateway module at `lib/integrations/ai` (`AI_STRATEGY.md` AI-04): an `AiProvider` interface with a single Google Vertex AI adapter pinned to `asia-south1`, structured output, pseudonymisation and post-checks, `ai_calls` metadata, per-tenant entitlement, quota and rate limits, server-side context assembly and usage audit (erratum 2026-11-10, AI §11.2). **Messaging:** keep the MSG91 adapter; delete Twilio and Gupshup if unused. |

### 3.7 CI/CD and deployment (§10.12, backend aspects; Workstream F owns the pipeline)
| | |
|---|---|
| **Current** | No CI workflows in the repo. Tests need the hosted Supabase. Migrations applied manually. Edited-in-place migrations. |
| **Recommended** | GitHub Actions running: typecheck → lint (with boundary rules) → unit tests (services with an in-memory or fake repo) → **integration tests against an ephemeral local Supabase** (`supabase start` + `db reset`) → pgTAP RLS and constraint tests → generated-types diff check → **migration immutability check** → build. Staging and production Supabase projects are separate. Migrations are applied by CI to staging automatically and to production with manual approval (`supabase db push`), always before the app deploy (expand/contract). Preview deployments use a staging DB or a branch database (Supabase Branching, if the plan allows). |
| **Reason** | Today nothing protects production from a broken migration or an RLS regression. |
| **Migration complexity** | M. |
| **Operational implications** | Owners must never run seed or test scripts against production (`.env` currently points tests at a hosted project; see the shared brief). |

### 3.8 Monitoring and observability (§10.13)
| | |
|---|---|
| **Current** | 191 `console.*` calls. Correlation IDs only on API 5xx. Health and ready endpoints. No error tracking, no metrics. |
| **Recommended** | (1) **pino** structured logger in `lib/core/logger` with child loggers carrying `requestId`, `tenantId`, `actorType`, `userId` (hashed or UUID only), `route/action`, `jobId`, and a **redaction list** (`*.phone`, `*.full_name`, `*.clinical_notes`, `*.address`, `authorization`, …). (2) **Sentry** (`@sentry/nextjs`) for errors and performance traces, with `sendDefaultPii: false`, `beforeSend` scrubbing and a data region chosen for compliance (**Assumption (validate)** with Workstream D). (3) Propagate `x-request-id` from middleware into the context, the logs and API error envelopes. (4) **Operational metrics:** `/api/ready` reports DB, storage, queue lag per kind, dead-letter counts and last scheduler run; an uptime monitor plus an alert route (e-mail or WhatsApp to on-call). (5) Supabase built-in logs and `pg_stat_statements` reviewed weekly. |
| **Reason** | A small team needs fast diagnosis without running observability infrastructure. |
| **Disadvantages** | Sentry is a new vendor that processes error context. PHI scrubbing must be verified. |
| **Migration complexity** | S–M. |
| **Operational implications** | Log retention and access controls per the compliance policy. |

### 3.9 Frontend framework (§10.1) (erratum 2026-11-10, P2-DOC)
| | |
|---|---|
| **Current** | Next.js App Router (`next@15.5.27`), React 19, TypeScript, Tailwind CSS v4 (`FRONTEND_TECHNOLOGY_ASSESSMENT.md` §1). |
| **Recommended** | **Keep the Next.js App Router.** Patch to the latest 15.5.x now (roadmap P0-06, C24); evaluate Next 16 (`middleware` → `proxy`) as a separate P2 PR in V2-03. RSC reads, server actions as the mutation layer (one atomic server command per business action, C18), GET route handlers for typeahead search, Supabase Realtime for Today with a polling fallback; TanStack Query deferred (roadmap FE-1, FE-5, FE-7). Installable PWA per `PWA_STRATEGY.md` (FE-11). |
| **Reason** | Scored 44 against React Router 7 framework mode 39, Vite SPA 33 and TanStack Start 32. The problems are in UI architecture, not the framework; about 110 exported functions in 24 `"use server"` modules already form the mutation layer (`FRONTEND_TECHNOLOGY_ASSESSMENT.md` §3; C8 counts 137 `export async function` in `features/`). |
| **Advantages** | In-place migration; RSC and streaming; small client JS on low-end devices if disciplined; mature ecosystem. |
| **Disadvantages** | Server actions are sequential per client and POST-only (poor for typeahead); every action is a public endpoint and must authorise. |
| **Migration complexity** | M for the Next upgrade (separate PR); the UI rebuild is phased M0–M5 (`FRONTEND_MIGRATION_PLAN.md`). |
| **Operational implications** | Unchanged Vercel deployment; route and Lighthouse budgets per `PWA_STRATEGY.md` §3.9 (report-only nightly, blocking at V2-15). |

### 3.10 Component library, styling and design system (§10.2, §10.3) (erratum 2026-11-10, P2-DOC)
| | |
|---|---|
| **Current** | 12 hand-rolled primitives in `components/ui` derived from the TailAdmin free template, no headless library, 937 arbitrary hex values, 0 focus-management code (`FRONTEND_TECHNOLOGY_ASSESSMENT.md` §1, §1.1). |
| **Recommended** | **shadcn/ui open-code components on Radix**, styled with v2 Tailwind tokens; `cmdk`, `react-day-picker`, `sonner`, TanStack Table; react-hook-form + zod 4 shared schemas. Fallback per component: Base UI or React Aria behind the same API. Design system **"Clinic Paper"** (`DESIGN_SYSTEM.md`): teal accent, warm neutrals, IBM Plex, tabular numerals, en-IN and IST conventions, healthcare patterns, enforced by CI grep guards and a palette reset. `/dev/ui` gallery with Playwright screenshots and axe instead of Storybook (roadmap FE-2, FE-3, FE-4, FE-8). |
| **Reason** | Accessibility (focus trapping, comboboxes, dismissable layers) cannot be reached by patching; there is no component contract and core primitives are missing (`FRONTEND_TECHNOLOGY_ASSESSMENT.md` §1.1). |
| **Advantages** | Mature accessibility; open code (no lock-in); one token source. |
| **Disadvantages** | Risk that Radix maintenance slows (mitigated by per-component swap); visual regressions while old and new coexist (`FRONTEND_TECHNOLOGY_ASSESSMENT.md` §8). |
| **Migration complexity** | L for primitives and clinical components (M2); XL in total for workflow rebuilds (M4). Design sub-gate G2-D approves rendered tokens and mock-ups before primitives are built (phase V2-DX). |
| **Operational implications** | Dependencies installed only after approval; bundle budgets in CI. |

### 3.11 Testing infrastructure (§10.10) (erratum 2026-11-10, P2-DOC)
| | |
|---|---|
| **Current** | 69 spec files, 649 cases; 206 skipped; 27 files fail without the hosted DB; no e2e, a11y, visual or coverage tooling; tests not type-checked (roadmap §8, `TEST_STRATEGY.md` §2–§4). |
| **Recommended** | Vitest (unit); Vitest + **local ephemeral Supabase** for DB integration (guard refuses non-local URLs); **pgTAP** RLS matrix over all tenant tables × CRUD × roles; an auth/permission guard test over every server action and route handler; MSW contracts for MSG91 and AI; **Playwright + @axe-core/playwright** on the `PWA_STRATEGY.md` §9.1 device matrix; concurrency tests; AI eval lanes L1 and L2 on every PR and L3 manually on each model or prompt change (nightly once pre-prod exists; `AI_STRATEGY.md` §7); nightly full e2e and ZAP baseline; pre-release k6 and a restore drill (`TEST_STRATEGY.md` §6, roadmap §8; backend-facing detail in §11 below). |
| **Reason** | Tests today depend on a hosted project with the service-role key (SEC-25) and cannot gate releases. |
| **Advantages** | Evidence-based gates (CI run links only); 0 skipped in the DB lane. |
| **Disadvantages** | CI time and maintenance of the generated pgTAP matrix. |
| **Migration complexity** | M–L, spread over V2-02 onward (`TEST_STRATEGY.md` §10). |
| **Operational implications** | Coverage ≥ 80 % lines / ≥ 70 % branches and p95 < 1.5 s are proposals to confirm at G2. |

### 3.12 Security tooling (§10.11) (erratum 2026-11-10, P2-DOC)
| | |
|---|---|
| **Current** | No CI, no SAST, no secret scanning in the pipeline, no security headers; `npm audit` reports high and critical issues (`SECURITY_ASSESSMENT.md` SEC-13, SEC-24, SEC-28). |
| **Recommended** | Per `SECURITY_VERIFICATION_PLAN.md`: Semgrep (OSS rulesets + custom rules), ESLint with `eslint-plugin-security` and `no-restricted-imports` + `no-restricted-syntax` (ESLint is the **single** enforcement mechanism for the ADR-005 service-role allow-list and its exception register, C20/C50), `tsc --noEmit`, `supabase db lint`; `npm audit --omit=dev --audit-level=high` + OSV-Scanner, Renovate/Dependabot, SBOM; gitleaks (history + pre-commit); pgTAP RLS matrix and role × operation tests; OWASP ZAP baseline/authenticated scans on local or staging only; an adversarial Claude security review in V2-14; no external penetration test in v2.0 (PO-17 round 2), recommended before scaling beyond the pilot (roadmap V2-14). Reports stored as CI artefacts (SARIF/JUnit/ZAP JSON). |
| **Reason** | Containment fixes need regression guards; DPDP/CERT-In evidence requires recorded results. |
| **Advantages** | Free/OSS tools; no repository content uploaded to third parties without approval. |
| **Disadvantages** | Custom Semgrep rules need upkeep; DAST is staging/local only. |
| **Migration complexity** | S–M, landing with CI in V2-02 and the security verification in V2-14. |
| **Operational implications** | Never run DAST against production, Supabase-hosted endpoints, MSG91 or AI providers. |

---

## 4. Domain module contract

```
features/<domain>/
  index.ts        // public surface for OTHER domains: re-exports service fns + types only
  schema.ts       // zod: Inputs, Outputs (DTOs), Events; inferred TS types
  policy.ts       // can(ctx, 'visit.sign', visit) → boolean | AppError; pure, unit-tested
  repo.ts         // supabase-js (user-scoped client) queries and .rpc() calls, typed by
                  //   generated DB types; no business rules; returns rows (erratum 2026-11-10, C18)
  service.ts      // use-cases: (ctx, input) => Promise<Result<Output, AppError>>
                  //   - calls policy, then ONE transaction: a single-statement write or one
                  //     SECURITY INVOKER plpgsql RPC that also writes audit + outbox/jobs rows
  queries.ts      // read models for RSC pages (may be cached per request)
  actions.ts      // "use server": parse → getContext() → service → toActionResult; revalidate
  api.ts          // REST adapters used by app/api/v1/** via withApi()
  jobs.ts         // job handlers registered by kind (idempotent)
  system.ts       // (optional) system-context entry points, e.g. webhook-driven flows
  __tests__/      // service tests with fake repo; repo tests against local Supabase
supabase/migrations/…   // the atomic-command plpgsql functions live here, covered by pgTAP
```

**Example shape (illustrative, not implementation) (erratum 2026-11-10, C18):**
```ts
// features/billing/service.ts
export async function recordPayment(ctx: RequestContext, input: RecordPaymentInput)
  : Promise<Result<PaymentRecorded, AppError>> {
  const denied = policy.canRecordPayment(ctx); if (denied) return err(denied);
  // One RPC = one transaction, under the caller's RLS (SECURITY INVOKER).
  const res = await repo.recordPayment(ctx, input);
  if (!res.ok) return err(mapDbError(res.error));   // e.g. reason 'OVERPAYMENT' → CONFLICT, 42501 → FORBIDDEN
  return ok({ paymentId: res.value.payment_id });
}

// features/billing/repo.ts
export async function recordPayment(ctx: RequestContext, input: RecordPaymentInput) {
  const db = await getUserDb();                      // lib/db: user-scoped client (session JWT), React.cache
  const { data, error } = await db.rpc('record_payment', {
    p_invoice_id: input.invoiceId, p_amount: input.amount,
    p_method: input.method, p_command_id: input.commandId,
  });                                                // args and result typed by `supabase gen types`
  return error ? { ok: false as const, error } : { ok: true as const, value: data };
}
```
```sql
-- supabase/migrations/<ts>_record_payment.sql
create function public.record_payment(p_invoice_id uuid, p_amount numeric, p_method text, p_command_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_inv public.invoices; v_paid numeric; v_payment_id uuid;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;   -- RLS filters other tenants
  if not found then raise exception using errcode = 'P0002', message = 'NOT_FOUND'; end if;
  if v_inv.status = 'cancelled' then raise exception using errcode = 'P0001', message = 'INVOICE_CANCELLED'; end if;
  -- sum payments, reject overpayment ('OVERPAYMENT'), insert payment (recorded_by = auth.uid()),
  -- update invoice status, insert audit row and outbox row: all in this one transaction
  return jsonb_build_object('payment_id', v_payment_id);
end $$;
```

---

## 5. Request context

```ts
type ActorType = 'user' | 'api_key' | 'system' | 'patient_link';
interface RequestContext {
  requestId: string;
  actorType: ActorType;
  userId: string | null;          // auth.users id, or service-principal id for api_key
  tenantId: string;               // active tenant (validated membership)
  role: UserRole | 'integration' | 'system';
  permissions: ReadonlySet<Permission>;
  apiKeyId?: string; scopes?: ReadonlySet<ApiScope>;
  now: Date; tenantTimeZone: string;  // all "today" logic uses tenant TZ (fixes UTC bugs)
  log: Logger;
}
```
- `getUserContext()` is memoised per request with `React.cache` and is built from the Supabase session plus memberships (one query).
- `getApiKeyContext(req)` is built from a single `api_authenticate()` RPC.
- `getSystemContext(reason, tenantId?)` is available only in jobs, webhooks and public-link handlers.

---

## 6. Standard error and result type

```ts
type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

type AppErrorCode =
  | 'VALIDATION_FAILED' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND'
  | 'CONFLICT' | 'PRECONDITION_FAILED' | 'RATE_LIMITED' | 'IDEMPOTENCY_MISMATCH'
  | 'DEPENDENCY_FAILED' | 'INTERNAL';

interface AppError {
  code: AppErrorCode;
  message: string;                 // safe, user-presentable
  reason?: string;                 // machine sub-code e.g. 'OVERPAYMENT', 'SLOT_TAKEN'
  fieldErrors?: Record<string, string[]>;
  cause?: unknown;                 // never serialised to clients; logged with redaction
}
```
- **Expected failures** (validation, not found, conflict) are returned as `err(...)`. **Unexpected failures** are thrown and caught at the adapter boundary, logged with `requestId`, and mapped to `INTERNAL`.
- **Postgres error mapping in `lib/db`:**
  - `23505` → `CONFLICT`
  - `23503` → `PRECONDITION_FAILED`
  - `23514`/`23P01` (check or exclusion violation) → `CONFLICT` with a reason derived from the constraint name
  - `42501` (RLS) → `FORBIDDEN`
  - `P0001`/`P0002` raised by an atomic-command RPC → `CONFLICT`/`NOT_FOUND`, with `reason` taken from the exception message (erratum 2026-11-10, C18)
  - others → `INTERNAL`
- **Adapters:**
  - Actions return `ActionResult<T> = { ok: true, data } | { ok: false, error: { code, message, fieldErrors? } }`.
  - REST returns the existing v1 envelope, with an HTTP status taken from the code table (400/401/403/404/409/412/429/502/500) and `correlation_id = requestId` on every error.

---

## 7. Transaction strategy

1. **One command, one transaction.** Every service command that writes runs in exactly one transaction: a single-statement write through supabase-js, or, for a multi-step write, **one `SECURITY INVOKER` plpgsql function called through `.rpc()`** under the caller's RLS. Audit rows (actor = `auth.uid()`) and outbox or job rows are written inside that function. Jobs and webhooks run the same functions through `getSystemDb(reason)` only where ADR-005 allows it, with an explicit system-actor argument (under the service role `auth.uid()` is null, so the audit actor and any `has_permission()` check need it); the system path is confirmed in the D1 spike (erratum 2026-11-10, C18). External calls (HTTP, AI, provider sends, PDF rendering) are **never** made inside a transaction. They are enqueued as jobs, or done before the transaction with the results validated inside it.
2. **The database guards invariants.** Uniqueness, exclusion (double-booking), CHECKs (money), composite FKs (tenancy) and immutability triggers (signed records). Services rely on these constraints and map violations to `CONFLICT`. Application pre-checks exist only for user-friendly messages.
3. **Concurrency.** `SELECT … FOR UPDATE` on aggregate roots (invoice, visit) inside the command's RPC for read-modify-write flows (erratum 2026-11-10, C18). Counters (queue tokens, invoice numbers) use `INSERT … ON CONFLICT DO UPDATE … RETURNING`. Use optimistic `version` columns only where long-lived edits occur (consultation draft autosave).
4. **Isolation level.** READ COMMITTED (the default) plus row locks. Use SERIALIZABLE only if a specific anomaly is found.
5. **Timeouts.** `statement_timeout` of about `'5s'` for the `authenticated` role (request path), set per function (`ALTER FUNCTION … SET statement_timeout`) where a command needs a different limit, and `'60s'` for job handlers (erratum 2026-11-10, C18).
6. **Idempotency.** API `Idempotency-Key`, server-action client-generated `commandId` on non-idempotent forms (payments, check-in), and job `dedupe_key`.

**Critical flows to migrate first** (each becomes one plpgsql RPC; roadmap P1-05 holds the authoritative list of the 8 atomic commands for V2-07, and the D1 confirmation spike in V2-03 plan 03-07 proves the pattern on one of them first) (erratum 2026-11-10, C18):
- create invoice (header, items, number)
- record payment
- complete and sign consultation (visit, prescription, audit, outbox, archival-PDF job)
- reopen and finalise amendment (snapshot, unlock, re-sign)
- check-in (token, visit status)
- walk-in (patient lookup or create, visit, token)
- register and book (patient, appointment; exclusion constraint)
- collect (payment against an existing invoice at the desk)

Later candidates, not in P1-05 (illustrative): waitlist promotion, staff reschedule, patient erasure (restriction, revoke tokens, cancel queued messages).

---

## 8. Job processing strategy

```
 service tx ──► INSERT jobs/communication_queue/webhook_delivery_queue (status=pending, run_at)
                     │ (commit)
 pg_cron (1/min) ──► pg_net POST /api/jobs/run  (secret)        after(): optional immediate kick
                     │
                     ▼
     claim_jobs(kinds[], batch=25, lease=120s)  -- UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)
                     │
       per job: handler(ctx=system(tenant), payload) ── idempotent (dedupe_key / provider msg id)
                     │ success → status=done   failure → attempts+1, run_at=backoff, or dead
                     ▼
     metrics: lag (now - min(run_at) where pending), dead count, last run → /api/ready + alerts
```
- **Job kinds:** `message.send`, `webhook.deliver`, `pdf.archive_prescription`, `pdf.receipt`, `ai.reservations_cleanup` (erratum 2026-11-10, AI §11.2), `retention.purge_*`, `erasure.anonymise`, `subscription.renewal_reminder`.
- **Backoff:** exponential with jitter. `max_attempts` per kind. Dead-letter rows stay for 30 days and can be replayed from an admin UI or script.
- **Tenant fairness:** the claim orders by `run_at` with a per-tenant cap per batch (window function), so no tenant can starve others.

---

## 9. Caching strategy

- **Per-request memoisation** (`React.cache`) of the context and reference lookups. This removes 2–4 redundant auth round trips per action.
- **Reference data** (`opd_diagnoses`, CDCI search): use `unstable_cache`/`use cache` with tag invalidation on reseed. Tenant data is **not** cached across requests (PHI, correctness).
- No Redis or CDN caching of API responses. Revisit only on measured need.

---

## 10. Security-relevant backend defaults (aligned with Workstream D)

- **Secrets:** a zod-validated `env` for every variable, with `server-only` imports. Fail fast at boot.
- **Signing secrets** for webhooks are encrypted at rest. Share tokens are stored **hashed**, like invites and API keys.
- **Public patient links:** short TTL, revocable, rate-limited per IP and token, resolved by RPC with a tenant join.
- **Server actions:** a single validated input object, context from the session only, no exported internals.

---

## 11. Testing architecture (backend-facing; Workstream E owns the strategy)

- **Unit:** policies, money and time utilities, services with a fake repo.
- **Integration:** repos and services against an **ephemeral local Supabase**. No hosted project.
- **Database:** pgTAP for RLS (per role × per table × per command), constraints, triggers, SECURITY DEFINER functions and the atomic-command `SECURITY INVOKER` RPCs (happy path, RLS denial, rollback on failure) (erratum 2026-11-10, C18).
- **Contract:** OpenAPI generated from zod plus route-coverage tests. Webhook signature vectors.

---

## 12. What we deliberately do not change

- **Next.js App Router as the backend runtime.** There is no evidence that a separate API service is needed.
- **Supabase as platform** (Postgres, Auth, Storage, pg_cron, Vault): it fits team size and cost.
- **The shared-schema tenancy model.**
- **The v1 REST paths and envelope.** Hardening only; breaking changes wait for `/api/v2`.
- **The domain vocabulary and working business rules** (visit-centric model, versioned prescriptions, revision snapshots, consent records), refactored but preserved.
