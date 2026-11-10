# clinicOS v2.0: API and Integration Assessment

**Workstream:** C3 (API and Integration Standards) · **Date:** 2026-11-10 · **Status:** Discovery only.
**Scope:**
- The public REST API (`app/api/v1/**`, 13 route files, 25 handlers)
- Internal HTTP routes (`app/api/{ai,cron,health,ready,invoices,visits,r,reports,reschedule,webhooks}`)
- The server-action surface, which is an implicit RPC API
- Outbound webhooks and third-party integrations

Workstream D covers authentication cryptography, SSRF and inbound webhook verification in depth.
**Labels:** Fact / Problem / Risk / Assumption (validate) / Recommendation · P0–P3 · S/M/L/XL.

---

## 1. API surface inventory

| Surface | Auth | DB client | Count | Notes |
|---|---|---|---|---|
| `/api/v1/*` public REST | Bearer API key (`clq_live_…`, SHA-256-hashed) | service-role | 25 handlers in 13 files | Patients, appointments, visits, prescriptions, lab-orders, referrals, patient export, OpenAPI JSON, docs page |
| Server actions (`"use server"` in `features/*`, `app/(dashboard)/settings/clinic/actions.ts`) | Supabase cookie session (but see API-01) | RLS, sometimes service-role | about 230 exported functions | The **main** API of the product: an RPC over POST with action IDs |
| `/api/ai/{clinical,operations}-copilot` | Cookie session | RLS | 2 | Streaming. No rate limit or quota |
| `/api/invoices/[id]/receipt-pdf`, `/api/visits/[id]/prescription-pdf` | Cookie session | RLS | 2 | Binary PDF responses |
| `/api/r/[token]`, `/api/reports/view`, `/api/reschedule/[token]` (+ page twins `app/r/[token]`, `app/reports/view`) | Bearer token in URL (patient-facing) | service-role | 3 (+2 pages) | Logic duplicated between page and route |
| `/api/webhooks/messaging/[provider]` | Shared secret or signature | service-role | 1 | Inbound DLR and button replies (MSG91, Twilio, Gupshup) |
| `/api/cron/{dispatch-communications,webhooks}` | `Authorization: Bearer $CRON_SECRET` | service-role | 2 | No scheduler definition in the repo |
| `/api/health`, `/api/ready` | none | service-role (ready) | 2 | Liveness and readiness |

---

## 2. Public REST API v1: conventions review

### 2.1 What is good (Facts)
- **Envelope:** `{ data, meta? }` and `{ error: { code, message, details?, correlation_id? } }` (`lib/api/envelope.ts:4-67`). 5xx and DB errors are sanitised to a generic message and given a correlation ID (`:50-63`).
- **Versioning** is path-based (`/api/v1`). The OpenAPI 3.0.3 document is served at `/api/v1/openapi.json`, and docs are rendered with a pinned Scalar CDN script (`app/api/v1/docs/route.ts:31`).
- **API keys:** 192-bit random, a `clq_live_` prefix, only the SHA-256 hash stored, prefix shown for identification, revocation by timestamp, lookup by hash with constant-time compare (`lib/api/auth.ts:24-102`).
- **Rate-limit headers** `X-RateLimit-Limit/Remaining/Reset` (`lib/api/rate-limiter.ts:54-60`).
- **Pagination:** `page` and `limit` capped at 100, `meta.total/total_pages` (`app/api/v1/patients/route.ts:36-80`).
- **Audit:** mutations record `actor_type: 'api_key'` and `api_key_id` (`app/api/v1/patients/route.ts:161-180`).
- **Doctor guard:** clinical mutations validate that `doctor_id` is a doctor or owner in the tenant (`lib/api/doctor-guard.ts:21-65`).

### 2.2 Problems

