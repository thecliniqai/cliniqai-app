-- amendment_snapshot.test.sql — V2-05 fix plan 05-11e (re-check of the 05-11d fixes,
-- reviews/v205a-review-recheck-05-11d.md; migration 000077). Each NF-case reproduces a probe of the re-checker that
-- succeeded at 000076:
--   NF-1 route A: an amendment row written on an UNSIGNED visit later reopens the signed version, which is then
--        replaced without a snapshot; route B: a row written while another doctor's amendment is open reopens the
--        re-signed version the same way;
--   NF-2 route C: a decoy prescription header on a signed visit steers the amendment snapshot away from the signed
--        medicines, which are then deleted;
--   NF-3: a signed visit's follow-up is moved to another patient, rescheduled or deleted.
-- The legitimate paths stay open in the same file: a doctor amends a signed visit twice and each snapshot holds the
-- previous signed version with every Rx item; follow-ups are scheduled, rescheduled and cleared on open visits and
-- during an amendment; a front-desk follow-up with no visit; the latest-version read of the app.
-- Synthetic data only; the file rolls back.
begin;
select plan(60);

insert into auth.users (id, email) values
  ('c11e0000-0000-4000-8000-000000000101', 'c11e-owner-a@example.test'),
  ('c11e0000-0000-4000-8000-000000000102', 'c11e-doctor-a@example.test'),
  ('c11e0000-0000-4000-8000-000000000103', 'c11e-doctor2-a@example.test'),
  ('c11e0000-0000-4000-8000-000000000104', 'c11e-receptionist-a@example.test');
insert into public.tenants (id, name) values ('c11e0000-0000-4000-8000-00000000000a', 'Synthetic 05-11e Clinic A');
insert into public.memberships (user_id, tenant_id, role) values
  ('c11e0000-0000-4000-8000-000000000101', 'c11e0000-0000-4000-8000-00000000000a', 'owner'),
  ('c11e0000-0000-4000-8000-000000000102', 'c11e0000-0000-4000-8000-00000000000a', 'doctor'),
  ('c11e0000-0000-4000-8000-000000000103', 'c11e0000-0000-4000-8000-00000000000a', 'doctor'),
  ('c11e0000-0000-4000-8000-000000000104', 'c11e0000-0000-4000-8000-00000000000a', 'receptionist');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c11e0000-0000-4000-8000-000000001001', 'c11e0000-0000-4000-8000-00000000000a', 'Synthetic Patient One', '+919000001301', 'c11e0000-0000-4000-8000-000000000101'),
  ('c11e0000-0000-4000-8000-000000001002', 'c11e0000-0000-4000-8000-00000000000a', 'Synthetic Patient Two', '+919000001302', 'c11e0000-0000-4000-8000-000000000101');
-- Doctor A's visits. Signed and completed: V1 2001 (legitimate amendments), V2 2002 (route B), V6 2006 (route C).
-- Open: V3 2003 (patient Two), V4 2004 (patient One, unsigned: route A).
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, signed_at, signed_by, created_by) values
  ('c11e0000-0000-4000-8000-000000002001', 'c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000001001',
   'c11e0000-0000-4000-8000-000000000102', 'walk_in', 'completed', '2030-01-01 10:00+05:30', 'c11e0000-0000-4000-8000-000000000102',
   'c11e0000-0000-4000-8000-000000000101'),
  ('c11e0000-0000-4000-8000-000000002002', 'c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000001001',
   'c11e0000-0000-4000-8000-000000000102', 'walk_in', 'completed', '2030-01-02 10:00+05:30', 'c11e0000-0000-4000-8000-000000000102',
   'c11e0000-0000-4000-8000-000000000101'),
  ('c11e0000-0000-4000-8000-000000002003', 'c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000001002',
   'c11e0000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', null, null, 'c11e0000-0000-4000-8000-000000000101'),
  ('c11e0000-0000-4000-8000-000000002004', 'c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000001001',
   'c11e0000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', null, null, 'c11e0000-0000-4000-8000-000000000101'),
  ('c11e0000-0000-4000-8000-000000002006', 'c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000001001',
   'c11e0000-0000-4000-8000-000000000102', 'walk_in', 'completed', '2030-01-06 10:00+05:30', 'c11e0000-0000-4000-8000-000000000102',
   'c11e0000-0000-4000-8000-000000000101');
