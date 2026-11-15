-- Migration: 000091_ai_gating.sql
-- V2-05 plan 05-10c (AI-03 database part, AI-06 L2 database part; AI_STRATEGY §4.6, C48, PO-21, PO-25; rulings R-33,
-- R-42; acceptance 13 gating half; threats T-05-37, T-05-38).
--
-- Every AI call (V2-12's gateway, AI-04) asks the database first; the app cannot skip a check because the checks and
-- the quota live in SECURITY DEFINER functions over tables no API role can write.
--
-- 1. `public.tenant_ai_settings` (tenant_id PK): the owner's opt-in (`enabled`, default false) with the accepted AI terms
--    version, who accepted and when. SELECT `clinic:view` of the active clinic (R-40); no DML grant for any API role:
--    written only by `set_ai_opt_in` (owner only, R-33).
-- 2. `public.patients.ai_processing_objected` (default false) + `objected_at` + `objection_recorded_by`, stamped by the
--    BEFORE INSERT/UPDATE trigger `patients_ai_objection_stamp` from the flag and `auth.uid()` (a caller cannot write
--    the stamp columns: they are recomputed on every write). The flag follows the patient policies (`patients:edit`,
--    AI §4.6 "editable by doctor or receptionist").
-- 3. `public.ai_usage_monthly` (tenant_id, period, feature, units) and `public.ai_quota_reservations` (id, tenant_id,
--    feature, period, created_at, expires_at): RLS on, no tenant access, no API-role grant (AI §4.6 "write protection").
-- 4. `private.ai_gate(p_feature, p_visit_id)` (internal, invoker; no API grant) — the AI-06 L2 gating contract, in
--    this order (05-PLAN 05-10c):
--      unknown feature (not a boolean `ai.*` entitlement key)                         → raises AI_FEATURE_UNKNOWN
--      no session, unknown visit, or the visit's clinic is not the active clinic (R-42) → forbidden
--      the clinic's access level is not `full`                                         → locked
--      the caller's active role lacks `consultations:edit`                             → forbidden
--      `platform_settings.ai_features ->> p_feature` is not true (kill switch; absent = off) → killed
--      `billing_internal.has_entitlement(clinic, p_feature, now())` is false           → not_entitled
--      the clinic's opt-in is off (or no row)                                          → not_opted_in
--      the visit's patient objected                                                    → patient_objected
--      units + live reservations ≥ entitlement_limit(clinic, p_feature || '.monthly_drafts') → over_quota
--      else                                                                            → ok
--    The period is `'trial:' || <trial start, clinic-local date>` while the subscription is `trialing` (PO-21: 1,500
--    drafts over the whole trial), else the clinic-local month `YYYY-MM` (`public.tenant_local_date`, 05-08; Asia/Kolkata
--    by default). Tenant and patient come from the visit (V2-04 R-6 pattern), never from the caller.
-- 5. `public.ai_preflight(p_feature, p_visit_id) → text`: the code above (no side effect).
--    `public.ai_reserve(p_feature, p_visit_id, p_timeout_s) → uuid`: the same checks, then the usage row is locked
--    (`INSERT … ON CONFLICT DO NOTHING`, then `SELECT … FOR UPDATE`), only reservations with `expires_at > now()` are
--    counted, and a reservation expiring at now() + clamp(p_timeout_s, 10, 300) s + 30 s is inserted; any code other
--    than ok raises `AI_<CODE>` (P0001; lib/db/errors.ts RPC_REASON_CODES). Two parallel calls at limit − 1 give one
--    reservation and one AI_OVER_QUOTA.
--    `public.ai_commit(p_reservation) → integer`: deletes the caller's clinic's reservation and adds exactly 1 unit to
--    its period (returns the new units); `public.ai_release(p_reservation) → boolean`: deletes it, no unit. Both need
--    `consultations:edit` in the active clinic, at any access level (a call that started before a lock is still
--    metered); a reservation of another clinic is not found (P0002 AI_RESERVATION_NOT_FOUND). Expired reservations stop
--    counting at `expires_at`; their cleanup job is V2-12 (R-33).
--    `public.set_ai_opt_in(p_tenant, p_enabled, p_terms_version) → tenant_ai_settings`: owner of the active clinic at
--    access level `full` only (42501 AI_OPT_IN_OWNER_ONLY otherwise; a locked clinic reads as another clinic, 05-10a);
--    enabling needs a terms version (AI_TERMS_VERSION_INVALID); stamps accepted_by = auth.uid(), accepted_at = now()
--    on enable (kept on disable); one audit row per change (`ai.opt_in.enabled` / `ai.opt_in.disabled`).
--    All five: SECURITY DEFINER, `search_path = ''`, `lock_timeout` 5 s where a lock is taken, EXECUTE for
--    `authenticated` only. Env `AI_ENABLED` stays app-side (V2-12).
-- Expand-only: new tables, nullable/defaulted columns, new functions. No data change.

-- 1. tenant_ai_settings -------------------------------------------------------------------------------------------------
CREATE TABLE public.tenant_ai_settings (
    tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
    enabled boolean NOT NULL DEFAULT false,
    accepted_terms_version text CHECK (accepted_terms_version IS NULL OR accepted_terms_version ~ '^[A-Za-z0-9._-]{1,40}$'),
    accepted_by uuid REFERENCES auth.users (id),
    accepted_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tenant_ai_settings_enabled_needs_acceptance
        CHECK (NOT enabled OR (accepted_terms_version IS NOT NULL AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL))
);
CREATE INDEX idx_tenant_ai_settings_accepted_by ON public.tenant_ai_settings (accepted_by);
COMMENT ON TABLE public.tenant_ai_settings IS
    'AI-03 owner opt-in per clinic (AI §4.6, C48): off by default; written only by set_ai_opt_in (owner, R-33); SELECT clinic:view.';

ALTER TABLE public.tenant_ai_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tenant_ai_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tenant_ai_settings TO authenticated;
CREATE POLICY tenant_ai_settings_select ON public.tenant_ai_settings
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('clinic:view')));

