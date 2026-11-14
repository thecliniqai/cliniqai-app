-- grants.test.sql — V2-05 plan 05-02c (P1-01; R-13, R-47; threat T-05-13). Catalogue loops over the API roles'
-- privileges in `public` after 000059 (grants hardening). The per-table expected set (each table's privileges equal its
-- matrix row) is generated into authz_completeness.test.sql from tests/authz/table-matrix.ts; this file holds the
-- rules that do not depend on the matrix:
--   1. no TRUNCATE / REFERENCES / TRIGGER / MAINTAIN for anon or authenticated on any public table or column;
--   2. anon holds no table, column or sequence privilege in public;
--   3. the default ACLs of role postgres (public, authz, global) grant nothing to anon / authenticated / PUBLIC, and a
--      table or function created now starts closed (proved by creating them inside this rolled-back transaction);
--   4. audit_logs: INSERT revoked from the API roles, kept for service_role (system writers);
--   5. the role-level statement_timeout of anon (3s) and authenticated (8s) as found at branch time (R-47: function-
--      level timeouts are not enforced for the calling statement, so the role setting is the only bound).
-- Synthetic data only; the file rolls back.
begin;
select plan(15);

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

-- 1. -------------------------------------------------------------------------------------------------------------------
select is_empty(
  $$ select c.relname || ':' || a.grantee::regrole::text || ':' || a.privilege_type
       from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
        and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
        and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN') $$,
  'no anon/authenticated TRUNCATE, REFERENCES, TRIGGER or MAINTAIN on any public table'
);
select is_empty(
  $$ select c.relname || '.' || att.attname || ':' || a.grantee::regrole::text || ':' || a.privilege_type
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute att on att.attrelid = c.oid and att.attacl is not null, aclexplode(att.attacl) a
      where n.nspname = 'public' and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
        and a.privilege_type = 'REFERENCES' $$,
  'no anon/authenticated column-level REFERENCES in public'
);
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000101', null, $$truncate public.patients$$), 'denied:permission denied for table patients',
  'a signed-in owner cannot TRUNCATE a tenant table (TRUNCATE bypasses RLS)');

-- 2. -------------------------------------------------------------------------------------------------------------------
select is_empty(
  $$ select c.relname || ':' || a.privilege_type
       from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S') and a.grantee = 'anon'::regrole $$,
  'anon holds no table, view or sequence privilege in public'
);
select is_empty(
  $$ select c.relname || '.' || att.attname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute att on att.attrelid = c.oid and att.attacl is not null, aclexplode(att.attacl) a
      where n.nspname = 'public' and a.grantee = 'anon'::regrole $$,
  'anon holds no column privilege in public'
);
select is(pg_temp.as_user(null, null, $$select 1 from public.cdci_brands limit 1$$),
  'denied:permission denied for table cdci_brands', 'anon cannot even read global reference data');

-- 3. -------------------------------------------------------------------------------------------------------------------
select is_empty(
  $$ select coalesce(n.nspname, '<global>') || ':' || d.defaclobjtype::text || ':' ||
            case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end
       from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
      where d.defaclrole = 'postgres'::regrole
        and (d.defaclnamespace = 0 or n.nspname in ('public', 'authz'))
        and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole)) $$,
  'the default ACLs of postgres in public, authz and globally grant nothing to anon, authenticated or PUBLIC'
);
select ok(
  exists (select 1 from pg_default_acl d where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0
           and d.defaclobjtype = 'f'),
  'a global default ACL for postgres functions exists (it is what removes the built-in PUBLIC EXECUTE)'
);
create table public.c2c_grants_probe (id int primary key);
create function public.c2c_grants_probe_fn() returns int language sql as $$ select 1 $$;
create function authz.c2c_grants_probe_fn() returns int language sql as $$ select 1 $$;
select is(
  array[has_table_privilege('anon', 'public.c2c_grants_probe', 'SELECT'),
        has_table_privilege('authenticated', 'public.c2c_grants_probe', 'SELECT'),
        has_table_privilege('authenticated', 'public.c2c_grants_probe', 'TRUNCATE')],
  array[false, false, false],
  'a table created now in public grants nothing to anon or authenticated'
);
select is(
  array[has_function_privilege('anon', 'public.c2c_grants_probe_fn()', 'EXECUTE'),
        has_function_privilege('authenticated', 'public.c2c_grants_probe_fn()', 'EXECUTE'),
        has_function_privilege('anon', 'authz.c2c_grants_probe_fn()', 'EXECUTE'),
        has_function_privilege('authenticated', 'authz.c2c_grants_probe_fn()', 'EXECUTE')],
  array[false, false, false, false],
  'a function created now in public or authz is executable by neither anon nor authenticated (no PUBLIC EXECUTE)'
);
select ok(
  has_table_privilege('service_role', 'public.c2c_grants_probe', 'SELECT'),
  'service_role keeps its default privileges on new public tables'
);

-- 4. -------------------------------------------------------------------------------------------------------------------
select is(
  array[has_table_privilege('authenticated', 'public.audit_logs', 'INSERT'),
        has_table_privilege('anon', 'public.audit_logs', 'INSERT'),
        has_table_privilege('service_role', 'public.audit_logs', 'INSERT')],
  array[false, false, true],
  'audit_logs INSERT: revoked from the API roles, kept for service_role'
);
select is(
  array[has_table_privilege('authenticated', 'public.cdci_brands', 'INSERT'),
        has_table_privilege('authenticated', 'public.opd_diagnoses', 'UPDATE'),
        has_table_privilege('authenticated', 'public.opd_diagnoses', 'DELETE'),
        has_table_privilege('authenticated', 'public.cdci_brands', 'SELECT')],
  array[false, false, false, true],
  'global reference data: read-only for authenticated'
);

-- 5. -------------------------------------------------------------------------------------------------------------------
select is(
  (select array_agg(c order by c) from pg_roles r, unnest(r.rolconfig) c where r.rolname = 'anon' and c like 'statement_timeout=%'),
  array['statement_timeout=3s'],
  'anon keeps its role-level statement_timeout (3s, R-47)'
);
select is(
  (select array_agg(c order by c) from pg_roles r, unnest(r.rolconfig) c where r.rolname = 'authenticated' and c like 'statement_timeout=%'),
  array['statement_timeout=8s'],
  'authenticated keeps its role-level statement_timeout (8s, R-47)'
);

select * from finish();
rollback;
