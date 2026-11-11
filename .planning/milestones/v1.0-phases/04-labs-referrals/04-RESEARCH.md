# Phase 4: Labs & Referrals - Research

**Date:** 2026-10-22  
**Phase:** 04-Labs & Referrals  
**Status:** Complete  
**Objective:** Answer *"What do I need to know to PLAN this phase well?"*

---

<user_constraints>
## User Constraints & Decisions (from CONTEXT.md)

### Lab Recommendations & Orders
- **D-01: No in-house lab catalog or technician queues.** Lab tests are recommended directly inside the Consultation Cabin (`/consultation/[id]`) as part of the clinical encounter note and printed on prescriptions/requisitions. Avoids heavy catalog tables, lab technician queue management, or manual numeric parameter entry tables for clinics without internal pathology labs.

### Lab Reports & Result Storage
- **D-02: Dedicated "Lab Reports & Records" on Patient Profile.** Returned lab reports and scans are uploaded directly as PDFs/images into a dedicated section on `/patients/[id]`, decoupled from rigid visit ID foreign-key constraints while remaining linkable to visit timeline history.
- **D-03: Zero-friction upload with auto-amended filenames.** Files are uploaded directly without manual numerical entry. The system automatically standardizes and amends the stored filename with the patient's full name and upload date (e.g., `Rajesh_Kumar_CBC_Report_2026-10-22.pdf`). Detailed parameter extraction and abnormal value trend analysis are deferred to Phase 5 AI Assist (`REQ-ai-features`).

### Storage Abstraction & Cloudflare R2 Portability
- **D-04: Unified Storage Abstraction (`lib/storage/`).** All PDF and document operations (Lab Reports, Prescriptions, and Billing Invoices/Receipts) must use an abstracted storage interface. Backed initially by private Supabase Storage buckets, but engineered for zero-downtime swap to Cloudflare R2 via environment variables (S3 client). Relative keys (`tenants/[tenant_id]/patients/[patient_id]/labs/...`) are stored in the database, never vendor-specific URLs.
- **D-05: Patient & Staff Access.** Authenticated staff and doctors preview/download files via short-lived private signed URLs (1 hour / 3600s). Patients receive a secure, tokenized zero-login web link with expiry (7 days) for mobile viewing/download.

### Referrals & Loop Closure
- **D-06: Dual Referral Creation.** Referrals can be initiated both during an active Consultation visit (under Treatment/Disposition) and directly from the Patient Profile (`/patients/[id]`) for quick referrals outside an active visit.
- **D-07: Formal Branded Out-of-Network Referral Letter.** Generate downloadable/printable clinic-branded PDF referral letters using `@react-pdf/renderer` containing clinic letterhead, patient summary, provisional diagnosis, active medications, referral notes, and referring doctor signature.
- **D-08: In-Network Consent-Gated History Sharing.** In-network referrals feature an explicit patient consent toggle ("Patient consents to share clinical history") which securely authorizes the receiving doctor to view recent encounters, medications, and vitals. Recorded in `consent_records` under DPDP guidelines.
- **D-09: Centralized Referrals Register (`/referrals`).** A dedicated clinic register with Inbound / Outbound tabs, status badges (`Sent`, `Acknowledged`, `Completed`), and a 1-tap modal to record return/closing-the-loop notes, with full visibility on the patient profile timeline.

### Discretionary Items
- Database table naming and indexing: `patient_documents` (with `document_type = 'lab_report'`), `document_share_tokens`, and `referrals`.
- Standardized file path structure in storage buckets: `tenants/[tenant_id]/patients/[patient_id]/labs/[filename]` and `tenants/[tenant_id]/referrals/[referral_id]/[filename]`.
- Tokenized public report preview URL schema: `/share/document/[token]` or `/reports/view?token=[token]`, 7-day expiry with access counting and revocation.
- Design: Strict adherence to `DESIGN.md` light-theme tokens, `#1769E0` brand blue, 24px pill status badges, accessible touch targets, and clean modal dialogs.

### Deferred Items
- **Automated AI Lab Report Analysis:** Extraction of numerical biomarkers and abnormal range checking via LLM/OCR (Phase 5).
- **Cloudflare R2 Bucket Migration:** Physical transfer of legacy Supabase bucket files to Cloudflare R2 (future ops task).
- **WhatsApp/SMS Automated Delivery:** Automated dispatch of tokenized lab and referral links via WhatsApp/SMS bot (Phase 5 `REQ-reminders-notifications`).
</user_constraints>

