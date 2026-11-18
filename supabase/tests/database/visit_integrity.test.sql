-- visit_integrity.test.sql — V2-05 fix plan 05-11a (05a review triage H-VISIT, M-ACTOR, M-SIGNED, M-DURATION,
-- M-TOKEN, M-INVOICE doctor_id part; migrations 000068-000070). Each case is a reproduction from the review reports
-- (reviews/v205a-review-*.md) that succeeded before 05-11a:
--   1. H-VISIT (INT H-1, RLS M-3, IND M1): nobody re-keys a visit to another patient; only a consultations:edit holder
--      signs, only as itself; a signature is never cleared or replaced outside the amendment path; a signed visit is
--      reopened only after the caller wrote an amendment row, and each reopen needs a new one; a signed visit keeps
--      its doctor; a signer is a member of the clinic (FK);
--   2. M-INVOICE (IND M2, RLS L-1): a doctor cannot take a colleague's visit (doctor_id); the front desk can;
--   3. M-ACTOR: visit created_by, prescription doctor_id (and the visit's patient), amendment author = the caller;
--   4. M-SIGNED (INT M-3): notes and vitals of a signed visit are locked unless it is reopened;
--   5. M-DURATION (INT M-1, IND L1): 5..480 minutes; the constraints are validated;
--   6. M-TOKEN (INT M-2): the counter refuses to pass 9999 and nothing is written.
-- Synthetic data only; the file rolls back.
begin;
select plan(45);

insert into auth.users (id, email) values
  ('c11a0000-0000-4000-8000-000000000101', 'c11a-owner-a@example.test'),
  ('c11a0000-0000-4000-8000-000000000102', 'c11a-doctor-a@example.test'),
  ('c11a0000-0000-4000-8000-000000000103', 'c11a-doctor2-a@example.test'),
  ('c11a0000-0000-4000-8000-000000000104', 'c11a-receptionist-a@example.test'),
  ('c11a0000-0000-4000-8000-000000000105', 'c11a-nurse-a@example.test'),
  ('c11a0000-0000-4000-8000-000000000201', 'c11a-owner-b@example.test');
insert into public.tenants (id, name) values
  ('c11a0000-0000-4000-8000-00000000000a', 'Synthetic 05-11a Clinic A'),
  ('c11a0000-0000-4000-8000-00000000000b', 'Synthetic 05-11a Clinic B');
insert into public.memberships (user_id, tenant_id, role) values
  ('c11a0000-0000-4000-8000-000000000101', 'c11a0000-0000-4000-8000-00000000000a', 'owner'),
  ('c11a0000-0000-4000-8000-000000000102', 'c11a0000-0000-4000-8000-00000000000a', 'doctor'),
  ('c11a0000-0000-4000-8000-000000000103', 'c11a0000-0000-4000-8000-00000000000a', 'doctor'),
  ('c11a0000-0000-4000-8000-000000000104', 'c11a0000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c11a0000-0000-4000-8000-000000000105', 'c11a0000-0000-4000-8000-00000000000a', 'nurse'),
  ('c11a0000-0000-4000-8000-000000000201', 'c11a0000-0000-4000-8000-00000000000b', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c11a0000-0000-4000-8000-000000001001', 'c11a0000-0000-4000-8000-00000000000a', 'Synthetic Patient One', '+919000001101', 'c11a0000-0000-4000-8000-000000000101'),
  ('c11a0000-0000-4000-8000-000000001002', 'c11a0000-0000-4000-8000-00000000000a', 'Synthetic Patient Two', '+919000001102', 'c11a0000-0000-4000-8000-000000000101');
-- 2001: completed and signed by doctor A, with notes. 2002: in consultation, unsigned. 2003: booked, unsigned.
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, signed_at, signed_by, created_by) values
  ('c11a0000-0000-4000-8000-000000002001', 'c11a0000-0000-4000-8000-00000000000a', 'c11a0000-0000-4000-8000-000000001001',
   'c11a0000-0000-4000-8000-000000000102', 'walk_in', 'completed', '2030-01-01 10:00+05:30', 'c11a0000-0000-4000-8000-000000000102',
   'c11a0000-0000-4000-8000-000000000101'),
  ('c11a0000-0000-4000-8000-000000002002', 'c11a0000-0000-4000-8000-00000000000a', 'c11a0000-0000-4000-8000-000000001001',
   'c11a0000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', null, null, 'c11a0000-0000-4000-8000-000000000101'),
  ('c11a0000-0000-4000-8000-000000002003', 'c11a0000-0000-4000-8000-00000000000a', 'c11a0000-0000-4000-8000-000000001001',
   'c11a0000-0000-4000-8000-000000000102', 'walk_in', 'booked', null, null, 'c11a0000-0000-4000-8000-000000000101');
update public.clinical_notes set clinical_notes = 'Synthetic note for patient one'
 where visit_id = 'c11a0000-0000-4000-8000-000000002001';

-- The single value p_sql returns as the user acting in p_header ('none' for no row); a 42501 is 'denied:<message>',
-- any other error 'error:<sqlstate>'. The JWT claims are cleared afterwards, so the next statement of this file runs
-- as a system path again (auth.uid() null). Not rolled back: an admitted write stays for the later cases.
create function pg_temp.as_user(p_user uuid, p_header uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', p_header)::text, true);
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

-- 1. H-VISIT ----------------------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000104', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set patient_id = 'c11a0000-0000-4000-8000-000000001002', signed_by = 'c11a0000-0000-4000-8000-000000000104',
      status = 'booked' where id = 'c11a0000-0000-4000-8000-000000002001' returning 'updated'$$),
  'denied:VISIT_KEY_IMMUTABLE', 'INT H-1 reproduction: a receptionist cannot move a signed visit to another patient');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000102', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set patient_id = 'c11a0000-0000-4000-8000-000000001002'
     where id = 'c11a0000-0000-4000-8000-000000002003' returning 'updated'$$),
  'denied:VISIT_KEY_IMMUTABLE', 'a doctor cannot re-key even an unsigned visit to another patient');
