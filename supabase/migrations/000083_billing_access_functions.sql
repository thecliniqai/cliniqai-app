-- Migration: 000083_billing_access_functions.sql
-- V2-05 plan 05-09a step 4 (SUB-01; SUBSCRIPTIONS_AND_PLANS.md §4 "billing anchor", §6.2, §7.2, §10.3; rulings R-26,
-- R-28; acceptance 8 function half, 9, 13 entitlement half).
--
-- billing_internal (service_role only; never `anon`/`authenticated`, acceptance 9):
--   tenant_access_level(p_tenant, p_now)    exactly SUB §6.2: `purged` → none; `comp_until` in the future → full (any
--                                           other status); `incomplete` → onboarding; trialing/active/past_due with
--                                           p_now < access_ends_at → full; everything else (expired, archived, a stale
--                                           status past access_ends_at, a NULL access_ends_at) → locked; no row → NULL
--                                           (never full). SECURITY DEFINER as specified (the RLS helpers of 05-10a call
--                                           it internally with now()). The other billing_internal functions are SECURITY
--                                           INVOKER: their only callers are the service role (full table privileges)
--                                           and definer functions owned by postgres (05-PLAN checklist: definer only
--                                           where the plan says so).
--   has_entitlement(p_tenant, p_key, p_now) SUB §7.2 order: (1) access level `full`, else false; (2) an unexpired
--                                           override wins; (3) `trialing` → the base plan's `trial_plan_id`
--                                           entitlements; (4) otherwise the base plan's (through `plan_price_id`; a row
--                                           without a price has none, research Pitfall 8).
--   entitlement_limit(p_tenant, p_key, p_now) the same order; 0 when the resolved entitlement is disabled or absent.
--                                           The override, when present, decides (it is the explicit grant); otherwise
--                                           the largest limit among the applicable plan sources (today exactly one:
--                                           the base or the trial plan; SUB-11 add-ons will join this maximum).
--   start_trial(p_tenant, p_plan_price_id, p_now)  `incomplete` → `trialing` (T1): trial_start = p_now; trial_end = the
--                                           IST date of p_now + trial_days at 10:00 IST (SUB §4 billing anchor);
--                                           access_ends_at = trial_end + pending_charge_buffer_hours; trial_consumed;
--                                           version + 1; one subscription_events row. Refuses any other status
--                                           (SUBSCRIPTION_STATE_INVALID), a second trial (TRIAL_ALREADY_CONSUMED) and a
--                                           price that is inactive at p_now or not a purchasable base plan with a trial
--                                           (PLAN_PRICE_INVALID). Row-locked (FOR UPDATE, lock_timeout 5 s).
-- public:
--   my_tenant_access(p_tenant)              the caller-bound wrapper (SUB §6.2): the level for one of the caller's own
--                                           clinics (`authz.member_tenant_ids()`, which 05-05 limits to active
--                                           memberships), else NULL (a member of A asking for B gets NULL). Member-bound,
--                                           not active-clinic-bound: the layout and the clinic switcher must resolve a
--                                           locked clinic (R-40). `authenticated` only.
--   my_entitlements(p_tenant)               (key, enabled, limit_value) of every entitlement key for one of the
--                                           caller's own clinics; no rows otherwise. `authenticated` only.
--   tenant_access_for_system(p_tenant)      the level at now() for service-role readers (05-10a: /api/v1 key auth,
--                                           sharing; R-28). SECURITY INVOKER, `service_role` only.
-- Every function: `search_path = ''`, qualified names, REVOKE from PUBLIC/anon/authenticated (and service_role where
-- it is not a caller), explicit GRANT. No `p_now` is reachable by a client. Raised reasons are machine reasons (P0001 /
-- P0002), registered in lib/db/errors.ts RPC_REASON_CODES.

