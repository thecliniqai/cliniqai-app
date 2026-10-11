# Phase 3: Consultation & Prescribing - Research

**Completed:** 2026-10-11  
**Phase Status:** Ready for Planning  
**Target:** Outpatient Consultation Workspace, Specialty Templates (GP, Dental, Pediatrics), Curated Terminology Search (ICD-11 & SNOMED CT), India CDCI Drug Master, Electronic Prescriptions, Server-Side React-PDF Letterhead Engine, and Post-Sign-Off Audit Trail.

---

## 1. User Constraints & Locked Decisions

The following architectural and clinical constraints were confirmed during `/gsd-discuss-phase` and recorded in `03-CONTEXT.md`. All downstream plans must strictly adhere to these boundaries:

<user_constraints>

### Workspace & UX Architecture
- **D-01 (Single-Page Fast-Scrolling SOAP Workspace):** Continuous fast-scrolling page with sticky section jumps (`Vitals` → `Complaints & History` → `Exam / Specialty` → `Diagnosis` → `Rx` → `Advice & Follow-up`). Zero tab switching; designed for high-throughput Indian OPD clinics (3-minute target per visit).
- **D-02 (Shared Vitals Block):** Nurse or Doctor can record vitals (`BP`, `Pulse`, `SpO2`, `Temperature`, `Weight`, `Height`, `BMI`). Abnormal readings are visually badged (BP > 140/90 or < 90/60, SpO2 < 95%, Temp > 99.5°F).
- **D-03 (Configuration-Driven Specialty Templates):** JSON-schema driven widgets saved in `visits.specialty_data` (JSONB). Core launch:
  1. **General Physician:** Systemic review (CVS, RS, PA, CNS) and general physical signs.
  2. **Dental:** Interactive visual SVG Odontogram (FDI 11–48 adult, 51–85 child) with condition tags (Decay, Crown, Missing, RCT, Extraction) + procedure notes.
  3. **Pediatrics:** Birth history (gestational age, birth weight, delivery type), growth percentiles (Weight, Height, Head Circumference with WHO percentiles), and IAP immunization schedule checklist (given vs due).
- **D-04 (Doctor Profile Default & Visit Switcher):** Doctor profile defines default specialty for Quick Start; consultation header allows switching specialty per visit without changing profile defaults.
- **D-05 (Debounced Auto-Save & Post-Sign-Off Revision Snapshots):** Auto-saves draft in `in_consultation` state. "Complete & Sign" transitions visit to `completed`. Post-sign-off edits save immutable snapshots in `visit_revisions` table with audit trail ("Amended by Dr. X on [date]").
- **D-06 (Longitudinal History Side Panel):** Collapsible drawer/panel showing past visits, previous prescriptions, and lab summaries with 1-click "Repeat previous Rx" and "Copy notes" actions.
- **D-07 (Hybrid Complaints):** Quick-tap chips for frequent OPD complaints (Fever, Cough, Cold, Headache, etc.) + 1-tap duration selector + free-text input.
- **D-08 (Follow-Ups Table):** Quick chips (3d, 5d, 1w, 2w, custom) persisted to dedicated `follow_ups` table (`patient_id`, `visit_id`, `follow_up_date`, `status`). No reminder config in doctor view (Phase 5 will consume these records).
- **D-09 (Structured Investigations Advised):** Autocomplete and quick chips (CBC, Blood Sugar, HbA1c, Thyroid, Lipid, X-ray) printed on PDF and stored in visit data for Phase 4 lab routing.
- **D-10 (Clinical File Dropzone):** JPEG/PNG/PDF uploads (up to 10MB) stored in Supabase Storage with tenant-isolated signed URLs.

### Prescription & Drug Master Architecture
- **D-11 (Central CDCI Drug Master Database):** Ingest 7 official TSVs from NRCeS / CDCI Flat Files Package into Supabase PostgreSQL. Sub-100ms fuzzy search powered by materialized search view with `pg_trgm` and `tsvector` GIN indexes.
- **D-12 (Custom Medicines & Doctor Favorites):** Unrestricted custom entry saved to `doctor_custom_medicines` and boosted as Quick Favorites in future visits.
- **D-13 (Indian OPD Dosage Chips):** 1-tap buttons for frequency (`1-0-1`, `1-0-0`, `0-0-1`, `1-1-1`, `SOS`), food relation (`After food`, `Before food`), and duration (`3d`, `5d`, `7d`, `10d`, `1m`). Prescriptions record frequency and duration only.
- **D-14 (Informational Allergy Banner):** Patient allergies prominently displayed above the Rx builder for manual clinician review without blocking modal dialogs.
- **D-15 (Named Prescription Protocol Templates):** Doctors save current prescriptions as named templates (e.g. "Viral Fever Protocol") and apply them via 1-click dropdown.
- **D-16 (Hybrid Medicine Name Display on PDF):** Prominent Brand Name with active Generic composition / salt underneath (NMC compliant). For custom medicines, printed as typed.
- **D-17 (Versioned Prescription Revisions):** Editing an issued prescription increments version (`v2`, `v3`), logs audit record with reason, and stamps PDF as "Amended on [Date]".
- **D-18 (1-Tap Repeat Previous Prescription):** Pre-populates medicines from patient's previous visit into draft Rx.
- **D-19 (Diet, Lifestyle & Advice Chips):** 1-tap preset chips (Warm saline gargle, Steam inhalation, Plenty of fluids, Diabetic diet, etc.) + free-text advice textarea.
- **D-20 (Profile Credentials & Signature Stamping):** Doctor Full Name, Qualifications (MBBS, MD, BDS), Medical Council Registration Number, and optional uploaded signature image stamped onto prescription footer.

