-- command_review_fixes.test.sql — V2-07 07-04a (the review fix round; migration 000099).
--   F-1  log_audit refuses the five actions only a command writes (a nurse/receptionist cannot forge them), still accepts an
--        allowed action, and the commands still write their rows.
--   F-2  every definer clinical command checks the permission of each table family it writes: a role that holds the command's
--        own permission but lacks prescriptions:edit or appointments:edit is refused (the matrix is overridden inside the
--        rolled-back transaction, because no real role has consultations:edit without both).
--   F-3  location_id of a signed visit cannot be changed; of an unsigned one it can.
--   F-4  the system path of command_claim needs the service role.
--   F-6  sign-off only from a waiting or in-consultation visit.
--   G-3  available_slots lists no slot that starts before now(); G-9 a doctor must be a clinician (owner/doctor) in
--        enqueue_walk_in, register_and_book and available_slots.
--   07-04 contract  nobody but the definer steps inserts invoices; create_invoice still does.
-- Synthetic data only; every probe and the file roll back.
begin;
select plan(31);

-- Fixtures: clinic A with an owner, a doctor, a nurse and a receptionist -------------------------------------------------
insert into auth.users (id, email) values
  ('c9900000-0000-4000-8000-000000000101', 'c990-owner@example.test'),
  ('c9900000-0000-4000-8000-000000000103', 'c990-doctor@example.test'),
  ('c9900000-0000-4000-8000-000000000105', 'c990-nurse@example.test'),
  ('c9900000-0000-4000-8000-000000000106', 'c990-receptionist@example.test');
insert into public.tenants (id, name) values ('c9900000-0000-4000-8000-00000000000a', 'Synthetic 07-04a Clinic A');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id = 'c9900000-0000-4000-8000-00000000000a';
insert into public.memberships (user_id, tenant_id, role, full_name) values
  ('c9900000-0000-4000-8000-000000000101', 'c9900000-0000-4000-8000-00000000000a', 'owner', 'Synthetic Owner'),
  ('c9900000-0000-4000-8000-000000000103', 'c9900000-0000-4000-8000-00000000000a', 'doctor', 'Synthetic Doctor'),
  ('c9900000-0000-4000-8000-000000000105', 'c9900000-0000-4000-8000-00000000000a', 'nurse', 'Synthetic Nurse'),
  ('c9900000-0000-4000-8000-000000000106', 'c9900000-0000-4000-8000-00000000000a', 'receptionist', 'Synthetic Receptionist');
-- Every day 00:00-23:00 for the doctor (a schedule so available_slots has hours to list).
update public.memberships set availability_schedule = jsonb_build_object(
    'monday', '{"enabled": true, "shifts": [{"start": "00:00", "end": "23:00"}]}'::jsonb,
    'tuesday', '{"enabled": true, "shifts": [{"start": "00:00", "end": "23:00"}]}'::jsonb,
    'wednesday', '{"enabled": true, "shifts": [{"start": "00:00", "end": "23:00"}]}'::jsonb,
    'thursday', '{"enabled": true, "shifts": [{"start": "00:00", "end": "23:00"}]}'::jsonb,
    'friday', '{"enabled": true, "shifts": [{"start": "00:00", "end": "23:00"}]}'::jsonb,
    'saturday', '{"enabled": true, "shifts": [{"start": "00:00", "end": "23:00"}]}'::jsonb,
    'sunday', '{"enabled": true, "shifts": [{"start": "00:00", "end": "23:00"}]}'::jsonb),
  default_slot_duration_minutes = 60
 where user_id = 'c9900000-0000-4000-8000-000000000103';
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c9900000-0000-4000-8000-000000001001', 'c9900000-0000-4000-8000-00000000000a', 'Synthetic Patient', '+919000000990',
   'c9900000-0000-4000-8000-000000000101');
