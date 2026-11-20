-- definer_functions.test.sql — V2-05 plan 05-02c (P1-01; R-13, R-42; threats T-05-14, T-05-39; V2-03 03-07 finding 2).
-- The SECURITY DEFINER catalogue of `public` and `private`, every function classified (a new definer function without
-- a row here fails the set_eq), and the active-clinic sweep of 000061 proven per user-authorised function:
--   1. classification: user-authorised (bound to the active clinic, with a dual-member leg below), the member helper,
--      token-scoped / onboarding / anon-system exemptions, service_role-only, and internal (no API grant);
--   2. the exact EXECUTE grantees of every definer function in public and private (anon only where listed);
--   3. every SECURITY DEFINER function in the app schemas has a pinned search_path ('' or ending in pg_temp);
--   4. no definer function calls a legacy "any membership" helper (05-b0 dropped `current_user_has_role`,
--      `current_user_is_admin_or_owner` and `generate_daily_queue_token`, with their rows and legs here; 000079);
--   5. dual-member legs: a user who belongs to clinics A and B, acting in A (x-clinicos-tenant header) on a clinic-B
--      subject, is refused; the same call acting in B is allowed;
--   6. access-level legs (05-10a, SUB-02, research Pitfall 9): every user-reachable and service-role definer function is
--      classified by how it treats a clinic whose access level is not `full` (the list equals the catalogue), and each
--      one that reads tenant data refuses clinic B once B is locked, while the level-neutral ones keep working.
-- Synthetic data only; every probe and the file roll back.
begin;
select plan(95);

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
-- Clinic B is listed in the referral directory (05-06): it is the in-network target of the referral fixture.
insert into public.tenants (id, name, referral_directory_listed) values
  ('c2c00000-0000-4000-8000-00000000000a', 'Synthetic 05-02c Clinic A', false),
  ('c2c00000-0000-4000-8000-00000000000b', 'Synthetic 05-02c Clinic B', true);
-- V2-05 05-09c (R-25, acceptance 11 preparation): this file's clinics are trialing on the Standard price, so they keep
-- full access once the RLS helpers read the access level (05-10a). Clinics created in this transaction only.
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in (select t.id from public.tenants t where t.created_at = now()) and s.status = 'incomplete';
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
insert into public.invitations (id, tenant_id, role, invited_address, expires_at, created_by) values
  ('c2c00000-0000-4000-8000-000000004101', 'c2c00000-0000-4000-8000-00000000000b', 'nurse', 'c2c-pending-b@example.test', now() + interval '1 day', 'c2c00000-0000-4000-8000-000000000201');
insert into public.payments (id, tenant_id, invoice_id, amount, payment_method, recorded_by) values
  ('c2c00000-0000-4000-8000-000000009999', 'c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000002005', 100, 'cash', 'c2c00000-0000-4000-8000-000000000201');

