---
phase: 06-api-launch-readiness
plan: "02"
subsystem: api
tags: [rest-api, clinical-api, doctor-guard, visits, prescriptions, labs, referrals]

requires:
  - phase: 06-api-launch-readiness
    plan: "01"
    provides: API key Bearer authentication, rate limiter, uniform envelopes, and audit framework
provides:
  - Clinical Doctor Guard (lib/api/doctor-guard.ts) validating doctor role against tenant memberships
  - Grounded Visits REST API (/api/v1/visits, /api/v1/visits/[id]) with encounter completion safety
  - Prescriptions REST API (/api/v1/prescriptions, /api/v1/prescriptions/[id]) with nested items and versioning
  - Lab Orders REST API (/api/v1/lab-orders, /api/v1/lab-orders/[id]) grounded in patient_documents
  - Referrals REST API (/api/v1/referrals, /api/v1/referrals/[id]) with in-network patient consent validation
  - Full automated integration test suite in tests/api/v1-doctor-guard.spec.ts (27 tests)
affects:
  - 06-03-PLAN.md (Webhooks event triggers for visit.completed and prescription.issued)
  - 06-04-PLAN.md (DPDP export accessing visits, prescriptions, labs)
  - 06-05-PLAN.md (OpenAPI specification documentation for clinical resources)

actuals:
  tokens: 21114
  tasks: 3
  commits: 3
  plan_head_before: 99fc70ab20939501dca807fa93b140307ba3a4ad
  plan_head_after: 618c1191b7120aeb073f8103df7f783bf1f40703

tech-stack:
  added: []
  patterns:
    - Server-side Doctor Guard checking public.memberships role IN ('doctor', 'owner')
    - Grounded schema persistence across visits, prescriptions, patient_documents, and referrals
    - Versioned prescription headers per visit_id resolving uq_prescriptions_visit_version
    - Encounter completion safety requiring notes or diagnosis before transitioning to completed
    - In-network referral consent validation enforcing DPDP purpose limitation

key-files:
  created:
    - lib/api/doctor-guard.ts
    - app/api/v1/visits/route.ts
    - app/api/v1/visits/[id]/route.ts
    - app/api/v1/prescriptions/route.ts
    - app/api/v1/prescriptions/[id]/route.ts
    - app/api/v1/lab-orders/route.ts
    - app/api/v1/lab-orders/[id]/route.ts
    - app/api/v1/referrals/route.ts
    - app/api/v1/referrals/[id]/route.ts
    - tests/api/v1-doctor-guard.spec.ts
  modified: []

key-decisions:
  - "D-05: Enforced explicit doctor_id on visits, prescriptions, and referrals validated via validateDoctorAssignment to require doctor or owner role in active tenant"
  - "Grounded Visits Schema: Mapped encounters to public.visits (origin_type, reason_for_visit, JSONB chief_complaints, clinical_notes) and created_by = session.userId"
  - "Clinical Completion Safety: PATCH /api/v1/visits/[id] prevents status='completed' without at least one diagnosis or clinical note"
  - "Prescription Versioning: Calculated max(version) + 1 per (tenant_id, visit_id) and persisted timing and special_instructions without tenant_id on items"
  - "Lab Orders & Referrals Grounding: Mapped lab orders to public.patient_documents (document_type='lab_report') and referrals to public.referrals with in-network consent checking"

patterns-established:
  - "Doctor Guard: validateDoctorAssignment queries public.memberships with tenant scoping and rejects non-clinical roles with 403 FORBIDDEN_CLINICIAN"
  - "Clinical Safety Gate: Transition to 'completed' requires clinical note or consultation_diagnoses row"
  - "Consent Boundary: in_network referrals verify patient_consents_history_sharing = true before persisting record"

requirements-completed:
  - REQ-api-access
  - REQ-nfr-regulatory-compliance

duration: 18min
completed: 2026-11-09
status: complete
---

# Phase 06 Plan 02: Clinical Resources REST API & Doctor Guard Summary

**Server-side Doctor Guard role enforcement (D-05), encounter completion safety guards, and grounded CRUD REST API endpoints for Visits, Prescriptions, Lab Orders, and Referrals.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-11-09T15:38:00Z
- **Completed:** 2026-11-09T15:56:00Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments

