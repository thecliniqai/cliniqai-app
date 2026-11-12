-- Migration: 000022_share_path_and_token_hash.sql
-- V2-01 plan 01-09 (review round 2; reviews/review2-adversarial.md = AR2).
--
-- 1. AR2-H1: storage keys are [A-Za-z0-9_./-] with no empty, '.' or '..' segments (is_safe_storage_key). A key such as
--    'tenants/<A>/patients/<P>/%2e%2e/%2e%2e/...' passed the 000021 prefix + "no literal .." check, and the URL parser
--    in the storage client collapsed the encoded dots, so the service role signed another tenant's object.
--    share_object_path() is the one rule for "the object this row may point at"; share_token_resource (the share-link
--    resolver) and the CHECK constraints on the stored path columns both use it:
--      patient_document  tenants/<tenant>/patients/<patient>/<safe key>
--      prescription      <tenant>/<visit>/rx_v<digits>.pdf           (features/prescriptions/pdf/generator.ts)
--      referral          tenants/<tenant>/referrals/<safe key>       (the share link derives the letter path anyway)
--    The CHECKs are added NOT VALID (enforced for every new write) and validated here when no existing row breaks them;
--    otherwise a WARNING names the constraint and the resolver still refuses the bad rows (validate in a later
--    migration after cleaning). Production starts empty, so there they are validated.
-- 2. AR2-L1 (supersedes the F17 deferral): share tokens are stored only as SHA-256 hex hashes (token_hash). The raw
--    token is returned once by create_share_token / create_reschedule_token and is never stored; every lookup hashes the
--    presented token. Expand (token_hash, backfilled), migrate (functions), contract (the raw `token` column is dropped)
--    in one migration: no live data (PO-15) and nothing else reads the column.
-- Function signatures are unchanged.

