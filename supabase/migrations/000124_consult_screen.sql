-- Migration: 000124_consult_screen.sql
-- V2-09e 09E-05 (R-8, R-9): the consult in one read. A new INVOKER read composed of existing reads; no table, policy or grant change beyond EXECUTE.
--
-- public.consult_screen(p_tenant_id, p_visit_id) returns one jsonb with everything the consult page used to read in 14 sequential calls:
--   visit, patient, notes (with draft_version), token_number, follow_up, diagnoses, prescription {items, latest_version}, amendment, history,
--   entitlements (the assist.* map), assist_context, snapshot, macros, upcoming, documents, allergy_context, my_lists.
-- Every part keeps the gate the page applied: consultations:view for the whole read (NULL otherwise: another clinic, a forged tenant, a visit the caller
-- cannot read, a role without the permission); the assist.* parts only for a clinic whose access level is `full` and an entitled key; the learned order,
-- the macros and the follow-up instants only for an editable record (amending, or a draft that is not completed or cancelled: the TypeScript predicate
-- `recordState` is the rule, applied again by the page); documents only with labs:view; my_lists (the caller's OWN custom medicines, custom diagnoses and
-- protocol templates, doctor_id = auth.uid(), capped 500/500/100 by R-8) only with prescriptions:edit or consultations:edit. The print payload of a
-- sealed record is not part of it (a separate streamed read, R-9).
-- The function composes reads that are already INVOKER and gated (consult_assist_context, patient_snapshot, rx_allergy_context, my_entitlements,
-- my_tenant_access): RLS applies to every table it reads. STABLE: one snapshot for all parts.
-- Per-migration checklist: one new public function (STABLE INVOKER, search_path '', EXECUTE for authenticated only). No table, column, policy, trigger or data change.