| ID | Finding | Evidence | Priority |
|---|---|---|---|
| API-02 | **All v1 traffic uses the service-role client.** Tenant isolation depends on every query adding `.eq("tenant_id", session.tenantId)` by hand. One missed filter is a cross-tenant leak, and RLS offers no backstop | `getAdminClient()` in all handlers, e.g. `app/api/v1/patients/route.ts:44,131` | P1 |
| API-03 | **Business logic re-implemented** per handler, not shared with UI actions; the rules already diverge (visit completion skips prescription signing, PDF archive and amendment workflow; patient update schema duplicated) | `app/api/v1/visits/[id]/route.ts:103-165` vs `features/consultation/actions.ts:597-743`; `app/api/v1/patients/[id]/route.ts:15-39` vs `features/patients/schema.ts` | P1 |
| API-04 | **Signed records can be overwritten** through `PATCH /visits/{id}` (clinical notes, vitals, advice on `completed` visits, with no revision snapshot) and "signed" with `signed_by` set to the API-key creator, who may not be a doctor | `app/api/v1/visits/[id]/route.ts:150-165` | P1 |
| API-05 | **Arbitrary `storage_path`** accepted on `POST /lab-orders`, a cross-tenant file reference (see ARCHITECTURE_ASSESSMENT §4.6). The endpoint name "lab-orders" actually creates `patient_documents` rows of type `lab_report`; there is no order concept | `app/api/v1/lab-orders/route.ts:9-12,123-189` | P1 |
| API-06 | **Validation is inconsistent:** some handlers use zod (`patients`), others destructure the body by hand (`lab-orders`, `visits/[id]` PATCH: `const { status, clinical_notes, … } = body`). `vitals`, `advice` and `chief_complaints` are written with minimal type checks. Path `id` values are not UUID-validated (Postgres raises errors, which become 500 `DATABASE_ERROR`) | `app/api/v1/visits/[id]/route.ts:103-115`; `app/api/v1/lab-orders/route.ts:123-133` | P1 |
| API-07 | **Over-exposure:** `select("*")` returns full rows, including internal fields (`is_deleted`, `erasure_reason`, `created_by`, `abha_id`, `storage_path`, `tenant_id`). There is no response DTO or field allow-list | `app/api/v1/patients/route.ts:48`, `[id]/route.ts:71`, `referrals/route.ts:50`, `lab-orders/route.ts:50` | P1 |
| API-08 | **Rate limiter is in-memory per instance** (`Map`). On serverless or multiple instances the effective limit is N × 120/min and resets on cold start. Only `/api/v1` is limited; server actions, AI routes, public token routes and OTP requests have no limit | `lib/api/rate-limiter.ts:12-49` | P1 |
| API-09 | **Usage counter race and latency:** each request makes 3–4 extra sequential writes (last_used, select usage, update or insert). Concurrent requests lose increments | `lib/api/auth.ts:104-140` | P2 |
| API-10 | **No idempotency:** a retried `POST /patients`, `/appointments`, `/prescriptions` or `/visits` creates duplicates. A post-commit audit failure returns 500 after the row was created, which invites a retry and therefore a duplicate | `app/api/v1/patients/route.ts:134-186` | P1 |
| API-11 | **Authorisation model is all-or-nothing:** every key acts as tenant "admin" (`role: "admin"` hard-coded) with no scopes and no read-only keys. Audit attribution uses the **creator's user ID**, and the key keeps working after the creator leaves the clinic (no check that the creator still has a membership) | `lib/api/auth.ts:8-14,142-151`; `app/api/v1/lab-orders/route.ts:215` uses `role: "owner"` | P1 |
| API-12 | **OpenAPI is hand-written and has drifted:** the `Patient` schema documents `gender` and `blood_group`, but the table has `sex` and no blood group; the security scheme says `x-api-key` is accepted, but auth only reads `Authorization: Bearer` | `lib/api/openapi-spec.ts:649,653-668` vs `000003:11`, `lib/api/auth.ts:48-59` | P2 |
| API-13 | **HTTP semantics:** `PUT /patients/{id}` is a partial update (PATCH semantics). Status codes vary (422 for validation, 404 vs 403 for cross-tenant). Error codes are free strings with no catalogue. `DELETE /patients/{id}` performs "erasure" with a JSON body (bodies on DELETE are poorly supported by clients) | `app/api/v1/patients/[id]/route.ts:97,207-236` | P2 |
| API-14 | **Offset pagination with `count: "exact"`** on every list. That costs a COUNT per page and gives unstable pages under concurrent inserts. There is no `updated_since` filter for sync use cases | `app/api/v1/patients/route.ts:48,61` | P2 |
| API-15 | **Export endpoint permission:** `/patients/{id}/export` with a cookie session requires only `patients:view`, so a receptionist can export a full medical record. The matrix defines `exports:create` but it is not used | `app/api/v1/patients/[id]/export/route.ts:66` vs `lib/permissions/matrix.ts:23` | P1 |
| API-16 | **Boilerplate duplication:** each of the 25 handlers repeats about 25 lines of auth, rate-limit and JSON-parse code, so a fix must be applied 25 times | e.g. `app/api/v1/patients/route.ts:16-33,93-117` | P2 |

