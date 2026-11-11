---
phase: 03-consultation-prescribing
plan: 01
subsystem: database
tags: [supabase, rls, cdci, postgres, terminology, vitest, prescribing, search]

requires:
  - phase: 02-patient-records-scheduling
    provides: Unified visits model, queue tokens, patient demographic fields, and test helpers
provides:
  - Migration 000007 for consultation SOAP columns, specialty data, prescriptions, CDCI drug master, and OPD diagnoses
  - Typed database interfaces for consultation entities and CDCI search
  - High-performance CDCI streaming ingestion pipeline and 200 OPD drugs test fixture
  - Curated Indian OPD diagnosis master with 1,550 conditions mapped to ICD-11 & SNOMED CT
  - Vitest integration test suite proving sub-100ms fuzzy drug search and cross-tenant RLS isolation
affects: [03-consultation-prescribing, doctor-workspace, prescription-builder]

actuals:
  tasks: 4
  commits: 4

tech-stack:
  added: [pg_trgm, tsvector]
  patterns: [cdci-drug-search-rpc, doctor-custom-favorites-boost, streaming-tsv-seeding]

key-files:
  created:
    - supabase/migrations/000007_consultation_prescriptions_cdci.sql
    - scripts/seed-cdci.ts
    - scripts/seed-cdci-test-fixture.ts
    - scripts/seed-opd-diagnoses.ts
    - supabase/seed-data/terminology/diagnoses.json
    - tests/integration/cdci-search.spec.ts
  modified:
    - lib/db/types.ts
    - package.json
    - tests/helpers/tenants.ts

key-decisions:
  - "D-06: Dual-Layer Medication Search — Doctor custom favorites and high-frequency medications are unioned and sorted ahead of standard CDCI catalog records."
  - "D-07: Sub-100ms Search Performance via GIN Trigram & TSVector — Brand and generic names indexed with pg_trgm (similarity > 0.2) and tsvector simple configuration."
  - "D-08: Curated Indian Terminology Master — 1,550 outpatient diagnoses with ICD-11 and SNOMED CT codes seeded centrally with public read-only RLS."

patterns-established:
  - "Prescription versioning: visit_revisions captures immutable snapshot upon completion and amendment."
  - "Doctor custom medicines and diagnoses are strictly tenant-isolated under RLS."

requirements-completed: [REQ-prescribing, REQ-multi-tenancy, REQ-nfr-performance, REQ-nfr-security]

coverage:
  - id: P3-01
    description: "Database migration 000007 with consultation, prescriptions, CDCI tables, and search_medicines RPC"
    requirement: "REQ-prescribing"
    verification:
      - kind: integration
        ref: "tests/integration/cdci-search.spec.ts#1. Custom medicine appears first with is_custom=true and is_favorite=true"
        status: pass
  - id: P3-02
    description: "Sub-100ms fuzzy brand and generic search latency benchmark"
    requirement: "REQ-nfr-performance"
    verification:
      - kind: integration
        ref: "tests/integration/cdci-search.spec.ts#4. Drug search latency benchmark executes under 100ms on database tier"
        status: pass
  - id: P3-03
    description: "Multi-tenant RLS isolation on doctor custom medications"
    requirement: "REQ-multi-tenancy"
    verification:
      - kind: integration
        ref: "tests/integration/cdci-search.spec.ts#5. Tenant B doctor searching does NOT see Tenant A's custom medicines"
        status: pass
---

# Plan 03-01: Data Layer, CDCI Drug Master & Terminology Foundations Summary

## Execution Overview
- **Phase**: 03-consultation-prescribing
- **Plan**: 01
- **Status**: Completed successfully
- **Commits**:
  - `37f039c`: `feat(03-01): migration 000007 and consultation database types`
  - `f227ead`: `feat(03-01): cdci streaming ingestion pipeline and test fixture`
  - `5535f42`: `feat(03-01): curated indian opd diagnosis master and seeder`
  - `1e43cc6`: `fix(03-01): drop legacy prescriptions table in migration 000007`
  - `2d67adf`: `test(03-01): integration tests for cdci drug search and tenant isolation`

## What Was Delivered
1. **Database Schema & RLS Policies (`000007_consultation_prescriptions_cdci.sql`)**:
   - Extended `visits` table with clinical SOAP fields (`vitals`, `chief_complaints`, `clinical_notes`, `specialty`, `specialty_data`, `investigations_advised`, `advice`, `current_revision`, `signed_at`, `signed_by`).
   - Extended `tenants` and `memberships` with clinic letterhead branding (`logo_url`, `phone`, `email`, margins) and doctor profile data (`qualifications`, `medical_council_reg_no`, `signature_url`).
   - Created 8 tenant-scoped tables with full RLS: `consultation_diagnoses`, `prescriptions`, `prescription_items`, `doctor_custom_medicines`, `doctor_custom_diagnoses`, `doctor_prescription_templates`, `visit_revisions`, and `follow_ups`.
   - Created 9 central terminology & drug master tables: `cdci_substances`, `cdci_drug_forms`, `cdci_routes`, `cdci_suppliers`, `cdci_products`, `cdci_generics`, `cdci_brands`, `cdci_medicines_search`, and `opd_diagnoses`.
   - Created `search_medicines(p_query, p_doctor_id, p_tenant_id, p_limit)` PL/pgSQL RPC combining doctor custom favorites and CDCI catalog with trigram fuzzy matching.

2. **TypeScript Database Types (`lib/db/types.ts`)**:
   - Complete interfaces for `ConsultationDiagnosis`, `Prescription`, `PrescriptionItem`, `DoctorCustomMedicine`, `DoctorCustomDiagnosis`, `DoctorPrescriptionTemplate`, `VisitRevision`, `FollowUp`, `OpdDiagnosis`, `CdciMedicineSearch`, and `search_medicines` RPC definitions.

3. **CDCI Streaming Ingestion & Test Fixture**:
   - `scripts/seed-cdci.ts`: Streaming parser for 7 CDCI TSV files with batch upserts of 1,000 rows.
   - `scripts/seed-cdci-test-fixture.ts`: Instant seeder for ~200 essential Indian OPD formulations.
   - `scripts/seed-opd-diagnoses.ts`: Idempotent bulk seeder for 1,550 curated Indian outpatient conditions.

4. **Integration Testing & Benchmarks**:
   - `tests/integration/cdci-search.spec.ts`: 6/6 tests passing against live Supabase project.
   - Sub-100ms latency verified (roundtrip: ~67-82ms).
   - Strict tenant isolation verified: Doctor B cannot view or modify Doctor A custom medicines under RLS.

## Self-Check: PASSED
