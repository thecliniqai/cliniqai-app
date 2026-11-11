# Phase 3: Consultation & Prescribing - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.  
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-09  
**Phase:** 3-Consultation & Prescribing  
**Areas discussed:** Consultation UI & Specialty Templates, Prescription Builder & Drug Search, Diagnosis Coding & Terminology, Provisional Billing & Invoicing, Prescription PDF & Clinic Letterhead, Master Databases & Pre-Phase Execution  

---

## 1. Consultation UI & Specialty Templates

| Decision Item | Options Presented | Selected | Notes |
|---|---|---|---|
| Workspace Layout | (1) Single continuous fast-scrolling page with sticky section jumps (Vitals → Chief Complaints & History → Exam / Specialty → Diagnosis → Rx).<br>(2) Tabbed multi-step wizard.<br>(3) Two-column split layout. | **Single continuous page** | Selected for sub-3-minute OPD consultations with zero tab switching. |
| Vitals Recording | (1) Shared vitals block: Nurse records in 'With Nurse', or Doctor in consultation; abnormal flags highlighted.<br>(2) Doctor-only entry.<br>(3) Strict nurse gate. | **Shared vitals block** | Flexible OPD triage; abnormal flags alert clinician. |
| Specialty Templates Architecture | (1) Configuration-driven JSON schema with specialty widgets in `jsonb specialty_data`.<br>(2) Markdown template stamps.<br>(3) Fixed database columns & hardcoded components. | **JSON schema + widgets** | Extensible without full application releases. |
| Autosave & Finalization | (1) Background debounced auto-save + Complete & Sign button.<br>(2) Manual save draft only.<br>(3) Auto-finalize on exit. | **Debounced autosave + Complete & Sign** | User clarified: Doctor must be able to fetch and edit the record even after Complete & Sign off; it should not be locked out permanently. Edits create versioned snapshots in `visit_revisions`. |
| Past Visit Reference | (1) Slide-over history drawer / collapsible panel with 1-click repeat.<br>(2) Inline past visit card.<br>(3) Separate navigation to patient profile. | **Slide-over history drawer** | Quick access to longitudinal context without leaving consultation. |
| Chief Complaint Input | (1) Hybrid quick chips + duration + free text.<br>(2) Free-text textareas only.<br>(3) Structured medical checklist. | **Hybrid quick chips + duration** | Rapid symptom entry for OPD speed. |
| Amendment Tracking | (1) Versioned snapshot model (`visit_revisions`).<br>(2) In-place overwrite.<br>(3) Append-only addendum. | **Versioned snapshot model** | Preserves full audit history for compliance while keeping primary record editable. |
| AI Note Drafting | (1) Draft from shorthand button.<br>(2) Inline autocomplete.<br>(3) Defer AI notes to Phase 5. | **Defer AI notes to Phase 5** | Keep Phase 3 focused on manual structured entry and chips; AI assist delivers in Phase 5 (`REQ-ai-features`). |
| Specialty Template Assignment | (1) Doctor profile sets default specialty with quick visit dropdown switcher.<br>(2) Clinic-wide single specialty setting.<br>(3) Mandatory prompt on every visit. | **Doctor profile default + visit dropdown** | Default preselected for Quick Start; multi-specialty doctors can switch per visit without altering profile default. |
| Dental Specialty UI | (1) Interactive visual odontogram (FDI / Universal numbering tooth chart) with condition tags.<br>(2) Tabular tooth finding list.<br>(3) Text notes with procedure chips. | **Interactive visual odontogram** | High-value clinical tool for dentists. |
| Pediatrics Specialty Scope | (1) Pediatric essentials: birth history, growth measurements with WHO percentile badge, and IAP immunization checklist.<br>(2) Lightweight vitals only.<br>(3) Full multi-curve growth charts. | **Pediatric essentials** | Birth history, growth with WHO percentile badges, IAP vaccine checklist. |
| Follow-Up Scheduling | (1) Quick chips (3d, 5d, 1w, 2w, custom) printed on PDF, stored in `follow_ups` table.<br>(2) Prescription advice text only.<br>(3) Reception handoff task. | **Quick chips + dedicated follow_ups table** | User specified: no communication/reminder config exposed to doctor; Phase 5 will consume these records. |
| Launch Specialties | (1) GP, Dental, and Pediatrics now; defer OB/GYN, Derm, Ortho.<br>(2) Full suite of 6 specialties.<br>(3) Text fields for all. | **GP, Dental, and Pediatrics for Phase 3** | Focus on 3 core specialties with deep widget support; defer others to post-launch. |
| Note Visibility Split | (1) Internal doctor notes vs patient-facing advice.<br>(2) Single combined notes. | **Single notes section** | User confirmed: no private vs public note split needed right now. |
| Investigations Advised | (1) Structured field with autocomplete/chips printed on PDF & stored for Phase 4.<br>(2) Plain text only.<br>(3) Exclude from Phase 3. | **Structured field with chips** | Printed on PDF and saved for Phase 4 lab routing. |
| Clinical File Attachments | (1) File attachment dropzone (JPEG/PNG/PDF up to 10MB) in Supabase Storage with signed URLs.<br>(2) Exclude from Phase 3.<br>(3) External links only. | **File attachment dropzone** | Allows uploading photos/reports directly in consultation. |