-- Visits (doctor 103): 2001 waiting, 2002 booked, 2003 cancelled, 2004 in_consultation, 2005 waiting (the F-2 and F-3 subject),
-- 2006 signed and reopened (the finalize subject), 2007 signed (the location and reopen subject), 2008 booked (check-in, invoice).
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c9900000-0000-4000-8000-000000002001', 'c9900000-0000-4000-8000-00000000000a', 'c9900000-0000-4000-8000-000000001001', 'c9900000-0000-4000-8000-000000000103', 'walk_in', 'waiting', 'c9900000-0000-4000-8000-000000000101'),
  ('c9900000-0000-4000-8000-000000002002', 'c9900000-0000-4000-8000-00000000000a', 'c9900000-0000-4000-8000-000000001001', 'c9900000-0000-4000-8000-000000000103', 'walk_in', 'booked', 'c9900000-0000-4000-8000-000000000101'),
  ('c9900000-0000-4000-8000-000000002003', 'c9900000-0000-4000-8000-00000000000a', 'c9900000-0000-4000-8000-000000001001', 'c9900000-0000-4000-8000-000000000103', 'walk_in', 'cancelled', 'c9900000-0000-4000-8000-000000000101'),
  ('c9900000-0000-4000-8000-000000002004', 'c9900000-0000-4000-8000-00000000000a', 'c9900000-0000-4000-8000-000000001001', 'c9900000-0000-4000-8000-000000000103', 'walk_in', 'in_consultation', 'c9900000-0000-4000-8000-000000000101'),
  ('c9900000-0000-4000-8000-000000002005', 'c9900000-0000-4000-8000-00000000000a', 'c9900000-0000-4000-8000-000000001001', 'c9900000-0000-4000-8000-000000000103', 'walk_in', 'waiting', 'c9900000-0000-4000-8000-000000000101'),
  ('c9900000-0000-4000-8000-000000002006', 'c9900000-0000-4000-8000-00000000000a', 'c9900000-0000-4000-8000-000000001001', 'c9900000-0000-4000-8000-000000000103', 'walk_in', 'waiting', 'c9900000-0000-4000-8000-000000000101'),
  ('c9900000-0000-4000-8000-000000002007', 'c9900000-0000-4000-8000-00000000000a', 'c9900000-0000-4000-8000-000000001001', 'c9900000-0000-4000-8000-000000000103', 'walk_in', 'waiting', 'c9900000-0000-4000-8000-000000000101'),
  ('c9900000-0000-4000-8000-000000002008', 'c9900000-0000-4000-8000-00000000000a', 'c9900000-0000-4000-8000-000000001001', 'c9900000-0000-4000-8000-000000000103', 'walk_in', 'booked', 'c9900000-0000-4000-8000-000000000101');
-- A clinical note and an active prescription on every visit (the sign-off needs content; the finalize needs a prescription).
insert into public.consultation_diagnoses (tenant_id, visit_id, patient_id, diagnosis_name)
  select 'c9900000-0000-4000-8000-00000000000a', v.id, 'c9900000-0000-4000-8000-000000001001', 'Synthetic diagnosis'
    from public.visits v where v.id::text like 'c9900000-0000-4000-8000-00000000200%';
insert into public.prescriptions (tenant_id, visit_id, patient_id, doctor_id, version, status)
  select 'c9900000-0000-4000-8000-00000000000a', v.id, 'c9900000-0000-4000-8000-000000001001', 'c9900000-0000-4000-8000-000000000103', 1, 'active'
    from public.visits v where v.id::text like 'c9900000-0000-4000-8000-00000000200%';
-- Visits 2006 and 2007 are signed as the doctor; 2006 is then reopened (a database snapshot revision, status in_consultation).
update public.visits set status = 'completed', signed_at = now(), signed_by = 'c9900000-0000-4000-8000-000000000103'
 where id in ('c9900000-0000-4000-8000-000000002006', 'c9900000-0000-4000-8000-000000002007');
insert into public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason) values
  ('c9900000-0000-4000-8000-00000000000a', 'c9900000-0000-4000-8000-000000002006', 'c9900000-0000-4000-8000-000000000103', 'Synthetic amendment reason');
update public.visits set status = 'in_consultation' where id = 'c9900000-0000-4000-8000-000000002006';
-- A second (non-default) location for the F-3 location change.
insert into public.clinic_locations (id, tenant_id, name) values
  ('c9900000-0000-4000-8000-0000000000f1', 'c9900000-0000-4000-8000-00000000000a', 'Synthetic Annex');

-- Helpers ----------------------------------------------------------------------------------------------------------
-- As a signed-in user with the active-clinic header: run p_sql; the rows it affected/returned, 'denied:<message>' (42501) or
-- 'error:<sqlstate>:<message>'. With p_probe, the first column of p_probe (run as postgres in the same subtransaction)
-- instead. Always rolled back.
create function pg_temp.as_user(p_user uuid, p_header uuid, p_sql text, p_probe text default null) returns text
language plpgsql as $f$
declare
  v_rows bigint;
  v_out text;
