# clinicOS v2.0: Architecture Decision Records (Backend)

**Status of all entries: Proposed** (2026-11-10). They need owner approval in Phase 2 (Architecture and design approval) before implementation.
**Format:** Context → Decision → Alternatives → Consequences → Evidence. The evidence references `ARCHITECTURE_ASSESSMENT.md` (ARC-*), `DATABASE_ASSESSMENT.md` (DB-*, RLS-*) and `API_ASSESSMENT.md` (API-*, WH-*).

| ADR | Title | Priority |
|---|---|---|
| 001 | Modular monolith on Next.js + Supabase (retain platform) | P1 |
| 002 | Per-domain module contract and enforced boundaries | P1 |
| 003 | ~~Kysely over pooled Postgres with RLS context for data access~~ **Superseded** by RPC-per-flow (erratum 2026-11-10, C18) | P1 |
| 004 | Database-enforced invariants and one-transaction-per-command | P1 |
| 005 | Confine the service-role client; no overrides in server actions | **P0** |
| 006 | Role-aware RLS from a single permission source; composite tenant FKs (**amended**: `has_permission()` with a hard-coded `CASE`; erratum 2026-11-10, C19) | P1 |
| 007 | Standard `Result`/`AppError` and error envelopes | P2 |
| 008 | Zod v4 contracts at every boundary; OpenAPI generated | P1 |
| 009 | Transactional outbox plus Postgres job queue driven by a scheduler | P1 |
| 010 | Postgres-backed rate limiting and idempotency | P1 |
| 011 | API keys as scoped principals under RLS (**amended**: no `withTenantTx`; erratum 2026-11-10, C18) | P1 |
| 012 | Structured logging, request IDs and error tracking | P1 |
| 013 | Immutable migrations, generated types, CI on an ephemeral DB | P1 |
| 014 | A single object-storage provider | P2 |
| 015 | Signed clinical records are immutable in the database | P1 |
| 016 | Tenant-local time computed in one place | P1 |
| 017 | Retain Supabase Auth | P2 |
| 018 | Retention and erasure as scheduled, audited jobs | P1 |
| 019 | Request-scoped caching only | P3 |

---

## ADR-001: Modular monolith on Next.js + Supabase (retain platform)
- **Context:** A single Next.js deployable on Supabase. The problems found are structural (layering, transactions), not topological. The team and the scale are small.
- **Decision:** Keep one Next.js application as the backend runtime and Supabase (Postgres, Auth, Storage, pg_cron) as the platform. Organise the code as a modular monolith (ADR-002). Do not add a separate worker service until the triggers in TARGET_ARCHITECTURE §3.1 are met.
- **Alternatives:**
  - NestJS or Fastify API plus a separate frontend: duplicates auth and deployment for no requirement.
  - Microservices: rejected under prompt §C1.
  - Moving off Supabase to RDS plus custom auth: high migration cost and no identified benefit.
- **Consequences:**
  - (+) Lowest operational load.
  - (−) Serverless limits shape job design (ADR-009).
- **Evidence:** ARC-08, ARC-09; TARGET_ARCHITECTURE §1.

## ADR-002: Per-domain module contract and enforced boundaries
- **Context:** Action files of 700–1,300 lines mix authorisation, SQL, rules and side effects. REST handlers re-implement the same rules, and the two versions diverge (API-03, ARC-08).
- **Decision:** Every domain exposes `schema.ts`, `policy.ts`, `repo.ts`, `service.ts`, `queries.ts`, `actions.ts`, `api.ts` and `jobs.ts`, with `index.ts` as its public surface (TARGET_ARCHITECTURE §4). Adapters (actions, REST, webhooks, jobs) contain no business rules. Boundaries are enforced with ESLint (`no-restricted-imports` / `eslint-plugin-boundaries`). Merge `features/appointments` into `features/visits`.
- **Alternatives:**
  - Hexagonal or clean architecture with ports for everything: too much ceremony for this team.
  - Leaving the layout as-is and adding tests: does not fix duplication.
- **Consequences:**
  - (+) One implementation per rule; unit-testable services.
  - (−) A large incremental refactor, done one domain at a time.
- **Evidence:** `features/billing/actions.ts` (1,304 lines); `app/api/v1/visits/[id]/route.ts:103-165` vs `features/consultation/actions.ts:597-743`.

