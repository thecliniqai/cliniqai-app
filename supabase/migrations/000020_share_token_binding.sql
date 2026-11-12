-- Migration: 000020_share_token_binding.sql
-- V2-01 plan 01-04 (P0-04; SEC-05, ARC-05, F7(a)); ADR-0005 Decision 3: public links resolve through SECURITY DEFINER
-- RPCs scoped to the token, bound to the token's tenant and resource_type, never through service-role queries.
--
-- 1. Expand: system-issued tokens have no creator (D9: created_by nullable); 'appointment' resource type;
--    resource_id backfilled from document_id.
-- 2. Members get SELECT only; INSERT/UPDATE/DELETE only through the functions below.
-- 3. create_share_token(type, id): tenant derived from the resource row, caller must be a member of it.
-- 4. create_reschedule_token(visit_id): service_role only (inbound messaging webhook).
-- 5. resolve_share_token(token, kinds): anon-callable; resource fetched by id AND the token's tenant; returns display
--    fields only (no ids, no storage paths); increments access_count in the same transaction.
-- 6. share_token_object(token, kinds): service_role only; the storage target for signing (tenant, bucket, path).
-- 7. get_reschedule_context / consume_reschedule_token: anon-callable, type 'appointment' only; consume is single-use
--    (token row locked and revoked in the same transaction as the visit update and the front-desk notification).

-- 1. Expand ------------------------------------------------------------------------------------------------------
ALTER TABLE public.document_share_tokens ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE public.document_share_tokens DROP CONSTRAINT IF EXISTS document_share_tokens_resource_type_check;
ALTER TABLE public.document_share_tokens ADD CONSTRAINT document_share_tokens_resource_type_check
    CHECK (resource_type IN ('patient_document', 'prescription', 'invoice', 'referral', 'appointment'));

-- Local/staging data only (no live clinics, PO-15).
UPDATE public.document_share_tokens
SET resource_id = document_id
WHERE resource_id IS NULL AND document_id IS NOT NULL;

-- 2. Privileges and policy -----------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "doc_tokens_staff_manage" ON public.document_share_tokens;
DROP POLICY IF EXISTS "doc_tokens_select_tenant" ON public.document_share_tokens;

CREATE POLICY "doc_tokens_select_tenant"
ON public.document_share_tokens
FOR SELECT
TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.document_share_tokens FROM anon, authenticated;