select throws_ok($$update public.visits set patient_id = 'c11a0000-0000-4000-8000-000000001002'
  where id = 'c11a0000-0000-4000-8000-000000002001'$$, '42501', 'VISIT_KEY_IMMUTABLE',
  'patient_id is immutable on a system path too (service role, migrations)');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000104', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set status = 'completed', signed_at = now(), signed_by = 'c11a0000-0000-4000-8000-000000000102'
     where id = 'c11a0000-0000-4000-8000-000000002002' returning 'updated'$$),
  'denied:VISIT_SIGNOFF_FORBIDDEN', 'RLS M-3 reproduction: a receptionist cannot mark a visit signed by a doctor');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000104', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set status = 'in_consultation', signed_at = null, signed_by = null
     where id = 'c11a0000-0000-4000-8000-000000002001' returning 'updated'$$),
  'denied:VISIT_SIGNOFF_FORBIDDEN', 'IND M1 reproduction: a receptionist cannot un-sign a consultation');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000104', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set status = 'in_consultation' where id = 'c11a0000-0000-4000-8000-000000002001' returning 'updated'$$),
  'denied:VISIT_SIGNED_STATUS_FORBIDDEN', 'a receptionist cannot reopen a signed visit');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000104', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set status = 'cancelled' where id = 'c11a0000-0000-4000-8000-000000002001' returning 'updated'$$),
  'denied:VISIT_SIGNED_STATUS_FORBIDDEN', 'a receptionist cannot cancel a signed visit');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000103', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set status = 'completed', signed_at = now(), signed_by = 'c11a0000-0000-4000-8000-000000000102'
     where id = 'c11a0000-0000-4000-8000-000000002002' returning 'updated'$$),
  'denied:VISIT_SIGNOFF_FORBIDDEN', 'a doctor cannot sign in another doctor''s name');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000103', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set signed_at = now(), signed_by = 'c11a0000-0000-4000-8000-000000000103'
     where id = 'c11a0000-0000-4000-8000-000000002001' returning 'updated'$$),
  'denied:VISIT_SIGNOFF_FORBIDDEN', 'a doctor cannot replace a signature on a completed visit (only finalizing an amendment re-signs)');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000102', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set signed_at = null, signed_by = null, status = 'completed'
     where id = 'c11a0000-0000-4000-8000-000000002001' returning 'updated'$$),
  'denied:VISIT_SIGNOFF_FORBIDDEN', 'the signer cannot clear the signature either');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000102', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set status = 'in_consultation' where id = 'c11a0000-0000-4000-8000-000000002001' returning 'updated'$$),
  'denied:VISIT_REOPEN_NEEDS_AMENDMENT', 'a doctor cannot reopen a signed visit without an amendment row');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000103', 'c11a0000-0000-4000-8000-00000000000a',
  $$insert into public.visit_revisions (tenant_id, visit_id, revision_number, amended_by, amendment_reason, snapshot)
    values ('c11a0000-0000-4000-8000-00000000000a', 'c11a0000-0000-4000-8000-000000002001', 1,
            'c11a0000-0000-4000-8000-000000000103', 'Synthetic amendment by doctor two', '{}') returning 'inserted'$$),
  'inserted', 'a second doctor writes an amendment row as itself');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000102', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set status = 'in_consultation' where id = 'c11a0000-0000-4000-8000-000000002001' returning 'updated'$$),
  'denied:VISIT_REOPEN_NEEDS_AMENDMENT', 'another doctor''s amendment row does not let this doctor reopen');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000102', 'c11a0000-0000-4000-8000-00000000000a',
  $$insert into public.visit_revisions (tenant_id, visit_id, revision_number, amended_by, amendment_reason, snapshot)
    values ('c11a0000-0000-4000-8000-00000000000a', 'c11a0000-0000-4000-8000-000000002001', 2,
            'c11a0000-0000-4000-8000-000000000102', 'Synthetic amendment by doctor one', '{}') returning 'inserted'$$),
  'inserted', 'the doctor writes an amendment row (the app''s reopenVisitForAmendment step 6)');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000102', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set status = 'in_consultation' where id = 'c11a0000-0000-4000-8000-000000002001'
    returning current_revision::text$$),
  '3', 'then reopens it (step 7); current_revision moves past the amendment row (2 -> 3)');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000102', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.clinical_notes set clinical_notes = 'Synthetic amended note'
     where visit_id = 'c11a0000-0000-4000-8000-000000002001' returning 'updated'$$),
  'updated', 'a reopened visit''s notes can be amended');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000102', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set status = 'completed' where id = 'c11a0000-0000-4000-8000-000000002001' returning 'updated'$$),
  'denied:VISIT_SIGNED_STATUS_FORBIDDEN', 'finalizing an amendment without re-signing is refused');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000102', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set status = 'completed', signed_at = now(), signed_by = 'c11a0000-0000-4000-8000-000000000102'
     where id = 'c11a0000-0000-4000-8000-000000002001' returning signed_by::text$$),
  'c11a0000-0000-4000-8000-000000000102', 'finalizing re-signs as the caller (finalizeVisitAmendment step 4)');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000102', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set status = 'in_consultation' where id = 'c11a0000-0000-4000-8000-000000002001' returning 'updated'$$),
  'denied:VISIT_REOPEN_NEEDS_AMENDMENT', 'a second reopen needs a new amendment row (the old one is spent)');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000104', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set doctor_id = 'c11a0000-0000-4000-8000-000000000103'
     where id = 'c11a0000-0000-4000-8000-000000002001' returning 'updated'$$),
  'denied:VISIT_SIGNED_DOCTOR_IMMUTABLE', 'a signed visit keeps its doctor, even for the front desk');
