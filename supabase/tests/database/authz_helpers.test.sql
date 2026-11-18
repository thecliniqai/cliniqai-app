-- V2-05 05-01b: the `authz` helpers (migration 000046_authz_core.sql; ADR-006, rulings R-14, R-41, R-42; threats
-- T-05-14, T-05-39, T-05-40). Hand-written; the generated role x table matrix is authz_matrix.test.sql.
--
-- Pins what later plans may not change: the helper SIGNATURES (05-05 and 05-10a change bodies only, R-14), their
-- volatility, SECURITY DEFINER flag, empty search_path and exact EXECUTE grants (a new function in `authz` without
-- its REVOKEs fails the ACL set). Then the behaviour: the PO-3 permission CASE, `has_permission` bound to the caller
-- and to the ACTIVE clinic (the `x-clinicos-tenant` request header, R-42), and the dual-member cases of the V2-03
-- 03-07 D1 finding 2. Principals are simulated with `request.jwt.claims` / `request.headers` inside
-- `pg_temp.authz_eval`, which runs one query as the principal in a subtransaction it always rolls back.
--
-- Synthetic data only; one transaction, rolled back.
begin;
select plan(77);

-- ---------------------------------------------------------------------------------------------------------------------
-- Signatures, volatility, definer flag, search_path (10 functions x 5 = 50)
-- ---------------------------------------------------------------------------------------------------------------------

select has_function('authz', 'permission_keys', array[]::name[], 'authz.permission_keys() exists');
select function_returns('authz', 'permission_keys', array[]::name[], 'text[]', 'permission_keys returns text[]');
select volatility_is('authz', 'permission_keys', array[]::name[], 'immutable', 'permission_keys is IMMUTABLE');
select isnt_definer('authz', 'permission_keys', array[]::name[], 'permission_keys is SECURITY INVOKER');
select is((select proconfig from pg_proc where oid = 'authz.permission_keys()'::regprocedure), array['search_path=""'], 'permission_keys: search_path is empty');

select has_function('authz', 'role_has_permission', array['text', 'text'], 'authz.role_has_permission(text, text) exists');
select function_returns('authz', 'role_has_permission', array['text', 'text'], 'boolean', 'role_has_permission returns boolean');
select volatility_is('authz', 'role_has_permission', array['text', 'text'], 'immutable', 'role_has_permission is IMMUTABLE');
select isnt_definer('authz', 'role_has_permission', array['text', 'text'], 'role_has_permission is SECURITY INVOKER');
select is((select proconfig from pg_proc where oid = 'authz.role_has_permission(text,text)'::regprocedure), array['search_path=""'], 'role_has_permission: search_path is empty');

select has_function('authz', 'active_tenant_id', array[]::name[], 'authz.active_tenant_id() exists');
select function_returns('authz', 'active_tenant_id', array[]::name[], 'uuid', 'active_tenant_id returns uuid');
select volatility_is('authz', 'active_tenant_id', array[]::name[], 'stable', 'active_tenant_id is STABLE');
select is_definer('authz', 'active_tenant_id', array[]::name[], 'active_tenant_id is SECURITY DEFINER');
select is((select proconfig from pg_proc where oid = 'authz.active_tenant_id()'::regprocedure), array['search_path=""'], 'active_tenant_id: search_path is empty');

select has_function('authz', 'member_tenant_ids', array[]::name[], 'authz.member_tenant_ids() exists');
select function_returns('authz', 'member_tenant_ids', array[]::name[], 'setof uuid', 'member_tenant_ids returns setof uuid');
select volatility_is('authz', 'member_tenant_ids', array[]::name[], 'stable', 'member_tenant_ids is STABLE');
select is_definer('authz', 'member_tenant_ids', array[]::name[], 'member_tenant_ids is SECURITY DEFINER');
select is((select proconfig from pg_proc where oid = 'authz.member_tenant_ids()'::regprocedure), array['search_path=""'], 'member_tenant_ids: search_path is empty');

