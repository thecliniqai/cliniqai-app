-- today_board.test.sql — V2-09e 09E-06 (R-9, R-12; migration 000125; threats: another clinic's or another role's data on the board's one read).
-- public.today_board(tenant, mode, doctor, date): Today's board in one STABLE INVOKER read.
--   1. grants and shape: INVOKER, search_path pinned, EXECUTE for authenticated only;
--   2. refusals: another clinic, a forged tenant, no membership, a NULL tenant or mode, an unknown mode, no session and a clinic that is not full all return NULL;
--   3. the versions in the answer equal clinic_versions in the same transaction, for every member role;
--   4. the role x part matrix: owner, doctor, receptionist, nurse, admin (allergy flag, vitals, invoice, follow-up);
--   5. only the fields a row shows: the exact key sets of a visit and its patient; no allergen name, address or note anywhere in the answer;
--   6. the clinic day: today's booking and walk-in only, a booking of yesterday and another clinic's visit never, p_date reads another day;
--   7. doctor mode: p_doctor_id, or the caller when none is given; front mode lists every doctor;
--   8. invoices: the live invoice's total, payments summed, a cancelled invoice is no invoice, only a completed visit carries one;
--   9. follow-up and its booked rule; row_version moves with a listed column; doctors include a removed doctor.
-- Every call runs under the real principal. The file rolls back. Synthetic data only.
begin;
select plan(62);

insert into auth.users (id, email) values
  ('c1250000-0000-4000-8000-000000000101', 'c125-owner-a@example.test'),
  ('c1250000-0000-4000-8000-000000000102', 'c125-doctor-a@example.test'),
  ('c1250000-0000-4000-8000-000000000103', 'c125-admin-a@example.test'),
  ('c1250000-0000-4000-8000-000000000104', 'c125-nurse-a@example.test'),
  ('c1250000-0000-4000-8000-000000000105', 'c125-receptionist-a@example.test'),
  ('c1250000-0000-4000-8000-000000000106', 'c125-doctor2-a@example.test'),
  ('c1250000-0000-4000-8000-000000000107', 'c125-removed-doctor-a@example.test'),
  ('c1250000-0000-4000-8000-000000000201', 'c125-owner-b@example.test'),
  ('c1250000-0000-4000-8000-000000000301', 'c125-outsider@example.test'),
  ('c1250000-0000-4000-8000-000000000401', 'c125-owner-c@example.test');
insert into public.tenants (id, name) values
  ('c1250000-0000-4000-8000-00000000000a', 'Synthetic 000125 Clinic A'),
  ('c1250000-0000-4000-8000-00000000000b', 'Synthetic 000125 Clinic B'),
  ('c1250000-0000-4000-8000-00000000000c', 'Synthetic 000125 Clinic C (not full)');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1250000-0000-4000-8000-00000000000a', 'c1250000-0000-4000-8000-00000000000b') and s.status = 'incomplete';
insert into public.memberships (user_id, tenant_id, role, full_name) values
  ('c1250000-0000-4000-8000-000000000101', 'c1250000-0000-4000-8000-00000000000a', 'owner', 'Synthetic Owner'),
  ('c1250000-0000-4000-8000-000000000102', 'c1250000-0000-4000-8000-00000000000a', 'doctor', 'Synthetic Doctor One'),
  ('c1250000-0000-4000-8000-000000000103', 'c1250000-0000-4000-8000-00000000000a', 'admin', null),
  ('c1250000-0000-4000-8000-000000000104', 'c1250000-0000-4000-8000-00000000000a', 'nurse', null),
  ('c1250000-0000-4000-8000-000000000105', 'c1250000-0000-4000-8000-00000000000a', 'receptionist', null),
  ('c1250000-0000-4000-8000-000000000106', 'c1250000-0000-4000-8000-00000000000a', 'doctor', 'Synthetic Doctor Two'),
  ('c1250000-0000-4000-8000-000000000201', 'c1250000-0000-4000-8000-00000000000b', 'owner', null),
  ('c1250000-0000-4000-8000-000000000401', 'c1250000-0000-4000-8000-00000000000c', 'owner', null);
-- A doctor who has left the clinic: still named on past visits.
insert into public.memberships (user_id, tenant_id, role, full_name, status, removed_at) values
  ('c1250000-0000-4000-8000-000000000107', 'c1250000-0000-4000-8000-00000000000a', 'doctor', 'Synthetic Removed Doctor', 'removed', now());

insert into public.patients (id, tenant_id, full_name, phone, sex, date_of_birth, created_by, allergies, address) values
  ('c1250000-0000-4000-8000-000000001001', 'c1250000-0000-4000-8000-00000000000a', 'Synthetic Board Patient One', '+919000012501', 'female', '1990-03-04', 'c1250000-0000-4000-8000-000000000101', array['Qzboardallergen'], '{"line": "Synthetic address 1"}'::jsonb),
  ('c1250000-0000-4000-8000-000000001002', 'c1250000-0000-4000-8000-00000000000a', 'Synthetic Board Patient Two', '+919000012502', 'male', null, 'c1250000-0000-4000-8000-000000000101', null, null),
  ('c1250000-0000-4000-8000-000000001003', 'c1250000-0000-4000-8000-00000000000b', 'Synthetic Board Patient B', '+919000012503', null, null, 'c1250000-0000-4000-8000-000000000201', null, null),
  ('c1250000-0000-4000-8000-000000001004', 'c1250000-0000-4000-8000-00000000000c', 'Synthetic Board Patient C', '+919000012504', null, null, 'c1250000-0000-4000-8000-000000000401', null, null);

-- Visits (A): 2001 booked today (doctor 1), 2002 waiting walk-in today (doctor 1, token), 2003 in consultation (doctor 2, vitals), 2004 completed with an
-- invoice and payments (doctor 1, follow-up), 2005 completed without an invoice (doctor 2), 2006 completed with a CANCELLED invoice (doctor 1),
-- 2007 yesterday's booking (doctor 1), 2008 a booked visit later on the follow-up day (doctor 1), 2009 completed of the removed doctor.
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by, scheduled_at, is_overbooked) values
  ('c1250000-0000-4000-8000-000000002001', 'c1250000-0000-4000-8000-00000000000a', 'c1250000-0000-4000-8000-000000001001', 'c1250000-0000-4000-8000-000000000102', 'scheduled', 'booked', 'c1250000-0000-4000-8000-000000000101', now(), true),
  ('c1250000-0000-4000-8000-000000002007', 'c1250000-0000-4000-8000-00000000000a', 'c1250000-0000-4000-8000-000000001001', 'c1250000-0000-4000-8000-000000000102', 'scheduled', 'booked', 'c1250000-0000-4000-8000-000000000101', now() - interval '1 day', true),
  ('c1250000-0000-4000-8000-000000002008', 'c1250000-0000-4000-8000-00000000000a', 'c1250000-0000-4000-8000-000000001001', 'c1250000-0000-4000-8000-000000000102', 'scheduled', 'booked', 'c1250000-0000-4000-8000-000000000101', now() + interval '6 days', true),
  ('c1250000-0000-4000-8000-000000003001', 'c1250000-0000-4000-8000-00000000000b', 'c1250000-0000-4000-8000-000000001003', 'c1250000-0000-4000-8000-000000000201', 'walk_in', 'waiting', 'c1250000-0000-4000-8000-000000000201', null, false),
  ('c1250000-0000-4000-8000-000000004001', 'c1250000-0000-4000-8000-00000000000c', 'c1250000-0000-4000-8000-000000001004', 'c1250000-0000-4000-8000-000000000401', 'walk_in', 'waiting', 'c1250000-0000-4000-8000-000000000401', null, false);
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1250000-0000-4000-8000-000000002002', 'c1250000-0000-4000-8000-00000000000a', 'c1250000-0000-4000-8000-000000001002', 'c1250000-0000-4000-8000-000000000102', 'walk_in', 'waiting', 'c1250000-0000-4000-8000-000000000101'),
  ('c1250000-0000-4000-8000-000000002003', 'c1250000-0000-4000-8000-00000000000a', 'c1250000-0000-4000-8000-000000001002', 'c1250000-0000-4000-8000-000000000106', 'walk_in', 'in_consultation', 'c1250000-0000-4000-8000-000000000101'),
  ('c1250000-0000-4000-8000-000000002004', 'c1250000-0000-4000-8000-00000000000a', 'c1250000-0000-4000-8000-000000001001', 'c1250000-0000-4000-8000-000000000102', 'walk_in', 'completed', 'c1250000-0000-4000-8000-000000000101'),
  ('c1250000-0000-4000-8000-000000002005', 'c1250000-0000-4000-8000-00000000000a', 'c1250000-0000-4000-8000-000000001002', 'c1250000-0000-4000-8000-000000000106', 'walk_in', 'completed', 'c1250000-0000-4000-8000-000000000101'),
  ('c1250000-0000-4000-8000-000000002006', 'c1250000-0000-4000-8000-00000000000a', 'c1250000-0000-4000-8000-000000001002', 'c1250000-0000-4000-8000-000000000102', 'walk_in', 'completed', 'c1250000-0000-4000-8000-000000000101'),
  ('c1250000-0000-4000-8000-000000002009', 'c1250000-0000-4000-8000-00000000000a', 'c1250000-0000-4000-8000-000000001002', 'c1250000-0000-4000-8000-000000000107', 'walk_in', 'completed', 'c1250000-0000-4000-8000-000000000101');