---

<phase_requirements>
## Phase Requirements Traceability

| Requirement ID | PRD Scope & Definition | Phase 4 Delivery Mapping |
|---|---|---|
| **REQ-lab-records** | Lab order creation from within a visit (configurable local test catalog); in-house result-entry workflow or external partner-lab routing; structured numeric/coded results plus free-text/file upload; abnormal flagging against configurable reference ranges; patient-facing result visibility via secure link. *(PRD §4.7)* | **1. Consultation Cabin:** Doctor recommends lab tests in SOAP/Investigations (persisted on `visits.investigations_advised` and rendered on prescription/requisition).<br>**2. Zero-Overhead Upload:** Patient profile (`/patients/[id]`) dedicated "Lab Reports & Records" tab accepting PDF/image uploads.<br>**3. Auto-Amended Filename:** Sanitized name: `[Clean_Patient_Name]_[Original_Filename]_[YYYY-MM-DD].ext`.<br>**4. Storage Abstraction (`lib/storage/`):** Unified provider backed by Supabase private storage (ready for R2 swap via env vars).<br>**5. Patient Link:** Tokenized 7-day zero-login viewer (`/reports/view?token=...`) with signed binary stream and access logging. |
| **REQ-referrals** | In-network referral to another doctor/clinic on the platform with consented shareable history summary; out-of-network PDF referral letter with clinical summary; statuses Sent / Acknowledged / Completed with closing-the-loop notes. *(PRD §4.9)* | **1. Dual Entry:** Create referrals from active Consultation Cabin (`/consultation/[id]`) and Patient Profile (`/patients/[id]`).<br>**2. Out-of-Network Referral:** Branded PDF letter generated with `@react-pdf/renderer` (letterhead, diagnosis, meds snapshot, doctor credentials).<br>**3. In-Network Referral:** Target tenant/doctor routing + explicit DPDP consent toggle capturing `consent_records` and packaging consented clinical history snapshot (vitals, diagnoses, active medications).<br>**4. Centralized Register (`/referrals`):** Inbound and Outbound tabs, status lifecycle (`Sent` → `Acknowledged` → `Completed`).<br>**5. Close the Loop:** 1-tap modal to log return findings and complete the referral loop with timeline visibility. |
</phase_requirements>

---

## 1. Storage Layer Architecture (`lib/storage/`)

