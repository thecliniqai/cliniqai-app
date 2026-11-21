-- front_desk_review_fixes.test.sql — V2-08 08-06a (migration 000106; review rows A-2, A-3, A-5, S-1..S-8).
--   S-1/S-2/S-8  authenticated holds no INSERT on visits and patients and no INSERT/UPDATE on waitlist_entries; a direct write is
--                refused at the privilege level for every role; the definer commands (enqueue_walk_in, add_to_waitlist, register_patient)
--                still insert; UPDATE on patients stays.
--   S-3          visits.metadata, written directly by a member: needs consultations:edit, an open draft, only ai_assisted and
--                ai_sections_used (typed, bounded), at most 8 KB; the definer cancel_visit and a privileged writer are not restricted.
--   S-4          complete_visit at the desk: a waiting visit completes, an in_consultation visit is refused (VISIT_NOT_COMPLETABLE).
--   S-5          the five legacy actions are not in private.audit_client_actions(); log_audit refuses them; step_create_visit still
--                writes visit.create (through log_command_audit).
--   S-6          the anon reschedule context carries no other appointment's time.
--   S-7          the Realtime read policy checks the row's own topic: with the session topic of A, B's rows are invisible.
--   A-2          the waitlist promotion skips a blocked and an off-duty slot; cancelling for doctor_unavailable / clinic_closed never
--                promotes; the control promotes.
--   A-3          a late no-show whose slot was rebooked is checked in (and started) as an overbooked visit; one whose slot is free is not.
--   A-5          an invoice insert and a change of its total or status signal the Today board; a write of another column does not.
-- Synthetic data only; every probe and the file roll back.
begin;
select plan(54);

-- Fixtures: clinic A (owner, doctor D1 and D2 with the column-default schedule, nurse, receptionist), clinic B (owner, doctor) ----------------
insert into auth.users (id, email) values
  ('c1060000-0000-4000-8000-000000000101', 'c106-owner@example.test'),
  ('c1060000-0000-4000-8000-000000000103', 'c106-doctor1@example.test'),
  ('c1060000-0000-4000-8000-000000000104', 'c106-doctor2@example.test'),
  ('c1060000-0000-4000-8000-000000000105', 'c106-nurse@example.test'),
  ('c1060000-0000-4000-8000-000000000106', 'c106-receptionist@example.test'),
  ('c1060000-0000-4000-8000-000000000201', 'c106-owner-b@example.test'),
  ('c1060000-0000-4000-8000-000000000203', 'c106-doctor-b@example.test');
insert into public.tenants (id, name) values
  ('c1060000-0000-4000-8000-00000000000a', 'Synthetic 08-06a Clinic A'),
  ('c1060000-0000-4000-8000-00000000000b', 'Synthetic 08-06a Clinic B');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1060000-0000-4000-8000-00000000000a', 'c1060000-0000-4000-8000-00000000000b');
insert into public.memberships (user_id, tenant_id, role, full_name) values
  ('c1060000-0000-4000-8000-000000000101', 'c1060000-0000-4000-8000-00000000000a', 'owner', 'Synthetic Owner'),
  ('c1060000-0000-4000-8000-000000000103', 'c1060000-0000-4000-8000-00000000000a', 'doctor', 'Synthetic Doctor One'),
  ('c1060000-0000-4000-8000-000000000104', 'c1060000-0000-4000-8000-00000000000a', 'doctor', 'Synthetic Doctor Two'),
  ('c1060000-0000-4000-8000-000000000105', 'c1060000-0000-4000-8000-00000000000a', 'nurse', 'Synthetic Nurse'),
  ('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a', 'receptionist', 'Synthetic Receptionist'),
  ('c1060000-0000-4000-8000-000000000201', 'c1060000-0000-4000-8000-00000000000b', 'owner', 'Synthetic Owner B'),
  ('c1060000-0000-4000-8000-000000000203', 'c1060000-0000-4000-8000-00000000000b', 'doctor', 'Synthetic Doctor B');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1060000-0000-4000-8000-000000001001', 'c1060000-0000-4000-8000-00000000000a', 'Synthetic Patient One', '+919000001061', 'c1060000-0000-4000-8000-000000000101'),
  ('c1060000-0000-4000-8000-000000001002', 'c1060000-0000-4000-8000-00000000000a', 'Synthetic Patient Two', '+919000001062', 'c1060000-0000-4000-8000-000000000101'),
  ('c1060000-0000-4000-8000-000000001003', 'c1060000-0000-4000-8000-00000000000a', 'Synthetic Patient Three', '+919000001063', 'c1060000-0000-4000-8000-000000000101');

