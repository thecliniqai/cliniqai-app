-- Migration: 000088_invitations_v2.sql
-- V2-05 plan 05-07a (AUTH-06 backend, AUTH-D1, SEC-08, AUTH_REDESIGN §3.2; rulings R-30, R-32, R-38 (actor rule);
-- threats T-05-27, T-05-28, T-05-30). Builds on 05-11b's H-INVITE binding (000071: token_hash unreadable by members;
-- consume_invitation needs the caller's CONFIRMED email = the invited address) and 05-05's revocation columns (000087).
--
-- 1. `invitations`: `token_version` (≥ 1), `last_sent_at`, `send_count` (≥ 0); `token_hash` becomes NULLABLE: the
--    raw token is minted at SEND time by the email handler (R-30), so neither `invitations` nor `ops.jobs` ever holds a
--    usable token. One pending invitation per clinic and address: unique partial index on
--    (tenant_id, lower(invited_address)) WHERE consumed_at IS NULL AND revoked_at IS NULL (older duplicates of the
--    pre-v2 era are revoked first, idempotently). The INSERT policy is dropped and INSERT revoked from
--    anon/authenticated: invitations are created only by `invite_staff` (or the service role).
-- 2. `public.invite_staff(p_tenant, p_email, p_role) returns jsonb` (SECURITY DEFINER, authenticated). `p_tenant` is the
--    server session's clinic (`ctx.tenantId`) and is accepted only when it is in `authz.tenant_ids_with('staff:invite')`
--    for the caller (the active clinic, an active membership), else 42501 STAFF_INVITE_FORBIDDEN (V2-04 R-6 pattern);
--    owner/admin invitations only by an owner (42501 OWNER_REQUIRED); an address that is already an active (or
--    suspended) member of the clinic: P0001 ALREADY_MEMBER; an unexpired pending invitation for the address is returned
--    with `deduped: true` and nothing is enqueued; an expired pending one is revoked first; `expires_at = now() + 72 h`;
--    in the SAME transaction one job `email.invite` with payload {invitation_id, token_version} and dedupe key
--    `invite:<id>:v<version>` (`ops.enqueue_job`, idempotent on the key). Returns {id, expires_at, deduped}; never a
--    token.
--    `public.resend_invitation(p_invitation_id)`: same permission rules (the clinic is the row's and must be the active
--    clinic, else P0002 INVITATION_NOT_FOUND); pending only (P0001 INVITATION_NOT_PENDING); token_version + 1,
--    token_hash = NULL (the old link is dead now), new 72 h expiry, a new job. Returns {id, expires_at, token_version}.
--    `public.revoke_invitation(p_invitation_id)`: same rules; sets revoked_at/by and token_hash = NULL. A second revoke
--    of the same invitation returns it unchanged. Returns {id, revoked_at}.
-- 3. `public.invitation_issue_token(p_invitation_id, p_token_version) returns text` (SECURITY DEFINER, service_role
--    only; the email handler, 05-07b): when the invitation is pending, unexpired and still on `p_token_version`, mints
--    32 random bytes (hex), stores only their SHA-256 (hex of the UTF-8 hex string, as `hashInviteToken`), bumps
--    send_count/last_sent_at and returns the raw token once; otherwise NULL (a stale job sends nothing). Each call
--    mints a NEW token (a retried send after a transport failure invalidates the unsent one).
-- 4. `public.peek_invitation(p_token_hash) returns jsonb` (anon, authenticated): {status} with status
--    pending|expired|revoked|used|not_found, plus clinic_name, role and a masked address for a known hash; nothing
--    else (never the address, ids or dates). A malformed hash reads as not_found.
-- 5. `public.consume_invitation(p_token_hash)` (same signature; 000071's binding kept): the confirmed caller whose
--    email equals the invited address; row locked; not revoked, not expired, not consumed; inserts the membership with
--    the invited role, or REACTIVATES a `removed` one (same row, R-32); an active/suspended member: P0001
--    ALREADY_MEMBER; audit `staff.invite_accepted`.
--    `public.consume_invitation_for(p_user_id, p_token_hash)` (service_role only, the invite-acceptance system path of
--    05-07b): the same checks with that user's auth email, confirmation NOT required (the system path confirms the
--    address it validated); idempotent for the same user and invitation (returns the clinic again).
-- Actor rule (R-38 erratum, as 000085): the service-role functions read the SESSION role
-- (`coalesce(nullif(current_setting('role'), 'none'), session_user)`), never `current_user` (always the owner inside a
-- SECURITY DEFINER function), and refuse any caller but service_role/postgres (42501 SYSTEM_ONLY) even if a grant
-- leaked; the user functions take the actor from `auth.uid()` only.
-- Per-migration checklist: new columns only; grants only narrow (INSERT revoked); every function `search_path = ''`,
-- REVOKE from PUBLIC/anon/authenticated/service_role then explicit GRANT; `lock_timeout`, no statement_timeout; machine
-- reasons registered in lib/db/errors.ts; peek_invitation joins the anon allowlist of readiness-probe-db.spec.ts.
-- Deploy order: the app's inviteStaff calls invite_staff in the same commit (the INSERT revoke breaks an older build's
-- direct insert; the invite form is owner/admin only).

