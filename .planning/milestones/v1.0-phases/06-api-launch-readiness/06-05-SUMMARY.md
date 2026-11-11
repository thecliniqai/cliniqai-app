---
phase: 06-api-launch-readiness
plan: "05"
subsystem: platform-readiness
tags:
  - security-hardening
  - dev-logger
  - health-probes
  - readiness
  - performance
  - benchmarks
  - backup-restore
  - openapi
  - documentation
status: complete
requires:
  - "06-01"
  - "06-02"
  - "06-03"
  - "06-04"
provides:
  - dev-logger-lockdown
  - staff-invite-security
  - liveness-probe
  - readiness-probe
  - middleware-api-bypass
  - core-performance-sla
  - backup-restore-runbook
  - openapi-spec
  - interactive-api-docs
affects:
  - auth
  - middleware
  - storage
  - api-v1
  - operations
tech-stack:
  added: []
  patterns:
    - unbypassable-production-gate
    - dual-probe-liveness-readiness
    - generic-error-sanitization
    - middleware-session-bypass
    - scalar-standalone-cdn-docs
key-files:
  created:
    - app/api/health/route.ts
    - app/api/ready/route.ts
    - app/api/v1/openapi.json/route.ts
    - app/api/v1/docs/route.ts
    - docs/ops/backup-restore.md
    - lib/api/openapi-spec.ts
    - tests/api/health-probes.spec.ts
    - tests/api/openapi.spec.ts
    - tests/api/v1-performance.spec.ts
    - tests/ops/backup-restore.spec.ts
    - tests/security/dev-logger-lockout.spec.ts
  modified:
    - components/staff/invite-staff-form.tsx
    - features/auth/dev-actions.ts
    - features/staff/actions.ts
    - lib/auth/dev-logger.ts
    - middleware.ts
decisions:
  - "Dev auth logger and staff invite tokens permanently locked down in production (process.env.NODE_ENV === 'production') with zero escape hatches or credential leakages"
  - "Middleware bypasses Supabase auth cookie refresh for /api/v1/*, /api/health, and /api/ready, eliminating network and compute latency on API calls and uptime probes"
  - "Readiness probe (/api/ready) verifies Supabase Postgres, active storage provider (Supabase bucket or Cloudflare R2), and webhook delivery queue table, returning sanitized 503 errors without leaking raw exception strings"
  - "Core clinical actions benchmarked under strict 1-2s target in tests/api/v1-performance.spec.ts (open patient: ~300ms, create appointment: ~670ms, save prescription: ~150ms)"
  - "Postgres PITR (7-day window, RTO < 2h, RPO < 15m) and object storage cross-region replication documented in docs/ops/backup-restore.md and verified in tests/ops/backup-restore.spec.ts"
  - "OpenAPI 3.0 specification generated programmatically at /api/v1/openapi.json paired with zero-npm-dependency standalone Scalar documentation viewer at /api/v1/docs"
metrics:
  duration: 15m
  completed_date: "2026-11-09"
actuals:
  tokens: 21510
  tasks: 3
  commits: 3
  plan_head_before: "abbbb6175efe46536ac223ba490f7b39e18caa10"
  plan_head_after: "e33e0a44ee28eff81ac9878126e7d45c374b5f49"
---

# Phase 06 Plan 05: Launch Readiness, Health Monitoring, Performance & OpenAPI Documentation Summary

Execution of launch readiness and non-functional requirements (NFRs) for ClinicQ: complete lockdown of development-only authentication logging and staff invite token exposures; middleware optimization bypassing cookie session refresh for Bearer-authenticated API routes and monitoring endpoints; deployment of standardized health probes (`/api/health`, `/api/ready`) with storage provider awareness and error sanitization; performance verification of core clinical actions under the 1-2s SLA; operational backup and disaster recovery runbooks with automated integrity tests; and auto-generated OpenAPI 3.0 documentation with a zero-npm interactive Scalar documentation viewer.