begin
  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    perform set_config('request.headers', json_build_object('x-clinicos-tenant', p_header)::text, true);
    set local role authenticated;
    execute p_sql;
    get diagnostics v_rows = row_count;
    v_out := v_rows::text;
    if p_probe is not null then
      reset role;
      execute p_probe into v_out;
    end if;
    raise exception 'c990 sentinel' using errcode = 'P0S03';
  exception
    when sqlstate 'P0S03' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

-- A definer wrapper (owner: the test's postgres) so the no-grant claim helper can be exercised under the service role.
create function pg_temp.sys_claim(p_tenant uuid, p_id uuid, p_actor text) returns text language sql security definer as $$
  select coalesce(private.command_claim(p_tenant, p_id, 'synthetic.command', 'hash-1', p_actor)::text, 'NULL')
$$;
grant execute on function pg_temp.sys_claim(uuid, uuid, text) to service_role;
create function pg_temp.as_service(p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  begin
    set local role service_role;
    execute p_sql into v_out;
    reset role;
  exception when others then reset role; v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

-- The matrix override for F-2: the roles keep their permissions except the ones named in the transaction-local setting
-- c990.denied (a comma-separated list). The original function is copied under another name first.
do $$
begin
  execute replace(pg_get_functiondef('authz.role_has_permission(text,text)'::regprocedure),
                  'authz.role_has_permission', 'authz.role_has_permission_orig');
end $$;
grant execute on function authz.role_has_permission_orig(text, text) to authenticated, service_role;
create or replace function authz.role_has_permission(p_role text, p_perm text) returns boolean
language sql stable set search_path = '' as $$
  select authz.role_has_permission_orig(p_role, p_perm)
     and not (p_perm = any (string_to_array(coalesce(nullif(current_setting('c990.denied', true), ''), '-'), ',')))
$$;

-- F-1 ------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000105', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select public.log_audit('c9900000-0000-4000-8000-00000000000a'::uuid, 'visit.complete_and_sign', 'visit', 'c9900000-0000-4000-8000-000000002001', '{"version": 1}'::jsonb)$$),
  'error:P0001:INPUT_INVALID', 'F-1: a nurse cannot forge visit.complete_and_sign through log_audit');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000106', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select public.log_audit('c9900000-0000-4000-8000-00000000000a'::uuid, 'visit.reopen_for_amendment', 'visit', 'c9900000-0000-4000-8000-000000002001', '{}'::jsonb)$$),
  'error:P0001:INPUT_INVALID', 'F-1: a receptionist cannot forge visit.reopen_for_amendment');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000106', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select public.log_audit('c9900000-0000-4000-8000-00000000000a'::uuid, 'visit.amend_finalized', 'visit', 'c9900000-0000-4000-8000-000000002001', '{}'::jsonb)$$),
  'error:P0001:INPUT_INVALID', 'F-1: a receptionist cannot forge visit.amend_finalized');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000106', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select public.log_audit('c9900000-0000-4000-8000-00000000000a'::uuid, 'invoice.create', 'invoice', 'c9900000-0000-4000-8000-000000002001', '{}'::jsonb)$$),
  'error:P0001:INPUT_INVALID', 'F-1: a receptionist cannot forge invoice.create');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000106', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select public.log_audit('c9900000-0000-4000-8000-00000000000a'::uuid, 'queue.check_in', 'queue_token', 'c9900000-0000-4000-8000-000000002001', '{}'::jsonb)$$),
  'error:P0001:INPUT_INVALID', 'F-1: a receptionist cannot forge queue.check_in');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000105', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select public.log_audit('c9900000-0000-4000-8000-00000000000a'::uuid, 'patient.view', 'patient', 'c9900000-0000-4000-8000-000000001001', '{}'::jsonb)$$),
  '1', 'F-1 control: log_audit still writes an action the app writes');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000106', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select public.check_in_visit('c9900000-0000-4000-8000-00000000000a'::uuid, 'c9900000-0000-4000-8000-000000002008', 'normal', 'c9900000-0000-4000-8000-0000000c0001')$$,
  $$select count(*)::text from public.audit_logs where tenant_id = 'c9900000-0000-4000-8000-00000000000a'::uuid and action = 'queue.check_in' and actor_id = 'c9900000-0000-4000-8000-000000000106'$$),
  '1', 'F-1: check_in_visit still writes its queue.check_in row (through log_command_audit)');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000103', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select public.sign_consultation('c9900000-0000-4000-8000-00000000000a'::uuid, 'c9900000-0000-4000-8000-000000002001', 'c9900000-0000-4000-8000-0000000c0002')$$,
  $$select count(*)::text from public.audit_logs where tenant_id = 'c9900000-0000-4000-8000-00000000000a'::uuid and action = 'visit.complete_and_sign' and entity_id = 'c9900000-0000-4000-8000-000000002001'$$),
  '1', 'F-1: sign_consultation still writes its visit.complete_and_sign row');