update public.clinical_notes set clinical_notes = 'Synthetic signed note V1' where visit_id = 'c11e0000-0000-4000-8000-000000002001';
update public.clinical_notes set clinical_notes = 'Synthetic signed note V2' where visit_id = 'c11e0000-0000-4000-8000-000000002002';
update public.clinical_notes set clinical_notes = 'Synthetic draft note V4' where visit_id = 'c11e0000-0000-4000-8000-000000002004';
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id, signed_at) values
  ('c11e0000-0000-4000-8000-000000003001', 'c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000002001',
   'c11e0000-0000-4000-8000-000000001001', 'c11e0000-0000-4000-8000-000000000102', '2030-01-01 10:00+05:30'),
  ('c11e0000-0000-4000-8000-000000003002', 'c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000002002',
   'c11e0000-0000-4000-8000-000000001001', 'c11e0000-0000-4000-8000-000000000102', '2030-01-02 10:00+05:30'),
  ('c11e0000-0000-4000-8000-000000003003', 'c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000002003',
   'c11e0000-0000-4000-8000-000000001002', 'c11e0000-0000-4000-8000-000000000102', null),
  ('c11e0000-0000-4000-8000-000000003004', 'c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000002004',
   'c11e0000-0000-4000-8000-000000001001', 'c11e0000-0000-4000-8000-000000000102', null),
  ('c11e0000-0000-4000-8000-000000003006', 'c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000002006',
   'c11e0000-0000-4000-8000-000000001001', 'c11e0000-0000-4000-8000-000000000102', '2030-01-06 10:00+05:30');
insert into public.prescription_items (id, prescription_id, medicine_name, dosage, duration, sort_order) values
  ('c11e0000-0000-4000-8000-000000003101', 'c11e0000-0000-4000-8000-000000003001', 'Synthetic Amoxicillin', '1-0-1', '5 days', 0),
  ('c11e0000-0000-4000-8000-000000003111', 'c11e0000-0000-4000-8000-000000003001', 'Synthetic Paracetamol', '0-0-1', '3 days', 1),
  ('c11e0000-0000-4000-8000-000000003102', 'c11e0000-0000-4000-8000-000000003002', 'Synthetic Azithromycin', '1-0-0', '3 days', 0),
  ('c11e0000-0000-4000-8000-000000003104', 'c11e0000-0000-4000-8000-000000003004', 'Synthetic Cetirizine', '0-0-1', '3 days', 0),
  ('c11e0000-0000-4000-8000-000000003106', 'c11e0000-0000-4000-8000-000000003006', 'Synthetic Doxycycline', '1-0-1', '7 days', 0);
insert into public.consultation_diagnoses (id, tenant_id, visit_id, patient_id, diagnosis_name) values
  ('c11e0000-0000-4000-8000-000000003201', 'c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000002001',
   'c11e0000-0000-4000-8000-000000001001', 'Synthetic signed diagnosis');
insert into public.follow_ups (id, tenant_id, patient_id, visit_id, doctor_id, follow_up_date) values
  ('c11e0000-0000-4000-8000-000000003301', 'c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000001001',
   'c11e0000-0000-4000-8000-000000002001', 'c11e0000-0000-4000-8000-000000000102', '2030-01-10');