-- 05-10a: a reschedule (appointment) token of clinic B with a known raw value, for the access-level legs.
insert into public.document_share_tokens (id, tenant_id, resource_type, resource_id, token_hash, created_by) values
  ('c2c00000-0000-4000-8000-000000004002', 'c2c00000-0000-4000-8000-00000000000b', 'appointment', 'c2c00000-0000-4000-8000-000000002002',
   public.share_token_hash('c2c-synthetic-reschedule-token-for-clinic-b-0001'), 'c2c00000-0000-4000-8000-000000000201'),
  ('c2c00000-0000-4000-8000-000000004003', 'c2c00000-0000-4000-8000-00000000000b', 'invoice', 'c2c00000-0000-4000-8000-000000002005',
   public.share_token_hash('c2c-synthetic-invoice-token-for-clinic-b-00001'), 'c2c00000-0000-4000-8000-000000000201');

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
  ('public.issue_queue_token', 'bound', 'visit''s clinic = active clinic with appointments:edit (000068, 05-11a; replaced next_queue_token)'),
  ('public.generate_tenant_invoice_number', 'bound', 'billing:collect or consultations:edit, active clinic (000056)'),
  ('public.search_medicines', 'bound', 'the active clinic (000061)'),
  ('public.log_audit', 'bound', 'p_tenant = active clinic (000060); action and metadata allow-lists (000074, 05-11b)'),
  ('public.record_payment', 'bound', 'p_tenant_id = active clinic with billing:collect; system path = service role + closed actor (000072, 05-11b)'),
  ('public.create_invoice', 'bound', 'p_tenant_id = active clinic; billing:collect, or consultations:edit on the visit''s own doctor; the visit is looked up in that clinic only (000096, 07-02, R-1)'),
  ('public.collect_payment', 'bound', 'p_tenant_id = active clinic with billing:collect; the visit is looked up in that clinic only (000096, 07-02, R-7)'),
  ('public.sign_consultation', 'bound', 'p_tenant_id = active clinic with consultations:edit; the visit is looked up in that clinic only (000097, 07-01, R-1)'),
  ('public.reopen_visit_for_amendment', 'bound', 'p_tenant_id = active clinic with consultations:edit; the visit is looked up in that clinic only (000097, 07-01, R-1)'),
  ('public.finalize_visit_amendment', 'bound', 'p_tenant_id = active clinic with consultations:edit; the visit is looked up in that clinic only (000097, 07-01, R-1)'),
  ('public.check_in_visit', 'bound', 'p_tenant_id = active clinic with appointments:edit; the visit is looked up in that clinic only (000097, 07-01, R-1)'),
  ('public.start_consultation', 'bound', 'p_tenant_id = active clinic with consultations:edit and appointments:edit; the visit is looked up in that clinic only (000100, 08-01b, R-1)'),
  ('public.complete_visit', 'bound', 'p_tenant_id = active clinic with appointments:edit; the visit is looked up in that clinic only (000100, 08-01b)'),
  ('public.register_patient', 'bound', 'p_tenant_id = active clinic with patients:edit; the patient is inserted in that clinic only (000101, 08-02, R-12)'),
  ('public.enqueue_walk_in', 'bound', 'p_tenant_id = active clinic with appointments:edit (+ patients:edit for a new patient); patient and doctor are looked up in that clinic only (000098, 07-03, R-1)'),
  ('public.register_and_book', 'bound', 'p_tenant_id = active clinic with appointments:edit (+ patients:edit for a new patient); patient and doctor are looked up in that clinic only (000098, 07-03, R-1)'),
  ('public.complete_and_bill', 'bound', 'p_tenant_id = active clinic with consultations:edit (+ billing:collect with a payment); the visit is looked up in that clinic only (000098, 07-03, R-1, R-7)'),
  ('public.has_permission', 'bound', 'authz.tenant_ids_with: the active clinic (000046)'),
  ('private.command_claim', 'internal', 'idempotent command claim: user path p_tenant_id = the active, full clinic, system path = service role + a system actor; called only by the definer commands, no API grant since 000099 (07-00, R-2; 07-04a F-4)'),
  ('private.command_complete', 'internal', 'completes only the claim the caller''s own transaction made; called only by the definer commands, no API grant since 000099 (07-00, R-2; 07-04a F-4)'),
  ('private.command_request_hash', 'internal', 'the keyed request digest of a command (HMAC-SHA256 with the key in private.command_hash_key); called by the definer commands, no API grant (000099, 07-04a, G-8)'),
  ('private.log_command_audit', 'internal', 'the audit writer for the five actions only a command writes (log_audit refuses them); called by the definer steps, no API grant (000099, 07-04a, F-1)'),
  ('public.referral_directory_search', 'bound', 'consultations:edit in the active clinic; never the active clinic itself (000062, 05-06)'),
  ('public.remove_member', 'bound', 'target membership''s clinic = active clinic; staff:invite, owner-only for owner/admin targets (000087, 05-05); a locked/onboarding clinic only by its owner (000092, 05-12)'),
  ('public.invite_staff', 'bound', 'p_tenant in tenant_ids_with(staff:invite): the active clinic; owner/admin invitations by owners (000088, 05-07a)'),
  ('public.resend_invitation', 'bound', 'invitation''s clinic = active clinic with staff:invite (000088, 05-07a)'),
  ('public.revoke_invitation', 'bound', 'invitation''s clinic = active clinic with staff:invite (000088, 05-07a)'),
  ('public.ai_preflight', 'bound', 'visit''s clinic = active clinic, consultations:edit there; the AI gate (000091, 05-10c)'),
  ('public.ai_reserve', 'bound', 'visit''s clinic = active clinic, consultations:edit there; the AI gate + quota lock (000091, 05-10c)'),
  ('public.ai_commit', 'bound', 'the caller''s own reservation in the active clinic, consultations:edit there (000091, 05-10c); system path = service-role session (000092, 05-12)'),
  ('public.ai_release', 'bound', 'the caller''s own reservation in the active clinic, consultations:edit there (000091, 05-10c); system path = service-role session (000092, 05-12)'),
  ('public.set_ai_opt_in', 'bound', 'owner of the active, full clinic (000091, 05-10c, R-33)'),
  -- the member helper
  ('public.current_user_tenant_ids', 'member', 'every clinic of the caller (switcher); no policy or function uses it'),
  ('public.my_tenant_access', 'member', 'SUB §6.2 wrapper: the access level of one of the caller''s own clinics, else null (000083, 05-09a)'),
  ('public.my_entitlements', 'member', 'SUB §6.2 wrapper: entitlements of one of the caller''s own clinics, else no rows (000083, 05-09a)'),
  -- exempt: authorised by something other than a clinic membership
  ('public.consume_invitation', 'exempt', 'invitation token bound to the caller''s confirmed address (000071, 000088)'),
  ('public.peek_invitation', 'exempt', 'anon /join preview by token hash: status, clinic, role, masked address (000088, 05-07a)'),
  ('public.create_clinic_with_owner', 'exempt', 'onboarding: creates the clinic and the caller''s first membership'),
  ('public.consume_reschedule_token', 'exempt', 'anon, patient reschedule token'),
  ('public.get_reschedule_context', 'exempt', 'anon, patient reschedule token'),
  ('public.resolve_share_token', 'exempt', 'anon, share-link token'),
  ('public.readiness_probe', 'exempt', 'anon readiness probe: booleans only'),
  ('public.ops_ingest_error', 'exempt', 'error ingest: ingest key, no tenant data returned'),
  ('public.is_platform_admin', 'exempt', 'platform admin: own platform_admins row + aal2, not a clinic role (000085, 05-09b)'),
  ('public.session_is_live', 'exempt', 'the caller''s own JWT session only, no tenant data (000087, 05-05)'),
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
  ('public.invitation_issue_token', 'system', 'email.invite handler: mints the token at send time (000088, 05-07a, R-30)'),
  ('public.consume_invitation_for', 'system', 'invite acceptance system path, address-bound (000088, 05-07a)'),
  ('public.invitation_accept_context', 'system', 'invite acceptance system path: the invited address and its account (000089, 05-07b, R-44)'),
  ('private.invitation_audit', 'internal', 'audit writer behind the invitation RPCs (000088, 05-07a)'),
  -- internal: no API role may execute them (called by the definer wrappers or as triggers)
  ('private.enqueue_message_internal', 'internal', 'writer behind the bound enqueue RPCs'),
  ('private.enqueue_webhook_internal', 'internal', 'writer behind the bound enqueue RPCs'),
  ('private.message_subject', 'internal', 'subject lookup for the enqueue RPCs'),
  ('private.webhook_event_subject', 'internal', 'subject lookup for the enqueue RPCs'),
  ('private.visits_create_clinical_notes', 'internal', 'trigger (05-02a)'),
  ('private.referrals_directory_consent_guard', 'internal', 'trigger: referral target listed + consent (05-06); actor, target doctor, consent coverage (000074, 05-11b)'),
  ('private.invoice_items_sync_invoice', 'internal', 'trigger: invoice totals and status follow its items (000072, 05-11b); never promotes to paid (000075, 05-11d)'),
  ('private.invoice_items_integrity_guard', 'internal', 'trigger: computed line total, keys, paid/collected locks (000075, 05-11d)'),
  ('private.visit_revisions_actor_guard', 'internal', 'trigger: amendment author, database snapshot and number (000068/000075, 05-11a/05-11d)'),
  ('private.step_create_invoice', 'internal', 'step: the visit''s live invoice or a new one; called by create_invoice and collect_payment after their guard block, no API grant (000096, 07-02)'),
  ('private.step_sign_consultation', 'internal', 'step: the sign-off body (visit, prescriptions, audit, outbox); called by sign_consultation after its guard block, no API grant (000097, 07-01)'),
  ('private.step_check_in', 'internal', 'step: the check-in body (token, waiting status, audit); called by check_in_visit after its guard block, no API grant (000097, 07-01)'),
  ('private.visits_status_transition_guard', 'internal', 'trigger: refuses a visits.status change the state machine does not list; definer because it calls the private transition function (000100, 08-01b, R-7)'),
  ('private.today_signal', 'internal', 'trigger: sends the PHI-free Today signal {kind, visit_id} after a visits, queue_tokens, payments or clinical_notes (vitals) write; swallows every Realtime error (000102, 08-03a, R-10)'),
  ('private.today_signal_send', 'internal', 'step: the one caller of realtime.send for the Today signals; called by private.today_signal, no API grant (000102, 08-03a, R-10)'),
  ('private.step_create_patient', 'internal', 'step: the patient insert (validated input, created_by = the session user, audit); called by enqueue_walk_in and register_and_book after their guard block, no API grant (000098, 07-03)'),
  ('private.step_create_visit', 'internal', 'step: the visit insert (patient and doctor in the clinic, audit); called by enqueue_walk_in and register_and_book after their guard block, no API grant (000098, 07-03)'),
  ('private.step_enqueue_booking_message', 'internal', 'step: the appointment_booked message in the booking transaction, with the validation public.enqueue_message applies; called by register_and_book after its guard block, no API grant (000098, 07-03)'),
  ('private.step_record_payment', 'internal', 'step: the payment body shared by record_payment and collect_payment after their guard block, no API grant (000096, 07-02)'),
  ('private.tenants_create_default_location', 'internal', 'trigger: every new clinic gets its default location (000095, 07-00, R-5)'),
  ('private.fill_default_location', 'internal', 'trigger: visits, queue_tokens and invoices get the clinic''s default location when none is given (000095, 07-00, R-5)'),
  ('private.tenants_create_subscription', 'internal', 'trigger: every new clinic gets one incomplete tenant_subscriptions row (000082, 05-09a, R-24)'),
  ('private.tenants_timezone_audit', 'internal', 'trigger: every tenants.timezone change is audited (000092, 05-12, H-AITZ)'),
  ('private.patients_ai_objection_audit', 'internal', 'trigger: the AI objection is audited; cleared only by doctor/receptionist (000092, 05-12, AI L-3)');

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
    'public.referral_source_clinics:authenticated',
    'public.issue_queue_token:authenticated',
    'public.generate_tenant_invoice_number:authenticated,service_role', 'public.search_medicines:authenticated,service_role',
    'public.log_audit:authenticated', 'public.has_permission:authenticated,service_role',
    'public.current_user_tenant_ids:authenticated,service_role',
    'public.my_tenant_access:authenticated', 'public.my_entitlements:authenticated',
    'public.consume_invitation:authenticated', 'public.create_clinic_with_owner:authenticated,service_role',
    'public.consume_reschedule_token:anon,authenticated,service_role',
    'public.get_reschedule_context:anon,authenticated,service_role',
    'public.resolve_share_token:anon,authenticated,service_role', 'public.readiness_probe:anon',
    'public.ops_ingest_error:anon,authenticated', 'public.is_platform_admin:authenticated',
    'public.remove_member:authenticated', 'public.session_is_live:authenticated',
    'public.invite_staff:authenticated', 'public.resend_invitation:authenticated',
    'public.revoke_invitation:authenticated', 'public.peek_invitation:anon,authenticated',
    'public.ai_preflight:authenticated', 'public.ai_reserve:authenticated', 'public.ai_commit:authenticated,service_role',
    'public.ai_release:authenticated,service_role', 'public.set_ai_opt_in:authenticated',
    'public.invitation_issue_token:service_role', 'public.consume_invitation_for:service_role',
    'public.invitation_accept_context:service_role',
    'private.invitation_audit:',
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
    'private.webhook_event_subject:', 'private.visits_create_clinical_notes:',
    'public.referral_directory_search:authenticated', 'private.referrals_directory_consent_guard:',
    'public.record_payment:authenticated,service_role', 'private.invoice_items_sync_invoice:',
    'private.invoice_items_integrity_guard:', 'private.visit_revisions_actor_guard:',
    'private.tenants_create_subscription:', 'private.tenants_timezone_audit:', 'private.patients_ai_objection_audit:',
    'private.command_claim:', 'private.command_complete:', 'private.command_request_hash:', 'private.log_command_audit:',
    'public.create_invoice:authenticated', 'public.collect_payment:authenticated',
    'private.step_create_invoice:', 'private.step_record_payment:',
    'public.start_consultation:authenticated', 'public.complete_visit:authenticated', 'public.register_patient:authenticated', 'private.visits_status_transition_guard:', 'private.today_signal:', 'private.today_signal_send:',
    'public.sign_consultation:authenticated', 'public.reopen_visit_for_amendment:authenticated',
    'public.finalize_visit_amendment:authenticated', 'public.check_in_visit:authenticated',
    'private.step_sign_consultation:', 'private.step_check_in:',
    'public.enqueue_walk_in:authenticated', 'public.register_and_book:authenticated', 'public.complete_and_bill:authenticated',
    'private.step_create_patient:', 'private.step_create_visit:', 'private.step_enqueue_booking_message:',
    'private.tenants_create_default_location:', 'private.fill_default_location:'
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
-- command_claim / command_complete: no API grant since 000099 (07-04a F-4); their behaviour is tested through definer wrappers in
-- tests/commands/command-results.spec.ts, their grants in the set_eq above.
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000a', $$select * from public.referral_source_clinics(array['c2c00000-0000-4000-8000-00000000000a']::uuid[])$$),
  '0', 'referral_source_clinics: acting in A, clinic A is not a source of A''s incoming referrals');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', $$select * from public.referral_source_clinics(array['c2c00000-0000-4000-8000-00000000000a']::uuid[])$$),
  '1', 'referral_source_clinics: acting in B (the target), A is listed');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000a', $$select token_number from public.issue_queue_token('c2c00000-0000-4000-8000-000000002002')$$),
  'denied:forbidden', 'issue_queue_token: acting in A on clinic B''s visit is refused (05-08, 05-11a)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', $$select token_number from public.issue_queue_token('c2c00000-0000-4000-8000-000000002002')$$),
  '1', 'issue_queue_token: acting in B a token is issued (05-08, 05-11a)');
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
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', $$select public.log_audit('c2c00000-0000-4000-8000-00000000000b', 'patient.view', 'patient', null, null)$$),
  '1', 'log_audit: acting in B it writes');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select public.record_payment('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000002005', 1, 'cash', '', null)$$),
  'error:P0002:INVOICE_NOT_FOUND', 'record_payment: acting in A on clinic B''s invoice is not found (000072 definer, 05-11b)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select public.record_payment('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000002005', 1, 'cash', '', null)$$),
  '1', 'record_payment: acting in B (receptionist there, billing:collect) it records');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select public.create_invoice('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009001', '[{"description":"x","unit_price":1}]'::jsonb, 'c2c00000-0000-4000-8000-0000000c0011')$$),
  'error:P0002:VISIT_NOT_FOUND', 'create_invoice: acting in A, naming clinic B, is not found (000096, 07-02)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select public.collect_payment('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009001', '[]'::jsonb, 1, 'cash', '', '', 'c2c00000-0000-4000-8000-0000000c0012')$$),
  'error:P0002:VISIT_NOT_FOUND', 'collect_payment: acting in A, naming clinic B, is not found (000096, 07-02)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select public.sign_consultation('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009001', 'c2c00000-0000-4000-8000-0000000c0021')$$),
  'error:P0002:VISIT_NOT_FOUND', 'sign_consultation: acting in A, naming clinic B, is not found (000097, 07-01)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select public.reopen_visit_for_amendment('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009001', 'Synthetic amendment reason', 'c2c00000-0000-4000-8000-0000000c0022')$$),
  'error:P0002:VISIT_NOT_FOUND', 'reopen_visit_for_amendment: acting in A, naming clinic B, is not found (000097, 07-01)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select public.finalize_visit_amendment('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009001', 'c2c00000-0000-4000-8000-0000000c0023')$$),
  'error:P0002:VISIT_NOT_FOUND', 'finalize_visit_amendment: acting in A, naming clinic B, is not found (000097, 07-01)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select public.check_in_visit('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009001', 'normal', 'c2c00000-0000-4000-8000-0000000c0024')$$),
  'error:P0002:VISIT_NOT_FOUND', 'check_in_visit: acting in A, naming clinic B, is not found (000097, 07-01)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select public.start_consultation('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009001', 'c2c00000-0000-4000-8000-0000000c0028')$$),
  'error:P0002:VISIT_NOT_FOUND', 'start_consultation: acting in A, naming clinic B, is not found (000100, 08-01b)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select public.complete_visit('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009001', 'c2c00000-0000-4000-8000-0000000c0029')$$),
  'error:P0002:VISIT_NOT_FOUND', 'complete_visit: acting in A, naming clinic B, is not found (000100, 08-01b)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select public.register_patient('c2c00000-0000-4000-8000-00000000000b', '{"full_name":"Synthetic Elsewhere","phone":"9000000707","age":30}'::jsonb, 'c2c00000-0000-4000-8000-0000000c0040')$$),
  'error:P0002:PATIENT_NOT_FOUND', 'register_patient: acting in A, naming clinic B, is not found (000101, 08-02)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select public.enqueue_walk_in('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009002', null, 'c2c00000-0000-4000-8000-000000000301', 'normal', 'c2c00000-0000-4000-8000-0000000c0025')$$),
  'error:P0002:PATIENT_NOT_FOUND', 'enqueue_walk_in: acting in A, naming clinic B, is not found (000098, 07-03)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select public.register_and_book('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009002', null, 'c2c00000-0000-4000-8000-000000000301', now() + interval '3 days', 15, false, 'c2c00000-0000-4000-8000-0000000c0026')$$),
  'error:P0002:PATIENT_NOT_FOUND', 'register_and_book: acting in A, naming clinic B, is not found (000098, 07-03)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select public.complete_and_bill('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009001', '[]'::jsonb, 0, 0, null, 'c2c00000-0000-4000-8000-0000000c0027')$$),
  'error:P0002:VISIT_NOT_FOUND', 'complete_and_bill: acting in A, naming clinic B, is not found (000098, 07-03)');