### 1.1 Design Goals
1. **Single Unified Interface:** Prescriptions (`features/prescriptions`), Billing Invoices (`features/billing`), Lab Reports (`features/labs`), and Referral Letters (`features/referrals`) must all read and write through `lib/storage/`.
2. **Zero-Vendor Database Leaks:** Database tables store relative object keys (e.g. `tenants/{tenant_id}/patients/{patient_id}/labs/{filename}`), never vendor-specific URLs or domain names.
3. **Instant Cloudflare R2 Swap:** By setting environment variables (`STORAGE_PROVIDER=r2`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`), the entire platform immediately switches storage engine without database migrations or frontend rewrites.

### 1.2 Storage Interface Contract
```typescript
// lib/storage/types.ts
export interface StorageUploadOptions {
  path: string; // Relative path, e.g. "tenants/<tenantId>/patients/<patientId>/labs/<file>.pdf"
  buffer: Buffer | Uint8Array;
  contentType: string;
  upsert?: boolean;
}

export interface StorageSignedUrlOptions {
  path: string;
  expiresInSeconds?: number; // Default 3600 (1 hour)
  downloadFilename?: string;
}

export interface StorageProvider {
  name: "supabase" | "r2";
  upload(options: StorageUploadOptions): Promise<{ path: string; error?: string }>;
  createSignedUrl(options: StorageSignedUrlOptions): Promise<{ signedUrl: string; error?: string }>;
  delete(path: string): Promise<{ success: boolean; error?: string }>;
  download?(path: string): Promise<{ buffer: Buffer; contentType: string } | null>;
}
```

### 1.3 Provider Implementations
- **`SupabaseStorageProvider` (`lib/storage/supabase-provider.ts`):**
  - Uses `@supabase/supabase-js` service/authenticated client.
  - Interacts with private bucket `clinic-records` (or category-mapped bucket `prescriptions`).
  - Calls `supabase.storage.from(bucket).upload(path, buffer, { contentType, upsert })`.
  - Calls `supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds)`.
  - Handles RLS path prefix validation: `split_part(name, '/', 2)::uuid IN (SELECT current_user_tenant_ids())`.
- **`R2StorageProvider` (`lib/storage/r2-provider.ts`):**
  - Uses `@aws-sdk/client-s3` (`PutObjectCommand`, `DeleteObjectCommand`, `GetObjectCommand`) and `@aws-sdk/s3-request-presigner` (`getSignedUrl`).
  - Connects to `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`.
  - Generates standard S3 presigned URLs with custom expiration.
- **Factory (`lib/storage/index.ts`):**
  - Checks `process.env.STORAGE_PROVIDER === "r2"` or presence of `process.env.R2_ACCOUNT_ID`.
  - Lazily instantiates the appropriate provider singleton.
  - Exposes high-level helpers: `uploadFile()`, `getSignedUrl()`, `deleteFile()`.

### 1.4 Refactoring Existing Storage Usages
To honor user decision D-04 ("cover Prescriptions and Invoices as well"):
- `features/prescriptions/pdf/generator.ts`: Replace direct `supabase.storage.from("prescriptions").upload` and `createSignedUrl` with calls to `uploadFile()` and `getSignedUrl()`.
- `features/billing/pdf/generator.ts`: Replace direct `supabase.storage.from("prescriptions")` upload with `uploadFile()` and `getSignedUrl()`.

---

## 2. Database Schema & Multi-Tenant Boundaries

### 2.1 Storage Bucket Migration (`000013_labs_and_referrals.sql`)
1. Create unified private bucket `clinic-records` (size limit 25MB, MIME types: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`).
2. Add multi-tenant RLS policies on `storage.objects`:
```sql
-- Allows authenticated members to upload objects to their tenant prefix
CREATE POLICY "clinic_records_storage_insert_policy" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'clinic-records'
    AND (
        CASE
            WHEN split_part(name, '/', 1) = 'tenants' THEN split_part(name, '/', 2)::uuid
            ELSE split_part(name, '/', 1)::uuid
        END
    ) IN (SELECT public.current_user_tenant_ids())
);

-- Allows authenticated members to read objects belonging to their tenant
CREATE POLICY "clinic_records_storage_select_policy" ON storage.objects
FOR SELECT TO authenticated
USING (
    bucket_id = 'clinic-records'
    AND (
        CASE
            WHEN split_part(name, '/', 1) = 'tenants' THEN split_part(name, '/', 2)::uuid
            ELSE split_part(name, '/', 1)::uuid
        END
    ) IN (SELECT public.current_user_tenant_ids())
);
```

### 2.2 Table: `patient_documents`
Anchors diagnostic reports, lab scans, and clinical documents directly to the patient record:
```sql
CREATE TABLE IF NOT EXISTS public.patient_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL, -- Decoupled: optional linking
    title TEXT NOT NULL,                                           -- E.g. "Complete Blood Count (CBC)"
    document_type TEXT NOT NULL DEFAULT 'lab_report' 
        CHECK (document_type IN ('lab_report', 'imaging', 'prescription_scan', 'other')),
    original_filename TEXT NOT NULL,
    storage_path TEXT NOT NULL,                                    -- Relative storage key
    file_size_bytes BIGINT NOT NULL,
    mime_type TEXT NOT NULL,
    report_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    is_abnormal BOOLEAN NOT NULL DEFAULT false,                   -- Manual clinician flag
    uploaded_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_patient_docs_tenant_patient ON public.patient_documents(tenant_id, patient_id, report_date DESC);
CREATE INDEX idx_patient_docs_visit ON public.patient_documents(visit_id);

ALTER TABLE public.patient_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patient_documents_tenant_isolation" ON public.patient_documents
FOR ALL TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));
```

### 2.3 Table: `document_share_tokens`
Enables patient zero-login preview links with auto-expiry and revocation:
```sql
CREATE TABLE IF NOT EXISTS public.document_share_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES public.patient_documents(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,                                    -- 64-character secure random hex
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_doc_tokens_lookup ON public.document_share_tokens(token) 
    WHERE revoked_at IS NULL;
CREATE INDEX idx_doc_tokens_tenant ON public.document_share_tokens(tenant_id);

ALTER TABLE public.document_share_tokens ENABLE ROW LEVEL SECURITY;

-- Staff can manage tokens within their tenant
CREATE POLICY "doc_tokens_staff_manage" ON public.document_share_tokens
FOR ALL TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));
```

