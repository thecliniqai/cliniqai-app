-- ============================================================================
-- Migration: 000013_labs_and_referrals.sql
-- Description: Phase 4 Labs & Referrals:
--  1. Private 'clinic-records' storage bucket with multi-tenant RLS policies.
--  2. Table patient_documents for uploaded lab reports, imaging, and scans.
--  3. Table document_share_tokens for secure, 7-day tokenized patient access.
--  4. Table referrals for out-of-network specialists and in-network partner clinics.
-- ============================================================================

-- 1. Private 'clinic-records' storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'clinic-records',
    'clinic-records',
    false,
    26214400, -- 25MB limit
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 26214400,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

-- Drop prior policies on clinic-records if any
DROP POLICY IF EXISTS "clinic_records_storage_insert_policy" ON storage.objects;
DROP POLICY IF EXISTS "clinic_records_storage_select_policy" ON storage.objects;
DROP POLICY IF EXISTS "clinic_records_storage_update_policy" ON storage.objects;
DROP POLICY IF EXISTS "clinic_records_storage_delete_policy" ON storage.objects;

-- Storage RLS INSERT policy (supports tenants/[tenant_id]/... or [tenant_id]/...)
CREATE POLICY "clinic_records_storage_insert_policy" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'clinic-records'
    AND (
        (split_part(name, '/', 1) = 'tenants' AND split_part(name, '/', 2)::uuid IN (SELECT public.current_user_tenant_ids()))
        OR (split_part(name, '/', 1)::uuid IN (SELECT public.current_user_tenant_ids()))
    )
);

-- Storage RLS SELECT policy
CREATE POLICY "clinic_records_storage_select_policy" ON storage.objects
FOR SELECT TO authenticated
USING (
    bucket_id = 'clinic-records'
    AND (
        (split_part(name, '/', 1) = 'tenants' AND split_part(name, '/', 2)::uuid IN (SELECT public.current_user_tenant_ids()))
        OR (split_part(name, '/', 1)::uuid IN (SELECT public.current_user_tenant_ids()))
    )
);

-- Storage RLS UPDATE policy
CREATE POLICY "clinic_records_storage_update_policy" ON storage.objects
FOR UPDATE TO authenticated
USING (
    bucket_id = 'clinic-records'
    AND (
        (split_part(name, '/', 1) = 'tenants' AND split_part(name, '/', 2)::uuid IN (SELECT public.current_user_tenant_ids()))
        OR (split_part(name, '/', 1)::uuid IN (SELECT public.current_user_tenant_ids()))
    )
)
WITH CHECK (
    bucket_id = 'clinic-records'
    AND (
        (split_part(name, '/', 1) = 'tenants' AND split_part(name, '/', 2)::uuid IN (SELECT public.current_user_tenant_ids()))
        OR (split_part(name, '/', 1)::uuid IN (SELECT public.current_user_tenant_ids()))
    )
);

-- Storage RLS DELETE policy
CREATE POLICY "clinic_records_storage_delete_policy" ON storage.objects
FOR DELETE TO authenticated
USING (
    bucket_id = 'clinic-records'
    AND (
        (split_part(name, '/', 1) = 'tenants' AND split_part(name, '/', 2)::uuid IN (SELECT public.current_user_tenant_ids()))
        OR (split_part(name, '/', 1)::uuid IN (SELECT public.current_user_tenant_ids()))
    )
);

-- 2. Table public.patient_documents
CREATE TABLE IF NOT EXISTS public.patient_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    document_type TEXT NOT NULL DEFAULT 'lab_report' CHECK (document_type IN ('lab_report', 'imaging', 'prescription_scan', 'other')),
    original_filename TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    mime_type TEXT NOT NULL,
    report_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    is_abnormal BOOLEAN NOT NULL DEFAULT false,
    uploaded_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_documents_tenant_patient_date
