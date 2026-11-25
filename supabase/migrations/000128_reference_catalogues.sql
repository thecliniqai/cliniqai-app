-- Migration: 000128_reference_catalogues.sql
-- V2-09e 09E-09 (R-5, R-6; C-2 answered yes 2026-11-23): the global reference catalogues on the device. Versions, shards and the
-- tie-break that lets a TypeScript twin of each search agree with SQL on every database.
--
-- 1. public.reference_catalogues(catalogue, version uuid, changed_at): one row per source ('cdci': substances, generics, brands, the
--    medicine search table; 'diagnoses': opd_diagnoses). RLS on, SELECT for authenticated (global reference data, like the catalogue
--    tables themselves), no write grant to any API role. Both rows seeded here.
-- 2. private.reference_catalogue_bump() (definer, no API grant): a new random version and now() for the catalogue named by the trigger
--    argument. Statement-level AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE triggers on cdci_substances, cdci_generics, cdci_brands,
--    cdci_medicines_search ('cdci') and opd_diagnoses ('diagnoses'): any reload or edit of a catalogue changes its version with no app code.
-- 3. public.reference_shard(p_tenant_id, p_catalogue, p_shard) -> jsonb: STABLE INVOKER, search_path ''. substances and diagnoses need
--    consultations:view, medicines needs prescriptions:edit in p_tenant_id; NULL otherwise (no session, another clinic, a forged tenant, a
--    clinic that is not full, an unknown catalogue, a shard out of range). Answer {catalogue, version, shard, shards, rows}, version and rows
--    from one snapshot (a STABLE function sees the calling statement's snapshot). Rows are arrays, ordered by id (COLLATE "C"):
--    substances [id, name] (one shard); diagnoses [id, name, icd11, snomed, chronic, specialties, synonyms] (one shard); medicines shard 0 =
--    generics [id, name, substance_ids], shards 1..n = the medicine search table's brands [id, brand_name, generic_row, dose_form], 12,000
--    per shard, generic_row = the 0-based position of the brand's generic in shard 0 (NULL when it has none). No PHI: catalogue rows only.
-- 4. search_substances (000118), search_diagnoses (000114) and search_medicines (000117) replaced from their latest bodies (CREATE OR REPLACE:
--    same signatures, grants and comments kept). The ONLY change in each is the name tie-break, now lower(name) COLLATE "C" (R-6), so the
--    device's twin and every database agree whatever the database's default collation.
-- Per-migration checklist: one new global table (RLS on, SELECT authenticated, no write grant), one new private definer trigger function
-- (no API grant), 5 statement triggers, one new public INVOKER read (EXECUTE authenticated only), three INVOKER reads replaced (order of
-- equal-ranked names only). Expand-safe: the running app calls none of the new objects; the search output columns are unchanged.

-- 1. The versions ------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE public.reference_catalogues (
    catalogue text PRIMARY KEY CHECK (catalogue IN ('cdci', 'diagnoses')),
    version uuid NOT NULL,
    changed_at timestamptz NOT NULL
);
COMMENT ON TABLE public.reference_catalogues IS
    'V2-09e 09E-09 (R-5): the version of each global reference catalogue source (cdci, diagnoses), changed by statement triggers on the catalogue tables. No PHI, no tenant. Written only by private.reference_catalogue_bump.';
ALTER TABLE public.reference_catalogues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reference_catalogues FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.reference_catalogues TO authenticated;
CREATE POLICY reference_catalogues_select ON public.reference_catalogues
    FOR SELECT TO authenticated
    USING (true);

INSERT INTO public.reference_catalogues (catalogue, version, changed_at)
VALUES ('cdci', gen_random_uuid(), now()), ('diagnoses', gen_random_uuid(), now())
ON CONFLICT DO NOTHING;

-- 2. The bump ----------------------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION private.reference_catalogue_bump()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.reference_catalogues
       SET version = gen_random_uuid(), changed_at = now()
     WHERE catalogue = TG_ARGV[0];
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.reference_catalogue_bump() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.reference_catalogue_bump() IS
    'V2-09e 09E-09 (R-5): statement trigger on the catalogue tables: a new random version and now() for the catalogue named by the trigger argument (cdci or diagnoses). No API grant.';

CREATE TRIGGER cdci_substances_reference_bump
    AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.cdci_substances
    FOR EACH STATEMENT EXECUTE FUNCTION private.reference_catalogue_bump('cdci');
CREATE TRIGGER cdci_generics_reference_bump
    AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.cdci_generics
    FOR EACH STATEMENT EXECUTE FUNCTION private.reference_catalogue_bump('cdci');
CREATE TRIGGER cdci_brands_reference_bump
    AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.cdci_brands
    FOR EACH STATEMENT EXECUTE FUNCTION private.reference_catalogue_bump('cdci');
CREATE TRIGGER cdci_medicines_search_reference_bump
    AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.cdci_medicines_search
    FOR EACH STATEMENT EXECUTE FUNCTION private.reference_catalogue_bump('cdci');
CREATE TRIGGER opd_diagnoses_reference_bump
    AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.opd_diagnoses
    FOR EACH STATEMENT EXECUTE FUNCTION private.reference_catalogue_bump('diagnoses');

-- 3. The shard read ----------------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.reference_shard(p_tenant_id uuid, p_catalogue text, p_shard integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    c_brands_per_shard constant integer := 12000;
    v_source text;
    v_permission text;
    v_version uuid;
    v_shards integer;
    v_rows jsonb;
BEGIN
    IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_catalogue IS NULL OR p_shard IS NULL OR p_shard < 0 THEN
        RETURN NULL;
    END IF;
    IF p_catalogue = 'substances' THEN
        v_source := 'cdci';
        v_permission := 'consultations:view';
    ELSIF p_catalogue = 'diagnoses' THEN
        v_source := 'diagnoses';
        v_permission := 'consultations:view';
    ELSIF p_catalogue = 'medicines' THEN
        v_source := 'cdci';
        v_permission := 'prescriptions:edit';
    ELSE
        RETURN NULL;
    END IF;
    IF NOT public.has_permission(p_tenant_id, v_permission) THEN
        RETURN NULL;
    END IF;
    SELECT rc.version INTO v_version FROM public.reference_catalogues rc WHERE rc.catalogue = v_source;
    IF v_version IS NULL THEN
        RETURN NULL;
    END IF;

    IF p_catalogue = 'substances' THEN
        v_shards := 1;
        IF p_shard >= v_shards THEN
            RETURN NULL;
        END IF;
        SELECT coalesce(jsonb_agg(jsonb_build_array(s.id, s.substance_name) ORDER BY s.id COLLATE "C"), '[]'::jsonb)
          INTO v_rows
          FROM public.cdci_substances s;
    ELSIF p_catalogue = 'diagnoses' THEN
        v_shards := 1;
        IF p_shard >= v_shards THEN
            RETURN NULL;
        END IF;
        SELECT coalesce(jsonb_agg(jsonb_build_array(d.id, d.name, d.icd11_code, d.snomed_concept_id, d.is_chronic,
                                                    coalesce(d.specialties, ARRAY[]::text[]), coalesce(d.synonyms, ARRAY[]::text[]))
                                  ORDER BY d.id), '[]'::jsonb)
          INTO v_rows
          FROM public.opd_diagnoses d;
    ELSE
        v_shards := 1 + ceil((SELECT count(*) FROM public.cdci_medicines_search)::numeric / c_brands_per_shard)::integer;
        IF p_shard >= v_shards THEN
            RETURN NULL;
        END IF;
        IF p_shard = 0 THEN
            SELECT coalesce(jsonb_agg(jsonb_build_array(g.id, g.generic_name, coalesce(g.substance_ids, ARRAY[]::text[])) ORDER BY g.id COLLATE "C"), '[]'::jsonb)
              INTO v_rows
              FROM public.cdci_generics g;
        ELSE
            WITH gen AS (
                SELECT g.id, (row_number() OVER (ORDER BY g.id COLLATE "C") - 1)::integer AS pos
                  FROM public.cdci_generics g
            ), page AS (
                SELECT c.id, c.brand_name, c.dose_form
                  FROM public.cdci_medicines_search c
                 ORDER BY c.id COLLATE "C"
                OFFSET (p_shard - 1) * c_brands_per_shard
                 LIMIT c_brands_per_shard
            )
            SELECT coalesce(jsonb_agg(jsonb_build_array(p.id, p.brand_name, gen.pos, p.dose_form) ORDER BY p.id COLLATE "C"), '[]'::jsonb)
              INTO v_rows
              FROM page p
              LEFT JOIN public.cdci_brands b ON b.id = p.id
              LEFT JOIN gen ON gen.id = b.generic_id;
        END IF;
    END IF;

    RETURN jsonb_build_object('catalogue', p_catalogue, 'version', v_version, 'shard', p_shard, 'shards', v_shards, 'rows', v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.reference_shard(uuid, text, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reference_shard(uuid, text, integer) TO authenticated;
COMMENT ON FUNCTION public.reference_shard(uuid, text, integer) IS
    'V2-09e 09E-09 (R-5): one shard of a global reference catalogue for the device. STABLE INVOKER; substances and diagnoses need consultations:view, medicines prescriptions:edit in p_tenant_id; NULL otherwise and for an unknown catalogue or a shard out of range. {catalogue, version, shard, shards, rows}: version and rows from one snapshot; rows are arrays ordered by id (substances [id, name]; diagnoses [id, name, icd11, snomed, chronic, specialties, synonyms]; medicines shard 0 generics [id, name, substance_ids], shards 1..n brands [id, brand_name, generic_row, dose_form], 12,000 per shard). Catalogue rows only, no PHI.';

-- 4. The searches: the name tie-break only (R-6) -------------------------------------------------------------------------------------------------
-- search_substances (latest body: 000118)
CREATE OR REPLACE FUNCTION public.search_substances(p_tenant_id uuid, p_query text, p_limit integer DEFAULT 12)
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
              lower(s.substance_name) COLLATE "C", s.id
     LIMIT v_limit;
END;
$$;

-- search_diagnoses (latest body: 000114; pg_trgm's schema looked up as there)
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
CREATE OR REPLACE FUNCTION public.search_diagnoses(
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
     ORDER BY m.grp, m.uses DESC, m.rank, lower(m.name) COLLATE "C"
     LIMIT v_limit;
END;
$body$;
$fn$;
    EXECUTE replace(v_sql, '__TRGM__', quote_ident(v_schema));
END;
$migration$;

-- search_medicines (latest body: 000117)
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
CREATE OR REPLACE FUNCTION public.search_medicines(
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
     ORDER BY m.grp, m.uses DESC, m.rank, lower(m.medicine_name) COLLATE "C", m.id
     LIMIT $5
    $q$ USING v_pat, v_term, p_tenant_id, v_uid, v_limit;
END;
$body$;
$fn$;
    EXECUTE replace(v_sql, '__TRGM__', quote_ident(v_schema));
END;
$migration$;
