-- rum_daily.test.sql — V2-09e 09E-02 (R-20, decision 10; T-09E-14, T-09E-15; migration 000122).
-- Real-user monitoring storage: histograms of timings in ops.rum_daily, written only by public.ops_ingest_rum.
--   1. objects and grants: RLS on, no API role reads or writes `ops`, the ingest function is a pinned definer function executable by
--      `authenticated` alone, the report and the cleanup by nobody;
--   2. ingest: valid samples add up (+1 per sample, bucket from fixed log-spaced bounds, CLS and count metrics on their own scale);
--   3. every malformed shape is refused and writes no row: an unknown or missing key, a value outside a closed list (a uuid as the
--      screen included: the High finding), a non-numeric or out-of-range value, more than 60 samples, no session;
--   4. the daily total cap sends the rest to the overflow counter;
--   5. rum_report: p50/p75/p95 as bucket upper bounds on a synthetic histogram, only the requested days;
--   6. ops.cleanup() deletes rum rows older than 90 days and keeps the newer ones.
-- Synthetic data only; the file rolls back.
begin;
select plan(63);

-- 09E-14a (000127): the ingest answers an active member only; the caller below is the owner of a synthetic clinic.
insert into auth.users (id, email) values ('c1220000-0000-4000-8000-000000000001', 'c122-member@example.test');
insert into public.tenants (id, name) values ('c1220000-0000-4000-8000-00000000000a', 'Synthetic 000122 Clinic');
insert into public.memberships (user_id, tenant_id, role) values ('c1220000-0000-4000-8000-000000000001', 'c1220000-0000-4000-8000-00000000000a', 'owner');

-- Nothing the local stack already holds may colour the counts below (the transaction rolls back).
delete from ops.rum_daily;
delete from ops.rum_overflow;

-- Calls the ingest as `authenticated` (a signed-in user with no clinic: the function stores no tenant or user) or as the given role.
create function pg_temp.ingest(p_samples jsonb, p_env text default 'test', p_release text default 'abcdef1', p_signed_in boolean default true)
returns text language plpgsql as $f$
declare
  v_out text := 'ok';
begin
  if p_signed_in then
    perform set_config('request.jwt.claims', json_build_object('sub', 'c1220000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  else
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  end if;
  begin
    set local role authenticated;
    perform public.ops_ingest_rum(p_env, p_release, p_samples);
    reset role;
  exception when others then
    reset role; v_out := sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$f$;

create function pg_temp.sample(p_screen text, p_metric text, p_value numeric, p_device text default 'desktop', p_net text default '4g')
returns jsonb language sql as $f$
  select jsonb_build_object('screen', p_screen, 'metric', p_metric, 'device', p_device, 'net', p_net, 'value', p_value);
$f$;

-- 1. Objects and grants -------------------------------------------------------------------------------------------------
select is(
  (select string_agg(c.relname || ':' || c.relrowsecurity::text, ',' order by c.relname) from pg_class c
    where c.relnamespace = 'ops'::regnamespace and c.relname in ('rum_daily', 'rum_overflow')),
  'rum_daily:true,rum_overflow:true', 'RLS is on for both tables');
select is(
  (select count(*)::int from pg_policy where polrelid in ('ops.rum_daily'::regclass, 'ops.rum_overflow'::regclass)),
  0, 'no policy on either table (nothing but the definer function can reach them)');
select is(
  (select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r,
          unnest(array['ops.rum_daily', 'ops.rum_overflow']) t
    where has_table_privilege(r, t, 'SELECT,INSERT,UPDATE,DELETE')),
  0, 'no API role holds any privilege on the tables');
select is(
  (select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r where has_schema_privilege(r, 'ops', 'USAGE')),
  0, 'no API role has USAGE on schema ops');
select is(
  (select p.prosecdef::text || ':' || array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'public.ops_ingest_rum(text, text, jsonb)'::regprocedure),
  'true:search_path=""', 'ops_ingest_rum is a definer function with search_path pinned to the empty string');
select is(
  (select string_agg(a.grantee::regrole::text, ',' order by a.grantee::regrole::text)
     from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.oid = 'public.ops_ingest_rum(text, text, jsonb)'::regprocedure and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner),
  'authenticated', 'EXECUTE on ops_ingest_rum: authenticated only');
select is(
  (select count(*)::int from unnest(array['ops.rum_report(integer)', 'ops.cleanup()', 'ops.rum_daily_cap()', 'ops.rum_bucket(text, numeric)']) f,
          unnest(array['anon', 'authenticated', 'service_role']) r
    where has_function_privilege(r, f::regprocedure, 'EXECUTE')),
  0, 'the report, the cleanup, the cap and the bucket function are executable by no API role');
select throws_ok(
  $$ set local role authenticated; select count(*) from ops.rum_daily $$,
  '42501', null, 'authenticated cannot read ops.rum_daily');
reset role;
select throws_ok(
  $$ set local role anon; select count(*) from ops.rum_daily $$,
  '42501', null, 'anon cannot read ops.rum_daily');
reset role;
select throws_ok(
  $$ set local role authenticated; insert into ops.rum_daily values (current_date, 'test', 'unknown', 'today', 'lcp', 'desktop', '4g', 1, 1) $$,
  '42501', null, 'authenticated cannot write ops.rum_daily directly');
reset role;
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('today', 'lcp', 100)), 'test', 'abcdef1', false), '42501', 'a call with no signed-in user is refused');
select throws_ok(
  $$ set local role anon; select public.ops_ingest_rum('test', 'abcdef1', '[]'::jsonb) $$,
  '42501', null, 'anon cannot execute ops_ingest_rum');
