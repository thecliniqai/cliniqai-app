-- Migration: 000062_referrals_directory_consent.sql
-- V2-05 plan 05-06 (P1-10, P1-11; rulings R-13, R-35, R-42; threats T-05-18, T-05-19).
--
-- 1. `tenants.referral_directory_listed` (boolean, default false): a clinic's opt-in to receive in-network referrals.
--    Set by `clinic:manage` through the existing `tenants_update` policy (000057); no UI before V2-11 (runbook
--    `docs/runbooks/referral-directory.md`). Existing clinics start unlisted.
-- 2. `private.referrals_directory_consent_guard` (BEFORE INSERT/UPDATE trigger on `referrals`, every writer including
--    the service role and `postgres`):
--      - a non-null `target_tenant_id` must name a listed clinic other than the referral's own, else P0001
--        REFERRAL_TARGET_NOT_LISTED (on UPDATE only when the target or the originating clinic changes, so a clinic
--        that leaves the directory does not freeze referrals it already received);
--      - a non-null `consented_history_snapshot` needs `patient_consents_history_sharing = true`, else P0001
--        REFERRAL_CONSENT_REQUIRED.
--    SECURITY DEFINER because the sender cannot read the target's `tenants` row under RLS (member helper); it reads
--    one boolean and returns NEW unchanged. No API role may execute it (a trigger function needs no EXECUTE grant at
--    fire time). The receiver-column guard `referrals_target_update_guard` (000021/000054) is unchanged.
-- 3. `public.referral_directory_search(p_query)`: SECURITY DEFINER, `id` and `name` of listed clinics only, at most 20,
--    never the caller's own clinic; callers need `consultations:edit` in the active clinic (R-42), else 42501. A query
--    shorter than 2 characters returns nothing (search, not a browsable list); LIKE wildcards in the query are literal.
-- 4. `api_keys.scopes` (text[], default empty, closed set {'exports:create'}): the `/api/v1` export route requires the
--    `exports:create` scope on the key (keys without it get 403; P1-11). Set by `clinic:manage` through the existing
--    `api_keys_update` policy. Existing keys get no scope.
-- Per-migration checklist: no new table; the new function revokes PUBLIC/anon and grants authenticated only; the
-- trigger function grants nothing; search_path '' and fully qualified names; machine reasons registered in
-- `lib/db/errors.ts` RPC_REASON_CODES. No data is changed.

-- 1. Directory opt-in -------------------------------------------------------------------------------------------------
ALTER TABLE public.tenants
    ADD COLUMN referral_directory_listed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenants.referral_directory_listed IS
    'Opt-in: the clinic may be the target of in-network referrals (V2-05 05-06). Set by clinic:manage.';

-- 2. Target and consent guard -----------------------------------------------------------------------------------------
CREATE FUNCTION private.referrals_directory_consent_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.target_tenant_id IS NOT NULL
       AND (TG_OP = 'INSERT'
            OR NEW.target_tenant_id IS DISTINCT FROM OLD.target_tenant_id
            OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
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

    IF NEW.consented_history_snapshot IS NOT NULL
       AND jsonb_typeof(NEW.consented_history_snapshot) <> 'null'
       AND NEW.patient_consents_history_sharing IS NOT TRUE THEN
        RAISE EXCEPTION 'REFERRAL_CONSENT_REQUIRED' USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.referrals_directory_consent_guard() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER referrals_directory_consent_guard
BEFORE INSERT OR UPDATE OF target_tenant_id, tenant_id, consented_history_snapshot, patient_consents_history_sharing
ON public.referrals
FOR EACH ROW
EXECUTE FUNCTION private.referrals_directory_consent_guard();

-- 3. Directory search -------------------------------------------------------------------------------------------------
CREATE FUNCTION public.referral_directory_search(p_query TEXT)
RETURNS TABLE (id UUID, name TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_active UUID;
    v_query TEXT := left(btrim(coalesce(p_query, '')), 100);
    v_pattern TEXT;
BEGIN
    SELECT x INTO v_active FROM authz.tenant_ids_with('consultations:edit') AS x LIMIT 1;
    IF v_active IS NULL THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    IF char_length(v_query) < 2 THEN
        RETURN;
    END IF;

    v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

    RETURN QUERY
    SELECT t.id, t.name
    FROM public.tenants t
    WHERE t.referral_directory_listed
      AND t.id <> v_active
      AND t.name ILIKE v_pattern ESCAPE '\'
    ORDER BY t.name, t.id
    LIMIT 20;
END;
$$;

REVOKE ALL ON FUNCTION public.referral_directory_search(TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.referral_directory_search(TEXT) TO authenticated;

-- 4. API key scopes ---------------------------------------------------------------------------------------------------
ALTER TABLE public.api_keys
    ADD COLUMN scopes TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    ADD CONSTRAINT api_keys_scopes_known CHECK (scopes <@ ARRAY['exports:create']::TEXT[]);

COMMENT ON COLUMN public.api_keys.scopes IS
    'Extra capabilities of the key beyond the default register access (V2-05 05-06): exports:create allows the /api/v1 patient export.';