select has_function('authz', 'full_tenant_ids', array[]::name[], 'authz.full_tenant_ids() exists');
select function_returns('authz', 'full_tenant_ids', array[]::name[], 'setof uuid', 'full_tenant_ids returns setof uuid');
select volatility_is('authz', 'full_tenant_ids', array[]::name[], 'stable', 'full_tenant_ids is STABLE');
select is_definer('authz', 'full_tenant_ids', array[]::name[], 'full_tenant_ids is SECURITY DEFINER');
select is((select proconfig from pg_proc where oid = 'authz.full_tenant_ids()'::regprocedure), array['search_path=""'], 'full_tenant_ids: search_path is empty');

select has_function('authz', 'tenant_ids_with', array['text'], 'authz.tenant_ids_with(text) exists');
select function_returns('authz', 'tenant_ids_with', array['text'], 'setof uuid', 'tenant_ids_with returns setof uuid');
select volatility_is('authz', 'tenant_ids_with', array['text'], 'stable', 'tenant_ids_with is STABLE');
select is_definer('authz', 'tenant_ids_with', array['text'], 'tenant_ids_with is SECURITY DEFINER');
select is((select proconfig from pg_proc where oid = 'authz.tenant_ids_with(text)'::regprocedure), array['search_path=""'], 'tenant_ids_with: search_path is empty');

select has_function('authz', 'billing_tenant_ids', array[]::name[], 'authz.billing_tenant_ids() exists');
select function_returns('authz', 'billing_tenant_ids', array[]::name[], 'setof uuid', 'billing_tenant_ids returns setof uuid');
select volatility_is('authz', 'billing_tenant_ids', array[]::name[], 'stable', 'billing_tenant_ids is STABLE');
select is_definer('authz', 'billing_tenant_ids', array[]::name[], 'billing_tenant_ids is SECURITY DEFINER');
select is((select proconfig from pg_proc where oid = 'authz.billing_tenant_ids()'::regprocedure), array['search_path=""'], 'billing_tenant_ids: search_path is empty');

select has_function('public', 'has_permission', array['uuid', 'text'], 'public.has_permission(uuid, text) exists');
select function_returns('public', 'has_permission', array['uuid', 'text'], 'boolean', 'has_permission returns boolean');
select volatility_is('public', 'has_permission', array['uuid', 'text'], 'stable', 'has_permission is STABLE');
select is_definer('public', 'has_permission', array['uuid', 'text'], 'has_permission is SECURITY DEFINER');
select is((select proconfig from pg_proc where oid = 'public.has_permission(uuid,text)'::regprocedure), array['search_path=""'], 'has_permission: search_path is empty');

select has_function('public', 'permission_matrix', array[]::name[], 'public.permission_matrix() exists');
select function_returns('public', 'permission_matrix', array[]::name[], 'setof record', 'permission_matrix returns a table');
select volatility_is('public', 'permission_matrix', array[]::name[], 'immutable', 'permission_matrix is IMMUTABLE');
select isnt_definer('public', 'permission_matrix', array[]::name[], 'permission_matrix is SECURITY INVOKER');
select is((select proconfig from pg_proc where oid = 'public.permission_matrix()'::regprocedure), array['search_path=""'], 'permission_matrix: search_path is empty');

select has_function('public', 'current_user_tenant_ids', array[]::name[], 'public.current_user_tenant_ids() keeps its signature');
select function_returns('public', 'current_user_tenant_ids', array[]::name[], 'setof uuid', 'current_user_tenant_ids returns setof uuid');
select volatility_is('public', 'current_user_tenant_ids', array[]::name[], 'stable', 'current_user_tenant_ids is STABLE');
select is_definer('public', 'current_user_tenant_ids', array[]::name[], 'current_user_tenant_ids is SECURITY DEFINER');
select is((select proconfig from pg_proc where oid = 'public.current_user_tenant_ids()'::regprocedure), array['search_path=""'], 'current_user_tenant_ids: search_path is empty');

-- ---------------------------------------------------------------------------------------------------------------------
-- Exact grants (2): schema USAGE and EXECUTE on every function in `authz` plus the public entry points
-- ---------------------------------------------------------------------------------------------------------------------