### 2.4 Table: `referrals`
Supports both In-Network and Out-of-Network referrals with full loop closure:
```sql
CREATE TABLE IF NOT EXISTS public.referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE, -- Originating clinic
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL,           -- Optional visit origin
    referral_type TEXT NOT NULL CHECK (referral_type IN ('out_of_network', 'in_network')),
    referring_doctor_id UUID NOT NULL REFERENCES auth.users(id),
    
    -- Target Info (Out-of-Network)
    referred_to_name TEXT NOT NULL,                                         -- Doctor / Specialist name
    referred_to_facility TEXT,                                              -- Hospital / Clinic name
    referred_to_specialty TEXT,                                             -- E.g. "Cardiology"
    referred_to_contact TEXT,                                               -- Phone / Email
    
    -- Target Info (In-Network)
    target_tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
    target_doctor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- Clinical Context
    reason_for_referral TEXT NOT NULL,
    provisional_diagnosis TEXT,
    urgency TEXT NOT NULL DEFAULT 'routine' CHECK (urgency IN ('routine', 'priority', 'urgent')),
    clinical_summary TEXT,
    active_medications_snapshot JSONB DEFAULT '[]'::jsonb,
    investigations_advised TEXT[] DEFAULT '{}',
    
    -- In-Network Digital Sharing & DPDP Consent
    patient_consents_history_sharing BOOLEAN NOT NULL DEFAULT false,
    consented_history_snapshot JSONB,                                       -- Structured snapshot of recent encounters/vitals
    
    -- Status & Loop Closure
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'acknowledged', 'completed', 'cancelled')),
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    closure_notes TEXT,                                                     -- Return findings note
    closed_by UUID REFERENCES auth.users(id),                               -- Clinician logging return
    
    -- Letterhead & PDF
    pdf_storage_path TEXT,
    letterhead_mode TEXT NOT NULL DEFAULT 'blank_paper' CHECK (letterhead_mode IN ('blank_paper', 'preprinted_letterhead')),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_referrals_tenant_status ON public.referrals(tenant_id, status, sent_at DESC);
CREATE INDEX idx_referrals_target_tenant ON public.referrals(target_tenant_id, status) WHERE target_tenant_id IS NOT NULL;
CREATE INDEX idx_referrals_patient ON public.referrals(patient_id);
CREATE INDEX idx_referrals_visit ON public.referrals(visit_id);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Originating tenant: full access
CREATE POLICY "referrals_originating_tenant" ON public.referrals
FOR ALL TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

-- Receiving tenant (In-Network): SELECT and UPDATE (acknowledge/complete)
CREATE POLICY "referrals_receiving_tenant_select" ON public.referrals
FOR SELECT TO authenticated
USING (target_tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "referrals_receiving_tenant_update" ON public.referrals
FOR UPDATE TO authenticated
USING (target_tenant_id IN (SELECT public.current_user_tenant_ids()))
WITH CHECK (target_tenant_id IN (SELECT public.current_user_tenant_ids()));
```

---

## 3. Server Actions & Feature Modules

### 3.1 Lab Reports Feature (`features/labs/`)
- `features/labs/schema.ts`:
  - `uploadLabDocumentSchema`: `patient_id`, `visit_id` (optional), `title`, `document_type`, `report_date`, `notes`, `is_abnormal`.
  - `generateShareTokenSchema`: `document_id`.
- `features/labs/actions.ts`:
  - `uploadLabDocument(formData: FormData)`:
    1. Validate tenant & permissions (Doctor/Admin/Receptionist).
    2. Sanitize patient name: `patient.full_name.replace(/[^a-zA-Z0-9]/g, "_")`.
    3. Generate amended filename: `${cleanPatientName}_${cleanOriginalName}_${date}.pdf`.
    4. Deterministic storage path: `tenants/${tenant_id}/patients/${patient_id}/labs/${amendedFilename}`.
    5. Call `getStorageProvider().upload(...)`.
    6. Insert into `patient_documents`.
    7. Record audit log: `action: 'create', entity_type: 'patient_document'`.
  - `getPatientDocuments(patientId: string)`:
    - Returns all documents for a patient ordered by `report_date DESC`.
  - `getDocumentSignedUrl(documentId: string)`:
    - Returns 1-hour signed URL for authenticated staff preview.
  - `generateDocumentShareToken(documentId: string)`:
    - Generates 64-hex crypto token in `document_share_tokens` (7-day TTL).
    - Returns public shareable URL: `/reports/view?token=${token}`.
  - `deleteLabDocument(documentId: string)`:
    - Deletes from storage via `getStorageProvider().delete(...)` and removes row.

