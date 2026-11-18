-- IR2-Info (plan 01-09; pgTAP since V2-05 05-01a): proves that search_medicines works when pg_trgm lives in the
-- `extensions` schema (the Supabase dashboard default) and not only in `public` (where 000007 puts it on a fresh local
-- database).
--
-- Run by `npm run test:pgtap` (supabase test db --local supabase/tests/database), local stack only. Everything runs
-- inside one transaction that is rolled back: the database is left exactly as it was.
--
-- Steps:
--   1. Move pg_trgm to `extensions` (if it is not there already).
--   2. Control: a function that still names the old schema fails (undefined_function), so the check below is able to
--      detect a wrong resolution. Not applicable (recorded as a passing "not applicable" test, never a SKIP) when
--      pg_trgm already lived in `extensions`; on the local and CI stacks it lives in `public`.
--   3. Re-run migration 000021's search_medicines section, whose DO block resolves pg_trgm's schema and re-creates
--      search_medicines.
--   4. Call search_medicines with a misspelt query that only trigram similarity() can match, and assert rows return.
--
-- The legacy psql script re-ran the whole migration with `\ir ../migrations/000021_review_fixes.sql`; pg_prove runs in
-- a container where supabase/migrations is not mounted (research A7), so the section this test exercises (000021 §6) is
-- inlined between the `verbatim` markers below. It must stay byte-identical to the migration
-- (tests/ci/pgtap-legacy-inline.spec.ts); 000021 itself is immutable (scripts/ci/migration-immutability.mjs).
begin;
select plan(6);

-- service_role path of the function's authorisation check (auth.role() reads the request JWT claims).
set local "request.jwt.claims" to '{"role":"service_role"}';
set local "request.jwt.claim.role" to 'service_role';

create temp table _trgm_origin on commit drop as
select n.nspname as schema_name
from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid = e.extnamespace
where e.extname = 'pg_trgm';

-- A synthetic catalogue row (rolled back with everything else), so the check does not depend on seed data. The probe
-- 'Synthozamm' (misspelt) matches it only through trigram similarity(): not by ILIKE and not by the prefix tsquery.
insert into public.cdci_medicines_search (id, brand_name, generic_name, dose_form)
values ('ir2-info-synthetic-1', 'Synthozam 250', 'Synthetic Compound 250 mg', 'Tablet');

-- 1. pg_trgm is installed.
select isnt((select schema_name::text from _trgm_origin), null, 'pg_trgm is installed');

-- 2. Precondition: the query must reach similarity() (no ILIKE / prefix tsquery match).
select is(
  (select count(*)::int from public.cdci_medicines_search c
    where c.brand_name ilike '%Synthozamm%' or coalesce(c.generic_name, '') ilike '%Synthozamm%'
       or c.search_vector @@ to_tsquery('simple', 'Synthozamm:*')),
  0,
  'precondition: the probe matches only through similarity()'
);

-- Step 1: move the extension.
do $move$
begin
    if (select schema_name from _trgm_origin) <> 'extensions' then
        execute 'alter extension pg_trgm set schema extensions';
    end if;
end;
$move$;

-- 3. Control: the function as currently compiled names the old schema and must now fail.
select case
  when (select schema_name from _trgm_origin) = 'extensions'
    then pass('control not applicable: pg_trgm already lived in extensions')
  else throws_ok(
    $$ select * from public.search_medicines('Synthozamm', gen_random_uuid(), gen_random_uuid(), 5) $$,
    '42883',
    null,
    'control: the stale function fails once pg_trgm moved (undefined_function)'
  )
end;

-- Step 3: re-run 000021 §6 (idempotent; rolled back at the end).
-- >>> verbatim 000021_review_fixes.sql §6 (lines 667-794)
-- 6. search_medicines: pg_trgm in any schema ------------------------------------------------------------------------
-- Supabase projects may have pg_trgm in `extensions` (dashboard default) or `public` (000007 on a fresh database).
-- The schema is resolved now and written into the function as a quoted identifier, so search_path stays '' and no
-- unqualified name is resolved at call time. If the extension is later moved (ALTER EXTENSION ... SET SCHEMA),
-- re-create the function the same way.
DO $migration$
DECLARE
    v_schema TEXT;
    v_sql TEXT;
