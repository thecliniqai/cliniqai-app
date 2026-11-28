-- Migration: 000133_review_fixes_09e_pr2.sql
-- V2-09e 09E PR 2 review fixes adversarial N4 and independent N-7. Expand-safe: one function body, one trigger function and its triggers; no table, column,
-- policy or data change.
-- 1. (N4) public.session_bootstrap answers only for the session's active clinic with full access (authz.full_tenant_ids, the gate of has_permission), as the
--    route already did: a member of a locked or onboarding clinic, or of another of their clinics than the session's, gets NULL. Otherwise unchanged.
-- 2. (N-7) The reference catalogue versions move only when a statement changed a row. The statement triggers of 000128 fired for every statement, also one
--    that changed nothing (an `UPDATE ... WHERE false`, an upsert of identical rows), which made every device download the catalogue again (~1.5 MB).
--    Each of the five tables now has four AFTER statement triggers (INSERT with its new rows, UPDATE with its old and new rows, DELETE with its old rows,
--    TRUNCATE), all on private.reference_catalogue_bump (same signature, definer, search_path '', no API grant): an insert or delete moves the version when
--    it touched a row, an update when a row's value differs (old and new compared as whole rows), a truncate always.
-- Per-migration checklist: one INVOKER read replaced (same signature, grant and comment restated), one definer trigger function replaced (same signature,
-- no API grant, comment restated), five statement triggers replaced by twenty. No table, column, policy or data change.

-- 1. The session bootstrap answers for the session's active, full clinic only -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.session_bootstrap(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_role text;
    v_name text;
    v_tenant record;
    v_zone text;
    v_doctors jsonb;
    v_clinics jsonb;
    v_settings bigint;
BEGIN
    IF v_uid IS NULL OR p_tenant_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT m.role::text, m.full_name INTO v_role, v_name
      FROM public.memberships m
     WHERE m.tenant_id = p_tenant_id AND m.user_id = v_uid AND m.status = 'active';
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    -- 000132 (adversarial N4): the same gate as public.has_permission: p_tenant_id must be the session's ACTIVE clinic (authz.active_tenant_id, the
    -- x-clinicos-tenant header) with full access. A member of a locked, onboarding or other (not the session's) clinic gets NULL, as the route answers.
    IF NOT EXISTS (SELECT 1 FROM authz.full_tenant_ids() f WHERE f = p_tenant_id) THEN
        RETURN NULL;
    END IF;

    SELECT t.id, t.name, t.timezone, t.owner_is_practicing_doctor, t.rx_paper_size, t.rx_letterhead_mode,
           t.letterhead_top_margin, t.letterhead_bottom_margin
      INTO v_tenant
      FROM public.tenants t
     WHERE t.id = p_tenant_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    -- The database's own resolution of the stored zone (case-insensitive IANA name, else Asia/Kolkata), as today_board and schedule_range read it.
    SELECT z.name INTO v_zone FROM pg_catalog.pg_timezone_names z WHERE lower(z.name) = lower(v_tenant.timezone) ORDER BY z.name LIMIT 1;
    v_zone := coalesce(v_zone, 'Asia/Kolkata');

    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', m.user_id,
               'full_name', coalesce(nullif(btrim(m.full_name), ''), CASE WHEN m.role = 'doctor' THEN 'Doctor' ELSE 'Clinic Doctor' END),
               'specialty', nullif(btrim(m.default_specialty), '')
           ) ORDER BY m.created_at, m.user_id), '[]'::jsonb)
      INTO v_doctors
      FROM public.memberships m
     WHERE m.tenant_id = p_tenant_id
       AND m.status = 'active'
       AND (m.role = 'doctor' OR (m.role = 'owner' AND coalesce(v_tenant.owner_is_practicing_doctor, true)));

    SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) ORDER BY t.id), '[]'::jsonb)
      INTO v_clinics
      FROM public.memberships m
      JOIN public.tenants t ON t.id = m.tenant_id
     WHERE m.user_id = v_uid AND m.status = 'active';

    SELECT cv.version INTO v_settings FROM public.clinic_versions cv WHERE cv.tenant_id = p_tenant_id AND cv.domain = 'settings';

    RETURN jsonb_build_object(
        'profile', jsonb_build_object('id', v_uid, 'full_name', nullif(btrim(v_name), '')),
        'clinic', jsonb_build_object('id', v_tenant.id, 'name', v_tenant.name, 'zone', v_zone),
        'role', v_role,
        'doctors', v_doctors,
        'clinics', v_clinics,
        'rx_print', jsonb_build_object(
            'paper_size', v_tenant.rx_paper_size,
            'letterhead_mode', v_tenant.rx_letterhead_mode,
            'top_margin', v_tenant.letterhead_top_margin,
            'bottom_margin', v_tenant.letterhead_bottom_margin),
        'versions', jsonb_build_object('settings', coalesce(v_settings, 0)));
