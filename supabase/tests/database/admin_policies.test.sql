-- admin_policies.test.sql — V2-05 plan 05-02c (P1-01, SVP §6.1; R-40, R-42; threats T-05-11, T-05-39). Hand-written
-- cases next to the generated matrix for the admin/system tables of 000057, where a one-row matrix cell cannot say
-- enough:
--   1. catalogue: the exact S/I/U policy set of the admin/system tables, all TO authenticated, none on a legacy helper;
--   2. in_app_notifications: a notice addressed to a user is theirs alone; an unaddressed notice reaches its role (or
--      everyone), owners/admins also the admin/owner/receptionist notices (the rule the service applies), only in the
--      active clinic (before: every member read every colleague's notices);
--   3. invitations: staff:invite in the active clinic; owner/admin invitations only by an owner;
--   4. document_share_tokens: rows by resource type (prescription / invoice / referral / patient document);
--   5. memberships and tenants: the clinic switcher (own rows and every clinic of the caller) vs the active clinic's
--      staff; profile updates only in the active clinic.
-- Synthetic data only; every probe and the file roll back.
begin;
select plan(32);

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

-- Fixtures ----------------------------------------------------------------------------------------------------------
insert into public.in_app_notifications (id, tenant_id, recipient_user_id, recipient_role, category, event_type, title, message) values
  ('c2c00000-0000-4000-8000-000000003001', 'c2c00000-0000-4000-8000-00000000000a', 'c2c00000-0000-4000-8000-000000000103', null, 'system', 'c2c', 'Synthetic', 'Synthetic'),       -- addressed to the doctor
  ('c2c00000-0000-4000-8000-000000004001', 'c2c00000-0000-4000-8000-00000000000a', null, 'receptionist', 'system', 'c2c', 'Synthetic', 'Synthetic'), -- role notice: reception
  ('c2c00000-0000-4000-8000-000000003002', 'c2c00000-0000-4000-8000-00000000000a', null, null, 'system', 'c2c', 'Synthetic', 'Synthetic'),         -- broadcast
  ('c2c00000-0000-4000-8000-000000002008', 'c2c00000-0000-4000-8000-00000000000a', null, 'nurse', 'system', 'c2c', 'Synthetic', 'Synthetic');      -- role notice: nurses
insert into public.document_share_tokens (tenant_id, resource_type, resource_id, token_hash, created_by) values
  ('c2c00000-0000-4000-8000-00000000000a', 'prescription', 'c2c00000-0000-4000-8000-000000001002', repeat('1', 64), 'c2c00000-0000-4000-8000-000000000101'),
  ('c2c00000-0000-4000-8000-00000000000a', 'invoice', 'c2c00000-0000-4000-8000-000000001005', repeat('2', 64), 'c2c00000-0000-4000-8000-000000000101'),
  ('c2c00000-0000-4000-8000-00000000000a', 'referral', 'c2c00000-0000-4000-8000-000000001008', repeat('3', 64), 'c2c00000-0000-4000-8000-000000000101'),
  ('c2c00000-0000-4000-8000-00000000000a', 'patient_document', 'c2c00000-0000-4000-8000-000000009999', repeat('4', 64), 'c2c00000-0000-4000-8000-000000000101');

-- 1. Catalogue ------------------------------------------------------------------------------------------------------
select set_eq(
  $$ select tablename::text || '.' || policyname::text from pg_policies
      where schemaname = 'public' and cmd <> 'DELETE'
        and tablename in ('tenants', 'memberships', 'invitations', 'api_keys', 'api_key_usage_daily',
                          'webhook_subscriptions', 'webhook_delivery_queue', 'tenant_messaging_config',
                          'in_app_notifications', 'document_share_tokens', 'patient_documents', 'audit_logs',
                          'subscriptions', 'payment_records') $$,
  array[
    'tenants.tenants_select', 'tenants.tenants_update',
    'memberships.memberships_select', 'memberships.memberships_update',
    'invitations.invitations_select', 'invitations.invitations_insert',
    'api_keys.api_keys_select', 'api_keys.api_keys_insert', 'api_keys.api_keys_update',
    'api_key_usage_daily.api_key_usage_daily_select', 'api_key_usage_daily.api_key_usage_daily_insert',
    'api_key_usage_daily.api_key_usage_daily_update',
    'webhook_subscriptions.webhook_subscriptions_select', 'webhook_subscriptions.webhook_subscriptions_insert',
    'webhook_subscriptions.webhook_subscriptions_update',
    'webhook_delivery_queue.webhook_delivery_queue_select',
    'tenant_messaging_config.tenant_messaging_config_select', 'tenant_messaging_config.tenant_messaging_config_insert',
    'tenant_messaging_config.tenant_messaging_config_update',
    'in_app_notifications.in_app_notifications_select', 'in_app_notifications.in_app_notifications_update',
    'document_share_tokens.document_share_tokens_select',
    'patient_documents.patient_documents_select', 'patient_documents.patient_documents_insert',
    'patient_documents.patient_documents_update',
    'audit_logs.audit_logs_select',
    'subscriptions.subscriptions_select', 'payment_records.payment_records_select'
  ]::text[],
  'the admin/system tables have exactly the S/I/U policies of 000057/000060'
);
select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
      where schemaname = 'public'
        and (roles <> array['authenticated']::name[] or cmd = 'ALL'
             or coalesce(qual, '') || coalesce(with_check, '') ~ 'current_user_tenant_ids|current_user_has_role|current_user_is_admin_or_owner') $$,
  'every public policy is TO authenticated, none is FOR ALL, none calls a legacy helper'
);