### Terminology & Diagnosis
- **D-21 (Curated OPD Terminology Master):** Pre-seeded database of ~1,500 common Indian OPD conditions mapped with ICD-11 codes and SNOMED CT concept IDs (`opd_diagnoses`).
- **D-22 (Simple Row Structure):** Diagnoses added as simple rows in `consultation_diagnoses`. No primary/secondary or provisional/confirmed distinction required.
- **D-23 (Code Display in Search Dropdown Only):** Subtle ICD-11 / SNOMED CT badges in search dropdown; generated PDF prints clean clinical names.
- **D-24 (Chronic Conditions Sync Toggle):** Checkbox on diagnosis row allows auto-updating patient's `chronic_conditions` list upon completion.
- **D-25 (Specialty Quick Chips & Custom Diagnosis Auto-Save):** Top 6-8 frequent diagnoses for active specialty displayed as 1-tap chips; custom diagnoses auto-saved to `doctor_custom_diagnoses`.
- **D-26 (Explicit Structured Diagnosis Columns):** `diagnosis_name` (required), `snomed_concept_id` (optional), `icd11_code` (optional), `is_custom` (boolean), `notes` (optional). No ICD-10.

### PDF & Letterhead
- **D-28 (Dual Letterhead Printing Modes):** Configurable toggle between "Print on Blank Paper" (full clinic logo, header, contact) and "Print on Pre-Printed Letterhead" (margin offsets to fit physical clinic stationery).
- **D-29 (Server-Side React-PDF & Supabase Storage):** Server-side `@react-pdf/renderer`, archived in Supabase Storage bucket `prescriptions`, secure signed URLs, in-app preview modal, 1-click print / download.
- **D-30 (In-App Download & Print Only):** WhatsApp delivery formally deferred to Phase 5.
- **D-31 (Standard Indian Clinical PDF Layout):** Header → Patient Bar & Vitals → Chief Complaints & Diagnosis → Rx Medication Table → Advised Investigations → Clinical Advice → Follow-up Date → Doctor Signature & Reg No Footer.

### Scope Adjustments
- **D-27 (Billing Formally Moved to Phase 3A):** Billing & Invoicing is descoped from Phase 3 into Phase 3A. Consultation completion moves visit directly to `completed`.
- **D-32 (Plan 03-01 Dedicated Foundation Plan):** First plan of Phase 3 handles schema migrations, CDCI TSV ingestion, terminology seeding, materialized views with trigram indexes, and sub-100ms benchmark verification before UI is built.
- **D-33 (Source Data Placement):** Raw CDCI TSVs located in `supabase/seed-data/cdci/`. Curated diagnosis dataset committed in `supabase/seed-data/terminology/diagnoses.json`.
- **D-34 (Dual-Mode Seed Script):** Full CDCI import for staging/prod (`npm run seed:cdci`), fast test fixture (~200 common drugs) for automated Vitest test suites.

</user_constraints>

---

## 2. Phase Requirements Mapping

| Requirement ID | Scope Summary | Research Findings & Architecture Strategy |
|---|---|---|
| `REQ-specialty-templates` | Generic core visit record (chief complaint, HPI, exam notes, vitals, diagnosis, Rx, follow-up) + JSON-schema driven specialty template layer for GP, Dental, and Pediatrics. | Implement generic SOAP columns on `visits` (`vitals`, `chief_complaints`, `clinical_notes`, `advice`, `investigations_advised`) and `specialty_data` (JSONB). Add TypeScript discriminated union for `GeneralPhysicianData`, `DentalSpecialtyData` (SVG Odontogram with FDI 11–48 / 51–85 numbering), and `PediatricsSpecialtyData` (gestational history, WHO percentiles via embedded LMS curves, IAP immunization checklist). Profile stores default specialty with in-consultation dropdown switcher. |
| `REQ-diagnosis-visit-management` | ICD-11 & SNOMED CT terminology search (~1,500 curated Indian OPD master), multiple diagnoses as rows, clean names on PDF, chronic conditions sync, visit status progression (`waiting` → `in_consultation` → `completed`), post-sign-off edits with `visit_revisions` snapshots. | Seed ~1,500 curated OPD conditions into `opd_diagnoses` with `pg_trgm` GIN index for sub-100ms fuzzy search. Add `consultation_diagnoses` table with tenant isolation. Hook status transitions into `/queue` and Server Actions. Build `visit_revisions` table that saves immutable JSON snapshots with mandatory amendment reasons when editing completed visits. |
| `REQ-e-prescriptions` | NRCeS / CDCI Flat Files Package (7 TSV files) master drug database in Supabase, materialized search view with `pg_trgm` & `tsvector` GIN indexes for sub-100ms fuzzy search, custom medicines saved to `doctor_custom_medicines`, Indian OPD dosage chips (`1-0-1`, food, duration), versioned Rx (`v2`, `v3`), profile credentials & signature stamping, server-side `@react-pdf/renderer` with Supabase Storage signed URLs, blank paper vs pre-printed letterhead mode. | Ingest the 7 CDCI TSVs into relational tables (`cdci_brands`, `cdci_generics`, `cdci_products`, etc.) and compile a denormalized `cdci_medicines_search` table/view with GIN trigram indexes on `brand_name` and `generic_name`. Build dosage chip selectors (`1-0-1`, `After food`, `5 days`). Configure `@react-pdf/renderer` in `next.config.ts` (`serverExternalPackages`). Implement dual letterhead layout (margin offsets for physical pads vs full branding). Upload generated PDF to Supabase Storage bucket `prescriptions` and return signed URLs. |

---

## 3. Database Schema & Migration Architecture

### 3.1 Migration Strategy (`000007_consultation_prescriptions_cdci.sql`)

All Phase 3 data structures will be applied via a consolidated, transactional migration file: `supabase/migrations/000007_consultation_prescriptions_cdci.sql`.

#### Schema Alterations to `public.visits`
```sql
ALTER TABLE public.visits
ADD COLUMN IF NOT EXISTS vitals JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS chief_complaints JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS clinical_notes TEXT,
ADD COLUMN IF NOT EXISTS specialty TEXT NOT NULL DEFAULT 'general_physician'
    CHECK (specialty IN ('general_physician', 'dental', 'pediatrics')),
ADD COLUMN IF NOT EXISTS specialty_data JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS investigations_advised TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS advice TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS current_revision INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS signed_by UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_visits_specialty ON public.visits(tenant_id, specialty);
```

#### New Tables & Row Level Security

