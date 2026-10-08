-- Migration: 000006_appointments_queue_waitlist.sql
-- Unified Visits (Scheduled & Walk-In), Queue Tokens, and Waitlist Entries with Row Level Security

-- 1. Alter patients table: add demographic extensions
ALTER TABLE public.patients
ADD COLUMN IF NOT EXISTS age INTEGER,
ADD COLUMN IF NOT EXISTS allergies TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS chronic_conditions TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS emergency_contact JSONB;

-- 2. Create visits table (Unified Appointment & Walk-In model)
CREATE TABLE IF NOT EXISTS public.visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES auth.users(id),
    origin_type TEXT NOT NULL CHECK (origin_type IN ('scheduled', 'walk_in')),
    status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN (
        'booked',
        'confirmed',
        'waiting',
        'in_consultation',
        'completed',
        'cancelled',
        'no_show'
    )),
    scheduled_at TIMESTAMPTZ,
    estimated_duration_minutes INTEGER NOT NULL DEFAULT 15,
    reason_for_visit TEXT,
    is_overbooked BOOLEAN NOT NULL DEFAULT false,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visits_tenant_doctor_sched ON public.visits(tenant_id, doctor_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_visits_tenant_patient ON public.visits(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_visits_tenant_status ON public.visits(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_visits_tenant_created ON public.visits(tenant_id, created_at DESC);

-- 3. Create queue_tokens table (Daily sequential token operational layer)
CREATE TABLE IF NOT EXISTS public.queue_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    visit_id UUID NOT NULL UNIQUE REFERENCES public.visits(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    token_number INTEGER NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent', 'vip')),
    called_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_date_token UNIQUE (tenant_id, date, token_number)
);

CREATE INDEX IF NOT EXISTS idx_queue_tokens_tenant_date ON public.queue_tokens(tenant_id, date, token_number);

-- 4. Create waitlist_entries table
CREATE TABLE IF NOT EXISTS public.waitlist_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    doctor_id UUID REFERENCES auth.users(id),
    target_date DATE NOT NULL,
    time_window TEXT,
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'promoted', 'expired', 'cancelled')),
    promoted_visit_id UUID REFERENCES public.visits(id),
    priority INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_tenant_date_status ON public.waitlist_entries(tenant_id, target_date, status);

-- 5. RPC function: generate_daily_queue_token
CREATE OR REPLACE FUNCTION public.generate_daily_queue_token(p_tenant_id UUID, p_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_next_token INTEGER;
BEGIN
    SELECT COALESCE(MAX(token_number), 0) + 1
    INTO v_next_token
    FROM public.queue_tokens
    WHERE tenant_id = p_tenant_id AND date = p_date;

    RETURN v_next_token;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_daily_queue_token(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_daily_queue_token(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_daily_queue_token(UUID, DATE) TO service_role;

-- 6. Enable Row Level Security (RLS)
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies for visits
CREATE POLICY "visits_select_member"
ON public.visits
FOR SELECT
TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "visits_insert_member"
ON public.visits
FOR INSERT
TO authenticated
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "visits_update_member"
ON public.visits
FOR UPDATE
TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "visits_delete_member"
ON public.visits
FOR DELETE
TO authenticated
USING (
    tenant_id IN (SELECT public.current_user_tenant_ids())
    AND auth.uid() IN (SELECT user_id FROM public.memberships WHERE tenant_id = visits.tenant_id AND role IN ('owner', 'admin'))
);

-- 8. RLS Policies for queue_tokens
CREATE POLICY "queue_tokens_select_member"
ON public.queue_tokens
FOR SELECT
TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "queue_tokens_insert_member"
ON public.queue_tokens
FOR INSERT
TO authenticated
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "queue_tokens_update_member"
ON public.queue_tokens
FOR UPDATE
TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "queue_tokens_delete_member"
ON public.queue_tokens
FOR DELETE
TO authenticated
USING (
    tenant_id IN (SELECT public.current_user_tenant_ids())
    AND auth.uid() IN (SELECT user_id FROM public.memberships WHERE tenant_id = queue_tokens.tenant_id AND role IN ('owner', 'admin'))
);

-- 9. RLS Policies for waitlist_entries
CREATE POLICY "waitlist_entries_select_member"
ON public.waitlist_entries
FOR SELECT
TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "waitlist_entries_insert_member"
ON public.waitlist_entries
FOR INSERT
TO authenticated
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "waitlist_entries_update_member"
ON public.waitlist_entries
FOR UPDATE
TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "waitlist_entries_delete_member"
ON public.waitlist_entries
FOR DELETE
TO authenticated
USING (
    tenant_id IN (SELECT public.current_user_tenant_ids())
    AND auth.uid() IN (SELECT user_id FROM public.memberships WHERE tenant_id = waitlist_entries.tenant_id AND role IN ('owner', 'admin'))
);