-- 2. in_app_notifications (T-05-11) ---------------------------------------------------------------------------------
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000103', null, $$select 1 from public.in_app_notifications where tenant_id = 'c2c00000-0000-4000-8000-00000000000a'$$),
  '2', 'doctor: their own notice and the broadcast');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000104', null, $$select 1 from public.in_app_notifications where id = 'c2c00000-0000-4000-8000-000000003001'$$),
  '0', 'a second doctor cannot read a notice addressed to a colleague (before: any member could)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000106', null, $$select 1 from public.in_app_notifications where tenant_id = 'c2c00000-0000-4000-8000-00000000000a'$$),
  '2', 'receptionist: the reception notice and the broadcast');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000105', null, $$select 1 from public.in_app_notifications where tenant_id = 'c2c00000-0000-4000-8000-00000000000a'$$),
  '2', 'nurse: the nurses'' notice and the broadcast');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000102', null, $$select 1 from public.in_app_notifications where tenant_id = 'c2c00000-0000-4000-8000-00000000000a'$$),
  '2', 'admin: the reception notice and the broadcast (the service''s owner/admin rule), not the doctor''s or nurses''');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000101', null, $$select 1 from public.in_app_notifications where id = 'c2c00000-0000-4000-8000-000000003001'$$),
  '0', 'even the owner cannot read a notice addressed to the doctor');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000104', null, $$update public.in_app_notifications set is_read = true where id = 'c2c00000-0000-4000-8000-000000003001'$$),
  '0', 'a colleague cannot mark someone else''s notice read');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000106', null, $$update public.in_app_notifications set is_read = true where id = 'c2c00000-0000-4000-8000-000000004001'$$),
  '1', 'a receptionist marks the reception notice read');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select 1 from public.in_app_notifications where tenant_id = 'c2c00000-0000-4000-8000-00000000000a'$$),
  '0', 'a dual member acting in B reads none of A''s notices, not even the broadcast');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000101', null,
  $$insert into public.in_app_notifications (tenant_id, recipient_user_id, category, event_type, title, message)
    values ('c2c00000-0000-4000-8000-00000000000a', 'c2c00000-0000-4000-8000-000000000103', 'system', 'c2c', 'Synthetic', 'Synthetic')$$),
  'denied:permission denied for table in_app_notifications', 'no user-client writer: INSERT is revoked');

-- 3. invitations ----------------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000102', null,
  $$insert into public.invitations (tenant_id, role, invited_address, token_hash, expires_at, created_by)
    values ('c2c00000-0000-4000-8000-00000000000a', 'doctor', 'c2c-invitee-1@example.test', repeat('5', 64), now() + interval '1 day', 'c2c00000-0000-4000-8000-000000000102')$$),
  '1', 'an admin invites a doctor (staff:invite)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000102', null,
  $$insert into public.invitations (tenant_id, role, invited_address, token_hash, expires_at, created_by)
    values ('c2c00000-0000-4000-8000-00000000000a', 'admin', 'c2c-invitee-2@example.test', repeat('6', 64), now() + interval '1 day', 'c2c00000-0000-4000-8000-000000000102')$$),
  'denied:new row violates row-level security policy for table "invitations"', 'an admin cannot invite an admin (owner only)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000101', null,
  $$insert into public.invitations (tenant_id, role, invited_address, token_hash, expires_at, created_by)
    values ('c2c00000-0000-4000-8000-00000000000a', 'admin', 'c2c-invitee-3@example.test', repeat('7', 64), now() + interval '1 day', 'c2c00000-0000-4000-8000-000000000101')$$),
  '1', 'the owner invites an admin');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000106', null,
  $$insert into public.invitations (tenant_id, role, invited_address, token_hash, expires_at, created_by)
    values ('c2c00000-0000-4000-8000-00000000000a', 'nurse', 'c2c-invitee-4@example.test', repeat('8', 64), now() + interval '1 day', 'c2c00000-0000-4000-8000-000000000106')$$),
  'denied:new row violates row-level security policy for table "invitations"', 'a receptionist cannot invite');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000a',
  $$insert into public.invitations (tenant_id, role, invited_address, token_hash, expires_at, created_by)
    values ('c2c00000-0000-4000-8000-00000000000b', 'admin', 'c2c-invitee-5@example.test', repeat('9', 64), now() + interval '1 day', 'c2c00000-0000-4000-8000-000000000303')$$),
  'denied:new row violates row-level security policy for table "invitations"', 'B''s owner acting in A cannot invite into B');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000b',
  $$insert into public.invitations (tenant_id, role, invited_address, token_hash, expires_at, created_by)
    values ('c2c00000-0000-4000-8000-00000000000b', 'admin', 'c2c-invitee-6@example.test', repeat('a', 64), now() + interval '1 day', 'c2c00000-0000-4000-8000-000000000303')$$),
  '1', 'the same owner acting in B invites an admin into B');

