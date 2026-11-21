-- Migration: 000105_smart_assist.sql
-- V2-08 08-05 (R-18, AI-13, AI-14): the two deterministic Smart Assist reads of the front desk. No model, no outbound call.
--
-- 1. public.slot_suggestion_context(doctor, patient) (AI-13): STABLE INVOKER, appointments:view. One row for the session's active
--    full clinic: the doctor's average consult minutes over the last 60 days (queue_tokens.called_at to visits.signed_at; null
--    under 5 samples, sample count reported), and the patient's preferred time band (morning before 12:00, afternoon before
--    17:00, evening) over their last 5 attended visits in the clinic's time zone (null with no visit; a tie goes to the more
--    recent band). Counts and a band only: no names, no free text. The ranking itself is pure TypeScript (`suggestSlots`).
-- 2. private.name_normalize(text) (AI-14): IMMUTABLE. Lower case, punctuation to spaces, honorifics Dr/Mr/Mrs/Ms removed, a small
--    short-form and transliteration table (Mohd, Md, Mohamad, Muhammad -> Mohammed; Kr -> Kumar; Smt -> Shrimati; sh -> s,
--    ee -> i, oo -> u, doubled letters collapsed), words sorted so the order does not matter. A trigram index on the expression
--    (idx_patients_name_normalized_trgm) serves the name rule; EXECUTE for authenticated and service_role because the invoker
--    that inserts or searches evaluates it.
-- 3. public.find_patient_duplicates (AI-14): same arguments, same columns plus `strength` ('strong' | 'possible'). Now SECURITY
--    DEFINER (it was INVOKER in 000101): under RLS the patients policy adds a security qual and the planner may not push a
--    non-leakproof operator (`%`, LIKE, ILIKE) into an index below it, so an invoker lookup scanned every patient of the clinic and
--    evaluated the name normalisation on each (about 380 ms at 10,000 patients). The function keeps the guard block it already had
--    (the session's active full clinic, patients:view) and filters every table it reads by that clinic itself, as available_slots
--    does (000103); the rows are the same minimal projection. Gated by the
--    clinic's `assist.duplicates` entitlement (my_entitlements, the access level is already `full`): not entitled, the 08-02 rules
--    return unchanged with strength 'possible' on every row. Entitled: a candidate is the same mobile (any name: a shared family
--    mobile lists everyone on it, a child under a guardian's number included), or a similar name (trigram similarity of the
--    normalised names of 0.6 or more) with the same date of birth or an age within two years. strong: same mobile with a similar
--    name, or a similar name with the same date of birth; possible: the rest. Never blocks a registration (R-11).
-- Per-migration checklist: one new public invoker read function (EXECUTE: authenticated only), one replaced public read function
-- (dropped and created: the result gains a column; now a definer wrapper, grants unchanged), one new private pure function, one index. No table,
-- column, policy or data change; expand-safe (the previous build ignores the extra column; its rows keep their old fields).

-- 1. slot_suggestion_context ------------------------------------------------------------------------------------------------
CREATE FUNCTION public.slot_suggestion_context(p_doctor_id uuid, p_patient_id uuid)
RETURNS TABLE (
    avg_consult_minutes integer,
    consult_samples integer,
    preferred_band text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid := (SELECT authz.full_tenant_ids() LIMIT 1);
    v_tz text;
    v_n integer;
    v_avg numeric;
    v_band text;
BEGIN
    IF v_tenant IS NULL OR p_doctor_id IS NULL THEN
        RETURN;
    END IF;
    IF NOT public.has_permission(v_tenant, 'appointments:view') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    SELECT coalesce(t.timezone, 'Asia/Kolkata') INTO v_tz FROM public.tenants t WHERE t.id = v_tenant;

    SELECT count(*)::integer, avg(extract(epoch FROM (v.signed_at - q.called_at)) / 60.0)
      INTO v_n, v_avg
      FROM public.visits v
      JOIN public.queue_tokens q ON q.visit_id = v.id AND q.tenant_id = v.tenant_id
     WHERE v.tenant_id = v_tenant AND v.doctor_id = p_doctor_id
       AND v.signed_at IS NOT NULL AND v.signed_at >= now() - interval '60 days'
       AND q.called_at IS NOT NULL AND v.signed_at > q.called_at
       AND v.signed_at - q.called_at <= interval '4 hours';

    IF p_patient_id IS NOT NULL THEN
        SELECT b.band INTO v_band
          FROM (
                SELECT CASE WHEN l.h < 12 THEN 'morning' WHEN l.h < 17 THEN 'afternoon' ELSE 'evening' END AS band,
                       count(*) AS n, max(l.ts) AS last_ts
                  FROM (
                        SELECT coalesce(v.scheduled_at, v.created_at) AS ts,
                               extract(hour FROM coalesce(v.scheduled_at, v.created_at) AT TIME ZONE v_tz)::integer AS h
                          FROM public.visits v
                         WHERE v.tenant_id = v_tenant AND v.patient_id = p_patient_id
                           AND v.status IN ('waiting', 'in_consultation', 'completed')
                         ORDER BY coalesce(v.scheduled_at, v.created_at) DESC
                         LIMIT 5
                       ) l
                 GROUP BY 1
               ) b
         ORDER BY b.n DESC, b.last_ts DESC
         LIMIT 1;
    END IF;

    RETURN QUERY SELECT CASE WHEN v_n >= 5 THEN round(v_avg)::integer END, v_n, v_band;
END;
$$;
REVOKE ALL ON FUNCTION public.slot_suggestion_context(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.slot_suggestion_context(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.slot_suggestion_context(uuid, uuid) IS
    'V2-08 08-05 (AI-13, R-18): the inputs of the booking sheet''s Smart Assist slot suggestions for the session''s active full clinic, appointments:view: avg_consult_minutes (the doctor''s average from the queue call to the signature over the last 60 days, null under 5 samples), consult_samples, and preferred_band (morning, afternoon or evening in the clinic zone, from the patient''s last 5 attended visits; null with none). Counts and a band only. SECURITY INVOKER: RLS applies.';

-- 2. name_normalize ----------------------------------------------------------------------------------------------------------
CREATE FUNCTION private.name_normalize(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT coalesce(string_agg(n.tok, ' ' ORDER BY n.tok), '')
      FROM (
            SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(m.tok,
                       'sh', 's', 'g'), 'ee', 'i', 'g'), 'oo', 'u', 'g'), '(.)\1+', '\1', 'g') AS tok
              FROM (
                    SELECT CASE w.word
                               WHEN 'mohd' THEN 'mohammed' WHEN 'md' THEN 'mohammed' WHEN 'mohamad' THEN 'mohammed'
                               WHEN 'mohammad' THEN 'mohammed' WHEN 'muhammad' THEN 'mohammed' WHEN 'mohamed' THEN 'mohammed'
                               WHEN 'kr' THEN 'kumar' WHEN 'kumr' THEN 'kumar'
                               WHEN 'smt' THEN 'shrimati' WHEN 'srimati' THEN 'shrimati'
                               ELSE w.word
                           END AS tok
                      FROM regexp_split_to_table(btrim(regexp_replace(lower(coalesce(p_name, '')), '[^[:alnum:]]+', ' ', 'g')), ' ') AS w(word)
                     WHERE w.word <> '' AND w.word NOT IN ('dr', 'mr', 'mrs', 'ms')
                   ) m
           ) n
     WHERE n.tok <> ''
$$;
REVOKE ALL ON FUNCTION private.name_normalize(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.name_normalize(text) TO authenticated, service_role;
COMMENT ON FUNCTION private.name_normalize(text) IS
    'V2-08 08-05 (AI-14): a person''s name in a comparable form: lower case, punctuation as spaces, Dr/Mr/Mrs/Ms removed, Mohd/Md/Mohamad/Mohammad/Muhammad/Mohamed as mohammed, Kr as kumar, Smt as shrimati, sh as s, ee as i, oo as u, doubled letters collapsed, words sorted. Pure and immutable: the expression of idx_patients_name_normalized_trgm.';

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
    EXECUTE format('CREATE INDEX idx_patients_name_normalized_trgm ON public.patients USING gin (private.name_normalize(full_name) %I.gin_trgm_ops)', v_schema);
END;
$migration$;

-- 3. find_patient_duplicates (AI-14) ----------------------------------------------------------------------------------------
DROP FUNCTION public.find_patient_duplicates(text, text, date, integer);

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
CREATE FUNCTION public.find_patient_duplicates(p_phone text, p_name text, p_dob date, p_age integer)
RETURNS TABLE (
    id uuid,
    full_name text,
    sex text,
    age integer,
    date_of_birth date,
    phone_last4 text,
    last_visit_at timestamptz,
    reasons text[],
    strength text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $body$
DECLARE
    v_tenant uuid := (SELECT authz.full_tenant_ids() LIMIT 1);
    v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
    v_mobile text;
    v_name text := lower(btrim(coalesce(p_name, '')));
    v_nname text;
    v_assist boolean;
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

    v_assist := coalesce((SELECT e.enabled FROM public.my_entitlements(v_tenant) e WHERE e.key = 'assist.duplicates'), false);

    IF NOT v_assist THEN
        -- The 08-02 rules: same mobile; the same name with the same date of birth or an age within two years.
        RETURN QUERY
        SELECT m.id, m.full_name, m.sex, m.age, m.date_of_birth, m.phone_last4, m.last_visit_at, m.reasons, 'possible'::text
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
        RETURN;
    END IF;

    -- Smart Assist rules (AI-14). The candidate set is the union of two separately planned lookups (an OR over both made the
    -- planner scan the whole clinic): the mobile (phone trigram index or a short scan) and the normalised name
    -- (idx_patients_name_normalized_trgm, `%` at the default 0.3 threshold, below the 0.6 the rule then applies).
    v_nname := private.name_normalize(p_name);
    RETURN QUERY
    SELECT m.id, m.full_name, m.sex, m.age, m.date_of_birth, m.phone_last4, m.last_visit_at, m.reasons,
           CASE WHEN (m.same_mobile AND m.name_ok) OR (m.name_ok AND m.same_dob) THEN 'strong' ELSE 'possible' END
      FROM (
            SELECT c.id, c.full_name, c.sex, c.age, c.date_of_birth, c.phone_last4, c.last_visit_at,
                   c.same_mobile, c.name_ok, c.same_dob,
                   array_remove(ARRAY[
                       CASE WHEN c.same_mobile THEN 'same_mobile' END,
                       CASE WHEN c.name_ok AND c.same_dob THEN 'same_name_dob' END,
                       CASE WHEN c.name_ok AND c.age_near THEN 'same_name_age' END
                   ], NULL) AS reasons
              FROM (
                    SELECT p.id, p.full_name, p.sex, p.age, p.date_of_birth,
                           CASE WHEN char_length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) >= 4
                                THEN right(regexp_replace(p.phone, '\D', '', 'g'), 4) END AS phone_last4,
                           (SELECT max(coalesce(v.scheduled_at, v.created_at))
                              FROM public.visits v
                             WHERE v.tenant_id = v_tenant AND v.patient_id = p.id
                               AND v.status IN ('waiting', 'in_consultation', 'completed')) AS last_visit_at,
                           (v_mobile IS NOT NULL
                            AND right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) = v_mobile) AS same_mobile,
                           (char_length(v_nname) >= 3
                            AND __TRGM__.similarity(private.name_normalize(p.full_name), v_nname) >= 0.6) AS name_ok,
                           (p_dob IS NOT NULL AND p.date_of_birth = p_dob) AS same_dob,
                           (p_age IS NOT NULL AND p.age IS NOT NULL AND abs(p.age - p_age) <= 2) AS age_near
                      FROM public.patients p
                     WHERE p.tenant_id = v_tenant AND NOT p.is_deleted AND p.erased_at IS NULL
                       AND p.id IN (
                           SELECT m1.id FROM public.patients m1
                            WHERE v_mobile IS NOT NULL AND m1.tenant_id = v_tenant AND m1.phone LIKE '%' || v_mobile
                           UNION
                           SELECT m2.id FROM public.patients m2
                            WHERE char_length(v_nname) >= 3 AND m2.tenant_id = v_tenant
                              AND private.name_normalize(m2.full_name) OPERATOR(__TRGM__.%) v_nname
                       )
                   ) c
           ) m
     WHERE cardinality(m.reasons) > 0
     ORDER BY ((m.same_mobile AND m.name_ok) OR (m.name_ok AND m.same_dob)) DESC, m.same_mobile DESC,
              m.last_visit_at DESC NULLS LAST, m.full_name, m.id
     LIMIT 10;
END;
$body$;
$fn$;
    EXECUTE replace(v_sql, '__TRGM__', quote_ident(v_schema));
END;
$migration$;
REVOKE ALL ON FUNCTION public.find_patient_duplicates(text, text, date, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.find_patient_duplicates(text, text, date, integer) TO authenticated;
COMMENT ON FUNCTION public.find_patient_duplicates(text, text, date, integer) IS
    'V2-08 08-05 (R-11, AI-14): advisory duplicate candidates for a new patient in the session''s active clinic: id, full_name, sex, age, date_of_birth, phone_last4, last_visit_at, reasons, strength; at most 10, strong first. Without the assist.duplicates entitlement: the 08-02 rules (same_mobile; same_name_dob and same_name_age on an equal lower-cased name), every row possible. With it: same_mobile (a shared family mobile lists everyone on it), and a similar name (normalised, trigram similarity 0.6 or more) with the same date of birth (same_name_dob) or an age within two years (same_name_age); strong = same mobile with a similar name, or a similar name with the same date of birth. Never blocks a registration. SECURITY DEFINER with the session''s active full clinic and patients:view as its guard; every table is read by that clinic only.';
