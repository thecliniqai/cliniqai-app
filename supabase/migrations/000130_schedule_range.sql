-- Migration: 000130_schedule_range.sql
-- V2-09e 09E-12 (R-10; decisions 7, 11): the Schedule's data in one read for a range of clinic dates, with the free slots from SQL. (Planned as 000129; 000129
-- became the H-1 fix of reference_shard, so this file and session_bootstrap moved up by one: 000130 here, 000131 for 09E-13.) A new INVOKER read composed of
-- tables the Schedule already read through the user's own client; no table, column, policy, trigger or grant change beyond EXECUTE.
--
-- public.schedule_range(p_tenant_id, p_from, p_to, p_include_slots DEFAULT true) returns one jsonb:
--   zone        the clinic's stored zone text (the application resolves it exactly as before; the range below uses the database's own resolution);
--   server_now  now() of the statement (the device hides slots that have started by its clock offset to this; display only);
--   versions    {schedule, queue} of clinic_versions in the SAME snapshot as the rows (an exact basis for the live core);
--   clinicians  the clinic's active doctors (role doctor, or the owner when practising: the Schedule's doctor directory), ordered by membership creation:
--               {id, full_name, specialty, slot_minutes (the slot length, floored at 5, default 15, as the slot list uses), schedule (the effective weekly
--               schedule: the stored one, or the clinic default when it is NULL; the same literal as private.default_weekly_schedule, asserted by pgTAP)};
--   blocks      schedule blocks of any doctor or the whole clinic that touch the range: {id, doctor_id, start_time, end_time, all_day, reason};
--   visits      the range's scheduled visits that are not cancelled, with the fields the cards and the sheets use today: {id, patient_id, doctor_id, status,
--               scheduled_at, estimated_duration_minutes, is_overbooked, signed_at, row_version, clinic_confirmed, patient_confirmed, patient_name};
--   waitlist    the range's waiting entries (the Schedule's Waitlist button and sheet; not in the plan's field list, recorded in 09E-NOTES): {id, target_date,
--               doctor_id, priority, time_window, created_at, patient_name}, by priority (high first), then age;
--   slots       (absent when p_include_slots is false) the free slots of each clinician on each clinic-local date of the range, from public.available_slots (the
--               definer wrapper of private.available_slots_core: the one rule the booking commands also apply; an INVOKER function cannot call the private core):
--               [{doctor_id, date, slots: [[start_minute, length_minutes], ...]}], start minutes from the clinic's local midnight, by start; a date with none is left
--               out. No slot rule is restated here or in TypeScript.
-- Gates: appointments:view in p_tenant_id (public.has_permission: the session's active, full clinic); NULL otherwise (another clinic, a forged tenant, a role
-- without it, no session) and for a NULL argument, a reversed range or one longer than 42 days. RLS applies to every table it reads (SECURITY INVOKER).
-- STABLE: one snapshot for every part.
-- Per-migration checklist: one new public function (STABLE INVOKER, search_path '', EXECUTE for authenticated only). No table, column, policy, trigger or data change.

