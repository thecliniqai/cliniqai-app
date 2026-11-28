-- command_versions.test.sql — V2-09e 09E PR 2, PO option A (migration 000134): a command's answer carries the clinic versions its own transaction produced.
--   1. check_in_visit answers versions {queue, schedule}: exactly the domains it raised, each one past the version before, equal to clinic_versions after;
--   2. only the clinic the command was authorised for: another clinic raised in the same transaction is not in the answer;
--   3. a replay of the same request id answers the stored result, versions included, and raises nothing;
--   4. a command that raised no domain answers versions {};
--   5. command_complete keeps its shape (definer, search_path '', lock_timeout 2s, no API grant).
-- A pgTAP file is one transaction: `pg_temp.fresh()` clears the once-per-transaction marker before each command (as clinic_versions.test.sql). Synthetic data only.
begin;
select plan(11);

insert into auth.users (id, email) values
  ('c1340000-0000-4000-8000-000000000101', 'c134-owner-a@example.test'),
  ('c1340000-0000-4000-8000-000000000105', 'c134-receptionist-a@example.test'),
  ('c1340000-0000-4000-8000-000000000201', 'c134-owner-b@example.test');
insert into public.tenants (id, name) values
  ('c1340000-0000-4000-8000-00000000000a', 'Synthetic 000134 Clinic A'),
  ('c1340000-0000-4000-8000-00000000000b', 'Synthetic 000134 Clinic B');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1340000-0000-4000-8000-00000000000a', 'c1340000-0000-4000-8000-00000000000b') and s.status = 'incomplete';
insert into public.memberships (user_id, tenant_id, role, full_name) values
  ('c1340000-0000-4000-8000-000000000101', 'c1340000-0000-4000-8000-00000000000a', 'owner', 'Synthetic Owner A'),
  ('c1340000-0000-4000-8000-000000000105', 'c1340000-0000-4000-8000-00000000000a', 'receptionist', null),
  ('c1340000-0000-4000-8000-000000000201', 'c1340000-0000-4000-8000-00000000000b', 'owner', 'Synthetic Owner B');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1340000-0000-4000-8000-000000001001', 'c1340000-0000-4000-8000-00000000000a', 'Synthetic Versions Patient A', '+919000013401', 'c1340000-0000-4000-8000-000000000101'),
  ('c1340000-0000-4000-8000-000000001002', 'c1340000-0000-4000-8000-00000000000b', 'Synthetic Versions Patient B', '+919000013402', 'c1340000-0000-4000-8000-000000000201');
-- 2001: booked now in A (checked in, replayed, checked in again); 2101: B's visit.
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by, scheduled_at, estimated_duration_minutes, is_overbooked) values
  ('c1340000-0000-4000-8000-000000002001', 'c1340000-0000-4000-8000-00000000000a', 'c1340000-0000-4000-8000-000000001001', 'c1340000-0000-4000-8000-000000000101', 'scheduled', 'booked', 'c1340000-0000-4000-8000-000000000101', now(), 20, true),
  ('c1340000-0000-4000-8000-000000002101', 'c1340000-0000-4000-8000-00000000000b', 'c1340000-0000-4000-8000-000000001002', 'c1340000-0000-4000-8000-000000000201', 'scheduled', 'booked', 'c1340000-0000-4000-8000-000000000201', now(), 20, true);

create function pg_temp.fresh() returns void language sql as $f$
  update public.clinic_versions set last_xact = null;
$f$;
create function pg_temp.ver(p_tenant text, p_domain text) returns bigint language sql as $f$
  select version from public.clinic_versions where tenant_id = ('c1340000-0000-4000-8000-00000000000' || p_tenant)::uuid and domain = p_domain
