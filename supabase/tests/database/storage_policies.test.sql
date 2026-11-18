-- storage_policies.test.sql — V2-05 plan 05-02c (P1-01, SVP §6.1, BACKEND C9; R-23, R-42, R-45; threats T-05-15,
-- T-05-16, T-05-39). Hand-written storage cases next to the generated matrix (authz_matrix.test.sql has one cell per
-- class x operation x principal): per class x role, the doctor's own-visit receipt (Sign & Bill), cross-clinic prefixes,
-- the dual member bound to the active clinic, malformed keys and unknown classes denied without an error.
-- Objects are inserted as postgres and read/written as simulated users (request.jwt.claims + request.headers, the
-- shape the Storage API gives the policies; proven end to end by tests/authz/active-tenant-carrier.spec.ts and
-- tests/storage/storage-policies-jwt.spec.ts). Every probe is rolled back; the file rolls back. Synthetic data only.
begin;
select plan(46);

-- Fixtures (synthetic, inlined: pg_prove mounts only the test directory) -----------------------------------------
-- Clinic A: owner, admin, doctor, second doctor, nurse, receptionist. Clinic B: owner, doctor.
-- Multi-clinic users (R-42): dual = doctor in A, receptionist in B (the matrix principal); dd = doctor in both;
-- dr = receptionist in A, owner in B.
insert into auth.users (id, email) values
  ('c2c00000-0000-4000-8000-000000000101', 'c2c-owner-a@example.test'),
  ('c2c00000-0000-4000-8000-000000000102', 'c2c-admin-a@example.test'),
  ('c2c00000-0000-4000-8000-000000000103', 'c2c-doctor-a@example.test'),
  ('c2c00000-0000-4000-8000-000000000104', 'c2c-doctor2-a@example.test'),
  ('c2c00000-0000-4000-8000-000000000105', 'c2c-nurse-a@example.test'),
  ('c2c00000-0000-4000-8000-000000000106', 'c2c-receptionist-a@example.test'),
  ('c2c00000-0000-4000-8000-000000000201', 'c2c-owner-b@example.test'),
  ('c2c00000-0000-4000-8000-000000000202', 'c2c-doctor-b@example.test'),
  ('c2c00000-0000-4000-8000-000000000301', 'c2c-dual@example.test'),
  ('c2c00000-0000-4000-8000-000000000302', 'c2c-dd@example.test'),
  ('c2c00000-0000-4000-8000-000000000303', 'c2c-dr@example.test');
insert into public.tenants (id, name) values
  ('c2c00000-0000-4000-8000-00000000000a', 'Synthetic 05-02c Clinic A'),
  ('c2c00000-0000-4000-8000-00000000000b', 'Synthetic 05-02c Clinic B');
insert into public.memberships (user_id, tenant_id, role) values
  ('c2c00000-0000-4000-8000-000000000101', 'c2c00000-0000-4000-8000-00000000000a', 'owner'),
  ('c2c00000-0000-4000-8000-000000000102', 'c2c00000-0000-4000-8000-00000000000a', 'admin'),
  ('c2c00000-0000-4000-8000-000000000103', 'c2c00000-0000-4000-8000-00000000000a', 'doctor'),
  ('c2c00000-0000-4000-8000-000000000104', 'c2c00000-0000-4000-8000-00000000000a', 'doctor'),
  ('c2c00000-0000-4000-8000-000000000105', 'c2c00000-0000-4000-8000-00000000000a', 'nurse'),
  ('c2c00000-0000-4000-8000-000000000106', 'c2c00000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c2c00000-0000-4000-8000-000000000201', 'c2c00000-0000-4000-8000-00000000000b', 'owner'),
  ('c2c00000-0000-4000-8000-000000000202', 'c2c00000-0000-4000-8000-00000000000b', 'doctor'),
  ('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', 'doctor'),
  ('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', 'receptionist'),
  ('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000a', 'doctor'),
  ('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', 'doctor'),
  ('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000b', 'owner');