-- The single value p_sql returns as the user (acting in clinic A; 'none' for no row); a 42501 is 'denied:<message>',
-- any other error 'error:<sqlstate>'. Claims are cleared afterwards (next statement = system path). Not rolled back:
-- an admitted write stays for the later cases.
create function pg_temp.as_user(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c11e0000-0000-4000-8000-00000000000a')::text, true);
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
create function pg_temp.dr(p_sql text) returns text language sql as $f$
  select pg_temp.as_user('c11e0000-0000-4000-8000-000000000102', p_sql)
$f$;
create function pg_temp.dr2(p_sql text) returns text language sql as $f$
  select pg_temp.as_user('c11e0000-0000-4000-8000-000000000103', p_sql)
$f$;
create function pg_temp.rc(p_sql text) returns text language sql as $f$
  select pg_temp.as_user('c11e0000-0000-4000-8000-000000000104', p_sql)
$f$;
-- An amendment row by p_user on p_visit (the app's reopenVisitForAmendment insert); returns its number.
create function pg_temp.amend(p_user uuid, p_visit uuid) returns text language sql as $f$
  select pg_temp.as_user(p_user, format($q$insert into public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason)
      values ('c11e0000-0000-4000-8000-00000000000a', %L, %L, 'Synthetic amendment reason') returning revision_number::text$q$,
      p_visit, p_user))
$f$;
create function pg_temp.reopen(p_user uuid, p_visit uuid) returns text language sql as $f$
  select pg_temp.as_user(p_user, format($q$update public.visits set status = 'in_consultation' where id = %L
      returning 'cur=' || current_revision$q$, p_visit))
$f$;
-- Finalize (re-sign) with the wall clock, so each signature differs inside this one transaction.
create function pg_temp.finalize(p_user uuid, p_visit uuid) returns text language sql as $f$
  select pg_temp.as_user(p_user, format($q$update public.visits set status = 'completed', signed_at = clock_timestamp(),
      signed_by = %L where id = %L returning 'ok'$q$, p_user, p_visit))
$f$;
create function pg_temp.snap(p_visit uuid, p_number int) returns jsonb language sql as $f$
  select snapshot from public.visit_revisions where visit_id = p_visit and revision_number = p_number
$f$;
create function pg_temp.snaps_with(p_visit uuid, p_text text) returns int language sql as $f$
  select count(*)::int from public.visit_revisions where visit_id = p_visit and strpos(snapshot::text, p_text) > 0
$f$;

-- NF-1 route A: an amendment row on an unsigned visit --------------------------------------------------------------------
select is(pg_temp.amend('c11e0000-0000-4000-8000-000000000103', 'c11e0000-0000-4000-8000-000000002004'),
  'denied:AMENDMENT_VISIT_NOT_SIGNED', 'NF-1 route A repro: a doctor cannot write an amendment row on an unsigned visit');
-- The same row written on the system path (which the guard still numbers and snapshots) must not reopen anything later.
insert into public.visit_revisions (tenant_id, visit_id, revision_number, amended_by, amendment_reason, snapshot)
values ('c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000002004', 1,
        'c11e0000-0000-4000-8000-000000000103', 'Synthetic pre-signature row', '{}');
select is(pg_temp.dr($$update public.clinical_notes set clinical_notes = 'Synthetic FINAL signed note V4'
    where visit_id = 'c11e0000-0000-4000-8000-000000002004' returning 'ok'$$), 'ok', 'the doctor writes the final note');
select is(pg_temp.dr($$update public.visits set status = 'completed', signed_at = clock_timestamp(),
    signed_by = 'c11e0000-0000-4000-8000-000000000102' where id = 'c11e0000-0000-4000-8000-000000002004' returning 'ok'$$),
  'ok', 'and signs the visit');
select is(pg_temp.reopen('c11e0000-0000-4000-8000-000000000103', 'c11e0000-0000-4000-8000-000000002004'),
  'denied:VISIT_REOPEN_NEEDS_AMENDMENT', 'NF-1 route A repro: a row taken before the signature does not reopen the signed visit');
select is(pg_temp.dr2($$update public.clinical_notes set clinical_notes = 'Synthetic REPLACED note'
    where visit_id = 'c11e0000-0000-4000-8000-000000002004' returning 'ok'$$),
  'denied:CLINICAL_NOTES_VISIT_SIGNED', 'so the signed note cannot be replaced');
select is(pg_temp.dr2($$delete from public.prescription_items where prescription_id = 'c11e0000-0000-4000-8000-000000003004'
    returning 'ok'$$), 'denied:PRESCRIPTION_ITEM_VISIT_SIGNED', 'nor the signed Rx item deleted');
select is((select clinical_notes from public.clinical_notes where visit_id = 'c11e0000-0000-4000-8000-000000002004'),
  'Synthetic FINAL signed note V4', 'the signed note is intact');
select is(pg_temp.amend('c11e0000-0000-4000-8000-000000000103', 'c11e0000-0000-4000-8000-000000002004'), '2',
  'a row written now, after the signature, is admitted');
select is(pg_temp.snaps_with('c11e0000-0000-4000-8000-000000002004', 'Synthetic FINAL signed note V4'), 1,
  'and it is a snapshot of the signed note');
select is(pg_temp.reopen('c11e0000-0000-4000-8000-000000000103', 'c11e0000-0000-4000-8000-000000002004'), 'cur=3',
  'that row reopens the visit');

-- NF-1 route B: a row written while another doctor's amendment is open ----------------------------------------------------
select is(pg_temp.amend('c11e0000-0000-4000-8000-000000000102', 'c11e0000-0000-4000-8000-000000002002'), '1',
  'route B: the doctor writes an amendment row on his signed visit');
select is(pg_temp.reopen('c11e0000-0000-4000-8000-000000000102', 'c11e0000-0000-4000-8000-000000002002'), 'cur=2',
  'and reopens it');
select is(pg_temp.amend('c11e0000-0000-4000-8000-000000000103', 'c11e0000-0000-4000-8000-000000002002'),
  'denied:AMENDMENT_VISIT_NOT_SIGNED', 'NF-1 route B repro: another doctor cannot write a row while the amendment is open');
insert into public.visit_revisions (tenant_id, visit_id, revision_number, amended_by, amendment_reason, snapshot)
values ('c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000002002', 2,
        'c11e0000-0000-4000-8000-000000000103', 'Synthetic mid-amendment row', '{}');
select is(pg_temp.dr($$update public.clinical_notes set clinical_notes = 'Synthetic amended note V2 FINAL'
    where visit_id = 'c11e0000-0000-4000-8000-000000002002' returning 'ok'$$), 'ok', 'the doctor makes his final edit');
select is(pg_temp.finalize('c11e0000-0000-4000-8000-000000000102', 'c11e0000-0000-4000-8000-000000002002'), 'ok',
  'and finalizes');
select is(pg_temp.reopen('c11e0000-0000-4000-8000-000000000103', 'c11e0000-0000-4000-8000-000000002002'),
  'denied:VISIT_REOPEN_NEEDS_AMENDMENT', 'NF-1 route B repro: a row taken while the visit was open does not reopen the re-signed version');
select is(pg_temp.snaps_with('c11e0000-0000-4000-8000-000000002002', 'Synthetic amended note V2 FINAL'), 0,
  'no snapshot of the re-signed version exists yet');
select is(pg_temp.amend('c11e0000-0000-4000-8000-000000000103', 'c11e0000-0000-4000-8000-000000002002'), '3',
  'the other doctor writes a row of the re-signed version');
select is(pg_temp.snaps_with('c11e0000-0000-4000-8000-000000002002', 'Synthetic amended note V2 FINAL'), 1,
  'which snapshots the re-signed note');
select is(pg_temp.reopen('c11e0000-0000-4000-8000-000000000103', 'c11e0000-0000-4000-8000-000000002002'), 'cur=4',
  'and only then reopens it (current_revision moves past every row)');
select is(pg_temp.finalize('c11e0000-0000-4000-8000-000000000103', 'c11e0000-0000-4000-8000-000000002002'), 'ok',
  'the other doctor finalizes');
select is(pg_temp.amend('c11e0000-0000-4000-8000-000000000102', 'c11e0000-0000-4000-8000-000000002002')
          || '/' || pg_temp.amend('c11e0000-0000-4000-8000-000000000103', 'c11e0000-0000-4000-8000-000000002002'), '4/5',
  'two doctors each write a row of the same signature');
select is(pg_temp.reopen('c11e0000-0000-4000-8000-000000000102', 'c11e0000-0000-4000-8000-000000002002'), 'cur=6',
  'the first row does not block the other doctor''s reopen (either row is a faithful snapshot)');
select is(pg_temp.finalize('c11e0000-0000-4000-8000-000000000102', 'c11e0000-0000-4000-8000-000000002002'), 'ok',
  'finalized again');
select is(pg_temp.reopen('c11e0000-0000-4000-8000-000000000103', 'c11e0000-0000-4000-8000-000000002002'),
  'denied:VISIT_REOPEN_NEEDS_AMENDMENT', 'the unused row of the earlier signature is spent');
-- A malformed legacy snapshot (planted with the triggers off) never matches, and never raises.
set local session_replication_role = replica;
insert into public.visit_revisions (tenant_id, visit_id, revision_number, amended_by, amendment_reason, snapshot)
values ('c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000002002', 50,
        'c11e0000-0000-4000-8000-000000000103', 'Synthetic legacy row',
        jsonb_build_object('captured_by', 'database', 'visit', jsonb_build_object('status', 'completed',
            'signed_by', 'c11e0000-0000-4000-8000-000000000102', 'signed_at', 'not-a-time')));
set local session_replication_role = origin;
select is(pg_temp.reopen('c11e0000-0000-4000-8000-000000000103', 'c11e0000-0000-4000-8000-000000002002'),
  'denied:VISIT_REOPEN_NEEDS_AMENDMENT', 'a legacy row with a malformed snapshot reopens nothing (no 22007 either)');

-- NF-2 route C: a decoy prescription header ------------------------------------------------------------------------------
select is(pg_temp.dr2($$insert into public.prescriptions (tenant_id, visit_id, patient_id, doctor_id, version)
    values ('c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000002006',
            'c11e0000-0000-4000-8000-000000001001', 'c11e0000-0000-4000-8000-000000000103', 99) returning 'ok'$$),
  'denied:PRESCRIPTION_VISIT_SIGNED', 'NF-2 route C repro: no new prescription header on a signed visit');
-- A decoy that exists anyway (system path, or one left from before) no longer steers the snapshot.
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id, version) values
  ('c11e0000-0000-4000-8000-000000003099', 'c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000002006',
   'c11e0000-0000-4000-8000-000000001001', 'c11e0000-0000-4000-8000-000000000103', 98);
