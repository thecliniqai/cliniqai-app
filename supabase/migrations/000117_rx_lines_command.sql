-- Migration: 000117_rx_lines_command.sql
-- V2-09c 09C-01 (R-2, R-3, R-12 print columns; P1-32, AI-08 part, M4.4): one command for every prescription change, the medicine search as an INVOKER read,
-- and the clinic's print settings. Additive columns, a new read and command, the old search dropped, grant narrowing after the writer inventory.
--
-- 1. Print columns (R-12): tenants.rx_paper_size ('A4' | 'A5') and tenants.rx_letterhead_mode ('blank_paper' | 'preprinted_letterhead'), the clinic's defaults;
--    CHECK 0 to 300 on tenants.letterhead_top_margin and letterhead_bottom_margin (points; NULL stays allowed, the PDF falls back to its defaults);
--    prescriptions.paper_size ('A4' | 'A5'), frozen on the header at its creation (the 000108/000109 column grant leaves authenticated no UPDATE on it).
--    cdci_generics.substance_ids text[] (the CDCI substance ids of a generic, loaded by the CDCI seed in 09C-02) with a GIN index: the search reads it once.
-- 2. public.search_medicines(p_tenant_id, p_query, p_limit) replaces the 4-argument DEFINER function of 000061 (dropped): STABLE INVOKER, prescriptions:edit in
--    p_tenant_id (the doctor is auth.uid(), never a parameter). The query is trimmed to 60 characters; `%`, `_` and `\` match themselves; no to_tsquery on input.
--    Order: the caller's own custom medicines (use_count), then the CDCI catalogue by rank (1 brand prefix, 2 a word of the brand, 3 generic prefix or a word of
--    the generic, 4 the term inside, 5 trigram similarity of at least 0.3 on brand or generic). A custom row carries the doctor's stored dosage, timing and
--    duration; a CDCI row carries none (the 000061 function invented 'After food' and '5 days': AI §1.1 A4, 09B R-14). substance_ids come from
--    cdci_brands.generic_id -> cdci_generics.substance_ids (empty until the CDCI seed loads them).
-- 3. public.change_prescription(p_tenant_id, p_visit_id, p_changes, p_client_request_id): DEFINER, the V2-07 pattern. p_changes = {add: [line] (0-30),
--    update: [{id, dosage?, timing?, duration?, special_instructions?}] (0-30), remove: [uuid] (0-30)}, closed key sets, at most 64 kB, at least one operation.
--    Refuses a sealed, an unsigned completed and a cancelled visit with DRAFT_LOCKED (the predicate of save_consultation_draft); every update or remove id must
--    be an item of the visit's latest header (ITEM_NOT_FOUND, P0002, nothing written); creates that header when none exists (the clinic's letterhead mode and
--    paper size); adds take the next sort_order in array order; a line without cdci_brand_id upserts the doctor's custom medicine with the line's dose as their
--    stored values (use_count + 1). Audit prescription.lines_change with counts only. The 09A seal guards still fire for the definer body (auth.uid() is the caller).
-- 4. Audit lists: prescription.lines_change is command-only (log_command_audit accepts it; log_audit does not), prescription.item_add and
--    prescription.item_remove leave the client-action list (no writer remains), metadata keys added, updated, removed. Bodies start from 000112.
-- 5. Contract: INSERT, UPDATE, DELETE on prescription_items, INSERT on prescriptions and INSERT, UPDATE on doctor_custom_medicines are revoked from
--    authenticated. Writer inventory (09C-NOTES.md): the request-path writers were features/prescriptions/service.ts (deleted in this plan); the v1 API
--    writes with the service role (ADR-0005 register, V2-12); the PDF pair UPDATE on prescriptions stays (R-A).
--
-- Per-migration checklist: a new public INVOKER read and a new public DEFINER command (search_path '', lock_timeout 2s, EXECUTE for authenticated only), three
-- replaced audit helpers (private, no API grant), additive columns with defaults, one dropped function (its only caller is deleted in the same plan), three
-- privilege revocations after the inventory. No data change.

-- 1. Columns ---------------------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.tenants
    ADD COLUMN rx_paper_size text NOT NULL DEFAULT 'A4',
    ADD COLUMN rx_letterhead_mode text NOT NULL DEFAULT 'blank_paper';
ALTER TABLE public.tenants
    ADD CONSTRAINT tenants_rx_paper_size_check CHECK (rx_paper_size IN ('A4', 'A5')),
    ADD CONSTRAINT tenants_rx_letterhead_mode_check CHECK (rx_letterhead_mode IN ('blank_paper', 'preprinted_letterhead')),
    ADD CONSTRAINT tenants_letterhead_top_margin_range CHECK (letterhead_top_margin BETWEEN 0 AND 300),
    ADD CONSTRAINT tenants_letterhead_bottom_margin_range CHECK (letterhead_bottom_margin BETWEEN 0 AND 300);
COMMENT ON COLUMN public.tenants.rx_paper_size IS 'V2-09c (R-12): the clinic''s default prescription paper size, frozen on a header at its creation (prescriptions.paper_size).';
COMMENT ON COLUMN public.tenants.rx_letterhead_mode IS 'V2-09c (R-12): the clinic''s default prescription letterhead mode, frozen on a header at its creation (prescriptions.letterhead_mode).';

ALTER TABLE public.prescriptions
    ADD COLUMN paper_size text NOT NULL DEFAULT 'A4',
    ADD CONSTRAINT prescriptions_paper_size_check CHECK (paper_size IN ('A4', 'A5'));
COMMENT ON COLUMN public.prescriptions.paper_size IS 'V2-09c (R-12): the paper size the header was created with; no request path may change it (the UPDATE grant is the PDF pair only).';

ALTER TABLE public.cdci_generics ADD COLUMN substance_ids text[] NOT NULL DEFAULT '{}';
CREATE INDEX idx_cdci_generics_substance_ids ON public.cdci_generics USING gin (substance_ids);
COMMENT ON COLUMN public.cdci_generics.substance_ids IS 'V2-09c (R-3, R-7): the CDCI substance ids of the generic (GenericMaster.txt column 3), loaded by the CDCI seed; empty until then.';

-- 2. The medicine search (R-3) ----------------------------------------------------------------------------------------------------------------
DROP FUNCTION public.search_medicines(text, uuid, uuid, integer);

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
        RAISE EXCEPTION 'medicine search requires the pg_trgm extension';
    END IF;

    v_sql := $fn$
CREATE FUNCTION public.search_medicines(
    p_tenant_id uuid,
    p_query text,
    p_limit integer DEFAULT 15
)
RETURNS TABLE (
    id text,
    kind text,
    medicine_name text,
    generic_name text,
    dose_form text,
    substance_ids text[],
    dosage text,
    timing text,
    duration text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
SET pg_trgm.similarity_threshold = '0.3'
-- A typeahead must use the trigram indexes whatever the planner estimates: its cost model prefers four sequential scans of a small catalogue (66 ms at
-- 20,000 rows, measured) to the indexes (5 ms). Without an index to use, a scan is still chosen.
SET enable_seqscan = off
AS $body$
DECLARE
    v_uid uuid := auth.uid();
    v_limit integer := least(greatest(coalesce(p_limit, 15), 1), 30);
    v_term text := lower(btrim(left(coalesce(p_query, ''), 60)));
    v_pat text;
BEGIN
    IF v_uid IS NULL OR p_tenant_id IS NULL OR v_term = '' THEN
        RETURN;
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'prescriptions:edit') THEN
        RETURN;
    END IF;
    v_pat := replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_');

    -- Dynamic SQL on purpose: EXECUTE ... USING plans for the typed words, not once for unknown parameters.
    RETURN QUERY EXECUTE $q$
    WITH custom AS (
        SELECT cm.id::text AS id, 'custom'::text AS kind, cm.medicine_name AS medicine_name, cm.generic_name AS generic_name,
               cm.dose_form AS dose_form, ARRAY[]::text[] AS substance_ids,
               cm.default_dosage AS dosage, cm.default_timing AS timing, cm.default_duration AS duration,
               0 AS grp, cm.use_count AS uses, 0 AS rank
          FROM public.doctor_custom_medicines cm
         WHERE cm.tenant_id = $3 AND cm.doctor_id = $4
           AND (lower(cm.medicine_name) LIKE '%' || $1 || '%'
                OR lower(coalesce(cm.generic_name, '')) LIKE '%' || $1 || '%'
                OR __TRGM__.similarity(lower(cm.medicine_name), $2) >= 0.3)
    ), cand AS MATERIALIZED (
        -- Four index-friendly branches (the GIN trigram indexes of 000007 serve ILIKE and the % operator); one OR over all four is planned as a scan of the
        -- whole catalogue (about 50 ms at 20,000 rows against 3 ms here).
        SELECT c1.id AS id FROM public.cdci_medicines_search c1 WHERE c1.brand_name ILIKE '%' || $1 || '%'
        UNION
        SELECT c2.id FROM public.cdci_medicines_search c2 WHERE c2.generic_name ILIKE '%' || $1 || '%'
        UNION
        SELECT c3.id FROM public.cdci_medicines_search c3 WHERE c3.brand_name OPERATOR(__TRGM__.%) $2
        UNION
        SELECT c4.id FROM public.cdci_medicines_search c4 WHERE c4.generic_name OPERATOR(__TRGM__.%) $2
    ), cdci AS (
        SELECT c.id AS id, 'cdci'::text AS kind, c.brand_name AS medicine_name, c.generic_name AS generic_name,
               c.dose_form AS dose_form, coalesce(g.substance_ids, ARRAY[]::text[]) AS substance_ids,
               NULL::text AS dosage, NULL::text AS timing, NULL::text AS duration,
               1 AS grp, 0 AS uses,
               CASE
                   WHEN lower(c.brand_name) LIKE $1 || '%' THEN 1
                   WHEN lower(c.brand_name) LIKE '% ' || $1 || '%' THEN 2
                   WHEN lower(coalesce(c.generic_name, '')) LIKE $1 || '%'
                        OR lower(coalesce(c.generic_name, '')) LIKE '% ' || $1 || '%' THEN 3
                   WHEN lower(c.brand_name) LIKE '%' || $1 || '%'
                        OR lower(coalesce(c.generic_name, '')) LIKE '%' || $1 || '%' THEN 4
                   ELSE 5
               END AS rank
          FROM cand
          -- LATERAL: each candidate is read by its primary key (a plain join let the planner re-apply the filter below to the whole catalogue)
          CROSS JOIN LATERAL (SELECT cc.id, cc.brand_name, cc.generic_name, cc.dose_form
                                FROM public.cdci_medicines_search cc WHERE cc.id = cand.id) c
          LEFT JOIN public.cdci_brands b ON b.id = c.id
          LEFT JOIN public.cdci_generics g ON g.id = b.generic_id
         WHERE (c.brand_name ILIKE '%' || $1 || '%'
                OR c.generic_name ILIKE '%' || $1 || '%'
                OR __TRGM__.similarity(c.brand_name, $2) >= 0.3
                OR __TRGM__.similarity(coalesce(c.generic_name, ''), $2) >= 0.3)
           AND NOT EXISTS (SELECT 1 FROM custom cu WHERE lower(cu.medicine_name) = lower(c.brand_name))
    ), merged AS (
        SELECT u.* FROM (SELECT * FROM custom UNION ALL SELECT * FROM cdci) u
    )
    SELECT m.id, m.kind, m.medicine_name, m.generic_name, m.dose_form, m.substance_ids, m.dosage, m.timing, m.duration
      FROM merged m
     ORDER BY m.grp, m.uses DESC, m.rank, lower(m.medicine_name), m.id
     LIMIT $5
    $q$ USING v_pat, v_term, p_tenant_id, v_uid, v_limit;
END;
$body$;
$fn$;
    EXECUTE replace(v_sql, '__TRGM__', quote_ident(v_schema));
END;
$migration$;
REVOKE ALL ON FUNCTION public.search_medicines(uuid, text, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.search_medicines(uuid, text, integer) TO authenticated;
COMMENT ON FUNCTION public.search_medicines(uuid, text, integer) IS
    'V2-09c 09C-01 (R-3): the Rx medicine typeahead. STABLE INVOKER, prescriptions:edit in p_tenant_id; the doctor is auth.uid(). The caller''s own custom medicines first (use_count), then the CDCI catalogue by rank (brand prefix, a word of the brand, generic prefix, the term inside, trigram similarity >= 0.3). Custom rows carry the doctor''s stored dosage, timing and duration; CDCI rows carry none. %, _ and \ in the query match themselves. At most p_limit (1-30, default 15). Output: id, kind (cdci|custom), medicine_name, generic_name, dose_form, substance_ids, dosage, timing, duration.';

-- 3. The command (R-2) -----------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.change_prescription(
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
        IF v_key NOT IN ('add', 'update', 'remove') OR jsonb_typeof(p_changes -> v_key) <> 'array' OR jsonb_array_length(p_changes -> v_key) > 30 THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
    END LOOP;
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
            INSERT INTO public.prescription_items (tenant_id, prescription_id, medicine_name, generic_name, dose_form, dosage, timing, duration,
                                                   special_instructions, cdci_brand_id, cdci_generic_id, sort_order)
            VALUES (p_tenant_id, v_rx, btrim(v_el ->> 'medicine_name'),
                    nullif(btrim(coalesce(v_el ->> 'generic_name', '')), ''),
                    nullif(btrim(coalesce(v_el ->> 'dose_form', '')), ''),
                    btrim(v_el ->> 'dosage'),
                    nullif(btrim(coalesce(v_el ->> 'timing', '')), ''),
                    btrim(v_el ->> 'duration'),
                    nullif(btrim(coalesce(v_el ->> 'special_instructions', '')), ''),
                    nullif(btrim(coalesce(v_el ->> 'cdci_brand_id', '')), ''),
                    v_generic_id,
                    v_next)
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
                             jsonb_build_object('added', v_n_add, 'updated', v_n_upd, 'removed', v_n_rem));

    v_result := jsonb_build_object('prescription_id', v_rx, 'added_item_ids', to_jsonb(v_added), 'replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.change_prescription(uuid, uuid, jsonb, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.change_prescription(uuid, uuid, jsonb, uuid) TO authenticated;
COMMENT ON FUNCTION public.change_prescription(uuid, uuid, jsonb, uuid) IS
    'V2-09c 09C-01 (R-2): every prescription change in one transaction: add (0-30 lines), update (dose fields of 0-30 items), remove (0-30 items). The visit''s latest header is created with the clinic''s print settings when there is none; an update or remove id must be an item of that header (ITEM_NOT_FOUND, P0002, nothing written); adds take the next sort_order in array order; a line without cdci_brand_id upserts the doctor''s custom medicine (use_count + 1, the line''s dose as stored values); the prescription.lines_change audit row (added, updated, removed counts). prescriptions:edit. A sealed, an unsigned completed or a cancelled visit is DRAFT_LOCKED (P0001); the 09A seal guards still fire. Idempotent by p_client_request_id. Result: prescription_id, added_item_ids, replayed.';

-- 4. Audit allow-lists (bodies from 000112) ------------------------------------------------------------------------------------------------------
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
                                            'visit.create', 'consultation.draft_save', 'prescription.lines_change')
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
    'V2-07 07-04a (F-1), V2-08 08-01b, 08-04a, 08-06a, V2-09b 000112, V2-09c 000117: writes an audit row as the session user for the actions only a command writes (visit.complete_and_sign, visit.reopen_for_amendment, visit.amend_finalized, invoice.create, queue.check_in, visit.consultation_start, visit.complete_at_desk, visit.reschedule, visit.no_show, visit.cancel, visit.confirm, visit.auto_promoted_from_waitlist, waitlist.add, waitlist.promote, visit.create, consultation.draft_save, prescription.lines_change), with log_audit''s metadata rules. The active clinic and a membership are required. No API grant: public.log_audit refuses these actions.';

CREATE OR REPLACE FUNCTION private.audit_client_actions()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT ARRAY[
        'api_key.create', 'api_key.revoke', 'appointment.create',
        'clinic.profile.update', 'clinic.settings.update', 'consultation.amend', 'consultation.complete_sign',
        'consultation.share_consolidated_whatsapp', 'diagnosis.add', 'diagnosis.remove',
        'diagnosis.update_note', 'invoice.generate_receipt_pdf',
        'invoice.item_add', 'invoice.item_remove', 'invoice.payment_recorded', 'invoice.share_whatsapp',
        'lab_order.create', 'patient.consent.granted', 'patient.consent.withdrawn', 'patient.create',
        'patient.update', 'patient.view', 'patient_document.delete', 'patient_document.generate_share_token',
        'patient_document.share_whatsapp', 'patient_document.upload', 'prescription.create',
        'prescription.generate_pdf',
        'prescription.pdf_integrity_failed',
        'prescription.share_whatsapp', 'prescription.template_save',
        'referral.acknowledge', 'referral.close_loop', 'referral.create', 'referral.share_whatsapp',
        'schedule_block.create', 'schedule_block.delete', 'staff.member.update', 'user.profile.update',
        'vitals.record',
        'webhook.create', 'webhook.delete',
        'dpdp.data_export', 'dpdp.patient_erasure'
    ]::TEXT[];
$$;
COMMENT ON FUNCTION private.audit_client_actions() IS
    'The actions public.log_audit accepts from a signed-in member (parity: lib/audit/audit.ts AUDIT_ACTIONS without the reserved prefixes, plus the two bound DPDP events; tests/audit/log-audit-allowlist.spec.ts). V2-08 08-06a (S-5): appointment.cancel, appointment.reschedule, queue.transition, visit.status_update and visit.create are no longer accepted; their writers are the commands (private.log_command_audit) and the API-key path (audit_logs insert by the service client). V2-09a 000109: prescription.pdf_integrity_failed (a served sealed Rx PDF whose bytes did not match the stored SHA-256). V2-09b 000112: consultation.draft_save is written by save_consultation_draft only, and follow_up.record is gone with the app-side follow-up writer. V2-09c 000117: prescription.item_add and prescription.item_remove are gone with the app-side Rx writers; prescription.lines_change is written by change_prescription only.';

CREATE OR REPLACE FUNCTION private.audit_metadata_keys()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT ARRAY[
        'added', 'amendment_reason', 'conflict_overwrite', 'consent_type', 'correlation_id', 'dose_form', 'draft_version', 'erased_at',
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

-- 5. Contract: the writers are inventoried (09C-NOTES.md, 09C-01) ------------------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.prescription_items FROM authenticated;
REVOKE INSERT ON public.prescriptions FROM authenticated;
REVOKE INSERT, UPDATE ON public.doctor_custom_medicines FROM authenticated;
