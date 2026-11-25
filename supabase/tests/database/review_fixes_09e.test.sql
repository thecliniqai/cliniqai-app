-- review_fixes_09e.test.sql — V2-09e 09E-14a (migration 000127; independent review M4 and adversarial L-1).
--   1. Today's patient and follow-up facts move the queue domain (and only the queue): the listed columns of patients and follow_ups move it, a column the board does not
--      read moves nothing, a patient insert moves nothing, deletes and follow-up inserts move it; one bump per transaction and clinic, one signal.
--   2. ops_ingest_rum: an active member only (a signed-in account with no clinic, a removed member and a user with no row are refused 42501 and write nothing); one
--      account's accepted samples stop at its share of the day's cap and the rest are counted as overflow; another account still has room; the counter key is not the
--      user id and earlier days are deleted; no API role reaches the new table or functions.
-- Synthetic data only; the file rolls back.
begin;
select plan(41);

insert into auth.users (id, email) values
  ('c1270000-0000-4000-8000-000000000101', 'c127-owner-a@example.test'),
  ('c1270000-0000-4000-8000-000000000102', 'c127-removed@example.test'),
  ('c1270000-0000-4000-8000-000000000103', 'c127-second@example.test'),
  ('c1270000-0000-4000-8000-000000000301', 'c127-nobody@example.test');
insert into public.tenants (id, name) values ('c1270000-0000-4000-8000-00000000000a', 'Synthetic 000127 Clinic A');
insert into public.memberships (user_id, tenant_id, role, status, removed_at) values
  ('c1270000-0000-4000-8000-000000000101', 'c1270000-0000-4000-8000-00000000000a', 'owner', 'active', null),
  ('c1270000-0000-4000-8000-000000000103', 'c1270000-0000-4000-8000-00000000000a', 'doctor', 'active', null),
  ('c1270000-0000-4000-8000-000000000102', 'c1270000-0000-4000-8000-00000000000a', 'doctor', 'removed', now());
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1270000-0000-4000-8000-000000001001', 'c1270000-0000-4000-8000-00000000000a', 'Synthetic Patient 127', '+919000012701', 'c1270000-0000-4000-8000-000000000101');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, estimated_duration_minutes, created_by) values
  ('c1270000-0000-4000-8000-000000002001', 'c1270000-0000-4000-8000-00000000000a', 'c1270000-0000-4000-8000-000000001001', 'c1270000-0000-4000-8000-000000000101', 'walk_in', 'completed', 15, 'c1270000-0000-4000-8000-000000000101');

create function pg_temp.fresh() returns void language sql as $f$
  update public.clinic_versions set last_xact = null;
  delete from realtime.messages;
$f$;
-- The domains of clinic A that rose when `p_sql` ran as a new transaction would.
create function pg_temp.moved(p_sql text) returns text language plpgsql as $f$
declare v_before jsonb; v_after jsonb; v_moved text;
begin
  perform pg_temp.fresh();
  select jsonb_object_agg(domain, version) into v_before from public.clinic_versions where tenant_id = 'c1270000-0000-4000-8000-00000000000a';
  execute p_sql;
  select jsonb_object_agg(domain, version) into v_after from public.clinic_versions where tenant_id = 'c1270000-0000-4000-8000-00000000000a';
  select coalesce(string_agg(k, ',' order by k), '-') into v_moved from jsonb_object_keys(v_after) k where v_after->k is distinct from v_before->k;
  return v_moved;
end;
$f$;

