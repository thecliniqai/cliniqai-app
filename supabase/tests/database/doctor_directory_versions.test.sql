-- doctor_directory_versions.test.sql — V2-09e 09E PR 2 review fix I-1 (migration 000132).
-- The doctor directory that session_bootstrap (doctors, by the `settings` version) and schedule_range (clinicians, by the `schedule` version) answer depends
-- on tenants.owner_is_practicing_doctor and memberships.default_specialty. A write of either must move the version the device re-reads on, or another
-- device keeps a picker that the database no longer has (an owner who stopped practising stays bookable).
--   1. owner_is_practicing_doctor -> settings AND schedule, both ways; the same value written again moves nothing;
--   2. default_specialty -> schedule, settings; the same value written again moves nothing;
--   3. a rename still moves settings only (the schedule's version is unchanged);
--   4. after the toggle, the bootstrap and the range drop the owner and answer the new versions from the same statement;
--   5. the trigger functions keep their shape (definer, search_path pinned, no API grant).
-- A pgTAP file is one transaction: `pg_temp.fresh()` clears the once-per-transaction marker (as clinic_versions.test.sql). Synthetic data only.
begin;
select plan(16);

insert into auth.users (id, email) values
  ('c1320000-0000-4000-8000-000000000101', 'c132-owner-a@example.test'),
  ('c1320000-0000-4000-8000-000000000102', 'c132-doctor-a@example.test'),
  ('c1320000-0000-4000-8000-000000000104', 'c132-receptionist-a@example.test');
insert into public.tenants (id, name, owner_is_practicing_doctor) values
  ('c1320000-0000-4000-8000-00000000000a', 'Synthetic 000132 Clinic A', true);
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id = 'c1320000-0000-4000-8000-00000000000a' and s.status = 'incomplete';
insert into public.memberships (user_id, tenant_id, role, full_name, default_specialty, created_at) values
  ('c1320000-0000-4000-8000-000000000101', 'c1320000-0000-4000-8000-00000000000a', 'owner', 'Synthetic Owner A', null, now() - interval '9 minutes'),
  ('c1320000-0000-4000-8000-000000000102', 'c1320000-0000-4000-8000-00000000000a', 'doctor', 'Synthetic Doctor A', 'general_medicine', now() - interval '8 minutes'),
  ('c1320000-0000-4000-8000-000000000104', 'c1320000-0000-4000-8000-00000000000a', 'receptionist', 'Synthetic Receptionist A', null, now() - interval '7 minutes');

create function pg_temp.fresh() returns void language sql as $f$
  update public.clinic_versions set last_xact = null;
$f$;
-- Runs `p_sql` as a new transaction would and returns the domains of clinic A whose version rose ('-' for none).
create function pg_temp.moved(p_sql text) returns text language plpgsql as $f$
declare v_before jsonb; v_after jsonb;
begin
  perform pg_temp.fresh();
  select jsonb_object_agg(domain, version) into v_before from public.clinic_versions where tenant_id = 'c1320000-0000-4000-8000-00000000000a';
  execute p_sql;
  select jsonb_object_agg(domain, version) into v_after from public.clinic_versions where tenant_id = 'c1320000-0000-4000-8000-00000000000a';
  return coalesce((select string_agg(k, ',' order by k) from jsonb_object_keys(v_after) k where v_after -> k is distinct from v_before -> k), '-');
end;
$f$;
create function pg_temp.as_user(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c1320000-0000-4000-8000-00000000000a')::text, true);
  begin
    set local role authenticated;
    execute p_sql into v_out;
    reset role;
  exception when others then
    reset role; v_out := 'error:' || sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  return v_out;
end;
$f$;
create function pg_temp.boot() returns jsonb language sql as $f$
  select pg_temp.as_user('c1320000-0000-4000-8000-000000000104', $q$ select public.session_bootstrap('c1320000-0000-4000-8000-00000000000a')::text $q$)::jsonb
$f$;
create function pg_temp.range() returns jsonb language sql as $f$
  select pg_temp.as_user('c1320000-0000-4000-8000-000000000104',
    $q$ select public.schedule_range('c1320000-0000-4000-8000-00000000000a', current_date, current_date, false)::text $q$)::jsonb
$f$;
create function pg_temp.ver(p_domain text) returns bigint language sql as $f$
  select version from public.clinic_versions where tenant_id = 'c1320000-0000-4000-8000-00000000000a' and domain = p_domain
$f$;

-- 1. owner_is_practicing_doctor -------------------------------------------------------------------------------------------------
select is(pg_temp.moved($$ update public.tenants set owner_is_practicing_doctor = false where id = 'c1320000-0000-4000-8000-00000000000a' $$), 'schedule,settings',
  'the owner stops practising -> schedule (the range''s clinicians) and settings (the bootstrap''s doctors)');
select is(pg_temp.moved($$ update public.tenants set owner_is_practicing_doctor = false where id = 'c1320000-0000-4000-8000-00000000000a' $$), '-',
  'the same value written again moves nothing');

-- 4. (with the owner not practising) the reads answer the new directory with the new versions ---------------------------------------
select is((select string_agg(d ->> 'full_name', ',') from jsonb_array_elements(pg_temp.boot() -> 'doctors') d), 'Synthetic Doctor A',
  'the bootstrap''s doctors no longer list the owner');
select is((pg_temp.boot() #>> '{versions,settings}')::bigint, pg_temp.ver('settings'), 'the bootstrap answers the moved settings version');
select is((select string_agg(c ->> 'full_name', ',') from jsonb_array_elements(pg_temp.range() -> 'clinicians') c), 'Synthetic Doctor A',
  'the range''s clinicians no longer list the owner');
select is((pg_temp.range() #>> '{versions,schedule}')::bigint, pg_temp.ver('schedule'), 'the range answers the moved schedule version');

select is(pg_temp.moved($$ update public.tenants set owner_is_practicing_doctor = true where id = 'c1320000-0000-4000-8000-00000000000a' $$), 'schedule,settings',
  'the owner starts practising again -> schedule, settings');
select is((select string_agg(d ->> 'full_name', ',') from jsonb_array_elements(pg_temp.boot() -> 'doctors') d), 'Synthetic Owner A,Synthetic Doctor A',
  'the bootstrap lists the owner again');

-- 2. default_specialty ----------------------------------------------------------------------------------------------------------
select is(pg_temp.moved($$ update public.memberships set default_specialty = 'paediatrics' where user_id = 'c1320000-0000-4000-8000-000000000102' $$), 'schedule,settings',
  'a doctor''s specialty (the picker label) -> schedule, settings');
select is((select d ->> 'specialty' from jsonb_array_elements(pg_temp.boot() -> 'doctors') d where d ->> 'full_name' = 'Synthetic Doctor A'), 'paediatrics',
  'the bootstrap answers the new specialty');
select is(pg_temp.moved($$ update public.memberships set default_specialty = 'paediatrics' where user_id = 'c1320000-0000-4000-8000-000000000102' $$), '-',
  'the same specialty written again moves nothing');

-- 3. A rename still moves settings only --------------------------------------------------------------------------------------------
select is(pg_temp.moved($$ update public.tenants set name = 'Synthetic 000132 Clinic A2' where id = 'c1320000-0000-4000-8000-00000000000a' $$), 'settings',
  'a rename moves settings only (the schedule version is unchanged)');
select is(pg_temp.moved($$ update public.tenants set default_consultation_fee = 650 where id = 'c1320000-0000-4000-8000-00000000000a' $$), '-',
  'a fee (not in the directory) moves nothing');

-- 5. Shape ----------------------------------------------------------------------------------------------------------------------
select is((select string_agg(p.proname || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ','), ',' order by p.proname) from pg_proc p
            where p.pronamespace = 'private'::regnamespace and p.proname in ('cv_tenants_update', 'cv_memberships_update')),
  'cv_memberships_update:true:search_path="",cv_tenants_update:true:search_path=""', 'both trigger functions stay definer with search_path pinned');
select is((select count(*)::int from pg_proc p cross join lateral aclexplode(p.proacl) a
            where p.pronamespace = 'private'::regnamespace and p.proname in ('cv_tenants_update', 'cv_memberships_update')
              and a.grantee::regrole::text in ('anon', 'authenticated', 'service_role', '-')), 0, 'neither has an API grant');
select is((select string_agg(t.tgname, ',' order by t.tgname) from pg_trigger t
            where not t.tgisinternal and t.tgfoid in ('private.cv_tenants_update()'::regprocedure, 'private.cv_memberships_update()'::regprocedure)),
  'memberships_clinic_version_update,tenants_clinic_version_update', 'the same two statement triggers call them');

select * from finish();
rollback;