-- 4. document_share_tokens by type ------------------------------------------------------------------------------------
select is(pg_temp.val_as('c2c00000-0000-4000-8000-000000000106', null, $$select string_agg(resource_type, ',' order by resource_type) from public.document_share_tokens where tenant_id = 'c2c00000-0000-4000-8000-00000000000a'$$),
  'invoice', 'receptionist: invoice links only (billing:view)');
select is(pg_temp.val_as('c2c00000-0000-4000-8000-000000000105', null, $$select string_agg(resource_type, ',' order by resource_type) from public.document_share_tokens where tenant_id = 'c2c00000-0000-4000-8000-00000000000a'$$),
  'patient_document,referral', 'nurse: lab and referral links (labs:view, consultations:view)');
select is(pg_temp.val_as('c2c00000-0000-4000-8000-000000000103', null, $$select string_agg(resource_type, ',' order by resource_type) from public.document_share_tokens where tenant_id = 'c2c00000-0000-4000-8000-00000000000a'$$),
  'patient_document,prescription,referral', 'doctor: prescription, referral and lab links, no invoice link (no billing:view)');
select is(pg_temp.val_as('c2c00000-0000-4000-8000-000000000102', null, $$select string_agg(resource_type, ',' order by resource_type) from public.document_share_tokens where tenant_id = 'c2c00000-0000-4000-8000-00000000000a'$$),
  'invoice', 'admin: invoice links only');
select is(pg_temp.val_as('c2c00000-0000-4000-8000-000000000101', null, $$select count(*)::text from public.document_share_tokens where tenant_id = 'c2c00000-0000-4000-8000-00000000000a'$$),
  '4', 'owner: every link');

-- 5. memberships and tenants ------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000106', null, $$select 1 from public.memberships where tenant_id = 'c2c00000-0000-4000-8000-00000000000a'$$),
  '9', 'every role reads the active clinic''s staff (staff:view)');
select is(pg_temp.val_as('c2c00000-0000-4000-8000-000000000302', null, $$select string_agg(tenant_id::text, ',' order by tenant_id) from public.memberships$$),
  'c2c00000-0000-4000-8000-00000000000a,c2c00000-0000-4000-8000-00000000000b', 'a member of two clinics with no active clinic reads only their own two membership rows');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', null, $$select 1 from public.tenants where id in ('c2c00000-0000-4000-8000-00000000000a', 'c2c00000-0000-4000-8000-00000000000b')$$),
  '2', 'and both clinics in the switcher');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000a', $$select 1 from public.memberships where tenant_id = 'c2c00000-0000-4000-8000-00000000000b'$$),
  '1', 'acting in A: of clinic B only their own row');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000a', $$update public.memberships set full_name = 'Synthetic' where user_id = 'c2c00000-0000-4000-8000-000000000202' and tenant_id = 'c2c00000-0000-4000-8000-00000000000b'$$),
  '0', 'B''s owner acting in A cannot edit a B member''s profile');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000b', $$update public.memberships set full_name = 'Synthetic' where user_id = 'c2c00000-0000-4000-8000-000000000202' and tenant_id = 'c2c00000-0000-4000-8000-00000000000b'$$),
  '1', 'acting in B they can');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000a', $$update public.memberships set full_name = 'Synthetic' where user_id = 'c2c00000-0000-4000-8000-000000000302' and tenant_id = 'c2c00000-0000-4000-8000-00000000000b'$$),
  '0', 'own profile rows are edited only in the active clinic');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000102', null, $$update public.tenants set name = name where id = 'c2c00000-0000-4000-8000-00000000000a'$$),
  '1', 'an admin updates the clinic (clinic:manage)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000103', null, $$update public.tenants set name = name where id = 'c2c00000-0000-4000-8000-00000000000a'$$),
  '0', 'a doctor cannot update the clinic');

select * from finish();
rollback;
