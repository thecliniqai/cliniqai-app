-- consult_assist_context.test.sql — V2-09b 09B-03 (R-12, Q-8; migration 000113_consult_assist_context).
--
-- public.consult_assist_context(p_tenant_id): a SECURITY INVOKER, STABLE read of the calling doctor's own last 300 signed visits in the active
-- full clinic. Names and counts only. Proved here:
--   catalog        invoker, stable, search_path pinned, EXECUTE for authenticated only (not anon, not service_role)
--   the doctor     sees the aggregates of their own signed visits: complaint frequencies (case-insensitive), complaint-to-diagnosis pairs, recent
--                  diagnoses with the usual investigations, advice and the follow-up gap in days, and the last valid exam template id
--   scope          unsigned and cancelled visits are not counted; another doctor of the same clinic gets their own and never this doctor's; the
--                  owner with no signed visits of their own gets nothing; a nurse (consultations:view only), a receptionist and an admin get nothing;
--                  a forged tenant id, a null id and another clinic's owner get nothing of this clinic; no session cannot execute it
--   shape          the keys are exactly the documented ones and no id appears anywhere in the output
--   limit          at most 300 visits, newest first
-- 000119 (09C-03) adds rx_favourites and diagnoses[].rx: their cases are in rx_assist.test.sql; here the shape and the empty result carry them.
-- Every call runs under the real principal (set local role, JWT claims, the x-clinicos-tenant header). The file rolls back. Synthetic data only.
begin;
select plan(29);

-- Fixtures ----------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1130000-0000-4000-8000-000000000101', 'c113-owner-a@example.test'),
  ('c1130000-0000-4000-8000-000000000102', 'c113-doctor-a1@example.test'),
  ('c1130000-0000-4000-8000-000000000103', 'c113-doctor-a2@example.test'),
  ('c1130000-0000-4000-8000-000000000104', 'c113-admin-a@example.test'),
  ('c1130000-0000-4000-8000-000000000105', 'c113-nurse-a@example.test'),
  ('c1130000-0000-4000-8000-000000000106', 'c113-receptionist-a@example.test'),
  ('c1130000-0000-4000-8000-000000000107', 'c113-doctor-a3@example.test'),
  ('c1130000-0000-4000-8000-000000000201', 'c113-owner-b@example.test');
insert into public.tenants (id, name) values
  ('c1130000-0000-4000-8000-00000000000a', 'Synthetic 09B-03 Clinic A'),
  ('c1130000-0000-4000-8000-00000000000b', 'Synthetic 09B-03 Clinic B');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-00000000000b');
