-- Migration: 000114_diagnosis_search_snapshot.sql
-- V2-09b 09B-04a (R-11, R-13, AI-07, AI-10): the two deterministic Smart Assist reads of the consult's context. No model, no outbound call.
--
-- 1. public.search_diagnoses(p_tenant_id, p_terms, p_specialty, p_limit): STABLE INVOKER, consultations:view in p_tenant_id. The diagnosis typeahead
--    over the curated catalogue (opd_diagnoses, names, synonyms) and the CALLING doctor's own custom diagnoses (doctor_custom_diagnoses where doctor_id
--    = auth.uid(): another doctor's custom rows are never returned, although the table's SELECT policy would show them). `p_terms` is the typed query
--    plus its abbreviation expansions (the service does the expansion, features/terminology/abbreviations.ts); at most 8 terms of 2 to 100
--    characters; `%`, `_` and `\` in a term are escaped, so they match themselves. Order: the doctor's own custom diagnoses first (use_count, then
--    name), then the catalogue by rank: 1 exact name, 2 name prefix, 3 a synonym equal or prefixed, 4 a word of the name starts with it, 5 the term
--    inside the name, 6 trigram similarity of at least 0.3 on the name or a synonym; then name. A name that is both the doctor's custom and in the
--    catalogue is listed once (the custom row). `p_specialty` (when given) restricts the catalogue to diagnoses tagged with it. At most p_limit (1-50,
--    default 20). Output: id, name, icd11_code, snomed_concept_id, is_chronic, is_custom. A caller without consultations:view in p_tenant_id (or a
--    forged tenant) gets no rows.
-- 2. public.patient_snapshot(p_tenant_id, p_patient_id, p_exclude_visit_id) -> jsonb: STABLE INVOKER, consultations:view in p_tenant_id. A patient's
--    history as the doctor needs it in one glance, from the SIGNED visits only (a booked, waiting, unsigned or cancelled visit is not history; the
--    LLM catch-up's defect, AI §5.2 SA-04): the last 5 signed visits other than the current one, each with its clinic-zone signature date, the doctor's
--    display name, the diagnoses and the signed version's Rx lines; the patient's allergies and chronic conditions; the follow-ups due before the
--    clinic's today for which the patient has no attended visit (waiting, in consultation, completed) since, other than the current one; the latest
--    measured vitals among those visits (measurements only: no recorder id). NULL when the patient is not in p_tenant_id or the caller may not read.
-- Per-migration checklist: two new public INVOKER read functions (EXECUTE: authenticated only). No table, column, policy, grant or data change; expand-safe
-- (nothing in the previous build calls them). No index: the catalogue is a scan of about 2,000 rows measured under the R-18 target (see the plan notes).

-- 1. search_diagnoses --------------------------------------------------------------------------------------------------------
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
        RAISE EXCEPTION 'diagnosis search requires the pg_trgm extension';
    END IF;

    v_sql := $fn$
CREATE FUNCTION public.search_diagnoses(
    p_tenant_id uuid,
    p_terms text[],
    p_specialty text DEFAULT NULL,
    p_limit integer DEFAULT 20
)
RETURNS TABLE (
    id uuid,
    name text,
    icd11_code text,
    snomed_concept_id text,
    is_chronic boolean,
    is_custom boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $body$
DECLARE
    v_uid uuid := auth.uid();
    v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
BEGIN
    IF v_uid IS NULL OR p_tenant_id IS NULL OR p_terms IS NULL THEN
        RETURN;
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'consultations:view') THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH tq AS (
        SELECT x.term,
               replace(replace(replace(x.term, '\', '\\'), '%', '\%'), '_', '\_') AS pat
          FROM (
                SELECT DISTINCT lower(btrim(left(t, 100))) AS term
                  FROM unnest(p_terms[1:8]) AS t
                 WHERE char_length(btrim(t)) >= 2
               ) x
    ), custom AS (
        SELECT c.id AS id, c.diagnosis_name AS name, NULL::text AS icd11_code, NULL::text AS snomed_concept_id,
               false AS is_chronic, true AS is_custom, 0 AS grp, c.use_count AS uses, 0 AS rank
          FROM public.doctor_custom_diagnoses c
         WHERE c.tenant_id = p_tenant_id AND c.doctor_id = v_uid
           AND EXISTS (
                SELECT 1 FROM tq
                 WHERE lower(c.diagnosis_name) LIKE '%' || tq.pat || '%'
                    OR __TRGM__.similarity(lower(c.diagnosis_name), tq.term) >= 0.3
               )
    ), central AS (
        SELECT d.id AS id, d.name AS name, d.icd11_code AS icd11_code, d.snomed_concept_id AS snomed_concept_id,
               d.is_chronic AS is_chronic, false AS is_custom, 1 AS grp, 0 AS uses, r.rank AS rank
          FROM public.opd_diagnoses d
         CROSS JOIN LATERAL (
                SELECT min(CASE
                               WHEN lower(d.name) = tq.term THEN 1
                               WHEN lower(d.name) LIKE tq.pat || '%' THEN 2
                               WHEN EXISTS (SELECT 1 FROM unnest(d.synonyms) s WHERE lower(s) = tq.term OR lower(s) LIKE tq.pat || '%') THEN 3
                               WHEN lower(d.name) LIKE '% ' || tq.pat || '%' THEN 4
                               WHEN lower(d.name) LIKE '%' || tq.pat || '%' THEN 5
                               WHEN __TRGM__.similarity(lower(d.name), tq.term) >= 0.3
                                    OR EXISTS (SELECT 1 FROM unnest(d.synonyms) s WHERE __TRGM__.similarity(lower(s), tq.term) >= 0.3) THEN 6
                           END) AS rank
                  FROM tq
               ) r
         WHERE r.rank IS NOT NULL
           AND (p_specialty IS NULL OR d.specialties @> ARRAY[p_specialty])
    ), merged AS (
        SELECT DISTINCT ON (lower(u.name)) u.*
          FROM (SELECT * FROM custom UNION ALL SELECT * FROM central) u
         ORDER BY lower(u.name), u.grp, u.rank
    )
    SELECT m.id, m.name, m.icd11_code, m.snomed_concept_id, m.is_chronic, m.is_custom
      FROM merged m
     ORDER BY m.grp, m.uses DESC, m.rank, m.name
     LIMIT v_limit;
END;
$body$;
$fn$;
    EXECUTE replace(v_sql, '__TRGM__', quote_ident(v_schema));
END;
$migration$;
REVOKE ALL ON FUNCTION public.search_diagnoses(uuid, text[], text, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.search_diagnoses(uuid, text[], text, integer) TO authenticated;
COMMENT ON FUNCTION public.search_diagnoses(uuid, text[], text, integer) IS
    'V2-09b 09B-04a (R-11, AI-07): the diagnosis typeahead for the session''s active clinic, consultations:view: the calling doctor''s own custom diagnoses first, then the catalogue by rank (exact name, prefix, synonym, word prefix, inside the name, trigram 0.3), over the typed term and its abbreviation expansions (p_terms, at most 8). LIKE wildcards in a term match themselves. At most p_limit (1-50) rows: id, name, icd11_code, snomed_concept_id, is_chronic, is_custom. SECURITY INVOKER: RLS applies; another doctor''s custom rows are never returned.';

-- 2. patient_snapshot ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.patient_snapshot(p_tenant_id uuid, p_patient_id uuid, p_exclude_visit_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_tz text;
    v_today date;
    v_patient record;
    v_visits jsonb;
    v_due jsonb;
    v_vitals jsonb;
BEGIN
    IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_patient_id IS NULL THEN
        RETURN NULL;
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'consultations:view') THEN
        RETURN NULL;
    END IF;

    SELECT p.allergies, p.chronic_conditions INTO v_patient
      FROM public.patients p
     WHERE p.id = p_patient_id AND p.tenant_id = p_tenant_id AND NOT p.is_deleted AND p.erased_at IS NULL;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT coalesce(t.timezone, 'Asia/Kolkata') INTO v_tz FROM public.tenants t WHERE t.id = p_tenant_id;
    v_today := (now() AT TIME ZONE v_tz)::date;

    WITH last5 AS (
        SELECT v.id AS vid, v.doctor_id, v.signed_at
          FROM public.visits v
         WHERE v.tenant_id = p_tenant_id AND v.patient_id = p_patient_id AND v.signed_at IS NOT NULL
           AND (p_exclude_visit_id IS NULL OR v.id <> p_exclude_visit_id)
         ORDER BY v.signed_at DESC
         LIMIT 5
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'date', ((l.signed_at AT TIME ZONE v_tz)::date)::text,
               'doctor', (SELECT m.full_name FROM public.memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = l.doctor_id LIMIT 1),
               'diagnoses', coalesce((SELECT jsonb_agg(jsonb_build_object('name', d.diagnosis_name, 'icd11', d.icd11_code) ORDER BY d.created_at, d.id)
                                        FROM public.consultation_diagnoses d
                                       WHERE d.visit_id = l.vid AND d.tenant_id = p_tenant_id), '[]'::jsonb),
               'rx', coalesce((SELECT jsonb_agg(jsonb_build_object('medicine', i.medicine_name, 'dosage', i.dosage, 'timing', i.timing, 'duration', i.duration)
                                                ORDER BY i.sort_order, i.id)
                                 FROM public.prescription_items i
                                WHERE i.tenant_id = p_tenant_id
                                  AND i.prescription_id = (SELECT rx.id FROM public.prescriptions rx
                                                            WHERE rx.visit_id = l.vid AND rx.tenant_id = p_tenant_id AND rx.signed_at IS NOT NULL
                                                            ORDER BY rx.version DESC LIMIT 1)), '[]'::jsonb)
           ) ORDER BY l.signed_at DESC), '[]'::jsonb)
      INTO v_visits
      FROM last5 l;

    -- The latest measured vitals among those visits: measurements only (no recorder id), the clinic-zone date of that visit.
    SELECT jsonb_build_object(
               'date', ((l.signed_at AT TIME ZONE v_tz)::date)::text,
               'vitals', jsonb_strip_nulls(jsonb_build_object(
                   'systolic', CASE WHEN jsonb_typeof(n.vitals -> 'systolic') = 'number' THEN n.vitals -> 'systolic' END,
                   'diastolic', CASE WHEN jsonb_typeof(n.vitals -> 'diastolic') = 'number' THEN n.vitals -> 'diastolic' END,
                   'pulse', CASE WHEN jsonb_typeof(n.vitals -> 'pulse') = 'number' THEN n.vitals -> 'pulse' END,
                   'temperature', CASE WHEN jsonb_typeof(n.vitals -> 'temperature') = 'number' THEN n.vitals -> 'temperature' END,
                   'spo2', CASE WHEN jsonb_typeof(n.vitals -> 'spo2') = 'number' THEN n.vitals -> 'spo2' END,
                   'weight', CASE WHEN jsonb_typeof(n.vitals -> 'weight') = 'number' THEN n.vitals -> 'weight' END,
                   'respiratory_rate', CASE WHEN jsonb_typeof(n.vitals -> 'respiratory_rate') = 'number' THEN n.vitals -> 'respiratory_rate' END
               )))
      INTO v_vitals
      FROM (
            SELECT v.id AS vid, v.signed_at
              FROM public.visits v
             WHERE v.tenant_id = p_tenant_id AND v.patient_id = p_patient_id AND v.signed_at IS NOT NULL
               AND (p_exclude_visit_id IS NULL OR v.id <> p_exclude_visit_id)
             ORDER BY v.signed_at DESC
             LIMIT 5
           ) l
      JOIN public.clinical_notes n ON n.visit_id = l.vid AND n.tenant_id = p_tenant_id
     WHERE jsonb_typeof(n.vitals) = 'object'
       AND (jsonb_typeof(n.vitals -> 'systolic') = 'number' OR jsonb_typeof(n.vitals -> 'pulse') = 'number'
            OR jsonb_typeof(n.vitals -> 'temperature') = 'number' OR jsonb_typeof(n.vitals -> 'spo2') = 'number'
            OR jsonb_typeof(n.vitals -> 'weight') = 'number' OR jsonb_typeof(n.vitals -> 'respiratory_rate') = 'number')
     ORDER BY l.signed_at DESC
     LIMIT 1;

    -- Follow-ups due before the clinic's today with no attended visit since (the visit in progress is not "since": the patient is here now, and the
    -- question is whether they came back before this).
    SELECT coalesce(jsonb_agg(jsonb_build_object('date', f.follow_up_date::text) ORDER BY f.follow_up_date), '[]'::jsonb)
      INTO v_due
      FROM public.follow_ups f
     WHERE f.tenant_id = p_tenant_id AND f.patient_id = p_patient_id AND f.status = 'scheduled'
       AND f.follow_up_date < v_today
       AND (p_exclude_visit_id IS NULL OR f.visit_id IS DISTINCT FROM p_exclude_visit_id)
       AND NOT EXISTS (
            SELECT 1 FROM public.visits w
             WHERE w.tenant_id = p_tenant_id AND w.patient_id = p_patient_id
               AND w.status IN ('waiting', 'in_consultation', 'completed')
               AND (p_exclude_visit_id IS NULL OR w.id <> p_exclude_visit_id)
               AND w.id IS DISTINCT FROM f.visit_id
               AND coalesce(w.scheduled_at, w.created_at) > f.created_at
           );

    RETURN jsonb_build_object(
        'visits', v_visits,
        'allergies', to_jsonb(v_patient.allergies),
        'chronic_conditions', coalesce(to_jsonb(v_patient.chronic_conditions), '[]'::jsonb),
        'due_follow_ups', v_due,
        'last_vitals', v_vitals
    );
END;
$$;
REVOKE ALL ON FUNCTION public.patient_snapshot(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.patient_snapshot(uuid, uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.patient_snapshot(uuid, uuid, uuid) IS
    'V2-09b 09B-04a (R-13, AI-10): a patient''s history from the SIGNED visits only, for the session''s active clinic, consultations:view: the last 5 signed visits other than p_exclude_visit_id (clinic-zone date, doctor, diagnoses, the signed version''s Rx lines), allergies and chronic conditions, follow-ups due before the clinic''s today with no attended visit since, and the latest measured vitals (measurements only). NULL when the patient is not in p_tenant_id or the caller may not read. SECURITY INVOKER: RLS applies.';