-- A Monday two weeks ahead in the clinic's zone (D1 works Mon 10:00-13:00 and 17:00-21:00 by the column default).
create temp table d(mon date) on commit drop;
insert into d select (date_trunc('week', now() at time zone 'Asia/Kolkata') + interval '14 days')::date;
create function pg_temp.ist(p_date date, p_time time) returns timestamptz language sql immutable as $$
  select (p_date + p_time) at time zone 'Asia/Kolkata'
$$;

-- Placeholders the probes substitute before they switch role (an API role cannot read the temp objects above).
create temp table ph(token text primary key, val text not null) on commit drop;
insert into ph select '{MON}', mon::text from d;
insert into ph select '{MON_' || to_char(t, 'HH24MI') || '}', pg_temp.ist(d.mon, t)::text
  from d, (values (time '10:00'), (time '10:15'), (time '10:30'), (time '10:45'), (time '11:00'), (time '14:00')) v(t);

-- Visits of D1 (the doctor), all booked: V1 10:00 (blocked below), V2 10:15, V3 10:30, V12 10:45, V11 11:00, V4 14:00 (off duty, between the shifts).
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at, estimated_duration_minutes, created_by)
select v.id, 'c1060000-0000-4000-8000-00000000000a', 'c1060000-0000-4000-8000-000000001001', 'c1060000-0000-4000-8000-000000000103',
       'scheduled', 'booked', pg_temp.ist(d.mon, v.t), 15, 'c1060000-0000-4000-8000-000000000101'
  from d, (values ('c1060000-0000-4000-8000-000000002001'::uuid, time '10:00'), ('c1060000-0000-4000-8000-000000002002'::uuid, time '10:15'),
                  ('c1060000-0000-4000-8000-000000002003'::uuid, time '10:30'), ('c1060000-0000-4000-8000-000000002004'::uuid, time '14:00'),
                  ('c1060000-0000-4000-8000-000000002011'::uuid, time '11:00'), ('c1060000-0000-4000-8000-000000002012'::uuid, time '10:45')) v(id, t);
insert into public.schedule_blocks (tenant_id, doctor_id, start_time, end_time, created_by)
select 'c1060000-0000-4000-8000-00000000000a', 'c1060000-0000-4000-8000-000000000103', pg_temp.ist(d.mon, time '10:00'), pg_temp.ist(d.mon, time '10:10'),
       'c1060000-0000-4000-8000-000000000101' from d;
-- An open consultation (V5), a signed completed visit (V6), a waiting visit (V7) of D1 today.
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1060000-0000-4000-8000-000000002005', 'c1060000-0000-4000-8000-00000000000a', 'c1060000-0000-4000-8000-000000001002', 'c1060000-0000-4000-8000-000000000103', 'walk_in', 'in_consultation', 'c1060000-0000-4000-8000-000000000101'),
  ('c1060000-0000-4000-8000-000000002007', 'c1060000-0000-4000-8000-00000000000a', 'c1060000-0000-4000-8000-000000001002', 'c1060000-0000-4000-8000-000000000103', 'walk_in', 'waiting', 'c1060000-0000-4000-8000-000000000101');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, signed_at, signed_by, created_by) values
  ('c1060000-0000-4000-8000-000000002006', 'c1060000-0000-4000-8000-00000000000a', 'c1060000-0000-4000-8000-000000001002', 'c1060000-0000-4000-8000-000000000103', 'walk_in', 'completed', now(), 'c1060000-0000-4000-8000-000000000103', 'c1060000-0000-4000-8000-000000000101');
