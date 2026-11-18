-- Migration: 000094_gate_close_05b.sql
-- V2-05 05b gate close: the re-verification's cheap Lows (`reviews/v205b-review-reverify.md`) and the CTO ruling of
-- 2026-11-15 on clearing a patient's AI objection (`05b-REVIEW-TRIAGE.md`). Replaces three function bodies; no table,
-- column, policy or grant changes (CREATE OR REPLACE keeps each function's grants).
--
-- A. N-1 (Low): `ai_commit` locks the clinic's usage row FIRST (the lock `ai_reserve` takes before it counts live
--    reservations), then the reservation, and only then decides expiry against `clock_timestamp()` (the wall clock),
--    not `now()` (the transaction start). A commit whose transaction began before expiry, or that waited on the lock
--    past expiry, is refused (AI_RESERVATION_EXPIRED), so `ai_reserve` and `ai_commit` serialise on one row and the
--    units of a period never exceed its limit.
-- B. N-2 (Low): `invite_staff` names the STORED role in every answer (`role`), including both `deduped` branches (a
--    concurrent invite to the same address with another role wins the unique index), so the app reports the role the
--    invitation actually carries, never the one requested.
-- C. CTO ruling 2026-11-15: an owner who holds the doctor permissions (the owner role holds every permission of the
--    doctor role; typical of a single-doctor clinic) may also clear a patient's AI objection. Admins and nurses still
--    may not; every change stays audited (`patient.ai_objection.set` / `.cleared`, actor and role, no PHI).
-- Every replaced definer function keeps `search_path = ''`. Synthetic data only in tests.