-- F-2 ------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000103', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select set_config('c990.denied', 'prescriptions:edit', true), public.sign_consultation('c9900000-0000-4000-8000-00000000000a'::uuid, 'c9900000-0000-4000-8000-000000002005', 'c9900000-0000-4000-8000-0000000c0003')$$),
  'denied:FORBIDDEN', 'F-2: a caller with consultations:edit but without prescriptions:edit cannot sign off');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000103', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select set_config('c990.denied', 'appointments:edit', true), public.sign_consultation('c9900000-0000-4000-8000-00000000000a'::uuid, 'c9900000-0000-4000-8000-000000002005', 'c9900000-0000-4000-8000-0000000c0004')$$),
  'denied:FORBIDDEN', 'F-2: ... nor without appointments:edit');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000103', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select set_config('c990.denied', 'prescriptions:edit', true), public.finalize_visit_amendment('c9900000-0000-4000-8000-00000000000a'::uuid, 'c9900000-0000-4000-8000-000000002006', 'c9900000-0000-4000-8000-0000000c0005')$$),
  'denied:FORBIDDEN', 'F-2: finalize_visit_amendment without prescriptions:edit is refused');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000103', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select set_config('c990.denied', 'appointments:edit', true), public.finalize_visit_amendment('c9900000-0000-4000-8000-00000000000a'::uuid, 'c9900000-0000-4000-8000-000000002006', 'c9900000-0000-4000-8000-0000000c0006')$$),
  'denied:FORBIDDEN', 'F-2: finalize_visit_amendment without appointments:edit is refused');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000103', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select set_config('c990.denied', 'appointments:edit', true), public.reopen_visit_for_amendment('c9900000-0000-4000-8000-00000000000a'::uuid, 'c9900000-0000-4000-8000-000000002007', 'Synthetic amendment reason for the test', 'c9900000-0000-4000-8000-0000000c0007')$$),
  'denied:FORBIDDEN', 'F-2: reopen_visit_for_amendment without appointments:edit is refused');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000103', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select set_config('c990.denied', 'labs:edit', true), public.sign_consultation('c9900000-0000-4000-8000-00000000000a'::uuid, 'c9900000-0000-4000-8000-000000002005', 'c9900000-0000-4000-8000-0000000c0008')$$,
  $$select status from public.visits where id = 'c9900000-0000-4000-8000-000000002005'$$),
  'completed', 'F-2 control: with an unrelated permission denied the same sign-off succeeds');

-- F-6 ------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000103', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select public.sign_consultation('c9900000-0000-4000-8000-00000000000a'::uuid, 'c9900000-0000-4000-8000-000000002002', 'c9900000-0000-4000-8000-0000000c0009')$$),
  'error:P0001:VISIT_NOT_SIGNABLE', 'F-6: a booked visit cannot be signed');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000103', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select public.sign_consultation('c9900000-0000-4000-8000-00000000000a'::uuid, 'c9900000-0000-4000-8000-000000002003', 'c9900000-0000-4000-8000-0000000c000a')$$),
  'error:P0001:VISIT_NOT_SIGNABLE', 'F-6: a cancelled visit cannot be signed');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000103', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select public.sign_consultation('c9900000-0000-4000-8000-00000000000a'::uuid, 'c9900000-0000-4000-8000-000000002004', 'c9900000-0000-4000-8000-0000000c000b')$$,
  $$select status from public.visits where id = 'c9900000-0000-4000-8000-000000002004'$$),
  'completed', 'F-6: a visit in consultation is signed');

-- F-3 ------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000103', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$update public.visits set location_id = 'c9900000-0000-4000-8000-0000000000f1' where id = 'c9900000-0000-4000-8000-000000002007'$$),
  'denied:VISIT_SIGNED_FIELD_IMMUTABLE', 'F-3: the location of a signed visit cannot be changed');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000103', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$update public.visits set location_id = 'c9900000-0000-4000-8000-0000000000f1' where id = 'c9900000-0000-4000-8000-000000002008'$$),
  '1', 'F-3 control: the location of an unsigned visit can be changed');

-- F-4 ------------------------------------------------------------------------------------------------------------------------
select throws_ok(
  $$select pg_temp.sys_claim('c9900000-0000-4000-8000-00000000000a'::uuid, 'c9900000-0000-4000-8000-0000000c0010', 'system:payment_webhook')$$,
  'P0001', 'ACTOR_INVALID', 'F-4: a system claim outside the service role is refused');
