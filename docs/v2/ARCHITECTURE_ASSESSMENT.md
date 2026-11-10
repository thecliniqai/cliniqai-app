# clinicOS v2.0: Backend Architecture Assessment

**Workstream:** C (Backend Architecture), in the roles of Principal Software Architect and Senior Backend Architect
**Date:** 2026-11-10 · **Branch:** `feature/v2` · **Status:** Discovery only. No code, schema or configuration was changed.
**Companion documents:** `DATABASE_ASSESSMENT.md`, `API_ASSESSMENT.md`, `TARGET_ARCHITECTURE.md`, `ARCHITECTURE_DECISIONS.md`, `BACKEND_MIGRATION_PLAN.md`. Workstream D owns the in-depth security assessment; this document reports only the tenant-isolation and data-integrity defects found during the architecture review.

**Labels:** **Fact**: verified in the repository. **Problem**: a defect or weakness. **Risk**: a plausible negative outcome. **Assumption (validate)**: a belief that needs confirmation. **Recommendation**: proposed change.
**Priority:** P0 = critical or security blocker, P1 = essential for v2, P2 = important, P3 = optional. **Size:** S / M / L / XL (relative).

---

## 1. Executive summary

The v1 backend is a **Next.js 15 App Router application that talks directly to Supabase (PostgREST) from about 25 `"use server"` action files and 13 REST route handlers**. The product logic works and much of it is careful: the audit metadata allow-list, HMAC-signed webhooks with SSRF checks, E.164 phone normalisation, append-only consent records, and versioned prescriptions. The *engineering structure* around that logic, however, is not production-grade:

1. **P0: tenant isolation can be bypassed through server-action parameters.** Several `"use server"` exports take a client-supplied `sessionOverride`. When it is present they skip authentication and switch to the **service-role client**. Because those actions are imported by client components, they are reachable over HTTP by anyone holding the action ID (§4.1).
2. **P0: privilege escalation through RLS.** The `memberships` UPDATE policy lets any user update their *own* membership row, including `role` (`supabase/migrations/000011_fix_memberships_rls_recursion.sql:26-39`). Session JWTs are readable in the browser, so any receptionist can promote themselves to `owner` with a direct PostgREST call (§4.2).
3. **No service or repository layer.** Business rules, authorisation, data access, side effects (messaging, webhooks, PDFs, audit) and cache invalidation are interleaved in 500–1,300-line action files. The REST API **re-implements** the same rules separately against the service-role client, and the two implementations already diverge (§5).
4. **No transactions.** Every multi-step write (invoice plus items, payment plus status, sign-off, amendment, check-in) is a sequence of independent PostgREST calls, often with ignored errors. Audit logs and outbox events are written *after* the business commit (§6).
5. **The type system is mostly bypassed.** `lib/db/types.ts` is hand-written (1,535 lines) and omits about 10 tables. The codebase contains **387 `as any` casts** and **337 eslint-disable comments** (§7).
6. **Background jobs are opportunistic.** Two outbox tables exist, but dispatch is triggered inline inside user requests and by cron routes that no scheduler config in the repo invokes. Rows are not claimed atomically, and the messaging governance logic (quiet hours, quota, opt-out) is dead code (§9).
7. **Observability is close to zero.** There are 191 `console.*` calls, no structured logger, no error tracker and no request or correlation IDs outside API 5xx responses (§10).

**Target recommendation (details in `TARGET_ARCHITECTURE.md`):** keep a **modular monolith on Next.js + Supabase Postgres + Supabase Auth**. Introduce a strict per-domain contract `schema → policy → service → repo` with thin `actions`/`api` adapters. Make real Postgres transactions the default by adding a typed query builder (Kysely) that runs under the caller's RLS context. Confine the service-role client to an explicit "system" context. Move invariants into the database (composite tenant FKs, CHECK and exclusion constraints, immutability triggers). Run jobs through a transactional outbox with `SKIP LOCKED` claiming on a scheduler. No microservices and no separate worker fleet are needed at the current scale.

---

## 2. Scope and method

- **Read in full:** `middleware.ts`, `lib/supabase/*`, `lib/auth/tenant.ts`, `lib/permissions/*`, `lib/api/*`, `lib/audit/audit.ts`, `lib/webhooks/*`, all 18 migrations, and every `app/api/v1/**` route handler header.
- **Sampled in depth:** `features/{patients,visits,queue,billing,consultation,appointments,settings,api-keys,dpdp}` and `lib/{messaging,storage,ai}`. Every `features/<domain>` export was checked for server-action exposure, the override pattern, zod usage and admin-client usage with `grep`.
- **Not done (by rule):** no database connection, no execution of integration tests or seed scripts, no reading of `.env` values.

---

