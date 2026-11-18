-- signed_visit_fields.test.sql — V2-05 05a gate close (final re-check of 05-11e, reviews/v205a-review-recheck-05-11e.md;
-- migration 000078). Each NF-case reproduces a probe of the re-checker that succeeded at 000077:
--   NF-4: the front desk (and any appointments:edit holder) moves a signed, completed visit's date or relabels its
--         specialty with no amendment row; the amendment snapshot did not record the visit date;
--   NF-5: the signer chooses the signature time (back- or forward-dated) at sign-off and at the finalize re-sign.
-- The legitimate paths stay open in the same file: unsigned visits are rescheduled and relabelled; a reopened visit's
-- specialty and date are amended and re-signed; the system path is unchanged; a same-value write is not a change.
-- Synthetic data only; the file rolls back.
begin;
select plan(26);

insert into auth.users (id, email) values
  ('c0780000-0000-4000-8000-000000000101', 'c078-owner-a@example.test'),
  ('c0780000-0000-4000-8000-000000000102', 'c078-doctor-a@example.test'),
  ('c0780000-0000-4000-8000-000000000103', 'c078-doctor2-a@example.test'),
  ('c0780000-0000-4000-8000-000000000104', 'c078-receptionist-a@example.test');
insert into public.tenants (id, name) values ('c0780000-0000-4000-8000-00000000000a', 'Synthetic 000078 Clinic A');
insert into public.memberships (user_id, tenant_id, role) values
  ('c0780000-0000-4000-8000-000000000101', 'c0780000-0000-4000-8000-00000000000a', 'owner'),
  ('c0780000-0000-4000-8000-000000000102', 'c0780000-0000-4000-8000-00000000000a', 'doctor'),
  ('c0780000-0000-4000-8000-000000000103', 'c0780000-0000-4000-8000-00000000000a', 'doctor'),
  ('c0780000-0000-4000-8000-000000000104', 'c0780000-0000-4000-8000-00000000000a', 'receptionist');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c0780000-0000-4000-8000-000000001001', 'c0780000-0000-4000-8000-00000000000a', 'Synthetic Patient One', '+919000001401', 'c0780000-0000-4000-8000-000000000101');
-- Doctor A's visits (walk-ins with a date, so the slot constraint is out of play).
-- Signed and completed: V1 2001 (NF-4 front desk), V2 2002 (NF-4 amendment path).
-- Open: V3 2003 (legitimate reschedule), V4 2004 (NF-5 sign-off), V5 2005 (NF-5 future date).
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at, specialty, signed_at, signed_by, created_by) values
  ('c0780000-0000-4000-8000-000000002001', 'c0780000-0000-4000-8000-00000000000a', 'c0780000-0000-4000-8000-000000001001',
   'c0780000-0000-4000-8000-000000000102', 'walk_in', 'completed', '2030-02-01 10:00+05:30', 'general_physician',
   '2030-02-01 10:30+05:30', 'c0780000-0000-4000-8000-000000000102', 'c0780000-0000-4000-8000-000000000101'),
  ('c0780000-0000-4000-8000-000000002002', 'c0780000-0000-4000-8000-00000000000a', 'c0780000-0000-4000-8000-000000001001',
   'c0780000-0000-4000-8000-000000000102', 'walk_in', 'completed', '2030-02-02 10:00+05:30', 'general_physician',
   '2030-02-02 10:30+05:30', 'c0780000-0000-4000-8000-000000000102', 'c0780000-0000-4000-8000-000000000101'),
  ('c0780000-0000-4000-8000-000000002003', 'c0780000-0000-4000-8000-00000000000a', 'c0780000-0000-4000-8000-000000001001',
   'c0780000-0000-4000-8000-000000000102', 'walk_in', 'booked', '2030-02-03 10:00+05:30', 'general_physician',
   null, null, 'c0780000-0000-4000-8000-000000000101'),
  ('c0780000-0000-4000-8000-000000002004', 'c0780000-0000-4000-8000-00000000000a', 'c0780000-0000-4000-8000-000000001001',
   'c0780000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', '2030-02-04 10:00+05:30', 'general_physician',
   null, null, 'c0780000-0000-4000-8000-000000000101'),
  ('c0780000-0000-4000-8000-000000002005', 'c0780000-0000-4000-8000-00000000000a', 'c0780000-0000-4000-8000-000000001001',
   'c0780000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', '2030-02-05 10:00+05:30', 'general_physician',
   null, null, 'c0780000-0000-4000-8000-000000000101');

