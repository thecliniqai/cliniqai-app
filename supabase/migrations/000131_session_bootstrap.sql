-- Migration: 000131_session_bootstrap.sql
-- V2-09e 09E-13 (R-13; decision 1, C-1; T-09E-10): the session bootstrap. What the signed-in shell shows for the whole session and holds in the browser's
-- memory (never on disk, never on the server between requests): who the user is, the clinic's name and zone, the role for display and navigation, the clinic's
-- doctor directory (names) and the Rx print display settings, with the `settings` version of the same statement (the live core re-reads it when a newer one
-- arrives). Planned as 000130; 000129 became the H-1 fix of reference_shard, so this file moved up by one (recorded in 09E-NOTES).
-- A new INVOKER read composed of tables the shell already read through the user's own client; no table, column, policy, trigger or grant change beyond EXECUTE.
--
-- public.session_bootstrap(p_tenant_id) returns one jsonb with EXACTLY these keys (an allow-list; pgTAP fails on any other key at any level):
--   profile   {id, full_name}: the caller (auth.uid()) and the display name of the caller's membership in p_tenant_id (NULL when none is set);
--   clinic    {id, name, zone}: zone is the database's own resolution of tenants.timezone (a case-insensitive IANA name), Asia/Kolkata when unset or unknown;
--   role      the caller's role in the clinic: for display and navigation only; every permission is decided by the server and the database on each request;
--   doctors   [{id, full_name, specialty}]: the clinic's bookable doctors, as every doctor picker lists them today (getActiveClinicDoctors, V2-08 R-2): active
--             doctors, and the owner when the owner practises; ordered by membership creation; a missing name reads "Doctor" ("Clinic Doctor" for the owner);
--   clinics   [{id, name}]: the caller's own active clinics (the shell's clinic switcher; the read the layout made before, so a full load makes no extra call);
--   rx_print  {paper_size, letterhead_mode, top_margin, bottom_margin}: the display fields of the clinic's prescription print settings (margins in points);
--   versions  {settings}: clinic_versions in the SAME snapshot as the rest (an exact basis for the live core).
-- NEVER in it (R-13's never-held list): fees or prices, invoices, payments, the subscription, the access level, entitlements, permissions, availability,
-- schedule blocks, slots, bookings, the queue. They are live data read from the database when used.
-- Gates: a session (auth.uid()) and an ACTIVE membership of the caller in p_tenant_id; NULL otherwise (another clinic, a forged or unknown tenant, a removed
-- member, no session, a NULL argument). RLS applies to every table it reads (SECURITY INVOKER). STABLE: one snapshot for every part.
-- Per-migration checklist: one new public function (STABLE INVOKER, search_path '', EXECUTE for authenticated only). No table, column, policy, trigger or data change.

CREATE FUNCTION public.session_bootstrap(p_tenant_id uuid)
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
    'V2-09e 09E-13 (R-13): the session bootstrap of one of the caller''s own clinics: {profile, clinic, role, doctors, clinics, rx_print, versions{settings}} from one statement; NULL unless the caller is an active member. Display data only: no fee, invoice, payment, subscription, access, entitlement or permission. INVOKER.';
