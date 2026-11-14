-- domain_policies.test.sql — V2-05 plan 05-02b (P1-01, P0-14, PO-3, SVP §6.1; R-6, R-7, R-8, R-42; threats T-05-08,
-- T-05-09, T-05-10, T-05-39). Hand-written cases next to the generated matrix (authz_matrix.test.sql), for what a
-- one-statement matrix cell cannot express.
--
-- 1. Catalogue: the S/I/U policy set of the 20 clinical, front-desk and financial tables is exactly the 05-02b set
--    (000054-000056), every one is TO authenticated, and none references a legacy helper (any membership).
-- 2. patients_clinical_fields_guard (R-8): without consultations:view in the row's (active) clinic, allergies and
--    chronic_conditions cannot change (42501); demographics can; INSERT may record them; system paths are not limited.
-- 3. generate_tenant_invoice_number (R-7): billing:collect or consultations:edit in the ACTIVE clinic (nurse, another
--    clinic's owner, a dual member acting elsewhere, anon: refused).
-- 4. referrals_target_update_guard: the target clinic may only acknowledge; a member of BOTH clinics acting as the target
--    can no longer rewrite the referral (the guard's originating-clinic exemption is bound to the active clinic).
-- Every probe runs in a subtransaction that is always rolled back; the file rolls back. Synthetic data only.
begin;
select plan(42);

-- Fixtures (synthetic) -------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('d0000000-0000-4000-8000-000000000101', 'dp-owner-a@example.test'),
  ('d0000000-0000-4000-8000-000000000102', 'dp-admin-a@example.test'),
  ('d0000000-0000-4000-8000-000000000103', 'dp-doctor-a@example.test'),
  ('d0000000-0000-4000-8000-000000000104', 'dp-doctor2-a@example.test'),
  ('d0000000-0000-4000-8000-000000000105', 'dp-nurse-a@example.test'),
  ('d0000000-0000-4000-8000-000000000106', 'dp-receptionist-a@example.test'),
  ('d0000000-0000-4000-8000-000000000201', 'dp-owner-b@example.test'),
  ('d0000000-0000-4000-8000-000000000301', 'dp-dual-doctor@example.test'),
  ('d0000000-0000-4000-8000-000000000302', 'dp-dual-desk@example.test');
insert into public.tenants (id, name) values
  ('d0000000-0000-4000-8000-00000000000a', 'Synthetic Policies Clinic A'),
  ('d0000000-0000-4000-8000-00000000000b', 'Synthetic Policies Clinic B');
insert into public.memberships (user_id, tenant_id, role) values
  ('d0000000-0000-4000-8000-000000000101', 'd0000000-0000-4000-8000-00000000000a', 'owner'),
  ('d0000000-0000-4000-8000-000000000102', 'd0000000-0000-4000-8000-00000000000a', 'admin'),
  ('d0000000-0000-4000-8000-000000000103', 'd0000000-0000-4000-8000-00000000000a', 'doctor'),
  ('d0000000-0000-4000-8000-000000000104', 'd0000000-0000-4000-8000-00000000000a', 'doctor'),
  ('d0000000-0000-4000-8000-000000000105', 'd0000000-0000-4000-8000-00000000000a', 'nurse'),
  ('d0000000-0000-4000-8000-000000000106', 'd0000000-0000-4000-8000-00000000000a', 'receptionist'),
  ('d0000000-0000-4000-8000-000000000201', 'd0000000-0000-4000-8000-00000000000b', 'owner'),
  -- a doctor in both clinics (the referral guard leg) and a receptionist in both (the invoice-number leg)
  ('d0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-00000000000a', 'doctor'),
  ('d0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-00000000000b', 'doctor'),
  ('d0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-00000000000a', 'receptionist'),
  ('d0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-00000000000b', 'receptionist');
insert into public.patients (id, tenant_id, full_name, phone, allergies, chronic_conditions, created_by) values
  ('d0000000-0000-4000-8000-000000001001', 'd0000000-0000-4000-8000-00000000000a', 'Synthetic Policies Patient',
   '+919000000501', array['Synthetic allergen'], array['Synthetic condition'], 'd0000000-0000-4000-8000-000000000101');
-- A refers to B (in network), status 'sent'.
insert into public.referrals (id, tenant_id, patient_id, referral_type, referring_doctor_id, referred_to_name,
                              reason_for_referral, target_tenant_id, status) values
  ('d0000000-0000-4000-8000-000000001002', 'd0000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-000000001001',
   'in_network', 'd0000000-0000-4000-8000-000000000103', 'Synthetic Clinic B', 'Synthetic reason',
   'd0000000-0000-4000-8000-00000000000b', 'sent');

-- Helpers ----------------------------------------------------------------------------------------------------------
-- As postgres: one statement in a subtransaction that is ALWAYS rolled back; 'ok' or the SQLSTATE it raised.
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
begin
  begin
    execute p_sql;
    raise exception 'dp sentinel' using errcode = 'P0S02';
  exception when others then
    if sqlstate = 'P0S02' then return 'ok'; end if;
    return sqlstate;
  end;
end;
$f$;

-- As a signed-in user (anon when p_user is null) with the x-clinicos-tenant header p_header (none when null): rows
-- affected/returned by p_sql, 'denied:<message>' (42501) or 'error:<sqlstate>'. Always rolled back.
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
    raise exception 'dp sentinel' using errcode = 'P0S02';
  exception
    when sqlstate 'P0S02' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate;
  end;
  return v_out;
end;
$f$;

-- 1. Catalogue ------------------------------------------------------------------------------------------------------
create temp table dp_tables(t text) on commit drop;
insert into dp_tables values
  ('consultation_diagnoses'), ('consultations'), ('visit_revisions'), ('prescriptions'), ('prescription_items'),
  ('doctor_custom_diagnoses'), ('doctor_custom_medicines'), ('doctor_prescription_templates'), ('referrals'),
  ('patients'), ('consent_records'), ('visits'), ('queue_tokens'), ('waitlist_entries'), ('schedule_blocks'),
  ('follow_ups'), ('communication_queue'), ('invoices'), ('invoice_items'), ('payments');

select set_eq(
  $$ select tablename::text || '.' || policyname::text from pg_policies
      where schemaname = 'public' and cmd <> 'DELETE' and tablename in (select t from dp_tables) $$,
  array[
    'consultation_diagnoses.consultation_diagnoses_select', 'consultation_diagnoses.consultation_diagnoses_insert',
    'consultation_diagnoses.consultation_diagnoses_update',
    'consultations.consultations_select', 'consultations.consultations_insert', 'consultations.consultations_update',
    'visit_revisions.visit_revisions_select', 'visit_revisions.visit_revisions_insert',
    'prescriptions.prescriptions_select', 'prescriptions.prescriptions_insert', 'prescriptions.prescriptions_update',
    'prescription_items.prescription_items_select', 'prescription_items.prescription_items_insert',
    'prescription_items.prescription_items_update',
    'doctor_custom_diagnoses.doctor_custom_diagnoses_select', 'doctor_custom_diagnoses.doctor_custom_diagnoses_insert',
    'doctor_custom_diagnoses.doctor_custom_diagnoses_update',
    'doctor_custom_medicines.doctor_custom_medicines_select', 'doctor_custom_medicines.doctor_custom_medicines_insert',
    'doctor_custom_medicines.doctor_custom_medicines_update',
    'doctor_prescription_templates.doctor_prescription_templates_select',
    'doctor_prescription_templates.doctor_prescription_templates_insert',
    'doctor_prescription_templates.doctor_prescription_templates_update',
    'referrals.referrals_originating_select', 'referrals.referrals_originating_insert',
    'referrals.referrals_originating_update', 'referrals.referrals_target_select', 'referrals.referrals_target_update',
    'patients.patients_select', 'patients.patients_insert', 'patients.patients_update',
    'consent_records.consent_records_select', 'consent_records.consent_records_insert',
    'visits.visits_select', 'visits.visits_insert', 'visits.visits_update',
    'queue_tokens.queue_tokens_select', 'queue_tokens.queue_tokens_insert', 'queue_tokens.queue_tokens_update',
    'waitlist_entries.waitlist_entries_select', 'waitlist_entries.waitlist_entries_insert',
    'waitlist_entries.waitlist_entries_update',
    'schedule_blocks.schedule_blocks_select', 'schedule_blocks.schedule_blocks_insert',
    'schedule_blocks.schedule_blocks_update',
    'follow_ups.follow_ups_select', 'follow_ups.follow_ups_insert', 'follow_ups.follow_ups_update',
    'communication_queue.communication_queue_select',
    'invoices.invoices_select', 'invoices.invoices_insert', 'invoices.invoices_update',
    'invoice_items.invoice_items_select', 'invoice_items.invoice_items_insert', 'invoice_items.invoice_items_update',
    'payments.payments_select', 'payments.payments_insert'
  ]::text[],
  'the S/I/U policies of the 20 domain tables are exactly the 05-02b set (no leftover *_member / *_tenant policy)'
);

select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
      where schemaname = 'public' and tablename in (select t from dp_tables)
        and (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
            ~ '(current_user_tenant_ids|current_user_has_role|current_user_is_admin_or_owner)' $$,
  'no policy of the 20 domain tables uses a legacy helper (any membership): all bound to the active clinic'
);

select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
      where schemaname = 'public' and tablename in (select t from dp_tables) and roles <> '{authenticated}'::name[] $$,
  'every policy of the 20 domain tables is TO authenticated (anon matches none)'
);

select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
      where schemaname = 'public' and tablename in (select t from dp_tables) and cmd = 'ALL' $$,
  'no FOR ALL policy on the 20 domain tables (DELETE stays 05-04''s)'
);