select throws_ok($$update public.visits set doctor_id = 'c11a0000-0000-4000-8000-000000000103'
  where id = 'c11a0000-0000-4000-8000-000000002001'$$, '42501', 'VISIT_SIGNED_DOCTOR_IMMUTABLE',
  'a signed visit keeps its doctor on a system path too');
select throws_ok($$update public.visits set status = 'completed', signed_at = now(), signed_by = 'c11a0000-0000-4000-8000-000000000201'
  where id = 'c11a0000-0000-4000-8000-000000002002'$$, '23503', null,
  'IND M1: a signer who is not a member of the clinic is refused (visits_tenant_signed_by_fkey), even on a system path');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000102', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set status = 'completed', signed_at = now(), signed_by = 'c11a0000-0000-4000-8000-000000000102'
     where id = 'c11a0000-0000-4000-8000-000000002002' returning 'signed'$$),
  'signed', 'a doctor signs an open visit as itself (completeAndSignConsultation step 3)');

-- 2. M-INVOICE (doctor_id) ---------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000103', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set doctor_id = 'c11a0000-0000-4000-8000-000000000103'
     where id = 'c11a0000-0000-4000-8000-000000002003' returning 'updated'$$),
  'denied:VISIT_DOCTOR_REASSIGN_FORBIDDEN', 'IND M2 / RLS L-1 reproduction: a doctor cannot take a colleague''s visit');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000104', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set doctor_id = 'c11a0000-0000-4000-8000-000000000103'
     where id = 'c11a0000-0000-4000-8000-000000002003' returning doctor_id::text$$),
  'c11a0000-0000-4000-8000-000000000103', 'the front desk reassigns an unsigned visit');