```sql
-- 1. Consultation Diagnoses (Simple row structure per D-22, D-26)
CREATE TABLE IF NOT EXISTS public.consultation_diagnoses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    diagnosis_name TEXT NOT NULL,
    snomed_concept_id TEXT,
    icd11_code TEXT,
    is_custom BOOLEAN NOT NULL DEFAULT false,
    is_chronic BOOLEAN NOT NULL DEFAULT false,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consultation_diagnoses_visit ON public.consultation_diagnoses(tenant_id, visit_id);
CREATE INDEX IF NOT EXISTS idx_consultation_diagnoses_patient ON public.consultation_diagnoses(tenant_id, patient_id);

-- 2. Prescriptions (Versioned electronic prescription per D-17)
CREATE TABLE IF NOT EXISTS public.prescriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES auth.users(id),
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'amended', 'cancelled')),
    letterhead_mode TEXT NOT NULL DEFAULT 'blank_paper' CHECK (letterhead_mode IN ('blank_paper', 'preprinted_letterhead')),
    pdf_storage_path TEXT,
    signed_at TIMESTAMPTZ,
    amendment_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_prescriptions_visit_version UNIQUE (tenant_id, visit_id, version)
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_visit ON public.prescriptions(tenant_id, visit_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON public.prescriptions(tenant_id, patient_id);

-- 3. Prescription Items (Individual medications per prescription)
CREATE TABLE IF NOT EXISTS public.prescription_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_id UUID NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
    medicine_name TEXT NOT NULL,
    generic_name TEXT,
    dose_form TEXT,
    dosage TEXT NOT NULL,          -- e.g. '1-0-1', '1-0-0', 'SOS'
    timing TEXT,                   -- e.g. 'After food', 'Before food'
    duration TEXT NOT NULL,        -- e.g. '5 days', '1 month'
    special_instructions TEXT,
    cdci_brand_id TEXT,
    cdci_generic_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prescription_items_prescription ON public.prescription_items(prescription_id, sort_order);

-- 4. Doctor Custom Medicines & Favorites (D-12)
CREATE TABLE IF NOT EXISTS public.doctor_custom_medicines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    medicine_name TEXT NOT NULL,
    generic_name TEXT,
    dose_form TEXT,
    default_dosage TEXT,
    default_timing TEXT,
    default_duration TEXT,
    use_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_doctor_custom_medicine UNIQUE (tenant_id, doctor_id, medicine_name)
);

CREATE INDEX IF NOT EXISTS idx_doctor_custom_medicines ON public.doctor_custom_medicines(tenant_id, doctor_id, use_count DESC);

-- 5. Doctor Custom Diagnoses (D-25)
CREATE TABLE IF NOT EXISTS public.doctor_custom_diagnoses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    diagnosis_name TEXT NOT NULL,
    specialty TEXT,
    use_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_doctor_custom_diagnosis UNIQUE (tenant_id, doctor_id, diagnosis_name)
);

CREATE INDEX IF NOT EXISTS idx_doctor_custom_diagnoses ON public.doctor_custom_diagnoses(tenant_id, doctor_id, use_count DESC);

-- 6. Doctor Prescription Templates (Named protocols per D-15)
CREATE TABLE IF NOT EXISTS public.doctor_prescription_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    template_name TEXT NOT NULL,
    specialty TEXT,
    items JSONB NOT NULL, -- Array of medication item definitions
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doctor_rx_templates ON public.doctor_prescription_templates(tenant_id, doctor_id);

-- 7. Visit Revisions (Immutable post-sign-off snapshot audit trail per D-05)
CREATE TABLE IF NOT EXISTS public.visit_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    amended_by UUID NOT NULL REFERENCES auth.users(id),
    amended_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    amendment_reason TEXT NOT NULL,
    snapshot JSONB NOT NULL, -- Full frozen snapshot of visit, vitals, diagnoses, prescriptions, specialty data
    CONSTRAINT uq_visit_revisions UNIQUE (visit_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_visit_revisions_visit ON public.visit_revisions(visit_id, revision_number DESC);

-- 8. Follow-ups Table (D-08)
CREATE TABLE IF NOT EXISTS public.follow_ups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES auth.users(id),
    follow_up_date DATE NOT NULL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'attended', 'cancelled', 'missed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_tenant_date ON public.follow_ups(tenant_id, follow_up_date);
CREATE INDEX IF NOT EXISTS idx_follow_ups_patient ON public.follow_ups(tenant_id, patient_id);

-- 9. Doctor Profiles & Clinic Letterhead Settings
ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS logo_url TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS registration_number TEXT,
ADD COLUMN IF NOT EXISTS letterhead_top_margin INTEGER DEFAULT 110,
ADD COLUMN IF NOT EXISTS letterhead_bottom_margin INTEGER DEFAULT 60;

ALTER TABLE public.memberships
ADD COLUMN IF NOT EXISTS qualifications TEXT,
ADD COLUMN IF NOT EXISTS medical_council_reg_no TEXT,
ADD COLUMN IF NOT EXISTS signature_url TEXT,
ADD COLUMN IF NOT EXISTS default_specialty TEXT DEFAULT 'general_physician';
```

#### RLS Policy Definition
Every tenant-owned table above (`consultation_diagnoses`, `prescriptions`, `prescription_items`, `doctor_custom_medicines`, `doctor_custom_diagnoses`, `doctor_prescription_templates`, `visit_revisions`, `follow_ups`) enables Row Level Security with standard tenant membership policies:
```sql
ALTER TABLE public.consultation_diagnoses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_custom_medicines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_custom_diagnoses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_prescription_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;

-- Standard tenant isolation policies using public.current_user_tenant_ids()
CREATE POLICY "consultation_diagnoses_tenant_isolation" ON public.consultation_diagnoses
    FOR ALL TO authenticated
    USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
    WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "prescriptions_tenant_isolation" ON public.prescriptions
    FOR ALL TO authenticated
    USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
    WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "prescription_items_tenant_isolation" ON public.prescription_items
    FOR ALL TO authenticated
    USING (prescription_id IN (
        SELECT id FROM public.prescriptions WHERE tenant_id IN (SELECT public.current_user_tenant_ids())
    ))
    WITH CHECK (prescription_id IN (
        SELECT id FROM public.prescriptions WHERE tenant_id IN (SELECT public.current_user_tenant_ids())
    ));

CREATE POLICY "doctor_custom_medicines_tenant_isolation" ON public.doctor_custom_medicines
    FOR ALL TO authenticated
    USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
    WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "doctor_custom_diagnoses_tenant_isolation" ON public.doctor_custom_diagnoses
    FOR ALL TO authenticated
    USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
    WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "doctor_prescription_templates_tenant_isolation" ON public.doctor_prescription_templates
    FOR ALL TO authenticated
    USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
    WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "visit_revisions_tenant_isolation" ON public.visit_revisions
    FOR ALL TO authenticated
    USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
    WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "follow_ups_tenant_isolation" ON public.follow_ups
    FOR ALL TO authenticated
    USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
    WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));
```