-- 2. patients_clinical_fields_guard (R-8, T-05-10) -------------------------------------------------------------------
select is(
  (select count(*)::int from pg_trigger where tgrelid = 'public.patients'::regclass
      and tgname = 'patients_clinical_fields_guard' and tgenabled = 'O'),
  1, 'patients_clinical_fields_guard is an enabled trigger on patients'
);
select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.patients_clinical_fields_guard'::regproc),
  false, 'the guard is SECURITY INVOKER'
);
select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.patients_clinical_fields_guard'::regproc),
  array['search_path=""']::text[], 'the guard pins search_path to empty'
);

select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000106', null,
  $$update public.patients set allergies = array[]::text[] where id = 'd0000000-0000-4000-8000-000000001001'$$),
  'denied:PATIENT_CLINICAL_FIELDS', 'receptionist: changing allergies → 42501 PATIENT_CLINICAL_FIELDS');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000106', null,
  $$update public.patients set chronic_conditions = array['Other']::text[] where id = 'd0000000-0000-4000-8000-000000001001'$$),
  'denied:PATIENT_CLINICAL_FIELDS', 'receptionist: changing chronic_conditions → 42501');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000106', null,
  $$update public.patients set full_name = 'Synthetic Renamed', allergies = array['Added']::text[]
      where id = 'd0000000-0000-4000-8000-000000001001'$$),
  'denied:PATIENT_CLINICAL_FIELDS', 'receptionist: a demographics update that also changes allergies → 42501 (all or nothing)');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000102', null,
  $$update public.patients set allergies = array[]::text[] where id = 'd0000000-0000-4000-8000-000000001001'$$),
  'denied:PATIENT_CLINICAL_FIELDS', 'admin: changing allergies → 42501 (no clinical access, R-9)');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000106', null,
  $$update public.patients set full_name = 'Synthetic Renamed', phone = '+919000000502'
      where id = 'd0000000-0000-4000-8000-000000001001'$$),
  '1', 'receptionist: demographics update → 1 row');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000106', null,
  $$update public.patients set allergies = allergies, chronic_conditions = chronic_conditions
      where id = 'd0000000-0000-4000-8000-000000001001'$$),
  '1', 'receptionist: re-writing the same allergies/conditions is not a change → 1 row');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000106', null,
  $$insert into public.patients (tenant_id, full_name, phone, allergies, chronic_conditions, created_by)
      values ('d0000000-0000-4000-8000-00000000000a', 'Synthetic Intake', '+919000000503', array['Intake allergen'],
              array['Intake condition'], 'd0000000-0000-4000-8000-000000000106')$$),
  '1', 'receptionist: registration may record allergies and conditions (INSERT not restricted, R-8)');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000105', null,
  $$update public.patients set allergies = array['Nurse recorded']::text[] where id = 'd0000000-0000-4000-8000-000000001001'$$),
  '1', 'nurse (consultations:view): changing allergies → 1 row');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000103', null,
  $$update public.patients set chronic_conditions = array['Doctor recorded']::text[]
      where id = 'd0000000-0000-4000-8000-000000001001'$$),
  '1', 'doctor: changing chronic_conditions → 1 row');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000101', null,
  $$update public.patients set allergies = array[]::text[] where id = 'd0000000-0000-4000-8000-000000001001'$$),
  '1', 'owner: changing allergies → 1 row');