-- The single value p_sql returns as the user (acting in clinic A; 'none' for no row); a 42501 is 'denied:<message>',
-- any other error 'error:<sqlstate>'. Claims are cleared afterwards (next statement = system path). Not rolled back:
-- an admitted write stays for the later cases.
create function pg_temp.as_user(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c0780000-0000-4000-8000-00000000000a')::text, true);
  begin
    set local role authenticated;
    execute p_sql into v_out;
    reset role;
    v_out := coalesce(v_out, 'none');
  exception
    when insufficient_privilege then reset role; v_out := 'denied:' || sqlerrm;
    when others then reset role; v_out := 'error:' || sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  return v_out;
end;
$f$;
create function pg_temp.owner(p_sql text) returns text language sql as $f$
  select pg_temp.as_user('c0780000-0000-4000-8000-000000000101', p_sql)
$f$;
create function pg_temp.dr(p_sql text) returns text language sql as $f$
  select pg_temp.as_user('c0780000-0000-4000-8000-000000000102', p_sql)
$f$;
create function pg_temp.dr2(p_sql text) returns text language sql as $f$
  select pg_temp.as_user('c0780000-0000-4000-8000-000000000103', p_sql)
$f$;
create function pg_temp.rc(p_sql text) returns text language sql as $f$
  select pg_temp.as_user('c0780000-0000-4000-8000-000000000104', p_sql)
$f$;
-- The visit's stored date / specialty / signature, read on the system path.
create function pg_temp.visit_of(p_visit uuid) returns public.visits language sql as $f$
  select * from public.visits where id = p_visit
$f$;

-- NF-4: a signed, completed visit's date and specialty --------------------------------------------------------------------
select is(pg_temp.rc($$update public.visits set scheduled_at = '2029-06-01 09:00+05:30'
    where id = 'c0780000-0000-4000-8000-000000002001' returning 'ok'$$),
  'denied:VISIT_SIGNED_FIELD_IMMUTABLE', 'NF-4 repro: the receptionist cannot move a signed visit''s date');
select is(pg_temp.rc($$update public.visits set specialty = 'dental'
    where id = 'c0780000-0000-4000-8000-000000002001' returning 'ok'$$),
  'denied:VISIT_SIGNED_FIELD_IMMUTABLE', 'NF-4 repro: the receptionist cannot relabel a signed visit''s specialty');
select is(pg_temp.owner($$update public.visits set scheduled_at = '2031-01-01 09:00+05:30'
    where id = 'c0780000-0000-4000-8000-000000002001' returning 'ok'$$),
  'denied:VISIT_SIGNED_FIELD_IMMUTABLE', 'NF-4: the owner cannot move a signed visit''s date either');
select is(pg_temp.dr($$update public.visits set specialty = 'pediatrics'
    where id = 'c0780000-0000-4000-8000-000000002001' returning 'ok'$$),
  'denied:VISIT_SIGNED_FIELD_IMMUTABLE', 'NF-4: the signing doctor cannot relabel the signed visit without reopening it');
select is(pg_temp.dr2($$update public.visits set scheduled_at = '2030-01-15 09:00+05:30', specialty = 'dental'
    where id = 'c0780000-0000-4000-8000-000000002001' returning 'ok'$$),
  'denied:VISIT_SIGNED_FIELD_IMMUTABLE', 'NF-4: another doctor cannot change both in one statement');
select is((pg_temp.visit_of('c0780000-0000-4000-8000-000000002001')).scheduled_at, '2030-02-01 10:00+05:30'::timestamptz,
  'NF-4: the signed visit keeps its date');
select is((pg_temp.visit_of('c0780000-0000-4000-8000-000000002001')).specialty, 'general_physician',
  'NF-4: the signed visit keeps its specialty');
-- A write that names the same values changes nothing and stays admitted (the app re-sends unchanged fields).
select is(pg_temp.rc($$update public.visits set scheduled_at = '2030-02-01 10:00+05:30', specialty = 'general_physician',
    updated_at = now() where id = 'c0780000-0000-4000-8000-000000002001' returning 'ok'$$),
  'ok', 'NF-4 control: re-sending the same date and specialty is not a change');

-- NF-4 amendment path: the snapshot records the date; the reopen statement itself cannot change the fields --------------
select is(pg_temp.dr($$insert into public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason)
    values ('c0780000-0000-4000-8000-00000000000a', 'c0780000-0000-4000-8000-000000002002',
            'c0780000-0000-4000-8000-000000000102', 'Synthetic amendment reason') returning revision_number::text$$),
  '1', 'the doctor writes an amendment row of the signed visit');
select is((select (snapshot -> 'visit' ->> 'scheduled_at')::timestamptz from public.visit_revisions
            where visit_id = 'c0780000-0000-4000-8000-000000002002' and revision_number = 1),
  '2030-02-02 10:00+05:30'::timestamptz, 'NF-4: the amendment snapshot records the signed visit date');
select is((select snapshot -> 'visit' ->> 'specialty' from public.visit_revisions
            where visit_id = 'c0780000-0000-4000-8000-000000002002' and revision_number = 1),
  'general_physician', 'the amendment snapshot records the signed specialty');
select is(pg_temp.dr($$update public.visits set status = 'in_consultation', specialty = 'dental'
    where id = 'c0780000-0000-4000-8000-000000002002' returning 'ok'$$),
  'denied:VISIT_SIGNED_FIELD_IMMUTABLE', 'NF-4: the reopen statement cannot change the specialty in the same write');