-- Late no-shows: V8 and V13 (D1, at "now") whose slot V9 (booked, the same time) holds, and V10 (D2) whose slot is free.
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at, estimated_duration_minutes, created_by) values
  ('c1060000-0000-4000-8000-000000002008', 'c1060000-0000-4000-8000-00000000000a', 'c1060000-0000-4000-8000-000000001001', 'c1060000-0000-4000-8000-000000000103', 'scheduled', 'no_show', now(), 15, 'c1060000-0000-4000-8000-000000000101'),
  ('c1060000-0000-4000-8000-000000002009', 'c1060000-0000-4000-8000-00000000000a', 'c1060000-0000-4000-8000-000000001003', 'c1060000-0000-4000-8000-000000000103', 'scheduled', 'booked', now(), 15, 'c1060000-0000-4000-8000-000000000101'),
  ('c1060000-0000-4000-8000-000000002010', 'c1060000-0000-4000-8000-00000000000a', 'c1060000-0000-4000-8000-000000001003', 'c1060000-0000-4000-8000-000000000104', 'scheduled', 'no_show', now(), 15, 'c1060000-0000-4000-8000-000000000101'),
  ('c1060000-0000-4000-8000-000000002013', 'c1060000-0000-4000-8000-00000000000a', 'c1060000-0000-4000-8000-000000001002', 'c1060000-0000-4000-8000-000000000103', 'scheduled', 'no_show', now(), 15, 'c1060000-0000-4000-8000-000000000101');
-- A waiting waitlist entry (patient One, the Monday, any doctor).
insert into public.waitlist_entries (id, tenant_id, patient_id, target_date, created_by)
select 'c1060000-0000-4000-8000-000000005001', 'c1060000-0000-4000-8000-00000000000a', 'c1060000-0000-4000-8000-000000001001', d.mon, 'c1060000-0000-4000-8000-000000000101' from d;
-- A reschedule link for V2 (anon context probe) and a clinic-B visit.
insert into public.document_share_tokens (id, tenant_id, resource_type, resource_id, token_hash, created_by) values
  ('c1060000-0000-4000-8000-000000004001', 'c1060000-0000-4000-8000-00000000000a', 'appointment', 'c1060000-0000-4000-8000-000000002001',
   public.share_token_hash('c106-synthetic-reschedule-token-for-clinic-a-0001'), 'c1060000-0000-4000-8000-000000000101');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1060000-0000-4000-8000-000000001101', 'c1060000-0000-4000-8000-00000000000b', 'Synthetic Patient B', '+919000001064', 'c1060000-0000-4000-8000-000000000201');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1060000-0000-4000-8000-000000002101', 'c1060000-0000-4000-8000-00000000000b', 'c1060000-0000-4000-8000-000000001101', 'c1060000-0000-4000-8000-000000000203', 'walk_in', 'waiting', 'c1060000-0000-4000-8000-000000000201');

-- Helper: the first column of p_sql run as a signed-in user (anon when p_user is null), with the active-clinic header; 'denied:<message>' for
-- 42501, 'error:<sqlstate>:<message>' otherwise. A probe query runs afterwards as the owner of the session. Always rolled back.
create function pg_temp.val_as(p_user uuid, p_header uuid, p_sql text, p_probe text default null) returns text language plpgsql as $f$
declare
  v_out text;
  v_ph record;
  v_sql text := p_sql;
begin
  for v_ph in select * from ph loop
    v_sql := replace(v_sql, v_ph.token, v_ph.val);
  end loop;
  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims',
      case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
    perform set_config('request.headers',
      case when p_header is null then '' else json_build_object('x-clinicos-tenant', p_header)::text end, true);
    if p_user is null then set local role anon; else set local role authenticated; end if;
    if p_probe is null then
      execute v_sql into v_out;
    else
      execute v_sql;
      reset role;
      v_sql := p_probe;
      for v_ph in select * from ph loop
        v_sql := replace(v_sql, v_ph.token, v_ph.val);
      end loop;
      execute v_sql into v_out;
    end if;
    raise exception 'c106 sentinel' using errcode = 'P0S06';
  exception
    when sqlstate 'P0S06' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

-- 1. S-1, S-2, S-8: the grants -----------------------------------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.visits', 'INSERT')
      and not exists (select 1 from pg_attribute a where a.attrelid = 'public.visits'::regclass and a.attnum > 0 and not a.attisdropped
                         and has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT')),
  'S-1: authenticated holds no INSERT on visits, at table or column level');
select ok(has_table_privilege('service_role', 'public.visits', 'INSERT'), 'S-1: service_role keeps INSERT on visits (/api/v1)');
select ok(not has_table_privilege('authenticated', 'public.waitlist_entries', 'INSERT') and not has_table_privilege('authenticated', 'public.waitlist_entries', 'UPDATE')
      and not exists (select 1 from pg_attribute a where a.attrelid = 'public.waitlist_entries'::regclass and a.attnum > 0 and not a.attisdropped
                         and (has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT') or has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE'))),
  'S-2: authenticated holds no INSERT or UPDATE on waitlist_entries, at table or column level');