-- 3. M-ACTOR ------------------------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000104', 'c11a0000-0000-4000-8000-00000000000a',
  $$insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, created_by)
    values ('c11a0000-0000-4000-8000-00000000000a', 'c11a0000-0000-4000-8000-000000001002',
            'c11a0000-0000-4000-8000-000000000102', 'walk_in', 'c11a0000-0000-4000-8000-000000000101') returning 'inserted'$$),
  'denied:VISIT_ACTOR_NOT_CALLER', 'a visit is not inserted in another user''s name');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000104', 'c11a0000-0000-4000-8000-00000000000a',
  $$insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, created_by, status, signed_at, signed_by)
    values ('c11a0000-0000-4000-8000-00000000000a', 'c11a0000-0000-4000-8000-000000001002',
            'c11a0000-0000-4000-8000-000000000102', 'walk_in', 'c11a0000-0000-4000-8000-000000000104', 'completed', now(),
            'c11a0000-0000-4000-8000-000000000102') returning 'inserted'$$),
  'denied:VISIT_SIGNOFF_FORBIDDEN', 'a visit is not inserted already signed');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000104', 'c11a0000-0000-4000-8000-00000000000a',
  $$insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, created_by)
    values ('c11a0000-0000-4000-8000-00000000000a', 'c11a0000-0000-4000-8000-000000001002',
            'c11a0000-0000-4000-8000-000000000102', 'walk_in', 'c11a0000-0000-4000-8000-000000000104') returning 'inserted'$$),
  'inserted', 'a receptionist books a visit as itself');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000104', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set created_by = 'c11a0000-0000-4000-8000-000000000104'
     where id = 'c11a0000-0000-4000-8000-000000002003' returning 'updated'$$),
  'denied:VISIT_ACTOR_IMMUTABLE', 'created_by never changes (not even to the caller)');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000102', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.visits set current_revision = 99 where id = 'c11a0000-0000-4000-8000-000000002003' returning 'updated'$$),
  'denied:VISIT_REVISION_FORBIDDEN', 'current_revision is written only by the reopen path');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000103', 'c11a0000-0000-4000-8000-00000000000a',
  $$insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id)
    values ('c11a0000-0000-4000-8000-000000003001', 'c11a0000-0000-4000-8000-00000000000a', 'c11a0000-0000-4000-8000-000000002003',
            'c11a0000-0000-4000-8000-000000001001', 'c11a0000-0000-4000-8000-000000000102') returning 'inserted'$$),
  'denied:PRESCRIPTION_DOCTOR_NOT_CALLER', 'IND L2 reproduction: a doctor cannot prescribe in another doctor''s name');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000103', 'c11a0000-0000-4000-8000-00000000000a',
  $$insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id)
    values ('c11a0000-0000-4000-8000-000000003001', 'c11a0000-0000-4000-8000-00000000000a', 'c11a0000-0000-4000-8000-000000002003',
            'c11a0000-0000-4000-8000-000000001002', 'c11a0000-0000-4000-8000-000000000103') returning 'inserted'$$),
  'denied:PRESCRIPTION_PATIENT_MISMATCH', 'a prescription names the visit''s own patient');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000103', 'c11a0000-0000-4000-8000-00000000000a',
  $$insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id)
    values ('c11a0000-0000-4000-8000-000000003001', 'c11a0000-0000-4000-8000-00000000000a', 'c11a0000-0000-4000-8000-000000002003',
            'c11a0000-0000-4000-8000-000000001001', 'c11a0000-0000-4000-8000-000000000103') returning 'inserted'$$),
  'inserted', 'a doctor prescribes as itself');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000102', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.prescriptions set doctor_id = 'c11a0000-0000-4000-8000-000000000102'
     where id = 'c11a0000-0000-4000-8000-000000003001' returning 'updated'$$),
  'denied:PRESCRIPTION_KEY_IMMUTABLE', 'a prescription''s prescriber never changes');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000103', 'c11a0000-0000-4000-8000-00000000000a',
  $$insert into public.visit_revisions (tenant_id, visit_id, revision_number, amended_by, amendment_reason, snapshot)
    values ('c11a0000-0000-4000-8000-00000000000a', 'c11a0000-0000-4000-8000-000000002001', 9,
            'c11a0000-0000-4000-8000-000000000102', 'Synthetic forged amendment', '{}') returning 'inserted'$$),
  'denied:AMENDMENT_AUTHOR_NOT_CALLER', 'RLS M-3 reproduction: an amendment is not attributed to another doctor');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000103', 'c11a0000-0000-4000-8000-00000000000a',
  $$insert into public.visit_revisions (tenant_id, visit_id, revision_number, amended_by, amended_at, amendment_reason, snapshot)
    values ('c11a0000-0000-4000-8000-00000000000a', 'c11a0000-0000-4000-8000-000000002001', 10,
            'c11a0000-0000-4000-8000-000000000103', '2001-01-01', 'Synthetic backdated amendment', '{}')
    returning (amended_at = now())::text$$),
  'true', 'an amendment''s time is the database clock, not the caller''s');