> Verification (2026-11-10): PARTIALLY_CONFIRMED — API-02/API-11: confirmed; the lab-orders `owner` role is only an audit label. H/P1. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — API-04: confirmed, except DELETE is limited to owner/admin; an interim API PATCH guard can ride in containment. H/P1. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — API-05: injection confirmed; service-role signing happens on the share route (and R2); attacker needs the exact object key. Raised to H/P0 (C1). See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — API-11: confirmed; the lab-orders `owner` role is only an audit label. H/P1. See VERIFICATION_LOG.md

### 2.3 Server actions as an API surface
- **API-01 (P0).** Exported actions accept `clientOverride`/`sessionOverride`. Some switch to service-role when an override is present (`features/patients/actions.ts:174,255,278`; `features/patients/consent.ts:163`; `features/settings/actions.ts:48,179`), and they are reachable from the client bundle. See `ARCHITECTURE_ASSESSMENT.md §4.1`.
- **Problem (P1):** About 230 exported functions form an undocumented RPC surface. Most have no zod validation of their arguments, and some return raw database error messages.
- **Recommendation:** Treat every `"use server"` export as a public endpoint:
  - one input object validated by zod
  - authorisation from the session only
  - `ActionResult<T>` output
  - no internal helpers exported from `"use server"` files; move them to `service.ts`, which is not `"use server"`
  - an ESLint rule `server-actions/one-param-validated` (custom) or a CI grep

---

## 3. Outbound webhooks

**Facts:**
- Events are `visit.completed`, `prescription.issued`, `lab_result.ready` and others (`features/webhooks/constants.ts`).
- Envelope: `{ id, event, created_at, data }`.
- The raw text payload is stored and signed (`lib/webhooks/outbox.ts:82-101`).
- Header `X-ClinicQ-Signature: t=…,v1=HMAC-SHA256(secret, t.payload)` (`lib/webhooks/signer.ts:16-34`).
- 5-second timeout, 5 retries with backoff 1m/5m/15m/1h/6h (`lib/webhooks/dispatcher.ts:31-37`).
- SSRF validation (`lib/webhooks/ssrf.ts`).
- `whsec_` secrets are generated server-side (`features/webhooks/actions.ts:95`).

| ID | Finding | Evidence | Priority |
|---|---|---|---|
| WH-01 | Payload bugs: `visit.completed` sends `patient_id`/`doctor_id` as `undefined` because the source select omits them | `features/consultation/actions.ts:612,700-701` | P1 |
| WH-02 | No atomic claim or lease, so concurrent cron and opportunistic dispatch can deliver twice. Fire-and-forget dispatch may be killed by the serverless runtime | `lib/webhooks/dispatcher.ts:236-276`; `lib/webhooks/outbox.ts:117-131` | P1 |
| WH-03 | Events are enqueued after the business write, outside any transaction, and errors are swallowed and return `[]`, so events are silently lost | `lib/webhooks/outbox.ts:73-112,134-137` | P1 |
| WH-04 | Signing secrets are stored in plaintext and **returned to the browser on every list** | `000018:89`; `features/webhooks/actions.ts:35,107` | P2 |
| WH-05 | No event-ID header, no `webhook-version`, no documented event schemas in OpenAPI, no replay or redelivery endpoint, no auto-disable after repeated failure | `lib/webhooks/dispatcher.ts:129-139` | P2 |
| WH-06 | `fetch` follows redirects by default, and SSRF validation is done before DNS resolution at fetch time (TOCTOU) | `lib/webhooks/dispatcher.ts:129-140` | P1 (Workstream D to confirm) |
| WH-07 | `webhook_delivery_queue.status` has no CHECK; there is no `processing` state | `000018:129` | P2 |