## ADR-003: Kysely over pooled Postgres with RLS context for data access (**Superseded**, erratum 2026-11-10, C18)
- **Status:** **Superseded.** The decision below is replaced by **RPC-per-flow** (former alternative (a)). The original text is kept under "Original proposal" for the record. The RPC-per-flow pattern is Proposed, pending the D1 confirmation spike (V2-03 plan 03-07), and is recorded at G2 (R6). (erratum 2026-11-10, C18)
- **Context:** PostgREST cannot run multi-statement transactions from the app. The types are hand-written, and there are 387 `as any` casts.
- **Decision (current):** (erratum 2026-11-10, C18)
  - Each atomic multi-step write (the 8 atomic commands) is a **plpgsql function, `SECURITY INVOKER` under RLS**, called through supabase-js, with audit and outbox rows written inside the same function/transaction.
  - Generated Supabase types (roadmap P1-34) remove most `as any` casts without a second data layer.
  - No `DATABASE_URL`, no Kysely, no `withTenantTx`: no new privileged secret, no pooler constraints.
  - A short **D1 confirmation spike** in V2-03 (before V2-05) proves one flow end to end: RLS, `auth.uid()` as actor, audit and outbox in one transaction, and error mapping to `AppError`.
  - Kysely is revisited only if RPCs prove unmaintainable, through a new ADR.
- **Original proposal (superseded):**
  - Use Kysely plus `pg` through Supavisor transaction mode for application data access.
  - `withTenantTx(ctx, fn)` sets `ROLE authenticated` and `request.jwt.claims` with `SET LOCAL`/`set_config(...,true)` so RLS applies.
  - Generate types with `kysely-codegen` from a locally migrated DB.
  - Keep supabase-js for Auth and Storage.
  - plpgsql RPCs only for security primitives.
- **Alternatives:**
  - (a) supabase-js plus RPC for every multi-step write. **This is now the decision** (erratum 2026-11-10, C18).
  - (b) Drizzle: conflicts with SQL-first migrations.
  - (c) Prisma: rejected.
- **Consequences:**
  - Of the superseded Kysely proposal: (+) real transactions, typed SQL, fewer round trips; (−) a new privileged secret (`DATABASE_URL`) and pooler constraints (no session state). These costs are why it was superseded.
  - Of RPC-per-flow: (+) transactions and RLS stay inside Postgres with the caller's `auth.uid()`; (−) business logic for the atomic commands lives in plpgsql and needs pgTAP coverage. The D1 spike confirms the pattern (no longer a Kysely-vs-RPC decision). (erratum 2026-11-10, C18)
- **Evidence:** ARC-09, ARC-12; `lib/db/types.ts:530-1430`.

## ADR-004: Database-enforced invariants and one-transaction-per-command
- **Context:**
  - Double-booking, invoice numbering, overpayment, cross-tenant references and partial writes are guarded only in TypeScript, or not at all.
  - Audit and outbox rows are written after the commit.
- **Decision:**
  - Each write command runs in exactly one transaction that also writes audit and outbox rows.
  - Add composite FKs, CHECKs, a `btree_gist` exclusion constraint for appointments, counter tables for queue tokens and invoice numbers (Indian financial year), and `updated_at` triggers.
  - No external I/O inside transactions.
- **Alternatives:** Application-level locks or advisory locks only. These are fragile and ignore other writers (API, jobs).
- **Consequences:**
  - (+) Integrity holds regardless of entry point.
  - (−) Existing data must be diagnosed before constraints are validated (BACKEND_MIGRATION_PLAN §3).
- **Evidence:** DB-01, DB-08..DB-12; `features/billing/actions.ts:80-138,203-261`.

## ADR-005: Confine the service-role client; no overrides in server actions (P0)

> Update (2026-11-10, PO round 3; roadmap §16 G0, VERIFICATION_LOG addendum 4): ADR-005 is ratified **as part of gate G0** (end of V2-00): an isolated Claude reviewer checks it together with the V2-00 configs, and the PO signs it off with G0. It is not a separate PO decision. Its status changes from "Proposed" to "Accepted" when G0 passes; V2-01a and V2-01 start after that.

- **Context:**
  - `"use server"` exports accept `sessionOverride`, which skips authentication and selects the service-role client. These functions are reachable from the browser.
  - There are five separate service-role factories (`lib/supabase/admin.ts`, `features/appointments/actions.ts`, `features/auth/dev-actions.ts`, `lib/messaging/dispatcher.ts`, `lib/storage/supabase-provider.ts`) (erratum 2026-11-10, C3).
