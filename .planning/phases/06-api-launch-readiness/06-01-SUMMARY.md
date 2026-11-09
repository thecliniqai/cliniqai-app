---
phase: 06-api-launch-readiness
plan: "01"
subsystem: api
tags: [rest-api, api-keys, rate-limiting, visits, patients, audit, dpdp]

requires:
  - phase: 05.3-communications-reliability-hardening
    provides: E.164 phone normalization, transactional outbox queue patterns
provides:
  - Prefixed Bearer token authentication (clq_live_...) with timing-safe SHA-256 verification
  - Database migration 000018 for api_keys, api_key_usage_daily, webhook_subscriptions, and DPDP columns
  - Standardized JSON response envelopes ({ data, meta } / { error: { code, message, details } })
  - Sliding-window rate limiter enforcing 120 req/min with standard X-RateLimit-* headers
  - Full CRUD Route Handlers for Patients (/api/v1/patients) and Appointments (/api/v1/appointments grounded in public.visits)
  - Complete integration test suites across auth, rate limiting, and CRUD operations
affects:
  - 06-02-PLAN.md (Clinical APIs for visits, prescriptions, labs, referrals)
  - 06-03-PLAN.md (Webhooks delivery engine and settings UI)
  - 06-04-PLAN.md (DPDP export and patient erasure)

actuals:
  tokens: 22130
  tasks: 3
  commits: 3
  plan_head_before: f56a660c759d5d62dccefeaa19a4dfdbff101d4e
  plan_head_after: 8b22efe5786cce5f41fc1e9d167f4ce32c743233

tech-stack:
  added: []
  patterns:
    - Prefixed high-entropy Bearer token auth with CSPRNG and SHA-256 constant-time verification
    - In-memory sliding-window rate limiter with RFC rate-limit headers
    - Clean schema grounding mapping REST appointments directly to public.visits (origin_type='scheduled')
    - Tenant context derived strictly from API key record in database
    - Audit logging with actor_type: 'api_key' and foreign-key compliant creator user ID

key-files:
  created:
    - supabase/migrations/000018_api_keys_webhooks_dpdp.sql
    - lib/api/auth.ts
    - lib/api/envelope.ts
    - lib/api/rate-limiter.ts
    - app/api/v1/patients/route.ts
    - app/api/v1/patients/[id]/route.ts
    - app/api/v1/appointments/route.ts
    - app/api/v1/appointments/[id]/route.ts
    - tests/api/v1-auth.spec.ts
    - tests/api/rate-limiting.spec.ts
    - tests/api/v1-crud.spec.ts
  modified:
    - lib/db/types.ts
    - lib/audit/audit.ts

key-decisions:
  - "D-01: Used prefixed Bearer tokens (clq_live_...) with timing-safe SHA-256 verification against public.api_keys table"
  - "D-02: API keys grant full clinic admin access scoped to the authenticated clinic tenant via public.api_keys.tenant_id"
  - "D-03: Response envelope standardizes { data, meta } on success and { error: { code, message, details, correlation_id } } on errors"
  - "D-08: Database mutations record audit logs with actor_type: 'api_key', api_key_id, and created_by user FK compliance"
  - "D-19: In-memory sliding window rate limiter enforces default 120 req/min per key with X-RateLimit-* headers"

patterns-established:
  - "API Auth Middleware: authenticateApiKey verifies Bearer token and returns AuthenticatedApiKeySession with tenantId, apiKeyId, and userId"
  - "Appointments persistence: /api/v1/appointments maps directly to public.visits where origin_type = 'scheduled' with slot-conflict checking"
  - "Error sanitisation: 500 and database errors return generic messages with correlation IDs to avoid leaking database internals"

requirements-completed:
  - REQ-api-access
  - REQ-nfr-performance