insert into public.queue_tokens (tenant_id, visit_id, date, token_number, priority) values
  ('c1250000-0000-4000-8000-00000000000a', 'c1250000-0000-4000-8000-000000002002', (now() at time zone 'Asia/Kolkata')::date, 11, 'urgent');
update public.clinical_notes set vitals = '{"systolic": 150, "diastolic": 95, "pulse": 88}'::jsonb, clinical_notes = 'Synthetic confidential note' where visit_id = 'c1250000-0000-4000-8000-000000002003';
insert into public.invoices (id, tenant_id, visit_id, patient_id, invoice_number, total_amount) values
  ('c1250000-0000-4000-8000-0000000b2004', 'c1250000-0000-4000-8000-00000000000a', 'c1250000-0000-4000-8000-000000002004', 'c1250000-0000-4000-8000-000000001001', 'C125-1', 1000);
insert into public.invoices (id, tenant_id, visit_id, patient_id, invoice_number, total_amount, status) values
  ('c1250000-0000-4000-8000-0000000b2006', 'c1250000-0000-4000-8000-00000000000a', 'c1250000-0000-4000-8000-000000002006', 'c1250000-0000-4000-8000-000000001002', 'C125-2', 300, 'cancelled');
insert into public.payments (tenant_id, invoice_id, amount, payment_method, recorded_by) values
  ('c1250000-0000-4000-8000-00000000000a', 'c1250000-0000-4000-8000-0000000b2004', 250, 'cash', 'c1250000-0000-4000-8000-000000000101'),
  ('c1250000-0000-4000-8000-00000000000a', 'c1250000-0000-4000-8000-0000000b2004', 150, 'cash', 'c1250000-0000-4000-8000-000000000101');