-- 1. Triggers ---------------------------------------------------------------------------------------------------------------
select is(pg_temp.moved($$ update public.patients set full_name = 'Synthetic Patient 127 renamed' where id = 'c1270000-0000-4000-8000-000000001001' $$), 'queue', 'a patient rename moves queue');
select is(pg_temp.moved($$ update public.patients set phone = '+919000012799' where id = 'c1270000-0000-4000-8000-000000001001' $$), 'queue', 'a phone change moves queue');
select is(pg_temp.moved($$ update public.patients set sex = 'female' where id = 'c1270000-0000-4000-8000-000000001001' $$), 'queue', 'sex moves queue');
select is(pg_temp.moved($$ update public.patients set age = 41 where id = 'c1270000-0000-4000-8000-000000001001' $$), 'queue', 'age moves queue');
select is(pg_temp.moved($$ update public.patients set date_of_birth = date '1980-01-01' where id = 'c1270000-0000-4000-8000-000000001001' $$), 'queue', 'date of birth moves queue');
select is(pg_temp.moved($$ update public.patients set allergies = array['penicillin'] where id = 'c1270000-0000-4000-8000-000000001001' $$), 'queue', 'allergies move queue (the board shows the flag)');
select is(pg_temp.moved($$ update public.patients set allergies = array['penicillin'] where id = 'c1270000-0000-4000-8000-000000001001' $$), '-', 'an update that changes no listed value moves nothing');
select is(pg_temp.moved($$ update public.patients set guardian_name = 'Synthetic Guardian', abha_id = '12-3456-7890-1234' where id = 'c1270000-0000-4000-8000-000000001001' $$), '-', 'guardian and ABHA are not on the board: nothing moves');
select is(pg_temp.moved($$ update public.patients set whatsapp_opt_out = true, emergency_contact = '{}'::jsonb where id = 'c1270000-0000-4000-8000-000000001001' $$), '-', 'opt-out and emergency contact are not on the board: nothing moves');
select is(pg_temp.moved($$ insert into public.patients (id, tenant_id, full_name, phone, created_by) values ('c1270000-0000-4000-8000-000000001002', 'c1270000-0000-4000-8000-00000000000a', 'Synthetic Patient 127 b', '+919000012702', 'c1270000-0000-4000-8000-000000000101') $$), '-', 'a patient insert moves nothing (no visit yet)');
select is(pg_temp.moved($$ update public.patients set full_name = 'x1', age = 5 where tenant_id = 'c1270000-0000-4000-8000-00000000000a' $$), 'queue', 'one statement over two patients raises queue once');
select is((select count(*)::int from realtime.messages where topic = 'today:c1270000-0000-4000-8000-00000000000a'), 1, 'and sends one signal');
select is(pg_temp.moved($$ delete from public.patients where id = 'c1270000-0000-4000-8000-000000001002' $$), 'queue', 'a patient delete moves queue');

select is(pg_temp.moved($$ insert into public.follow_ups (id, tenant_id, visit_id, patient_id, doctor_id, follow_up_date) values ('c1270000-0000-4000-8000-000000003001', 'c1270000-0000-4000-8000-00000000000a', 'c1270000-0000-4000-8000-000000002001', 'c1270000-0000-4000-8000-000000001001', 'c1270000-0000-4000-8000-000000000101', current_date + 7) $$), 'queue', 'a follow-up insert moves queue');
select is(pg_temp.moved($$ update public.follow_ups set follow_up_date = current_date + 9 where id = 'c1270000-0000-4000-8000-000000003001' $$), 'queue', 'a follow-up date change moves queue');
select is(pg_temp.moved($$ update public.follow_ups set notes = 'Synthetic note' where id = 'c1270000-0000-4000-8000-000000003001' $$), '-', 'a follow-up note is not on the board: nothing moves');
select is(pg_temp.moved($$ update public.follow_ups set follow_up_date = follow_up_date where id = 'c1270000-0000-4000-8000-000000003001' $$), '-', 'an unchanged date moves nothing');
select is(pg_temp.moved($$ delete from public.follow_ups where id = 'c1270000-0000-4000-8000-000000003001' $$), 'queue', 'a follow-up delete moves queue');
select is(
  (select count(*)::int from pg_trigger t where t.tgrelid in ('public.patients'::regclass, 'public.follow_ups'::regclass) and t.tgname like '%clinic_version%' and not t.tgisinternal),
  5, 'five new statement triggers');