coverage:
  - id: D1
    description: "Database migration 000018 establishing api_keys, api_key_usage_daily, webhook tables, and DPDP patient columns"
    requirement: "REQ-api-access"
    verification:
      - kind: integration
        ref: "tests/api/v1-auth.spec.ts#authenticates valid token, returns creator userId, and records usage counters"
        status: pass
    human_judgment: false
  - id: D2
    description: "Bearer token authentication with timing-safe comparison, revocation check, and usage counter tracking"
    requirement: "REQ-api-access"
    verification:
      - kind: integration
        ref: "tests/api/v1-auth.spec.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Sliding-window rate limiter enforcing 120 req/min per key with HTTP 429 response envelope and headers"
    requirement: "REQ-api-access"
    verification:
      - kind: unit
        ref: "tests/api/rate-limiting.spec.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Patients collection and detail CRUD endpoints with search sanitisation, pagination, and soft-delete filtering"
    requirement: "REQ-api-access"
    verification:
      - kind: integration
        ref: "tests/api/v1-crud.spec.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Appointments REST endpoints mapped to public.visits with origin_type='scheduled' and slot conflict prevention"
    requirement: "REQ-api-access"
    verification:
      - kind: integration
        ref: "tests/api/v1-crud.spec.ts"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-11-09
status: complete
---

# Phase 06 Plan 01: External Developer REST API Foundation & Patients/Appointments API Summary

**Prefixed Bearer token authentication (clq_live_...), migration 000018, sliding-window rate limiting, uniform JSON response envelopes, and complete CRUD endpoints for Patients and Appointments grounded in public.visits.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-11-09T15:12:00Z
- **Completed:** 2026-11-09T15:34:00Z
- **Tasks:** 3
- **Files modified:** 13

## Accomplishments

- Applied migration `000018_api_keys_webhooks_dpdp.sql` creating `public.api_keys`, `public.api_key_usage_daily`, `public.webhook_subscriptions`, `public.webhook_delivery_queue`, and added DPDP soft-delete columns (`is_deleted`, `status`, `erased_at`, `erasure_reason`) on `public.patients`.
- Implemented prefixed Bearer authentication middleware (`lib/api/auth.ts`) validating tokens in constant time via `crypto.timingSafeEqual` and updating per-key daily usage counters.
- Built uniform response envelope utility (`lib/api/envelope.ts`) guaranteeing `{ data, meta }` on success and `{ error: { code, message, details, correlation_id } }` on failure while sanitising internal database errors.
- Built in-memory sliding-window rate limiter (`lib/api/rate-limiter.ts`) enforcing 120 req/min with `X-RateLimit-*` headers and HTTP 429 responses.
- Implemented `/api/v1/patients` (GET, POST) and `/api/v1/patients/[id]` (GET, PUT) with sanitised search, range pagination, soft-delete filtering, and audit trail logging (`actor_type: 'api_key'`).
- Implemented `/api/v1/appointments` (GET, POST) and `/api/v1/appointments/[id]` (GET, PATCH, DELETE) grounded in `public.visits` with `origin_type = 'scheduled'`, slot-conflict checks via `checkSlotAvailability`, and doctor role verification.
- Established comprehensive test coverage with 29 passing automated integration tests across auth, rate limiting, and CRUD suites.

## Task Commits

Each task was committed atomically:

1. **Task 1: Database Migration 000018, Audit Model Extensions, API Key Bearer Authentication & Patients REST API** - `499e601` (feat)
2. **Task 2: Sliding Window Rate Limiting & Patients Detail + Appointments REST API Grounded in Visits Schema** - `039f2b0` (feat)
3. **Task 3: External REST API CRUD Integration Tests & Schema Verification** - `8b22efe` (test)

## Files Created/Modified

