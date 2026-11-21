-- diagnosis_search_snapshot.test.sql — V2-09b 09B-04a (R-11, R-13; migration 000114_diagnosis_search_snapshot).
--
-- public.search_diagnoses(p_tenant_id, p_terms, p_specialty, p_limit): STABLE INVOKER typeahead. The caller's own custom diagnoses first (use_count),
--   never another doctor's or another clinic's; then the catalogue by rank (exact, prefix, synonym, word prefix, inside the name, trigram); LIKE wildcards
--   in a term match themselves; the specialty filter; a custom row that repeats a catalogue name is listed once; no consultations:view or a forged tenant
--   gets nothing; the limit is clamped.
-- public.patient_snapshot(p_tenant_id, p_patient_id, p_exclude_visit_id): STABLE INVOKER jsonb. Signed visits only (a booked, waiting, cancelled or
--   unsigned completed visit is not history), the last 5 other than the current one, the signed Rx version's lines, the follow-ups due with no attended
--   visit since, the latest measured vitals without any recorder id, NULL for a role without consultations:view, another clinic or an unknown patient.
-- Every call runs under the real principal (set local role, JWT claims, the x-clinicos-tenant header). The file rolls back. Synthetic data only.
begin;
select plan(49);

-- Fixtures ----------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1140000-0000-4000-8000-000000000101', 'c114-owner-a@example.test'),
  ('c1140000-0000-4000-8000-000000000102', 'c114-doctor-a1@example.test'),
  ('c1140000-0000-4000-8000-000000000103', 'c114-doctor-a2@example.test'),
  ('c1140000-0000-4000-8000-000000000104', 'c114-admin-a@example.test'),
  ('c1140000-0000-4000-8000-000000000105', 'c114-nurse-a@example.test'),
  ('c1140000-0000-4000-8000-000000000106', 'c114-receptionist-a@example.test'),
  ('c1140000-0000-4000-8000-000000000201', 'c114-owner-b@example.test');
insert into public.tenants (id, name) values
  ('c1140000-0000-4000-8000-00000000000a', 'Synthetic 09B-04a Clinic A'),
  ('c1140000-0000-4000-8000-00000000000b', 'Synthetic 09B-04a Clinic B');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-00000000000b');
insert into public.memberships (user_id, tenant_id, role, full_name) values
  ('c1140000-0000-4000-8000-000000000101', 'c1140000-0000-4000-8000-00000000000a', 'owner', 'Synthetic Owner A'),
  ('c1140000-0000-4000-8000-000000000102', 'c1140000-0000-4000-8000-00000000000a', 'doctor', 'Dr Synthetic One'),
  ('c1140000-0000-4000-8000-000000000103', 'c1140000-0000-4000-8000-00000000000a', 'doctor', 'Dr Synthetic Two'),
  ('c1140000-0000-4000-8000-000000000104', 'c1140000-0000-4000-8000-00000000000a', 'admin', 'Synthetic Admin A'),
  ('c1140000-0000-4000-8000-000000000105', 'c1140000-0000-4000-8000-00000000000a', 'nurse', 'Synthetic Nurse A'),
  ('c1140000-0000-4000-8000-000000000106', 'c1140000-0000-4000-8000-00000000000a', 'receptionist', 'Synthetic Receptionist A'),
  ('c1140000-0000-4000-8000-000000000201', 'c1140000-0000-4000-8000-00000000000b', 'owner', 'Synthetic Owner B');

