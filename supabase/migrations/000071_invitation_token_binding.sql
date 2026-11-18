-- Migration: 000071_invitation_token_binding.sql
-- V2-05 fix plan 05-11b, finding H-INVITE (05a review RLS H-1). Brings forward the minimal part of 05-07a; invitations
-- v2 (invite_staff, resend/revoke, peek, consume_invitation_for, email delivery) is still 05-07a's.
--
-- Before: `invitations_select` (000057) gave every `staff:invite` holder (owners AND admins) the `token_hash` of every
-- invitation of the clinic, including owner invitations only an owner may create, and `consume_invitation` accepted
-- that hash from ANY signed-in account. An admin could read the owner invitation's hash and redeem it from a second
-- account of their own, which became an owner of the clinic.
--
-- 1. `token_hash` is no longer readable by `anon`/`authenticated`: table SELECT is replaced by a column SELECT grant
--    on every other column (the staff page reads id, invited_address, role, expires_at, consumed_at). INSERT keeps the
--    column (the inviter stores the hash of a token it generated; `.insert(...).select("id")` returns only the id).
--    A `select *` by a member is now 42501; nothing in the app does that.
-- 2. `public.consume_invitation(p_token_hash)` (same signature, still SECURITY DEFINER, still `authenticated` +
--    `service_role`): the caller must have a CONFIRMED email (`auth.users.email_confirmed_at` set) equal,
--    case-insensitively and trimmed, to the invitation's `invited_address`; else 42501 `INVITATION_EMAIL_MISMATCH`
--    (an unconfirmed address: `INVITATION_EMAIL_UNCONFIRMED`). The checks run under the row lock, before any write.
--    Existing texts are kept for the app's mapping ("Invalid invitation token", "already been used", "expired").
--    search_path is now '' (was `public, pg_temp`). The membership insert and the consume update are unchanged.
-- Per-migration checklist: no new table or function; grants only narrow; no data changed. Expand-safe: the previous
-- app build reads only the granted columns and calls the RPC with the same signature.

-- 1. Column grants ------------------------------------------------------------------------------------------------------
REVOKE SELECT ON public.invitations FROM anon, authenticated;
GRANT SELECT (id, tenant_id, role, invited_address, expires_at, consumed_at, consumed_by, created_by, created_at)
    ON public.invitations TO authenticated;

COMMENT ON COLUMN public.invitations.token_hash IS
    'SHA-256 of the invitation token. Not readable by API roles (05-11b, H-INVITE); redeemed only by the invitee.';

-- 2. consume_invitation: the invitee only ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_invitation(p_token_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_invite RECORD;
    v_email TEXT;
    v_confirmed TIMESTAMPTZ;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;

    -- Lock the invitation row so two redemptions serialise.
    SELECT i.id, i.tenant_id, i.role, i.invited_address, i.expires_at, i.consumed_at
      INTO v_invite
      FROM public.invitations i
     WHERE i.token_hash = p_token_hash
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid invitation token' USING ERRCODE = 'P0001';
    END IF;

    IF v_invite.consumed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Invitation has already been used' USING ERRCODE = 'P0001';
    END IF;

    IF v_invite.expires_at < now() THEN
        RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = 'P0001';
    END IF;

    -- The bearer of the hash is not enough: the signed-in account must own the invited address (H-INVITE).
    SELECT u.email, u.email_confirmed_at
      INTO v_email, v_confirmed
      FROM auth.users u
     WHERE u.id = v_user_id;

    IF v_email IS NULL
       OR lower(btrim(v_email)) IS DISTINCT FROM lower(btrim(v_invite.invited_address)) THEN
        RAISE EXCEPTION 'INVITATION_EMAIL_MISMATCH' USING ERRCODE = '42501';
    END IF;

    IF v_confirmed IS NULL THEN
        RAISE EXCEPTION 'INVITATION_EMAIL_UNCONFIRMED' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.memberships (user_id, tenant_id, role)
    VALUES (v_user_id, v_invite.tenant_id, v_invite.role);

    UPDATE public.invitations
       SET consumed_at = now(),
           consumed_by = v_user_id
     WHERE id = v_invite.id;

    RETURN v_invite.tenant_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_invitation(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_invitation(TEXT) TO authenticated, service_role;
