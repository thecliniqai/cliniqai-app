-- reverify_integrity.test.sql — V2-05 fix plan 05-11d (05a re-verification, reviews/v205a-review-reverify.md;
-- migrations 000075-000076). Each N-case reproduces a probe from the re-verifier's report that succeeded at 000074:
--   N-1: prescription items and diagnoses of a signed encounter are re-keyed to another patient or edited by any doctor;
--        a diagnosis names a patient other than its visit's;
--   N-2: the amendment row's snapshot is whatever the caller sends ('{}' erases the record of the signed content);
--   N-8: a squatted revision number (2147483647) blocks every later amendment;
--   N-3: a doctor settles (paid without collecting) or zeroes an invoice through invoice_items;
--   N-5: patients.created_by names another user;
--   N-7: the notice link check accepts "/<TAB>/host".
-- The legitimate paths stay open in the same file: a doctor's own unsigned visit, amending a signed visit twice
-- (reopen, edit the children, finalize), adding a charge while a balance is due, paying through record_payment.
-- Synthetic data only; the file rolls back.
begin;
select plan(61);

insert into auth.users (id, email) values
  ('c11d0000-0000-4000-8000-000000000101', 'c11d-owner-a@example.test'),
  ('c11d0000-0000-4000-8000-000000000102', 'c11d-doctor-a@example.test'),
  ('c11d0000-0000-4000-8000-000000000103', 'c11d-doctor2-a@example.test'),
  ('c11d0000-0000-4000-8000-000000000104', 'c11d-receptionist-a@example.test'),
  ('c11d0000-0000-4000-8000-000000000201', 'c11d-owner-b@example.test');
insert into public.tenants (id, name) values
  ('c11d0000-0000-4000-8000-00000000000a', 'Synthetic 05-11d Clinic A'),
  ('c11d0000-0000-4000-8000-00000000000b', 'Synthetic 05-11d Clinic B');
insert into public.memberships (user_id, tenant_id, role) values
  ('c11d0000-0000-4000-8000-000000000101', 'c11d0000-0000-4000-8000-00000000000a', 'owner'),
  ('c11d0000-0000-4000-8000-000000000102', 'c11d0000-0000-4000-8000-00000000000a', 'doctor'),
  ('c11d0000-0000-4000-8000-000000000103', 'c11d0000-0000-4000-8000-00000000000a', 'doctor'),
  ('c11d0000-0000-4000-8000-000000000104', 'c11d0000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c11d0000-0000-4000-8000-000000000201', 'c11d0000-0000-4000-8000-00000000000b', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c11d0000-0000-4000-8000-000000001001', 'c11d0000-0000-4000-8000-00000000000a', 'Synthetic Patient One', '+919000001201', 'c11d0000-0000-4000-8000-000000000101'),
  ('c11d0000-0000-4000-8000-000000001002', 'c11d0000-0000-4000-8000-00000000000a', 'Synthetic Patient Two', '+919000001202', 'c11d0000-0000-4000-8000-000000000101');
-- V1 2001: patient One, doctor A, completed and signed. V3 2003: patient Two, open. V4 2004: patient One, open.
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, signed_at, signed_by, created_by) values
  ('c11d0000-0000-4000-8000-000000002001', 'c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000001001',
   'c11d0000-0000-4000-8000-000000000102', 'walk_in', 'completed', '2030-01-01 10:00+05:30', 'c11d0000-0000-4000-8000-000000000102',
   'c11d0000-0000-4000-8000-000000000101'),
  ('c11d0000-0000-4000-8000-000000002003', 'c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000001002',
   'c11d0000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', null, null, 'c11d0000-0000-4000-8000-000000000101'),
  ('c11d0000-0000-4000-8000-000000002004', 'c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000001001',
   'c11d0000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', null, null, 'c11d0000-0000-4000-8000-000000000101');
