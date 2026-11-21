-- lab_documents_append_only.test.sql — V2-09a 09A-04 (R-13 lab part, R-14; migration 000110). Lab documents are append-only: no role deletes a lab document
-- row (privilege for the request path, LAB_DOCUMENT_DELETE_FORBIDDEN for the service role and postgres), and no role updates or removes a lab object in storage.
--
-- 1. Catalogue: no DELETE policy and no DELETE privilege on patient_documents for authenticated; the BEFORE DELETE trigger and its function; the lab storage class
--    keeps SELECT and INSERT only.
-- 2. Matrix: DELETE of a lab document x role (owner, doctor, admin, nurse, receptionist of clinic A, owner of clinic B, anon, service_role, postgres); the row is
--    still there afterwards. Controls: the roles that hold labs:edit still INSERT and UPDATE a document.
-- 3. Storage: the roles that hold labs:edit still upload a new lab object, and none of them updates or removes one.
-- 4. R-4a: deleting a whole clinic as postgres and as service_role cascades through its lab documents; a visit's deletion still sets `visit_id` to NULL (an UPDATE).
-- Synthetic data only; the file rolls back.
begin;
select plan(24);

-- Fixtures ----------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1100000-0000-4000-8000-000000000101', 'c110-owner-a@example.test'),
  ('c1100000-0000-4000-8000-000000000102', 'c110-doctor-a@example.test'),
  ('c1100000-0000-4000-8000-000000000103', 'c110-admin-a@example.test'),
  ('c1100000-0000-4000-8000-000000000104', 'c110-nurse-a@example.test'),
  ('c1100000-0000-4000-8000-000000000105', 'c110-receptionist-a@example.test'),
  ('c1100000-0000-4000-8000-000000000201', 'c110-owner-b@example.test'),
  ('c1100000-0000-4000-8000-000000000301', 'c110-owner-c@example.test'),
  ('c1100000-0000-4000-8000-000000000401', 'c110-owner-d@example.test');
insert into public.tenants (id, name) values
  ('c1100000-0000-4000-8000-00000000000a', 'Synthetic 09A-04 Clinic A'),
  ('c1100000-0000-4000-8000-00000000000b', 'Synthetic 09A-04 Clinic B'),
  ('c1100000-0000-4000-8000-00000000000c', 'Synthetic 09A-04 Clinic C (purged as postgres)'),
  ('c1100000-0000-4000-8000-00000000000d', 'Synthetic 09A-04 Clinic D (purged as service_role)');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in (select t.id from public.tenants t where t.created_at = now());
insert into public.memberships (user_id, tenant_id, role) values
  ('c1100000-0000-4000-8000-000000000101', 'c1100000-0000-4000-8000-00000000000a', 'owner'),
  ('c1100000-0000-4000-8000-000000000102', 'c1100000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1100000-0000-4000-8000-000000000103', 'c1100000-0000-4000-8000-00000000000a', 'admin'),
  ('c1100000-0000-4000-8000-000000000104', 'c1100000-0000-4000-8000-00000000000a', 'nurse'),
  ('c1100000-0000-4000-8000-000000000105', 'c1100000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c1100000-0000-4000-8000-000000000201', 'c1100000-0000-4000-8000-00000000000b', 'owner'),
  ('c1100000-0000-4000-8000-000000000301', 'c1100000-0000-4000-8000-00000000000c', 'owner'),
  ('c1100000-0000-4000-8000-000000000401', 'c1100000-0000-4000-8000-00000000000d', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1100000-0000-4000-8000-000000001001', 'c1100000-0000-4000-8000-00000000000a', 'Synthetic Lab Patient A', '+919000011001', 'c1100000-0000-4000-8000-000000000101'),
  ('c1100000-0000-4000-8000-000000003001', 'c1100000-0000-4000-8000-00000000000c', 'Synthetic Lab Patient C', '+919000011003', 'c1100000-0000-4000-8000-000000000301'),
  ('c1100000-0000-4000-8000-000000004001', 'c1100000-0000-4000-8000-00000000000d', 'Synthetic Lab Patient D', '+919000011004', 'c1100000-0000-4000-8000-000000000401');
-- A visit of clinic A (never signed) that one document is attached to.
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by) values
  ('c1100000-0000-4000-8000-000000002001', 'c1100000-0000-4000-8000-00000000000a', 'c1100000-0000-4000-8000-000000001001',
   'c1100000-0000-4000-8000-000000000102', 'walk_in', 'c1100000-0000-4000-8000-000000000101');