### 3.2 Referrals Feature (`features/referrals/`)
- `features/referrals/schema.ts`:
  - `createReferralSchema`:
    - `patient_id`, `visit_id` (optional).
    - `referral_type` (`out_of_network` | `in_network`).
    - `referred_to_name`, `referred_to_facility`, `referred_to_specialty`, `referred_to_contact`.
    - `target_tenant_id` (optional).
    - `reason_for_referral`, `provisional_diagnosis`, `urgency`, `clinical_summary`.
    - `patient_consents_history_sharing` (boolean).
    - `letterhead_mode` (`blank_paper` | `preprinted_letterhead`).
  - `closeReferralLoopSchema`: `referral_id`, `closure_notes`.
- `features/referrals/actions.ts`:
  - `createReferral(input)`:
    1. Authenticate doctor/staff.
    2. Fetch patient demographics, active medications snapshot, and latest vitals.
    3. If `in_network` and `patient_consents_history_sharing`:
       - Compile recent 5 visits (dates, chief complaints, diagnoses, vitals, meds).
       - Record DPDP consent in `consent_records` (`consent_type: 'referral_history_sharing'`).
       - Store structured snapshot in `consented_history_snapshot`.
    4. Insert into `referrals`.
    5. Generate branded referral letter PDF via `features/referrals/pdf/generator.ts`.
    6. Upload PDF to storage: `tenants/${tenant_id}/referrals/${referral_id}/referral_letter.pdf`.
    7. Update referral with `pdf_storage_path`.
    8. Record audit log.
  - `getOutboundReferrals()`: Lists outbound referrals for current tenant.
  - `getInboundReferrals()`: Lists inbound referrals where `target_tenant_id = current_tenant_id`.
  - `acknowledgeReferral(referralId)`: Inbound doctor marks status as `acknowledged`.
  - `closeReferralLoop(referralId, closureNotes)`:
    - Updates status to `completed`, stores `closure_notes`, `completed_at = now()`, `closed_by = auth.uid()`.
  - `getReferralSignedUrl(referralId)`: Short-lived signed URL for referral PDF.

### 3.3 Public Patient Report Viewer (`app/api/reports/view/route.ts` & `/reports/view/page.tsx`)
- Zero-login, mobile-optimized patient viewing page.
- Validates token against `document_share_tokens` table:
  - Verifies `revoked_at IS NULL` and `expires_at > now()`.
  - Increments `access_count`, records `last_accessed_at`.
- Generates 10-minute temporary binary stream or signed URL.
- Renders clean view with clinic branding, document title, date, and "Download PDF / View Report" button adhering strictly to `DESIGN.md` light theme tokens.

---

## 4. UI & Workflow Design (Adhering to `DESIGN.md`)

### 4.1 Consultation Cabin Integration (`components/consultation/`)
- Existing `investigations_advised` is already present on `visits` and rendered on `PrescriptionDocument`.
- Add a **Referral Disposition Card / Trigger** directly below or alongside Investigations & Advice:
  - Compact trigger button: `+ Create Referral` with `Share2` icon.
  - Clicking opens a slide-over drawer or modal pre-populated with:
    - Patient Name & Demographics
    - Current Visit Provisional Diagnoses
    - Active Medications snapshot
    - Radio toggle: `Out-of-Network Specialist` vs `In-Network Clinic`
    - Recipient Specialist name, Facility, Specialty, Urgency selector (`Routine`, `Priority`, `Urgent`)
    - In-Network only: `[x] Patient consents to share clinical history summary`
    - Primary Button: `Generate Referral Letter & Save` (`#1769E0`)
  - Once created, a badge displays: `Referral to Dr. [Name] ([Status])` with quick link to print/download the referral letter.

### 4.2 Patient Profile "Lab Reports & Records" Tab (`components/patients/`)
- In `components/patients/patient-detail-view.tsx`, extend tabs:
  - `Clinical Encounters` | `Lab Reports & Records` (`FlaskConical` icon + count badge) | `Profile` | `Consent`
