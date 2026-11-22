-- Migration: 000118_rx_allergy_check.sql
-- V2-09c 09C-02 (R-6, R-7, R-8; AI-11, SA-07 at substance level): the allergy check, the allergy record command and the three allergy states made true again.
-- Additive column, helpers, replaced command and normalizer, two reads, one command.
--
-- 1. prescription_items.allergy_override jsonb ({reason 5-300 characters, allergens 1-50 strings, by uuid, at timestamp}, the CHECK reads the shape) holds the
--    doctor's reason to prescribe a medicine that matches a recorded allergy; an index on lower(btrim(cdci_substances.substance_name)) serves the coding.
-- 2. Helpers, one SQL source of the rule (R-7): private.allergy_substance_ids(text[]) (the CDCI substance ids of the allergy strings that equal a substance
--    name, case-insensitive and trimmed), private.rx_line_substance_ids(cdci_brand_id, generic_name) (brand -> generic -> substance_ids), and
--    private.rx_allergy_matches(allergies, substance_ids, names) -> the allergy strings the line matches: a CODED allergy matches by substance ids when the
--    line has ids; an allergy that is not coded, or a line with no ids, is checked by NAME (the allergy's words appear, in order, in the medicine or generic
--    name; case-insensitive, split on non-alphanumerics, so a word inside a longer word never matches). No class table, no salt relations (D-9).
--    EXECUTE for authenticated (pure reads of the public catalogue; the INVOKER read below calls them), none for anon or the service role's API grant.
-- 3. public.change_prescription replaced from its 000117 body: the optional key allergy_override_reason; with assist.allergy_check entitled (resolved from
--    billing_internal.has_entitlement; a platform override of the key is the kill switch) and allergies recorded, a matching ADD without a reason is
--    ALLERGY_MATCH (P0001: nothing written, no audit row); with a reason the line stores the override and the audit counts it (allergy_overrides; the reason
--    is never in audit metadata); an UPDATE with a reason confirms an existing line that matches. Everything else is unchanged.
-- 4. public.rx_allergy_context(p_tenant_id, p_visit_id) (INVOKER, consultations:view): the patient's allergy state (not_recorded, none, known), each
--    allergy string with its substance ids, whether the clinic is entitled, and each current item with the strings it matches, how it was checked and
--    whether it carries an override. public.search_substances(p_tenant_id, p_query, p_limit) (INVOKER, consultations:view): the allergy typeahead over the
--    CDCI substances (prefix, word prefix, then trigram similarity; %, _ and \ match themselves).
-- 5. public.record_patient_allergies(p_tenant_id, p_patient_id, p_allergies, p_client_request_id): DEFINER, V2-07 pattern; patients:edit AND
--    consultations:view (the 000055 rule: the front desk cannot); 0-50 strings of 1-200 characters, duplicates removed case-insensitively; [] = "No known
--    allergies"; audit patient.allergies_record (counts only).
-- 6. private.patient_input_normalize and private.step_create_patient replaced from 000101: an absent or null allergies stays NULL ("not recorded"); the
--    registration commands stored {} ("No known allergies") for patients nobody asked. Every other rule is unchanged.
-- 7. Audit lists (bodies from 000117): patient.allergies_record is command-only; metadata keys allergies_count, allergy_overrides, coded_count.
-- Per-migration checklist: three private helpers with EXECUTE for authenticated, two INVOKER reads and one DEFINER command (search_path '', lock_timeout 2s,
-- EXECUTE for authenticated only), four replaced bodies, one additive column. No grant narrowing and no data change.

-- 1. The override column and the substance-name index ------------------------------------------------------------------------------------------
ALTER TABLE public.prescription_items ADD COLUMN allergy_override jsonb;
ALTER TABLE public.prescription_items
    ADD CONSTRAINT prescription_items_allergy_override_shape CHECK (
        allergy_override IS NULL OR (
            jsonb_typeof(allergy_override) = 'object'
            AND allergy_override ?& ARRAY['reason', 'allergens', 'by', 'at']
            AND allergy_override - 'reason' - 'allergens' - 'by' - 'at' = '{}'::jsonb
            AND jsonb_typeof(allergy_override -> 'reason') = 'string'
            AND char_length(allergy_override ->> 'reason') BETWEEN 5 AND 300
            AND jsonb_typeof(allergy_override -> 'allergens') = 'array'
            AND jsonb_array_length(allergy_override -> 'allergens') BETWEEN 1 AND 50
            AND (allergy_override -> 'allergens')::text ~ '^\[("([^"\\]|\\.){1,200}"(, )?)+\]$'
            AND jsonb_typeof(allergy_override -> 'by') = 'string'
            AND (allergy_override ->> 'by') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND jsonb_typeof(allergy_override -> 'at') = 'string'
            AND (allergy_override ->> 'at') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}'
        )
    );
