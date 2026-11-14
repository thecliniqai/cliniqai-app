-- audit_v2.test.sql — V2-05 plan 05-02c (P1-04 trigger part, PO-3; R-20, R-42; threats T-05-08, T-05-12, T-05-39).
--   1. `audit_logs` INSERT is revoked from the API roles: a signed-in direct insert (with or without a forged actor)
--      is refused; the select policy is clinic:manage in the active clinic.
--   2. `log_audit`: the actor is the session (id, role in the active clinic, actor_type 'user', no api key, no
--      system_actor); another clinic (single member, or a dual member acting elsewhere) is refused with 42501; input
--      is bounded; anon cannot execute it.
--   3. The actor guard (defence in depth): with INSERT re-granted inside this rolled-back transaction, an API-role
--      insert gets the JWT subject as actor whatever it names, and a dual member acting in A cannot insert for B
--      (before 05-02c the guard only looked the role up and let it through).
--   4. `record_payment`: billing:collect (doctor and nurse FORBIDDEN, receptionist ok with the audit actor =
--      receptionist), `p_tenant_id` checked against the DB-side active clinic (a dual member acting in A naming B:
--      P0002, no payment), and the catalogue has no SECURITY INVOKER function inserting into audit_logs.
-- Synthetic data only; every probe and the file roll back.
begin;
select plan(24);

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

-- 1. Direct insert refused ------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000103', null,
  $$insert into public.audit_logs (tenant_id, actor_id, actor_role, action, entity_type) values ('c2c00000-0000-4000-8000-00000000000a', 'c2c00000-0000-4000-8000-000000000103', 'doctor', 'c2c.probe', 'synthetic')$$),
  'denied:permission denied for table audit_logs', 'authenticated direct INSERT into audit_logs is refused (42501)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000101', null,
  $$insert into public.audit_logs (tenant_id, actor_id, actor_role, action, entity_type) values ('c2c00000-0000-4000-8000-00000000000a', 'c2c00000-0000-4000-8000-000000000105', 'nurse', 'c2c.probe', 'synthetic')$$),
  'denied:permission denied for table audit_logs', 'an owner cannot insert a row naming another actor');
select is(pg_temp.as_user(null, null,
  $$insert into public.audit_logs (tenant_id, actor_role, action, entity_type) values ('c2c00000-0000-4000-8000-00000000000a', 'owner', 'c2c.probe', 'synthetic')$$),
  'denied:permission denied for table audit_logs', 'anon direct INSERT is refused');
select set_eq(
  $$ select policyname::text || ':' || cmd from pg_policies where schemaname = 'public' and tablename = 'audit_logs' $$,
  array['audit_logs_select:SELECT']::text[],
  'audit_logs has one policy (SELECT clinic:manage); the "any member inserts" policy is gone'
);

-- 2. log_audit ------------------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000103', null,
  $$select public.log_audit('c2c00000-0000-4000-8000-00000000000a', 'visit.status_update', 'visit', 'c2c00000-0000-4000-8000-000000001002', '{"reason": "probe", "system_actor": "system:forged"}'::jsonb)$$,
  $$select actor_id::text || '|' || actor_role || '|' || actor_type || '|' || coalesce(api_key_id::text, '-') || '|' || (metadata ? 'system_actor')::text
      from public.audit_logs where action = 'visit.status_update' and tenant_id = 'c2c00000-0000-4000-8000-00000000000a'$$),
  'c2c00000-0000-4000-8000-000000000103|doctor|user|-|false', 'log_audit by a clinic-A doctor records the doctor (id, role, user) and drops system_actor');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000106', null,
  $$select public.log_audit('c2c00000-0000-4000-8000-00000000000a', 'patient.view', 'patient', null, null)$$,
  $$select actor_id::text || '|' || actor_role from public.audit_logs where action = 'patient.view' and tenant_id = 'c2c00000-0000-4000-8000-00000000000a'$$),
  'c2c00000-0000-4000-8000-000000000106|receptionist', 'log_audit by a receptionist records the receptionist');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000103', null, $$select public.log_audit('c2c00000-0000-4000-8000-00000000000b', 'c2c.probe', 'synthetic', null, null)$$),
  'denied:ACTOR_INVALID', 'log_audit for clinic B by a clinic-A member is refused (42501)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select public.log_audit('c2c00000-0000-4000-8000-00000000000b', 'c2c.probe', 'synthetic', null, null)$$),
  'denied:ACTOR_INVALID', 'a dual member acting in A cannot audit for B');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b',
  $$select public.log_audit('c2c00000-0000-4000-8000-00000000000b', 'patient.view', 'patient', null, null)$$,
  $$select actor_id::text || '|' || actor_role from public.audit_logs where action = 'patient.view' and tenant_id = 'c2c00000-0000-4000-8000-00000000000b'$$),
  'c2c00000-0000-4000-8000-000000000301|receptionist', 'a dual member acting in B audits for B with their B role');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', null, $$select public.log_audit('c2c00000-0000-4000-8000-00000000000a', 'c2c.probe', 'synthetic', null, null)$$),
  'denied:ACTOR_INVALID', 'a dual member with no active clinic cannot audit at all');
select alike(pg_temp.as_user('c2c00000-0000-4000-8000-000000000103', null, $$select public.log_audit('c2c00000-0000-4000-8000-00000000000a', 'not an action', 'synthetic', null, null)$$),
  'error:P0001:INPUT_INVALID%', 'log_audit refuses a malformed action');