- **Decision:**
  1. Immediately remove all `clientOverride`/`sessionOverride` parameters from exported server actions. Tests target services with an explicit context.
  2. Provide one `getSystemDb(reason)` factory, importable only from `lib/jobs/**`, `features/*/system.ts` and `app/api/{jobs,webhooks}/**` (lint rule), and log every use.
  3. Public-link flows use SECURITY DEFINER RPCs instead of broad service-role queries.
- **Alternatives:** Keep the overrides but check `process.env.NODE_ENV === 'test'`. Rejected: brittle, and it still leaves the surface exposed.
- **Consequences:**
  - (+) Closes an unauthenticated cross-tenant hole.
  - (−) Tests must be restructured (Workstream E).
- **Evidence:** `features/patients/actions.ts:174,255,278`; `features/patients/consent.ts:163`; `features/settings/actions.ts:48,179`; client imports listed in ARCHITECTURE_ASSESSMENT §4.1.
- **Canonical text:** `docs/adr/0005-confine-service-role-client.md`, amended at G0 (scope, factory home `lib/supabase/system.ts`, ESLint rule set, exception register, SEC-02 verification) (erratum 2026-11-10, C50).

## ADR-006: Role-aware RLS from a single permission source; composite tenant FKs
- **Context:**
  - RBAC exists only in `lib/permissions/matrix.ts`. RLS is tenant-only, so the browser JWT bypasses role restrictions.
  - Memberships can be self-escalated.
- **Decision:**
  - A STABLE SQL function `has_permission(tenant_id, perm)` with a **hard-coded `CASE` over the 5 fixed roles**, used by clinical-table policies. **No `role_permissions` table, join or codegen**; a table is introduced only if per-tenant custom roles are ever approved. (erratum 2026-11-10, C19)
  - A unit test asserts parity between the SQL `CASE` and `lib/permissions/matrix.ts`; pgTAP covers the policies. (erratum 2026-11-10, C19)
  - Column-level revoke on `memberships.role/tenant_id/user_id`, with role changes going through an RPC (owner-only for owner and admin grants; last-owner protection).
  - Composite `(tenant_id, id)` FKs throughout.
- **Alternatives:** Custom JWT claims carrying the role (stale on switch, larger tokens); keeping app-only RBAC. Rejected.
- **Consequences:**
  - (+) Defence in depth.
  - (−) More complex policies; pgTAP coverage is mandatory; watch RLS performance (use `(select auth.uid())`).
- **Evidence:** RLS-01, RLS-02, DB-01; `000011:26-39`.

## ADR-007: Standard `Result`/`AppError` and error envelopes
- **Context:** The codebase mixes `{success,error}` unions, thrown errors, `null` and `[]`, and raw DB messages reach the UI.
- **Decision:** `Result<T, AppError>` with the code taxonomy in TARGET_ARCHITECTURE §6. Postgres error-code mapping in `lib/db`. Actions return `ActionResult<T>`, and REST keeps the v1 envelope with `correlation_id` on every error.
- **Alternatives:** Exceptions everywhere (loses typed expected failures); a library such as `neverthrow` (unnecessary dependency).
- **Consequences:** Consistent UI error handling (helps Workstream B) and no leakage of DB messages.
- **Evidence:** ARC-21; `features/patients/actions.ts:74-78,286-289`; `features/appointments/actions.ts:76`.

## ADR-008: Zod v4 contracts at every boundary; OpenAPI generated
- **Context:**
  - Only about 27 call sites validate input.
  - The OpenAPI document is hand-written and has drifted (`gender`/`blood_group` vs `sex`; an `x-api-key` header that is not implemented).
  - zod 3 has an advisory.
- **Decision:**
  - Upgrade to zod v4.
  - Domain `schema.ts` is the single source for inputs, DTOs and events.
  - Generate OpenAPI 3.1 (including `webhooks:`) from the schemas.
  - Validate env, job payloads and inbound webhooks with zod too.
- **Alternatives:** valibot or typebox (smaller, but migration churn); keeping hand-written OpenAPI.
- **Consequences:**
  - (+) No drift; typed DTOs prevent `select("*")` over-exposure.
  - (−) Upgrade effort across about 20 schema files.
- **Evidence:** API-06, API-07, API-12; `lib/api/openapi-spec.ts:649-668`.

## ADR-009: Transactional outbox plus Postgres job queue driven by a scheduler
- **Context:**
  - Dispatch runs inline in user requests (cross-tenant) or fire-and-forget.
  - The cron routes have no scheduler in the repo.
  - There is no claiming, so duplicate WhatsApp sends and webhook deliveries are possible.
  - Governance is unused.