reset role;

-- 2. Ingest ------------------------------------------------------------------------------------------------------------
select is(pg_temp.ingest(jsonb_build_array(
    pg_temp.sample('today', 'lcp', 1800),
    pg_temp.sample('today', 'lcp', 1800),
    pg_temp.sample('today', 'lcp', 70000),
    pg_temp.sample('today', 'cls', 0.07),
    pg_temp.sample('schedule', 'live_dropped', 1, 'phone', '3g'))), 'ok', 'a valid batch is accepted');
select is((select sum(count)::int from ops.rum_daily), 5, 'one count per sample');
select is((select count from ops.rum_daily where metric = 'lcp' and bucket = 15), 2::bigint, 'two samples of 1800 ms share the 2000 ms bucket');
select is((select count(*)::int from ops.rum_daily where metric = 'lcp' and bucket = 21), 1, 'a value above the last bound goes to the open bucket');
select is((select bucket from ops.rum_daily where metric = 'cls'), 4::smallint, 'CLS 0.07 is in the 0.1 bucket (its own bounds)');
select is((select bucket from ops.rum_daily where metric = 'live_dropped'), 0::smallint, 'a count metric uses bucket 0');
select is(
  (select day::text || ':' || environment || ':' || release from ops.rum_daily where metric = 'cls'),
  ((now() at time zone 'utc')::date)::text || ':test:abcdef1', 'the row carries the UTC day, the environment and the release, nothing else');
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('today', 'lcp', 1800)), 'test', null), 'ok', 'a missing release is stored as unknown');
select is((select count from ops.rum_daily where release = 'unknown'), 1::bigint, 'the unknown release row exists');
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('today', 'lcp', 1900))), 'ok', 'a second batch is accepted');
select is((select count from ops.rum_daily where metric = 'lcp' and bucket = 15 and release = 'abcdef1'), 3::bigint, 'counts add up across batches');
select is(pg_temp.ingest('[]'::jsonb), 'ok', 'an empty batch is accepted and writes nothing');
select is(
  (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a where a.attrelid = 'ops.rum_daily'::regclass and a.attnum > 0 and not a.attisdropped),
  'day,environment,release,screen,metric,device,net,bucket,count', 'the table has no tenant, user, URL, id, text or time-of-day column');

-- 3. Refusals: no row is written ---------------------------------------------------------------------------------------
create temp table before_refusals as select coalesce(sum(count), 0)::bigint as n, count(*)::int as rows from ops.rum_daily;
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('today', 'lcp', 100) || '{"url": "/patients"}')), '22023', 'an unknown key is refused');
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('today', 'lcp', 100) - 'net')), '22023', 'a missing key is refused');
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('11111111-2222-4333-8444-555555555555', 'lcp', 100))), '22023', 'a uuid as the screen is refused');
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('/patients/abc', 'lcp', 100))), '22023', 'a path as the screen is refused');
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('today', 'page_load', 100))), '22023', 'an unknown metric is refused');
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('today', 'lcp', 100, 'watch'))), '22023', 'an unknown device is refused');
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('today', 'lcp', 100, 'desktop', '5g'))), '22023', 'an unknown network class is refused');
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('today', 'lcp', 100) || '{"value": "100"}')), '22023', 'a string value is refused');
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('today', 'lcp', 100) || '{"value": null}')), '22023', 'a null value is refused');
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('today', 'lcp', -1))), '22023', 'a negative value is refused');
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('today', 'lcp', 600001))), '22023', 'a timing above ten minutes is refused');
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('today', 'cls', 101))), '22023', 'a CLS above 100 is refused');
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('today', 'live_dropped', 1001))), '22023', 'a count above 1000 is refused');
select is(pg_temp.ingest(jsonb_build_array('"today"'::jsonb)), '22023', 'a sample that is not an object is refused');
select is(pg_temp.ingest('{"screen": "today"}'::jsonb), '22023', 'a batch that is not an array is refused');
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('today', 'lcp', 100)), 'laptop'), '22023', 'an unknown environment is refused');
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('today', 'lcp', 100)), 'test', '../../etc'), '22023', 'a release that is not a commit hash is refused');
select is(pg_temp.ingest((select jsonb_agg(pg_temp.sample('today', 'lcp', 100)) from generate_series(1, 61))), '22023', 'more than 60 samples are refused');
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('today', 'lcp', 100), pg_temp.sample('nowhere', 'lcp', 100))), '22023', 'one bad sample refuses the whole batch');
select is((select n from before_refusals), (select coalesce(sum(count), 0)::bigint from ops.rum_daily), 'no refused call wrote a count');
select is((select rows from before_refusals), (select count(*)::int from ops.rum_daily), 'no refused call wrote a row');
select is((select count(*)::int from ops.rum_daily where screen !~ '^[a-z]+$'), 0, 'every stored screen is a closed-list word');
select is(pg_temp.ingest((select jsonb_agg(pg_temp.sample('today', 'lcp', 100)) from generate_series(1, 60))), 'ok', 'exactly 60 samples are accepted');

