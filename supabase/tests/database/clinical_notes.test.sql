-- clinical_notes.test.sql — V2-05 plan 05-02a (P1-01, PO-3, SVP §6.1 "visits.clinical_notes"; R-2, R-3, R-5;
-- threats T-05-01, T-05-02, T-05-03).
--
-- 1. Shape: the table, its keys, RLS on, privileges (authenticated SELECT/UPDATE only, anon nothing), the two policies,
--    the definer trigger function closed to the API roles.
-- 2. Every visit gets exactly one clinical_notes row at insert, with fixed empty content, also when a receptionist books
--    it; no caller can put clinical content into `visits` any more (VALID CHECK, 23514 for each moved column).
-- 3. Real principals (JWT claims + the x-clinicos-tenant header, R-42): SELECT needs consultations:view (doctor, nurse,
--    owner: 1 row; receptionist, admin, clinic B's owner, the dual member acting in B: 0); UPDATE needs
--    consultations:edit, or vitals:edit for `vitals` only (nurse: vitals → 1 row, anything else → 42501).
-- 4. Keys never change; no INSERT/DELETE by a tenant role; a visit's notes RESTRICT its deletion; deleting the tenant
--    cascades.
-- Every probe runs in a subtransaction that is always rolled back; the file rolls back. Synthetic data only.
begin;
select plan(53);

-- Fixtures (synthetic) -------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c0000000-0000-4000-8000-000000000101', 'cn-owner-a@example.test'),
  ('c0000000-0000-4000-8000-000000000102', 'cn-admin-a@example.test'),
  ('c0000000-0000-4000-8000-000000000103', 'cn-doctor-a@example.test'),
  ('c0000000-0000-4000-8000-000000000104', 'cn-nurse-a@example.test'),
  ('c0000000-0000-4000-8000-000000000105', 'cn-receptionist-a@example.test'),
  ('c0000000-0000-4000-8000-000000000201', 'cn-owner-b@example.test'),
  ('c0000000-0000-4000-8000-000000000301', 'cn-dual@example.test');
insert into public.tenants (id, name) values
  ('c0000000-0000-4000-8000-00000000000a', 'Synthetic Notes Clinic A'),
  ('c0000000-0000-4000-8000-00000000000b', 'Synthetic Notes Clinic B');
insert into public.memberships (user_id, tenant_id, role) values
  ('c0000000-0000-4000-8000-000000000101', 'c0000000-0000-4000-8000-00000000000a', 'owner'),
  ('c0000000-0000-4000-8000-000000000102', 'c0000000-0000-4000-8000-00000000000a', 'admin'),
  ('c0000000-0000-4000-8000-000000000103', 'c0000000-0000-4000-8000-00000000000a', 'doctor'),
  ('c0000000-0000-4000-8000-000000000104', 'c0000000-0000-4000-8000-00000000000a', 'nurse'),
  ('c0000000-0000-4000-8000-000000000105', 'c0000000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c0000000-0000-4000-8000-000000000201', 'c0000000-0000-4000-8000-00000000000b', 'owner'),
  ('c0000000-0000-4000-8000-000000000301', 'c0000000-0000-4000-8000-00000000000a', 'doctor'),
  ('c0000000-0000-4000-8000-000000000301', 'c0000000-0000-4000-8000-00000000000b', 'receptionist');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c0000000-0000-4000-8000-000000001001', 'c0000000-0000-4000-8000-00000000000a', 'Synthetic Notes Patient', '+919000000401', 'c0000000-0000-4000-8000-000000000101');
-- V1: the visit every probe reads/writes (its notes row is created by the trigger, then given content as postgres).
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by) values
  ('c0000000-0000-4000-8000-000000001011', 'c0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-000000001001', 'c0000000-0000-4000-8000-000000000103', 'walk_in', 'c0000000-0000-4000-8000-000000000101');
update public.clinical_notes
   set clinical_notes = 'Synthetic note', vitals = '{"pulse": 72}'::jsonb, chief_complaints = '[{"complaint": "Synthetic"}]'::jsonb
 where visit_id = 'c0000000-0000-4000-8000-000000001011';

-- Helpers ----------------------------------------------------------------------------------------------------------
-- As postgres: one statement in a subtransaction that is ALWAYS rolled back; 'ok' or the SQLSTATE it raised.
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
begin
  begin
    execute p_sql;
    raise exception 'cn sentinel' using errcode = 'P0S01';
  exception when others then
    if sqlstate = 'P0S01' then return 'ok'; end if;
    return sqlstate;
  end;
