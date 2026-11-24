-- Migration: 000125_today_board.sql
-- V2-09e 09E-06 (R-9, R-12): Today's board in one read. A new INVOKER read composed of tables the board already read through the user's own client;
-- no table, column, policy, trigger or grant change beyond EXECUTE.
--
-- public.today_board(p_tenant_id, p_mode, p_doctor_id, p_date) returns one jsonb with what the board page and GET /api/today/board used to read in seven or
-- more calls (the clinic's zone and versions, the day's visits with patient, token and vitals, the invoices and payments of the completed ones, the follow-ups
-- and their booked state, the clinic's doctors):
--   time_zone  the clinic's stored zone text (the application resolves it exactly as before; the day below uses the database's own resolution);
--   versions   {schedule, queue, billing, settings} of clinic_versions in the SAME snapshot as the visits (an exact basis for the live core, not a lower bound);
--   doctors    [{id, full_name}] of the clinic's doctors (role doctor, or the owner when practising), active or not, so a past visit still names its doctor;
--   visits     the clinic day's visits (clinic-local day: a booking by its appointment time, a walk-in by its creation time), each with the fields a row shows
--              and its row_version: patient {full_name, phone, sex, age, date_of_birth}, has_allergy (a flag, never the allergen names), token {number, priority,
--              created_at}, vitals, invoice {total, paid, row_version} and follow_up {date, booked}.
-- Gates (the page's own, applied in the statement): appointments:view for the whole read (NULL otherwise: another clinic, a forged tenant, a role without it, no
-- session, an unknown mode); allergy flag only with vitals:view or consultations:view; vitals only with consultations:view; the invoice part only with
-- billing:view and only for a completed visit; the follow-up part only with appointments:edit and only for a completed visit. RLS still applies to every
-- table it reads (SECURITY INVOKER). Mode 'doctor' lists only one doctor's visits: p_doctor_id, or the caller when none is given. p_date (a clinic date) is for
-- tests and other days; the caller's reach is the same as on any other day (appointments:view over the clinic's visits). STABLE: one snapshot for every part.
-- Per-migration checklist: one new public function (STABLE INVOKER, search_path '', EXECUTE for authenticated only). No table, column, policy, trigger or data change.

