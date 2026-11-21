-- 000116_consult_review_fixes.sql — V2-09b 09B-06a, the review fix round (09B-REVIEW-TRIAGE.md: A-4, S-2 / A-8, S-4, S-7; S-3 inventoried and deferred).
--
-- A-4  Upload idempotency. `patient_documents.client_request_id uuid` (nullable: rows before 000116 and callers that send none have no id) with the
--      partial unique index `patient_documents_client_request_unique (tenant_id, client_request_id) WHERE client_request_id IS NOT NULL`. The upload
--      control makes one id per file and re-sends it on Retry; the service derives the storage key from it and returns the stored row for a repeat, so
--      a retry after a lost response stores one row and one object. Two parallel inserts of one id: the index lets one win.
-- S-2  No document is linked to a visit whose record is closed. `private.patient_documents_visit_open`, BEFORE INSERT on public.patient_documents,
--      every writer: a row whose visit (in the row's clinic) is completed, cancelled, or signed and not reopened for amendment is refused
--      (DOCUMENT_VISIT_LOCKED, 42501): the predicate of DRAFT_LOCKED in save_consultation_draft and of recordState (09A R-2). A visit id that is not
--      the clinic's is left to the composite FK (23503). Every role holding labs:edit (owner, doctor, nurse) also holds appointments:view, so the
--      visits SELECT policy shows the trigger every visit of the clinic. A row with no visit (an upload to the patient's record) is unaffected.
--      UPDATE on patient_documents is revoked from authenticated (000111), and the FK's ON DELETE SET NULL only clears visit_id, so INSERT is the path.
-- S-4  `public.save_consultation_draft` (replaced; latest body 000112:269-534, changed only as listed) also checks: the vitals ranges and integer
--      fields of vitalsSchema, systolic above diastolic, sugar_type in (random, fasting, pp); each complaint's keys and types (chiefComplaintItemSchema);
--      a follow-up date from the clinic's today to today + 366 days (a date the visit's follow-up already holds is accepted unchanged). All INPUT_INVALID.
--      `specialty_data` keys per specialty stay open (V2-14 backlog row, 09B-NOTES 09B-06a).
-- S-7  EXECUTE on the two 000115 trigger functions is revoked from PUBLIC, anon, authenticated and service_role (the per-migration checklist).
-- S-3  Not here: `recordVisitVitals` (features/visits/service.ts) still writes clinical_notes.vitals with the caller's JWT, so UPDATE (vitals) stays
--      granted to authenticated (inventory in 09B-NOTES 09B-06a; deferred to V2-14 with a vitals command).
--
-- Per-migration checklist: expand-only (one nullable column, one index, one trigger); no data change; no policy change. The trigger function is INVOKER
-- with search_path '' and qualified names, EXECUTE revoked from PUBLIC, anon, authenticated, service_role. The replaced command keeps its signature,
-- settings and grants (EXECUTE for authenticated only).

-- A-4 -----------------------------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.patient_documents ADD COLUMN client_request_id uuid;
COMMENT ON COLUMN public.patient_documents.client_request_id IS
    'V2-09b 09B-06a (A-4): the id the upload control made for this file; a repeat of the same upload (a retry after a lost response) returns this row. Null before 000116.';
CREATE UNIQUE INDEX patient_documents_client_request_unique
    ON public.patient_documents (tenant_id, client_request_id) WHERE client_request_id IS NOT NULL;

-- S-2 -----------------------------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION private.patient_documents_visit_open()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NEW.visit_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.visits v
                    WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.visit_id
                      AND (v.status IN ('completed', 'cancelled') OR (v.signed_at IS NOT NULL AND v.status <> 'in_consultation'))) THEN
        RAISE EXCEPTION 'DOCUMENT_VISIT_LOCKED' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.patient_documents_visit_open() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.patient_documents_visit_open() IS
    'V2-09b 09B-06a (S-2 / A-8): BEFORE INSERT on patient_documents, every writer. A document linked to a completed or cancelled visit, or to a signed '
    'visit not reopened for amendment, is refused (DOCUMENT_VISIT_LOCKED, 42501). A document with no visit is unaffected; a foreign visit is the FK''s.';
