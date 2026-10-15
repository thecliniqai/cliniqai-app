-- Migration: 000007_consultation_prescriptions_cdci.sql
-- Consultation, Prescribing, Terminology Foundations & CDCI Drug Master

-- 0. Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Alter visits: add SOAP & specialty clinical fields
ALTER TABLE public.visits
ADD COLUMN IF NOT EXISTS vitals JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS chief_complaints JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS clinical_notes TEXT,
ADD COLUMN IF NOT EXISTS specialty TEXT NOT NULL DEFAULT 'general_physician' CHECK (specialty IN ('general_physician', 'dental', 'pediatrics')),
ADD COLUMN IF NOT EXISTS specialty_data JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS investigations_advised TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS advice TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS current_revision INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS signed_by UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_visits_tenant_specialty ON public.visits(tenant_id, specialty);

-- 2. Alter tenants & memberships: add letterhead and doctor profile extensions
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

-- 3. Create consultation_diagnoses table
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

CREATE INDEX IF NOT EXISTS idx_consultation_diagnoses_tenant_visit ON public.consultation_diagnoses(tenant_id, visit_id);
CREATE INDEX IF NOT EXISTS idx_consultation_diagnoses_tenant_patient ON public.consultation_diagnoses(tenant_id, patient_id);

-- 4. Create prescriptions table
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

CREATE INDEX IF NOT EXISTS idx_prescriptions_tenant_visit ON public.prescriptions(tenant_id, visit_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_tenant_patient ON public.prescriptions(tenant_id, patient_id);

-- 5. Create prescription_items table
CREATE TABLE IF NOT EXISTS public.prescription_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_id UUID NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
    medicine_name TEXT NOT NULL,
    generic_name TEXT,
    dose_form TEXT,
    dosage TEXT NOT NULL,
    timing TEXT,
    duration TEXT NOT NULL,
    special_instructions TEXT,
    cdci_brand_id TEXT,
    cdci_generic_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prescription_items_prescription_sort ON public.prescription_items(prescription_id, sort_order);

-- 6. Create doctor_custom_medicines table
CREATE TABLE IF NOT EXISTS public.doctor_custom_medicines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES auth.users(id),
    medicine_name TEXT NOT NULL,
    generic_name TEXT,
    dose_form TEXT,
    default_dosage TEXT,
    default_timing TEXT,
    default_duration TEXT,
    use_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_doctor_custom_medicines UNIQUE (tenant_id, doctor_id, medicine_name)
);

CREATE INDEX IF NOT EXISTS idx_doctor_custom_medicines_tenant_doctor ON public.doctor_custom_medicines(tenant_id, doctor_id, medicine_name);

-- 7. Create doctor_custom_diagnoses table
CREATE TABLE IF NOT EXISTS public.doctor_custom_diagnoses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES auth.users(id),
    diagnosis_name TEXT NOT NULL,
    specialty TEXT,
    use_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_doctor_custom_diagnoses UNIQUE (tenant_id, doctor_id, diagnosis_name)
);

CREATE INDEX IF NOT EXISTS idx_doctor_custom_diagnoses_tenant_doctor ON public.doctor_custom_diagnoses(tenant_id, doctor_id);

-- 8. Create doctor_prescription_templates table
CREATE TABLE IF NOT EXISTS public.doctor_prescription_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES auth.users(id),
    template_name TEXT NOT NULL,
    specialty TEXT,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doctor_prescription_templates_tenant_doctor ON public.doctor_prescription_templates(tenant_id, doctor_id);