BEGIN
    SELECT n.nspname INTO v_schema
    FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm';

    IF v_schema IS NULL THEN
        RAISE EXCEPTION 'search_medicines requires the pg_trgm extension';
    END IF;

    v_sql := $fn$
CREATE OR REPLACE FUNCTION public.search_medicines(
    p_query TEXT,
    p_doctor_id UUID,
    p_tenant_id UUID,
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    id TEXT,
    medicine_name TEXT,
    generic_name TEXT,
    dose_form TEXT,
    default_dosage TEXT,
    default_timing TEXT,
    default_duration TEXT,
    is_custom BOOLEAN,
    is_favorite BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $body$
DECLARE
    v_clean_query TEXT := trim(COALESCE(p_query, ''));
BEGIN
    IF NOT (
        (SELECT auth.role()) = 'service_role'
        OR (
            p_tenant_id IN (SELECT public.current_user_tenant_ids())
            AND p_doctor_id = auth.uid()
        )
    ) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    WITH custom_matches AS (
        SELECT
            cm.id::TEXT AS id,
            cm.medicine_name,
            cm.generic_name,
            cm.dose_form,
            cm.default_dosage,
            cm.default_timing,
            cm.default_duration,
            true AS is_custom,
            true AS is_favorite,
            cm.use_count
        FROM public.doctor_custom_medicines cm
        WHERE cm.tenant_id = p_tenant_id
          AND cm.doctor_id = p_doctor_id
          AND (
              v_clean_query = ''
              OR cm.medicine_name ILIKE '%' || v_clean_query || '%'
              OR COALESCE(cm.generic_name, '') ILIKE '%' || v_clean_query || '%'
          )
    ),
    cdci_matches AS (
        SELECT
            c.id,
            c.brand_name AS medicine_name,
            c.generic_name,
            c.dose_form,
            NULL::TEXT AS default_dosage,
            'After food'::TEXT AS default_timing,
            '5 days'::TEXT AS default_duration,
            false AS is_custom,
            false AS is_favorite,
            0 AS use_count
        FROM public.cdci_medicines_search c
        WHERE (
            v_clean_query = ''
            OR c.brand_name ILIKE '%' || v_clean_query || '%'
            OR COALESCE(c.generic_name, '') ILIKE '%' || v_clean_query || '%'
            OR c.search_vector @@ to_tsquery('simple', replace(v_clean_query, ' ', ' & ') || ':*')
            OR @TRGM@.similarity(c.brand_name, v_clean_query) > 0.2
            OR (c.generic_name IS NOT NULL AND @TRGM@.similarity(c.generic_name, v_clean_query) > 0.2)
        )
        AND NOT EXISTS (
            SELECT 1 FROM custom_matches cm2 WHERE lower(cm2.medicine_name) = lower(c.brand_name)
        )
    )
    SELECT
        q.id,
        q.medicine_name,
        q.generic_name,
        q.dose_form,
        q.default_dosage,
        q.default_timing,
        q.default_duration,
        q.is_custom,
        q.is_favorite
    FROM (
        SELECT * FROM custom_matches
        UNION ALL
        SELECT * FROM cdci_matches
    ) q
    ORDER BY q.is_favorite DESC, q.use_count DESC, q.medicine_name ASC
    LIMIT p_limit;
END;
$body$;
$fn$;

    EXECUTE replace(v_sql, '@TRGM@', pg_catalog.quote_ident(v_schema));
END;
$migration$;

REVOKE EXECUTE ON FUNCTION public.search_medicines(TEXT, UUID, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_medicines(TEXT, UUID, UUID, INTEGER) TO authenticated, service_role;
-- <<< verbatim

-- 4-6. Assertions.
select ok(
  (select p.prosrc ~ 'extensions\.similarity' from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'search_medicines'),
  'search_medicines calls extensions.similarity after re-resolution'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'search_medicines' and p.proconfig @> array['search_path=""']
  ),
  'search_medicines keeps search_path = '''''
);
select ok(
  (select count(*) from public.search_medicines('Synthozamm', gen_random_uuid(), gen_random_uuid(), 5) s
    where s.id = 'ir2-info-synthetic-1') > 0,
  'search_medicines returns the trigram-only match with pg_trgm in extensions'
);

select * from finish();
rollback;