select is(pg_temp.try(
  $$update public.patients set allergies = array[]::text[] where id = 'd0000000-0000-4000-8000-000000001001'$$),
  'ok', 'a system path (no auth.uid(): service role, migrations) is not restricted');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-00000000000b',
  $$update public.patients set full_name = 'Synthetic Cross Clinic' where id = 'd0000000-0000-4000-8000-000000001001'$$),
  '0', 'a receptionist of both clinics acting in B cannot update an A patient (0 rows, R-42)');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-00000000000a',
  $$update public.patients set full_name = 'Synthetic Same Clinic' where id = 'd0000000-0000-4000-8000-000000001001'$$),
  '1', '... and acting in A can (control)');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-00000000000b',
  $$insert into public.patients (tenant_id, full_name, phone, created_by)
      values ('d0000000-0000-4000-8000-00000000000a', 'Synthetic Cross Insert', '+919000000504', 'd0000000-0000-4000-8000-000000000302')$$),
  'denied:new row violates row-level security policy for table "patients"',
  '... and acting in B cannot register a patient into A (42501)');

-- 3. generate_tenant_invoice_number (R-7) -----------------------------------------------------------------------------
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000106', null,
  $$select public.generate_tenant_invoice_number('d0000000-0000-4000-8000-00000000000a')$$),
  '1', 'receptionist (billing:collect) gets an invoice number');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000102', null,
  $$select public.generate_tenant_invoice_number('d0000000-0000-4000-8000-00000000000a')$$),
  '1', 'admin (billing:collect) gets an invoice number');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000103', null,
  $$select public.generate_tenant_invoice_number('d0000000-0000-4000-8000-00000000000a')$$),
  '1', 'doctor (consultations:edit, Sign & Bill) gets an invoice number');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000105', null,
  $$select public.generate_tenant_invoice_number('d0000000-0000-4000-8000-00000000000a')$$),
  'denied:forbidden', 'nurse (neither key) → 42501');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000201', null,
  $$select public.generate_tenant_invoice_number('d0000000-0000-4000-8000-00000000000a')$$),
  'denied:forbidden', 'clinic B''s owner for clinic A → 42501');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-00000000000b',
  $$select public.generate_tenant_invoice_number('d0000000-0000-4000-8000-00000000000a')$$),
  'denied:forbidden', 'a receptionist of both clinics acting in B, for A → 42501 (before: any membership admitted it)');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000302', 'd0000000-0000-4000-8000-00000000000a',
  $$select public.generate_tenant_invoice_number('d0000000-0000-4000-8000-00000000000a')$$),
  '1', '... acting in A → a number (control)');