-- 4. Daily cap -----------------------------------------------------------------------------------------------------------
delete from ops.rum_daily;
create or replace function ops.rum_daily_cap() returns bigint language sql immutable set search_path = '' as $f$ select 5::bigint $f$;
select is(pg_temp.ingest((select jsonb_agg(pg_temp.sample('today', 'lcp', 100)) from generate_series(1, 4))), 'ok', 'four samples fit under a cap of five');
select is(pg_temp.ingest((select jsonb_agg(pg_temp.sample('today', 'lcp', 100)) from generate_series(1, 3))), 'ok', 'a batch that crosses the cap is accepted');
select is((select sum(count)::int from ops.rum_daily), 5, 'only up to the cap is stored');
select is((select dropped from ops.rum_overflow where day = (now() at time zone 'utc')::date), 2::bigint, 'the samples past the cap are counted as dropped');
select is(pg_temp.ingest(jsonb_build_array(pg_temp.sample('today', 'lcp', 100), pg_temp.sample('today', 'lcp', 100))), 'ok', 'a batch after the cap is accepted');
select is((select sum(count)::int from ops.rum_daily), 5, 'nothing more is stored after the cap');
select is((select dropped from ops.rum_overflow where day = (now() at time zone 'utc')::date), 4::bigint, 'the overflow counter keeps adding');

-- 5. Report -------------------------------------------------------------------------------------------------------------
delete from ops.rum_daily;
delete from ops.rum_overflow;
insert into ops.rum_daily (day, environment, release, screen, metric, device, net, bucket, count) values
  ((now() at time zone 'utc')::date, 'test', 'unknown', 'today', 'lcp', 'desktop', '4g', 5, 50),
  ((now() at time zone 'utc')::date, 'test', 'unknown', 'today', 'lcp', 'desktop', '4g', 9, 25),
  ((now() at time zone 'utc')::date - 1, 'test', 'unknown', 'today', 'lcp', 'desktop', '3g', 13, 15),
  ((now() at time zone 'utc')::date - 2, 'test', 'unknown', 'today', 'lcp', 'desktop', '4g', 15, 10),
  ((now() at time zone 'utc')::date - 20, 'test', 'unknown', 'today', 'lcp', 'desktop', '4g', 21, 500),
  ((now() at time zone 'utc')::date, 'test', 'unknown', 'patients', 'inp', 'phone', '4g', 21, 4),
  ((now() at time zone 'utc')::date, 'test', 'unknown', 'schedule', 'live_dropped', 'phone', '4g', 0, 7);
select results_eq(
  $$ select samples, p50, p75, p95 from ops.rum_report(7) where screen = 'today' and metric = 'lcp' and device = 'desktop' $$,
  $$ values (100::bigint, 75::numeric, 300::numeric, 2000::numeric) $$,
  'p50, p75 and p95 are the upper bounds of the buckets holding those ranks (net classes and days in the window added up)');
select is((select p50 from ops.rum_report(7) where screen = 'patients' and metric = 'inp'), 'Infinity'::numeric, 'a rank in the open bucket reports Infinity');
select results_eq(
  $$ select samples, p50 from ops.rum_report(7) where metric = 'live_dropped' $$,
  $$ values (7::bigint, null::numeric) $$,
  'a count metric reports its samples and no percentile');
select is((select samples from ops.rum_report(30) where screen = 'today' and metric = 'lcp'), 600::bigint, 'a longer window adds the older day');
select is((select count(*)::int from ops.rum_report(7) where screen = 'today' and metric = 'lcp'), 1, 'one row per environment, screen, metric and device');

-- 6. Retention ----------------------------------------------------------------------------------------------------------
delete from ops.rum_daily;
insert into ops.rum_daily (day, environment, release, screen, metric, device, net, bucket, count) values
  ((now() at time zone 'utc')::date - 91, 'test', 'unknown', 'today', 'lcp', 'desktop', '4g', 5, 1),
  ((now() at time zone 'utc')::date - 89, 'test', 'unknown', 'today', 'lcp', 'desktop', '4g', 5, 1);
insert into ops.rum_overflow (day, dropped) values ((now() at time zone 'utc')::date - 91, 3), ((now() at time zone 'utc')::date - 89, 3);
select is((ops.cleanup() ->> 'rum_daily')::int, 1, 'cleanup reports one rum_daily row deleted');
select is((select count(*)::int from ops.rum_daily), 1, 'only the row older than 90 days is gone');
select is((select count(*)::int from ops.rum_overflow), 1, 'the same for the overflow counter');

select * from finish();
rollback;
