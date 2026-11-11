---
phase: 02-patient-records-scheduling
plan: 01
subsystem: database
tags: [supabase, rls, postgres, visits, queue, waitlist, vitest]

requires:
  - phase: 01-foundation-tenant-isolation
    provides: Tenant isolation foundation, RLS patterns, membership resolution, and test helpers
provides:
  - Migration 000006 for visits, queue_tokens, waitlist_entries, and patients demographic extensions
  - Typed database interfaces for visits, queue tokens, and waitlist
  - Server actions for visit creation, date-scoped fetch, and status updates with audit logging
  - Server actions for atomic queue check-in and consulting room transitions
  - Vitest integration test suite proving sequential daily tokens and cross-tenant RLS isolation
affects: [02-patient-records-scheduling, reception-desk, doctor-calendar]

actuals:
  tokens: 4500
  tasks: 3
  commits: 1

tech-stack:
  added: []
  patterns: [unified visit model with layered queue tokens, daily sequential token generation RPC]

key-files:
  created:
    - supabase/migrations/000006_appointments_queue_waitlist.sql
    - features/visits/actions.ts
    - features/queue/actions.ts
    - tests/integration/visits.spec.ts
  modified:
    - lib/db/types.ts
    - lib/audit/audit.ts

key-decisions:
  - "D-04: Unified Visit Model with Layered Queue Tokens — scheduled visits and walk-ins share the visits table with an origin_type discriminator, while queue_tokens handles daily sequence and arrival state."
  - "Atomic token generation RPC (generate_daily_queue_token) ensures zero race conditions during peak morning check-ins."

patterns-established:
  - "Visits and queue token operations are strictly tenant-isolated under RLS and audited."

requirements-completed: [REQ-patient-records, REQ-appointment-booking, REQ-multi-tenancy, REQ-nfr-security]

coverage:
  - id: D1
    description: "Database migration 000006 with visits, queue_tokens, waitlist_entries, and RLS policies"
    requirement: "REQ-multi-tenancy"
    verification:
      - kind: integration
        ref: "tests/integration/visits.spec.ts#3. Proves Tenant B cannot read Tenant A visits or queue tokens under Row Level Security"
        status: pass
  - id: D2
    description: "Atomic daily sequential queue token issuance RPC"
    requirement: "REQ-appointment-booking"
    verification:
      - kind: integration
        ref: "tests/integration/visits.spec.ts#1. Tenant A owner can create a visit and check in patient, receiving sequential token #1"
        status: pass
  - id: D3
    description: "Patient table demographic extension (age, allergies, chronic conditions, emergency contact)"
    requirement: "REQ-patient-records"
    verification:
      - kind: integration
        ref: "tests/integration/visits.spec.ts"
        status: pass
---

# Plan 02-01: Data Layer & Architectural Tracer for Visits and Queue Summary

## Execution Overview
- **Phase**: 02-patient-records-scheduling
- **Plan**: 01
- **Status**: Completed successfully
- **Commit Baseline**: Migration `000006_appointments_queue_waitlist.sql`, updated `lib/db/types.ts`, `features/visits/actions.ts`, `features/queue/actions.ts`, and `tests/integration/visits.spec.ts`.

## What Was Delivered
1. **Database Schema & RLS Policies (`000006_appointments_queue_waitlist.sql`)**:
   - `patients` demographic extensions: `age`, `allergies`, `chronic_conditions`, `emergency_contact`.
   - `visits`: unified table supporting both scheduled appointments (`origin_type = 'scheduled'`) and walk-ins (`origin_type = 'walk_in'`) with full lifecycle statuses (`booked`, `confirmed`, `waiting`, `in_consultation`, `completed`, `cancelled`, `no_show`).
   - `queue_tokens`: daily operational queue layer tracking arrival times, token numbers (`token_number`), and room transition timestamps (`called_at`, `completed_at`) with unique constraint `(tenant_id, date, token_number)`.
   - `waitlist_entries`: preference queue capturing requested slot dates and time windows.
   - `generate_daily_queue_token`: atomic PL/pgSQL RPC returning the next sequential token number per clinic and date.
   - Complete Row Level Security policies for all three tables enforcing tenant boundary isolation.

2. **TypeScript Database Types (`lib/db/types.ts`)**:
   - Strongly typed `Patient`, `Visit`, `QueueToken`, `WaitlistEntry` interfaces and table/function definitions in `Database['public']`.

3. **Visit & Queue Server Actions**:
   - `features/visits/actions.ts`: `createVisit`, `getVisitsForDate`, `updateVisitStatus` with permission validation (`appointments:edit` / `appointments:view`) and structured audit trail (`visit.create`, `visit.status_update`).
   - `features/queue/actions.ts`: `checkInVisit` (RPC token issue + status flip to `waiting`), `transitionQueueState` (`in_consultation`, `completed`).
   - `lib/audit/audit.ts`: extended with visit and queue actions and metadata whitelist.

4. **Automated Verification**:
   - `tests/integration/visits.spec.ts`: 6/6 tests passing against live Supabase project proving token sequence and RLS isolation.
   - Full Vitest suite: 57/57 tests passing across 9 test suites.
   - `npm run lint`: 0 errors, 0 warnings.
   - `npm run typecheck`: clean strict mode.
   - `npm run build`: successful compilation.

## Self-Check: PASSED