COMMENT ON COLUMN public.prescription_items.allergy_override IS
    'V2-09c (R-7): the reason a medicine matching a recorded allergy was prescribed anyway: {reason, allergens, by, at}. Written only by change_prescription.';
CREATE INDEX idx_cdci_substances_name_lower ON public.cdci_substances (lower(btrim(substance_name)));

-- 2. The helpers (R-7) ---------------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION private.allergy_substance_ids(p_allergies text[])
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT coalesce(array_agg(DISTINCT s.id ORDER BY s.id), ARRAY[]::text[])
      FROM public.cdci_substances s
     WHERE lower(btrim(s.substance_name)) IN (SELECT lower(btrim(a)) FROM unnest(coalesce(p_allergies, ARRAY[]::text[])) a WHERE btrim(a) <> '')
$$;
REVOKE ALL ON FUNCTION private.allergy_substance_ids(text[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.allergy_substance_ids(text[]) TO authenticated;
COMMENT ON FUNCTION private.allergy_substance_ids(text[]) IS
    'V2-09c 000118 (R-6, R-7): the CDCI substance ids of the allergy strings that equal a substance name (case-insensitive, trimmed). A string that is not a substance name codes to nothing.';

CREATE FUNCTION private.rx_line_substance_ids(p_cdci_brand_id text, p_generic_name text)
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT coalesce(
        (SELECT g.substance_ids FROM public.cdci_brands b JOIN public.cdci_generics g ON g.id = b.generic_id WHERE b.id = p_cdci_brand_id),
        ARRAY[]::text[])
$$;
REVOKE ALL ON FUNCTION private.rx_line_substance_ids(text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.rx_line_substance_ids(text, text) TO authenticated;
COMMENT ON FUNCTION private.rx_line_substance_ids(text, text) IS
    'V2-09c 000118 (R-7): the CDCI substance ids of a prescription line: its brand''s generic''s substance_ids; empty for a custom medicine, a brand with no generic, or while the CDCI load has not filled substance_ids (the line is then checked by name). p_generic_name is not used yet (reserved).';

CREATE FUNCTION private.rx_allergy_matches(p_allergies text[], p_substance_ids text[], p_names text[])
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
     WHERE CASE
               -- a coded allergy and a line with substances: compared by substance
               WHEN cardinality(x.ids) > 0 AND cardinality(coalesce(p_substance_ids, ARRAY[]::text[])) > 0 THEN x.ids && p_substance_ids
               -- otherwise by name: the allergy's words appear, in order, as whole words of the medicine or the generic name
               ELSE x.words <> '' AND EXISTS (
                        SELECT 1 FROM unnest(coalesce(p_names, ARRAY[]::text[])) n
                         WHERE position(' ' || x.words || ' ' IN ' ' || btrim(regexp_replace(lower(n), '[^[:alnum:]]+', ' ', 'g')) || ' ') > 0)
           END
$$;
REVOKE ALL ON FUNCTION private.rx_allergy_matches(text[], text[], text[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.rx_allergy_matches(text[], text[], text[]) TO authenticated;
COMMENT ON FUNCTION private.rx_allergy_matches(text[], text[], text[]) IS
    'V2-09c 000118 (R-7, AI-11, SA-07 at substance level): the allergy strings a prescription line matches. A coded allergy (its string is a CDCI substance name) matches a line that has substance ids by substance; an allergy that is not coded, or a line with no ids, matches by name: the allergy''s words appear in order as whole words of the medicine or generic name (case-insensitive). No class or salt relations (D-9). Pure; the order of the allergies is kept.';

-- 3. The command (R-7), from the 000117 body ----------------------------------------------------------------------------------------------------
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
        IF nullif(btrim(coalesce(v_el ->> 'cdci_brand_id', '')), '') IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.cdci_medicines_search c WHERE c.id = btrim(v_el ->> 'cdci_brand_id')) THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
    END LOOP;

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
        SELECT p.allergies INTO v_allergies FROM public.patients p WHERE p.id = v_visit.patient_id AND p.tenant_id = p_tenant_id;
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
REVOKE ALL ON FUNCTION public.change_prescription(uuid, uuid, jsonb, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.change_prescription(uuid, uuid, jsonb, uuid) TO authenticated;
COMMENT ON FUNCTION public.change_prescription(uuid, uuid, jsonb, uuid) IS
    'V2-09c 09C-01 (R-2), 09C-02 (R-7): every prescription change in one transaction: add (0-30 lines), update (dose fields of 0-30 items), remove (0-30 items), and the optional allergy_override_reason (5-300 characters). The visit''s latest header is created with the clinic''s print settings when there is none; an update or remove id must be an item of that header (ITEM_NOT_FOUND, P0002, nothing written); adds take the next sort_order in array order; a line without cdci_brand_id upserts the doctor''s custom medicine (use_count + 1, the line''s dose as stored values); the prescription.lines_change audit row (added, updated, removed counts and allergy_overrides when a line matching a recorded allergy was prescribed anyway). With assist.allergy_check entitled and allergies recorded, a matching add without a reason is ALLERGY_MATCH (P0001, nothing written); with a reason the line stores allergy_override {reason, allergens, by, at}; an update with a reason confirms a matching line. prescriptions:edit. A sealed, an unsigned completed or a cancelled visit is DRAFT_LOCKED (P0001); the 09A seal guards still fire. Idempotent by p_client_request_id. Result: prescription_id, added_item_ids, replayed.';

-- 4. The two reads ---------------------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.rx_allergy_context(p_tenant_id uuid, p_visit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_patient record;
    v_rx uuid;
    v_entitled boolean;
    v_allergies text[];
BEGIN
    IF v_uid IS NULL OR p_tenant_id IS NULL OR p_visit_id IS NULL THEN
        RETURN NULL;
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'consultations:view') THEN
        RETURN NULL;
    END IF;
    SELECT p.allergies INTO v_patient
      FROM public.visits v
      JOIN public.patients p ON p.id = v.patient_id AND p.tenant_id = v.tenant_id
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    v_allergies := v_patient.allergies;
    SELECT coalesce((SELECT e.enabled FROM public.my_entitlements(p_tenant_id) e WHERE e.key = 'assist.allergy_check'), false) INTO v_entitled;
    SELECT pr.id INTO v_rx FROM public.prescriptions pr WHERE pr.tenant_id = p_tenant_id AND pr.visit_id = p_visit_id ORDER BY pr.version DESC LIMIT 1;

    RETURN jsonb_build_object(
        'state', CASE WHEN v_allergies IS NULL THEN 'not_recorded' WHEN cardinality(v_allergies) = 0 THEN 'none' ELSE 'known' END,
        'entitled', v_entitled,
        'allergies', coalesce((SELECT jsonb_agg(jsonb_build_object('text', a.allergy, 'substance_ids', to_jsonb(private.allergy_substance_ids(ARRAY[a.allergy]))) ORDER BY a.ord)
                                 FROM unnest(coalesce(v_allergies, ARRAY[]::text[])) WITH ORDINALITY a(allergy, ord)), '[]'::jsonb),
        'items', coalesce((SELECT jsonb_agg(jsonb_build_object(
                               'id', i.id,
                               'matches', to_jsonb(private.rx_allergy_matches(v_allergies, private.rx_line_substance_ids(i.cdci_brand_id, i.generic_name),
                                                                              ARRAY[i.medicine_name, coalesce(i.generic_name, '')])),
                               'checked_by', CASE WHEN cardinality(private.rx_line_substance_ids(i.cdci_brand_id, i.generic_name)) > 0 THEN 'substance' ELSE 'name' END,
                               'overridden', i.allergy_override IS NOT NULL,
                               'override_reason', i.allergy_override ->> 'reason') ORDER BY i.sort_order)
                             FROM public.prescription_items i WHERE i.tenant_id = p_tenant_id AND i.prescription_id = v_rx), '[]'::jsonb)
    );
END;
$$;
REVOKE ALL ON FUNCTION public.rx_allergy_context(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rx_allergy_context(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.rx_allergy_context(uuid, uuid) IS
    'V2-09c 09C-02 (R-7): the allergy picture of a consult for the UI. STABLE INVOKER, consultations:view in p_tenant_id; NULL for another clinic, a visit that is not found or a caller who may not read. state: not_recorded (allergies NULL), none ([]), known; entitled: the clinic holds assist.allergy_check; allergies: each string with the CDCI substance ids it codes to (empty = checked by name only); items: each current prescription item with the allergy strings it matches, how it is checked (substance or name), whether it carries an override and its reason. The rule is private.rx_allergy_matches, the one the commands use.';

CREATE FUNCTION public.search_substances(p_tenant_id uuid, p_query text, p_limit integer DEFAULT 12)
RETURNS TABLE (id text, substance_name text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 30);
    v_term text := lower(btrim(left(coalesce(p_query, ''), 60)));
    v_pat text;
BEGIN
    IF auth.uid() IS NULL OR p_tenant_id IS NULL OR v_term = '' THEN
        RETURN;
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'consultations:view') THEN
        RETURN;
    END IF;
    v_pat := replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_');
    RETURN QUERY
    SELECT s.id, s.substance_name
      FROM public.cdci_substances s
     WHERE lower(s.substance_name) LIKE '%' || v_pat || '%'
     ORDER BY CASE WHEN lower(btrim(s.substance_name)) = v_term THEN 0
                   WHEN lower(s.substance_name) LIKE v_pat || '%' THEN 1
                   WHEN lower(s.substance_name) LIKE '% ' || v_pat || '%' THEN 2
                   ELSE 3 END,
              lower(s.substance_name), s.id
     LIMIT v_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.search_substances(uuid, text, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.search_substances(uuid, text, integer) TO authenticated;
COMMENT ON FUNCTION public.search_substances(uuid, text, integer) IS
    'V2-09c 09C-02 (R-6): the allergy typeahead over the CDCI substances. STABLE INVOKER, consultations:view in p_tenant_id (nothing otherwise). The query is trimmed to 60 characters; %, _ and \ match themselves. Order: the exact name, a prefix, a word prefix, the term inside; then name. At most p_limit (1-30, default 12). Output: id, substance_name.';

-- 5. The allergy record command (R-8) ------------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.record_patient_allergies(p_tenant_id uuid, p_patient_id uuid, p_allergies jsonb, p_client_request_id uuid)
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

    -- 3. Claim; a replay returns the first result and writes nothing.
    v_replay := private.command_claim(p_tenant_id, p_client_request_id, 'public.record_patient_allergies',
                                      private.command_request_hash(jsonb_build_object('patient', p_patient_id, 'allergies', p_allergies)));
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock the patient (in this clinic only), write the list, audit.
    PERFORM 1 FROM public.patients p WHERE p.id = p_patient_id AND p.tenant_id = p_tenant_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PATIENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.patients p SET allergies = v_list, updated_at = now() WHERE p.id = p_patient_id AND p.tenant_id = p_tenant_id;
    v_coded := cardinality(private.allergy_substance_ids(v_list)) ;
    SELECT count(*) INTO v_coded FROM unnest(v_list) a WHERE cardinality(private.allergy_substance_ids(ARRAY[a])) > 0;

    PERFORM private.log_command_audit(p_tenant_id, 'patient.allergies_record', 'patient', p_patient_id,
                             jsonb_build_object('allergies_count', cardinality(v_list), 'coded_count', v_coded));

    v_result := jsonb_build_object('patient_id', p_patient_id, 'allergies_count', cardinality(v_list), 'replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.record_patient_allergies(uuid, uuid, jsonb, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_patient_allergies(uuid, uuid, jsonb, uuid) TO authenticated;
COMMENT ON FUNCTION public.record_patient_allergies(uuid, uuid, jsonb, uuid) IS
    'V2-09c 09C-02 (R-8): records a patient''s allergies in one transaction: the list of 0 to 50 strings (1 to 200 characters, whitespace collapsed, duplicates removed case-insensitively; [] is "No known allergies"), and the patient.allergies_record audit row (allergies_count, coded_count). patients:edit AND consultations:view (the front desk cannot). PATIENT_NOT_FOUND (P0002) for another clinic. Idempotent by p_client_request_id. Result: patient_id, allergies_count, replayed.';

-- 6. Registration keeps "not recorded" (R-8): bodies from 000101 ---------------------------------------------------------------------------------------------
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
    -- 000118 (R-8): an absent or null allergies stays NULL ("not recorded"); only a list the form entered, or [] chosen as "No known allergies", is stored.
    v_allergies := CASE WHEN jsonb_typeof(p_patient -> 'allergies') = 'null' THEN NULL ELSE p_patient -> 'allergies' END;
    v_chronic := coalesce(CASE WHEN jsonb_typeof(p_patient -> 'chronic_conditions') = 'null' THEN NULL ELSE p_patient -> 'chronic_conditions' END, '[]'::jsonb);
    IF (v_allergies IS NOT NULL AND (jsonb_typeof(v_allergies) <> 'array' OR jsonb_array_length(v_allergies) > 50))
       OR jsonb_typeof(v_chronic) <> 'array' OR jsonb_array_length(v_chronic) > 50
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_allergies, '[]'::jsonb) || v_chronic) a(el)
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
        'allergies', coalesce(v_allergies, 'null'::jsonb),
        'chronic_conditions', v_chronic,
        'emergency_contact', v_emergency,
        'abha_id', v_abha,
        'ai_processing_objected', v_objected
    );
END;
$$;
REVOKE ALL ON FUNCTION private.patient_input_normalize(jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.patient_input_normalize(jsonb) IS
    'V2-07 07-03, V2-09c 000118 (R-8): validates and normalises a new patient for the front-desk commands (the patientSchema rules: closed key set, full_name 1-120, an Indian mobile stored as +91 and ten digits, a real date of birth, age 0-130, sex, address, up to 50 allergies / conditions, emergency_contact limited to name / phone / relation strings, abha_id, ai_processing_objected). An absent or null allergies is kept as null (not recorded). INPUT_INVALID (P0001).';

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
        -- 000118 (R-8): JSON null (not recorded) is stored as NULL, a list as the list ([] = no known allergies)
        CASE WHEN jsonb_typeof(v_p -> 'allergies') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(v_p -> 'allergies')) END,
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
    'V2-07 07-03 (R-7), V2-08 08-02 (R-12), V2-09c 000118 (R-8): the patient insert shared by register_patient, enqueue_walk_in and register_and_book: validated input (including ai_processing_objected), created_by = the session user, patient.create audit row. Allergies are stored as NULL when none were entered (not recorded). The caller has checked actor, clinic and patients:edit and holds the command claim; no API grant.';

-- 7. Audit allow-lists (bodies from 000117) -------------------------------------------------------------------------------------------------------
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
                                            'visit.create', 'consultation.draft_save', 'prescription.lines_change', 'patient.allergies_record')
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
    'V2-07 07-04a (F-1), V2-08 08-01b, 08-04a, 08-06a, V2-09b 000112, V2-09c 000117, 000118: writes an audit row as the session user for the actions only a command writes (visit.complete_and_sign, visit.reopen_for_amendment, visit.amend_finalized, invoice.create, queue.check_in, visit.consultation_start, visit.complete_at_desk, visit.reschedule, visit.no_show, visit.cancel, visit.confirm, visit.auto_promoted_from_waitlist, waitlist.add, waitlist.promote, visit.create, consultation.draft_save, prescription.lines_change, patient.allergies_record), with log_audit''s metadata rules. The active clinic and a membership are required. No API grant: public.log_audit refuses these actions.';

CREATE OR REPLACE FUNCTION private.audit_metadata_keys()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT ARRAY[
        'added', 'allergies_count', 'allergy_overrides', 'amendment_reason', 'conflict_overwrite', 'coded_count', 'consent_type', 'correlation_id', 'dose_form', 'draft_version', 'erased_at',
        'fields_changed',
        'follow_up_date', 'format', 'invoice_id', 'invoice_number', 'is_chronic', 'is_custom', 'is_initial_grant',
        'is_overbooked', 'items_count', 'late_arrival', 'letterhead_mode', 'new_scheduled_at', 'new_status',
        'old_scheduled_at', 'old_status', 'origin_type',
        'patient_consents_history_sharing', 'payment_method', 'priority', 'promoted_from_waitlist_id',
        'promoted_visit_id', 'reason', 'referral_type', 'removed', 'retention_policy', 'revision_number', 'sha256', 'specialty', 'status',
        'storage_path', 'target_date', 'target_tenant_id', 'template_name', 'token_number', 'total_amount', 'updated', 'urgency',
        'version', 'view_context'
    ]::TEXT[];
$$;
