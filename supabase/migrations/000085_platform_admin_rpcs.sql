-- Migration: 000085_platform_admin_rpcs.sql
-- V2-05 plan 05-09b (SUB-01 transition RPCs, AI-18 availability switch; SUBSCRIPTIONS_AND_PLANS.md §6.2, §8.1, §9.2;
-- rulings R-10, R-13; threat T-05-33).
--
-- 1. `public.platform_admins` (user_id PK → auth.users ON DELETE RESTRICT: an admin is revoked through `revoked_at`,
--    never deleted by an auth-user delete; every grant/revocation is audited by a trigger) and `public.platform_audit_log` (append-only by grants: no API role and not
--    the service role may write it; the definer RPCs below are its only writers; `actor_id`/`target_tenant_id` carry no
--    FK, so the record outlives the user and the clinic purge, SUB §6.6). RLS on, no policy, no tenant grant.
-- 2. `public.is_platform_admin()` (SECURITY DEFINER, SUB §9.2): an active `platform_admins` row for `auth.uid()` AND
--    `auth.jwt() ->> 'aal' = 'aal2'`. `authenticated` only.
-- 3. `private.platform_actor(p_actor)`: the SUB §8.1 actor rule, shared by every `platform.*` RPC.
--    DEVIATION from SUB §8.1's text (05-09b record, proposed erratum): the block tests `current_user`, which inside a
--    SECURITY DEFINER function is always the function's owner (`postgres`), so every JWT caller would take the SQL
--    branch and could name any admin in `p_actor`. The caller is therefore read from the session: the `role` setting
--    PostgREST (and `SET ROLE`) sets, else `session_user` (the SQL editor / a direct `postgres` connection).
--      postgres / service_role (no JWT): `p_actor` is required and must be an active platform admin, else 42501
--        PLATFORM_ACTOR_INVALID; channel 'sql'.
--      any other caller (a JWT): `p_actor` is IGNORED; `is_platform_admin()` is required, else 42501
--        PLATFORM_ADMIN_REQUIRED; actor = auth.uid(); channel 'ui'.
-- 4. The `platform.*` RPCs (SECURITY DEFINER, `search_path = ''`, EXECUTE for authenticated and service_role only,
--    SUB §8.1). Each resolves the actor first, takes `lock_timeout 5s`, row-locks what it changes, writes one
--    `platform_audit_log` row (with the channel, before/after, the reason) and, when tenant-scoped, one
--    `subscription_events` row; tenant-scoped ones bump `tenant_subscriptions.version` and maintain `access_ends_at`.
--      extend_trial(tenant, by, reason, actor)        a `trialing` clinic's trial_end += by (0 < by <= 90 days);
--                                                     access_ends_at = trial_end + buffer (no buffer when cancelling)
--      set_comp(tenant, until, reason, actor)         comp_until = until (future, < 5 years) or NULL (clears it);
--                                                     refused on a `purged` clinic
--      grant_override(tenant, key, enabled, limit, expires_at, reason, actor)
--                                                     upsert of the clinic's override for a known key (a boolean key
--                                                     takes no limit; an enabled limit key needs one)
--      create_plan_price(code, model, base, bp, inclusive, provider_plan_id, active_from, actor)
--                                                     a new price version (flat_recurring, GST-exclusive, PO-20); the
--                                                     plan's open price of that model closes at the new active_from
--      set_product_availability(code, purchasable, visibility, actor)
--                                                     refuses purchasable = true unless the plan has a price active now
--                                                     with a provider plan id (acceptance 13; AI-18), and for a trial or
--                                                     retired plan
-- Machine reasons (05-PLAN checklist 9): 42501 PLATFORM_ADMIN_REQUIRED / PLATFORM_ACTOR_INVALID (→ FORBIDDEN by
-- SQLSTATE); P0001 INPUT_INVALID, SUBSCRIPTION_STATE_INVALID, PLAN_PRICE_INVALID (registered by 05-09a),
-- ENTITLEMENT_KEY_UNKNOWN, PRODUCT_PRICE_REQUIRED, PRODUCT_STATE_INVALID (registered in lib/db/errors.ts here); P0002
-- SUBSCRIPTION_NOT_FOUND, PLAN_NOT_FOUND.

-- 1. -----------------------------------------------------------------------------------------------------------------
CREATE TABLE public.platform_admins (
    user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE RESTRICT,
    granted_at timestamptz NOT NULL DEFAULT now(),
    granted_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    revoked_at timestamptz,
    CONSTRAINT platform_admins_revoked_after_grant CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);