select ok(has_table_privilege('authenticated', 'public.waitlist_entries', 'SELECT'), 'S-2: and still reads waitlist_entries');
select ok(not has_table_privilege('authenticated', 'public.patients', 'INSERT')
      and not exists (select 1 from pg_attribute a where a.attrelid = 'public.patients'::regclass and a.attnum > 0 and not a.attisdropped
                         and has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT')),
  'S-8: authenticated holds no INSERT on patients, at table or column level');
select ok(has_table_privilege('authenticated', 'public.patients', 'UPDATE'), 'S-8: UPDATE on patients stays (the profile edit)');

select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, status, created_by) values ('c1060000-0000-4000-8000-00000000000a', 'c1060000-0000-4000-8000-000000001001', 'c1060000-0000-4000-8000-000000000103', 'walk_in', 'completed', 'c1060000-0000-4000-8000-000000000106') returning 'x'$$),
  'denied:permission denied for table visits', 'S-1: a receptionist cannot insert a visit (the reviewer''s completed-visit forgery)');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000103', 'c1060000-0000-4000-8000-00000000000a',
  $$insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, created_by) values ('c1060000-0000-4000-8000-00000000000a', 'c1060000-0000-4000-8000-000000001001', 'c1060000-0000-4000-8000-000000000103', 'walk_in', 'c1060000-0000-4000-8000-000000000103') returning 'x'$$),
  'denied:permission denied for table visits', 'S-1: nor a doctor');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000101', 'c1060000-0000-4000-8000-00000000000a',
  $$insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, created_by) values ('c1060000-0000-4000-8000-00000000000a', 'c1060000-0000-4000-8000-000000001001', 'c1060000-0000-4000-8000-000000000103', 'walk_in', 'c1060000-0000-4000-8000-000000000101') returning 'x'$$),
  'denied:permission denied for table visits', 'S-1: nor the owner');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$insert into public.waitlist_entries (tenant_id, patient_id, target_date, created_by) values ('c1060000-0000-4000-8000-00000000000a', 'c1060000-0000-4000-8000-000000001001', current_date + 3, 'c1060000-0000-4000-8000-000000000101') returning 'x'$$),
  'denied:permission denied for table waitlist_entries', 'S-2: a receptionist cannot insert a waitlist entry (forged attribution)');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$update public.waitlist_entries set status = 'waiting' where tenant_id = 'c1060000-0000-4000-8000-00000000000a' returning 'x'$$),
  'denied:permission denied for table waitlist_entries', 'S-2: nor update one (re-open a promoted entry)');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$insert into public.patients (tenant_id, full_name, phone, created_by) values ('c1060000-0000-4000-8000-00000000000a', 'Synthetic Direct', '9000001099', 'c1060000-0000-4000-8000-000000000106') returning 'x'$$),
  'denied:permission denied for table patients', 'S-8: a receptionist cannot insert a patient (no phone normalisation, no audit)');

select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$select public.enqueue_walk_in('c1060000-0000-4000-8000-00000000000a'::uuid, 'c1060000-0000-4000-8000-000000001001', null, 'c1060000-0000-4000-8000-000000000103', 'normal', 'c1060000-0000-4000-8000-0000000c0001')$$,
  $$select (select count(*) from public.visits where tenant_id = 'c1060000-0000-4000-8000-00000000000a' and reason_for_visit is null and origin_type = 'walk_in' and status = 'waiting' and created_by = 'c1060000-0000-4000-8000-000000000106')::text
         || ':' || (select count(*) from public.audit_logs where tenant_id = 'c1060000-0000-4000-8000-00000000000a' and action = 'visit.create' and actor_id = 'c1060000-0000-4000-8000-000000000106' and actor_role = 'receptionist')::text$$),
  '1:1', 'the walk-in command still inserts the visit (definer) and writes its visit.create audit row through the command-only writer (S-5)');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$select public.add_to_waitlist('c1060000-0000-4000-8000-00000000000a'::uuid, 'c1060000-0000-4000-8000-000000001001', '{MON}'::date, 'c1060000-0000-4000-8000-0000000c0002')$$,
  $$select count(*)::text from public.waitlist_entries where tenant_id = 'c1060000-0000-4000-8000-00000000000a' and target_date = '{MON}'::date and created_by = 'c1060000-0000-4000-8000-000000000106'$$),
  '1', 'add_to_waitlist still inserts the entry (definer), attributed to the caller');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$select public.register_patient('c1060000-0000-4000-8000-00000000000a'::uuid, '{"full_name": "Synthetic Registered", "phone": "9000001098", "age": 30}'::jsonb, 'c1060000-0000-4000-8000-0000000c0003')$$,
  $$select p.phone from public.patients p where p.tenant_id = 'c1060000-0000-4000-8000-00000000000a' and p.full_name = 'Synthetic Registered'$$),
  '+919000001098', 'register_patient still inserts the patient (definer), the phone normalised');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$update public.patients set full_name = 'Synthetic Renamed' where id = 'c1060000-0000-4000-8000-000000001003'$$,
  $$select full_name from public.patients where id = 'c1060000-0000-4000-8000-000000001003'$$),
  'Synthetic Renamed', 'S-8: a receptionist still updates a patient''s demographics');