insert into public.follow_ups (tenant_id, patient_id, visit_id, doctor_id, follow_up_date, notes) values
  ('c1250000-0000-4000-8000-00000000000a', 'c1250000-0000-4000-8000-000000001001', 'c1250000-0000-4000-8000-000000002004', 'c1250000-0000-4000-8000-000000000102', (now() at time zone 'Asia/Kolkata')::date + 6, 'Synthetic follow-up note');

-- The clinic's own today (Asia/Kolkata), which is not the database's current_date for part of every day.
create function pg_temp.d0() returns date language sql as $f$ select (now() at time zone 'Asia/Kolkata')::date $f$;
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
-- The board as a user (mode 'front' unless given): the whole jsonb text, or 'NULL'.
create function pg_temp.board(p_user text, p_mode text default 'front', p_tenant text default 'c1250000-0000-4000-8000-00000000000a', p_doctor text default null, p_date text default null) returns text language sql as $f$
  select pg_temp.as_user(('c1250000-0000-4000-8000-000000000' || p_user)::uuid,
    format($q$ select coalesce(public.today_board(%L, %L, %L, %L)::text, 'NULL') $q$, p_tenant, p_mode, p_doctor::uuid, p_date::date))
$f$;
-- One visit of the board (jsonb text) or 'absent'.
create function pg_temp.visit(p_user text, p_visit text, p_mode text default 'front') returns text language sql as $f$
  select coalesce((select v::text from jsonb_array_elements(pg_temp.board(p_user, p_mode)::jsonb -> 'visits') v where v ->> 'id' = 'c1250000-0000-4000-8000-00000000' || p_visit), 'absent')
