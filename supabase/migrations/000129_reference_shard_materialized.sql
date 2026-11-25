-- Migration: 000129_reference_shard_materialized.sql
-- V2-09e H-1 (found in 09E-11): public.reference_shard (000128) times out on the late brand shards at the full CDCI size (93,911 brands).
-- The planner estimates the OFFSET/LIMIT page at one row (with fresh statistics, a parallel-scan estimate below the offset; with stale ones, the old
-- table size) and joins it to cdci_brands and the generics window by nested loop (a scan of all generics per brand): shard 8 answered 500 after 8.3 s
-- (the API role's statement timeout) in the lane, and OFFSET 84000 ran over 30 s in psql. Materializing both CTEs (the first idea) fixes the fresh-statistics
-- case only: with statistics taken before a reload (30 generics, 319 brands) the materialized generics CTE is still scanned once per brand (> 15 s).
--
-- The ONLY change, in the brand-shard branch: no join whose cost depends on the estimates. The generics' 0-based positions (same order, id COLLATE "C") are
-- read once into a jsonb map (v_generic_pos, one pass); the page is `AS MATERIALIZED` (computed once); only its 12,000 rows meet cdci_brands (by primary key
-- or hashed) and look their generic's position up in the map. Same answer: generic_row is the position, or JSON null when the brand has no generic.
-- Everything else is the 000128 body unchanged (signature, STABLE INVOKER, search_path '', the permission per catalogue, every NULL case, the answer's
-- keys and row shapes, the 12,000 brands a shard). Measured on 93,911 synthetic brands (psql, rolled back): about 0.2 s per brand shard with fresh, stale
-- or no statistics.
-- CREATE OR REPLACE keeps the grants; they and the comment are restated (R-17). 000128 is not edited.
-- Per-migration checklist: one public INVOKER read replaced with the same signature, grants (EXECUTE authenticated only) and output. No table, policy
-- or grant change. Expand-safe: the running app's calls and the answer are unchanged.

CREATE OR REPLACE FUNCTION public.reference_shard(p_tenant_id uuid, p_catalogue text, p_shard integer)
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
    v_generic_pos jsonb;
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
            -- H-1: no join whose cost depends on the row estimates. The generics' positions are read once into a jsonb map (one pass, a lookup per brand);
            -- the page is materialized, so it is computed once and only its 12,000 rows meet cdci_brands (by primary key, or hashed).
            SELECT jsonb_object_agg(g.id, g.pos)
              INTO v_generic_pos
              FROM (SELECT gg.id, (row_number() OVER (ORDER BY gg.id COLLATE "C") - 1)::integer AS pos FROM public.cdci_generics gg) g;
            WITH page AS MATERIALIZED (
                SELECT c.id, c.brand_name, c.dose_form
                  FROM public.cdci_medicines_search c
                 ORDER BY c.id COLLATE "C"
                OFFSET (p_shard - 1) * c_brands_per_shard
                 LIMIT c_brands_per_shard
            )
            SELECT coalesce(jsonb_agg(jsonb_build_array(p.id, p.brand_name, v_generic_pos -> b.generic_id, p.dose_form) ORDER BY p.id COLLATE "C"), '[]'::jsonb)
              INTO v_rows
              FROM page p
              LEFT JOIN public.cdci_brands b ON b.id = p.id;
        END IF;
    END IF;

    RETURN jsonb_build_object('catalogue', p_catalogue, 'version', v_version, 'shard', p_shard, 'shards', v_shards, 'rows', v_rows);
END;
$$;
REVOKE ALL ON FUNCTION public.reference_shard(uuid, text, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reference_shard(uuid, text, integer) TO authenticated;
COMMENT ON FUNCTION public.reference_shard(uuid, text, integer) IS
    'V2-09e 09E-09 (R-5), H-1 (000129: brand shards without an estimate-dependent join): one shard of a global reference catalogue for the device. STABLE INVOKER; substances and diagnoses need consultations:view, medicines prescriptions:edit in p_tenant_id; NULL otherwise and for an unknown catalogue or a shard out of range. {catalogue, version, shard, shards, rows}: version and rows from one snapshot; rows are arrays ordered by id (substances [id, name]; diagnoses [id, name, icd11, snomed, chronic, specialties, synonyms]; medicines shard 0 generics [id, name, substance_ids], shards 1..n brands [id, brand_name, generic_row, dose_form], 12,000 per shard). Catalogue rows only, no PHI.';