select is(pg_temp.amend('c11e0000-0000-4000-8000-000000000103', 'c11e0000-0000-4000-8000-000000002006'), '1',
  'route C: the other doctor writes an amendment row');
select is(jsonb_array_length(pg_temp.snap('c11e0000-0000-4000-8000-000000002006', 1) -> 'prescriptions'), 2,
  'NF-2: the snapshot holds every prescription of the visit');
select is(pg_temp.snap('c11e0000-0000-4000-8000-000000002006', 1) -> 'prescriptions' -> 0 -> 'items' -> 0 ->> 'medicine_name',
  'Synthetic Doxycycline', 'NF-2 route C repro: including the signed medicines under the decoy');
select is(pg_temp.reopen('c11e0000-0000-4000-8000-000000000103', 'c11e0000-0000-4000-8000-000000002006'), 'cur=2',
  'the amendment reopens the visit');
select is(pg_temp.dr2($$delete from public.prescription_items where prescription_id = 'c11e0000-0000-4000-8000-000000003006'
    returning 'ok'$$), 'ok', 'the signed medicine is removed during the amendment');
select is(pg_temp.snaps_with('c11e0000-0000-4000-8000-000000002006', 'Synthetic Doxycycline'), 1,
  'NF-2 route C repro: a snapshot still holds the signed medicine');
