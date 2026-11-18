-- Migration: 000089_invitation_accept_context.sql
-- V2-05 plan 05-07b (AUTH-06 app paths; rulings R-30, R-38 (actor rule), R-44 (ADR-0005 amendment A4); threats
-- T-05-27, T-05-29). Builds on 000088 (invitations v2).
--
-- `public.invitation_accept_context(p_token_hash) returns jsonb` (SECURITY DEFINER, service_role only): what the
-- invite-acceptance system path (`features/auth/system.ts`, reached only through `features/auth/invite-flows.ts` after
-- the token-shape, Turnstile, password-policy and Pwned Passwords checks) needs to decide between "create the invitee's
-- account", "complete an unconfirmed account" and "sign in to accept":
--   * malformed or unknown hash → {"status": "not_found"};
--   * a used, revoked or expired invitation → {"status": "used" | "revoked" | "expired"} only;
--   * a pending one → {"status": "pending", "invited_address", "user_id" (the auth account that owns the address, or
--     null), "email_confirmed" (boolean, false without an account)}.
-- The address is matched as consume_invitation matches it (lower(btrim(email))); deleted accounts are ignored; two
-- live accounts for one address raise P0001 INVITATION_ACCOUNT_AMBIGUOUS (never guessed).
-- Why a function: the Auth admin API cannot look an account up by address, and `auth.users` is not on the Data API.
-- Actor rule (R-38 erratum, as 000085/000088): the caller is the SESSION role (`private.invitation_system_caller()`),
-- never `current_user`; any caller but service_role/postgres gets 42501 SYSTEM_ONLY even if a grant leaked.
-- Per-migration checklist: one new function, `search_path = ''`, REVOKE from PUBLIC/anon/authenticated/service_role then
-- GRANT to service_role only; STABLE (reads only, no lock); the new reason is registered in lib/db/errors.ts;
-- definer_functions.test.sql classifies it `system`.

CREATE FUNCTION public.invitation_accept_context(p_token_hash TEXT)
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
    IF NOT private.invitation_system_caller() THEN
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

REVOKE ALL ON FUNCTION public.invitation_accept_context(TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invitation_accept_context(TEXT) TO service_role;

COMMENT ON FUNCTION public.invitation_accept_context(TEXT) IS
    'AUTH-06 (05-07b): service role only (invite acceptance system path, R-44). For a pending invitation: the invited address and the auth account that owns it (id, confirmed); otherwise the status only. SYSTEM_ONLY for any other session role (R-38).';