---

## 2. Prescription Builder & Drug Search

| Decision Item | Options Presented | Selected | Notes |
|---|---|---|---|
| Drug Catalog Source | (1) Shared central medicine master using NRCeS/CDCI Flat Files Package (7 TSVs in PostgreSQL) with sub-100ms search + Custom Medicine entry.<br>(2) Third-party drug API.<br>(3) Blank manual catalog. | **NRCeS/CDCI 7 TSV master** | User specified: Shared central master across clinics, sub-100ms search, custom medicines saved to `doctor_custom_medicines` and auto-suggested as favorites. |
| Dosage Entry UX | (1) Fast-click chip preset row (`1-0-1`, `After food`, `5d`).<br>(2) Structured select dropdowns.<br>(3) Single-line text parser. | **Fast-click chip preset row** | Takes < 5 seconds per prescribed drug. |
| Allergy Warning Behavior | (1) Prominent warning card with 1-click override reason.<br>(2) Hard blocking modal.<br>(3) Informational banner only above prescription builder. | **Informational banner only** | Prominently displays patient allergies above prescription builder for clinician manual review without automated blocking. |
| Prescription Protocols | (1) Named protocol templates with 1-click apply.<br>(2) Clinic-wide admin templates.<br>(3) Smart auto-suggestions. | **Named protocol templates with 1-click apply** | Per-doctor templates (e.g., 'URTI Protocol') editable before signing. |
| CDCI Search Indexing | (1) Materialized search view with pg_trgm & tsvector GIN indexes.<br>(2) Multi-table joins live.<br>(3) Client cache. | **Materialized view with pg_trgm & tsvector** | Sub-100ms response time on fuzzy and prefix search. |
| Brand vs Generic Display | (1) Hybrid display: Brand Name with generic composition underneath; custom medicines as typed.<br>(2) Generic/salt only.<br>(3) Brand name only. | **Hybrid display (custom medicines as typed)** | Meets Indian NMC guidelines and preserves custom medicine names exactly as entered. |
| Prescription Amendments | (1) Versioned prescription (`v2`, `v3`) with audit record and timestamp.<br>(2) In-place overwrite.<br>(3) Cancel and reissue. | **Versioned prescription (v2, v3)** | Preserves previous PDF as superseded; new PDF marked 'Amended on [Date]'. |
| Repeat Previous Prescription | (1) 1-tap 'Repeat Previous Rx' button.<br>(2) Selective checklist drawer.<br>(3) Manual re-entry. | **1-tap 'Repeat Previous Rx' button** | Pre-populates all medications and dosages with 1 click; doctor can adjust durations or items. |
| Clinical & Lifestyle Advice | (1) Quick-tap advice chips + custom text.<br>(2) Free-text textarea only.<br>(3) Dropdown checklist. | **Quick-tap advice chips + custom text** | Rapid entry for common OPD instructions (saline gargle, steam, fluids, etc.). |
| Doctor Sign-Off & Credentials | (1) Profile credentials (Name, Degree, Reg No) + optional uploaded signature image.<br>(2) Draw signature per visit.<br>(3) Text-only. | **Profile credentials + signature image** | 1-click 'Sign & Finalize' stamps credentials onto PDF footer. |
| Medication Total Quantity | (1) Auto-calculate with override.<br>(2) Manual quantity entry.<br>(3) Duration and frequency only. | **Duration and frequency only** | Matches Indian OPD practice; pharmacy calculates dispensing package quantity. |