## 3. Current architecture (as-is)

```
Browser (React 19 client components)
   │  server-action RPC (POST, action-ID)          │ fetch /api/**
   ▼                                               ▼
┌──────────────────────── Next.js 15 (single deployable) ─────────────────────────┐
│ middleware.ts  – refreshes Supabase session cookie only (no authz)             │
│                                                                                 │
│ app/(dashboard)/**  pages: some query Supabase directly (10 `.from()` calls)    │
│ app/api/v1/**      REST (API-key) ─┐   app/api/{r,reschedule,reports,invoices,   │
│                                     │       visits}/**  public/tokenised + PDFs   │
│ app/api/cron/**    CRON_SECRET     │   app/api/webhooks/messaging/[provider]     │
│ app/api/ai/**      streaming LLM   │                                             │
│                                     ▼                                            │
│ features/<domain>/actions.ts ("use server") ── business logic + data access     │
│      │  (also imported by app/api/v1, cron, webhooks, AI tools)                  │
│      ▼                                                                           │
│ lib/: supabase clients (anon/RLS + service-role ×4 factories), permissions,     │
│       audit, messaging (outbox + providers), webhooks (outbox + dispatcher),    │
│       storage (Supabase | R2 via S3 SDK), ai (Vercel AI SDK), api (auth, rate   │
│       limit, envelope, OpenAPI)                                                  │
└───────────────────────────────┬─────────────────────────────────────────────────┘
                                ▼
          Supabase: Postgres (RLS, 6 SECURITY DEFINER fns) · Auth · Storage
          External: MSG91 / Twilio / Gupshup · Gemini / OpenAI · Cloudflare R2
```

**Facts**
- There is one deployable (Next.js) and no worker process. No `vercel.json` or other scheduler definition exists in the repo (repo root listing).
- `middleware.ts:4-53` only refreshes the session. It skips `/api/v1`, `/api/health` and `/api/ready` (`middleware.ts:6-12`). Authorisation is done per page or action (`app/(dashboard)/layout.tsx` redirects unauthenticated users).
- There are 20 feature domains, about 25 `"use server"` modules and about 230 exported functions (count of `^export async function` across `features/`).
- Supabase is accessed through three kinds of clients: the cookie/RLS client (`lib/supabase/server.ts`), the browser client (`lib/supabase/client.ts`, used for auth pages and `components/layout/user-dropdown.tsx`), and **four separate service-role factories**: `lib/supabase/admin.ts:13`, `lib/messaging/dispatcher.ts:33-46`, `features/appointments/actions.ts:10-22` and `features/auth/dev-actions.ts:38`.

---

## 4. Tenant-isolation and authorisation defects found (report to Workstream D)

These defects are listed here because they are architectural in origin. Workstream D should own exploitation analysis and remediation sequencing.

### 4.1 P0: `sessionOverride` in server actions bypasses authentication and RLS
- **Fact:** `features/patients/actions.ts:168-176`, `:247-256` and `:274-279` (`getPatient`, `searchPatients`, `getPatients`) contain:
  `const supabase = clientOverride || (sessionOverride ? getAdminClient() : await createClient()); const session = sessionOverride || (await requirePermission(...));`
- **Fact:** The same pattern appears in `features/patients/consent.ts:156-166` (`toggleGlobalConsent`, which writes) and `features/settings/actions.ts:48-51` and `:179-182` (`updateClinicSettings` and `updateStatutorySettings`, which write to `tenants`).
- **Fact:** These files start with `"use server"`, and the functions are imported by client components: `components/layout/global-search-modal.tsx:6`, `components/patients/patient-directory-table.tsx:17`, `components/calendar/booking-drawer.tsx:9`, `components/queue/walk-in-drawer.tsx:9`, `app/(dashboard)/patients/[id]/consent-section.tsx:4`, `components/settings/clinic-profile-form.tsx:6` and `components/settings/statutory-fields-card.tsx:5`. Next.js exposes each such export as a POST endpoint, and its arguments are deserialised from the request body.
- **Problem:** A caller who knows the action ID (it ships in the client bundle) and a victim `tenant_id` can call, for example, `searchPatients("a", undefined, {userId:"x", tenantId:"<victim>"})`. The call skips `requirePermission` and runs with the **service-role key**. No session is required.
- **Problem (wider pattern):** `sessionOverride?:` appears 87 times across `features/`. Most of those functions use the RLS client, for example `features/visits/actions.ts:36-59`, `features/queue/actions.ts:16-25` and `features/billing/actions.ts:184-202`. In those, RLS still limits data to the caller's tenants, but the **role/permission check is skipped**. A receptionist can therefore call `recordPayment` or `completeAndSignConsultation` with an override of their own tenant.
- **Root cause:** Test seams (`clientOverride`, `sessionOverride`) were added to the *public* signatures of server actions so that integration tests could inject a service-role client.
- **Recommendation (P0, S):** Remove every override parameter from `"use server"` exports immediately. Tests should call internal service functions, which take an explicit `RequestContext`, instead. Add an ESLint rule or CI grep that fails if a `"use server"` export has more than its documented input parameter. See ADR-005 and ADR-002.

