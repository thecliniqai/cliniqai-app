-- Migration: 000011_fix_memberships_rls_recursion.sql
-- Fix 42P17 infinite recursion in memberships UPDATE policy by using a SECURITY DEFINER helper function.

-- 1. Helper function: check if current user is owner or admin in a tenant
-- Marked SECURITY DEFINER so that internal queries to public.memberships run with
-- elevated privileges and bypass RLS, preventing infinite recursion (error 42P17).
CREATE OR REPLACE FUNCTION public.current_user_is_admin_or_owner(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM public.memberships 
        WHERE tenant_id = p_tenant_id 
          AND user_id = auth.uid() 
          AND role IN ('owner', 'admin')
    );
$$;

-- 2. Drop the recursive policy and re-create it using the SECURITY DEFINER function
DROP POLICY IF EXISTS "memberships_update_tenant" ON public.memberships;

CREATE POLICY "memberships_update_tenant"
ON public.memberships
FOR UPDATE
TO authenticated
USING (
    tenant_id IN (SELECT public.current_user_tenant_ids())
    AND (
        user_id = auth.uid()
        OR public.current_user_is_admin_or_owner(tenant_id)
    )
)
WITH CHECK (
    tenant_id IN (SELECT public.current_user_tenant_ids())
);
