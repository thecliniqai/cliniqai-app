-- Migration: 000021_review_fixes.sql
-- V2-01 plan 01-08 (review fixes; reviews/review-independent.md = IR, reviews/review-adversarial.md = AR).
--
-- 1. AR-M1: the storage object behind a share token is derived from, or verified against, the resource's own tenant,
--    patient and id (a stored path that points anywhere else is never signed). The receiving clinic of a referral may
--    only acknowledge it (status 'sent' -> 'acknowledged', acknowledged_at, updated_at); every other column stays as
--    the originating clinic wrote it.
-- 2. IR-M2 / AR-M2: create_share_token requires, per resource type, a role holding the app permission that the
--    matching share action checks; the token is audited inside the function; revoke_share_token(token_id).
-- 3. AR-L2: self-service reschedule limited to 90 days ahead and refused when the doctor already has an active visit
--    in that slot; a newly issued reschedule link revokes the visit's earlier unused links; the booked-times lookup is
--    clamped to one day.
-- 4. AR-L3: memberships.default_slot_duration_minutes between 5 and 120; availability_schedule must be a weekly
--    schedule object of HH:MM shifts (start < end, at most 8 per day).
-- 5. AR-L4: medical credentials (qualifications, medical_council_reg_no) are changed only by the member or an owner;
--    the name and phone of an owner/admin row only by that member or an owner.
-- 6. IR-L4: search_medicines calls pg_trgm's similarity() in whichever schema the extension lives in (resolved when
--    this migration runs; search_path stays '').
-- Signatures of existing functions are unchanged (expand-safe).

