-- Migration: 000023_reschedule_state_guards.sql
-- V2-01 plan 01-09 (review round 2; reviews/review2-adversarial.md = AR2).
--
-- 1. AR2-L4: a self-service reschedule link is issued for, shown for, and consumed on a visit that is still 'booked' or
--    'confirmed' only (the same rule as the WhatsApp confirm/cancel replies). A visit that is waiting, in consultation,
--    completed or cancelled answers 'closed'. Before, a late link could move a patient who was already in the queue.
-- 2. AR2-Info (I1): a visit with no doctor (doctor_id NULL) cannot be rescheduled online: pg_advisory_xact_lock(NULL)
--    takes no lock and `o.doctor_id = NULL` disables the overlap check, so the double-booking guard would silently not
--    apply. Such a visit answers 'unavailable' (issue refused with 'appointment_unassigned').
-- Bodies otherwise as 000022 (hash lookup). Signatures unchanged.

CREATE OR REPLACE FUNCTION public.create_reschedule_token(p_visit_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant UUID;
    v_status TEXT;
    v_doctor UUID;
    v_token TEXT := encode(extensions.gen_random_bytes(32), 'hex');
BEGIN
    SELECT v.tenant_id, v.status, v.doctor_id INTO v_tenant, v_status, v_doctor
    FROM public.visits v WHERE v.id = p_visit_id;

    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    IF v_status IS NULL OR v_status NOT IN ('booked', 'confirmed') THEN
        RAISE EXCEPTION 'appointment_closed' USING ERRCODE = 'P0001';
    END IF;

    IF v_doctor IS NULL THEN
        RAISE EXCEPTION 'appointment_unassigned' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.document_share_tokens s
    SET revoked_at = now()
    WHERE s.tenant_id = v_tenant
      AND s.resource_type = 'appointment'
      AND s.resource_id = p_visit_id
      AND s.revoked_at IS NULL;

    INSERT INTO public.document_share_tokens
        (tenant_id, document_id, resource_type, resource_id, token_hash, expires_at, created_by)
    VALUES (v_tenant, NULL, 'appointment', p_visit_id, public.share_token_hash(v_token), now() + INTERVAL '24 hours', NULL);

    RETURN v_token;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_reschedule_token(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_reschedule_token(UUID) TO service_role;

-- status: not_found | revoked | expired | closed (visit not booked/confirmed) | unavailable (no doctor) | ok
CREATE OR REPLACE FUNCTION public.get_reschedule_context(p_token TEXT, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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

    SELECT jsonb_build_object('name', c.name, 'phone', c.phone, 'address', c.address)
    INTO v_clinic
    FROM public.tenants c
    WHERE c.id = t.tenant_id;

    SELECT jsonb_build_object(
        'full_name', m.full_name,
        'default_specialty', m.default_specialty,
        'default_slot_duration_minutes', m.default_slot_duration_minutes,
        'availability_schedule', m.availability_schedule
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
$$;

REVOKE EXECUTE ON FUNCTION public.get_reschedule_context(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reschedule_context(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO anon, authenticated, service_role;

-- status: invalid_time | too_far | slot_taken | not_found | revoked | expired | closed | unavailable | ok.
-- A refused attempt (anything but ok) leaves the token usable.
CREATE OR REPLACE FUNCTION public.consume_reschedule_token(p_token TEXT, p_new_at TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    t public.document_share_tokens;
    v public.visits;
    v_slot INTERVAL;
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

    SELECT make_interval(mins => LEAST(GREATEST(COALESCE(m.default_slot_duration_minutes, 15), 5), 120))
    INTO v_slot
    FROM public.memberships m
    WHERE m.tenant_id = v.tenant_id AND m.user_id = v.doctor_id;
    v_slot := COALESCE(v_slot, INTERVAL '15 minutes');

    IF EXISTS (
        SELECT 1
        FROM public.visits o
        WHERE o.tenant_id = v.tenant_id
          AND o.doctor_id = v.doctor_id
          AND o.id <> v.id
          AND o.status IN ('booked', 'confirmed', 'waiting', 'in_consultation')
          AND o.scheduled_at > p_new_at - v_slot
          AND o.scheduled_at < p_new_at + v_slot
    ) THEN
        RETURN jsonb_build_object('status', 'slot_taken');
    END IF;

    UPDATE public.document_share_tokens
    SET revoked_at = now(),
        access_count = access_count + 1,
        last_accessed_at = now()
    WHERE id = t.id;

    UPDATE public.visits
    SET scheduled_at = p_new_at,
        updated_at = now()
    WHERE id = v.id AND tenant_id = t.tenant_id;

    INSERT INTO public.in_app_notifications
        (tenant_id, recipient_role, category, event_type, title, message, link_url, metadata)
    VALUES (
        t.tenant_id,
        'receptionist',
        'queue',
        'appointment_rescheduled',
        'Appointment Rescheduled Online',
        'A patient has rescheduled their appointment to '
            || to_char(p_new_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') || '.',
        '/calendar',
        jsonb_build_object('appointment_id', v.id, 'new_scheduled_at', p_new_at)
    );

    RETURN jsonb_build_object('status', 'ok', 'new_scheduled_at', p_new_at);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_reschedule_token(TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_reschedule_token(TEXT, TIMESTAMPTZ) TO anon, authenticated, service_role;
