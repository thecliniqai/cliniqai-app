-- Migration: 000101_patient_search_register.sql
-- V2-08 08-02 (R-11, R-12, P1-30, P2-08, P0-14, AI-14): one way to find a patient and one way to register one.
--
-- Before: five search UIs ran `select *` through PostgREST `ilike` filters on unindexed columns, two of them from a client
-- chain (patient insert, then visit); `createPatient` was an insert plus an app-side audit with no idempotency, and the
-- duplicate check returned whole patient rows to the browser.
--
-- 1. Trigram GIN indexes (P2-08) on patients(full_name), patients(phone), patients(abha_id). pg_trgm lives in `public`
--    locally and in `extensions` on a dashboard-created project, so the schema is resolved here (as 000021 does for
--    search_medicines) and written into the statements; search_path stays '' everywhere.
-- 2. public.search_patients(query, limit): STABLE INVOKER, the session's active clinic, explicit minimal columns (id, name,
--    sex, age, date of birth, last four digits of the mobile, last visit, rank). A query needs two letters or three digits;
--    LIKE wildcards, the escape character and PostgREST's `*` are removed first (06-09c rules), so none matches anything
--    special. Rank: exact mobile, mobile digits contained, name prefix, trigram similarity, substring; then last visit, name.
-- 3. public.find_patient_duplicates(phone, name, dob, age): STABLE INVOKER, advisory (R-11): same mobile; same name with the
--    same date of birth or an age within two years. The same minimal columns plus the reasons. A shared family mobile
--    returns every patient on it, with age and sex.
-- 4. private.patient_input_normalize and private.step_create_patient carry `ai_processing_objected` (R-12): the objection is
--    stored at registration (the stamp trigger sets objected_at / objection_recorded_by, the audit trigger writes
--    patient.ai_objection.set). enqueue_walk_in and register_and_book pick it up through the same helpers.
-- 5. public.register_patient(tenant, patient, request): the registration command, V2-07 pattern (SECURITY DEFINER over the
--    shared step, guard block, claim, patient.create audit row in the transaction). patients:edit (every clinic role).
-- Per-migration checklist: one new public definer command (EXECUTE: authenticated only), two new public invoker read
-- functions (EXECUTE: authenticated only), two replaced private helpers (no API grant), three indexes. No table, column,
-- policy or data change; expand-safe (the previous build keeps working: the new key is optional, nothing it calls changes).

-- 1. trigram indexes -------------------------------------------------------------------------------------------------------
DO $migration$
DECLARE
    v_schema text;
BEGIN
    SELECT n.nspname INTO v_schema
      FROM pg_catalog.pg_extension e
      JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
     WHERE e.extname = 'pg_trgm';
    IF v_schema IS NULL THEN
        RAISE EXCEPTION 'patient search requires the pg_trgm extension';
    END IF;
    EXECUTE format('CREATE INDEX idx_patients_full_name_trgm ON public.patients USING gin (full_name %I.gin_trgm_ops)', v_schema);
    EXECUTE format('CREATE INDEX idx_patients_phone_trgm ON public.patients USING gin (phone %I.gin_trgm_ops)', v_schema);
    EXECUTE format('CREATE INDEX idx_patients_abha_id_trgm ON public.patients USING gin (abha_id %I.gin_trgm_ops)', v_schema);
END;
$migration$;

-- 2. search_patients -------------------------------------------------------------------------------------------------------
DO $migration$
DECLARE
    v_schema text;
    v_sql text;
BEGIN
    SELECT n.nspname INTO v_schema
      FROM pg_catalog.pg_extension e
      JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
     WHERE e.extname = 'pg_trgm';
    IF v_schema IS NULL THEN
        RAISE EXCEPTION 'patient search requires the pg_trgm extension';
    END IF;

    v_sql := $fn$
CREATE FUNCTION public.search_patients(p_query text, p_limit integer DEFAULT 8)
RETURNS TABLE (
    id uuid,
    full_name text,
    sex text,
    age integer,
    date_of_birth date,
    phone_last4 text,
    last_visit_at timestamptz,
    rank integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $body$
DECLARE
    v_tenant uuid := (SELECT authz.full_tenant_ids() LIMIT 1);
    v_q text;
    v_digits text;
    v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 25);
