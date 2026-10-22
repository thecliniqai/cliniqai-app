---
phase: "04"
plan: "01"
subsystem: storage
tags:
  - storage
  - s3
  - r2
  - supabase-storage
  - migrations
  - rls
requires:
  - phase: "01"
    plan: "01"
  - phase: "03"
    plan: "02"
provides:
  - "Unified Storage Provider abstraction in lib/storage/ supporting Supabase Storage and Cloudflare R2"
  - "Storage bucket clinic-records with multi-tenant RLS"
  - "Database schema and TypeScript types for patient_documents, document_share_tokens, and referrals"
  - "Storage abstraction integration for prescriptions and billing PDF generators"
  - "Wave 0 test stubs across tests/storage/, tests/labs/, and tests/referrals/"
affects:
  - features/prescriptions
  - features/billing
  - features/labs
  - features/referrals
tech-stack:
  added:
    - "@aws-sdk/client-s3"
    - "@aws-sdk/s3-request-presigner"
  patterns:
    - "Storage provider strategy pattern with automatic environment-driven fallback"
    - "Deterministic tenant relative storage keys (tenants/[tenant_id]/...)"
    - "Path traversal sanitization and validation guard"
key-files:
  created:
    - supabase/migrations/000013_labs_and_referrals.sql
    - lib/storage/types.ts
    - lib/storage/supabase-provider.ts
    - lib/storage/r2-provider.ts
    - lib/storage/index.ts
    - tests/storage/storage-provider.spec.ts
    - tests/labs/lab-documents.spec.ts
    - tests/labs/tokenized-sharing.spec.ts
    - tests/referrals/referrals-flow.spec.ts
  modified:
    - package.json
    - lib/db/types.ts
    - features/prescriptions/pdf/generator.ts
    - features/billing/pdf/generator.ts
decisions:
  - "Unified Storage Provider abstraction in lib/storage/ with SupabaseStorageProvider default and R2StorageProvider S3-compatible provider"
  - "Relative storage keys only in database records (tenants/[tenant_id]/...) to preserve provider portability"
  - "Backward-compatibility with legacy tenant paths ([tenant_id]/...) in storage path validator"
metrics:
  duration: 10m
  completed_date: "2026-10-22"
status: complete
commits: 4
plan_head_before: "0a07cf279b9ba4bfb7fc4ca0c26da5cf4ff22ef4"
plan_head_after: "db52c3f15c7e0fe7876a147e45ce28ff552cae9a"
---

# Phase 04 Plan 01: Storage Foundation, Database Migrations, & Unified Storage Provider Summary

Unified storage provider abstraction with Cloudflare R2 / Supabase Storage parity, database migration 000013 for clinic-records, patient_documents, document_share_tokens, and referrals, Wave 0 test suites, and prescription/billing storage refactoring.

## What Was Built

1. **Wave 0 Test Harness & Stubs:**
   - Established unit test suite in `tests/storage/storage-provider.spec.ts` (13 unit tests verifying factory switching, path validation, traversal blocking, and delegation).
   - Created test stubs in `tests/labs/lab-documents.spec.ts`, `tests/labs/tokenized-sharing.spec.ts`, and `tests/referrals/referrals-flow.spec.ts`.

2. **Database Migration 000013 & Database Types:**
   - `supabase/migrations/000013_labs_and_referrals.sql` establishing private storage bucket `clinic-records` (25MB limit, PDF/JPEG/PNG/WEBP) with tenant RLS.
   - Created tables `patient_documents`, `document_share_tokens`, and `referrals` with complete indexes and Row Level Security policies.
   - Updated `lib/db/types.ts` with TypeScript types: `PatientDocument`, `DocumentShareToken`, `Referral`, `ReferralType`, `ReferralUrgency`, and `ReferralStatus`.

3. **Unified Storage Provider Abstraction (`lib/storage/`):**
   - Implemented `StorageProvider` interface in `lib/storage/types.ts`.
   - Built `SupabaseStorageProvider` supporting cookie and service-role client environments with `clinic-records` default bucket.
   - Built `R2StorageProvider` utilizing `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` for zero-egress Cloudflare R2 object storage.
   - Exported high-level helpers: `uploadFile`, `getSignedUrl`, `deleteFile`, `downloadFile`, `sanitizeStoragePath`, and `validateStoragePath`.

4. **Prescription & Billing Storage Refactoring:**
   - Updated `features/prescriptions/pdf/generator.ts` and `features/billing/pdf/generator.ts` to route all PDF uploads and signed URL generations through `uploadFile` and `getSignedUrl`.
   - Verified zero regressions across prescription versioning and billing receipt integration test suites.

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

- Unit tests: `npx vitest run tests/storage/` passed (13/13 tests green).
- Typecheck: `npm run typecheck` passed (0 TypeScript errors).
- Integration tests: `npx vitest run tests/integration/prescription-versioning.spec.ts tests/integration/receipt-reports.spec.ts` passed (10/10 tests green).

## Self-Check: PASSED
- `supabase/migrations/000013_labs_and_referrals.sql` exists on disk.
- `lib/storage/index.ts` exists on disk.
- All 4 task commits (`f8f3f33`, `f74c8dc`, `32e44b6`, `db52c3f`) verified in git log.