select matches(pg_temp.as_user(null, null,
  $$select public.generate_tenant_invoice_number('d0000000-0000-4000-8000-00000000000a')$$),
  '^denied:', 'anon → 42501');
select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.generate_tenant_invoice_number(uuid)'::regprocedure),
  true, 'generate_tenant_invoice_number stays SECURITY DEFINER (it counts the clinic''s invoices)'
);
select is(
  (select p.proconfig from pg_proc p where p.oid = 'public.generate_tenant_invoice_number(uuid)'::regprocedure),
  array['search_path=""']::text[], 'generate_tenant_invoice_number pins search_path to empty'
);

-- 4. referrals_target_update_guard: the target clinic only acknowledges ---------------------------------------------
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000201', null,
  $$update public.referrals set status = 'acknowledged' where id = 'd0000000-0000-4000-8000-000000001002'$$),
  '1', 'target clinic owner acknowledges (sent → acknowledged) → 1 row');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000201', null,
  $$update public.referrals set reason_for_referral = 'Rewritten' where id = 'd0000000-0000-4000-8000-000000001002'$$),
  'denied:referral_target_update_forbidden', 'target clinic owner rewriting the referral → 42501');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-00000000000b',
  $$update public.referrals set reason_for_referral = 'Rewritten' where id = 'd0000000-0000-4000-8000-000000001002'$$),
  'denied:referral_target_update_forbidden',
  'a doctor of BOTH clinics acting as the target (B) cannot rewrite it (before: any A membership exempted them)');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-00000000000b',
  $$update public.referrals set status = 'acknowledged' where id = 'd0000000-0000-4000-8000-000000001002'$$),
  '1', '... but acknowledges it as the target (1 row)');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000301', 'd0000000-0000-4000-8000-00000000000a',
  $$update public.referrals set reason_for_referral = 'Updated by the originating clinic'
      where id = 'd0000000-0000-4000-8000-000000001002'$$),
  '1', '... and acting in the originating clinic (A) edits it (1 row)');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000106', null,
  $$update public.referrals set status = 'acknowledged' where id = 'd0000000-0000-4000-8000-000000001002'$$),
  '0', 'a receptionist of the originating clinic does not see the referral (0 rows: clinical, consultations:*)');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000106', null,
  $$select 1 from public.referrals where id = 'd0000000-0000-4000-8000-000000001002'$$),
  '0', 'a receptionist reads no referral (0 rows)');