end;
$f$;

-- As a signed-in user (or anon when p_user is null): rows affected/returned by p_sql, 'denied:<message>' (42501) or
-- 'error:<sqlstate>'. Always rolled back, like the generated matrix cells.
create function pg_temp.as_user(p_user uuid, p_header uuid, p_sql text) returns text language plpgsql as $f$
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
    if p_user is null then set local role anon; else set local role authenticated; end if;
    execute p_sql;
    get diagnostics v_rows = row_count;
    v_out := v_rows::text;
    raise exception 'cn sentinel' using errcode = 'P0S01';
  exception
    when sqlstate 'P0S01' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate;
  end;
  return v_out;
end;
$f$;

-- As a signed-in user: p_sql, then (still in the same subtransaction, as postgres) the value of p_check. Rolled back.
create function pg_temp.as_user_then(p_user uuid, p_sql text, p_check text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    perform set_config('request.headers', '', true);
    set local role authenticated;
    execute p_sql;
    reset role;
    execute p_check into v_out;
    raise exception 'cn sentinel' using errcode = 'P0S01';
  exception
    when sqlstate 'P0S01' then null;
    when others then v_out := 'error:' || sqlstate;
  end;
  return v_out;
end;
$f$;

-- 1. Shape ----------------------------------------------------------------------------------------------------------
select has_table('public', 'clinical_notes', 'public.clinical_notes exists');
select col_is_pk('public', 'clinical_notes', 'visit_id', 'clinical_notes is keyed by visit_id (1:1 with visits)');
select is((select pg_get_constraintdef(oid) from pg_constraint where conname = 'clinical_notes_tenant_visit_fkey'),
  'FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id) ON DELETE RESTRICT',
  'composite FK to visits (tenant_id, id), RESTRICT (05-03 pattern)');
select ok((select relrowsecurity from pg_class where oid = 'public.clinical_notes'::regclass), 'RLS is enabled on clinical_notes');
select table_privs_are('public', 'clinical_notes', 'authenticated', array['SELECT', 'UPDATE'],
  'authenticated holds SELECT and UPDATE only (no INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER)');
select table_privs_are('public', 'clinical_notes', 'anon', array[]::text[], 'anon holds no privilege on clinical_notes');
select set_eq(
  $$select policyname::text, cmd::text from pg_policies where schemaname = 'public' and tablename = 'clinical_notes'$$,
  $$values ('clinical_notes_select', 'SELECT'), ('clinical_notes_update', 'UPDATE')$$,
  'clinical_notes has exactly a SELECT and an UPDATE policy (no INSERT, no DELETE)');
select is_empty(
  $$select policyname from pg_policies where schemaname = 'public' and tablename = 'clinical_notes'
     and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'current_user_tenant_ids|memberships'$$,
  'the clinical_notes policies use the authz helpers (active clinic), never the legacy rules');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
            where oid = 'private.visits_create_clinical_notes()'::regprocedure),
  'visits_create_clinical_notes is SECURITY DEFINER with an empty search_path');
select ok(not has_function_privilege('authenticated', 'private.visits_create_clinical_notes()', 'execute')
      and not has_function_privilege('anon', 'private.visits_create_clinical_notes()', 'execute')
      and not has_function_privilege('authenticated', 'public.clinical_notes_guard()', 'execute'),
  'the API roles cannot execute the trigger functions');

-- 2. One row per visit, fixed content; nothing clinical can be written into visits -----------------------------------
select is((select count(*)::int from public.clinical_notes where visit_id = 'c0000000-0000-4000-8000-000000001011'), 1,
  'inserting a visit creates exactly one clinical_notes row');
select is(pg_temp.as_user_then('c0000000-0000-4000-8000-000000000105',
  $$insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by) values ('c0000000-0000-4000-8000-000000001012', 'c0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-000000001001', 'c0000000-0000-4000-8000-000000000103', 'walk_in', 'c0000000-0000-4000-8000-000000000105')$$,
  $$select count(*)::text || ':' || (vitals = '{}' and chief_complaints = '[]' and clinical_notes is null and specialty_data = '{}'
           and investigations_advised = '{}' and advice = '{}' and tenant_id = 'c0000000-0000-4000-8000-00000000000a')::text
      from public.clinical_notes where visit_id = 'c0000000-0000-4000-8000-000000001012' group by vitals, chief_complaints, clinical_notes, specialty_data, investigations_advised, advice, tenant_id$$),
  '1:true',
  'a receptionist booking a visit creates its one clinical_notes row, with the fixed empty content (T-05-03)');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000105', null,
  $$insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, created_by, clinical_notes) values ('c0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-000000001001', 'c0000000-0000-4000-8000-000000000103', 'walk_in', 'c0000000-0000-4000-8000-000000000105', 'Injected note')$$),
  'error:23514', 'a receptionist cannot inject notes through the visit insert (visits_clinical_content_moved)');
