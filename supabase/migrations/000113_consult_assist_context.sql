-- Migration: 000113_consult_assist_context.sql
-- V2-09b 09B-03 (R-12, AI-07 context, Q-8, Q-9): the doctor's own learned order for the consult. No model, no outbound call.
--
-- public.consult_assist_context(p_tenant_id) -> jsonb. STABLE SECURITY INVOKER (RLS applies). It reads the CALLING doctor's own last 300 signed
-- visits in the active full clinic (visits.doctor_id = auth.uid(), signed_at IS NOT NULL, newest first) and returns NAMES AND COUNTS ONLY:
--   visits              how many signed visits were read (at most 300)
--   complaints          [{name, n}]                       the doctor's complaint frequencies (top 40, visits that named it)
--   complaint_pairs     [{a, b, n}]                       which complaints this doctor records together (top 200; a sorts before b)
--   pairs               [{complaint, diagnosis, n}]       complaint-to-diagnosis co-occurrence over those visits (top 300)
--   diagnoses           [{name, icd11, snomed, chronic, custom, n, investigations: [{name, n}], advice: [{name, n}], follow_up_days}]
--                       the doctor's 30 most recently used diagnoses; per diagnosis the usual investigations and advice (top 8 each) and the usual
--                       follow-up interval in days (the most common gap between the signature date, in the clinic's zone, and the follow-up date)
--   last_exam_template  the exam template id (specialty_data.exam.template_id) of the latest signed visit that has one, or null
-- No patient id, no visit id, no clinical note text. Complaint and diagnosis names are what this doctor typed or picked, returned to this doctor.
-- Nothing is authored here: "likely from the complaints" comes only from this co-occurrence (Q-8), never from a Claude-written table.
-- The caller must hold consultations:edit in p_tenant_id (public.has_permission is bound to the caller and the active tenant): a forged tenant id,
-- a role without the permission (receptionist, admin, nurse) or no session gets the empty result, not an error and not another doctor's data.
--
-- Per-migration checklist: one new public INVOKER read function (EXECUTE: authenticated only). No table, column, policy, grant or data change;
-- expand-safe (nothing in the previous build calls it). An index is added only if the measurement on the R-18 seed shows a sequential scan (see the
-- plan notes; none here).

CREATE FUNCTION public.consult_assist_context(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_tz text;
    v_out jsonb;
BEGIN
    IF v_uid IS NULL OR p_tenant_id IS NULL OR NOT public.has_permission(p_tenant_id, 'consultations:edit') THEN
        RETURN jsonb_build_object(
            'visits', 0, 'complaints', '[]'::jsonb, 'complaint_pairs', '[]'::jsonb, 'pairs', '[]'::jsonb, 'diagnoses', '[]'::jsonb,
            'last_exam_template', NULL);
    END IF;

    SELECT coalesce(t.timezone, 'Asia/Kolkata') INTO v_tz FROM public.tenants t WHERE t.id = p_tenant_id;

    WITH vs AS (
        SELECT v.id AS vid, v.signed_at
          FROM public.visits v
         WHERE v.tenant_id = p_tenant_id AND v.doctor_id = v_uid AND v.signed_at IS NOT NULL
         ORDER BY v.signed_at DESC
         LIMIT 300
    ), nt AS (
        SELECT vs.vid, vs.signed_at, n.chief_complaints, n.investigations_advised, n.advice, n.specialty_data
          FROM vs
          JOIN public.clinical_notes n ON n.visit_id = vs.vid AND n.tenant_id = p_tenant_id
    ), cp AS (
        SELECT nt.vid, lower(btrim(e.value ->> 'symptom')) AS k, btrim(e.value ->> 'symptom') AS name
          FROM nt
         CROSS JOIN LATERAL jsonb_array_elements(
               CASE WHEN jsonb_typeof(nt.chief_complaints) = 'array' THEN nt.chief_complaints ELSE '[]'::jsonb END) AS e(value)
         WHERE jsonb_typeof(e.value) = 'object' AND btrim(coalesce(e.value ->> 'symptom', '')) <> ''
    ), dx AS (
        SELECT vs.vid, vs.signed_at, lower(btrim(d.diagnosis_name)) AS k, btrim(d.diagnosis_name) AS name,
               d.icd11_code, d.snomed_concept_id, d.is_chronic, d.is_custom
          FROM vs
          JOIN public.consultation_diagnoses d ON d.visit_id = vs.vid AND d.tenant_id = p_tenant_id
         WHERE btrim(d.diagnosis_name) <> ''
    ), complaint_counts AS (
        SELECT cp.k, mode() WITHIN GROUP (ORDER BY cp.name) AS name, count(DISTINCT cp.vid)::integer AS n
          FROM cp
         GROUP BY cp.k
         ORDER BY count(DISTINCT cp.vid) DESC, cp.k
         LIMIT 40
    ), complaint_pair_counts AS (
        SELECT a.k AS ak, b.k AS bk, mode() WITHIN GROUP (ORDER BY a.name) AS a_name, mode() WITHIN GROUP (ORDER BY b.name) AS b_name,
               count(DISTINCT a.vid)::integer AS n
          FROM cp a
          JOIN cp b ON b.vid = a.vid AND a.k < b.k
         GROUP BY a.k, b.k
         ORDER BY count(DISTINCT a.vid) DESC, a.k, b.k
         LIMIT 200
    ), pair_counts AS (
        SELECT cp.k AS ck, dx.k AS dk, mode() WITHIN GROUP (ORDER BY cp.name) AS complaint,
               mode() WITHIN GROUP (ORDER BY dx.name) AS diagnosis, count(DISTINCT cp.vid)::integer AS n
          FROM cp
          JOIN dx ON dx.vid = cp.vid
         GROUP BY cp.k, dx.k
         ORDER BY count(DISTINCT cp.vid) DESC, cp.k, dx.k
         LIMIT 300
    ), dx_counts AS (
        SELECT dx.k, mode() WITHIN GROUP (ORDER BY dx.name) AS name, max(dx.icd11_code) AS icd11,
               max(dx.snomed_concept_id) AS snomed, bool_or(dx.is_chronic) AS chronic, bool_or(dx.is_custom) AS custom,
               count(DISTINCT dx.vid)::integer AS n, max(dx.signed_at) AS last_at
          FROM dx
         GROUP BY dx.k
         ORDER BY max(dx.signed_at) DESC, dx.k
         LIMIT 30
    ), inv AS (
        SELECT r.k, r.item, r.n, row_number() OVER (PARTITION BY r.k ORDER BY r.n DESC, r.item) AS rn
          FROM (
                SELECT dc.k, btrim(i.item) AS item, count(DISTINCT dx.vid)::integer AS n
                  FROM dx_counts dc
                  JOIN dx ON dx.k = dc.k
                  JOIN nt ON nt.vid = dx.vid
                 CROSS JOIN LATERAL unnest(nt.investigations_advised) AS i(item)
                 WHERE btrim(i.item) <> ''
                 GROUP BY dc.k, btrim(i.item)
               ) r
    ), adv AS (
        SELECT r.k, r.item, r.n, row_number() OVER (PARTITION BY r.k ORDER BY r.n DESC, r.item) AS rn
          FROM (
                SELECT dc.k, btrim(a.item) AS item, count(DISTINCT dx.vid)::integer AS n
                  FROM dx_counts dc
                  JOIN dx ON dx.k = dc.k
                  JOIN nt ON nt.vid = dx.vid
                 CROSS JOIN LATERAL unnest(nt.advice) AS a(item)
                 WHERE btrim(a.item) <> ''
                 GROUP BY dc.k, btrim(a.item)
               ) r
    ), fu AS (
        SELECT g.k, mode() WITHIN GROUP (ORDER BY g.days) AS days
          FROM (
                SELECT dc.k, (f.follow_up_date - (dx.signed_at AT TIME ZONE v_tz)::date) AS days
                  FROM dx_counts dc
                  JOIN dx ON dx.k = dc.k
                  JOIN public.follow_ups f ON f.visit_id = dx.vid AND f.tenant_id = p_tenant_id
               ) g
         WHERE g.days BETWEEN 1 AND 366
         GROUP BY g.k
    )
    SELECT jsonb_build_object(
        'visits', (SELECT count(*)::integer FROM vs),
        'complaints', coalesce((SELECT jsonb_agg(jsonb_build_object('name', c.name, 'n', c.n) ORDER BY c.n DESC, c.k) FROM complaint_counts c), '[]'::jsonb),
        'complaint_pairs', coalesce((SELECT jsonb_agg(jsonb_build_object('a', q.a_name, 'b', q.b_name, 'n', q.n) ORDER BY q.n DESC, q.ak, q.bk)
                                      FROM complaint_pair_counts q), '[]'::jsonb),
        'pairs', coalesce((SELECT jsonb_agg(jsonb_build_object('complaint', p.complaint, 'diagnosis', p.diagnosis, 'n', p.n) ORDER BY p.n DESC, p.ck, p.dk)
                             FROM pair_counts p), '[]'::jsonb),
        'diagnoses', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'name', d.name, 'icd11', d.icd11, 'snomed', d.snomed, 'chronic', d.chronic, 'custom', d.custom, 'n', d.n,
                       'investigations', coalesce((SELECT jsonb_agg(jsonb_build_object('name', i.item, 'n', i.n) ORDER BY i.rn)
                                                     FROM inv i WHERE i.k = d.k AND i.rn <= 8), '[]'::jsonb),
                       'advice', coalesce((SELECT jsonb_agg(jsonb_build_object('name', a.item, 'n', a.n) ORDER BY a.rn)
                                             FROM adv a WHERE a.k = d.k AND a.rn <= 8), '[]'::jsonb),
                       'follow_up_days', (SELECT fu.days FROM fu WHERE fu.k = d.k)
                   ) ORDER BY d.last_at DESC, d.k)
              FROM dx_counts d), '[]'::jsonb),
        'last_exam_template', (
            SELECT t.id
              FROM (
                    SELECT CASE WHEN (nt.specialty_data -> 'exam' ->> 'template_id') ~ '^[a-z0-9_]{1,24}$'
                                THEN nt.specialty_data -> 'exam' ->> 'template_id' END AS id, nt.signed_at
                      FROM nt
                     WHERE jsonb_typeof(nt.specialty_data -> 'exam') = 'object'
                   ) t
             WHERE t.id IS NOT NULL
             ORDER BY t.signed_at DESC
             LIMIT 1)
    ) INTO v_out;

    RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.consult_assist_context(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.consult_assist_context(uuid) TO authenticated;
COMMENT ON FUNCTION public.consult_assist_context(uuid) IS
    'V2-09b 09B-03 (R-12): the calling doctor''s own learned order for the consult, from their last 300 signed visits in the active full clinic: complaint frequencies, complaint-to-diagnosis co-occurrence, their 30 most recent diagnoses with the usual investigations, advice and follow-up gap in days, and the last exam template id. Names and counts only; no patient or visit id. SECURITY INVOKER: RLS applies; a caller without consultations:edit in p_tenant_id (or a forged tenant) gets the empty result.';
