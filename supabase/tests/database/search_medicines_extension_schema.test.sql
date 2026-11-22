-- IR2-Info (plan 01-09; pgTAP since V2-05 05-01a; re-pointed to the new function by V2-09c 000117): proves that search_medicines works when pg_trgm lives
-- in the `extensions` schema (the Supabase dashboard default) and not only in `public` (where 000007 puts it on a fresh local database).
--
-- Run by `npm run test:pgtap` (supabase test db --local supabase/tests/database), local stack only. Everything runs
-- inside one transaction that is rolled back: the database is left exactly as it was.
--
-- V2-09c 000117 replaced the 4-argument DEFINER function (000021 section 6, 000061) with the INVOKER `public.search_medicines(uuid, text, integer)`, whose
-- DO block resolves the schema of pg_trgm the same way. The steps are the same, run as a clinic's owner (the function reads nothing without a session and
-- prescriptions:edit):
--   1. Move pg_trgm to `extensions` (if it is not there already).
--   2. Control: the function as compiled names the old schema and fails (undefined_function) when it reaches similarity(). Not applicable (recorded as a
--      passing "not applicable" test, never a SKIP) when pg_trgm already lived in `extensions`; on the local and CI stacks it lives in `public`.
--   3. Drop the function and re-run migration 000117 section 2's DO block, which re-creates it against the current schema.
--   4. Call search_medicines with a misspelt query that only trigram similarity() can match, and assert rows return.
--
-- pg_prove runs in a container where supabase/migrations is not mounted (research A7), so the block this test exercises is inlined between the `verbatim`
-- markers below. It must stay byte-identical to the migration (tests/ci/pgtap-legacy-inline.spec.ts); an applied migration is immutable.
begin;
select plan(6);

-- A clinic with an owner: the search reads for a session with prescriptions:edit in the active clinic.
insert into auth.users (id, email) values ('c1170000-0000-4000-8000-0000000000e1', 'c117-ext-owner@example.test');
insert into public.tenants (id, name) values ('c1170000-0000-4000-8000-0000000000e2', 'Synthetic Extension Clinic');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id = 'c1170000-0000-4000-8000-0000000000e2';
insert into public.memberships (user_id, tenant_id, role) values ('c1170000-0000-4000-8000-0000000000e1', 'c1170000-0000-4000-8000-0000000000e2', 'owner');
set local "request.jwt.claims" to '{"sub":"c1170000-0000-4000-8000-0000000000e1","role":"authenticated"}';
set local "request.headers" to '{"x-clinicos-tenant":"c1170000-0000-4000-8000-0000000000e2"}';

create temp table _trgm_origin on commit drop as
select n.nspname as schema_name
from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid = e.extnamespace
where e.extname = 'pg_trgm';

-- A synthetic catalogue row (rolled back with everything else), so the check does not depend on seed data. The probe 'Synthozamm' (misspelt) matches it only
-- through trigram similarity(): not by ILIKE and not by the prefix tsquery.
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
    $$ select * from public.search_medicines('c1170000-0000-4000-8000-0000000000e2', 'Synthozamm', 5) $$,
    '42883',
    null,
    'control: the stale function fails once pg_trgm moved (undefined_function)'
  )
end;

-- Step 3: drop the function and re-run 000117 section 2's DO block (rolled back at the end).
drop function public.search_medicines(uuid, text, integer);
-- >>> verbatim 000117_rx_lines_command.sql §2 (lines 55-168)
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
-- <<< verbatim
grant execute on function public.search_medicines(uuid, text, integer) to authenticated;

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
  (select count(*) from public.search_medicines('c1170000-0000-4000-8000-0000000000e2', 'Synthozamm', 5) s
    where s.id = 'ir2-info-synthetic-1') > 0,
  'search_medicines returns the trigram-only match with pg_trgm in extensions'
);

select * from finish();
rollback;