select is(pg_temp.as_service($$select pg_temp.sys_claim('c9900000-0000-4000-8000-00000000000a'::uuid, 'c9900000-0000-4000-8000-0000000c0011', 'system:payment_webhook')$$),
  'NULL', 'F-4: under the service role the same system claim is made (a fresh claim answers NULL)');

-- G-9 and G-3 ----------------------------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000106', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select public.enqueue_walk_in('c9900000-0000-4000-8000-00000000000a'::uuid, 'c9900000-0000-4000-8000-000000001001', null, 'c9900000-0000-4000-8000-000000000106', 'normal', 'c9900000-0000-4000-8000-0000000c0012')$$),
  'error:P0002:DOCTOR_NOT_FOUND', 'G-9: a receptionist cannot be the doctor of a walk-in');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000106', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select public.enqueue_walk_in('c9900000-0000-4000-8000-00000000000a'::uuid, 'c9900000-0000-4000-8000-000000001001', null, 'c9900000-0000-4000-8000-000000000103', 'normal', 'c9900000-0000-4000-8000-0000000c0013')$$,
  $$select count(*)::text from public.visits where tenant_id = 'c9900000-0000-4000-8000-00000000000a'::uuid and origin_type = 'walk_in' and created_by = 'c9900000-0000-4000-8000-000000000106'$$),
  '1', 'G-9 control: the same walk-in with the doctor is registered');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000106', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select public.register_and_book('c9900000-0000-4000-8000-00000000000a'::uuid, 'c9900000-0000-4000-8000-000000001001', null, 'c9900000-0000-4000-8000-000000000105', now() + interval '3 days', 15, false, 'c9900000-0000-4000-8000-0000000c0014')$$),
  'error:P0002:DOCTOR_NOT_FOUND', 'G-9: a nurse cannot be the doctor of a booking');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000106', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select * from public.available_slots('c9900000-0000-4000-8000-000000000106', current_date + 2)$$),
  '0', 'G-9: available_slots of a receptionist lists nothing');
select isnt(pg_temp.as_user('c9900000-0000-4000-8000-000000000106', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select * from public.available_slots('c9900000-0000-4000-8000-000000000103', current_date + 2)$$),
  '0', 'G-9 control: available_slots of the doctor lists slots');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000106', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select * from public.available_slots('c9900000-0000-4000-8000-000000000103', current_date - 1)$$),
  '0', 'G-3: no slot that started before now() is listed');

-- 07-04 contract -------------------------------------------------------------------------------------------------------------
select is(
  (select array_agg(r || ':' || has_table_privilege(r, 'public.invoices', 'INSERT')::text order by r)
     from unnest(array['anon', 'authenticated', 'service_role']) r),
  array['anon:false', 'authenticated:false', 'service_role:true'], 'contract: authenticated and anon hold no INSERT on invoices');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000106', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$insert into public.invoices (tenant_id, visit_id, patient_id, invoice_number) values ('c9900000-0000-4000-8000-00000000000a'::uuid, 'c9900000-0000-4000-8000-000000002008', 'c9900000-0000-4000-8000-000000001001', 'C990-0001')$$),
  'denied:permission denied for table invoices', 'contract: a receptionist cannot insert an invoice header directly');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000106', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select public.create_invoice('c9900000-0000-4000-8000-00000000000a'::uuid, 'c9900000-0000-4000-8000-000000002008', '[{"description": "Synthetic fee", "unit_price": 100}]'::jsonb, 'c9900000-0000-4000-8000-0000000c0015')$$,
  $$select count(*)::text from public.invoices where visit_id = 'c9900000-0000-4000-8000-000000002008'$$),
  '1', 'contract: create_invoice (the definer step) still writes the invoice');
select is(pg_temp.as_user('c9900000-0000-4000-8000-000000000106', 'c9900000-0000-4000-8000-00000000000a'::uuid,
  $$select public.create_invoice('c9900000-0000-4000-8000-00000000000a'::uuid, 'c9900000-0000-4000-8000-000000002008', '[{"description": "Synthetic fee", "unit_price": 100}]'::jsonb, 'c9900000-0000-4000-8000-0000000c0016')$$,
  $$select count(*)::text from public.audit_logs where tenant_id = 'c9900000-0000-4000-8000-00000000000a'::uuid and action = 'invoice.create'$$),
  '1', 'contract: create_invoice writes its invoice.create audit row (through log_command_audit)');

select * from finish();
rollback;
