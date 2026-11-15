-- 05-05 mutant: session delete without the fail-soft block.
-- 4. remove_member -------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_member(p_membership_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_target public.memberships;
    v_caller_role TEXT;
    v_reason TEXT := NULLIF(btrim(p_reason), '');
    v_owners INTEGER;
    v_keys INTEGER;
    v_invites INTEGER;
    v_sessions INTEGER;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
    END IF;
    IF v_reason IS NULL OR char_length(v_reason) > 500 OR v_reason ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- The tenant comes from the target row and must be the caller's active clinic (R-42); anything else reads as "not
    -- found" (another clinic's membership ids are never confirmed).
    SELECT * INTO v_target FROM public.memberships WHERE id = p_membership_id FOR UPDATE;
    IF NOT FOUND OR v_target.tenant_id IS DISTINCT FROM authz.active_tenant_id() THEN
        RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    SELECT m.role INTO v_caller_role
      FROM public.memberships m
     WHERE m.tenant_id = v_target.tenant_id AND m.user_id = v_uid AND m.status = 'active';
    IF v_caller_role IS NULL OR NOT authz.role_has_permission(v_caller_role, 'staff:invite') THEN
        RAISE EXCEPTION 'STAFF_REMOVE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    IF v_target.role IN ('owner', 'admin') AND v_caller_role <> 'owner' THEN
        RAISE EXCEPTION 'OWNER_REQUIRED' USING ERRCODE = '42501';
    END IF;

    IF v_target.status = 'removed' THEN
        RAISE EXCEPTION 'MEMBER_NOT_ACTIVE' USING ERRCODE = 'P0001';
    END IF;

    IF v_target.role = 'owner' THEN
        -- Same lock as change_member_role: concurrent demotions and removals of owners serialise here.
        PERFORM 1 FROM public.memberships
         WHERE tenant_id = v_target.tenant_id AND role = 'owner'
           FOR UPDATE;
        SELECT count(*) INTO v_owners
          FROM public.memberships
         WHERE tenant_id = v_target.tenant_id AND role = 'owner' AND status = 'active';
        IF v_owners <= 1 THEN
            RAISE EXCEPTION 'LAST_OWNER' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    IF v_target.user_id = v_uid THEN
        RAISE EXCEPTION 'SELF_REMOVAL' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.memberships
       SET status = 'removed', removed_at = now(), removed_by = v_uid
     WHERE id = v_target.id;

    WITH k AS (
        UPDATE public.api_keys
           SET revoked_at = now(), updated_at = now()
         WHERE tenant_id = v_target.tenant_id AND created_by = v_target.user_id AND revoked_at IS NULL
        RETURNING 1
    )
    SELECT count(*) INTO v_keys FROM k;

    WITH i AS (
        UPDATE public.invitations
           SET revoked_at = now(), revoked_by = v_uid
         WHERE tenant_id = v_target.tenant_id AND created_by = v_target.user_id
           AND consumed_at IS NULL AND revoked_at IS NULL
        RETURNING 1
    )
    SELECT count(*) INTO v_invites FROM i;

    -- R-43: end every session of the removed user (refresh tokens cascade). A hosted database that refuses the delete
    -- leaves the removal in place; the 900 s access token is then the bound and the count is NULL.
    WITH s AS (
        DELETE FROM auth.sessions WHERE user_id = v_target.user_id RETURNING 1
    )
    SELECT count(*) INTO v_sessions FROM s;

    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, entity_type, entity_id, metadata)
    VALUES (
        v_target.tenant_id,
        v_uid,
        v_caller_role,
        'staff.removed',
        'membership',
        v_target.id,
        jsonb_build_object(
            'target_user_id', v_target.user_id,
            'role', v_target.role,
            'reason', v_reason,
            'keys_revoked', v_keys,
            'invites_revoked', v_invites,
            'sessions_revoked', v_sessions
        )
    );

    RETURN jsonb_build_object(
        'user_id', v_target.user_id,
        'keys_revoked', v_keys,
        'invites_revoked', v_invites,
        'sessions_revoked', v_sessions
    );
END;
$$;