BEGIN
    IF v_tenant IS NULL OR p_query IS NULL THEN
        RETURN;
    END IF;
    IF NOT public.has_permission(v_tenant, 'patients:view') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    -- The LIKE wildcards, PostgREST's `*`, the escape character and filter punctuation match nothing special: they become
    -- spaces ("%%" is no query, "_" is no per-digit oracle, "M_ena" does not find "Meena").
    v_q := btrim(regexp_replace(regexp_replace(left(p_query, 100), '[,()%_*\\]', ' ', 'g'), '\s+', ' ', 'g'));
    v_digits := regexp_replace(v_q, '\D', '', 'g');
    IF char_length(regexp_replace(v_q, '[[:digit:][:space:][:punct:]]', '', 'g')) < 2 AND char_length(v_digits) < 3 THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT m.id, m.full_name, m.sex, m.age, m.date_of_birth, m.phone_last4, m.last_visit_at, m.rank
      FROM (
            SELECT p.id, p.full_name, p.sex, p.age, p.date_of_birth,
                   CASE WHEN char_length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) >= 4
                        THEN right(regexp_replace(p.phone, '\D', '', 'g'), 4) END AS phone_last4,
                   (SELECT max(coalesce(v.scheduled_at, v.created_at))
                      FROM public.visits v
                     WHERE v.tenant_id = v_tenant AND v.patient_id = p.id
                       AND v.status IN ('waiting', 'in_consultation', 'completed')) AS last_visit_at,
                   CASE
                       WHEN char_length(v_digits) >= 10
                            AND right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) = right(v_digits, 10) THEN 1
                       WHEN char_length(v_digits) >= 3 AND p.phone LIKE '%' || v_digits || '%' THEN 2
                       WHEN p.full_name ILIKE v_q || '%' OR p.full_name ILIKE '% ' || v_q || '%' THEN 3
                       WHEN __TRGM__.similarity(p.full_name, v_q) >= 0.4 THEN 4
                       ELSE 5
                   END AS rank
              FROM public.patients p
             WHERE p.tenant_id = v_tenant AND NOT p.is_deleted AND p.erased_at IS NULL
               AND (p.full_name ILIKE '%' || v_q || '%'
                    OR (char_length(v_digits) >= 3 AND p.phone LIKE '%' || v_digits || '%')
                    OR p.abha_id ILIKE '%' || v_q || '%')
           ) m
     ORDER BY m.rank, m.last_visit_at DESC NULLS LAST, m.full_name, m.id
     LIMIT v_limit;
END;
$body$;
$fn$;
    EXECUTE replace(v_sql, '__TRGM__', quote_ident(v_schema));