insert into public.memberships (user_id, tenant_id, role) values
  ('c1130000-0000-4000-8000-000000000101', 'c1130000-0000-4000-8000-00000000000a', 'owner'),
  ('c1130000-0000-4000-8000-000000000102', 'c1130000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1130000-0000-4000-8000-000000000103', 'c1130000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1130000-0000-4000-8000-000000000104', 'c1130000-0000-4000-8000-00000000000a', 'admin'),
  ('c1130000-0000-4000-8000-000000000105', 'c1130000-0000-4000-8000-00000000000a', 'nurse'),
  ('c1130000-0000-4000-8000-000000000106', 'c1130000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c1130000-0000-4000-8000-000000000107', 'c1130000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1130000-0000-4000-8000-000000000201', 'c1130000-0000-4000-8000-00000000000b', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1130000-0000-4000-8000-000000001001', 'c1130000-0000-4000-8000-00000000000a', 'Synthetic Assist Patient', '+919000011301', 'c1130000-0000-4000-8000-000000000101'),
  ('c1130000-0000-4000-8000-000000001002', 'c1130000-0000-4000-8000-00000000000b', 'Synthetic Assist Patient B', '+919000011302', 'c1130000-0000-4000-8000-000000000201');

-- Doctor A1: V1..V3 signed (3, 2 and 1 days ago), V4 still in consultation, V5 cancelled. Doctor A2: V6 signed. Owner B (a doctor of clinic B): V7 signed.
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1130000-0000-4000-8000-000000002001', 'c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-000000001001', 'c1130000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1130000-0000-4000-8000-000000000101'),
  ('c1130000-0000-4000-8000-000000002002', 'c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-000000001001', 'c1130000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1130000-0000-4000-8000-000000000101'),
  ('c1130000-0000-4000-8000-000000002003', 'c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-000000001001', 'c1130000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1130000-0000-4000-8000-000000000101'),
  ('c1130000-0000-4000-8000-000000002004', 'c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-000000001001', 'c1130000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1130000-0000-4000-8000-000000000101'),
  ('c1130000-0000-4000-8000-000000002005', 'c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-000000001001', 'c1130000-0000-4000-8000-000000000102', 'walk_in', 'cancelled', 'c1130000-0000-4000-8000-000000000101'),
  ('c1130000-0000-4000-8000-000000002006', 'c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-000000001001', 'c1130000-0000-4000-8000-000000000103', 'walk_in', 'in_consultation', 'c1130000-0000-4000-8000-000000000101'),
  ('c1130000-0000-4000-8000-000000002007', 'c1130000-0000-4000-8000-00000000000b', 'c1130000-0000-4000-8000-000000001002', 'c1130000-0000-4000-8000-000000000201', 'walk_in', 'in_consultation', 'c1130000-0000-4000-8000-000000000201');

-- The notes (written while the visits are drafts; a signed row is sealed).
update public.clinical_notes set
  chief_complaints = '[{"symptom":"Fever","duration_val":3,"duration_unit":"days"},{"symptom":"Cough","duration_val":2,"duration_unit":"days"}]'::jsonb,
  investigations_advised = array['CBC', 'Dengue NS1'], advice = array['Rest'],
  specialty_data = '{"specialty":"general_physician","exam":{"template_id":"fever","systems":{}}}'::jsonb
 where visit_id = 'c1130000-0000-4000-8000-000000002001';
update public.clinical_notes set
  chief_complaints = '[{"symptom":"fever","duration_val":1,"duration_unit":"days"},{"symptom":"Body ache","duration_val":1,"duration_unit":"days"}]'::jsonb,
  investigations_advised = array['CBC'], advice = array['Rest', 'Fluids']
 where visit_id = 'c1130000-0000-4000-8000-000000002002';
update public.clinical_notes set
  chief_complaints = '[{"symptom":"Headache","duration_val":5,"duration_unit":"days"}]'::jsonb,
  specialty_data = '{"specialty":"general_physician","exam":{"template_id":"Bad Id!","systems":{}}}'::jsonb
 where visit_id = 'c1130000-0000-4000-8000-000000002003';
update public.clinical_notes set chief_complaints = '[{"symptom":"Unsigned complaint","duration_val":1,"duration_unit":"days"}]'::jsonb
 where visit_id = 'c1130000-0000-4000-8000-000000002004';
update public.clinical_notes set chief_complaints = '[{"symptom":"Cancelled complaint","duration_val":1,"duration_unit":"days"}]'::jsonb
 where visit_id = 'c1130000-0000-4000-8000-000000002005';
update public.clinical_notes set chief_complaints = '[{"symptom":"Cough","duration_val":4,"duration_unit":"days"}]'::jsonb, advice = array['Another doctor advice']
 where visit_id = 'c1130000-0000-4000-8000-000000002006';
update public.clinical_notes set chief_complaints = '[{"symptom":"Clinic B complaint","duration_val":4,"duration_unit":"days"}]'::jsonb
 where visit_id = 'c1130000-0000-4000-8000-000000002007';

insert into public.consultation_diagnoses (tenant_id, visit_id, patient_id, diagnosis_name, icd11_code, is_chronic) values
  ('c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-000000002001', 'c1130000-0000-4000-8000-000000001001', 'Viral fever', 'MG26', false),
  ('c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-000000002002', 'c1130000-0000-4000-8000-000000001001', 'Viral fever', 'MG26', false),
  ('c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-000000002003', 'c1130000-0000-4000-8000-000000001001', 'Migraine', '8A80', false),
  ('c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-000000002004', 'c1130000-0000-4000-8000-000000001001', 'Unsigned diagnosis', null, false),
  ('c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-000000002006', 'c1130000-0000-4000-8000-000000001001', 'Allergic rhinitis', 'CA08.0', false),
  ('c1130000-0000-4000-8000-00000000000b', 'c1130000-0000-4000-8000-000000002007', 'c1130000-0000-4000-8000-000000001002', 'Clinic B diagnosis', null, false);

-- Follow-ups: 3 days after the signature date in the clinic's zone, for V1 and V2.
insert into public.follow_ups (tenant_id, patient_id, visit_id, doctor_id, follow_up_date) values
  ('c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-000000001001', 'c1130000-0000-4000-8000-000000002001', 'c1130000-0000-4000-8000-000000000102',
   ((now() - interval '3 days') at time zone 'Asia/Kolkata')::date + 3),
  ('c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-000000001001', 'c1130000-0000-4000-8000-000000002002', 'c1130000-0000-4000-8000-000000000102',
   ((now() - interval '2 days') at time zone 'Asia/Kolkata')::date + 3);

-- The signatures, under each doctor's own session as the sign-off command does (09A R-15), with a fixed signed_at.
create function pg_temp.sign(p_user uuid, p_tenant uuid, p_visit uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', p_tenant)::text, true);
  execute format('update public.visits set status = %L, signed_at = now(), signed_by = %L where id = %L', 'completed', p_user, p_visit);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end
$f$;
select pg_temp.sign('c1130000-0000-4000-8000-000000000102', 'c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-000000002001');
select pg_temp.sign('c1130000-0000-4000-8000-000000000102', 'c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-000000002002');
select pg_temp.sign('c1130000-0000-4000-8000-000000000102', 'c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-000000002003');
select pg_temp.sign('c1130000-0000-4000-8000-000000000103', 'c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-000000002006');
select pg_temp.sign('c1130000-0000-4000-8000-000000000201', 'c1130000-0000-4000-8000-00000000000b', 'c1130000-0000-4000-8000-000000002007');

-- Doctor A3: 305 signed visits, the five oldest carry a complaint that must fall outside the 300.
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by)
select ('c1130000-0000-4000-8000-0000000' || lpad(g::text, 5, '0'))::uuid, 'c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-000000001001',
       'c1130000-0000-4000-8000-000000000107', 'walk_in', 'in_consultation', 'c1130000-0000-4000-8000-000000000101'
  from generate_series(10001, 10305) g;
update public.clinical_notes set chief_complaints = '[{"symptom":"Old complaint","duration_val":1,"duration_unit":"days"}]'::jsonb
 where visit_id in (select ('c1130000-0000-4000-8000-0000000' || lpad(g::text, 5, '0'))::uuid from generate_series(10001, 10005) g);
update public.clinical_notes set chief_complaints = '[{"symptom":"Recent complaint","duration_val":1,"duration_unit":"days"}]'::jsonb
 where visit_id in (select ('c1130000-0000-4000-8000-0000000' || lpad(g::text, 5, '0'))::uuid from generate_series(10006, 10305) g);
do $do$
declare
  d constant uuid := 'c1130000-0000-4000-8000-000000000107';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c1130000-0000-4000-8000-00000000000a')::text, true);
  update public.visits v set status = 'completed', signed_by = d, signed_at = now() where v.doctor_id = d;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);