select set_eq(
  $$ select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end
       from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
      where n.nspname = 'authz' and a.privilege_type = 'USAGE' and a.grantee <> n.nspowner $$,
  array['authenticated', 'service_role'],
  'USAGE on schema authz: authenticated and service_role only (not anon, not PUBLIC)'
);

select set_eq(
  $$ select p.pronamespace::regnamespace::text || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ') '
            || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end
       from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner
        and (p.pronamespace = 'authz'::regnamespace
             or p.oid in ('public.has_permission(uuid,text)'::regprocedure, 'public.permission_matrix()'::regprocedure,
                          'public.current_user_tenant_ids()'::regprocedure)) $$,
  array[
    'authz.active_tenant_id() authenticated',
    'authz.billing_tenant_ids() authenticated',
    'authz.full_tenant_ids() authenticated',
    'authz.member_tenant_ids() authenticated',
    'authz.permission_keys() authenticated',
    'authz.permission_keys() service_role',
    'authz.role_has_permission(text, text) authenticated',
    'authz.role_has_permission(text, text) service_role',
    'authz.tenant_ids_with(text) authenticated',
    'public.current_user_tenant_ids() authenticated',
    'public.current_user_tenant_ids() service_role',
    'public.has_permission(uuid, text) authenticated',
    'public.has_permission(uuid, text) service_role',
    'public.permission_matrix() authenticated',
    'public.permission_matrix() service_role'
  ],
  'EXECUTE grants are exact: no PUBLIC or anon grant on any authz function or entry point'
);

-- ---------------------------------------------------------------------------------------------------------------------
-- The PO-3 permission CASE (8)
-- ---------------------------------------------------------------------------------------------------------------------

select is(authz.role_has_permission('receptionist', 'billing:collect'), true, 'receptionist holds billing:collect (PO-3)');
select is(authz.role_has_permission('receptionist', 'patients:edit'), true, 'receptionist holds patients:edit (PO-3, P0-14)');
select is(authz.role_has_permission('doctor', 'billing:collect'), false, 'doctor does not hold billing:collect (PO-3)');
select is(authz.role_has_permission('receptionist', 'consultations:view'), false, 'receptionist does not hold consultations:view');
select is(authz.role_has_permission('owner', 'exports:create'), true, 'owner holds every known key');
select is(authz.role_has_permission('owner', 'patient:edit'), false, 'an unknown (misspelt) key is denied to everyone, owner included');
select is(authz.role_has_permission('superuser', 'clinic:view'), false, 'an unknown role holds nothing');
select ok(array_length(authz.permission_keys(), 1) = 20 and not ('*' = any (authz.permission_keys())),
          'permission_keys lists the 20 keys and never the wildcard');

-- ---------------------------------------------------------------------------------------------------------------------
-- Principals and the active clinic (17)
-- ---------------------------------------------------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('a5b00000-0000-4000-8000-000000000101', 'authz-helpers-owner-a@example.test'),
  ('a5b00000-0000-4000-8000-000000000201', 'authz-helpers-owner-b@example.test'),
  ('a5b00000-0000-4000-8000-000000000301', 'authz-helpers-dual@example.test');
insert into public.tenants (id, name) values
  ('a5b00000-0000-4000-8000-00000000000a', 'Synthetic Helpers Clinic A'),
  ('a5b00000-0000-4000-8000-00000000000b', 'Synthetic Helpers Clinic B');
insert into public.memberships (user_id, tenant_id, role) values
  ('a5b00000-0000-4000-8000-000000000101', 'a5b00000-0000-4000-8000-00000000000a', 'owner'),
  ('a5b00000-0000-4000-8000-000000000201', 'a5b00000-0000-4000-8000-00000000000b', 'owner'),
  ('a5b00000-0000-4000-8000-000000000301', 'a5b00000-0000-4000-8000-00000000000a', 'doctor'),
  ('a5b00000-0000-4000-8000-000000000301', 'a5b00000-0000-4000-8000-00000000000b', 'receptionist');

