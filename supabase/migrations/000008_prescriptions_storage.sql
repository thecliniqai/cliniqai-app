-- ============================================================================
-- Migration: 000008_prescriptions_storage.sql
-- Description: Creates private 'prescriptions' Supabase Storage bucket and sets
-- up multi-tenant RLS policies on storage.objects scoped to clinic membership.
-- ============================================================================

-- 1. Ensure private 'prescriptions' bucket exists
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'prescriptions',
    'prescriptions',
    false,
    10485760, -- 10MB limit
    ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['application/pdf'];

-- 2. Drop any prior policies
DROP POLICY IF EXISTS "prescriptions_storage_insert_policy" ON storage.objects;
DROP POLICY IF EXISTS "prescriptions_storage_select_policy" ON storage.objects;
DROP POLICY IF EXISTS "prescriptions_storage_update_policy" ON storage.objects;

-- 3. Storage RLS INSERT policy:
-- Authenticated users can only upload PDFs into their tenant folder
CREATE POLICY "prescriptions_storage_insert_policy" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'prescriptions'
    AND split_part(name, '/', 1)::uuid IN (SELECT public.current_user_tenant_ids())
);

-- 4. Storage RLS SELECT policy:
-- Authenticated users can only read prescription PDFs belonging to their tenant
CREATE POLICY "prescriptions_storage_select_policy" ON storage.objects
FOR SELECT TO authenticated
USING (
    bucket_id = 'prescriptions'
    AND split_part(name, '/', 1)::uuid IN (SELECT public.current_user_tenant_ids())
);

-- 5. Storage RLS UPDATE policy:
CREATE POLICY "prescriptions_storage_update_policy" ON storage.objects
FOR UPDATE TO authenticated
USING (
    bucket_id = 'prescriptions'
    AND split_part(name, '/', 1)::uuid IN (SELECT public.current_user_tenant_ids())
)
WITH CHECK (
    bucket_id = 'prescriptions'
    AND split_part(name, '/', 1)::uuid IN (SELECT public.current_user_tenant_ids())
);
