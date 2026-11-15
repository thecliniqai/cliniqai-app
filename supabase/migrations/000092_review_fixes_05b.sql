-- Migration: 000092_review_fixes_05b.sql
-- V2-05 fix plan 05-12 (05b review triage, `05b-REVIEW-TRIAGE.md`; reviews in `reviews/v205b-review-*.md`).
-- Expand + migrate step; the contract step (VALIDATE of the time-zone CHECK after diagnostic D12z) is 000093.
--
-- A. AI quota (H-AITZ, M-AIEXP; Lows IND L-6, IND L-2 + I-5)
--    1. `private.ai_period(tenant, at)`: the metering period no longer reads `tenants.timezone` (a column owners and
--       admins can edit): while `trialing` it is `trial:<trial_start as an Asia/Kolkata date>` (the stored, immutable
--       trial start; PO-21), otherwise the Asia/Kolkata month `YYYY-MM` (AI §4.6 "IST calendar month", SUB §4's
--       billing anchor). Changing the clinic's zone mid-trial or mid-month can no longer open a new pool.
--    2. `entitlement_keys.quota_key`: the limit key that meters a boolean AI feature (ai.scribe →
--       ai.scribe.monthly_drafts, ai.voice_receptionist → ai.voice_receptionist.monthly_minutes). `private.ai_gate`
--       takes the limit from it; an AI feature without one raises AI_QUOTA_NOT_CONFIGURED (fail closed, a clear
--       configuration error instead of a permanent over_quota).
--    3. `ai_quota_reservations.created_by` (set by `ai_reserve`): `ai_commit` / `ai_release` act only on the caller's
--       own reservation in the active clinic (consultations:edit there), or on any reservation from the system path
--       (session role service_role/postgres, R-38: the session role, never current_user). EXECUTE gains service_role.
--    4. `ai_commit` refuses an expired reservation (P0001 AI_RESERVATION_EXPIRED; nothing changes): units can no
--       longer exceed the limit through calls that outlive their reservation. The V2-12 gateway aborts the provider
--       call at the reserved timeout and discards a late draft (recorded in 05-12's record). `ai_release` of an
--       expired reservation still deletes it.
-- B. Clinic time zone (H-AITZ part 4): `private.is_iana_timezone(text)` and CHECK `tenants_timezone_iana` (NOT VALID
--    here, VALIDATEd by 000093 after D12z); every change of `tenants.timezone` writes `clinic.timezone_changed` to
--    audit_logs (old and new zone; actor from the session) through the definer trigger `tenants_timezone_audit`.
-- C. Cancelled delivery jobs (M-CANCEL, AI L-1): `ops.jobs` trigger `jobs_delivery_cancelled` closes the job's
--    delivery row when a `message.send` / `webhook.deliver` job is cancelled (claim_jobs' `tenant_not_full`):
--    `communication_queue` → `cancelled` (the scrub trigger redacts template_params/metadata, as on the dead path),
--    `webhook_delivery_queue` → `failed` (terminal, like the dead path). `ops.backfill_delivery_jobs` reads only open
--    rows, so a closed row is never re-enqueued. Migrate step: rows already left open by a cancelled job, or open
--    without a job in a clinic that is not `full`, are closed the same way.
-- D. Re-invite with another role (M-REINVITE): `invite_staff` revokes a pending invitation to the same address with a
--    different role and creates a new one (new email); owner/admin invitations stay owner-only to revoke. The answer
--    carries `replaced_role` in that case; a same-role repeat is still `deduped`.
-- E. `remove_member` (IND L-3 + ACC L-1, IND L-5): disables the removed member's webhook subscriptions in the clinic
--    and rotates their signing secrets (`webhooks_disabled` in the answer and the audit row); the OWNER of a clinic
--    whose level is `locked` or `onboarding` may still remove staff with the same rules and audit.
-- F. Referral target guard (IND L-7): the target doctor must be an ACTIVE member of the target clinic.
-- G. SUB-D6 (IND L-4): an expired clinic's prescription link resolves to verification metadata only: clinic name,
--    doctor name and registration number, issue date, valid. No patient name, title, file name or file.
-- H. Patient AI objection (AI L-3): every change of `patients.ai_processing_objected` is audited
--    (`patient.ai_objection.set` / `.cleared`, no PHI); a signed-in caller may clear it only as a doctor or
--    receptionist of the clinic (AI §4.6; 42501 AI_OBJECTION_CLEAR_FORBIDDEN).
-- Every new or replaced definer function: `search_path = ''`, explicit REVOKE/GRANT. Synthetic data only in tests.

-- A. AI quota ---------------------------------------------------------------------------------------------------------

ALTER TABLE public.entitlement_keys
    ADD COLUMN quota_key text REFERENCES public.entitlement_keys (key) ON DELETE RESTRICT;
ALTER TABLE public.entitlement_keys
    ADD CONSTRAINT entitlement_keys_quota_key_boolean CHECK (quota_key IS NULL OR (kind = 'boolean' AND quota_key <> key));
CREATE INDEX idx_entitlement_keys_quota_key ON public.entitlement_keys (quota_key);
COMMENT ON COLUMN public.entitlement_keys.quota_key IS
    '05-12 (IND L-2): the limit key that meters this boolean AI feature (ai_gate reads the limit from it). NULL = not metered: ai_gate refuses the feature (AI_QUOTA_NOT_CONFIGURED).';
UPDATE public.entitlement_keys SET quota_key = 'ai.scribe.monthly_drafts' WHERE key = 'ai.scribe';
UPDATE public.entitlement_keys SET quota_key = 'ai.voice_receptionist.monthly_minutes' WHERE key = 'ai.voice_receptionist';

ALTER TABLE public.ai_quota_reservations
    ADD COLUMN created_by uuid REFERENCES auth.users (id) ON DELETE CASCADE;
CREATE INDEX idx_ai_quota_reservations_created_by ON public.ai_quota_reservations (created_by);
COMMENT ON COLUMN public.ai_quota_reservations.created_by IS
    '05-12 (IND L-6): the user whose ai_reserve made it; only they (or the system path) commit or release it. NULL only for reservations made before 000092.';

-- The metering period (05-12, H-AITZ). Never reads tenants.timezone.
CREATE FUNCTION private.ai_period(p_tenant uuid, p_at timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN s.status = 'trialing' AND s.trial_start IS NOT NULL
            THEN 'trial:' || to_char(s.trial_start AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')
        ELSE to_char(p_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') END
      FROM (SELECT 1) one
      LEFT JOIN public.tenant_subscriptions s ON s.tenant_id = p_tenant
$$;
REVOKE EXECUTE ON FUNCTION private.ai_period(uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.ai_period(uuid, timestamptz) IS
    'AI metering period (05-12, H-AITZ): trial:<Asia/Kolkata date of the stored trial_start> while trialing, else the Asia/Kolkata month. Independent of tenants.timezone.';

-- The session is the system path (R-38: the session role, never current_user inside SECURITY DEFINER).
CREATE FUNCTION private.ai_system_caller()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT coalesce(nullif(current_setting('role', true), 'none'), session_user::text) IN ('service_role', 'postgres')
$$;
REVOKE EXECUTE ON FUNCTION private.ai_system_caller() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.ai_gate(
    p_feature text,
    p_visit_id uuid,
    OUT r_code text,
    OUT r_tenant uuid,
    OUT r_period text,
    OUT r_limit bigint
)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_active uuid;
    v_patient uuid;
    v_role text;
    v_quota_key text;
    v_units bigint;
    v_live bigint;
BEGIN
    SELECT k.quota_key INTO v_quota_key
      FROM public.entitlement_keys k
     WHERE k.key = p_feature AND k.kind = 'boolean' AND k.key LIKE 'ai.%';
    IF p_feature IS NULL OR NOT FOUND THEN
        RAISE EXCEPTION 'AI_FEATURE_UNKNOWN' USING ERRCODE = 'P0001';
    END IF;
    -- 05-12 (IND L-2): the limit comes from the feature's own quota key; an unmetered AI feature is refused.
    IF v_quota_key IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.entitlement_keys q WHERE q.key = v_quota_key AND q.kind = 'limit'
    ) THEN
        RAISE EXCEPTION 'AI_QUOTA_NOT_CONFIGURED' USING ERRCODE = 'P0001';
    END IF;

    r_code := 'forbidden';
    IF v_uid IS NULL OR p_visit_id IS NULL THEN
        RETURN;
    END IF;

    -- Tenant and patient from the visit; the visit's clinic must be the session's active clinic (R-42).
    v_active := authz.active_tenant_id();
    SELECT v.tenant_id, v.patient_id INTO r_tenant, v_patient FROM public.visits v WHERE v.id = p_visit_id;
    IF NOT FOUND OR v_active IS NULL OR r_tenant IS DISTINCT FROM v_active THEN
        r_tenant := NULL;
        RETURN;
    END IF;

    IF billing_internal.tenant_access_level(r_tenant, now()) IS DISTINCT FROM 'full' THEN
        r_code := 'locked';
        RETURN;
    END IF;

    SELECT m.role INTO v_role
      FROM public.memberships m
     WHERE m.tenant_id = r_tenant AND m.user_id = v_uid AND m.status = 'active';
    IF v_role IS NULL OR NOT authz.role_has_permission(v_role, 'consultations:edit') THEN
        r_code := 'forbidden';
        RETURN;
    END IF;

    IF NOT coalesce((SELECT (ps.ai_features -> p_feature) = 'true'::jsonb FROM public.platform_settings ps WHERE ps.id), false) THEN
        r_code := 'killed';
        RETURN;
    END IF;

    IF NOT coalesce(billing_internal.has_entitlement(r_tenant, p_feature, now()), false) THEN
        r_code := 'not_entitled';
        RETURN;
    END IF;

    IF NOT coalesce((SELECT s.enabled FROM public.tenant_ai_settings s WHERE s.tenant_id = r_tenant), false) THEN
        r_code := 'not_opted_in';
        RETURN;
    END IF;

    IF coalesce((SELECT p.ai_processing_objected FROM public.patients p WHERE p.id = v_patient), false) THEN
        r_code := 'patient_objected';
        RETURN;
    END IF;

    -- 05-12 (H-AITZ): the period is independent of tenants.timezone.
    r_period := private.ai_period(r_tenant, now());
    r_limit := coalesce(billing_internal.entitlement_limit(r_tenant, v_quota_key, now()), 0);

    SELECT coalesce((SELECT u.units FROM public.ai_usage_monthly u
                      WHERE u.tenant_id = r_tenant AND u.period = r_period AND u.feature = p_feature), 0)
      INTO v_units;
    SELECT count(*) INTO v_live
      FROM public.ai_quota_reservations r
     WHERE r.tenant_id = r_tenant AND r.feature = p_feature AND r.period = r_period AND r.expires_at > now();
    r_code := CASE WHEN v_units + v_live >= r_limit THEN 'over_quota' ELSE 'ok' END;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_reserve(p_feature text, p_visit_id uuid, p_timeout_s integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
    v_gate record;
    v_units bigint;
    v_live bigint;
    v_timeout integer := greatest(10, least(300, coalesce(p_timeout_s, 60)));
    v_id uuid;
BEGIN
    SELECT g.* INTO v_gate FROM private.ai_gate(p_feature, p_visit_id) g;
    -- over_quota is decided again under the row lock below (a read without the lock may be stale either way).
    IF v_gate.r_code NOT IN ('ok', 'over_quota') THEN
        RAISE EXCEPTION USING MESSAGE = 'AI_' || upper(v_gate.r_code), ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.ai_usage_monthly (tenant_id, period, feature, units)
    VALUES (v_gate.r_tenant, v_gate.r_period, p_feature, 0)
    ON CONFLICT (tenant_id, period, feature) DO NOTHING;
    SELECT u.units INTO v_units
      FROM public.ai_usage_monthly u
     WHERE u.tenant_id = v_gate.r_tenant AND u.period = v_gate.r_period AND u.feature = p_feature
       FOR UPDATE;
    SELECT count(*) INTO v_live
      FROM public.ai_quota_reservations r
     WHERE r.tenant_id = v_gate.r_tenant AND r.feature = p_feature AND r.period = v_gate.r_period
       AND r.expires_at > now();
    IF v_units + v_live >= v_gate.r_limit THEN
        RAISE EXCEPTION 'AI_OVER_QUOTA' USING ERRCODE = 'P0001';
    END IF;

    -- 05-12 (IND L-6): the reservation belongs to the caller.
    INSERT INTO public.ai_quota_reservations (tenant_id, feature, period, expires_at, created_by)
    VALUES (v_gate.r_tenant, p_feature, v_gate.r_period, now() + make_interval(secs => v_timeout + 30), (SELECT auth.uid()))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

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
    SELECT * INTO v_row
      FROM public.ai_quota_reservations r
     WHERE r.id = p_reservation
       AND (v_system OR (r.tenant_id = v_tenant AND r.created_by = v_uid))
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'AI_RESERVATION_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    -- 05-12 (M-AIEXP): an expired reservation no longer counts against the quota, so it cannot become a unit either.
    IF v_row.expires_at <= now() THEN
        RAISE EXCEPTION 'AI_RESERVATION_EXPIRED' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM public.ai_quota_reservations r WHERE r.id = v_row.id;
    INSERT INTO public.ai_usage_monthly AS u (tenant_id, period, feature, units)
    VALUES (v_row.tenant_id, v_row.period, v_row.feature, 1)
    ON CONFLICT (tenant_id, period, feature) DO UPDATE SET units = u.units + 1, updated_at = now()
    RETURNING u.units INTO v_units;
    RETURN v_units;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ai_commit(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_commit(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.ai_commit(uuid) IS
    'AI-03 (05-10c, 05-12): the caller''s own live reservation (or any, on the system path) becomes exactly one used unit of its period; an expired one raises AI_RESERVATION_EXPIRED.';

CREATE OR REPLACE FUNCTION public.ai_release(p_reservation uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_system boolean := private.ai_system_caller();
    v_uid uuid := (SELECT auth.uid());
    v_tenant uuid;
BEGIN
    IF NOT v_system THEN
        v_tenant := private.ai_reservation_tenant();
    END IF;
    DELETE FROM public.ai_quota_reservations r
     WHERE r.id = p_reservation
       AND (v_system OR (r.tenant_id = v_tenant AND r.created_by = v_uid));
    RETURN FOUND;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ai_release(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_release(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.ai_release(uuid) IS
    'AI-03 (05-10c, 05-12): drops the caller''s own reservation (or any, on the system path) without a unit.';

-- B. Clinic time zone -------------------------------------------------------------------------------------------------

-- An IANA zone name the database knows (case-insensitive, as tenant_local_date and Intl read it). Offsets ("+05:30"),
-- abbreviations that are not zone names ("IST"), blanks and unknown names are not.
CREATE FUNCTION private.is_iana_timezone(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT p_name IS NOT NULL
       AND (p_name = 'Asia/Kolkata'
            OR EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE lower(z.name) = lower(p_name)))
$$;
REVOKE EXECUTE ON FUNCTION private.is_iana_timezone(text) FROM PUBLIC, anon, authenticated, service_role;
-- Every role that may write `tenants` evaluates the CHECK with its own privileges.
GRANT EXECUTE ON FUNCTION private.is_iana_timezone(text) TO authenticated, service_role;
COMMENT ON FUNCTION private.is_iana_timezone(text) IS
    '05-12 (H-AITZ): true for an IANA zone name known to pg_timezone_names (CHECK tenants_timezone_iana).';

ALTER TABLE public.tenants
    ADD CONSTRAINT tenants_timezone_iana CHECK (private.is_iana_timezone(timezone)) NOT VALID;

CREATE FUNCTION private.tenants_timezone_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_role text;
BEGIN
    IF v_uid IS NOT NULL THEN
        SELECT m.role INTO v_role
          FROM public.memberships m
         WHERE m.tenant_id = NEW.id AND m.user_id = v_uid AND m.status = 'active';
    END IF;
    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, actor_type, action, entity_type, entity_id, metadata)
    VALUES (NEW.id, v_uid, coalesce(v_role, 'system'), CASE WHEN v_uid IS NULL THEN 'system' ELSE 'user' END,
            'clinic.timezone_changed', 'tenant', NEW.id,
            jsonb_build_object('from', OLD.timezone, 'to', NEW.timezone));
    RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.tenants_timezone_audit() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER tenants_timezone_audit
    AFTER UPDATE OF timezone ON public.tenants
    FOR EACH ROW
    WHEN (NEW.timezone IS DISTINCT FROM OLD.timezone)
    EXECUTE FUNCTION private.tenants_timezone_audit();

-- C. Cancelled delivery jobs ------------------------------------------------------------------------------------------

CREATE FUNCTION ops.delivery_job_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
BEGIN
    BEGIN
        v_id := (NEW.payload ->> CASE WHEN NEW.kind = 'message.send' THEN 'queue_id' ELSE 'delivery_id' END)::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RETURN NULL;
    END;
    IF v_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF NEW.kind = 'message.send' THEN
        -- Terminal `cancelled`: communication_queue_scrub_payload redacts the template params and metadata (PHI) on it.
        UPDATE public.communication_queue q
           SET status = 'cancelled',
               error_message = left('job_cancelled:' || coalesce(NEW.last_error, ''), 500),
               updated_at = now()
         WHERE q.id = v_id
           AND q.tenant_id IS NOT DISTINCT FROM NEW.tenant_id
           AND q.status IN ('pending', 'processing', 'failed');
    ELSE
        UPDATE public.webhook_delivery_queue w
           SET status = 'failed',
               last_error = left('job_cancelled:' || coalesce(NEW.last_error, ''), 200),
               updated_at = now()
         WHERE w.id = v_id
           AND w.tenant_id IS NOT DISTINCT FROM NEW.tenant_id
           AND (w.status IN ('pending', 'processing') OR (w.status = 'failed' AND w.last_error = 'outcome_unknown'));
    END IF;
    RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION ops.delivery_job_cancelled() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER jobs_delivery_cancelled
    AFTER UPDATE OF status ON ops.jobs
    FOR EACH ROW
    WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'
          AND NEW.kind IN ('message.send', 'webhook.deliver'))
    EXECUTE FUNCTION ops.delivery_job_cancelled();
COMMENT ON FUNCTION ops.delivery_job_cancelled() IS
    '05-12 (M-CANCEL): a cancelled message.send / webhook.deliver job closes its delivery row (communication_queue cancelled and redacted; webhook_delivery_queue failed), so backfill_delivery_jobs never re-enqueues it.';

-- Migrate: rows a cancelled job already left open, and open rows without a job in a clinic that is not full.
DO $$
DECLARE
    v_msg integer;
    v_wh integer;
BEGIN
    WITH c AS (
        UPDATE public.communication_queue q
           SET status = 'cancelled',
               error_message = left('job_cancelled:' || coalesce(j.last_error, ''), 500),
               updated_at = now()
          FROM ops.jobs j
         WHERE j.dedupe_key = 'msg:' || q.id::text
           AND j.status = 'cancelled'
           AND q.status IN ('pending', 'processing', 'failed')
        RETURNING 1
    ), o AS (
        UPDATE public.communication_queue q
           SET status = 'cancelled', error_message = 'job_cancelled:tenant_not_full', updated_at = now()
         WHERE q.status IN ('pending', 'failed')
           AND q.tenant_id IS NOT NULL
           AND billing_internal.tenant_access_level(q.tenant_id, now()) IS DISTINCT FROM 'full'
           AND NOT EXISTS (SELECT 1 FROM ops.jobs j WHERE j.dedupe_key = 'msg:' || q.id::text)
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM c) + (SELECT count(*) FROM o) INTO v_msg;

    WITH c AS (
        UPDATE public.webhook_delivery_queue w
           SET status = 'failed', last_error = left('job_cancelled:' || coalesce(j.last_error, ''), 200), updated_at = now()
          FROM ops.jobs j
         WHERE j.dedupe_key = 'wh:' || w.id::text
           AND j.status = 'cancelled'
           AND (w.status IN ('pending', 'processing') OR (w.status = 'failed' AND w.last_error = 'outcome_unknown'))
        RETURNING 1
    ), o AS (
        UPDATE public.webhook_delivery_queue w
           SET status = 'failed', last_error = 'job_cancelled:tenant_not_full', updated_at = now()
         WHERE (w.status = 'pending' OR (w.status = 'failed' AND w.last_error = 'outcome_unknown'))
           AND billing_internal.tenant_access_level(w.tenant_id, now()) IS DISTINCT FROM 'full'
           AND NOT EXISTS (SELECT 1 FROM ops.jobs j WHERE j.dedupe_key = 'wh:' || w.id::text)
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM c) + (SELECT count(*) FROM o) INTO v_wh;

    RAISE NOTICE '05-12 D12c: closed % communication_queue and % webhook_delivery_queue rows left open by cancelled jobs', v_msg, v_wh;
END;
$$;

-- D. Re-invite with another role ---------------------------------------------------------------------------------------

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
            RETURN jsonb_build_object('id', v_existing.id, 'expires_at', v_existing.expires_at, 'deduped', true);
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
        jsonb_build_object('role', p_role, 'token_version', v_row.token_version)
        || CASE WHEN v_replaced IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('replaced_role', v_replaced) END);

    RETURN jsonb_build_object('id', v_row.id, 'expires_at', v_row.expires_at, 'deduped', false)
        || CASE WHEN v_replaced IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('replaced_role', v_replaced) END;
END;
$function$;

-- E. remove_member: webhooks, and the owner of a locked clinic -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.remove_member(p_membership_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
DECLARE
    v_uid UUID := auth.uid();
    v_target public.memberships;
    v_caller_role TEXT;
    v_reason TEXT := NULLIF(btrim(p_reason), '');
    v_full UUID;
    v_active UUID;
    v_owners INTEGER;
    v_keys INTEGER;
    v_invites INTEGER;
    v_webhooks INTEGER;
    v_sessions INTEGER;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
    END IF;
    IF v_reason IS NULL OR char_length(v_reason) > 500 OR v_reason ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- The tenant comes from the target row and must be the caller's active clinic (R-42); anything else reads as "not
    -- found" (another clinic's membership ids are never confirmed). 05-12 (IND L-5): besides the full active clinic,
    -- the active clinic at level `locked` or `onboarding` when the caller is its active OWNER (a dismissed member must
    -- not regain access on renewal).
    v_full := (SELECT authz.full_tenant_ids() LIMIT 1);
    v_active := authz.active_tenant_id();
    SELECT * INTO v_target FROM public.memberships WHERE id = p_membership_id FOR UPDATE;
    IF NOT FOUND
       OR (v_target.tenant_id IS DISTINCT FROM v_full
           AND NOT (v_target.tenant_id = v_active
                    AND billing_internal.tenant_access_level(v_active, now()) IN ('locked', 'onboarding')
                    AND EXISTS (SELECT 1 FROM public.memberships o
                                 WHERE o.tenant_id = v_active AND o.user_id = v_uid
                                   AND o.status = 'active' AND o.role = 'owner'))) THEN
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

    -- 05-12 (IND L-3, ACC L-1): the member's webhook subscriptions in this clinic stop, and their signing secrets are
    -- replaced, so an endpoint the removed member controls receives nothing and the secret they knew verifies nothing.
    WITH w AS (
        UPDATE public.webhook_subscriptions
           SET is_active = false,
               signing_secret = 'whsec_' || encode(extensions.gen_random_bytes(24), 'hex'),
               updated_at = now()
         WHERE tenant_id = v_target.tenant_id AND created_by = v_target.user_id
        RETURNING 1
    )
    SELECT count(*) INTO v_webhooks FROM w;

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
            'webhooks_disabled', v_webhooks,
            'sessions_revoked', v_sessions
        )
    );

    RETURN jsonb_build_object(
        'user_id', v_target.user_id,
        'keys_revoked', v_keys,
        'invites_revoked', v_invites,
        'webhooks_disabled', v_webhooks,
        'sessions_revoked', v_sessions
    );
END;
$function$;

-- F. Referral target guard: an ACTIVE doctor -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.referrals_directory_consent_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_uid UUID := auth.uid();
    v_target_changed BOOLEAN;
    v_clinical BOOLEAN;
BEGIN
    -- a. Actor columns (user path).
    IF v_uid IS NOT NULL THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW.referring_doctor_id IS DISTINCT FROM v_uid
               OR (NEW.closed_by IS NOT NULL AND NEW.closed_by <> v_uid) THEN
                RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
            END IF;
        ELSIF NEW.referring_doctor_id IS DISTINCT FROM OLD.referring_doctor_id
              OR (NEW.closed_by IS DISTINCT FROM OLD.closed_by AND NEW.closed_by IS NOT NULL AND NEW.closed_by <> v_uid) THEN
            RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
        END IF;
    END IF;

    v_target_changed := TG_OP = 'INSERT'
        OR NEW.target_tenant_id IS DISTINCT FROM OLD.target_tenant_id
        OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id;

    -- d. A listed target clinic other than the referral's own (000062).
    IF NEW.target_tenant_id IS NOT NULL AND v_target_changed THEN
        IF NEW.target_tenant_id = NEW.tenant_id
           OR NOT EXISTS (
               SELECT 1
               FROM public.tenants t
               WHERE t.id = NEW.target_tenant_id
                 AND t.referral_directory_listed
           ) THEN
            RAISE EXCEPTION 'REFERRAL_TARGET_NOT_LISTED' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- b. The target doctor practises in the target clinic: an ACTIVE member there (05-12, IND L-7).
    IF NEW.target_doctor_id IS NOT NULL
       AND (v_target_changed OR NEW.target_doctor_id IS DISTINCT FROM OLD.target_doctor_id) THEN
        IF NEW.target_tenant_id IS NULL
           OR NOT EXISTS (
               SELECT 1
               FROM public.memberships m
               WHERE m.tenant_id = NEW.target_tenant_id
                 AND m.user_id = NEW.target_doctor_id
                 AND m.status = 'active'
                 AND authz.role_has_permission(m.role, 'consultations:edit')
           ) THEN
            RAISE EXCEPTION 'REFERRAL_TARGET_DOCTOR_INVALID' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- c. Consent covers every clinical field the target clinic reads.
    IF TG_OP = 'INSERT'
       OR v_target_changed
       OR NEW.patient_consents_history_sharing IS DISTINCT FROM OLD.patient_consents_history_sharing
       OR NEW.consented_history_snapshot IS DISTINCT FROM OLD.consented_history_snapshot
       OR NEW.clinical_summary IS DISTINCT FROM OLD.clinical_summary
       OR NEW.provisional_diagnosis IS DISTINCT FROM OLD.provisional_diagnosis
       OR NEW.active_medications_snapshot IS DISTINCT FROM OLD.active_medications_snapshot
       OR NEW.investigations_advised IS DISTINCT FROM OLD.investigations_advised THEN

        IF NEW.consented_history_snapshot IS NOT NULL
           AND jsonb_typeof(NEW.consented_history_snapshot) <> 'null'
           AND NEW.patient_consents_history_sharing IS NOT TRUE THEN
            RAISE EXCEPTION 'REFERRAL_CONSENT_REQUIRED' USING ERRCODE = 'P0001';
        END IF;

        v_clinical := NULLIF(btrim(NEW.clinical_summary), '') IS NOT NULL
            OR NULLIF(btrim(NEW.provisional_diagnosis), '') IS NOT NULL
            OR (NEW.active_medications_snapshot IS NOT NULL
                AND NEW.active_medications_snapshot NOT IN ('null'::jsonb, '[]'::jsonb, '{}'::jsonb))
            OR coalesce(cardinality(NEW.investigations_advised), 0) > 0;

        IF NEW.target_tenant_id IS NOT NULL AND v_clinical AND NEW.patient_consents_history_sharing IS NOT TRUE THEN
            RAISE EXCEPTION 'REFERRAL_CONSENT_REQUIRED' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

-- G. SUB-D6 verification metadata -------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_share_token(p_token text, p_kinds text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    t public.document_share_tokens;
    v_rid UUID;
    v_res JSONB;
    v_clinic JSONB;
    v_level TEXT;
    v_sub_status TEXT;
BEGIN
    IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 128 THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    SELECT * INTO t FROM public.document_share_tokens s
    WHERE s.token_hash = public.share_token_hash(p_token)
    FOR UPDATE;

    IF NOT FOUND
       OR t.resource_type NOT IN ('patient_document', 'prescription', 'invoice', 'referral')
       OR p_kinds IS NULL
       OR NOT (t.resource_type = ANY (p_kinds)) THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    -- 05-10a (SUB-02, SUB-D6): the clinic's access level decides before anything of the resource is read.
    v_level := billing_internal.tenant_access_level(t.tenant_id, now());
    IF v_level IS DISTINCT FROM 'full' THEN
        SELECT st.status INTO v_sub_status FROM public.tenant_subscriptions st WHERE st.tenant_id = t.tenant_id;
        -- An expired clinic's prescription resolves to verification metadata only (no file, no access count); nothing
        -- else of a non-full clinic resolves, and nothing at all from `archived` on.
        IF NOT (t.resource_type = 'prescription' AND v_sub_status = 'expired'
                AND t.revoked_at IS NULL AND t.expires_at > now()) THEN
            RETURN jsonb_build_object('status', 'clinic_unavailable');
        END IF;
        -- 05-12 (IND L-4): exactly SUB §7.2's set: clinic name, doctor name and registration number, issue date,
        -- "valid prescription". No patient name, title, file name, MIME type or file.
        SELECT jsonb_build_object(
                   'status', 'ok',
                   'restricted', true,
                   'access', v_level,
                   'resource_type', 'prescription',
                   'clinic', jsonb_build_object('name', c.name),
                   'verification', jsonb_build_object(
                       'valid', r.status = 'active',
                       'doctor_name', nullif(btrim(m.full_name), ''),
                       'doctor_registration_number', nullif(btrim(m.medical_council_reg_no), ''),
                       'issued_on', to_char(public.tenant_local_date(r.tenant_id, coalesce(r.signed_at, r.created_at)), 'YYYY-MM-DD')))
          INTO v_res
          FROM public.prescriptions r
          JOIN public.tenants c ON c.id = r.tenant_id
          LEFT JOIN public.memberships m ON m.tenant_id = r.tenant_id AND m.user_id = r.doctor_id
         WHERE r.id = t.resource_id AND r.tenant_id = t.tenant_id;
        RETURN coalesce(v_res, jsonb_build_object('status', 'not_found'));
    END IF;

    v_rid := COALESCE(t.resource_id, CASE WHEN t.resource_type = 'patient_document' THEN t.document_id END);

    SELECT jsonb_build_object('name', c.name, 'phone', c.phone, 'address', c.address, 'logo_url', c.logo_url)
    INTO v_clinic
    FROM public.tenants c
    WHERE c.id = t.tenant_id;

    IF t.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'revoked', 'clinic', v_clinic - 'address' - 'logo_url');
    END IF;

    IF t.expires_at <= now() THEN
        RETURN jsonb_build_object('status', 'expired', 'clinic', v_clinic - 'address' - 'logo_url');
    END IF;

    v_res := public.share_token_resource(t.tenant_id, t.resource_type, v_rid);
    IF v_res IS NULL THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    UPDATE public.document_share_tokens
    SET access_count = access_count + 1,
        last_accessed_at = now()
    WHERE id = t.id;

    RETURN (v_res - '_bucket' - '_storage_path') || jsonb_build_object(
        'status', 'ok',
        'access', v_level,
        'resource_type', t.resource_type,
        'expires_at', t.expires_at,
        'clinic', v_clinic
    );
END;
$function$;

-- H. Patient AI objection: audited; cleared only by a doctor or receptionist ----------------------------------------------

CREATE FUNCTION private.patients_ai_objection_audit()
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
        IF TG_OP = 'UPDATE' AND NOT NEW.ai_processing_objected
           AND v_role IS DISTINCT FROM 'doctor' AND v_role IS DISTINCT FROM 'receptionist' THEN
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
REVOKE EXECUTE ON FUNCTION private.patients_ai_objection_audit() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER patients_ai_objection_audit
    AFTER INSERT OR UPDATE OF ai_processing_objected ON public.patients
    FOR EACH ROW EXECUTE FUNCTION private.patients_ai_objection_audit();