> Verification (2026-11-10): PARTIALLY_CONFIRMED — WH-01: only `patient_id` is undefined; `doctor_id` falls back to the signer. H/P1 with ARC-10. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — WH-02: confirmed for messaging; the webhook dispatcher has no `processing` state and double-delivers on overlap. H/P0 (ruling C16). See VERIFICATION_LOG.md

**Recommendation:** Keep the signing scheme; it is compatible with Standard Webhooks and the Stripe style. Also:
- Move enqueue into the business transaction (outbox).
- Claim with `SKIP LOCKED` and a lease.
- Add `webhook-id`/`webhook-timestamp` headers.
- Use `redirect: "manual"`, and pin the resolved IP or re-validate on connect.
- Show the secret once and store it encrypted (Supabase Vault, or an app-level AES-GCM key from env).
- Auto-disable a subscription after N consecutive failures, with notification.
- Document event payloads in OpenAPI `webhooks:` (OpenAPI 3.1).

---

## 4. Third-party integrations

| Integration | Current | Findings | Recommendation |
|---|---|---|---|
| **MSG91** (WhatsApp, SMS, OTP) plus Twilio and Gupshup adapters | `lib/messaging/providers/*`, template mapping and sync scripts, `communication_queue` outbox | Governance (quiet hours, quota, opt-out) never applied (`lib/messaging/governance.ts` used only by tests). `whatsapp_opt_out` ignored (`features/appointments/actions.ts:82-103`). Inline dispatch processes all tenants' queues in a user request (`lib/messaging/dispatcher.ts:104-110`). Phone written to audit metadata (`:219`). No claim or lease, so duplicate sends are possible | P1: enforce governance at enqueue; claim/lease; scheduler; remove PII from audit. P2: prune unused providers (**Assumption (validate):** MSG91 only in production). |
| **Inbound messaging webhooks** | `app/api/webhooks/messaging/[provider]/route.ts` (524 lines) handles DLR and button replies that confirm or cancel appointments | Shared secret accepted in the **query string** (`lib/messaging/webhook-helpers.ts:62`). Dev bypass when secrets are unset and not production (`:67-75`). Business actions (cancel or reschedule an appointment) run with service-role through `features/appointments/actions.ts` without idempotency on provider message ID | P1 (Workstream D): header-only secret or HMAC; constant-time compare; store processed provider event IDs (unique) for idempotency. |
| **AI** (Vercel AI SDK v4, Gemini or OpenAI) | `lib/ai/*`, `/api/ai/*`, actions for SOAP, catch-up and Rx suggestions | No per-tenant or per-user rate limit or cost cap. Client-supplied `patientContext` (`app/api/ai/clinical-copilot/route.ts:51-55`). Role list hard-coded (`:37`). Default key fallback `"test-api-key"` (`lib/ai/client.ts:44-48`). No audit of AI usage on PHI | P1: server-side context assembly by `visitId` with authorisation; quota table; usage audit (counts, not content). P2: AI SDK v5 upgrade when convenient. |
| **PDF** (@react-pdf) | Synchronous render in actions and routes | Archival PDF on sign-off fails silently (`features/consultation/actions.ts:671-678`) | P2: generate archival PDFs in jobs, with retry. |
| **Storage** (Supabase Storage or R2) | Provider chosen by env (`lib/storage/index.ts:64-82`) | Two code paths, two security models (RLS vs none) | P2: choose one (ADR-014). |
| **Payments** | None. Manual cash, UPI or card recording; SaaS subscription records are manual | — | When adding Razorpay or Cashfree: webhook signature verification, idempotent event table, and the outbox. Never trust client-side success callbacks. |

---

## 5. Sensitive data exposure (API and integrations)

| Finding | Evidence | Priority |
|---|---|---|
| Full patient rows (ABHA ID, address, erasure fields) returned by v1 | `app/api/v1/patients/route.ts:48` | P1 |
| Recipient phone logged into `audit_logs.metadata` | `lib/messaging/dispatcher.ts:208-221` | P2 |
| Raw Supabase errors (which may include values) logged with `console.error` throughout; API 5xx responses log `message, details` | `lib/api/envelope.ts:52` | P2 |
| Webhook payloads persist indefinitely in `webhook_delivery_queue.payload` (IDs only today, but titles of lab reports are included: `app/api/v1/lab-orders/route.ts:226-230`) | — | P2 |
| Share-link pages return the patient name and clinic details to anyone holding the token. Tokens are stored in **plaintext** (`000013:126`) | `app/api/r/[token]/route.ts:26-29` | P2 (Workstream D) |
| Webhook signing secrets re-displayed | `features/webhooks/actions.ts:35,107` | P2 |