update public.clinical_notes set clinical_notes = 'Synthetic signed note 05-11d', vitals = '{"bp": "120/80"}'
 where visit_id = 'c11d0000-0000-4000-8000-000000002001';
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id, signed_at) values
  ('c11d0000-0000-4000-8000-000000003001', 'c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000002001',
   'c11d0000-0000-4000-8000-000000001001', 'c11d0000-0000-4000-8000-000000000102', '2030-01-01 10:00+05:30'),
  ('c11d0000-0000-4000-8000-000000003003', 'c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000002003',
   'c11d0000-0000-4000-8000-000000001002', 'c11d0000-0000-4000-8000-000000000102', null);
insert into public.prescription_items (id, prescription_id, medicine_name, dosage, duration) values
  ('c11d0000-0000-4000-8000-000000003101', 'c11d0000-0000-4000-8000-000000003001', 'Synthetic Amoxicillin', '1-0-1', '5 days'),
  ('c11d0000-0000-4000-8000-000000003103', 'c11d0000-0000-4000-8000-000000003003', 'Synthetic Paracetamol', '1-0-1', '3 days');
insert into public.consultation_diagnoses (id, tenant_id, visit_id, patient_id, diagnosis_name) values
  ('c11d0000-0000-4000-8000-000000003201', 'c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000002001',
   'c11d0000-0000-4000-8000-000000001001', 'Synthetic signed diagnosis'),
  ('c11d0000-0000-4000-8000-000000003203', 'c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000002003',
   'c11d0000-0000-4000-8000-000000001002', 'Synthetic open diagnosis');
-- I1 4001 (V1): one ₹500 charge. I4 4004 (V4): one ₹300 charge.
insert into public.invoices (id, tenant_id, visit_id, patient_id, invoice_number, status) values
  ('c11d0000-0000-4000-8000-000000004001', 'c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000002001',
   'c11d0000-0000-4000-8000-000000001001', 'C11D-0001', 'issued'),
  ('c11d0000-0000-4000-8000-000000004004', 'c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000002004',
   'c11d0000-0000-4000-8000-000000001001', 'C11D-0004', 'issued');
insert into public.invoice_items (id, tenant_id, invoice_id, item_type, description, unit_price, quantity, total_price) values
  ('c11d0000-0000-4000-8000-000000004101', 'c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000004001',
   'consultation', 'Synthetic consultation', 500, 1, 500),
  ('c11d0000-0000-4000-8000-000000004104', 'c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000004004',
   'consultation', 'Synthetic consultation', 300, 1, 300);

-- The single value p_sql returns as the user acting in clinic p_header ('none' for no row); a 42501 is
-- 'denied:<message>', any other error 'error:<sqlstate>'. Claims are cleared afterwards (next statement = system path).
-- Not rolled back: an admitted write stays for the later cases.
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

create function pg_temp.dr(p_sql text) returns text language sql as $f$
  select pg_temp.as_user('c11d0000-0000-4000-8000-000000000102', 'c11d0000-0000-4000-8000-00000000000a', p_sql)
$f$;
create function pg_temp.dr2(p_sql text) returns text language sql as $f$
  select pg_temp.as_user('c11d0000-0000-4000-8000-000000000103', 'c11d0000-0000-4000-8000-00000000000a', p_sql)
$f$;
create function pg_temp.rc(p_sql text) returns text language sql as $f$
  select pg_temp.as_user('c11d0000-0000-4000-8000-000000000104', 'c11d0000-0000-4000-8000-00000000000a', p_sql)
$f$;
create function pg_temp.invoice_state(p_invoice uuid) returns text language sql as $f$
  select subtotal || '/' || total_amount || '/' || status from public.invoices where id = p_invoice
$f$;
create function pg_temp.pay_sql(p_amount numeric, p_cmd text) returns text language sql as $f$
  select format($q$select public.record_payment('c11d0000-0000-4000-8000-00000000000a',
      'c11d0000-0000-4000-8000-000000004001', %s, 'cash', '', %L::uuid) ->> 'invoice_status'$q$, p_amount, p_cmd)
$f$;
create function pg_temp.revision(p_number int) returns jsonb language sql as $f$
  select snapshot from public.visit_revisions
   where visit_id = 'c11d0000-0000-4000-8000-000000002001' and revision_number = p_number