-- 3. Internal helpers (no EXECUTE for API roles) ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.share_resource_tenant(p_type TEXT, p_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE p_type
        WHEN 'patient_document' THEN (SELECT d.tenant_id FROM public.patient_documents d WHERE d.id = p_id)
        WHEN 'prescription'     THEN (SELECT r.tenant_id FROM public.prescriptions r WHERE r.id = p_id)
        WHEN 'invoice'          THEN (SELECT i.tenant_id FROM public.invoices i WHERE i.id = p_id)
        WHEN 'referral'         THEN (SELECT f.tenant_id FROM public.referrals f WHERE f.id = p_id)
        WHEN 'appointment'      THEN (SELECT v.tenant_id FROM public.visits v WHERE v.id = p_id)
    END;
$$;

REVOKE EXECUTE ON FUNCTION public.share_resource_tenant(TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- The resource behind a token, read by (resource id, token tenant). Returns NULL when the resource does not exist in
-- the token's tenant. Keys prefixed "_" are internal (storage target) and are stripped from public responses.
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
            '_storage_path', d.storage_path
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
            '_storage_path', COALESCE(NULLIF(r.pdf_storage_path, ''), r.tenant_id::TEXT || '/' || r.id::TEXT || '.pdf')
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
            '_storage_path', COALESCE(
                NULLIF(f.pdf_storage_path, ''),
                'tenants/' || f.tenant_id::TEXT || '/referrals/' || f.id::TEXT || '/referral_letter.pdf'
            )
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

-- 4. Staff creation -----------------------------------------------------------------------------------------------
-- Errors: 28000 not_authenticated; 22023 invalid_resource_type; P0002 not_found (resource missing or in a tenant the
-- caller does not belong to; the two are indistinguishable).
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
    v_token TEXT := encode(extensions.gen_random_bytes(32), 'hex');
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;

    IF p_resource_type IS NULL OR p_resource_type NOT IN ('patient_document', 'prescription', 'invoice', 'referral') THEN
        RAISE EXCEPTION 'invalid_resource_type' USING ERRCODE = '22023';
    END IF;

    v_tenant := public.share_resource_tenant(p_resource_type, p_resource_id);

    IF v_tenant IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.memberships m WHERE m.tenant_id = v_tenant AND m.user_id = v_uid
    ) THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    RETURN QUERY
    INSERT INTO public.document_share_tokens AS t
        (tenant_id, document_id, resource_type, resource_id, token, expires_at, created_by)
    VALUES (
        v_tenant,
        CASE WHEN p_resource_type = 'patient_document' THEN p_resource_id END,
        p_resource_type,
        p_resource_id,
        v_token,
        now() + INTERVAL '7 days',
        v_uid
    )
    RETURNING t.token, t.expires_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_share_token(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_share_token(TEXT, UUID) TO authenticated;

-- 5. System creation (inbound messaging webhook only) -------------------------------------------------------------
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

    INSERT INTO public.document_share_tokens
        (tenant_id, document_id, resource_type, resource_id, token, expires_at, created_by)
    VALUES (v_tenant, NULL, 'appointment', p_visit_id, v_token, now() + INTERVAL '24 hours', NULL);

    RETURN v_token;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_reschedule_token(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_reschedule_token(UUID) TO service_role;

-- 6. Public resolution (document links) ---------------------------------------------------------------------------
-- Returns {status: not_found|revoked|expired|ok, ...}. A token whose resource_type is not in p_kinds, or whose resource
-- is not in the token's tenant, is not_found (same answer as a missing token). Only 'ok' increments access_count.
CREATE OR REPLACE FUNCTION public.resolve_share_token(p_token TEXT, p_kinds TEXT[])
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    t public.document_share_tokens;
    v_rid UUID;
    v_res JSONB;
    v_clinic JSONB;
BEGIN
    IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 128 THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    SELECT * INTO t FROM public.document_share_tokens s WHERE s.token = p_token FOR UPDATE;

    IF NOT FOUND
       OR t.resource_type NOT IN ('patient_document', 'prescription', 'invoice', 'referral')
       OR p_kinds IS NULL
       OR NOT (t.resource_type = ANY (p_kinds)) THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    v_rid := COALESCE(t.resource_id, CASE WHEN t.resource_type = 'patient_document' THEN t.document_id END);

    SELECT jsonb_build_object('name', c.name, 'phone', c.phone, 'address', c.address, 'logo_url', c.logo_url)
    INTO v_clinic
    FROM public.tenants c
    WHERE c.id = t.tenant_id;

    IF t.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'revoked', 'clinic', v_clinic - 'address' - 'logo_url');
    END IF;

    IF t.expires_at <= now() THEN
        RETURN jsonb_build_object('status', 'expired', 'clinic', v_clinic - 'address' - 'logo_url');
    END IF;

    v_res := public.share_token_resource(t.tenant_id, t.resource_type, v_rid);
    IF v_res IS NULL THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    UPDATE public.document_share_tokens
    SET access_count = access_count + 1,
        last_accessed_at = now()
    WHERE id = t.id;

    RETURN (v_res - '_bucket' - '_storage_path') || jsonb_build_object(
        'status', 'ok',
        'resource_type', t.resource_type,
        'expires_at', t.expires_at,
        'clinic', v_clinic
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_share_token(TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_share_token(TEXT, TEXT[]) TO anon, authenticated, service_role;

-- Storage target for signing (service_role only; called from features/sharing/system.ts after a successful resolve).
-- Same validity rules as resolve_share_token; does not count an access.
CREATE OR REPLACE FUNCTION public.share_token_object(p_token TEXT, p_kinds TEXT[])
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    t public.document_share_tokens;
    v_rid UUID;
    v_res JSONB;
BEGIN
    SELECT * INTO t FROM public.document_share_tokens s WHERE s.token = p_token;

    IF NOT FOUND
       OR t.resource_type NOT IN ('patient_document', 'prescription', 'invoice', 'referral')
       OR p_kinds IS NULL
       OR NOT (t.resource_type = ANY (p_kinds))
       OR t.revoked_at IS NOT NULL
       OR t.expires_at <= now() THEN
        RETURN NULL;
    END IF;

    v_rid := COALESCE(t.resource_id, CASE WHEN t.resource_type = 'patient_document' THEN t.document_id END);
    v_res := public.share_token_resource(t.tenant_id, t.resource_type, v_rid);
    IF v_res IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN jsonb_build_object(
        'tenant_id', t.tenant_id,
        'resource_type', t.resource_type,
        'resource_id', v_rid,
        'bucket', v_res ->> '_bucket',
        'storage_path', v_res ->> '_storage_path',
        'original_filename', v_res ->> 'original_filename'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.share_token_object(TEXT, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.share_token_object(TEXT, TEXT[]) TO service_role;

-- 7. Public reschedule link ---------------------------------------------------------------------------------------
-- Context for the reschedule page: clinic, doctor, current time, the doctor's availability and the booked times in
-- [p_from, p_to]. status: not_found | revoked | expired | closed | ok. No ids or patient contact data are returned.
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
    v_booked JSONB;
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

    SELECT COALESCE(jsonb_agg(b.scheduled_at ORDER BY b.scheduled_at), '[]'::JSONB)
    INTO v_booked
    FROM public.visits b
    WHERE b.tenant_id = t.tenant_id
      AND b.doctor_id = v.doctor_id
      AND b.scheduled_at >= p_from
      AND b.scheduled_at <= p_to
      AND b.status IN ('booked', 'confirmed', 'waiting', 'in_consultation');

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

-- Single-use reschedule. The token row is locked; a concurrent second call waits, then sees revoked_at and gets
-- 'revoked'. status: invalid_time | not_found | revoked | expired | closed | ok. No ids are returned.
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

    SELECT * INTO v FROM public.visits x
    WHERE x.id = t.resource_id AND x.tenant_id = t.tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    IF v.status IN ('completed', 'cancelled') THEN
        RETURN jsonb_build_object('status', 'closed', 'visit_status', v.status);
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

-- The visit behind an appointment token that was just consumed (service_role only), for the server-side follow-up
-- after consume_reschedule_token returned 'ok' (patient confirmation message, webhook event). Returns NULL unless
-- the token is an appointment token that has been used and its visit is in the token's tenant.
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
      AND s.revoked_at IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.reschedule_token_visit(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_token_visit(TEXT) TO service_role;