### 4.2 P0: a user can change their own membership `role` through RLS
- **Fact:** The policy `memberships_update_tenant` has `USING (tenant member AND (user_id = auth.uid() OR is_admin_or_owner))` and `WITH CHECK (tenant member)` (`supabase/migrations/000011_fix_memberships_rls_recursion.sql:26-39`). No migration restricts this with column-level `GRANT`/`REVOKE`.
- **Fact:** The browser holds the Supabase session through `@supabase/ssr`'s `createBrowserClient` (`lib/supabase/client.ts`), so the JWT is available to page JavaScript.
- **Problem:** Any authenticated staff member can run `update memberships set role='owner' where user_id = auth.uid()` directly against PostgREST. An admin can likewise promote anyone to owner, and admins can also *invite* owners (`000002_invitations_billing.sql:15,76-87`).
- **Recommendation (P0, S):** Revoke UPDATE on `memberships(role, tenant_id, user_id)` from `authenticated`. Route role changes through a SECURITY DEFINER function that enforces "only an owner may grant owner or admin". Add a trigger that prevents demoting the last owner.

### 4.3 P0/P1: the RLS model is tenant-only, while RBAC exists only in the application
- **Fact:** Every clinical table policy is `tenant_id IN (SELECT current_user_tenant_ids())` for SELECT, INSERT and UPDATE (for example `000007_consultation_prescriptions_cdci.sql:367-524`). The role matrix (`lib/permissions/matrix.ts:25-75`) exists only in TypeScript.
- **Problem:** A receptionist, who has no `consultations:view`, can read `visits.clinical_notes`, `consultation_diagnoses` and `prescriptions` directly through PostgREST with their own JWT, bypassing the UI permission model. RBAC is not enforced in depth.
- **Recommendation (P1, M):** Move the permission matrix into the database (`role_permissions` table plus a `has_permission(tenant_id, perm)` STABLE function), and make clinical-table policies role-aware. This is ADR-006.

### 4.4 P1: SECURITY DEFINER functions trust caller-supplied `tenant_id`
- **Fact:** `generate_daily_queue_token(p_tenant_id, p_date)` (`000006:76-96`), `search_medicines(p_query, p_doctor_id, p_tenant_id, …)` (`000007:251-344`) and `generate_tenant_invoice_number(p_tenant_id)` (`000009:63-84`) are SECURITY DEFINER and do not check membership. The last one also has **no REVOKE from PUBLIC/anon**.
- **Problem:** Any authenticated user can read another tenant's doctors' custom-medicine lists and infer other tenants' visit and invoice volumes. The invoice function may also be callable by `anon`. **Assumption (validate):** this depends on Supabase default grants on the `public` schema.
- **Recommendation (P1, S):** Derive the tenant inside each function from `current_user_tenant_ids()`, or `RAISE` when `p_tenant_id` is not in it. Convert to SECURITY INVOKER wherever RLS already permits the access.

### 4.5 P1: public share tokens resolve resources without a tenant check
- **Fact:** `document_share_tokens.resource_id` has no FK and no tenant consistency check (`000014:137-143`). Any tenant member can insert a token (`000013:144-154`). `app/api/r/[token]/route.ts:73,95,117,139` loads the resource **with the service-role client by `id` only**, with no `.eq("tenant_id", shareToken.tenant_id)`.
- **Problem:** A member of tenant A can mint a token whose `resource_id` is a tenant-B prescription or invoice UUID and download it without logging in.
- **Recommendation (P1, S):** Add the tenant filter on resolution now. Later, replace the polymorphic token with typed nullable FKs plus a CHECK, or with a SECURITY DEFINER `resolve_share_token(token)` RPC that joins on tenant.

### 4.6 P1: the API accepts arbitrary storage paths
- **Fact:** `POST /api/v1/lab-orders` takes `storage_path` from the request body without validation (`app/api/v1/lab-orders/route.ts:128-189`) and stores it on `patient_documents`. Signed URLs are later minted with the service-role storage client. `validateStoragePath` checks format only, not tenant (`lib/storage/index.ts:21-36`).
- **Problem:** An API key from tenant A can register `tenants/<B>/labs/...` and obtain a signed URL for tenant B's file through the UI or a share token.
- **Recommendation (P1, S):** Require `storage_path` to start with `tenants/<session.tenantId>/`. Better, provide an upload endpoint that issues the path itself.