$f$;
create function pg_temp.field(p_user text, p_visit text, p_path text, p_mode text default 'front') returns text language sql as $f$
  select coalesce((select (v #>> p_path::text[]) from jsonb_array_elements(pg_temp.board(p_user, p_mode)::jsonb -> 'visits') v where v ->> 'id' = 'c1250000-0000-4000-8000-00000000' || p_visit), 'absent')
$f$;
create function pg_temp.ids(p_user text, p_mode text default 'front', p_doctor text default null, p_date text default null) returns text language sql as $f$
  select coalesce((select string_agg(right(v ->> 'id', 4), ',' order by v ->> 'id') from jsonb_array_elements(pg_temp.board(p_user, p_mode, 'c1250000-0000-4000-8000-00000000000a', p_doctor, p_date)::jsonb -> 'visits') v), 'none')
$f$;

-- 1. Grants and shape -------------------------------------------------------------------------------------------------------
select is((select p.prosecdef::text || ':' || p.provolatile::text || ':' || array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'public.today_board(uuid, text, uuid, date)'::regprocedure),
  'false:s:search_path=""', 'today_board is a STABLE INVOKER function with search_path pinned');
select is((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text)
             from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid = 'public.today_board(uuid, text, uuid, date)'::regprocedure and a.grantee <> p.proowner),
  'authenticated:EXECUTE', 'EXECUTE is granted to authenticated only (not PUBLIC, anon or service_role)');
select throws_ok($$ set local role anon; select public.today_board('c1250000-0000-4000-8000-00000000000a', 'front') $$, '42501', null, 'anon cannot execute it');
select throws_ok($$ set local role service_role; select public.today_board('c1250000-0000-4000-8000-00000000000a', 'front') $$, '42501', null, 'service_role cannot execute it (no service-role path)');

-- 2. Refusals: all of them NULL -----------------------------------------------------------------------------------------------
select is(pg_temp.board('201'), 'NULL', 'the owner of B asking for A gets NULL (a forged tenant)');
select is(pg_temp.board('102', 'front', 'c1250000-0000-4000-8000-00000000000b'), 'NULL', 'a doctor of A asking for B gets NULL');
select is(pg_temp.board('301'), 'NULL', 'a user with no membership gets NULL');
select is(pg_temp.board('401', 'front', 'c1250000-0000-4000-8000-00000000000c'), 'NULL', 'the owner of a clinic that is not full gets NULL');
select is(pg_temp.as_user('c1250000-0000-4000-8000-000000000101', $$ select coalesce(public.today_board(null, 'front')::text, 'NULL') $$), 'NULL', 'a NULL tenant gets NULL');
select is(pg_temp.as_user('c1250000-0000-4000-8000-000000000101', $$ select coalesce(public.today_board('c1250000-0000-4000-8000-00000000000a', null)::text, 'NULL') $$), 'NULL', 'a NULL mode gets NULL');
select is(pg_temp.board('101', 'everyone'), 'NULL', 'an unknown mode gets NULL');
select is(pg_temp.as_user('c1250000-0000-4000-8000-000000000101', $$ select coalesce(public.today_board('c1250000-0000-4000-8000-0000000000ff', 'front')::text, 'NULL') $$), 'NULL', 'an unknown tenant gets NULL');
select is((select coalesce(public.today_board('c1250000-0000-4000-8000-00000000000a', 'front')::text, 'NULL')), 'NULL', 'with no session (no auth.uid()) the read is NULL');
select isnt(pg_temp.board('101'), 'NULL', 'the owner of A reads the board');

-- 3. The versions -----------------------------------------------------------------------------------------------------------------
select is((select pg_temp.board(u)::jsonb -> 'versions' from (values ('101')) v (u)),
  (select jsonb_object_agg(cv.domain, cv.version) from public.clinic_versions cv where cv.tenant_id = 'c1250000-0000-4000-8000-00000000000a'),
  'the versions of the answer equal clinic_versions of the clinic in the same transaction');
select is((select count(*)::int from (select pg_temp.board(u)::jsonb -> 'versions' as v from (values ('101'), ('102'), ('103'), ('104'), ('105')) r (u)) x
           where x.v = (select jsonb_object_agg(cv.domain, cv.version) from public.clinic_versions cv where cv.tenant_id = 'c1250000-0000-4000-8000-00000000000a')),
  5, 'every role reads the same four versions');
select is(pg_temp.board('101')::jsonb ->> 'time_zone', 'Asia/Kolkata', 'the stored zone is returned as stored');

-- 4. The role x part matrix --------------------------------------------------------------------------------------------------------
select is(pg_temp.field('101', '2001', '{has_allergy}'), 'true', 'owner: the allergy flag');
select is(pg_temp.field('102', '2001', '{has_allergy}'), 'true', 'doctor: the allergy flag');
select is(pg_temp.field('104', '2001', '{has_allergy}'), 'true', 'nurse: the allergy flag');
select is(pg_temp.field('105', '2001', '{has_allergy}'), 'absent', 'receptionist: no allergy flag (JSON null reads as absent)');
select is(pg_temp.field('103', '2001', '{has_allergy}'), 'absent', 'admin: no allergy flag');
select is(pg_temp.field('102', '2003', '{vitals,systolic}'), '150', 'doctor: the vitals');
select is(pg_temp.field('104', '2003', '{vitals,systolic}'), '150', 'nurse: the vitals (consultations:view)');
select is(pg_temp.field('105', '2003', '{vitals,systolic}'), 'absent', 'receptionist: no vitals');
select is(pg_temp.field('103', '2003', '{vitals,systolic}'), 'absent', 'admin: no vitals');
select is(pg_temp.field('101', '2004', '{invoice,total_amount}'), '1000.00', 'owner: the invoice');
select is(pg_temp.field('105', '2004', '{invoice,total_amount}'), '1000.00', 'receptionist: the invoice');
select is(pg_temp.field('103', '2004', '{invoice,total_amount}'), '1000.00', 'admin: the invoice');
select is(pg_temp.field('102', '2004', '{invoice,total_amount}'), 'absent', 'doctor: no invoice (no billing:view)');
select is(pg_temp.field('104', '2004', '{invoice,total_amount}'), 'absent', 'nurse: no invoice');
select is(pg_temp.field('105', '2004', '{follow_up,date}'), (pg_temp.d0() + 6)::text, 'receptionist (appointments:edit): the follow-up date');
select is(pg_temp.field('104', '2004', '{follow_up,date}'), (pg_temp.d0() + 6)::text, 'nurse (appointments:edit): the follow-up date too');

-- 5. Only the fields a row shows ---------------------------------------------------------------------------------------------------
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.visit('101', '2004')::jsonb) k),
  'doctor_id,follow_up,has_allergy,id,invoice,is_overbooked,origin_type,patient,patient_id,row_version,scheduled_at,signed_at,status,token,vitals',
  'a visit carries exactly the fields a row shows (and its row_version)');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.visit('101', '2001')::jsonb -> 'patient') k),
  'age,date_of_birth,full_name,phone,sex', 'its patient carries five fields: no address, allergen names or national id');