-- 1. Columns, pending uniqueness, no direct INSERT -------------------------------------------------------------------------
ALTER TABLE public.invitations
    ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN last_sent_at TIMESTAMPTZ,
    ADD COLUMN send_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.invitations
    ADD CONSTRAINT invitations_token_version_positive CHECK (token_version >= 1),
    ADD CONSTRAINT invitations_send_count_nonnegative CHECK (send_count >= 0);
ALTER TABLE public.invitations ALTER COLUMN token_hash DROP NOT NULL;
COMMENT ON COLUMN public.invitations.token_hash IS
    'SHA-256 (hex) of the invitation token, minted at send time by invitation_issue_token (05-07a, R-30); NULL until the first send and after a resend or revoke. Not readable by API roles (000071).';

-- Older duplicates (pre-v2 rows could repeat an address): keep the newest pending one per clinic and address.
UPDATE public.invitations i
   SET revoked_at = now()
 WHERE i.consumed_at IS NULL
   AND i.revoked_at IS NULL
   AND EXISTS (
       SELECT 1 FROM public.invitations n
        WHERE n.tenant_id = i.tenant_id
          AND lower(n.invited_address) = lower(i.invited_address)
          AND n.consumed_at IS NULL
          AND n.revoked_at IS NULL
          AND (n.created_at, n.id) > (i.created_at, i.id)
   );
CREATE UNIQUE INDEX invitations_one_pending_per_address
    ON public.invitations (tenant_id, lower(invited_address))
    WHERE consumed_at IS NULL AND revoked_at IS NULL;

DROP POLICY IF EXISTS invitations_insert ON public.invitations;
REVOKE INSERT ON public.invitations FROM anon, authenticated;
GRANT SELECT (token_version, last_sent_at, send_count) ON public.invitations TO authenticated;

-- Shared internals (no API role may execute them) -------------------------------------------------------------------------
-- The SESSION role of the caller (R-38): PostgREST's SET ROLE, else the connecting user. Inside a SECURITY DEFINER
-- function `current_user` is the owner, so it cannot tell a JWT caller from the service role.
CREATE FUNCTION private.invitation_system_caller()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT coalesce(nullif(current_setting('role', true), 'none'), session_user::text) IN ('service_role', 'postgres')
$$;
REVOKE ALL ON FUNCTION private.invitation_system_caller() FROM PUBLIC, anon, authenticated, service_role;

