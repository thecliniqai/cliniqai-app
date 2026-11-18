-- Migration: 000082_tenant_subscriptions.sql
-- V2-05 plan 05-09a step 3 (SUB-01; SUBSCRIPTIONS_AND_PLANS.md §6.1, §6.6, §7.1, §7.2; rulings R-10, R-13, R-24, R-26;
-- research Pitfall 5).
--
-- 1. `public.tenant_subscriptions`: the clinic's BASE subscription, one row per tenant (PK `tenant_id`), every SUB §7.1
--    column (status of the seven states, trial and period dates, `access_ends_at` maintained by the transition RPCs,
--    the cancel flags, grace/halt, the lifecycle timestamps, `comp_until`, provider ids, the folded-in mandate columns,
--    `trial_consumed`, `version`). Updated only by transition RPCs (billing_internal.start_trial here; platform.* in
--    05-09b; the provider webhooks in V2-13b) or the service role.
-- 2. `public.subscription_events`: the append-only lifecycle log. Append-only BY GRANTS (Pitfall 5: a delete trigger
--    would break the tenant cascade that teardown and the purge rely on): no API role holds UPDATE/DELETE/TRUNCATE, and
--    the service role keeps only SELECT/INSERT. The payload carries no PII (CHECKed to be an object).
-- 3. `public.platform_settings`: the single settings row (`id boolean PRIMARY KEY DEFAULT true CHECK (id)`); the row
--    itself is seeded in 000084.
-- 4. SELECT on tenant_subscriptions / subscription_events for the clinic's owners and admins in the ACTIVE clinic
--    (`authz.billing_tenant_ids()`, R-26/R-40: from 05-10a it also admits `locked`/`onboarding` clinics, so a locked
--    owner can still reach /billing/locked). platform_settings: no tenant access.
-- 5. AFTER INSERT trigger `tenants_create_subscription` on `tenants` (SECURITY DEFINER, R-24): every new clinic gets
--    exactly one `incomplete` row (`ON CONFLICT DO NOTHING`), whoever inserts it: `create_clinic_with_owner`, the
--    service role, or a migration. Existing clinics are backfilled `incomplete` (local and staging only; production
--    starts empty). Until 05-10a the RLS helpers ignore the access level, so `incomplete` changes nothing for users.