$f$;

-- N-1: children of an encounter -----------------------------------------------------------------------------------------
select is(pg_temp.dr2($$update public.prescription_items set prescription_id = 'c11d0000-0000-4000-8000-000000003003'
    where id = 'c11d0000-0000-4000-8000-000000003101' returning 'ok'$$),
  'denied:PRESCRIPTION_ITEM_KEY_IMMUTABLE', 'N-1 repro: a doctor cannot move a signed Rx item onto another patient''s Rx');
select throws_ok($$update public.prescription_items set tenant_id = 'c11d0000-0000-4000-8000-00000000000b'
    where id = 'c11d0000-0000-4000-8000-000000003103'$$, '42501', 'PRESCRIPTION_ITEM_KEY_IMMUTABLE',
  'an Rx item''s keys are immutable on a system path too');
select is(pg_temp.dr2($$update public.consultation_diagnoses set visit_id = 'c11d0000-0000-4000-8000-000000002003'
    where id = 'c11d0000-0000-4000-8000-000000003201' returning 'ok'$$),
  'denied:DIAGNOSIS_KEY_IMMUTABLE', 'N-1 repro: a doctor cannot move a signed diagnosis to another visit');
select is(pg_temp.dr2($$update public.consultation_diagnoses set visit_id = 'c11d0000-0000-4000-8000-000000002003',
    patient_id = 'c11d0000-0000-4000-8000-000000001002' where id = 'c11d0000-0000-4000-8000-000000003201' returning 'ok'$$),
  'denied:DIAGNOSIS_KEY_IMMUTABLE', 'N-1 repro: nor to another visit and patient together');
select throws_ok($$update public.consultation_diagnoses set patient_id = 'c11d0000-0000-4000-8000-000000001001'
    where id = 'c11d0000-0000-4000-8000-000000003203'$$, '42501', 'DIAGNOSIS_KEY_IMMUTABLE',
  'a diagnosis''s keys are immutable on a system path too');
select is(pg_temp.dr($$insert into public.consultation_diagnoses (tenant_id, visit_id, patient_id, diagnosis_name)
    values ('c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000002003',
            'c11d0000-0000-4000-8000-000000001001', 'Synthetic misplaced diagnosis') returning 'ok'$$),
  'denied:DIAGNOSIS_PATIENT_MISMATCH', 'a diagnosis cannot name a patient other than its visit''s');
select is(pg_temp.dr($$insert into public.consultation_diagnoses (tenant_id, visit_id, patient_id, diagnosis_name)
    values ('c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000002003',
            'c11d0000-0000-4000-8000-000000001002', 'Synthetic new diagnosis') returning 'ok'$$),
  'ok', 'control: the doctor records a diagnosis for the open visit''s own patient');
select is(pg_temp.dr2($$update public.prescription_items set medicine_name = 'Synthetic other', dosage = '4-4-4'
    where id = 'c11d0000-0000-4000-8000-000000003101' returning 'ok'$$),
  'denied:PRESCRIPTION_ITEM_VISIT_SIGNED', 'N-1 repro: a signed Rx item cannot be edited');
select is(pg_temp.dr($$delete from public.prescription_items where id = 'c11d0000-0000-4000-8000-000000003101' returning 'ok'$$),
  'denied:PRESCRIPTION_ITEM_VISIT_SIGNED', 'N-1 repro: nor deleted, even by the signing doctor');
select is(pg_temp.dr($$insert into public.prescription_items (prescription_id, medicine_name, dosage, duration)
    values ('c11d0000-0000-4000-8000-000000003001', 'Synthetic added', '1-0-0', '1 day') returning 'ok'$$),
  'denied:PRESCRIPTION_ITEM_VISIT_SIGNED', 'nor can an item be added to a signed Rx');
select is(pg_temp.dr($$update public.consultation_diagnoses set notes = 'Synthetic rewrite'
    where id = 'c11d0000-0000-4000-8000-000000003201' returning 'ok'$$),
  'denied:DIAGNOSIS_VISIT_SIGNED', 'a signed visit''s diagnosis cannot be edited');
