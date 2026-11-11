# Phase 3: Consultation & Prescribing - Context

**Gathered:** 2026-10-09  
**Status:** Ready for planning  

<domain>
## Phase Boundary

Doctors can complete a full outpatient consultation — record clinical notes (vitals, chief complaints, examination, specialty template), select diagnoses with ICD-11 & SNOMED CT terminology, build electronic prescriptions with India CDCI medication search, and generate clinic-branded PDF prescriptions with customizable letterhead. Visits transition through `waiting` → `in_consultation` → `completed`. Billing is deferred to dedicated Phase 3A.

</domain>

<decisions>
## Implementation Decisions

### Consultation Workspace & Specialty Templates
- **D-01: Single-Page Fast-Scrolling SOAP Workspace** — **Reversibility:** costly — defines layout and component hierarchy.
  - Single continuous fast-scrolling page with sticky section jumps (Vitals → Chief Complaints & History → Exam / Specialty → Diagnosis → Rx → Advice & Follow-up).
  - Optimized for high-throughput Indian OPD clinics (3-minute consultations) with zero tab switching.
- **D-02: Shared Vitals Block with Abnormal Badges** — **Reversibility:** costly — touches visit data model and queue workflow.
  - Vitals (BP, Pulse, SpO2, Temp, Weight, Height, BMI) can be recorded by Nurse during 'With Nurse' queue state or directly by Doctor in the consultation.
  - Abnormal values are visually badged (e.g., BP > 140/90, SpO2 < 95).
- **D-03: Configuration-Driven Specialty Templates (GP, Dental, Pediatrics)** — **Reversibility:** one-way — database schema and JSON schema structure.
  - Extensible JSON schema with specialty widgets saved in `visits.specialty_data` (JSONB).
  - Launching with 3 core specialties:
    - **General Physician**: General physical examination notes and systemic review.
    - **Dental**: Interactive visual odontogram (FDI / Universal numbering tooth chart) where clicking teeth toggles condition tags (Decay, Crown, Missing, RCT, Extraction) + procedure notes.
    - **Pediatrics**: Birth history (gestational age, birth weight), growth measurements (Weight, Height, Head Circumference with WHO percentile badge), and Indian Academy of Pediatrics (IAP) immunization checklist (given vs due).
  - OB/GYN, Dermatology, and Orthopedics are deferred to post-launch.
- **D-04: Doctor Profile Specialty Default & Visit Switcher** — **Reversibility:** reversible.
  - Doctor profile configures one or more specialties with a designated "Default Specialty".
  - Starting a consultation preselects the default template for Quick Start. Multi-specialty doctors can switch templates via a dropdown on the visit without altering profile defaults.
- **D-05: Debounced Auto-Save & Post-Sign-Off Editing via Versioned Snapshots** — **Reversibility:** one-way — requires `visit_revisions` table and audit model.
  - Debounced background auto-save as `in_consultation` draft.
  - "Complete & Sign" moves visit to `completed`.
  - Doctor can re-open and edit the record after completion/sign-off without being locked out.
  - Edits after completion save an immutable timestamped snapshot in `visit_revisions` with audit log entry ("Amended by Dr. X on [date]").
- **D-06: Longitudinal History Side Panel & 1-Click Repeat** — **Reversibility:** reversible.
  - Slide-over history drawer / collapsible panel shows past visits, previous Rx, and lab summaries with a 1-click "Repeat previous Rx" or "Copy notes" action.
- **D-07: Hybrid Chief Complaint Chips + Free-Text** — **Reversibility:** reversible.
  - Quick-tap chips for frequent OPD complaints (Fever, Cough, Headache, Loose Stools, etc.) + 1-tap duration picker (e.g. "3 days") + free-text input for extra details.
- **D-08: Follow-Ups Table & Chips (No Doctor-Side Reminder Config)** — **Reversibility:** costly — schema migration for `follow_ups` table.
  - Doctor selects follow-up interval using quick chips: 3 Days, 5 Days, 1 Week, 2 Weeks, Custom date.
  - Printed on prescription PDF and persisted to a dedicated `follow_ups` table (`patient_id`, `visit_id`, `follow_up_date`, `created_at`).
  - No communication/reminder configuration in doctor view; Phase 5 will consume these records for automated reminders.