select is(pg_temp.val_as('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000a', $$select public.has_permission('c2c00000-0000-4000-8000-00000000000b', 'patients:view')::text$$),
  'false', 'has_permission: acting in A, nothing in B');
select is(pg_temp.val_as('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', $$select public.has_permission('c2c00000-0000-4000-8000-00000000000b', 'patients:view')::text$$),
  'true', 'has_permission: acting in B, granted');
select alike(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select * from public.referral_directory_search('Synthetic 05-02c Clinic')$$),
  'denied:forbidden', 'referral_directory_search: acting in B (receptionist, no consultations:edit) is refused');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select * from public.referral_directory_search('Synthetic 05-02c Clinic')$$),
  '1', 'referral_directory_search: acting in A (doctor) the listed clinic B is found');
select alike(pg_temp.as_user('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000a',
  format('select public.remove_member(%L, %L)', (select id from public.memberships where user_id = 'c2c00000-0000-4000-8000-000000000202' and tenant_id = 'c2c00000-0000-4000-8000-00000000000b'), 'Synthetic reason')),
  'error:P0002:MEMBER_NOT_FOUND%', 'remove_member: acting in A on a B member is not found (05-05)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000b',
  format('select public.remove_member(%L, %L)', (select id from public.memberships where user_id = 'c2c00000-0000-4000-8000-000000000202' and tenant_id = 'c2c00000-0000-4000-8000-00000000000b'), 'Synthetic reason')),
  '1', 'remove_member: acting in B as its owner the B doctor is removed (05-05)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000a',
  $$select public.invite_staff('c2c00000-0000-4000-8000-00000000000b', 'c2c-invitee-b@example.test', 'admin')$$),
  'denied:STAFF_INVITE_FORBIDDEN', 'invite_staff: acting in A, inviting into B (where the caller is the owner) is refused (05-07a)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000b',
  $$select public.invite_staff('c2c00000-0000-4000-8000-00000000000b', 'c2c-invitee-b@example.test', 'admin')$$),
  '1', 'invite_staff: acting in B as its owner the invitation is created (05-07a)');