-- 1. Storage key rules -------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_safe_storage_key(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT COALESCE(
        length(p_path) BETWEEN 1 AND 512
        AND p_path ~ '^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$'
        AND ('/' || p_path || '/') !~ '/\.\.?/',
        FALSE
    );
$$;

-- The stored path if it is a safe key in the place this resource's object lives, else NULL. p_owner_id is the patient
-- (patient_document), the visit (prescription) or the referral (referral).
CREATE OR REPLACE FUNCTION public.share_object_path(p_type TEXT, p_tenant_id UUID, p_owner_id UUID, p_path TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_tenant_id IS NULL OR p_owner_id IS NULL OR NOT public.is_safe_storage_key(p_path) THEN NULL
        WHEN p_type = 'patient_document'
             AND starts_with(p_path, 'tenants/' || p_tenant_id::TEXT || '/patients/' || p_owner_id::TEXT || '/')
            THEN p_path
        WHEN p_type = 'prescription'
             AND p_path ~ ('^' || p_tenant_id::TEXT || '/' || p_owner_id::TEXT || '/rx_v[0-9]{1,9}\.pdf$')
            THEN p_path
        WHEN p_type = 'referral'
             AND starts_with(p_path, 'tenants/' || p_tenant_id::TEXT || '/referrals/')
            THEN p_path
    END;
$$;

-- Pure functions; EXECUTE is needed by the roles that write the checked tables (CHECK constraints run as the writer).
REVOKE EXECUTE ON FUNCTION public.is_safe_storage_key(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.share_object_path(TEXT, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_safe_storage_key(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.share_object_path(TEXT, UUID, UUID, TEXT) TO authenticated, service_role;

-- 1a. Share-link resolver: the object path goes through share_object_path (patient document, prescription) or is
-- derived (invoice, referral). Otherwise as 000021.
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
            '_storage_path', public.share_object_path('patient_document', d.tenant_id, d.patient_id, d.storage_path)
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
            '_storage_path', public.share_object_path('prescription', r.tenant_id, r.visit_id, r.pdf_storage_path)
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

-- 1b. CHECK constraints on the stored path columns ---------------------------------------------------------------
ALTER TABLE public.patient_documents DROP CONSTRAINT IF EXISTS patient_documents_storage_path_shape;
ALTER TABLE public.patient_documents ADD CONSTRAINT patient_documents_storage_path_shape
    CHECK (public.share_object_path('patient_document', tenant_id, patient_id, storage_path) IS NOT NULL) NOT VALID;

ALTER TABLE public.prescriptions DROP CONSTRAINT IF EXISTS prescriptions_pdf_storage_path_shape;
ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_pdf_storage_path_shape
    CHECK (pdf_storage_path IS NULL
           OR public.share_object_path('prescription', tenant_id, visit_id, pdf_storage_path) IS NOT NULL) NOT VALID;

ALTER TABLE public.referrals DROP CONSTRAINT IF EXISTS referrals_pdf_storage_path_shape;
ALTER TABLE public.referrals ADD CONSTRAINT referrals_pdf_storage_path_shape
    CHECK (pdf_storage_path IS NULL
           OR public.share_object_path('referral', tenant_id, id, pdf_storage_path) IS NOT NULL) NOT VALID;

DO $migration$
DECLARE
    v_check RECORD;
    v_bad BOOLEAN;
BEGIN
    FOR v_check IN
        SELECT * FROM (VALUES
            ('patient_documents', 'patient_documents_storage_path_shape',
             'public.share_object_path(''patient_document'', tenant_id, patient_id, storage_path) IS NULL'),
            ('prescriptions', 'prescriptions_pdf_storage_path_shape',
             'pdf_storage_path IS NOT NULL AND public.share_object_path(''prescription'', tenant_id, visit_id, pdf_storage_path) IS NULL'),
            ('referrals', 'referrals_pdf_storage_path_shape',
             'pdf_storage_path IS NOT NULL AND public.share_object_path(''referral'', tenant_id, id, pdf_storage_path) IS NULL')
        ) AS c(tbl, con, bad_rows)
    LOOP
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE %s)', v_check.tbl, v_check.bad_rows) INTO v_bad;
        IF v_bad THEN
            RAISE WARNING '% left NOT VALID: existing rows break it (the share resolver refuses them); clean and validate in a later migration', v_check.con;
        ELSE
            EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', v_check.tbl, v_check.con);
        END IF;
    END LOOP;
END;
$migration$;

-- 2. Share tokens stored as hashes -------------------------------------------------------------------------------
-- SHA-256 of the token's UTF-8 bytes, lowercase hex (same value as encode(extensions.digest(token, 'sha256'), 'hex');
-- pg_catalog.sha256 needs no extension schema).
CREATE OR REPLACE FUNCTION public.share_token_hash(p_token TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
    SELECT encode(pg_catalog.sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

REVOKE EXECUTE ON FUNCTION public.share_token_hash(TEXT) FROM PUBLIC, anon, authenticated;

-- Expand + backfill.
ALTER TABLE public.document_share_tokens ADD COLUMN IF NOT EXISTS token_hash TEXT;

DO $migration$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'document_share_tokens' AND column_name = 'token'
    ) THEN
        EXECUTE 'UPDATE public.document_share_tokens SET token_hash = public.share_token_hash(token) WHERE token_hash IS NULL';
    END IF;
END;
$migration$;

ALTER TABLE public.document_share_tokens ALTER COLUMN token_hash SET NOT NULL;
ALTER TABLE public.document_share_tokens DROP CONSTRAINT IF EXISTS document_share_tokens_token_hash_key;
ALTER TABLE public.document_share_tokens ADD CONSTRAINT document_share_tokens_token_hash_key UNIQUE (token_hash);
ALTER TABLE public.document_share_tokens DROP CONSTRAINT IF EXISTS document_share_tokens_token_hash_shape;
ALTER TABLE public.document_share_tokens ADD CONSTRAINT document_share_tokens_token_hash_shape
    CHECK (token_hash ~ '^[0-9a-f]{64}$');

-- 2a. Creation: the raw token is returned once, only its hash is stored. Otherwise as 000021.
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
        (tenant_id, document_id, resource_type, resource_id, token_hash, expires_at, created_by)
    VALUES (
        v_tenant,
        CASE WHEN p_resource_type = 'patient_document' THEN p_resource_id END,
        p_resource_type,
        p_resource_id,
        public.share_token_hash(v_token),
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
        (tenant_id, document_id, resource_type, resource_id, token_hash, expires_at, created_by)
    VALUES (v_tenant, NULL, 'appointment', p_visit_id, public.share_token_hash(v_token), now() + INTERVAL '24 hours', NULL);

    RETURN v_token;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_reschedule_token(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_reschedule_token(UUID) TO service_role;

-- 2b. Resolution by hash. Bodies otherwise as 000020 (resolve_share_token, share_token_object) and 000021 (reschedule).
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

    SELECT * INTO t FROM public.document_share_tokens s
    WHERE s.token_hash = public.share_token_hash(p_token)
    FOR UPDATE;

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
    IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 128 THEN
        RETURN NULL;
    END IF;

    SELECT * INTO t FROM public.document_share_tokens s WHERE s.token_hash = public.share_token_hash(p_token);

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
    WHERE s.token_hash = public.share_token_hash(p_token)
      AND s.resource_type = 'appointment'
      AND s.revoked_at IS NOT NULL
      AND s.access_count > 0;
$$;

REVOKE EXECUTE ON FUNCTION public.reschedule_token_visit(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_token_visit(TEXT) TO service_role;

-- 2c. Contract: the raw token column (and its indexes) goes. Members keep SELECT on the rows (id, hash, state) for the
-- in-app link list; a hash cannot be presented as a link.
ALTER TABLE public.document_share_tokens DROP COLUMN IF EXISTS token;
