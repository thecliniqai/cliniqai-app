-- schedule_range.test.sql — V2-09e 09E-12 (R-10; migration 000130; threats: another clinic's schedule on the range read, fields beyond the screen, range
-- abuse, a slot list that drifts from the one the booking commands check).
-- public.schedule_range(tenant, from, to, include_slots): the Schedule of up to 42 clinic dates in one STABLE INVOKER read.
--   1. grants and shape: INVOKER, search_path pinned, EXECUTE for authenticated only;
--   2. refusals (NULL): another clinic, a forged tenant, no membership, a clinic that is not full, no session, a NULL argument, a reversed range, 43 days;
--      42 days answers; every member role of a full clinic answers;
--   3. the exact key sets: the answer, a clinician, a visit, a block, a waitlist entry, a slot entry; p_include_slots false → no `slots` key;
--   4. the versions equal clinic_versions in the same transaction;
--   5. the rows: the range's visits only (not cancelled, not another clinic's, not outside the range), blocks that touch the range, waiting entries only;
--      clinicians (doctors, a practising owner; not an admin, not a removed doctor); the effective schedule of a NULL one is the default;
--   6. the slots equal public.available_slots for each (doctor, date) of a 25-case table: one rule, asserted.
-- Every call runs under the real principal. The file rolls back. Synthetic data only.
begin;
select plan(78);

insert into auth.users (id, email) values
  ('c1300000-0000-4000-8000-000000000101', 'c130-owner-a@example.test'),
  ('c1300000-0000-4000-8000-000000000102', 'c130-doctor1-a@example.test'),
  ('c1300000-0000-4000-8000-000000000103', 'c130-doctor2-a@example.test'),
  ('c1300000-0000-4000-8000-000000000104', 'c130-doctor3-a@example.test'),
  ('c1300000-0000-4000-8000-000000000105', 'c130-receptionist-a@example.test'),
  ('c1300000-0000-4000-8000-000000000106', 'c130-nurse-a@example.test'),
  ('c1300000-0000-4000-8000-000000000107', 'c130-admin-a@example.test'),
  ('c1300000-0000-4000-8000-000000000108', 'c130-removed-a@example.test'),
  ('c1300000-0000-4000-8000-000000000201', 'c130-owner-b@example.test'),
  ('c1300000-0000-4000-8000-000000000301', 'c130-outsider@example.test'),
  ('c1300000-0000-4000-8000-000000000401', 'c130-owner-c@example.test'),
  ('c1300000-0000-4000-8000-000000000501', 'c130-owner-d@example.test');
insert into public.tenants (id, name, timezone) values
  ('c1300000-0000-4000-8000-00000000000a', 'Synthetic 000130 Clinic A', 'Asia/Kolkata'),
  ('c1300000-0000-4000-8000-00000000000b', 'Synthetic 000130 Clinic B', 'Asia/Kolkata'),
  ('c1300000-0000-4000-8000-00000000000c', 'Synthetic 000130 Clinic C (not full)', 'Asia/Kolkata'),
  ('c1300000-0000-4000-8000-00000000000d', 'Synthetic 000130 Clinic D (New York)', 'America/New_York');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-00000000000b', 'c1300000-0000-4000-8000-00000000000d')
   and s.status = 'incomplete';