select is(pg_temp.dr($$delete from public.consultation_diagnoses where id = 'c11d0000-0000-4000-8000-000000003201' returning 'ok'$$),
  'denied:DIAGNOSIS_VISIT_SIGNED', 'nor deleted');
select is(pg_temp.dr($$insert into public.consultation_diagnoses (tenant_id, visit_id, patient_id, diagnosis_name)
    values ('c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000002001',
            'c11d0000-0000-4000-8000-000000001001', 'Synthetic late diagnosis') returning 'ok'$$),
  'denied:DIAGNOSIS_VISIT_SIGNED', 'nor can one be added to a signed visit');
select is(pg_temp.dr($$update public.prescription_items set dosage = '1-1-1'
    where id = 'c11d0000-0000-4000-8000-000000003103' returning 'ok'$$),
  'ok', 'control: the items of an open visit stay editable');
select is((select medicine_name || '/' || dosage from public.prescription_items where id = 'c11d0000-0000-4000-8000-000000003101'),
  'Synthetic Amoxicillin/1-0-1', 'the signed item is unchanged');

-- N-2 + N-8: the amendment row is filled by the database ---------------------------------------------------------------
select is(pg_temp.dr2($$insert into public.visit_revisions (tenant_id, visit_id, revision_number, amended_by, amendment_reason, snapshot)
    values ('c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000002001', 2147483647,
            'c11d0000-0000-4000-8000-000000000103', 'Synthetic squat and erase', '{}') returning revision_number::text$$),
  '1', 'N-8 repro: a squatted number is ignored; the row gets previous + 1');
select is(pg_temp.revision(1) -> 'visit' ->> 'clinical_notes', 'Synthetic signed note 05-11d',
  'N-2 repro: a ''{}'' snapshot is replaced by the signed note');
select is(pg_temp.revision(1) -> 'visit' -> 'vitals' ->> 'bp', '120/80', 'N-2: the snapshot holds the signed vitals');
select is((pg_temp.revision(1) -> 'diagnoses' -> 0 ->> 'diagnosis_name') || '/'
          || (pg_temp.revision(1) -> 'prescription' -> 'items' -> 0 ->> 'medicine_name'),
  'Synthetic signed diagnosis/Synthetic Amoxicillin', 'N-2: and the signed diagnoses and Rx items');
select is(pg_temp.revision(1) -> 'visit' ->> 'signed_by', 'c11d0000-0000-4000-8000-000000000102',
  'N-2: and the signature it amends');
select is(pg_temp.dr($$insert into public.visit_revisions (tenant_id, visit_id, revision_number, amended_by, amendment_reason, snapshot)
    values ('c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000002001', 1,
            'c11d0000-0000-4000-8000-000000000102', 'Synthetic amendment one', '{}') returning revision_number::text$$),
  '2', 'the next amendment is numbered 2 (a client 1 is ignored)');
select is(pg_temp.dr($$update public.visits set status = 'in_consultation'
    where id = 'c11d0000-0000-4000-8000-000000002001' returning 'ok'$$),
  'ok', 'N-8: the squat does not block the doctor''s reopen');
select is(pg_temp.dr($$update public.prescription_items set dosage = '1-1-1'
    where id = 'c11d0000-0000-4000-8000-000000003101' returning 'ok'$$),
  'ok', 'a reopened visit''s Rx items are editable (amendment path)');
select is(pg_temp.dr($$update public.consultation_diagnoses set notes = 'Synthetic amended note'
    where id = 'c11d0000-0000-4000-8000-000000003201' returning 'ok'$$),
  'ok', 'and its diagnoses');
select is(pg_temp.dr($$update public.visits set status = 'completed', signed_at = now(),
    signed_by = 'c11d0000-0000-4000-8000-000000000102' where id = 'c11d0000-0000-4000-8000-000000002001' returning 'ok'$$),
  'ok', 'the doctor finalizes the amendment');