-- 2. S-3: visits.metadata --------------------------------------------------------------------------------------------------------------
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$update public.visits set metadata = '{"patient_confirmed": true, "confirmed_by": "c1060000-0000-4000-8000-000000000103"}'::jsonb where id = 'c1060000-0000-4000-8000-000000002003'$$),
  'denied:VISIT_METADATA_FORBIDDEN', 'S-3: a receptionist cannot forge the confirmation keys');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$update public.visits set metadata = '{"ai_assisted": true}'::jsonb where id = 'c1060000-0000-4000-8000-000000002006'$$),
  'denied:VISIT_METADATA_FORBIDDEN', 'S-3: nor a receptionist rewrite a signed, completed visit''s metadata (the AI provenance)');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000103', 'c1060000-0000-4000-8000-00000000000a',
  $$update public.visits set metadata = '{"ai_assisted": true}'::jsonb where id = 'c1060000-0000-4000-8000-000000002006'$$),
  'denied:VISIT_METADATA_FORBIDDEN', 'S-3: nor the doctor: a signed visit keeps its metadata');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000103', 'c1060000-0000-4000-8000-00000000000a',
  $$update public.visits set metadata = '{"cancellation_reason": "call 9000000000"}'::jsonb where id = 'c1060000-0000-4000-8000-000000002005'$$),
  'denied:VISIT_METADATA_FORBIDDEN', 'S-3: a doctor cannot write a key outside the AI provenance (free-text cancellation_reason)');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000103', 'c1060000-0000-4000-8000-00000000000a',
  $$update public.visits set metadata = jsonb_build_object('ai_assisted', true, 'pad', repeat('x', 200000)) where id = 'c1060000-0000-4000-8000-000000002005'$$),
  'denied:VISIT_METADATA_FORBIDDEN', 'S-3: nor a 200 KB object');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000103', 'c1060000-0000-4000-8000-00000000000a',
  $$update public.visits set metadata = '{"ai_assisted": "yes"}'::jsonb where id = 'c1060000-0000-4000-8000-000000002005'$$),
  'denied:VISIT_METADATA_FORBIDDEN', 'S-3: ai_assisted must be a boolean');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000103', 'c1060000-0000-4000-8000-00000000000a',
  $$update public.visits set metadata = '{"ai_sections_used": [{"a": 1}]}'::jsonb where id = 'c1060000-0000-4000-8000-000000002005'$$),
  'denied:VISIT_METADATA_FORBIDDEN', 'S-3: ai_sections_used must be an array of short strings');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000103', 'c1060000-0000-4000-8000-00000000000a',
  $$update public.visits set metadata = '{"ai_assisted": true, "ai_sections_used": ["chief_complaints", "advice"]}'::jsonb where id = 'c1060000-0000-4000-8000-000000002005'$$,
  $$select (metadata ->> 'ai_assisted') || ':' || jsonb_array_length(metadata -> 'ai_sections_used') from public.visits where id = 'c1060000-0000-4000-8000-000000002005'$$),
  'true:2', 'S-3 control: the consultation draft still writes the AI provenance of an open consultation');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$select public.cancel_visit('c1060000-0000-4000-8000-00000000000a'::uuid, 'c1060000-0000-4000-8000-000000002011', 'patient_request', 'c1060000-0000-4000-8000-0000000c0010', null, false, false) ->> 'visit_id'$$,
  $$select metadata ->> 'cancellation_reason' from public.visits where id = 'c1060000-0000-4000-8000-000000002011'$$),
  'patient_request', 'S-3 control: the definer cancel_visit still writes its own metadata keys');