-- One patient, visit and invoice per clinic; clinic A also has a second doctor's visit with its invoice and a third
-- visit (the doctor's) whose invoice has no archived receipt yet.
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c2c00000-0000-4000-8000-000000001001', 'c2c00000-0000-4000-8000-00000000000a', 'Synthetic Patient A', '+919000000701',
   'c2c00000-0000-4000-8000-000000000101'),
  ('c2c00000-0000-4000-8000-000000002001', 'c2c00000-0000-4000-8000-00000000000b', 'Synthetic Patient B', '+919000000702',
   'c2c00000-0000-4000-8000-000000000201');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by) values
  ('c2c00000-0000-4000-8000-000000001002', 'c2c00000-0000-4000-8000-00000000000a', 'c2c00000-0000-4000-8000-000000001001',
   'c2c00000-0000-4000-8000-000000000103', 'walk_in', 'c2c00000-0000-4000-8000-000000000101'),
  ('c2c00000-0000-4000-8000-000000001003', 'c2c00000-0000-4000-8000-00000000000a', 'c2c00000-0000-4000-8000-000000001001',
   'c2c00000-0000-4000-8000-000000000104', 'walk_in', 'c2c00000-0000-4000-8000-000000000101'),
  ('c2c00000-0000-4000-8000-000000001004', 'c2c00000-0000-4000-8000-00000000000a', 'c2c00000-0000-4000-8000-000000001001',
   'c2c00000-0000-4000-8000-000000000103', 'walk_in', 'c2c00000-0000-4000-8000-000000000101'),
  ('c2c00000-0000-4000-8000-000000002002', 'c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000002001',
   'c2c00000-0000-4000-8000-000000000202', 'walk_in', 'c2c00000-0000-4000-8000-000000000201');
insert into public.invoices (id, tenant_id, visit_id, patient_id, invoice_number, total_amount, status) values
  ('c2c00000-0000-4000-8000-000000001005', 'c2c00000-0000-4000-8000-00000000000a', 'c2c00000-0000-4000-8000-000000001002',
   'c2c00000-0000-4000-8000-000000001001', 'C2C-A-0001', 500, 'issued'),
  ('c2c00000-0000-4000-8000-000000001006', 'c2c00000-0000-4000-8000-00000000000a', 'c2c00000-0000-4000-8000-000000001003',
   'c2c00000-0000-4000-8000-000000001001', 'C2C-A-0002', 500, 'issued'),
  ('c2c00000-0000-4000-8000-000000001007', 'c2c00000-0000-4000-8000-00000000000a', 'c2c00000-0000-4000-8000-000000001004',
   'c2c00000-0000-4000-8000-000000001001', 'C2C-A-0003', 500, 'issued'),
  ('c2c00000-0000-4000-8000-000000002005', 'c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000002002',
   'c2c00000-0000-4000-8000-000000002001', 'C2C-B-0001', 500, 'issued');

-- Helpers ----------------------------------------------------------------------------------------------------------
-- As a signed-in user (anon when p_user is null) with the x-clinicos-tenant header p_header (none when null): run
-- p_sql; return the rows it affected/returned, 'denied:<message>' (42501) or 'error:<sqlstate>:<message>'. With
-- p_probe, return instead the first column of p_probe run as postgres right after p_sql (same subtransaction). Always
-- rolled back.
create function pg_temp.as_user(p_user uuid, p_header uuid, p_sql text, p_probe text default null) returns text
language plpgsql as $f$
declare
  v_rows bigint;
  v_out text;
begin
  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims',
      case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
    perform set_config('request.headers',
      case when p_header is null then '' else json_build_object('x-clinicos-tenant', p_header)::text end, true);
    perform set_config('storage.allow_delete_query', 'true', true);
    if p_user is null then set local role anon; else set local role authenticated; end if;
    execute p_sql;
    get diagnostics v_rows = row_count;
    v_out := v_rows::text;
    if p_probe is not null then
      reset role;
      execute p_probe into v_out;
    end if;
    raise exception 'c2c sentinel' using errcode = 'P0S03';
  exception
    when sqlstate 'P0S03' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

