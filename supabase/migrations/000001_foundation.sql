-- Migration: 000001_foundation.sql
-- Foundation & Tenant Isolation: tenants, memberships, RLS policies, and atomic clinic creation

-- 1. Create tenants table
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Create memberships table (M:N user-tenant mapping with role)
CREATE TABLE IF NOT EXISTS public.memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'doctor', 'receptionist', 'nurse')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_user_tenant UNIQUE (user_id, tenant_id)
);

-- 3. Indexes for fast tenant scoping and membership resolution
CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON public.memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_tenant_id ON public.memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenants_created_at ON public.tenants(created_at);

-- 4. Enable Row Level Security (MANDATORY on every tenant table per AGENTS.md §5, §7)
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

-- 5. Helper function: Get tenant IDs accessible to current authenticated user
CREATE OR REPLACE FUNCTION public.current_user_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT tenant_id 
    FROM public.memberships 
    WHERE user_id = auth.uid();
$$;

-- 6. RLS Policies for tenants
-- Users can view tenants they are members of
CREATE POLICY "tenants_select_membership"
ON public.tenants
FOR SELECT
TO authenticated
USING (id IN (SELECT public.current_user_tenant_ids()));

-- Only owners and admins can update tenant profile
CREATE POLICY "tenants_update_owner_admin"
ON public.tenants
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.memberships
        WHERE memberships.tenant_id = tenants.id
          AND memberships.user_id = auth.uid()
          AND memberships.role IN ('owner', 'admin')
    )
);

-- 7. RLS Policies for memberships
-- Users can view memberships in their active tenants
CREATE POLICY "memberships_select_tenant"
ON public.memberships
FOR SELECT
TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

-- NOTE: No permissive INSERT policy on memberships.
-- Membership rows must only be created via the security definer function below or invitation consumption!

-- 8. Atomic clinic creation with first owner membership
CREATE OR REPLACE FUNCTION public.create_clinic_with_owner(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF trim(p_name) = '' THEN
        RAISE EXCEPTION 'Clinic name cannot be empty';
    END IF;

    -- Insert tenant
    INSERT INTO public.tenants (name)
    VALUES (trim(p_name))
    RETURNING id INTO v_tenant_id;

    -- Insert initial owner membership
    INSERT INTO public.memberships (user_id, tenant_id, role)
    VALUES (v_user_id, v_tenant_id, 'owner');

    RETURN v_tenant_id;
END;
$$;

-- Revoke execute from public/anon, grant only to authenticated users
REVOKE EXECUTE ON FUNCTION public.create_clinic_with_owner(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_clinic_with_owner(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_clinic_with_owner(TEXT) TO authenticated;