CREATE INDEX idx_platform_admins_granted_by ON public.platform_admins (granted_by);
COMMENT ON TABLE public.platform_admins IS
    'SUB §9.2 platform admins: not a tenant role, never derived from memberships. Bootstrap and revocation by SQL as postgres (docs/runbooks/subscriptions-sql.md); revoke with revoked_at, never delete. No API-role access.';

CREATE TABLE public.platform_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id uuid,
    channel text NOT NULL CHECK (channel IN ('sql', 'ui')),
    action text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$'),
    target_tenant_id uuid,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 8192),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    -- Every RPC row names its admin. Only a direct SQL change of platform_admins (bootstrap, revocation) may have no
    -- known actor: the trigger below records the session user in the payload instead.
    CONSTRAINT platform_audit_log_actor_known CHECK (actor_id IS NOT NULL OR action LIKE 'platform\_admin.%')
);
CREATE INDEX idx_platform_audit_log_target ON public.platform_audit_log (target_tenant_id, occurred_at);
CREATE INDEX idx_platform_audit_log_actor ON public.platform_audit_log (actor_id, occurred_at);
COMMENT ON TABLE public.platform_audit_log IS
    'SUB §9.2 platform audit trail: actor, channel (sql|ui), action, target clinic, before/after and reason in payload (no PII). Append-only by grants; written only by the platform.* RPCs; no FK, so it outlives users and the clinic purge (SUB §6.6).';

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_admins, public.platform_audit_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.platform_admins, public.platform_audit_log TO service_role;
-- No policy: no tenant role reads or writes either table.

-- Admin grants and revocations are SQL-only (SUB §9.2 bootstrap; no UI in v2.0) and audited by this trigger, so every
-- platform write leaves a platform_audit_log row. Only `postgres` holds DML on platform_admins (SECURITY INVOKER).
CREATE FUNCTION private.platform_admins_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.platform_audit_log (actor_id, channel, action, target_tenant_id, payload)
    VALUES (
        CASE TG_OP WHEN 'INSERT' THEN NEW.granted_by ELSE NULL END,
        'sql',
        CASE TG_OP WHEN 'INSERT' THEN 'platform_admin.granted'
                   WHEN 'UPDATE' THEN 'platform_admin.updated'
                   ELSE 'platform_admin.deleted' END,
        NULL,
        jsonb_build_object(
            'user_id', CASE TG_OP WHEN 'DELETE' THEN OLD.user_id ELSE NEW.user_id END,
            'session_user', session_user::text,
            'before', CASE TG_OP WHEN 'INSERT' THEN NULL
                           ELSE jsonb_build_object('granted_by', OLD.granted_by, 'revoked_at', OLD.revoked_at) END,
            'after', CASE TG_OP WHEN 'DELETE' THEN NULL
                          ELSE jsonb_build_object('granted_by', NEW.granted_by, 'revoked_at', NEW.revoked_at) END));
    RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.platform_admins_audit() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER platform_admins_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.platform_admins
    FOR EACH ROW EXECUTE FUNCTION private.platform_admins_audit();

-- 2. -----------------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
     and exists (
       select 1 from public.platform_admins a
        where a.user_id = (select auth.uid())
          and a.revoked_at is null
     )
$$;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
COMMENT ON FUNCTION public.is_platform_admin() IS
    'SUB §9.2: true only for an active platform_admins row of auth.uid() with an aal2 (MFA) session.';

-- 3. -----------------------------------------------------------------------------------------------------------------
CREATE FUNCTION private.platform_actor(p_actor uuid, OUT actor uuid, OUT channel text)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
    -- The CALLER, not current_user: inside the SECURITY DEFINER RPCs current_user is always their owner.
    v_caller text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
