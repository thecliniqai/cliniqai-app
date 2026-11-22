-- Migration: 000119_rx_assist.sql
-- V2-09c 09C-03 (R-9, R-10; AI-08, SA-02 fixed; V2-DX D1, D2): the doctor's own Rx favourites and "your usual", and "Same as last visit" as one command.
-- A replaced read and a new command: no table, column, policy or grant change; expand-safe (nothing in the previous build calls the new keys or the command).
--
-- 1. public.consult_assist_context(p_tenant_id) replaced from its 000113 body (every existing key unchanged) with two more outputs:
--    rx_favourites  the calling doctor's 12 most prescribed medicines over their own last 300 signed visits, the signed version of each visit only (the visit
--                   is completed and signed, its latest header is signed and active; an open amendment, an unsigned or a cancelled visit is not counted),
--                   ranked by the sum over the visits of 0.5 ^ (age in days / 90), ties to the most recent then the name. Each entry: name, generic_name,
--                   dose_form, cdci_brand_id, substance_ids (the catalogue's, for the screen's allergy pre-check), n (visits) and usual = the most frequent
--                   exact (dosage, timing, duration) triple of this doctor for that medicine (ties to the most recent), or null when that triple has no
--                   dosage or no duration. STORED VALUES ONLY: nothing is invented and a stored null timing stays null.
--    diagnoses[].rx per diagnosis (this doctor's 30 most recent), the medicines present in at least 40 % of their signed visits with that diagnosis (at
--                   least 2 such visits, at most 6, most frequent first), each as above with the usual taken from the visits with that diagnosis.
--    Names, counts, catalogue ids and substance ids only: no patient, visit, prescription or item id. The empty result (no session, a forged clinic, a role
--    without consultations:edit) gains rx_favourites = [].
-- 2. public.repeat_visit_plan(p_tenant_id, p_visit_id, p_source_visit_id, p_parts, p_client_request_id): DEFINER, V2-07 pattern; prescriptions:edit AND
--    consultations:edit. The source must be a signed (completed) visit of the SAME patient in the same clinic (any doctor of the clinic, Q-14). p_parts is a
--    subset of {diagnoses, prescription}. It copies, from the database and never from caller input: the source's diagnoses (a name already on this visit is
--    skipped, case-insensitive; the note of the source diagnosis is not copied) and the source's signed-version Rx lines (a medicine already on this Rx is
--    skipped, case-insensitive). With assist.allergy_check entitled and allergies recorded, a line that matches an allergy (private.rx_allergy_matches, the
--    rule change_prescription uses) is NOT copied: its source item id is returned in skipped_item_ids and the screen opens it flagged. The target visit is
--    locked and refused like change_prescription (DRAFT_LOCKED for a sealed, an unsigned completed or a cancelled visit). Audit visit.repeat_plan (command-only,
--    counts only: added, skipped, diagnoses_added). Result: prescription_id (null when no line was copied and none existed), added_item_ids,
--    skipped_item_ids, diagnoses_added, replayed.
-- 3. Audit lists (bodies from 000118): visit.repeat_plan is command-only; metadata keys skipped, diagnoses_added.
-- Per-migration checklist: one replaced INVOKER read, one DEFINER command (search_path '', lock_timeout 2s, EXECUTE for authenticated only), two replaced audit
-- lists. No table, column, policy, grant or data change. An index is added only if the measurement on the R-17 seed shows a sequential scan (none here).

