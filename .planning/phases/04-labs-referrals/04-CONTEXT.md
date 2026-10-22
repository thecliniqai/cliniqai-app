# Phase 4: Labs & Referrals - Context

**Gathered:** 2026-10-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 delivers practical, zero-overhead diagnostic lab tracking and multi-tier patient referrals for solo and small outpatient clinics:
1. Recommending diagnostic lab tests directly during doctor consultations without forcing complex in-house lab management overhead.
2. Uploading patient lab report PDFs and scans to a dedicated "Lab Reports & Records" section on the Patient Profile (`/patients/[id]`) with automatic patient-name and date file naming.
3. Building an abstracted storage adapter (`lib/storage/`) supporting Lab Reports, Prescriptions, and Invoices, backed by Supabase Storage with signed URLs and tokenized patient links, engineered for a drop-in switch to Cloudflare R2.
4. Managing both in-network (consent-gated history sharing) and out-of-network (branded PDF referral letters) referrals, complete with a centralized clinic Referrals Register (`/referrals`) and return loop-closure notes.

</domain>

<decisions>
## Implementation Decisions

### Lab Recommendations & Orders
- **D-01:** No heavy in-house lab management or separate test catalog module. Lab tests are recommended directly inside the Consultation Cabin (as part of the clinical encounter note and printed on prescriptions/requisitions) to avoid administrative overhead for clinics without internal pathology labs. — **Reversibility:** costly — avoids unnecessary catalog schema, lab technician queues, and manual parameter entry tables.

### Lab Reports & Result Storage
- **D-02:** Lab reports returned by patients are uploaded as PDFs/images directly into a dedicated "Lab Reports & Records" section on the Patient Profile (`/patients/[id]`), decoupled from rigid visit ID foreign-key constraints while remaining linkable to visit timeline history. — **Reversibility:** costly — anchors documents directly to patients without blocking visit lifecycles.
- **D-03:** Zero-friction upload: Files are uploaded directly without manual parameter or numerical entry. The system automatically standardizes and amends the stored filename with the patient's full name and upload date (e.g., `Rajesh_Kumar_CBC_Report_2026-10-22.pdf`). Detailed parameter extraction and abnormal value trend analysis are deferred to Phase 5 AI Assist. — **Reversibility:** reversible — filename formatting and document metadata structure.

### Storage Abstraction & Cloudflare R2 Portability
- **D-04:** Unified Storage Abstraction (`lib/storage/`): All PDF and document operations (Lab Reports, Prescriptions, and Billing Invoices/Receipts) must use an abstracted storage interface. Backed initially by private Supabase Storage buckets, but designed for zero-downtime swap to Cloudflare R2 via environment variables (S3 client). Relative keys (`tenants/[tenant_id]/patients/[patient_id]/labs/...`) are stored in the database, never vendor-specific URLs. — **Reversibility:** one-way — database schema and binary asset access architecture across all PDF modules.
- **D-05:** Patient & Staff Access: Authenticated staff and doctors preview/download files via short-lived private signed URLs. Patients receive a secure, tokenized zero-login web link with expiry for mobile viewing/download. — **Reversibility:** costly — public route handler, token verification table, and signed access policies.

### Referrals & Loop Closure
- **D-06:** Dual Referral Creation: Referrals can be initiated both during an active Consultation visit (under Treatment/Disposition) and directly from the Patient Profile (`/patients/[id]`) for quick referrals outside an active visit. — **Reversibility:** reversible — UI entry points and action handlers.
- **D-07:** Formal Branded Out-of-Network Referral Letter: Generate downloadable/printable clinic-branded PDF referral letters using `@react-pdf/renderer` containing clinic letterhead, patient summary, provisional diagnosis, active medications, referral notes, and referring doctor signature. — **Reversibility:** costly — PDF renderer template and styling.
- **D-08:** In-Network Consent-Gated History Sharing: In-network referrals feature an explicit patient consent toggle ("Patient consents to share clinical history") which securely authorizes the receiving doctor to view recent encounters, medications, and vitals. — **Reversibility:** one-way — consent record schema and multi-tenant access policy.
- **D-09:** Centralized Referrals Register (`/referrals`): A dedicated clinic register with Inbound / Outbound tabs, status badges (`Sent`, `Acknowledged`, `Completed`), and a 1-tap modal to record return/closing-the-loop notes, with full visibility on the patient profile timeline. — **Reversibility:** costly — navigation item, register page UI, and status transition mutations.