- Implemented `lib/api/doctor-guard.ts` providing `validateDoctorAssignment(tenantId, doctorId)` verifying clinician membership in the active clinic with role `doctor` or `owner` (rejecting non-clinical roles with HTTP 403 `FORBIDDEN_CLINICIAN`).
- Implemented `/api/v1/visits` and `/api/v1/visits/[id]` grounded directly in `public.visits` with `origin_type`, `reason_for_visit`, JSONB `chief_complaints`, `clinical_notes`, and `created_by: session.userId`.
- Added clinical completion safety check in `PATCH /api/v1/visits/[id]` ensuring encounters cannot be transitioned to `completed` without recording at least one clinical note or diagnosis.
- Implemented `/api/v1/prescriptions` and `/api/v1/prescriptions/[id]` creating prescription headers and nested `public.prescription_items` with `timing`, `special_instructions`, and automatic version incrementing per `(tenant_id, visit_id)`.
- Implemented `/api/v1/lab-orders` and `/api/v1/lab-orders/[id]` mapping to `public.patient_documents` where `document_type = 'lab_report'` with file metadata and `uploaded_by: session.userId`.
- Implemented `/api/v1/referrals` and `/api/v1/referrals/[id]` grounded in `public.referrals` with Doctor Guard validation on `referring_doctor_id` and strict validation requiring `patient_consents_history_sharing === true` for `in_network` referrals.
- Created test suite `tests/api/v1-doctor-guard.spec.ts` containing 27 integration tests covering Doctor Guard validation, visits, prescriptions, lab orders, and referrals with 100% pass rate.

## Task Commits

Each task was committed atomically:

1. **Task 1: Clinical Doctor Guard & Visits REST API Endpoints with Grounded Schema & Clinical Safety** - `c8bfc6e` (feat)
2. **Task 2: Prescriptions REST API Endpoints with Grounded Items Schema & Versioning** - `476a51f` (feat)
3. **Task 3: Lab Orders & Referrals REST API Endpoints Grounded in Existing Tables** - `618c119` (feat)

## Files Created/Modified

- `lib/api/doctor-guard.ts`: Clinician validation middleware verifying tenant membership and doctor/owner role.
- `app/api/v1/visits/route.ts`: Collection endpoint for listing and creating clinical encounters with Doctor Guard.
- `app/api/v1/visits/[id]/route.ts`: Detail endpoint with encounter completion clinical safety guard.
- `app/api/v1/prescriptions/route.ts`: Collection endpoint creating header and nested prescription items with versioning.
- `app/api/v1/prescriptions/[id]/route.ts`: Detail endpoint joining prescription items.
- `app/api/v1/lab-orders/route.ts`: Collection endpoint for lab report documents mapped to patient_documents.
- `app/api/v1/lab-orders/[id]/route.ts`: Detail endpoint for lab documents.
- `app/api/v1/referrals/route.ts`: Collection endpoint creating referrals with consent validation and Doctor Guard.
- `app/api/v1/referrals/[id]/route.ts`: Detail endpoint updating referral lifecycle (acknowledged, completed).
- `tests/api/v1-doctor-guard.spec.ts`: 27 integration tests covering all clinical resources and security boundaries.

## Decisions Made

- Grounded `/api/v1/visits` in `public.visits` with `created_by: session.userId` to satisfy foreign key constraints to `auth.users(id)`.
- Prevented completion of empty encounters via HTTP 422 `CLINICAL_SAFETY_VIOLATION` if neither clinical notes nor diagnoses exist.
- Used `timing` and `special_instructions` columns on `public.prescription_items` and omitted `tenant_id` from item inserts (as the table has no `tenant_id` column).
- Enforced `patient_consents_history_sharing` for all `in_network` referrals to satisfy DPDP purpose limitation obligations.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. All 27 integration tests in `tests/api/v1-doctor-guard.spec.ts` and 17 tests in `tests/api/v1-crud.spec.ts` passed cleanly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Clinical REST API layer and Doctor Guard are in place.
- Ready for Plan 06-03: Webhook Event Engine & Delivery Resilience (triggering events on `visit.completed` and `prescription.issued`).

---
*Phase: 06-api-launch-readiness*
*Completed: 2026-11-09*

## Self-Check: PASSED
- [x] All 10 created files exist on disk
- [x] All 3 task commits exist in git history (c8bfc6e, 476a51f, 618c119)
- [x] Typecheck passed with 0 errors
- [x] All 27 automated tests passed in tests/api/v1-doctor-guard.spec.ts and 17 in tests/api/v1-crud.spec.ts (44 total)