-- The inviting caller for an invitation of p_tenant: the role of an ACTIVE membership in the caller's active clinic
-- that holds staff:invite, else NULL.
CREATE FUNCTION private.invitation_inviter_role(p_tenant UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT m.role
      FROM public.memberships m
     WHERE m.user_id = auth.uid()
       AND m.tenant_id = p_tenant
       AND m.status = 'active'
       AND p_tenant IN (SELECT authz.tenant_ids_with('staff:invite'))
$$;
REVOKE ALL ON FUNCTION private.invitation_inviter_role(UUID) FROM PUBLIC, anon, authenticated, service_role;

-- Enqueues the send job of one token version (idempotent on the dedupe key).
CREATE FUNCTION private.invitation_enqueue_send(p_invitation_id UUID, p_tenant UUID, p_token_version INTEGER)
RETURNS UUID
LANGUAGE sql
SET search_path = ''
AS $$
    SELECT ops.enqueue_job(
        'email.invite',
        p_tenant,
        jsonb_build_object('invitation_id', p_invitation_id, 'token_version', p_token_version),
        'invite:' || p_invitation_id::text || ':v' || p_token_version::text,
        now(),
        5
    )
$$;
REVOKE ALL ON FUNCTION private.invitation_enqueue_send(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated, service_role;

-- One audit row written by the definer RPCs (the actions are not on log_audit's client allow-list, so no member can
-- forge them). SECURITY DEFINER with no API grant (internal; audit_v2.test.sql refuses an invoker audit writer).
CREATE FUNCTION private.invitation_audit(
    p_tenant UUID, p_actor UUID, p_actor_role TEXT, p_action TEXT, p_invitation_id UUID, p_metadata JSONB
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, entity_type, entity_id, metadata)
    VALUES (p_tenant, p_actor, p_actor_role, p_action, 'invitation', p_invitation_id, p_metadata)
$$;
REVOKE ALL ON FUNCTION private.invitation_audit(UUID, UUID, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;

-- 2. invite_staff, resend_invitation, revoke_invitation ---------------------------------------------------------------------
CREATE FUNCTION public.invite_staff(p_tenant UUID, p_email TEXT, p_role TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_caller_role TEXT;
    v_email TEXT := lower(btrim(p_email));
    v_existing public.invitations;
    v_row public.invitations;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
    END IF;

    v_caller_role := private.invitation_inviter_role(p_tenant);
    IF p_tenant IS NULL OR v_caller_role IS NULL THEN
        RAISE EXCEPTION 'STAFF_INVITE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    IF p_role IS NULL OR p_role NOT IN ('owner', 'admin', 'doctor', 'receptionist', 'nurse')
       OR v_email IS NULL OR char_length(v_email) > 254
       OR v_email !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$' THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    IF p_role IN ('owner', 'admin') AND v_caller_role <> 'owner' THEN
        RAISE EXCEPTION 'OWNER_REQUIRED' USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.memberships m
          JOIN auth.users u ON u.id = m.user_id
         WHERE m.tenant_id = p_tenant
           AND m.status IN ('active', 'suspended')
           AND lower(btrim(u.email)) = v_email
    ) THEN
        RAISE EXCEPTION 'ALREADY_MEMBER' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_existing
      FROM public.invitations i
     WHERE i.tenant_id = p_tenant
       AND lower(i.invited_address) = v_email
       AND i.consumed_at IS NULL
       AND i.revoked_at IS NULL
       FOR UPDATE;

    IF FOUND THEN
        IF v_existing.expires_at > now() THEN
            RETURN jsonb_build_object('id', v_existing.id, 'expires_at', v_existing.expires_at, 'deduped', true);
        END IF;
        -- An expired pending invitation is revoked first; a new one follows.
        UPDATE public.invitations
           SET revoked_at = now(), revoked_by = v_uid, token_hash = NULL
         WHERE id = v_existing.id;
    END IF;

    INSERT INTO public.invitations (tenant_id, role, invited_address, token_hash, expires_at, created_by)
    VALUES (p_tenant, p_role, v_email, NULL, now() + interval '72 hours', v_uid)
    ON CONFLICT (tenant_id, lower(invited_address)) WHERE consumed_at IS NULL AND revoked_at IS NULL DO NOTHING
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        -- A concurrent invite for the same address won: return it, enqueue nothing.
        SELECT * INTO v_existing
          FROM public.invitations i
         WHERE i.tenant_id = p_tenant
           AND lower(i.invited_address) = v_email
           AND i.consumed_at IS NULL
           AND i.revoked_at IS NULL;
        RETURN jsonb_build_object('id', v_existing.id, 'expires_at', v_existing.expires_at, 'deduped', true);
    END IF;

    PERFORM private.invitation_enqueue_send(v_row.id, p_tenant, v_row.token_version);
    PERFORM private.invitation_audit(p_tenant, v_uid, v_caller_role, 'staff.invited', v_row.id,
        jsonb_build_object('role', p_role, 'token_version', v_row.token_version));

    RETURN jsonb_build_object('id', v_row.id, 'expires_at', v_row.expires_at, 'deduped', false);
END;
$$;

-- Locks an invitation of the caller's active clinic and checks the caller may manage it; returns the caller's role.
-- Not found (or another clinic's) → P0002 INVITATION_NOT_FOUND. The row lock is held until the caller's transaction ends.
CREATE FUNCTION private.invitation_manager_role(p_invitation_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_row public.invitations;
    v_role TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_row FROM public.invitations WHERE id = p_invitation_id FOR UPDATE;
    IF NOT FOUND OR v_row.tenant_id IS DISTINCT FROM authz.active_tenant_id() THEN
        RAISE EXCEPTION 'INVITATION_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    v_role := private.invitation_inviter_role(v_row.tenant_id);
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'STAFF_INVITE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF v_row.role IN ('owner', 'admin') AND v_role <> 'owner' THEN
        RAISE EXCEPTION 'OWNER_REQUIRED' USING ERRCODE = '42501';
    END IF;
    RETURN v_role;
END;
$$;
REVOKE ALL ON FUNCTION private.invitation_manager_role(UUID) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.resend_invitation(p_invitation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
    v_row public.invitations;
    v_role TEXT;
BEGIN
    v_role := private.invitation_manager_role(p_invitation_id);
    SELECT * INTO v_row FROM public.invitations WHERE id = p_invitation_id;
    IF v_row.consumed_at IS NOT NULL OR v_row.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'INVITATION_NOT_PENDING' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.invitations
       SET token_version = token_version + 1,
           token_hash = NULL,
           expires_at = now() + interval '72 hours'
     WHERE id = v_row.id
    RETURNING * INTO v_row;

    PERFORM private.invitation_enqueue_send(v_row.id, v_row.tenant_id, v_row.token_version);
    PERFORM private.invitation_audit(v_row.tenant_id, auth.uid(), v_role, 'staff.invite_resent', v_row.id,
        jsonb_build_object('role', v_row.role, 'token_version', v_row.token_version));

    RETURN jsonb_build_object('id', v_row.id, 'expires_at', v_row.expires_at, 'token_version', v_row.token_version);
END;
$$;

CREATE FUNCTION public.revoke_invitation(p_invitation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
    v_row public.invitations;
    v_role TEXT;
BEGIN
    v_role := private.invitation_manager_role(p_invitation_id);
    SELECT * INTO v_row FROM public.invitations WHERE id = p_invitation_id;
    IF v_row.consumed_at IS NOT NULL THEN
        RAISE EXCEPTION 'INVITATION_NOT_PENDING' USING ERRCODE = 'P0001';
    END IF;
    IF v_row.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('id', v_row.id, 'revoked_at', v_row.revoked_at);
    END IF;

    UPDATE public.invitations
       SET revoked_at = now(), revoked_by = auth.uid(), token_hash = NULL
     WHERE id = v_row.id
    RETURNING * INTO v_row;

    PERFORM private.invitation_audit(v_row.tenant_id, auth.uid(), v_role, 'staff.invite_revoked', v_row.id,
        jsonb_build_object('role', v_row.role, 'token_version', v_row.token_version));

    RETURN jsonb_build_object('id', v_row.id, 'revoked_at', v_row.revoked_at);
END;
$$;

-- 3. invitation_issue_token (the email handler) ------------------------------------------------------------------------------
CREATE FUNCTION public.invitation_issue_token(p_invitation_id UUID, p_token_version INTEGER)
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
       OR p_token_version IS DISTINCT FROM v_row.token_version THEN
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

-- 4. peek_invitation (the /join page; anon) ---------------------------------------------------------------------------------
CREATE FUNCTION public.peek_invitation(p_token_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row RECORD;
    v_local TEXT;
    v_status TEXT;
BEGIN
    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    SELECT i.role, i.invited_address, i.expires_at, i.consumed_at, i.revoked_at, t.name AS clinic_name
      INTO v_row
      FROM public.invitations i
      JOIN public.tenants t ON t.id = i.tenant_id
     WHERE i.token_hash = p_token_hash;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    v_status := CASE
        WHEN v_row.consumed_at IS NOT NULL THEN 'used'
        WHEN v_row.revoked_at IS NOT NULL THEN 'revoked'
        WHEN v_row.expires_at <= now() THEN 'expired'
        ELSE 'pending'
    END;
    v_local := split_part(v_row.invited_address, '@', 1);
    RETURN jsonb_build_object(
        'status', v_status,
        'clinic_name', v_row.clinic_name,
        'role', v_row.role,
        'masked_email', left(v_local, 1) || '***@' || split_part(v_row.invited_address, '@', 2)
    );
END;
$$;

-- 5. consume_invitation / consume_invitation_for ----------------------------------------------------------------------------
-- The shared redemption: p_user redeems the invitation whose hash is p_token_hash. p_require_confirmed: the user path
-- (000071) needs a confirmed email; the system path (05-07b) confirms the address it validated afterwards.
-- p_idempotent: the system path returns the clinic again when this user already consumed this invitation.
CREATE FUNCTION private.invitation_consume(p_user UUID, p_token_hash TEXT, p_require_confirmed BOOLEAN, p_idempotent BOOLEAN)
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
    IF v_email IS NULL OR lower(btrim(v_email)) IS DISTINCT FROM lower(btrim(v_invite.invited_address)) THEN
        RAISE EXCEPTION 'INVITATION_EMAIL_MISMATCH' USING ERRCODE = '42501';
    END IF;
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
REVOKE ALL ON FUNCTION private.invitation_consume(UUID, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consume_invitation(p_token_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
    END IF;
    RETURN private.invitation_consume(auth.uid(), p_token_hash, true, false);
END;
$$;

CREATE FUNCTION public.consume_invitation_for(p_user_id UUID, p_token_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
BEGIN
    IF NOT private.invitation_system_caller() THEN
        RAISE EXCEPTION 'SYSTEM_ONLY' USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    RETURN private.invitation_consume(p_user_id, p_token_hash, false, true);
END;
$$;

-- Grants ------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.invite_staff(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resend_invitation(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.revoke_invitation(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.invitation_issue_token(UUID, INTEGER) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.peek_invitation(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consume_invitation(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consume_invitation_for(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.invite_staff(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resend_invitation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_invitation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invitation_issue_token(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.peek_invitation(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_invitation(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_invitation_for(UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.invite_staff(UUID, TEXT, TEXT) IS
    'AUTH-06 (05-07a): the only way a member creates an invitation. p_tenant = the session clinic, checked against staff:invite in the active clinic; owner/admin invitations by owners only; one pending invitation per address; the send job is enqueued in the same transaction; never returns a token.';
COMMENT ON FUNCTION public.invitation_issue_token(UUID, INTEGER) IS
    'AUTH-06 (05-07a, R-30): service role only (the email handler). Mints the raw token at send time for the current token_version, stores only its SHA-256, returns it once; NULL for a stale or dead invitation.';
COMMENT ON FUNCTION public.peek_invitation(TEXT) IS
    'AUTH-06 (05-07a): /join preview for anon: status, clinic name, role and a masked address of a known token hash; nothing else.';
COMMENT ON FUNCTION public.consume_invitation_for(UUID, TEXT) IS
    'AUTH-06 (05-07a): service role only (invite acceptance for a user without a confirmed account, 05-07b). Same address binding as consume_invitation; idempotent for the same user.';