ON public.patient_documents (tenant_id, patient_id, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_patient_documents_visit
ON public.patient_documents (visit_id);

ALTER TABLE public.patient_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "patient_documents_tenant_isolation" ON public.patient_documents;
CREATE POLICY "patient_documents_tenant_isolation"
ON public.patient_documents
FOR ALL
TO authenticated
USING (
    tenant_id IN (SELECT public.current_user_tenant_ids())
)
WITH CHECK (
    tenant_id IN (SELECT public.current_user_tenant_ids())
);

-- 3. Table public.document_share_tokens
CREATE TABLE IF NOT EXISTS public.document_share_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES public.patient_documents(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_tokens_token_active
ON public.document_share_tokens (token)
WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_doc_tokens_tenant
ON public.document_share_tokens (tenant_id);

ALTER TABLE public.document_share_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "doc_tokens_staff_manage" ON public.document_share_tokens;
CREATE POLICY "doc_tokens_staff_manage"
ON public.document_share_tokens
FOR ALL
TO authenticated
USING (
    tenant_id IN (SELECT public.current_user_tenant_ids())
)
WITH CHECK (
    tenant_id IN (SELECT public.current_user_tenant_ids())
);

-- 4. Table public.referrals
CREATE TABLE IF NOT EXISTS public.referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    visit_id UUID REFERENCES public.visits(id) ON DELETE SET NULL,
    referral_type TEXT NOT NULL CHECK (referral_type IN ('out_of_network', 'in_network')),
    referring_doctor_id UUID NOT NULL REFERENCES auth.users(id),
    referred_to_name TEXT NOT NULL,
    referred_to_facility TEXT,
    referred_to_specialty TEXT,
    referred_to_contact TEXT,
    target_tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
    target_doctor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reason_for_referral TEXT NOT NULL,
    provisional_diagnosis TEXT,
    urgency TEXT NOT NULL DEFAULT 'routine' CHECK (urgency IN ('routine', 'priority', 'urgent')),
    clinical_summary TEXT,
    active_medications_snapshot JSONB DEFAULT '[]'::jsonb,
    investigations_advised TEXT[] DEFAULT '{}',
    patient_consents_history_sharing BOOLEAN NOT NULL DEFAULT false,
    consented_history_snapshot JSONB,
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'acknowledged', 'completed', 'cancelled')),
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    closure_notes TEXT,
    closed_by UUID REFERENCES auth.users(id),
    pdf_storage_path TEXT,
    letterhead_mode TEXT NOT NULL DEFAULT 'blank_paper' CHECK (letterhead_mode IN ('blank_paper', 'preprinted_letterhead')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referrals_tenant_status_sent
ON public.referrals (tenant_id, status, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_referrals_target_tenant_status
ON public.referrals (target_tenant_id, status)
WHERE target_tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_referrals_patient
ON public.referrals (patient_id);

CREATE INDEX IF NOT EXISTS idx_referrals_visit
ON public.referrals (visit_id);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Originating tenant: full access to manage own referrals
DROP POLICY IF EXISTS "referrals_originating_tenant_manage" ON public.referrals;
CREATE POLICY "referrals_originating_tenant_manage"
ON public.referrals
FOR ALL
TO authenticated
USING (
    tenant_id IN (SELECT public.current_user_tenant_ids())
)
WITH CHECK (
    tenant_id IN (SELECT public.current_user_tenant_ids())
);

-- Target tenant (in-network receiving clinic): can view inbound referrals
DROP POLICY IF EXISTS "referrals_target_tenant_select" ON public.referrals;
CREATE POLICY "referrals_target_tenant_select"
ON public.referrals
FOR SELECT
TO authenticated
USING (
    target_tenant_id IS NOT NULL
    AND target_tenant_id IN (SELECT public.current_user_tenant_ids())
);

-- Target tenant (in-network receiving clinic): can update status/acknowledgment
DROP POLICY IF EXISTS "referrals_target_tenant_update" ON public.referrals;
CREATE POLICY "referrals_target_tenant_update"
ON public.referrals
FOR UPDATE
TO authenticated
USING (
    target_tenant_id IS NOT NULL
    AND target_tenant_id IN (SELECT public.current_user_tenant_ids())
)
WITH CHECK (
    target_tenant_id IS NOT NULL
    AND target_tenant_id IN (SELECT public.current_user_tenant_ids())
);