update public.visits set metadata = '{"confirmed_by": "x", "n": 1}'::jsonb where id = 'c1060000-0000-4000-8000-000000002006';
select is((select metadata ->> 'n' from public.visits where id = 'c1060000-0000-4000-8000-000000002006'), '1',
  'S-3 control: a privileged writer (the service role, a migration) is not restricted by the guard');

-- 3. S-4: desk completion ----------------------------------------------------------------------------------------------------------------
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$select public.complete_visit('c1060000-0000-4000-8000-00000000000a'::uuid, 'c1060000-0000-4000-8000-000000002005', 'c1060000-0000-4000-8000-0000000c0020')$$),
  'error:P0001:VISIT_NOT_COMPLETABLE', 'S-4: a receptionist cannot complete a doctor''s open consultation at the desk');
select is((select status from public.visits where id = 'c1060000-0000-4000-8000-000000002005'), 'in_consultation', 'S-4: the open consultation is untouched');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$select public.complete_visit('c1060000-0000-4000-8000-00000000000a'::uuid, 'c1060000-0000-4000-8000-000000002007', 'c1060000-0000-4000-8000-0000000c0021') ->> 'already_completed'$$,
  $$select status from public.visits where id = 'c1060000-0000-4000-8000-000000002007'$$),
  'completed', 'S-4 control: a waiting visit still completes at the desk');

-- 4. S-5: the audit allow-list ---------------------------------------------------------------------------------------------------------------
select is(
  (select count(*)::int from unnest(private.audit_client_actions()) a
    where a in ('appointment.cancel', 'appointment.reschedule', 'queue.transition', 'visit.status_update', 'visit.create')),
  0, 'S-5: the five legacy actions are not in private.audit_client_actions()');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$select public.log_audit('c1060000-0000-4000-8000-00000000000a'::uuid, 'appointment.cancel', 'visit', 'c1060000-0000-4000-8000-000000002003', '{"reason": "patient_request"}'::jsonb)$$),
  'error:P0001:INPUT_INVALID', 'S-5: a receptionist cannot write a forged appointment.cancel row (log_audit refuses it)');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$select public.log_audit('c1060000-0000-4000-8000-00000000000a'::uuid, 'visit.create', 'visit', 'c1060000-0000-4000-8000-000000002003', null)$$),
  'error:P0001:INPUT_INVALID', 'S-5: nor visit.create');

-- 5. S-6: the anon reschedule context -----------------------------------------------------------------------------------------------------
select is(pg_temp.val_as(null, null,
  $$select (public.get_reschedule_context('c106-synthetic-reschedule-token-for-clinic-a-0001', '{MON}'::date::timestamptz, ('{MON}'::date + 1)::timestamptz)) ->> 'status'$$),
  'ok', 'S-6: the link''s own context is still served to anon');
select is(pg_temp.val_as(null, null,
  $$select (public.get_reschedule_context('c106-synthetic-reschedule-token-for-clinic-a-0001', '{MON}'::date::timestamptz, ('{MON}'::date + 1)::timestamptz)) ? 'booked'$$),
  'false', 'S-6: it has no list of booked times');