-- The single value p_sql returns as the user (same conventions as as_user).
create function pg_temp.val_as(p_user uuid, p_header uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims',
      case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
    perform set_config('request.headers',
      case when p_header is null then '' else json_build_object('x-clinicos-tenant', p_header)::text end, true);
    if p_user is null then set local role anon; else set local role authenticated; end if;
    execute p_sql into v_out;
    raise exception 'c2c sentinel' using errcode = 'P0S03';
  exception
    when sqlstate 'P0S03' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

-- Objects (inserted as postgres; the policies are evaluated when the principals read or write them) ---------------
insert into storage.objects (bucket_id, name) values
  ('prescriptions', 'c2c00000-0000-4000-8000-00000000000a/c2c00000-0000-4000-8000-000000001002/rx_v1.pdf'),
  ('prescriptions', 'c2c00000-0000-4000-8000-00000000000b/c2c00000-0000-4000-8000-000000002002/rx_v1.pdf'),
  ('prescriptions', 'c2c00000-0000-4000-8000-00000000000a/receipts/inv_c2c00000-0000-4000-8000-000000001005.pdf'),
  ('prescriptions', 'c2c00000-0000-4000-8000-00000000000a/receipts/inv_c2c00000-0000-4000-8000-000000001006.pdf'),
  ('prescriptions', 'c2c00000-0000-4000-8000-00000000000b/receipts/inv_c2c00000-0000-4000-8000-000000002005.pdf'),
  ('prescriptions', 'not-a-uuid/x.pdf'),
  ('clinic-records', 'tenants/c2c00000-0000-4000-8000-00000000000a/patients/c2c00000-0000-4000-8000-000000001001/labs/c2c00000-0000-4000-8000-000000003001.pdf'),
  ('clinic-records', 'tenants/c2c00000-0000-4000-8000-00000000000a/patients/c2c00000-0000-4000-8000-000000001001/labs/Synthetic_Patient_A_report_2030-01-01.pdf'),
  ('clinic-records', 'tenants/c2c00000-0000-4000-8000-00000000000b/patients/c2c00000-0000-4000-8000-000000002001/labs/c2c00000-0000-4000-8000-000000004001.pdf'),
  ('clinic-records', 'tenants/c2c00000-0000-4000-8000-00000000000a/referrals/c2c00000-0000-4000-8000-000000001008/referral_letter.pdf'),
  ('clinic-records', 'tenants/not-a-uuid/patients/x/labs/x.pdf'),
  ('clinic-records', 'c2c00000-0000-4000-8000-00000000000a/legacy/file.pdf');

-- 1. Catalogue ------------------------------------------------------------------------------------------------------
select set_eq(
  $$ select policyname::text || ':' || cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' $$,
  array[
    'prescriptions_rx_select:SELECT', 'prescriptions_rx_insert:INSERT', 'prescriptions_rx_update:UPDATE',
    'prescriptions_receipt_select:SELECT', 'prescriptions_receipt_insert:INSERT', 'prescriptions_receipt_update:UPDATE',
    'clinic_records_lab_select:SELECT', 'clinic_records_lab_insert:INSERT', 'clinic_records_lab_update:UPDATE',
    'clinic_records_lab_delete:DELETE',
    'clinic_records_referral_letter_select:SELECT', 'clinic_records_referral_letter_insert:INSERT',
    'clinic_records_referral_letter_update:UPDATE'
  ]::text[],
  'storage.objects has exactly the per-class policies of 000058 (rx, receipt, lab, referral letter)'
);
select is_empty(
  $$ select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and (roles <> array['authenticated']::name[]
           or coalesce(qual, '') || coalesce(with_check, '') ~ '::uuid|current_user_tenant_ids|current_user_has_role') $$,
  'every storage policy is TO authenticated, casts no key to uuid and calls no legacy helper (BACKEND C9)'
);

-- 2. Rx vs receipts by role (T-05-16) ---------------------------------------------------------------------------
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000106', null, $$select 1 from storage.objects where bucket_id = 'prescriptions' and name = 'c2c00000-0000-4000-8000-00000000000a/c2c00000-0000-4000-8000-000000001002/rx_v1.pdf'$$),
  '0', 'receptionist cannot read an Rx PDF');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000106', null, $$select 1 from storage.objects where bucket_id = 'prescriptions' and name = 'c2c00000-0000-4000-8000-00000000000a/receipts/inv_c2c00000-0000-4000-8000-000000001005.pdf'$$),
  '1', 'receptionist reads a receipt (billing:view)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000105', null, $$select 1 from storage.objects where bucket_id = 'prescriptions' and name = 'c2c00000-0000-4000-8000-00000000000a/c2c00000-0000-4000-8000-000000001002/rx_v1.pdf'$$),
  '0', 'nurse cannot read an Rx PDF (no prescriptions:view)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000103', null, $$select 1 from storage.objects where bucket_id = 'prescriptions' and name = 'c2c00000-0000-4000-8000-00000000000a/c2c00000-0000-4000-8000-000000001002/rx_v1.pdf'$$),
  '1', 'doctor reads an Rx PDF');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000102', null, $$select 1 from storage.objects where bucket_id = 'prescriptions' and name = 'c2c00000-0000-4000-8000-00000000000a/c2c00000-0000-4000-8000-000000001002/rx_v1.pdf'$$),
  '0', 'admin cannot read an Rx PDF (R-9)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000105', null, $$select 1 from storage.objects where bucket_id = 'prescriptions' and name like '%/receipts/%'$$),
  '0', 'nurse reads no receipt');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000106', null, $$insert into storage.objects (bucket_id, name) values ('prescriptions', 'c2c00000-0000-4000-8000-00000000000a/c2c00000-0000-4000-8000-000000001002/rx_v2.pdf')$$),
  'denied:new row violates row-level security policy for table "objects"', 'receptionist cannot write an Rx PDF');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000103', null, $$insert into storage.objects (bucket_id, name) values ('prescriptions', 'c2c00000-0000-4000-8000-00000000000a/c2c00000-0000-4000-8000-000000001002/rx_v2.pdf')$$),
  '1', 'doctor archives an Rx PDF (prescriptions:edit)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000103', null, $$update storage.objects set metadata = metadata where bucket_id = 'prescriptions' and name = 'c2c00000-0000-4000-8000-00000000000a/c2c00000-0000-4000-8000-000000001002/rx_v1.pdf'$$),
  '1', 'doctor may replace the Rx PDF in place (upsert, R-23)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000101', null, $$delete from storage.objects where bucket_id = 'prescriptions' and name = 'c2c00000-0000-4000-8000-00000000000a/c2c00000-0000-4000-8000-000000001002/rx_v1.pdf'$$),
  '0', 'nobody deletes an Rx PDF, not even the owner');