select alike(pg_temp.as_user('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000a',
  $$select public.resend_invitation('c2c00000-0000-4000-8000-000000004101')$$),
  'error:P0002:INVITATION_NOT_FOUND%', 'resend_invitation: acting in A on B''s invitation is not found (05-07a)');
select alike(pg_temp.as_user('c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000a',
  $$select public.revoke_invitation('c2c00000-0000-4000-8000-000000004101')$$),
  'error:P0002:INVITATION_NOT_FOUND%', 'revoke_invitation: acting in A on B''s invitation is not found (05-07a)');
select is(pg_temp.val_as('c2c00000-0000-4000-8000-000000000302', null, $$select count(*)::text from public.current_user_tenant_ids()$$),
  '2', 'current_user_tenant_ids stays the member helper: every clinic of the caller (the switcher)');
select is(pg_temp.val_as('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000a', $$select public.ai_preflight('ai.scribe', 'c2c00000-0000-4000-8000-000000002002')$$),
  'forbidden', 'ai_preflight: acting in A on clinic B''s visit is forbidden (05-10c)');
select is(pg_temp.val_as('c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', $$select public.ai_preflight('ai.scribe', 'c2c00000-0000-4000-8000-000000002002')$$),
  'not_opted_in', 'ai_preflight: acting in B the gate passes the clinic, access, role, kill-switch and entitlement checks (B has not opted in)');