## Key Changes Implemented

### 1. Task 1: Permanent Lockdown of Dev Auth Logger & Staff Invite Tokens
- **Dev Auth Logger Hardening (`lib/auth/dev-logger.ts`):** Enforced a strict, unbypassable leading security gate `if (process.env.NODE_ENV === "production") return;`. Removed any escape hatches (such as `ENABLE_DEV_AUTH_LOGS`) overriding production mode, permanently neutralizing console output and `.planning/dev-auth-logs.txt` writes.
- **OTP Action Hardening (`features/auth/dev-actions.ts`):** Ensured `requestOtpAction` and `requestJoinOtpAction` return `devOtp: null` and `magicLink: null` when running in production mode.
- **Staff Invite Token Protection (`features/staff/actions.ts`):** In `inviteStaff`, suppressed returning `rawToken` and `inviteLink` in the client action response when `NODE_ENV === "production"`, and suppressed `logDevAuthEvent` calls. Exported `inviteStaffMemberAction`.
- **Security Verification (`tests/security/dev-logger-lockout.spec.ts`):** 6 automated security tests verifying zero console/file output, null credentials, and token suppression under simulated production builds.

### 2. Task 2: Health Probes, Storage Provider Check & Middleware Optimisation
- **Middleware Latency Bypass (`middleware.ts`):** Added early return `NextResponse.next()` for all paths starting with `/api/v1`, `/api/health`, or `/api/ready`, bypassing `supabase.auth.getUser()` cookie refresh round-trips for high-throughput API traffic and monitoring pings.
- **Liveness Probe (`app/api/health/route.ts`):** Rapid unauthenticated probe returning HTTP 200 `{ status: 'ok', timestamp, uptime }` with `Cache-Control: no-store` for Kubernetes/container liveness checks.
- **Readiness Probe (`app/api/ready/route.ts`):** Operational probe verifying:
  1. Supabase Postgres database connectivity via `tenants` count check.
  2. Active storage backend reachability: Supabase `clinic-records` bucket check or Cloudflare R2 credential/endpoint connectivity based on `getStorageProvider()`.
  3. Webhook outbox infrastructure health via `webhook_delivery_queue` table check.
  4. Error Sanitization: Disrupted checks return generic HTTP 503 `{ status: 'not_ready', checks: { database: 'error', ... }, correlationId }` and log diagnostics server-side without leaking raw internal exception strings (AGENTS.md §34).
- **Automated Probe Verification (`tests/api/health-probes.spec.ts`):** 8 automated tests validating 200 OK responses, R2 awareness, and sanitized 503 responses.

### 3. Task 3: Performance Benchmarks, Backup/Restore & OpenAPI 3.0 Documentation
- **Performance Benchmarks (`tests/api/v1-performance.spec.ts`):** Automated benchmarks validating Roadmap Success Criterion 3 (<1-2s core clinical actions):
  - Action 1 (Open patient record): ~300ms (SLA: <2000ms)
  - Action 2 (Create appointment): ~670ms with conflict check and outbox enqueue (SLA: <2000ms)
  - Action 3 (Save prescription): ~150ms transactional insert of header and items (SLA: <2000ms)
  - Database Indexes: Verified `000018` composite indexes execute tenant queries in <80ms.
  - Composite Throughput: 5-iteration average latency <500ms.
- **Backup & Restore Operational Guide (`docs/ops/backup-restore.md`):** Comprehensive runbook documenting:
  - Daily physical backups and PostgreSQL continuous WAL streaming for 7-day point-in-time recovery (PITR).
  - Disaster recovery SLAs: RTO < 2 hours, RPO < 15 minutes.
  - Logical backup procedures (`pg_dump`) for schema, full data, and isolated tenant export/offboarding under DPDP Act 2023.
  - Object storage replication (`clinic-records`) and emergency escalation matrix.