- **D-09: Structured Investigations Advised Field** — **Reversibility:** costly — schema and integration with Phase 4.
  - Autocomplete and quick chips for common tests (CBC, Blood Sugar, HbA1c, Thyroid, Lipid Profile, X-ray) printed on prescription PDF and stored in visit data for Phase 4 lab routing.
- **D-10: Clinical File Attachment Dropzone** — **Reversibility:** costly — Supabase Storage bucket and access policies.
  - Dropzone supporting JPEG/PNG/PDF uploads (up to 10MB) stored in Supabase Storage with tenant-isolated signed URLs, visible in visit history.

### Prescription Builder & Drug Search
- **D-11: Central CDCI Flat Files Master Database** — **Reversibility:** one-way — database migration and NRCeS dataset schema.
  - Shared central medicine master for all clinics importing the 7 tab-separated (TSV) master files from official NRCeS/CDCI package into Supabase PostgreSQL.
  - Sub-100ms search using a materialized view / denormalized table with pg_trgm and tsvector GIN indexes.
- **D-12: Custom Medicines & Doctor Favorites** — **Reversibility:** costly — schema for `doctor_custom_medicines`.
  - Doctors can enter a custom medicine by simply typing its name without mandatory brand/composition/strength.
  - Saved to `doctor_custom_medicines` linked to `doctor_id` and auto-suggested as Quick Favorites in future visits.
- **D-13: Fast-Click Indian OPD Dosage Chips** — **Reversibility:** reversible.
  - 1-tap buttons for frequency (`1-0-1`, `1-0-0`, `0-0-1`, `1-1-1`, `SOS`), food relation (`After food`, `Before food`), and duration (`3d`, `5d`, `7d`, `10d`, `1m`).
  - Prescriptions record frequency and duration only, leaving package quantity calculation to the dispensing pharmacy.
- **D-14: Informational Allergy Banner Above Prescription Builder** — **Reversibility:** reversible.
  - High-visibility banner displaying patient's recorded allergies prominently above the prescription builder for manual clinical review without automated blocking.
- **D-15: Named Prescription Protocol Templates** — **Reversibility:** costly — schema for `doctor_prescription_templates`.
  - Doctors can save current prescriptions as named templates (e.g. "Viral Fever Protocol", "Post-Extraction Dental") and apply them from a dropdown with 1 click, editing items before signing.
- **D-16: Hybrid Medicine Name Display on PDF** — **Reversibility:** reversible.
  - Printed PDF displays Brand Name prominent with active generic composition / salt underneath (compliant with Indian NMC guidelines).
  - For custom medicines where composition is unknown, prints exactly as typed.
- **D-17: Versioned Prescription Revisions (v2, v3)** — **Reversibility:** one-way — database schema and PDF document tracking.
  - Editing an issued prescription increments version number (`v2`, `v3`), creates an audit record with timestamp & reason, and marks the new PDF as "Amended on [Date]".
- **D-18: 1-Tap Repeat Previous Prescription** — **Reversibility:** reversible.
  - Button pre-populates all medicines and dosages from the patient's last prescription into the current draft with one click.
- **D-19: Diet, Lifestyle & Clinical Advice Chips** — **Reversibility:** reversible.
  - 1-tap preset chips for common advice (Warm saline gargle, Steam inhalation, Plenty of fluids, Avoid oily/cold food, Diabetic diet, Soft diet) plus free-text advice textarea.
- **D-20: Profile Credentials & Electronic Signature Stamping** — **Reversibility:** costly — doctor profile fields and PDF renderer.
  - Doctor profile stores Full Name, Medical Qualifications (MBBS, MD, BDS, etc.), and Medical Council Registration Number (e.g. MMC/12345), plus optional uploaded signature image.
  - "Sign & Finalize" automatically stamps credentials onto the prescription footer.

### Diagnosis Coding & Terminology
- **D-21: Curated OPD Terminology Master (ICD-11 & SNOMED CT)** — **Reversibility:** one-way — database schema and terminology tables.
  - Pre-seeded database of ~1,500 common Indian outpatient diagnoses mapped with ICD-11 codes and SNOMED CT concept IDs, with sub-100ms search.