---

## 4. CDCI Drug Master & Search Architecture

### 4.1 NRCeS / CDCI Flat File Structure Analysis

The official NRCeS Common Drug Codes for India Flat Files Package is already placed in `supabase/seed-data/cdci/`. The package consists of 7 TSV files:

| TSV File | Row Count | Primary Columns | Key Relationships |
|---|---|---|---|
| `BrandMaster.txt` | 93,912 | `Identifier`, `Brand Name`, `Product Identifier`, `Supplier Identifier`, `Generic Identifier`, `License Number`, `License Status`, `Excipient`, `last_updated_on` | Core anchor. Links to `ProductMaster`, `GenericMaster`, `SupplierMaster`. |
| `ProductMaster.txt` | 72,285 | `Identifier`, `Product Name` | Short trade brand (e.g., `Augmentin`, `Deriphyllin`, `Dolo`). |
| `GenericMaster.txt` | 10,306 | `Identifier`, `Generic Name`, `Substance Identifier`, `Route of Administration`, `Dose Form`, `Therapeutic Role`, `Indication`, `Contra Indication`, `Interaction with Drugs`, `Classification of Drugs`, `Source/ Regulatory`, `last_updated_on` | Active composition & clinical details. Links to `SubstanceMaster`, `DrugFormMaster`, `RouteOfAdministrationMaster`. |
| `SubstanceMaster.txt` | 3,284 | `Identifier`, `Substance Name`, `CAS Number`, `UNII`, `Substance Description`, `Molecular Weight`, `Toxicity`, `SMILE`, `InChI`, `IUPAC Name`, `Molecular Formula`, `last_updated_on` | Chemical substance / active ingredient. |
| `SupplierMaster.txt` | 8,214 | `Identifier`, `Supplier Name`, `Country` | Pharmaceutical manufacturer / marketer (e.g. `GlaxoSmithKline`, `Cipla`). |
| `DrugFormMaster.txt` | 424 | `Id`, `Dose Form` | Formulation (e.g. `Tablet`, `Oral suspension`, `Injection`). |
| `RouteOfAdministrationMaster.txt` | 161 | `Identifier`, `RouteOfAdministration` | Route (e.g. `Oral route`, `Topical route`, `Intravenous route`). |

### 4.2 Central Database Tables & Materialized Search View

The CDCI master is non-tenant specific (a shared Indian drug registry). It is publicly readable by all authenticated clinic users.

```sql
-- Extension requirement
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Base relational tables
CREATE TABLE IF NOT EXISTS public.cdci_substances (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cas_number TEXT,
    unii TEXT,
    description TEXT,
    last_updated_on TEXT
);

CREATE TABLE IF NOT EXISTS public.cdci_drug_forms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cdci_routes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cdci_suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    country TEXT
);

CREATE TABLE IF NOT EXISTS public.cdci_products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cdci_generics (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    substance_ids TEXT,
    route_id TEXT,
    dose_form_id TEXT,
    therapeutic_role TEXT,
    indication TEXT,
    contra_indication TEXT,
    last_updated_on TEXT
);

CREATE TABLE IF NOT EXISTS public.cdci_brands (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    product_id TEXT,
    supplier_id TEXT,
    generic_id TEXT,
    license_status TEXT,
    last_updated_on TEXT
);

-- Denormalized Materialized Search Table
CREATE TABLE IF NOT EXISTS public.cdci_medicines_search (
    id TEXT PRIMARY KEY, -- Brand Identifier
    brand_name TEXT NOT NULL,
    product_name TEXT,
    generic_name TEXT,
    dose_form TEXT,
    route TEXT,
    supplier_name TEXT,
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', brand_name), 'A') ||
        setweight(to_tsvector('simple', coalesce(generic_name, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(product_name, '')), 'C')
    ) STORED
);

-- Performance Indexes for Sub-100ms Search
CREATE INDEX IF NOT EXISTS idx_cdci_search_brand_trgm ON public.cdci_medicines_search USING gin (brand_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cdci_search_generic_trgm ON public.cdci_medicines_search USING gin (generic_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cdci_search_tsv ON public.cdci_medicines_search USING gin (search_vector);
```

### 4.3 Ingestion Pipeline Script (`scripts/seed-cdci.ts`)

- **Script:** `scripts/seed-cdci.ts` run via `npm run seed:cdci`.
- **Parsing Method:** High-performance line-streaming via Node.js `readline` parsing TSV tabs.
- **Bulk Loading:** Batch inserts of 1,000 rows per transaction using `pg` or Supabase admin client.
- **Execution Speed:**
  - 93,912 brands + dependencies ingest in ~12 to 18 seconds total.
  - The script compiles `cdci_medicines_search` directly after base tables load:
    ```sql
    INSERT INTO public.cdci_medicines_search (id, brand_name, product_name, generic_name, dose_form, route, supplier_name)
    SELECT 
        b.id,
        b.name AS brand_name,
        p.name AS product_name,
        g.name AS generic_name,
        df.name AS dose_form,
        r.name AS route,
        s.name AS supplier_name
    FROM public.cdci_brands b
    LEFT JOIN public.cdci_products p ON b.product_id = p.id
    LEFT JOIN public.cdci_generics g ON b.generic_id = g.id
    LEFT JOIN public.cdci_suppliers s ON b.supplier_id = s.id
    LEFT JOIN public.cdci_drug_forms df ON g.dose_form_id = df.id
    LEFT JOIN public.cdci_routes r ON g.route_id = r.id
    ON CONFLICT (id) DO NOTHING;
    ```