END;
$migration$;
REVOKE ALL ON FUNCTION public.search_patients(text, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.search_patients(text, integer) TO authenticated;
COMMENT ON FUNCTION public.search_patients(text, integer) IS
    'V2-08 08-02 (R-11, P1-30): typeahead over the session''s active clinic (a locked clinic has none): id, full_name, sex, age, date_of_birth, phone_last4, last_visit_at, rank, at most p_limit (1-25, default 8) rows. Needs two letters or three digits; % _ * \ , ( ) become spaces. Rank 1 exact mobile, 2 mobile digits contained, 3 name prefix, 4 trigram similarity, 5 substring or ABHA; then last visit (waiting, in consultation or completed), name. SECURITY INVOKER: RLS and patients:view apply. Deleted and erased patients are not listed.';

-- 3. find_patient_duplicates ------------------------------------------------------------------------------------------------
CREATE FUNCTION public.find_patient_duplicates(p_phone text, p_name text, p_dob date, p_age integer)
RETURNS TABLE (
    id uuid,
    full_name text,
    sex text,
    age integer,
    date_of_birth date,
    phone_last4 text,
    last_visit_at timestamptz,
    reasons text[]
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid := (SELECT authz.full_tenant_ids() LIMIT 1);
    v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
    v_mobile text;
    v_name text := lower(btrim(coalesce(p_name, '')));
BEGIN
    IF v_tenant IS NULL THEN
        RETURN;
    END IF;
    IF NOT public.has_permission(v_tenant, 'patients:view') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    -- A mobile number is the last ten digits of what was typed, and an Indian mobile starts with 6-9 (the registration rule).
    IF char_length(v_digits) >= 10 AND right(v_digits, 10) ~ '^[6-9][0-9]{9}$' THEN
        v_mobile := right(v_digits, 10);
    END IF;
    IF v_mobile IS NULL AND char_length(v_name) < 3 THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT m.id, m.full_name, m.sex, m.age, m.date_of_birth, m.phone_last4, m.last_visit_at, m.reasons
      FROM (
            SELECT p.id, p.full_name, p.sex, p.age, p.date_of_birth,
                   CASE WHEN char_length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) >= 4
                        THEN right(regexp_replace(p.phone, '\D', '', 'g'), 4) END AS phone_last4,
                   (SELECT max(coalesce(v.scheduled_at, v.created_at))
                      FROM public.visits v
                     WHERE v.tenant_id = v_tenant AND v.patient_id = p.id
                       AND v.status IN ('waiting', 'in_consultation', 'completed')) AS last_visit_at,
                   array_remove(ARRAY[
                       CASE WHEN v_mobile IS NOT NULL
                                 AND right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) = v_mobile
                            THEN 'same_mobile' END,
                       CASE WHEN char_length(v_name) >= 3 AND lower(btrim(p.full_name)) = v_name
                                 AND p_dob IS NOT NULL AND p.date_of_birth = p_dob
                            THEN 'same_name_dob' END,
                       CASE WHEN char_length(v_name) >= 3 AND lower(btrim(p.full_name)) = v_name
                                 AND p_age IS NOT NULL AND p.age IS NOT NULL AND abs(p.age - p_age) <= 2
                            THEN 'same_name_age' END
                   ], NULL) AS reasons
              FROM public.patients p
             WHERE p.tenant_id = v_tenant AND NOT p.is_deleted AND p.erased_at IS NULL
           ) m
     WHERE cardinality(m.reasons) > 0
     ORDER BY (m.reasons @> ARRAY['same_mobile']) DESC, m.last_visit_at DESC NULLS LAST, m.full_name, m.id
     LIMIT 10;