-- Doctor 1: Monday two shifts, Tuesday off, Wednesday a night shift (00:30-03:00 IST: the previous UTC day), Thursday off; 15 min. Doctor 2: 5 min, the
-- default hours (NULL). Doctor 3: 45 min, the default hours. The owner practises with the default hours. The owner of D (New York): Sunday 01:00-04:00, 30 min.
insert into public.memberships (user_id, tenant_id, role, full_name, availability_schedule, default_slot_duration_minutes) values
  ('c1300000-0000-4000-8000-000000000101', 'c1300000-0000-4000-8000-00000000000a', 'owner', 'Synthetic Owner A', null, null),
  ('c1300000-0000-4000-8000-000000000102', 'c1300000-0000-4000-8000-00000000000a', 'doctor', 'Synthetic Doctor One', '{
     "monday": {"enabled": true, "shifts": [{"start": "09:00", "end": "10:00"}, {"start": "14:00", "end": "15:00"}]},
     "tuesday": {"enabled": false, "shifts": [{"start": "09:00", "end": "10:00"}]},
     "wednesday": {"enabled": true, "shifts": [{"start": "00:30", "end": "03:00"}]},
     "thursday": {"enabled": false, "shifts": []}, "friday": {"enabled": false, "shifts": []},
     "saturday": {"enabled": false, "shifts": []}, "sunday": {"enabled": false, "shifts": []}}'::jsonb, 15),
  ('c1300000-0000-4000-8000-000000000103', 'c1300000-0000-4000-8000-00000000000a', 'doctor', 'Synthetic Doctor Two', null, 5),
  ('c1300000-0000-4000-8000-000000000104', 'c1300000-0000-4000-8000-00000000000a', 'doctor', null, null, 45),
  ('c1300000-0000-4000-8000-000000000105', 'c1300000-0000-4000-8000-00000000000a', 'receptionist', null, null, null),
  ('c1300000-0000-4000-8000-000000000106', 'c1300000-0000-4000-8000-00000000000a', 'nurse', null, null, null),
  ('c1300000-0000-4000-8000-000000000107', 'c1300000-0000-4000-8000-00000000000a', 'admin', 'Synthetic Admin', null, null),
  ('c1300000-0000-4000-8000-000000000201', 'c1300000-0000-4000-8000-00000000000b', 'owner', null, null, null),
  ('c1300000-0000-4000-8000-000000000401', 'c1300000-0000-4000-8000-00000000000c', 'owner', null, null, null),
  ('c1300000-0000-4000-8000-000000000501', 'c1300000-0000-4000-8000-00000000000d', 'owner', 'Synthetic Owner D', '{
     "monday": {"enabled": false, "shifts": []}, "tuesday": {"enabled": false, "shifts": []}, "wednesday": {"enabled": false, "shifts": []},
     "thursday": {"enabled": false, "shifts": []}, "friday": {"enabled": false, "shifts": []}, "saturday": {"enabled": false, "shifts": []},
     "sunday": {"enabled": true, "shifts": [{"start": "01:00", "end": "04:00"}]}}'::jsonb, 30);
insert into public.memberships (user_id, tenant_id, role, full_name, status, removed_at) values
  ('c1300000-0000-4000-8000-000000000108', 'c1300000-0000-4000-8000-00000000000a', 'doctor', 'Synthetic Removed Doctor', 'removed', now());

-- M = a Monday at least four weeks ahead (every slot of the table is in the future); d(n) = M + n.
create function pg_temp.d(n integer) returns date language sql as $f$
  select ((current_date + 28) - extract(isodow from current_date + 28)::integer + 1) + n
$f$;
create function pg_temp.at(p_day date, p_time text, p_zone text default 'Asia/Kolkata') returns timestamptz language sql as $f$
  select (p_day + p_time::time) at time zone p_zone
$f$;

insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1300000-0000-4000-8000-000000001001', 'c1300000-0000-4000-8000-00000000000a', 'Synthetic Range Patient One', '+919000013001', 'c1300000-0000-4000-8000-000000000101'),
  ('c1300000-0000-4000-8000-000000001002', 'c1300000-0000-4000-8000-00000000000a', 'Synthetic Range Patient Two', '+919000013002', 'c1300000-0000-4000-8000-000000000101'),
  ('c1300000-0000-4000-8000-000000001003', 'c1300000-0000-4000-8000-00000000000b', 'Synthetic Range Patient B', '+919000013003', 'c1300000-0000-4000-8000-000000000201');