- **Backup Restoration Integrity Test (`tests/ops/backup-restore.spec.ts`):** 3 automated tests verifying documentation SLA compliance, table RLS integrity, and snapshot restoration fidelity.
- **Programmatic OpenAPI 3.0 Spec (`lib/api/openapi-spec.ts`):** Fully typed OpenAPI 3.0.3 specification covering all `/api/v1/*` endpoints (patients, appointments, visits, prescriptions, lab-orders, referrals, and DPDP export) with BearerAuth security schemes, response envelopes, and rate limit headers.
- **Public Endpoints (`app/api/v1/openapi.json/route.ts`, `app/api/v1/docs/route.ts`):** JSON specification endpoint cached for 1 hour, paired with a standalone HTML viewer embedding official pinned Scalar script `@1.25.101` in light mode with zero new npm dependencies.

## Verification & Test Coverage

All test suites pass 100%:
- `tests/security/dev-logger-lockout.spec.ts` (6 tests)
- `tests/api/health-probes.spec.ts` (8 tests)
- `tests/api/v1-performance.spec.ts` (5 tests)
- `tests/ops/backup-restore.spec.ts` (3 tests)
- `tests/api/openapi.spec.ts` (3 tests)
- Full project test suite: 69 test files, 649/649 tests passing.
- TypeScript compilation: `npm run typecheck` passes with 0 errors.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Type Bug] FormData type narrowing in inviteStaff**
- **Found during:** Task 1 typecheck
- **Issue:** `input.email` threw TS2339 when `isFormData` boolean was stored separately from ternary expression.
- **Fix:** Used direct `input instanceof FormData ? input.get("email") : input.email` for TypeScript type narrowing.
- **Files modified:** `features/staff/actions.ts`
- **Commit:** `039bb54`

**2. [Rule 1 - Schema Bug] Patient gender vs sex column in backup-restore test**
- **Found during:** Task 3 test execution
- **Issue:** Test attempted inserting `gender: "male"` into `patients` table, which rejected with `Could not find the 'gender' column in schema cache`.
- **Fix:** Aligned with `000003` schema which defines `sex TEXT CHECK (sex IN ('male', 'female', 'other'))`.
- **Files modified:** `tests/ops/backup-restore.spec.ts`
- **Commit:** `e33e0a4`

**3. [Rule 1 - Return Shape Bug] createAppointment return envelope in performance benchmark**
- **Found during:** Task 3 test execution
- **Issue:** `createAppointment` returns `{ success: true, appointment: visit }`, but test asserted `appointment.origin_type` directly on returned object.
- **Fix:** Updated test to assert `res.appointment.origin_type === "scheduled"`.
- **Files modified:** `tests/api/v1-performance.spec.ts`
- **Commit:** `e33e0a4`

## Self-Check: PASSED

1. Created and modified files exist on disk:
   - `lib/auth/dev-logger.ts`: FOUND
   - `features/auth/dev-actions.ts`: FOUND
   - `features/staff/actions.ts`: FOUND
   - `middleware.ts`: FOUND
   - `app/api/health/route.ts`: FOUND
   - `app/api/ready/route.ts`: FOUND
   - `docs/ops/backup-restore.md`: FOUND
   - `tests/ops/backup-restore.spec.ts`: FOUND
   - `tests/api/v1-performance.spec.ts`: FOUND
   - `lib/api/openapi-spec.ts`: FOUND
   - `app/api/v1/openapi.json/route.ts`: FOUND
   - `app/api/v1/docs/route.ts`: FOUND
   - `tests/security/dev-logger-lockout.spec.ts`: FOUND
   - `tests/api/health-probes.spec.ts`: FOUND
   - `tests/api/openapi.spec.ts`: FOUND
2. Commits exist in git history:
   - `039bb54`: FOUND (Task 1)
   - `a908b61`: FOUND (Task 2)
   - `e33e0a4`: FOUND (Task 3)