- `supabase/migrations/000018_api_keys_webhooks_dpdp.sql`: Created tables for api_keys, api_key_usage_daily, webhooks, and added DPDP/statutory columns.
- `lib/db/types.ts`: Extended Database.public.Tables registry with ApiKey, ApiKeyUsageDaily, WebhookSubscription, WebhookDeliveryItem, Patient, Tenant, and AuditLog definitions.
- `lib/audit/audit.ts`: Added allowed metadata keys, expanded AuditAction union, and enabled API key actor logging.
- `lib/api/envelope.ts`: Standardized response envelope helpers (`apiSuccess`, `apiError`).
- `lib/api/rate-limiter.ts`: In-memory sliding-window rate limiter with RFC rate-limit header generator.
- `lib/api/auth.ts`: Prefixed Bearer token validation with timingSafeEqual, usage counter increment, and creator user FK resolution.
- `app/api/v1/patients/route.ts`: Collection GET and POST for patients.
- `app/api/v1/patients/[id]/route.ts`: Detail GET and PUT for patients with soft-delete filtering.
- `app/api/v1/appointments/route.ts`: Collection GET and POST for appointments mapped to public.visits.
- `app/api/v1/appointments/[id]/route.ts`: Detail GET, PATCH, DELETE for appointments with slot-conflict checking.
- `tests/api/v1-auth.spec.ts`: Integration test suite for Bearer token validation, SHA-256 constant-time checks, usage tracking, and tenant isolation.
- `tests/api/rate-limiting.spec.ts`: Unit and route integration test suite for 120 req/min sliding window and HTTP 429 responses.
- `tests/api/v1-crud.spec.ts`: 17 integration tests verifying full CRUD, pagination metadata, filtering, and cross-tenant isolation.

## Decisions Made

- Grounded `/api/v1/appointments` directly in `public.visits` with `origin_type = 'scheduled'`, avoiding schema fiction and leveraging existing slot-conflict prevention.
- Bound mutations to the API key creator's `auth.users` UUID (`session.userId`) satisfying strict database foreign key constraints on `created_by`.
- Restricted `api_keys` and `webhook_subscriptions` RLS policies strictly to tenant members with `owner` or `admin` role.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Included origin_type in appointments select clause**
- **Found during:** Task 3 (CRUD Integration Tests)
- **Issue:** GET `/api/v1/appointments` select list omitted `origin_type`, returning `undefined` for `origin_type` in response payloads.
- **Fix:** Added `origin_type` to the `.select(...)` column list in both collection and detail routes.
- **Files modified:** `app/api/v1/appointments/route.ts`, `app/api/v1/appointments/[id]/route.ts`
- **Verification:** `tests/api/v1-crud.spec.ts` passes asserting `origin_type === 'scheduled'`.
- **Committed in:** `8b22efe` (Task 3 commit)

**2. [Rule 1 - Bug] Handled doctor off-duty and blocked conflict states in appointment POST**
- **Found during:** Task 3 (CRUD Integration Tests)
- **Issue:** `checkSlotAvailability` returned early when a slot fell outside doctor shift hours, leaving `conflictingVisit` unset and allowing off-duty overbooking.
- **Fix:** Handled `slotCheck.isOffDuty` and `slotCheck.isBlocked` alongside `slotCheck.conflictingVisit` to return HTTP 409 `SLOT_CONFLICT`.
- **Files modified:** `app/api/v1/appointments/route.ts`
- **Verification:** `tests/api/v1-crud.spec.ts` passes verifying conflict rejection.
- **Committed in:** `8b22efe` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs).
**Impact on plan:** None. Fixes improved correctness, schema fidelity, and clinical safety.

## Issues Encountered

None. Migration 000018 was applied cleanly to the database and all 29 automated tests passed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Foundation, Bearer auth middleware, response envelopes, rate limiter, Patients API, and Appointments API are complete.
- Ready for Plan 06-02: Clinical APIs (Visits, Prescriptions, Lab Orders, Referrals) with Doctor Guard.

---
*Phase: 06-api-launch-readiness*
*Completed: 2026-11-09*

## Self-Check: PASSED
- [x] All 11 created files exist on disk
- [x] All 3 task commits exist in git history (499e601, 039f2b0, 8b22efe)
- [x] Typecheck passed with 0 errors
- [x] All 29 automated tests passed (tests/api/v1-auth.spec.ts, tests/api/rate-limiting.spec.ts, tests/api/v1-crud.spec.ts)
