-- scheduling_exclusion.test.sql — V2-05 plan 05-08 (P1-39, DB-08; R-11; threat T-05-20; roadmap V2-05 acceptance 6
-- "two overlapping non-overbooked appointments cannot both be inserted").
-- The `visits_no_double_booking` exclusion constraint and its IMMUTABLE slot wrapper:
--   1. catalogue: the constraint exists, is an exclusion constraint, is valid, with the D6 predicate; `visit_slot` is
--      IMMUTABLE, pins search_path, and is executable by the inserting roles only (not PUBLIC or anon);
--   2. the slot is half-open ([start, start + minutes)) and independent of the session TimeZone;
--   3. inserts: a second overlapping non-overbooked scheduled visit of the same doctor in the same clinic -> 23P01;
--      overbooked, back-to-back, cancelled, no-show, walk-in, other doctor, other clinic, and a scheduled visit
--      without a time -> allowed;
--   4. updates: moving a visit into a taken slot, restoring a cancelled overlap, or clearing an overbook flag -> 23P01;
--   5. through the API role: a receptionist (authenticated, acting in the clinic) gets 23P01 for the overlap and
--      books a free slot (the EXECUTE grant the index expression needs).
-- Synthetic data only; the file rolls back.
begin;
select plan(26);

insert into auth.users (id, email) values
  ('c0800000-0000-4000-8000-000000000101', 'c08-owner-a@example.test'),
  ('c0800000-0000-4000-8000-000000000102', 'c08-doctor-a@example.test'),
  ('c0800000-0000-4000-8000-000000000103', 'c08-doctor2-a@example.test'),
  ('c0800000-0000-4000-8000-000000000104', 'c08-receptionist-a@example.test'),
  ('c0800000-0000-4000-8000-000000000201', 'c08-owner-b@example.test');
insert into public.tenants (id, name) values
  ('c0800000-0000-4000-8000-00000000000a', 'Synthetic 05-08 Clinic A'),
  ('c0800000-0000-4000-8000-00000000000b', 'Synthetic 05-08 Clinic B');
insert into public.memberships (user_id, tenant_id, role) values
  ('c0800000-0000-4000-8000-000000000101', 'c0800000-0000-4000-8000-00000000000a', 'owner'),
  ('c0800000-0000-4000-8000-000000000102', 'c0800000-0000-4000-8000-00000000000a', 'doctor'),
  ('c0800000-0000-4000-8000-000000000103', 'c0800000-0000-4000-8000-00000000000a', 'doctor'),
  ('c0800000-0000-4000-8000-000000000104', 'c0800000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c0800000-0000-4000-8000-000000000201', 'c0800000-0000-4000-8000-00000000000b', 'owner'),
  -- the same doctor also works in clinic B
  ('c0800000-0000-4000-8000-000000000102', 'c0800000-0000-4000-8000-00000000000b', 'doctor');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c0800000-0000-4000-8000-000000001001', 'c0800000-0000-4000-8000-00000000000a', 'Synthetic 05-08 Patient A', '+919000000801', 'c0800000-0000-4000-8000-000000000101'),
  ('c0800000-0000-4000-8000-000000002001', 'c0800000-0000-4000-8000-00000000000b', 'Synthetic 05-08 Patient B', '+919000000802', 'c0800000-0000-4000-8000-000000000201');

-- Visit inserts in clinic A for doctor 102 at 2030-01-07 (a Monday), patient A, created by the owner.
create function pg_temp.book(p_id text, p_at text, p_mins int default 15, p_overbooked boolean default false,
                             p_status text default 'booked', p_origin text default 'scheduled',
                             p_doctor text default 'c0800000-0000-4000-8000-000000000102',
                             p_tenant text default 'c0800000-0000-4000-8000-00000000000a',
                             p_patient text default 'c0800000-0000-4000-8000-000000001001') returns text
language sql as $f$
  select format(
    $i$insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at,
                                  estimated_duration_minutes, is_overbooked, created_by)
       values (%L, %L, %L, %L, %L, %L, %s, %s, %L, 'c0800000-0000-4000-8000-000000000101')$i$,
    'c0800000-0000-4000-8000-0000000030' || p_id, p_tenant, p_patient, p_doctor, p_origin, p_status,
    case when p_at is null then 'null' else quote_literal('2030-01-07 ' || p_at || '+05:30') end, p_mins, p_overbooked)
$f$;

-- 1. Catalogue --------------------------------------------------------------------------------------------------------
select is(
  (select contype::text || ':' || convalidated::text from pg_constraint
    where conrelid = 'public.visits'::regclass and conname = 'visits_no_double_booking'),
  'x:true', 'visits_no_double_booking is a valid exclusion constraint');
select matches(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.visits'::regclass and conname = 'visits_no_double_booking'),
  'EXCLUDE USING gist \(tenant_id WITH =, doctor_id WITH =, visit_slot\(scheduled_at, estimated_duration_minutes\) WITH &&\) WHERE \(\(\(origin_type = ''scheduled''::text\) AND \(scheduled_at IS NOT NULL\) AND \(NOT is_overbooked\) AND \(status <> ALL \(ARRAY\[''cancelled''::text, ''no_show''::text\]\)\)\)\)',
  'the constraint covers (clinic, doctor, slot) for scheduled, timed, non-overbooked, live visits (diagnostics D6)');