### the agent's Discretion
- Database table naming and indexing for `patient_documents` / `lab_records` and `referrals`.
- Standardized file path structure in private storage buckets (`tenants/[tenant_id]/patients/[patient_id]/...`).
- Tokenized public report preview URL schema and expiry window (e.g., 7 days with configurable renewal).
- Layout and styling of the `/referrals` register and Patient Profile "Lab Reports & Records" card adhering to `DESIGN.md`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product & Requirements
- `docs/clinic-management-prd.md` §4.7 (Lab Records) & §4.9 (Referrals) — Core functional requirements and loop-closure workflow.
- `.planning/REQUIREMENTS.md` (`REQ-lab-records`, `REQ-referrals`) — Requirement definitions and traceability notes.

### Engineering & Architecture
- `AGENTS.md` §5 (Technology Stack), §7 (Multi-Tenancy), §9 (Healthcare Data), §21 (Files & Documents) — Security, signed URLs, file metadata separation, and multi-tenant RLS rules.
- `DESIGN.md` — Canonical design system: Light theme tokens, #1769E0 primary brand color, TailAdmin components, badges, and modal primitives.

### Existing System Implementations
- `app/api/prescriptions/[id]/route.ts` & `features/prescriptions/` — Established `@react-pdf/renderer` server-side PDF generation patterns and Supabase storage upload.
- `app/api/billing/invoices/[id]/receipt/route.ts` — Branded receipt PDF layout and storage integration.
- `app/(dashboard)/patients/[id]/page.tsx` & `components/patients/patient-visit-history.tsx` — Patient profile integration points for lab documents and referral history.
- `app/(dashboard)/consultation/[id]/page.tsx` & `components/consultation/consultation-screen.tsx` — Active encounter integration points for recommending labs and creating referrals.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `@react-pdf/renderer` document layout components in `features/prescriptions/pdf/` and `features/billing/pdf/`: Direct reference for building `ReferralLetterPdf`.
- `components/ui/` primitives (TailAdmin badges, modal dialogs, buttons, dropdowns, inputs, tabs): Reusable for the `/referrals` register and lab upload drawer/modal.
- `features/staff/actions.ts`: Clinician directory and name formatting (`formatDoctorDisplayName`) for referring doctor resolution.
- `lib/supabase/server.ts` & `lib/supabase/client.ts`: Authenticated client instances for server actions and route handlers.

### Established Patterns
- Server Actions with Zod schema validation in `features/*/actions.ts`.
- Multi-tenant RLS enforcement using `tenant_id = get_current_tenant_id()` on all tables.
- Short-lived signed URLs (1 hour / 3600s) for private binary asset access.
- Audit logging on clinical mutations via `audit_logs` table.

### Integration Points
- **Active Consultation Cabin:** Add "Lab Tests" recommendation input and "Referral" trigger under the encounter disposition/treatment section.
- **Patient Detail (`/patients/[id]`):** Add "Lab Reports & Records" card/tab for direct PDF uploads and viewing, plus referral badges in the clinical timeline.
- **Sidebar & App Shell:** Add "Referrals" navigation item (`/referrals`) linking to the clinic-wide referrals register.
- **Storage Layer (`lib/storage/`):** Unified storage provider module abstracting Supabase Storage / S3 / Cloudflare R2 for prescriptions, invoices, and lab uploads.

</code_context>

<specifics>
## Specific Ideas

- **Cloudflare R2 Ready:** The storage provider abstraction must be cleanly isolated in `lib/storage/` so that setting R2 credentials (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`) enables swapping all document and PDF storage without modifying database schemas or frontend components.
- **Auto-Amended Filenames:** When uploading a lab report, format the stored filename as `[Patient_Clean_Name]_[Original_Filename]_[YYYY-MM-DD].pdf` so clinic files remain instantly identifiable in storage browsers.
- **Closing the Loop:** When an outbound referral returns, clinicians can click "Close the Loop" to log return findings, outcome notes, and mark the referral status as `Completed`.

</specifics>

<deferred>
## Deferred Ideas

- **Automated AI Lab Report Analysis:** AI parsing of uploaded lab PDF/image files to extract numeric parameters, detect abnormal flags, and plot historical trends (e.g., HbA1c, lipid profiles) — deferred to Phase 5 (`REQ-ai-features`).
- **Cloudflare R2 Migration Execution:** Physical migration of past Supabase storage files to Cloudflare R2 bucket — deferred until clinic file volume warrants dedicated bucket provisioning.
- **WhatsApp/SMS Automated Delivery:** Automated dispatch of tokenized lab and referral links via WhatsApp/SMS bot — deferred to Phase 5 (`REQ-reminders-notifications`).

</deferred>

---

*Phase: 04-Labs & Referrals*
*Context gathered: 2026-10-22*