END;
$$;
REVOKE ALL ON FUNCTION public.find_patient_duplicates(text, text, date, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.find_patient_duplicates(text, text, date, integer) TO authenticated;
COMMENT ON FUNCTION public.find_patient_duplicates(text, text, date, integer) IS
    'V2-08 08-02 (R-11, AI-14 basic rule): advisory duplicate candidates for a new patient in the session''s active clinic: same_mobile (the last ten digits), same_name_dob (the same name, case-insensitive, and the same date of birth) and same_name_age (the same name and an age within two years). id, full_name, sex, age, date_of_birth, phone_last4, last_visit_at, reasons; at most 10, same mobile first. A shared family mobile returns every patient on it. Never blocks a registration. SECURITY INVOKER: RLS and patients:view apply.';

-- 4. patient input and the patient step carry the AI objection -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.patient_input_normalize(p_patient jsonb)
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
    v_objected boolean := false;
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
                         'chronic_conditions', 'emergency_contact', 'abha_id', 'ai_processing_objected') THEN
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

    -- emergency_contact (000099, G-6): null or an object of the three keys the app writes (name, phone, relation), each a
    -- string of up to 200 characters.
    v_emergency := CASE WHEN jsonb_typeof(p_patient -> 'emergency_contact') = 'null' THEN NULL ELSE p_patient -> 'emergency_contact' END;
    IF v_emergency IS NOT NULL THEN
        IF jsonb_typeof(v_emergency) <> 'object' OR octet_length(v_emergency::text) > 2000 THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        FOR v_entry IN SELECT x.key, x.value FROM jsonb_each(v_emergency) x LOOP
            IF v_entry.key NOT IN ('name', 'phone', 'relation') OR jsonb_typeof(v_entry.value) <> 'string'
               OR char_length(v_entry.value #>> '{}') > 200 THEN
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
        END LOOP;
    END IF;

    IF p_patient ? 'abha_id' AND jsonb_typeof(p_patient -> 'abha_id') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    v_abha := NULLIF(btrim(p_patient ->> 'abha_id'), '');
    IF char_length(v_abha) > 64 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- ai_processing_objected (000101, R-12): absent / null = false, otherwise a boolean (the patient's AI-processing objection).
    IF p_patient ? 'ai_processing_objected' AND jsonb_typeof(p_patient -> 'ai_processing_objected') NOT IN ('boolean', 'null') THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    v_objected := coalesce((p_patient ->> 'ai_processing_objected')::boolean, false);

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
        'abha_id', v_abha,
        'ai_processing_objected', v_objected
    );
END;
$$;
REVOKE ALL ON FUNCTION private.patient_input_normalize(jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.patient_input_normalize(jsonb) IS
    'V2-07 07-03: validates and normalises a new patient for the front-desk commands (the patientSchema rules: closed key set, full_name 1-120, an Indian mobile stored as +91 and ten digits, a real date of birth, age 0-130, sex, address, up to 50 allergies / conditions, emergency_contact limited to name / phone / relation strings, abha_id, ai_processing_objected). INPUT_INVALID (P0001).';

CREATE OR REPLACE FUNCTION private.step_create_patient(p_tenant_id uuid, p_patient jsonb)
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
    -- created_by is the session user (patients_actor_guard); the clinical-field guard only watches updates. The objection
    -- stamp (objected_at, objection_recorded_by) and the patient.ai_objection.set audit row come from the existing triggers.
    INSERT INTO public.patients (tenant_id, full_name, phone, date_of_birth, age, sex, address, allergies,
                                 chronic_conditions, emergency_contact, abha_id, ai_processing_objected, created_by)
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
        (v_p ->> 'ai_processing_objected')::boolean,
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
    'V2-07 07-03 (R-7), V2-08 08-02 (R-12): the patient insert shared by register_patient, enqueue_walk_in and register_and_book: validated input (including ai_processing_objected), created_by = the session user, patient.create audit row. The caller has checked actor, clinic and patients:edit and holds the command claim; no API grant.';

-- 5. register_patient --------------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.register_patient(p_tenant_id uuid, p_patient jsonb, p_client_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_patient jsonb;
    v_replay jsonb;
    v_patient_id uuid;
    v_result jsonb;
BEGIN
    -- 1. Actor: a session; this command has no system path.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. Active clinic, then patients:edit there.
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'PATIENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'patients:edit') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    v_patient := private.patient_input_normalize(p_patient);

    -- 3. Claim; a replay returns the first result and writes nothing.
    v_replay := private.command_claim(p_tenant_id, p_client_request_id, 'public.register_patient',
                                      private.command_request_hash(jsonb_build_object('patient', v_patient)));
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. The patient, its patient.create audit row and (when set) the objection stamp and audit row: one transaction.
    v_patient_id := private.step_create_patient(p_tenant_id, v_patient);

    v_result := jsonb_build_object('patient_id', v_patient_id, 'replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.register_patient(uuid, jsonb, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.register_patient(uuid, jsonb, uuid) TO authenticated;
COMMENT ON FUNCTION public.register_patient(uuid, jsonb, uuid) IS
    'V2-08 08-02 (R-6, R-12): registers a patient in one transaction: the validated patient (private.patient_input_normalize: closed key set, an Indian mobile stored as +91 and ten digits, a real date of birth or an age, sex, optional ABHA and ai_processing_objected), the patient.create audit row and, when the objection is set, its stamp and audit row. patients:edit. INPUT_INVALID (P0001) for a bad input; PATIENT_NOT_FOUND (P0002) for another clinic. Idempotent by p_client_request_id. Result: patient_id, replayed.';