select is(
  (select provolatile::text || ':' || prosecdef::text || ':' || array_to_string(proconfig, ',') from pg_proc
    where oid = 'public.visit_slot(timestamptz, integer)'::regprocedure),
  'i:false:search_path=""', 'visit_slot is IMMUTABLE, SECURITY INVOKER, search_path pinned');
select is(
  array[has_function_privilege('anon', 'public.visit_slot(timestamptz, integer)', 'EXECUTE'),
        has_function_privilege('authenticated', 'public.visit_slot(timestamptz, integer)', 'EXECUTE'),
        has_function_privilege('service_role', 'public.visit_slot(timestamptz, integer)', 'EXECUTE')],
  array[false, true, true], 'visit_slot: EXECUTE for the inserting roles only (not anon)');

-- 2. The slot -----------------------------------------------------------------------------------------------------------
select is(public.visit_slot('2030-01-07 10:00+05:30', 15), tstzrange('2030-01-07 10:00+05:30', '2030-01-07 10:15+05:30', '[)'),
  'visit_slot is [start, start + minutes)');
set local timezone = 'America/New_York';
select is(public.visit_slot('2030-03-10 01:50-05:00', 30), tstzrange('2030-03-10 06:50+00', '2030-03-10 07:20+00', '[)'),
  'visit_slot does not depend on TimeZone (30 minutes across a DST change are 30 minutes)');
reset timezone;

-- 3. Inserts ------------------------------------------------------------------------------------------------------------
select lives_ok(pg_temp.book('01', '10:00'), 'a scheduled visit 10:00-10:15 is booked');
select throws_ok(pg_temp.book('02', '10:05'), '23P01', null,
  'a second overlapping non-overbooked visit (10:05) of the same doctor is refused (before: inserted)');
select throws_ok(pg_temp.book('03', '09:50'), '23P01', null, 'an overlap from the left (09:50-10:05) is refused');
select throws_ok(pg_temp.book('04', '09:30', 60), '23P01', null, 'a longer visit enclosing the slot (09:30-10:30) is refused');
select lives_ok(pg_temp.book('05', '10:05', 15, true), 'the same overlap marked is_overbooked is allowed');
select lives_ok(pg_temp.book('06', '10:15'), 'back-to-back 10:15-10:30 is allowed (half-open slots)');
select lives_ok(pg_temp.book('07', '09:45'), 'back-to-back 09:45-10:00 is allowed');
select lives_ok(pg_temp.book('08', '10:00', 15, false, 'cancelled'), 'a cancelled visit in the slot is allowed');
select lives_ok(pg_temp.book('09', '10:00', 15, false, 'no_show'), 'a no-show visit in the slot is allowed');
select lives_ok(pg_temp.book('10', '10:00', 15, false, 'waiting', 'walk_in'), 'a walk-in at the same time is allowed');
select lives_ok(pg_temp.book('11', '10:00', 15, false, 'booked', 'scheduled', 'c0800000-0000-4000-8000-000000000103'),
  'another doctor at the same time is allowed');
select lives_ok(pg_temp.book('12', '10:00', 15, false, 'booked', 'scheduled', 'c0800000-0000-4000-8000-000000000102',
                             'c0800000-0000-4000-8000-00000000000b', 'c0800000-0000-4000-8000-000000002001'),
  'the same doctor in another clinic at the same time is allowed');
select lives_ok(pg_temp.book('13', null), 'a scheduled visit without a time is allowed');
select lives_ok(pg_temp.book('14', null), 'a second one without a time is allowed too (no unbounded slot)');

-- 4. Updates ------------------------------------------------------------------------------------------------------------
select throws_ok($$update public.visits set scheduled_at = '2030-01-07 10:10+05:30' where id = 'c0800000-0000-4000-8000-000000003006'$$,
  '23P01', null, 'rescheduling the 10:15 visit into the taken slot (10:10) is refused');
select throws_ok($$update public.visits set status = 'booked' where id = 'c0800000-0000-4000-8000-000000003008'$$,
  '23P01', null, 'restoring the cancelled overlap to booked is refused');
select throws_ok($$update public.visits set is_overbooked = false where id = 'c0800000-0000-4000-8000-000000003005'$$,
  '23P01', null, 'clearing the overbook flag of the overlapping visit is refused');
select lives_ok($$update public.visits set estimated_duration_minutes = 15, reason_for_visit = 'Synthetic' where id = 'c0800000-0000-4000-8000-000000003001'$$,
  'updating a booked visit in place does not conflict with itself');

-- 5. As a receptionist through the API role ------------------------------------------------------------------------------
set local role authenticated;
do $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c0800000-0000-4000-8000-000000000104', 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c0800000-0000-4000-8000-00000000000a')::text, true);
end
$$;
select throws_ok(
  $$insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at, created_by)
    values ('c0800000-0000-4000-8000-00000000000a', 'c0800000-0000-4000-8000-000000001001', 'c0800000-0000-4000-8000-000000000102',
            'scheduled', 'booked', '2030-01-07 10:10+05:30', 'c0800000-0000-4000-8000-000000000104')$$,
  '23P01', null, 'receptionist: an overlapping booking is refused with 23P01 (not a privilege error)');
select lives_ok(
  $$insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at, created_by)
    values ('c0800000-0000-4000-8000-00000000000a', 'c0800000-0000-4000-8000-000000001001', 'c0800000-0000-4000-8000-000000000102',
            'scheduled', 'booked', '2030-01-07 11:00+05:30', 'c0800000-0000-4000-8000-000000000104')$$,
  'receptionist: a free slot is booked');
reset role;

select * from finish();
rollback;