-- Visits of A (week M .. M+6 and later): 2001 booked Fri 10:15 (owner), 2002 overbooked Fri 10:00 (owner), 2003 cancelled Fri 10:30 (owner), 2004 no-show
-- Fri 10:45 (owner), 2005 confirmed Fri 11:00 (owner), 2006 booked Mon 09:20 for 20 min (doctor 2), 2007 booked M+14 (outside the first week),
-- 2008 booked M-1 (Sunday before), 3001 clinic B's booking on Monday.
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by, scheduled_at, is_overbooked, estimated_duration_minutes) values
  ('c1300000-0000-4000-8000-000000002001', 'c1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-000000001001', 'c1300000-0000-4000-8000-000000000101', 'scheduled', 'booked', 'c1300000-0000-4000-8000-000000000101', pg_temp.at(pg_temp.d(4), '10:15'), false, 15),
  ('c1300000-0000-4000-8000-000000002002', 'c1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-000000001002', 'c1300000-0000-4000-8000-000000000101', 'scheduled', 'booked', 'c1300000-0000-4000-8000-000000000101', pg_temp.at(pg_temp.d(4), '10:00'), true, 15),
  ('c1300000-0000-4000-8000-000000002003', 'c1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-000000001002', 'c1300000-0000-4000-8000-000000000101', 'scheduled', 'cancelled', 'c1300000-0000-4000-8000-000000000101', pg_temp.at(pg_temp.d(4), '10:30'), false, 15),
  ('c1300000-0000-4000-8000-000000002004', 'c1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-000000001002', 'c1300000-0000-4000-8000-000000000101', 'scheduled', 'booked', 'c1300000-0000-4000-8000-000000000101', pg_temp.at(pg_temp.d(4), '10:45'), false, 15),
  ('c1300000-0000-4000-8000-000000002005', 'c1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-000000001001', 'c1300000-0000-4000-8000-000000000101', 'scheduled', 'confirmed', 'c1300000-0000-4000-8000-000000000101', pg_temp.at(pg_temp.d(4), '11:00'), false, 15),
  ('c1300000-0000-4000-8000-000000002006', 'c1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-000000001001', 'c1300000-0000-4000-8000-000000000103', 'scheduled', 'booked', 'c1300000-0000-4000-8000-000000000101', pg_temp.at(pg_temp.d(0), '10:20'), false, 20),
  ('c1300000-0000-4000-8000-000000002007', 'c1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-000000001001', 'c1300000-0000-4000-8000-000000000101', 'scheduled', 'booked', 'c1300000-0000-4000-8000-000000000101', pg_temp.at(pg_temp.d(14), '10:00'), false, 15),
  ('c1300000-0000-4000-8000-000000002008', 'c1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-000000001001', 'c1300000-0000-4000-8000-000000000101', 'scheduled', 'booked', 'c1300000-0000-4000-8000-000000000101', pg_temp.at(pg_temp.d(-1), '18:00'), false, 15),
  ('c1300000-0000-4000-8000-000000003001', 'c1300000-0000-4000-8000-00000000000b', 'c1300000-0000-4000-8000-000000001003', 'c1300000-0000-4000-8000-000000000201', 'scheduled', 'booked', 'c1300000-0000-4000-8000-000000000201', pg_temp.at(pg_temp.d(0), '10:00'), false, 15);
-- The no-show (a status a booking reaches after its time; set directly here, the guard trigger is bypassed by the superuser seeding only through status order).
update public.visits set status = 'no_show' where id = 'c1300000-0000-4000-8000-000000002004';
-- Blocks: the whole clinic Thursday 10:00-11:00; doctor 1 on M+7 09:00-09:30; doctor 3 all of Saturday; clinic B Monday all day; one far outside the week.
insert into public.schedule_blocks (id, tenant_id, doctor_id, start_time, end_time, all_day, reason, created_by) values
  ('c1300000-0000-4000-8000-000000005001', 'c1300000-0000-4000-8000-00000000000a', null, pg_temp.at(pg_temp.d(3), '10:00'), pg_temp.at(pg_temp.d(3), '11:00'), false, 'Synthetic clinic meeting', 'c1300000-0000-4000-8000-000000000101'),
  ('c1300000-0000-4000-8000-000000005002', 'c1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-000000000102', pg_temp.at(pg_temp.d(7), '09:00'), pg_temp.at(pg_temp.d(7), '09:30'), false, null, 'c1300000-0000-4000-8000-000000000101'),
  ('c1300000-0000-4000-8000-000000005003', 'c1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-000000000104', pg_temp.at(pg_temp.d(5), '00:00'), pg_temp.at(pg_temp.d(6), '00:00'), true, null, 'c1300000-0000-4000-8000-000000000101'),
  ('c1300000-0000-4000-8000-000000005004', 'c1300000-0000-4000-8000-00000000000b', null, pg_temp.at(pg_temp.d(0), '00:00'), pg_temp.at(pg_temp.d(1), '00:00'), true, null, 'c1300000-0000-4000-8000-000000000201'),
  ('c1300000-0000-4000-8000-000000005005', 'c1300000-0000-4000-8000-00000000000a', null, pg_temp.at(pg_temp.d(30), '10:00'), pg_temp.at(pg_temp.d(30), '11:00'), false, null, 'c1300000-0000-4000-8000-000000000101');