select is(pg_temp.val_as(null, null,
  $$select (public.get_reschedule_context('c106-synthetic-reschedule-token-for-clinic-a-0001', '{MON}'::date::timestamptz, ('{MON}'::date + 1)::timestamptz))::text like '%' || to_char('{MON_1015}'::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') || '%'$$),
  'false', 'S-6: and the text of the context contains no other appointment''s time (V2 at 10:15 IST)');

-- 6. S-7: the Realtime read policy --------------------------------------------------------------------------------------------------------
delete from realtime.messages;
select private.today_signal_send('c1060000-0000-4000-8000-00000000000a', 'visit', 'c1060000-0000-4000-8000-000000002001');
select private.today_signal_send('c1060000-0000-4000-8000-00000000000b', 'visit', 'c1060000-0000-4000-8000-000000002101');
select matches(
  (select pg_get_expr(p.polqual, p.polrelid) from pg_policy p where p.polrelid = 'realtime.messages'::regclass and p.polname = 'today_signals_select'),
  '\(topic = realtime\.topic\(\)\)', 'S-7: the policy compares the row''s own topic with the session topic');
create function pg_temp.visible_topics(p_user uuid, p_session_topic text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '', true);
  perform set_config('realtime.topic', p_session_topic, true);
  begin
    set local role authenticated;
    select coalesce(string_agg(distinct m.topic, ',' order by m.topic), 'none') into v_out from realtime.messages m;
    reset role;
  exception when others then
    reset role; v_out := 'error:' || sqlstate;
  end;
  perform set_config('realtime.topic', '', true);
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$f$;
select is(pg_temp.visible_topics('c1060000-0000-4000-8000-000000000106', 'today:c1060000-0000-4000-8000-00000000000a'),
  'today:c1060000-0000-4000-8000-00000000000a', 'S-7: a member of A with the session topic of A sees A''s signals only, never B''s (before: both)');
select is(pg_temp.visible_topics('c1060000-0000-4000-8000-000000000106', 'today:c1060000-0000-4000-8000-00000000000b'),
  'none', 'S-7: and with the session topic of B (not theirs) sees nothing');
select is(pg_temp.visible_topics('c1060000-0000-4000-8000-000000000201', 'today:c1060000-0000-4000-8000-00000000000b'),
  'today:c1060000-0000-4000-8000-00000000000b', 'S-7 control: the owner of B reads B''s signals on B''s topic');

-- 7. A-2: the waitlist promotion ------------------------------------------------------------------------------------------------------------
-- The waiting entry (patient One, the Monday, any doctor) was added above. V1 (10:00) lies under the block, V4 (14:00) is between D1's shifts,
-- V2 (10:15), V3 (10:30), V12 (10:45) are working slots.
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$select public.cancel_visit('c1060000-0000-4000-8000-00000000000a'::uuid, 'c1060000-0000-4000-8000-000000002001', 'patient_request', 'c1060000-0000-4000-8000-0000000c0030', null, false, true) ->> 'promoted'$$),
  'false', 'A-2: cancelling a slot under a schedule block promotes nobody');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$select public.cancel_visit('c1060000-0000-4000-8000-00000000000a'::uuid, 'c1060000-0000-4000-8000-000000002004', 'patient_request', 'c1060000-0000-4000-8000-0000000c0031', null, false, true) ->> 'promoted'$$),
  'false', 'A-2: nor a slot the doctor does not work (14:00 is between the shifts)');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$select public.cancel_visit('c1060000-0000-4000-8000-00000000000a'::uuid, 'c1060000-0000-4000-8000-000000002002', 'doctor_unavailable', 'c1060000-0000-4000-8000-0000000c0032', null, false, true) ->> 'promoted'$$),
  'false', 'A-2: the reason doctor_unavailable never promotes (a working slot)');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$select public.cancel_visit('c1060000-0000-4000-8000-00000000000a'::uuid, 'c1060000-0000-4000-8000-000000002003', 'clinic_closed', 'c1060000-0000-4000-8000-0000000c0033', null, false, true) ->> 'promoted'$$),
  'false', 'A-2: nor clinic_closed');
select is((select count(*)::int from public.waitlist_entries where tenant_id = 'c1060000-0000-4000-8000-00000000000a' and status = 'waiting'), 1,
  'A-2: the waitlist entry is still waiting after the four refusals');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$select public.cancel_visit('c1060000-0000-4000-8000-00000000000a'::uuid, 'c1060000-0000-4000-8000-000000002012', 'patient_request', 'c1060000-0000-4000-8000-0000000c0034', null, false, true) ->> 'promoted'$$,
  $$select count(*)::text from public.visits where tenant_id = 'c1060000-0000-4000-8000-00000000000a' and reason_for_visit = 'Booked from waitlist' and scheduled_at = '{MON_1045}'::timestamptz$$),
  '1', 'A-2 control: a patient_request cancel of a working slot promotes the waiting entry into it');