-- The catalogue (global rows; this transaction only).
insert into public.opd_diagnoses (id, name, icd11_code, snomed_concept_id, category, specialties, synonyms, is_chronic) values
  ('c1140000-0000-4000-8000-0000000d0001', 'Hypertension', 'BA00', '38341003', 'Cardiovascular', '{general_physician}', '{HTN,high blood pressure}', true),
  ('c1140000-0000-4000-8000-0000000d0002', 'Hypertension, secondary', 'BA04', null, 'Cardiovascular', '{general_physician}', '{}', true),
  ('c1140000-0000-4000-8000-0000000d0003', 'Elevated BP', null, null, 'Cardiovascular', '{general_physician}', '{hypertension screening}', false),
  ('c1140000-0000-4000-8000-0000000d0004', 'Pulmonary hypertension', 'BB01', null, 'Cardiovascular', '{general_physician}', '{}', true),
  ('c1140000-0000-4000-8000-0000000d0005', 'Prehypertension', null, null, 'Cardiovascular', '{general_physician}', '{}', false),
  ('c1140000-0000-4000-8000-0000000d0006', 'Viral fever', 'MG26', '386661006', 'Infectious', '{general_physician,pediatrics}', '{}', false),
  ('c1140000-0000-4000-8000-0000000d0007', 'Dental caries', 'DA08.0', '80967001', 'Dental', '{dental}', '{cavity}', false),
  ('c1140000-0000-4000-8000-0000000d0008', 'Ax_y Dx', null, null, 'Test', '{general_physician}', '{}', false),
  ('c1140000-0000-4000-8000-0000000d0009', 'Axby Dx', null, null, 'Test', '{general_physician}', '{}', false),
  ('c1140000-0000-4000-8000-0000000d000a', '100% Test Dx', null, null, 'Test', '{general_physician}', '{}', false);
-- Custom diagnoses: doctor A1's two, doctor A2's one, clinic B's one; A1 also has one that repeats a catalogue name.
insert into public.doctor_custom_diagnoses (tenant_id, doctor_id, diagnosis_name, specialty, use_count) values
  ('c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000000102', 'My hypertension protocol', 'general_physician', 9),
  ('c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000000102', 'My hypertension review', 'general_physician', 3),
  ('c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000000102', 'Viral fever', 'general_physician', 4),
  ('c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000000103', 'Other doctor hypertension note', 'general_physician', 20),
  ('c1140000-0000-4000-8000-00000000000b', 'c1140000-0000-4000-8000-000000000201', 'Clinic B hypertension note', 'general_physician', 30);

-- A patient with a history in clinic A; one patient in clinic B.
insert into public.patients (id, tenant_id, full_name, phone, allergies, chronic_conditions, created_by) values
  ('c1140000-0000-4000-8000-000000001001', 'c1140000-0000-4000-8000-00000000000a', 'Synthetic Snapshot Patient', '+919000011401',
   '{Penicillin}', '{Hypertension,Type 2 diabetes}', 'c1140000-0000-4000-8000-000000000101'),
  ('c1140000-0000-4000-8000-000000001002', 'c1140000-0000-4000-8000-00000000000b', 'Synthetic Snapshot Patient B', '+919000011402', null, '{}',
   'c1140000-0000-4000-8000-000000000201');

-- Visits of patient P (clinic A). S1..S6 become signed (50, 40, 30, 20, 10 and 5 days ago); W waiting, B booked, C cancelled, U completed unsigned, X the
-- current visit (in consultation).
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1140000-0000-4000-8000-000000002001', 'c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000001001', 'c1140000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1140000-0000-4000-8000-000000000101'),
  ('c1140000-0000-4000-8000-000000002002', 'c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000001001', 'c1140000-0000-4000-8000-000000000103', 'walk_in', 'in_consultation', 'c1140000-0000-4000-8000-000000000101'),
  ('c1140000-0000-4000-8000-000000002003', 'c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000001001', 'c1140000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1140000-0000-4000-8000-000000000101'),
  ('c1140000-0000-4000-8000-000000002004', 'c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000001001', 'c1140000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1140000-0000-4000-8000-000000000101'),
  ('c1140000-0000-4000-8000-000000002005', 'c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000001001', 'c1140000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1140000-0000-4000-8000-000000000101'),
  ('c1140000-0000-4000-8000-000000002006', 'c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000001001', 'c1140000-0000-4000-8000-000000000103', 'walk_in', 'in_consultation', 'c1140000-0000-4000-8000-000000000101'),
  ('c1140000-0000-4000-8000-000000002007', 'c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000001001', 'c1140000-0000-4000-8000-000000000102', 'walk_in', 'waiting', 'c1140000-0000-4000-8000-000000000101'),
  ('c1140000-0000-4000-8000-000000002008', 'c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000001001', 'c1140000-0000-4000-8000-000000000102', 'walk_in', 'cancelled', 'c1140000-0000-4000-8000-000000000101'),
  ('c1140000-0000-4000-8000-000000002009', 'c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000001001', 'c1140000-0000-4000-8000-000000000102', 'walk_in', 'completed', 'c1140000-0000-4000-8000-000000000101'),
  ('c1140000-0000-4000-8000-00000000200a', 'c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000001001', 'c1140000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1140000-0000-4000-8000-000000000101');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at, is_overbooked, created_by) values
  ('c1140000-0000-4000-8000-00000000200b', 'c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000001001', 'c1140000-0000-4000-8000-000000000102', 'scheduled', 'booked', now() + interval '3 days', true, 'c1140000-0000-4000-8000-000000000101');

