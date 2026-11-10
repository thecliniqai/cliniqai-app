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
                         │   service.ts → use-cases; one DB tx per command;        │
                         │                writes audit + outbox in same tx         │
                         │   schema.ts  → zod contracts (input/output/events)      │
                         │                                            │            │
                         │  INFRASTRUCTURE                            ▼            │
                         │   repo.ts (Kysely, typed)   lib/db: withTenantTx/       │
                         │   lib/core: Result, AppError, RequestContext, logger    │
                         │   lib/integrations: messaging, ai, pdf, storage, payments│
                         │   lib/jobs: claim/dispatch handlers registry            │
                         └───────────────┬───────────────────────────┬─────────────┘
                                         │ pg (Supavisor tx-pool),   │ supabase-js
                                         │ RLS via SET LOCAL role +  │ (Auth, Storage only)
                                         │ request.jwt.claims        │
                                         ▼                           ▼
                         ┌─────────────────────────────────────────────────────────┐
                         │ Supabase: Postgres 15+ (RLS role-aware, composite tenant │
                         │ FKs, CHECK/EXCLUDE constraints, immutability triggers,   │
                         │ outbox/jobs tables, pg_cron) · Auth · Storage            │
                         └─────────────────────────────────────────────────────────┘
   Observability: pino → platform logs/drain · Sentry (errors, traces) · /api/ready + queue-lag metrics