-- 9. Create visit_revisions table
CREATE TABLE IF NOT EXISTS public.visit_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    amended_by UUID NOT NULL REFERENCES auth.users(id),
    amended_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    amendment_reason TEXT NOT NULL,
    snapshot JSONB NOT NULL,
    CONSTRAINT uq_visit_revisions_number UNIQUE (visit_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_visit_revisions_tenant_visit ON public.visit_revisions(tenant_id, visit_id);

-- 10. Create follow_ups table
CREATE TABLE IF NOT EXISTS public.follow_ups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL,
    doctor_id UUID NOT NULL REFERENCES auth.users(id),
    follow_up_date DATE NOT NULL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'attended', 'cancelled', 'missed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_tenant_date_status ON public.follow_ups(tenant_id, follow_up_date, status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_tenant_patient ON public.follow_ups(tenant_id, patient_id);

-- 11. Central CDCI Tables
CREATE TABLE IF NOT EXISTS public.cdci_substances (
    id TEXT PRIMARY KEY,
    substance_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cdci_drug_forms (
    id TEXT PRIMARY KEY,
    form_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cdci_routes (
    id TEXT PRIMARY KEY,
    route_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cdci_suppliers (
    id TEXT PRIMARY KEY,
    supplier_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cdci_products (
    id TEXT PRIMARY KEY,
    product_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cdci_generics (
    id TEXT PRIMARY KEY,
    generic_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cdci_brands (
    id TEXT PRIMARY KEY,
    brand_name TEXT NOT NULL,
    generic_id TEXT,
    product_id TEXT,
    supplier_id TEXT,
    form_id TEXT,
    route_id TEXT
);

CREATE TABLE IF NOT EXISTS public.cdci_medicines_search (
    id TEXT PRIMARY KEY,
    brand_name TEXT NOT NULL,
    product_name TEXT,
    generic_name TEXT,
    dose_form TEXT,
    route TEXT,
    supplier_name TEXT,
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', COALESCE(brand_name, '') || ' ' || COALESCE(generic_name, ''))
    ) STORED
);

CREATE INDEX IF NOT EXISTS idx_cdci_brand_trgm ON public.cdci_medicines_search USING gin (brand_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cdci_generic_trgm ON public.cdci_medicines_search USING gin (generic_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cdci_search_vector ON public.cdci_medicines_search USING gin (search_vector);

-- 12. Central Terminology Table
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

-- 13. search_medicines RPC function
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
    default_dosage TEXT,
    default_timing TEXT,
    default_duration TEXT,
    is_custom BOOLEAN,
    is_favorite BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_query TEXT := trim(COALESCE(p_query, ''));
BEGIN
    RETURN QUERY
    WITH custom_matches AS (
        SELECT
            cm.id::TEXT AS id,
            cm.medicine_name,
            cm.generic_name,
            cm.dose_form,
            cm.default_dosage,
            cm.default_timing,
            cm.default_duration,
            true AS is_custom,
            true AS is_favorite,
            cm.use_count
        FROM public.doctor_custom_medicines cm
        WHERE cm.tenant_id = p_tenant_id
          AND cm.doctor_id = p_doctor_id
          AND (
              v_clean_query = ''
              OR cm.medicine_name ILIKE '%' || v_clean_query || '%'
              OR COALESCE(cm.generic_name, '') ILIKE '%' || v_clean_query || '%'
          )
    ),
    cdci_matches AS (
        SELECT
            c.id,
            c.brand_name AS medicine_name,
            c.generic_name,
            c.dose_form,
            NULL::TEXT AS default_dosage,
            'After food'::TEXT AS default_timing,
            '5 days'::TEXT AS default_duration,
            false AS is_custom,
            false AS is_favorite,
            0 AS use_count
        FROM public.cdci_medicines_search c
        WHERE (
            v_clean_query = ''
            OR c.brand_name ILIKE '%' || v_clean_query || '%'
            OR COALESCE(c.generic_name, '') ILIKE '%' || v_clean_query || '%'
            OR c.search_vector @@ to_tsquery('simple', replace(v_clean_query, ' ', ' & ') || ':*')
            OR similarity(c.brand_name, v_clean_query) > 0.2
            OR (c.generic_name IS NOT NULL AND similarity(c.generic_name, v_clean_query) > 0.2)
        )
        AND NOT EXISTS (
            SELECT 1 FROM custom_matches cm WHERE lower(cm.medicine_name) = lower(c.brand_name)
        )
    )
    SELECT
        q.id,
        q.medicine_name,
        q.generic_name,
        q.dose_form,
        q.default_dosage,
        q.default_timing,
        q.default_duration,
        q.is_custom,
        q.is_favorite
    FROM (
        SELECT * FROM custom_matches
        UNION ALL
        SELECT * FROM cdci_matches
    ) q
    ORDER BY q.is_favorite DESC, q.use_count DESC, q.medicine_name ASC
    LIMIT p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_medicines(TEXT, UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_medicines(TEXT, UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_medicines(TEXT, UUID, UUID, INTEGER) TO service_role;

-- 14. Enable Row Level Security (RLS) on all new tables
ALTER TABLE public.consultation_diagnoses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_custom_medicines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_custom_diagnoses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_prescription_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cdci_substances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cdci_drug_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cdci_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cdci_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cdci_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cdci_generics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cdci_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cdci_medicines_search ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opd_diagnoses ENABLE ROW LEVEL SECURITY;

-- 15. RLS Policies for consultation_diagnoses
CREATE POLICY "consultation_diagnoses_select_member"
ON public.consultation_diagnoses FOR SELECT TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "consultation_diagnoses_insert_member"
ON public.consultation_diagnoses FOR INSERT TO authenticated
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "consultation_diagnoses_update_member"
ON public.consultation_diagnoses FOR UPDATE TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "consultation_diagnoses_delete_member"
ON public.consultation_diagnoses FOR DELETE TO authenticated
USING (
    tenant_id IN (SELECT public.current_user_tenant_ids())
    AND auth.uid() IN (SELECT user_id FROM public.memberships WHERE tenant_id = consultation_diagnoses.tenant_id AND role IN ('owner', 'admin'))
);

-- 16. RLS Policies for prescriptions
CREATE POLICY "prescriptions_select_member"
ON public.prescriptions FOR SELECT TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "prescriptions_insert_member"
ON public.prescriptions FOR INSERT TO authenticated
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "prescriptions_update_member"
ON public.prescriptions FOR UPDATE TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "prescriptions_delete_member"
ON public.prescriptions FOR DELETE TO authenticated
USING (
    tenant_id IN (SELECT public.current_user_tenant_ids())
    AND auth.uid() IN (SELECT user_id FROM public.memberships WHERE tenant_id = prescriptions.tenant_id AND role IN ('owner', 'admin'))
);

-- 17. RLS Policies for prescription_items
CREATE POLICY "prescription_items_select_member"
ON public.prescription_items FOR SELECT TO authenticated
USING (
    prescription_id IN (SELECT id FROM public.prescriptions WHERE tenant_id IN (SELECT public.current_user_tenant_ids()))
);

CREATE POLICY "prescription_items_insert_member"
ON public.prescription_items FOR INSERT TO authenticated
WITH CHECK (
    prescription_id IN (SELECT id FROM public.prescriptions WHERE tenant_id IN (SELECT public.current_user_tenant_ids()))
);

CREATE POLICY "prescription_items_update_member"
ON public.prescription_items FOR UPDATE TO authenticated
USING (
    prescription_id IN (SELECT id FROM public.prescriptions WHERE tenant_id IN (SELECT public.current_user_tenant_ids()))
)
WITH CHECK (
    prescription_id IN (SELECT id FROM public.prescriptions WHERE tenant_id IN (SELECT public.current_user_tenant_ids()))
);

CREATE POLICY "prescription_items_delete_member"
ON public.prescription_items FOR DELETE TO authenticated
USING (
    prescription_id IN (
        SELECT id FROM public.prescriptions
        WHERE tenant_id IN (SELECT public.current_user_tenant_ids())
          AND auth.uid() IN (SELECT user_id FROM public.memberships WHERE tenant_id = prescriptions.tenant_id AND role IN ('owner', 'admin'))
    )
);

-- 18. RLS Policies for doctor_custom_medicines
CREATE POLICY "doctor_custom_medicines_select_member"
ON public.doctor_custom_medicines FOR SELECT TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "doctor_custom_medicines_insert_member"
ON public.doctor_custom_medicines FOR INSERT TO authenticated
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "doctor_custom_medicines_update_member"
ON public.doctor_custom_medicines FOR UPDATE TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "doctor_custom_medicines_delete_member"
ON public.doctor_custom_medicines FOR DELETE TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

-- 19. RLS Policies for doctor_custom_diagnoses
CREATE POLICY "doctor_custom_diagnoses_select_member"
ON public.doctor_custom_diagnoses FOR SELECT TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "doctor_custom_diagnoses_insert_member"
ON public.doctor_custom_diagnoses FOR INSERT TO authenticated
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "doctor_custom_diagnoses_update_member"
ON public.doctor_custom_diagnoses FOR UPDATE TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "doctor_custom_diagnoses_delete_member"
ON public.doctor_custom_diagnoses FOR DELETE TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

-- 20. RLS Policies for doctor_prescription_templates
CREATE POLICY "doctor_prescription_templates_select_member"
ON public.doctor_prescription_templates FOR SELECT TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "doctor_prescription_templates_insert_member"
ON public.doctor_prescription_templates FOR INSERT TO authenticated
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "doctor_prescription_templates_update_member"
ON public.doctor_prescription_templates FOR UPDATE TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "doctor_prescription_templates_delete_member"
ON public.doctor_prescription_templates FOR DELETE TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

-- 21. RLS Policies for visit_revisions
CREATE POLICY "visit_revisions_select_member"
ON public.visit_revisions FOR SELECT TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "visit_revisions_insert_member"
ON public.visit_revisions FOR INSERT TO authenticated
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

-- (visit_revisions are append-only; no update or delete policies)

-- 22. RLS Policies for follow_ups
CREATE POLICY "follow_ups_select_member"
ON public.follow_ups FOR SELECT TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "follow_ups_insert_member"
ON public.follow_ups FOR INSERT TO authenticated
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "follow_ups_update_member"
ON public.follow_ups FOR UPDATE TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "follow_ups_delete_member"
ON public.follow_ups FOR DELETE TO authenticated
USING (
    tenant_id IN (SELECT public.current_user_tenant_ids())
    AND auth.uid() IN (SELECT user_id FROM public.memberships WHERE tenant_id = follow_ups.tenant_id AND role IN ('owner', 'admin'))
);

-- 23. RLS Read-only Policies for central master tables
CREATE POLICY "cdci_substances_select" ON public.cdci_substances FOR SELECT TO authenticated USING (true);
CREATE POLICY "cdci_drug_forms_select" ON public.cdci_drug_forms FOR SELECT TO authenticated USING (true);
CREATE POLICY "cdci_routes_select" ON public.cdci_routes FOR SELECT TO authenticated USING (true);
CREATE POLICY "cdci_suppliers_select" ON public.cdci_suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "cdci_products_select" ON public.cdci_products FOR SELECT TO authenticated USING (true);
CREATE POLICY "cdci_generics_select" ON public.cdci_generics FOR SELECT TO authenticated USING (true);
CREATE POLICY "cdci_brands_select" ON public.cdci_brands FOR SELECT TO authenticated USING (true);
CREATE POLICY "cdci_medicines_search_select" ON public.cdci_medicines_search FOR SELECT TO authenticated USING (true);
CREATE POLICY "opd_diagnoses_select" ON public.opd_diagnoses FOR SELECT TO authenticated USING (true);