- **Dual-Mode Testing Fixture (D-34):**
  - For unit tests and CI where loading 180,000 rows is unnecessary, provide `scripts/seed-cdci-test-fixture.ts` loading a curated slice of ~200 top Indian outpatient drugs (Paracetamol, Amoxicillin-Clav, Azithromycin, Pantoprazole, Telmisartan, Metformin, Cetirizine, Montelukast, Cefixime, Ibuprofen, etc.) in < 100ms.

### 4.4 Sub-100ms Unified Search RPC

```sql
CREATE OR REPLACE FUNCTION public.search_medicines(
    p_query TEXT,
    p_doctor_id UUID,
    p_tenant_id UUID,
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    id TEXT,
    medicine_name TEXT,
    generic_name TEXT,
    dose_form TEXT,
    is_custom BOOLEAN,
    is_favorite BOOLEAN,
    default_dosage TEXT,
    default_timing TEXT,
    default_duration TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    -- 1. Doctor's custom/favorite medicines first
    SELECT 
        cm.id::text,
        cm.medicine_name,
        cm.generic_name,
        cm.dose_form,
        true AS is_custom,
        true AS is_favorite,
        cm.default_dosage,
        cm.default_timing,
        cm.default_duration
    FROM public.doctor_custom_medicines cm
    WHERE cm.tenant_id = p_tenant_id
      AND cm.doctor_id = p_doctor_id
      AND (cm.medicine_name ILIKE '%' || p_query || '%' OR cm.generic_name ILIKE '%' || p_query || '%')

    UNION ALL

    -- 2. CDCI Master Drugs
    SELECT 
        cs.id,
        cs.brand_name AS medicine_name,
        cs.generic_name,
        cs.dose_form,
        false AS is_custom,
        false AS is_favorite,
        NULL::text AS default_dosage,
        NULL::text AS default_timing,
        NULL::text AS default_duration
    FROM public.cdci_medicines_search cs
    WHERE cs.brand_name ILIKE p_query || '%'
       OR cs.brand_name % p_query
       OR cs.generic_name ILIKE p_query || '%'
    ORDER BY is_favorite DESC, medicine_name ASC
    LIMIT p_limit;
END;
$$;
```

---

## 5. Curated Diagnosis Master Architecture

### 5.1 Dataset Design (`supabase/seed-data/terminology/diagnoses.json`)

To provide instant, zero-latency clinical coding without external API dependencies, Phase 3 seeds ~1,500 curated outpatient conditions frequently diagnosed in Indian OPD clinics.

```json
[
  {
    "name": "Acute Upper Respiratory Tract Infection",
    "icd11_code": "CA40",
    "snomed_concept_id": "54150009",
    "category": "Infections of the respiratory tract",
    "specialties": ["general_physician", "pediatrics"],
    "is_chronic": false,
    "synonyms": ["URTI", "Common Cold", "Acute Nasopharyngitis"]
  },
  {
    "name": "Dental Caries",
    "icd11_code": "DA08.0",
    "snomed_concept_id": "80967001",
    "category": "Diseases of hard tissues of teeth",
    "specialties": ["dental"],
    "is_chronic": false,
    "synonyms": ["Tooth Decay", "Cavity", "Caries of Dentine"]
  },
  {
    "name": "Type 2 Diabetes Mellitus",
    "icd11_code": "5A11",
    "snomed_concept_id": "44054006",
    "category": "Diabetes mellitus",
    "specialties": ["general_physician"],
    "is_chronic": true,
    "synonyms": ["T2DM", "Non-insulin dependent diabetes", "High Blood Sugar"]
  }
]
```

### 5.2 Database Table & Indexing

```sql
CREATE TABLE IF NOT EXISTS public.opd_diagnoses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    icd11_code TEXT,
    snomed_concept_id TEXT,
    category TEXT,
    specialties TEXT[] DEFAULT '{}',
    is_chronic BOOLEAN NOT NULL DEFAULT false,
    synonyms TEXT[] DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_opd_diagnoses_name_trgm ON public.opd_diagnoses USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_opd_diagnoses_specialties ON public.opd_diagnoses USING gin (specialties);
```

### 5.3 Quick Chips & Custom Diagnosis Persistence
- **Specialty Chips:** For General Physician, the top 8 chips render above the input (`Viral Fever`, `URTI`, `Acute Bronchitis`, `Hypertension`, `Type 2 Diabetes`, `GERD`, `UTI`, `Acute Gastroenteritis`).
- For Dental: `Dental Caries`, `Acute Pulpitis`, `Periapical Abscess`, `Gingivitis`, `Chronic Periodontitis`, `Impacted Molar`.
- For Pediatrics: `URTI`, `Acute Bronchiolitis`, `Acute Gastroenteritis`, `Viral Exanthem`, `Acute Otitis Media`, `Atopic Dermatitis`.
- **Auto-Save Custom:** If a doctor types a diagnosis not in the master, upon adding the row it auto-saves to `doctor_custom_diagnoses` with `use_count = use_count + 1` for future autocomplete.

---

## 6. Consultation Workspace & Specialty Templates

### 6.1 Workspace Layout & Section Hierarchy (D-01)

The consultation workspace resides at `app/(dashboard)/consultation/[id]/page.tsx`.