insert into public.patient_documents (id, tenant_id, patient_id, visit_id, title, original_filename, storage_path, file_size_bytes, mime_type, uploaded_by) values
  ('c1100000-0000-4000-8000-00000000d001', 'c1100000-0000-4000-8000-00000000000a', 'c1100000-0000-4000-8000-000000001001', null, 'Synthetic report 1', 'report1.pdf',
   'tenants/c1100000-0000-4000-8000-00000000000a/patients/c1100000-0000-4000-8000-000000001001/labs/c1100000-0000-4000-8000-00000000d001.pdf', 10, 'application/pdf', 'c1100000-0000-4000-8000-000000000101'),
  ('c1100000-0000-4000-8000-00000000d002', 'c1100000-0000-4000-8000-00000000000a', 'c1100000-0000-4000-8000-000000001001', 'c1100000-0000-4000-8000-000000002001', 'Synthetic report 2', 'report2.pdf',
   'tenants/c1100000-0000-4000-8000-00000000000a/patients/c1100000-0000-4000-8000-000000001001/labs/c1100000-0000-4000-8000-00000000d002.pdf', 10, 'application/pdf', 'c1100000-0000-4000-8000-000000000101'),
  ('c1100000-0000-4000-8000-00000000d003', 'c1100000-0000-4000-8000-00000000000c', 'c1100000-0000-4000-8000-000000003001', null, 'Synthetic report C', 'reportc.pdf',
   'tenants/c1100000-0000-4000-8000-00000000000c/patients/c1100000-0000-4000-8000-000000003001/labs/c1100000-0000-4000-8000-00000000d003.pdf', 10, 'application/pdf', 'c1100000-0000-4000-8000-000000000301'),
  ('c1100000-0000-4000-8000-00000000d004', 'c1100000-0000-4000-8000-00000000000d', 'c1100000-0000-4000-8000-000000004001', null, 'Synthetic report D', 'reportd.pdf',
   'tenants/c1100000-0000-4000-8000-00000000000d/patients/c1100000-0000-4000-8000-000000004001/labs/c1100000-0000-4000-8000-00000000d004.pdf', 10, 'application/pdf', 'c1100000-0000-4000-8000-000000000401');
insert into storage.objects (bucket_id, name) values
  ('clinic-records', 'tenants/c1100000-0000-4000-8000-00000000000a/patients/c1100000-0000-4000-8000-000000001001/labs/c1100000-0000-4000-8000-00000000d001.pdf');