CREATE FUNCTION public.schedule_range(p_tenant_id uuid, p_from date, p_to date, p_include_slots boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    c_max_days constant integer := 42;
    v_tz text;
    v_zone text;
    v_start timestamptz;
    v_end timestamptz;
    v_versions jsonb;
    v_clinicians jsonb;
    v_blocks jsonb;
    v_visits jsonb;
    v_waitlist jsonb;
    v_slots jsonb;
    v_out jsonb;
BEGIN
    IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_include_slots IS NULL THEN
        RETURN NULL;
    END IF;
    IF p_to < p_from OR p_to - p_from + 1 > c_max_days THEN
        RETURN NULL;
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'appointments:view') THEN
        RETURN NULL;
    END IF;

    SELECT t.timezone INTO v_tz FROM public.tenants t WHERE t.id = p_tenant_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    -- The database's own resolution of the stored zone (case-insensitive IANA name, else Asia/Kolkata), as today_board reads it.
    SELECT z.name INTO v_zone FROM pg_catalog.pg_timezone_names z WHERE lower(z.name) = lower(v_tz) ORDER BY z.name LIMIT 1;
    v_zone := coalesce(v_zone, 'Asia/Kolkata');
    v_start := p_from::timestamp AT TIME ZONE v_zone;
    v_end := (p_to + 1)::timestamp AT TIME ZONE v_zone;

    SELECT jsonb_build_object('schedule', max(cv.version) FILTER (WHERE cv.domain = 'schedule'),
                              'queue', max(cv.version) FILTER (WHERE cv.domain = 'queue'))
      INTO v_versions
      FROM public.clinic_versions cv
     WHERE cv.tenant_id = p_tenant_id AND cv.domain IN ('schedule', 'queue');

    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', m.user_id,
               'full_name', m.full_name,
               'specialty', m.default_specialty,
               'slot_minutes', greatest(coalesce(m.default_slot_duration_minutes, 15), 5),
               'schedule', coalesce(m.availability_schedule, '{
      "monday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}, {"start": "17:00", "end": "21:00"}]},
      "tuesday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}, {"start": "17:00", "end": "21:00"}]},
      "wednesday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}, {"start": "17:00", "end": "21:00"}]},
      "thursday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}, {"start": "17:00", "end": "21:00"}]},
      "friday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}, {"start": "17:00", "end": "21:00"}]},
      "saturday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}, {"start": "17:00", "end": "21:00"}]},
      "sunday": {"enabled": false, "shifts": []}
    }'::jsonb)
           ) ORDER BY m.created_at, m.user_id), '[]'::jsonb)
      INTO v_clinicians
      FROM public.memberships m
     WHERE m.tenant_id = p_tenant_id
       AND m.status = 'active'
       AND (m.role = 'doctor' OR (m.role = 'owner' AND coalesce((SELECT t.owner_is_practicing_doctor FROM public.tenants t WHERE t.id = p_tenant_id), true)));

    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', b.id, 'doctor_id', b.doctor_id, 'start_time', b.start_time, 'end_time', b.end_time, 'all_day', b.all_day, 'reason', b.reason
           ) ORDER BY b.start_time, b.id), '[]'::jsonb)
      INTO v_blocks
      FROM public.schedule_blocks b
     WHERE b.tenant_id = p_tenant_id AND b.start_time < v_end AND b.end_time >= v_start;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', v.id,
               'patient_id', v.patient_id,
               'doctor_id', v.doctor_id,
               'status', v.status,
               'scheduled_at', v.scheduled_at,
               'estimated_duration_minutes', v.estimated_duration_minutes,
               'is_overbooked', v.is_overbooked,
               'signed_at', v.signed_at,
               'row_version', v.row_version,
               'clinic_confirmed', v.metadata ->> 'clinic_confirmed',
               'patient_confirmed', v.metadata ->> 'patient_confirmed',
               'patient_name', p.full_name
           ) ORDER BY v.scheduled_at, v.id), '[]'::jsonb)
      INTO v_visits
      FROM public.visits v
      LEFT JOIN public.patients p ON p.id = v.patient_id AND p.tenant_id = p_tenant_id
     WHERE v.tenant_id = p_tenant_id
       AND v.scheduled_at >= v_start AND v.scheduled_at < v_end
       AND v.status <> 'cancelled';

    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', w.id, 'target_date', w.target_date, 'doctor_id', w.doctor_id, 'priority', w.priority, 'time_window', w.time_window,
               'created_at', w.created_at, 'patient_name', p.full_name
           ) ORDER BY w.priority DESC, w.created_at, w.id), '[]'::jsonb)
      INTO v_waitlist
      FROM public.waitlist_entries w
      LEFT JOIN public.patients p ON p.id = w.patient_id AND p.tenant_id = p_tenant_id
     WHERE w.tenant_id = p_tenant_id AND w.status = 'waiting' AND w.target_date BETWEEN p_from AND p_to;

    v_out := jsonb_build_object('zone', v_tz, 'server_now', now(), 'versions', v_versions, 'clinicians', v_clinicians, 'blocks', v_blocks,
                                'visits', v_visits, 'waitlist', v_waitlist);

    IF p_include_slots THEN
        SELECT coalesce(jsonb_agg(jsonb_build_object('doctor_id', s.doctor_id, 'date', s.day, 'slots', s.slots) ORDER BY s.ord, s.day), '[]'::jsonb)
          INTO v_slots
          FROM (
              SELECT c.doctor_id, c.ord, d.day::date AS day,
                     jsonb_agg(jsonb_build_array(
                         (extract(hour FROM (a.slot_start AT TIME ZONE v_zone)) * 60 + extract(minute FROM (a.slot_start AT TIME ZONE v_zone)))::integer,
                         round(extract(epoch FROM (a.slot_end - a.slot_start)) / 60)::integer
                     ) ORDER BY a.slot_start) AS slots
                FROM (SELECT (e ->> 'id')::uuid AS doctor_id, o AS ord FROM jsonb_array_elements(v_clinicians) WITH ORDINALITY x(e, o)) c
               CROSS JOIN generate_series(p_from, p_to, interval '1 day') d(day)
               CROSS JOIN LATERAL public.available_slots(c.doctor_id, d.day::date) a
               GROUP BY c.doctor_id, c.ord, d.day
          ) s;
        v_out := v_out || jsonb_build_object('slots', v_slots);
    END IF;

    RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.schedule_range(uuid, date, date, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.schedule_range(uuid, date, date, boolean) TO authenticated;
COMMENT ON FUNCTION public.schedule_range(uuid, date, date, boolean) IS
    'V2-09e 09E-12 (R-10): the Schedule of a range of clinic dates (at most 42) in one read, a new INVOKER read; no table, policy or grant change beyond EXECUTE. appointments:view in p_tenant_id; NULL for another clinic, a forged tenant, no session, a NULL argument, a reversed range or more than 42 days. Returns zone, server_now, versions {schedule, queue} (same snapshot), clinicians (id, full_name, specialty, slot_minutes, effective weekly schedule), blocks, the range''s non-cancelled scheduled visits with the fields the cards and sheets use plus row_version, the waiting waitlist entries, and (unless p_include_slots is false) the free slots of each clinician and date from public.available_slots as [start minute from local midnight, length]. SECURITY INVOKER: RLS applies to every table it reads.';