- In `components/patients/patient-lab-documents.tsx`:
  - **Header Action:** `+ Upload Report` button.
  - **Upload Modal / Dropzone:**
    - Drag & drop zone supporting PDF, PNG, JPG, WebP (max 25MB).
    - Auto-previews original filename.
    - Fields: Title (default: original filename), Report Date (default: today), Optional Visit linking dropdown, Notes, Abnormal toggle.
    - On submission, uploads and instantly shows auto-amended filename (e.g. `Ananya_Sharma_Thyroid_Profile_2026-10-22.pdf`).
  - **Document Card / Table View:**
    - Clean TailAdmin card layout with report icon, amended title, date, size, and abnormal flag badge.
    - Action buttons:
      - `View` (opens signed URL in viewer)
      - `Share` (generates 7-day patient link with 1-click clipboard copy)
      - `Delete` (staff confirmation dialog)
- In `components/patients/patient-visit-history.tsx`:
  - If a visit has linked lab reports or referrals, render clean badges linking directly to them.

### 4.3 Centralized Referrals Register (`/referrals`)
- Add **"Referrals"** item to `components/layout/app-sidebar.tsx`:
  - `label: "Referrals"`, `href: "/referrals"`, `icon: Share2`.
- `app/(dashboard)/referrals/page.tsx` & `components/referrals/referrals-register.tsx`:
  - **Tabs:** `Outbound Referrals` (default) | `Inbound Referrals`.
  - **Outbound Table:**
    - Patient Name (linked to `/patients/[id]`)
    - Referred To (Specialist & Clinic/Facility)
    - Specialty & Urgency badge (`Routine`: gray, `Priority`: warning, `Urgent`: error)
    - Date Sent
    - Status Badge:
      - `Sent`: Amber (`bg-[#FFF5E5] text-[#9A5B00] border-[#F3D39A]`)
      - `Acknowledged`: Info Blue (`bg-[#EAF2FF] text-[#1769E0] border-[#BFD8FF]`)
      - `Completed`: Success Green (`bg-[#EAF7F0] text-[#18794E] border-[#BDE5CF]`)
    - Actions:
      - `View Letter` (downloads/previews PDF)
      - `Close the Loop` (1-tap modal for returning patients)
  - **Close the Loop Modal:**
    - Form fields: Outcome / Findings Note, Date of Return, Recommendations followed.
    - Button: `Complete Referral` (updates status to `completed` and records closure note).
  - **Inbound Table:**
    - Patient Name & Referring Clinic / Doctor
    - Reason & Urgency
    - History Status: `Consented History Available` badge
    - Actions:
      - `Acknowledge` button
      - `View Consented History` drawer (displays shared vitals, diagnoses, medications)
      - `Book Appointment` quick-action

### 4.4 Branded PDF Referral Letter (`features/referrals/pdf/`)
- Built with `@react-pdf/renderer` mirroring `features/prescriptions/pdf/prescription-document.tsx`:
  - Header: Clinic Name, Address, Contact, Registration Number, Logo.
  - Doctor Section: Referring Doctor Name, Qualifications, Medical Council Reg No, Date.
  - Patient Section: Patient Full Name, Age/Sex, Phone, Patient ID, ABHA.
  - Referral Details: Addressed to Dr. [Name] / Facility, Specialty, Urgency.
  - Clinical Summary: Reason for Referral, Provisional Diagnosis, Vitals, Active Medications list, Advised Investigations.
  - Sign-off: Doctor Signature block and date.
  - Supports dual letterhead modes (`blank_paper` vs `preprinted_letterhead`).

---

## 5. Validation Architecture & Test Strategy

### 5.1 Test Execution Architecture (Vitest)
As discovered during research, running all test files concurrently against live Supabase can trigger auth rate limits on `signInWithRetry`. Tests must be runnable as isolated targeted suites:
```bash
npx vitest run tests/labs/
npx vitest run tests/referrals/
npx vitest run tests/storage/
```

### 5.2 Unit & Integration Test Suites
1. **`tests/storage/storage-provider.spec.ts`**:
   - `SupabaseStorageProvider`: verifies file upload, private bucket access, and 3600s signed URL generation.
   - `R2StorageProvider`: verifies configuration parsing and S3 client command construction.
   - `Storage Factory`: verifies provider selection via environment variables.
   - Prescriptions & Billing integration: verifies that `features/prescriptions` and `features/billing` use the storage provider.
