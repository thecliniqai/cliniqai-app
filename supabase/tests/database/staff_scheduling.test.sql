-- staff_scheduling.test.sql — V2-08 08-04a (R-9, R-15, R-16; migration 000103).
--   G-3 / R-9   private.default_weekly_schedule() is the column default of memberships.availability_schedule; a doctor whose schedule
--               is NULL is read as it by slot_conflicts (booking), available_slots_core (the staff list) and the patient link; the
--               slot list and the booking rule agree; slots are in the clinic's zone (a 00:30 IST slot belongs to its IST date).
--   slot_conflicts / available_slots  the visit being moved never conflicts with itself.
--   Contract    UPDATE on public.visits is narrowed to specialty, metadata and updated_at for authenticated: each revoked column is
--               refused (privilege level, before RLS or any guard), each kept column works, INSERT and the commands are unaffected.
--   Patient link  get_reschedule_slots lists the staff slots that fit the visit (its own slot included); consume_reschedule_token
--               refuses an off-duty time (slot_unavailable) and a taken one (slot_taken) and moves the visit on a free one.
--   Audit       the actions only a command writes (visit.reschedule, visit.no_show, visit.cancel, visit.confirm,
--               visit.auto_promoted_from_waitlist, waitlist.add, waitlist.promote) are not in log_audit's allow-list.
--   Grants      the six commands: authenticated only; the private helpers: nobody.
-- The behaviour of each command (audit, outbox, replay, faults, roles, races) is in tests/visits/*.spec.ts and tests/waitlist/*.spec.ts.
-- Synthetic data only; every probe and the file roll back.
begin;
select plan(49);

-- Fixtures: clinic A (owner, doctor D1 with the column-default schedule, doctor D2 whose schedule is NULL, doctor D3 with a night
-- shift, nurse, receptionist) and clinic B (owner) ----------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1030000-0000-4000-8000-000000000101', 'c103-owner@example.test'),
  ('c1030000-0000-4000-8000-000000000103', 'c103-doctor1@example.test'),
  ('c1030000-0000-4000-8000-000000000104', 'c103-doctor2@example.test'),
  ('c1030000-0000-4000-8000-000000000107', 'c103-doctor3@example.test'),
  ('c1030000-0000-4000-8000-000000000105', 'c103-nurse@example.test'),
  ('c1030000-0000-4000-8000-000000000106', 'c103-receptionist@example.test'),
  ('c1030000-0000-4000-8000-000000000201', 'c103-owner-b@example.test');
insert into public.tenants (id, name) values
  ('c1030000-0000-4000-8000-00000000000a', 'Synthetic 08-04a Clinic A'),
  ('c1030000-0000-4000-8000-00000000000b', 'Synthetic 08-04a Clinic B');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-00000000000b');
insert into public.memberships (user_id, tenant_id, role, full_name) values
  ('c1030000-0000-4000-8000-000000000101', 'c1030000-0000-4000-8000-00000000000a', 'owner', 'Synthetic Owner'),
  ('c1030000-0000-4000-8000-000000000103', 'c1030000-0000-4000-8000-00000000000a', 'doctor', 'Synthetic Doctor One'),
  ('c1030000-0000-4000-8000-000000000104', 'c1030000-0000-4000-8000-00000000000a', 'doctor', 'Synthetic Doctor Two'),
  ('c1030000-0000-4000-8000-000000000107', 'c1030000-0000-4000-8000-00000000000a', 'doctor', 'Synthetic Doctor Three'),
  ('c1030000-0000-4000-8000-000000000105', 'c1030000-0000-4000-8000-00000000000a', 'nurse', 'Synthetic Nurse'),
  ('c1030000-0000-4000-8000-000000000106', 'c1030000-0000-4000-8000-00000000000a', 'receptionist', 'Synthetic Receptionist'),
  ('c1030000-0000-4000-8000-000000000201', 'c1030000-0000-4000-8000-00000000000b', 'owner', 'Synthetic Owner B');
-- D1 keeps the column default. D2's schedule is cleared (NULL). D3 works 00:30-01:30 IST on Mondays only.
update public.memberships set availability_schedule = null where user_id = 'c1030000-0000-4000-8000-000000000104';
update public.memberships set availability_schedule = jsonb_build_object(
    'monday', '{"enabled": true, "shifts": [{"start": "00:30", "end": "01:30"}]}'::jsonb,
    'tuesday', '{"enabled": false, "shifts": []}'::jsonb, 'wednesday', '{"enabled": false, "shifts": []}'::jsonb,
    'thursday', '{"enabled": false, "shifts": []}'::jsonb, 'friday', '{"enabled": false, "shifts": []}'::jsonb,
    'saturday', '{"enabled": false, "shifts": []}'::jsonb, 'sunday', '{"enabled": false, "shifts": []}'::jsonb)
 where user_id = 'c1030000-0000-4000-8000-000000000107';
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1030000-0000-4000-8000-000000001001', 'c1030000-0000-4000-8000-00000000000a', 'Synthetic Patient', '+919000001030',
   'c1030000-0000-4000-8000-000000000101');

-- A Monday and a Sunday two to three weeks ahead, in the clinic's zone (a time of day on that date in IST, as a timestamptz).
create temp table d(mon date, sun date) on commit drop;
insert into d select (date_trunc('week', now() at time zone 'Asia/Kolkata') + interval '14 days')::date,
                     (date_trunc('week', now() at time zone 'Asia/Kolkata') + interval '20 days')::date;
create function pg_temp.ist(p_date date, p_time time) returns timestamptz language sql immutable as $$
  select (p_date + p_time) at time zone 'Asia/Kolkata'
$$;

-- Placeholders the probes substitute before they switch role (an API role cannot read the temp objects above).
create temp table ph(token text primary key, val text not null) on commit drop;
insert into ph select '{MON}', mon::text from d;
insert into ph select '{MON_' || to_char(t, 'HH24MI') || '}', pg_temp.ist(d.mon, t)::text
  from d, (values (time '03:00'), (time '10:00'), (time '10:05'), (time '10:15'), (time '11:00')) v(t);

-- Two booked visits of D1 on the Monday: V1 (10:00 IST, the visit that moves) and V2 (10:15 IST, another patient's slot).
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at, estimated_duration_minutes, created_by)
select v.id, 'c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000001001', 'c1030000-0000-4000-8000-000000000103',
       'scheduled', 'booked', pg_temp.ist(d.mon, v.t), 15, 'c1030000-0000-4000-8000-000000000101'
  from d, (values ('c1030000-0000-4000-8000-000000002001'::uuid, time '10:00'), ('c1030000-0000-4000-8000-000000002002'::uuid, time '10:15')) v(id, t);
insert into public.document_share_tokens (id, tenant_id, resource_type, resource_id, token_hash, created_by) values
  ('c1030000-0000-4000-8000-000000004001', 'c1030000-0000-4000-8000-00000000000a', 'appointment', 'c1030000-0000-4000-8000-000000002001',
   public.share_token_hash('c103-synthetic-reschedule-token-for-clinic-a-0001'), 'c1030000-0000-4000-8000-000000000101');

-- Helpers ----------------------------------------------------------------------------------------------------------
-- The first column of p_sql run as a signed-in user (anon when p_user is null), with the active-clinic header; 'denied:<message>'
-- for 42501, 'error:<sqlstate>:<message>' otherwise. Always rolled back.
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
      execute p_probe into v_out;
    end if;
    raise exception 'c103 sentinel' using errcode = 'P0S03';
  exception
    when sqlstate 'P0S03' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

-- 1. G-3: the default schedule ----------------------------------------------------------------------------------------------
select is(
  (select m.availability_schedule from public.memberships m where m.user_id = 'c1030000-0000-4000-8000-000000000103'),
  private.default_weekly_schedule(),
  'private.default_weekly_schedule() equals the column default (a membership inserted without a schedule has it)');
select is(private.effective_schedule(null), private.default_weekly_schedule(), 'a NULL schedule reads as the default');
select is(private.effective_schedule('{"monday": {"enabled": false, "shifts": []}}'::jsonb), '{"monday": {"enabled": false, "shifts": []}}'::jsonb,
  'a stored schedule is read as stored');
select ok((select m.availability_schedule is null from public.memberships m where m.user_id = 'c1030000-0000-4000-8000-000000000104'),
  'fixture: doctor two has a NULL schedule');

-- 2. booking reads the default for a NULL schedule (slot_conflicts) ---------------------------------------------------------
select is(private.slot_conflicts('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000000104', (select pg_temp.ist(mon, time '03:00') from d), 15, 'Asia/Kolkata'),
  array['off_duty']::text[], 'NULL schedule: 03:00 IST is off duty (not "any time")');
select is(private.slot_conflicts('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000000104', (select pg_temp.ist(mon, time '11:00') from d), 15, 'Asia/Kolkata'),
  array[]::text[], 'NULL schedule: 11:00 IST on a Monday is inside the default shift');
select is(private.slot_conflicts('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000000104', (select pg_temp.ist(mon, time '20:45') from d), 15, 'Asia/Kolkata'),
  array[]::text[], 'NULL schedule: the evening shift ends at 21:00 (the old TypeScript default ended at 20:00)');
select is(private.slot_conflicts('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000000104', (select pg_temp.ist(mon, time '20:50') from d), 20, 'Asia/Kolkata'),
  array['off_duty']::text[], 'NULL schedule: a visit that would end after 21:00 is off duty');
select is(private.slot_conflicts('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000000104', (select pg_temp.ist(sun, time '11:00') from d), 15, 'Asia/Kolkata'),
  array['off_duty']::text[], 'NULL schedule: Sunday is off');

-- 3. the staff slot list reads the same schedule and agrees with booking --------------------------------------------------------
select is((select count(*) from d, private.available_slots_core('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000000104', d.mon)),
  28::bigint, 'NULL schedule: a Monday lists the 28 default slots (12 morning + 16 evening)');
select is((select count(*) from d, private.available_slots_core('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000000104', d.sun)),
  0::bigint, 'NULL schedule: Sunday lists no slot');
select is_empty(
  $$ select 1 from d, private.available_slots_core('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000000104', d.mon) s
      where cardinality(private.slot_conflicts('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000000104', s.slot_start, 15, 'Asia/Kolkata')) > 0 $$,
  'every listed slot is free by the booking rule (the list equals booking)');
select is(
  (select min(s.slot_start) from d, private.available_slots_core('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000000104', d.mon) s),
  (select pg_temp.ist(mon, time '10:00') from d), 'the first slot is 10:00 in the clinic zone (04:30 UTC)');
select is(
  (select min(s.slot_start) from d, private.available_slots_core('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000000107', d.mon) s),
  (select pg_temp.ist(mon, time '00:30') from d),
  'a 00:30 IST slot belongs to its IST date although its UTC date is the day before');
select is((select (min(s.slot_start) at time zone 'UTC')::date = d.mon - 1 from d, private.available_slots_core('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000000107', d.mon) s group by d.mon),
  true, 'and that slot''s UTC date is the previous one');
select is(private.slot_conflicts('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000000107', (select pg_temp.ist(mon, time '00:30') from d), 15, 'Asia/Kolkata'),
  array[]::text[], 'booking accepts the 00:30 IST slot the list shows');

-- 4. the visit being moved never conflicts with itself --------------------------------------------------------------------------
select is(private.slot_conflicts('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000000103', (select pg_temp.ist(mon, time '10:00') from d), 15, 'Asia/Kolkata'),
  array['taken']::text[], 'D1 at 10:00: taken by V1');
select is(private.slot_conflicts('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000000103', (select pg_temp.ist(mon, time '10:00') from d), 15, 'Asia/Kolkata', 'c1030000-0000-4000-8000-000000002001'),
  array[]::text[], 'D1 at 10:00 excluding V1: free (a reschedule into its own time works)');
select is(private.slot_conflicts('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000000103', (select pg_temp.ist(mon, time '10:10') from d), 15, 'Asia/Kolkata', 'c1030000-0000-4000-8000-000000002001'),
  array['taken']::text[], 'D1 at 10:10 excluding V1: still taken by V2 (overlapping its own time is fine, another visit is not)');
select is((select count(*) from d, private.available_slots_core('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000000103', d.mon)),
  26::bigint, 'D1 Monday: 28 slots minus the two booked ones');
select is((select count(*) from d, private.available_slots_core('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000000103', d.mon, 'c1030000-0000-4000-8000-000000002001')),
  27::bigint, 'D1 Monday excluding V1: its own slot is listed again');
select is(pg_temp.val_as('c1030000-0000-4000-8000-000000000106', 'c1030000-0000-4000-8000-00000000000a',
  $$select count(*)::text from public.available_slots('c1030000-0000-4000-8000-000000000103', '{MON}'::date, 'c1030000-0000-4000-8000-000000002001')$$),
  '27', 'public.available_slots (the guarded wrapper) as a receptionist excludes the visit too');
select is(pg_temp.val_as('c1030000-0000-4000-8000-000000000201', 'c1030000-0000-4000-8000-00000000000b',
  $$select count(*)::text from public.available_slots('c1030000-0000-4000-8000-000000000103', '{MON}'::date)$$),
  '0', 'public.available_slots naming a doctor of clinic A while acting in clinic B lists nothing');

-- 5. the contract: UPDATE on visits is narrowed ---------------------------------------------------------------------------------
select is_empty(
  $$ select a.attname from pg_attribute a
      where a.attrelid = 'public.visits'::regclass and a.attnum > 0 and not a.attisdropped
        and a.attname not in ('specialty', 'metadata', 'updated_at')
        and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE') $$,
  'authenticated can update no column of visits but specialty, metadata and updated_at');
select set_eq(
  $$ select a.attname::text from pg_attribute a
      where a.attrelid = 'public.visits'::regclass and a.attnum > 0 and not a.attisdropped
        and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE') $$,
  array['specialty', 'metadata', 'updated_at'],
  'the columns authenticated may update are exactly specialty, metadata and updated_at');
select ok(not has_table_privilege('authenticated', 'public.visits', 'UPDATE') and not has_table_privilege('authenticated', 'public.visits', 'INSERT'),
  'no table-level UPDATE and (000106, S-1) no INSERT for authenticated');
select ok(has_table_privilege('service_role', 'public.visits', 'UPDATE') and not has_table_privilege('anon', 'public.visits', 'UPDATE'),
  'service_role keeps UPDATE (system paths); anon has none');
select is(pg_temp.val_as('c1030000-0000-4000-8000-000000000106', 'c1030000-0000-4000-8000-00000000000a',
  $$update public.visits set status = 'cancelled' where id = 'c1030000-0000-4000-8000-000000002001'$$),
  'denied:permission denied for table visits', 'a receptionist cannot write visits.status');
select is(pg_temp.val_as('c1030000-0000-4000-8000-000000000106', 'c1030000-0000-4000-8000-00000000000a',
  $$update public.visits set scheduled_at = now() + interval '9 days' where id = 'c1030000-0000-4000-8000-000000002001'$$),
  'denied:permission denied for table visits', 'a receptionist cannot write visits.scheduled_at');
select is(pg_temp.val_as('c1030000-0000-4000-8000-000000000103', 'c1030000-0000-4000-8000-00000000000a',
  $$update public.visits set doctor_id = 'c1030000-0000-4000-8000-000000000104' where id = 'c1030000-0000-4000-8000-000000002001'$$),
  'denied:permission denied for table visits', 'a doctor cannot write visits.doctor_id');
select is(pg_temp.val_as('c1030000-0000-4000-8000-000000000101', 'c1030000-0000-4000-8000-00000000000a',
  $$update public.visits set is_overbooked = true where id = 'c1030000-0000-4000-8000-000000002001'$$),
  'denied:permission denied for table visits', 'the owner cannot write visits.is_overbooked');
select is(pg_temp.val_as('c1030000-0000-4000-8000-000000000101', 'c1030000-0000-4000-8000-00000000000a',
  $$update public.visits set estimated_duration_minutes = 60 where id = 'c1030000-0000-4000-8000-000000002001'$$),
  'denied:permission denied for table visits', 'the owner cannot write visits.estimated_duration_minutes');
select is(pg_temp.val_as('c1030000-0000-4000-8000-000000000101', 'c1030000-0000-4000-8000-00000000000a',
  $$update public.visits set location_id = null where id = 'c1030000-0000-4000-8000-000000002001'$$),
  'denied:permission denied for table visits', 'the owner cannot write visits.location_id');
select is(pg_temp.val_as('c1030000-0000-4000-8000-000000000103', 'c1030000-0000-4000-8000-00000000000a',
  $$update public.visits set specialty = 'dental', updated_at = now() where id = 'c1030000-0000-4000-8000-000000002001'$$,
  $$select specialty from public.visits where id = 'c1030000-0000-4000-8000-000000002001'$$),
  'dental', 'the consultation draft still writes specialty and updated_at');
select is(pg_temp.val_as('c1030000-0000-4000-8000-000000000103', 'c1030000-0000-4000-8000-00000000000a',
  $$update public.visits set metadata = '{"ai_assisted": true}'::jsonb where id = 'c1030000-0000-4000-8000-000000002001'$$,
  $$select metadata ->> 'ai_assisted' from public.visits where id = 'c1030000-0000-4000-8000-000000002001'$$),
  'true', 'and the AI provenance in metadata (000106, S-3: any other metadata key is refused, see front_desk_review_fixes.test.sql)');
select is(pg_temp.val_as('c1030000-0000-4000-8000-000000000106', 'c1030000-0000-4000-8000-00000000000a',
  $$select public.confirm_appointment('c1030000-0000-4000-8000-00000000000a', 'c1030000-0000-4000-8000-000000002001', 'c1030000-0000-4000-8000-0000000c0001') ->> 'already_confirmed'$$,
  null),
  'false', 'a definer command still moves the status the grant keeps closed (confirm_appointment as a receptionist)');

-- 6. grants and audit lists -------------------------------------------------------------------------------------------------------
select is(
  (select array_agg(f || ':' || has_function_privilege('anon', f, 'EXECUTE')::text || ':' || has_function_privilege('authenticated', f, 'EXECUTE')::text
                    || ':' || has_function_privilege('service_role', f, 'EXECUTE')::text order by f)
     from unnest(array[
       'public.reschedule_visit(uuid, uuid, timestamptz, uuid, uuid, integer, boolean, boolean, boolean, boolean, bigint)',
       'public.cancel_visit(uuid, uuid, text, uuid, text, boolean, boolean, bigint)',
       'public.mark_no_show(uuid, uuid, uuid, bigint)', 'public.confirm_appointment(uuid, uuid, uuid, bigint)',
       'public.add_to_waitlist(uuid, uuid, date, uuid, uuid, text, integer, text)',
       'public.promote_waitlist_entry(uuid, uuid, timestamptz, uuid, uuid, integer, boolean)',
       'public.available_slots(uuid, date, uuid)']) f),
  array[
    'public.add_to_waitlist(uuid, uuid, date, uuid, uuid, text, integer, text):false:true:false',
    'public.available_slots(uuid, date, uuid):false:true:false',
    'public.cancel_visit(uuid, uuid, text, uuid, text, boolean, boolean, bigint):false:true:false',
    'public.confirm_appointment(uuid, uuid, uuid, bigint):false:true:false',
    'public.mark_no_show(uuid, uuid, uuid, bigint):false:true:false',
    'public.promote_waitlist_entry(uuid, uuid, timestamptz, uuid, uuid, integer, boolean):false:true:false',
    'public.reschedule_visit(uuid, uuid, timestamptz, uuid, uuid, integer, boolean, boolean, boolean, boolean, bigint):false:true:false'
  ]::text[],
  'the six commands and the slot list: EXECUTE for authenticated only (no anon, no service role)');
select is(
  (select array_agg(f || ':' || (has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
                                 or has_function_privilege('service_role', f, 'EXECUTE'))::text order by f)
     from unnest(array[
       'private.default_weekly_schedule()', 'private.effective_schedule(jsonb)',
       'private.slot_conflicts(uuid, uuid, timestamptz, integer, text, uuid)',
       'private.available_slots_core(uuid, uuid, date, uuid)', 'private.doctor_display_name(uuid, uuid)',
       'private.step_enqueue_visit_message(uuid, uuid, uuid, text, jsonb, text)',
       'private.step_promote_waitlist(uuid, uuid, timestamptz, integer, text)']) f),
  array[
    'private.available_slots_core(uuid, uuid, date, uuid):false', 'private.default_weekly_schedule():false',
    'private.doctor_display_name(uuid, uuid):false', 'private.effective_schedule(jsonb):false',
    'private.slot_conflicts(uuid, uuid, timestamptz, integer, text, uuid):false',
    'private.step_enqueue_visit_message(uuid, uuid, uuid, text, jsonb, text):false',
    'private.step_promote_waitlist(uuid, uuid, timestamptz, integer, text):false'
  ]::text[],
  'the private helpers have no API grant');
select is_empty(
  $$ select a from unnest(array['visit.reschedule', 'visit.no_show', 'visit.cancel', 'visit.confirm',
                                 'visit.auto_promoted_from_waitlist', 'waitlist.add', 'waitlist.promote']) a
      where a = any (private.audit_client_actions()) $$,
  'the seven actions only a command writes are not in the client allow-list');
select is(pg_temp.val_as('c1030000-0000-4000-8000-000000000106', 'c1030000-0000-4000-8000-00000000000a',
  $$select public.log_audit('c1030000-0000-4000-8000-00000000000a', 'visit.cancel', 'visit', 'c1030000-0000-4000-8000-000000002001', '{}'::jsonb)$$),
  'error:P0001:INPUT_INVALID', 'a receptionist cannot plant a visit.cancel audit row (log_audit refuses an action outside its allow-list)');

-- 7. the patient link ----------------------------------------------------------------------------------------------------------------
select is(pg_temp.val_as(null, null, $$select public.get_reschedule_slots('not-a-real-token-not-a-real-token-not-a-real-token', current_date + 3) ->> 'status'$$),
  'not_found', 'get_reschedule_slots: an unknown token is not_found (anon)');
select is(pg_temp.val_as(null, null,
  $$select (public.get_reschedule_slots('c103-synthetic-reschedule-token-for-clinic-a-0001', '{MON}'::date) -> 'slots') ->> 0$$) is not null, true,
  'get_reschedule_slots: the visit''s own token lists slots on the Monday');
select is(pg_temp.val_as(null, null,
  $$select jsonb_array_length(public.get_reschedule_slots('c103-synthetic-reschedule-token-for-clinic-a-0001', '{MON}'::date) -> 'slots')::text$$),
  '27', 'get_reschedule_slots: 28 default slots minus V2''s, the visit''s own slot included');
select is(pg_temp.val_as(null, null,
  $$select public.get_reschedule_slots('c103-synthetic-reschedule-token-for-clinic-a-0001', '{MON}'::date) ->> 'timezone'$$),
  'Asia/Kolkata', 'get_reschedule_slots: carries the clinic zone');
select is(pg_temp.val_as(null, null,
  $$select (public.consume_reschedule_token('c103-synthetic-reschedule-token-for-clinic-a-0001', '{MON_0300}'::timestamptz) ->> 'status')$$),
  'slot_unavailable', 'consume_reschedule_token: an off-duty time is slot_unavailable');
select is(pg_temp.val_as(null, null,
  $$select (public.consume_reschedule_token('c103-synthetic-reschedule-token-for-clinic-a-0001', '{MON_1015}'::timestamptz) ->> 'status')$$),
  'slot_taken', 'consume_reschedule_token: another visit''s slot is slot_taken');
select is(pg_temp.val_as(null, null,
  $$select (public.consume_reschedule_token('c103-synthetic-reschedule-token-for-clinic-a-0001', '{MON_1005}'::timestamptz) ->> 'status')$$),
  'slot_taken', 'consume_reschedule_token: overlapping another visit by the visit''s own duration is slot_taken');
select is(pg_temp.val_as(null, null,
  $$select (public.consume_reschedule_token('c103-synthetic-reschedule-token-for-clinic-a-0001', '{MON_1000}'::timestamptz) ->> 'status')$$),
  'ok', 'consume_reschedule_token: moving into the visit''s own time works (the visit never blocks itself)');
select is(pg_temp.val_as(null, null,
  $$select (public.consume_reschedule_token('c103-synthetic-reschedule-token-for-clinic-a-0001', '{MON_1100}'::timestamptz) ->> 'status')$$,
  $$select scheduled_at::text from public.visits where id = 'c1030000-0000-4000-8000-000000002001'$$),
  (select pg_temp.ist(mon, time '11:00')::text from d), 'consume_reschedule_token: a free slot moves the visit');

select * from finish();
rollback;