### 4.7 P1: referrals let the receiving tenant rewrite the whole row
- **Fact:** `referrals_target_tenant_update` allows UPDATE of any column when `target_tenant_id` is the caller's tenant (`000013:230-242`). The originating tenant can set `target_tenant_id` to *any* tenant UUID (`000013:207-216`).
- **Problem:** The receiving clinic can alter clinical content or ownership (`tenant_id`). The sender can push a patient's clinical history snapshot to any clinic.
- **Recommendation (P1, S):** Restrict the target tenant's writes to status and acknowledgement columns through an RPC. Validate that the target tenant has opted into in-network referrals.

### 4.8 P2: the audit log is forgeable and not atomic
- **Fact:** `audit_logs_insert_member` lets any member insert rows with any `actor_id`, `action` and `metadata` (`000003:91-97`). `recordAudit` runs after the business write, and if it fails it throws "Action was aborted" (`lib/audit/audit.ts:194-198`) even though the write has **already committed**.
- **Recommendation (P2, M):** Write audit entries inside the same transaction as the business change, from the service layer or a trigger. Set `actor_id = auth.uid()` in a BEFORE INSERT trigger. Revoke direct INSERT from `authenticated`.

---

## 5. Module boundaries and layering

### Facts
- `features/<domain>/actions.ts` files are the de facto "service + repository + controller":
  - `features/billing/actions.ts` (1,304 lines, 18 exports)
  - `features/visits/actions.ts` (1,064 lines)
  - `features/consultation/actions.ts` (1,043 lines)
  - `features/prescriptions/actions.ts` (858 lines)
  - `features/settings/actions.ts` (706 lines)
  - `features/referrals/actions.ts` (703 lines)
- A typical action does all of the following inline: zod parse, `requirePermission`, several `supabase.from()` calls, money arithmetic, audit, `enqueueMessage`/`enqueueWebhookEvent`, PDF rendering and `revalidatePath`. Example: `features/consultation/actions.ts:597-743`.
- The REST handlers in `app/api/v1/**` use `getAdminClient()` and **re-implement** the domain rules instead of calling shared services:
  - Patient update schema duplicated: `app/api/v1/patients/[id]/route.ts:15-39` vs `features/patients/schema.ts`.
  - Visit completion via the API (`app/api/v1/visits/[id]/route.ts:103-163`) sets `signed_at/signed_by` but skips prescription signing, archival PDF and the amendment workflow that `completeAndSignConsultation` performs (`features/consultation/actions.ts:640-681`).
  - Prescription versioning is computed in the API handler (`app/api/v1/prescriptions/route.ts:~196-206`) separately from `features/prescriptions/actions.ts`.
- Appointments are implemented twice: `features/visits/{actions,scheduling}.ts` (RLS client, with permissions) and `features/appointments/actions.ts` (not `"use server"`, always service-role, tenant passed in by the caller, no permission checks; used by the WhatsApp webhook and the reschedule-token route).
- Duplicate helpers exist, for example `createApiKeySecret` in `lib/api/auth.ts:24-34` is unused, and `features/api-keys/actions.ts:110-114` re-implements it.
- Server-only domain logic lives under `app/`: `app/(dashboard)/settings/clinic/actions.ts` is `"use server"`, and 8 page files query Supabase directly.
- There are no import-boundary rules. Any module can import any other module's actions; for example, `features/queue/actions.ts` imports `features/staff/actions.ts`.

### Problems
- **P1:** Rules differ by entry point (UI vs API vs webhook). Integrity depends on which door the data came through.
- **P1:** Business logic cannot be unit-tested without a live Supabase (confirmed by the coordinator: 27 test files require the hosted DB).
- **P2:** Very large files with mixed concerns make review, ownership and change risk hard to manage.

### Recommendation
Adopt the per-domain module contract in `TARGET_ARCHITECTURE.md §4`:
- `schema.ts` (zod contracts)
- `policy.ts` (authorisation)
- `repo.ts` (the only DB access)
- `service.ts` (rules, transactions, events)
- `actions.ts` and `api/` (thin adapters)
- `jobs.ts` (job handlers)

Enforce it with ESLint `no-restricted-imports` and boundary rules (P1, L, done incrementally per domain).

---

## 6. Transactions and consistency

**Fact:** No application code opens a transaction. Supabase-js/PostgREST runs one statement per HTTP request. Only `create_clinic_with_owner` and `consume_invitation` are atomic plpgsql RPCs (`000001:78-108`, `000002:120-165`).