---

## 3. Diagnosis Coding & Terminology

| Decision Item | Options Presented | Selected | Notes |
|---|---|---|---|
| Terminology Dataset | (1) Curated OPD master (~1,500 common diagnoses mapped with ICD-11 & SNOMED CT) with sub-100ms search + free-text custom diagnosis.<br>(2) Strict coding required.<br>(3) Free-text only. | **Curated OPD master (ICD-11 & SNOMED CT)** | Pre-seeded dataset with sub-100ms search and plain text custom entry. |
| Diagnosis Row Structure | (1) Multi-diagnosis list with 'Primary' badge and provisional/confirmed toggle.<br>(2) Single diagnosis only.<br>(3) Multiple diagnoses as rows without primary/secondary or provisional/confirmed flags. | **Multiple diagnoses as rows (no flags)** | User clarified: Doctor can add multiple diagnoses as rows, no primary/secondary or provisional/confirmed distinction needed. |
| Code Display in UI & PDF | (1) Codes visible in search dropdown only, clean names on patient PDF.<br>(2) Print codes on prescription.<br>(3) Hide codes completely in UI. | **Codes in search dropdown, clean names on PDF** | Preserves patient readability while ensuring clinical precision during search. |
| Chronic Condition Linking | (1) Optional 'Save to Chronic Conditions' toggle on row.<br>(2) Always auto-sync.<br>(3) Separate manual step. | **Optional toggle on diagnosis row** | Auto-updates patient profile `chronic_conditions` on visit completion if checked. |
| Specialty Diagnosis Chips | (1) Specialty-curated quick chips + full catalog search.<br>(2) Global search only.<br>(3) Strict specialty filter. | **Specialty-curated quick chips + full search** | 6-8 frequent condition chips per specialty for 1-tap entry. |
| Custom Diagnosis Reuse | (1) Auto-save to `doctor_custom_diagnoses`.<br>(2) Save to current visit only.<br>(3) Admin approval required. | **Auto-save to doctor custom diagnoses** | Custom entries become immediately available in that doctor's future autocomplete. |
| Inline Diagnosis Notes | (1) Optional inline note per diagnosis.<br>(2) Diagnosis title only.<br>(3) Mandatory severity dropdown. | **Optional inline note per diagnosis** | Subtle field for specific clinical remarks (e.g. 'Uncontrolled, HbA1c 8.9%'). |
| Table Columns | (1) Explicit structured columns (`diagnosis_name`, `snomed_concept_id`, `icd11_code`, `is_custom`, `notes`).<br>(2) Generic JSONB metadata.<br>(3) Name text only. | **Structured columns (no ICD-10)** | User specified: ICD-10 omitted in favor of modern ICD-11 and SNOMED CT. Structured columns ready for FHIR R4. |

---

## 4. Provisional Billing & Invoicing