end
$do$;

-- The seal guard stamps now() on a signature; the fixture back-dates it with the triggers off (this transaction only, as amendment_snapshot does).
set local session_replication_role = replica;
update public.visits set signed_at = now() - interval '3 days' where id = 'c1130000-0000-4000-8000-000000002001';
update public.visits set signed_at = now() - interval '2 days' where id = 'c1130000-0000-4000-8000-000000002002';
update public.visits set signed_at = now() - interval '1 day' where id in ('c1130000-0000-4000-8000-000000002003', 'c1130000-0000-4000-8000-000000002006', 'c1130000-0000-4000-8000-000000002007');
-- Doctor A3's visit number 10001 is the oldest (signed 305 minutes ago), 10305 the newest.
update public.visits v set signed_at = now() - ((10306 - (substr(v.id::text, 29)::int)) || ' minutes')::interval
 where v.doctor_id = 'c1130000-0000-4000-8000-000000000107';
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
    return 'ok:' || coalesce(v_res, '');
  exception when others then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    return 'error:' || sqlstate || ':' || sqlerrm;
  end;
end
$f$;
-- The context as `p_user` with the clinic header `p_header`, asking for `p_arg`; the jsonb result (null when the call failed).
create function pg_temp.ctx(p_user uuid, p_header uuid, p_arg uuid) returns jsonb language sql as $f$
  select case when o like 'ok:%' then substr(o, 4)::jsonb end
    from (select pg_temp.act('authenticated', p_user, p_header, format('select public.consult_assist_context(%L)::text', p_arg)) as o) x