- **Decision:**
  - Write a `jobs` table plus the existing delivery tables in the business transaction.
  - `claim_jobs()` with `FOR UPDATE SKIP LOCKED` and a lease.
  - pg_cron + pg_net (or Vercel Cron) calls `/api/jobs/run` every minute.
  - Idempotent handlers.
  - Governance at enqueue and re-checked at send.
  - Optional post-commit `after()` kick for urgent messages.
- **Alternatives:**
  - Inngest or Trigger.dev: a good developer experience, but a new vendor processing PHI payloads.
  - Redis/BullMQ worker: new infrastructure.
  - pgmq: a viable drop-in for the claim mechanics.
- **Consequences:**
  - (+) At-least-once delivery with dedupe, no lost events, no request latency.
  - (−) About 60 s polling latency for non-urgent work.
- **Evidence:** ARC-14, ARC-15, WH-02, WH-03; `lib/messaging/dispatcher.ts:104-150`; `lib/webhooks/outbox.ts:117-131`.

## ADR-010: Postgres-backed rate limiting and idempotency
- **Context:** The in-memory `Map` rate limiter is ineffective on serverless. Server actions, AI routes and public links have no limits. No endpoint is idempotent.
- **Decision:**
  - `rate_limit_hit(bucket_key, window, limit)` RPC (atomic upsert on `(key, window_start)`) used by the API, AI, OTP and public-link routes.
  - `idempotency_keys` table for API POSTs and selected actions.
  - Purge both through jobs.
- **Alternatives:** Upstash Redis (`@upstash/ratelimit`): simple and fast, but a new vendor. It is the preferred upgrade path if DB load becomes noticeable.
- **Consequences:**
  - (+) Correct global limits with no new infrastructure.
  - (−) One extra DB write per limited request (merged with API auth, ADR-011).
- **Evidence:** API-08, API-10; `lib/api/rate-limiter.ts:12-49`.

## ADR-011: API keys as scoped principals under RLS
- **Context:**
  - Every key is an all-powerful admin running as service-role.
  - Attribution goes to the key creator, and the key outlives the creator.
  - Four DB round trips per request.
- **Decision:**
  - Keys gain `scopes[]`, `expires_at` and a service-principal identity per tenant.
  - An `api_authenticate(key)` SECURITY DEFINER RPC verifies the hashed key, rate-limits and counts in one round trip, and returns the principal (tenant, scopes, owning membership).
  - Data access then uses either **explicit per-endpoint RPCs** that take the principal and enforce tenant and scope in SQL, or RLS through a **short-lived JWT** minted for the key principal. The JWT option needs the project's JWT signing secret, so it is chosen at G2 only if it is simpler than RPCs. **No `withTenantTx`** (ADR-003 is superseded). If PO-16 finds no API consumers, this ADR is P2 and `/api/v1` stays disabled. (erratum 2026-11-10, C18)
  - Keys are invalidated when the creator's membership is removed (or ownership is transferred explicitly).
- **Alternatives:** OAuth2 client credentials. Premature for current integrators.
- **Consequences:**
  - (+) RLS backstop for API traffic; least privilege.
  - (−) Existing keys need a default scope (grant full scopes to existing keys to stay compatible, and announce the change).
- **Evidence:** API-02, API-09, API-11; `lib/api/auth.ts:8-151`.

## ADR-012: Structured logging, request IDs and error tracking
- **Context:** 191 `console.*` calls, no correlation, no error tracking, and possible PHI in logs.
- **Decision:**
  - pino logger with context binding and a PHI redaction list.
  - `x-request-id` propagated end to end.
  - Sentry with PII scrubbing.
  - Queue and scheduler health in `/api/ready`, with alerts.
- **Alternatives:** OpenTelemetry collector plus Grafana stack (more operational load); platform logs only (insufficient).
- **Consequences:**
  - (+) Incidents become diagnosable.
  - (−) A vendor DPA and region review for Sentry (Workstream D).
- **Evidence:** ARC-16; `lib/api/envelope.ts:46-55`.

## ADR-013: Immutable migrations, generated types, CI on an ephemeral DB
- **Context:**
  - Migrations 000007 and 000014 were edited after creation.
  - There is a dead table.
  - Types are hand-written.
  - Tests and seeds hit a hosted project.