-- Waitlist: one waiting on Monday, one promoted (not shown), one waiting outside the week.
insert into public.waitlist_entries (id, tenant_id, patient_id, doctor_id, target_date, status, priority, time_window, created_by) values
  ('c1300000-0000-4000-8000-000000006001', 'c1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-000000001002', null, pg_temp.d(0), 'waiting', 2, 'morning', 'c1300000-0000-4000-8000-000000000101'),
  ('c1300000-0000-4000-8000-000000006002', 'c1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-000000001001', null, pg_temp.d(0), 'expired', 0, null, 'c1300000-0000-4000-8000-000000000101'),
  ('c1300000-0000-4000-8000-000000006003', 'c1300000-0000-4000-8000-00000000000a', 'c1300000-0000-4000-8000-000000001001', null, pg_temp.d(20), 'waiting', 0, null, 'c1300000-0000-4000-8000-000000000101');

create function pg_temp.as_user(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '', true);
  begin
    set local role authenticated;
    execute p_sql into v_out;
    reset role;
  exception when others then
    reset role; v_out := 'error:' || sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$f$;
create function pg_temp.uid(p_user text) returns uuid language sql as $f$ select ('c1300000-0000-4000-8000-000000000' || p_user)::uuid $f$;
-- The range as a user: the jsonb text, or 'NULL'.
create function pg_temp.range(p_user text, p_from date, p_to date, p_slots boolean default true, p_tenant text default 'c1300000-0000-4000-8000-00000000000a') returns text language sql as $f$
  select pg_temp.as_user(pg_temp.uid(p_user), format($q$ select coalesce(public.schedule_range(%L, %L, %L, %L)::text, 'NULL') $q$, p_tenant, p_from, p_to, p_slots))
$f$;
-- The slots of one (doctor, date) from the range read, as [[minute, length], ...] ('[]' when the range lists none).
create function pg_temp.range_slots(p_user text, p_doctor text, p_day date, p_tenant text default 'c1300000-0000-4000-8000-00000000000a') returns text language sql as $f$
  select coalesce((select e -> 'slots' from jsonb_array_elements(pg_temp.range(p_user, p_day, p_day, true, p_tenant)::jsonb -> 'slots') e
                    where e ->> 'doctor_id' = pg_temp.uid(p_doctor)::text and e ->> 'date' = p_day::text), '[]'::jsonb)::text
$f$;
-- The same (doctor, date) from public.available_slots (the list the booking commands check), as the same user, in the same form.
create function pg_temp.slots_of(p_user text, p_doctor text, p_day date, p_zone text default 'Asia/Kolkata') returns text language sql as $f$
  select pg_temp.as_user(pg_temp.uid(p_user), format($q$
    select coalesce(jsonb_agg(jsonb_build_array(
             (extract(hour from (a.slot_start at time zone %L)) * 60 + extract(minute from (a.slot_start at time zone %L)))::integer,
             round(extract(epoch from (a.slot_end - a.slot_start)) / 60)::integer) order by a.slot_start), '[]'::jsonb)::text
      from public.available_slots(%L, %L) a $q$, p_zone, p_zone, pg_temp.uid(p_doctor), p_day))
$f$;

-- 1. Grants and shape -------------------------------------------------------------------------------------------------------
select is((select p.prosecdef::text || ':' || p.provolatile::text || ':' || array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'public.schedule_range(uuid, date, date, boolean)'::regprocedure),
  'false:s:search_path=""', 'schedule_range is a STABLE INVOKER function with search_path pinned');
select is((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text)
             from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid = 'public.schedule_range(uuid, date, date, boolean)'::regprocedure and a.grantee <> p.proowner),
  'authenticated:EXECUTE', 'EXECUTE is granted to authenticated only (not PUBLIC, anon or service_role)');
select throws_ok($$ set local role anon; select public.schedule_range('c1300000-0000-4000-8000-00000000000a', current_date, current_date) $$, '42501', null, 'anon cannot execute it');
select throws_ok($$ set local role service_role; select public.schedule_range('c1300000-0000-4000-8000-00000000000a', current_date, current_date) $$, '42501', null, 'service_role cannot execute it (no service-role path)');