-- 5. A few cross-table reads the matrix's single fixture row cannot show ----------------------------------------------
-- The doctor sees the invoice of their own visit only; the nurse none (R-7, T-05-09).
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by) values
  ('d0000000-0000-4000-8000-000000001011', 'd0000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-000000001001',
   'd0000000-0000-4000-8000-000000000103', 'walk_in', 'd0000000-0000-4000-8000-000000000101'),
  ('d0000000-0000-4000-8000-000000001012', 'd0000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-000000001001',
   'd0000000-0000-4000-8000-000000000104', 'walk_in', 'd0000000-0000-4000-8000-000000000101');
insert into public.invoices (id, tenant_id, visit_id, patient_id, invoice_number, total_amount) values
  ('d0000000-0000-4000-8000-000000001021', 'd0000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-000000001011',
   'd0000000-0000-4000-8000-000000001001', 'DP-0001', 100),
  ('d0000000-0000-4000-8000-000000001022', 'd0000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-000000001012',
   'd0000000-0000-4000-8000-000000001001', 'DP-0002', 100);
insert into public.payments (tenant_id, invoice_id, amount, payment_method, recorded_by) values
  ('d0000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-000000001021', 100, 'cash', 'd0000000-0000-4000-8000-000000000106'),
  ('d0000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-000000001022', 100, 'cash', 'd0000000-0000-4000-8000-000000000106');

select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000103', null,
  $$select 1 from public.invoices where tenant_id = 'd0000000-0000-4000-8000-00000000000a'
      and id in ('d0000000-0000-4000-8000-000000001021', 'd0000000-0000-4000-8000-000000001022')$$),
  '1', 'doctor: sees 1 of the 2 invoices (own visit only)');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000103', null,
  $$select 1 from public.payments where tenant_id = 'd0000000-0000-4000-8000-00000000000a'
      and invoice_id in ('d0000000-0000-4000-8000-000000001021', 'd0000000-0000-4000-8000-000000001022')$$),
  '1', 'doctor: sees the payment of their own visit only');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000105', null,
  $$select 1 from public.invoices where tenant_id = 'd0000000-0000-4000-8000-00000000000a'$$),
  '0', 'nurse: sees no invoice');
select is(pg_temp.as_user('d0000000-0000-4000-8000-000000000106', null,
  $$select 1 from public.payments where tenant_id = 'd0000000-0000-4000-8000-00000000000a'$$),
  '2', 'receptionist (billing:view): sees both payments');

select * from finish();
rollback;