2. **`tests/labs/lab-documents.spec.ts`**:
   - Filename auto-amendment logic (`[Patient_Name]_[Original]_[Date].pdf`).
   - File upload server action: validates mime-types (PDF, images), stores relative paths, and creates DB row.
   - Scoping: verifies documents are anchored to patient, visit ID is optional.
   - Multi-tenant isolation: verifies Tenant B cannot access or list Tenant A's patient documents.
3. **`tests/labs/tokenized-sharing.spec.ts`**:
   - Token generation: verifies 64-hex token and 7-day expiry creation.
   - Public route access: valid token allows reading document metadata and fetching signed stream.
   - Expiration & Revocation: expired tokens (> 7 days) and revoked tokens return 404/410.
   - Access counting: verifies `access_count` increments on each retrieval.
4. **`tests/referrals/referrals-flow.spec.ts`**:
   - Creation of Out-of-Network referral: generates branded `@react-pdf/renderer` PDF letter, uploads to storage, and records referral row.
   - Creation of In-Network referral: records DPDP consent in `consent_records`, attaches consented clinical history snapshot.
   - Centralized register queries: Outbound tab returns clinic's referrals; Inbound tab returns targeted referrals.
   - Status transitions: `Sent` → `Acknowledged` → `Completed`.
   - "Close the Loop" modal mutation: records return notes, completion timestamp, clinician ID, and updates status to `Completed`.
   - Multi-tenant security: receiving clinic cannot edit clinical details, only acknowledge and complete.

### 5.3 Playwright E2E Test Suite (`tests/e2e/labs-referrals.spec.ts`)
- Doctor logs in → opens patient profile `/patients/[id]`.
- Navigates to "Lab Reports & Records" tab → uploads a PDF report.
- Verifies auto-amended filename displayed in table.
- Generates patient share link → visits `/reports/view?token=...` in incognito/unauthenticated context → verifies report is accessible.
- Opens active Consultation `/consultation/[id]` → adds investigations advised → creates Out-of-Network referral.
- Verifies referral letter PDF download link works.
- Navigates to `/referrals` register → finds referral in Outbound tab → clicks "Close the Loop" → submits return findings → verifies status updates to `Completed`.

---

## 6. Architecture & Implementation Checklist

- [ ] **Storage Layer (`lib/storage/`)**:
  - `lib/storage/types.ts`: `StorageProvider` contract.
  - `lib/storage/supabase-provider.ts`: Supabase Storage implementation.
  - `lib/storage/r2-provider.ts`: Cloudflare R2 / S3 client implementation.
  - `lib/storage/index.ts`: Provider factory & exports.
  - Refactor `features/prescriptions/pdf/generator.ts` and `features/billing/pdf/generator.ts` to route through `lib/storage/`.
- [ ] **Database Migration (`supabase/migrations/000013_labs_and_referrals.sql`)**:
  - Create `clinic-records` private storage bucket with RLS policies.
  - Create `patient_documents` table with multi-tenant RLS.
  - Create `document_share_tokens` table with multi-tenant RLS.
  - Create `referrals` table with dual-tenant RLS (originating + receiving).
- [ ] **Labs Feature (`features/labs/`)**:
  - `schema.ts`: Zod schemas for upload, share token, metadata.
  - `actions.ts`: `uploadLabDocument`, `getPatientDocuments`, `getDocumentSignedUrl`, `generateDocumentShareToken`, `deleteLabDocument`.
- [ ] **Referrals Feature (`features/referrals/`)**:
  - `schema.ts`: Zod schemas for referral creation and loop closure.
  - `actions.ts`: `createReferral`, `getOutboundReferrals`, `getInboundReferrals`, `acknowledgeReferral`, `closeReferralLoop`.
  - `pdf/referral-letter-document.tsx`: `@react-pdf/renderer` branded layout.
  - `pdf/generator.ts`: Referral letter PDF compilation and storage upload.
- [ ] **UI Integration**:
  - `components/patients/patient-lab-documents.tsx`: Dedicated tab on `/patients/[id]`.
  - `components/consultation/consultation-workspace.tsx`: Referral trigger under Treatment/Disposition.
  - `app/(dashboard)/referrals/page.tsx` & `components/referrals/referrals-register.tsx`: Centralized register with Outbound/Inbound tabs and Close-the-Loop modal.
  - `components/layout/app-sidebar.tsx`: Add "Referrals" navigation item.
  - `app/api/reports/view/route.ts` & `app/reports/view/page.tsx`: Tokenized public viewer.

---

## RESEARCH COMPLETE
