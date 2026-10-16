-- Migration: 000012_doctor_availability_and_blocks.sql
-- Description: Add doctor availability schedules, slot duration to memberships, and create schedule_blocks table for leaves/vacations/blocks.

-- 1. Add availability_schedule and default_slot_duration_minutes to memberships
ALTER TABLE public.memberships 
ADD COLUMN IF NOT EXISTS availability_schedule JSONB DEFAULT '{
  "monday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}, {"start": "17:00", "end": "21:00"}]},
  "tuesday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}, {"start": "17:00", "end": "21:00"}]},
  "wednesday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}, {"start": "17:00", "end": "21:00"}]},
  "thursday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}, {"start": "17:00", "end": "21:00"}]},
  "friday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}, {"start": "17:00", "end": "21:00"}]},
  "saturday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}, {"start": "17:00", "end": "21:00"}]},
  "sunday": {"enabled": false, "shifts": []}
}'::jsonb;

ALTER TABLE public.memberships
ADD COLUMN IF NOT EXISTS default_slot_duration_minutes INTEGER DEFAULT 15;

-- 2. Create schedule_blocks table for doctor and clinic-wide blocked dates, time intervals, and ranges
CREATE TABLE IF NOT EXISTS public.schedule_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL indicates clinic-wide block
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  reason TEXT,
  all_day BOOLEAN DEFAULT false,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Indexes for efficient lookup
CREATE INDEX IF NOT EXISTS idx_schedule_blocks_tenant_doctor_time 
ON public.schedule_blocks (tenant_id, doctor_id, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_schedule_blocks_tenant_time 
ON public.schedule_blocks (tenant_id, start_time, end_time);

-- 4. Enable Row Level Security
ALTER TABLE public.schedule_blocks ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
-- SELECT: Authenticated members of the tenant can read schedule blocks
DROP POLICY IF EXISTS "schedule_blocks_select_tenant" ON public.schedule_blocks;
CREATE POLICY "schedule_blocks_select_tenant"
ON public.schedule_blocks
FOR SELECT
TO authenticated
USING (
  tenant_id IN (SELECT public.current_user_tenant_ids())
);

-- INSERT: Doctors can create blocks for themselves; Admins & Owners can create for any doctor or clinic-wide
DROP POLICY IF EXISTS "schedule_blocks_insert_tenant" ON public.schedule_blocks;
CREATE POLICY "schedule_blocks_insert_tenant"
ON public.schedule_blocks
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id IN (SELECT public.current_user_tenant_ids())
  AND (
    doctor_id = auth.uid()
    OR doctor_id IS NULL
    OR public.current_user_is_admin_or_owner(tenant_id)
  )
);

-- UPDATE: Creator, matching doctor, or admin/owner
DROP POLICY IF EXISTS "schedule_blocks_update_tenant" ON public.schedule_blocks;
CREATE POLICY "schedule_blocks_update_tenant"
ON public.schedule_blocks
FOR UPDATE
TO authenticated
USING (
  tenant_id IN (SELECT public.current_user_tenant_ids())
  AND (
    created_by = auth.uid()
    OR doctor_id = auth.uid()
    OR public.current_user_is_admin_or_owner(tenant_id)
  )
)
WITH CHECK (
  tenant_id IN (SELECT public.current_user_tenant_ids())
);

-- DELETE: Creator, matching doctor, or admin/owner
DROP POLICY IF EXISTS "schedule_blocks_delete_tenant" ON public.schedule_blocks;
CREATE POLICY "schedule_blocks_delete_tenant"
ON public.schedule_blocks
FOR DELETE
TO authenticated
USING (
  tenant_id IN (SELECT public.current_user_tenant_ids())
  AND (
    created_by = auth.uid()
    OR doctor_id = auth.uid()
    OR public.current_user_is_admin_or_owner(tenant_id)
  )
);