select is(pg_temp.dr2($$insert into public.prescriptions (tenant_id, visit_id, patient_id, doctor_id, version)
    values ('c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000002006',
            'c11e0000-0000-4000-8000-000000001001', 'c11e0000-0000-4000-8000-000000000103', 100) returning 'ok'$$),
  'ok', 'a header can be added while the visit is reopened for amendment');
select is(pg_temp.dr($$insert into public.prescriptions (tenant_id, visit_id, patient_id, doctor_id, version)
    values ('c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000002003',
            'c11e0000-0000-4000-8000-000000001002', 'c11e0000-0000-4000-8000-000000000102', 2) returning 'ok'$$),
  'ok', 'and on an open visit (control)');

-- NF-3: follow-ups ---------------------------------------------------------------------------------------------------------
select is(pg_temp.dr2($$update public.follow_ups set visit_id = 'c11e0000-0000-4000-8000-000000002003',
    patient_id = 'c11e0000-0000-4000-8000-000000001002' where id = 'c11e0000-0000-4000-8000-000000003301' returning 'ok'$$),
  'denied:FOLLOW_UP_KEY_IMMUTABLE', 'NF-3 repro: a signed visit''s follow-up cannot be moved to another patient');
select is(pg_temp.rc($$update public.follow_ups set follow_up_date = '2031-01-01'
    where id = 'c11e0000-0000-4000-8000-000000003301' returning 'ok'$$),
  'denied:FOLLOW_UP_VISIT_SIGNED', 'NF-3 repro: nor rescheduled while the visit is signed');