select is(pg_temp.dr($$update public.prescription_items set dosage = '0-0-1'
    where id = 'c11d0000-0000-4000-8000-000000003101' returning 'ok'$$),
  'denied:PRESCRIPTION_ITEM_VISIT_SIGNED', 'after finalizing, the items are locked again');
select is(pg_temp.dr($$insert into public.visit_revisions (tenant_id, visit_id, revision_number, amended_by, amendment_reason, snapshot)
    values ('c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000002001', 2,
            'c11d0000-0000-4000-8000-000000000102', 'Synthetic amendment two', '{}') returning revision_number::text$$),
  '3', 'a second amendment is numbered 3');
select is(pg_temp.revision(3) -> 'prescription' -> 'items' -> 0 ->> 'dosage', '1-1-1',
  'its snapshot is the amended, re-signed content');
insert into public.visit_revisions (tenant_id, visit_id, revision_number, amended_by, amendment_reason, snapshot)
values ('c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000002001', 99,
        'c11d0000-0000-4000-8000-000000000102', 'Synthetic system amendment', '{"forged": true}');
select is((select (snapshot ? 'forged')::text || '/' || revision_number from public.visit_revisions
            where visit_id = 'c11d0000-0000-4000-8000-000000002001' and amendment_reason = 'Synthetic system amendment'),
  'false/4', 'on a system path too the snapshot and number come from the database');
select is(pg_temp.as_user('c11d0000-0000-4000-8000-000000000201', 'c11d0000-0000-4000-8000-00000000000b',
  $$insert into public.visit_revisions (tenant_id, visit_id, revision_number, amended_by, amendment_reason, snapshot)
    values ('c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000002001', 1,
            'c11d0000-0000-4000-8000-000000000201', 'Synthetic foreign amendment', '{}') returning revision_number::text$$),
  'denied:AMENDMENT_FORBIDDEN', 'another clinic''s owner is refused before anything is read');

-- N-3: invoice items -----------------------------------------------------------------------------------------------------
select is(pg_temp.dr($$insert into public.invoice_items (tenant_id, invoice_id, item_type, description, unit_price, quantity, total_price)
    values ('c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000004004', 'other', 'Synthetic credit',
            -500, 1, -500) returning 'ok'$$),
  'error:23514', 'N-3 repro (MI6): a negative charge is refused');
select is(pg_temp.dr($$insert into public.invoice_items (tenant_id, invoice_id, item_type, description, unit_price, quantity, total_price)
    values ('c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000004004', 'procedure', 'Synthetic dressing',
            200, 1, 1) returning total_price::text$$),
  '200.00', 'N-3 repro (MI7): the line total is price x quantity, not the typed 1');
select is(pg_temp.invoice_state('c11d0000-0000-4000-8000-000000004004'), '500.00/500.00/issued', 'the invoice follows');
select is(pg_temp.dr($$update public.invoice_items set total_price = 1 where id = 'c11d0000-0000-4000-8000-000000004104'
    returning total_price::text$$),
  '300.00', 'an UPDATE of the line total alone is recomputed too');
select is(pg_temp.rc(pg_temp.pay_sql(100, 'c11d0000-0000-4000-8000-00000000c001')), 'issued',
  'the receptionist collects ₹100 of ₹500 through record_payment');
select is(pg_temp.dr($$update public.invoice_items set unit_price = 100, total_price = 100
    where id = 'c11d0000-0000-4000-8000-000000004101' returning 'ok'$$),
  'denied:INVOICE_BELOW_COLLECTED', 'N-3 repro (MI5): the doctor cannot lower the bill to what was collected');
select is(pg_temp.invoice_state('c11d0000-0000-4000-8000-000000004001'), '500.00/500.00/issued', 'the invoice is unchanged, not paid');
select is(pg_temp.dr($$update public.invoice_items set unit_price = 400
    where id = 'c11d0000-0000-4000-8000-000000004101' returning 'ok'$$),
  'ok', 'a reduction that leaves a balance due is still allowed');