-- A. ai_commit: usage-row lock first, wall-clock expiry ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ai_commit(p_reservation uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
    v_system boolean := private.ai_system_caller();
    v_uid uuid := (SELECT auth.uid());
    v_tenant uuid;
    v_row public.ai_quota_reservations;
    v_units integer;
BEGIN
    IF NOT v_system THEN
        v_tenant := private.ai_reservation_tenant();
    END IF;
    -- 05-12 (IND L-6): the caller's own reservation in the active clinic, or any reservation on the system path.
    -- Read without a lock first, only to learn which usage row it meters.
    SELECT * INTO v_row
      FROM public.ai_quota_reservations r
     WHERE r.id = p_reservation
       AND (v_system OR (r.tenant_id = v_tenant AND r.created_by = v_uid));
    IF NOT FOUND THEN
        RAISE EXCEPTION 'AI_RESERVATION_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    -- 000094 (N-1): the usage row lock first, the same lock ai_reserve holds while it counts live reservations.
    INSERT INTO public.ai_usage_monthly (tenant_id, period, feature, units)
    VALUES (v_row.tenant_id, v_row.period, v_row.feature, 0)
    ON CONFLICT (tenant_id, period, feature) DO NOTHING;
    PERFORM 1
       FROM public.ai_usage_monthly u
      WHERE u.tenant_id = v_row.tenant_id AND u.period = v_row.period AND u.feature = v_row.feature
        FOR UPDATE;

    -- Then the reservation itself: a concurrent commit or release may have consumed it while this call waited.
    SELECT * INTO v_row
      FROM public.ai_quota_reservations r
     WHERE r.id = v_row.id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'AI_RESERVATION_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    -- 05-12 (M-AIEXP) + 000094 (N-1): expiry is decided under the lock, at the wall clock (not the transaction start):
    -- an expired reservation no longer counts against the quota, so it cannot become a unit either.
    IF v_row.expires_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'AI_RESERVATION_EXPIRED' USING ERRCODE = 'P0001';
    END IF;

    DELETE FROM public.ai_quota_reservations r WHERE r.id = v_row.id;
    UPDATE public.ai_usage_monthly u
       SET units = u.units + 1, updated_at = now()
     WHERE u.tenant_id = v_row.tenant_id AND u.period = v_row.period AND u.feature = v_row.feature
    RETURNING u.units INTO v_units;
    RETURN v_units;
END;
$$;
COMMENT ON FUNCTION public.ai_commit(uuid) IS
    'AI-03 (05-10c, 05-12, 000094): the caller''s own live reservation (or any, on the system path) becomes exactly one used unit of its period. Locks the usage row first, then decides expiry at clock_timestamp(); an expired one raises AI_RESERVATION_EXPIRED.';

-- B. invite_staff: the stored role in every answer -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.invite_staff(p_tenant uuid, p_email text, p_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
DECLARE
    v_uid UUID := auth.uid();
    v_caller_role TEXT;
    v_email TEXT := lower(btrim(p_email));
    v_existing public.invitations;
    v_row public.invitations;
    v_replaced TEXT;
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
        IF v_existing.expires_at > now() AND v_existing.role = p_role THEN
            RETURN jsonb_build_object('id', v_existing.id, 'expires_at', v_existing.expires_at, 'deduped', true,
                                      'role', v_existing.role);
        END IF;
        IF v_existing.expires_at > now() THEN
            -- 05-12 (M-REINVITE): a pending invitation for ANOTHER role is replaced, never silently kept. Revoking an
            -- owner/admin invitation is owner-only, as in revoke_invitation.
            IF v_existing.role IN ('owner', 'admin') AND v_caller_role <> 'owner' THEN
                RAISE EXCEPTION 'OWNER_REQUIRED' USING ERRCODE = '42501';
            END IF;
            v_replaced := v_existing.role;
        END IF;
        -- An expired, or replaced, pending invitation is revoked first; a new one follows.
        UPDATE public.invitations
           SET revoked_at = now(), revoked_by = v_uid, token_hash = NULL
         WHERE id = v_existing.id;
        IF v_replaced IS NOT NULL THEN
            PERFORM private.invitation_audit(p_tenant, v_uid, v_caller_role, 'staff.invite_revoked', v_existing.id,
                jsonb_build_object('role', v_existing.role, 'token_version', v_existing.token_version,
                                   'replaced_by_role', p_role));
        END IF;
    END IF;

    INSERT INTO public.invitations (tenant_id, role, invited_address, token_hash, expires_at, created_by)
    VALUES (p_tenant, p_role, v_email, NULL, now() + interval '72 hours', v_uid)
    ON CONFLICT (tenant_id, lower(invited_address)) WHERE consumed_at IS NULL AND revoked_at IS NULL DO NOTHING
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        -- A concurrent invite for the same address won: return it, enqueue nothing. 000094 (N-2): the answer names the
        -- STORED role, which may differ from p_role when the winner asked for another role; the app shows that role.
        SELECT * INTO v_existing
          FROM public.invitations i
         WHERE i.tenant_id = p_tenant
           AND lower(i.invited_address) = v_email
           AND i.consumed_at IS NULL
           AND i.revoked_at IS NULL;
        RETURN jsonb_build_object('id', v_existing.id, 'expires_at', v_existing.expires_at, 'deduped', true,
                                  'role', v_existing.role);
    END IF;

    PERFORM private.invitation_enqueue_send(v_row.id, p_tenant, v_row.token_version);
    PERFORM private.invitation_audit(p_tenant, v_uid, v_caller_role, 'staff.invited', v_row.id,
        jsonb_build_object('role', p_role, 'token_version', v_row.token_version)
        || CASE WHEN v_replaced IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('replaced_role', v_replaced) END);

    RETURN jsonb_build_object('id', v_row.id, 'expires_at', v_row.expires_at, 'deduped', false, 'role', v_row.role)
        || CASE WHEN v_replaced IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('replaced_role', v_replaced) END;
END;
$function$;

-- C. Patient AI objection: an owner who holds the doctor permissions may clear it -------------------------------------

CREATE OR REPLACE FUNCTION private.patients_ai_objection_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_role text;
BEGIN
    IF TG_OP = 'INSERT' AND NOT NEW.ai_processing_objected THEN
        RETURN NULL;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.ai_processing_objected IS NOT DISTINCT FROM OLD.ai_processing_objected THEN
        RETURN NULL;
    END IF;
    IF v_uid IS NOT NULL THEN
        SELECT m.role INTO v_role
          FROM public.memberships m
         WHERE m.tenant_id = NEW.tenant_id AND m.user_id = v_uid AND m.status = 'active';
        -- AI §4.6: the objection is editable by the doctor or the receptionist; clearing it is the DPDP-relevant change.
        -- CTO ruling 2026-11-15 (000094): an owner who holds every permission of the doctor role (a practising owner)
        -- may clear it too. Admins and nurses may not.
        IF TG_OP = 'UPDATE' AND NOT NEW.ai_processing_objected
           AND v_role IS DISTINCT FROM 'doctor' AND v_role IS DISTINCT FROM 'receptionist'
           AND NOT (v_role = 'owner' AND NOT EXISTS (
                   SELECT 1
                     FROM unnest(authz.permission_keys()) AS k(perm)
                    WHERE authz.role_has_permission('doctor', k.perm)
                      AND NOT authz.role_has_permission(v_role, k.perm))) THEN
            RAISE EXCEPTION 'AI_OBJECTION_CLEAR_FORBIDDEN' USING ERRCODE = '42501';
        END IF;
    END IF;
    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, actor_type, action, entity_type, entity_id, metadata)
    VALUES (NEW.tenant_id, v_uid, coalesce(v_role, 'system'), CASE WHEN v_uid IS NULL THEN 'system' ELSE 'user' END,
            CASE WHEN NEW.ai_processing_objected THEN 'patient.ai_objection.set' ELSE 'patient.ai_objection.cleared' END,
            'patient', NEW.id, '{}'::jsonb);
    RETURN NULL;
END;
$$;