-- Runs p_sql (one text column, one row) as p_role with the given JWT subject and request headers, in a subtransaction
-- that is always rolled back; returns its value (`<null>` for NULL) or `error:<sqlstate>`.
create function pg_temp.authz_eval(p_role text, p_sub text, p_headers text, p_sql text)
returns text
language plpgsql
as $fn$
declare
    v_out text;
begin
    begin
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claims',
                           case when p_sub is null then '' else json_build_object('sub', p_sub, 'role', p_role)::text end,
                           true);
        perform set_config('request.headers', coalesce(p_headers, ''), true);
        execute format('set local role %I', p_role);
        execute p_sql into v_out;
        v_out := coalesce(v_out, '<null>');
        raise exception 'authz eval sentinel' using errcode = 'AZ999';
    exception
        when sqlstate 'AZ999' then
            null;
        when others then
            v_out := 'error:' || sqlstate;
    end;
    return v_out;
end;
$fn$;

-- Shorthands: A, B, the dual member D (doctor in A, receptionist in B), the owners of A and B.
create function pg_temp.hdr(p_tenant text) returns text language sql as $fn$
    select json_build_object('x-clinicos-tenant', p_tenant)::text
$fn$;

-- D, header naming A: A is active; full/with-permission sets are {A}; B is out of scope even for B's own keys.
select is(pg_temp.authz_eval('authenticated', 'a5b00000-0000-4000-8000-000000000301', pg_temp.hdr('a5b00000-0000-4000-8000-00000000000a'),
          $q$ select authz.active_tenant_id()::text $q$),
          'a5b00000-0000-4000-8000-00000000000a', 'dual member, header A: active tenant is A');
select is(pg_temp.authz_eval('authenticated', 'a5b00000-0000-4000-8000-000000000301', pg_temp.hdr('a5b00000-0000-4000-8000-00000000000a'),
          $q$ select string_agg(t::text, ',' order by t) from authz.full_tenant_ids() t $q$),
          'a5b00000-0000-4000-8000-00000000000a', 'dual member, header A: full_tenant_ids = {A}');
select is(pg_temp.authz_eval('authenticated', 'a5b00000-0000-4000-8000-000000000301', pg_temp.hdr('a5b00000-0000-4000-8000-00000000000a'),
          $q$ select public.has_permission('a5b00000-0000-4000-8000-00000000000b', 'patients:view')::text $q$),
          'false', 'dual member, header A: has_permission(B, patients:view) is false (03-07 finding 2)');
select is(pg_temp.authz_eval('authenticated', 'a5b00000-0000-4000-8000-000000000301', pg_temp.hdr('a5b00000-0000-4000-8000-00000000000a'),
          $q$ select public.has_permission('a5b00000-0000-4000-8000-00000000000a', 'consultations:edit')::text $q$),
          'true', 'dual member, header A: has_permission(A, consultations:edit) is true (doctor in A)');

-- D, header naming B: B is active with the receptionist's keys.
select is(pg_temp.authz_eval('authenticated', 'a5b00000-0000-4000-8000-000000000301', pg_temp.hdr('a5b00000-0000-4000-8000-00000000000b'),
          $q$ select authz.active_tenant_id()::text $q$),
          'a5b00000-0000-4000-8000-00000000000b', 'dual member, header B: active tenant is B');
select is(pg_temp.authz_eval('authenticated', 'a5b00000-0000-4000-8000-000000000301', pg_temp.hdr('a5b00000-0000-4000-8000-00000000000b'),
          $q$ select string_agg(t::text, ',' order by t) from authz.tenant_ids_with('billing:collect') t $q$),
          'a5b00000-0000-4000-8000-00000000000b', 'dual member, header B: tenant_ids_with(billing:collect) = {B}');
select is(pg_temp.authz_eval('authenticated', 'a5b00000-0000-4000-8000-000000000301', pg_temp.hdr('a5b00000-0000-4000-8000-00000000000b'),
          $q$ select public.has_permission('a5b00000-0000-4000-8000-00000000000a', 'consultations:edit')::text $q$),
          'false', 'dual member, header B: has_permission(A, consultations:edit) is false');