---

## 6. Recommended API standard (v1 hardening, then v2)

1. **One handler pipeline** `withApi({ auth: 'apiKey'|'session', scope, input: zodSchema, rateLimit, idempotent }, handler)`. It removes about 600 lines of duplicated boilerplate and makes every cross-cutting fix a single change.
2. **Handlers call domain services** (`features/<d>/service.ts`) with a `RequestContext` (`TARGET_ARCHITECTURE.md §4`). No handler touches the database directly.
3. **API-key principal under RLS:** use a per-request transaction with `set_config('request.jwt.claims', '{"sub": <service_principal_user>, "tenant_id": …, "scopes": […]}', true)` and `SET LOCAL ROLE authenticated`. Alternatively, give each key a dedicated "integration" membership. RLS then backstops API traffic as it does UI traffic (ADR-011).
4. **Scopes:** `patients:read`, `patients:write`, `appointments:*`, `clinical:read`, `clinical:write`, `documents:*`, `exports:create`. Default new keys to read-only.
5. **Idempotency-Key** header (required on POST), stored in `idempotency_keys(tenant_id, key, request_hash, response, created_at)` for 24 hours.
6. **Distributed rate limiting** in Postgres. A single `api_authenticate(key_hash)` RPC verifies the key, increments the minute bucket and daily usage atomically, and returns the limit state. No new infrastructure. Upstash Redis is an option if throughput grows.
7. **Response DTOs** built with zod `.pick()`. Stable error-code catalogue (`VALIDATION_FAILED`, `NOT_FOUND`, `CONFLICT`, `FORBIDDEN`, `RATE_LIMITED`, `IDEMPOTENCY_MISMATCH`, `INTERNAL`). RFC 9457 `application/problem+json` is an option for v2 only; do not churn v1 clients.
8. **OpenAPI generated from zod** (zod v4 `toJSONSchema` or `@asteasolutions/zod-to-openapi`), with a CI contract test that every route is documented and examples validate.
9. **Pagination:** keep offset in v1 and add `cursor` (keyset on `(created_at, id)`) plus `updated_since` in v1.1 or v2.
10. **Versioning policy:** additive changes in v1; a breaking change means `/api/v2` with at least 6 months' overlap. A `Deprecation` and `Sunset` header policy should be documented.
11. **Remove semantic mismatches:** rename `lab-orders` to `documents` (keep a v1 alias), and fix PUT to PATCH (keep PUT as an alias).

---

## 7. Findings register (API and integrations)

| ID | Summary | Priority | Size |
|---|---|---|---|
| API-01 | Server-action override parameters → service-role access without auth | **P0** | S |
| API-02 | v1 runs entirely as service-role | P1 | M |
| API-03 | Logic duplicated and diverging between REST and actions | P1 | L |
| API-04 | Signed visits overwritable via API; false signer attribution | P1 | S |
| API-05 | Arbitrary storage_path; "lab-orders" misnomer | P1 | S |
| API-06 | Inconsistent validation | P1 | M |
| API-07 | `select("*")` over-exposure | P1 | S |
| API-08 | In-memory rate limiting; no limits elsewhere | P1 | S |
| API-10 | No idempotency | P1 | M |
| API-11 | No scopes; key outlives creator; inconsistent actor role | P1 | M |
| API-15 | Export permission too broad | P1 | S |
| WH-01/02/03/06 | Webhook payload bug, duplicate delivery, lost events, redirect SSRF | P1 | M |
| MSG | Messaging governance not enforced; inbound webhook idempotency | P1 | M |
| AI | No AI quotas or audit; client-supplied context | P1 | M |
| API-09/12/13/14/16, WH-04/05/07 | Usage race, OpenAPI drift, HTTP semantics, pagination, boilerplate, secret display, webhook DX | P2 | M |
