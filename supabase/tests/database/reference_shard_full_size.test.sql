-- reference_shard_full_size.test.sql — V2-09e H-1 (migration 000129; threat: the device's medicine download fails at the real catalogue size and every
-- app start costs the database one statement-timeout-long query).
--   At the full CDCI size (93,911 synthetic brands, 10,305 synthetic generics), as a doctor of a full clinic under a 5 s statement timeout:
--   1. the last brand shard answers with STALE planner statistics (taken when the tables held 300 brands and 30 generics, as right after a reload
--      before autovacuum runs) and again with FRESH ones (ANALYZE after the load); 000128 picks a nested loop in both and is canceled by the
--      timeout ('error:57014'); shard 7 and every other shard answer too;
--   2. the shard count, the rows of the last shard, every synthetic brand exactly once across shards 1..8, the last id in the last shard,
--      and the generic_row of a late brand pointing at its generic in shard 0;
--   3. the function is still STABLE INVOKER with search_path '' and EXECUTE for authenticated only.
-- The 5 s timeout is armed per top-level statement (one statement per shard). The late shards are read first: PL/pgSQL plans the first five calls with
-- the real OFFSET (later it may switch to a generic plan that hides the problem). 000129 answers a brand shard in about 0.2 s on this VM, so the bound is
-- 25x the measured time, not a tight timing.
-- Every read runs under the real principal. The file rolls back. Synthetic data only.
begin;
select plan(14);

insert into auth.users (id, email) values ('c1290000-0000-4000-8000-000000000102', 'c129-doctor-a@example.test');
insert into public.tenants (id, name) values ('c1290000-0000-4000-8000-00000000000a', 'Synthetic 000129 Clinic A');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id = 'c1290000-0000-4000-8000-00000000000a' and s.status = 'incomplete';
insert into public.memberships (user_id, tenant_id, role) values
  ('c1290000-0000-4000-8000-000000000102', 'c1290000-0000-4000-8000-00000000000a', 'doctor');

-- The full-size catalogue: the stack's own rows (if any) are removed inside this transaction so the sizes are exact.
delete from public.cdci_brands;
delete from public.cdci_medicines_search;
delete from public.cdci_generics;
create function pg_temp.load(p_from integer, p_to integer, p_gen_to integer) returns void language sql as $f$
  insert into public.cdci_generics (id, generic_name, substance_ids)
  select 'test-ref-129-g' || lpad(g::text, 6, '0'), 'Qzxfullgen ' || g, array[]::text[] from generate_series(1, p_gen_to) g on conflict (id) do nothing;
  insert into public.cdci_medicines_search (id, brand_name, dose_form)
  select 'test-ref-129-b' || lpad(g::text, 6, '0'), 'Qzxfullbrand ' || g, 'Tablet' from generate_series(p_from, p_to) g;
  insert into public.cdci_brands (id, brand_name, generic_id)
  select 'test-ref-129-b' || lpad(g::text, 6, '0'), 'Qzxfullbrand ' || g, 'test-ref-129-g' || lpad((1 + g % 10305)::text, 6, '0') from generate_series(p_from, p_to) g;
$f$;
-- Stale statistics: taken on a small catalogue (the first 300 brands, 30 generics), then the rest loaded.
select pg_temp.load(1, 300, 30);
analyze public.cdci_generics;
analyze public.cdci_medicines_search;
analyze public.cdci_brands;
select pg_temp.load(301, 93911, 10305);

create function pg_temp.shard(p_shard integer) returns text language plpgsql as $f$
declare v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c1290000-0000-4000-8000-000000000102', 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '', true);
  begin
    set local role authenticated;
    v_out := coalesce(public.reference_shard('c1290000-0000-4000-8000-00000000000a', 'medicines', p_shard)::text, 'NULL');
    reset role;
  exception when query_canceled or others then
    reset role;
    v_out := 'error:' || sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$f$;
