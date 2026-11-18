-- 05-07a mutant: redemption without the invited-address binding (H-INVITE).
CREATE OR REPLACE FUNCTION private.invitation_consume(p_user UUID, p_token_hash TEXT, p_require_confirmed BOOLEAN, p_idempotent BOOLEAN)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_invite public.invitations;
    v_email TEXT;
    v_confirmed TIMESTAMPTZ;
    v_member public.memberships;
BEGIN
    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Invalid invitation token' USING ERRCODE = 'P0001';
    END IF;

    -- Lock the invitation row so two redemptions serialise.
    SELECT * INTO v_invite FROM public.invitations i WHERE i.token_hash = p_token_hash FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid invitation token' USING ERRCODE = 'P0001';
    END IF;

    IF v_invite.consumed_at IS NOT NULL THEN
        IF p_idempotent AND v_invite.consumed_by = p_user THEN
            RETURN v_invite.tenant_id;
        END IF;
        RAISE EXCEPTION 'Invitation has already been used' USING ERRCODE = 'P0001';
    END IF;

    IF v_invite.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'INVITATION_REVOKED' USING ERRCODE = 'P0001';
    END IF;

    IF v_invite.expires_at <= now() THEN
        RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = 'P0001';
    END IF;

    -- The bearer of the hash is not enough: the account must own the invited address (H-INVITE, T-05-27).
    SELECT u.email, u.email_confirmed_at INTO v_email, v_confirmed FROM auth.users u WHERE u.id = p_user;

    IF p_require_confirmed AND v_confirmed IS NULL THEN
        RAISE EXCEPTION 'INVITATION_EMAIL_UNCONFIRMED' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_member
      FROM public.memberships m
     WHERE m.user_id = p_user AND m.tenant_id = v_invite.tenant_id
       FOR UPDATE;
    IF FOUND THEN
        IF v_member.status <> 'removed' THEN
            RAISE EXCEPTION 'ALREADY_MEMBER' USING ERRCODE = 'P0001';
        END IF;
        -- R-32: a removed member who is invited again gets the same row back, with the invited role.
        UPDATE public.memberships
           SET status = 'active', role = v_invite.role, removed_at = NULL, removed_by = NULL
         WHERE id = v_member.id;
    ELSE
        INSERT INTO public.memberships (user_id, tenant_id, role)
        VALUES (p_user, v_invite.tenant_id, v_invite.role)
        RETURNING * INTO v_member;
    END IF;

    UPDATE public.invitations
       SET consumed_at = now(), consumed_by = p_user
     WHERE id = v_invite.id;

    PERFORM private.invitation_audit(v_invite.tenant_id, p_user, v_invite.role, 'staff.invite_accepted', v_invite.id,
        jsonb_build_object('role', v_invite.role, 'membership_id', v_member.id,
                           'reactivated', v_member.status = 'removed'));

    RETURN v_invite.tenant_id;
END;
$$;