```
┌────────────────────────────────────────────────────────────────────────┐
│ STICKY HEADER: Patient Name (Age/Sex) • Token #4 • Status Badge        │
│ Specialty: [General Physician ▾]   [Save Draft]   [Complete & Sign]   │
│ Section Jumps: [Vitals] [Complaints] [Exam] [Diagnosis] [Rx] [Advice] │
├────────────────────────────────────────────────────────────────────────┤
│ [!] ALLERGY BANNER: Penicillin, Sulfa Drugs                            │
├────────────────────────────────────────────────────────────────────────┤
│ 1. VITALS BLOCK                                                        │
│    BP [120/80]  Pulse [72]  SpO2 [98%]  Temp [98.6°F]  Wt [68kg] Ht [172cm]│
│    BMI: 23.0 (Normal)                                                  │
├────────────────────────────────────────────────────────────────────────┤
│ 2. CHIEF COMPLAINTS & CLINICAL NOTES                                   │
│    Chips: [Fever x 3d] [Cough x 5d] [+ Add Complaint]                  │
│    Clinical Notes: "Fever high grade with chills since 3 days..."      │
├────────────────────────────────────────────────────────────────────────┤
│ 3. EXAMINATION & SPECIALTY TEMPLATE (Dynamic by Specialty)             │
│    GP: Systemic Exam (CVS, RS, PA, CNS)                                │
│    Dental: Interactive SVG FDI Tooth Chart (11-48, 51-85)              │
│    Pediatrics: Birth History + WHO Growth Percentiles + IAP Vaccines   │
├────────────────────────────────────────────────────────────────────────┤
│ 4. DIAGNOSES                                                           │
│    Chips: [Viral Fever] [URTI] [GERD]                                  │
│    Search: [Type diagnosis... (ICD-11 / SNOMED CT)]                   │
│    Rows:                                                               │
│    - Acute Upper Respiratory Tract Infection (CA40) [x] [Chronic ☐]    │
├────────────────────────────────────────────────────────────────────────┤
│ 5. ELECTRONIC PRESCRIPTION (Rx)                                        │
│    [Repeat Last Rx]  [Apply Protocol ▾]  [+ Custom Medicine]           │
│    Search: [Augmentin 625 Duo Tablet                               ]  │
│    Rows:                                                               │
│    - Augmentin 625 Duo (Amoxicillin 500mg + Clav 125mg)                │
│      Freq: [1-0-1]  Food: [After food]  Duration: [5 days]  [x]        │
├────────────────────────────────────────────────────────────────────────┤
│ 6. INVESTIGATIONS & CLINICAL ADVICE                                    │
│    Investigations: [CBC] [Blood Sugar] [Chest X-ray]                   │
│    Advice: [Warm saline gargle] [Steam inhalation] [Plenty of fluids]  │
├────────────────────────────────────────────────────────────────────────┤
│ 7. FOLLOW-UP & ATTACHMENTS                                             │
│    Follow-up: [3 Days] [5 Days] [1 Week] [2 Weeks] [Custom Date]       │
│    Dropzone: Drag & drop clinical records/reports (JPEG/PNG/PDF < 10MB)│
└────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Dental Odontogram Component Design

- **Numbering Standard:** FDI Two-Digit Notation.
  - Adult Upper: `18` to `11` (Right) | `21` to `28` (Left)
  - Adult Lower: `48` to `41` (Right) | `31` to `38` (Left)
  - Primary Upper: `55` to `51` (Right) | `61` to `65` (Left)
  - Primary Lower: `85` to `81` (Right) | `71` to `75` (Left)
- **Visual Presentation:** Clean declarative SVG grid rendered with anatomical tooth outlines (crown and root).
- **Condition Tags:**
  - `Decay / Caries`: Red fill (`#EF4444`)
  - `Crown / Cap`: Amber fill (`#F59E0B`)
  - `Missing`: Slate fill with cross (`#64748B`)
  - `RCT`: Purple fill (`#A855F7`)
  - `Extraction Advised`: Deep crimson outline (`#991B1B`)
  - `Filled / Restoration`: Blue fill (`#3B82F6`)
- **Interaction:**
  - Clicking a tooth opens an accessible popover containing condition chips.
  - Doctor toggles conditions and can enter optional tooth notes (e.g., "Deep mesial caries, tender on percussion").
  - Summary table renders underneath showing all flagged teeth and advised procedures.

### 6.3 Pediatrics Growth & Vaccine Implementation

- **WHO Percentile Calculation:**
  - Embed the standard WHO Child Growth Standards LMS tables (0 to 60 months) for Weight-for-age, Height-for-age, and Head Circumference-for-age in `lib/pediatrics/who-data.ts`.
  - Calculate exact Z-score using LMS formula:
    $$Z = \frac{(X / M)^L - 1}{L \cdot S} \quad (L \ne 0)$$
  - Convert Z-score to percentile using standard error function approximation:
    $$\text{Percentile} = \Phi(Z) \times 100$$
  - Real-time display: When age and weight/height are entered, immediately badge the reading:
    - `< 3rd`: Underweight / Stunted (Red badge)
    - `3rd – 15th`: Below Average (Amber badge)
    - `15th – 85th`: Normal (Green badge)
    - `85th – 97th`: Above Average (Amber badge)
    - `> 97th`: High / Obese (Red badge)
- **IAP Immunization Schedule:**
  - Pre-load standard IAP ACVIP vaccine milestones (`Birth`, `6w`, `10w`, `14w`, `6m`, `9m`, `12m`, `15m`, `18m`, `2y`, `5y`, `10y`).
  - Interactive grid allows doctor/nurse to click status: `Given`, `Due`, `Delayed`, `Skipped`.

---

## 7. Server-Side React-PDF & Letterhead Engine

### 7.1 Architecture & Next.js 15 Integration

1. **Package:** `@react-pdf/renderer` (v4.1.0+).
2. **Next.js 15 Bundling Guard:**
   In `next.config.ts`, add:
   ```typescript
   import type { NextConfig } from "next";

   const nextConfig: NextConfig = {
     serverExternalPackages: ["@react-pdf/renderer"],
   };

   export default nextConfig;
   ```
3. **Execution Context:** Never render PDFs inside browser client components. Render exclusively on the server in a Node.js Route Handler (`app/api/visits/[id]/prescription-pdf/route.ts`) or Server Action.
4. **Buffer Generation:**
   ```typescript
   import { pdf } from "@react-pdf/renderer";
   import { PrescriptionDocument } from "@/features/prescriptions/pdf/prescription-document";

   export async function generatePrescriptionPdfBuffer(payload: PrescriptionPdfPayload): Promise<Buffer> {
     const doc = <PrescriptionDocument payload={payload} />;
     const instance = pdf(doc);
     const buffer = await instance.toBuffer();
     return buffer;
   }
   ```