-- The notes and rows of the signed visits, written while they are drafts (a signed row is sealed).
update public.clinical_notes set vitals = '{}'::jsonb where visit_id = 'c1140000-0000-4000-8000-000000002006';
update public.clinical_notes set vitals = jsonb_build_object('systolic', 150, 'diastolic', 95, 'pulse', 96, 'temperature', 100.8, 'recorded_by', 'c1140000-0000-4000-8000-000000000105')
 where visit_id = 'c1140000-0000-4000-8000-000000002005';
update public.clinical_notes set vitals = jsonb_build_object('systolic', 120, 'diastolic', 80) where visit_id = 'c1140000-0000-4000-8000-000000002004';
insert into public.consultation_diagnoses (tenant_id, visit_id, patient_id, diagnosis_name, icd11_code) values
  ('c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000002006', 'c1140000-0000-4000-8000-000000001001', 'Viral fever', 'MG26'),
  ('c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000002005', 'c1140000-0000-4000-8000-000000001001', 'Hypertension', 'BA00'),
  ('c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000002001', 'c1140000-0000-4000-8000-000000001001', 'Oldest diagnosis', null),
  ('c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-00000000200a', 'c1140000-0000-4000-8000-000000001001', 'Current visit diagnosis', null),
  ('c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000002007', 'c1140000-0000-4000-8000-000000001001', 'Waiting visit diagnosis', null);
-- S6 has a signed Rx version 1 (one item) and an unsigned draft version 2 (another item): only the signed version is the history.
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id, version, status) values
  ('c1140000-0000-4000-8000-0000000e0001', 'c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000002006', 'c1140000-0000-4000-8000-000000001001', 'c1140000-0000-4000-8000-000000000103', 1, 'active'),
  ('c1140000-0000-4000-8000-0000000e0002', 'c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000002006', 'c1140000-0000-4000-8000-000000001001', 'c1140000-0000-4000-8000-000000000103', 2, 'active');
insert into public.prescription_items (tenant_id, prescription_id, medicine_name, dosage, timing, duration, sort_order) values
  ('c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-0000000e0001', 'Synthetic Medicine Signed', '1-0-1', 'After food', '5 days', 0),
  ('c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-0000000e0002', 'Synthetic Medicine Draft', '0-0-1', null, '3 days', 0);
-- Follow-ups: F1 on S6 (due 2 days ago, written 5 days ago: nothing attended since), F2 on S2 (due long ago, but S3 was attended after it was written),
-- F3 on S4 (not yet due).
insert into public.follow_ups (tenant_id, patient_id, visit_id, doctor_id, follow_up_date) values
  ('c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000001001', 'c1140000-0000-4000-8000-000000002006', 'c1140000-0000-4000-8000-000000000103', ((now() - interval '2 days') at time zone 'Asia/Kolkata')::date),
  ('c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000001001', 'c1140000-0000-4000-8000-000000002002', 'c1140000-0000-4000-8000-000000000103', ((now() - interval '35 days') at time zone 'Asia/Kolkata')::date),
  ('c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000001001', 'c1140000-0000-4000-8000-000000002004', 'c1140000-0000-4000-8000-000000000102', ((now() + interval '3 days') at time zone 'Asia/Kolkata')::date);