select is(pg_temp.dr($$delete from public.follow_ups where id = 'c11e0000-0000-4000-8000-000000003301' returning 'ok'$$),
  'denied:FOLLOW_UP_VISIT_SIGNED', 'NF-3: nor deleted');
select is(pg_temp.dr($$insert into public.follow_ups (tenant_id, patient_id, visit_id, doctor_id, follow_up_date)
    values ('c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000001001',
            'c11e0000-0000-4000-8000-000000002006', 'c11e0000-0000-4000-8000-000000000102', '2030-02-01') returning 'ok'$$),
  'ok', 'a follow-up is added while a visit is reopened for amendment (V6)');
select is(pg_temp.dr($$insert into public.follow_ups (tenant_id, patient_id, visit_id, doctor_id, follow_up_date)
    values ('c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000001001',
            'c11e0000-0000-4000-8000-000000002004', 'c11e0000-0000-4000-8000-000000000102', '2030-02-01') returning 'ok'$$),
  'ok', 'and on V4 while reopened');
select is(pg_temp.dr($$insert into public.follow_ups (tenant_id, patient_id, visit_id, doctor_id, follow_up_date)
    values ('c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000001001',
            'c11e0000-0000-4000-8000-000000002001', 'c11e0000-0000-4000-8000-000000000102', '2030-02-01') returning 'ok'$$),
  'denied:FOLLOW_UP_VISIT_SIGNED', 'NF-3: but not on a signed visit');
select is(pg_temp.dr($$insert into public.follow_ups (tenant_id, patient_id, visit_id, doctor_id, follow_up_date)
    values ('c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000001001',
            'c11e0000-0000-4000-8000-000000002003', 'c11e0000-0000-4000-8000-000000000102', '2030-02-01') returning 'ok'$$),
  'denied:FOLLOW_UP_PATIENT_MISMATCH', 'NF-3: a follow-up names its visit''s own patient');
select throws_ok($$update public.follow_ups set patient_id = 'c11e0000-0000-4000-8000-000000001002'
    where id = 'c11e0000-0000-4000-8000-000000003301'$$, '42501', 'FOLLOW_UP_KEY_IMMUTABLE',
  'NF-3: a follow-up''s patient never changes, on a system path either');
select is(pg_temp.dr($$insert into public.follow_ups (id, tenant_id, patient_id, visit_id, doctor_id, follow_up_date)
    values ('c11e0000-0000-4000-8000-000000003303', 'c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000001002',
            'c11e0000-0000-4000-8000-000000002003', 'c11e0000-0000-4000-8000-000000000102', '2030-02-01') returning 'ok'$$),
  'ok', 'the doctor schedules a follow-up on an open visit (recordFollowUp)');
select is(pg_temp.dr($$update public.follow_ups set follow_up_date = '2030-02-08', notes = 'Synthetic follow-up note'
    where id = 'c11e0000-0000-4000-8000-000000003303' returning follow_up_date::text$$),
  '2030-02-08', 'and changes it while the visit is open');
select is(pg_temp.rc($$update public.follow_ups set follow_up_date = '2030-02-09'
    where id = 'c11e0000-0000-4000-8000-000000003303' returning follow_up_date::text$$),
  '2030-02-09', 'the front desk reschedules a follow-up of an open visit');
select is(pg_temp.rc($$insert into public.follow_ups (tenant_id, patient_id, doctor_id, follow_up_date)
    values ('c11e0000-0000-4000-8000-00000000000a', 'c11e0000-0000-4000-8000-000000001002',
            'c11e0000-0000-4000-8000-000000000102', '2030-02-10') returning 'ok'$$),
  'ok', 'and books a follow-up with no visit');
select is(pg_temp.dr($$delete from public.follow_ups where id = 'c11e0000-0000-4000-8000-000000003303' returning 'ok'$$),
  'ok', 'the doctor clears an open visit''s follow-up (the "None" choice)');