select is(pg_temp.dr($$update public.visits set status = 'in_consultation'
    where id = 'c0780000-0000-4000-8000-000000002002' returning 'cur=' || current_revision$$),
  'cur=2', 'the doctor reopens the visit with the amendment row');
select is(pg_temp.dr($$update public.visits set specialty = 'pediatrics', scheduled_at = '2030-02-02 11:00+05:30'
    where id = 'c0780000-0000-4000-8000-000000002002' returning specialty$$),
  'pediatrics', 'NF-4 control: while reopened, the doctor corrects the specialty and the date');
select is(pg_temp.dr($$update public.visits set status = 'completed', signed_at = '2030-02-02 12:00+05:30',
    signed_by = 'c0780000-0000-4000-8000-000000000102' where id = 'c0780000-0000-4000-8000-000000002002' returning status$$),
  'completed', 'and finalizes the amendment');
select is(pg_temp.rc($$update public.visits set scheduled_at = '2030-02-02 10:00+05:30'
    where id = 'c0780000-0000-4000-8000-000000002002' returning 'ok'$$),
  'denied:VISIT_SIGNED_FIELD_IMMUTABLE', 'NF-4: the re-signed visit is locked again');

-- NF-4 controls: unsigned visits and the system path --------------------------------------------------------------------
select is(pg_temp.rc($$update public.visits set scheduled_at = '2030-02-03 12:00+05:30'
    where id = 'c0780000-0000-4000-8000-000000002003' returning 'ok'$$),
  'ok', 'NF-4 control: the receptionist reschedules an unsigned booked visit');
select is(pg_temp.dr($$update public.visits set specialty = 'dental'
    where id = 'c0780000-0000-4000-8000-000000002004' returning specialty$$),
  'dental', 'NF-4 control: the doctor sets the specialty of an open consultation');
update public.visits set scheduled_at = '2030-02-01 10:15+05:30' where id = 'c0780000-0000-4000-8000-000000002001';
select is((pg_temp.visit_of('c0780000-0000-4000-8000-000000002001')).scheduled_at, '2030-02-01 10:15+05:30'::timestamptz,
  'the system path (no caller) is unchanged by 000078 (N-9, V2-09a)');

-- NF-5: the signature time is the database clock -------------------------------------------------------------------------
select is(pg_temp.dr($$update public.visits set status = 'completed', signed_at = '1999-01-01 00:00+00',
    signed_by = 'c0780000-0000-4000-8000-000000000102' where id = 'c0780000-0000-4000-8000-000000002004' returning 'ok'$$),
  'ok', 'NF-5: the doctor signs, sending a backdated signature time');
select is((pg_temp.visit_of('c0780000-0000-4000-8000-000000002004')).signed_at, now(),
  'NF-5 repro: the stored signature time is the database clock, not the backdated value');
select is(pg_temp.dr($$update public.visits set status = 'completed', signed_at = '2099-12-31 00:00+00',
    signed_by = 'c0780000-0000-4000-8000-000000000102' where id = 'c0780000-0000-4000-8000-000000002005' returning 'ok'$$),
  'ok', 'NF-5: the doctor signs another visit, sending a future signature time');
select is((pg_temp.visit_of('c0780000-0000-4000-8000-000000002005')).signed_at, now(),
  'NF-5 repro: a forward-dated signature time is replaced by the database clock');
-- The finalize re-sign of an amendment: another doctor amends V4 and re-signs it with a backdated time.
select is(pg_temp.dr2($$insert into public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason)
    values ('c0780000-0000-4000-8000-00000000000a', 'c0780000-0000-4000-8000-000000002004',
            'c0780000-0000-4000-8000-000000000103', 'Synthetic amendment reason') returning 'ok'$$)
  || '/' || pg_temp.dr2($$update public.visits set status = 'in_consultation'
    where id = 'c0780000-0000-4000-8000-000000002004' returning 'reopened'$$)
  || '/' || pg_temp.dr2($$update public.visits set status = 'completed', signed_at = '1999-01-01 00:00+00',
    signed_by = 'c0780000-0000-4000-8000-000000000103' where id = 'c0780000-0000-4000-8000-000000002004' returning 'signed'$$),
  'ok/reopened/signed', 'NF-5: another doctor amends the visit and re-signs it with a backdated time');
select is((select signed_at::text || '/' || signed_by::text from public.visits where id = 'c0780000-0000-4000-8000-000000002004'),
  now()::text || '/c0780000-0000-4000-8000-000000000103',
  'NF-5 repro: the finalize re-sign stores the database clock and the new signer');
select is(pg_temp.dr($$update public.visits set status = 'completed', signed_at = null,
    signed_by = 'c0780000-0000-4000-8000-000000000102' where id = 'c0780000-0000-4000-8000-000000002003' returning 'ok'$$),
  'denied:VISIT_SIGNOFF_FORBIDDEN', 'NF-5 control: a sign-off without a signature time is still refused before the clock is applied');

select * from finish();
rollback;
