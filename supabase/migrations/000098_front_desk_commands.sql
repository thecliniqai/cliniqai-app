-- Migration: 000098_front_desk_commands.sql
-- V2-07 07-03 (R-1, R-2, R-3, R-7, R-8): the front-desk write path as atomic server commands, and the staff slot list.
--
-- Before: the walk-in drawer chained createPatient -> createVisit -> checkInVisit from the browser (an orphan patient on a
-- failed visit, a visit without a token, a duplicate patient on retry); the booking drawer chained createPatient ->
-- bookAppointment (an orphan patient on a slot conflict, and the overbook confirmation registered the patient a SECOND
-- time; a read-then-insert slot check; the appointment_booked message was best-effort and lost on a failure); Sign & Bill
-- chained sign-off -> invoice -> payment as three commands and reported a lost payment as success (paymentRecorded:false).
--
-- 1. Input and step helpers, all in `private`, no API grant:
--    - private.patient_input_normalize(jsonb): the patientSchema rules in SQL (closed key set, E.164 mobile, bounds) -> the
--      normalised patient. INVOKER.
--    - private.step_create_patient(tenant, patient jsonb): the one patient insert (created_by = the session user, patient.create
--      audit row). DEFINER.
--    - private.step_create_visit(...): the one visit insert for walk-ins and bookings (patient active in the clinic, doctor an
--      active member, bounds, visit.create audit row). DEFINER.
--    - private.slot_conflict(...): the booking availability check (shift, block, taken slot) in the clinic's time zone. INVOKER.
--    - private.step_enqueue_booking_message(...): the appointment_booked message in the booking transaction, with the same
--      validation public.enqueue_message applies (template role, params, metadata, member dedupe namespace, the patient's own
--      number). DEFINER.
-- 2. public.enqueue_walk_in, public.register_and_book, public.complete_and_bill: SECURITY DEFINER commands (R-1: they write
--    through the DEFINER steps of 07-01/07-02, whose tables are not writable by `authenticated` as a function), with the
--    record_payment guard block (actor, active clinic, has_permission), a command claim (R-2) and command_complete.
--    - enqueue_walk_in: appointments:edit (+ patients:edit for a new patient): [patient] + walk-in visit + token (step_check_in).
--    - register_and_book: appointments:edit (+ patients:edit for a new patient): [patient] + scheduled visit; the slot is checked
--      here unless overbooked; the exclusion constraint's 23P01 (and a deadlock that survives one retry) is SLOT_TAKEN.
--    - complete_and_bill: consultations:edit (+ billing:collect when a payment is given): sign-off (or resume of a visit this
--      user signed that has no invoice yet) + invoice + optional payment in ONE transaction.
-- 3. public.available_slots(doctor, date): the staff-side free-slot list (R-8), STABLE INVOKER, in the clinic's time zone.
-- PDF rendering, the consolidated WhatsApp message and storage stay after the commit in the app (R-4).
-- Per-migration checklist: three new public definer commands (EXECUTE: authenticated only; no system path), one new public
-- invoker read function (EXECUTE: authenticated only), five private helpers with no API grant (patient_input_normalize and
-- slot_conflict are invoker; step_create_patient, step_create_visit and step_enqueue_booking_message are definer). No
-- table, column, policy or data change; expand-safe (the previous app build keeps working: nothing it calls is changed).
-- The optional trailing parameters (reason, duration, the booking overrides) carry the walk-in drawer's and booking drawer's
-- existing inputs; the plan's signatures are their required prefix.