-- 2. Refusals: all NULL; every member role answers ----------------------------------------------------------------------------
select is(pg_temp.range('201', pg_temp.d(0), pg_temp.d(6)), 'NULL', 'the owner of B asking for A gets NULL (a forged tenant): no visit of A comes back');
select is(pg_temp.range('101', pg_temp.d(0), pg_temp.d(6), true, 'c1300000-0000-4000-8000-00000000000b'), 'NULL', 'the owner of A asking for B gets NULL');
select is(pg_temp.range('301', pg_temp.d(0), pg_temp.d(6)), 'NULL', 'a user with no membership gets NULL');
select is(pg_temp.range('401', pg_temp.d(0), pg_temp.d(6), true, 'c1300000-0000-4000-8000-00000000000c'), 'NULL', 'the owner of a clinic that is not full gets NULL for it');
select is(pg_temp.range('101', pg_temp.d(0), pg_temp.d(6), true, 'c1300000-0000-4000-8000-0000000000ff'), 'NULL', 'an unknown tenant gets NULL');
select is((select coalesce(public.schedule_range('c1300000-0000-4000-8000-00000000000a', pg_temp.d(0), pg_temp.d(6))::text, 'NULL')), 'NULL', 'no session gets NULL');
select is(pg_temp.as_user(pg_temp.uid('101'), $q$ select coalesce(public.schedule_range(null, current_date, current_date)::text, 'NULL') $q$), 'NULL', 'a NULL tenant gets NULL');
select is(pg_temp.as_user(pg_temp.uid('101'), $q$ select coalesce(public.schedule_range('c1300000-0000-4000-8000-00000000000a', null, current_date)::text, 'NULL') $q$), 'NULL', 'a NULL from gets NULL');
select is(pg_temp.as_user(pg_temp.uid('101'), $q$ select coalesce(public.schedule_range('c1300000-0000-4000-8000-00000000000a', current_date, null)::text, 'NULL') $q$), 'NULL', 'a NULL to gets NULL');
select is(pg_temp.as_user(pg_temp.uid('101'), $q$ select coalesce(public.schedule_range('c1300000-0000-4000-8000-00000000000a', current_date, current_date, null)::text, 'NULL') $q$), 'NULL', 'a NULL include_slots gets NULL');
select is(pg_temp.range('101', pg_temp.d(6), pg_temp.d(0)), 'NULL', 'a reversed range gets NULL');
select is(pg_temp.range('101', pg_temp.d(0), pg_temp.d(42)), 'NULL', '43 days get NULL');
select isnt(pg_temp.range('101', pg_temp.d(0), pg_temp.d(41)), 'NULL', '42 days answer');
select is(jsonb_array_length(pg_temp.range('101', pg_temp.d(0), pg_temp.d(41))::jsonb -> 'visits'), 6, 'the 42-day range holds every visit of A in it (the first week''s five that are not cancelled, and M+14)');
select is((select string_agg(r, ',' order by r) from unnest(array['101', '102', '105', '106', '107']) r where pg_temp.range(r, pg_temp.d(0), pg_temp.d(0)) <> 'NULL'),
  '101,102,105,106,107', 'every member role of A answers (owner, doctor, receptionist, nurse, admin: all hold appointments:view)');

-- 3. Exact key sets -------------------------------------------------------------------------------------------------------------
create temp table w on commit drop as select pg_temp.range('105', pg_temp.d(0), pg_temp.d(6))::jsonb as j;
select is((select string_agg(k, ',' order by k) from w, jsonb_object_keys(j) k), 'blocks,clinicians,server_now,slots,versions,visits,waitlist,zone', 'the answer''s keys');
select is((select string_agg(k, ',' order by k) from w, jsonb_object_keys(pg_temp.range('105', pg_temp.d(0), pg_temp.d(6), false)::jsonb) k),
  'blocks,clinicians,server_now,versions,visits,waitlist,zone', 'p_include_slots false: no slots key');
select is((select string_agg(distinct k, ',' order by k) from w, jsonb_array_elements(j -> 'clinicians') c, jsonb_object_keys(c) k), 'full_name,id,schedule,slot_minutes,specialty', 'a clinician''s keys');
select is((select string_agg(distinct k, ',' order by k) from w, jsonb_array_elements(j -> 'visits') v, jsonb_object_keys(v) k),
  'clinic_confirmed,doctor_id,estimated_duration_minutes,id,is_overbooked,patient_confirmed,patient_id,patient_name,row_version,scheduled_at,signed_at,status', 'a visit''s keys: the card''s fields and row_version, nothing more');
