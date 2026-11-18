CREATE OR REPLACE FUNCTION public.invitation_accept_context(p_token_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row public.invitations;
    v_status TEXT;
    v_users INTEGER;
    v_user UUID;
    v_confirmed BOOLEAN;
BEGIN
    IF current_user::text NOT IN ('service_role', 'postgres') THEN
        RAISE EXCEPTION 'SYSTEM_ONLY' USING ERRCODE = '42501';
    END IF;

    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    SELECT * INTO v_row FROM public.invitations i WHERE i.token_hash = p_token_hash;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    v_status := CASE
        WHEN v_row.consumed_at IS NOT NULL THEN 'used'
        WHEN v_row.revoked_at IS NOT NULL THEN 'revoked'
        WHEN v_row.expires_at <= now() THEN 'expired'
        ELSE 'pending'
    END;
    IF v_status <> 'pending' THEN
        RETURN jsonb_build_object('status', v_status);
    END IF;

    SELECT count(*), min(u.id::text)::uuid, bool_or(u.email_confirmed_at IS NOT NULL)
      INTO v_users, v_user, v_confirmed
      FROM auth.users u
     WHERE lower(btrim(u.email)) = lower(btrim(v_row.invited_address))
       AND u.deleted_at IS NULL;
    IF v_users > 1 THEN
        RAISE EXCEPTION 'INVITATION_ACCOUNT_AMBIGUOUS' USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object(
        'status', 'pending',
        'invited_address', lower(btrim(v_row.invited_address)),
        'user_id', v_user,
        'email_confirmed', coalesce(v_confirmed, false)
    );
END;
$$;

