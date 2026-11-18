CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  select exists (
       select 1 from public.platform_admins a
        where a.user_id = (select auth.uid())
          and a.revoked_at is null
     )
$$;
CREATE OR REPLACE FUNCTION platform.set_product_availability(
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
        -- MUTANT: provider-price check removed
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