select throws_ok($$update public.visits set clinical_notes = 'Synthetic' where id = 'c0000000-0000-4000-8000-000000001011'$$,
  '23514', null, 'writing clinical_notes into visits fails (23514)');
select throws_ok($$update public.visits set vitals = '{"pulse": 80}' where id = 'c0000000-0000-4000-8000-000000001011'$$,
  '23514', null, 'writing vitals into visits fails (23514)');
select throws_ok($$update public.visits set chief_complaints = '[{"complaint": "x"}]' where id = 'c0000000-0000-4000-8000-000000001011'$$,
  '23514', null, 'writing chief_complaints into visits fails (23514)');
select throws_ok($$update public.visits set specialty_data = '{"a": 1}' where id = 'c0000000-0000-4000-8000-000000001011'$$,
  '23514', null, 'writing specialty_data into visits fails (23514)');
select throws_ok($$update public.visits set investigations_advised = array['CBC'] where id = 'c0000000-0000-4000-8000-000000001011'$$,
  '23514', null, 'writing investigations_advised into visits fails (23514)');
select throws_ok($$update public.visits set advice = array['Rest'] where id = 'c0000000-0000-4000-8000-000000001011'$$,
  '23514', null, 'writing advice into visits fails (23514)');
select is(pg_temp.try($$update public.visits set vitals = '{}', chief_complaints = '[]', specialty_data = '{}', investigations_advised = '{}', advice = '{}', clinical_notes = null where id = 'c0000000-0000-4000-8000-000000001011'$$),
  'ok', 'control: the empty values (the column defaults) are still accepted on visits');
select ok((select convalidated from pg_constraint where conname = 'visits_clinical_content_moved'), 'visits_clinical_content_moved is VALID');

-- 3. SELECT by role -------------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000101', null, $$select * from public.clinical_notes where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), '1', 'owner reads the note');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000103', null, $$select * from public.clinical_notes where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), '1', 'doctor reads the note');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000104', null, $$select * from public.clinical_notes where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), '1', 'nurse reads the note');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000105', null, $$select * from public.clinical_notes where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), '0', 'receptionist reads 0 rows (PO-3, acceptance 2)');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000102', null, $$select * from public.clinical_notes where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), '0', 'admin reads 0 rows (R-9)');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000201', null, $$select * from public.clinical_notes where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), '0', 'clinic B''s owner reads 0 rows');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000301', 'c0000000-0000-4000-8000-00000000000a', $$select * from public.clinical_notes where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), '1', 'dual member acting in A (doctor) reads the note');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000301', 'c0000000-0000-4000-8000-00000000000b', $$select * from public.clinical_notes where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), '0', 'dual member acting in B (receptionist) reads 0 rows of A');
select is(pg_temp.as_user(null, null, $$select * from public.clinical_notes$$), 'denied:permission denied for table clinical_notes', 'anon has no privilege');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000105', null, $$select * from public.visits where id = 'c0000000-0000-4000-8000-000000001011' and clinical_notes is null and (vitals is null or vitals = '{}')$$),
  '1', 'the receptionist still reads the visit row, whose legacy clinical columns are empty');