-- D, header naming a clinic they do not belong to, a malformed header, no header: nothing is active.
select is(pg_temp.authz_eval('authenticated', 'a5b00000-0000-4000-8000-000000000301', pg_temp.hdr('a5b00000-0000-4000-8000-0000000000ff'),
          $q$ select coalesce(authz.active_tenant_id()::text, '<null>') || '/' || (select count(*) from authz.full_tenant_ids())::text $q$),
          '<null>/0', 'dual member, header naming a non-member clinic: no active tenant, no full tenants');
select is(pg_temp.authz_eval('authenticated', 'a5b00000-0000-4000-8000-000000000301', pg_temp.hdr('not-a-uuid'' or true --'),
          $q$ select authz.active_tenant_id()::text $q$),
          '<null>', 'dual member, malformed header: null, no error');
select is(pg_temp.authz_eval('authenticated', 'a5b00000-0000-4000-8000-000000000301', '{not json',
          $q$ select authz.active_tenant_id()::text $q$),
          '<null>', 'dual member, request.headers not JSON: null, no error');
select is(pg_temp.authz_eval('authenticated', 'a5b00000-0000-4000-8000-000000000301', null,
          $q$ select coalesce(authz.active_tenant_id()::text, '<null>') || '/' || (select count(*) from authz.tenant_ids_with('patients:view'))::text $q$),
          '<null>/0', 'dual member, no header (two memberships): no active tenant, nothing with patients:view');
select is(pg_temp.authz_eval('authenticated', 'a5b00000-0000-4000-8000-000000000301', null,
          $q$ select string_agg(t::text, ',' order by t) from authz.member_tenant_ids() t $q$),
          'a5b00000-0000-4000-8000-00000000000a,a5b00000-0000-4000-8000-00000000000b', 'dual member: member_tenant_ids still lists both clinics (switcher)');
select is(pg_temp.authz_eval('authenticated', 'a5b00000-0000-4000-8000-000000000301', pg_temp.hdr('a5b00000-0000-4000-8000-00000000000a'),
          $q$ select ((select array_agg(t order by t) from public.current_user_tenant_ids() t)
                      = (select array_agg(t order by t) from authz.member_tenant_ids() t))::text $q$),
          'true', 'current_user_tenant_ids() equals member_tenant_ids() (legacy policies keep their meaning)');

-- Single-clinic owner of A: no header needed; a header naming another clinic neither widens nor hides.
select is(pg_temp.authz_eval('authenticated', 'a5b00000-0000-4000-8000-000000000101', null,
          $q$ select string_agg(t::text, ',' order by t) from authz.billing_tenant_ids() t $q$),
          'a5b00000-0000-4000-8000-00000000000a', 'single-clinic owner, no header: billing_tenant_ids = {A} (sole membership)');
select is(pg_temp.authz_eval('authenticated', 'a5b00000-0000-4000-8000-000000000101', pg_temp.hdr('a5b00000-0000-4000-8000-00000000000b'),
          $q$ select public.has_permission('a5b00000-0000-4000-8000-00000000000a', 'clinic:manage')::text
                     || '/' || public.has_permission('a5b00000-0000-4000-8000-00000000000b', 'clinic:view')::text $q$),
          'true/false', 'single-clinic owner, header naming B: still A only (B not theirs)');

-- anon: no JWT subject; cannot even reach the authz schema; has_permission is not executable.
select is(pg_temp.authz_eval('anon', null, pg_temp.hdr('a5b00000-0000-4000-8000-00000000000a'),
          $q$ select authz.active_tenant_id()::text $q$),
          'error:42501', 'anon cannot execute authz functions (no USAGE)');
select is(pg_temp.authz_eval('anon', null, pg_temp.hdr('a5b00000-0000-4000-8000-00000000000a'),
          $q$ select public.has_permission('a5b00000-0000-4000-8000-00000000000a', 'patients:view')::text $q$),
          'error:42501', 'anon cannot execute has_permission (EXECUTE revoked)');

select * from finish();
rollback;