| Decision Item | Options Presented | Selected | Notes |
|---|---|---|---|
| Billing Scope in Phase 3 | (1) Lightweight per-visit billing in Phase 3.<br>(2) Descope billing from Phase 3.<br>(3) Consultation fee recording only. | **Descope billing from Phase 3; Move to Phase 3A** | User decided: Move Billing to dedicated **Phase 3A** after Phase 3 is completed. Visiting completes directly to `completed`. |

---

## 5. Prescription PDF & Clinic Letterhead

| Decision Item | Options Presented | Selected | Notes |
|---|---|---|---|
| Letterhead Modes | (1) Configurable: Blank paper mode (full digital logo/header) AND Pre-printed pad mode (margin offsets).<br>(2) Digital letterhead only.<br>(3) Plain text document. | **Dual letterhead modes (Blank paper vs Pre-printed pad)** | Adapts to clinics using physical printed pads or plain A4 paper. |
| PDF Generation Tech | (1) Server-side React-PDF (`@react-pdf/renderer`) + Supabase Storage.<br>(2) Browser Print CSS (`window.print()`).<br>(3) Client-side canvas (`html2canvas` + `jspdf`). | **Server-side React-PDF + Supabase Storage** | Deterministic A4 rendering on server, archived with signed URLs, in-app modal preview. |
| Sharing / WhatsApp | (1) 1-click WhatsApp launcher (`wa.me`) + Download & Print.<br>(2) Download and Print buttons only.<br>(3) QR code on prescription. | **Download and Print buttons only** | Strictly in-app PDF download and local print dialog; WhatsApp integration deferred to Phase 5. |
| PDF Section Layout | (1) Standard Indian Clinical Flow: Header → Patient Bar & Vitals → Chief Complaints & Diagnosis → Rx Table → Advised Investigations → Clinical Advice → Follow-up Date → Doctor Sign Footer.<br>(2) Compact 2-column layout.<br>(3) Medication-focused sheet. | **Standard Indian Clinical Flow** | Clean, familiar medical formatting. |

---

## 6. Master Databases & Pre-Phase Execution

| Decision Item | Options Presented | Selected | Notes |
|---|---|---|---|
| Plan Execution Sequence | (1) Plan 03-01 Dedicated Foundation Plan (schema, CDCI ingestion, terminology seeding, materialized views, sub-100ms benchmarks).<br>(2) Standalone manual seed script outside GSD.<br>(3) Lazy seed on app init. | **Plan 03-01 Dedicated Foundation Plan** | Ensures data layer and performance benchmarks are verified before building UI. |
| Sourcing & Repository Layout | (1) Local seed data directories (`supabase/seed-data/cdci/` and `supabase/seed-data/terminology/`).<br>(2) Cloud storage download script. | **Local seed data directories** | User creates `/supabase/seed-data/cdci/` and adds 7 TSV files. Diagnoses seeded via curated JSON + optional WHO ICD CLI enrichment script. |
| Test / CI Dataset Strategy | (1) Dual-mode seed script (Full CDCI vs lightweight ~200 drug test fixture).<br>(2) Full dataset in all environments. | **Dual-mode seed script** | Fast execution for Vitest automated test suites; full dataset for staging and production. |

---

## the agent's Discretion
- Visual spacing and component composition adhering strictly to `DESIGN.md`.
- Exact relational table schema for the 7 CDCI tables matching NRCeS flat file specs.
- Interactive SVG implementation of the Dental Odontogram.

## Deferred Ideas
- **Phase 3A: Billing & Invoicing**: Formally deferred to an inserted sub-phase directly following Phase 3.
- **Phase 5: Automated Communications**: WhatsApp bot notifications and automated delivery of prescription PDFs.
- **Phase 5: AI Assist**: AI visit summarization and shorthand expansion (`REQ-ai-features`).
- **Post-Launch Specialties**: OB/GYN, Dermatology, and Orthopedics templates.