| Flow | Evidence | Failure mode |
|---|---|---|
| Create invoice | `features/billing/actions.ts:80-138` | Invoice inserted, items insert fails → orphan invoice with totals but no items. Invoice number fallback `INV-YYYY-<Date.now() tail>` (`:93`) breaks the sequence. `count(*)+1` numbering races into a unique violation. |
| Record payment | `features/billing/actions.ts:203-261` | Payment inserted, status recomputed with read-then-write. Concurrent payments or overpayment are not prevented, and payments on `cancelled` invoices are accepted. |
| Complete and sign | `features/consultation/actions.ts:640-668` | Three updates with **errors ignored**. `queue_tokens` is updated with `updated_at`, a column that table does not have (`:664-668` vs `000006:42-53`), so it silently fails. The webhook payload reads `visit.patient_id`, but the select includes only `id, status, clinical_notes` (`:612`, `:700`), so `patient_id`/`doctor_id` are `undefined` in `visit.completed` events. |
| Reopen for amendment | `features/consultation/actions.ts:~855-880` | Revision snapshot inserted, then status update. A failure in between leaves a revision without a reopened visit. |
| Queue check-in | `features/queue/actions.ts:68-110` | `MAX+1` token RPC, then insert. Concurrent check-ins hit `uq_tenant_date_token` and the user sees an error. The date is computed in **UTC** (`:26`), so check-ins between 00:00 and 05:30 IST are filed on the previous day. |
| Audit and outbox | `lib/audit/audit.ts:168-198`, `lib/webhooks/outbox.ts:33-138` | Written after the commit. Events can be lost (outbox insert fails and is swallowed) or audits can be missing. |

**Recommendation (P1, L):** Make every multi-statement write a single database transaction that also writes the audit row and outbox row (ADR-003/004). Rely on database constraints for invariants (DB-assessment §5).

---

## 7. Type safety, validation and result conventions

**Facts**
- `lib/db/types.ts` is **hand-written**. The `Database` type (`:530-1430`) lacks `consent_records`, `queue_tokens`, `waitlist_entries`, `invoices`, `invoice_items`, `payments`, `communication_queue`, `tenant_messaging_config`, `in_app_notifications` and `consultations`. As a result there are **387 `as any`** occurrences across `app/features/lib`, plus many hand-written structural casts such as `features/visits/actions.ts:63-71` and `features/queue/actions.ts:41-53`.
- Zod is used at only about 27 call sites. Most exported actions accept raw IDs and objects without parsing; per file, `safeParse` count against exported functions is ai 0/4, api-keys 0/3, queue 0/3, webhooks 0/5, notifications 0/4, appointments 0/6. Several API handlers destructure untyped bodies (`app/api/v1/visits/[id]/route.ts:103`, `app/api/v1/lab-orders/route.ts:123-133`).
- Unvalidated strings are interpolated into PostgREST filters: `` .or(`doctor_id.eq.${doctorId},doctor_id.is.null`) `` (`features/visits/scheduling.ts:232,299`).
- Result conventions are inconsistent:
  - `{success,error,fieldErrors}` unions in most actions
  - thrown `Error` in `features/appointments/actions.ts:76`
  - `null` in `getPatient`
  - `[]` on error in `getPatients` (`features/patients/actions.ts:286-289`)
  - raw `err.message` returned to the UI (for example `features/patients/actions.ts:74-78`), which can surface Postgres or PostgREST messages such as `lib/auth/tenant.ts:48`.
- `env.ts` validates only three variables (`lib/env.ts:3-11`). About 30 others (`CRON_SECRET`, `R2_*`, `MSG91_*`, `AI_*`, `TWILIO_*`, `GUPSHUP_*`, `NEXT_PUBLIC_APP_URL`) are read ad hoc. `AI_API_KEY` silently falls back to `"test-api-key"` (`lib/ai/client.ts:44-48`).

**Recommendations**
- **P1, S:** Generate DB types (`supabase gen types` now; `kysely-codegen` in the target state) and check them in CI.
- **P1, M:** Zod v4 schemas at every boundary (action input, route body and query, webhook payload, job payload, env).
- **P1, S:** Use one `Result<T, AppError>` type and one error taxonomy (`TARGET_ARCHITECTURE.md §6`). Never return database messages to clients.

---

## 8. Service-role (RLS-bypass) usage inventory