```

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
- `repo.ts` is the only code allowed to import `lib/db`. `getSystemDb()` is importable only from `lib/jobs/**`, `features/*/system.ts` and `app/api/{jobs,webhooks}/**`.
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
| **Operational implications** | Unchanged deployment model. Add a scheduler (§3.6) and a database URL secret. |

### 3.2 Database and data-access approach (§10.5)
| | |
|---|---|
| **Current** | supabase-js (PostgREST) everywhere, hand-written types, 387 `as any`, no transactions, invariants in TypeScript. |
| **Recommended** | **Postgres stays the system of record. Supabase SQL migrations stay the single source of schema truth.** For application data access, use **Kysely** (typed SQL query builder) over `pg` through Supabase's **Supavisor transaction pooler**. Run every request inside `withTenantTx(ctx, fn)`, which starts a transaction and applies `SET LOCAL ROLE authenticated` plus `set_config('request.jwt.claims', <ctx claims>, true)`, so **RLS still applies**. Types are generated with `kysely-codegen` from the migrated local DB. Keep supabase-js only for **Auth and Storage**. Use plpgsql RPCs only for security primitives (role change, share-token resolution, counters, amendment unlock). Invariants move into constraints and triggers (DATABASE_ASSESSMENT §5). |
| **Reason** | Multi-step clinical and financial writes need real transactions. PostgREST cannot span statements except inside RPCs, and writing all business logic in plpgsql would be harder to test and review for this team. |
| **Alternatives considered** | **(a) supabase-js + plpgsql RPC for every multi-step write.** Lowest change and keeps the PostgREST model, but moves significant logic into SQL, gives weak typing of RPC payloads and makes unit testing harder. *Acceptable fallback if direct DB connections are ruled out.* **(b) Drizzle ORM.** Excellent typing and documented Supabase RLS patterns, but it wants to own the schema and migrations (drizzle-kit), which conflicts with the SQL-first RLS-heavy migrations; introspection-only use is possible but awkward. **(c) Prisma.** Heavier runtime and poor fit with RLS session variables. Rejected. |
| **Advantages** | Real transactions. Compile-time types generated from the real schema. SQL-transparent (easy to review, `EXPLAIN`). RLS retained as defence in depth. Fewer HTTP hops (one TCP connection instead of an HTTP request per statement). |
| **Disadvantages** | Adds a high-privilege `DATABASE_URL` secret, managed like the service-role key. Connection pooling on serverless must use transaction mode (no session-level state, no named prepared statements; Kysely with `pg` is compatible). The team must learn Kysely, which is small. Realtime and Storage still use supabase-js. |
| **Migration complexity** | L, done per domain. Phase 1 can deliver quick wins (generated types and RPCs for the 3 worst flows) before Kysely lands. |
| **Operational implications** | Monitor pooler connections. Set `statement_timeout`/`idle_in_transaction_session_timeout` per role. **Assumption (validate):** the Supabase plan includes Supavisor (all current plans do), and the region is ap-south-1 for latency and residency. |

### 3.3 Authentication and authorisation (§10.6)
| | |
|---|---|
| **Current** | Supabase Auth with email OTP (dev magic-link helper). Cookie session through `@supabase/ssr` 0.5.2. Membership and role resolved per call. RBAC matrix in TypeScript only. RLS is tenant-only. Memberships can self-escalate (P0). |
| **Recommended** | **Retain Supabase Auth.** Upgrade `@supabase/ssr`. Add phone OTP through an MSG91 SMS hook if product needs it (Workstream A/D). Authorisation in **two layers from one source of truth**: a `role_permissions` table (seeded from today's matrix), a STABLE `has_permission(tenant, perm)` used by RLS, and the TypeScript `policy.ts` reading the same generated constant. Resolve `RequestContext {userId, tenantId, role, permissions, actorType, requestId}` once per request, memoised with `React.cache`. Lock down `memberships` columns, and make role changes go through an RPC. |
| **Reason** | Auth itself is not the problem. The gaps are authorisation enforcement and duplication. Replacing the IdP would add migration risk (existing users) for no benefit. |
| **Advantages** | No user migration. RLS enforces RBAC even if a code path forgets to. A single matrix. |
| **Disadvantages** | Role-aware RLS policies are more complex; this needs pgTAP tests and the performance pattern `(select auth.uid())`. |
| **Migration complexity** | M. |
| **Operational implications** | Permission changes become migrations (auditable). Optionally move tenant and role into JWT custom claims later, through a Supabase access-token hook, but only if multi-clinic switching UX is solved (claims go stale on switch). Not required now. |

### 3.4 Tenant isolation (§10.7)
| | |
|---|---|
| **Current** | Shared schema, `tenant_id` columns, tenant-only RLS. Service role in about 35 files. Cross-tenant FKs possible. Server-action overrides bypass everything (P0). |
| **Recommended** | **Shared-schema multi-tenancy (retain)** with layered defence: (1) RLS on every table, role-aware for clinical data; (2) composite `(tenant_id, id)` foreign keys so references cannot cross tenants; (3) all request-path DB access through `withTenantTx` under the user's or API key's claims; the service role only in a `system` context (jobs, public-token RPCs) with a reason code and a log line; (4) public patient links resolved by SECURITY DEFINER RPCs that return only the needed fields after token-hash lookup; (5) CI pgTAP suite asserting cross-tenant denial for every table and RPC; (6) an ESLint rule banning `getSystemDb` outside allowed paths. |
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
| **Recommended** | **Transactional outbox plus a Postgres job queue, driven by a scheduler; no new broker.** Add a generic `jobs` table (`id, tenant_id, kind, payload jsonb, run_at, attempts, max_attempts, status, locked_until, last_error, dedupe_key UNIQUE NULLS NOT DISTINCT`). Keep the existing `communication_queue` and `webhook_delivery_queue` as domain "delivery" tables, now **inserted inside the business transaction**. Claim with an RPC `claim_jobs(kinds, batch, lease_seconds)` using `FOR UPDATE SKIP LOCKED` and setting `locked_until`; expired leases become claimable again. **Trigger:** a Supabase `pg_cron` job every minute calls `/api/jobs/run` through `pg_net`, authenticated by a rotating secret; Vercel Cron is an alternative depending on the plan (**Assumption (validate)** with Workstream F). Handlers are idempotent (dedupe keys, provider message IDs). Governance (quiet hours, quota, opt-out, consent) is applied at enqueue and re-checked at send. Archival PDFs, AI summaries, retention purges and webhook deliveries become job kinds. Consider **pgmq** (Supabase Queues) as a drop-in for the claim mechanics if preferred. |
| **Reason** | Correct delivery semantics (at-least-once with dedupe), no lost events, no request-path latency, and no new infrastructure. |
| **Advantages** | One mechanism for every async concern. Queue state is queryable. Transactional with business writes. |
| **Disadvantages** | Polling latency of up to about 60 s for non-urgent messages (urgent sends can still be kicked opportunistically **after commit**, through `after()` in Next 15). Serverless duration limits cap batch size. |
| **Migration complexity** | M. |
| **Operational implications** | Alert on queue lag, dead letters and lease expiries. A runbook for replaying dead letters. **Single storage provider:** choose Supabase Storage (RLS-integrated, same region and vendor, simplest) unless egress cost analysis favours R2. Remove the other path (ADR-014). **AI:** keep the Vercel AI SDK behind `lib/integrations/ai` with per-tenant quotas, server-side context assembly and usage audit. **Messaging:** keep the MSG91 adapter; delete Twilio and Gupshup if unused. |

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

---

## 4. Domain module contract

```
features/<domain>/
  index.ts        // public surface for OTHER domains: re-exports service fns + types only
  schema.ts       // zod: Inputs, Outputs (DTOs), Events; inferred TS types
  policy.ts       // can(ctx, 'visit.sign', visit) → boolean | AppError; pure, unit-tested
  repo.ts         // Kysely queries; takes `tx: TenantTx`; no business rules; returns rows
  service.ts      // use-cases: (ctx, input) => Promise<Result<Output, AppError>>
                  //   - validates invariants, calls policy, runs ONE transaction,
                  //     writes audit + outbox/jobs rows in the same tx
  queries.ts      // read models for RSC pages (may be cached per request)
  actions.ts      // "use server": parse → getContext() → service → toActionResult; revalidate
  api.ts          // REST adapters used by app/api/v1/** via withApi()
  jobs.ts         // job handlers registered by kind (idempotent)
  system.ts       // (optional) system-context entry points, e.g. webhook-driven flows
  __tests__/      // service tests with fake repo; repo tests against local Supabase
```

**Example shape (illustrative, not implementation):**
```ts
// features/billing/service.ts
export async function recordPayment(ctx: RequestContext, input: RecordPaymentInput)
  : Promise<Result<PaymentRecorded, AppError>> {
  const denied = policy.canRecordPayment(ctx); if (denied) return err(denied);
  return withTenantTx(ctx, async (tx) => {
    const inv = await repo.lockInvoice(tx, input.invoiceId);          // SELECT … FOR UPDATE
    if (!inv) return err(notFound('invoice'));
    if (inv.status === 'cancelled') return err(conflict('INVOICE_CANCELLED'));
    const paid = await repo.sumPayments(tx, inv.id);
    if (paid + input.amount > inv.totalAmount) return err(conflict('OVERPAYMENT'));
    const p = await repo.insertPayment(tx, { ...input, recordedBy: ctx.userId });
    await repo.setInvoiceStatus(tx, inv.id, paid + input.amount === inv.totalAmount ? 'paid' : 'issued');
    await audit.record(tx, ctx, 'invoice.payment_recorded', { invoice_id: inv.id });
    await outbox.emit(tx, ctx, 'payment.recorded', { payment_id: p.id, invoice_id: inv.id });
    return ok({ paymentId: p.id });
  });
}
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
  - others → `INTERNAL`
- **Adapters:**
  - Actions return `ActionResult<T> = { ok: true, data } | { ok: false, error: { code, message, fieldErrors? } }`.
  - REST returns the existing v1 envelope, with an HTTP status taken from the code table (400/401/403/404/409/412/429/502/500) and `correlation_id = requestId` on every error.

---

## 7. Transaction strategy

1. **One command, one transaction.** Every service command that writes runs in exactly one `withTenantTx`. Audit rows and outbox or job rows are written in that transaction. External calls (HTTP, AI, provider sends, PDF rendering) are **never** made inside a transaction. They are enqueued as jobs, or done before the transaction with the results validated inside it.
2. **The database guards invariants.** Uniqueness, exclusion (double-booking), CHECKs (money), composite FKs (tenancy) and immutability triggers (signed records). Services rely on these constraints and map violations to `CONFLICT`. Application pre-checks exist only for user-friendly messages.
3. **Concurrency.** `SELECT … FOR UPDATE` on aggregate roots (invoice, visit) for read-modify-write flows. Counters (queue tokens, invoice numbers) use `INSERT … ON CONFLICT DO UPDATE … RETURNING`. Use optimistic `version` columns only where long-lived edits occur (consultation draft autosave).
4. **Isolation level.** READ COMMITTED (the default) plus row locks. Use SERIALIZABLE only if a specific anomaly is found.
5. **Timeouts.** `SET LOCAL statement_timeout = '5s'` for request transactions and `'60s'` for jobs.
6. **Idempotency.** API `Idempotency-Key`, server-action client-generated `commandId` on non-idempotent forms (payments, check-in), and job `dedupe_key`.

**Critical flows to migrate first:**
- create invoice (header, items, number)
- record payment
- complete and sign consultation (visit, prescription, audit, outbox, archival-PDF job)
- reopen and finalise amendment (snapshot, unlock, re-sign)
- check-in (token, visit status)
- waitlist promotion (visit, waitlist status)
- book or reschedule appointment (exclusion constraint)
- patient erasure (restriction, revoke tokens, cancel queued messages)

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
- **Job kinds:** `message.send`, `webhook.deliver`, `pdf.archive_prescription`, `pdf.receipt`, `ai.summary`, `retention.purge_*`, `erasure.anonymise`, `subscription.renewal_reminder`.
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
- **Database:** pgTAP for RLS (per role × per table × per command), constraints, triggers and SECURITY DEFINER functions.
- **Contract:** OpenAPI generated from zod plus route-coverage tests. Webhook signature vectors.

---

## 12. What we deliberately do not change

- **Next.js App Router as the backend runtime.** There is no evidence that a separate API service is needed.
- **Supabase as platform** (Postgres, Auth, Storage, pg_cron, Vault): it fits team size and cost.
- **The shared-schema tenancy model.**
- **The v1 REST paths and envelope.** Hardening only; breaking changes wait for `/api/v2`.
- **The domain vocabulary and working business rules** (visit-centric model, versioned prescriptions, revision snapshots, consent records), refactored but preserved.