CREATE FUNCTION public.consult_screen(p_tenant_id uuid, p_visit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_visit record;
    v_patient jsonb;
    v_full boolean;
    v_editable boolean;
    v_amending boolean;
    v_can_edit boolean;
    v_assist jsonb := '{}'::jsonb;
    v_notes jsonb;
    v_out jsonb;
BEGIN
    IF v_uid IS NULL OR p_tenant_id IS NULL OR p_visit_id IS NULL THEN
        RETURN NULL;
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'consultations:view') THEN
        RETURN NULL;
    END IF;

    SELECT v.id, v.patient_id, v.doctor_id, v.status, v.scheduled_at, v.specialty, v.signed_at, v.current_revision INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT jsonb_build_object(
               'id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'whatsapp_opt_out', p.whatsapp_opt_out, 'sex', p.sex,
               'date_of_birth', p.date_of_birth, 'age', p.age, 'allergies', p.allergies, 'chronic_conditions', p.chronic_conditions,
               'national_health_id', p.national_health_id)
      INTO v_patient
      FROM public.patients p
     WHERE p.id = v_visit.patient_id AND p.tenant_id = p_tenant_id;
    IF v_patient IS NULL THEN
        RETURN NULL;
    END IF;

    v_amending := v_visit.signed_at IS NOT NULL AND v_visit.status = 'in_consultation';
    v_editable := v_amending OR (v_visit.signed_at IS NULL AND v_visit.status NOT IN ('completed', 'cancelled'));
    v_can_edit := public.has_permission(p_tenant_id, 'consultations:edit');
    v_full := public.my_tenant_access(p_tenant_id) = 'full';

    -- The assist.* entitlements of a clinic that is `full` (a clinic that is not has none: no assist part below is read).
    IF v_full THEN
        SELECT coalesce(jsonb_object_agg(e.key, e.enabled), '{}'::jsonb) INTO v_assist
          FROM public.my_entitlements(p_tenant_id) e
         WHERE e.key LIKE 'assist.%';
    END IF;

    SELECT jsonb_build_object(
               'vitals', n.vitals, 'chief_complaints', n.chief_complaints, 'clinical_notes', n.clinical_notes, 'specialty_data', n.specialty_data,
               'investigations_advised', n.investigations_advised, 'advice', n.advice, 'draft_version', n.draft_version)
      INTO v_notes
      FROM public.clinical_notes n
     WHERE n.visit_id = p_visit_id AND n.tenant_id = p_tenant_id;

    v_out := jsonb_build_object(
        'visit', jsonb_build_object(
            'id', v_visit.id, 'patient_id', v_visit.patient_id, 'doctor_id', v_visit.doctor_id, 'status', v_visit.status,
            'scheduled_at', v_visit.scheduled_at, 'specialty', v_visit.specialty, 'signed_at', v_visit.signed_at,
            'current_revision', v_visit.current_revision),
        'patient', v_patient,
        'notes', v_notes,
        'token_number', (SELECT q.token_number FROM public.queue_tokens q WHERE q.visit_id = p_visit_id AND q.tenant_id = p_tenant_id LIMIT 1),
        'follow_up', (SELECT jsonb_build_object('follow_up_date', f.follow_up_date, 'notes', f.notes)
                        FROM public.follow_ups f WHERE f.visit_id = p_visit_id AND f.tenant_id = p_tenant_id LIMIT 1),
        'diagnoses', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', d.id, 'visit_id', d.visit_id, 'patient_id', d.patient_id, 'diagnosis_name', d.diagnosis_name,
                       'snomed_concept_id', d.snomed_concept_id, 'icd11_code', d.icd11_code, 'is_custom', d.is_custom,
                       'is_chronic', d.is_chronic, 'notes', d.notes, 'created_at', d.created_at) ORDER BY d.created_at, d.id)
              FROM public.consultation_diagnoses d
             WHERE d.visit_id = p_visit_id AND d.tenant_id = p_tenant_id), '[]'::jsonb),
        'prescription', jsonb_build_object(
            'items', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                           'id', i.id, 'prescription_id', i.prescription_id, 'medicine_name', i.medicine_name, 'generic_name', i.generic_name,
                           'dose_form', i.dose_form, 'dosage', i.dosage, 'timing', i.timing, 'duration', i.duration,
                           'special_instructions', i.special_instructions, 'cdci_brand_id', i.cdci_brand_id, 'cdci_generic_id', i.cdci_generic_id,
                           'sort_order', i.sort_order, 'created_at', i.created_at) ORDER BY i.sort_order, i.created_at, i.id)
                  FROM public.prescriptions r
                  JOIN public.prescription_items i ON i.prescription_id = r.id
                 WHERE r.visit_id = p_visit_id AND r.tenant_id = p_tenant_id AND r.status = 'active'), '[]'::jsonb),
            'latest_version', (SELECT r.version FROM public.prescriptions r
                                WHERE r.visit_id = p_visit_id AND r.tenant_id = p_tenant_id ORDER BY r.version DESC LIMIT 1)),
        'amendment', CASE WHEN v_amending THEN
            (SELECT jsonb_build_object('reason', vr.amendment_reason, 'opened_at', vr.amended_at)
               FROM public.visit_revisions vr WHERE vr.visit_id = p_visit_id AND vr.tenant_id = p_tenant_id
              ORDER BY vr.revision_number DESC LIMIT 1) END,
        -- The patient's other encounters (completed or in consultation), newest first, with their diagnoses and active prescription lines.
        'history', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', hv.id, 'scheduled_at', hv.scheduled_at, 'created_at', hv.created_at, 'status', hv.status, 'signed_at', hv.signed_at,
                       'specialty', hv.specialty,
                       'notes', (SELECT jsonb_build_object('vitals', n.vitals, 'chief_complaints', n.chief_complaints,
                                                           'clinical_notes', n.clinical_notes, 'advice', n.advice)
                                   FROM public.clinical_notes n WHERE n.visit_id = hv.id AND n.tenant_id = p_tenant_id),
                       'diagnoses', coalesce((
                           SELECT jsonb_agg(jsonb_build_object(
                                      'id', d.id, 'visit_id', d.visit_id, 'diagnosis_name', d.diagnosis_name, 'icd11_code', d.icd11_code,
                                      'snomed_concept_id', d.snomed_concept_id, 'is_chronic', d.is_chronic) ORDER BY d.created_at, d.id)
                             FROM public.consultation_diagnoses d WHERE d.visit_id = hv.id AND d.tenant_id = p_tenant_id), '[]'::jsonb),
                       'prescriptions', coalesce((
                           SELECT jsonb_agg(jsonb_build_object(
                                      'id', r.id, 'version', r.version,
                                      'items', coalesce((
                                          SELECT jsonb_agg(jsonb_build_object(
                                                     'id', i.id, 'prescription_id', i.prescription_id, 'medicine_name', i.medicine_name,
                                                     'generic_name', i.generic_name, 'dose_form', i.dose_form, 'dosage', i.dosage,
                                                     'timing', i.timing, 'duration', i.duration,
                                                     'special_instructions', i.special_instructions, 'sort_order', i.sort_order)
                                                 ORDER BY i.sort_order, i.id)
                                            FROM public.prescription_items i WHERE i.prescription_id = r.id), '[]'::jsonb))
                                  ORDER BY r.version DESC, r.id)
                             FROM public.prescriptions r
                            WHERE r.visit_id = hv.id AND r.tenant_id = p_tenant_id AND r.status = 'active'), '[]'::jsonb)
                   ) ORDER BY hv.created_at DESC, hv.id)
              FROM public.visits hv
             WHERE hv.tenant_id = p_tenant_id AND hv.patient_id = v_visit.patient_id
               AND hv.status IN ('completed', 'in_consultation') AND hv.id <> p_visit_id), '[]'::jsonb),
        'entitlements', v_assist,
        'allergy_context', public.rx_allergy_context(p_tenant_id, p_visit_id)
    );

    -- The learned order (terminology, the Rx favourites and usual doses): an editable record and consultations:edit.
    IF v_full AND v_editable AND v_can_edit
       AND (coalesce((v_assist ->> 'assist.terminology')::boolean, false) OR coalesce((v_assist ->> 'assist.frequent_rx')::boolean, false)) THEN
        v_out := v_out || jsonb_build_object('assist_context', public.consult_assist_context(p_tenant_id));
    END IF;

    -- The patient snapshot (signed visits only, this visit excluded).
    IF v_full AND coalesce((v_assist ->> 'assist.snapshot')::boolean, false) THEN
        v_out := v_out || jsonb_build_object('snapshot', public.patient_snapshot(p_tenant_id, v_visit.patient_id, p_visit_id));
    END IF;

    -- The caller's own text macros.
    IF v_full AND v_editable AND v_can_edit AND coalesce((v_assist ->> 'assist.shorthand')::boolean, false) THEN
        v_out := v_out || jsonb_build_object('macros', coalesce((
            SELECT jsonb_agg(jsonb_build_object('id', m.id, 'shortcut', m.shortcut, 'expansion', m.expansion) ORDER BY m.shortcut)
              FROM (SELECT m0.id, m0.shortcut, m0.expansion FROM public.doctor_text_macros m0
                     WHERE m0.tenant_id = p_tenant_id AND m0.doctor_id = v_uid ORDER BY m0.shortcut LIMIT 200) m), '[]'::jsonb));
    END IF;

    -- The instants of this patient's booked or confirmed visits with this visit's doctor from three days ago onward (the follow-up display rule).
    IF v_full AND v_editable AND coalesce((v_assist ->> 'assist.followup')::boolean, false) THEN
        v_out := v_out || jsonb_build_object('upcoming', coalesce((
            SELECT jsonb_agg(u.scheduled_at ORDER BY u.scheduled_at)
              FROM (SELECT uv.scheduled_at FROM public.visits uv
                     WHERE uv.tenant_id = p_tenant_id AND uv.patient_id = v_visit.patient_id AND uv.doctor_id = v_visit.doctor_id
                       AND uv.status IN ('booked', 'confirmed') AND uv.scheduled_at >= now() - interval '3 days'
                     ORDER BY uv.scheduled_at LIMIT 20) u), '[]'::jsonb));
    END IF;

    -- The patient's documents, newest first, for a role that may read them.
    IF public.has_permission(p_tenant_id, 'labs:view') THEN
        v_out := v_out || jsonb_build_object('documents', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', pd.id, 'visit_id', pd.visit_id, 'title', pd.title, 'original_filename', pd.original_filename,
                       'mime_type', pd.mime_type, 'file_size_bytes', pd.file_size_bytes, 'report_date', pd.report_date,
                       'created_at', pd.created_at) ORDER BY pd.report_date DESC, pd.created_at DESC, pd.id)
              FROM public.patient_documents pd WHERE pd.patient_id = v_visit.patient_id AND pd.tenant_id = p_tenant_id), '[]'::jsonb));
    END IF;

    -- The caller's OWN lists (R-8): doctor_id = auth.uid() is the only thing that keeps another doctor's rows out (the tables' policies are clinic-wide).
    IF public.has_permission(p_tenant_id, 'prescriptions:edit') OR v_can_edit THEN
        v_out := v_out || jsonb_build_object('my_lists', jsonb_build_object(
            'custom_medicines', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                           'medicine_name', cm.medicine_name, 'generic_name', cm.generic_name, 'dose_form', cm.dose_form,
                           'default_dosage', cm.default_dosage, 'default_timing', cm.default_timing, 'default_duration', cm.default_duration,
                           'use_count', cm.use_count) ORDER BY cm.use_count DESC, cm.medicine_name)
                  FROM (SELECT * FROM public.doctor_custom_medicines c0
                         WHERE c0.tenant_id = p_tenant_id AND c0.doctor_id = v_uid ORDER BY c0.use_count DESC, c0.medicine_name LIMIT 500) cm), '[]'::jsonb),
            'custom_diagnoses', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                           'diagnosis_name', cd.diagnosis_name, 'specialty', cd.specialty, 'use_count', cd.use_count)
                           ORDER BY cd.use_count DESC, cd.diagnosis_name)
                  FROM (SELECT * FROM public.doctor_custom_diagnoses c0
                         WHERE c0.tenant_id = p_tenant_id AND c0.doctor_id = v_uid ORDER BY c0.use_count DESC, c0.diagnosis_name LIMIT 500) cd), '[]'::jsonb),
            'templates', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                           'id', t.id, 'template_name', t.template_name, 'specialty', t.specialty, 'items', t.items, 'created_at', t.created_at)
                           ORDER BY t.template_name, t.id)
                  FROM (SELECT * FROM public.doctor_prescription_templates t0
                         WHERE t0.tenant_id = p_tenant_id AND t0.doctor_id = v_uid ORDER BY t0.template_name, t0.id LIMIT 100) t), '[]'::jsonb)));
    END IF;

    RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.consult_screen(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.consult_screen(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.consult_screen(uuid, uuid) IS
    'V2-09e 09E-05 (R-8, R-9): the consult in one read, a new INVOKER read composed of existing reads; no table, policy or grant change beyond EXECUTE. consultations:view in p_tenant_id; NULL for another clinic, a forged tenant, a visit or patient the caller cannot read. Parts and their gates are listed in the migration header; the caller''s own custom medicines, custom diagnoses and templates only (doctor_id = auth.uid()). SECURITY INVOKER: RLS applies to every table it reads.';