| Location | Why bypass | Assessment |
|---|---|---|
| `app/api/v1/**` (13 handlers), `lib/api/auth.ts`, `lib/api/doctor-guard.ts` | API keys have no Postgres identity | **Problem P1:** All API traffic runs as superuser-equivalent, so every query must remember `.eq("tenant_id")`. Mitigation: run API requests under a per-key RLS context (ADR-005/011). |
| `app/api/r/[token]`, `app/r/[token]/page.tsx`, `app/api/reports/view`, `app/reports/view/page.tsx`, `app/api/reschedule/[token]` | Unauthenticated patient links | Legitimate need, but the logic is duplicated across page and route, and the tenant check is missing (§4.5). Replace with narrow SECURITY DEFINER RPCs. |
| `lib/messaging/dispatcher.ts`, `lib/webhooks/*`, cron | System jobs | Legitimate. Should use a single `systemContext()` factory. |
| `features/patients/actions.ts`, `features/patients/consent.ts`, `features/settings/actions.ts`, `features/prescriptions/pdf/generator.ts` (`sessionOverride ? getAdminClient()`) | Test seam | **P0 defect** (§4.1). |
| `features/dpdp/*`, `features/notifications/triggers.ts`, `features/referrals/actions.ts`, `features/api-keys/actions.ts`, `lib/ai/*` | Mixed: cross-tenant referrals, system notifications, AI context | Each needs a documented justification. Default to the RLS client. |
| `features/appointments/actions.ts:10-22` | Webhook-driven rescheduling | Duplicate factory and duplicate domain logic. Merge into the visits service with a system context. |

**Recommendation (P1, S):** Use one `getSystemClient(reason)` factory, importable only from `server/system/**` and `jobs/**` (ESLint-enforced). Log each use with a reason code.

---

## 9. Background jobs, messaging and webhooks

**Facts**
- There are two outbox tables: `communication_queue` (`000014:12-54`) and `webhook_delivery_queue` (`000018:123-166`).
- **Dispatch triggers:**
  1. `enqueueMessage` synchronously awaits `dispatchPendingQueue()` inside the user's request. That call processes up to 20 due rows **across all tenants** (`lib/messaging/dispatcher.ts:104-110,118-138`).
  2. `enqueueWebhookEvent` fires a dynamic `import("./dispatcher")` without awaiting it (`lib/webhooks/outbox.ts:117-131`). On serverless platforms this work may be cut off when the response returns.
  3. `GET|POST /api/cron/{dispatch-communications,webhooks}`, protected by `CRON_SECRET`. No scheduler that calls these routes is defined in the repo. **Outstanding investigation:** confirm what (if anything) triggers them in production.
- **No atomic claiming:** both dispatchers `SELECT` due rows and then `UPDATE` them (`lib/messaging/dispatcher.ts:129-150`; `lib/webhooks/dispatcher.ts:239-249`). Concurrent runs (cron plus the inline dispatch) can **send the same WhatsApp message or webhook twice**. Rows left in `processing` after a crash are never recovered.
- **Governance is dead code:** `evaluateMessageEligibility`, `isQuietHours` and the quota checks in `lib/messaging/governance.ts:29-174` are referenced only by `tests/messaging/outbox-queue.spec.ts`. `whatsapp_opt_out` is selected but never enforced (`features/appointments/actions.ts:82-103`). `tenant_messaging_config` is never read or written by app code, and `messages_sent_this_month` is never incremented.
- **PII in audit:** the dispatcher writes `recipient_phone` into `audit_logs.metadata` (`lib/messaging/dispatcher.ts:208-221`), bypassing the allow-list in `lib/audit/audit.ts:98-140`.
- Webhook signing is good: Stripe-style `t=…,v1=HMAC` over the raw payload, signing the exact stored text, a stable event `id`, an SSRF check and a 5-second timeout (`lib/webhooks/signer.ts`, `lib/webhooks/dispatcher.ts:93-145`).

**Recommendations**
- **P1, M:** Use a transactional outbox: write the row in the business transaction, claim rows with a `claim_jobs(kind, n, lease)` RPC using `FOR UPDATE SKIP LOCKED` plus a lease timeout, and have one scheduler call one dispatcher route every minute.
- **P1, S:** Enforce governance at enqueue time.
- **P2, S:** Move PII out of audit metadata.

See ADR-009.

---

## 10. Logging, observability and error handling

**Facts:**
- There are 191 `console.*` calls. Most are `console.error(…, error)` with the raw Supabase error, and some log row data.
- There is no logger abstraction, no request ID propagation, no Sentry/OpenTelemetry dependency (`package.json`), no queue-depth metrics and no alerting.
- Correlation IDs are generated only for API 5xx responses and are not linked to any log context (`lib/api/envelope.ts:46-55`).
- `/api/health` (liveness) and `/api/ready` (DB and storage checks) exist.

**Problems:** A production incident cannot be traced from a clinic's report to a log line. Logs may contain PHI, for example error objects carrying row values.

**Recommendation (P1, M):** Use a structured logger (pino) with `requestId`, `tenantId`, `actor`, `route/action` and `durationMs`, plus redaction paths. Add Sentry, with PII scrubbing and a data region chosen consciously. Expose queue-lag metrics on `/api/ready` and a dashboard. See ADR-012.

