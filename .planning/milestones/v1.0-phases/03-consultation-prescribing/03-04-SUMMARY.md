# Plan 03-04 Summary: React-PDF Generation Pipeline, Dual Letterhead Printing & Post-Sign-Off Amendments

## Execution Overview
- **Phase:** 03 (Consultation & Prescribing)
- **Plan:** 03-04 (React-PDF Generation Pipeline, Dual Letterhead Printing & Post-Sign-Off Amendments)
- **Status:** Completed
- **Branch:** `phase-2b-tailadmin-ui`
- **Verification:**
  - `npx vitest run tests/integration/prescription-versioning.spec.ts` (6/6 passed)
  - Full suite `npx vitest run` (19/19 test files, 132/132 tests passed)
  - `npm run typecheck` (0 errors across entire repository)

---

## Deliverables & Key Implementations

### 1. Server-Side React-PDF Engine (`features/prescriptions/pdf/` & `next.config.ts`)
- `next.config.ts`:
  - Configured `serverExternalPackages: ["@react-pdf/renderer"]` to prevent bundling conflicts with React 19 / Turbopack client components.
- `features/prescriptions/pdf/prescription-document.tsx`:
  - Built with `@react-pdf/renderer` primitives (`Document`, `Page`, `View`, `Text`, `StyleSheet`).
  - Standard A4 page dimensions with clean typography using PDF-standard Helvetica fonts (zero external font downloads).
  - Dual Letterhead Mode:
    - `blank_paper`: Includes full clinic branding header (name, address, phone, registration number, logo), doctor credentials, and footer.
    - `preprinted_letterhead`: Omits clinic branding header and footer; applies top margin offset (`paddingTop: 110pt` / ~39mm) and bottom margin offset (`paddingBottom: 60pt` / ~21mm) to align with physical clinic letterhead stationery pads.
  - Clinical Content Blocks: Patient demographics banner, vital signs strip with formatted BMI, chief complaints with duration, ICD-11/SNOMED diagnoses list, ℞ medications table (item number, brand name, generic salt, dosage frequency, food relation, duration, special instructions), advised investigations, clinical advice, follow-up date, and doctor digital signature block with registration number.
  - Amendment Banner Watermark: If `version > 1` or amendment reason exists, prominently renders amber header banner: `"AMENDED PRESCRIPTION (v{version}) • Reason: {amendment_reason}"`.
- `features/prescriptions/pdf/generator.ts`:
  - `generateAndArchivePrescriptionPdf`: Server-side PDF compilation, async stream-to-buffer conversion, upload to private Supabase Storage bucket `prescriptions` under path `${tenant_id}/${visit_id}/rx_v${version}.pdf`, 3600-second signed URL issuance, and compliance audit trail logging (`prescription.generate_pdf`).

### 2. Authenticated Route Handler & In-App Preview Modal
- `app/api/visits/[id]/prescription-pdf/route.ts`:
  - Authenticated Route Handler verifying session and clinic membership.
  - Evaluates query parameters `letterhead` (`blank_paper` | `preprinted_letterhead`) and `download` (`true` | `false`).
  - Streams compiled PDF buffer directly with headers `Content-Type: application/pdf` and `Content-Disposition: inline` or `attachment`.
- `components/consultation/pdf-preview-modal.tsx`:
  - Accessible modal dialog (`role="dialog"`, `aria-modal="true"`, `aria-labelledby="pdf-preview-title"`).
  - Segmented control switcher toggling between `Print on Blank Paper` and `Print on Pre-Printed Letterhead`, immediately refreshing the signed PDF preview.
  - Loading spinner and error retry fallback.
  - Responsive `<iframe>` embedding the signed PDF URL.
  - Action footer adhering to verb+noun copywriting contract: `Close Preview` (safe dismiss), `Print Prescription` (triggers browser native print dialog), and `Download PDF` (primary action).

### 3. Complete & Sign Workflow & Post-Sign-Off Amendment Lifecycle
- `features/consultation/actions.ts`:
  - `completeAndSignConsultation`: Enforces safety check (at least one diagnosis or clinical note), marks prescription as signed, transitions visit status to `completed`, generates initial archival PDF v1, and logs `visit.complete_and_sign`.
  - `reopenVisitForAmendment`: Requires mandatory reason for amendment (minimum 10 characters), captures an immutable JSON state snapshot into `visit_revisions` table (`revision_number`, `snapshot`, `amendment_reason`, `amended_by`, `amended_at`), transitions visit status back to `in_consultation`, and logs `visit.reopen_for_amendment`.
  - `finalizeVisitAmendment`: Increments prescription version counter (`v2`, `v3`), stamps amendment reason and timestamp, regenerates watermarked amended PDF, seals visit status back to `completed`, and logs `visit.amend_finalized`.
- `components/consultation/amendment-modal.tsx`:
  - Accessible dialog warning the clinician about audit implications.
  - Mandatory reason for amendment textarea with 10-character minimum validation.
  - Action buttons: `Cancel Amendment` (safe outline) and `Confirm & Reopen for Amendment` (amber warning button).

### 4. Storage Multi-Tenant RLS & Integration Testing
- `supabase/migrations/000008_prescriptions_storage.sql`:
  - Configures private `prescriptions` bucket (10MB limit, `application/pdf`).
  - Sets up row-level security policies on `storage.objects` enforcing `split_part(name, '/', 1)::uuid IN (SELECT public.current_user_tenant_ids())` for INSERT, SELECT, and UPDATE.
- `tests/integration/prescription-versioning.spec.ts`:
  - 6 end-to-end integration tests verifying:
    1. Visit encounter setup with vitals, complaints, diagnoses, and medications.
    2. `completeAndSignConsultation` status transitions and signing.
    3. Server-side binary PDF compilation with `%PDF-` magic bytes.
    4. Dual letterhead mode signed URL generation.
    5. Full post-sign-off amendment lifecycle with immutable `visit_revisions` snapshot and version increment to v2.
    6. Multi-tenant RLS isolation blocking cross-tenant access to revision snapshots and PDFs.

---

## Automated Verification Results
- `tests/integration/prescription-versioning.spec.ts`: 6/6 integration tests passed.
- Entire test suite: 19 test files, 132 tests passed (0 failures).
- `npm run typecheck`: 0 TypeScript compilation errors.

---

## Atomic Commits
1. `37d3a72`: `feat(03-04): server-side react-pdf document template, generator, and route handler` (Task 1)
2. `d233009`: `feat(03-04): in-app pdf preview modal and dual letterhead selector ui` (Task 2)
3. `c9c7267`: `feat(03-04): complete and sign workflow, post-sign-off amendment modal, and immutability lifecycle` (Task 3)
4. `7b4b800`: `test(03-04): integration tests for server-side pdf, signed storage urls, and prescription versioning` (Task 4)