CREATE FUNCTION public.today_board(p_tenant_id uuid, p_mode text, p_doctor_id uuid DEFAULT NULL, p_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_tz text;
    v_zone text;
    v_day date;
    v_start timestamptz;
    v_end timestamptz;
    v_doctor uuid;
    v_allergies boolean;
    v_vitals boolean;
    v_billing boolean;
    v_follow boolean;
    v_versions jsonb;
    v_doctors jsonb;
    v_visits jsonb;
BEGIN
    IF v_uid IS NULL OR p_tenant_id IS NULL OR p_mode IS NULL OR p_mode NOT IN ('front', 'triage', 'doctor') THEN
        RETURN NULL;
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'appointments:view') THEN
        RETURN NULL;
    END IF;

    SELECT t.timezone INTO v_tz FROM public.tenants t WHERE t.id = p_tenant_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    -- The database's own resolution of the stored zone (case-insensitive IANA name, else Asia/Kolkata), as tenant_local_date reads it.
    SELECT z.name INTO v_zone FROM pg_catalog.pg_timezone_names z WHERE lower(z.name) = lower(v_tz) ORDER BY z.name LIMIT 1;
    v_zone := coalesce(v_zone, 'Asia/Kolkata');
    v_day := coalesce(p_date, (now() AT TIME ZONE v_zone)::date);
    v_start := v_day::timestamp AT TIME ZONE v_zone;
    v_end := (v_day + 1)::timestamp AT TIME ZONE v_zone;

    v_doctor := CASE WHEN p_doctor_id IS NOT NULL THEN p_doctor_id WHEN p_mode = 'doctor' THEN v_uid END;
    v_allergies := public.has_permission(p_tenant_id, 'vitals:view') OR public.has_permission(p_tenant_id, 'consultations:view');
    v_vitals := public.has_permission(p_tenant_id, 'consultations:view');
    v_billing := public.has_permission(p_tenant_id, 'billing:view');
    v_follow := public.has_permission(p_tenant_id, 'appointments:edit');

    SELECT CASE WHEN count(*) = 4 THEN jsonb_object_agg(cv.domain, cv.version) END
      INTO v_versions
      FROM public.clinic_versions cv
     WHERE cv.tenant_id = p_tenant_id;

    SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.user_id, 'full_name', d.full_name) ORDER BY d.created_at, d.id), '[]'::jsonb)
      INTO v_doctors
      FROM public.memberships d
     WHERE d.tenant_id = p_tenant_id
       AND (d.role = 'doctor' OR (d.role = 'owner' AND coalesce((SELECT t.owner_is_practicing_doctor FROM public.tenants t WHERE t.id = p_tenant_id), true)));

    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', v.id,
               'patient_id', v.patient_id,
               'doctor_id', v.doctor_id,
               'origin_type', v.origin_type,
               'status', v.status,
               'scheduled_at', v.scheduled_at,
               'is_overbooked', v.is_overbooked,
               'signed_at', v.signed_at,
               'row_version', v.row_version,
               'patient', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
                   'full_name', p.full_name, 'phone', p.phone, 'sex', p.sex, 'age', p.age, 'date_of_birth', p.date_of_birth) END,
               'has_allergy', CASE WHEN v_allergies THEN coalesce(cardinality(p.allergies), 0) > 0 END,
               'token', CASE WHEN q.id IS NULL THEN NULL ELSE jsonb_build_object(
                   'token_number', q.token_number, 'priority', q.priority, 'created_at', q.created_at) END,
               'vitals', CASE WHEN v_vitals THEN n.vitals END,
               'invoice', CASE WHEN v_billing AND v.status = 'completed' AND i.id IS NOT NULL THEN jsonb_build_object(
                   'total_amount', i.total_amount, 'paid', coalesce(pay.paid, 0), 'row_version', i.row_version) END,
               'follow_up', CASE WHEN v_follow AND v.status = 'completed' AND f.id IS NOT NULL THEN jsonb_build_object(
                   'date', f.follow_up_date,
                   'booked', EXISTS (
                       SELECT 1 FROM public.visits fv
                        WHERE fv.tenant_id = p_tenant_id AND fv.patient_id = v.patient_id AND fv.doctor_id = v.doctor_id
                          AND fv.status IN ('booked', 'confirmed')
                          AND fv.scheduled_at >= v_start - interval '3 days'
                          AND (fv.scheduled_at AT TIME ZONE v_zone)::date >= f.follow_up_date - 3)) END
           ) ORDER BY coalesce(v.scheduled_at, v.created_at), v.id), '[]'::jsonb)
      INTO v_visits
      FROM public.visits v
      LEFT JOIN public.patients p ON p.id = v.patient_id AND p.tenant_id = p_tenant_id
      LEFT JOIN LATERAL (SELECT q0.id, q0.token_number, q0.priority, q0.created_at FROM public.queue_tokens q0
                          WHERE q0.visit_id = v.id AND q0.tenant_id = p_tenant_id ORDER BY q0.created_at, q0.id LIMIT 1) q ON true
      LEFT JOIN public.clinical_notes n ON v_vitals AND n.visit_id = v.id AND n.tenant_id = p_tenant_id
      LEFT JOIN LATERAL (SELECT i0.id, i0.total_amount, i0.row_version FROM public.invoices i0
                          WHERE v_billing AND v.status = 'completed' AND i0.visit_id = v.id AND i0.tenant_id = p_tenant_id AND i0.status <> 'cancelled'
                          ORDER BY i0.created_at DESC, i0.id LIMIT 1) i ON true
      LEFT JOIN LATERAL (SELECT sum(py.amount) AS paid FROM public.payments py WHERE i.id IS NOT NULL AND py.invoice_id = i.id AND py.tenant_id = p_tenant_id) pay ON true
      LEFT JOIN LATERAL (SELECT f0.id, f0.follow_up_date FROM public.follow_ups f0
                          WHERE v_follow AND v.status = 'completed' AND f0.visit_id = v.id AND f0.tenant_id = p_tenant_id
                          ORDER BY f0.created_at DESC, f0.id LIMIT 1) f ON true
     WHERE v.tenant_id = p_tenant_id
       AND (v_doctor IS NULL OR v.doctor_id = v_doctor)
       AND ((v.scheduled_at >= v_start AND v.scheduled_at < v_end)
            OR (v.scheduled_at IS NULL AND v.created_at >= v_start AND v.created_at < v_end));

    RETURN jsonb_build_object('time_zone', v_tz, 'versions', v_versions, 'doctors', v_doctors, 'visits', v_visits);
END;
$$;
REVOKE ALL ON FUNCTION public.today_board(uuid, text, uuid, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.today_board(uuid, text, uuid, date) TO authenticated;
COMMENT ON FUNCTION public.today_board(uuid, text, uuid, date) IS
    'V2-09e 09E-06 (R-9, R-12): Today''s board in one read, a new INVOKER read; no table, policy or grant change beyond EXECUTE. appointments:view in p_tenant_id; NULL for another clinic, a forged tenant, no session or an unknown mode. Returns time_zone, versions (same snapshot), doctors and the clinic day''s visits with only the fields a row shows (an allergy flag, never allergen names). The invoice, vitals, allergy and follow-up parts are gated as the page gated them. SECURITY INVOKER: RLS applies to every table it reads.';
