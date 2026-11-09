-- Migration: 000018_api_keys_webhooks_dpdp.sql
-- API Keys, Daily Usage Tracking, Webhooks Outbox Queue, and DPDP / Statutory Extensions

-- 1. Create public.api_keys
CREATE TABLE IF NOT EXISTS public.api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON public.api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON public.api_keys (tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON public.api_keys (key_prefix) WHERE revoked_at IS NULL;

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_keys_owner_admin" ON public.api_keys;
CREATE POLICY "api_keys_owner_admin"
ON public.api_keys
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.memberships
        WHERE memberships.tenant_id = api_keys.tenant_id
          AND memberships.user_id = auth.uid()
          AND memberships.role IN ('owner', 'admin')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.memberships
        WHERE memberships.tenant_id = api_keys.tenant_id
          AND memberships.user_id = auth.uid()
          AND memberships.role IN ('owner', 'admin')
    )
);

-- 2. Create public.api_key_usage_daily
CREATE TABLE IF NOT EXISTS public.api_key_usage_daily (
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    api_key_id UUID NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    last_request_at TIMESTAMPTZ,
    PRIMARY KEY (api_key_id, date)
);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_tenant ON public.api_key_usage_daily (tenant_id, date);

ALTER TABLE public.api_key_usage_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_key_usage_owner_admin" ON public.api_key_usage_daily;
CREATE POLICY "api_key_usage_owner_admin"
ON public.api_key_usage_daily
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.memberships
        WHERE memberships.tenant_id = api_key_usage_daily.tenant_id
          AND memberships.user_id = auth.uid()
          AND memberships.role IN ('owner', 'admin')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.memberships
        WHERE memberships.tenant_id = api_key_usage_daily.tenant_id
          AND memberships.user_id = auth.uid()
          AND memberships.role IN ('owner', 'admin')
    )
);

-- 3. Create public.webhook_subscriptions
CREATE TABLE IF NOT EXISTS public.webhook_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    endpoint_url TEXT NOT NULL,
    event_types TEXT[] NOT NULL,
    signing_secret TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_subs_tenant ON public.webhook_subscriptions (tenant_id);

ALTER TABLE public.webhook_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "webhook_subs_owner_admin" ON public.webhook_subscriptions;
CREATE POLICY "webhook_subs_owner_admin"
ON public.webhook_subscriptions
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.memberships
        WHERE memberships.tenant_id = webhook_subscriptions.tenant_id
          AND memberships.user_id = auth.uid()
          AND memberships.role IN ('owner', 'admin')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.memberships
        WHERE memberships.tenant_id = webhook_subscriptions.tenant_id
          AND memberships.user_id = auth.uid()
          AND memberships.role IN ('owner', 'admin')
    )
);

-- 4. Create public.webhook_delivery_queue
CREATE TABLE IF NOT EXISTS public.webhook_delivery_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES public.webhook_subscriptions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 5,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    response_status INTEGER,
    duration_ms INTEGER,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_queue_status_retry ON public.webhook_delivery_queue (status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_webhook_queue_sub ON public.webhook_delivery_queue (subscription_id);
CREATE INDEX IF NOT EXISTS idx_webhook_queue_tenant ON public.webhook_delivery_queue (tenant_id);

ALTER TABLE public.webhook_delivery_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "webhook_queue_owner_admin" ON public.webhook_delivery_queue;
CREATE POLICY "webhook_queue_owner_admin"
ON public.webhook_delivery_queue
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.memberships
        WHERE memberships.tenant_id = webhook_delivery_queue.tenant_id
          AND memberships.user_id = auth.uid()
          AND memberships.role IN ('owner', 'admin')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.memberships
        WHERE memberships.tenant_id = webhook_delivery_queue.tenant_id
          AND memberships.user_id = auth.uid()
          AND memberships.role IN ('owner', 'admin')
    )
);

-- 5. Alter public.patients with DPDP soft-delete & erasure columns
ALTER TABLE public.patients
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
ADD COLUMN IF NOT EXISTS erased_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS erasure_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_patients_tenant_active ON public.patients(tenant_id, is_deleted);

-- 6. Alter public.tenants with statutory registration columns
ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS clinical_establishment_reg_no TEXT,
ADD COLUMN IF NOT EXISTS state_medical_council_reg_no TEXT,
ADD COLUMN IF NOT EXISTS gstin TEXT,
ADD COLUMN IF NOT EXISTS drug_license_no TEXT;

-- 7. Alter public.audit_logs with API key actor columns
ALTER TABLE public.audit_logs
ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'user',
ADD COLUMN IF NOT EXISTS api_key_id UUID REFERENCES public.api_keys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_api_key ON public.audit_logs(api_key_id) WHERE api_key_id IS NOT NULL;