-- billing_internal.tenant_access_level (SUB §6.2, verbatim body) ------------------------------------------------------
CREATE FUNCTION billing_internal.tenant_access_level(p_tenant uuid, p_now timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  select case
    when s.status = 'purged'                                             then 'none'
    when s.comp_until is not null and p_now < s.comp_until               then 'full'
    when s.status = 'incomplete'                                         then 'onboarding'
    when s.status in ('trialing','active','past_due')
         and p_now < s.access_ends_at                                    then 'full'
    else 'locked' end                       -- includes expired, archived, and a stale status past access_ends_at
  from public.tenant_subscriptions s where s.tenant_id = p_tenant
$$;
REVOKE EXECUTE ON FUNCTION billing_internal.tenant_access_level(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION billing_internal.tenant_access_level(uuid, timestamptz) TO service_role;

-- billing_internal.resolve_entitlement: the shared SUB §7.2 resolution ------------------------------------------------
CREATE FUNCTION billing_internal.resolve_entitlement(
    p_tenant uuid,
    p_key text,
    p_now timestamptz,
    OUT enabled boolean,
    OUT limit_value bigint
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
    v_status text;
    v_plan uuid;
    v_trial_plan uuid;
BEGIN
    enabled := false;
    limit_value := 0;

    -- (1) access level full
    IF billing_internal.tenant_access_level(p_tenant, p_now) IS DISTINCT FROM 'full' THEN
        RETURN;
    END IF;

    -- (2) an unexpired override wins
    SELECT o.enabled, o.limit_value INTO enabled, limit_value
      FROM public.tenant_entitlement_overrides o
     WHERE o.tenant_id = p_tenant
       AND o.key = p_key
       AND (o.expires_at IS NULL OR p_now < o.expires_at);
    IF FOUND THEN
        limit_value := CASE WHEN enabled THEN coalesce(limit_value, 0) ELSE 0 END;
        RETURN;
    END IF;
    enabled := false;
    limit_value := 0;

    -- (3)/(4) the trial plan while trialing, else the base plan (through plan_price_id)
    SELECT s.status, pp.plan_id, p.trial_plan_id INTO v_status, v_plan, v_trial_plan
      FROM public.tenant_subscriptions s
      JOIN public.plan_prices pp ON pp.id = s.plan_price_id
      JOIN public.plans p ON p.id = pp.plan_id
     WHERE s.tenant_id = p_tenant;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    IF v_status = 'trialing' AND v_trial_plan IS NOT NULL THEN
        v_plan := v_trial_plan;
    END IF;

    SELECT coalesce(bool_or(pe.enabled), false),
           coalesce(max(CASE WHEN pe.enabled THEN coalesce(pe.limit_value, 0) ELSE 0 END), 0)
      INTO enabled, limit_value
      FROM public.plan_entitlements pe
     WHERE pe.plan_id = v_plan
       AND pe.key = p_key;
END;
$$;
REVOKE EXECUTE ON FUNCTION billing_internal.resolve_entitlement(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION billing_internal.resolve_entitlement(uuid, text, timestamptz) TO service_role;

CREATE FUNCTION billing_internal.has_entitlement(p_tenant uuid, p_key text, p_now timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  select (billing_internal.resolve_entitlement(p_tenant, p_key, p_now)).enabled
$$;
REVOKE EXECUTE ON FUNCTION billing_internal.has_entitlement(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION billing_internal.has_entitlement(uuid, text, timestamptz) TO service_role;

CREATE FUNCTION billing_internal.entitlement_limit(p_tenant uuid, p_key text, p_now timestamptz)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  select (billing_internal.resolve_entitlement(p_tenant, p_key, p_now)).limit_value
$$;
REVOKE EXECUTE ON FUNCTION billing_internal.entitlement_limit(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION billing_internal.entitlement_limit(uuid, text, timestamptz) TO service_role;

-- billing_internal.start_trial (T1) -----------------------------------------------------------------------------------
CREATE FUNCTION billing_internal.start_trial(p_tenant uuid, p_plan_price_id uuid, p_now timestamptz)
RETURNS public.tenant_subscriptions
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
    v_sub public.tenant_subscriptions;
    v_plan public.plans;
    v_buffer_hours integer;
    v_trial_end timestamptz;
BEGIN
    PERFORM set_config('lock_timeout', '5s', true);
    IF p_now IS NULL THEN
        RAISE 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_sub FROM public.tenant_subscriptions WHERE tenant_id = p_tenant FOR UPDATE;
    IF NOT FOUND THEN
        RAISE 'SUBSCRIPTION_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_sub.status <> 'incomplete' THEN
        RAISE 'SUBSCRIPTION_STATE_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF v_sub.trial_consumed THEN
        RAISE 'TRIAL_ALREADY_CONSUMED' USING ERRCODE = 'P0001';
    END IF;

    SELECT p.* INTO v_plan
      FROM public.plan_prices pp
      JOIN public.plans p ON p.id = pp.plan_id
     WHERE pp.id = p_plan_price_id
       AND pp.active_from <= p_now
       AND (pp.active_until IS NULL OR p_now < pp.active_until)
       AND p.kind = 'base'
       AND p.status = 'active'
       AND p.purchasable
       AND coalesce(p.trial_days, 0) > 0;
    IF NOT FOUND THEN
        RAISE 'PLAN_PRICE_INVALID' USING ERRCODE = 'P0001';
    END IF;

    SELECT s.pending_charge_buffer_hours INTO v_buffer_hours FROM public.platform_settings s WHERE s.id;
    -- SUB §4: the first debit (= trial_end) is the IST date of T0 + trial_days, at 10:00 IST.
    v_trial_end := (((p_now AT TIME ZONE 'Asia/Kolkata')::date + v_plan.trial_days) + time '10:00')
                   AT TIME ZONE 'Asia/Kolkata';

    UPDATE public.tenant_subscriptions s
       SET status = 'trialing',
           plan_price_id = p_plan_price_id,
           trial_start = p_now,
           trial_end = v_trial_end,
           access_ends_at = v_trial_end + make_interval(hours => coalesce(v_buffer_hours, 24)),
           trial_consumed = true,
           version = s.version + 1,
           updated_at = p_now
     WHERE s.tenant_id = p_tenant
    RETURNING s.* INTO v_sub;

    INSERT INTO public.subscription_events (tenant_id, subject, type, from_status, to_status, actor_type, occurred_at)
    VALUES (p_tenant, 'base', 'trial.started', 'incomplete', 'trialing', 'system', p_now);

    RETURN v_sub;
END;
$$;
REVOKE EXECUTE ON FUNCTION billing_internal.start_trial(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION billing_internal.start_trial(uuid, uuid, timestamptz) TO service_role;

-- public wrappers ------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.my_tenant_access(p_tenant uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  select case
    when p_tenant in (select authz.member_tenant_ids())
      then billing_internal.tenant_access_level(p_tenant, now())
  end
$$;
REVOKE EXECUTE ON FUNCTION public.my_tenant_access(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_tenant_access(uuid) TO authenticated;
COMMENT ON FUNCTION public.my_tenant_access(uuid) IS
    'SUB §6.2 caller-bound wrapper: the access level of one of the caller''s own clinics at now(), else NULL. No p_now.';

CREATE FUNCTION public.my_entitlements(p_tenant uuid)
RETURNS TABLE (key text, enabled boolean, limit_value bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  select k.key, r.enabled, r.limit_value
    from public.entitlement_keys k
   cross join lateral billing_internal.resolve_entitlement(p_tenant, k.key, now()) r
   where p_tenant in (select authz.member_tenant_ids())
   order by k.key
$$;
REVOKE EXECUTE ON FUNCTION public.my_entitlements(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_entitlements(uuid) TO authenticated;
COMMENT ON FUNCTION public.my_entitlements(uuid) IS
    'SUB §6.2 caller-bound wrapper: (key, enabled, limit_value) of every entitlement key for one of the caller''s own clinics at now(); no rows otherwise.';

CREATE FUNCTION public.tenant_access_for_system(p_tenant uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  select billing_internal.tenant_access_level(p_tenant, now())
$$;
REVOKE EXECUTE ON FUNCTION public.tenant_access_for_system(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_access_for_system(uuid) TO service_role;
COMMENT ON FUNCTION public.tenant_access_for_system(uuid) IS
    'R-28: the access level at now() for service-role readers (/api/v1 key auth, sharing; 05-10a). service_role only.';