$f$;
create function pg_temp.as_a(p_user text) returns jsonb language sql as $f$
  select pg_temp.ctx(('c1130000-0000-4000-8000-000000000' || p_user)::uuid, 'c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-00000000000a')
$f$;
create function pg_temp.empty(p_out jsonb) returns boolean language sql as $f$
  select p_out is not null and p_out = '{"visits": 0, "pairs": [], "complaints": [], "diagnoses": [], "complaint_pairs": [], "last_exam_template": null, "rx_favourites": []}'::jsonb
$f$;

-- 1. Catalog ---------------------------------------------------------------------------------------------------------------------
select is((select prosecdef::text || ':' || provolatile::text || ':' || (proconfig @> array['search_path=""'])::text
            from pg_proc where oid = 'public.consult_assist_context(uuid)'::regprocedure), 'false:s:true',
  'consult_assist_context is SECURITY INVOKER, STABLE, search_path pinned');
select is((select has_function_privilege('authenticated', 'public.consult_assist_context(uuid)', 'EXECUTE')::text || ','
         || has_function_privilege('anon', 'public.consult_assist_context(uuid)', 'EXECUTE')::text || ','
         || has_function_privilege('service_role', 'public.consult_assist_context(uuid)', 'EXECUTE')::text),
  'true,false,false', 'EXECUTE for authenticated only (not anon, not service_role)');
select ok(pg_temp.act('anon', null, 'c1130000-0000-4000-8000-00000000000a', $$select public.consult_assist_context('c1130000-0000-4000-8000-00000000000a')::text$$)
  like 'error:42501:%', 'no session (anon) cannot execute it');

-- 2. The doctor sees their own aggregates -------------------------------------------------------------------------------------------
select is((pg_temp.as_a('102') ->> 'visits')::int, 3, 'doctor A1: three signed visits are read (the unsigned and the cancelled one are not)');
select is((select string_agg(lower(c ->> 'name') || '=' || (c ->> 'n'), ',' order by ord) from jsonb_array_elements(pg_temp.as_a('102') -> 'complaints') with ordinality as t(c, ord)),
  'fever=2,body ache=1,cough=1,headache=1', 'complaint frequencies are case-insensitive and ordered by count');
select is((select string_agg(lower(p ->> 'a') || '+' || lower(p ->> 'b') || '=' || (p ->> 'n'), ',' order by p ->> 'a', p ->> 'b')
             from jsonb_array_elements(pg_temp.as_a('102') -> 'complaint_pairs') as t(p)),
  'body ache+fever=1,cough+fever=1', 'which complaints this doctor records together (a sorts before b, counted per visit)');
select is((select string_agg(lower(p ->> 'complaint') || '>' || lower(p ->> 'diagnosis') || '=' || (p ->> 'n'), ',' order by p ->> 'complaint', p ->> 'diagnosis')
             from jsonb_array_elements(pg_temp.as_a('102') -> 'pairs') as t(p)
            where lower(p ->> 'complaint') in ('fever', 'cough', 'headache')),
  'cough>viral fever=1,fever>viral fever=2,headache>migraine=1', 'complaint-to-diagnosis co-occurrence counts visits');
select is((select string_agg(d ->> 'name', ',' order by ord) from jsonb_array_elements(pg_temp.as_a('102') -> 'diagnoses') with ordinality as t(d, ord)),
  'Migraine,Viral fever', 'recent diagnoses, most recently used first');
select is((select (d ->> 'n') || '|' || (d ->> 'icd11') || '|' || (d ->> 'follow_up_days')
             from jsonb_array_elements(pg_temp.as_a('102') -> 'diagnoses') as t(d) where d ->> 'name' = 'Viral fever'),
  '2|MG26|3', 'a diagnosis carries its count, its ICD-11 code and the usual follow-up gap in days (3)');
select is((select (d -> 'investigations')::text from jsonb_array_elements(pg_temp.as_a('102') -> 'diagnoses') as t(d) where d ->> 'name' = 'Viral fever'),
  '[{"n": 2, "name": "CBC"}, {"n": 1, "name": "Dengue NS1"}]', 'the usual investigations for a diagnosis, by count');