-- 6. Access level (05-10a, SUB-02) ---------------------------------------------------------------------------------
-- How every non-internal definer function treats a clinic that is not `full`:
--   refuses  reads or writes tenant data: the caller's clinic must be full (bound helpers or the substituted check of
--            000090); a leg below proves it on clinic B, locked;
--   token    an anon token path: answers `clinic_unavailable` (000090); a leg below;
--   neutral  no tenant data (or only the caller's own access/entitlements/audit row): works at any level;
--   claim    job-runner and system paths: their jobs are cancelled at claim time for a non-full clinic (R-27) or the
--            route checks `tenant_access_for_system` first (R-28).
create temp table c2c_access(fn text primary key, handling text not null) on commit drop;
insert into c2c_access values
  ('public.change_member_role', 'refuses'), ('public.create_share_token', 'refuses'), ('public.revoke_share_token', 'refuses'),
  ('public.enqueue_message', 'refuses'), ('public.enqueue_webhook_event', 'refuses'), ('private.outbox_payment_recorded', 'refuses'),
  ('public.referral_source_clinics', 'refuses'), ('public.issue_queue_token', 'refuses'), ('public.generate_tenant_invoice_number', 'refuses'),
  ('public.search_medicines', 'refuses'), ('public.record_payment', 'refuses'), ('public.create_invoice', 'refuses'), ('public.collect_payment', 'refuses'),
  ('public.sign_consultation', 'refuses'), ('public.reopen_visit_for_amendment', 'refuses'),
  ('public.finalize_visit_amendment', 'refuses'), ('public.check_in_visit', 'refuses'),
  ('public.start_consultation', 'refuses'), ('public.complete_visit', 'refuses'), ('public.register_patient', 'refuses'),
  ('public.enqueue_walk_in', 'refuses'), ('public.register_and_book', 'refuses'), ('public.complete_and_bill', 'refuses'),
  ('public.has_permission', 'refuses'),
  ('public.referral_directory_search', 'refuses'), ('public.invite_staff', 'refuses'),
  -- 05-12 (IND L-5): the owner of a locked/onboarding clinic may still remove staff; everyone else is refused.
  ('public.remove_member', 'owner_only'),
  ('public.resend_invitation', 'refuses'), ('public.revoke_invitation', 'refuses'),
  ('public.ai_preflight', 'refuses'), ('public.ai_reserve', 'refuses'), ('public.set_ai_opt_in', 'refuses'),
  -- 05-10c: a call reserved before a lock is still metered or released (no tenant data is read).
  ('public.ai_commit', 'neutral'), ('public.ai_release', 'neutral'),
  ('public.log_audit', 'neutral'), ('public.current_user_tenant_ids', 'neutral'), ('public.my_tenant_access', 'neutral'),
  ('public.my_entitlements', 'neutral'), ('public.consume_invitation', 'neutral'), ('public.peek_invitation', 'neutral'),
  ('public.create_clinic_with_owner', 'neutral'), ('public.readiness_probe', 'neutral'), ('public.ops_ingest_error', 'neutral'),
  ('public.is_platform_admin', 'neutral'), ('public.session_is_live', 'neutral'),
  ('public.consume_reschedule_token', 'token'), ('public.get_reschedule_context', 'token'), ('public.resolve_share_token', 'token'),
  ('public.share_token_object', 'token'),
  ('public.claim_jobs', 'claim'), ('public.complete_job', 'claim'), ('public.defer_job', 'claim'), ('public.fail_job', 'claim'),
  ('public.release_job', 'claim'), ('public.start_job', 'claim'), ('public.jobs_runner_begin', 'claim'), ('public.jobs_runner_end', 'claim'),
  ('public.communication_queue_apply_dlr', 'claim'), ('public.communication_queue_claim', 'refuses'),
  ('public.communication_queue_dead_letter', 'claim'), ('public.communication_queue_finish', 'refuses'),
  ('public.communication_queue_scrub_payload', 'claim'), ('public.create_reschedule_token', 'claim'),
  ('public.reschedule_token_visit', 'claim'), ('public.enqueue_message_system', 'claim'), ('public.enqueue_unmatched_reply_system', 'claim'),
  ('public.enqueue_webhook_event_system', 'claim'), ('public.get_tenant_table_rls_policies', 'neutral'),
  ('public.inbound_webhook_begin', 'neutral'), ('public.inbound_webhook_finish', 'neutral'), ('public.ops_alert_notified', 'neutral'),
  ('public.ops_alert_payload', 'neutral'), ('public.share_resource_tenant', 'claim'), ('public.share_token_resource', 'claim'),
  ('public.webhook_delivery_claim', 'claim'), ('public.webhook_delivery_finish', 'claim'), ('private.log_system_audit', 'neutral'),
  ('public.invitation_issue_token', 'claim'), ('public.consume_invitation_for', 'neutral'), ('public.invitation_accept_context', 'neutral');
select set_eq(
  $$ select fn from c2c_definer where class <> 'internal' $$,
  $$ select fn from c2c_access $$,
  'every non-internal definer function is classified by how it treats a clinic that is not full (05-10a), and nothing else'
);

-- Run as the user acting in p_header, with clinic p_lock's access ended before the transaction (locked); rolled back.
create function pg_temp.locked_as(p_lock uuid, p_user uuid, p_header uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  begin
    update public.tenant_subscriptions set access_ends_at = now() - interval '1 day' where tenant_id = p_lock;
    v_out := pg_temp.as_user(p_user, p_header, p_sql);
    raise exception 'c2c lock sentinel' using errcode = 'P0S04';
  exception
    when sqlstate 'P0S04' then null;
  end;
  return v_out;
end;
$f$;
create function pg_temp.locked_val(p_lock uuid, p_user uuid, p_header uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  begin
    update public.tenant_subscriptions set access_ends_at = now() - interval '1 day' where tenant_id = p_lock;
    v_out := pg_temp.val_as(p_user, p_header, p_sql);
    raise exception 'c2c lock sentinel' using errcode = 'P0S04';
  exception
    when sqlstate 'P0S04' then null;
  end;
  return v_out;
end;
$f$;

-- Each call is the "acting in B is allowed" call of section 5 (or its token equivalent), now with B locked.
select alike(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000b',
  format('select public.change_member_role(%L, %L)', (select id from public.memberships where user_id = 'c2c00000-0000-4000-8000-000000000202' and tenant_id = 'c2c00000-0000-4000-8000-00000000000b'), 'nurse')),
  'error:P0002:not_found%', 'locked B: change_member_role is refused');
select alike(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select * from public.create_share_token('invoice', 'c2c00000-0000-4000-8000-000000002005')$$),
  'error:P0002:not_found%', 'locked B: create_share_token is refused');
select alike(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select public.revoke_share_token('c2c00000-0000-4000-8000-000000004001')$$),
  'error:P0002:not_found%', 'locked B: revoke_share_token is refused');