-- 1a. patient input ------------------------------------------------------------------------------------------------------
CREATE FUNCTION private.patient_input_normalize(p_patient jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_key text;
    v_name text;
    v_national text;
    v_dob text;
    v_age numeric;
    v_sex text;
    v_address jsonb;
    v_emergency jsonb;
    v_abha text;
    v_allergies jsonb;
    v_chronic jsonb;
    v_dob_date date;
    v_entry record;
BEGIN
    IF p_patient IS NULL OR jsonb_typeof(p_patient) <> 'object' THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    FOR v_key IN SELECT k FROM jsonb_object_keys(p_patient) k LOOP
        IF v_key NOT IN ('full_name', 'phone', 'date_of_birth', 'age', 'sex', 'address', 'allergies',
                         'chronic_conditions', 'emergency_contact', 'abha_id') THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
    END LOOP;

    -- full_name: 1-120 characters after trimming, no control characters.
    IF jsonb_typeof(p_patient -> 'full_name') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    v_name := btrim(p_patient ->> 'full_name');
    IF char_length(v_name) NOT BETWEEN 1 AND 120 OR v_name ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- phone: an Indian mobile number, stored as +91 and ten digits (the app's toE164).
    IF jsonb_typeof(p_patient -> 'phone') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    v_national := private.indian_mobile_national(p_patient ->> 'phone');
    IF v_national IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- date_of_birth: absent / null / empty, or a real YYYY-MM-DD date.
    IF p_patient ? 'date_of_birth' AND jsonb_typeof(p_patient -> 'date_of_birth') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    v_dob := NULLIF(btrim(p_patient ->> 'date_of_birth'), '');
    IF v_dob IS NOT NULL THEN
        IF v_dob !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        BEGIN
            v_dob_date := v_dob::date;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END;
        v_dob := to_char(v_dob_date, 'YYYY-MM-DD');
    END IF;

    -- age: absent / null, or a whole number 0-130.
    IF p_patient ? 'age' AND jsonb_typeof(p_patient -> 'age') NOT IN ('number', 'null') THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    v_age := (p_patient ->> 'age')::numeric;
    IF v_age IS NOT NULL AND (v_age <> trunc(v_age) OR v_age < 0 OR v_age > 130) THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    IF p_patient ? 'sex' AND jsonb_typeof(p_patient -> 'sex') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    v_sex := p_patient ->> 'sex';
    IF v_sex IS NOT NULL AND v_sex NOT IN ('male', 'female', 'other') THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- address: null or an object of the four known string fields.
    v_address := CASE WHEN jsonb_typeof(p_patient -> 'address') = 'null' THEN NULL ELSE p_patient -> 'address' END;
    IF v_address IS NOT NULL THEN
        IF jsonb_typeof(v_address) <> 'object' OR octet_length(v_address::text) > 2000 THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        FOR v_entry IN SELECT e.key, e.value FROM jsonb_each(v_address) e LOOP
            IF v_entry.key NOT IN ('line1', 'city', 'state', 'pincode') OR jsonb_typeof(v_entry.value) <> 'string' THEN
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
        END LOOP;
    END IF;

    -- allergies / chronic conditions: up to 50 strings of up to 200 characters each.
    v_allergies := coalesce(CASE WHEN jsonb_typeof(p_patient -> 'allergies') = 'null' THEN NULL ELSE p_patient -> 'allergies' END, '[]'::jsonb);
    v_chronic := coalesce(CASE WHEN jsonb_typeof(p_patient -> 'chronic_conditions') = 'null' THEN NULL ELSE p_patient -> 'chronic_conditions' END, '[]'::jsonb);
    IF jsonb_typeof(v_allergies) <> 'array' OR jsonb_array_length(v_allergies) > 50
       OR jsonb_typeof(v_chronic) <> 'array' OR jsonb_array_length(v_chronic) > 50
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_allergies || v_chronic) a(el)
                   WHERE jsonb_typeof(a.el) <> 'string' OR char_length(a.el #>> '{}') > 200) THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    v_emergency := CASE WHEN jsonb_typeof(p_patient -> 'emergency_contact') = 'null' THEN NULL ELSE p_patient -> 'emergency_contact' END;
    IF v_emergency IS NOT NULL AND (jsonb_typeof(v_emergency) <> 'object' OR octet_length(v_emergency::text) > 2000) THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    IF p_patient ? 'abha_id' AND jsonb_typeof(p_patient -> 'abha_id') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    v_abha := NULLIF(btrim(p_patient ->> 'abha_id'), '');
    IF char_length(v_abha) > 64 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object(
        'full_name', v_name,
        'phone', '+91' || v_national,
        'date_of_birth', v_dob,
        'age', v_age::integer,
        'sex', v_sex,
        'address', v_address,
        'allergies', v_allergies,
        'chronic_conditions', v_chronic,
        'emergency_contact', v_emergency,
        'abha_id', v_abha
    );
END;
$$;
REVOKE ALL ON FUNCTION private.patient_input_normalize(jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.patient_input_normalize(jsonb) IS
    'V2-07 07-03: validates and normalises a new patient for the front-desk commands (the patientSchema rules: closed key set, full_name 1-120, an Indian mobile stored as +91 and ten digits, a real date of birth, age 0-130, sex, address, up to 50 allergies / conditions, abha_id). INPUT_INVALID (P0001).';

-- 1b. step: create a patient ----------------------------------------------------------------------------------------------
CREATE FUNCTION private.step_create_patient(p_tenant_id uuid, p_patient jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_p jsonb := private.patient_input_normalize(p_patient);
    v_id uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- created_by is the session user (patients_actor_guard); the clinical-field guard only watches updates.
    INSERT INTO public.patients (tenant_id, full_name, phone, date_of_birth, age, sex, address, allergies,
                                 chronic_conditions, emergency_contact, abha_id, created_by)
    VALUES (
        p_tenant_id,
        v_p ->> 'full_name',
        v_p ->> 'phone',
        (v_p ->> 'date_of_birth')::date,
        (v_p ->> 'age')::integer,
        v_p ->> 'sex',
        CASE WHEN jsonb_typeof(v_p -> 'address') = 'null' THEN NULL ELSE v_p -> 'address' END,
        ARRAY(SELECT jsonb_array_elements_text(v_p -> 'allergies')),
        ARRAY(SELECT jsonb_array_elements_text(v_p -> 'chronic_conditions')),
        CASE WHEN jsonb_typeof(v_p -> 'emergency_contact') = 'null' THEN NULL ELSE v_p -> 'emergency_contact' END,
        v_p ->> 'abha_id',
        v_uid
    )
    RETURNING id INTO v_id;

    PERFORM public.log_audit(p_tenant_id, 'patient.create', 'patient', v_id,
                             jsonb_build_object('fields_changed', jsonb_build_array('created')));
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION private.step_create_patient(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.step_create_patient(uuid, jsonb) IS
    'V2-07 07-03 (R-7): the patient insert shared by enqueue_walk_in and register_and_book: validated input, created_by = the session user, patient.create audit row. The caller has checked actor, clinic and patients:edit and holds the command claim; no API grant.';

-- 1c. step: create a visit ------------------------------------------------------------------------------------------------
CREATE FUNCTION private.step_create_visit(
    p_tenant_id uuid,
    p_patient_id uuid,
    p_doctor_id uuid,
    p_origin text,
    p_scheduled_at timestamptz,
    p_duration_minutes integer,
    p_reason text,
    p_overbooked boolean
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_reason text := NULLIF(btrim(p_reason), '');
    v_id uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_origin IS NULL OR p_origin NOT IN ('scheduled', 'walk_in')
       OR (p_origin = 'scheduled' AND p_scheduled_at IS NULL)
       OR p_duration_minutes IS NULL OR p_duration_minutes NOT BETWEEN 5 AND 480
       OR char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- The patient and the doctor must belong to the clinic (the FKs and RLS do not check this: P0-13). A removed or
    -- suspended member cannot be given new work; a soft-deleted or erased patient gets no new visit (AR-L6).
    PERFORM 1 FROM public.patients p
     WHERE p.id = p_patient_id AND p.tenant_id = p_tenant_id AND NOT p.is_deleted AND p.erased_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PATIENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    PERFORM 1 FROM public.memberships m
     WHERE m.tenant_id = p_tenant_id AND m.user_id = p_doctor_id AND m.status = 'active';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DOCTOR_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.visits (tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at,
                               estimated_duration_minutes, reason_for_visit, is_overbooked, created_by)
    VALUES (
        p_tenant_id, p_patient_id, p_doctor_id, p_origin,
        CASE WHEN p_origin = 'walk_in' THEN 'waiting' ELSE 'booked' END,
        CASE WHEN p_origin = 'walk_in' THEN NULL ELSE p_scheduled_at END,
        p_duration_minutes, v_reason, coalesce(p_overbooked, false), v_uid
    )
    RETURNING id INTO v_id;

    PERFORM public.log_audit(p_tenant_id, 'visit.create', 'visit', v_id,
                             jsonb_build_object('origin_type', p_origin, 'fields_changed', jsonb_build_array('created')));
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION private.step_create_visit(uuid, uuid, uuid, text, timestamptz, integer, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.step_create_visit(uuid, uuid, uuid, text, timestamptz, integer, text, boolean) IS
    'V2-07 07-03 (R-7): the visit insert shared by enqueue_walk_in and register_and_book: the patient is active in the clinic (PATIENT_NOT_FOUND, P0002), the doctor an active member (DOCTOR_NOT_FOUND, P0002), duration 5-480, visit.create audit row. A walk-in starts waiting, a scheduled visit booked. A slot violation surfaces as 23P01 (the caller maps it). The caller has checked actor, clinic and appointments:edit and holds the command claim; no API grant.';

-- 1d. slot conflict -------------------------------------------------------------------------------------------------------
CREATE FUNCTION private.slot_conflict(
    p_tenant_id uuid,
    p_doctor_id uuid,
    p_start timestamptz,
    p_duration_minutes integer,
    p_timezone text
)
RETURNS text
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
    v_end timestamptz := p_start + make_interval(mins => p_duration_minutes);
BEGIN
    -- 1. The doctor's working shifts, on the clinic-local weekday and time of day. No schedule stored = no restriction.
    SELECT m.availability_schedule INTO v_sched
      FROM public.memberships m
     WHERE m.tenant_id = p_tenant_id AND m.user_id = p_doctor_id;
    IF FOUND AND v_sched IS NOT NULL THEN
        v_local := p_start AT TIME ZONE p_timezone;
        v_minute := extract(hour FROM v_local)::integer * 60 + extract(minute FROM v_local)::integer;
        v_day := v_sched -> (ARRAY['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
                             )[extract(isodow FROM v_local)::integer];
        IF v_day IS NULL OR NOT coalesce((v_day ->> 'enabled')::boolean, false) THEN
            RETURN 'off_duty';
        END IF;
        FOR v_shift IN SELECT s.value FROM jsonb_array_elements(v_day -> 'shifts') s LOOP
            IF v_minute >= (substr(v_shift ->> 'start', 1, 2)::integer * 60 + substr(v_shift ->> 'start', 4, 2)::integer)
               AND v_minute + p_duration_minutes <= (substr(v_shift ->> 'end', 1, 2)::integer * 60 + substr(v_shift ->> 'end', 4, 2)::integer) THEN
                v_in_shift := true;
                EXIT;
            END IF;
        END LOOP;
        IF NOT v_in_shift THEN
            RETURN 'off_duty';
        END IF;
    END IF;

    -- 2. Schedule blocks: the doctor's own and clinic-wide (doctor_id null).
    IF EXISTS (SELECT 1 FROM public.schedule_blocks b
                WHERE b.tenant_id = p_tenant_id AND (b.doctor_id = p_doctor_id OR b.doctor_id IS NULL)
                  AND b.start_time < v_end AND b.end_time > p_start) THEN
        RETURN 'blocked';
    END IF;

    -- 3. A booked visit of the doctor: the rows visits_no_double_booking (000063) keeps apart.
    IF EXISTS (SELECT 1 FROM public.visits v
                WHERE v.tenant_id = p_tenant_id AND v.doctor_id = p_doctor_id AND v.origin_type = 'scheduled'
                  AND v.scheduled_at IS NOT NULL AND NOT v.is_overbooked AND v.status NOT IN ('cancelled', 'no_show')
                  AND public.visit_slot(v.scheduled_at, v.estimated_duration_minutes) && tstzrange(p_start, v_end, '[)')) THEN
        RETURN 'taken';
    END IF;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.slot_conflict(uuid, uuid, timestamptz, integer, text) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.slot_conflict(uuid, uuid, timestamptz, integer, text) IS
    'V2-07 07-03: why a doctor cannot take [start, start + duration): off_duty (outside the clinic-local shifts), blocked (a doctor or clinic block overlaps), taken (a non-overbooked scheduled visit overlaps), or NULL when free. Same order and rules as the old app-side checkSlotAvailability.';

-- 1e. step: the appointment_booked message ----------------------------------------------------------------------------------
CREATE FUNCTION private.step_enqueue_booking_message(
    p_tenant_id uuid,
    p_visit_id uuid,
    p_patient_id uuid,
    p_doctor_id uuid,
    p_scheduled_at timestamptz,
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
    v_uid uuid := auth.uid();
    v_template record;
    v_patient record;
    v_doctor_name text;
    v_params jsonb;
    v_metadata jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;

    SELECT p.full_name, p.phone INTO v_patient
      FROM public.patients p WHERE p.id = p_patient_id AND p.tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PATIENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    -- A patient without a usable mobile number gets no message (the booking itself stands); the old best-effort path
    -- skipped these silently too. Every other refusal below fails the whole command.
    IF private.indian_mobile_national(v_patient.phone) IS NULL THEN
        RETURN jsonb_build_object('enqueued', false);
    END IF;

    SELECT m.full_name INTO v_doctor_name
      FROM public.memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = p_doctor_id;
    v_doctor_name := CASE
        WHEN NULLIF(btrim(v_doctor_name), '') IS NULL THEN 'Doctor'
        WHEN lower(btrim(v_doctor_name)) LIKE 'dr.%' OR lower(btrim(v_doctor_name)) LIKE 'dr %' THEN btrim(v_doctor_name)
        ELSE 'Dr. ' || btrim(v_doctor_name)
    END;
    v_params := jsonb_build_object(
        'patient_name', left(coalesce(NULLIF(btrim(v_patient.full_name), ''), 'Patient'), 200),
        'doctor_name', left(v_doctor_name, 200),
        -- en-IN "medium date, short time" in the clinic's zone: 18 Nov 2026, 3:30 pm.
        'date_time', to_char(p_scheduled_at AT TIME ZONE p_timezone, 'FMDD Mon YYYY, FMHH12:MI am')
    );
    v_metadata := jsonb_build_object('buttons', jsonb_build_array(
        jsonb_build_object('id', 'btn_confirm', 'text', 'Confirm'),
        jsonb_build_object('id', 'btn_cancel', 'text', 'Cancel'),
        jsonb_build_object('id', 'btn_reschedule', 'text', 'Reschedule')
    ));

    -- The request-path rules of public.enqueue_message (000090): a request-callable template, a role that holds the call
    -- site's permission, bounded params and metadata.
    SELECT t.params, t.request_roles INTO v_template
      FROM ops.message_templates t
     WHERE t.template_id = 'appointment_booked' AND t.channel = 'whatsapp';
    IF NOT FOUND OR cardinality(v_template.request_roles) = 0 THEN
        RAISE EXCEPTION 'TEMPLATE_NOT_ALLOWED' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.memberships m
                    WHERE m.tenant_id = p_tenant_id AND m.user_id = v_uid AND m.role = ANY (v_template.request_roles)) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF NOT private.message_params_ok(v_params, v_template.params, 256)
       OR NOT private.request_message_metadata_ok(v_metadata, p_visit_id) THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- One booking message per visit, whatever the retries do: the caller's key lives in its own namespace
    -- (member:<user>:<key>, 04-07a M-DEDUPE), exactly as public.enqueue_message stores it.
    RETURN private.enqueue_message_internal(
        p_tenant_id, p_patient_id, p_visit_id, 'whatsapp', 'appointment_booked', 'appointment_booked',
        v_params, NULL, NULL, v_metadata, now(),
        'member:' || v_uid::text || ':appointment_booked:' || p_visit_id::text,
        v_uid
    ) || jsonb_build_object('enqueued', true);
END;
$$;
REVOKE ALL ON FUNCTION private.step_enqueue_booking_message(uuid, uuid, uuid, uuid, timestamptz, text) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.step_enqueue_booking_message(uuid, uuid, uuid, uuid, timestamptz, text) IS
    'V2-07 07-03 (R-3): the appointment_booked WhatsApp message in the booking transaction (dedupe key appointment_booked:<visit>, in the member namespace), after the validation public.enqueue_message applies. A patient without a valid mobile gets none ({enqueued:false}). The caller has checked actor, clinic and appointments:edit; no API grant.';

-- 2a. enqueue_walk_in -----------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.enqueue_walk_in(
    p_tenant_id uuid,
    p_patient_id uuid,
    p_new_patient jsonb,
    p_doctor_id uuid,
    p_priority text,
    p_client_request_id uuid,
    p_reason text DEFAULT NULL,
    p_duration_minutes integer DEFAULT 15
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
    v_new jsonb := CASE WHEN p_new_patient IS NULL OR jsonb_typeof(p_new_patient) = 'null' THEN NULL ELSE p_new_patient END;
    v_replay jsonb;
    v_patient_id uuid := p_patient_id;
    v_visit_id uuid;
    v_check jsonb;
    v_result jsonb;
BEGIN
    -- 1. Actor: a session; this command has no system path.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. Active clinic, then appointments:edit there (plus patients:edit when a patient is registered).
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'PATIENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'appointments:edit')
       OR (v_new IS NOT NULL AND NOT public.has_permission(p_tenant_id, 'patients:edit')) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    -- Input: exactly one of an existing patient and a new patient.
    IF (p_patient_id IS NULL) = (v_new IS NULL) OR p_doctor_id IS NULL
       OR p_priority IS NULL OR p_priority NOT IN ('normal', 'urgent', 'vip') THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF v_new IS NOT NULL THEN
        v_new := private.patient_input_normalize(v_new);
    END IF;

    -- 3. Claim; a replay returns the first result and writes nothing.
    v_replay := private.command_claim(
        p_tenant_id, p_client_request_id, 'public.enqueue_walk_in',
        md5(jsonb_build_object('patient', p_patient_id, 'new', v_new, 'doctor', p_doctor_id, 'priority', p_priority,
                               'reason', NULLIF(btrim(p_reason), ''), 'duration', p_duration_minutes)::text)
    );
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Patient (when new), walk-in visit, token: one transaction.
    IF v_new IS NOT NULL THEN
        v_patient_id := private.step_create_patient(p_tenant_id, v_new);
    END IF;
    v_visit_id := private.step_create_visit(p_tenant_id, v_patient_id, p_doctor_id, 'walk_in', NULL, p_duration_minutes,
                                            p_reason, false);
    v_check := private.step_check_in(p_tenant_id, v_visit_id, p_priority);

    v_result := jsonb_build_object(
        'patient_id', v_patient_id,
        'patient_created', v_new IS NOT NULL,
        'visit_id', v_visit_id,
        'queue_token_id', v_check -> 'queue_token_id',
        'token_number', v_check -> 'token_number',
        'priority', v_check -> 'priority',
        'replayed', false
    );
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_walk_in(uuid, uuid, jsonb, uuid, text, uuid, text, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_walk_in(uuid, uuid, jsonb, uuid, text, uuid, text, integer) TO authenticated;
COMMENT ON FUNCTION public.enqueue_walk_in(uuid, uuid, jsonb, uuid, text, uuid, text, integer) IS
    'V2-07 07-03 (R-1, R-7): registers a walk-in in one transaction: the patient (when p_new_patient is given instead of p_patient_id), the walk-in visit (waiting) and its queue token, with patient.create, visit.create and queue.check_in audit rows. appointments:edit (+ patients:edit for a new patient). INPUT_INVALID unless exactly one of p_patient_id and p_new_patient is given; PATIENT_NOT_FOUND / DOCTOR_NOT_FOUND (P0002). Idempotent by p_client_request_id. Result: patient_id, patient_created, visit_id, queue_token_id, token_number, priority, replayed.';

-- 2b. register_and_book ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.register_and_book(
    p_tenant_id uuid,
    p_patient_id uuid,
    p_new_patient jsonb,
    p_doctor_id uuid,
    p_scheduled_at timestamptz,
    p_duration_minutes integer,
    p_overbook boolean,
    p_client_request_id uuid,
    p_reason text DEFAULT NULL,
    p_override_off_duty boolean DEFAULT false,
    p_override_block boolean DEFAULT false
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
    v_new jsonb := CASE WHEN p_new_patient IS NULL OR jsonb_typeof(p_new_patient) = 'null' THEN NULL ELSE p_new_patient END;
    v_overbook boolean := coalesce(p_overbook, false);
    v_off_duty_ok boolean := coalesce(p_override_off_duty, false);
    v_block_ok boolean := coalesce(p_override_block, false);
    v_replay jsonb;
    v_tz text;
    v_conflict text;
    v_patient_id uuid := p_patient_id;
    v_visit_id uuid;
    v_attempt integer := 0;
    v_message jsonb;
    v_result jsonb;
BEGIN
    -- 1. Actor: a session; this command has no system path.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. Active clinic, then appointments:edit there (plus patients:edit when a patient is registered).
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'PATIENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'appointments:edit')
       OR (v_new IS NOT NULL AND NOT public.has_permission(p_tenant_id, 'patients:edit')) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF (p_patient_id IS NULL) = (v_new IS NULL) OR p_doctor_id IS NULL OR p_scheduled_at IS NULL
       OR p_duration_minutes IS NULL OR p_duration_minutes NOT BETWEEN 5 AND 480 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF v_new IS NOT NULL THEN
        v_new := private.patient_input_normalize(v_new);
    END IF;

    -- 3. Claim.
    v_replay := private.command_claim(
        p_tenant_id, p_client_request_id, 'public.register_and_book',
        md5(jsonb_build_object('patient', p_patient_id, 'new', v_new, 'doctor', p_doctor_id,
                               'at', extract(epoch FROM p_scheduled_at)::text, 'duration', p_duration_minutes,
                               'overbook', v_overbook, 'reason', NULLIF(btrim(p_reason), ''),
                               'off_duty_ok', v_off_duty_ok, 'block_ok', v_block_ok)::text)
    );
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. References, then the slot (unless overbooked): a refusal here writes nothing, and no patient is registered.
    PERFORM 1 FROM public.memberships m
     WHERE m.tenant_id = p_tenant_id AND m.user_id = p_doctor_id AND m.status = 'active';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DOCTOR_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF p_patient_id IS NOT NULL THEN
        PERFORM 1 FROM public.patients p
         WHERE p.id = p_patient_id AND p.tenant_id = p_tenant_id AND NOT p.is_deleted AND p.erased_at IS NULL;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'PATIENT_NOT_FOUND' USING ERRCODE = 'P0002';
        END IF;
    END IF;
    SELECT t.timezone INTO v_tz FROM public.tenants t WHERE t.id = p_tenant_id;

    IF NOT v_overbook THEN
        v_conflict := private.slot_conflict(p_tenant_id, p_doctor_id, p_scheduled_at, p_duration_minutes, v_tz);
        -- An off-duty override books outside the shifts (and overbooks); a block override books into a block but
        -- not into a taken slot (the exclusion constraint below still decides that).
        IF v_conflict = 'off_duty' AND NOT v_off_duty_ok THEN
            RAISE EXCEPTION 'SLOT_OFF_DUTY' USING ERRCODE = 'P0001';
        ELSIF v_conflict = 'blocked' AND NOT v_block_ok THEN
            RAISE EXCEPTION 'SLOT_BLOCKED' USING ERRCODE = 'P0001';
        ELSIF v_conflict = 'taken' THEN
            RAISE EXCEPTION 'SLOT_TAKEN' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 5. Writes: patient (when new), the scheduled visit, the booking message, in one transaction.
    IF v_new IS NOT NULL THEN
        v_patient_id := private.step_create_patient(p_tenant_id, v_new);
    END IF;

    -- Two concurrent inserts of conflicting slots can each find the other's uncommitted row while checking
    -- visits_no_double_booking; PostgreSQL then aborts one as a deadlock (40P01) instead of 23P01. The other goes on, so
    -- one retry answers definitively: 23P01 (taken) or the booking itself. Both end as SLOT_TAKEN for the loser.
    LOOP
        v_attempt := v_attempt + 1;
        BEGIN
            v_visit_id := private.step_create_visit(p_tenant_id, v_patient_id, p_doctor_id, 'scheduled', p_scheduled_at,
                                                    p_duration_minutes, p_reason, v_overbook OR v_off_duty_ok);
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

    v_message := private.step_enqueue_booking_message(p_tenant_id, v_visit_id, v_patient_id, p_doctor_id, p_scheduled_at, v_tz);

    v_result := jsonb_build_object(
        'patient_id', v_patient_id,
        'patient_created', v_new IS NOT NULL,
        'visit_id', v_visit_id,
        'message_enqueued', coalesce((v_message ->> 'enqueued')::boolean, false),
        'replayed', false
    );
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.register_and_book(uuid, uuid, jsonb, uuid, timestamptz, integer, boolean, uuid, text, boolean, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.register_and_book(uuid, uuid, jsonb, uuid, timestamptz, integer, boolean, uuid, text, boolean, boolean) TO authenticated;
COMMENT ON FUNCTION public.register_and_book(uuid, uuid, jsonb, uuid, timestamptz, integer, boolean, uuid, text, boolean, boolean) IS
    'V2-07 07-03 (R-1, R-3, R-7): books an appointment in one transaction: the patient (when p_new_patient is given instead of p_patient_id), the scheduled visit (booked), the appointment_booked message (dedupe key appointment_booked:<visit>), and the patient.create / visit.create audit rows. Unless p_overbook, the slot is checked in the clinic time zone: SLOT_OFF_DUTY, SLOT_BLOCKED, SLOT_TAKEN (P0001, nothing is written); the exclusion constraint (or a deadlock that survives one retry) is SLOT_TAKEN too. p_override_off_duty books outside the shifts as an overbooking; p_override_block books into a block. appointments:edit (+ patients:edit for a new patient). Idempotent by p_client_request_id. Result: patient_id, patient_created, visit_id, message_enqueued, replayed.';

-- 2c. complete_and_bill ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.complete_and_bill(
    p_tenant_id uuid,
    p_visit_id uuid,
    p_items jsonb,
    p_discount numeric,
    p_tax numeric,
    p_payment jsonb,
    p_client_request_id uuid
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
    v_pay jsonb := CASE WHEN p_payment IS NULL OR jsonb_typeof(p_payment) = 'null' THEN NULL ELSE p_payment END;
    v_method text;
    v_reference text;
    v_amount numeric;
    v_replay jsonb;
    v_visit record;
    v_resumed boolean := false;
    v_sign jsonb;
    v_inv jsonb;
    v_payment jsonb;
    v_key text;
    v_result jsonb;
BEGIN
    -- 1. Actor: a session; this command has no system path.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. Active clinic, then consultations:edit there; collecting needs billing:collect too (PO-3), refused before anything
    --    is signed.
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'consultations:edit')
       OR (v_pay IS NOT NULL AND NOT public.has_permission(p_tenant_id, 'billing:collect')) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_visit_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- Payment input: {method, reference?, amount?}; the amount defaults to the invoice total.
    IF v_pay IS NOT NULL THEN
        IF jsonb_typeof(v_pay) <> 'object' THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        FOR v_key IN SELECT k FROM jsonb_object_keys(v_pay) k LOOP
            IF v_key NOT IN ('method', 'reference', 'amount') THEN
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
        END LOOP;
        IF jsonb_typeof(v_pay -> 'method') IS DISTINCT FROM 'string' OR (v_pay ->> 'method') NOT IN ('cash', 'upi', 'card') THEN
            RAISE EXCEPTION 'METHOD_INVALID' USING ERRCODE = 'P0001';
        END IF;
        v_method := v_pay ->> 'method';
        IF v_pay ? 'reference' AND jsonb_typeof(v_pay -> 'reference') NOT IN ('string', 'null') THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        v_reference := NULLIF(btrim(v_pay ->> 'reference'), '');
        IF char_length(v_reference) > 100 THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        IF v_pay ? 'amount' AND jsonb_typeof(v_pay -> 'amount') NOT IN ('number', 'null') THEN
            RAISE EXCEPTION 'AMOUNT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        v_amount := (v_pay ->> 'amount')::numeric;
        IF v_amount IS NOT NULL AND (v_amount <= 0 OR v_amount <> round(v_amount, 2) OR v_amount >= 100000000) THEN
            RAISE EXCEPTION 'AMOUNT_INVALID' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 3. Claim; a replay returns the first result and writes nothing.
    v_replay := private.command_claim(
        p_tenant_id, p_client_request_id, 'public.complete_and_bill',
        md5(jsonb_build_object('visit', p_visit_id, 'items', p_items, 'discount', COALESCE(p_discount, 0),
                               'tax', COALESCE(p_tax, 0), 'method', v_method, 'reference', v_reference,
                               'amount', v_amount, 'collect', v_pay IS NOT NULL)::text)
    );
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock the visit (the aggregate root); the invoice needs a collector or the visit's own doctor, as create_invoice.
    SELECT v.status, v.signed_at, v.signed_by, v.doctor_id INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT (public.has_permission(p_tenant_id, 'billing:collect') OR v_visit.doctor_id IS NOT DISTINCT FROM v_uid) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    -- 5. Sign off. A visit this user already signed whose billing never happened resumes at billing (IR2-L1: it is not
    --    re-signed, P1-23); one that is already billed is refused; anything else signed is ALREADY_SIGNED (in the step).
    IF v_visit.status = 'completed' AND v_visit.signed_at IS NOT NULL AND v_visit.signed_by IS NOT DISTINCT FROM v_uid THEN
        IF EXISTS (SELECT 1 FROM public.invoices i
                    WHERE i.tenant_id = p_tenant_id AND i.visit_id = p_visit_id AND i.status <> 'cancelled') THEN
            RAISE EXCEPTION 'ALREADY_BILLED' USING ERRCODE = 'P0001';
        END IF;
        v_resumed := true;
        v_sign := jsonb_build_object('visit_id', p_visit_id, 'signed_at', v_visit.signed_at, 'sealed_prescriptions', 0);
    ELSE
        v_sign := private.step_sign_consultation(p_tenant_id, p_visit_id);
    END IF;

    -- 6. Invoice, then the payment: an invoice that already existed (an invoice made at the desk before the sign-off)
    --    is returned and nothing is paid (AR3-N2: "already billed", never "payment pending").
    v_inv := private.step_create_invoice(p_tenant_id, p_visit_id, p_items, p_discount, p_tax);
    IF v_pay IS NOT NULL AND NOT (v_inv ->> 'existing')::boolean AND (v_inv ->> 'total_amount')::numeric > 0 THEN
        v_payment := private.step_record_payment(p_tenant_id, (v_inv ->> 'invoice_id')::uuid,
                                                 coalesce(v_amount, (v_inv ->> 'total_amount')::numeric),
                                                 v_method, v_reference, NULL, p_client_request_id, NULL);
    END IF;

    v_result := jsonb_build_object(
        'visit_id', p_visit_id,
        'signed_at', v_sign -> 'signed_at',
        'sealed_prescriptions', v_sign -> 'sealed_prescriptions',
        'resumed', v_resumed,
        'invoice_id', v_inv -> 'invoice_id',
        'invoice_number', v_inv -> 'invoice_number',
        'total_amount', v_inv -> 'total_amount',
        'already_billed', (v_inv ->> 'existing')::boolean,
        'payment_recorded', v_payment IS NOT NULL,
        'payment_id', v_payment -> 'payment_id',
        'invoice_status', coalesce(v_payment ->> 'invoice_status', v_inv ->> 'status'),
        'paid_total', coalesce((v_payment ->> 'paid_total')::numeric, 0),
        'replayed', false
    );
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.complete_and_bill(uuid, uuid, jsonb, numeric, numeric, jsonb, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.complete_and_bill(uuid, uuid, jsonb, numeric, numeric, jsonb, uuid) TO authenticated;
COMMENT ON FUNCTION public.complete_and_bill(uuid, uuid, jsonb, numeric, numeric, jsonb, uuid) IS
    'V2-07 07-03 (R-1, R-7): Sign & Bill in one transaction: the sign-off (or the resume of a visit this user signed that has no invoice), the visit''s invoice, and the payment when p_payment {method, reference?, amount?} is given (the invoice total by default). consultations:edit, plus billing:collect when a payment is given; the invoice needs billing:collect or the visit''s own doctor. ALREADY_BILLED (P0001) for a visit this user signed and billed; ALREADY_SIGNED / SIGN_CONTENT_REQUIRED from the sign-off. Nothing persists unless every step succeeds. Idempotent by p_client_request_id. Result: visit_id, signed_at, sealed_prescriptions, resumed, invoice_id, invoice_number, total_amount, already_billed, payment_recorded, payment_id, invoice_status, paid_total, replayed.';

-- 3. available_slots ------------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.available_slots(p_doctor_id uuid, p_date date)
RETURNS TABLE (slot_start timestamptz, slot_end timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid := (SELECT authz.full_tenant_ids() LIMIT 1);
    v_tz text;
    v_sched jsonb;
    v_step integer;
    v_day jsonb;
BEGIN
    IF v_tenant IS NULL OR p_doctor_id IS NULL OR p_date IS NULL THEN
        RETURN;
    END IF;
    IF NOT public.has_permission(v_tenant, 'appointments:view') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    SELECT t.timezone INTO v_tz FROM public.tenants t WHERE t.id = v_tenant;
    SELECT m.availability_schedule, greatest(coalesce(m.default_slot_duration_minutes, 15), 5)
      INTO v_sched, v_step
      FROM public.memberships m
     WHERE m.tenant_id = v_tenant AND m.user_id = p_doctor_id AND m.status = 'active';
    -- Not a member of the clinic, or no schedule stored: there are no defined hours to list.
    IF NOT FOUND OR v_sched IS NULL OR v_tz IS NULL THEN
        RETURN;
    END IF;
    v_day := v_sched -> (ARRAY['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
                         )[extract(isodow FROM p_date)::integer];
    IF v_day IS NULL OR NOT coalesce((v_day ->> 'enabled')::boolean, false) THEN
        RETURN;
    END IF;

    -- Back-to-back slots of the doctor's slot length inside each shift, in the clinic's zone (a 02:00 IST slot belongs to
    -- its IST date, not the UTC one), minus blocks and booked visits.
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
     WHERE NOT EXISTS (SELECT 1 FROM public.schedule_blocks b
                        WHERE b.tenant_id = v_tenant AND (b.doctor_id = p_doctor_id OR b.doctor_id IS NULL)
                          AND b.start_time < g.g_end AND b.end_time > g.g_start)
       AND NOT EXISTS (SELECT 1 FROM public.visits v
                        WHERE v.tenant_id = v_tenant AND v.doctor_id = p_doctor_id AND v.origin_type = 'scheduled'
                          AND v.scheduled_at IS NOT NULL AND NOT v.is_overbooked AND v.status NOT IN ('cancelled', 'no_show')
                          AND public.visit_slot(v.scheduled_at, v.estimated_duration_minutes) && tstzrange(g.g_start, g.g_end, '[)'))
     ORDER BY g.g_start;
END;
$$;
REVOKE ALL ON FUNCTION public.available_slots(uuid, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.available_slots(uuid, date) TO authenticated;
COMMENT ON FUNCTION public.available_slots(uuid, date) IS
    'V2-07 07-03 (R-8, PR-7): the doctor''s free slots on a clinic-local date, for the session''s active clinic: back-to-back slots of the doctor''s slot length inside the weekly shifts, minus schedule blocks (the doctor''s and clinic-wide) and booked non-overbooked scheduled visits (the rows visits_no_double_booking keeps apart; cancelled and no-show visits free their slot). Computed in tenants.timezone. SECURITY INVOKER: RLS and appointments:view apply. A doctor outside the clinic or without a stored schedule has no slots.';