END;
$$;

REVOKE ALL ON FUNCTION public.session_bootstrap(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.session_bootstrap(uuid) TO authenticated;
COMMENT ON FUNCTION public.session_bootstrap(uuid) IS
    'V2-09e 09E-13 (R-13), 000132 (N4): the session bootstrap of the session''s active, full clinic: {profile, clinic, role, doctors, clinics, rx_print, versions{settings}} from one statement; NULL unless the caller is an active member and the clinic is authz.full_tenant_ids (the gate of has_permission). Display data only: no fee, invoice, payment, subscription, access, entitlement or permission. INVOKER.';

-- 2. The reference catalogue versions move on a changed row only ---------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.reference_catalogue_bump()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Each branch reads only the transition tables its own trigger declares (plpgsql plans a statement when it first runs it).
    IF TG_OP = 'INSERT' THEN
        IF NOT EXISTS (SELECT 1 FROM new_rows) THEN
            RETURN NULL;
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        IF NOT EXISTS (SELECT 1 FROM old_rows) THEN
            RETURN NULL;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Whole rows compared as jsonb (every column type has a jsonb form with equality): an update that wrote the values already there moves nothing.
        IF NOT EXISTS (SELECT to_jsonb(n) FROM new_rows n EXCEPT SELECT to_jsonb(o) FROM old_rows o) THEN
            RETURN NULL;
        END IF;
    END IF;
    UPDATE public.reference_catalogues
       SET version = gen_random_uuid(), changed_at = now()
     WHERE catalogue = TG_ARGV[0];
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.reference_catalogue_bump() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.reference_catalogue_bump() IS
    'V2-09e 09E-09 (R-5), 000132 (N-7): statement trigger on the catalogue tables: a new random version and now() for the catalogue named by the trigger argument (cdci or diagnoses) when the statement inserted, deleted or changed a row, or truncated the table. No API grant.';

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT * FROM (VALUES
                ('cdci_substances', 'cdci'), ('cdci_generics', 'cdci'), ('cdci_brands', 'cdci'),
                ('cdci_medicines_search', 'cdci'), ('opd_diagnoses', 'diagnoses')) AS t(tbl, catalogue) LOOP
        EXECUTE format('DROP TRIGGER %I ON public.%I', r.tbl || '_reference_bump', r.tbl);
        EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON public.%I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.reference_catalogue_bump(%L)',
                       r.tbl || '_reference_bump_insert', r.tbl, r.catalogue);
        EXECUTE format('CREATE TRIGGER %I AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.reference_catalogue_bump(%L)',
                       r.tbl || '_reference_bump_update', r.tbl, r.catalogue);
        EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON public.%I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION private.reference_catalogue_bump(%L)',
                       r.tbl || '_reference_bump_delete', r.tbl, r.catalogue);
        EXECUTE format('CREATE TRIGGER %I AFTER TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION private.reference_catalogue_bump(%L)',
                       r.tbl || '_reference_bump_truncate', r.tbl, r.catalogue);
    END LOOP;
END;
$$;