CREATE TRIGGER patient_documents_visit_open
    BEFORE INSERT ON public.patient_documents
    FOR EACH ROW EXECUTE FUNCTION private.patient_documents_visit_open();

-- S-7 -----------------------------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION private.doctor_text_macros_before_insert(), private.doctor_text_macros_before_update()
    FROM PUBLIC, anon, authenticated, service_role;

-- S-4: the command, replaced ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_consultation_draft(
    p_tenant_id uuid,
    p_visit_id uuid,
    p_expected_version integer,
    p_patch jsonb,
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
    v_visit record;
    v_notes record;
    v_key text;
    v_el jsonb;
    v_fields text[] := ARRAY[]::text[];
    v_mkeys constant text[] := ARRAY['systolic', 'diastolic', 'pulse', 'temperature', 'spo2', 'weight', 'height', 'respiratory_rate', 'bmi'];
    v_in jsonb;
    v_vitals jsonb;
    v_has_measure boolean;
    v_same boolean;
    v_prov jsonb;
    v_specialty text;
    v_metadata jsonb;
    v_overwrite boolean := false;
    v_started boolean := false;
    v_new_version integer;
    v_fu jsonb;
    v_fu_date date;
    v_result jsonb;
    -- 000116 (S-4): the measurement ranges of vitalsSchema (features/consultation/schema.ts): [min, max, integer only].
    v_ranges constant jsonb := '{"systolic": [50, 250, true], "diastolic": [30, 150, true], "pulse": [30, 220, true],
                                 "temperature": [90, 110, false], "spo2": [50, 100, true], "weight": [0.5, 300, false],
                                 "height": [20, 250, false], "respiratory_rate": [8, 60, true], "sugar": [10, 1000, false]}'::jsonb;
    v_range jsonb;
    v_num numeric;
    v_today date;
