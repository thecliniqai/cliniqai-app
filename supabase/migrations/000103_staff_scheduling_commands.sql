-- Migration: 000103_staff_scheduling_commands.sql
-- V2-08 08-04a (R-9, R-15, R-16): the staff scheduling writes as atomic commands, one set of slot rules for staff and for the
-- patient's reschedule link, and the contract of UPDATE on `visits`.
--
-- Before: staff cancelled, confirmed and rescheduled through multi-statement services (a cancel was five statements:
-- status, audit, waitlist read, replacement visit, entry update) and a visit's status, time and doctor could be written
-- by any role with UPDATE on `visits`; a doctor whose weekly schedule was NULL was read as "no restriction" in booking and
-- as "no slots" in the slot list; the patient's reschedule link built its own slots in UTC from a TypeScript default that
-- ended at 20:00 while the column default ends at 21:00, and consume_reschedule_token ignored shifts, blocks and the visit's
-- own duration.
--
-- 1. G-3 (R-9): private.default_weekly_schedule() is the column default of memberships.availability_schedule (a pgTAP check
--    proves it); private.effective_schedule(jsonb) reads NULL as that default. private.slot_conflicts (booking, staff
--    reschedule) and the slot list use it, so a cleared schedule is "the default hours", never "any time" and never "no
--    slots". private.slot_conflicts gains p_exclude_visit_id (a visit never conflicts with itself).
-- 2. private.available_slots_core(tenant, doctor, date, exclude_visit) holds the grid logic; public.available_slots(doctor,
--    date, exclude_visit default null) is its guarded wrapper (the 2-argument signature is dropped and recreated).
--    The wrapper is SECURITY DEFINER because an invoker wrapper could not call the private core.
-- 3. The commands (V2-07 pattern: definer, guard block, claim, lock, invariants, writes, in-transaction audit through
--    private.log_command_audit, command_complete): reschedule_visit, cancel_visit, mark_no_show, confirm_appointment,
--    add_to_waitlist, promote_waitlist_entry. Required parameters come first and the optional ones trail (PostgreSQL
--    allows no required parameter after a default), so p_client_request_id sits before the optional inputs.
--    Patient messages (appointment_rescheduled, appointment_cancelled) and the webhook events (appointment.rescheduled,
--    appointment.cancelled) are queued in the same transaction. The messages go through private.step_enqueue_visit_message,
--    a definer step that applies private.enqueue_message_internal's template and parameter allow-list; the template rows'
--    request_roles are NOT widened (they stay system-only for public.enqueue_message).
--    private.step_promote_waitlist is the shared waitlist promotion (D-08 parity: same date, same doctor or no doctor,
--    highest priority then oldest), claiming an entry with FOR UPDATE SKIP LOCKED so two cancels never promote one entry twice.
-- 4. Patient link (R-16): get_reschedule_context adds the clinic zone; new token-scoped get_reschedule_slots(token, date) lists
--    the clinic-zone slots that fit the visit's own duration (shifts, blocks, other visits; the visit never blocks itself);
--    consume_reschedule_token validates shifts, blocks, the visit's own duration and the exclusion constraint (slot_unavailable,
--    slot_taken).
-- 5. Audit: visit.reschedule and visit.no_show are new command-only actions; visit.confirm, visit.cancel,
--    visit.auto_promoted_from_waitlist, waitlist.add and waitlist.promote become command-only too (no member can forge them
--    through public.log_audit any more); two metadata keys (old_scheduled_at, new_scheduled_at).
-- 6. Contract (R-15): UPDATE on public.visits is revoked from authenticated and granted back only on the columns a request path
--    still writes: specialty, metadata and updated_at (the consultation draft). status, scheduled_at, doctor_id, is_overbooked,
--    estimated_duration_minutes and location_id are written by the definer commands only. The draft save moves a waiting visit
--    to in_consultation through start_consultation instead of writing the status itself.
-- Per-migration checklist: six new public definer commands and one new public token-scoped definer function (anon,
-- authenticated, service_role, like the other two token functions); public.available_slots recreated as a definer wrapper;
-- private helpers with no API grant: default_weekly_schedule, effective_schedule, available_slots_core (invoker),
-- doctor_display_name (invoker), step_enqueue_visit_message and step_promote_waitlist (definer); function bodies replaced:
-- slot_conflicts (signature widened: the 5-argument one is dropped), get_reschedule_context, consume_reschedule_token,
-- log_command_audit, audit_client_actions, audit_metadata_keys. No table, column or policy change. Not expand-safe for the
-- previous app build on purpose (contract): its cancel, confirm and status writes are refused once the grant narrows.

-- 1. G-3 the default schedule ---------------------------------------------------------------------------------------------
CREATE FUNCTION private.default_weekly_schedule()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT '{
      "monday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}, {"start": "17:00", "end": "21:00"}]},
      "tuesday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}, {"start": "17:00", "end": "21:00"}]},
      "wednesday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}, {"start": "17:00", "end": "21:00"}]},
      "thursday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}, {"start": "17:00", "end": "21:00"}]},
      "friday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}, {"start": "17:00", "end": "21:00"}]},
      "saturday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}, {"start": "17:00", "end": "21:00"}]},
      "sunday": {"enabled": false, "shifts": []}
    }'::jsonb
$$;
REVOKE ALL ON FUNCTION private.default_weekly_schedule() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.default_weekly_schedule() IS
    'V2-08 08-04a (R-9, G-3): the weekly schedule a new membership gets (Mon-Sat 10:00-13:00 and 17:00-21:00, Sunday off): the column default of memberships.availability_schedule (000012), proven equal by pgTAP.';