BEGIN
    IF v_caller IN ('postgres', 'service_role') THEN
        -- SQL editor / service role: no JWT. p_actor is required and must be an active platform admin.
        IF p_actor IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.platform_admins a WHERE a.user_id = p_actor AND a.revoked_at IS NULL
        ) THEN
            RAISE 'PLATFORM_ACTOR_INVALID' USING ERRCODE = '42501';
        END IF;
        actor := p_actor;
        channel := 'sql';
    ELSE
        -- Any JWT caller: p_actor is IGNORED; the actor is auth.uid(), and aal2 + platform_admins are required.
        IF NOT public.is_platform_admin() THEN
            RAISE 'PLATFORM_ADMIN_REQUIRED' USING ERRCODE = '42501';
        END IF;
        actor := (SELECT auth.uid());
        channel := 'ui';
    END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.platform_actor(uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.platform_actor(uuid) IS
    'SUB §8.1 actor rule for the platform.* RPCs (caller from the session role, not current_user). Internal: no API role may execute it.';

-- A reason is required and short (it is stored in the audit trail; no PII by policy, runbook).
CREATE FUNCTION private.platform_reason(p_reason text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v text := btrim(p_reason);
BEGIN
    IF v IS NULL OR length(v) < 1 OR length(v) > 500 THEN
        RAISE 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    RETURN v;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.platform_reason(text) FROM PUBLIC, anon, authenticated, service_role;

-- 4. -----------------------------------------------------------------------------------------------------------------
CREATE FUNCTION platform.extend_trial(p_tenant uuid, p_by interval, p_reason text, p_actor uuid DEFAULT NULL)
RETURNS public.tenant_subscriptions
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor uuid;
    v_channel text;
    v_reason text;
    v_buffer_hours integer;
    v_before public.tenant_subscriptions;
    v_after public.tenant_subscriptions;
BEGIN
    SELECT a.actor, a.channel INTO v_actor, v_channel FROM private.platform_actor(p_actor) a;
    PERFORM set_config('lock_timeout', '5s', true);
    v_reason := private.platform_reason(p_reason);
    IF p_tenant IS NULL OR p_by IS NULL OR p_by <= interval '0' OR p_by > interval '90 days' THEN
        RAISE 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_before FROM public.tenant_subscriptions WHERE tenant_id = p_tenant FOR UPDATE;
    IF NOT FOUND THEN
        RAISE 'SUBSCRIPTION_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_before.status <> 'trialing' OR v_before.trial_end IS NULL THEN
        RAISE 'SUBSCRIPTION_STATE_INVALID' USING ERRCODE = 'P0001';
    END IF;

    SELECT s.pending_charge_buffer_hours INTO v_buffer_hours FROM public.platform_settings s WHERE s.id;
    -- SUB §6.2: trialing, not cancelling → trial_end + buffer; trialing, cancelling → trial_end (nothing is pending).
    UPDATE public.tenant_subscriptions s
       SET trial_end = s.trial_end + p_by,
           access_ends_at = s.trial_end + p_by
               + CASE WHEN s.cancel_at_period_end THEN interval '0'
                      ELSE make_interval(hours => coalesce(v_buffer_hours, 24)) END,
           version = s.version + 1,
           updated_at = now()
     WHERE s.tenant_id = p_tenant
    RETURNING s.* INTO v_after;

    INSERT INTO public.subscription_events
        (tenant_id, subject, type, from_status, to_status, actor_type, actor_id, reason, payload)
    VALUES (p_tenant, 'base', 'trial.extended', v_before.status, v_after.status, 'platform_admin', v_actor, v_reason,
            jsonb_build_object('channel', v_channel, 'by', p_by::text,
                               'trial_end_before', v_before.trial_end, 'trial_end_after', v_after.trial_end));
    INSERT INTO public.platform_audit_log (actor_id, channel, action, target_tenant_id, payload)
    VALUES (v_actor, v_channel, 'subscription.extend_trial', p_tenant,
            jsonb_build_object('reason', v_reason, 'by', p_by::text,
                               'before', jsonb_build_object('trial_end', v_before.trial_end,
                                                            'access_ends_at', v_before.access_ends_at,
                                                            'version', v_before.version),
                               'after', jsonb_build_object('trial_end', v_after.trial_end,
                                                           'access_ends_at', v_after.access_ends_at,
                                                           'version', v_after.version)));
    RETURN v_after;
END;
$$;

CREATE FUNCTION platform.set_comp(p_tenant uuid, p_until timestamptz, p_reason text, p_actor uuid DEFAULT NULL)
RETURNS public.tenant_subscriptions
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor uuid;
    v_channel text;
    v_reason text;
    v_before public.tenant_subscriptions;
    v_after public.tenant_subscriptions;
BEGIN
    SELECT a.actor, a.channel INTO v_actor, v_channel FROM private.platform_actor(p_actor) a;
    PERFORM set_config('lock_timeout', '5s', true);
    v_reason := private.platform_reason(p_reason);
    -- NULL clears the comp; otherwise a future instant within five years (a typo guard, not a policy).
    IF p_tenant IS NULL OR (p_until IS NOT NULL AND (p_until <= now() OR p_until > now() + interval '5 years')) THEN
        RAISE 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_before FROM public.tenant_subscriptions WHERE tenant_id = p_tenant FOR UPDATE;
    IF NOT FOUND THEN
        RAISE 'SUBSCRIPTION_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    -- A purged clinic has no data left to serve (SUB §6.1: comp is `full` for any status except purged).
    IF v_before.status = 'purged' THEN
        RAISE 'SUBSCRIPTION_STATE_INVALID' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.tenant_subscriptions s
       SET comp_until = p_until,
           version = s.version + 1,
           updated_at = now()
     WHERE s.tenant_id = p_tenant
    RETURNING s.* INTO v_after;

    INSERT INTO public.subscription_events
        (tenant_id, subject, type, from_status, to_status, actor_type, actor_id, reason, payload)
    VALUES (p_tenant, 'base', CASE WHEN p_until IS NULL THEN 'comp.cleared' ELSE 'comp.set' END,
            v_before.status, v_after.status, 'platform_admin', v_actor, v_reason,
            jsonb_build_object('channel', v_channel,
                               'comp_until_before', v_before.comp_until, 'comp_until_after', v_after.comp_until));
    INSERT INTO public.platform_audit_log (actor_id, channel, action, target_tenant_id, payload)
    VALUES (v_actor, v_channel, 'subscription.set_comp', p_tenant,
            jsonb_build_object('reason', v_reason,
                               'before', jsonb_build_object('comp_until', v_before.comp_until, 'version', v_before.version),
                               'after', jsonb_build_object('comp_until', v_after.comp_until, 'version', v_after.version)));
    RETURN v_after;
END;
$$;

CREATE FUNCTION platform.grant_override(
    p_tenant uuid,
    p_key text,
    p_enabled boolean,
    p_limit bigint,
    p_expires_at timestamptz,
    p_reason text,
    p_actor uuid DEFAULT NULL
)
RETURNS public.tenant_entitlement_overrides
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor uuid;
    v_channel text;
    v_reason text;
    v_kind text;
    v_limit bigint;
    v_sub public.tenant_subscriptions;
    v_before public.tenant_entitlement_overrides;
    v_after public.tenant_entitlement_overrides;
BEGIN
    SELECT a.actor, a.channel INTO v_actor, v_channel FROM private.platform_actor(p_actor) a;
    PERFORM set_config('lock_timeout', '5s', true);
    v_reason := private.platform_reason(p_reason);
    IF p_tenant IS NULL OR p_key IS NULL OR p_enabled IS NULL
       OR (p_expires_at IS NOT NULL AND p_expires_at <= now()) THEN
        RAISE 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    SELECT k.kind INTO v_kind FROM public.entitlement_keys k WHERE k.key = p_key;
    IF NOT FOUND THEN
        RAISE 'ENTITLEMENT_KEY_UNKNOWN' USING ERRCODE = 'P0001';
    END IF;
    -- A boolean key carries no limit; an enabled limit key needs one (>= 0); a disabled override stores none.
    IF v_kind = 'boolean' THEN
        IF p_limit IS NOT NULL THEN
            RAISE 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        v_limit := NULL;
    ELSIF p_enabled THEN
        IF p_limit IS NULL OR p_limit < 0 THEN
            RAISE 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        v_limit := p_limit;
    ELSE
        v_limit := NULL;
    END IF;

    SELECT * INTO v_sub FROM public.tenant_subscriptions WHERE tenant_id = p_tenant FOR UPDATE;
    IF NOT FOUND THEN
        RAISE 'SUBSCRIPTION_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_sub.status = 'purged' THEN
        RAISE 'SUBSCRIPTION_STATE_INVALID' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_before FROM public.tenant_entitlement_overrides o
     WHERE o.tenant_id = p_tenant AND o.key = p_key FOR UPDATE;

    INSERT INTO public.tenant_entitlement_overrides AS o
        (tenant_id, key, enabled, limit_value, expires_at, reason, granted_by)
    VALUES (p_tenant, p_key, p_enabled, v_limit, p_expires_at, v_reason, v_actor)
    ON CONFLICT (tenant_id, key) DO UPDATE
       SET enabled = excluded.enabled,
           limit_value = excluded.limit_value,
           expires_at = excluded.expires_at,
           reason = excluded.reason,
           granted_by = excluded.granted_by,
           created_at = now()
    RETURNING o.* INTO v_after;

    UPDATE public.tenant_subscriptions s
       SET version = s.version + 1, updated_at = now()
     WHERE s.tenant_id = p_tenant;

    INSERT INTO public.subscription_events
        (tenant_id, subject, type, from_status, to_status, actor_type, actor_id, reason, payload)
    VALUES (p_tenant, 'base', 'entitlement.override_set', v_sub.status, v_sub.status, 'platform_admin', v_actor, v_reason,
            jsonb_build_object('channel', v_channel, 'key', p_key, 'enabled', p_enabled, 'limit_value', v_limit,
                               'expires_at', p_expires_at));
    INSERT INTO public.platform_audit_log (actor_id, channel, action, target_tenant_id, payload)
    VALUES (v_actor, v_channel, 'entitlement.grant_override', p_tenant,
            jsonb_build_object('reason', v_reason, 'key', p_key,
                               'before', CASE WHEN v_before.id IS NULL THEN NULL
                                              ELSE jsonb_build_object('enabled', v_before.enabled,
                                                                      'limit_value', v_before.limit_value,
                                                                      'expires_at', v_before.expires_at) END,
                               'after', jsonb_build_object('enabled', v_after.enabled,
                                                           'limit_value', v_after.limit_value,
                                                           'expires_at', v_after.expires_at)));
    RETURN v_after;
END;
$$;

CREATE FUNCTION platform.create_plan_price(
    p_plan_code text,
    p_billing_model text,
    p_base_amount_paise bigint,
    p_tax_rate_bp integer,
    p_tax_inclusive boolean,
    p_provider_plan_id text,
    p_active_from timestamptz,
    p_actor uuid DEFAULT NULL
)
RETURNS public.plan_prices
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor uuid;
    v_channel text;
    v_plan public.plans;
    v_from timestamptz := coalesce(p_active_from, now());
    v_interval text;
    v_interval_count integer;
    v_closed jsonb;
    v_after public.plan_prices;
BEGIN
    SELECT a.actor, a.channel INTO v_actor, v_channel FROM private.platform_actor(p_actor) a;
    PERFORM set_config('lock_timeout', '5s', true);
    IF p_plan_code IS NULL OR p_base_amount_paise IS NULL OR p_base_amount_paise <= 0
       OR p_tax_rate_bp IS NULL OR p_tax_rate_bp NOT BETWEEN 0 AND 10000
       OR v_from < now() THEN
        RAISE 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_plan FROM public.plans p WHERE p.code = p_plan_code FOR UPDATE;
    IF NOT FOUND THEN
        RAISE 'PLAN_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    -- v2.0 sells flat monthly prices only (the other models need units/tiers this signature does not carry, SUB-11);
    -- prices are GST-exclusive (PO-20); a trial plan has no price; a retired plan gets no new one.
    IF p_billing_model IS DISTINCT FROM 'flat_recurring' OR coalesce(p_tax_inclusive, false)
       OR v_plan.kind = 'trial' OR v_plan.status <> 'active' THEN
        RAISE 'PLAN_PRICE_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- A new version starts after every existing version of the plan's model (prices are versioned, never rewritten).
    IF EXISTS (SELECT 1 FROM public.plan_prices pp
                WHERE pp.plan_id = v_plan.id AND pp.billing_model = p_billing_model AND pp.active_from >= v_from) THEN
        RAISE 'PLAN_PRICE_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- Same cadence as the plan's latest price of this model; a first price is monthly.
    SELECT pp."interval", pp.interval_count INTO v_interval, v_interval_count
      FROM public.plan_prices pp
     WHERE pp.plan_id = v_plan.id AND pp.billing_model = p_billing_model
     ORDER BY pp.active_from DESC
     LIMIT 1;

    -- The open (or later-ending) version of this model closes when the new one starts; subscriptions keep their row.
    WITH closed AS (
        UPDATE public.plan_prices pp
           SET active_until = v_from
         WHERE pp.plan_id = v_plan.id
           AND pp.billing_model = p_billing_model
           AND (pp.active_until IS NULL OR pp.active_until > v_from)
        RETURNING pp.id, pp.active_until
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'active_until', c.active_until)), '[]'::jsonb)
      INTO v_closed FROM closed c;

    INSERT INTO public.plan_prices
        (plan_id, billing_model, base_amount_paise, tax_rate_bp, tax_inclusive, currency, "interval", interval_count,
         provider, provider_plan_id, active_from)
    VALUES (v_plan.id, p_billing_model, p_base_amount_paise, p_tax_rate_bp, false, 'INR',
            coalesce(v_interval, 'month'), coalesce(v_interval_count, 1), 'razorpay', p_provider_plan_id, v_from)
    RETURNING * INTO v_after;

    INSERT INTO public.platform_audit_log (actor_id, channel, action, target_tenant_id, payload)
    VALUES (v_actor, v_channel, 'catalogue.create_plan_price', NULL,
            jsonb_build_object('plan_code', v_plan.code, 'price_id', v_after.id, 'billing_model', p_billing_model,
                               'base_amount_paise', v_after.base_amount_paise, 'tax_rate_bp', v_after.tax_rate_bp,
                               'charge_amount_paise', v_after.charge_amount_paise,
                               'provider_plan_id', v_after.provider_plan_id, 'active_from', v_after.active_from,
                               'closed', v_closed));
    RETURN v_after;