-- 3. The doctor's own-visit receipt (05-02b handover b: Sign & Bill archives on the doctor's client) ---------------
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000103', null, $$select 1 from storage.objects where bucket_id = 'prescriptions' and name = 'c2c00000-0000-4000-8000-00000000000a/receipts/inv_c2c00000-0000-4000-8000-000000001005.pdf'$$),
  '1', 'doctor reads the receipt of their own visit');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000103', null, $$select 1 from storage.objects where bucket_id = 'prescriptions' and name = 'c2c00000-0000-4000-8000-00000000000a/receipts/inv_c2c00000-0000-4000-8000-000000001006.pdf'$$),
  '0', 'doctor cannot read the receipt of a colleague''s visit');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000103', null, $$insert into storage.objects (bucket_id, name) values ('prescriptions', 'c2c00000-0000-4000-8000-00000000000a/receipts/inv_c2c00000-0000-4000-8000-000000001007.pdf')$$),
  '1', 'doctor archives the receipt of their own visit''s invoice (Sign & Bill)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000104', null, $$insert into storage.objects (bucket_id, name) values ('prescriptions', 'c2c00000-0000-4000-8000-00000000000a/receipts/inv_c2c00000-0000-4000-8000-000000001007.pdf')$$),
  'denied:new row violates row-level security policy for table "objects"', 'a doctor cannot archive the receipt of another doctor''s visit');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000103', null, $$insert into storage.objects (bucket_id, name) values ('prescriptions', 'c2c00000-0000-4000-8000-00000000000a/receipts/inv_c2c00000-0000-4000-8000-000000009999.pdf')$$),
  'denied:new row violates row-level security policy for table "objects"', 'a doctor cannot archive a receipt for an invoice that does not exist');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000103', null, $$update storage.objects set metadata = metadata where bucket_id = 'prescriptions' and name = 'c2c00000-0000-4000-8000-00000000000a/receipts/inv_c2c00000-0000-4000-8000-000000001005.pdf'$$),
  '1', 'doctor may replace their own visit''s receipt in place (upsert)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000105', null, $$insert into storage.objects (bucket_id, name) values ('prescriptions', 'c2c00000-0000-4000-8000-00000000000a/receipts/inv_c2c00000-0000-4000-8000-000000001007.pdf')$$),
  'denied:new row violates row-level security policy for table "objects"', 'nurse cannot archive a receipt');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000106', null, $$insert into storage.objects (bucket_id, name) values ('prescriptions', 'c2c00000-0000-4000-8000-00000000000a/receipts/inv_c2c00000-0000-4000-8000-000000001007.pdf')$$),
  '1', 'receptionist archives a receipt (billing:collect)');