-- Legitimate path: amend a signed visit twice; each snapshot is the previous signed version ------------------------------
select is(pg_temp.amend('c11e0000-0000-4000-8000-000000000102', 'c11e0000-0000-4000-8000-000000002001'), '1',
  'the doctor writes the first amendment row');
select is(jsonb_path_query_array(pg_temp.snap('c11e0000-0000-4000-8000-000000002001', 1),
                                 '$.prescriptions[*].items[*].medicine_name')::text,
  '["Synthetic Amoxicillin", "Synthetic Paracetamol"]', 'its snapshot holds every signed Rx item');
select is((pg_temp.snap('c11e0000-0000-4000-8000-000000002001', 1) -> 'visit' ->> 'clinical_notes') || '/'
          || (pg_temp.snap('c11e0000-0000-4000-8000-000000002001', 1) -> 'follow_ups' -> 0 ->> 'follow_up_date'),
  'Synthetic signed note V1/2030-01-10', 'and the signed note and follow-up');
select is(pg_temp.reopen('c11e0000-0000-4000-8000-000000000102', 'c11e0000-0000-4000-8000-000000002001'), 'cur=2',
  'the doctor reopens the visit');
select is(pg_temp.dr($$with n as (update public.clinical_notes set clinical_notes = 'Synthetic amended note V1'
                                   where visit_id = 'c11e0000-0000-4000-8000-000000002001' returning 1),
                          i as (update public.prescription_items set dosage = '1-1-1'
                                 where id = 'c11e0000-0000-4000-8000-000000003101' returning 1),
                          f as (update public.follow_ups set follow_up_date = '2030-01-12'
                                 where id = 'c11e0000-0000-4000-8000-000000003301' returning 1),
                          p as (update public.prescriptions set version = 2, amendment_reason = 'Synthetic amendment reason'
                                 where id = 'c11e0000-0000-4000-8000-000000003001' returning 1)
                     select ((select count(*) from n) + (select count(*) from i) + (select count(*) from f)
                             + (select count(*) from p))::text$$),
  '4', 'and amends the note, an Rx item and the follow-up, and bumps the Rx version (finalizeVisitAmendment)');
select is(pg_temp.finalize('c11e0000-0000-4000-8000-000000000102', 'c11e0000-0000-4000-8000-000000002001'), 'ok',
  'the first amendment is finalized');
select is(pg_temp.amend('c11e0000-0000-4000-8000-000000000102', 'c11e0000-0000-4000-8000-000000002001'), '2',
  'the second amendment row');
select is((pg_temp.snap('c11e0000-0000-4000-8000-000000002001', 2) -> 'visit' ->> 'clinical_notes') || '/'
          || jsonb_path_query_array(pg_temp.snap('c11e0000-0000-4000-8000-000000002001', 2),
                                    '$.prescriptions[*].items[*].dosage')::text || '/'
          || (pg_temp.snap('c11e0000-0000-4000-8000-000000002001', 2) -> 'prescriptions' -> 0 ->> 'version') || '/'
          || (pg_temp.snap('c11e0000-0000-4000-8000-000000002001', 2) -> 'follow_ups' -> 0 ->> 'follow_up_date'),
  'Synthetic amended note V1/["1-1-1", "0-0-1"]/2/2030-01-12', 'holds the first amended, re-signed version');
select is(pg_temp.reopen('c11e0000-0000-4000-8000-000000000102', 'c11e0000-0000-4000-8000-000000002001'), 'cur=3',
  'the second reopen');
select is(pg_temp.finalize('c11e0000-0000-4000-8000-000000000102', 'c11e0000-0000-4000-8000-000000002001'), 'ok',
  'the second amendment is finalized');
select is(pg_temp.snap('c11e0000-0000-4000-8000-000000002001', 1) -> 'visit' ->> 'clinical_notes',
  'Synthetic signed note V1', 'the first snapshot still holds the original signed note');
select is(pg_temp.dr($$select id::text || '/v' || version from public.prescriptions
    where visit_id = 'c11e0000-0000-4000-8000-000000002001' order by version desc limit 1$$),
  'c11e0000-0000-4000-8000-000000003001/v2', 'the app''s latest-version read still finds the amended prescription');

select * from finish();
rollback;