END;
$$;

CREATE FUNCTION platform.set_product_availability(
    p_plan_code text,
    p_purchasable boolean,
    p_visibility text,
    p_actor uuid DEFAULT NULL
)
RETURNS public.plans
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor uuid;
    v_channel text;
    v_before public.plans;
    v_after public.plans;
BEGIN
    SELECT a.actor, a.channel INTO v_actor, v_channel FROM private.platform_actor(p_actor) a;
    PERFORM set_config('lock_timeout', '5s', true);
    IF p_plan_code IS NULL OR p_purchasable IS NULL
       OR p_visibility IS NULL OR p_visibility NOT IN ('public', 'coming_soon', 'hidden') THEN
        RAISE 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_before FROM public.plans p WHERE p.code = p_plan_code FOR UPDATE;
    IF NOT FOUND THEN
        RAISE 'PLAN_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF p_purchasable THEN
        IF v_before.kind = 'trial' OR v_before.status <> 'active' THEN
            RAISE 'PRODUCT_STATE_INVALID' USING ERRCODE = 'P0001';
        END IF;
        -- Acceptance 13 / AI-18: nothing is sold without a price active now that carries a provider plan id.
        IF NOT EXISTS (
            SELECT 1 FROM public.plan_prices pp
             WHERE pp.plan_id = v_before.id
               AND pp.provider_plan_id IS NOT NULL
               AND pp.active_from <= now()
               AND (pp.active_until IS NULL OR now() < pp.active_until)
        ) THEN
            RAISE 'PRODUCT_PRICE_REQUIRED' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    UPDATE public.plans p
       SET purchasable = p_purchasable,
           visibility = p_visibility,
           updated_at = now()
     WHERE p.id = v_before.id
    RETURNING p.* INTO v_after;

    INSERT INTO public.platform_audit_log (actor_id, channel, action, target_tenant_id, payload)
    VALUES (v_actor, v_channel, 'catalogue.set_product_availability', NULL,
            jsonb_build_object('plan_code', v_after.code,
                               'before', jsonb_build_object('purchasable', v_before.purchasable,
                                                            'visibility', v_before.visibility),
                               'after', jsonb_build_object('purchasable', v_after.purchasable,
                                                           'visibility', v_after.visibility)));
    RETURN v_after;
END;
$$;

-- Grants (SUB §8.1): no PUBLIC or anon; authenticated (the V2-13c admin UI, gated by is_platform_admin() + aal2 inside)
-- and service_role (with an explicit admin p_actor). The schema itself has no anon USAGE (000080).
REVOKE EXECUTE ON FUNCTION platform.extend_trial(uuid, interval, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION platform.set_comp(uuid, timestamptz, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION platform.grant_override(uuid, text, boolean, bigint, timestamptz, text, uuid)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION platform.create_plan_price(text, text, bigint, integer, boolean, text, timestamptz, uuid)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION platform.set_product_availability(text, boolean, text, uuid)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION platform.extend_trial(uuid, interval, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION platform.set_comp(uuid, timestamptz, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION platform.grant_override(uuid, text, boolean, bigint, timestamptz, text, uuid)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION platform.create_plan_price(text, text, bigint, integer, boolean, text, timestamptz, uuid)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION platform.set_product_availability(text, boolean, text, uuid) TO authenticated, service_role;
