-- Migration: 000087_membership_status.sql
-- V2-05 plan 05-05 (AUTH-05, SEC-07, AUTH_REDESIGN §3.6; rulings R-14, R-32, R-42, R-43; threats T-05-24..T-05-26).
--
-- 1. `memberships.status` ('active' | 'suspended' | 'removed', default 'active'), `removed_at`, `removed_by`
--    (→ auth.users, NO ACTION, indexed). Staff are deactivated, never deleted: since 05-03 a doctor's membership is
--    the RESTRICT parent of their visits, prescriptions, … (composite FKs). None of the three columns is in the
--    self-update column grants (000019), so a member cannot reactivate themself. `invitations.revoked_at`,
--    `revoked_by` (expand step, used here and by 05-07a's invitations v2); SELECT granted on both columns
--    (`token_hash` stays unreadable, 000071).
-- 2. Helper BODIES only (R-14, no policy changes): `authz.active_tenant_id()`, `member_tenant_ids()`,
--    `full_tenant_ids()`, `tenant_ids_with()`, `billing_tenant_ids()` read only `status = 'active'` memberships. A
--    removed or suspended member therefore reads 0 rows and writes nothing in every table, storage class and bound
--    definer function with a still-valid JWT (acceptance 4), without any policy being rewritten.
-- 3. `change_member_role` ignores non-active rows: a removed/suspended target is not found, the caller's role is read
--    from an active row, and the last-owner count is of active owners.
-- 4. `public.remove_member(p_membership_id, p_reason) returns jsonb` (SECURITY DEFINER, `authenticated` only). The tenant
--    comes from the target row and must be the caller's ACTIVE clinic (R-42), else P0002 MEMBER_NOT_FOUND (existence
--    of another clinic's member is never revealed). Then, in this order: the caller holds `staff:invite` there, else
--    42501 STAFF_REMOVE_FORBIDDEN; an owner/admin target needs an owner caller, else 42501 OWNER_REQUIRED; the last
--    active owner cannot be removed (owners locked, as change_member_role), P0001 LAST_OWNER; self-removal is refused,
--    P0001 SELF_REMOVAL (R-32); an already removed member, P0001 MEMBER_NOT_ACTIVE. Effects: status `removed` +
--    removed_at/by; the target's API keys in that clinic `revoked_at = now()`; the target's pending invitations in that
--    clinic `revoked_at`/`revoked_by`; **sessions (R-43):** `delete from auth.sessions where user_id = <target>` in an
--    inner block that catches `insufficient_privilege`, so a hosted refusal never undoes the removal
--    (`sessions_revoked` = rows deleted, or NULL when refused; refresh tokens cascade). The removal signs the user out
--    of every clinic until they sign in again (intended; the auth user is never banned: other clinics keep them). One
--    audit row `staff.removed` with counts only (+ the target user, role and the caller's reason, ≤ 500 chars),
--    written directly by this definer function as `change_member_role` does: putting the action on `log_audit`'s
--    client allow-list would let any member forge a removal row. Returns {user_id, keys_revoked, invites_revoked,
--    sessions_revoked}.
-- 5. `public.session_is_live() returns boolean` (SECURITY DEFINER, `authenticated`; AUTH §3.5 step 3): the caller's
--    JWT `session_id` still has an unexpired row in `auth.sessions` of the caller (an invoker read of auth.sessions is
--    denied to API roles).
-- 6. `consume_invitation` (same signature, still the 000071 binding) refuses a revoked invitation (P0001
--    INVITATION_REVOKED): removal revokes the target's invitations, and a revoked link must be dead now, not in 05-07a.
-- Per-migration checklist: no new table; new columns only; FKs indexed; both functions `search_path = ''`, REVOKE from
-- PUBLIC/anon, explicit GRANT; machine reasons registered in lib/db/errors.ts; `lock_timeout`, no statement_timeout.
-- Expand-safe: existing rows become 'active'; the previous app build never names the new columns.

-- 1. Columns ------------------------------------------------------------------------------------------------------------
ALTER TABLE public.memberships
    ADD COLUMN status TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN removed_at TIMESTAMPTZ,
    ADD COLUMN removed_by UUID REFERENCES auth.users (id);
ALTER TABLE public.memberships
    ADD CONSTRAINT memberships_status_check CHECK (status IN ('active', 'suspended', 'removed')),
    ADD CONSTRAINT memberships_removed_at_status CHECK ((status = 'removed') = (removed_at IS NOT NULL));
CREATE INDEX idx_memberships_removed_by ON public.memberships (removed_by);
COMMENT ON COLUMN public.memberships.status IS
    'AUTH-05 (05-05): only active memberships count in the authz helpers. removed = staff removal (remove_member); suspended is reserved (V2-11/V2-13c). Never deleted: the row is the RESTRICT parent of the member''s clinical history.';

ALTER TABLE public.invitations
    ADD COLUMN revoked_at TIMESTAMPTZ,
    ADD COLUMN revoked_by UUID REFERENCES auth.users (id);
CREATE INDEX idx_invitations_revoked_by ON public.invitations (revoked_by);
GRANT SELECT (revoked_at, revoked_by) ON public.invitations TO authenticated;

-- 2. Helper bodies (R-14: same signatures, volatility, definer flag, search_path and ACL) ------------------------------
CREATE OR REPLACE FUNCTION authz.active_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_headers TEXT := NULLIF(current_setting('request.headers', true), '');
    v_named TEXT;
    v_tenant UUID;
    v_only UUID[];
BEGIN
    IF v_uid IS NULL THEN
        RETURN NULL;
    END IF;

    -- Nested, so the cast runs only on valid JSON (AND does not promise an evaluation order).
    IF v_headers IS NOT NULL AND pg_catalog.pg_input_is_valid(v_headers, 'json') THEN
        IF pg_catalog.json_typeof(v_headers::json) = 'object' THEN
            v_named := v_headers::json ->> 'x-clinicos-tenant';
        END IF;
    END IF;

    -- 05-05: only an ACTIVE membership can be the active clinic (a removed/suspended one is as if absent).
    IF v_named ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN
        SELECT m.tenant_id INTO v_tenant
          FROM public.memberships m
         WHERE m.user_id = v_uid
           AND m.tenant_id = v_named::UUID
           AND m.status = 'active';
        IF v_tenant IS NOT NULL THEN
            RETURN v_tenant;
        END IF;
    END IF;

    SELECT ARRAY(
        SELECT m.tenant_id FROM public.memberships m WHERE m.user_id = v_uid AND m.status = 'active' LIMIT 2
    ) INTO v_only;
    IF pg_catalog.cardinality(v_only) = 1 THEN
        RETURN v_only[1];
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION authz.member_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT m.tenant_id
      FROM public.memberships m
     WHERE m.user_id = auth.uid()
       AND m.status = 'active'
$$;

CREATE OR REPLACE FUNCTION authz.full_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT m.tenant_id
      FROM public.memberships m
     WHERE m.user_id = auth.uid()
       AND m.status = 'active'
       AND m.tenant_id = authz.active_tenant_id()
$$;

CREATE OR REPLACE FUNCTION authz.tenant_ids_with(p_perm TEXT)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT m.tenant_id
      FROM public.memberships m
     WHERE m.user_id = auth.uid()
       AND m.status = 'active'
       AND m.tenant_id IN (SELECT authz.full_tenant_ids())
       AND authz.role_has_permission(m.role, p_perm)
$$;

CREATE OR REPLACE FUNCTION authz.billing_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT m.tenant_id
      FROM public.memberships m
     WHERE m.user_id = auth.uid()
       AND m.status = 'active'
       AND m.tenant_id = authz.active_tenant_id()
       AND m.role IN ('owner', 'admin')
$$;

-- 3. change_member_role: active rows only --------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_member_role(p_membership_id UUID, p_role TEXT)
RETURNS public.memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_target public.memberships;
    v_caller_role TEXT;
    v_old_role TEXT;
    v_owners INTEGER;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;

    IF p_role IS NULL OR p_role NOT IN ('owner', 'admin', 'doctor', 'receptionist', 'nurse') THEN
        RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_target FROM public.memberships WHERE id = p_membership_id FOR UPDATE;
    -- 05-05: a removed or suspended membership has no role to change (reactivation is 05-07a's re-invite).
    IF NOT FOUND OR v_target.status <> 'active' THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    -- The tenant comes from the target row; it must be the session's ACTIVE clinic (05-02c, R-42) and the caller's
    -- role is read there (from an active membership, 05-05).
    IF v_target.tenant_id IS DISTINCT FROM authz.active_tenant_id() THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT m.role INTO v_caller_role
    FROM public.memberships m
    WHERE m.tenant_id = v_target.tenant_id AND m.user_id = v_uid AND m.status = 'active';

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    IF v_caller_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    IF (p_role IN ('owner', 'admin') OR v_target.role IN ('owner', 'admin')) AND v_caller_role <> 'owner' THEN
        RAISE EXCEPTION 'owner_required' USING ERRCODE = '42501';
    END IF;

    IF v_target.role = p_role THEN
        RETURN v_target;
    END IF;

    IF v_target.role = 'owner' THEN
        -- Serialise concurrent demotions/removals of the tenant's owners, then count the ACTIVE ones.
        PERFORM 1 FROM public.memberships
        WHERE tenant_id = v_target.tenant_id AND role = 'owner'
        FOR UPDATE;

        SELECT count(*) INTO v_owners
        FROM public.memberships
        WHERE tenant_id = v_target.tenant_id AND role = 'owner' AND status = 'active';

        IF v_owners <= 1 THEN
            RAISE EXCEPTION 'last_owner' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    v_old_role := v_target.role;

    UPDATE public.memberships
    SET role = p_role
    WHERE id = p_membership_id
    RETURNING * INTO v_target;

    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, entity_type, entity_id, metadata)
    VALUES (
        v_target.tenant_id,
        v_uid,
        v_caller_role,
        'staff.member.role_change',
        'membership',
        v_target.id,
        jsonb_build_object('target_user_id', v_target.user_id, 'from_role', v_old_role, 'to_role', p_role)
    );

    RETURN v_target;
END;
$$;

-- 4. remove_member -------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.remove_member(p_membership_id UUID, p_reason TEXT)
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
    BEGIN
        WITH s AS (
            DELETE FROM auth.sessions WHERE user_id = v_target.user_id RETURNING 1
        )
        SELECT count(*) INTO v_sessions FROM s;
    EXCEPTION
        WHEN insufficient_privilege THEN
            v_sessions := NULL;
    END;

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

REVOKE ALL ON FUNCTION public.remove_member(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_member(UUID, TEXT) TO authenticated;
COMMENT ON FUNCTION public.remove_member(UUID, TEXT) IS
    'AUTH-05 staff removal (05-05): status removed, API keys and pending invitations revoked, sessions deleted (fail-soft, R-43), audited with counts. The tenant is the target row''s and must be the caller''s active clinic.';

-- 5. session_is_live -----------------------------------------------------------------------------------------------------
CREATE FUNCTION public.session_is_live()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM auth.sessions s
         WHERE s.user_id = auth.uid()
           AND s.id = CASE
                          WHEN (auth.jwt() ->> 'session_id')
                               ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
                          THEN (auth.jwt() ->> 'session_id')::UUID
                      END
           AND (s.not_after IS NULL OR s.not_after > now())
    )
$$;

REVOKE ALL ON FUNCTION public.session_is_live() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.session_is_live() TO authenticated;
COMMENT ON FUNCTION public.session_is_live() IS
    'AUTH §3.5 step 3 (05-05): true while the caller''s JWT session_id still has an unexpired auth.sessions row of the caller (false after sign-out elsewhere or staff removal).';

-- 6. consume_invitation: a revoked invitation is dead --------------------------------------------------------------------
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
    SELECT i.id, i.tenant_id, i.role, i.invited_address, i.expires_at, i.consumed_at, i.revoked_at
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

    -- 05-05: revoked by the inviter's removal (remove_member) or, from 05-07a, by revoke_invitation.
    IF v_invite.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'INVITATION_REVOKED' USING ERRCODE = 'P0001';
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