select is((select count(*)::int from (values ('101'), ('102'), ('103'), ('104'), ('105')) r (u)
           where pg_temp.board(u) ~* 'Qzboardallergen|Synthetic address|Synthetic confidential note|Synthetic follow-up note'), 0,
  'no allergen name, address, clinical note or follow-up note appears in any role''s answer');

-- 6. The clinic day ---------------------------------------------------------------------------------------------------------------
select is(pg_temp.ids('101'), '2001,2002,2003,2004,2005,2006,2009', 'the day: today''s booking and walk-ins; not yesterday''s booking (2007), a booking six days ahead (2008) or another clinic''s');
select is(pg_temp.ids('101', 'front', null, (pg_temp.d0() - 1)::text), '2007', 'p_date reads another day (yesterday)');
select is(pg_temp.ids('101', 'front', null, (pg_temp.d0() + 6)::text), '2008', 'p_date reads another day (a booking six days ahead)');
select is(pg_temp.ids('101', 'front', null, (pg_temp.d0() + 30)::text), 'none', 'a day with no visit is an empty list');
select is(pg_temp.board('101', 'front', 'c1250000-0000-4000-8000-00000000000a', null, (pg_temp.d0() + 30)::text)::jsonb -> 'visits', '[]'::jsonb, 'an empty day is [] not NULL');