CREATE FUNCTION private.effective_schedule(p_schedule jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT coalesce(p_schedule, private.default_weekly_schedule())
$$;
REVOKE ALL ON FUNCTION private.effective_schedule(jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.effective_schedule(jsonb) IS
    'V2-08 08-04a (R-9, G-3): a doctor''s stored weekly schedule, or the default when it is NULL. Booking, the slot list and the patient reschedule link all read the schedule through this function.';

-- 2. slot_conflicts with the visit's own exclusion and the default schedule ----------------------------------------------------
DROP FUNCTION private.slot_conflicts(uuid, uuid, timestamptz, integer, text);
CREATE FUNCTION private.slot_conflicts(
    p_tenant_id uuid,
    p_doctor_id uuid,
    p_start timestamptz,
    p_duration_minutes integer,
    p_timezone text,
    p_exclude_visit_id uuid DEFAULT NULL
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
    v_sched jsonb;
    v_day jsonb;
    v_local timestamp;
    v_minute integer;
    v_shift jsonb;
    v_in_shift boolean := false;
    v_out text[] := ARRAY[]::text[];
    v_end timestamptz := p_start + make_interval(mins => p_duration_minutes);
BEGIN
    -- The doctor is an active clinician of the clinic (G-9).
    SELECT m.availability_schedule INTO v_sched
      FROM public.memberships m
     WHERE m.tenant_id = p_tenant_id AND m.user_id = p_doctor_id AND m.status = 'active'
       AND authz.role_has_permission(m.role, 'consultations:edit');
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DOCTOR_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    v_sched := private.effective_schedule(v_sched);

    -- 1. The doctor's working shifts, on the clinic-local weekday and time of day (a stored NULL reads as the default, G-3).
    v_local := p_start AT TIME ZONE p_timezone;
    v_minute := extract(hour FROM v_local)::integer * 60 + extract(minute FROM v_local)::integer;
    v_day := v_sched -> (ARRAY['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
                         )[extract(isodow FROM v_local)::integer];
    IF v_day IS NOT NULL AND coalesce((v_day ->> 'enabled')::boolean, false) THEN
        FOR v_shift IN SELECT s.value FROM jsonb_array_elements(v_day -> 'shifts') s LOOP
            IF v_minute >= (substr(v_shift ->> 'start', 1, 2)::integer * 60 + substr(v_shift ->> 'start', 4, 2)::integer)
               AND v_minute + p_duration_minutes <= (substr(v_shift ->> 'end', 1, 2)::integer * 60 + substr(v_shift ->> 'end', 4, 2)::integer) THEN
                v_in_shift := true;
                EXIT;
            END IF;
        END LOOP;
    END IF;
    IF NOT v_in_shift THEN
        v_out := array_append(v_out, 'off_duty');
    END IF;

    -- 2. Schedule blocks: the doctor's own and clinic-wide (doctor_id null).
    IF EXISTS (SELECT 1 FROM public.schedule_blocks b
                WHERE b.tenant_id = p_tenant_id AND (b.doctor_id = p_doctor_id OR b.doctor_id IS NULL)
                  AND b.start_time < v_end AND b.end_time > p_start) THEN
        v_out := array_append(v_out, 'blocked');
    END IF;

    -- 3. A booked visit of the doctor: the rows visits_no_double_booking (000063) keeps apart; the visit being moved is not one.
    IF EXISTS (SELECT 1 FROM public.visits v
                WHERE v.tenant_id = p_tenant_id AND v.doctor_id = p_doctor_id AND v.origin_type = 'scheduled'
                  AND v.scheduled_at IS NOT NULL AND NOT v.is_overbooked AND v.status NOT IN ('cancelled', 'no_show')
                  AND (p_exclude_visit_id IS NULL OR v.id <> p_exclude_visit_id)
                  AND public.visit_slot(v.scheduled_at, v.estimated_duration_minutes) && tstzrange(p_start, v_end, '[)')) THEN
        v_out := array_append(v_out, 'taken');
    END IF;
    RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION private.slot_conflicts(uuid, uuid, timestamptz, integer, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.slot_conflicts(uuid, uuid, timestamptz, integer, text, uuid) IS
    'V2-07 07-04a (G-1, G-9), V2-08 08-04a (G-3): every reason a doctor cannot take [start, start + duration): off_duty (outside the clinic-local shifts; a NULL schedule reads as the default hours), blocked (a doctor or clinic block overlaps), taken (a non-overbooked scheduled visit other than p_exclude_visit_id overlaps); an empty array when free. DOCTOR_NOT_FOUND (P0002) unless the doctor is an active clinician of the clinic.';

-- 3. the slot list: one core, a guarded wrapper -----------------------------------------------------------------------------------
CREATE FUNCTION private.available_slots_core(p_tenant_id uuid, p_doctor_id uuid, p_date date, p_exclude_visit_id uuid DEFAULT NULL)
RETURNS TABLE (slot_start timestamptz, slot_end timestamptz)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
    v_tz text;
    v_sched jsonb;
    v_step integer;
    v_day jsonb;
BEGIN
    IF p_tenant_id IS NULL OR p_doctor_id IS NULL OR p_date IS NULL THEN
        RETURN;
    END IF;
    SELECT t.timezone INTO v_tz FROM public.tenants t WHERE t.id = p_tenant_id;
    SELECT m.availability_schedule, greatest(coalesce(m.default_slot_duration_minutes, 15), 5)
      INTO v_sched, v_step
      FROM public.memberships m
     WHERE m.tenant_id = p_tenant_id AND m.user_id = p_doctor_id AND m.status = 'active'
       AND authz.role_has_permission(m.role, 'consultations:edit');
    -- Not a clinician of the clinic (G-9): there are no hours to list. A stored NULL schedule is the default (G-3).
    IF NOT FOUND OR v_tz IS NULL THEN
        RETURN;
    END IF;
    v_sched := private.effective_schedule(v_sched);
    v_day := v_sched -> (ARRAY['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
                         )[extract(isodow FROM p_date)::integer];
    IF v_day IS NULL OR NOT coalesce((v_day ->> 'enabled')::boolean, false) THEN
        RETURN;
    END IF;

    -- Back-to-back slots of the doctor's slot length inside each shift, in the clinic's zone (a 02:00 IST slot belongs to
    -- its IST date, not the UTC one), minus blocks and booked visits (the visit being moved excepted), none before now().
    RETURN QUERY
    WITH shifts AS (
        SELECT (p_date + (s.value ->> 'start')::time) AS s_start, (p_date + (s.value ->> 'end')::time) AS s_end
          FROM jsonb_array_elements(v_day -> 'shifts') s
    ),
    grid AS (
        SELECT DISTINCT
               ((sh.s_start + make_interval(mins => n * v_step)) AT TIME ZONE v_tz) AS g_start,
               ((sh.s_start + make_interval(mins => (n + 1) * v_step)) AT TIME ZONE v_tz) AS g_end
          FROM shifts sh
         CROSS JOIN LATERAL generate_series(
               0, greatest(floor(extract(epoch FROM (sh.s_end - sh.s_start)) / 60 / v_step)::integer - 1, -1)) AS n
    )
    SELECT g.g_start, g.g_end
      FROM grid g
     WHERE g.g_start >= now()
       AND NOT EXISTS (SELECT 1 FROM public.schedule_blocks b
                        WHERE b.tenant_id = p_tenant_id AND (b.doctor_id = p_doctor_id OR b.doctor_id IS NULL)
                          AND b.start_time < g.g_end AND b.end_time > g.g_start)
       AND NOT EXISTS (SELECT 1 FROM public.visits v
                        WHERE v.tenant_id = p_tenant_id AND v.doctor_id = p_doctor_id AND v.origin_type = 'scheduled'
                          AND v.scheduled_at IS NOT NULL AND NOT v.is_overbooked AND v.status NOT IN ('cancelled', 'no_show')
                          AND (p_exclude_visit_id IS NULL OR v.id <> p_exclude_visit_id)
                          AND public.visit_slot(v.scheduled_at, v.estimated_duration_minutes) && tstzrange(g.g_start, g.g_end, '[)'))
     ORDER BY g.g_start;
END;
$$;
REVOKE ALL ON FUNCTION private.available_slots_core(uuid, uuid, date, uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.available_slots_core(uuid, uuid, date, uuid) IS
    'V2-08 08-04a (R-9, R-16): the free slots of one doctor on a clinic-local date: back-to-back slots of the doctor''s slot length inside the weekly shifts (a NULL schedule is the default), minus schedule blocks and booked non-overbooked scheduled visits other than p_exclude_visit_id, none starting before now(), in tenants.timezone. The caller has authorised the clinic; no API grant.';

DROP FUNCTION public.available_slots(uuid, date);
CREATE FUNCTION public.available_slots(p_doctor_id uuid, p_date date, p_exclude_visit_id uuid DEFAULT NULL)
RETURNS TABLE (slot_start timestamptz, slot_end timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid := (SELECT authz.full_tenant_ids() LIMIT 1);
BEGIN
    IF v_tenant IS NULL OR p_doctor_id IS NULL OR p_date IS NULL THEN
        RETURN;
    END IF;
    IF NOT public.has_permission(v_tenant, 'appointments:view') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT c.slot_start, c.slot_end FROM private.available_slots_core(v_tenant, p_doctor_id, p_date, p_exclude_visit_id) c;
END;
$$;
REVOKE ALL ON FUNCTION public.available_slots(uuid, date, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.available_slots(uuid, date, uuid) TO authenticated;
COMMENT ON FUNCTION public.available_slots(uuid, date, uuid) IS
    'V2-07 07-03 (R-8, PR-7), V2-08 08-04a (R-9): the doctor''s free slots on a clinic-local date, for the session''s active full clinic (none for a locked clinic), appointments:view: the shifts (a NULL schedule is the default hours), minus schedule blocks and booked non-overbooked scheduled visits (p_exclude_visit_id: the visit being moved), none before now(), in tenants.timezone. A member who is not a clinician (owner, doctor) has no slots. SECURITY DEFINER wrapper of private.available_slots_core (an invoker wrapper cannot call the private core); the guard is the session''s active clinic and the permission.';

-- 4. helpers for the commands ---------------------------------------------------------------------------------------------------
CREATE FUNCTION private.doctor_display_name(p_tenant_id uuid, p_doctor_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN NULLIF(btrim(m.full_name), '') IS NULL THEN 'Doctor'
        WHEN lower(btrim(m.full_name)) LIKE 'dr.%' OR lower(btrim(m.full_name)) LIKE 'dr %' THEN btrim(m.full_name)
        ELSE 'Dr. ' || btrim(m.full_name)
    END
    FROM (SELECT p_doctor_id AS uid) d
    LEFT JOIN public.memberships m ON m.tenant_id = p_tenant_id AND m.user_id = d.uid
$$;
REVOKE ALL ON FUNCTION private.doctor_display_name(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.doctor_display_name(uuid, uuid) IS
    'V2-08 08-04a: the doctor''s name as a patient message prints it ("Dr. " prefix unless already there, "Doctor" when unnamed). No API grant.';

CREATE FUNCTION private.step_enqueue_visit_message(
    p_tenant_id uuid,
    p_visit_id uuid,
    p_patient_id uuid,
    p_template_id text,
    p_params jsonb,
    p_dedupe_key text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_phone text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_template_id IS NULL OR p_template_id NOT IN ('appointment_rescheduled', 'appointment_cancelled') THEN
        RAISE EXCEPTION 'TEMPLATE_NOT_ALLOWED' USING ERRCODE = 'P0001';
    END IF;
    SELECT p.phone INTO v_phone FROM public.patients p WHERE p.id = p_patient_id AND p.tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PATIENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    -- A patient without a usable mobile number gets no message (the change itself stands, as for the booking message).
    IF private.indian_mobile_national(v_phone) IS NULL THEN
        RETURN jsonb_build_object('enqueued', false);
    END IF;
    -- private.enqueue_message_internal validates the template row and the parameter allow-list, the recipient (the patient's
    -- own number) and the dedupe key; the key lives in the caller's own namespace (04-07a M-DEDUPE), as for the booking.
    RETURN private.enqueue_message_internal(
        p_tenant_id, p_patient_id, p_visit_id, 'whatsapp', p_template_id, p_template_id,
        p_params, NULL, NULL, NULL, now(),
        'member:' || v_uid::text || ':' || p_dedupe_key,
        v_uid
    ) || jsonb_build_object('enqueued', true);
END;
$$;
REVOKE ALL ON FUNCTION private.step_enqueue_visit_message(uuid, uuid, uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.step_enqueue_visit_message(uuid, uuid, uuid, text, jsonb, text) IS
    'V2-08 08-04a (R-15): the appointment_rescheduled / appointment_cancelled WhatsApp message in the command''s transaction, through private.enqueue_message_internal (template and parameter allow-list, the patient''s own number). A patient without a valid mobile gets none ({enqueued:false}). The caller has checked actor, clinic and appointments:edit; the template rows'' request_roles are not consulted (they stay system-only for public.enqueue_message). No API grant.';

CREATE FUNCTION private.step_promote_waitlist(
    p_tenant_id uuid,
    p_doctor_id uuid,
    p_scheduled_at timestamptz,
    p_duration_minutes integer,
    p_timezone text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_entry record;
    v_visit_id uuid;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- D-08: a waiting entry for the slot's clinic-local date, for this doctor or for any; highest priority, then the oldest.
    -- SKIP LOCKED: a concurrent cancel that already holds an entry takes that one, so one entry is promoted once; an entry
    -- whose patient or doctor can no longer take a visit is skipped, not retried forever.
    FOR v_entry IN
        SELECT w.id, w.patient_id
          FROM public.waitlist_entries w
         WHERE w.tenant_id = p_tenant_id
           AND w.target_date = (p_scheduled_at AT TIME ZONE p_timezone)::date
           AND w.status = 'waiting'
           AND (w.doctor_id IS NULL OR w.doctor_id = p_doctor_id)
         ORDER BY w.priority DESC, w.created_at ASC
         LIMIT 10
           FOR UPDATE OF w SKIP LOCKED
    LOOP
        BEGIN
            v_visit_id := private.step_create_visit(p_tenant_id, v_entry.patient_id, p_doctor_id, 'scheduled', p_scheduled_at,
                                                    p_duration_minutes, 'Booked from waitlist', false);
        EXCEPTION
            WHEN exclusion_violation OR no_data_found THEN
                CONTINUE;
        END;
        UPDATE public.waitlist_entries SET status = 'promoted', promoted_visit_id = v_visit_id
         WHERE id = v_entry.id AND tenant_id = p_tenant_id;
        PERFORM private.log_command_audit(p_tenant_id, 'visit.auto_promoted_from_waitlist', 'visit', v_visit_id,
                                          jsonb_build_object('promoted_from_waitlist_id', v_entry.id, 'promoted_visit_id', v_visit_id));
        RETURN jsonb_build_object('promoted', true, 'entry_id', v_entry.id, 'visit_id', v_visit_id, 'patient_id', v_entry.patient_id);
    END LOOP;
    RETURN jsonb_build_object('promoted', false);
END;
$$;
REVOKE ALL ON FUNCTION private.step_promote_waitlist(uuid, uuid, timestamptz, integer, text) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.step_promote_waitlist(uuid, uuid, timestamptz, integer, text) IS
    'V2-08 08-04a (R-15, D-08): the waitlist promotion shared by cancel_visit: the best waiting entry of the slot''s clinic-local date (this doctor or any; priority, then age) becomes a booked visit in the vacated slot ("Booked from waitlist"), the entry is marked promoted and visit.auto_promoted_from_waitlist is audited. FOR UPDATE SKIP LOCKED: two concurrent cancels never promote one entry twice; an entry that cannot take a visit is skipped. The caller has checked actor, clinic and appointments:edit; no API grant.';

-- 5. audit allow-lists -----------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.audit_client_actions()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT ARRAY[
        'api_key.create', 'api_key.revoke', 'appointment.cancel', 'appointment.create', 'appointment.reschedule',
        'clinic.profile.update', 'clinic.settings.update', 'consultation.amend', 'consultation.complete_sign',
        'consultation.draft_save', 'consultation.share_consolidated_whatsapp', 'diagnosis.add', 'diagnosis.remove',
        'diagnosis.update_note', 'follow_up.record', 'invoice.generate_receipt_pdf',
        'invoice.item_add', 'invoice.item_remove', 'invoice.payment_recorded', 'invoice.share_whatsapp',
        'lab_order.create', 'patient.consent.granted', 'patient.consent.withdrawn', 'patient.create',
        'patient.update', 'patient.view', 'patient_document.delete', 'patient_document.generate_share_token',
        'patient_document.share_whatsapp', 'patient_document.upload', 'prescription.create',
        'prescription.generate_pdf', 'prescription.item_add', 'prescription.item_remove',
        'prescription.share_whatsapp', 'prescription.template_save', 'queue.transition',
        'referral.acknowledge', 'referral.close_loop', 'referral.create', 'referral.share_whatsapp',
        'schedule_block.create', 'schedule_block.delete', 'staff.member.update', 'user.profile.update',
        'visit.create', 'visit.status_update', 'vitals.record',
        'webhook.create', 'webhook.delete',
        'dpdp.data_export', 'dpdp.patient_erasure'
    ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION private.audit_metadata_keys()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT ARRAY[
        'amendment_reason', 'consent_type', 'correlation_id', 'dose_form', 'erased_at', 'fields_changed',
        'follow_up_date', 'format', 'invoice_id', 'invoice_number', 'is_chronic', 'is_custom', 'is_initial_grant',
        'is_overbooked', 'items_count', 'late_arrival', 'letterhead_mode', 'new_scheduled_at', 'new_status',
        'old_scheduled_at', 'old_status', 'origin_type',
        'patient_consents_history_sharing', 'payment_method', 'priority', 'promoted_from_waitlist_id',
        'promoted_visit_id', 'reason', 'referral_type', 'retention_policy', 'revision_number', 'specialty', 'status',
        'storage_path', 'target_date', 'target_tenant_id', 'template_name', 'token_number', 'total_amount', 'urgency',
        'version', 'view_context'
    ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION private.log_command_audit(p_tenant uuid, p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_role text;
    v_id bigint;
    v_key text;
    v_value jsonb;
BEGIN
    IF v_uid IS NULL OR p_tenant IS NULL OR p_tenant IS DISTINCT FROM authz.active_tenant_id() THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
    END IF;
    SELECT m.role INTO v_role FROM public.memberships m WHERE m.tenant_id = p_tenant AND m.user_id = v_uid;
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
    END IF;
    -- Only the actions a command writes (log_audit refuses these): a closed list.
    IF p_action IS NULL OR p_action NOT IN ('visit.complete_and_sign', 'visit.reopen_for_amendment', 'visit.amend_finalized',
                                            'invoice.create', 'queue.check_in',
                                            'visit.consultation_start', 'visit.complete_at_desk',
                                            'visit.reschedule', 'visit.no_show', 'visit.cancel', 'visit.confirm',
                                            'visit.auto_promoted_from_waitlist', 'waitlist.add', 'waitlist.promote')
       OR p_entity_type IS NULL OR p_entity_type !~ '^[a-z][a-z0-9_]{0,49}$'
       OR (p_metadata IS NOT NULL AND (jsonb_typeof(p_metadata) <> 'object' OR octet_length(p_metadata::text) > 4096)) THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- Metadata: the same allow-listed keys and bounded scalar values as public.log_audit.
    IF p_metadata IS NOT NULL THEN
        IF (SELECT count(*) FROM jsonb_object_keys(p_metadata)) > 20 THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        FOR v_key, v_value IN SELECT e.key, e.value FROM jsonb_each(p_metadata) e LOOP
            IF NOT (v_key = ANY (private.audit_metadata_keys())) THEN
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
            IF jsonb_typeof(v_value) = 'array' THEN
                IF jsonb_array_length(v_value) > 50
                   OR EXISTS (
                       SELECT 1 FROM jsonb_array_elements(v_value) a(el)
                        WHERE jsonb_typeof(a.el) NOT IN ('string', 'number', 'boolean', 'null')
                           OR (jsonb_typeof(a.el) = 'string' AND char_length(a.el #>> '{}') > 500)
                   ) THEN
                    RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
                END IF;
            ELSIF jsonb_typeof(v_value) = 'object'
                  OR (jsonb_typeof(v_value) = 'string' AND char_length(v_value #>> '{}') > 500) THEN
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
        END LOOP;
    END IF;

    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, actor_type, api_key_id, action, entity_type, entity_id, metadata)
    VALUES (p_tenant, v_uid, v_role, 'user', NULL, p_action, p_entity_type, p_entity_id, p_metadata)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION private.log_command_audit(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.log_command_audit(uuid, text, text, uuid, jsonb) IS
    'V2-07 07-04a (F-1), V2-08 08-01b, 08-04a: writes an audit row as the session user for the actions only a command writes (visit.complete_and_sign, visit.reopen_for_amendment, visit.amend_finalized, invoice.create, queue.check_in, visit.consultation_start, visit.complete_at_desk, visit.reschedule, visit.no_show, visit.cancel, visit.confirm, visit.auto_promoted_from_waitlist, waitlist.add, waitlist.promote), with log_audit''s metadata rules. The active clinic and a membership are required. No API grant: public.log_audit refuses these actions.';

-- 6. reschedule_visit -------------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.reschedule_visit(
    p_tenant_id uuid,
    p_visit_id uuid,
    p_new_scheduled_at timestamptz,
    p_client_request_id uuid,
    p_doctor_id uuid DEFAULT NULL,
    p_duration_minutes integer DEFAULT NULL,
    p_overbook boolean DEFAULT false,
    p_override_off_duty boolean DEFAULT false,
    p_override_block boolean DEFAULT false,
    p_notify boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_overbook boolean := coalesce(p_overbook, false);
    v_off_duty_ok boolean := coalesce(p_override_off_duty, false);
    v_block_ok boolean := coalesce(p_override_block, false);
    v_notify boolean := coalesce(p_notify, false);
    v_replay jsonb;
    v_visit record;
    v_tz text;
    v_doctor uuid;
    v_duration integer;
    v_conflicts text[] := ARRAY[]::text[];
    v_off_duty boolean := false;
    v_overbooked boolean;
    v_attempt integer := 0;
    v_message jsonb := jsonb_build_object('enqueued', false);
    v_patient record;
    v_result jsonb;
BEGIN
    -- 1. Actor.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. Active clinic, then appointments:edit there.
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'appointments:edit') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_visit_id IS NULL OR p_new_scheduled_at IS NULL
       OR (p_duration_minutes IS NOT NULL AND p_duration_minutes NOT BETWEEN 5 AND 480) THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Claim.
    v_replay := private.command_claim(
        p_tenant_id, p_client_request_id, 'public.reschedule_visit',
        private.command_request_hash(jsonb_build_object('visit', p_visit_id, 'at', extract(epoch FROM p_new_scheduled_at)::text,
                                                        'doctor', p_doctor_id, 'duration', p_duration_minutes,
                                                        'overbook', v_overbook, 'off_duty_ok', v_off_duty_ok,
                                                        'block_ok', v_block_ok, 'notify', v_notify))
    );
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock the visit (commands on one visit run one after the other) and decide.
    SELECT v.status, v.scheduled_at, v.doctor_id, v.estimated_duration_minutes, v.patient_id, v.metadata
      INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    -- Booked, confirmed, or a no-show that is rebooked (R-7). A waiting, in-consultation, completed or cancelled visit is not moved.
    IF v_visit.status NOT IN ('booked', 'confirmed', 'no_show') THEN
        RAISE EXCEPTION 'VISIT_NOT_RESCHEDULABLE' USING ERRCODE = 'P0001';
    END IF;
    IF p_new_scheduled_at <= now() THEN
        RAISE EXCEPTION 'SLOT_IN_PAST' USING ERRCODE = 'P0001';
    END IF;
    v_doctor := coalesce(p_doctor_id, v_visit.doctor_id);
    v_duration := coalesce(p_duration_minutes, v_visit.estimated_duration_minutes, 15);
    SELECT t.timezone INTO v_tz FROM public.tenants t WHERE t.id = p_tenant_id;

    -- 5. The slot (unless overbooked): off duty, blocked and taken are evaluated independently, the visit never conflicts
    --    with itself, and each override clears only its own conflict (as register_and_book, 000099 G-1). A doctor who is not an
    --    active clinician is DOCTOR_NOT_FOUND (inside slot_conflicts; checked here too for an overbooked move).
    PERFORM 1 FROM public.memberships m
     WHERE m.tenant_id = p_tenant_id AND m.user_id = v_doctor AND m.status = 'active'
       AND authz.role_has_permission(m.role, 'consultations:edit');
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DOCTOR_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT v_overbook THEN
        v_conflicts := private.slot_conflicts(p_tenant_id, v_doctor, p_new_scheduled_at, v_duration, v_tz, p_visit_id);
        v_off_duty := 'off_duty' = ANY (v_conflicts);
        IF v_off_duty AND NOT v_off_duty_ok THEN
            RAISE EXCEPTION 'SLOT_OFF_DUTY' USING ERRCODE = 'P0001';
        ELSIF 'blocked' = ANY (v_conflicts) AND NOT v_block_ok THEN
            RAISE EXCEPTION 'SLOT_BLOCKED' USING ERRCODE = 'P0001';
        ELSIF 'taken' = ANY (v_conflicts) THEN
            RAISE EXCEPTION 'SLOT_TAKEN' USING ERRCODE = 'P0001';
        END IF;
    END IF;
    v_overbooked := v_overbook OR (v_off_duty_ok AND v_off_duty);

    -- 6. Write: the new time, doctor and duration, status back to booked (the confirmation is cleared; a no-show is rebooked).
    --    Two moves into one slot: the loser's UPDATE waits on the exclusion constraint, then fails with 23P01 (or a deadlock that
    --    survives one retry): SLOT_TAKEN.
    LOOP
        v_attempt := v_attempt + 1;
        BEGIN
            UPDATE public.visits
               SET scheduled_at = p_new_scheduled_at,
                   doctor_id = v_doctor,
                   estimated_duration_minutes = v_duration,
                   is_overbooked = v_overbooked,
                   status = 'booked',
                   metadata = coalesce(metadata, '{}'::jsonb) - 'clinic_confirmed' - 'confirmed_at' - 'confirmed_by'
                              - 'confirmed_via' - 'patient_confirmed',
                   updated_at = now()
             WHERE id = p_visit_id AND tenant_id = p_tenant_id;
            EXIT;
        EXCEPTION
            WHEN exclusion_violation THEN
                RAISE EXCEPTION 'SLOT_TAKEN' USING ERRCODE = 'P0001';
            WHEN deadlock_detected THEN
                IF v_attempt >= 2 THEN
                    RAISE EXCEPTION 'SLOT_TAKEN' USING ERRCODE = 'P0001';
                END IF;
        END;
    END LOOP;

    PERFORM private.log_command_audit(p_tenant_id, 'visit.reschedule', 'visit', p_visit_id,
        jsonb_build_object(
            'old_status', v_visit.status, 'new_status', 'booked', 'is_overbooked', v_overbooked,
            'old_scheduled_at', to_char(v_visit.scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'new_scheduled_at', to_char(p_new_scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));

    -- 7. The patient's message and the webhook event, in the same transaction.
    IF v_notify THEN
        SELECT p.full_name INTO v_patient FROM public.patients p WHERE p.id = v_visit.patient_id AND p.tenant_id = p_tenant_id;
        v_message := private.step_enqueue_visit_message(
            p_tenant_id, p_visit_id, v_visit.patient_id, 'appointment_rescheduled',
            jsonb_build_object(
                'patient_name', left(coalesce(NULLIF(btrim(v_patient.full_name), ''), 'Patient'), 200),
                'doctor_name', left(private.doctor_display_name(p_tenant_id, v_doctor), 200),
                'new_date_time', to_char(p_new_scheduled_at AT TIME ZONE v_tz, 'FMDD Mon YYYY, FMHH12:MI am')),
            'appointment_rescheduled:' || p_visit_id::text || ':' || extract(epoch FROM p_new_scheduled_at)::bigint::text);
    END IF;
    PERFORM public.enqueue_webhook_event(p_tenant_id, 'appointment.rescheduled', p_visit_id);

    v_result := jsonb_build_object(
        'visit_id', p_visit_id,
        'is_overbooked', v_overbooked,
        'message_enqueued', coalesce((v_message ->> 'enqueued')::boolean, false),
        'replayed', false
    );
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.reschedule_visit(uuid, uuid, timestamptz, uuid, uuid, integer, boolean, boolean, boolean, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reschedule_visit(uuid, uuid, timestamptz, uuid, uuid, integer, boolean, boolean, boolean, boolean) TO authenticated;
COMMENT ON FUNCTION public.reschedule_visit(uuid, uuid, timestamptz, uuid, uuid, integer, boolean, boolean, boolean, boolean) IS
    'V2-08 08-04a (R-15): moves a booked, confirmed or no-show visit to a new time (and optionally doctor and duration) in one transaction: the slot is checked as register_and_book does (SLOT_OFF_DUTY, SLOT_BLOCKED, SLOT_TAKEN; the visit never conflicts with itself; overbook and the two overrides as in the booking), a past time is SLOT_IN_PAST, the status goes back to booked (a no-show is rebooked, the confirmation is cleared), visit.reschedule audit row, the appointment_rescheduled message when p_notify (the patient has a mobile number) and the appointment.rescheduled webhook event. appointments:edit. VISIT_NOT_RESCHEDULABLE (P0001) for any other status. Idempotent by p_client_request_id. Result: visit_id, is_overbooked, message_enqueued, replayed.';

-- 7. cancel_visit -----------------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.cancel_visit(
    p_tenant_id uuid,
    p_visit_id uuid,
    p_reason_code text,
    p_client_request_id uuid,
    p_reason_note text DEFAULT NULL,
    p_notify boolean DEFAULT false,
    p_promote_waitlist boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_note text := NULLIF(btrim(p_reason_note), '');
    v_notify boolean := coalesce(p_notify, false);
    v_promote boolean := coalesce(p_promote_waitlist, true);
    v_replay jsonb;
    v_visit record;
    v_tz text;
    v_promotion jsonb := jsonb_build_object('promoted', false);
    v_message jsonb := jsonb_build_object('enqueued', false);
    v_patient record;
    v_result jsonb;
BEGIN
    -- 1. Actor.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. Active clinic, then appointments:edit there.
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'appointments:edit') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_visit_id IS NULL OR p_reason_code IS NULL
       OR p_reason_code NOT IN ('patient_request', 'doctor_unavailable', 'clinic_closed', 'duplicate', 'other')
       OR char_length(v_note) > 500 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Claim.
    v_replay := private.command_claim(
        p_tenant_id, p_client_request_id, 'public.cancel_visit',
        private.command_request_hash(jsonb_build_object('visit', p_visit_id, 'reason', p_reason_code, 'note', v_note,
                                                        'notify', v_notify, 'promote', v_promote))
    );
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock the visit and decide: booked, confirmed, or a waiting visit that leaves (R-7).
    SELECT v.status, v.scheduled_at, v.doctor_id, v.estimated_duration_minutes, v.patient_id, v.metadata
      INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_visit.status NOT IN ('booked', 'confirmed', 'waiting') THEN
        RAISE EXCEPTION 'VISIT_NOT_CANCELLABLE' USING ERRCODE = 'P0001';
    END IF;
    SELECT t.timezone INTO v_tz FROM public.tenants t WHERE t.id = p_tenant_id;

    -- 5. Cancel. The reason code is the one the webhook payload reads (metadata.cancellation_reason); the note stays on the
    --    visit and is never copied into a result or a message.
    UPDATE public.visits
       SET status = 'cancelled',
           metadata = coalesce(metadata, '{}'::jsonb)
                      || jsonb_build_object('cancellation_reason', p_reason_code, 'cancelled_by', v_uid::text,
                                            'cancelled_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
                      || CASE WHEN v_note IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('cancellation_note', v_note) END,
           updated_at = now()
     WHERE id = p_visit_id AND tenant_id = p_tenant_id;

    PERFORM private.log_command_audit(p_tenant_id, 'visit.cancel', 'visit', p_visit_id,
        jsonb_build_object('old_status', v_visit.status, 'new_status', 'cancelled', 'reason', p_reason_code));

    -- 6. The vacated slot goes to the waitlist (D-08): only a booking that still lies ahead has a slot to fill.
    IF v_promote AND v_visit.status IN ('booked', 'confirmed') AND v_visit.scheduled_at IS NOT NULL
       AND v_visit.scheduled_at > now() AND v_visit.doctor_id IS NOT NULL THEN
        v_promotion := private.step_promote_waitlist(p_tenant_id, v_visit.doctor_id, v_visit.scheduled_at,
                                                     coalesce(v_visit.estimated_duration_minutes, 15), v_tz);
    END IF;

    -- 7. The patient's message and the webhook event, in the same transaction.
    IF v_notify THEN
        SELECT p.full_name INTO v_patient FROM public.patients p WHERE p.id = v_visit.patient_id AND p.tenant_id = p_tenant_id;
        v_message := private.step_enqueue_visit_message(
            p_tenant_id, p_visit_id, v_visit.patient_id, 'appointment_cancelled',
            jsonb_build_object(
                'patient_name', left(coalesce(NULLIF(btrim(v_patient.full_name), ''), 'Patient'), 200),
                'reason', CASE p_reason_code
                    WHEN 'patient_request' THEN 'At your request'
                    WHEN 'doctor_unavailable' THEN 'The doctor is unavailable'
                    WHEN 'clinic_closed' THEN 'The clinic is closed'
                    WHEN 'duplicate' THEN 'Duplicate booking'
                    ELSE 'Schedule change' END),
            'appointment_cancelled:' || p_visit_id::text);
    END IF;
    PERFORM public.enqueue_webhook_event(p_tenant_id, 'appointment.cancelled', p_visit_id);

    v_result := jsonb_build_object(
        'visit_id', p_visit_id,
        'promoted', coalesce((v_promotion ->> 'promoted')::boolean, false),
        'replacement_visit_id', v_promotion -> 'visit_id',
        'promoted_patient_id', v_promotion -> 'patient_id',
        'message_enqueued', coalesce((v_message ->> 'enqueued')::boolean, false),
        'replayed', false
    );
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_visit(uuid, uuid, text, uuid, text, boolean, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_visit(uuid, uuid, text, uuid, text, boolean, boolean) TO authenticated;
COMMENT ON FUNCTION public.cancel_visit(uuid, uuid, text, uuid, text, boolean, boolean) IS
    'V2-08 08-04a (R-15): cancels a booked, confirmed or waiting visit in one transaction: status, metadata.cancellation_reason (one of patient_request, doctor_unavailable, clinic_closed, duplicate, other; the webhook payload reads it) and the optional note (metadata.cancellation_note, never in a result), visit.cancel audit row, the waitlist promotion into the vacated slot when p_promote_waitlist and the slot lies ahead (D-08: private.step_promote_waitlist, one entry once), the appointment_cancelled message when p_notify and the appointment.cancelled webhook event. appointments:edit. VISIT_NOT_CANCELLABLE (P0001) for any other status. Idempotent by p_client_request_id. Result: visit_id, promoted, replacement_visit_id, promoted_patient_id, message_enqueued, replayed.';

-- 8. mark_no_show -----------------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.mark_no_show(p_tenant_id uuid, p_visit_id uuid, p_client_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_replay jsonb;
    v_visit record;
    v_result jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'appointments:edit') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_visit_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    v_replay := private.command_claim(p_tenant_id, p_client_request_id, 'public.mark_no_show',
                                      private.command_request_hash(jsonb_build_object('visit', p_visit_id)));
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    SELECT v.status, v.scheduled_at INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_visit.status NOT IN ('booked', 'confirmed') THEN
        RAISE EXCEPTION 'VISIT_NOT_MARKABLE' USING ERRCODE = 'P0001';
    END IF;
    -- Only once the appointment time has passed (R-7).
    IF v_visit.scheduled_at IS NULL OR v_visit.scheduled_at > now() THEN
        RAISE EXCEPTION 'NO_SHOW_TOO_EARLY' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.visits SET status = 'no_show', updated_at = now()
     WHERE id = p_visit_id AND tenant_id = p_tenant_id;
    PERFORM private.log_command_audit(p_tenant_id, 'visit.no_show', 'visit', p_visit_id,
                                      jsonb_build_object('old_status', v_visit.status, 'new_status', 'no_show'));

    v_result := jsonb_build_object('visit_id', p_visit_id, 'replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.mark_no_show(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mark_no_show(uuid, uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.mark_no_show(uuid, uuid, uuid) IS
    'V2-08 08-04a (R-15): marks a booked or confirmed visit whose appointment time has passed as no_show, with the visit.no_show audit row. appointments:edit. NO_SHOW_TOO_EARLY (P0001) before the appointment time; VISIT_NOT_MARKABLE (P0001) for any other status. Idempotent by p_client_request_id. Result: visit_id, replayed.';

-- 9. confirm_appointment ------------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.confirm_appointment(p_tenant_id uuid, p_visit_id uuid, p_client_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_replay jsonb;
    v_visit record;
    v_already boolean := false;
    v_result jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'appointments:edit') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_visit_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    v_replay := private.command_claim(p_tenant_id, p_client_request_id, 'public.confirm_appointment',
                                      private.command_request_hash(jsonb_build_object('visit', p_visit_id)));
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    SELECT v.status INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_visit.status = 'confirmed' THEN
        v_already := true;
    ELSIF v_visit.status = 'booked' THEN
        UPDATE public.visits
           SET status = 'confirmed',
               metadata = coalesce(metadata, '{}'::jsonb)
                          || jsonb_build_object('clinic_confirmed', true,
                                                'confirmed_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                                'confirmed_by', v_uid::text, 'confirmed_via', 'staff_calendar'),
               updated_at = now()
         WHERE id = p_visit_id AND tenant_id = p_tenant_id;
        PERFORM private.log_command_audit(p_tenant_id, 'visit.confirm', 'visit', p_visit_id,
                                          jsonb_build_object('old_status', 'booked', 'new_status', 'confirmed'));
    ELSE
        RAISE EXCEPTION 'VISIT_NOT_CONFIRMABLE' USING ERRCODE = 'P0001';
    END IF;

    v_result := jsonb_build_object('visit_id', p_visit_id, 'already_confirmed', v_already, 'replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_appointment(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_appointment(uuid, uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.confirm_appointment(uuid, uuid, uuid) IS
    'V2-08 08-04a (R-15): a booked visit becomes confirmed (metadata clinic_confirmed, confirmed_at, confirmed_by, confirmed_via staff_calendar) with the visit.confirm audit row; an already confirmed visit answers already_confirmed with no second audit row. appointments:edit. VISIT_NOT_CONFIRMABLE (P0001) for any other status. Idempotent by p_client_request_id. Result: visit_id, already_confirmed, replayed.';

-- 10. add_to_waitlist -----------------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.add_to_waitlist(
    p_tenant_id uuid,
    p_patient_id uuid,
    p_target_date date,
    p_client_request_id uuid,
    p_doctor_id uuid DEFAULT NULL,
    p_time_window text DEFAULT NULL,
    p_priority integer DEFAULT 0,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_window text := NULLIF(btrim(p_time_window), '');
    v_notes text := NULLIF(btrim(p_notes), '');
    v_priority integer := coalesce(p_priority, 0);
    v_replay jsonb;
    v_entry_id uuid;
    v_result jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'PATIENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'appointments:edit') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_patient_id IS NULL OR p_target_date IS NULL OR v_priority NOT BETWEEN 0 AND 10
       OR char_length(v_window) > 100 OR char_length(v_notes) > 500 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    v_replay := private.command_claim(
        p_tenant_id, p_client_request_id, 'public.add_to_waitlist',
        private.command_request_hash(jsonb_build_object('patient', p_patient_id, 'date', p_target_date, 'doctor', p_doctor_id,
                                                        'window', v_window, 'priority', v_priority, 'notes', v_notes))
    );
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- The patient and the doctor must belong to the clinic (P0-13: the FKs and RLS do not check this).
    PERFORM 1 FROM public.patients p
     WHERE p.id = p_patient_id AND p.tenant_id = p_tenant_id AND NOT p.is_deleted AND p.erased_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PATIENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF p_doctor_id IS NOT NULL THEN
        PERFORM 1 FROM public.memberships m
         WHERE m.tenant_id = p_tenant_id AND m.user_id = p_doctor_id AND m.status = 'active'
           AND authz.role_has_permission(m.role, 'consultations:edit');
        IF NOT FOUND THEN
            RAISE EXCEPTION 'DOCTOR_NOT_FOUND' USING ERRCODE = 'P0002';
        END IF;
    END IF;

    INSERT INTO public.waitlist_entries (tenant_id, patient_id, doctor_id, target_date, time_window, priority, notes, status, created_by)
    VALUES (p_tenant_id, p_patient_id, p_doctor_id, p_target_date, v_window, v_priority, v_notes, 'waiting', v_uid)
    RETURNING id INTO v_entry_id;
    PERFORM private.log_command_audit(p_tenant_id, 'waitlist.add', 'waitlist', v_entry_id,
                                      jsonb_build_object('target_date', p_target_date::text, 'priority', v_priority));

    v_result := jsonb_build_object('entry_id', v_entry_id, 'replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.add_to_waitlist(uuid, uuid, date, uuid, uuid, text, integer, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.add_to_waitlist(uuid, uuid, date, uuid, uuid, text, integer, text) TO authenticated;
COMMENT ON FUNCTION public.add_to_waitlist(uuid, uuid, date, uuid, uuid, text, integer, text) IS
    'V2-08 08-04a (R-15): adds a patient to the clinic waitlist for a date (optionally for one doctor, with a time window, a priority 0-10 and a note), with the waitlist.add audit row. appointments:edit. PATIENT_NOT_FOUND / DOCTOR_NOT_FOUND (P0002) unless both belong to the clinic. Idempotent by p_client_request_id. Result: entry_id, replayed.';

-- 11. promote_waitlist_entry ------------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.promote_waitlist_entry(
    p_tenant_id uuid,
    p_entry_id uuid,
    p_scheduled_at timestamptz,
    p_client_request_id uuid,
    p_doctor_id uuid DEFAULT NULL,
    p_duration_minutes integer DEFAULT 15,
    p_overbook boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_overbook boolean := coalesce(p_overbook, false);
    v_duration integer := coalesce(p_duration_minutes, 15);
    v_replay jsonb;
    v_entry record;
    v_doctor uuid;
    v_tz text;
    v_conflicts text[];
    v_visit_id uuid;
    v_attempt integer := 0;
    v_result jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'WAITLIST_ENTRY_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'appointments:edit') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_entry_id IS NULL OR p_scheduled_at IS NULL OR v_duration NOT BETWEEN 5 AND 480 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    v_replay := private.command_claim(
        p_tenant_id, p_client_request_id, 'public.promote_waitlist_entry',
        private.command_request_hash(jsonb_build_object('entry', p_entry_id, 'at', extract(epoch FROM p_scheduled_at)::text,
                                                        'doctor', p_doctor_id, 'duration', v_duration, 'overbook', v_overbook))
    );
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    SELECT w.patient_id, w.doctor_id, w.status INTO v_entry
      FROM public.waitlist_entries w
     WHERE w.id = p_entry_id AND w.tenant_id = p_tenant_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'WAITLIST_ENTRY_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_entry.status <> 'waiting' THEN
        RAISE EXCEPTION 'WAITLIST_ENTRY_CLOSED' USING ERRCODE = 'P0001';
    END IF;
    IF p_scheduled_at <= now() THEN
        RAISE EXCEPTION 'SLOT_IN_PAST' USING ERRCODE = 'P0001';
    END IF;
    v_doctor := coalesce(v_entry.doctor_id, p_doctor_id);
    IF v_doctor IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    SELECT t.timezone INTO v_tz FROM public.tenants t WHERE t.id = p_tenant_id;

    IF NOT v_overbook THEN
        v_conflicts := private.slot_conflicts(p_tenant_id, v_doctor, p_scheduled_at, v_duration, v_tz);
        IF 'off_duty' = ANY (v_conflicts) THEN
            RAISE EXCEPTION 'SLOT_OFF_DUTY' USING ERRCODE = 'P0001';
        ELSIF 'blocked' = ANY (v_conflicts) THEN
            RAISE EXCEPTION 'SLOT_BLOCKED' USING ERRCODE = 'P0001';
        ELSIF 'taken' = ANY (v_conflicts) THEN
            RAISE EXCEPTION 'SLOT_TAKEN' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    LOOP
        v_attempt := v_attempt + 1;
        BEGIN
            v_visit_id := private.step_create_visit(p_tenant_id, v_entry.patient_id, v_doctor, 'scheduled', p_scheduled_at,
                                                    v_duration, 'Booked from waitlist', v_overbook);
            EXIT;
        EXCEPTION
            WHEN exclusion_violation THEN
                RAISE EXCEPTION 'SLOT_TAKEN' USING ERRCODE = 'P0001';
            WHEN deadlock_detected THEN
                IF v_attempt >= 2 THEN
                    RAISE EXCEPTION 'SLOT_TAKEN' USING ERRCODE = 'P0001';
                END IF;
        END;
    END LOOP;

    UPDATE public.waitlist_entries SET status = 'promoted', promoted_visit_id = v_visit_id
     WHERE id = p_entry_id AND tenant_id = p_tenant_id;
    PERFORM private.log_command_audit(p_tenant_id, 'waitlist.promote', 'waitlist', p_entry_id,
                                      jsonb_build_object('promoted_visit_id', v_visit_id));
    PERFORM private.log_command_audit(p_tenant_id, 'visit.auto_promoted_from_waitlist', 'visit', v_visit_id,
                                      jsonb_build_object('promoted_from_waitlist_id', p_entry_id, 'promoted_visit_id', v_visit_id));

    v_result := jsonb_build_object('entry_id', p_entry_id, 'visit_id', v_visit_id, 'replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.promote_waitlist_entry(uuid, uuid, timestamptz, uuid, uuid, integer, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.promote_waitlist_entry(uuid, uuid, timestamptz, uuid, uuid, integer, boolean) TO authenticated;
COMMENT ON FUNCTION public.promote_waitlist_entry(uuid, uuid, timestamptz, uuid, uuid, integer, boolean) IS
    'V2-08 08-04a (R-15): books a waiting waitlist entry into a chosen future slot in one transaction: the doctor (the entry''s own, else p_doctor_id), the slot checked as register_and_book does unless p_overbook (SLOT_OFF_DUTY, SLOT_BLOCKED, SLOT_TAKEN), the booked visit ("Booked from waitlist"), the entry marked promoted, waitlist.promote and visit.auto_promoted_from_waitlist audit rows. appointments:edit. WAITLIST_ENTRY_NOT_FOUND (P0002); WAITLIST_ENTRY_CLOSED, SLOT_IN_PAST (P0001). Idempotent by p_client_request_id. Result: entry_id, visit_id, replayed.';

-- 12. the patient link (R-16) -----------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_reschedule_context(p_token text, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    t public.document_share_tokens;
    v public.visits;
    v_clinic JSONB;
    v_doctor JSONB;
    v_booked JSONB := '[]'::JSONB;
    v_from TIMESTAMPTZ;
    v_to TIMESTAMPTZ;
BEGIN
    IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 128 THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    SELECT * INTO t FROM public.document_share_tokens s
    WHERE s.token_hash = public.share_token_hash(p_token) AND s.resource_type = 'appointment';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    -- 05-10a (SUB-02): a clinic whose access level is not `full` offers no online service.
    IF billing_internal.tenant_access_level(t.tenant_id, now()) IS DISTINCT FROM 'full' THEN
        RETURN jsonb_build_object('status', 'clinic_unavailable');
    END IF;
    IF t.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'revoked');
    END IF;
    IF t.expires_at <= now() THEN
        RETURN jsonb_build_object('status', 'expired');
    END IF;

    SELECT * INTO v FROM public.visits x WHERE x.id = t.resource_id AND x.tenant_id = t.tenant_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    IF v.status IS NULL OR v.status NOT IN ('booked', 'confirmed') THEN
        RETURN jsonb_build_object('status', 'closed', 'visit_status', v.status);
    END IF;
    IF v.doctor_id IS NULL THEN
        RETURN jsonb_build_object('status', 'unavailable');
    END IF;

    -- V2-08 08-04a (R-16): the clinic's zone travels with the context, so the page and the slot list name the same day.
    SELECT jsonb_build_object('name', c.name, 'phone', c.phone, 'address', c.address, 'timezone', c.timezone)
    INTO v_clinic
    FROM public.tenants c
    WHERE c.id = t.tenant_id;

    SELECT jsonb_build_object(
        'full_name', m.full_name,
        'default_specialty', m.default_specialty,
        'default_slot_duration_minutes', m.default_slot_duration_minutes,
        'availability_schedule', private.effective_schedule(m.availability_schedule)
    ) INTO v_doctor
    FROM public.memberships m
    WHERE m.tenant_id = t.tenant_id AND m.user_id = v.doctor_id;

    v_from := GREATEST(p_from, now() - INTERVAL '1 day');
    v_to := LEAST(p_to, v_from + INTERVAL '1 day', now() + INTERVAL '91 days');

    IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_to >= v_from THEN
        SELECT COALESCE(jsonb_agg(b.scheduled_at ORDER BY b.scheduled_at), '[]'::JSONB)
        INTO v_booked
        FROM public.visits b
        WHERE b.tenant_id = t.tenant_id
          AND b.doctor_id = v.doctor_id
          AND b.scheduled_at >= v_from
          AND b.scheduled_at <= v_to
          AND b.status IN ('booked', 'confirmed', 'waiting', 'in_consultation');
    END IF;

    RETURN jsonb_build_object(
        'status', 'ok',
        'clinic', v_clinic,
        'doctor', COALESCE(v_doctor, '{}'::JSONB),
        'current_scheduled_at', v.scheduled_at,
        'booked', v_booked
    );
END;
$function$;

CREATE FUNCTION public.get_reschedule_slots(p_token text, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    t public.document_share_tokens;
    v public.visits;
    v_tz text;
    v_today date;
    v_slots jsonb := '[]'::jsonb;
BEGIN
    IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 128 THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    SELECT * INTO t FROM public.document_share_tokens s
     WHERE s.token_hash = public.share_token_hash(p_token) AND s.resource_type = 'appointment';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    IF billing_internal.tenant_access_level(t.tenant_id, now()) IS DISTINCT FROM 'full' THEN
        RETURN jsonb_build_object('status', 'clinic_unavailable');
    END IF;
    IF t.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'revoked');
    END IF;
    IF t.expires_at <= now() THEN
        RETURN jsonb_build_object('status', 'expired');
    END IF;
    SELECT * INTO v FROM public.visits x WHERE x.id = t.resource_id AND x.tenant_id = t.tenant_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    IF v.status IS NULL OR v.status NOT IN ('booked', 'confirmed') THEN
        RETURN jsonb_build_object('status', 'closed', 'visit_status', v.status);
    END IF;
    IF v.doctor_id IS NULL THEN
        RETURN jsonb_build_object('status', 'unavailable');
    END IF;

    SELECT c.timezone INTO v_tz FROM public.tenants c WHERE c.id = t.tenant_id;
    v_today := public.tenant_local_date(t.tenant_id, now());
    -- The same slots staff see (R-9): the clinic-zone grid of the doctor's schedule minus blocks and booked visits, here also
    -- limited to slots that fit the visit's own duration, within the 90-day horizon consume_reschedule_token enforces.
    IF p_date IS NOT NULL AND p_date >= v_today AND p_date <= v_today + 90 THEN
        SELECT coalesce(jsonb_agg(jsonb_build_object('start', c.slot_start, 'end', c.slot_end) ORDER BY c.slot_start), '[]'::jsonb)
          INTO v_slots
          FROM private.available_slots_core(t.tenant_id, v.doctor_id, p_date, v.id) c
         WHERE c.slot_start <= now() + INTERVAL '90 days'
           AND cardinality(private.slot_conflicts(t.tenant_id, v.doctor_id, c.slot_start,
                                                  coalesce(v.estimated_duration_minutes, 15), v_tz, v.id)) = 0;
    END IF;

    RETURN jsonb_build_object('status', 'ok', 'timezone', v_tz, 'date', p_date, 'slots', v_slots);
END;
$$;
REVOKE ALL ON FUNCTION public.get_reschedule_slots(text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reschedule_slots(text, date) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.get_reschedule_slots(text, date) IS
    'V2-08 08-04a (R-16): token-scoped (appointment link): the clinic-zone slots a patient may move the visit to on a clinic-local date: the slots staff see (available_slots_core: the doctor''s schedule, a NULL schedule reading as the default hours, minus blocks and booked visits, the visit itself excepted) that also fit the visit''s own duration; none before now(), none beyond 90 days. Statuses as get_reschedule_context (not_found, clinic_unavailable, revoked, expired, closed, unavailable); ok carries timezone, date and slots [{start, end}]. No ids or patient data.';

CREATE OR REPLACE FUNCTION public.consume_reschedule_token(p_token text, p_new_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    t public.document_share_tokens;
    v public.visits;
    v_tz text;
    v_conflicts text[];
BEGIN
    IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 128 THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    SELECT * INTO t FROM public.document_share_tokens s
    WHERE s.token_hash = public.share_token_hash(p_token) AND s.resource_type = 'appointment'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    -- 05-10a (SUB-02): a clinic whose access level is not `full` offers no online service.
    IF billing_internal.tenant_access_level(t.tenant_id, now()) IS DISTINCT FROM 'full' THEN
        RETURN jsonb_build_object('status', 'clinic_unavailable');
    END IF;
    IF t.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'revoked');
    END IF;
    IF t.expires_at <= now() THEN
        RETURN jsonb_build_object('status', 'expired');
    END IF;

    IF p_new_at IS NULL OR p_new_at <= now() THEN
        RETURN jsonb_build_object('status', 'invalid_time');
    END IF;
    IF p_new_at > now() + INTERVAL '90 days' THEN
        RETURN jsonb_build_object('status', 'too_far');
    END IF;

    SELECT * INTO v FROM public.visits x
    WHERE x.id = t.resource_id AND x.tenant_id = t.tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    IF v.status IS NULL OR v.status NOT IN ('booked', 'confirmed') THEN
        RETURN jsonb_build_object('status', 'closed', 'visit_status', v.status);
    END IF;
    IF v.doctor_id IS NULL THEN
        RETURN jsonb_build_object('status', 'unavailable');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('reschedule:' || v.tenant_id::TEXT || ':' || v.doctor_id::TEXT, 0));

    -- V2-08 08-04a (R-16): the same rules staff are held to: the doctor's shifts (a NULL schedule is the default hours), blocks
    -- and booked visits in the clinic's zone, for the visit's own duration, the visit itself excepted. A doctor who is no longer
    -- an active clinician of the clinic cannot take the visit (unavailable).
    SELECT c.timezone INTO v_tz FROM public.tenants c WHERE c.id = t.tenant_id;
    BEGIN
        v_conflicts := private.slot_conflicts(v.tenant_id, v.doctor_id, p_new_at, coalesce(v.estimated_duration_minutes, 15), v_tz, v.id);
    EXCEPTION
        WHEN no_data_found THEN
            RETURN jsonb_build_object('status', 'unavailable');
    END;
    IF 'off_duty' = ANY (v_conflicts) OR 'blocked' = ANY (v_conflicts) THEN
        RETURN jsonb_build_object('status', 'slot_unavailable');
    END IF;
    IF 'taken' = ANY (v_conflicts) THEN
        RETURN jsonb_build_object('status', 'slot_taken');
    END IF;

    -- The move first: the exclusion constraint has the last word, and a refused move leaves the link usable.
    BEGIN
        UPDATE public.visits
        SET scheduled_at = p_new_at,
            is_overbooked = false,
            updated_at = now()
        WHERE id = v.id AND tenant_id = t.tenant_id;
    EXCEPTION
        WHEN exclusion_violation THEN
            RETURN jsonb_build_object('status', 'slot_taken');
    END;

    UPDATE public.document_share_tokens
    SET revoked_at = now(),
        access_count = access_count + 1,
        last_accessed_at = now()
    WHERE id = t.id;

    INSERT INTO public.in_app_notifications
        (tenant_id, recipient_role, category, event_type, title, message, link_url, metadata)
    VALUES (
        t.tenant_id,
        'receptionist',
        'queue',
        'appointment_rescheduled',
        'Appointment Rescheduled Online',
        'A patient has rescheduled their appointment to '
            || to_char(p_new_at AT TIME ZONE v_tz, 'DD Mon YYYY, HH12:MI AM') || '.',
        '/calendar',
        jsonb_build_object('appointment_id', v.id, 'new_scheduled_at', p_new_at)
    );

    RETURN jsonb_build_object('status', 'ok', 'new_scheduled_at', p_new_at);
END;
$function$;

-- 13. the contract: UPDATE on visits narrowed to the columns a request path still writes -----------------------------------------------
-- status, scheduled_at, doctor_id, is_overbooked, estimated_duration_minutes and location_id are written by the definer commands
-- (check_in_visit, start_consultation, complete_visit, sign_consultation, the amendment commands, reschedule_visit,
-- cancel_visit, mark_no_show, confirm_appointment) and by service_role system paths only. The consultation draft keeps writing
-- specialty and metadata (and updated_at); every other column was already guarded by triggers and is not written from a request.
REVOKE UPDATE ON TABLE public.visits FROM authenticated;
GRANT UPDATE (specialty, metadata, updated_at) ON TABLE public.visits TO authenticated;
