-- 05-07a mutant: token minted for any token_version (stale jobs would send).
CREATE OR REPLACE FUNCTION public.invitation_issue_token(p_invitation_id UUID, p_token_version INTEGER)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
    v_row public.invitations;
    v_raw TEXT;
BEGIN
    IF NOT private.invitation_system_caller() THEN
        RAISE EXCEPTION 'SYSTEM_ONLY' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_row FROM public.invitations WHERE id = p_invitation_id FOR UPDATE;
    IF NOT FOUND
       OR v_row.consumed_at IS NOT NULL
       OR v_row.revoked_at IS NOT NULL
       OR v_row.expires_at <= now()
       THEN
        RETURN NULL;
    END IF;

    v_raw := encode(extensions.gen_random_bytes(32), 'hex');
    UPDATE public.invitations
       SET token_hash = encode(sha256(convert_to(v_raw, 'UTF8')), 'hex'),
           send_count = send_count + 1,
           last_sent_at = now()
     WHERE id = v_row.id;
    RETURN v_raw;
END;
$$;