select is((select (d -> 'advice')::text from jsonb_array_elements(pg_temp.as_a('102') -> 'diagnoses') as t(d) where d ->> 'name' = 'Viral fever'),
  '[{"n": 2, "name": "Rest"}, {"n": 1, "name": "Fluids"}]', 'the usual advice for a diagnosis, by count');
select is((select (d -> 'follow_up_days')::text from jsonb_array_elements(pg_temp.as_a('102') -> 'diagnoses') as t(d) where d ->> 'name' = 'Migraine'),
  'null', 'a diagnosis with no follow-up has no usual gap');
select is(pg_temp.as_a('102') ->> 'last_exam_template', 'fever',
  'the last exam template is the latest valid id (the newer visit''s malformed id is ignored)');
select is((select count(*)::int from jsonb_array_elements(pg_temp.as_a('102') -> 'complaints') c where c ->> 'name' ~* '(unsigned|cancelled)'), 0,
  'unsigned and cancelled visits are not counted');

-- 3. Scope ------------------------------------------------------------------------------------------------------------------------
select is((select string_agg(lower(c ->> 'name') || '=' || (c ->> 'n'), ',') from jsonb_array_elements(pg_temp.as_a('103') -> 'complaints') as t(c)),
  'cough=1', 'another doctor of the same clinic gets their own aggregates (one Cough), not doctor A1''s');
select is((select string_agg(d ->> 'name', ',') from jsonb_array_elements(pg_temp.as_a('103') -> 'diagnoses') as t(d)), 'Allergic rhinitis',
  'and their own diagnoses only');
select ok(pg_temp.empty(pg_temp.as_a('101')), 'the owner holds the permission but has no signed visit of their own: nothing');
select ok(pg_temp.empty(pg_temp.as_a('105')), 'a nurse (consultations:view only) gets nothing');
select ok(pg_temp.empty(pg_temp.as_a('106')), 'a receptionist gets nothing');
select ok(pg_temp.empty(pg_temp.as_a('104')), 'an admin gets nothing');
select ok(pg_temp.empty(pg_temp.ctx('c1130000-0000-4000-8000-000000000102', 'c1130000-0000-4000-8000-00000000000a', 'c1130000-0000-4000-8000-00000000000b')),
  'a forged tenant id (clinic B while signed in to clinic A) gets nothing');
select ok(pg_temp.empty(pg_temp.ctx('c1130000-0000-4000-8000-000000000102', 'c1130000-0000-4000-8000-00000000000a', null)), 'a null tenant id gets nothing');
select ok(pg_temp.empty(pg_temp.ctx('c1130000-0000-4000-8000-000000000201', 'c1130000-0000-4000-8000-00000000000b', 'c1130000-0000-4000-8000-00000000000a')),
  'the owner of clinic B asking for clinic A gets nothing of it');
select is((select string_agg(lower(c ->> 'name'), ',') from jsonb_array_elements(pg_temp.ctx('c1130000-0000-4000-8000-000000000201', 'c1130000-0000-4000-8000-00000000000b', 'c1130000-0000-4000-8000-00000000000b') -> 'complaints') as t(c)),
  'clinic b complaint', 'and gets their own clinic''s aggregates in their own clinic');

-- 4. Shape: documented keys, no id anywhere -------------------------------------------------------------------------------------------
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.as_a('102')) k), 'complaint_pairs,complaints,diagnoses,last_exam_template,pairs,rx_favourites,visits',
  'the keys are exactly the documented ones');
select is((select string_agg(distinct k, ',' order by k) from jsonb_array_elements(pg_temp.as_a('102') -> 'diagnoses') d, jsonb_object_keys(d) k),
  'advice,chronic,custom,follow_up_days,icd11,investigations,n,name,rx,snomed', 'a diagnosis entry carries names, codes, flags and counts only (000119 adds rx)');
select is(pg_temp.as_a('102')::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', false,
  'no patient id, visit id or any uuid appears in the output');

-- 5. The limit: 300 newest -------------------------------------------------------------------------------------------------------------
select is((pg_temp.as_a('107') ->> 'visits')::int, 300, 'at most 300 signed visits are read');
select is((select string_agg(lower(c ->> 'name') || '=' || (c ->> 'n'), ',') from jsonb_array_elements(pg_temp.as_a('107') -> 'complaints') as t(c)),
  'recent complaint=300', 'the five oldest visits fall outside the window (newest first)');

select * from finish();
rollback;