select is((select string_agg(distinct k, ',' order by k) from w, jsonb_array_elements(j -> 'blocks') b, jsonb_object_keys(b) k), 'all_day,doctor_id,end_time,id,reason,start_time', 'a block''s keys');
select is((select string_agg(distinct k, ',' order by k) from w, jsonb_array_elements(j -> 'waitlist') e, jsonb_object_keys(e) k), 'created_at,doctor_id,id,patient_name,priority,target_date,time_window', 'a waitlist entry''s keys');
select is((select string_agg(distinct k, ',' order by k) from w, jsonb_array_elements(j -> 'slots') e, jsonb_object_keys(e) k), 'date,doctor_id,slots', 'a slot entry''s keys');
select is((select string_agg(k, ',' order by k) from w, jsonb_object_keys(j -> 'versions') k), 'queue,schedule', 'the versions: schedule and queue');
select is((select j ->> 'zone' from w), 'Asia/Kolkata', 'the zone is the clinic''s');
select ok((select abs(extract(epoch from ((j ->> 'server_now')::timestamptz - now()))) < 1 from w), 'server_now is the statement''s now()');

-- 4. Versions from the same snapshot -------------------------------------------------------------------------------------------
select is((select (j -> 'versions' ->> 'schedule')::bigint from w), (select version from public.clinic_versions where tenant_id = 'c1300000-0000-4000-8000-00000000000a' and domain = 'schedule'), 'versions.schedule equals clinic_versions');
select is((select (j -> 'versions' ->> 'queue')::bigint from w), (select version from public.clinic_versions where tenant_id = 'c1300000-0000-4000-8000-00000000000a' and domain = 'queue'), 'versions.queue equals clinic_versions');

-- 5. Rows -------------------------------------------------------------------------------------------------------------------------
select is((select string_agg(right(v ->> 'id', 4), ',' order by v ->> 'id') from w, jsonb_array_elements(j -> 'visits') v), '2001,2002,2004,2005,2006',
  'the week''s visits of A: booked, overbooked, no-show, confirmed, doctor 2''s; not the cancelled one, not M+14, not M-1, not B''s');
select is((select v ->> 'patient_name' from w, jsonb_array_elements(j -> 'visits') v where v ->> 'id' like '%2001'), 'Synthetic Range Patient One', 'a visit carries its patient''s name');
select is((select (v ->> 'row_version')::bigint from w, jsonb_array_elements(j -> 'visits') v where v ->> 'id' like '%2001'),
  (select row_version from public.visits where id = 'c1300000-0000-4000-8000-000000002001'), 'a visit carries its row_version');
select is((select string_agg(right(b ->> 'id', 4), ',' order by b ->> 'id') from w, jsonb_array_elements(j -> 'blocks') b), '5001,5003',
  'blocks that touch the week (the doctor block at M+7 09:00 is outside: see below), none of B''s, not M+30');
select is((select string_agg(right(e ->> 'id', 4), ',' order by e ->> 'id') from w, jsonb_array_elements(j -> 'waitlist') e), '6001', 'waiting entries of the week only');
select is((select string_agg(right(c ->> 'id', 3), ',' order by c ->> 'id') from w, jsonb_array_elements(j -> 'clinicians') c), '101,102,103,104',
  'clinicians: the practising owner and the active doctors; not the admin, the receptionist, the nurse or the removed doctor');
select is((select c -> 'schedule' from w, jsonb_array_elements(j -> 'clinicians') c where c ->> 'id' like '%103'), private.effective_schedule(null),
  'a NULL weekly schedule is returned as the clinic default (the same as private.effective_schedule)');
select is((select string_agg((c ->> 'slot_minutes'), ',' order by c ->> 'id') from w, jsonb_array_elements(j -> 'clinicians') c), '15,15,5,45', 'slot minutes: default 15, as stored');
select is((select count(*)::int from w, jsonb_array_elements(j -> 'clinicians') c where c ->> 'id' like '%101' and c ->> 'full_name' = 'Synthetic Owner A'), 1, 'a clinician carries their full name');
update public.tenants set owner_is_practicing_doctor = false where id = 'c1300000-0000-4000-8000-00000000000a';
select is((select string_agg(right(c ->> 'id', 3), ',' order by c ->> 'id') from jsonb_array_elements(pg_temp.range('105', pg_temp.d(0), pg_temp.d(0))::jsonb -> 'clinicians') c), '102,103,104',
  'an owner who does not practise is no clinician');
update public.tenants set owner_is_practicing_doctor = true where id = 'c1300000-0000-4000-8000-00000000000a';
select is((select string_agg(right(b ->> 'id', 4), ',' order by b ->> 'id') from jsonb_array_elements(pg_temp.range('105', pg_temp.d(7), pg_temp.d(7))::jsonb -> 'blocks') b), '5002',
  'the next Monday''s range holds the doctor block of that day');
