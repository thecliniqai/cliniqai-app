-- Migration: 000004_compliance_columns.sql
-- Forward-compatible structured clinical columns (ICD-10, structured drug refs, HFR/HPR identifiers)

-- 1. Extend patients with HFR/HPR registration and national health identifiers
ALTER TABLE public.patients
ADD COLUMN IF NOT EXISTS hfr_facility_id TEXT,
ADD COLUMN IF NOT EXISTS national_health_id TEXT;

-- 2. Create structured consultations table preview for Phase 3 readiness
CREATE TABLE IF NOT EXISTS public.consultations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES auth.users(id),
    chief_complaint TEXT,
    clinical_notes TEXT,
    icd10_code TEXT,
    icd10_display TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consultations_tenant_patient ON public.consultations(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_consultations_icd10 ON public.consultations(icd10_code);

-- 3. Create structured prescriptions table preview with discrete drug components
CREATE TABLE IF NOT EXISTS public.prescriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES auth.users(id),
    drug_name TEXT NOT NULL,
    drug_code TEXT,
    dosage TEXT NOT NULL,
    frequency TEXT NOT NULL,
    duration TEXT NOT NULL,
    instructions TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_tenant_patient ON public.prescriptions(tenant_id, patient_id);

-- 4. Enable RLS on consultation and prescription preview tables
ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consultations_tenant_isolation"
ON public.consultations
FOR ALL
TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "prescriptions_tenant_isolation"
ON public.prescriptions
FOR ALL
TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));