-- 1a. Share target binding -----------------------------------------------------------------------------------------
-- patient_document: tenants/<tenant>/patients/<patient>/...   (features/labs/service.ts uploadLabDocument)
-- prescription:     <tenant>/<visit>/...                      (features/prescriptions/pdf/generator.ts)
-- invoice:          <tenant>/receipts/inv_<invoice>.pdf       (derived; features/billing/pdf/generator.ts)
-- referral:         tenants/<tenant>/referrals/<referral>/referral_letter.pdf (derived, the stored column is ignored)
-- A stored path outside its prefix, or containing '..', yields a NULL _storage_path: nothing is signed.
CREATE OR REPLACE FUNCTION public.share_token_resource(p_tenant_id UUID, p_type TEXT, p_resource_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v JSONB;
BEGIN
    IF p_resource_id IS NULL OR p_tenant_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF p_type = 'patient_document' THEN
        SELECT jsonb_build_object(
            'title', COALESCE(NULLIF(d.title, ''), 'Lab Report'),
            'document_type', COALESCE(d.document_type, 'lab_report'),
            'original_filename', COALESCE(NULLIF(d.original_filename, ''), 'report.pdf'),
            'mime_type', COALESCE(NULLIF(d.mime_type, ''), 'application/pdf'),
            'report_date', COALESCE(to_jsonb(d.report_date), to_jsonb(d.created_at)),
            'file_size_bytes', d.file_size_bytes,
            'is_abnormal', d.is_abnormal,
            'notes', d.notes,
            'patient_name', COALESCE(p.full_name, 'Patient'),
            '_bucket', 'clinic-records',
            '_storage_path', CASE
                WHEN starts_with(d.storage_path, 'tenants/' || d.tenant_id::TEXT || '/patients/' || d.patient_id::TEXT || '/')
                     AND strpos(d.storage_path, '..') = 0
                THEN d.storage_path
            END
        ) INTO v
        FROM public.patient_documents d
        LEFT JOIN public.patients p ON p.id = d.patient_id AND p.tenant_id = d.tenant_id
        WHERE d.id = p_resource_id AND d.tenant_id = p_tenant_id;
    ELSIF p_type = 'prescription' THEN
        SELECT jsonb_build_object(
            'title', 'Official Prescription',
            'document_type', 'prescription',
            'original_filename', 'Prescription_' || left(r.id::TEXT, 8) || '.pdf',
            'mime_type', 'application/pdf',
            'report_date', to_jsonb(r.created_at),
            'patient_name', COALESCE(p.full_name, 'Patient'),
            '_bucket', 'prescriptions',
            '_storage_path', CASE
                WHEN r.visit_id IS NOT NULL
                     AND starts_with(r.pdf_storage_path, r.tenant_id::TEXT || '/' || r.visit_id::TEXT || '/')
                     AND strpos(r.pdf_storage_path, '..') = 0
                THEN r.pdf_storage_path
            END
        ) INTO v
        FROM public.prescriptions r
        LEFT JOIN public.patients p ON p.id = r.patient_id AND p.tenant_id = r.tenant_id
        WHERE r.id = p_resource_id AND r.tenant_id = p_tenant_id;
    ELSIF p_type = 'invoice' THEN
        SELECT jsonb_build_object(
            'title', 'Payment Receipt #' || COALESCE(i.invoice_number, ''),
            'document_type', 'invoice',
            'original_filename', 'Receipt_' || COALESCE(NULLIF(i.invoice_number, ''), left(i.id::TEXT, 8)) || '.pdf',
            'mime_type', 'application/pdf',
            'report_date', to_jsonb(i.created_at),
            'patient_name', COALESCE(p.full_name, 'Patient'),
            '_bucket', 'prescriptions',
            '_storage_path', i.tenant_id::TEXT || '/receipts/inv_' || i.id::TEXT || '.pdf'
        ) INTO v
        FROM public.invoices i
        LEFT JOIN public.patients p ON p.id = i.patient_id AND p.tenant_id = i.tenant_id
        WHERE i.id = p_resource_id AND i.tenant_id = p_tenant_id;
    ELSIF p_type = 'referral' THEN
        SELECT jsonb_build_object(
            'title', 'Referral Letter — ' || COALESCE(NULLIF(f.referred_to_name, ''), 'Specialist'),
            'document_type', 'referral',
            'original_filename', 'Referral_' || left(f.id::TEXT, 8) || '.pdf',
            'mime_type', 'application/pdf',
            'report_date', to_jsonb(f.created_at),
            'patient_name', COALESCE(p.full_name, 'Patient'),
            '_bucket', 'clinic-records',
            '_storage_path', 'tenants/' || f.tenant_id::TEXT || '/referrals/' || f.id::TEXT || '/referral_letter.pdf'
        ) INTO v
        FROM public.referrals f
        LEFT JOIN public.patients p ON p.id = f.patient_id AND p.tenant_id = f.tenant_id
        WHERE f.id = p_resource_id AND f.tenant_id = p_tenant_id;
    ELSE
        RETURN NULL;
    END IF;

    RETURN v;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.share_token_resource(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- 1b. Receiving clinic of a referral: acknowledge only ------------------------------------------------------------
-- The policy "referrals_target_tenant_update" (000013) stays, since acknowledgeReferral (features/referrals/service.ts)
-- updates through it; this trigger narrows what it can change. A member of the originating tenant (tenant_id) is not
-- restricted here (policy "referrals_originating_tenant_manage"); system writes (no JWT user) are not restricted.
CREATE OR REPLACE FUNCTION public.referrals_target_update_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL OR OLD.tenant_id IN (SELECT public.current_user_tenant_ids()) THEN
        RETURN NEW;
    END IF;

    IF (to_jsonb(NEW) - ARRAY['status', 'acknowledged_at', 'updated_at'])
           IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'acknowledged_at', 'updated_at'])
       OR NOT (NEW.status = OLD.status OR (OLD.status = 'sent' AND NEW.status = 'acknowledged')) THEN
        RAISE EXCEPTION 'referral_target_update_forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.referrals_target_update_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS referrals_target_update_guard ON public.referrals;
CREATE TRIGGER referrals_target_update_guard
BEFORE UPDATE ON public.referrals
FOR EACH ROW
EXECUTE FUNCTION public.referrals_target_update_guard();

