-- IR2-Info (plan 01-09): proves that search_medicines works when pg_trgm lives in the `extensions` schema (the
-- Supabase dashboard default) and not only in `public` (where 000007 puts it on a fresh local database).
--
-- Run against the LOCAL stack only, from the repository root:
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/search_medicines_extension_schema.sql
-- Everything runs inside one transaction that is rolled back: the database is left exactly as it was.
-- Prints "PASS: ..." on success; any failed assertion raises an exception (and psql exits non-zero).
--
-- Steps:
--   1. Move pg_trgm to `extensions` (if it is not there already).
--   2. Control: a function that still names the old schema fails (undefined_function), so the check below is able to
--      detect a wrong resolution. Skipped when pg_trgm already lived in `extensions`.
--   3. Re-run migration 000021, whose DO block resolves pg_trgm's schema and re-creates search_medicines.
--   4. Call search_medicines with a misspelt query that only trigram similarity() can match, and assert rows return.
\set ON_ERROR_STOP on

BEGIN;

-- service_role path of the function's authorisation check (auth.role() reads the request JWT claims).
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE TEMP TABLE _trgm_origin ON COMMIT DROP AS
SELECT n.nspname AS schema_name
FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'pg_trgm';

-- A synthetic catalogue row (rolled back with everything else), so the check does not depend on seed data. The probe
-- 'Synthozamm' (misspelt) matches it only through trigram similarity(): not by ILIKE and not by the prefix tsquery.
INSERT INTO public.cdci_medicines_search (id, brand_name, generic_name, dose_form)
VALUES ('ir2-info-synthetic-1', 'Synthozam 250', 'Synthetic Compound 250 mg', 'Tablet');

DO $check$
DECLARE
    v_rows INTEGER;
BEGIN
    IF (SELECT schema_name FROM _trgm_origin) IS NULL THEN
        RAISE EXCEPTION 'FAIL: pg_trgm is not installed';
    END IF;
    -- Precondition: the query must reach similarity() (no ILIKE / prefix tsquery match).
    SELECT count(*) INTO v_rows FROM public.cdci_medicines_search c
    WHERE c.brand_name ILIKE '%Synthozamm%' OR COALESCE(c.generic_name, '') ILIKE '%Synthozamm%'
       OR c.search_vector @@ to_tsquery('simple', 'Synthozamm:*');
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'FAIL: precondition: the probe matches without similarity(), so it would not be exercised';
    END IF;
END;
$check$;

-- 1. Move the extension.
DO $move$
BEGIN
    IF (SELECT schema_name FROM _trgm_origin) <> 'extensions' THEN
        EXECUTE 'ALTER EXTENSION pg_trgm SET SCHEMA extensions';
    END IF;
END;
$move$;

-- 2. Control: the function as currently compiled names the old schema and must now fail.
DO $control$
BEGIN
    IF (SELECT schema_name FROM _trgm_origin) = 'extensions' THEN
        RAISE NOTICE 'control skipped: pg_trgm already lived in extensions';
        RETURN;
    END IF;
    BEGIN
        PERFORM * FROM public.search_medicines('Synthozamm', gen_random_uuid(), gen_random_uuid(), 5);
        RAISE EXCEPTION 'FAIL: control: the stale function still ran after pg_trgm moved (check is not discriminating)';
    EXCEPTION WHEN undefined_function THEN
        RAISE NOTICE 'control ok: the stale function fails once pg_trgm moved (undefined_function)';
    END;
END;
$control$;

-- 3. Re-run 000021 (idempotent). Function bodies of other objects in it are not checked against today's schema
--    (later migrations replaced them); everything is rolled back at the end.
SET LOCAL check_function_bodies = off;
\ir ../migrations/000021_review_fixes.sql
SET LOCAL check_function_bodies = on;

-- 4. Assertions.
DO $assert$
DECLARE
    v_rows INTEGER;
    v_src TEXT;
BEGIN
    SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'search_medicines';
    IF v_src !~ 'extensions\.similarity' THEN
        RAISE EXCEPTION 'FAIL: search_medicines does not call extensions.similarity after re-resolution';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'search_medicines' AND p.proconfig @> ARRAY['search_path=""']
    ) THEN
        RAISE EXCEPTION 'FAIL: search_medicines lost search_path=''''';
    END IF;

    SELECT count(*) INTO v_rows
    FROM public.search_medicines('Synthozamm', gen_random_uuid(), gen_random_uuid(), 5) s
    WHERE s.id = 'ir2-info-synthetic-1';
    IF v_rows = 0 THEN
        RAISE EXCEPTION 'FAIL: search_medicines returned no trigram match with pg_trgm in extensions';
    END IF;

    RAISE NOTICE 'PASS: search_medicines resolves pg_trgm in schema "extensions" (the synthetic row matched a misspelt query only through similarity()); transaction rolled back';
END;
$assert$;

ROLLBACK;
