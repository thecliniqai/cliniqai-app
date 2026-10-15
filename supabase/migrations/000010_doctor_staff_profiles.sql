-- Migration: 000010_doctor_staff_profiles.sql
-- Add full_name, phone to memberships and enable RLS UPDATE policy for self & clinic admins

-- 1. Add full_name and phone to memberships table
ALTER TABLE public.memberships
ADD COLUMN IF NOT EXISTS full_name TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT;

-- 2. Populate initial full_name and phone from auth.users metadata if available
UPDATE public.memberships m
SET full_name = COALESCE(u.raw_user_meta_data->>'full_name', m.full_name),
    phone = COALESCE(u.raw_user_meta_data->>'phone', u.phone, m.phone)
FROM auth.users u
WHERE m.user_id = u.id AND (m.full_name IS NULL OR m.phone IS NULL);

-- 3. RLS UPDATE policy on memberships
-- Users can update their own membership in their tenant,
-- or owners and admins can update any membership in their tenant.
DROP POLICY IF EXISTS "memberships_update_tenant" ON public.memberships;

CREATE POLICY "memberships_update_tenant"
ON public.memberships
FOR UPDATE
TO authenticated
USING (
    tenant_id IN (SELECT public.current_user_tenant_ids())
    AND (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.memberships m
            WHERE m.tenant_id = memberships.tenant_id
              AND m.user_id = auth.uid()
              AND m.role IN ('owner', 'admin')
        )
    )
)
WITH CHECK (
    tenant_id IN (SELECT public.current_user_tenant_ids())
);
