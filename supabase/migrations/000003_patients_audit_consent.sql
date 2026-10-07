-- Migration: 000003_patients_audit_consent.sql
-- Patients, Append-Only Audit Logs, and Immutable Consent Records

-- 1. Create patients table
CREATE TABLE IF NOT EXISTS public.patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    date_of_birth DATE,
    sex TEXT CHECK (sex IN ('male', 'female', 'other')),
    address JSONB,
    abha_id TEXT, -- Nullable from day one (NULL = unlinked, non-empty when linked)
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patients_tenant_id ON public.patients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_patients_tenant_name ON public.patients(tenant_id, full_name);
CREATE INDEX IF NOT EXISTS idx_patients_tenant_phone ON public.patients(tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_patients_tenant_created_at ON public.patients(tenant_id, created_at);

-- 2. Create append-only audit_logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES auth.users(id),
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_occurred ON public.audit_logs(tenant_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);

-- 3. Create append-only consent_records table
CREATE TABLE IF NOT EXISTS public.consent_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    consent_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('granted', 'withdrawn')),
    recorded_by UUID NOT NULL REFERENCES auth.users(id),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    note TEXT
);

CREATE INDEX IF NOT EXISTS idx_consent_records_tenant_patient ON public.consent_records(tenant_id, patient_id, recorded_at DESC, id DESC);

-- 4. Enable Row Level Security
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;

-- 5. Helper function for tenant membership check
-- (public.current_user_tenant_ids() was created in 000001_foundation.sql)

-- 6. RLS Policies for patients
-- Staff in the clinic can view patient records
CREATE POLICY "patients_select_member"
ON public.patients
FOR SELECT
TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

-- Permitted staff (owner, admin, doctor, receptionist) can create patients
CREATE POLICY "patients_insert_member"
ON public.patients
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id IN (SELECT public.current_user_tenant_ids())
);

-- Permitted staff can update patients
CREATE POLICY "patients_update_member"
ON public.patients
FOR UPDATE
TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

-- NOTE: Deliberately NO DELETE policy on patients. Patient records must not be hard deleted.

-- 7. RLS Policies for audit_logs
-- Any authenticated member of the tenant can insert an audit entry
CREATE POLICY "audit_logs_insert_member"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id IN (SELECT public.current_user_tenant_ids())
);

-- Only owner and admin of that tenant can view audit logs
CREATE POLICY "audit_logs_select_owner_admin"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.memberships
        WHERE memberships.tenant_id = audit_logs.tenant_id
          AND memberships.user_id = auth.uid()
          AND memberships.role IN ('owner', 'admin')
    )
);

-- NOTE: Deliberately NO UPDATE or DELETE policies on audit_logs (Strictly Append-Only).

-- 8. RLS Policies for consent_records
-- Members of the tenant can view consent records
CREATE POLICY "consent_records_select_member"
ON public.consent_records
FOR SELECT
TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

-- Members of the tenant can record consent
CREATE POLICY "consent_records_insert_member"
ON public.consent_records
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id IN (SELECT public.current_user_tenant_ids())
);

-- NOTE: Deliberately NO UPDATE or DELETE policies on consent_records (Strictly Append-Only).