$f$;
-- One statement as a user of clinic A; the answer (jsonb) or {"error": "<sqlstate>:<message>"}.
create function pg_temp.call(p_user text, p_sql text) returns jsonb language plpgsql as $f$
declare v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', ('c1340000-0000-4000-8000-000000000' || p_user)::uuid, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '', true);
  begin
    set local role authenticated;
    execute p_sql into v_out;
    reset role;
  exception when others then
    reset role; v_out := json_build_object('error', sqlstate || ':' || sqlerrm)::text;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v_out::jsonb;
end;
$f$;
create function pg_temp.check_in(p_visit text, p_request text) returns jsonb language sql as $f$
  select pg_temp.call('105', format($q$select public.check_in_visit('c1340000-0000-4000-8000-00000000000a', %L, 'normal', %L)::text$q$,
    'c1340000-0000-4000-8000-00000000' || p_visit, 'c1340000-0000-4000-8000-0000000c' || p_request))
$f$;

create temp table before_v as select tenant_id, domain, version from public.clinic_versions where tenant_id::text like 'c1340000-%';
create function pg_temp.was(p_tenant text, p_domain text) returns bigint language sql as $f$
  select version from before_v where tenant_id = ('c1340000-0000-4000-8000-00000000000' || p_tenant)::uuid and domain = p_domain
$f$;

-- 1 + 2. A check-in in A, in a transaction that has also raised clinic B's schedule (B's visit moved first, as another statement of the same transaction).
select pg_temp.fresh();
update public.visits set estimated_duration_minutes = 25 where id = 'c1340000-0000-4000-8000-000000002101';
select is(pg_temp.ver('b', 'schedule'), pg_temp.was('b', 'schedule') + 1, 'setup: clinic B''s schedule was raised in this transaction');
create temp table first_answer as select pg_temp.check_in('2001', '0001') as r;
select is((select r ->> 'token_number' is not null from first_answer), true, 'the check-in succeeded');
select is((select string_agg(k, ',' order by k) from first_answer, jsonb_object_keys(r -> 'versions') k), 'queue,schedule',
  'the answer names exactly the domains the check-in raised (queue, schedule)');
select is((select (r -> 'versions' ->> 'queue')::bigint from first_answer), pg_temp.was('a', 'queue') + 1, 'queue: one past the version before');
select is((select (r -> 'versions' ->> 'schedule')::bigint from first_answer), pg_temp.was('a', 'schedule') + 1, 'schedule: one past the version before');
select is((select r -> 'versions' from first_answer),
  jsonb_build_object('queue', pg_temp.ver('a', 'queue'), 'schedule', pg_temp.ver('a', 'schedule')),
  'the numbers are clinic A''s versions after the commit (never clinic B''s, raised in the same transaction)');

-- 3. A replay answers the stored result, versions included, and raises nothing.
select pg_temp.fresh();
select is(pg_temp.check_in('2001', '0001'), (select r from first_answer) || jsonb_build_object('replayed', true),
  'a replay of the same request id answers the stored result (versions included), marked replayed');
select is(pg_temp.ver('a', 'queue'), pg_temp.was('a', 'queue') + 1, 'the replay raised nothing');

-- 4. A command whose transaction raised no domain of the clinic answers {}: a second check-in (new request id) of the visit already waiting with its token
--    changes nothing and writes no second audit row (step_check_in).
select pg_temp.fresh();
create temp table repeat_answer as select pg_temp.check_in('2001', '0002') as r;
select is((select r ->> 'replayed' from repeat_answer), 'false', 'the repeat check-in is a new request, not a replay');
select is((select r -> 'versions' from repeat_answer), '{}'::jsonb, 'nothing raised: versions {}');

-- 5. Shape.
select is((select p.prosecdef::text || ':' || array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'private.command_complete(uuid, uuid, jsonb)'::regprocedure)
         || ':' || has_function_privilege('authenticated', 'private.command_complete(uuid, uuid, jsonb)', 'execute')::text,
  'true:search_path="",lock_timeout=2s:false', 'command_complete: definer, search_path empty, lock_timeout 2s, no EXECUTE for authenticated');

select * from finish();
rollback;