---

## 11. Caching and performance

**Facts**
- There is no application caching and no `React.cache` for per-request session resolution. `requirePermission` calls `getActiveMembership()` (one `auth.getUser()` network call plus one memberships query, `lib/auth/tenant.ts:30-88`), and `recordAudit` calls it **again** (`lib/audit/audit.ts:173`). Middleware calls `getUser()` again on every request (`middleware.ts:50`). A single action therefore makes 3–5 auth or DB round trips before doing any work.
- API authentication performs four sequential DB calls per request, including a read-modify-write usage counter (`lib/api/auth.ts:77-137`). Under concurrency the counter loses increments.
- Patient search uses `ILIKE '%term%'` on `full_name`, `phone` and `abha_id` (`features/patients/actions.ts:213-245`), but only B-tree indexes exist (`000003:19-22`). Every search is a sequential scan within the tenant.
- There are 94 `revalidatePath` calls: coarse, path-based invalidation.

**Recommendations:**
- **P2, S:** Wrap session resolution in `React.cache` per request.
- **P2, S:** Combine API-key authentication and usage counting into one RPC.
- **P2, S:** Add `pg_trgm` GIN indexes for patient search.
- Do **not** introduce Redis or a cache tier at the current scale.

---

## 12. External integrations

| Integration | Facts | Assessment |
|---|---|---|
| Messaging | Provider abstraction for MSG91, Twilio and Gupshup (`lib/messaging/providers/*`), templates mapping and sync scripts | A good seam. Prune unused providers (**Assumption (validate):** only MSG91 is used in production). Inbound webhook verification uses a shared secret in a header or query string (`lib/messaging/webhook-helpers.ts:62-80`); Workstream D to review. |
| AI | Vercel AI SDK v4 with Gemini or OpenAI and a custom fetch interceptor for Gemini thought signatures (`lib/ai/client.ts:14-41`). Patient context is sanitised (`lib/ai/sanitizer.ts`). The copilot RBAC role list is hard-coded (`app/api/ai/clinical-copilot/route.ts:37`) and differs from the permission matrix | No per-tenant quota or rate limit and no cost telemetry. `patientContext` is client-supplied (`:51-55`). Retain the SDK; add gateway-level quotas, audit and server-side context assembly. |
| PDF | `@react-pdf/renderer` rendered synchronously inside actions and routes (`features/*/pdf/*`, `app/api/invoices/[id]/receipt-pdf`, `app/api/visits/[id]/prescription-pdf`), as `serverExternalPackages` (`next.config.ts`) | Acceptable for on-demand downloads. Archival PDFs generated during sign-off add latency and fail silently (`features/consultation/actions.ts:671-678`). Move archival generation to a job. |
| Storage | Dual provider: Supabase Storage or Cloudflare R2 via S3 SDK, auto-selected by environment variables (`lib/storage/index.ts:64-82`). Two buckets with path-prefix RLS (`000008`, `000013`). The R2 path bypasses Supabase storage RLS entirely | Choose one provider (ADR-014). The storage RLS policy casts `split_part(name,'/',1)::uuid` inside an `OR` (`000013:35-38`). Postgres does not guarantee short-circuit order, so `tenants/...` paths may raise a cast error. **Assumption (validate)** against the hosted DB. |
| Payments | None implemented. `subscriptions` and `payment_records` are read-only manual records (`features/billing/subscription.ts`). Patient payments are recorded manually as cash, UPI or card | When a gateway (Razorpay or Cashfree) is added, it must use the same outbox and idempotency patterns. |

---

## 13. Dependency hygiene

**Facts:**
- Installed versions: next 15.5.27, @supabase/ssr **0.5.2** (old), supabase-js 2.117.2, zod 3.25.76, ai 4.3.19, @react-pdf 4.9.0.
- The coordinator recorded `npm audit --omit=dev`: 10 vulnerabilities, including next and zod.
- The `supabase` CLI is a devDependency.
- There is no Renovate or Dependabot config.

**Recommendations:**
- **P1, S:** Upgrade `next` and `zod` (to v4) as part of foundations, and `@supabase/ssr` to the current minor version.
- **P2, S:** Enable Renovate with grouped weekly PRs.
- Workstream F owns CI.

---

## 14. Strengths worth preserving

- The tenant and membership model with explicit active-tenant selection that never trusts the browser (`lib/auth/tenant.ts:26-88`).
- Atomic clinic creation and invitation consumption in plpgsql (`000001:78-108`, `000002:120-165`).
- The audit metadata allow-list approach (`lib/audit/audit.ts:98-157`), append-only consent records, and visit revision snapshots.
- Webhook design: raw-payload HMAC, retries with backoff, SSRF validation, and a stable event IDs.
- API envelope, rate-limit headers and SHA-256-hashed API keys with prefix display.
- Storage path sanitisation (`lib/storage/index.ts:41-57`) and the provider abstraction.
- Phone normalisation to E.164 in both application and database.

