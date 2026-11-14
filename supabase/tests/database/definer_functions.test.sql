-- definer_functions.test.sql — V2-05 plan 05-02c (P1-01; R-13, R-42; threats T-05-14, T-05-39; V2-03 03-07 finding 2).
-- The SECURITY DEFINER catalogue of `public` and `private`, every function classified (a new definer function without
-- a row here fails the set_eq), and the active-clinic sweep of 000061 proven per user-authorised function:
--   1. classification: user-authorised (bound to the active clinic, with a dual-member leg below), the member helper,
--      token-scoped / onboarding / anon-system exemptions, service_role-only, and internal (no API grant);
--   2. the exact EXECUTE grantees of every definer function in public and private (anon only where listed);
--   3. every SECURITY DEFINER function in the app schemas has a pinned search_path ('' or ending in pg_temp);
--   4. no definer function calls a legacy "any membership" helper (other than the helpers' own definitions);
--   5. dual-member legs: a user who belongs to clinics A and B, acting in A (x-clinicos-tenant header) on a clinic-B
--      subject, is refused; the same call acting in B is allowed. 05-10a adds the access-level leg to this file.
-- Synthetic data only; every probe and the file roll back.
begin;
select plan(34);

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

-- Fixtures for the legs (clinic B subjects) --------------------------------------------------------------------------
insert into public.webhook_subscriptions (id, tenant_id, endpoint_url, event_types, signing_secret, is_active) values
  ('c2c00000-0000-4000-8000-000000002008', 'c2c00000-0000-4000-8000-00000000000b', 'https://hooks.example.test/c2c', array['ping'], repeat('s', 32), true);
insert into public.document_share_tokens (id, tenant_id, resource_type, resource_id, token_hash, created_by) values
  ('c2c00000-0000-4000-8000-000000004001', 'c2c00000-0000-4000-8000-00000000000b', 'invoice', 'c2c00000-0000-4000-8000-000000002005', repeat('c', 64), 'c2c00000-0000-4000-8000-000000000201');
insert into public.referrals (id, tenant_id, patient_id, referral_type, referring_doctor_id, referred_to_name,
                              reason_for_referral, target_tenant_id) values
  ('c2c00000-0000-4000-8000-000000001008', 'c2c00000-0000-4000-8000-00000000000a', 'c2c00000-0000-4000-8000-000000001001', 'in_network', 'c2c00000-0000-4000-8000-000000000103', 'Synthetic Clinic B', 'Synthetic reason', 'c2c00000-0000-4000-8000-00000000000b');
insert into public.payments (id, tenant_id, invoice_id, amount, payment_method, recorded_by) values
  ('c2c00000-0000-4000-8000-000000009999', 'c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000002005', 100, 'cash', 'c2c00000-0000-4000-8000-000000000201');

create temp table c2c_definer(fn text primary key, class text not null, reason text not null) on commit drop;
insert into c2c_definer values
  -- user-authorised, bound to the active clinic (legs in section 5)
  ('public.change_member_role', 'bound', 'target membership''s clinic = active clinic (000061)'),
  ('public.create_share_token', 'bound', 'resource''s clinic = active clinic; role by type (000061)'),
  ('public.revoke_share_token', 'bound', 'token''s clinic = active clinic (000061)'),
  ('public.enqueue_message', 'bound', 'p_tenant_id = active clinic (000061)'),
  ('public.enqueue_webhook_event', 'bound', 'p_tenant_id = active clinic; ping clinic:manage (000061)'),
  ('private.outbox_payment_recorded', 'bound', 'a session''s payment in the active clinic (000061)'),
  ('public.referral_source_clinics', 'bound', 'consultations:view in the active clinic (000061)'),
  ('public.generate_daily_queue_token', 'bound', 'appointments:edit in the active clinic (000061)'),
  ('public.generate_tenant_invoice_number', 'bound', 'billing:collect or consultations:edit, active clinic (000056)'),
  ('public.search_medicines', 'bound', 'the active clinic (000061)'),
  ('public.log_audit', 'bound', 'p_tenant = active clinic (000060)'),
  ('public.has_permission', 'bound', 'authz.tenant_ids_with: the active clinic (000046)'),
  ('public.current_user_has_role', 'bound', 'legacy helper, body bound to the active clinic (000061)'),
  ('public.current_user_is_admin_or_owner', 'bound', 'legacy helper, body bound to the active clinic (000061)'),
  -- the member helper
  ('public.current_user_tenant_ids', 'member', 'every clinic of the caller (switcher); no policy or function uses it'),
  -- exempt: authorised by something other than a clinic membership
  ('public.consume_invitation', 'exempt', 'invitation token (creates the membership; 05-07a rework)'),
  ('public.create_clinic_with_owner', 'exempt', 'onboarding: creates the clinic and the caller''s first membership'),
  ('public.consume_reschedule_token', 'exempt', 'anon, patient reschedule token'),
  ('public.get_reschedule_context', 'exempt', 'anon, patient reschedule token'),
  ('public.resolve_share_token', 'exempt', 'anon, share-link token'),
  ('public.readiness_probe', 'exempt', 'anon readiness probe: booleans only'),
  ('public.ops_ingest_error', 'exempt', 'error ingest: ingest key, no tenant data returned'),
  -- service_role only (system paths; no session)
  ('public.claim_jobs', 'system', 'job runner'), ('public.complete_job', 'system', 'job runner'),
  ('public.defer_job', 'system', 'job runner'), ('public.fail_job', 'system', 'job runner'),
  ('public.release_job', 'system', 'job runner'), ('public.start_job', 'system', 'job runner'),
  ('public.jobs_runner_begin', 'system', 'job runner'), ('public.jobs_runner_end', 'system', 'job runner'),
  ('public.communication_queue_apply_dlr', 'system', 'messaging webhook'),
  ('public.communication_queue_claim', 'system', 'messaging worker (session branch bound too)'),
  ('public.communication_queue_dead_letter', 'system', 'messaging worker'),
  ('public.communication_queue_finish', 'system', 'messaging worker (session branch bound too)'),
  ('public.communication_queue_scrub_payload', 'system', 'messaging retention'),
  ('public.create_reschedule_token', 'system', 'reminder job'),
  ('public.reschedule_token_visit', 'system', 'reschedule route (A1)'),
  ('public.enqueue_message_system', 'system', 'system message writer'),
  ('public.enqueue_unmatched_reply_system', 'system', 'system message writer'),
  ('public.enqueue_webhook_event_system', 'system', 'system webhook writer'),
  ('public.get_tenant_table_rls_policies', 'system', 'RLS catalogue helper for tests'),
  ('public.inbound_webhook_begin', 'system', 'inbound webhook dedupe'),
  ('public.inbound_webhook_finish', 'system', 'inbound webhook dedupe'),
  ('public.ops_alert_notified', 'system', 'ops alerts'), ('public.ops_alert_payload', 'system', 'ops alerts'),
  ('public.share_resource_tenant', 'system', 'share routes (A1)'),
  ('public.share_token_object', 'system', 'share routes (A1)'),
  ('public.share_token_resource', 'system', 'share routes (A1)'),
  ('public.webhook_delivery_claim', 'system', 'webhook runner'),
  ('public.webhook_delivery_finish', 'system', 'webhook runner'),
  ('private.log_system_audit', 'system', 'record_payment system path (000060)'),
  -- internal: no API role may execute them (called by the definer wrappers or as triggers)
  ('private.enqueue_message_internal', 'internal', 'writer behind the bound enqueue RPCs'),
  ('private.enqueue_webhook_internal', 'internal', 'writer behind the bound enqueue RPCs'),
  ('private.message_subject', 'internal', 'subject lookup for the enqueue RPCs'),
  ('private.webhook_event_subject', 'internal', 'subject lookup for the enqueue RPCs'),
  ('private.visits_create_clinical_notes', 'internal', 'trigger (05-02a)');

-- 1. ------------------------------------------------------------------------------------------------------------------
select set_eq(
  $$ select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname in ('public', 'private') $$,
  $$ select fn from c2c_definer $$,
  'every SECURITY DEFINER function in public and private is classified here, and nothing else'
);

-- 2. ------------------------------------------------------------------------------------------------------------------
select set_eq(
  $$ select n.nspname || '.' || p.proname || ':' || coalesce((
            select string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ',' order by 1)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname in ('public', 'private') $$,
  array[
    'public.change_member_role:authenticated,service_role', 'public.create_share_token:authenticated,service_role',
    'public.revoke_share_token:authenticated,service_role', 'public.enqueue_message:authenticated',
    'public.enqueue_webhook_event:authenticated', 'private.outbox_payment_recorded:authenticated,service_role',
    'public.referral_source_clinics:authenticated', 'public.generate_daily_queue_token:authenticated,service_role',
    'public.generate_tenant_invoice_number:authenticated,service_role', 'public.search_medicines:authenticated,service_role',
    'public.log_audit:authenticated', 'public.has_permission:authenticated,service_role',
    'public.current_user_has_role:authenticated,service_role', 'public.current_user_is_admin_or_owner:authenticated,service_role',
    'public.current_user_tenant_ids:authenticated,service_role',
    'public.consume_invitation:authenticated,service_role', 'public.create_clinic_with_owner:authenticated,service_role',
    'public.consume_reschedule_token:anon,authenticated,service_role',
    'public.get_reschedule_context:anon,authenticated,service_role',
    'public.resolve_share_token:anon,authenticated,service_role', 'public.readiness_probe:anon',
    'public.ops_ingest_error:anon,authenticated',
    'public.claim_jobs:service_role', 'public.complete_job:service_role', 'public.defer_job:service_role',
    'public.fail_job:service_role', 'public.release_job:service_role', 'public.start_job:service_role',
    'public.jobs_runner_begin:service_role', 'public.jobs_runner_end:service_role',
    'public.communication_queue_apply_dlr:service_role', 'public.communication_queue_claim:service_role',
    'public.communication_queue_dead_letter:service_role', 'public.communication_queue_finish:service_role',
    'public.communication_queue_scrub_payload:service_role', 'public.create_reschedule_token:service_role',
    'public.reschedule_token_visit:service_role', 'public.enqueue_message_system:service_role',
    'public.enqueue_unmatched_reply_system:service_role', 'public.enqueue_webhook_event_system:service_role',
    'public.get_tenant_table_rls_policies:service_role', 'public.inbound_webhook_begin:service_role',
    'public.inbound_webhook_finish:service_role', 'public.ops_alert_notified:service_role',
    'public.ops_alert_payload:service_role', 'public.share_resource_tenant:service_role',
    'public.share_token_object:service_role', 'public.share_token_resource:service_role',
    'public.webhook_delivery_claim:service_role', 'public.webhook_delivery_finish:service_role',
    'private.log_system_audit:service_role',
    'private.enqueue_message_internal:', 'private.enqueue_webhook_internal:', 'private.message_subject:',
    'private.webhook_event_subject:', 'private.visits_create_clinical_notes:'
  ]::text[],
  'every definer function has exactly its expected EXECUTE grantees (anon only for the token, probe and ingest paths)'
);
select is_empty(
  $$ select fn from c2c_definer where class in ('system', 'internal')
      and (has_function_privilege('authenticated', (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                                     where n.nspname || '.' || p.proname = fn), 'EXECUTE')
        or has_function_privilege('anon', (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                            where n.nspname || '.' || p.proname = fn), 'EXECUTE')) $$,
  'no service_role-only or internal definer function is executable by anon or authenticated'
);

-- 3. ------------------------------------------------------------------------------------------------------------------
select is_empty(
  $$ select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname in ('public', 'private', 'authz', 'ops')
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c
           where c = 'search_path=""' or (c like 'search_path=%' and c ~ 'pg_temp$')
        ) $$,
  'every SECURITY DEFINER function in public, private, authz and ops pins search_path ('''' or ending in pg_temp)'
);

-- 4. ------------------------------------------------------------------------------------------------------------------
select is_empty(
  $$ select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private', 'authz', 'ops')
        and p.prosrc ~ '(current_user_tenant_ids|current_user_has_role|current_user_is_admin_or_owner)\s*\(' $$,
  'no function calls a legacy "any membership" helper'
);

-- 5. Dual-member legs: acting in A on a clinic-B subject is refused; acting in B the same call is allowed --------------
select alike(pg_temp.as_user('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000a',
  format('select public.change_member_role(%L, %L)', (select id from public.memberships where user_id = 'c2c00000-0000-4000-8000-000000000202' and tenant_id = 'c2c00000-0000-4000-8000-00000000000b'), 'nurse')),
  'error:P0002:not_found%', 'change_member_role: acting in A on a B member is refused (before: owner of B, admitted)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000b',
  format('select public.change_member_role(%L, %L)', (select id from public.memberships where user_id = 'c2c00000-0000-4000-8000-000000000202' and tenant_id = 'c2c00000-0000-4000-8000-00000000000b'), 'nurse')),
  '1', 'change_member_role: acting in B as its owner is allowed');
select alike(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select * from public.create_share_token('invoice', 'c2c00000-0000-4000-8000-000000002005')$$),
  'error:P0002:not_found%', 'create_share_token: acting in A, a link to B''s receipt is refused (05-01b wave note)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select * from public.create_share_token('invoice', 'c2c00000-0000-4000-8000-000000002005')$$),
  '1', 'create_share_token: acting in B (receptionist) the receipt link is minted');
select alike(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select public.revoke_share_token('c2c00000-0000-4000-8000-000000004001')$$),
  'error:P0002:not_found%', 'revoke_share_token: acting in A, B''s token is refused');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select public.revoke_share_token('c2c00000-0000-4000-8000-000000004001')$$),
  '1', 'revoke_share_token: acting in B the token is revoked');
select alike(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000a',
  $$select public.enqueue_message('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000002001', null, 'whatsapp', 'appointment_booked', 'appointment_booked',
      '{"patient_name": "Synthetic"}'::jsonb, '+919000000702', null, null)$$),
  'error:P0002:SUBJECT_MISMATCH%', 'enqueue_message: acting in A for clinic B is refused');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b',
  $$select public.enqueue_message('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000002001', null, 'whatsapp', 'appointment_booked', 'appointment_booked',
      '{"patient_name": "Synthetic"}'::jsonb, '+919000000702', null, null)$$),
  '1', 'enqueue_message: acting in B the message is queued');
select alike(pg_temp.as_user('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000a', $$select public.enqueue_webhook_event('c2c00000-0000-4000-8000-00000000000b', 'ping', 'c2c00000-0000-4000-8000-000000002008', 'c2c00000-0000-4000-8000-000000002008')$$),
  'error:P0002:SUBJECT_MISMATCH%', 'enqueue_webhook_event: acting in A for clinic B is refused');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000b', $$select public.enqueue_webhook_event('c2c00000-0000-4000-8000-00000000000b', 'ping', 'c2c00000-0000-4000-8000-000000002008', 'c2c00000-0000-4000-8000-000000002008')$$),
  '1', 'enqueue_webhook_event: acting in B as its owner the ping is queued');
select alike(pg_temp.as_user('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000a',
  $$select set_config('clinicos.record_payment_id', 'c2c00000-0000-4000-8000-000000009999', true), private.outbox_payment_recorded('c2c00000-0000-4000-8000-000000009999')$$),
  'error:P0001:OUTBOX_SUBJECT_INVALID%', 'outbox_payment_recorded: acting in A for B''s payment is refused');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000b',
  $$select set_config('clinicos.record_payment_id', 'c2c00000-0000-4000-8000-000000009999', true), private.outbox_payment_recorded('c2c00000-0000-4000-8000-000000009999')$$),
  '1', 'outbox_payment_recorded: acting in B it runs');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000a', $$select * from public.referral_source_clinics(array['c2c00000-0000-4000-8000-00000000000a']::uuid[])$$),
  '0', 'referral_source_clinics: acting in A, clinic A is not a source of A''s incoming referrals');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', $$select * from public.referral_source_clinics(array['c2c00000-0000-4000-8000-00000000000a']::uuid[])$$),
  '1', 'referral_source_clinics: acting in B (the target), A is listed');
select alike(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000a', $$select public.generate_daily_queue_token('c2c00000-0000-4000-8000-00000000000b', '2030-01-01')$$),
  'denied:forbidden', 'generate_daily_queue_token: acting in A for B is refused');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', $$select public.generate_daily_queue_token('c2c00000-0000-4000-8000-00000000000b', '2030-01-01')$$),
  '1', 'generate_daily_queue_token: acting in B it answers');
select alike(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000a', $$select * from public.search_medicines('para', 'c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', 1)$$),
  'denied:forbidden', 'search_medicines: acting in A in B''s catalogue is refused');
select matches(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', $$select * from public.search_medicines('para', 'c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', 1)$$),
  '^[0-9]+$', 'search_medicines: acting in B it answers');
select alike(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000a', $$select public.generate_tenant_invoice_number('c2c00000-0000-4000-8000-00000000000b')$$),
  'denied:%', 'generate_tenant_invoice_number: acting in A for B is refused');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', $$select public.generate_tenant_invoice_number('c2c00000-0000-4000-8000-00000000000b')$$),
  '1', 'generate_tenant_invoice_number: acting in B it answers');
select alike(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000a', $$select public.log_audit('c2c00000-0000-4000-8000-00000000000b', 'c2c.probe', 'synthetic', null, null)$$),
  'denied:ACTOR_INVALID', 'log_audit: acting in A for B is refused');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', $$select public.log_audit('c2c00000-0000-4000-8000-00000000000b', 'c2c.probe', 'synthetic', null, null)$$),
  '1', 'log_audit: acting in B it writes');
select is(pg_temp.val_as('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000a', $$select public.has_permission('c2c00000-0000-4000-8000-00000000000b', 'patients:view')::text$$),
  'false', 'has_permission: acting in A, nothing in B');
select is(pg_temp.val_as('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', $$select public.has_permission('c2c00000-0000-4000-8000-00000000000b', 'patients:view')::text$$),
  'true', 'has_permission: acting in B, granted');
select is(pg_temp.val_as('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000a', $$select public.current_user_has_role('c2c00000-0000-4000-8000-00000000000b', array['doctor'])::text$$),
  'false', 'current_user_has_role: acting in A, no role in B (before: true, any membership)');
select is(pg_temp.val_as('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', $$select public.current_user_has_role('c2c00000-0000-4000-8000-00000000000b', array['doctor'])::text$$),
  'true', 'current_user_has_role: acting in B, the B role');
select is(pg_temp.val_as('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000a', $$select public.current_user_is_admin_or_owner('c2c00000-0000-4000-8000-00000000000b')::text$$),
  'false', 'current_user_is_admin_or_owner: acting in A, not B''s owner (before: true)');
select is(pg_temp.val_as('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000b', $$select public.current_user_is_admin_or_owner('c2c00000-0000-4000-8000-00000000000b')::text$$),
  'true', 'current_user_is_admin_or_owner: acting in B, B''s owner');
select is(pg_temp.val_as('c2c00000-0000-4000-8000-000000000302', null, $$select count(*)::text from public.current_user_tenant_ids()$$),
  '2', 'current_user_tenant_ids stays the member helper: every clinic of the caller (the switcher)');

select * from finish();
rollback;
