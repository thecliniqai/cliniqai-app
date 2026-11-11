---
phase: "04"
plan: "03"
subsystem: referrals
tags:
  - referrals
  - dpdp
  - consent
  - pdf
  - letterhead
  - loop-closure
  - register
requires:
  - phase: "04"
    plan: "01"
  - phase: "04"
    plan: "02"
provides:
  - "Referrals feature data layer in features/referrals/ with createReferral, getOutboundReferrals, getInboundReferrals, acknowledgeReferral, closeReferralLoop, getReferralSignedUrl, and getPatientReferrals"
  - "DPDP compliant clinical history sharing snapshot assembly with mandatory consent recording in consent_records"
  - "Branded PDF referral letter generator with dual letterhead modes (blank paper vs preprinted letterhead)"
  - "Centralized clinic Referrals Register at /referrals with Outbound and Inbound tabs, search, status filters, and mobile card view"
  - "1-tap Close the Loop modal for recording specialist findings and completing referrals"
  - "Dual referral entry points in Consultation Cabin (/consultation/[id]) and Patient Profile (/patients/[id])"
  - "Visit timeline referral status badge in PatientVisitHistory"
  - "Referrals item added to navigation sidebar"
affects:
  - features/referrals
  - components/referrals
  - components/consultation
  - components/patients
  - components/layout
tech-stack:
  added: []
  patterns:
    - "Multi-tenant RLS isolation for originating and target clinics"
    - "DPDP explicit consent tracking with immutable audit trail"
    - "React-PDF clinical referral letter compilation with 3600s signed URL generation"
key-files:
  created:
    - features/referrals/types.ts
    - features/referrals/schema.ts
    - features/referrals/actions.ts
    - features/referrals/pdf/referral-letter-document.tsx
    - features/referrals/pdf/generator.ts
    - components/referrals/close-loop-modal.tsx
    - components/referrals/create-referral-modal.tsx
    - components/referrals/referrals-register.tsx
    - app/(dashboard)/referrals/page.tsx
  modified:
    - lib/audit/audit.ts
    - components/layout/app-sidebar.tsx
    - components/consultation/consultation-workspace.tsx
    - components/patients/patient-detail-view.tsx
    - components/patients/patient-visit-history.tsx
    - tests/referrals/referrals-flow.spec.ts
decisions:
  - "Mandatory DPDP consent verification and logging in consent_records when packaging in-network clinical history snapshots"
  - "Admin client used for resolving public originating clinic details in inbound register to cross tenant boundary without relaxing RLS"
  - "Branded PDF referral letter generator supporting blank paper (with clinic details) and pre-printed letterhead pads (with top margin gap)"
metrics:
  duration: 30m
  completed_date: "2026-10-22"
status: complete
commits: 3
plan_head_before: "2445190"
plan_head_after: "1eb3ece"
---

# Phase 04 Plan 03: Referrals Lifecycle, Branded PDF Letters & Register Summary

End-to-end clinical referrals lifecycle covering out-of-network specialists and in-network partner clinics, DPDP consent-gated history sharing, branded PDF referral letter generation, centralized clinic Referrals Register at `/referrals`, 1-tap "Close the Loop" modal, and dual entry points in Consultation Cabin and Patient Profile.

## What Was Built

1. **Referrals Feature Data Layer & DPDP Consent:**
   - `features/referrals/types.ts` and `features/referrals/schema.ts` defining strict validation schemas.
   - `features/referrals/actions.ts` implementing `createReferral`, `getOutboundReferrals`, `getInboundReferrals`, `acknowledgeReferral`, `closeReferralLoop`, `getReferralSignedUrl`, and `getPatientReferrals`.
   - DPDP consent enforcement: when referring to in-network clinics with history sharing, generates immutable `consented_history_snapshot` and records `consent_records` audit entry.
   - Multi-tenant RLS isolation strictly tested and enforced.

2. **Branded PDF Referral Letter Generator:**
   - `features/referrals/pdf/referral-letter-document.tsx` using `@react-pdf/renderer` with clinical typography matching `DESIGN.md`.
   - Dual letterhead modes (`blank_paper` with clinic header, `preprinted_letterhead` with pad offset).
   - Generates and archives PDF to `clinic-records` bucket at `tenants/[tenant_id]/referrals/[id]/referral_letter.pdf` with 3600-second signed URL.

3. **Centralized Referrals Register & Close-the-Loop Modal:**
   - Added "Referrals" item with `Share2` icon to `components/layout/app-sidebar.tsx`.
   - Built dashboard page `app/(dashboard)/referrals/page.tsx` and interactive `components/referrals/referrals-register.tsx`.
   - Outbound and Inbound tabs with search, status filters (Sent, Acknowledged, Completed), and urgency badges.
   - Built `components/referrals/close-loop-modal.tsx` allowing clinicians to record specialist return findings and transition status to `completed`.
   - Consented clinical history drawer for viewing transferred encounter summaries.

4. **Dual Entry Points & Patient Timeline Integration:**
   - Reusable `components/referrals/create-referral-modal.tsx` with specialist details, clinical context, and consent checkboxes.
   - Consultation Cabin (`components/consultation/consultation-workspace.tsx`) Referral & Specialist Disposition card under Section 7.
   - Patient Profile (`components/patients/patient-detail-view.tsx`) "Refer Patient" header action.
   - Visit timeline (`components/patients/patient-visit-history.tsx`) referral status badge linking to register.

## Deviations from Plan

None - all tasks executed per plan and UI specifications.

## Verification Results

- Referrals tests: `npx vitest run tests/referrals/` passed (13/13 tests green).
- Labs tests: `npx vitest run tests/labs/` passed (18/18 tests green).
- Storage tests: `npx vitest run tests/storage/` passed (13/13 tests green).
- Typecheck: `npm run typecheck` passed (0 TypeScript errors).

## Self-Check: PASSED