-- 1. -----------------------------------------------------------------------------------------------------------------
CREATE TABLE public.tenant_subscriptions (
    tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
    plan_price_id uuid REFERENCES public.plan_prices (id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'incomplete'
        CHECK (status IN ('incomplete', 'trialing', 'active', 'past_due', 'expired', 'archived', 'purged')),
    trial_start timestamptz,
    trial_end timestamptz,
    current_period_start timestamptz,
    current_period_end timestamptz,
    access_ends_at timestamptz,
    cancel_at_period_end boolean NOT NULL DEFAULT false,
    canceled_at timestamptz,
    cancel_source text CHECK (cancel_source IS NULL OR cancel_source IN ('owner', 'upi_app', 'admin', 'provider')),
    past_due_since timestamptz,
    grace_until timestamptz,
    halted_at timestamptz,
    expired_at timestamptz,
    archive_at timestamptz,
    archived_at timestamptz,
    purge_at timestamptz,
    purged_at timestamptz,
    comp_until timestamptz,
    provider text NOT NULL DEFAULT 'razorpay' CHECK (provider IN ('razorpay')),
    provider_customer_id text CHECK (provider_customer_id IS NULL OR provider_customer_id ~ '^[A-Za-z0-9_]{1,64}$'),
    provider_subscription_id text CHECK (provider_subscription_id IS NULL OR provider_subscription_id ~ '^[A-Za-z0-9_]{1,64}$'),
    mandate_method text CHECK (mandate_method IS NULL OR mandate_method IN ('upi', 'card')),
    mandate_display text CHECK (mandate_display IS NULL OR length(mandate_display) <= 64),
    mandate_max_paise bigint CHECK (mandate_max_paise IS NULL OR mandate_max_paise >= 0),
    mandate_authenticated_at timestamptz,
    mandate_revoked_at timestamptz,
    trial_consumed boolean NOT NULL DEFAULT false,
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tenant_subscriptions_trial_window CHECK (trial_end IS NULL OR trial_start IS NULL OR trial_end > trial_start),
    CONSTRAINT tenant_subscriptions_period_window
        CHECK (current_period_end IS NULL OR current_period_start IS NULL OR current_period_end > current_period_start),
    CONSTRAINT tenant_subscriptions_provider_subscription_key UNIQUE (provider, provider_subscription_id)
);
CREATE INDEX idx_tenant_subscriptions_plan_price_id ON public.tenant_subscriptions (plan_price_id);
COMMENT ON TABLE public.tenant_subscriptions IS
    'SUB-01 base subscription, one row per clinic (SUB §7.1). Access is decided by billing_internal.tenant_access_level from timestamps, never from a job having run (SUB §6.2). Written only by transition RPCs or the service role.';

-- 2. -----------------------------------------------------------------------------------------------------------------
CREATE TABLE public.subscription_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    subject text NOT NULL DEFAULT 'base'
        CHECK (subject = 'base' OR subject ~ '^addon:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    type text NOT NULL CHECK (type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,3}$'),
    from_status text CHECK (from_status IS NULL OR from_status IN
        ('incomplete', 'trialing', 'active', 'past_due', 'expired', 'archived', 'purged')),
    to_status text CHECK (to_status IS NULL OR to_status IN
        ('incomplete', 'trialing', 'active', 'past_due', 'expired', 'archived', 'purged')),
    actor_type text NOT NULL CHECK (actor_type IN ('system', 'owner', 'admin', 'platform_admin', 'provider')),
    actor_id uuid,
    reason text CHECK (reason IS NULL OR length(reason) <= 500),
    provider_event_id text CHECK (provider_event_id IS NULL OR length(provider_event_id) <= 128),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
    occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_subscription_events_tenant ON public.subscription_events (tenant_id, occurred_at);
COMMENT ON TABLE public.subscription_events IS
    'SUB-01 subscription lifecycle log (SUB §7.1, §6.6): append-only by grants (no UPDATE/DELETE for any API role or the service role); payload without PII.';

-- 3. -----------------------------------------------------------------------------------------------------------------
CREATE TABLE public.platform_settings (
    id boolean PRIMARY KEY DEFAULT true CONSTRAINT platform_settings_single_row CHECK (id),
    lock_window_days integer NOT NULL DEFAULT 30 CHECK (lock_window_days BETWEEN 0 AND 365),
    purge_after_days integer NOT NULL DEFAULT 180 CHECK (purge_after_days BETWEEN 0 AND 3650),
    pending_charge_buffer_hours integer NOT NULL DEFAULT 24 CHECK (pending_charge_buffer_hours BETWEEN 0 AND 168),
    gst_retention_months integer NOT NULL DEFAULT 72 CHECK (gst_retention_months BETWEEN 0 AND 240),
    log_retention_days integer NOT NULL DEFAULT 365 CHECK (log_retention_days BETWEEN 0 AND 3650),
    supplier_gstin text CHECK (supplier_gstin IS NULL OR supplier_gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
    supplier_state text CHECK (supplier_state IS NULL OR length(supplier_state) BETWEEN 1 AND 60),
    sac text NOT NULL DEFAULT '998314' CHECK (sac ~ '^[0-9]{6}$'),
    ai_features jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(ai_features) = 'object'),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT platform_settings_purge_after_lock CHECK (purge_after_days >= lock_window_days)
);
COMMENT ON TABLE public.platform_settings IS
    'SUB-01 single settings row (SUB §4, §7.1): lock window, purge horizon, pending-charge buffer, retention, supplier GST facts, ai_features kill switch (AI-03). No tenant access.';

-- RLS and grants (closed by default, R-13) ---------------------------------------------------------------------------
ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tenant_subscriptions, public.subscription_events, public.platform_settings
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tenant_subscriptions, public.subscription_events TO authenticated;
-- Append-only by grants, also for the service role (Pitfall 5): the tenant cascade runs as the table owner.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.subscription_events FROM service_role;

CREATE POLICY tenant_subscriptions_select ON public.tenant_subscriptions
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.billing_tenant_ids()));
CREATE POLICY subscription_events_select ON public.subscription_events
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.billing_tenant_ids()));
-- platform_settings: no policy and no grant.

-- 5. -----------------------------------------------------------------------------------------------------------------
CREATE FUNCTION private.tenants_create_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.tenant_subscriptions (tenant_id, status)
    VALUES (NEW.id, 'incomplete')
    ON CONFLICT (tenant_id) DO NOTHING;
    RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.tenants_create_subscription() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.tenants_create_subscription() IS
    'R-24: every new clinic starts with exactly one incomplete tenant_subscriptions row, whoever inserts the clinic.';

CREATE TRIGGER tenants_create_subscription
    AFTER INSERT ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION private.tenants_create_subscription();

-- Backfill (idempotent): clinics that existed before this migration start `incomplete` too.
INSERT INTO public.tenant_subscriptions (tenant_id, status)
SELECT t.id, 'incomplete' FROM public.tenants t
ON CONFLICT (tenant_id) DO NOTHING;
