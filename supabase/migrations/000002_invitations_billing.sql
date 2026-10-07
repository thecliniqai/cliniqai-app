-- Migration: 000002_invitations_billing.sql
-- Staff Invitations, Subscriptions, Payment Records, and Clinic Profile Extensions

-- 1. Extend tenants table with profile fields
ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS specialties TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS working_hours JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- 2. Create invitations table
CREATE TABLE IF NOT EXISTS public.invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'doctor', 'receptionist', 'nurse')),
    invited_address TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    consumed_by UUID REFERENCES auth.users(id),
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitations_tenant_id ON public.invitations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invitations_token_hash ON public.invitations(token_hash);

-- 3. Create subscriptions table
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'standard',
    amount_inr INTEGER NOT NULL DEFAULT 1000,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'trialing')),
    current_period_end TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_id ON public.subscriptions(tenant_id);

-- 4. Create payment_records table
CREATE TABLE IF NOT EXISTS public.payment_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    amount_inr INTEGER NOT NULL,
    paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    method TEXT NOT NULL DEFAULT 'upi',
    reference TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_records_tenant_id ON public.payment_records(tenant_id);

-- 5. Enable Row Level Security
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies for invitations
-- Only owner/admin of that tenant can view invitations
CREATE POLICY "invitations_select_owner_admin"
ON public.invitations
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.memberships
        WHERE memberships.tenant_id = invitations.tenant_id
          AND memberships.user_id = auth.uid()
          AND memberships.role IN ('owner', 'admin')
    )
);

-- Only owner/admin of that tenant can create invitations
CREATE POLICY "invitations_insert_owner_admin"
ON public.invitations
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.memberships
        WHERE memberships.tenant_id = invitations.tenant_id
          AND memberships.user_id = auth.uid()
          AND memberships.role IN ('owner', 'admin')
    )
);

-- 7. RLS Policies for subscriptions
-- Only owner/admin of that tenant can view subscription details
CREATE POLICY "subscriptions_select_owner_admin"
ON public.subscriptions
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.memberships
        WHERE memberships.tenant_id = subscriptions.tenant_id
          AND memberships.user_id = auth.uid()
          AND memberships.role IN ('owner', 'admin')
    )
);

-- 8. RLS Policies for payment_records
-- Only owner/admin of that tenant can view payment records
CREATE POLICY "payment_records_select_owner_admin"
ON public.payment_records
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.memberships
        WHERE memberships.tenant_id = payment_records.tenant_id
          AND memberships.user_id = auth.uid()
          AND memberships.role IN ('owner', 'admin')
    )
);

-- 9. Atomic invitation consumption (security definer)
CREATE OR REPLACE FUNCTION public.consume_invitation(p_token_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_invite RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Lock invite row to prevent concurrent consumption
    SELECT * INTO v_invite
    FROM public.invitations
    WHERE token_hash = p_token_hash
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid invitation token';
    END IF;

    IF v_invite.consumed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Invitation has already been used';
    END IF;

    IF v_invite.expires_at < now() THEN
        RAISE EXCEPTION 'Invitation has expired';
    END IF;

    -- Insert membership for the joining user
    INSERT INTO public.memberships (user_id, tenant_id, role)
    VALUES (v_user_id, v_invite.tenant_id, v_invite.role);

    -- Mark invitation as consumed
    UPDATE public.invitations
    SET consumed_at = now(),
        consumed_by = v_user_id
    WHERE id = v_invite.id;

    RETURN v_invite.tenant_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_invitation(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_invitation(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.consume_invitation(TEXT) TO authenticated;