create function pg_temp.attempt(p_db_role text, p_user uuid, p_tenant uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
  v_n bigint;
begin
  begin
    perform set_config('request.jwt.claims', case when p_user is null then json_build_object('role', p_db_role)::text
                                                  else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
    perform set_config('request.headers', json_build_object('x-clinicos-tenant', p_tenant)::text, true);
    perform set_config('storage.allow_delete_query', 'true', true);
    if p_db_role <> 'postgres' then
      execute 'set local role ' || quote_ident(p_db_role);
    end if;
    execute p_sql;
    get diagnostics v_n = row_count;
    raise exception using errcode = 'ROLLB', message = 'ok:' || v_n;
  exception
    when sqlstate 'ROLLB' then v_out := sqlerrm;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  return v_out;
end
$f$;

-- 1. Catalogue ------------------------------------------------------------------------------------------------------------
select is((select array_agg(cmd::text order by cmd::text) from pg_policies where schemaname = 'public' and tablename = 'patient_documents'),
  array['INSERT', 'SELECT', 'UPDATE'], 'patient_documents has SELECT, INSERT and UPDATE policies and no DELETE policy');
select is(array[has_table_privilege('authenticated', 'public.patient_documents', 'DELETE'), has_table_privilege('anon', 'public.patient_documents', 'DELETE'),
                has_table_privilege('authenticated', 'public.patient_documents', 'INSERT'), has_table_privilege('authenticated', 'public.patient_documents', 'UPDATE'),
                has_table_privilege('authenticated', 'public.patient_documents', 'SELECT')],
  array[false, false, true, true, true], 'authenticated holds no DELETE on patient_documents (anon neither); SELECT, INSERT and UPDATE stay');
select has_trigger('public', 'patient_documents', 'patient_documents_no_delete', 'patient_documents carries the append-only trigger');
select is(
  (select p.proname || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ',') || ':' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
     || ':' || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
     from pg_proc p where p.oid = 'private.patient_documents_no_delete()'::regprocedure),
  'patient_documents_no_delete:false:search_path="":false:false', 'the trigger function is SECURITY INVOKER, search_path pinned, no EXECUTE for the API roles');
select is((select array_agg(cmd::text order by cmd::text) from pg_policies
            where schemaname = 'storage' and tablename = 'objects' and policyname like 'clinic_records_lab_%'),
  array['INSERT', 'SELECT'], 'the lab storage class keeps SELECT and INSERT only: no UPDATE and no DELETE policy (R-13)');

-- 2. DELETE of a lab document, every role -------------------------------------------------------------------------------
create temp table roles (role text, db_role text, uid uuid, tenant uuid, expected text);
insert into roles values
  ('owner',        'authenticated', 'c1100000-0000-4000-8000-000000000101', 'c1100000-0000-4000-8000-00000000000a', 'denied:permission denied'),
  ('doctor',       'authenticated', 'c1100000-0000-4000-8000-000000000102', 'c1100000-0000-4000-8000-00000000000a', 'denied:permission denied'),
  ('admin',        'authenticated', 'c1100000-0000-4000-8000-000000000103', 'c1100000-0000-4000-8000-00000000000a', 'denied:permission denied'),
  ('nurse',        'authenticated', 'c1100000-0000-4000-8000-000000000104', 'c1100000-0000-4000-8000-00000000000a', 'denied:permission denied'),
  ('receptionist', 'authenticated', 'c1100000-0000-4000-8000-000000000105', 'c1100000-0000-4000-8000-00000000000a', 'denied:permission denied'),
  ('owner_b',      'authenticated', 'c1100000-0000-4000-8000-000000000201', 'c1100000-0000-4000-8000-00000000000b', 'denied:permission denied'),
  ('anon',         'anon',          null,                                   'c1100000-0000-4000-8000-00000000000a', 'denied:permission denied'),
  ('service_role', 'service_role',  null,                                   'c1100000-0000-4000-8000-00000000000a', 'denied:LAB_DOCUMENT_DELETE_FORBIDDEN'),
  ('postgres',     'postgres',      null,                                   'c1100000-0000-4000-8000-00000000000a', 'denied:LAB_DOCUMENT_DELETE_FORBIDDEN');
create temp table res as
select r.role, r.expected,
       pg_temp.attempt(r.db_role, r.uid, r.tenant, $$delete from public.patient_documents where id = 'c1100000-0000-4000-8000-00000000d001'$$) as outcome
  from roles r;
select is((select count(*)::int from res), 9, 'the matrix ran DELETE as all nine roles');
select is((select string_agg(role || ' => ' || outcome, '; ') from res where outcome !~ ('^' || expected)), null,
  'no role deletes a lab document: the request path is refused by privilege, the service role and postgres by LAB_DOCUMENT_DELETE_FORBIDDEN');
select is((select count(*)::int from public.patient_documents where id in ('c1100000-0000-4000-8000-00000000d001', 'c1100000-0000-4000-8000-00000000d002')), 2,
  'the lab documents are still there');
select is(pg_temp.attempt('service_role', null, 'c1100000-0000-4000-8000-00000000000a', $$delete from public.patient_documents where tenant_id = 'c1100000-0000-4000-8000-00000000000a'$$),
  'denied:LAB_DOCUMENT_DELETE_FORBIDDEN', 'a bulk DELETE by the service role is refused too (BEFORE ROW: the first row stops it)');
-- Controls: the append-only rule is not a broken fixture.
select is(pg_temp.attempt('authenticated', 'c1100000-0000-4000-8000-000000000104', 'c1100000-0000-4000-8000-00000000000a',
  $$insert into public.patient_documents (tenant_id, patient_id, title, original_filename, storage_path, file_size_bytes, mime_type, uploaded_by)
    values ('c1100000-0000-4000-8000-00000000000a', 'c1100000-0000-4000-8000-000000001001', 'Synthetic nurse upload', 'n.pdf',
            'tenants/c1100000-0000-4000-8000-00000000000a/patients/c1100000-0000-4000-8000-000000001001/labs/c1100000-0000-4000-8000-00000000d005.pdf', 10, 'application/pdf',
            'c1100000-0000-4000-8000-000000000104')$$),
  'ok:1', 'control: a nurse (labs:edit) still uploads a lab document (INSERT)');
select is(pg_temp.attempt('authenticated', 'c1100000-0000-4000-8000-000000000102', 'c1100000-0000-4000-8000-00000000000a',
  $$update public.patient_documents set notes = 'Reviewed' where id = 'c1100000-0000-4000-8000-00000000d001'$$),
  'ok:1', 'control: a doctor (labs:edit) still updates a document''s notes (UPDATE)');
select is(pg_temp.attempt('authenticated', 'c1100000-0000-4000-8000-000000000105', 'c1100000-0000-4000-8000-00000000000a',
  $$update public.patient_documents set notes = 'Reviewed' where id = 'c1100000-0000-4000-8000-00000000d001'$$),
  'ok:0', 'control: a receptionist (no labs:edit) still updates nothing');

-- 3. Storage: append-only objects -------------------------------------------------------------------------------------
select is(pg_temp.attempt('authenticated', 'c1100000-0000-4000-8000-000000000104', 'c1100000-0000-4000-8000-00000000000a',
  $$insert into storage.objects (bucket_id, name) values ('clinic-records', 'tenants/c1100000-0000-4000-8000-00000000000a/patients/c1100000-0000-4000-8000-000000001001/labs/c1100000-0000-4000-8000-00000000d006.pdf')$$),
  'ok:1', 'control: a nurse (labs:edit) uploads a new lab object');
select is(pg_temp.attempt('authenticated', 'c1100000-0000-4000-8000-000000000102', 'c1100000-0000-4000-8000-00000000000a',
  $$insert into storage.objects (bucket_id, name) values ('clinic-records', 'tenants/c1100000-0000-4000-8000-00000000000a/patients/c1100000-0000-4000-8000-000000001001/labs/c1100000-0000-4000-8000-00000000d007.pdf')$$),
  'ok:1', 'and so does a doctor');
create temp table obj_roles (role text, uid uuid);
insert into obj_roles values ('owner', 'c1100000-0000-4000-8000-000000000101'), ('doctor', 'c1100000-0000-4000-8000-000000000102'), ('nurse', 'c1100000-0000-4000-8000-000000000104');
select is((select string_agg(o.role || ' => ' || pg_temp.attempt('authenticated', o.uid, 'c1100000-0000-4000-8000-00000000000a',
             $$update storage.objects set metadata = metadata where bucket_id = 'clinic-records' and name like 'tenants/c1100000-0000-4000-8000-00000000000a/patients/%/labs/c1100000-0000-4000-8000-00000000d001.pdf'$$), '; ')
             from obj_roles o where pg_temp.attempt('authenticated', o.uid, 'c1100000-0000-4000-8000-00000000000a',
             $$update storage.objects set metadata = metadata where bucket_id = 'clinic-records' and name like 'tenants/c1100000-0000-4000-8000-00000000000a/patients/%/labs/c1100000-0000-4000-8000-00000000d001.pdf'$$) <> 'ok:0'), null,
  'no role updates a lab object in place (no UPDATE policy: an upsert of an existing object fails)');
select is((select string_agg(o.role || ' => ' || pg_temp.attempt('authenticated', o.uid, 'c1100000-0000-4000-8000-00000000000a',
             $$delete from storage.objects where bucket_id = 'clinic-records' and name like 'tenants/c1100000-0000-4000-8000-00000000000a/patients/%/labs/c1100000-0000-4000-8000-00000000d001.pdf'$$), '; ')
             from obj_roles o where pg_temp.attempt('authenticated', o.uid, 'c1100000-0000-4000-8000-00000000000a',
             $$delete from storage.objects where bucket_id = 'clinic-records' and name like 'tenants/c1100000-0000-4000-8000-00000000000a/patients/%/labs/c1100000-0000-4000-8000-00000000d001.pdf'$$) <> 'ok:0'), null,
  'no role deletes a lab object (no DELETE policy)');
select is((select count(*)::int from storage.objects where bucket_id = 'clinic-records' and name like '%/labs/c1100000-0000-4000-8000-00000000d001.pdf'), 1, 'the lab object is still there');
select is(pg_temp.attempt('authenticated', 'c1100000-0000-4000-8000-000000000102', 'c1100000-0000-4000-8000-00000000000a',
  $$select count(*) from storage.objects where bucket_id = 'clinic-records' and name like 'tenants/c1100000-0000-4000-8000-00000000000a/patients/%/labs/c1100000-0000-4000-8000-00000000d001.pdf'$$),
  'ok:1', 'control: the doctor still reads (SELECT) the lab object');

-- 4. R-4a: the cascade of a tenant purge; the visit FK's SET NULL ---------------------------------------------------------
select is(pg_temp.attempt('postgres', null, 'c1100000-0000-4000-8000-00000000000a',
  $$delete from public.patient_documents where id = 'c1100000-0000-4000-8000-00000000d003'$$), 'denied:LAB_DOCUMENT_DELETE_FORBIDDEN',
  'R-4a (negative): while the clinic exists a system-path DELETE of its document is refused');
select lives_ok($$delete from public.tenants where id = 'c1100000-0000-4000-8000-00000000000c'$$,
  'R-4a: deleting a clinic as postgres cascades through its lab documents');
select is((select count(*)::int from public.patient_documents where tenant_id = 'c1100000-0000-4000-8000-00000000000c'), 0, 'and nothing of that clinic remains');
create function pg_temp.purge_as_service_role(p_t uuid) returns text language plpgsql as $f$
begin
  set local role service_role;
  begin
    delete from public.tenants where id = p_t;
    reset role;
    return 'deleted';
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
end
$f$;
select is(pg_temp.purge_as_service_role('c1100000-0000-4000-8000-00000000000d'), 'deleted',
  'R-4a: the same cascade as service_role (the role of the run teardown and a tenant purge job)');
select is((select count(*)::int from public.patient_documents where tenant_id = 'c1100000-0000-4000-8000-00000000000d'), 0, 'and nothing of the second clinic remains');
-- The visit FK is ON DELETE SET NULL: deleting the (unsigned) visit updates the document, it does not delete it.
delete from public.clinical_notes where visit_id = 'c1100000-0000-4000-8000-000000002001';
delete from public.visits where id = 'c1100000-0000-4000-8000-000000002001';
select is((select visit_id is null from public.patient_documents where id = 'c1100000-0000-4000-8000-00000000d002'), true,
  'deleting a visit sets the document''s visit_id to NULL (an UPDATE); the document stays');

select * from finish();
rollback;