-- 4. M-SIGNED -------------------------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000102', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.clinical_notes set clinical_notes = 'rewritten after signing'
     where visit_id = 'c11a0000-0000-4000-8000-000000002001' returning 'updated'$$),
  'denied:CLINICAL_NOTES_VISIT_SIGNED', 'INT M-3 reproduction: a doctor cannot rewrite the notes of a signed visit');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000105', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.clinical_notes set vitals = '{"bp":"200/120"}'
     where visit_id = 'c11a0000-0000-4000-8000-000000002001' returning 'updated'$$),
  'denied:CLINICAL_NOTES_VISIT_SIGNED', 'INT M-3 reproduction: a nurse cannot rewrite the vitals of a signed visit');
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000105', 'c11a0000-0000-4000-8000-00000000000a',
  $$update public.clinical_notes set vitals = '{"bp":"120/80"}'
     where visit_id = 'c11a0000-0000-4000-8000-000000002003' returning 'updated'$$),
  'updated', 'a nurse still records vitals on an unsigned visit');

-- 5. M-DURATION -----------------------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000104', 'c11a0000-0000-4000-8000-00000000000a',
  $$insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at, estimated_duration_minutes, created_by)
    values ('c11a0000-0000-4000-8000-00000000000a', 'c11a0000-0000-4000-8000-000000001002', 'c11a0000-0000-4000-8000-000000000102',
            'scheduled', 'booked', '2030-03-04 10:00+05:30', 0, 'c11a0000-0000-4000-8000-000000000104') returning 'inserted'$$),
  'error:23514', 'INT M-1 reproduction: a zero-length slot (which overlapped nothing) is refused');
select throws_ok($$insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at, estimated_duration_minutes, created_by)
  values ('c11a0000-0000-4000-8000-00000000000a', 'c11a0000-0000-4000-8000-000000001002', 'c11a0000-0000-4000-8000-000000000102',
          'scheduled', 'booked', '2030-03-04 11:00+05:30', 2000000000, 'c11a0000-0000-4000-8000-000000000101')$$,
  '23514', null, 'a slot of years is refused, also on a system path');
select lives_ok($$insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at, estimated_duration_minutes, created_by)
  values ('c11a0000-0000-4000-8000-00000000000a', 'c11a0000-0000-4000-8000-000000001002', 'c11a0000-0000-4000-8000-000000000102',
          'scheduled', 'booked', '2030-03-04 12:00+05:30', 5, 'c11a0000-0000-4000-8000-000000000101'),
         ('c11a0000-0000-4000-8000-00000000000a', 'c11a0000-0000-4000-8000-000000001002', 'c11a0000-0000-4000-8000-000000000102',
          'scheduled', 'booked', '2030-03-04 13:00+05:30', 480, 'c11a0000-0000-4000-8000-000000000101')$$,
  'the bounds 5 and 480 are admitted');
select is(
  (select array_agg(conname || ':' || convalidated order by conname) from pg_constraint
    where conname in ('visits_duration_range', 'queue_tokens_token_range', 'visits_tenant_signed_by_fkey')),
  array['queue_tokens_token_range:true', 'visits_duration_range:true', 'visits_tenant_signed_by_fkey:true'],
  'the three 000068 constraints are validated (000069)');

-- 6. M-TOKEN: the counter stops at 9999 --------------------------------------------------------------------------------
insert into public.queue_token_counters (tenant_id, date, last_token) values
  ('c11a0000-0000-4000-8000-00000000000a', public.tenant_local_date('c11a0000-0000-4000-8000-00000000000a', now()), 9999);
select is(pg_temp.as_user('c11a0000-0000-4000-8000-000000000104', 'c11a0000-0000-4000-8000-00000000000a',
  $$select token_number::text from public.issue_queue_token('c11a0000-0000-4000-8000-000000002003')$$),
  'error:54000', 'past token 9999 the RPC refuses (no integer overflow, no out-of-range row)');
select is(
  (select row((select last_token from public.queue_token_counters where tenant_id = 'c11a0000-0000-4000-8000-00000000000a'),
              (select count(*) from public.queue_tokens where tenant_id = 'c11a0000-0000-4000-8000-00000000000a'))::text),
  row(9999, 0)::text, 'the refused call left the counter at 9999 and wrote no token row');

select * from finish();
rollback;