- **Decision:**
  - Applied migrations are never edited (CI check).
  - Reconcile production with a baseline diff.
  - Generate types in CI.
  - Use `supabase start`/`db reset` plus pgTAP in CI.
  - Make seeds local-by-default.
  - Expand/contract for every breaking schema change.
- **Consequences:** A reproducible schema and safe deployments.
- **Evidence:** DATABASE_ASSESSMENT §8; commits `1e43cc6`, `45521b5`.

## ADR-014: A single object-storage provider
- **Context:** Supabase Storage and Cloudflare R2 are both implemented and selected by env. R2 bypasses storage RLS. There are two policy models.
- **Decision:** Standardise on **Supabase Storage** (same region and vendor, RLS on `storage.objects`, signed URLs). Keep the `StorageProvider` interface. Remove the R2 path after confirming which provider holds production objects (**Outstanding investigation**). If R2 holds the data, invert the decision and document compensating controls.
- **Alternatives:** R2 only (cheaper egress, but no RLS).
- **Consequences:** Less code and one security model.
- **Evidence:** `lib/storage/index.ts:64-82`.

## ADR-015: Signed clinical records are immutable in the database
- **Context:** Signed visits, prescriptions and items remain editable through any path. The REST API overwrites signed notes.
- **Decision:**
  - BEFORE UPDATE/DELETE triggers reject changes when `signed_at IS NOT NULL` unless the transaction has a valid amendment context set by `begin_amendment(visit_id, reason)`. That function snapshots the record into `visit_revisions` and sets a transaction-local flag.
  - The `visits` DELETE policy is removed in favour of cancellation.
- **Alternatives:** Application-only enforcement. Insufficient, given the multiple entry points.
- **Consequences:**
  - (+) Medico-legal integrity.
  - (−) The amendment flow must be refactored at the same time.
- **Evidence:** DB-13, API-04; `app/api/v1/visits/[id]/route.ts:150-165`.

## ADR-016: Tenant-local time computed in one place
- **Context:** 29 sites (erratum 2026-11-10, C4) compute "today" with `toISOString().split("T")[0]` (UTC), while `tenants.timezone` defaults to Asia/Kolkata. Queue tokens and day views are wrong between 00:00 and 05:30 IST.
- **Decision:**
  - `RequestContext.tenantTimeZone`, plus a `lib/core/time` module that is the only date-boundary helper.
  - Date-bucketing in SQL uses `(now() AT TIME ZONE tenant_tz)::date`.
  - A lint rule bans `toISOString().split("T")`.
- **Consequences:** Historical UTC-bucketed data remains as-is (documented).
- **Evidence:** `features/queue/actions.ts:26`; `features/visits/scheduling.ts:270-272`.

## ADR-017: Retain Supabase Auth
- **Context:** Auth works. Gaps are in authorisation, session handling version (`@supabase/ssr` 0.5.2) and OTP rate limits.
- **Decision:**
  - Keep Supabase Auth and upgrade `@supabase/ssr`.
  - Use `getUser()`/`getClaims()` server-side only.
  - Add phone OTP through an SMS hook if the product requires it.
  - Rate-limit OTP requests (ADR-010).
  - Do not move to Clerk, Auth0 or Auth.js.
- **Alternatives:** Clerk (great developer experience, but a user migration, and RLS integration via third-party JWT); Auth.js (more code to own).
- **Consequences:** No user migration. Workstream D owns MFA and session policies.
- **Evidence:** `lib/auth/tenant.ts`, `middleware.ts`.

## ADR-018: Retention and erasure as scheduled, audited jobs
- **Context:**
  - Erasure only sets flags; PII persists in patients, queues and payloads.
  - No table has a purge.
- **Decision:**
  - A documented retention schedule (DATABASE_ASSESSMENT §7), implemented as `retention.*` jobs.
  - Erasure is restriction now and anonymisation after the statutory period, tracked in `erasure_requests`.
  - Dry-run mode and owner approval for irreversible steps.
- **Consequences:** Needs legal confirmation of retention periods (Workstream D).
- **Evidence:** `features/dpdp/erasure.ts:59-110`.

## ADR-019: Request-scoped caching only
- **Context:** No caching today; 3–5 redundant auth or DB calls per action.
- **Decision:** Use `React.cache` for context and reference lookups, and tag-based caching for global reference data only. No cross-request caching of tenant data and no Redis.
- **Consequences:** Lower latency without stale-PHI risk.
- **Evidence:** ARC-18; `lib/auth/tenant.ts:30-88`, `lib/audit/audit.ts:173`.