select alike(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b',
  $$select public.enqueue_message('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000002001', null, 'whatsapp', 'appointment_booked', 'appointment_booked',
      '{"patient_name": "Synthetic"}'::jsonb, '+919000000702', null, null)$$),
  'error:P0002:SUBJECT_MISMATCH%', 'locked B: enqueue_message is refused (no patient message from a locked clinic)');
select alike(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000b', $$select public.enqueue_webhook_event('c2c00000-0000-4000-8000-00000000000b', 'ping', 'c2c00000-0000-4000-8000-000000002008', 'c2c00000-0000-4000-8000-000000002008')$$),
  'error:P0002:SUBJECT_MISMATCH%', 'locked B: enqueue_webhook_event is refused');
select alike(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000b',
  $$select set_config('clinicos.record_payment_id', 'c2c00000-0000-4000-8000-000000009999', true), private.outbox_payment_recorded('c2c00000-0000-4000-8000-000000009999')$$),
  'error:P0001:OUTBOX_SUBJECT_INVALID%', 'locked B: outbox_payment_recorded is refused');
select is(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', $$select * from public.referral_source_clinics(array['c2c00000-0000-4000-8000-00000000000a']::uuid[])$$),
  '0', 'locked B: referral_source_clinics lists nothing');
select is(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', $$select token_number from public.issue_queue_token('c2c00000-0000-4000-8000-000000002002')$$),
  'denied:forbidden', 'locked B: issue_queue_token is refused');