-- Signatures under each doctor's own session (09A R-15), then the clock moved back (the seal guard stamps now()).
create function pg_temp.sign(p_user uuid, p_visit uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c1140000-0000-4000-8000-00000000000a')::text, true);
  execute format('update public.visits set status = %L, signed_at = now(), signed_by = %L where id = %L', 'completed', p_user, p_visit);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end
$f$;
select pg_temp.sign('c1140000-0000-4000-8000-000000000102', 'c1140000-0000-4000-8000-000000002001');
select pg_temp.sign('c1140000-0000-4000-8000-000000000103', 'c1140000-0000-4000-8000-000000002002');
select pg_temp.sign('c1140000-0000-4000-8000-000000000102', 'c1140000-0000-4000-8000-000000002003');
select pg_temp.sign('c1140000-0000-4000-8000-000000000102', 'c1140000-0000-4000-8000-000000002004');
select pg_temp.sign('c1140000-0000-4000-8000-000000000102', 'c1140000-0000-4000-8000-000000002005');
select pg_temp.sign('c1140000-0000-4000-8000-000000000103', 'c1140000-0000-4000-8000-000000002006');

set local session_replication_role = replica;
update public.visits set signed_at = now() - interval '50 days', created_at = now() - interval '50 days' where id = 'c1140000-0000-4000-8000-000000002001';
update public.visits set signed_at = now() - interval '40 days', created_at = now() - interval '40 days' where id = 'c1140000-0000-4000-8000-000000002002';
update public.visits set signed_at = now() - interval '30 days', created_at = now() - interval '30 days' where id = 'c1140000-0000-4000-8000-000000002003';
update public.visits set signed_at = now() - interval '20 days', created_at = now() - interval '20 days' where id = 'c1140000-0000-4000-8000-000000002004';
update public.visits set signed_at = now() - interval '10 days', created_at = now() - interval '10 days' where id = 'c1140000-0000-4000-8000-000000002005';
update public.visits set signed_at = now() - interval '5 days', created_at = now() - interval '5 days' where id = 'c1140000-0000-4000-8000-000000002006';
-- The waiting, cancelled and unsigned completed visits are old (before every follow-up below was written, so they are not "since" any of them).
update public.visits set created_at = now() - interval '60 days' where id in
  ('c1140000-0000-4000-8000-000000002007', 'c1140000-0000-4000-8000-000000002008', 'c1140000-0000-4000-8000-000000002009');
update public.prescriptions set signed_at = now() - interval '5 days' where id = 'c1140000-0000-4000-8000-0000000e0001';
update public.follow_ups set created_at = now() - interval '5 days' where visit_id = 'c1140000-0000-4000-8000-000000002006';
update public.follow_ups set created_at = now() - interval '40 days' where visit_id = 'c1140000-0000-4000-8000-000000002002';
update public.follow_ups set created_at = now() - interval '20 days' where visit_id = 'c1140000-0000-4000-8000-000000002004';
set local session_replication_role = origin;

-- Runs one statement under a real principal and returns 'ok:<result>' or 'error:<sqlstate>:<message>'.
create function pg_temp.act(p_db_role text, p_user uuid, p_header uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_res text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_user is null then json_build_object('role', p_db_role)::text
                                                  else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
    perform set_config('request.headers', json_build_object('x-clinicos-tenant', p_header)::text, true);
    execute 'set local role ' || quote_ident(p_db_role);
    execute p_sql into v_res;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    return 'ok:' || coalesce(v_res, '<null>');
  exception when others then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    return 'error:' || sqlstate || ':' || sqlerrm;
  end;
end
$f$;
-- Names (in order) that search_diagnoses returns for `terms` as `user` (clinic A unless a header is given), '-' when none, or the error text.
create function pg_temp.search(p_user text, p_terms text, p_specialty text default null, p_limit int default 20, p_header text default 'a', p_tenant text default 'a') returns text language sql as $f$
  select regexp_replace(pg_temp.act('authenticated', ('c1140000-0000-4000-8000-000000000' || p_user)::uuid,
    ('c1140000-0000-4000-8000-00000000000' || p_header)::uuid,
    format($q$select coalesce(string_agg(r.name || case when r.is_custom then '*' else '' end, ' | '), '-') from public.search_diagnoses(%L, %L::text[], %L, %s) r$q$,
           ('c1140000-0000-4000-8000-00000000000' || p_tenant)::uuid, p_terms, p_specialty, p_limit)), '^ok:', '')
$f$;
create function pg_temp.snap(p_user text, p_patient text, p_exclude text default null, p_header text default 'a', p_tenant text default 'a') returns jsonb language sql as $f$
  select case when o like 'ok:%' and o <> 'ok:<null>' then substr(o, 4)::jsonb end
    from (select pg_temp.act('authenticated', ('c1140000-0000-4000-8000-000000000' || p_user)::uuid, ('c1140000-0000-4000-8000-00000000000' || p_header)::uuid,
            format('select public.patient_snapshot(%L, %L, %L)::text', ('c1140000-0000-4000-8000-00000000000' || p_tenant)::uuid,
                   ('c1140000-0000-4000-8000-00000000' || p_patient)::uuid, case when p_exclude is null then null else ('c1140000-0000-4000-8000-00000000' || p_exclude)::uuid end)) as o) x
$f$;

-- 1. Catalog --------------------------------------------------------------------------------------------------------------------
select is((select prosecdef::text || ':' || provolatile::text || ':' || (proconfig @> array['search_path=""'])::text
            from pg_proc where oid = 'public.search_diagnoses(uuid, text[], text, integer)'::regprocedure), 'false:s:true',
  'search_diagnoses is SECURITY INVOKER, STABLE, search_path pinned');
select is((select prosecdef::text || ':' || provolatile::text || ':' || (proconfig @> array['search_path=""'])::text
            from pg_proc where oid = 'public.patient_snapshot(uuid, uuid, uuid)'::regprocedure), 'false:s:true',
  'patient_snapshot is SECURITY INVOKER, STABLE, search_path pinned');
select is((select has_function_privilege('authenticated', 'public.search_diagnoses(uuid, text[], text, integer)', 'EXECUTE')::text || ','
         || has_function_privilege('anon', 'public.search_diagnoses(uuid, text[], text, integer)', 'EXECUTE')::text || ','
         || has_function_privilege('service_role', 'public.search_diagnoses(uuid, text[], text, integer)', 'EXECUTE')::text
         || ';' || has_function_privilege('authenticated', 'public.patient_snapshot(uuid, uuid, uuid)', 'EXECUTE')::text || ','
         || has_function_privilege('anon', 'public.patient_snapshot(uuid, uuid, uuid)', 'EXECUTE')::text || ','
         || has_function_privilege('service_role', 'public.patient_snapshot(uuid, uuid, uuid)', 'EXECUTE')::text),
  'true,false,false;true,false,false', 'EXECUTE for authenticated only on both (not anon, not service_role)');
select ok(pg_temp.act('anon', null, 'c1140000-0000-4000-8000-00000000000a', $$select count(*)::text from public.search_diagnoses('c1140000-0000-4000-8000-00000000000a', '{hyper}', null, 5)$$)
  like 'error:42501:%', 'no session (anon) cannot search');
select ok(pg_temp.act('anon', null, 'c1140000-0000-4000-8000-00000000000a', $$select public.patient_snapshot('c1140000-0000-4000-8000-00000000000a', 'c1140000-0000-4000-8000-000000001001', null)::text$$)
  like 'error:42501:%', 'no session (anon) cannot read a snapshot');

-- 2. search_diagnoses: ranking, scope -----------------------------------------------------------------------------------------------
-- '*' marks the doctor's own custom rows.
select is(pg_temp.search('102', '{hypertension}'),
  'My hypertension protocol* | My hypertension review* | Hypertension | Hypertension, secondary | Elevated BP | Pulmonary hypertension | Prehypertension',
  'the doctor''s own custom rows first by use_count, then exact name, name prefix, synonym, word prefix, inside the name');
select is(pg_temp.search('102', '{hypertension}') like '%Other doctor%' or pg_temp.search('102', '{hypertension}') like '%Clinic B%', false,
  'never another doctor''s custom diagnosis nor another clinic''s');
select is(pg_temp.search('103', '{hypertension}'), 'Other doctor hypertension note* | Hypertension | Hypertension, secondary | Elevated BP | Pulmonary hypertension | Prehypertension',
  'another doctor of the same clinic gets their own custom rows and none of the first doctor''s');
select is(pg_temp.search('201', '{hypertension}', null, 20, 'b', 'b'), 'Clinic B hypertension note* | Hypertension | Hypertension, secondary | Elevated BP | Pulmonary hypertension | Prehypertension',
  'the owner of clinic B gets their own clinic''s custom row');
select is(pg_temp.search('102', '{htn}'), 'Hypertension', 'a synonym (HTN) finds the diagnosis');
select is(pg_temp.search('102', '{htn,hypertension}'),
  'My hypertension protocol* | My hypertension review* | Hypertension | Hypertension, secondary | Elevated BP | Pulmonary hypertension | Prehypertension',
  'the expansions are searched with the typed term and the best rank of any term decides');
select is(pg_temp.search('102', '{hypertensn}'),
  'My hypertension protocol* | My hypertension review* | Elevated BP | Hypertension | Hypertension, secondary | Prehypertension | Pulmonary hypertension',
  'a one-letter typo is found by trigram similarity (rank 6, name order) on the name, a synonym or a custom name');
select is(pg_temp.search('102', '{HYPERTENSION}', null, 3), 'My hypertension protocol* | My hypertension review* | Hypertension', 'case does not matter and the limit applies');
select is(pg_temp.search('102', '{viral fever}'), 'Viral fever*', 'a custom row that repeats a catalogue name is listed once, as the custom row');
select is(pg_temp.search('102', '{cavity}', 'dental'), 'Dental caries', 'the specialty filter keeps tagged diagnoses (found by synonym)');
select is(pg_temp.search('102', '{cavity}', 'pediatrics'), '-', 'and drops the others');
select is(pg_temp.search('102', '{elevated}', 'dental'), '-', 'a catalogue row of another specialty is not returned');

-- 3. search_diagnoses: wildcards, limits, permission, tenant ---------------------------------------------------------------------------
select is(pg_temp.search('102', '{x_y}'), 'Ax_y Dx', 'an underscore in a term matches itself, not any character');
select is(pg_temp.search('102', '{100%}'), '100% Test Dx', 'a percent sign in a term matches itself');
select is(pg_temp.search('102', '{%%}'), '-', 'a term of wildcards matches nothing (it is not "everything")');
select is(pg_temp.search('102', '{h}'), '-', 'a one-character term is no query');
select is(pg_temp.search('102', '{hypertension}', null, 0), 'My hypertension protocol*', 'a limit of 0 is raised to 1');
select is((select count(*)::int from regexp_split_to_table(pg_temp.search('102', '{hy,ax,vi,de,10,el,pu,pr}', null, 999), ' \| ')),
          (select count(*)::int from regexp_split_to_table(pg_temp.search('102', '{hy,ax,vi,de,10,el,pu,pr}', null, 50), ' \| ')),
  'a limit above 50 is clamped to 50 (here fewer rows match, so both calls return every match)');
select is(pg_temp.search('105', '{hypertension}'), 'Hypertension | Hypertension, secondary | Elevated BP | Pulmonary hypertension | Prehypertension',
  'a nurse (consultations:view) searches the catalogue and has no custom rows');
select is(pg_temp.search('106', '{hypertension}'), '-', 'a receptionist gets nothing');
select is(pg_temp.search('104', '{hypertension}'), '-', 'an admin gets nothing');
select is(pg_temp.search('102', '{hypertension}', null, 20, 'a', 'b'), '-', 'a forged tenant id (clinic B while signed in to clinic A) gets nothing');
select is(pg_temp.search('201', '{hypertension}', null, 20, 'b', 'a'), '-', 'the owner of clinic B asking for clinic A gets nothing');

-- 4. patient_snapshot: history ---------------------------------------------------------------------------------------------------------
select is((select string_agg(v ->> 'date', ',' order by ord) from jsonb_array_elements(pg_temp.snap('102', '1001', '200a') -> 'visits') with ordinality t(v, ord)),
  (select string_agg((((now() - (d || ' days')::interval) at time zone 'Asia/Kolkata')::date)::text, ',' order by ord) from unnest(array[5, 10, 20, 30, 40]) with ordinality u(d, ord)),
  'the last five signed visits, newest first (the oldest of six is left out), as clinic-zone dates');
select is((select count(*)::int from jsonb_array_elements(pg_temp.snap('102', '1001', '200a') -> 'visits')), 5, 'five visits');
select is(pg_temp.snap('102', '1001', '200a')::text ~ 'Current visit diagnosis|Waiting visit diagnosis|Oldest diagnosis', false,
  'neither the current visit, nor a waiting one, nor the sixth-oldest signed visit appears (a booked, waiting or unsigned visit is not history)');
select is((pg_temp.snap('102', '1001', '2006') -> 'visits' -> 0 ->> 'date') is not null, true, 'the excluded visit is the one named (here S6 is left out: the newest is then S5)');
select is(pg_temp.snap('102', '1001', '2006') -> 'visits' -> 0 -> 'diagnoses' -> 0 ->> 'name', 'Hypertension', 'excluding the newest signed visit leaves the next one first');
select is((pg_temp.snap('102', '1001', '200a') -> 'visits' -> 0 ->> 'doctor') || '|' || (pg_temp.snap('102', '1001', '200a') -> 'visits' -> 0 -> 'diagnoses' -> 0 ->> 'name')
          || '|' || (pg_temp.snap('102', '1001', '200a') -> 'visits' -> 0 -> 'diagnoses' -> 0 ->> 'icd11'),
  'Dr Synthetic Two|Viral fever|MG26', 'a visit carries the doctor''s display name and its diagnoses with their ICD-11 codes');
select is((pg_temp.snap('102', '1001', '200a') -> 'visits' -> 0 -> 'rx')::text,
  '[{"dosage": "1-0-1", "timing": "After food", "duration": "5 days", "medicine": "Synthetic Medicine Signed"}]',
  'the Rx lines are the signed version''s (the unsigned draft version 2 is not history)');
select is(pg_temp.snap('102', '1001', '200a') ->> 'allergies', '["Penicillin"]', 'the patient''s allergies');
select is(pg_temp.snap('102', '1001', '200a') ->> 'chronic_conditions', '["Hypertension", "Type 2 diabetes"]', 'and chronic conditions');

-- 5. patient_snapshot: due follow-ups, vitals, scope --------------------------------------------------------------------------------------
select is((pg_temp.snap('102', '1001', '200a') -> 'due_follow_ups')::text,
  format('[{"date": "%s"}]', (((now() - interval '2 days') at time zone 'Asia/Kolkata')::date)::text),
  'one follow-up is due: written 5 days ago, due 2 days ago, and nothing attended since (the visit in progress is not "since")');
select is((pg_temp.snap('102', '1001') -> 'due_follow_ups')::text, '[]',
  'without naming the current visit it counts as a visit since: nothing is due (and the other two are not: one was followed by an attended visit, one is in the future)');
select is((pg_temp.snap('102', '1001', '200a') -> 'last_vitals' ->> 'date'),
  (((now() - interval '10 days') at time zone 'Asia/Kolkata')::date)::text, 'the latest measured vitals skip the newest visit (empty vitals) and come from the one before, with its date');
select is((pg_temp.snap('102', '1001', '200a') -> 'last_vitals' -> 'vitals')::text, '{"pulse": 96, "systolic": 150, "diastolic": 95, "temperature": 100.8}',
  'measurements only: no recorder id');
select is(pg_temp.snap('102', '1001', '200a')::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', false, 'no uuid anywhere in the snapshot');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.snap('102', '1001', '200a')) k), 'allergies,chronic_conditions,due_follow_ups,last_vitals,visits',
  'the keys are exactly the documented ones');
select isnt(pg_temp.snap('105', '1001', '200a'), null, 'a nurse (consultations:view) reads the snapshot');
select is(pg_temp.snap('106', '1001', '200a'), null, 'a receptionist gets nothing (NULL)');
select is(pg_temp.snap('104', '1001', '200a'), null, 'an admin gets nothing (NULL)');
select is(pg_temp.snap('201', '1001', null, 'b', 'b'), null, 'clinic B''s owner asking for clinic A''s patient in clinic B: NULL (the patient is not there)');
select is(pg_temp.snap('201', '1001', null, 'b', 'a'), null, 'and asking with clinic A''s id: NULL (not the active clinic)');
select is(pg_temp.snap('102', '9999', null), null, 'an unknown patient: NULL');

select * from finish();
rollback;