- **D-22: Simple Row Structure for Diagnoses** — **Reversibility:** costly — schema for `consultation_diagnoses`.
  - Doctors add multiple diagnoses as rows. No primary/secondary or provisional/confirmed distinction required.
- **D-23: Code Display in Search Dropdown Only, Clean Names on PDF** — **Reversibility:** reversible.
  - Search dropdown displays clinical term with subtle code badge (ICD-11 / SNOMED CT), but generated PDF displays clean clinical names.
- **D-24: Optional 'Save to Chronic Conditions' Toggle** — **Reversibility:** costly — synchronization with `patients.chronic_conditions`.
  - Checkbox on diagnosis row allows auto-updating the patient's ongoing `chronic_conditions` list upon visit completion.
- **D-25: Specialty Quick Chips & Custom Diagnosis Auto-Save** — **Reversibility:** costly — schema for `doctor_custom_diagnoses`.
  - Top 6-8 frequent diagnoses for the active specialty displayed as 1-tap chips above search.
  - Custom typed diagnoses are auto-saved to `doctor_custom_diagnoses` for future autocomplete.
- **D-26: Explicit Structured Diagnosis Columns (No ICD-10)** — **Reversibility:** one-way — table columns.
  - Columns: `diagnosis_name` (required), `snomed_concept_id` (optional), `icd11_code` (optional), `is_custom` (boolean), `notes` (optional inline comment).
  - ICD-10 is omitted in favor of modern ICD-11 and SNOMED CT.

### Provisional Billing & Invoicing
- **D-27: Billing Formally Moved to Phase 3A** — **Reversibility:** costly — roadmap adjustment.
  - Billing & Invoicing is descoped from Phase 3 and scheduled as a dedicated sub-phase: **Phase 3A**.
  - Completing a consultation moves the visit directly to `completed`.
  - In Phase 3A, the billing workflow and queue states will be revisited.

### Prescription PDF & Clinic Letterhead
- **D-28: Dual Letterhead Printing Modes** — **Reversibility:** reversible.
  - Configurable toggle between "Print on Blank Paper" (renders full clinic logo, clinic name, address, contact, and doctor header) and "Print on Pre-Printed Letterhead" (offsets top/bottom margins to print directly on physical clinic pads).
- **D-29: Server-Side React-PDF (@react-pdf/renderer) & Supabase Storage** — **Reversibility:** one-way — PDF generation stack.
  - PDF rendered server-side via `@react-pdf/renderer`, archived in Supabase Storage with secure signed URLs, in-app preview modal, and 1-click Download / Print actions.
- **D-30: In-App Download & Print Only (WhatsApp Deferred to Phase 5)** — **Reversibility:** reversible.
  - Strictly in-app PDF download and local print dialog; automated and manual WhatsApp sharing deferred to Phase 5.
- **D-31: Standard Indian Clinical PDF Layout Order** — **Reversibility:** reversible.
  - Header → Patient Bar & Vitals → Chief Complaints & Diagnosis → Rx Medication Table (Brand + Generic, Frequency, Food, Duration) → Advised Investigations → Clinical Advice → Follow-up Date → Doctor Sign & Reg No Footer.

### Master Databases & Pre-Phase Execution
- **D-32: Plan 03-01 Dedicated Foundation Plan** — **Reversibility:** costly — plan execution structure.
  - First plan of Phase 3 handles schema migrations, CDCI TSV ingestion scripts, terminology seeding, materialized views with trigram indexes, and sub-100ms benchmark verification before any UI is built.
- **D-33: Source Data Placement & Hybrid Terminology Seeding** — **Reversibility:** one-way — repository file layout.
  - Raw CDCI TSV files placed in `supabase/seed-data/cdci/`.
  - Curated diagnosis dataset committed in `supabase/seed-data/terminology/diagnoses.json` (~1,500 entries) for zero-latency local seeding, with an optional CLI enrichment script querying the WHO ICD API.
- **D-34: Dual-Mode Seed Script for Testing & CI** — **Reversibility:** reversible.
  - Seed script supports full CDCI import for staging/production and a fast test fixture (~200 common drugs) for Vitest automated test suites.