select alike(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', $$select * from public.search_medicines('para', 'c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', 1)$$),
  'denied:forbidden', 'locked B: search_medicines is refused');
select alike(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', $$select public.generate_tenant_invoice_number('c2c00000-0000-4000-8000-00000000000b')$$),
  'denied:%', 'locked B: generate_tenant_invoice_number is refused');
select is(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select public.record_payment('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000002005', 1, 'cash', '', null)$$),
  'error:P0002:INVOICE_NOT_FOUND', 'locked B: record_payment is refused');
select is(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select public.create_invoice('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009001', '[{"description":"x","unit_price":1}]'::jsonb, 'c2c00000-0000-4000-8000-0000000c0013')$$),
  'error:P0002:VISIT_NOT_FOUND', 'locked B: create_invoice is refused');
select is(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select public.collect_payment('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009001', '[]'::jsonb, 1, 'cash', '', '', 'c2c00000-0000-4000-8000-0000000c0014')$$),
  'error:P0002:VISIT_NOT_FOUND', 'locked B: collect_payment is refused');
select is(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select public.sign_consultation('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009001', 'c2c00000-0000-4000-8000-0000000c0031')$$),
  'error:P0002:VISIT_NOT_FOUND', 'locked B: sign_consultation is refused');
select is(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select public.reopen_visit_for_amendment('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009001', 'Synthetic amendment reason', 'c2c00000-0000-4000-8000-0000000c0032')$$),
  'error:P0002:VISIT_NOT_FOUND', 'locked B: reopen_visit_for_amendment is refused');
select is(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select public.finalize_visit_amendment('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009001', 'c2c00000-0000-4000-8000-0000000c0033')$$),
  'error:P0002:VISIT_NOT_FOUND', 'locked B: finalize_visit_amendment is refused');
select is(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select public.check_in_visit('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009001', 'normal', 'c2c00000-0000-4000-8000-0000000c0034')$$),
  'error:P0002:VISIT_NOT_FOUND', 'locked B: check_in_visit is refused');
select is(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select public.start_consultation('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009001', 'c2c00000-0000-4000-8000-0000000c0038')$$),
  'error:P0002:VISIT_NOT_FOUND', 'locked B: start_consultation is refused');
select is(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select public.complete_visit('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009001', 'c2c00000-0000-4000-8000-0000000c0039')$$),
  'error:P0002:VISIT_NOT_FOUND', 'locked B: complete_visit is refused');
select is(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select public.register_patient('c2c00000-0000-4000-8000-00000000000b', '{"full_name":"Synthetic Locked","phone":"9000000707","age":30}'::jsonb, 'c2c00000-0000-4000-8000-0000000c0041')$$),
  'error:P0002:PATIENT_NOT_FOUND', 'locked B: register_patient is refused');
select is(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select public.enqueue_walk_in('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009002', null, 'c2c00000-0000-4000-8000-000000000301', 'normal', 'c2c00000-0000-4000-8000-0000000c0035')$$),
  'error:P0002:PATIENT_NOT_FOUND', 'locked B: enqueue_walk_in is refused');
select is(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select public.register_and_book('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009002', null, 'c2c00000-0000-4000-8000-000000000301', now() + interval '3 days', 15, false, 'c2c00000-0000-4000-8000-0000000c0036')$$),
  'error:P0002:PATIENT_NOT_FOUND', 'locked B: register_and_book is refused');
select is(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000b', $$select public.complete_and_bill('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000009001', '[]'::jsonb, 0, 0, null, 'c2c00000-0000-4000-8000-0000000c0037')$$),
  'error:P0002:VISIT_NOT_FOUND', 'locked B: complete_and_bill is refused');
select is(pg_temp.locked_val('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b', $$select public.has_permission('c2c00000-0000-4000-8000-00000000000b', 'patients:view')::text$$),
  'false', 'locked B: has_permission is false');