-- 2. patients: AI processing objection -----------------------------------------------------------------------------------
ALTER TABLE public.patients
    ADD COLUMN ai_processing_objected boolean NOT NULL DEFAULT false,
    ADD COLUMN objected_at timestamptz,
    ADD COLUMN objection_recorded_by uuid REFERENCES auth.users (id);
ALTER TABLE public.patients
    ADD CONSTRAINT patients_ai_objection_stamped CHECK (ai_processing_objected = (objected_at IS NOT NULL));
CREATE INDEX idx_patients_objection_recorded_by ON public.patients (objection_recorded_by);
COMMENT ON COLUMN public.patients.ai_processing_objected IS
    'AI-03 (AI §4.6): the patient objected to AI processing; ai_preflight/ai_reserve refuse their visits (patient_objected).';

CREATE FUNCTION private.patients_ai_objection_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' OR NEW.ai_processing_objected IS DISTINCT FROM OLD.ai_processing_objected THEN
        NEW.objected_at := CASE WHEN NEW.ai_processing_objected THEN now() ELSE NULL END;
        NEW.objection_recorded_by := CASE
            WHEN TG_OP = 'INSERT' AND NOT NEW.ai_processing_objected THEN NULL
            ELSE (SELECT auth.uid()) END;
    ELSE
        -- The stamp columns are derived: a write that does not change the flag keeps them.
        NEW.objected_at := OLD.objected_at;
        NEW.objection_recorded_by := OLD.objection_recorded_by;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.patients_ai_objection_stamp() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER patients_ai_objection_stamp
    BEFORE INSERT OR UPDATE ON public.patients
    FOR EACH ROW EXECUTE FUNCTION private.patients_ai_objection_stamp();

-- 3. usage and reservations ----------------------------------------------------------------------------------------------
CREATE TABLE public.ai_usage_monthly (
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    period text NOT NULL CHECK (period ~ '^(trial:[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{4}-[0-9]{2})$'),
    feature text NOT NULL CHECK (feature ~ '^ai\.[a-z0-9_.]{1,60}$'),
    units integer NOT NULL DEFAULT 0 CHECK (units >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, period, feature)
);
COMMENT ON TABLE public.ai_usage_monthly IS
    'AI-03 metered units per clinic, period (trial:<start> or the clinic month) and feature (AI §4.6). No API-role access; written by ai_reserve/ai_commit.';