select is(pg_temp.rc($$delete from public.invoice_items where id = 'c11d0000-0000-4000-8000-000000004101' returning 'ok'$$),
  'denied:INVOICE_BELOW_COLLECTED', 'a collector cannot remove the charge that was partly paid either (no refund path)');
select is(pg_temp.rc(pg_temp.pay_sql(300, 'c11d0000-0000-4000-8000-00000000c002')), 'paid',
  'the balance is collected through record_payment: paid');
select is(pg_temp.rc($$insert into public.invoice_items (tenant_id, invoice_id, item_type, description, unit_price, quantity, total_price)
    values ('c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000004001', 'other', 'Synthetic extra',
            100, 1, 100) returning 'ok'$$),
  'denied:INVOICE_ITEMS_LOCKED', 'a paid invoice''s items cannot be added to');
select is(pg_temp.dr($$update public.invoice_items set unit_price = 50 where id = 'c11d0000-0000-4000-8000-000000004101' returning 'ok'$$),
  'denied:INVOICE_ITEMS_LOCKED', 'or changed');
select is(pg_temp.invoice_state('c11d0000-0000-4000-8000-000000004001'), '400.00/400.00/paid', 'the paid invoice is intact');
select throws_ok($$update public.invoice_items set invoice_id = 'c11d0000-0000-4000-8000-000000004004'
    where id = 'c11d0000-0000-4000-8000-000000004101'$$, '42501', 'INVOICE_ITEM_KEY_IMMUTABLE',
  'an item never moves to another invoice (every path)');
insert into public.payments (tenant_id, invoice_id, amount, payment_method, recorded_by) values
  ('c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000004004', 200, 'cash', 'c11d0000-0000-4000-8000-000000000104');
update public.invoice_items set unit_price = 0 where id = 'c11d0000-0000-4000-8000-000000004104';
select is(pg_temp.invoice_state('c11d0000-0000-4000-8000-000000004004'), '200.00/200.00/issued',
  'items brought down to the amount paid (system path) leave the invoice issued: only record_payment sets paid');
select ok(pg_temp.dr2($$insert into public.invoice_items (tenant_id, invoice_id, item_type, description, unit_price, quantity, total_price)
    values ('c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000004001', 'other', 'Synthetic colleague',
            1, 1, 1) returning 'ok'$$) like 'denied:new row violates row-level security policy%',
  'a doctor who is not the visit''s doctor is refused by the item policy, as before (the guard reveals nothing)');
select is((select count(*)::int from pg_constraint where conrelid = 'public.invoice_items'::regclass and convalidated
            and conname in ('invoice_items_unit_price_nonnegative', 'invoice_items_total_matches')), 2,
  'catalogue: both invoice item CHECKs are validated (000076)');

-- N-5: patients.created_by -----------------------------------------------------------------------------------------------
select is(pg_temp.rc($$insert into public.patients (tenant_id, full_name, phone, created_by)
    values ('c11d0000-0000-4000-8000-00000000000a', 'Synthetic Forged Creator', '+919000001203',
            'c11d0000-0000-4000-8000-000000000101') returning 'ok'$$),
  'denied:ACTOR_INVALID', 'N-5 repro: a receptionist cannot register a patient as created by the owner');
select is(pg_temp.rc($$insert into public.patients (tenant_id, full_name, phone, created_by)
    values ('c11d0000-0000-4000-8000-00000000000a', 'Synthetic Own Creator', '+919000001204',
            'c11d0000-0000-4000-8000-000000000104') returning 'ok'$$),
  'ok', 'control: as itself it can');
select is(pg_temp.rc($$update public.patients set created_by = 'c11d0000-0000-4000-8000-000000000102'
    where id = 'c11d0000-0000-4000-8000-000000001001' returning 'ok'$$),
  'denied:ACTOR_INVALID', 'N-5 repro: created_by never changes');
select is(pg_temp.rc($$update public.patients set full_name = 'Synthetic Patient One B'
    where id = 'c11d0000-0000-4000-8000-000000001001' returning 'ok'$$),
  'ok', 'control: other demographics stay editable');