### the agent's Discretion
- Visual spacing, badge variants, and icon choices adhering to `DESIGN.md` light theme tokens.
- Exact table schema design for the 7 CDCI tables respecting the NRCeS flat file structure.
- Implementation details of the SVG odontogram tooth chart component.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Clinical Architecture & Standards
- `AGENTS.md` §4.2 (Common clinical workflows), §18 (Clinical data rules - immutability, draft vs finalized, audit revisions), §21 (Files & documents - Supabase Storage signed URLs)
- `DESIGN.md` (Healthcare blue `#1769E0`, Inter typography, light-only theme, 44px mobile touch targets, cards, drawers)
- `docs/clinic-management-prd.md` §4.4 (Specialty Templates), §4.5 (E-Prescriptions), §4.6 (Diagnosis & Visit Management), §4.10 (Billing & Invoicing)

### Data Layer & Existing Schema
- `supabase/migrations/000006_appointments_queue_waitlist.sql` (Existing `visits` and `queue_tokens` table schema and status constraints)
- `supabase/migrations/000003_patients_audit_consent.sql` (Existing patient table schema with allergies & conditions)
- `lib/audit/audit.ts` (Mandatory audit logging on clinical record access and modification)
- `lib/permissions/` (Role permissions for Doctor, Nurse, Receptionist, Admin)

### External Standards & Masters
- Official NRCeS / CDCI Flat Files Package (7 TSV files for Indian drugs)
- WHO ICD-11 Core Reference & SNOMED CT Indian Primary Care Terminology (NRCeS)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `components/ui/button.tsx`, `components/ui/badge.tsx`, `components/ui/card.tsx`, `components/ui/input.tsx`, `components/ui/field.tsx`, `components/ui/modal.tsx`, `components/ui/dropdown.tsx`: Core UI primitives from Phase 02.1.
- `components/layout/Sidebar.tsx`, `components/layout/Header.tsx`: Responsive application shell.
- `lib/supabase/client.ts` and `lib/supabase/server.ts`: Cookie-based SSR Supabase clients.
- `lib/audit/audit.ts`: `recordAudit` for logging clinical modifications and amendments.

### Established Patterns
- Server Actions for mutations (`features/patients/actions.ts`, `features/visits/actions.ts`).
- Zod runtime schema validation.
- Row Level Security (RLS) on all tenant-owned tables.
- Materialized search view pattern with pg_trgm for sub-100ms text search.

### Integration Points
- `app/(dashboard)/visits/[id]/` or `app/(dashboard)/consultation/[id]/`: New doctor consultation workspace.
- `app/(dashboard)/queue/`: Live queue reflects status transitions (`waiting` → `in_consultation` → `completed`).
- `app/(dashboard)/patients/[id]/`: Patient detail visit history timeline links to completed consultation summaries and PDF prescriptions.

</code_context>

<specifics>
## Specific Ideas
- Odontogram tooth chart for dentists: Interactive visual SVG odontogram (FDI / Universal numbering) toggling condition tags per tooth.
- Pediatric growth badges: Display WHO percentiles for weight/height/head circumference.
- Quick dosage chips (`1-0-1`, `1-1-1`, `1-0-0`, `0-0-1`, `SOS`) enabling complete drug prescription in < 5 seconds.
- Print Letterhead Toggle: Instant switch between blank paper print (with clinic logo/header) and physical letterhead print (margin offsets).

</specifics>

<deferred>
## Deferred Ideas
- **Phase 3A: Billing & Invoicing**: Consultation fees, procedure charges, Cash/UPI/Card payment recording, and PDF receipts.
- **Phase 5: Automated Communications**: SMS/WhatsApp appointment reminders and automatic delivery of prescription PDFs via WhatsApp bot.
- **Phase 5: AI Assist**: AI visit notes summarization and shorthand expansion (`REQ-ai-features`).
- **Post-Launch Specialties**: OB/GYN, Dermatology, and Orthopedics specialty templates.
- **Private Doctor Notes**: Separate private doctor-only notes excluded from printed PDFs (not needed for now).

</deferred>

---

*Phase: 3-Consultation & Prescribing*  
*Context gathered: 2026-10-09*