-- 4. UPDATE by role (R-3: nurses record vitals only) -------------------------------------------------------------
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000104', null, $$update public.clinical_notes set vitals = '{"pulse": 90}' where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), '1', 'nurse updates vitals (1 row)');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000104', null, $$update public.clinical_notes set clinical_notes = 'Nurse text' where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), 'denied:CLINICAL_NOTES_VITALS_ONLY', 'nurse update of clinical_notes → 42501 (guard, T-05-02)');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000104', null, $$update public.clinical_notes set vitals = '{"pulse": 91}', advice = array['Nurse advice'] where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), 'denied:CLINICAL_NOTES_VITALS_ONLY', 'nurse update of vitals together with advice → 42501');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000104', null, $$update public.clinical_notes set chief_complaints = '[]' where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), 'denied:CLINICAL_NOTES_VITALS_ONLY', 'nurse update of chief_complaints → 42501');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000103', null, $$update public.clinical_notes set clinical_notes = 'Doctor text', vitals = '{"pulse": 70}' where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), '1', 'doctor updates notes and vitals (1 row)');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000101', null, $$update public.clinical_notes set advice = array['Owner advice'] where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), '1', 'owner updates (1 row)');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000105', null, $$update public.clinical_notes set vitals = '{"pulse": 1}' where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), '0', 'receptionist update → 0 rows');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000102', null, $$update public.clinical_notes set clinical_notes = 'Admin text' where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), '0', 'admin update → 0 rows');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000201', null, $$update public.clinical_notes set clinical_notes = 'B text' where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), '0', 'clinic B''s owner update → 0 rows');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000301', 'c0000000-0000-4000-8000-00000000000b', $$update public.clinical_notes set clinical_notes = 'Dual text' where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), '0', 'dual member acting in B → 0 rows of A');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000301', 'c0000000-0000-4000-8000-00000000000a', $$update public.clinical_notes set clinical_notes = 'Dual text' where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), '1', 'dual member acting in A (doctor) → 1 row');
select is(pg_temp.as_user_then('c0000000-0000-4000-8000-000000000104',
  $$update public.clinical_notes set vitals = '{"pulse": 88}' where visit_id = 'c0000000-0000-4000-8000-000000001011'$$,
  $$select (vitals ->> 'pulse') || '|' || clinical_notes || '|' || (chief_complaints -> 0 ->> 'complaint') from public.clinical_notes where visit_id = 'c0000000-0000-4000-8000-000000001011'$$),
  '88|Synthetic note|Synthetic', 'the nurse''s vitals update lands and leaves the notes and complaints untouched');

-- 5. Keys, INSERT/DELETE, updated_at, RESTRICT, tenant cascade -----------------------------------------------------
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000103', null, $$update public.clinical_notes set visit_id = 'c0000000-0000-4000-8000-000000001099' where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), 'denied:CLINICAL_NOTES_KEY_IMMUTABLE', 'visit_id never changes (doctor)');
select is(pg_temp.try($$update public.clinical_notes set tenant_id = 'c0000000-0000-4000-8000-00000000000b' where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), '42501', 'tenant_id never changes (even as postgres)');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000103', null, $$insert into public.clinical_notes (visit_id, tenant_id) values ('c0000000-0000-4000-8000-000000001099', 'c0000000-0000-4000-8000-00000000000a')$$), 'denied:permission denied for table clinical_notes', 'no tenant role inserts (doctor: no privilege)');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000101', null, $$delete from public.clinical_notes where visit_id = 'c0000000-0000-4000-8000-000000001011'$$), 'denied:permission denied for table clinical_notes', 'no tenant role deletes (owner: no privilege)');
select is(pg_temp.try($$insert into public.clinical_notes (visit_id, tenant_id) values ('c0000000-0000-4000-8000-000000001099', 'c0000000-0000-4000-8000-00000000000a')$$), '23503', 'a notes row needs its visit in the same clinic (composite FK)');
alter table public.clinical_notes disable trigger clinical_notes_guard;
update public.clinical_notes set updated_at = '2020-01-01T00:00:00Z' where visit_id = 'c0000000-0000-4000-8000-000000001011';
alter table public.clinical_notes enable trigger clinical_notes_guard;
select is(pg_temp.as_user_then('c0000000-0000-4000-8000-000000000104',
  $$update public.clinical_notes set vitals = '{"pulse": 77}', updated_at = '2001-01-01T00:00:00Z' where visit_id = 'c0000000-0000-4000-8000-000000001011'$$,
  $$select (updated_at = now())::text from public.clinical_notes where visit_id = 'c0000000-0000-4000-8000-000000001011'$$),
  'true', 'updated_at is maintained by the guard (a caller-sent value is replaced by now())');
select is(pg_temp.try($$delete from public.visits where id = 'c0000000-0000-4000-8000-000000001011'$$), '23503', 'a visit cannot be deleted from under its clinical notes (RESTRICT)');
select is(pg_temp.as_user('c0000000-0000-4000-8000-000000000201', null, $$update public.clinical_notes set vitals = '{}' $$), '0', 'clinic B''s owner updates 0 rows of A with an unfiltered UPDATE');
select lives_ok($$delete from public.tenants where id = 'c0000000-0000-4000-8000-00000000000a'$$, 'deleting the tenant cascades through visits and their clinical notes');
select is((select count(*)::int from public.clinical_notes where tenant_id = 'c0000000-0000-4000-8000-00000000000a'), 0, 'no clinical_notes row of the deleted clinic is left');

select * from finish();
rollback;