select is((select count(*)::int from jsonb_array_elements(pg_temp.range('105', pg_temp.d(0), pg_temp.d(6))::jsonb -> 'slots') e
            where e ->> 'date' not between pg_temp.d(0)::text and pg_temp.d(6)::text or e ->> 'doctor_id' not in (select c ->> 'id' from w, jsonb_array_elements(j -> 'clinicians') c)), 0,
  'slot entries are only for the range''s dates and the clinicians');
select is((select count(*)::int from w, jsonb_array_elements(j -> 'slots') e where jsonb_array_length(e -> 'slots') = 0), 0, 'a (doctor, date) with no free slot is left out');

-- 6. Slots equal public.available_slots: 25 cases -------------------------------------------------------------------------------
select is(pg_temp.range_slots('105', '101', pg_temp.d(0)), pg_temp.slots_of('105', '101', pg_temp.d(0)), 'slots 1: the owner, default hours, Monday (doctor 2''s booking is not the owner''s)');
select is(pg_temp.range_slots('105', '101', pg_temp.d(5)), pg_temp.slots_of('105', '101', pg_temp.d(5)), 'slots 2: the owner, default hours, Saturday');
select is(pg_temp.range_slots('105', '101', pg_temp.d(6)), '[]', 'slots 3: the owner on Sunday (a disabled day): none');
select is(pg_temp.slots_of('105', '101', pg_temp.d(6)), '[]', 'slots 3b: available_slots agrees: none on Sunday');
select is(pg_temp.range_slots('105', '102', pg_temp.d(0)), pg_temp.slots_of('105', '102', pg_temp.d(0)), 'slots 4: doctor 1, two shifts on Monday');
select is(pg_temp.range_slots('105', '102', pg_temp.d(0)), '[[540, 15], [555, 15], [570, 15], [585, 15], [840, 15], [855, 15], [870, 15], [885, 15]]', 'slots 4b: the two shifts in clinic minutes (09:00 .. 09:45, 14:00 .. 14:45)');
select is(pg_temp.range_slots('105', '102', pg_temp.d(1)), pg_temp.slots_of('105', '102', pg_temp.d(1)), 'slots 5: doctor 1 on Tuesday, a disabled day with shifts listed: none');
select is(pg_temp.range_slots('105', '102', pg_temp.d(2)), pg_temp.slots_of('105', '102', pg_temp.d(2)), 'slots 6: doctor 1 on Wednesday 00:30-03:00 IST (the previous UTC day)');
select is((pg_temp.range_slots('105', '102', pg_temp.d(2))::jsonb -> 0 ->> 0)::int, 30, 'slots 6b: the night shift''s first slot is 00:30 on the clinic date, not the UTC one');
select is(pg_temp.range_slots('105', '103', pg_temp.d(0)), pg_temp.slots_of('105', '103', pg_temp.d(0)), 'slots 7: doctor 2, 5-minute slots, with a 20-minute booking at 10:20 taking four');
select ok(not (pg_temp.range_slots('105', '103', pg_temp.d(0))::jsonb @> '[[620, 5]]'::jsonb) and pg_temp.range_slots('105', '103', pg_temp.d(0))::jsonb @> '[[640, 5]]'::jsonb,
  'slots 7b: 10:20 is taken, 10:40 is free');
select is(pg_temp.range_slots('105', '104', pg_temp.d(0)), pg_temp.slots_of('105', '104', pg_temp.d(0)), 'slots 8: doctor 3, 45-minute slots');
select is(pg_temp.range_slots('105', '101', pg_temp.d(3)), pg_temp.slots_of('105', '101', pg_temp.d(3)), 'slots 9: the owner on Thursday with a clinic-wide block 10:00-11:00');
select ok(not (pg_temp.range_slots('105', '101', pg_temp.d(3))::jsonb @> '[[600, 15]]'::jsonb), 'slots 9b: 10:00 is blocked');
select is(pg_temp.range_slots('105', '104', pg_temp.d(3)), pg_temp.slots_of('105', '104', pg_temp.d(3)), 'slots 10: doctor 3 under the same clinic-wide block');
select is(pg_temp.range_slots('105', '102', pg_temp.d(7)), pg_temp.slots_of('105', '102', pg_temp.d(7)), 'slots 11: doctor 1 on the next Monday with their own block 09:00-09:30');
select is(pg_temp.range_slots('105', '101', pg_temp.d(4)), pg_temp.slots_of('105', '101', pg_temp.d(4)), 'slots 12: the owner on Friday: booked, overbooked, cancelled, no-show, confirmed');
select is((select string_agg(m::text, ',' order by m) from unnest(array[600, 615, 630, 645, 660]) m where pg_temp.range_slots('105', '101', pg_temp.d(4))::jsonb @> jsonb_build_array(jsonb_build_array(m, 15))),
  '600,630,645', 'slots 12b: 10:00 free (the overbooked visit holds no slot), 10:15 booked, 10:30 free (cancelled), 10:45 free (no-show), 11:00 confirmed');