create temp table shards (s integer primary key, body text) on commit drop;
set local statement_timeout = '5s';
insert into shards select -8, pg_temp.shard(8);
set local statement_timeout = 0;
-- Fresh statistics.
analyze public.cdci_generics;
analyze public.cdci_medicines_search;
analyze public.cdci_brands;
set local statement_timeout = '5s';
insert into shards select 8, pg_temp.shard(8);
insert into shards select 7, pg_temp.shard(7);
insert into shards select 0, pg_temp.shard(0);
insert into shards select 1, pg_temp.shard(1);
insert into shards select 2, pg_temp.shard(2);
insert into shards select 3, pg_temp.shard(3);
insert into shards select 4, pg_temp.shard(4);
insert into shards select 5, pg_temp.shard(5);
insert into shards select 6, pg_temp.shard(6);
set local statement_timeout = 0;
-- A timed-out shard keeps its 'error:' text; the shape checks below read j (NULL for it) and fail instead of aborting the file.
alter table shards add column j jsonb;
update shards set j = case when body like '{%' then body::jsonb end;

-- 1. They answer --------------------------------------------------------------------------------------------------------------------
select is((select left(body, 6) from shards where s = -8), '{"rows', 'stale statistics: the last brand shard (8) answers within 5 s at 93,911 brands (000128: canceled, error:57014)');
select is((select left(body, 6) from shards where s = 8), '{"rows', 'fresh statistics: the last brand shard (8) answers within 5 s at 93,911 brands (000128: canceled, error:57014)');
select is((select body from shards where s = -8), (select body from shards where s = 8), 'the same shard read under stale and fresh statistics is the same answer');
select is((select left(body, 6) from shards where s = 7), '{"rows', 'brand shard 7 answers within 5 s at 93,911 brands');
select is((select count(*)::int from shards where body like 'error:%' or body = 'NULL'), 0, 'every read answers (none timed out, none NULL)');

-- 2. The full-size shapes -----------------------------------------------------------------------------------------------------------
select is((select (j ->> 'shards')::int from shards where s = 0), 9, '93,911 brands: generics plus eight brand shards');
select is((select jsonb_array_length(j -> 'rows') from shards where s = 0), 10305, 'shard 0 holds the 10,305 generics');
select is((select jsonb_array_length(j -> 'rows') from shards where s = 8), 9911, 'the last shard holds the remaining 9,911 brands');
select is((select count(distinct e ->> 0)::int from shards cross join lateral jsonb_array_elements(j -> 'rows') e where s between 1 and 8), 93911,
  'every brand exactly once across shards 1..8 (distinct ids)');
select is((select count(*)::int from shards cross join lateral jsonb_array_elements(j -> 'rows') e where s between 1 and 8), 93911,
  'and no brand twice (all ids)');
select is((select j -> 'rows' -> -1 ->> 0 from shards where s = 8), 'test-ref-129-b093911', 'the last id is the last row of the last shard');
-- test-ref-129-b093911 -> generic 1 + 93911 % 10305 = 1167 (test-ref-129-g001167) -> 0-based position 1166 in shard 0.
select is((select (j -> 'rows' -> -1 ->> 2)::int from shards where s = 8), 1166, 'a late brand''s generic_row is its generic''s position in shard 0');

-- 3. Same function contract -----------------------------------------------------------------------------------------------------------
select is((select format('%s|%s|%s', p.provolatile, p.prosecdef, array_to_string(p.proconfig, ',')) from pg_proc p
            where p.oid = 'public.reference_shard(uuid, text, integer)'::regprocedure),
  's|f|search_path=""', 'reference_shard stays STABLE INVOKER with search_path ''''');
select is((select string_agg(grantee, ',' order by grantee) from information_schema.routine_privileges
            where routine_schema = 'public' and routine_name = 'reference_shard' and privilege_type = 'EXECUTE'
              and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
  'authenticated', 'EXECUTE on reference_shard for authenticated only');

select * from finish();
rollback;