### 7.2 Storage & Delivery Pipeline

1. **Storage Bucket:** Supabase Storage bucket `prescriptions` (private).
2. **File Path:** `${tenantId}/${visitId}/rx_v${version}.pdf`.
3. **Signed URL:** Generated via `supabase.storage.from('prescriptions').createSignedUrl(path, 3600)`.
4. **Audit Trail:** Mandatory `prescription.generate_pdf` audit log entry with `visit_id`, `version`, and `letterhead_mode`.
5. **In-App Modal:** Renders an accessible preview modal embedding the PDF via `<iframe>` or `<object>` with:
   - Letterhead Mode Switcher: `[Blank Paper]` vs `[Pre-Printed Letterhead]`.
   - `[Print]` button: Triggers native print dialog via `iframe.contentWindow.print()`.
   - `[Download PDF]` button: Direct download link.

### 7.3 Dual Letterhead Mode Layout Specs (D-28, D-31)

```
┌────────────────────────────────────────────────────────────┐
│                    MODE 1: BLANK PAPER                     │
├────────────────────────────────────────────────────────────┤
│ [LOGO]  APEX HEALTH CLINIC                                 │
│         123 MG Road, Bengaluru • Ph: +91 80 2345 6789     │
│         Reg No: CEA/BLR/2023/1042                          │
│                                                            │
│ Dr. Ramesh Rao, MBBS, MD (Internal Medicine)               │
│ Reg. No: KMC/45210/2014                                    │
│ ────────────────────────────────────────────────────────── │
│ Patient: Rahul Sharma (35 M)        Date: 11-Oct-2026      │
│ Phone: +91 98765 43210              Visit ID: V-1049       │
│ Vitals: BP: 120/80 mmHg | Pulse: 72 bpm | Wt: 68 kg       │
│ ────────────────────────────────────────────────────────── │
│ Chief Complaints: Fever x 3 days, Productive cough         │
│ Diagnosis: Acute Upper Respiratory Tract Infection (CA40) │
│ ────────────────────────────────────────────────────────── │
│ ℞ MEDICATIONS                                              │
│ 1. AUGMENTIN 625 DUO TABLET                                │
│    Amoxicillin 500 mg + Clavulanic acid 125 mg             │
│    Dosage: 1-0-1 | After food | 5 days                     │
│                                                            │
│ 2. DOLO 650 TABLET                                         │
│    Paracetamol 650 mg                                      │
│    Dosage: 1-0-1 (SOS) | After food | 3 days               │
│ ────────────────────────────────────────────────────────── │
│ Advised Investigations: Complete Blood Count (CBC)        │
│ Advice: Warm saline gargle, plenty of oral fluids          │
│ Follow-up: After 5 days (16-Oct-2026)                      │
│ ────────────────────────────────────────────────────────── │
│ [SIGNATURE]                                                │
│ Dr. Ramesh Rao                                             │
│ KMC/45210/2014                                             │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│              MODE 2: PRE-PRINTED LETTERHEAD                │
├────────────────────────────────────────────────────────────┤
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ░ TOP MARGIN OFFSET: 110pt (~39mm)                       ░ │
│ ░ (Reserved for physical clinic pad pre-printed heading)   ░ │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ Patient: Rahul Sharma (35 M)        Date: 11-Oct-2026      │
│ Phone: +91 98765 43210              Visit ID: V-1049       │
│ Vitals: BP: 120/80 mmHg | Pulse: 72 bpm | Wt: 68 kg       │
│ ────────────────────────────────────────────────────────── │
│ Chief Complaints: Fever x 3 days, Productive cough         │
│ Diagnosis: Acute Upper Respiratory Tract Infection (CA40) │
│ ────────────────────────────────────────────────────────── │
│ ℞ MEDICATIONS                                              │
│ 1. AUGMENTIN 625 DUO TABLET                                │
│    Amoxicillin 500 mg + Clavulanic acid 125 mg             │
│    Dosage: 1-0-1 | After food | 5 days                     │
│ ────────────────────────────────────────────────────────── │
│ Advised Investigations: Complete Blood Count (CBC)        │
│ Follow-up: After 5 days (16-Oct-2026)                      │
│ ────────────────────────────────────────────────────────── │
│ [SIGNATURE]                                                │
│ Dr. Ramesh Rao                                             │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ░ BOTTOM MARGIN OFFSET: 60pt (~21mm)                     ░ │
│ ░ (Reserved for physical clinic pad footer)                ░ │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└────────────────────────────────────────────────────────────┘
```

---

## 8. Post-Sign-Off Amendments & Versioning (D-05, D-17)

In clinical practice, a doctor frequently needs to correct or adjust a prescription after the visit is marked completed (e.g., patient calls back about an allergy, or lab tests prompt dosage alteration).

### Immutable Audit Model
1. **Initial Sign-Off:**
   - Moves visit to `completed`.
   - Creates `prescriptions` record with `version = 1`.
   - Generates PDF `rx_v1.pdf`.
   - Records audit event `visit.complete_sign`.
2. **Re-Opening & Editing:**
   - UI warns: *"This consultation was signed on [Date]. Editing will generate an amended prescription (v2) and save an audit revision."*
   - Requires doctor to enter `amendment_reason` (e.g. *"Adjusted antibiotic dose due to gastric intolerance"*).
3. **Save Amendment:**
   - Creates a frozen JSON snapshot in `visit_revisions`:
     ```json
     {
       "visit_id": "...",
       "revision_number": 1,
       "amended_by": "...",
       "amendment_reason": "...",
       "snapshot": {
         "vitals": {...},
         "complaints": [...],
         "diagnoses": [...],
         "prescription_v1_items": [...],
         "specialty_data": {...}
       }
     }
     ```
   - Increments visit `current_revision` to `2`.
   - Inserts new `prescriptions` row with `version = 2` (previous marked `amended`).
   - Generates amended PDF `rx_v2.pdf` watermarked / stamped with *"Amended on 11-Oct-2026 by Dr. Ramesh Rao (Reason: Adjusted antibiotic dose)"*.
   - Records audit event `visit.amend` and `prescription.amend`.

---

## 9. Validation Architecture & Test Strategy