select is(pg_temp.range_slots('105', '104', pg_temp.d(5)), '[]', 'slots 13: doctor 3 on a Saturday blocked all day: none');
select is(pg_temp.slots_of('105', '104', pg_temp.d(5)), '[]', 'slots 13b: available_slots agrees');
select is(pg_temp.range_slots('105', '103', pg_temp.d(1)), pg_temp.slots_of('105', '103', pg_temp.d(1)), 'slots 14: doctor 2, default hours, Tuesday');
select is(pg_temp.range_slots('105', '103', pg_temp.d(5)), pg_temp.slots_of('105', '103', pg_temp.d(5)), 'slots 15: doctor 2, default hours, Saturday');
select is(pg_temp.range_slots('105', '102', pg_temp.d(3)), '[]', 'slots 16: doctor 1 on Thursday (off): none');
select is(pg_temp.range_slots('105', '101', pg_temp.d(-35)), pg_temp.slots_of('105', '101', pg_temp.d(-35)), 'slots 17: the owner on a day in the past: none on either side');
select is(pg_temp.range_slots('105', '101', current_date), pg_temp.slots_of('105', '101', current_date), 'slots 18: the owner today: the slots that have started are left out on both sides');
-- Case 19 records a finding of the slot rule itself (private.available_slots_core, 000103; not changed here): on the spring-forward Sunday a shift across the missing
-- hour makes a slot whose end is before its start (02:30 EST .. 03:00 EDT) and tstzrange raises 22000. available_slots raises it today; schedule_range raises the same
-- (one rule): the range read fails for such a clinic and range exactly as the old per-day reads failed. Asia/Kolkata has no daylight saving. 09E-NOTES, PO question.
select is(pg_temp.range('501', date '2031-03-09', date '2031-03-09', true, 'c1300000-0000-4000-8000-00000000000d'), 'error:22000',
  'slots 19: New York, the spring-forward Sunday with a shift across the missing hour: the range read raises 22000 ...');
select is(pg_temp.slots_of('501', '501', date '2031-03-09', 'America/New_York'), 'error:22000', 'slots 19b: ... exactly as public.available_slots does (the same rule)');
select is(pg_temp.range_slots('501', '501', date '2031-03-16', 'c1300000-0000-4000-8000-00000000000d'), pg_temp.slots_of('501', '501', date '2031-03-16', 'America/New_York'),
  'slots 20: New York, an ordinary Sunday');
select is(pg_temp.range_slots('501', '501', date '2031-03-16', 'c1300000-0000-4000-8000-00000000000d'), '[[60, 30], [90, 30], [120, 30], [150, 30], [180, 30], [210, 30]]',
  'slots 20b: an ordinary Sunday is six 30-minute slots from 01:00');
select is(pg_temp.range_slots('501', '501', date '2031-11-02', 'c1300000-0000-4000-8000-00000000000d'), pg_temp.slots_of('501', '501', date '2031-11-02', 'America/New_York'),
  'slots 21: New York, the fall-back Sunday (01:00-04:00 across the repeated hour)');
select is(pg_temp.range_slots('501', '501', date '2031-03-10', 'c1300000-0000-4000-8000-00000000000d'), '[]', 'slots 22: New York on a Monday (off): none');
select is(pg_temp.range_slots('105', '104', pg_temp.d(7)), pg_temp.slots_of('105', '104', pg_temp.d(7)), 'slots 23: doctor 3 on the next Monday');
select is(pg_temp.range_slots('105', '101', pg_temp.d(14)), pg_temp.slots_of('105', '101', pg_temp.d(14)), 'slots 24: the owner two weeks on, with a booking at 10:00');
select is(pg_temp.range_slots('105', '102', pg_temp.d(9)), pg_temp.slots_of('105', '102', pg_temp.d(9)), 'slots 25: doctor 1 the next Wednesday (night shift again)');

select * from finish();
rollback;