select is(
  (select count(*)::int from unnest(array['private.cv_patients_update()', 'private.cv_patients_delete()', 'private.cv_follow_ups_change()', 'private.cv_follow_ups_update()']) f,
          unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, f::regprocedure, 'EXECUTE')),
  0, 'the trigger functions are executable by no API role');

-- 2. RUM ---------------------------------------------------------------------------------------------------------------------
delete from ops.rum_daily;
delete from ops.rum_overflow;
delete from ops.rum_user_daily;

create function pg_temp.ingest(p_user text, p_n int) returns text language plpgsql as $f$
declare v_out text := 'ok';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  begin
    set local role authenticated;
    perform public.ops_ingest_rum('test', 'abcdef1',
      (select coalesce(jsonb_agg(jsonb_build_object('screen', 'today', 'metric', 'lcp', 'device', 'desktop', 'net', '4g', 'value', 100)), '[]'::jsonb) from generate_series(1, p_n)));
    reset role;
  exception when others then
    reset role; v_out := sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$f$;

select is(pg_temp.ingest('c1270000-0000-4000-8000-000000000301', 3), '42501', 'a signed-in account with no clinic is refused');
select is(pg_temp.ingest('c1270000-0000-4000-8000-000000000102', 3), '42501', 'a removed member is refused');
select is((select coalesce(sum(count), 0)::int from ops.rum_daily), 0, 'neither wrote a sample');
select is((select count(*)::int from ops.rum_user_daily), 0, 'neither wrote a counter');
select is(pg_temp.ingest('c1270000-0000-4000-8000-000000000101', 3), 'ok', 'an active member is accepted');
select is((select sum(count)::int from ops.rum_daily), 3, 'its samples are stored');
select is((select samples from ops.rum_user_daily), 3::bigint, 'and counted for its share');
select is((select count(*)::int from ops.rum_user_daily where user_key = decode(replace('c1270000-0000-4000-8000-000000000101', '-', ''), 'hex')), 0, 'the counter key is not the user id');
select is((select length(user_key) from ops.rum_user_daily), 32, 'it is a sha256 digest');

create or replace function ops.rum_user_daily_cap() returns bigint language sql immutable set search_path = '' as $f$ select 5::bigint $f$;
select is(pg_temp.ingest('c1270000-0000-4000-8000-000000000101', 4), 'ok', 'a batch that crosses the account''s share is accepted');
select is((select sum(count)::int from ops.rum_daily), 5, 'only up to the share is stored (3 + 2)');
select is((select dropped from ops.rum_overflow where day = (now() at time zone 'utc')::date), 2::bigint, 'the rest is counted as overflow');
select is(pg_temp.ingest('c1270000-0000-4000-8000-000000000101', 4), 'ok', 'a later batch of the same account is accepted');
select is((select sum(count)::int from ops.rum_daily), 5, 'and stores nothing');
select is(pg_temp.ingest('c1270000-0000-4000-8000-000000000103', 4), 'ok', 'another member still has room (the total cap is not used up by one account)');
select is((select sum(count)::int from ops.rum_daily), 9, 'its four samples are stored');
update ops.rum_user_daily set day = day - 1;
select is(pg_temp.ingest('c1270000-0000-4000-8000-000000000103', 1), 'ok', 'a call on a later day');
select is((select count(*)::int from ops.rum_user_daily where day < (now() at time zone 'utc')::date), 0, 'deletes the counters of earlier days');
select is(
  (select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r where has_table_privilege(r, 'ops.rum_user_daily', 'SELECT,INSERT,UPDATE,DELETE')),
  0, 'no API role holds a privilege on the counter table');
select is(
  (select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'ops.rum_user_daily_cap()', 'EXECUTE')),
  0, 'nor on its cap function');
select is(
  (select string_agg(a.grantee::regrole::text, ',' order by a.grantee::regrole::text)
     from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.oid = 'public.ops_ingest_rum(text, text, jsonb)'::regprocedure and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner),
  'authenticated', 'EXECUTE on ops_ingest_rum is still authenticated only');

select * from finish();
rollback;
