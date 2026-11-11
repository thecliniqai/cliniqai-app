---
phase: 06-api-launch-readiness
plan: "04"
subsystem: compliance
tags:
  - dpdp
  - nmc
  - privacy
  - export
  - erasure
  - consent
  - statutory
  - pdf
status: complete
requires:
  - "06-01"
  - "06-02"
  - "06-03"
provides:
  - dpdp-right-to-access
  - dpdp-right-to-erasure
  - patient-global-consent
  - statutory-clinic-registrations
affects:
  - patients
  - prescriptions
  - settings
  - audit
tech-stack:
  added: []
  patterns:
    - dpdp-dual-format-export
    - statutory-soft-delete-erasure
    - append-only-consent-sync
    - react-pdf-medical-summary
key-files:
  created:
    - features/dpdp/export.ts
    - features/dpdp/pdf/medical-summary-doc.tsx
    - features/dpdp/pdf/generator.ts
    - app/api/v1/patients/[id]/export/route.ts
    - components/patients/dpdp-export-actions.tsx
    - features/dpdp/erasure.ts
    - components/settings/statutory-fields-card.tsx
    - tests/compliance/dpdp-rights.spec.ts
  modified:
    - app/(dashboard)/patients/[id]/consent-section.tsx
    - app/(dashboard)/patients/page.tsx
    - app/api/v1/patients/[id]/route.ts
    - components/patients/patient-detail-view.tsx
    - components/settings/clinic-profile-form.tsx
    - features/patients/actions.ts
    - features/patients/consent.ts
    - features/prescriptions/pdf/generator.ts
    - features/prescriptions/pdf/prescription-document.tsx
    - features/settings/actions.ts
    - features/settings/schema.ts
decisions:
  - "DPDP §12(3) Right to Erasure implemented as statutory soft-deletion (status = 'erased', is_deleted = true, erased_at) preserving clinical history (visits, prescriptions, invoices) to reconcile with NMC Regulation 1.3.1 mandatory 3-year medical record retention"
  - "DPDP Right to Access exports both a machine-readable JSON archive containing complete patient clinical and billing data, and a branded, multi-page Medical Summary PDF compiled with @react-pdf/renderer without writing to local disk"
  - "Single global consent toggle synchronizes global, treatment, and data_sharing consent records simultaneously with append-only immutable audit trail satisfying DPDP Act 2023 purpose limitation"
  - "Statutory healthcare establishment registrations (Clinical Establishment Act, State Medical Council, GSTIN, and Drug License) persisted in public.tenants and dynamically rendered on prescription letterheads"
metrics:
  duration: 45m
  completed_date: "2026-11-09"
actuals:
  tokens: 28500
  tasks: 3
  commits: 3
  plan_head_before: "23aee7e0f2880fd2b7219618995b475af8de3f19"
  plan_head_after: "e4becf4911c3fc5b60053e919f3799f67b340b03"
---

# Phase 06 Plan 04: DPDP Patient Rights & Statutory Registration Workflows Summary

Comprehensive implementation of India's Digital Personal Data Protection (DPDP) Act 2023 patient privacy rights (Right to Access dual-format data export including billing records, and Right to Erasure statutory soft-deletion with application-wide search suppression), single global consent toggle with purpose synchronization, and statutory clinic establishment registration persistence dynamically rendered on prescription letterheads.

## Key Changes Implemented

### 1. Task 1: DPDP Right to Access Dual-Format Data Export
- **Export Engine (`features/dpdp/export.ts`):** Implemented `exportPatientDpdpArchive(patientId, tenantId)` querying demographics, encounters, prescriptions, vitals, patient documents, invoices, payments, and consent records strictly tenant-isolated and compliant with DPDP Act 2023 §11 / §12.
- **Medical Summary PDF (`features/dpdp/pdf/medical-summary-doc.tsx`, `features/dpdp/pdf/generator.ts`):** Created a branded `@react-pdf/renderer` multi-page document adhering to `DESIGN.md` guidelines (TailAdmin typography, `#1769E0` accent header, medical history, vitals, prescriptions, and legal disclaimer) compiled directly into an in-memory buffer without local disk writes.
- **Dual-Authentication Route Handler (`app/api/v1/patients/[id]/export/route.ts`):** Created GET endpoint accepting `format=json` or `format=pdf` authenticated via API keys (`x-api-key` / `Bearer cliq_live_...`) with `patients:read` scope or authenticated dashboard cookie sessions.
- **Patient Detail Actions (`components/patients/dpdp-export-actions.tsx`, `components/patients/patient-detail-view.tsx`):** Mounted download buttons with loading spinners for direct patient archive and medical summary PDF downloads.

### 2. Task 2: DPDP Right to Erasure Statutory Soft-Deletion & Search Suppression
- **Statutory Soft-Delete Engine (`features/dpdp/erasure.ts`):** Implemented `erasePatientRecord(patientId, tenantId, reason, actor)` executing `status = 'erased'`, `is_deleted = true`, and setting `erased_at` timestamp.
- **NMC Regulation 1.3.1 Reconciliation:** Under DPDP §12(3), data retention is permissible when mandated by law. National Medical Commission regulations mandate 3-year medical record retention for defense against medical negligence/malpractice. Underlying clinical encounters (`visits`, `prescriptions`, `invoices`, `payments`) are strictly preserved with NO hard deletion.
- **Application-wide Search Suppression (`features/patients/actions.ts`, `app/(dashboard)/patients/page.tsx`):** Updated `getPatient`, `searchPatients`, and `getPatients` to enforce `is_deleted = false`, ensuring erased patients are hidden from active queries, autocomplete, and patient listings.
- **REST API Deletion (`app/api/v1/patients/[id]/route.ts`):** Added `DELETE` handler delegating to `erasePatientRecord` with `patients:write` API key scope or staff cookie session.