-- 8. A-3: a late arrival whose slot was rebooked --------------------------------------------------------------------------------------------
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000106', 'c1060000-0000-4000-8000-00000000000a',
  $$select public.check_in_visit('c1060000-0000-4000-8000-00000000000a'::uuid, 'c1060000-0000-4000-8000-000000002008', 'normal', 'c1060000-0000-4000-8000-0000000c0040') ->> 'token_number'$$,
  $$select v.status || ':' || v.is_overbooked::text || ':' || (select a.metadata ->> 'late_arrival' || ':' || (a.metadata ->> 'is_overbooked') from public.audit_logs a
                                                          where a.action = 'queue.check_in' and a.tenant_id = v.tenant_id and a.metadata ? 'late_arrival')
       from public.visits v where v.id = 'c1060000-0000-4000-8000-000000002008'$$),
  'waiting:true:true:true', 'A-3: the late no-show whose slot V9 now holds is checked in as an overbooked visit (before: CONFLICT 23P01), and the queue.check_in audit row says late_arrival and is_overbooked');
select is((select v.is_overbooked from public.visits v where v.id = 'c1060000-0000-4000-8000-000000002009'), false, 'A-3: the visit that holds the slot is untouched');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000103', 'c1060000-0000-4000-8000-00000000000a',
  $$select public.start_consultation('c1060000-0000-4000-8000-00000000000a'::uuid, 'c1060000-0000-4000-8000-000000002010', 'c1060000-0000-4000-8000-0000000c0041') ->> 'already_started'$$,
  $$select v.status || ':' || v.is_overbooked::text from public.visits v where v.id = 'c1060000-0000-4000-8000-000000002010'$$),
  'in_consultation:false', 'A-3 control: a late no-show whose slot is free is started without becoming overbooked');
select is(pg_temp.val_as('c1060000-0000-4000-8000-000000000103', 'c1060000-0000-4000-8000-00000000000a',
  $$select public.start_consultation('c1060000-0000-4000-8000-00000000000a'::uuid, 'c1060000-0000-4000-8000-000000002013', 'c1060000-0000-4000-8000-0000000c0042') ->> 'already_started'$$,
  $$select v.status || ':' || v.is_overbooked::text from public.visits v where v.id = 'c1060000-0000-4000-8000-000000002013'$$),
  'in_consultation:true', 'A-3: start_consultation of the late no-show with the rebooked slot works too (overbooked)');

-- 9. A-5: invoices signal the Today board -------------------------------------------------------------------------------------------------------
delete from realtime.messages where topic = 'today:c1060000-0000-4000-8000-00000000000a';
insert into public.invoices (id, tenant_id, visit_id, patient_id, invoice_number, total_amount) values
  ('c1060000-0000-4000-8000-000000003001', 'c1060000-0000-4000-8000-00000000000a', 'c1060000-0000-4000-8000-000000002006',
   'c1060000-0000-4000-8000-000000001002', 'INV-C106-1', 0);
select is((select count(*)::int from realtime.messages where topic = 'today:c1060000-0000-4000-8000-00000000000a'
             and payload ->> 'kind' = 'invoice' and payload ->> 'visit_id' = 'c1060000-0000-4000-8000-000000002006'), 1,
  'A-5: an invoice insert signals {kind: invoice, visit_id}');
select is((select (payload - 'id' - 'kind' - 'visit_id') from realtime.messages where topic = 'today:c1060000-0000-4000-8000-00000000000a' and payload ->> 'kind' = 'invoice'),
  '{}'::jsonb, 'A-5: and the payload carries nothing else (no PHI, no amount, no number)');
delete from realtime.messages where topic = 'today:c1060000-0000-4000-8000-00000000000a';
update public.invoices set total_amount = 250, updated_at = now() where id = 'c1060000-0000-4000-8000-000000003001';
select is((select count(*)::int from realtime.messages where topic = 'today:c1060000-0000-4000-8000-00000000000a' and payload ->> 'kind' = 'invoice'), 1,
  'A-5: a change of the total signals');
delete from realtime.messages where topic = 'today:c1060000-0000-4000-8000-00000000000a';
update public.invoices set status = 'issued' where id = 'c1060000-0000-4000-8000-000000003001';
select is((select count(*)::int from realtime.messages where topic = 'today:c1060000-0000-4000-8000-00000000000a' and payload ->> 'kind' = 'invoice'), 1,
  'A-5: a change of the status signals');
delete from realtime.messages where topic = 'today:c1060000-0000-4000-8000-00000000000a';
update public.invoices set updated_at = now() + interval '1 second' where id = 'c1060000-0000-4000-8000-000000003001';
select is((select count(*)::int from realtime.messages where topic = 'today:c1060000-0000-4000-8000-00000000000a'), 0,
  'A-5: a write of another column signals nothing');

select * from finish();
rollback;