select alike(pg_temp.as_user('c2c00000-0000-4000-8000-000000000103', null, $$select public.log_audit('c2c00000-0000-4000-8000-00000000000a', 'c2c.probe', 'synthetic', null, '[1]'::jsonb)$$),
  'error:P0001:INPUT_INVALID%', 'log_audit refuses metadata that is not an object');
select alike(pg_temp.as_user(null, null, $$select public.log_audit('c2c00000-0000-4000-8000-00000000000a', 'c2c.probe', 'synthetic', null, null)$$),
  'denied:permission denied for function log_audit', 'anon cannot execute log_audit');
select is(
  array[has_function_privilege('authenticated', 'public.log_audit(uuid, text, text, uuid, jsonb)', 'EXECUTE'),
        has_function_privilege('anon', 'public.log_audit(uuid, text, text, uuid, jsonb)', 'EXECUTE'),
        has_function_privilege('service_role', 'public.log_audit(uuid, text, text, uuid, jsonb)', 'EXECUTE')],
  array[true, false, false],
  'log_audit: EXECUTE for authenticated only'
);

-- 3. The guard behind the revoke (INSERT re-granted for this transaction only) ---------------------------------------
grant insert on public.audit_logs to authenticated;
grant usage on sequence public.audit_logs_id_seq to authenticated;
create policy c2c_reinsert on public.audit_logs for insert to authenticated with check (true);
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000103', null,
  $$insert into public.audit_logs (tenant_id, actor_id, actor_role, actor_type, action, entity_type, metadata)
    values ('c2c00000-0000-4000-8000-00000000000a', 'c2c00000-0000-4000-8000-000000000101', 'owner', 'system', 'c2c.forged', 'synthetic', '{"system_actor": "system:forged"}'::jsonb)$$,
  $$select actor_id::text || '|' || actor_role || '|' || actor_type || '|' || (metadata ? 'system_actor')::text
      from public.audit_logs where action = 'c2c.forged'$$),
  'c2c00000-0000-4000-8000-000000000103|doctor|user|false', 'a forged actor, role and type under a JWT are replaced by the JWT subject (000029 guard)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a',
  $$insert into public.audit_logs (tenant_id, actor_role, action, entity_type) values ('c2c00000-0000-4000-8000-00000000000b', 'receptionist', 'c2c.forged', 'synthetic')$$),
  'denied:ACTOR_INVALID', 'a dual member acting in A cannot insert an audit row for B (before: let through)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000201', null,
  $$insert into public.audit_logs (tenant_id, actor_role, action, entity_type) values ('c2c00000-0000-4000-8000-00000000000a', 'owner', 'c2c.forged', 'synthetic')$$),
  'denied:ACTOR_INVALID', 'a clinic-B owner cannot insert an audit row for A');
drop policy c2c_reinsert on public.audit_logs;
revoke insert on public.audit_logs from authenticated;
revoke usage on sequence public.audit_logs_id_seq from authenticated;

-- 4. record_payment ---------------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000103', null,
  $$select public.record_payment('c2c00000-0000-4000-8000-00000000000a', 'c2c00000-0000-4000-8000-000000001005', 100, 'cash', null, null)$$),
  'denied:FORBIDDEN', 'a doctor cannot collect, even on their own visit''s invoice (FORBIDDEN before the invoice read)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000105', null,
  $$select public.record_payment('c2c00000-0000-4000-8000-00000000000a', 'c2c00000-0000-4000-8000-000000001005', 100, 'cash', null, null)$$),
  'denied:FORBIDDEN', 'a nurse cannot collect');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000106', null,
  $$select public.record_payment('c2c00000-0000-4000-8000-00000000000a', 'c2c00000-0000-4000-8000-000000001005', 100, 'cash', null, null)$$,
  $$select a.actor_id::text || '|' || a.actor_role || '|' || a.actor_type || '|' || (select count(*) from public.payments p where p.invoice_id = 'c2c00000-0000-4000-8000-000000001005')
      from public.audit_logs a where a.action = 'invoice.payment_recorded' and a.tenant_id = 'c2c00000-0000-4000-8000-00000000000a'$$),
  'c2c00000-0000-4000-8000-000000000106|receptionist|user|1', 'a receptionist collects; the audit row (through log_audit) names the receptionist');
select alike(pg_temp.as_user('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000a',
  $$select public.record_payment('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000002005', 100, 'cash', null, null)$$),
  'error:P0002:INVOICE_NOT_FOUND%', 'a dual member acting in A naming clinic B gets NOT_FOUND (before: p_tenant_id trusted)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000a',
  $$select 1$$,
  $$select count(*)::text from public.payments where invoice_id = 'c2c00000-0000-4000-8000-000000002005'$$),
  '0', 'and clinic B has no payment');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000b',
  $$select public.record_payment('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000002005', 100, 'cash', null, null)$$,
  $$select a.actor_id::text || '|' || a.actor_role from public.audit_logs a where a.action = 'invoice.payment_recorded' and a.tenant_id = 'c2c00000-0000-4000-8000-00000000000b'$$),
  'c2c00000-0000-4000-8000-000000000303|owner', 'the same user acting in B collects there, audited with the B role');
select is_empty(
  $$ select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where not p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema')
        and p.prosrc ~* 'insert\s+into\s+(public\.)?audit_logs' $$,
  'no SECURITY INVOKER function inserts into audit_logs (each would fail on the revoke; users go through log_audit)'
);

select * from finish();
rollback;