-- 2. Share token creation and revocation --------------------------------------------------------------------------
-- Roles allowed to mint or revoke a link of each type. Mirrors the app permission each share action checks
-- (lib/permissions/matrix.ts ROLE_PERMISSIONS; SHARE_LINK_PERMISSIONS in features/sharing/tokens.ts; keep in sync,
-- tests/security/review-fixes-db.spec.ts compares the two for every role and type):
--   prescription     consultations:view  (sharePrescriptionViaWhatsApp, sendConsolidatedConsultationWhatsApp)
--                                         -> owner, doctor, nurse
--   invoice          billing:view (shareReceiptViaWhatsApp) or consultations:view (sendConsolidatedConsultationWhatsApp,
--                                         the visit's own receipt) -> owner, admin, doctor, nurse
--   patient_document patients:view       (generateDocumentShareToken, shareLabReportViaWhatsApp) -> all roles
--   referral         patients:view       (shareReferralLetterViaWhatsApp) -> all roles
--   appointment      appointments:edit   (revoke only; these links are system-issued) -> all roles
CREATE OR REPLACE FUNCTION public.share_type_roles(p_type TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_type
        WHEN 'prescription'     THEN ARRAY['owner', 'doctor', 'nurse']
        WHEN 'invoice'          THEN ARRAY['owner', 'admin', 'doctor', 'nurse']
        WHEN 'patient_document' THEN ARRAY['owner', 'admin', 'doctor', 'receptionist', 'nurse']
        WHEN 'referral'         THEN ARRAY['owner', 'admin', 'doctor', 'receptionist', 'nurse']
        WHEN 'appointment'      THEN ARRAY['owner', 'admin', 'doctor', 'receptionist', 'nurse']
        ELSE ARRAY[]::TEXT[]
    END;
$$;

REVOKE EXECUTE ON FUNCTION public.share_type_roles(TEXT) FROM PUBLIC, anon, authenticated;

-- Errors: 28000 not_authenticated; 22023 invalid_resource_type; P0002 not_found (resource missing or in a tenant the
-- caller does not belong to); 42501 forbidden (the caller's role may not share this type). The audit row carries the
-- token id, never the token.
CREATE OR REPLACE FUNCTION public.create_share_token(p_resource_type TEXT, p_resource_id UUID)
RETURNS TABLE (token TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_tenant UUID;
    v_role TEXT;
    v_id UUID;
    v_token TEXT := encode(extensions.gen_random_bytes(32), 'hex');
    v_expires TIMESTAMPTZ := now() + INTERVAL '7 days';
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;

    IF p_resource_type IS NULL OR p_resource_type NOT IN ('patient_document', 'prescription', 'invoice', 'referral') THEN
        RAISE EXCEPTION 'invalid_resource_type' USING ERRCODE = '22023';
    END IF;

    v_tenant := public.share_resource_tenant(p_resource_type, p_resource_id);

    IF v_tenant IS NOT NULL THEN
        SELECT m.role INTO v_role FROM public.memberships m WHERE m.tenant_id = v_tenant AND m.user_id = v_uid;
    END IF;

    IF v_role IS NULL THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT (v_role = ANY (public.share_type_roles(p_resource_type))) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.document_share_tokens
        (tenant_id, document_id, resource_type, resource_id, token, expires_at, created_by)
    VALUES (
        v_tenant,
        CASE WHEN p_resource_type = 'patient_document' THEN p_resource_id END,
        p_resource_type,
        p_resource_id,
        v_token,
        v_expires,
        v_uid
    )
    RETURNING id INTO v_id;

    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, entity_type, entity_id, metadata)
    VALUES (
        v_tenant,
        v_uid,
        v_role,
        'share_token.create',
        p_resource_type,
        p_resource_id,
        jsonb_build_object('token_id', v_id, 'expires_at', v_expires)
    );

    RETURN QUERY SELECT v_token, v_expires;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_share_token(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_share_token(TEXT, UUID) TO authenticated;

-- Revokes a link of the caller's tenant (tenant from the token row). Same role rule as creation for the token's type.
-- Returns the revocation time; revoking an already revoked link returns the original time and writes no new audit row.
-- Errors: 28000 not_authenticated; P0002 not_found (missing, or not a member of the token's tenant); 42501 forbidden.
CREATE OR REPLACE FUNCTION public.revoke_share_token(p_token_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    t public.document_share_tokens;
    v_role TEXT;
    v_now TIMESTAMPTZ := now();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO t FROM public.document_share_tokens s WHERE s.id = p_token_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    SELECT m.role INTO v_role FROM public.memberships m WHERE m.tenant_id = t.tenant_id AND m.user_id = v_uid;
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT (v_role = ANY (public.share_type_roles(t.resource_type))) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    IF t.revoked_at IS NOT NULL THEN
        RETURN t.revoked_at;
    END IF;

    UPDATE public.document_share_tokens SET revoked_at = v_now WHERE id = t.id;

    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, entity_type, entity_id, metadata)
    VALUES (
        t.tenant_id,
        v_uid,
        v_role,
        'share_token.revoke',
        t.resource_type,
        COALESCE(t.resource_id, t.document_id),
        jsonb_build_object('token_id', t.id)
    );

    RETURN v_now;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_share_token(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_share_token(UUID) TO authenticated;

-- 3. Reschedule links ---------------------------------------------------------------------------------------------
-- A new link for a visit revokes that visit's earlier unused links (only the latest link the patient received works).
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
    v_token TEXT := encode(extensions.gen_random_bytes(32), 'hex');
BEGIN
    SELECT v.tenant_id, v.status INTO v_tenant, v_status FROM public.visits v WHERE v.id = p_visit_id;

    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    IF v_status IN ('completed', 'cancelled') THEN
        RAISE EXCEPTION 'appointment_closed' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.document_share_tokens s
    SET revoked_at = now()
    WHERE s.tenant_id = v_tenant
      AND s.resource_type = 'appointment'
      AND s.resource_id = p_visit_id
      AND s.revoked_at IS NULL;

    INSERT INTO public.document_share_tokens
        (tenant_id, document_id, resource_type, resource_id, token, expires_at, created_by)
    VALUES (v_tenant, NULL, 'appointment', p_visit_id, v_token, now() + INTERVAL '24 hours', NULL);

    RETURN v_token;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_reschedule_token(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_reschedule_token(UUID) TO service_role;

-- Booked times are returned for at most one day, inside [now - 1 day, now + 91 days].
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

    SELECT * INTO t FROM public.document_share_tokens s WHERE s.token = p_token AND s.resource_type = 'appointment';
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

    IF v.status IN ('completed', 'cancelled') THEN
        RETURN jsonb_build_object('status', 'closed', 'visit_status', v.status);
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

-- status: invalid_time | too_far (more than 90 days ahead) | slot_taken (the doctor has another active visit
-- overlapping [p_new_at, p_new_at + slot length)) | not_found | revoked | expired | closed | ok. Concurrent reschedules
-- for one doctor are serialised by a transaction-scoped advisory lock so two links cannot take the same slot.
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
    WHERE s.token = p_token AND s.resource_type = 'appointment'
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
    IF v.status IN ('completed', 'cancelled') THEN
        RETURN jsonb_build_object('status', 'closed', 'visit_status', v.status);
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

-- A link that was consumed (access_count > 0 is set only by consume_reschedule_token), not one superseded by a newer
-- link (revoked by create_reschedule_token without being used).
CREATE OR REPLACE FUNCTION public.reschedule_token_visit(p_token TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object('tenant_id', v.tenant_id, 'visit_id', v.id)
    FROM public.document_share_tokens s
    JOIN public.visits v ON v.id = s.resource_id AND v.tenant_id = s.tenant_id
    WHERE s.token = p_token
      AND s.resource_type = 'appointment'
      AND s.revoked_at IS NOT NULL
      AND s.access_count > 0;
$$;

REVOKE EXECUTE ON FUNCTION public.reschedule_token_visit(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_token_visit(TEXT) TO service_role;

-- 4. Scheduling bounds on memberships -----------------------------------------------------------------------------
-- Mirrors doctorWeeklyScheduleSchema (features/settings/schema.ts): an object keyed by weekday; each day
-- {enabled: boolean, shifts: [{start: "HH:MM", end: "HH:MM"}]} with start < end and at most 8 shifts. Days may be
-- missing (the reschedule route treats a missing day as closed).
CREATE OR REPLACE FUNCTION public.is_valid_weekly_schedule(p_schedule JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_day TEXT;
    v_val JSONB;
    v_shift JSONB;
BEGIN
    IF p_schedule IS NULL THEN
        RETURN TRUE;
    END IF;
    IF jsonb_typeof(p_schedule) <> 'object' THEN
        RETURN FALSE;
    END IF;

    FOR v_day, v_val IN SELECT e.key, e.value FROM jsonb_each(p_schedule) e LOOP
        IF v_day NOT IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday') THEN
            RETURN FALSE;
        END IF;
        IF jsonb_typeof(v_val) <> 'object'
           OR jsonb_typeof(v_val -> 'enabled') IS DISTINCT FROM 'boolean'
           OR jsonb_typeof(v_val -> 'shifts') IS DISTINCT FROM 'array'
           OR jsonb_array_length(v_val -> 'shifts') > 8 THEN
            RETURN FALSE;
        END IF;
        FOR v_shift IN SELECT s.value FROM jsonb_array_elements(v_val -> 'shifts') s LOOP
            IF jsonb_typeof(v_shift) <> 'object'
               OR jsonb_typeof(v_shift -> 'start') IS DISTINCT FROM 'string'
               OR jsonb_typeof(v_shift -> 'end') IS DISTINCT FROM 'string'
               OR (v_shift ->> 'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
               OR (v_shift ->> 'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
               OR (v_shift ->> 'start') >= (v_shift ->> 'end') THEN
                RETURN FALSE;
            END IF;
        END LOOP;
    END LOOP;

    RETURN TRUE;
END;
$$;

ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_slot_duration_bounds;
ALTER TABLE public.memberships ADD CONSTRAINT memberships_slot_duration_bounds
    CHECK (default_slot_duration_minutes IS NULL OR default_slot_duration_minutes BETWEEN 5 AND 120) NOT VALID;
ALTER TABLE public.memberships VALIDATE CONSTRAINT memberships_slot_duration_bounds;

ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_availability_schedule_shape;
ALTER TABLE public.memberships ADD CONSTRAINT memberships_availability_schedule_shape
    CHECK (public.is_valid_weekly_schedule(availability_schedule)) NOT VALID;
ALTER TABLE public.memberships VALIDATE CONSTRAINT memberships_availability_schedule_shape;

-- 5. Credential and owner/admin identity columns ------------------------------------------------------------------
-- Policy "memberships_update_tenant" lets owners and admins update any row of their tenant. Narrowed here: medical
-- credentials only by the member themself or an owner; full_name/phone of an owner or admin row likewise. System
-- writes (no JWT user) and SECURITY DEFINER role changes (role column only) are unaffected.
CREATE OR REPLACE FUNCTION public.memberships_profile_update_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL OR OLD.user_id = auth.uid()
       OR public.current_user_has_role(OLD.tenant_id, ARRAY['owner']) THEN
        RETURN NEW;
    END IF;

    IF NEW.qualifications IS DISTINCT FROM OLD.qualifications
       OR NEW.medical_council_reg_no IS DISTINCT FROM OLD.medical_council_reg_no THEN
        RAISE EXCEPTION 'credentials_self_or_owner' USING ERRCODE = '42501';
    END IF;

    IF OLD.role IN ('owner', 'admin')
       AND (NEW.full_name IS DISTINCT FROM OLD.full_name OR NEW.phone IS DISTINCT FROM OLD.phone) THEN
        RAISE EXCEPTION 'owner_required' USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.memberships_profile_update_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS memberships_profile_update_guard ON public.memberships;
CREATE TRIGGER memberships_profile_update_guard
BEFORE UPDATE ON public.memberships
FOR EACH ROW
EXECUTE FUNCTION public.memberships_profile_update_guard();

-- 6. search_medicines: pg_trgm in any schema ------------------------------------------------------------------------
-- Supabase projects may have pg_trgm in `extensions` (dashboard default) or `public` (000007 on a fresh database).
-- The schema is resolved now and written into the function as a quoted identifier, so search_path stays '' and no
-- unqualified name is resolved at call time. If the extension is later moved (ALTER EXTENSION ... SET SCHEMA),
-- re-create the function the same way.
DO $migration$
DECLARE
    v_schema TEXT;
    v_sql TEXT;
BEGIN
    SELECT n.nspname INTO v_schema
    FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm';

    IF v_schema IS NULL THEN
        RAISE EXCEPTION 'search_medicines requires the pg_trgm extension';
    END IF;

    v_sql := $fn$
CREATE OR REPLACE FUNCTION public.search_medicines(
    p_query TEXT,
    p_doctor_id UUID,
    p_tenant_id UUID,
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    id TEXT,
    medicine_name TEXT,
    generic_name TEXT,
    dose_form TEXT,
    default_dosage TEXT,
    default_timing TEXT,
    default_duration TEXT,
    is_custom BOOLEAN,
    is_favorite BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $body$
DECLARE
    v_clean_query TEXT := trim(COALESCE(p_query, ''));
BEGIN
    IF NOT (
        (SELECT auth.role()) = 'service_role'
        OR (
            p_tenant_id IN (SELECT public.current_user_tenant_ids())
            AND p_doctor_id = auth.uid()
        )
    ) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    WITH custom_matches AS (
        SELECT
            cm.id::TEXT AS id,
            cm.medicine_name,
            cm.generic_name,
            cm.dose_form,
            cm.default_dosage,
            cm.default_timing,
            cm.default_duration,
            true AS is_custom,
            true AS is_favorite,
            cm.use_count
        FROM public.doctor_custom_medicines cm
        WHERE cm.tenant_id = p_tenant_id
          AND cm.doctor_id = p_doctor_id
          AND (
              v_clean_query = ''
              OR cm.medicine_name ILIKE '%' || v_clean_query || '%'
              OR COALESCE(cm.generic_name, '') ILIKE '%' || v_clean_query || '%'
          )
    ),
    cdci_matches AS (
        SELECT
            c.id,
            c.brand_name AS medicine_name,
            c.generic_name,
            c.dose_form,
            NULL::TEXT AS default_dosage,
            'After food'::TEXT AS default_timing,
            '5 days'::TEXT AS default_duration,
            false AS is_custom,
            false AS is_favorite,
            0 AS use_count
        FROM public.cdci_medicines_search c
        WHERE (
            v_clean_query = ''
            OR c.brand_name ILIKE '%' || v_clean_query || '%'
            OR COALESCE(c.generic_name, '') ILIKE '%' || v_clean_query || '%'
            OR c.search_vector @@ to_tsquery('simple', replace(v_clean_query, ' ', ' & ') || ':*')
            OR @TRGM@.similarity(c.brand_name, v_clean_query) > 0.2
            OR (c.generic_name IS NOT NULL AND @TRGM@.similarity(c.generic_name, v_clean_query) > 0.2)
        )
        AND NOT EXISTS (
            SELECT 1 FROM custom_matches cm2 WHERE lower(cm2.medicine_name) = lower(c.brand_name)
        )
    )
    SELECT
        q.id,
        q.medicine_name,
        q.generic_name,
        q.dose_form,
        q.default_dosage,
        q.default_timing,
        q.default_duration,
        q.is_custom,
        q.is_favorite
    FROM (
        SELECT * FROM custom_matches
        UNION ALL
        SELECT * FROM cdci_matches
    ) q
    ORDER BY q.is_favorite DESC, q.use_count DESC, q.medicine_name ASC
    LIMIT p_limit;
END;
$body$;
$fn$;

    EXECUTE replace(v_sql, '@TRGM@', pg_catalog.quote_ident(v_schema));
END;
$migration$;

REVOKE EXECUTE ON FUNCTION public.search_medicines(TEXT, UUID, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_medicines(TEXT, UUID, UUID, INTEGER) TO authenticated, service_role;