---

## 15. Findings register (architecture)

| ID | Finding | Priority | Size | Detail |
|---|---|---|---|---|
| ARC-01 | `sessionOverride` in exported server actions → unauthenticated cross-tenant service-role access, and RBAC bypass | **P0** | S | §4.1 |
| ARC-02 | Self-service role escalation through the `memberships` UPDATE policy | **P0** | S | §4.2 |
| ARC-03 | RLS is tenant-only; RBAC is application-only and bypassable with the browser JWT | P1 | M | §4.3 |
| ARC-04 | SECURITY DEFINER functions trust `p_tenant_id`; missing REVOKE | P1 | S | §4.4 |
| ARC-05 | Share-token resolution has no tenant check | P1 | S | §4.5 |
| ARC-06 | API accepts arbitrary `storage_path` | P1 | S | §4.6 |
| ARC-07 | Referral target can rewrite any column; sender can target any tenant | P1 | S | §4.7 |
| ARC-08 | No service/repo layer; REST duplicates and diverges from action logic | P1 | L | §5 |
| ARC-09 | No transactions; ignored errors; audit and outbox written after commit | P1 | L | §6 |
| ARC-10 | Sign-off bugs: webhook payload missing IDs; update to a non-existent column | P1 | S | §6 |
| ARC-11 | UTC date bugs in tenant-local operations (13 sites) | P1 | M | §6 |
| ARC-12 | Hand-written DB types, 387 `as any`; sparse zod; filter-string interpolation | P1 | M | §7 |
| ARC-13 | Four service-role client factories; bypass not confined | P1 | S | §8 |
| ARC-14 | Jobs: no scheduler in repo, inline cross-tenant dispatch, no claim or lease, duplicate sends | P1 | M | §9 |
| ARC-15 | Messaging governance (quiet hours, quota, opt-out) not enforced | P1 | S | §9 |
| ARC-16 | No structured logging, tracing or error tracking; possible PHI in logs | P1 | M | §10 |
| ARC-17 | Audit log forgeable and non-atomic; PII in dispatcher audit metadata | P2 | M | §4.8, §9 |
| ARC-18 | Redundant auth round trips; API usage counter race | P2 | S | §11 |
| ARC-19 | Dual storage providers; possible storage-policy cast error | P2 | S | §12 |
| ARC-20 | Env validation covers 3 of about 30 variables; silent AI-key fallback | P2 | S | §7 |
| ARC-21 | Inconsistent result and error conventions; DB messages leak to the UI | P2 | S | §7 |
| ARC-22 | Outdated `@supabase/ssr`; vulnerable next and zod; no dependency bot | P1 | S | §13 |

> Verification (2026-11-10): PARTIALLY_CONFIRMED — ARC-02: self-promotion confirmed (Cr/P0); `tenant_id` can move only to a tenant the user already belongs to; `user_id` is unconstrained. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — ARC-04: metadata-only leak; anon EXECUTE probably wider than claimed (OI-5). M/P2. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — ARC-05: prescriptions, referrals and lab documents leak via 600 s signed URL + patient name; invoice PDFs do not. Raised to H/P0 (ruling C11). See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — ARC-06: injection confirmed; service-role signing happens on the share route (and R2), in-app signing uses RLS; attacker needs the exact object key. Raised to H/P0 (C1). See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — ARC-10: confirmed; a failed visit update is still reported as success; `doctor_id` falls back to the signer (only `patient_id` undefined). H/P1. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — ARC-14: confirmed for messaging; the webhook dispatcher has no `processing` state (it double-delivers on overlap, no stuck rows). Raised to H/P0 (ruling C16). See VERIFICATION_LOG.md

## 16. Outstanding investigations

1. What triggers `/api/cron/*` in production (Vercel Cron, Supabase pg_cron, an external pinger, or nothing)? Check queue tables for stale `pending` rows (read-only).
2. Whether the hosted DB schema matches the repo migrations (migrations 000007 and 000014 were edited after creation; see `DATABASE_ASSESSMENT.md §8`).
3. Whether Supabase default grants allow `anon` to execute `generate_tenant_invoice_number`.
4. The hosting platform and plan (it affects cron frequency, function duration and region). Coordinate with Workstream F.
5. Whether any production data shows evidence of exploitation of ARC-01, ARC-02 or ARC-05. Read-only diagnostic queries are given in `BACKEND_MIGRATION_PLAN.md §3`.