-- 4. Tenant prefix, dual member bound to the active clinic (T-05-39) -------------------------------------------------
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000101', null, $$select 1 from storage.objects where name like 'c2c00000-0000-4000-8000-00000000000b/%' or name like 'tenants/c2c00000-0000-4000-8000-00000000000b/%'$$),
  '0', 'owner of A reads nothing under clinic B''s prefix');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000201', null, $$select 1 from storage.objects where name like 'c2c00000-0000-4000-8000-00000000000a/%' or name like 'tenants/c2c00000-0000-4000-8000-00000000000a/%'$$),
  '0', 'owner of B reads nothing under clinic A''s prefix');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select 1 from storage.objects where bucket_id = 'prescriptions' and name = 'c2c00000-0000-4000-8000-00000000000a/c2c00000-0000-4000-8000-000000001002/rx_v1.pdf'$$),
  '1', 'dual member acting in A (doctor) reads A''s Rx PDF');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select 1 from storage.objects where bucket_id = 'prescriptions' and name = 'c2c00000-0000-4000-8000-00000000000a/c2c00000-0000-4000-8000-000000001002/rx_v1.pdf'$$),
  '0', 'dual member acting in B cannot read A''s Rx PDF');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select 1 from storage.objects where bucket_id = 'prescriptions' and name = 'c2c00000-0000-4000-8000-00000000000b/receipts/inv_c2c00000-0000-4000-8000-000000002005.pdf'$$),
  '1', 'dual member acting in B (receptionist) reads B''s receipt');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select 1 from storage.objects where bucket_id = 'prescriptions' and name = 'c2c00000-0000-4000-8000-00000000000b/receipts/inv_c2c00000-0000-4000-8000-000000002005.pdf'$$),
  '0', 'dual member acting in A cannot read B''s receipt');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', null, $$select 1 from storage.objects where bucket_id in ('prescriptions', 'clinic-records')$$),
  '0', 'dual member with no active clinic reads no object');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$insert into storage.objects (bucket_id, name) values ('prescriptions', 'c2c00000-0000-4000-8000-00000000000b/receipts/inv_c2c00000-0000-4000-8000-000000009999.pdf')$$),
  'denied:new row violates row-level security policy for table "objects"', 'dual member acting in A cannot write under B''s prefix');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select 1 from storage.objects where bucket_id = 'clinic-records' and name like 'tenants/c2c00000-0000-4000-8000-00000000000b/%'$$),
  '0', 'dual member acting in A reads none of B''s clinic records');

-- 5. Malformed keys and unknown classes: denied, never an error (C9, T-05-15) ---------------------------------------
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000101', null, $$select 1 from storage.objects where bucket_id = 'prescriptions' and name = 'not-a-uuid/x.pdf'$$),
  '0', 'a malformed prescriptions key is denied without an error (before: 22P02)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000201', null, $$select 1 from storage.objects where bucket_id = 'clinic-records' and name = 'tenants/not-a-uuid/patients/x/labs/x.pdf'$$),
  '0', 'a malformed clinic-records key is denied without an error (before: 22P02)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000101', null, $$insert into storage.objects (bucket_id, name) values ('prescriptions', 'not-a-uuid/y.pdf')$$),
  'denied:new row violates row-level security policy for table "objects"', 'a malformed key cannot be written');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000101', null, $$select 1 from storage.objects where bucket_id = 'clinic-records' and name = 'c2c00000-0000-4000-8000-00000000000a/legacy/file.pdf'$$),
  '0', 'an object outside every class (legacy <tenant>/ root) is denied');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000101', null, $$insert into storage.objects (bucket_id, name) values ('prescriptions', 'c2c00000-0000-4000-8000-00000000000a/c2c00000-0000-4000-8000-000000001002/notes.txt')$$),
  'denied:new row violates row-level security policy for table "objects"', 'an unknown file under the Rx prefix cannot be written');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000101', null, $$insert into storage.objects (bucket_id, name) values ('prescriptions', 'C2C00000-0000-4000-8000-00000000000A/c2c00000-0000-4000-8000-000000001002/rx_v3.pdf')$$),
  'denied:new row violates row-level security policy for table "objects"', 'an upper-case clinic id does not match a class');