select alike(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000a', 'c2c00000-0000-4000-8000-000000000301', 'c2c00000-0000-4000-8000-00000000000a', $$select * from public.referral_directory_search('Synthetic 05-02c Clinic')$$),
  'denied:forbidden', 'locked A: referral_directory_search is refused (acting in A, A locked)');
select is(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000b',
  format('select public.remove_member(%L, %L)', (select id from public.memberships where user_id = 'c2c00000-0000-4000-8000-000000000202' and tenant_id = 'c2c00000-0000-4000-8000-00000000000b'), 'Synthetic reason')),
  '1', 'locked B: its OWNER may still remove staff (05-12, IND L-5; any other role is refused, review_fixes_05b)');
select is(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000b',
  $$select public.invite_staff('c2c00000-0000-4000-8000-00000000000b', 'c2c-invitee-b@example.test', 'admin')$$),
  'denied:STAFF_INVITE_FORBIDDEN', 'locked B: invite_staff is refused');
select alike(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000b',
  $$select public.resend_invitation('c2c00000-0000-4000-8000-000000004101')$$),
  'error:P0002:INVITATION_NOT_FOUND%', 'locked B: resend_invitation is refused');
select alike(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000303', 'c2c00000-0000-4000-8000-00000000000b',
  $$select public.revoke_invitation('c2c00000-0000-4000-8000-000000004101')$$),
  'error:P0002:INVITATION_NOT_FOUND%', 'locked B: revoke_invitation is refused');
select is(pg_temp.locked_val('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b',
  $$select public.ai_preflight('ai.scribe', 'c2c00000-0000-4000-8000-000000002002')$$),
  'locked', 'locked B: ai_preflight answers locked (05-10c)');
select is(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000302', 'c2c00000-0000-4000-8000-00000000000b',
  $$select public.ai_reserve('ai.scribe', 'c2c00000-0000-4000-8000-000000002002', 60)$$),
  'error:P0001:AI_LOCKED', 'locked B: ai_reserve is refused (05-10c)');
select is(pg_temp.locked_as('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000201', 'c2c00000-0000-4000-8000-00000000000b',
  $$select public.set_ai_opt_in('c2c00000-0000-4000-8000-00000000000b', true, '2026-11')$$),
  'denied:AI_OPT_IN_OWNER_ONLY', 'locked B: set_ai_opt_in is refused to B''s owner (05-10c)');
select is(pg_temp.as_user('c2c00000-0000-4000-8000-000000000201', 'c2c00000-0000-4000-8000-00000000000b',
  $$select public.set_ai_opt_in('c2c00000-0000-4000-8000-00000000000b', true, '2026-11')$$),
  '1', 'full B: set_ai_opt_in by B''s owner is allowed (05-10c control)');
-- Token paths (anon) and the share-object lookup (service role).
select is(pg_temp.locked_val('c2c00000-0000-4000-8000-00000000000b', null, null,
  $$select (public.get_reschedule_context('c2c-synthetic-reschedule-token-for-clinic-b-0001', now(), now() + interval '1 day') ->> 'status')$$),
  'clinic_unavailable', 'locked B: get_reschedule_context answers clinic_unavailable (control below: ok when full)');
select is(pg_temp.val_as(null, null,
  $$select (public.get_reschedule_context('c2c-synthetic-reschedule-token-for-clinic-b-0001', now(), now() + interval '1 day') ->> 'status')$$),
  'ok', 'full B: get_reschedule_context answers ok');
select is(pg_temp.locked_val('c2c00000-0000-4000-8000-00000000000b', null, null,
  $$select (public.consume_reschedule_token('c2c-synthetic-reschedule-token-for-clinic-b-0001', now() + interval '2 days') ->> 'status')$$),
  'clinic_unavailable', 'locked B: consume_reschedule_token answers clinic_unavailable and moves nothing');
select is(pg_temp.locked_val('c2c00000-0000-4000-8000-00000000000b', null, null,
  $$select (public.resolve_share_token('c2c-synthetic-invoice-token-for-clinic-b-00001', array['invoice']) ->> 'status')$$),
  'clinic_unavailable', 'locked B: resolve_share_token of a receipt answers clinic_unavailable');
select is(pg_temp.val_as(null, null,
  $$select (public.resolve_share_token('c2c-synthetic-invoice-token-for-clinic-b-00001', array['invoice']) ->> 'access')$$),
  'full', 'full B: resolve_share_token resolves and reports the access level');
create function pg_temp.locked_service(p_lock uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  begin
    update public.tenant_subscriptions set access_ends_at = now() - interval '1 day' where tenant_id = p_lock;
    set local role service_role;
    execute p_sql into v_out;
    raise exception 'c2c lock sentinel' using errcode = 'P0S04';
  exception
    when sqlstate 'P0S04' then null;
  end;
  return v_out;
end;
$f$;
select is(pg_temp.locked_service('c2c00000-0000-4000-8000-00000000000b',
  $$select coalesce(public.share_token_object('c2c-synthetic-invoice-token-for-clinic-b-00001', array['invoice'])::text, 'null')$$),
  'null', 'locked B: share_token_object returns nothing to sign (service role)');
-- Level-neutral control: the caller still learns its own clinic's level, and still writes its own audit row.
select is(pg_temp.locked_val('c2c00000-0000-4000-8000-00000000000b', 'c2c00000-0000-4000-8000-000000000201', null, $$select public.my_tenant_access('c2c00000-0000-4000-8000-00000000000b')$$),
  'locked', 'locked B: my_tenant_access tells its owner the clinic is locked (the billing page needs it)');

select * from finish();
rollback;