CREATE TABLE public.ai_quota_reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    feature text NOT NULL CHECK (feature ~ '^ai\.[a-z0-9_.]{1,60}$'),
    period text NOT NULL CHECK (period ~ '^(trial:[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{4}-[0-9]{2})$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    CONSTRAINT ai_quota_reservations_expiry CHECK (expires_at > created_at)
);
CREATE INDEX idx_ai_quota_reservations_live ON public.ai_quota_reservations (tenant_id, feature, period, expires_at);
COMMENT ON TABLE public.ai_quota_reservations IS
    'AI-03 in-flight AI calls (AI §4.6): count against the quota until expires_at (call timeout + 30 s). No API-role access; cleanup job V2-12 (R-33).';

ALTER TABLE public.ai_usage_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_quota_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_usage_monthly, public.ai_quota_reservations FROM PUBLIC, anon, authenticated;
-- No policy: no tenant role reads or writes either table.

-- 4. the gate (internal) -------------------------------------------------------------------------------------------------
CREATE FUNCTION private.ai_gate(
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
    v_status text;
    v_trial_start timestamptz;
    v_units bigint;
    v_live bigint;
BEGIN
    IF p_feature IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.entitlement_keys k WHERE k.key = p_feature AND k.kind = 'boolean' AND k.key LIKE 'ai.%'
    ) THEN
        RAISE EXCEPTION 'AI_FEATURE_UNKNOWN' USING ERRCODE = 'P0001';
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

    SELECT s.status, s.trial_start INTO v_status, v_trial_start
      FROM public.tenant_subscriptions s WHERE s.tenant_id = r_tenant;
    r_period := CASE
        WHEN v_status = 'trialing' AND v_trial_start IS NOT NULL
            THEN 'trial:' || to_char(public.tenant_local_date(r_tenant, v_trial_start), 'YYYY-MM-DD')
        ELSE to_char(public.tenant_local_date(r_tenant, now()), 'YYYY-MM') END;
    r_limit := coalesce(billing_internal.entitlement_limit(r_tenant, p_feature || '.monthly_drafts', now()), 0);

    SELECT coalesce((SELECT u.units FROM public.ai_usage_monthly u
                      WHERE u.tenant_id = r_tenant AND u.period = r_period AND u.feature = p_feature), 0)
      INTO v_units;
    SELECT count(*) INTO v_live
      FROM public.ai_quota_reservations r
     WHERE r.tenant_id = r_tenant AND r.feature = p_feature AND r.period = r_period AND r.expires_at > now();
    r_code := CASE WHEN v_units + v_live >= r_limit THEN 'over_quota' ELSE 'ok' END;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.ai_gate(text, uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.ai_gate(text, uuid) IS
    'AI-06 L2 gating contract (05-10c): forbidden, locked, forbidden (role), killed, not_entitled, not_opted_in, patient_objected, over_quota, ok. Internal: called by ai_preflight/ai_reserve only.';

-- 5. public functions ------------------------------------------------------------------------------------------------
CREATE FUNCTION public.ai_preflight(p_feature text, p_visit_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN (SELECT g.r_code FROM private.ai_gate(p_feature, p_visit_id) g);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ai_preflight(text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_preflight(text, uuid) TO authenticated;
COMMENT ON FUNCTION public.ai_preflight(text, uuid) IS
    'AI-03 (05-10c): the gating code for an AI feature on a visit of the active clinic (private.ai_gate); no side effect.';

CREATE FUNCTION public.ai_reserve(p_feature text, p_visit_id uuid, p_timeout_s integer)
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

    INSERT INTO public.ai_quota_reservations (tenant_id, feature, period, expires_at)
    VALUES (v_gate.r_tenant, p_feature, v_gate.r_period, now() + make_interval(secs => v_timeout + 30))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ai_reserve(text, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_reserve(text, uuid, integer) TO authenticated;
COMMENT ON FUNCTION public.ai_reserve(text, uuid, integer) IS
    'AI-03 (05-10c): the gate, then a quota reservation under the usage row lock; raises AI_<CODE> otherwise.';

-- The caller's clinic and role for commit/release: the active clinic (any access level) with consultations:edit.
CREATE FUNCTION private.ai_reservation_tenant()
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_tenant uuid := authz.active_tenant_id();
    v_role text;
BEGIN
    IF v_uid IS NOT NULL AND v_tenant IS NOT NULL THEN
        SELECT m.role INTO v_role
          FROM public.memberships m
         WHERE m.tenant_id = v_tenant AND m.user_id = v_uid AND m.status = 'active';
    END IF;
    IF v_role IS NULL OR NOT authz.role_has_permission(v_role, 'consultations:edit') THEN
        RAISE EXCEPTION 'AI_FORBIDDEN' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_tenant;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.ai_reservation_tenant() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.ai_commit(p_reservation uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
    v_tenant uuid := private.ai_reservation_tenant();
    v_feature text;
    v_period text;
    v_units integer;
BEGIN
    DELETE FROM public.ai_quota_reservations r
     WHERE r.id = p_reservation AND r.tenant_id = v_tenant
    RETURNING r.feature, r.period INTO v_feature, v_period;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'AI_RESERVATION_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO public.ai_usage_monthly AS u (tenant_id, period, feature, units)
    VALUES (v_tenant, v_period, v_feature, 1)
    ON CONFLICT (tenant_id, period, feature) DO UPDATE SET units = u.units + 1, updated_at = now()
    RETURNING u.units INTO v_units;
    RETURN v_units;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ai_commit(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_commit(uuid) TO authenticated;
COMMENT ON FUNCTION public.ai_commit(uuid) IS
    'AI-03 (05-10c): the caller''s clinic''s reservation becomes exactly one used unit of its period.';

CREATE FUNCTION public.ai_release(p_reservation uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid := private.ai_reservation_tenant();
BEGIN
    DELETE FROM public.ai_quota_reservations r WHERE r.id = p_reservation AND r.tenant_id = v_tenant;
    RETURN FOUND;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ai_release(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_release(uuid) TO authenticated;
COMMENT ON FUNCTION public.ai_release(uuid) IS
    'AI-03 (05-10c): drops the caller''s clinic''s reservation without a unit (a failed or cancelled call).';

CREATE FUNCTION public.set_ai_opt_in(p_tenant uuid, p_enabled boolean, p_terms_version text)
RETURNS public.tenant_ai_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_role text;
    v_row public.tenant_ai_settings;
BEGIN
    -- Owner of the ACTIVE clinic at full access (R-33, R-42): a locked clinic reads as another clinic (05-10a).
    IF v_uid IS NULL OR p_tenant IS NULL OR p_tenant IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'AI_OPT_IN_OWNER_ONLY' USING ERRCODE = '42501';
    END IF;
    SELECT m.role INTO v_role
      FROM public.memberships m
     WHERE m.tenant_id = p_tenant AND m.user_id = v_uid AND m.status = 'active';
    IF v_role IS DISTINCT FROM 'owner' THEN
        RAISE EXCEPTION 'AI_OPT_IN_OWNER_ONLY' USING ERRCODE = '42501';
    END IF;
    IF p_enabled IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_enabled AND (p_terms_version IS NULL OR p_terms_version !~ '^[A-Za-z0-9._-]{1,40}$') THEN
        RAISE EXCEPTION 'AI_TERMS_VERSION_INVALID' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.tenant_ai_settings AS s (tenant_id, enabled, accepted_terms_version, accepted_by, accepted_at, updated_at)
    VALUES (p_tenant, p_enabled,
            CASE WHEN p_enabled THEN p_terms_version END,
            CASE WHEN p_enabled THEN v_uid END,
            CASE WHEN p_enabled THEN now() END,
            now())
    ON CONFLICT (tenant_id) DO UPDATE SET
        enabled = excluded.enabled,
        accepted_terms_version = CASE WHEN excluded.enabled THEN excluded.accepted_terms_version ELSE s.accepted_terms_version END,
        accepted_by = CASE WHEN excluded.enabled THEN excluded.accepted_by ELSE s.accepted_by END,
        accepted_at = CASE WHEN excluded.enabled THEN excluded.accepted_at ELSE s.accepted_at END,
        updated_at = now()
    RETURNING s.* INTO v_row;

    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, entity_type, entity_id, metadata)
    VALUES (p_tenant, v_uid, v_role,
            CASE WHEN p_enabled THEN 'ai.opt_in.enabled' ELSE 'ai.opt_in.disabled' END,
            'tenant_ai_settings', p_tenant,
            CASE WHEN p_enabled THEN jsonb_build_object('terms_version', p_terms_version) ELSE '{}'::jsonb END);

    RETURN v_row;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_ai_opt_in(uuid, boolean, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_ai_opt_in(uuid, boolean, text) TO authenticated;
COMMENT ON FUNCTION public.set_ai_opt_in(uuid, boolean, text) IS
    'AI-03 owner opt-in (05-10c, R-33): owner of the active, full clinic only; enabling records the accepted terms version, who and when; audited.';