-- 6. Labs (labs:view / labs:edit; ids-only and legacy names, R-45) ----------------------------------------------------
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000106', null, $$select 1 from storage.objects where bucket_id = 'clinic-records' and name like 'tenants/c2c00000-0000-4000-8000-00000000000a/patients/%'$$),
  '0', 'receptionist reads no lab report (no labs:view)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000105', null, $$select 1 from storage.objects where bucket_id = 'clinic-records' and name like 'tenants/c2c00000-0000-4000-8000-00000000000a/patients/%'$$),
  '2', 'nurse reads both lab reports (id-only and legacy name)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000105', null, $$insert into storage.objects (bucket_id, name) values ('clinic-records', 'tenants/c2c00000-0000-4000-8000-00000000000a/patients/c2c00000-0000-4000-8000-000000001001/labs/c2c00000-0000-4000-8000-000000003002.png')$$),
  '1', 'nurse uploads a lab report (labs:edit)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000102', null, $$insert into storage.objects (bucket_id, name) values ('clinic-records', 'tenants/c2c00000-0000-4000-8000-00000000000a/patients/c2c00000-0000-4000-8000-000000001001/labs/c2c00000-0000-4000-8000-000000003002.png')$$),
  'denied:new row violates row-level security policy for table "objects"', 'admin cannot upload a lab report');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000103', null, $$delete from storage.objects where bucket_id = 'clinic-records' and name = 'tenants/c2c00000-0000-4000-8000-00000000000a/patients/c2c00000-0000-4000-8000-000000001001/labs/c2c00000-0000-4000-8000-000000003001.pdf'$$),
  '1', 'doctor deletes a lab report (labs:edit)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000106', null, $$delete from storage.objects where bucket_id = 'clinic-records' and name = 'tenants/c2c00000-0000-4000-8000-00000000000a/patients/c2c00000-0000-4000-8000-000000001001/labs/c2c00000-0000-4000-8000-000000003001.pdf'$$),
  '0', 'receptionist cannot delete a lab report');

-- 7. Referral letters (consultations:view / consultations:edit) -----------------------------------------------------
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000106', null, $$select 1 from storage.objects where bucket_id = 'clinic-records' and name like 'tenants/c2c00000-0000-4000-8000-00000000000a/referrals/%'$$),
  '0', 'receptionist cannot read a referral letter');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000105', null, $$select 1 from storage.objects where bucket_id = 'clinic-records' and name like 'tenants/c2c00000-0000-4000-8000-00000000000a/referrals/%'$$),
  '1', 'nurse reads a referral letter (consultations:view)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000105', null, $$insert into storage.objects (bucket_id, name) values ('clinic-records', 'tenants/c2c00000-0000-4000-8000-00000000000a/referrals/c2c00000-0000-4000-8000-000000001009/referral_letter.pdf')$$),
  'denied:new row violates row-level security policy for table "objects"', 'nurse cannot write a referral letter (no consultations:edit)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000103', null, $$insert into storage.objects (bucket_id, name) values ('clinic-records', 'tenants/c2c00000-0000-4000-8000-00000000000a/referrals/c2c00000-0000-4000-8000-000000001009/referral_letter.pdf')$$),
  '1', 'doctor writes a referral letter');

-- 8. anon -----------------------------------------------------------------------------------------------------------
select is(pg_temp.as_user(null, null, $$select 1 from storage.objects where bucket_id in ('prescriptions', 'clinic-records')$$),
  '0', 'anon reads no object');

select * from finish();
rollback;