-- 7. Doctor mode -------------------------------------------------------------------------------------------------------------------
select is(pg_temp.ids('102', 'doctor'), '2001,2002,2004,2006', 'doctor mode with no doctor: the caller''s own visits');
select is(pg_temp.ids('106', 'doctor'), '2003,2005', 'doctor mode: the second doctor''s own visits');
select is(pg_temp.ids('101', 'doctor'), 'none', 'doctor mode: an owner with no visits of their own sees none');
select is(pg_temp.ids('101', 'doctor', 'c1250000-0000-4000-8000-000000000106'), '2003,2005', 'doctor mode with p_doctor_id: that doctor''s visits');
select is(pg_temp.ids('105', 'front', 'c1250000-0000-4000-8000-000000000106'), '2003,2005', 'front mode with p_doctor_id: filtered the same way');
select is(pg_temp.ids('104', 'triage'), '2001,2002,2003,2004,2005,2006,2009', 'triage mode lists the whole day');

-- 8. Invoices ----------------------------------------------------------------------------------------------------------------------
select is(pg_temp.field('101', '2004', '{invoice,paid}'), '400.00', 'payments are summed');
select is(pg_temp.field('101', '2005', '{invoice,paid}'), 'absent', 'a completed visit with no invoice carries none');
select is(pg_temp.field('101', '2006', '{invoice,paid}'), 'absent', 'a cancelled invoice is no invoice');
select is(pg_temp.field('101', '2002', '{invoice,paid}'), 'absent', 'a visit that is not completed carries no invoice part');
select is(pg_temp.field('101', '2004', '{invoice,row_version}'), '0', 'the invoice carries its row_version');

-- 9. Follow-up, row versions, doctors ------------------------------------------------------------------------------------------------
select is(pg_temp.field('105', '2004', '{follow_up,booked}'), 'true', 'a booked visit of the same doctor on the follow-up day makes it booked');
update public.visits set status = 'cancelled' where id = 'c1250000-0000-4000-8000-000000002008';
select is(pg_temp.field('105', '2004', '{follow_up,booked}'), 'false', 'a cancelled one does not');
select is(pg_temp.field('105', '2005', '{follow_up,date}'), 'absent', 'a completed visit with no follow-up carries none');
select is(pg_temp.field('105', '2002', '{follow_up,date}'), 'absent', 'a visit that is not completed carries no follow-up');
select is(pg_temp.field('101', '2001', '{row_version}'), '0', 'a new visit starts at row_version 0');
update public.visits set is_overbooked = false where id = 'c1250000-0000-4000-8000-000000002001';
select is(pg_temp.field('101', '2001', '{row_version}'), '1', 'the row_version moves with a listed column');
select is(pg_temp.field('102', '2002', '{token,token_number}'), '11', 'the token number is on the visit');
select is(pg_temp.field('102', '2002', '{token,priority}'), 'urgent', 'the token priority is on the visit');
select is((select string_agg(d ->> 'full_name', ',' order by d ->> 'full_name') from jsonb_array_elements(pg_temp.board('105')::jsonb -> 'doctors') d),
  'Synthetic Doctor One,Synthetic Doctor Two,Synthetic Owner,Synthetic Removed Doctor', 'doctors: the clinic''s doctors and the practising owner, including one who has left (a past visit still names them)');
select is(pg_temp.field('101', '2009', '{doctor_id}'), 'c1250000-0000-4000-8000-000000000107', 'the removed doctor''s visit is listed');

select * from finish();
rollback;