BEGIN
    -- 1. Actor: a session; this command has no system path.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. The tenant is the session's ACTIVE clinic (another clinic reads as not found), then consultations:edit there.
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'consultations:edit') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    -- Input: a visit, a version, and a patch of known keys and types, at most 256 kB.
    IF p_visit_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0
       OR p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb
       OR octet_length(p_patch::text) > 262144 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
        IF v_key NOT IN ('vitals', 'chief_complaints', 'clinical_notes', 'specialty_data', 'investigations_advised', 'advice',
                         'specialty', 'provenance', 'follow_up', 'conflict_overwrite') THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
    END LOOP;
    IF (p_patch ? 'vitals' AND jsonb_typeof(p_patch -> 'vitals') NOT IN ('object', 'null'))
       OR (p_patch ? 'chief_complaints' AND jsonb_typeof(p_patch -> 'chief_complaints') <> 'array')
       OR (p_patch ? 'clinical_notes' AND jsonb_typeof(p_patch -> 'clinical_notes') NOT IN ('string', 'null'))
       OR (p_patch ? 'specialty_data' AND jsonb_typeof(p_patch -> 'specialty_data') NOT IN ('object', 'null'))
       OR (p_patch ? 'investigations_advised' AND jsonb_typeof(p_patch -> 'investigations_advised') <> 'array')
       OR (p_patch ? 'advice' AND jsonb_typeof(p_patch -> 'advice') <> 'array')
       OR (p_patch ? 'specialty' AND (jsonb_typeof(p_patch -> 'specialty') <> 'string'
                                      OR (p_patch ->> 'specialty') NOT IN ('general_physician', 'dental', 'pediatrics')))
       OR (p_patch ? 'provenance' AND jsonb_typeof(p_patch -> 'provenance') NOT IN ('object', 'null'))
       OR (p_patch ? 'follow_up' AND jsonb_typeof(p_patch -> 'follow_up') NOT IN ('object', 'null'))
       OR (p_patch ? 'conflict_overwrite' AND jsonb_typeof(p_patch -> 'conflict_overwrite') <> 'boolean') THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- The text-list columns hold strings only (at most 200 entries, 500 characters each).
    FOREACH v_key IN ARRAY ARRAY['investigations_advised', 'advice'] LOOP
        IF p_patch ? v_key THEN
            IF jsonb_array_length(p_patch -> v_key) > 200
               OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_patch -> v_key) a(el)
                           WHERE jsonb_typeof(a.el) <> 'string' OR char_length(a.el #>> '{}') > 500) THEN
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
        END IF;
    END LOOP;
    IF p_patch ? 'chief_complaints' THEN
        IF jsonb_array_length(p_patch -> 'chief_complaints') > 100
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_patch -> 'chief_complaints') a(el) WHERE jsonb_typeof(a.el) <> 'object') THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        -- 000116 (S-4): each complaint has the keys and types of chiefComplaintItemSchema: symptom 1 to 200 characters; optional id (a string of at most
        -- 100), duration_val (a positive integer), duration_unit (days, weeks, months, years) and notes (a string of at most 500, or null). Nothing else.
        FOR v_el IN SELECT a.el FROM jsonb_array_elements(p_patch -> 'chief_complaints') a(el) LOOP
            IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_el) k WHERE k NOT IN ('id', 'symptom', 'duration_val', 'duration_unit', 'notes'))
               OR jsonb_typeof(v_el -> 'symptom') IS DISTINCT FROM 'string'
               OR char_length(v_el ->> 'symptom') NOT BETWEEN 1 AND 200
               OR (v_el ? 'id' AND (jsonb_typeof(v_el -> 'id') <> 'string' OR char_length(v_el ->> 'id') > 100))
               OR (v_el ? 'duration_unit' AND (jsonb_typeof(v_el -> 'duration_unit') <> 'string'
                                               OR (v_el ->> 'duration_unit') NOT IN ('days', 'weeks', 'months', 'years')))
               OR (v_el ? 'notes' AND (jsonb_typeof(v_el -> 'notes') NOT IN ('string', 'null') OR char_length(v_el ->> 'notes') > 500)) THEN
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
            IF v_el ? 'duration_val' THEN
                IF jsonb_typeof(v_el -> 'duration_val') <> 'number' THEN
                    RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
                END IF;
                v_num := (v_el ->> 'duration_val')::numeric;
                IF v_num <= 0 OR v_num <> trunc(v_num) OR v_num > 9007199254740991 THEN
                    RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
                END IF;
            END IF;
        END LOOP;
    END IF;
    -- Vitals: known keys only; the measurements are numbers or null, inside the ranges of vitalsSchema (000116, S-4: before, the ranges were the
    -- service's zod schema only, so a direct RPC call stored any number); systolic above diastolic when both are given; sugar_type is one of the three.
    IF p_patch ? 'vitals' AND jsonb_typeof(p_patch -> 'vitals') = 'object' THEN
        FOR v_key, v_el IN SELECT e.key, e.value FROM jsonb_each(p_patch -> 'vitals') e LOOP
            IF v_key = ANY (v_mkeys) OR v_key = 'sugar' THEN
                IF jsonb_typeof(v_el) NOT IN ('number', 'null') THEN
                    RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
                END IF;
                v_range := v_ranges -> v_key;
                IF jsonb_typeof(v_el) = 'number' AND v_range IS NOT NULL THEN
                    v_num := (v_el #>> '{}')::numeric;
                    IF v_num < (v_range ->> 0)::numeric OR v_num > (v_range ->> 1)::numeric
                       OR ((v_range ->> 2)::boolean AND v_num <> trunc(v_num)) THEN
                        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
                    END IF;
                END IF;
            ELSIF v_key = 'sugar_type' THEN
                IF jsonb_typeof(v_el) NOT IN ('string', 'null')
                   OR (jsonb_typeof(v_el) = 'string' AND (v_el #>> '{}') NOT IN ('random', 'fasting', 'pp')) THEN
                    RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
                END IF;
            ELSIF v_key IN ('recorded_at', 'recorded_by') THEN
                IF jsonb_typeof(v_el) NOT IN ('string', 'null') OR char_length(v_el #>> '{}') > 64 THEN
                    RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
                END IF;
            ELSE
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
        END LOOP;
        IF jsonb_typeof(p_patch -> 'vitals' -> 'systolic') = 'number' AND jsonb_typeof(p_patch -> 'vitals' -> 'diastolic') = 'number'
           AND (p_patch -> 'vitals' ->> 'systolic')::numeric <= (p_patch -> 'vitals' ->> 'diastolic')::numeric THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
    END IF;
    -- Provenance: exactly the two AI keys the draft may carry (08-06a S-3).
    IF p_patch ? 'provenance' AND jsonb_typeof(p_patch -> 'provenance') = 'object' THEN
        v_prov := p_patch -> 'provenance';
        FOR v_key, v_el IN SELECT e.key, e.value FROM jsonb_each(v_prov) e LOOP
            IF v_key = 'ai_assisted' THEN
                IF jsonb_typeof(v_el) <> 'boolean' THEN
                    RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
                END IF;
            ELSIF v_key = 'ai_sections_used' THEN
                IF jsonb_typeof(v_el) <> 'array' OR jsonb_array_length(v_el) > 20
                   OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_el) a(x)
                               WHERE jsonb_typeof(a.x) <> 'string' OR char_length(a.x #>> '{}') > 40) THEN
                    RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
                END IF;
            ELSE
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
        END LOOP;
    END IF;
    -- Follow-up: a calendar date, a note of at most 500 characters, the UI's interval word is accepted and not stored.
    IF p_patch ? 'follow_up' AND jsonb_typeof(p_patch -> 'follow_up') = 'object' THEN
        v_fu := p_patch -> 'follow_up';
        FOR v_key IN SELECT jsonb_object_keys(v_fu) LOOP
            IF v_key NOT IN ('follow_up_date', 'notes', 'interval') THEN
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
        END LOOP;
        IF jsonb_typeof(v_fu -> 'follow_up_date') IS DISTINCT FROM 'string'
           OR (v_fu ->> 'follow_up_date') !~ '^\d{4}-\d{2}-\d{2}$'
           OR (v_fu ? 'notes' AND (jsonb_typeof(v_fu -> 'notes') NOT IN ('string', 'null') OR char_length(v_fu ->> 'notes') > 500))
           OR (v_fu ? 'interval' AND jsonb_typeof(v_fu -> 'interval') NOT IN ('string', 'null')) THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        BEGIN
            v_fu_date := (v_fu ->> 'follow_up_date')::date;
        EXCEPTION WHEN data_exception THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END;
        IF to_char(v_fu_date, 'YYYY-MM-DD') <> (v_fu ->> 'follow_up_date') THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        -- 000116 (S-4): a follow-up falls from the clinic's today to 366 days on, in the clinic's zone. The date the visit's follow-up already holds is
        -- accepted unchanged (an amendment of an older visit may edit the note of a follow-up whose date has passed).
        v_today := public.tenant_local_date(p_tenant_id, now());
        IF (v_fu_date < v_today OR v_fu_date > v_today + 366)
           AND NOT EXISTS (SELECT 1 FROM public.follow_ups f
                            WHERE f.tenant_id = p_tenant_id AND f.visit_id = p_visit_id AND f.follow_up_date = v_fu_date) THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 3. Claim; a replay returns the first result and writes nothing.
    v_replay := private.command_claim(p_tenant_id, p_client_request_id, 'public.save_consultation_draft',
                                      private.command_request_hash(jsonb_build_object(
                                          'visit', p_visit_id, 'expected_version', p_expected_version, 'patch', p_patch)));
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock the visit, then its notes row (a sign-off, an amendment and another draft save on this visit run one after the other).
    SELECT v.status, v.signed_at, v.patient_id, v.specialty, v.metadata INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    SELECT n.draft_version, n.vitals INTO v_notes
      FROM public.clinical_notes n
     WHERE n.tenant_id = p_tenant_id AND n.visit_id = p_visit_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    -- A sealed visit (signed and not reopened) or an unsigned completed or cancelled one takes no draft (recordState, V2-09a R-2, R-11).
    IF v_visit.status IN ('completed', 'cancelled') OR (v_visit.signed_at IS NOT NULL AND v_visit.status <> 'in_consultation') THEN
        RAISE EXCEPTION 'DRAFT_LOCKED' USING ERRCODE = 'P0001';
    END IF;
    -- Optimistic concurrency: the draft was read at expected_version; anything else is another writer's change.
    IF v_notes.draft_version <> p_expected_version THEN
        RAISE EXCEPTION 'DRAFT_CONFLICT' USING ERRCODE = 'P0001';
    END IF;

    -- 5. Writes: only the keys present.
    v_overwrite := coalesce((p_patch ->> 'conflict_overwrite')::boolean, false);
    FOREACH v_key IN ARRAY ARRAY['vitals', 'chief_complaints', 'clinical_notes', 'specialty_data', 'investigations_advised', 'advice',
                                 'specialty', 'provenance', 'follow_up'] LOOP
        IF p_patch ? v_key THEN
            v_fields := v_fields || v_key;
        END IF;
    END LOOP;
    IF cardinality(v_fields) = 0 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- Vitals: the recorder is never caller-chosen (V2-01 F6, SEC-02). The same measurements as stored keep the stored recorder (a doctor
    -- saving a draft does not re-attribute a nurse's reading); changed measurements record the actor.
    v_vitals := v_notes.vitals;
    IF p_patch ? 'vitals' THEN
        v_in := CASE WHEN jsonb_typeof(p_patch -> 'vitals') = 'object' THEN (p_patch -> 'vitals') - 'recorded_by' ELSE '{}'::jsonb END;
        v_has_measure := EXISTS (SELECT 1 FROM unnest(v_mkeys) k WHERE jsonb_typeof(v_in -> k) = 'number');
        IF v_has_measure THEN
            v_same := NOT EXISTS (SELECT 1 FROM unnest(v_mkeys) k
                                   WHERE coalesce(v_in -> k, 'null'::jsonb) IS DISTINCT FROM coalesce(v_notes.vitals -> k, 'null'::jsonb));
            IF v_same AND jsonb_typeof(v_notes.vitals -> 'recorded_by') = 'string' THEN
                v_in := v_in || jsonb_build_object('recorded_by', v_notes.vitals -> 'recorded_by');
            ELSE
                v_in := v_in || jsonb_build_object('recorded_by', v_uid::text);
            END IF;
        END IF;
        v_vitals := v_in;
    END IF;

    UPDATE public.clinical_notes n
       SET vitals = v_vitals,
           chief_complaints = CASE WHEN p_patch ? 'chief_complaints' THEN p_patch -> 'chief_complaints' ELSE n.chief_complaints END,
           clinical_notes = CASE WHEN p_patch ? 'clinical_notes' THEN p_patch ->> 'clinical_notes' ELSE n.clinical_notes END,
           specialty_data = CASE WHEN p_patch ? 'specialty_data'
                                 THEN CASE WHEN jsonb_typeof(p_patch -> 'specialty_data') = 'object' THEN p_patch -> 'specialty_data' ELSE '{}'::jsonb END
                                 ELSE n.specialty_data END,
           investigations_advised = CASE WHEN p_patch ? 'investigations_advised'
                                         THEN ARRAY(SELECT jsonb_array_elements_text(p_patch -> 'investigations_advised'))
                                         ELSE n.investigations_advised END,
           advice = CASE WHEN p_patch ? 'advice' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch -> 'advice')) ELSE n.advice END
     WHERE n.tenant_id = p_tenant_id AND n.visit_id = p_visit_id
    RETURNING n.draft_version INTO v_new_version;

    v_specialty := CASE WHEN p_patch ? 'specialty' THEN p_patch ->> 'specialty' ELSE v_visit.specialty END;
    v_metadata := coalesce(v_visit.metadata, '{}'::jsonb);
    IF p_patch ? 'provenance' AND jsonb_typeof(p_patch -> 'provenance') = 'object' THEN
        v_metadata := v_metadata || (p_patch -> 'provenance');
    END IF;
    IF v_specialty IS DISTINCT FROM v_visit.specialty OR v_metadata IS DISTINCT FROM coalesce(v_visit.metadata, '{}'::jsonb) THEN
        UPDATE public.visits v
           SET specialty = v_specialty, metadata = v_metadata, updated_at = now()
         WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id;
    END IF;

    IF p_patch ? 'follow_up' THEN
        IF jsonb_typeof(p_patch -> 'follow_up') = 'null' THEN
            DELETE FROM public.follow_ups f WHERE f.tenant_id = p_tenant_id AND f.visit_id = p_visit_id;
        ELSE
            INSERT INTO public.follow_ups (tenant_id, patient_id, visit_id, doctor_id, follow_up_date, notes, status)
            VALUES (p_tenant_id, v_visit.patient_id, p_visit_id, v_uid, v_fu_date, p_patch -> 'follow_up' ->> 'notes', 'scheduled')
            ON CONFLICT (tenant_id, visit_id) WHERE visit_id IS NOT NULL
            DO UPDATE SET follow_up_date = EXCLUDED.follow_up_date, notes = EXCLUDED.notes;
        END IF;
    END IF;

    -- A waiting visit moves to in_consultation as start_consultation does, when the caller may also move visits. A business refusal of
    -- the step (another day, not checkable: P0001) leaves the status as it was and never fails the save; its writes roll back with it.
    IF v_visit.status = 'waiting' AND public.has_permission(p_tenant_id, 'appointments:edit') THEN
        BEGIN
            PERFORM private.step_start_consultation(p_tenant_id, p_visit_id);
            v_started := true;
        EXCEPTION WHEN SQLSTATE 'P0001' THEN
            v_started := false;
        END;
    END IF;

    PERFORM private.log_command_audit(p_tenant_id, 'consultation.draft_save', 'visit', p_visit_id,
                             jsonb_build_object('fields_changed', to_jsonb(v_fields), 'draft_version', v_new_version,
                                                'conflict_overwrite', v_overwrite));

    v_result := jsonb_build_object('visit_id', p_visit_id, 'draft_version', v_new_version, 'started', v_started, 'replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.save_consultation_draft(uuid, uuid, integer, jsonb, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_consultation_draft(uuid, uuid, integer, jsonb, uuid) TO authenticated;
COMMENT ON FUNCTION public.save_consultation_draft(uuid, uuid, integer, jsonb, uuid) IS
    'V2-09b 09B-01 (R-3), 09B-06a (S-4): saves the consult draft in one transaction: the keys present in p_patch (vitals, chief_complaints, clinical_notes, specialty_data, investigations_advised, advice, specialty, provenance, follow_up) are written to clinical_notes, visits and follow_ups, a waiting visit is started (when the caller holds appointments:edit), and the consultation.draft_save audit row is written (fields_changed, draft_version, conflict_overwrite). consultations:edit. p_expected_version must equal clinical_notes.draft_version (DRAFT_CONFLICT, P0001); a sealed, completed or cancelled visit is DRAFT_LOCKED (P0001). Input checks (INPUT_INVALID): keys and types, 256 kB, vitals ranges of vitalsSchema, complaint keys and types, a follow-up date from the clinic''s today to +366 days. The optional patch key conflict_overwrite (boolean) is audited, not stored. Idempotent by p_client_request_id. Result: visit_id, draft_version, started, replayed.';