### 9.1 Vitest Unit Test Suites (In-Memory, Zero Network)

1. **`tests/prescriptions/dosage.spec.ts`**:
   - Tests parsing and validation of Indian OPD dosage chips (`1-0-1`, `1-0-0`, `0-0-1`, `1-1-1`, `SOS`).
   - Validates duration strings (`3d`, `5d`, `1w`, `1m`).
   - Validates food relation tags (`After food`, `Before food`, `With food`).
2. **`tests/pediatrics/who-growth.spec.ts`**:
   - Tests WHO LMS Z-score calculation against known reference points (e.g., 24-month boy weighing 12.2kg → 50th percentile).
   - Validates boundary conditions (< 3rd percentile, > 97th percentile).
3. **`tests/dental/odontogram.spec.ts`**:
   - Validates FDI tooth numbering ranges (adult 11–48, deciduous 51–85).
   - Validates condition tag mutations and serializations into `visits.specialty_data`.
4. **`tests/consultation/schemas.spec.ts`**:
   - Validates Zod schemas for visit updates, diagnoses, prescription items, and specialty data payloads.

### 9.2 Supabase Integration Test Suites

1. **`tests/integration/cdci-search.spec.ts`**:
   - Loads the ~200 drug test fixture.
   - Verifies fuzzy trigram search for brand names (e.g. `Augmentin`) and generic salts (e.g. `Amoxicillin`) executes in < 100ms.
   - Verifies doctor custom medicines appear first in search results.
2. **`tests/integration/consultation-flow.spec.ts`**:
   - Transitions a visit from `waiting` → `in_consultation` → `completed`.
   - Adds multiple diagnoses and prescription items.
   - Verifies chronic condition flag updates `patients.chronic_conditions`.
   - Verifies follow-up record created in `follow_ups` table.
3. **`tests/integration/prescription-versioning.spec.ts`**:
   - Amends a completed visit.
   - Verifies `visit_revisions` contains exact immutable snapshot of v1.
   - Verifies prescription increments to v2 with audit log entry.
   - Verifies dual letterhead modes generate correct margins.

### 9.3 Quality Verification Commands

- **Typecheck:** `npm run typecheck` (`tsc --noEmit`)
- **Lint:** `npm run lint`
- **Unit Tests:** `npm run test`
- **CDCI Ingestion:** `npm run seed:cdci`

---

## 10. Pitfalls & "Don't Hand-Roll" Rules

1. **Don't Import `@react-pdf/renderer` in Client Components:**
   - *Why:* Causes React 19 / Next.js client bundler crashes due to Node.js / canvas dependencies.
   - *Rule:* Only import `@react-pdf/renderer` on the server (Route Handlers or Server Actions). Mark `@react-pdf/renderer` in `serverExternalPackages` in `next.config.ts`.
2. **Don't Run Unindexed Trigram Queries on 94,000 CDCI Drugs:**
   - *Why:* Sequential scans on 94,000 rows take 250–500ms and saturate database CPU.
   - *Rule:* Always utilize `GIN` trigram indexes on `brand_name gin_trgm_ops` and `generic_name gin_trgm_ops`. Prioritize prefix matches (`brand_name ILIKE query || '%'`) before full similarity scoring.
3. **Don't Overwrite Completed Visits In-Place:**
   - *Why:* Violates medical-legal records compliance (AGENTS.md §18).
   - *Rule:* Always capture an immutable snapshot in `visit_revisions` before saving amendments to a completed visit.
4. **Don't Hand-Roll Complex Dental Canvas Libraries:**
   - *Why:* Canvas charting is inaccessible, difficult to style with Tailwind tokens, and heavy.
   - *Rule:* Use declarative inline SVGs with standard FDI tooth numbers, standard 44px clickable areas, and TailAdmin design tokens.
5. **Don't Hand-Roll WHO Growth Curves:**
   - *Why:* Polynomial estimation leads to clinical inaccuracy.
   - *Rule:* Embed standard WHO LMS reference tables (0–60 months) and use the exact closed-form LMS formula.
6. **Don't Do Sequential HTTP Inserts for CDCI Ingestion:**
   - *Why:* Ingesting 94,000 rows one-by-one takes over 30 minutes.
   - *Rule:* Use streaming TSV parsing with 1,000-row batch transactions in `scripts/seed-cdci.ts` (ingests in < 15s).
7. **Don't Show Blocking Modal Alerts for Allergies:**
   - *Why:* Causes alert fatigue in high-throughput OPD settings (D-14).
   - *Rule:* Display a prominent, persistent informational banner above the Rx builder for clinician review without interrupting typing.

---

## 11. Recommended Plan Breakdown for Phase 3

To ensure rigorous execution and clean validation, Phase 3 is recommended to be planned in 5 sequential plans:

- **Plan 03-01 (Foundation & Masters):** Database migration `000007_consultation_prescriptions_cdci.sql`, CDCI ingestion script (`npm run seed:cdci`), test fixture, `opd_diagnoses` seeding, `search_medicines` & `search_diagnoses` RPCs, sub-100ms search benchmarks.
- **Plan 03-02 (Consultation Workspace & Vitals):** Single-page SOAP workspace (`app/(dashboard)/consultation/[id]`), sticky section jumps, shared vitals block with abnormal badges, chief complaints chips + duration picker, history side panel.
- **Plan 03-03 (Specialty Templates Layer):** Configuration-driven specialty templates: General Physician (systemic exam), Dental (SVG FDI Odontogram tooth chart), and Pediatrics (birth history, WHO growth percentiles, IAP immunization checklist).
- **Plan 03-04 (Prescriptions & Diagnosis Engine):** Terminology diagnosis search, chronic conditions profile sync, CDCI drug search with doctor favorites, dosage chips (`1-0-1`, food, duration), named protocol templates, follow-ups persistence.
- **Plan 03-05 (PDF Engine, Dual Letterhead & Post-Sign-Off Audit):** Server-side `@react-pdf/renderer` pipeline, Supabase Storage bucket `prescriptions`, signed URLs, in-app modal preview & print, dual letterhead mode, `visit_revisions` snapshot amendment audit trail, full test suite verification.