### 3. Task 3: Single Global Consent Toggle & Statutory Registrations
- **Single Global Consent Toggle (`features/patients/consent.ts`, `app/(dashboard)/patients/[id]/consent-section.tsx`):** Implemented `toggleGlobalConsent(patientId, targetStatus, note)` synchronizing `global`, `treatment`, and `data_sharing` consent records in an append-only table, satisfying DPDP purpose limitation and recording immutable audit entries. Replaced multi-toggle UI with a prominent card displaying current status (`Active Consent` vs `Withdrawn Consent`) and clear confirmation modals.
- **Statutory Clinic Registrations (`features/settings/schema.ts`, `features/settings/actions.ts`, `components/settings/statutory-fields-card.tsx`):** Added schema validation (including 15-character Indian GSTIN regex), server action `updateStatutorySettings`, and a dedicated UI card for:
  - Clinical Establishment Act Reg. No.
  - State Medical Council Reg. No.
  - GSTIN (15-character uppercase alphanumeric)
  - Drug License Number (Form 20/20B)
- **Prescription Header Enrichment (`features/prescriptions/pdf/generator.ts`, `features/prescriptions/pdf/prescription-document.tsx`):** Enriched prescription generation to automatically query clinic statutory numbers from `public.tenants` and render a dedicated regulatory line under the clinic header.

## Verification & Test Coverage

All 15 comprehensive compliance tests in `tests/compliance/dpdp-rights.spec.ts` passed:
- `exportPatientDpdpArchive` compiles demographics, visits, prescriptions, documents, billing, and consent
- `generateDpdpMedicalSummaryPdf` compiles a valid PDF binary buffer
- `GET /api/v1/patients/[id]/export?format=json` returns application/json archive
- `GET /api/v1/patients/[id]/export?format=pdf` returns application/pdf binary
- `GET /api/v1/patients/[id]/export` enforces tenant isolation (404 for cross-tenant access)
- `GET /api/v1/patients/[id]/export` returns 401 when unauthorized
- `erasePatientRecord` marks `is_deleted = true`, `status = 'erased'`, and populates `erased_at`
- Underlying clinical records (`visits`, `prescriptions`, `invoices`) are preserved (NO HARD DELETE)
- `searchPatients`, `getPatient`, and `getPatients` suppress erased patients from active queries
- Audit log records compliance entry with retention policy `NMC_REGULATION_1.3.1_3_YEAR_MANDATE`
- `DELETE /api/v1/patients/[id]` delegates to `erasePatientRecord` and returns success envelope
- `toggleGlobalConsent` records `global`, `treatment`, and `data_sharing` consent entries
- `updateStatutorySettings` persists registration numbers and audits changes
- `updateStatutorySettings` validates GSTIN format and rejects invalid GSTIN
- `generateAndArchivePrescriptionPdf` enriches statutory registration fields in payload and PDF

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Type Bug] Missing Field htmlFor & hint vs help prop in Statutory Fields Card**
- **Found during:** Task 3 verification (`npm run typecheck`)
- **Issue:** `Field` component required `htmlFor: string` and used `help` / `helpText` props instead of `hint`.
- **Fix:** Provided explicit `id`s (`cea-reg-no`, `smc-reg-no`, `clinic-gstin`, `drug-license-no`) and passed `help` and `htmlFor` props.
- **Files modified:** `components/settings/statutory-fields-card.tsx`
- **Commit:** `e4becf4`

**2. [Rule 1 - Type Bug] Zod optionalGstin transformation dropping undefined**
- **Found during:** Task 3 verification (`npm run typecheck`)
- **Issue:** `.transform((val) => val ? val.toUpperCase() : null)` caused `optionalGstin` to inferred as `string | null` instead of `string | null | undefined`, making `gstin` mandatory on `clinicSettingsSchema` inputs.
- **Fix:** Preserved `undefined` in `optionalGstin` transformation when input is `undefined`.
- **Files modified:** `features/settings/schema.ts`
- **Commit:** `e4becf4`

**3. [Rule 1 - Test Scope Bug] Supabase client cookies() call outside request context in Vitest**
- **Found during:** Task 3 test execution
- **Issue:** `updateStatutorySettings` and `generateAndArchivePrescriptionPdf` called `createClient()` when `sessionOverride` was supplied without `clientOverride`, triggering `cookies()` outside request context.
- **Fix:** Resolved client as `clientOverride || (sessionOverride ? getAdminClient() : await createClient())` and passed `supabase as any` to `recordAudit`.
- **Files modified:** `features/settings/actions.ts`, `features/prescriptions/pdf/generator.ts`
- **Commit:** `e4becf4`

## Self-Check: PASSED

1. Created files exist:
   - `features/dpdp/export.ts`: FOUND
   - `features/dpdp/pdf/medical-summary-doc.tsx`: FOUND
   - `features/dpdp/pdf/generator.ts`: FOUND
   - `app/api/v1/patients/[id]/export/route.ts`: FOUND
   - `components/patients/dpdp-export-actions.tsx`: FOUND
   - `features/dpdp/erasure.ts`: FOUND
   - `components/settings/statutory-fields-card.tsx`: FOUND
   - `tests/compliance/dpdp-rights.spec.ts`: FOUND
2. Commits exist in git history:
   - `81881eb`: FOUND (Task 1)
   - `ad8e792`: FOUND (Task 2)
   - `e4becf4`: FOUND (Task 3)