-- 1. consult_assist_context (000113 body, two outputs added) ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consult_assist_context(p_tenant_id uuid)
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
            'last_exam_template', NULL, 'rx_favourites', '[]'::jsonb);
    END IF;

    SELECT coalesce(t.timezone, 'Asia/Kolkata') INTO v_tz FROM public.tenants t WHERE t.id = p_tenant_id;

    WITH vs AS (
        SELECT v.id AS vid, v.signed_at, v.status AS vstatus
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
    ), rx_hdr AS (
        -- The signed version of each signed visit: the visit is completed (not an open amendment), and its latest header is signed and active.
        SELECT DISTINCT ON (vs.vid) vs.vid, vs.signed_at, p.id AS rxid
          FROM vs
          JOIN public.prescriptions p ON p.visit_id = vs.vid AND p.tenant_id = p_tenant_id AND p.signed_at IS NOT NULL AND p.status = 'active'
         WHERE vs.vstatus = 'completed'
         ORDER BY vs.vid, p.version DESC
    ), rxl AS (
        SELECT h.vid, h.signed_at, lower(btrim(i.medicine_name)) AS k, btrim(i.medicine_name) AS name,
               nullif(btrim(coalesce(i.generic_name, '')), '') AS generic_name, nullif(btrim(coalesce(i.dose_form, '')), '') AS dose_form,
               nullif(btrim(coalesce(i.cdci_brand_id, '')), '') AS brand,
               btrim(i.dosage) AS dosage, nullif(btrim(coalesce(i.timing, '')), '') AS timing, btrim(i.duration) AS duration,
               i.sort_order, i.id AS iid
          FROM rx_hdr h
          JOIN public.prescription_items i ON i.prescription_id = h.rxid AND i.tenant_id = p_tenant_id
         WHERE btrim(i.medicine_name) <> ''
    ), rx_visit AS (
        SELECT DISTINCT r.k, r.vid, r.signed_at FROM rxl r
    ), rx_show AS (
        -- How a medicine is named: its most recent line (the doctor's own spelling, catalogue id and generic).
        SELECT DISTINCT ON (r.k) r.k, r.name, r.generic_name, r.dose_form, r.brand
          FROM rxl r
         ORDER BY r.k, r.signed_at DESC, r.sort_order, r.iid
    ), fav AS (
        SELECT rv.k, count(*)::integer AS n, max(rv.signed_at) AS last_at,
               sum(power(0.5, greatest(extract(epoch FROM (now() - rv.signed_at)) / 86400.0, 0) / 90.0)) AS score
          FROM rx_visit rv
         GROUP BY rv.k
         ORDER BY score DESC, last_at DESC, rv.k
         LIMIT 12
    ), fav_usual AS (
        SELECT g.k, g.dosage, g.timing, g.duration
          FROM (
                SELECT r.k, r.dosage, r.timing, r.duration,
                       row_number() OVER (PARTITION BY r.k
                                          ORDER BY count(DISTINCT r.vid) DESC, max(r.signed_at) DESC, r.dosage, r.duration, r.timing NULLS FIRST) AS rn
                  FROM rxl r
                 WHERE r.k IN (SELECT f.k FROM fav f)
                 GROUP BY r.k, r.dosage, r.timing, r.duration
               ) g
         WHERE g.rn = 1
    ), dx_rx AS (
        -- Medicines present in at least 40 % of this doctor's signed visits with the diagnosis (at least 2 such visits), most frequent first, at most 6.
        SELECT q.dk, q.mk, q.n, q.last_at, row_number() OVER (PARTITION BY q.dk ORDER BY q.n DESC, q.last_at DESC, q.mk) AS rn
          FROM (
                SELECT dc.k AS dk, rv.k AS mk, count(DISTINCT rv.vid)::integer AS n, max(rv.signed_at) AS last_at, dc.n AS dn
                  FROM dx_counts dc
                  JOIN dx ON dx.k = dc.k
                  JOIN rx_visit rv ON rv.vid = dx.vid
                 GROUP BY dc.k, rv.k, dc.n
                HAVING dc.n >= 2 AND count(DISTINCT rv.vid) * 10 >= dc.n * 4
               ) q
    ), dx_rx_usual AS (
        SELECT g.dk, g.mk, g.dosage, g.timing, g.duration
          FROM (
                SELECT dr.dk, r.k AS mk, r.dosage, r.timing, r.duration,
                       row_number() OVER (PARTITION BY dr.dk, r.k
                                          ORDER BY count(DISTINCT r.vid) DESC, max(r.signed_at) DESC, r.dosage, r.duration, r.timing NULLS FIRST) AS rn
                  FROM dx_rx dr
                  JOIN dx ON dx.k = dr.dk
                  JOIN rxl r ON r.vid = dx.vid AND r.k = dr.mk
                 WHERE dr.rn <= 6
                 GROUP BY dr.dk, r.k, r.dosage, r.timing, r.duration
               ) g
         WHERE g.rn = 1
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
                       'follow_up_days', (SELECT fu.days FROM fu WHERE fu.k = d.k),
                       'rx', coalesce((
                           SELECT jsonb_agg(jsonb_build_object(
                                      'name', s.name, 'generic_name', s.generic_name, 'dose_form', s.dose_form, 'cdci_brand_id', s.brand,
                                      'substance_ids', to_jsonb(private.rx_line_substance_ids(s.brand, s.generic_name)), 'n', r.n,
                                      'usual', CASE WHEN u.dosage IS NOT NULL AND u.dosage <> '' AND u.duration IS NOT NULL AND u.duration <> ''
                                                    THEN jsonb_build_object('dosage', u.dosage, 'timing', u.timing, 'duration', u.duration) END
                                  ) ORDER BY r.rn)
                             FROM dx_rx r
                             JOIN rx_show s ON s.k = r.mk
                             LEFT JOIN dx_rx_usual u ON u.dk = r.dk AND u.mk = r.mk
                            WHERE r.dk = d.k AND r.rn <= 6), '[]'::jsonb)
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
             LIMIT 1),
        'rx_favourites', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'name', s.name, 'generic_name', s.generic_name, 'dose_form', s.dose_form, 'cdci_brand_id', s.brand,
                       'substance_ids', to_jsonb(private.rx_line_substance_ids(s.brand, s.generic_name)), 'n', f.n,
                       'usual', CASE WHEN u.dosage IS NOT NULL AND u.dosage <> '' AND u.duration IS NOT NULL AND u.duration <> ''
                                     THEN jsonb_build_object('dosage', u.dosage, 'timing', u.timing, 'duration', u.duration) END
                   ) ORDER BY f.score DESC, f.last_at DESC, f.k)
              FROM fav f
              JOIN rx_show s ON s.k = f.k
              LEFT JOIN fav_usual u ON u.k = f.k), '[]'::jsonb)
    ) INTO v_out;

    RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.consult_assist_context(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.consult_assist_context(uuid) TO authenticated;
COMMENT ON FUNCTION public.consult_assist_context(uuid) IS
    'V2-09b 09B-03 (R-12), V2-09c 000119 (R-9): the calling doctor''s own learned order for the consult, from their last 300 signed visits in the active full clinic: complaint frequencies, complaint-to-diagnosis co-occurrence, their 30 most recent diagnoses with the usual investigations, advice, follow-up gap in days and Rx (medicines in at least 40 % of their signed visits with it, at most 6, each with the doctor''s own stored usual dose), the last exam template id, and rx_favourites (their 12 most prescribed medicines, recent use weighted, each with the stored usual dose). The signed version of each visit only. Names, counts, catalogue ids and substance ids only; no patient, visit or item id; no invented dose. SECURITY INVOKER: RLS applies; a caller without consultations:edit in p_tenant_id (or a forged tenant) gets the empty result.';

-- 2. repeat_visit_plan (R-10) ---------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.repeat_visit_plan(
    p_tenant_id uuid,
    p_visit_id uuid,
    p_source_visit_id uuid,
    p_parts text[],
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
    v_replay jsonb;
    v_part text;
    v_do_dx boolean := false;
    v_do_rx boolean := false;
    v_target record;
    v_source record;
    v_src_rx uuid;
    v_rx uuid;
    v_tenant record;
    v_next integer;
    v_entitled boolean;
    v_allergies text[];
    v_item record;
    v_item_id uuid;
    v_generic_id text;
    v_added uuid[] := ARRAY[]::uuid[];
    v_skipped uuid[] := ARRAY[]::uuid[];
    v_dx_added integer := 0;
    v_result jsonb;
BEGIN
    -- 1. Actor: a session; this command has no system path.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. The tenant is the session's ACTIVE clinic (another clinic reads as not found), then prescriptions:edit AND consultations:edit there.
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT (public.has_permission(p_tenant_id, 'prescriptions:edit') AND public.has_permission(p_tenant_id, 'consultations:edit')) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    -- Input: two different visits and one or two known parts, each once.
    IF p_visit_id IS NULL OR p_source_visit_id IS NULL OR p_visit_id = p_source_visit_id
       OR p_parts IS NULL OR cardinality(p_parts) NOT BETWEEN 1 AND 2 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    FOREACH v_part IN ARRAY p_parts LOOP
        IF v_part = 'diagnoses' AND NOT v_do_dx THEN
            v_do_dx := true;
        ELSIF v_part = 'prescription' AND NOT v_do_rx THEN
            v_do_rx := true;
        ELSE
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
    END LOOP;

    -- 3. Claim; a replay returns the first result and writes nothing.
    v_replay := private.command_claim(p_tenant_id, p_client_request_id, 'public.repeat_visit_plan',
                                      private.command_request_hash(jsonb_build_object(
                                          'visit', p_visit_id, 'source', p_source_visit_id,
                                          'diagnoses', v_do_dx, 'prescription', v_do_rx)));
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock the target visit (a sign-off, an amendment and another Rx change on this visit run one after the other); the same states as change_prescription.
    SELECT v.status, v.signed_at, v.patient_id INTO v_target
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_target.status IN ('completed', 'cancelled') OR (v_target.signed_at IS NOT NULL AND v_target.status <> 'in_consultation') THEN
        RAISE EXCEPTION 'DRAFT_LOCKED' USING ERRCODE = 'P0001';
    END IF;

    -- The source: a signed (completed) visit of the SAME patient in this clinic. Anything else reads as not found (nothing about another clinic or patient is said).
    SELECT v.patient_id INTO v_source
      FROM public.visits v
     WHERE v.id = p_source_visit_id AND v.tenant_id = p_tenant_id AND v.patient_id = v_target.patient_id
       AND v.signed_at IS NOT NULL AND v.status = 'completed';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    -- 5. Writes. The diagnoses: the source's, from the database; a name already on this visit is skipped. The source's note is not copied.
    IF v_do_dx THEN
        INSERT INTO public.consultation_diagnoses (tenant_id, visit_id, patient_id, diagnosis_name, snomed_concept_id, icd11_code, is_custom, is_chronic)
        SELECT p_tenant_id, p_visit_id, v_target.patient_id, d.diagnosis_name, d.snomed_concept_id, d.icd11_code, d.is_custom, d.is_chronic
          FROM public.consultation_diagnoses d
         WHERE d.visit_id = p_source_visit_id AND d.tenant_id = p_tenant_id
           AND NOT EXISTS (SELECT 1 FROM public.consultation_diagnoses x
                            WHERE x.visit_id = p_visit_id AND x.tenant_id = p_tenant_id
                              AND lower(btrim(x.diagnosis_name)) = lower(btrim(d.diagnosis_name)))
         ORDER BY d.created_at, d.id;
        GET DIAGNOSTICS v_dx_added = ROW_COUNT;
    END IF;

    -- The prescription lines: the source's signed version, in its order.
    SELECT p.id INTO v_rx
      FROM public.prescriptions p
     WHERE p.tenant_id = p_tenant_id AND p.visit_id = p_visit_id
     ORDER BY p.version DESC
     LIMIT 1
       FOR UPDATE;
    IF v_do_rx THEN
        SELECT p.id INTO v_src_rx
          FROM public.prescriptions p
         WHERE p.tenant_id = p_tenant_id AND p.visit_id = p_source_visit_id AND p.signed_at IS NOT NULL AND p.status = 'active'
         ORDER BY p.version DESC
         LIMIT 1;
        IF v_src_rx IS NOT NULL THEN
            -- The allergy check, as change_prescription reads it: entitled and allergies recorded.
            v_entitled := coalesce(billing_internal.has_entitlement(p_tenant_id, 'assist.allergy_check', now()), false);
            IF v_entitled THEN
                SELECT p.allergies INTO v_allergies FROM public.patients p WHERE p.id = v_target.patient_id AND p.tenant_id = p_tenant_id;
            END IF;
            FOR v_item IN
                SELECT i.id, i.medicine_name, i.generic_name, i.dose_form, i.dosage, i.timing, i.duration, i.special_instructions, i.cdci_brand_id
                  FROM public.prescription_items i
                 WHERE i.tenant_id = p_tenant_id AND i.prescription_id = v_src_rx
                 ORDER BY i.sort_order, i.id
            LOOP
                -- A medicine already on this Rx (or copied a moment ago) is not copied again.
                IF v_rx IS NOT NULL AND EXISTS (SELECT 1 FROM public.prescription_items x
                                                 WHERE x.tenant_id = p_tenant_id AND x.prescription_id = v_rx
                                                   AND lower(btrim(x.medicine_name)) = lower(btrim(v_item.medicine_name))) THEN
                    CONTINUE;
                END IF;
                -- A line that matches a recorded allergy is never copied silently: it is reported by its source item id and the doctor decides.
                IF v_allergies IS NOT NULL AND cardinality(v_allergies) > 0
                   AND cardinality(private.rx_allergy_matches(
                           v_allergies,
                           private.rx_line_substance_ids(nullif(btrim(coalesce(v_item.cdci_brand_id, '')), ''), nullif(btrim(coalesce(v_item.generic_name, '')), '')),
                           ARRAY[btrim(v_item.medicine_name), coalesce(v_item.generic_name, '')])) > 0 THEN
                    v_skipped := v_skipped || v_item.id;
                    CONTINUE;
                END IF;
                IF v_rx IS NULL THEN
                    SELECT t.rx_letterhead_mode, t.rx_paper_size INTO v_tenant FROM public.tenants t WHERE t.id = p_tenant_id;
                    INSERT INTO public.prescriptions (tenant_id, visit_id, patient_id, doctor_id, version, status, letterhead_mode, paper_size)
                    VALUES (p_tenant_id, p_visit_id, v_target.patient_id, v_uid, 1, 'active', v_tenant.rx_letterhead_mode, v_tenant.rx_paper_size)
                    RETURNING id INTO v_rx;
                END IF;
                SELECT coalesce(max(x.sort_order), -1) + 1 INTO v_next
                  FROM public.prescription_items x WHERE x.tenant_id = p_tenant_id AND x.prescription_id = v_rx;
                v_generic_id := NULL;
                IF nullif(btrim(coalesce(v_item.cdci_brand_id, '')), '') IS NOT NULL THEN
                    SELECT b.generic_id INTO v_generic_id FROM public.cdci_brands b WHERE b.id = btrim(v_item.cdci_brand_id);
                END IF;
                -- The stored values exactly: a null timing stays null, nothing is added.
                INSERT INTO public.prescription_items (tenant_id, prescription_id, medicine_name, generic_name, dose_form, dosage, timing, duration,
                                                       special_instructions, cdci_brand_id, cdci_generic_id, sort_order)
                VALUES (p_tenant_id, v_rx, btrim(v_item.medicine_name), nullif(btrim(coalesce(v_item.generic_name, '')), ''),
                        nullif(btrim(coalesce(v_item.dose_form, '')), ''), btrim(v_item.dosage),
                        nullif(btrim(coalesce(v_item.timing, '')), ''), btrim(v_item.duration),
                        nullif(btrim(coalesce(v_item.special_instructions, '')), ''),
                        nullif(btrim(coalesce(v_item.cdci_brand_id, '')), ''), v_generic_id, v_next)
                RETURNING id INTO v_item_id;
                v_added := v_added || v_item_id;
                -- A medicine outside the catalogue joins the doctor's own list with this line's dose, as a line the doctor adds does.
                IF nullif(btrim(coalesce(v_item.cdci_brand_id, '')), '') IS NULL THEN
                    INSERT INTO public.doctor_custom_medicines (tenant_id, doctor_id, medicine_name, generic_name, dose_form,
                                                                default_dosage, default_timing, default_duration, use_count)
                    VALUES (p_tenant_id, v_uid, btrim(v_item.medicine_name), nullif(btrim(coalesce(v_item.generic_name, '')), ''),
                            nullif(btrim(coalesce(v_item.dose_form, '')), ''), btrim(v_item.dosage),
                            nullif(btrim(coalesce(v_item.timing, '')), ''), btrim(v_item.duration), 1)
                    ON CONFLICT (tenant_id, doctor_id, medicine_name) DO UPDATE
                       SET generic_name = EXCLUDED.generic_name, dose_form = EXCLUDED.dose_form,
                           default_dosage = EXCLUDED.default_dosage, default_timing = EXCLUDED.default_timing,
                           default_duration = EXCLUDED.default_duration,
                           use_count = public.doctor_custom_medicines.use_count + 1, updated_at = now();
                END IF;
            END LOOP;
        END IF;
    END IF;

    PERFORM private.log_command_audit(p_tenant_id, 'visit.repeat_plan', 'visit', p_visit_id,
                             jsonb_build_object('added', cardinality(v_added), 'skipped', cardinality(v_skipped), 'diagnoses_added', v_dx_added));

    v_result := jsonb_build_object('prescription_id', v_rx, 'added_item_ids', to_jsonb(v_added), 'skipped_item_ids', to_jsonb(v_skipped),
                                   'diagnoses_added', v_dx_added, 'replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.repeat_visit_plan(uuid, uuid, uuid, text[], uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.repeat_visit_plan(uuid, uuid, uuid, text[], uuid) TO authenticated;
COMMENT ON FUNCTION public.repeat_visit_plan(uuid, uuid, uuid, text[], uuid) IS
    'V2-09c 09C-03 (R-10): "Same as last visit" in one transaction: copies, from the database, the signed source visit''s diagnoses and/or its signed-version prescription lines onto this visit (p_parts a subset of diagnoses, prescription). The source must be a completed, signed visit of the same patient in this clinic (VISIT_NOT_FOUND, P0002, otherwise: another clinic''s or patient''s visit reads as not found). A diagnosis name or medicine already on this visit is skipped; the stored values are copied exactly (a null timing stays null). With assist.allergy_check entitled and allergies recorded, a line that matches an allergy (private.rx_allergy_matches) is not copied and its source item id is returned in skipped_item_ids. prescriptions:edit AND consultations:edit; a sealed, an unsigned completed or a cancelled visit is DRAFT_LOCKED (P0001). Audit visit.repeat_plan (added, skipped, diagnoses_added counts only). Idempotent by p_client_request_id. Result: prescription_id, added_item_ids, skipped_item_ids, diagnoses_added, replayed.';

-- 3. Audit allow-lists (bodies from 000118) -------------------------------------------------------------------------------------------------------
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
                                            'visit.auto_promoted_from_waitlist', 'waitlist.add', 'waitlist.promote',
                                            'visit.create', 'consultation.draft_save', 'prescription.lines_change', 'patient.allergies_record', 'visit.repeat_plan')
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
    'V2-07 07-04a (F-1), V2-08 08-01b, 08-04a, 08-06a, V2-09b 000112, V2-09c 000117, 000118, 000119: writes an audit row as the session user for the actions only a command writes (visit.complete_and_sign, visit.reopen_for_amendment, visit.amend_finalized, invoice.create, queue.check_in, visit.consultation_start, visit.complete_at_desk, visit.reschedule, visit.no_show, visit.cancel, visit.confirm, visit.auto_promoted_from_waitlist, waitlist.add, waitlist.promote, visit.create, consultation.draft_save, prescription.lines_change, patient.allergies_record, visit.repeat_plan), with log_audit''s metadata rules. The active clinic and a membership are required. No API grant: public.log_audit refuses these actions.';

CREATE OR REPLACE FUNCTION private.audit_metadata_keys()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT ARRAY[
        'added', 'allergies_count', 'allergy_overrides', 'amendment_reason', 'conflict_overwrite', 'coded_count', 'consent_type', 'correlation_id', 'diagnoses_added', 'dose_form', 'draft_version', 'erased_at',
        'fields_changed',
        'follow_up_date', 'format', 'invoice_id', 'invoice_number', 'is_chronic', 'is_custom', 'is_initial_grant',
        'is_overbooked', 'items_count', 'late_arrival', 'letterhead_mode', 'new_scheduled_at', 'new_status',
        'old_scheduled_at', 'old_status', 'origin_type',
        'patient_consents_history_sharing', 'payment_method', 'priority', 'promoted_from_waitlist_id',
        'promoted_visit_id', 'reason', 'referral_type', 'removed', 'retention_policy', 'revision_number', 'sha256', 'skipped', 'specialty', 'status',
        'storage_path', 'target_date', 'target_tenant_id', 'template_name', 'token_number', 'total_amount', 'updated', 'urgency',
        'version', 'view_context'
    ]::TEXT[];
$$;
