-- Migration: 000120_rx_review_fixes.sql
-- V2-09c 09C-06a: the review fixes of 09C-REVIEW-SEC (S-1, S-2, S-5, S-6, S-7, S-8) and 09C-REVIEW-A (A-7, A-8), per 09C-REVIEW-TRIAGE (rulings R-AL).
-- Replaced bodies, one replaced command signature, one trigger, one column default and one policy. No data change.
--
-- 1. private.rx_allergy_matches (S-1): a line matches an allergy by substance overlap OR by name. The printed name is always checked, so a line whose
--    catalogue id points at another medicine can no longer pass a coded allergy by its substances alone.
-- 2. public.change_prescription (S-1, S-8): a line with cdci_brand_id must carry that brand's catalogue name (case and spacing aside), else INPUT_INVALID;
--    its name, generic and form are the catalogue's (the line's own generic and form only where the catalogue has none). Allergies are read FOR SHARE.
-- 3. public.repeat_visit_plan (S-1, S-8): a source line keeps its catalogue id only when the brand exists under the line's own name, else it is copied as a
--    medicine outside the catalogue (checked by name); the allergies are read FOR SHARE.
-- 4. public.record_patient_allergies (A-8, S-6): takes p_expected, the list the editor started from (JSON null = not recorded); a stored list that differs is
--    ALLERGIES_CHANGED (P0001, CONFLICT: nothing written, the editor reloads). An erased or deleted patient is PATIENT_NOT_FOUND. The 4-argument function is
--    dropped, so no variant without the check stays executable.
-- 5. patients_allergies_audit (S-2, ruling R-AL): AFTER UPDATE OF allergies, every writer (the command, the patient edit, a direct UPDATE under RLS, the
--    service role) leaves a counts-only patient.allergies_change row: allergies_count (null = not recorded), added, removed. Never the strings.
-- 6. patients.allergies has no default (S-5, A-7): an insert that names no allergies stores NULL ("not recorded"), never {} ("No known allergies").
-- 7. doctor_custom_medicines_select (S-7): a member reads only their own custom medicines (search_medicines, the one reader, already asks for the caller's).
-- Per-migration checklist: two DEFINER commands replaced and one replaced by a new signature (search_path '', lock_timeout 2s, EXECUTE for authenticated
-- only), one DEFINER trigger function (no EXECUTE grant), one pure helper replaced (grants unchanged), one policy, one default. No grant widening.

-- 1. The rule (S-1) ------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.rx_allergy_matches(p_allergies text[], p_substance_ids text[], p_names text[])
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    -- One row per allergy string: coded -> its ids; words -> the allergy's alphanumeric words joined by single spaces.
    SELECT coalesce(array_agg(x.allergy ORDER BY x.ord), ARRAY[]::text[])
      FROM (
        SELECT a.allergy, a.ord,
               private.allergy_substance_ids(ARRAY[a.allergy]) AS ids,
               btrim(regexp_replace(lower(a.allergy), '[^[:alnum:]]+', ' ', 'g')) AS words
          FROM unnest(coalesce(p_allergies, ARRAY[]::text[])) WITH ORDINALITY AS a(allergy, ord)
         WHERE btrim(a.allergy) <> ''
      ) x
     WHERE -- a coded allergy and a line with substances: by substance
           (cardinality(x.ids) > 0 AND cardinality(coalesce(p_substance_ids, ARRAY[]::text[])) > 0 AND x.ids && p_substance_ids)
           -- and always by name (000120, S-1): the allergy's words appear, in order, as whole words of the medicine or the generic name
        OR (x.words <> '' AND EXISTS (
                SELECT 1 FROM unnest(coalesce(p_names, ARRAY[]::text[])) n
                 WHERE position(' ' || x.words || ' ' IN ' ' || btrim(regexp_replace(lower(n), '[^[:alnum:]]+', ' ', 'g')) || ' ') > 0))
$$;
COMMENT ON FUNCTION private.rx_allergy_matches(text[], text[], text[]) IS
    'V2-09c 000118 (R-7, AI-11, SA-07 at substance level), 000120 (S-1): the allergy strings a prescription line matches. A coded allergy (its string is a CDCI substance name) matches a line that has substance ids by substance; EVERY allergy also matches by name: its words appear in order as whole words of the medicine or generic name (case-insensitive), so the printed name is always checked. No class or salt relations (D-9). Pure; the order of the allergies is kept.';

-- 2. change_prescription (S-1, S-8), from the 000118 body ----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_prescription(
    p_tenant_id uuid,
    p_visit_id uuid,
    p_changes jsonb,
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
    v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
    v_replay jsonb;
    v_key text;
    v_el jsonb;
    v_add jsonb;
    v_upd jsonb;
    v_rem jsonb;
    v_n_add integer;
    v_n_upd integer;
    v_n_rem integer;
    v_all uuid[] := ARRAY[]::uuid[];
    v_rem_ids uuid[] := ARRAY[]::uuid[];
    v_visit record;
    v_tenant record;
    v_rx uuid;
    v_next integer;
    v_item uuid;
    v_added uuid[] := ARRAY[]::uuid[];
    v_generic_id text;
    v_deleted integer;
    v_result jsonb;
    v_reason text;
    v_entitled boolean;
    v_allergies text[];
    v_matched text[];
    v_override jsonb;
    v_overrides integer := 0;
    v_upd_item record;
    v_cat record;
    v_line jsonb;
    v_adds jsonb := '[]'::jsonb;
BEGIN
    -- 1. Actor: a session; this command has no system path.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. The tenant is the session's ACTIVE clinic (another clinic reads as not found), then prescriptions:edit there.
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'prescriptions:edit') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    -- Input: a visit and a change set of known keys, types and sizes (at most 64 kB, 30 operations of each kind, at least one).
    IF p_visit_id IS NULL OR p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR octet_length(p_changes::text) > 65536 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(p_changes) LOOP
        IF v_key = 'allergy_override_reason' THEN
            -- 000118 (R-7): the doctor's reason to prescribe a medicine that matches a recorded allergy, 5 to 300 characters.
            IF jsonb_typeof(p_changes -> v_key) <> 'string' OR char_length(btrim(p_changes ->> v_key)) NOT BETWEEN 5 AND 300 THEN
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
        ELSIF v_key NOT IN ('add', 'update', 'remove') OR jsonb_typeof(p_changes -> v_key) <> 'array' OR jsonb_array_length(p_changes -> v_key) > 30 THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
    END LOOP;
    v_reason := nullif(btrim(coalesce(p_changes ->> 'allergy_override_reason', '')), '');
    v_add := coalesce(p_changes -> 'add', '[]'::jsonb);
    v_upd := coalesce(p_changes -> 'update', '[]'::jsonb);
    v_rem := coalesce(p_changes -> 'remove', '[]'::jsonb);
    v_n_add := jsonb_array_length(v_add);
    v_n_upd := jsonb_array_length(v_upd);
    v_n_rem := jsonb_array_length(v_rem);
    IF v_n_add + v_n_upd + v_n_rem = 0 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    FOR v_el IN SELECT a.el FROM jsonb_array_elements(v_add) a(el) LOOP
        IF jsonb_typeof(v_el) <> 'object' THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        FOR v_key IN SELECT jsonb_object_keys(v_el) LOOP
            IF v_key NOT IN ('medicine_name', 'generic_name', 'dose_form', 'dosage', 'timing', 'duration', 'special_instructions', 'cdci_brand_id') THEN
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
        END LOOP;
        IF jsonb_typeof(v_el -> 'medicine_name') IS DISTINCT FROM 'string' OR btrim(v_el ->> 'medicine_name') = '' OR char_length(v_el ->> 'medicine_name') > 250
           OR jsonb_typeof(v_el -> 'dosage') IS DISTINCT FROM 'string' OR btrim(v_el ->> 'dosage') = '' OR char_length(v_el ->> 'dosage') > 50
           OR jsonb_typeof(v_el -> 'duration') IS DISTINCT FROM 'string' OR btrim(v_el ->> 'duration') = '' OR char_length(v_el ->> 'duration') > 50 THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        IF (v_el ? 'generic_name' AND (jsonb_typeof(v_el -> 'generic_name') NOT IN ('string', 'null') OR char_length(v_el ->> 'generic_name') > 250))
           OR (v_el ? 'dose_form' AND (jsonb_typeof(v_el -> 'dose_form') NOT IN ('string', 'null') OR char_length(v_el ->> 'dose_form') > 50))
           OR (v_el ? 'timing' AND (jsonb_typeof(v_el -> 'timing') NOT IN ('string', 'null') OR char_length(v_el ->> 'timing') > 100))
           OR (v_el ? 'special_instructions' AND (jsonb_typeof(v_el -> 'special_instructions') NOT IN ('string', 'null') OR char_length(v_el ->> 'special_instructions') > 500))
           OR (v_el ? 'cdci_brand_id' AND (jsonb_typeof(v_el -> 'cdci_brand_id') NOT IN ('string', 'null') OR char_length(v_el ->> 'cdci_brand_id') > 100)) THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        -- 000120 (S-1): a catalogue line is the catalogue's medicine. The brand id must exist and its name must be the line's name (case and spacing
        -- aside), else INPUT_INVALID; the name, the generic and the form stored are the catalogue's (the line's own generic and form only where the
        -- catalogue has none). A forged id can no longer lend another medicine's substances to the allergy check, and the printed name is the one checked.
        v_line := v_el;
        IF nullif(btrim(coalesce(v_el ->> 'cdci_brand_id', '')), '') IS NOT NULL THEN
            SELECT c.brand_name, c.generic_name, c.dose_form INTO v_cat
              FROM public.cdci_medicines_search c WHERE c.id = btrim(v_el ->> 'cdci_brand_id');
            IF NOT FOUND
               OR lower(regexp_replace(btrim(v_cat.brand_name), '\s+', ' ', 'g')) IS DISTINCT FROM lower(regexp_replace(btrim(v_el ->> 'medicine_name'), '\s+', ' ', 'g')) THEN
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
            v_line := v_line || jsonb_build_object(
                'medicine_name', btrim(v_cat.brand_name),
                'generic_name', coalesce(nullif(btrim(coalesce(v_cat.generic_name, '')), ''), nullif(btrim(coalesce(v_el ->> 'generic_name', '')), '')),
                'dose_form', coalesce(nullif(btrim(coalesce(v_cat.dose_form, '')), ''), nullif(btrim(coalesce(v_el ->> 'dose_form', '')), '')));
        END IF;
        v_adds := v_adds || jsonb_build_array(v_line);
    END LOOP;
    -- From here on the adds are the effective lines (the catalogue's generic and form on a catalogue line).
    v_add := v_adds;

    FOR v_el IN SELECT a.el FROM jsonb_array_elements(v_upd) a(el) LOOP
        IF jsonb_typeof(v_el) <> 'object' THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        FOR v_key IN SELECT jsonb_object_keys(v_el) LOOP
            IF v_key NOT IN ('id', 'dosage', 'timing', 'duration', 'special_instructions') THEN
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
        END LOOP;
        IF jsonb_typeof(v_el -> 'id') IS DISTINCT FROM 'string' OR (v_el ->> 'id') !~ v_uuid_re
           OR (SELECT count(*) FROM jsonb_object_keys(v_el)) < 2
           OR (v_el ? 'dosage' AND (jsonb_typeof(v_el -> 'dosage') <> 'string' OR btrim(v_el ->> 'dosage') = '' OR char_length(v_el ->> 'dosage') > 50))
           OR (v_el ? 'duration' AND (jsonb_typeof(v_el -> 'duration') <> 'string' OR btrim(v_el ->> 'duration') = '' OR char_length(v_el ->> 'duration') > 50))
           OR (v_el ? 'timing' AND (jsonb_typeof(v_el -> 'timing') NOT IN ('string', 'null') OR char_length(v_el ->> 'timing') > 100))
           OR (v_el ? 'special_instructions' AND (jsonb_typeof(v_el -> 'special_instructions') NOT IN ('string', 'null') OR char_length(v_el ->> 'special_instructions') > 500)) THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        v_all := v_all || (v_el ->> 'id')::uuid;
    END LOOP;

    FOR v_el IN SELECT a.el FROM jsonb_array_elements(v_rem) a(el) LOOP
        IF jsonb_typeof(v_el) <> 'string' OR (v_el #>> '{}') !~ v_uuid_re THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        v_rem_ids := v_rem_ids || (v_el #>> '{}')::uuid;
        v_all := v_all || (v_el #>> '{}')::uuid;
    END LOOP;
    -- An item is named once: not twice, and not both updated and removed.
    IF cardinality(v_all) <> (SELECT count(DISTINCT x) FROM unnest(v_all) x) THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Claim; a replay returns the first result and writes nothing.
    v_replay := private.command_claim(p_tenant_id, p_client_request_id, 'public.change_prescription',
                                      private.command_request_hash(jsonb_build_object('visit', p_visit_id, 'changes', p_changes)));
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock the visit (a sign-off, an amendment and another Rx change on this visit run one after the other).
    SELECT v.status, v.signed_at, v.patient_id INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    -- A sealed visit (signed and not reopened) or an unsigned completed or cancelled one takes no Rx change (recordState, V2-09a R-2, R-11).
    IF v_visit.status IN ('completed', 'cancelled') OR (v_visit.signed_at IS NOT NULL AND v_visit.status <> 'in_consultation') THEN
        RAISE EXCEPTION 'DRAFT_LOCKED' USING ERRCODE = 'P0001';
    END IF;

    -- The visit's latest header, created with the clinic's print settings when there is none.
    SELECT p.id INTO v_rx
      FROM public.prescriptions p
     WHERE p.tenant_id = p_tenant_id AND p.visit_id = p_visit_id
     ORDER BY p.version DESC
     LIMIT 1
       FOR UPDATE;
    IF cardinality(v_all) > 0 THEN
        IF v_rx IS NULL
           OR (SELECT count(*) FROM public.prescription_items i WHERE i.tenant_id = p_tenant_id AND i.prescription_id = v_rx AND i.id = ANY (v_all)) <> cardinality(v_all) THEN
            RAISE EXCEPTION 'ITEM_NOT_FOUND' USING ERRCODE = 'P0002';
        END IF;
    END IF;
    IF v_rx IS NULL THEN
        SELECT t.rx_letterhead_mode, t.rx_paper_size INTO v_tenant FROM public.tenants t WHERE t.id = p_tenant_id;
        INSERT INTO public.prescriptions (tenant_id, visit_id, patient_id, doctor_id, version, status, letterhead_mode, paper_size)
        VALUES (p_tenant_id, p_visit_id, v_visit.patient_id, v_uid, 1, 'active', v_tenant.rx_letterhead_mode, v_tenant.rx_paper_size)
        RETURNING id INTO v_rx;
    END IF;

    -- The allergy check (000118, R-7, AI-11): when the clinic is entitled to assist.allergy_check and the patient has recorded allergies, a line that is
    -- added and matches one is refused with ALLERGY_MATCH (nothing written, no audit row) unless the change carries allergy_override_reason; the reason,
    -- the matched allergies, the actor and the time are stored on the line. An update with a reason confirms an existing line that matches an allergy
    -- recorded after it was added. The clinic's kill switch is a platform override of the entitlement; it never depends on the AI kill switch.
    v_entitled := coalesce(billing_internal.has_entitlement(p_tenant_id, 'assist.allergy_check', now()), false);
    IF v_entitled THEN
        -- 000120 (S-8): FOR SHARE, so an allergy record running at the same moment either commits first (and is read) or waits for this command.
        SELECT p.allergies INTO v_allergies FROM public.patients p WHERE p.id = v_visit.patient_id AND p.tenant_id = p_tenant_id FOR SHARE;
    END IF;
    IF v_allergies IS NOT NULL AND cardinality(v_allergies) > 0 AND v_reason IS NULL THEN
        FOR v_el IN SELECT a.el FROM jsonb_array_elements(v_add) a(el) LOOP
            v_matched := private.rx_allergy_matches(
                v_allergies,
                private.rx_line_substance_ids(nullif(btrim(coalesce(v_el ->> 'cdci_brand_id', '')), ''), nullif(btrim(coalesce(v_el ->> 'generic_name', '')), '')),
                ARRAY[btrim(v_el ->> 'medicine_name'), coalesce(v_el ->> 'generic_name', '')]);
            IF cardinality(v_matched) > 0 THEN
                RAISE EXCEPTION 'ALLERGY_MATCH' USING ERRCODE = 'P0001';
            END IF;
        END LOOP;
    END IF;

    -- 5. Writes: removes, then updates (dose fields only), then adds in array order.
    IF v_n_rem > 0 THEN
        DELETE FROM public.prescription_items i
         WHERE i.tenant_id = p_tenant_id AND i.prescription_id = v_rx AND i.id = ANY (v_rem_ids);
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
        IF v_deleted <> v_n_rem THEN
            RAISE EXCEPTION 'ITEM_NOT_FOUND' USING ERRCODE = 'P0002';
        END IF;
    END IF;

    FOR v_el IN SELECT a.el FROM jsonb_array_elements(v_upd) a(el) LOOP
        UPDATE public.prescription_items i
           SET dosage = CASE WHEN v_el ? 'dosage' THEN btrim(v_el ->> 'dosage') ELSE i.dosage END,
               timing = CASE WHEN v_el ? 'timing' THEN nullif(btrim(coalesce(v_el ->> 'timing', '')), '') ELSE i.timing END,
               duration = CASE WHEN v_el ? 'duration' THEN btrim(v_el ->> 'duration') ELSE i.duration END,
               special_instructions = CASE WHEN v_el ? 'special_instructions' THEN nullif(btrim(coalesce(v_el ->> 'special_instructions', '')), '') ELSE i.special_instructions END
         WHERE i.id = (v_el ->> 'id')::uuid AND i.tenant_id = p_tenant_id AND i.prescription_id = v_rx;
        IF v_reason IS NOT NULL AND v_allergies IS NOT NULL AND cardinality(v_allergies) > 0 THEN
            SELECT i.medicine_name, i.generic_name, i.cdci_brand_id INTO v_upd_item
              FROM public.prescription_items i WHERE i.id = (v_el ->> 'id')::uuid AND i.tenant_id = p_tenant_id;
            v_matched := private.rx_allergy_matches(v_allergies, private.rx_line_substance_ids(v_upd_item.cdci_brand_id, v_upd_item.generic_name),
                                                    ARRAY[v_upd_item.medicine_name, coalesce(v_upd_item.generic_name, '')]);
            IF cardinality(v_matched) > 0 THEN
                UPDATE public.prescription_items i
                   SET allergy_override = jsonb_build_object('reason', v_reason, 'allergens', to_jsonb(v_matched), 'by', v_uid,
                                                             'at', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
                 WHERE i.id = (v_el ->> 'id')::uuid AND i.tenant_id = p_tenant_id;
                v_overrides := v_overrides + 1;
            END IF;
        END IF;
    END LOOP;

    IF v_n_add > 0 THEN
        SELECT coalesce(max(i.sort_order), -1) + 1 INTO v_next
          FROM public.prescription_items i
         WHERE i.tenant_id = p_tenant_id AND i.prescription_id = v_rx;
        FOR v_el IN SELECT a.el FROM jsonb_array_elements(v_add) a(el) LOOP
            v_generic_id := NULL;
            IF nullif(btrim(coalesce(v_el ->> 'cdci_brand_id', '')), '') IS NOT NULL THEN
                SELECT b.generic_id INTO v_generic_id FROM public.cdci_brands b WHERE b.id = btrim(v_el ->> 'cdci_brand_id');
            END IF;
            v_override := NULL;
            IF v_reason IS NOT NULL AND v_allergies IS NOT NULL AND cardinality(v_allergies) > 0 THEN
                v_matched := private.rx_allergy_matches(
                    v_allergies,
                    private.rx_line_substance_ids(nullif(btrim(coalesce(v_el ->> 'cdci_brand_id', '')), ''), nullif(btrim(coalesce(v_el ->> 'generic_name', '')), '')),
                    ARRAY[btrim(v_el ->> 'medicine_name'), coalesce(v_el ->> 'generic_name', '')]);
                IF cardinality(v_matched) > 0 THEN
                    v_override := jsonb_build_object('reason', v_reason, 'allergens', to_jsonb(v_matched), 'by', v_uid,
                                                     'at', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
                    v_overrides := v_overrides + 1;
                END IF;
            END IF;
            INSERT INTO public.prescription_items (tenant_id, prescription_id, medicine_name, generic_name, dose_form, dosage, timing, duration,
                                                   special_instructions, cdci_brand_id, cdci_generic_id, sort_order, allergy_override)
            VALUES (p_tenant_id, v_rx, btrim(v_el ->> 'medicine_name'),
                    nullif(btrim(coalesce(v_el ->> 'generic_name', '')), ''),
                    nullif(btrim(coalesce(v_el ->> 'dose_form', '')), ''),
                    btrim(v_el ->> 'dosage'),
                    nullif(btrim(coalesce(v_el ->> 'timing', '')), ''),
                    btrim(v_el ->> 'duration'),
                    nullif(btrim(coalesce(v_el ->> 'special_instructions', '')), ''),
                    nullif(btrim(coalesce(v_el ->> 'cdci_brand_id', '')), ''),
                    v_generic_id,
                    v_next, v_override)
            RETURNING id INTO v_item;
            v_added := v_added || v_item;
            v_next := v_next + 1;
            -- A medicine outside the catalogue joins the doctor's own list with this line's dose as their stored values.
            IF nullif(btrim(coalesce(v_el ->> 'cdci_brand_id', '')), '') IS NULL THEN
                INSERT INTO public.doctor_custom_medicines (tenant_id, doctor_id, medicine_name, generic_name, dose_form,
                                                            default_dosage, default_timing, default_duration, use_count)
                VALUES (p_tenant_id, v_uid, btrim(v_el ->> 'medicine_name'),
                        nullif(btrim(coalesce(v_el ->> 'generic_name', '')), ''),
                        nullif(btrim(coalesce(v_el ->> 'dose_form', '')), ''),
                        btrim(v_el ->> 'dosage'),
                        nullif(btrim(coalesce(v_el ->> 'timing', '')), ''),
                        btrim(v_el ->> 'duration'), 1)
                ON CONFLICT (tenant_id, doctor_id, medicine_name) DO UPDATE
                   SET generic_name = EXCLUDED.generic_name, dose_form = EXCLUDED.dose_form,
                       default_dosage = EXCLUDED.default_dosage, default_timing = EXCLUDED.default_timing,
                       default_duration = EXCLUDED.default_duration,
                       use_count = public.doctor_custom_medicines.use_count + 1, updated_at = now();
            END IF;
        END LOOP;
    END IF;

    PERFORM private.log_command_audit(p_tenant_id, 'prescription.lines_change', 'prescription', v_rx,
                             jsonb_build_object('added', v_n_add, 'updated', v_n_upd, 'removed', v_n_rem)
                             || CASE WHEN v_overrides > 0 THEN jsonb_build_object('allergy_overrides', v_overrides) ELSE '{}'::jsonb END);

    v_result := jsonb_build_object('prescription_id', v_rx, 'added_item_ids', to_jsonb(v_added), 'replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.change_prescription(uuid, uuid, jsonb, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.change_prescription(uuid, uuid, jsonb, uuid) TO authenticated;
COMMENT ON FUNCTION public.change_prescription(uuid, uuid, jsonb, uuid) IS
    'V2-09c 09C-01 (R-2), 09C-02 (R-7), 000120 (S-1, S-8): every prescription change in one transaction: add (0-30 lines), update (dose fields of 0-30 items), remove (0-30 items), and the optional allergy_override_reason (5-300 characters). A line with cdci_brand_id must carry that brand''s catalogue name (case and spacing aside; INPUT_INVALID otherwise) and stores the catalogue''s name, generic and form. The visit''s latest header is created with the clinic''s print settings when there is none; an update or remove id must be an item of that header (ITEM_NOT_FOUND, P0002, nothing written); adds take the next sort_order in array order; a line without cdci_brand_id upserts the doctor''s custom medicine (use_count + 1, the line''s dose as stored values); the prescription.lines_change audit row (added, updated, removed counts and allergy_overrides when a line matching a recorded allergy was prescribed anyway). With assist.allergy_check entitled and allergies recorded (read FOR SHARE), a matching add without a reason is ALLERGY_MATCH (P0001, nothing written); with a reason the line stores allergy_override {reason, allergens, by, at}; an update with a reason confirms a matching line. prescriptions:edit. A sealed, an unsigned completed or a cancelled visit is DRAFT_LOCKED (P0001); the 09A seal guards still fire. Idempotent by p_client_request_id. Result: prescription_id, added_item_ids, replayed.';

-- 3. repeat_visit_plan (S-1, S-8), from the 000119 body ------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.repeat_visit_plan(
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
    v_brand text;
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
                -- 000120 (S-8): FOR SHARE, as change_prescription reads them.
                SELECT p.allergies INTO v_allergies FROM public.patients p WHERE p.id = v_target.patient_id AND p.tenant_id = p_tenant_id FOR SHARE;
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
                -- 000120 (S-1): the source line keeps its catalogue id only when that brand still exists under the line's own name; otherwise it is copied
                -- as a medicine outside the catalogue (checked by name), so a stored id can never lend another medicine's substances to the check.
                v_brand := nullif(btrim(coalesce(v_item.cdci_brand_id, '')), '');
                IF v_brand IS NOT NULL AND NOT EXISTS (
                       SELECT 1 FROM public.cdci_medicines_search c
                        WHERE c.id = v_brand
                          AND lower(regexp_replace(btrim(c.brand_name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(v_item.medicine_name), '\s+', ' ', 'g'))) THEN
                    v_brand := NULL;
                END IF;
                -- A line that matches a recorded allergy is never copied silently: it is reported by its source item id and the doctor decides.
                IF v_allergies IS NOT NULL AND cardinality(v_allergies) > 0
                   AND cardinality(private.rx_allergy_matches(
                           v_allergies,
                           private.rx_line_substance_ids(v_brand, nullif(btrim(coalesce(v_item.generic_name, '')), '')),
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
                IF v_brand IS NOT NULL THEN
                    SELECT b.generic_id INTO v_generic_id FROM public.cdci_brands b WHERE b.id = v_brand;
                END IF;
                -- The stored values exactly: a null timing stays null, nothing is added.
                INSERT INTO public.prescription_items (tenant_id, prescription_id, medicine_name, generic_name, dose_form, dosage, timing, duration,
                                                       special_instructions, cdci_brand_id, cdci_generic_id, sort_order)
                VALUES (p_tenant_id, v_rx, btrim(v_item.medicine_name), nullif(btrim(coalesce(v_item.generic_name, '')), ''),
                        nullif(btrim(coalesce(v_item.dose_form, '')), ''), btrim(v_item.dosage),
                        nullif(btrim(coalesce(v_item.timing, '')), ''), btrim(v_item.duration),
                        nullif(btrim(coalesce(v_item.special_instructions, '')), ''),
                        v_brand, v_generic_id, v_next)
                RETURNING id INTO v_item_id;
                v_added := v_added || v_item_id;
                -- A medicine outside the catalogue joins the doctor's own list with this line's dose, as a line the doctor adds does.
                IF v_brand IS NULL THEN
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
    'V2-09c 09C-03 (R-10), 000120 (S-1, S-8): "Same as last visit" in one transaction: copies, from the database, the signed source visit''s diagnoses and/or its signed-version prescription lines onto this visit (p_parts a subset of diagnoses, prescription). The source must be a completed, signed visit of the same patient in this clinic (VISIT_NOT_FOUND, P0002, otherwise: another clinic''s or patient''s visit reads as not found). A diagnosis name or medicine already on this visit is skipped; the stored values are copied exactly (a null timing stays null); a source line keeps its cdci_brand_id only when the catalogue brand has the line''s own name, else it is copied as a medicine outside the catalogue. With assist.allergy_check entitled and allergies recorded (read FOR SHARE), a line that matches an allergy (private.rx_allergy_matches) is not copied and its source item id is returned in skipped_item_ids. prescriptions:edit AND consultations:edit; a sealed, an unsigned completed or a cancelled visit is DRAFT_LOCKED (P0001). Audit visit.repeat_plan (added, skipped, diagnoses_added counts only). Idempotent by p_client_request_id. Result: prescription_id, added_item_ids, skipped_item_ids, diagnoses_added, replayed.';

-- 4. The allergy record command (A-8, S-6) ---------------------------------------------------------------------------------------------------------
DROP FUNCTION public.record_patient_allergies(uuid, uuid, jsonb, uuid);
CREATE FUNCTION public.record_patient_allergies(p_tenant_id uuid, p_patient_id uuid, p_allergies jsonb, p_expected jsonb, p_client_request_id uuid)
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
    v_el jsonb;
    v_clean text;
    v_list text[] := ARRAY[]::text[];
    v_seen text[] := ARRAY[]::text[];
    v_expected text[];
    v_stored text[];
    v_coded integer;
    v_result jsonb;
BEGIN
    -- 1. Actor: a session; this command has no system path.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. The ACTIVE clinic, then patients:edit AND consultations:view there (the 000055 rule: the front desk cannot change allergies).
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'PATIENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT (public.has_permission(p_tenant_id, 'patients:edit') AND public.has_permission(p_tenant_id, 'consultations:view')) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    -- Input: a patient and a list of at most 50 strings of 1 to 200 characters (after trimming); [] = no known allergies.
    IF p_patient_id IS NULL OR p_allergies IS NULL OR jsonb_typeof(p_allergies) <> 'array' OR jsonb_array_length(p_allergies) > 50 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    FOR v_el IN SELECT a.el FROM jsonb_array_elements(p_allergies) a(el) LOOP
        IF jsonb_typeof(v_el) <> 'string' THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        v_clean := btrim(regexp_replace(v_el #>> '{}', '\s+', ' ', 'g'));
        IF char_length(v_clean) NOT BETWEEN 1 AND 200 OR v_clean ~ '[[:cntrl:]]' THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        IF NOT (lower(v_clean) = ANY (v_seen)) THEN
            v_seen := v_seen || lower(v_clean);
            v_list := v_list || v_clean;
        END IF;
    END LOOP;
    -- 000120 (A-8): the list the editor started from. SQL NULL or JSON null = "not recorded"; otherwise an array of at most 200 strings (any list a writer
    -- may have stored). The stored list must be exactly this one, or the write is refused below.
    IF p_expected IS NOT NULL AND jsonb_typeof(p_expected) <> 'null' THEN
        IF jsonb_typeof(p_expected) <> 'array' OR jsonb_array_length(p_expected) > 200
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_expected) a(el) WHERE jsonb_typeof(a.el) <> 'string' OR char_length(a.el #>> '{}') > 1000) THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        v_expected := ARRAY(SELECT a.el #>> '{}' FROM jsonb_array_elements(p_expected) WITH ORDINALITY a(el, ord) ORDER BY a.ord);
    END IF;

    -- 3. Claim; a replay returns the first result and writes nothing (it is answered before the comparison: after a commit the stored list is the new one).
    v_replay := private.command_claim(p_tenant_id, p_client_request_id, 'public.record_patient_allergies',
                                      private.command_request_hash(jsonb_build_object('patient', p_patient_id, 'allergies', p_allergies,
                                                                                      'expected', coalesce(p_expected, 'null'::jsonb))));
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock the patient (in this clinic only; an erased or deleted record is not found, S-6), compare, write the list, audit.
    SELECT p.allergies INTO v_stored
      FROM public.patients p
     WHERE p.id = p_patient_id AND p.tenant_id = p_tenant_id AND NOT p.is_deleted AND p.erased_at IS NULL
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PATIENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_stored IS DISTINCT FROM v_expected THEN
        RAISE EXCEPTION 'ALLERGIES_CHANGED' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.patients p SET allergies = v_list, updated_at = now() WHERE p.id = p_patient_id AND p.tenant_id = p_tenant_id;
    SELECT count(*) INTO v_coded FROM unnest(v_list) a WHERE cardinality(private.allergy_substance_ids(ARRAY[a])) > 0;

    PERFORM private.log_command_audit(p_tenant_id, 'patient.allergies_record', 'patient', p_patient_id,
                             jsonb_build_object('allergies_count', cardinality(v_list), 'coded_count', v_coded));

    v_result := jsonb_build_object('patient_id', p_patient_id, 'allergies_count', cardinality(v_list), 'replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.record_patient_allergies(uuid, uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_patient_allergies(uuid, uuid, jsonb, jsonb, uuid) TO authenticated;
COMMENT ON FUNCTION public.record_patient_allergies(uuid, uuid, jsonb, jsonb, uuid) IS
    'V2-09c 09C-02 (R-8), 000120 (A-8, S-6): records a patient''s allergies in one transaction: the list of 0 to 50 strings (1 to 200 characters, whitespace collapsed, duplicates removed case-insensitively; [] is "No known allergies"), and the patient.allergies_record audit row (allergies_count, coded_count). p_expected is the list the caller started from (JSON null = not recorded): a stored list that differs is ALLERGIES_CHANGED (P0001, nothing written), so a stale editor never removes an allergy recorded meanwhile. patients:edit AND consultations:view (the front desk cannot). PATIENT_NOT_FOUND (P0002) for another clinic or an erased or deleted patient. Idempotent by p_client_request_id (a replay is answered before the comparison). Result: patient_id, allergies_count, replayed.';

-- 5. Every allergy write is audited at the database (S-2, ruling R-AL) ----------------------------------------------------------------------------
CREATE FUNCTION private.patients_allergies_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_role text;
    v_old text[] := ARRAY(SELECT DISTINCT lower(btrim(a)) FROM unnest(coalesce(OLD.allergies, ARRAY[]::text[])) a WHERE btrim(a) <> '');
    v_new text[] := ARRAY(SELECT DISTINCT lower(btrim(a)) FROM unnest(coalesce(NEW.allergies, ARRAY[]::text[])) a WHERE btrim(a) <> '');
BEGIN
    IF v_uid IS NOT NULL THEN
        SELECT m.role INTO v_role
          FROM public.memberships m
         WHERE m.tenant_id = NEW.tenant_id AND m.user_id = v_uid AND m.status = 'active';
    END IF;
    -- Counts only: how many the record now holds (null = not recorded), how many entries were added and removed (case-insensitive). Never the strings.
    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, actor_type, action, entity_type, entity_id, metadata)
    VALUES (NEW.tenant_id, v_uid, coalesce(v_role, 'system'), CASE WHEN v_uid IS NULL THEN 'system' ELSE 'user' END,
            'patient.allergies_change', 'patient', NEW.id,
            jsonb_build_object('allergies_count', CASE WHEN NEW.allergies IS NULL THEN NULL ELSE cardinality(NEW.allergies) END,
                               'added', (SELECT count(*) FROM unnest(v_new) x WHERE NOT (x = ANY (v_old))),
                               'removed', (SELECT count(*) FROM unnest(v_old) x WHERE NOT (x = ANY (v_new)))));
    RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.patients_allergies_audit() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.patients_allergies_audit() IS
    'V2-09c 000120 (S-2, ruling R-AL): AFTER UPDATE OF allergies on patients, when the value changed: one patient.allergies_change audit row for every writer (record_patient_allergies, the patient edit, a direct UPDATE, the service role): allergies_count (null = not recorded), added, removed. Counts only, never the strings. The actor is the session user (membership role) or system.';
CREATE TRIGGER patients_allergies_audit
    AFTER UPDATE OF allergies ON public.patients
    FOR EACH ROW
    WHEN (NEW.allergies IS DISTINCT FROM OLD.allergies)
    EXECUTE FUNCTION private.patients_allergies_audit();

-- 6. "Not recorded" is the default (S-5, A-7) -------------------------------------------------------------------------------------------------------
ALTER TABLE public.patients ALTER COLUMN allergies DROP DEFAULT;

-- 7. A doctor's custom medicines are theirs (S-7) ----------------------------------------------------------------------------------------------------
DROP POLICY doctor_custom_medicines_select ON public.doctor_custom_medicines;
CREATE POLICY doctor_custom_medicines_select ON public.doctor_custom_medicines
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('consultations:view')) AND doctor_id = (SELECT auth.uid()));