-- N-7: notice links ------------------------------------------------------------------------------------------------------
select throws_ok($$insert into public.in_app_notifications (tenant_id, category, event_type, title, message, link_url)
    values ('c11d0000-0000-4000-8000-00000000000a', 'system', 'synthetic', 'Synthetic', 'Synthetic', E'/\t/evil.example')$$,
  '23514', null, 'N-7 repro: "/<TAB>/host" is refused');
select throws_ok($$insert into public.in_app_notifications (tenant_id, category, event_type, title, message, link_url)
    values ('c11d0000-0000-4000-8000-00000000000a', 'system', 'synthetic', 'Synthetic', 'Synthetic', E'/\n/evil.example')$$,
  '23514', null, 'a newline after the slash is refused');
select throws_ok($$insert into public.in_app_notifications (tenant_id, category, event_type, title, message, link_url)
    values ('c11d0000-0000-4000-8000-00000000000a', 'system', 'synthetic', 'Synthetic', 'Synthetic', E'/calendar\t')$$,
  '23514', null, 'a control character anywhere is refused');
select throws_ok($$insert into public.in_app_notifications (tenant_id, category, event_type, title, message, link_url)
    values ('c11d0000-0000-4000-8000-00000000000a', 'system', 'synthetic', 'Synthetic', 'Synthetic', '//evil.example')$$,
  '23514', null, 'a protocol-relative link stays refused');
select lives_ok($$insert into public.in_app_notifications (tenant_id, category, event_type, title, message, link_url) values
    ('c11d0000-0000-4000-8000-00000000000a', 'system', 'synthetic', 'Synthetic', 'Synthetic', '/calendar'),
    ('c11d0000-0000-4000-8000-00000000000a', 'queue', 'synthetic', 'Synthetic', 'Synthetic', '/queue?tab=waitlist'),
    ('c11d0000-0000-4000-8000-00000000000a', 'clinical', 'synthetic', 'Synthetic', 'Synthetic', '/patients/c11d0000-0000-4000-8000-000000001001'),
    ('c11d0000-0000-4000-8000-00000000000a', 'system', 'synthetic', 'Synthetic', 'Synthetic', '/')$$,
  'the app''s in-app links are accepted');

-- N-3 legacy rows: D7i and the VALIDATE of 000076 (no automatic remedy; last, as it alters the table) ----------------
alter table public.invoice_items drop constraint invoice_items_total_matches;
alter table public.invoice_items disable trigger invoice_items_integrity_guard;
insert into public.invoice_items (id, tenant_id, invoice_id, item_type, description, unit_price, quantity, total_price) values
  ('c11d0000-0000-4000-8000-000000004109', 'c11d0000-0000-4000-8000-00000000000a', 'c11d0000-0000-4000-8000-000000004004',
   'other', 'Synthetic legacy line', 500, 1, 1);
alter table public.invoice_items enable trigger invoice_items_integrity_guard;
select is((select count(*)::int from public.invoice_items where tenant_id = 'c11d0000-0000-4000-8000-00000000000a'
            and (unit_price < 0 or total_price is distinct from round(unit_price * quantity, 2))), 1,
  'D7i finds the planted legacy line');
select lives_ok($$ALTER TABLE public.invoice_items
    ADD CONSTRAINT invoice_items_total_matches CHECK (total_price = round(unit_price * quantity, 2)) NOT VALID$$,
  '000075''s NOT VALID constraint is added over it (expand)');
select throws_ok($$ALTER TABLE public.invoice_items VALIDATE CONSTRAINT invoice_items_total_matches$$, '23514', null,
  '000076''s VALIDATE stops on it (no automatic remedy)');
select lives_ok($$update public.invoice_items set unit_price = 1 where id = 'c11d0000-0000-4000-8000-000000004109'$$,
  'the line is corrected (with the clinic)');
select lives_ok($$ALTER TABLE public.invoice_items VALIDATE CONSTRAINT invoice_items_total_matches$$,
  'VALIDATE succeeds once corrected');

select * from finish();
rollback;
