# Plan 01-04: Compliance Data Layer, Audit Logging & Immutable Consent Summary

## Execution Overview
- **Phase**: 01-foundation-tenant-isolation
- **Plan**: 04
- **Status**: Completed successfully
- **Commit Baseline**: Migrations `000003_patients_audit_consent.sql` & `000004_compliance_columns.sql`, append-only audit trail service, patient directory & registration flow, immutable consent tracking, FHIR R4 mapping specification, and 31 passing unit & integration tests.

## What Was Delivered
1. **Database Foundations (`000003` & `000004`)**:
   - `patients`: demographic records with nullable `abha_id` (NULL from day one), tenant isolation indexes, and RLS policies.
   - `audit_logs`: strictly append-only BigSerial table with RLS permitting member INSERT and Owner/Admin SELECT only. No UPDATE/DELETE policies.
   - `consent_records`: immutable consent history table with no UPDATE/DELETE policies; status grants and withdrawals are appended immutably.
   - `consultations` & `prescriptions`: preview tables with discrete ICD-10 codes/descriptions and structured drug components (dosage, frequency, duration) for Phase 3 readiness.
   - HFR/HPR registration and national health identity columns on `patients`.

2. **Compliance & Audit Infrastructure**:
   - `lib/audit/audit.ts`: server-side `recordAudit` enforcing safe metadata allowlist (`fields_changed`, `reason`, `consent_type`, etc.) and preventing clinical notes or PII leakage into audit logs.
   - `features/clinics/profile.ts`: wired with `recordAudit` for administrative configuration changes (`clinic.profile.update`).
   - `docs/compliance-data-layer.md`: architecture specification detailing demographic, consultation, e-prescription, and consent field mappings to HL7 FHIR R4 resources (`Patient`, `Encounter`, `Condition`, `MedicationRequest`, `Consent`).

3. **Patient & Consent Management UI**:
   - `features/patients/schema.ts`: Zod schema validating patient input; accepts name+phone only; normalizes blank ABHA string to null.
   - `features/patients/actions.ts`: `createPatient`, `updatePatient`, and `getPatient` Server Actions with audit logs recorded on both creation, update, and view access.
   - `features/patients/consent.ts`: `grantConsent`, `withdrawConsent`, and `getCurrentConsent` ordered deterministically by `recorded_at DESC, id DESC`.
   - `app/(dashboard)/patients/page.tsx`: searchable patient list with empty states.
   - `app/(dashboard)/patients/new/page.tsx`: patient registration with optional ABHA and address inputs.
   - `app/(dashboard)/patients/[id]/page.tsx` & `consent-section.tsx`: patient detail view displaying demographics, compliance status, and interactive consent controls.

4. **Automated Verification**:
   - `tests/patients/schema.spec.ts` (5 tests): verifies required fields, phone normalization, blank ABHA normalization to null, and name validation.
   - `tests/audit/audit-logging.spec.ts` (4 tests): verifies patient creation writes an audit row, member UPDATE/DELETE on audit logs is rejected, cross-tenant audit isolation, and non-admin read refusal.
   - `tests/compliance/consent.spec.ts` (3 tests): verifies append-only consent grant, in-place update blockage, history preservation on withdrawal, and cross-tenant write refusal.
   - All 31 tests in the repository passing cleanly.

## Verification Results
- `npm run lint`: Passed (0 warnings, 0 errors).
- `npm run typecheck`: Passed (clean strict mode).
- `npm run build`: Passed (13 static/dynamic routes compiled).
- `npx vitest run`: 31 passed across 7 test suites.
