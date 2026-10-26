-- ============================================================================
-- Migration: 000014_communications_and_ai.sql
-- Description: Phase 5 Communications & AI Assist:
--  1. Table communication_queue for asynchronous multi-channel outbox queueing.
--  2. Table tenant_messaging_config for company/clinic messaging quotas & quiet hours.
--  3. Table in_app_notifications for real-time internal clinic cue delivery.
--  4. Alter table patients to add communication preferences (language, opt-out, guardian).
--  5. Alter table document_share_tokens to make document_id nullable and add polymorphic resource columns.
-- ============================================================================

-- 1. Table public.communication_queue
CREATE TABLE IF NOT EXISTS public.communication_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES public.visits(id) ON DELETE SET NULL,
    channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'in_app')),
    message_type TEXT NOT NULL,
    template_id TEXT NOT NULL,
    template_params JSONB NOT NULL DEFAULT '{}'::jsonb,
    recipient_phone TEXT,
    recipient_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled', 'dead_letter')) DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    error_message TEXT,
    external_message_id TEXT,
    sent_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_queue_dispatch 
ON public.communication_queue (status, next_retry_at) 
WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_comm_queue_tenant 
ON public.communication_queue (tenant_id, created_at DESC);

ALTER TABLE public.communication_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "communication_queue_tenant_isolation" ON public.communication_queue;
CREATE POLICY "communication_queue_tenant_isolation"
ON public.communication_queue
FOR ALL
TO authenticated
USING (
    tenant_id IN (SELECT public.current_user_tenant_ids())
)
WITH CHECK (
    tenant_id IN (SELECT public.current_user_tenant_ids())
);

-- 2. Table public.tenant_messaging_config
CREATE TABLE IF NOT EXISTS public.tenant_messaging_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
    whatsapp_enabled BOOLEAN NOT NULL DEFAULT true,
    sms_enabled BOOLEAN NOT NULL DEFAULT true,
    monthly_quota INTEGER NOT NULL DEFAULT 200,
    messages_sent_this_month INTEGER NOT NULL DEFAULT 0,
    quota_warning_threshold INTEGER NOT NULL DEFAULT 160,
    quota_warning_sent_at TIMESTAMPTZ,
    quiet_hours_enabled BOOLEAN NOT NULL DEFAULT true,
    quiet_hours_start TIME NOT NULL DEFAULT '21:00',
    quiet_hours_end TIME NOT NULL DEFAULT '08:00',
    auto_prescription_share BOOLEAN NOT NULL DEFAULT false,
    auto_lab_share BOOLEAN NOT NULL DEFAULT false,
    auto_receipt_share BOOLEAN NOT NULL DEFAULT false,
    auto_reminder_hours INTEGER NOT NULL DEFAULT 24,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_messaging_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_messaging_config_tenant_isolation" ON public.tenant_messaging_config;
CREATE POLICY "tenant_messaging_config_tenant_isolation"
ON public.tenant_messaging_config
FOR ALL
TO authenticated
USING (
    tenant_id IN (SELECT public.current_user_tenant_ids())
)
WITH CHECK (
    tenant_id IN (SELECT public.current_user_tenant_ids())
);

-- 3. Table public.in_app_notifications
CREATE TABLE IF NOT EXISTS public.in_app_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    recipient_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    recipient_role TEXT CHECK (recipient_role IN ('doctor', 'receptionist', 'admin', 'owner', 'nurse')),
    category TEXT NOT NULL CHECK (category IN ('clinical', 'queue', 'billing', 'system')),
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    link_url TEXT,
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_in_app_notifs_user 
ON public.in_app_notifications (tenant_id, recipient_user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_in_app_notifs_role 
ON public.in_app_notifications (tenant_id, recipient_role, is_read, created_at DESC);

ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "in_app_notifications_tenant_isolation" ON public.in_app_notifications;
CREATE POLICY "in_app_notifications_tenant_isolation"
ON public.in_app_notifications
FOR ALL
TO authenticated
USING (
    tenant_id IN (SELECT public.current_user_tenant_ids())
)
WITH CHECK (
    tenant_id IN (SELECT public.current_user_tenant_ids())
);

-- 4. Alter table public.patients for communication preferences
ALTER TABLE public.patients
ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'mr')),
ADD COLUMN IF NOT EXISTS whatsapp_opt_out BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS guardian_name TEXT,
ADD COLUMN IF NOT EXISTS guardian_phone TEXT,
ADD COLUMN IF NOT EXISTS guardian_relationship TEXT;

-- 5. Alter table public.document_share_tokens to support polymorphic document access
ALTER TABLE public.document_share_tokens
ALTER COLUMN document_id DROP NOT NULL;

ALTER TABLE public.document_share_tokens
ADD COLUMN IF NOT EXISTS resource_type TEXT NOT NULL DEFAULT 'patient_document' 
  CHECK (resource_type IN ('patient_document', 'prescription', 'invoice', 'referral')),
ADD COLUMN IF NOT EXISTS resource_id UUID;
