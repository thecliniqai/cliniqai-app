-- patient_search.test.sql — V2-08 08-02 (migration 000101).
--   P2-08  trigram GIN indexes on patients(full_name, phone, abha_id), and the planner uses them (sequential scans off, 5,000 rows).
--   R-11   public.search_patients (typeahead) and public.find_patient_duplicates (advisory): INVOKER, the session's clinic only,
--          minimal columns, ranking, short and wildcard queries empty, deleted patients and a not-full-access clinic empty.
--   R-12   public.register_patient: definer command, patients:edit, the AI objection stored, stamped and audited, replay, bad input.
-- Synthetic data only; every probe and the file roll back.
begin;
select plan(40);

-- Fixtures: clinic A (owner, receptionist, nurse), clinic B (owner), clinic C (no full access) ----------------------------------
insert into auth.users (id, email) values
  ('c1010000-0000-4000-8000-000000000101', 'c101-owner@example.test'),
  ('c1010000-0000-4000-8000-000000000105', 'c101-nurse@example.test'),
  ('c1010000-0000-4000-8000-000000000106', 'c101-receptionist@example.test'),
  ('c1010000-0000-4000-8000-000000000201', 'c101-owner-b@example.test'),
  ('c1010000-0000-4000-8000-000000000301', 'c101-owner-c@example.test');
insert into public.tenants (id, name) values
  ('c1010000-0000-4000-8000-00000000000a', 'Synthetic 08-02 Clinic A'),
  ('c1010000-0000-4000-8000-00000000000b', 'Synthetic 08-02 Clinic B'),
  ('c1010000-0000-4000-8000-00000000000c', 'Synthetic 08-02 Clinic C');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1010000-0000-4000-8000-00000000000a', 'c1010000-0000-4000-8000-00000000000b');
insert into public.memberships (user_id, tenant_id, role, full_name) values
  ('c1010000-0000-4000-8000-000000000101', 'c1010000-0000-4000-8000-00000000000a', 'owner', 'Synthetic Owner'),
  ('c1010000-0000-4000-8000-000000000105', 'c1010000-0000-4000-8000-00000000000a', 'nurse', 'Synthetic Nurse'),
  ('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a', 'receptionist', 'Synthetic Receptionist'),
  ('c1010000-0000-4000-8000-000000000201', 'c1010000-0000-4000-8000-00000000000b', 'owner', 'Synthetic Owner B'),
  ('c1010000-0000-4000-8000-000000000301', 'c1010000-0000-4000-8000-00000000000c', 'owner', 'Synthetic Owner C');
-- p1 and p2 share a family mobile; p2 has a waiting visit (a last visit); p3 has an ABHA id and a date of birth; p4 is deleted.
insert into public.patients (id, tenant_id, full_name, phone, age, sex, date_of_birth, abha_id, is_deleted, created_by) values
  ('c1010000-0000-4000-8000-000000001001', 'c1010000-0000-4000-8000-00000000000a', 'Synthetic Asha Verma', '+919000000111', 34, 'female', null, null, false, 'c1010000-0000-4000-8000-000000000101'),
  ('c1010000-0000-4000-8000-000000001002', 'c1010000-0000-4000-8000-00000000000a', 'Synthetic Asha Verma Jr', '+919000000111', 8, 'male', null, null, false, 'c1010000-0000-4000-8000-000000000101'),
  ('c1010000-0000-4000-8000-000000001003', 'c1010000-0000-4000-8000-00000000000a', 'Synthetic Ravi Kumar', '+919000000333', 52, 'male', '1974-05-05', '91-1234-5678-9012', false, 'c1010000-0000-4000-8000-000000000101'),
  ('c1010000-0000-4000-8000-000000001004', 'c1010000-0000-4000-8000-00000000000a', 'Synthetic Asha Deleted', '+919000000444', 40, 'female', null, null, true, 'c1010000-0000-4000-8000-000000000101'),
  ('c1010000-0000-4000-8000-000000001101', 'c1010000-0000-4000-8000-00000000000b', 'Synthetic Asha Other Clinic', '+919000000111', 30, 'female', null, null, false, 'c1010000-0000-4000-8000-000000000201'),
  ('c1010000-0000-4000-8000-000000001201', 'c1010000-0000-4000-8000-00000000000c', 'Synthetic Asha Third Clinic', '+919000000555', 30, 'female', null, null, false, 'c1010000-0000-4000-8000-000000000301');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1010000-0000-4000-8000-000000002001', 'c1010000-0000-4000-8000-00000000000a', 'c1010000-0000-4000-8000-000000001002',
   'c1010000-0000-4000-8000-000000000101', 'walk_in', 'waiting', 'c1010000-0000-4000-8000-000000000101');

-- Helper: as a signed-in user with the active-clinic header, the first column of p_sql (or of p_probe, run as postgres in the same
-- subtransaction when given); 'denied:<message>' (42501) or 'error:<sqlstate>:<message>'. Always rolled back.
create function pg_temp.as_user(p_user uuid, p_header uuid, p_sql text, p_probe text default null) returns text
language plpgsql as $f$
declare
  v_out text;
begin
  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    perform set_config('request.headers', json_build_object('x-clinicos-tenant', p_header)::text, true);
    set local role authenticated;
    execute p_sql into v_out;
    if p_probe is not null then
      reset role;
      execute p_probe into v_out;
    end if;
    raise exception 'c101 sentinel' using errcode = 'P0S03';
  exception
    when sqlstate 'P0S03' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

-- The plan text of a statement (as postgres).
create function pg_temp.plan_of(p_sql text) returns text language plpgsql as $f$
declare
  v_line text;
  v_out text := '';
begin
  for v_line in execute 'explain ' || p_sql loop
    v_out := v_out || v_line || E'\n';
  end loop;
  return v_out;
end;
$f$;

-- 1. P2-08: the indexes ------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_indexes
            where schemaname = 'public' and tablename = 'patients'
              and indexname in ('idx_patients_full_name_trgm', 'idx_patients_phone_trgm', 'idx_patients_abha_id_trgm')
              and indexdef like '%USING gin%gin_trgm_ops%'),
  3, 'P2-08: three trigram GIN indexes exist on patients (full_name, phone, abha_id)');

insert into public.patients (tenant_id, full_name, phone, abha_id, created_by)
select 'c1010000-0000-4000-8000-00000000000a', 'Synthetic Filler ' || n, '+9190000' || lpad((10000 + n)::text, 5, '0'),
       'filler-' || n, 'c1010000-0000-4000-8000-000000000101'
  from generate_series(1, 5000) n;
analyze public.patients;
set local enable_seqscan = off;
select alike(pg_temp.plan_of($$select id from public.patients where full_name ilike '%filler 4999%'$$),
  '%idx_patients_full_name_trgm%'::text, 'P2-08: a name substring search uses the full_name trigram index (5,000 rows, sequential scans off)'::text);
select alike(pg_temp.plan_of($$select id from public.patients where phone like '%900001234%'$$),
  '%idx_patients_phone_trgm%'::text, 'P2-08: a mobile digits search uses the phone trigram index'::text);
select alike(pg_temp.plan_of($$select id from public.patients where abha_id ilike '%filler-49%'$$),
  '%idx_patients_abha_id_trgm%'::text, 'P2-08: an ABHA substring search uses the abha_id trigram index'::text);
reset enable_seqscan;

-- 2. catalog: invoker reads, definer command, grants --------------------------------------------------------------------
select is((select prosecdef from pg_proc where oid = 'public.search_patients(text,integer)'::regprocedure), false,
  'search_patients is SECURITY INVOKER (RLS applies)');
select is((select prosecdef from pg_proc where oid = 'public.find_patient_duplicates(text,text,date,integer)'::regprocedure), false,
  'find_patient_duplicates is SECURITY INVOKER (RLS applies)');
select is((select prosecdef from pg_proc where oid = 'public.register_patient(uuid,jsonb,uuid)'::regprocedure), true,
  'register_patient is SECURITY DEFINER (the V2-07 command pattern)');
select is((select count(*)::int from pg_proc p
            where p.oid in ('public.search_patients(text,integer)'::regprocedure,
                            'public.find_patient_duplicates(text,text,date,integer)'::regprocedure,
                            'public.register_patient(uuid,jsonb,uuid)'::regprocedure)
              and p.proconfig @> array['search_path=""']), 3,
  'the three functions pin search_path to the empty string');
select is((select count(*)::int from pg_proc p
            where p.oid = 'public.register_patient(uuid,jsonb,uuid)'::regprocedure and p.proconfig @> array['lock_timeout=2s']),
  1, 'register_patient pins lock_timeout = 2s');
select set_eq(
  $$select p.proname || ':' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end
      from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid in ('public.search_patients(text,integer)'::regprocedure,
                     'public.find_patient_duplicates(text,text,date,integer)'::regprocedure,
                     'public.register_patient(uuid,jsonb,uuid)'::regprocedure)
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner$$,
  $$values ('search_patients:authenticated'), ('find_patient_duplicates:authenticated'), ('register_patient:authenticated')$$,
  'EXECUTE: authenticated only (not PUBLIC, anon or service_role)');
select is(pg_get_function_result('public.search_patients(text,integer)'::regprocedure),
  'TABLE(id uuid, full_name text, sex text, age integer, date_of_birth date, phone_last4 text, last_visit_at timestamp with time zone, rank integer)',
  'search_patients returns the minimal columns only (no address, allergies, ABHA or full number)');
select is(pg_get_function_result('public.find_patient_duplicates(text,text,date,integer)'::regprocedure),
  'TABLE(id uuid, full_name text, sex text, age integer, date_of_birth date, phone_last4 text, last_visit_at timestamp with time zone, reasons text[])',
  'find_patient_duplicates returns the minimal columns and the reasons only');

-- 3. search_patients ----------------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select string_agg(full_name, '|' order by rank, last_visit_at desc nulls last, full_name) from public.search_patients('asha')$$),
  'Synthetic Asha Verma Jr|Synthetic Asha Verma',
  'a receptionist finds her clinic''s patients by name; the one with a last visit comes first; the deleted patient and other clinics'' patients are not listed');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000105', 'c1010000-0000-4000-8000-00000000000a',
  $$select count(*)::text from public.search_patients('asha')$$), '2', 'a nurse (patients:view) can search too');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select string_agg(rank::text || ':' || phone_last4, ',' order by full_name) from public.search_patients('+91 90000 00111')$$),
  '1:0111,1:0111', 'a full mobile number ranks first (rank 1) and shows only the last four digits');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select (select last_visit_at is not null from public.search_patients('asha') where id = 'c1010000-0000-4000-8000-000000001002')::text
        || (select last_visit_at is null from public.search_patients('asha') where id = 'c1010000-0000-4000-8000-000000001001')::text$$),
  'truetrue', 'the last visit comes from a waiting, in-consultation or completed visit');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select string_agg(full_name, '|') from public.search_patients('5678')$$),
  'Synthetic Ravi Kumar', 'an ABHA fragment finds the patient');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select count(*)::text from public.search_patients('Synthetic')$$),
  '8', 'a query that matches thousands of patients lists the default 8');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select count(*)::text from public.search_patients('Synthetic', 3)$$), '3', 'the limit argument is honoured');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select count(*)::text from public.search_patients('Synthetic', 1000)$$), '25', 'the limit is capped at 25');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select (select count(*) from public.search_patients('a'))::text || ',' || (select count(*) from public.search_patients('98'))::text
      || ',' || (select count(*) from public.search_patients('%%'))::text || ',' || (select count(*) from public.search_patients('As%ha'))::text
      || ',' || (select count(*) from public.search_patients('___'))::text || ',' || (select count(*) from public.search_patients('  '))::text
      || ',' || (select count(*) from public.search_patients(null))::text$$),
  '0,0,0,0,0,0,0', 'one letter, two digits, wildcards, blanks and null find nothing (no wildcard oracle)');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select count(*)::text from public.search_patients('Deleted')$$), '0', 'a deleted patient is not listed');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000201', 'c1010000-0000-4000-8000-00000000000b',
  $$select string_agg(full_name, '|') from public.search_patients('asha')$$),
  'Synthetic Asha Other Clinic', 'clinic B''s owner sees only clinic B''s patients');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000301', 'c1010000-0000-4000-8000-00000000000c',
  $$select count(*)::text from public.search_patients('asha')$$), '0', 'a clinic without full access (not subscribed) has no search results');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000b',
  $$select string_agg(full_name, '|' order by full_name) from public.search_patients('asha')$$),
  'Synthetic Asha Verma|Synthetic Asha Verma Jr',
  'a header naming a clinic the user does not belong to changes nothing: the user''s own clinic, never clinic B''s patients');

-- 4. find_patient_duplicates --------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select string_agg(full_name || ' ' || age || ' ' || sex || ' ' || array_to_string(reasons, '+'), '|' order by age)
      from public.find_patient_duplicates('9000000111', null, null, null)$$),
  'Synthetic Asha Verma Jr 8 male same_mobile|Synthetic Asha Verma 34 female same_mobile',
  'a shared family mobile returns every patient on it with age and sex (clinic B''s patient with the same number is not returned)');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select string_agg(full_name || ' ' || array_to_string(reasons, '+'), '|') from public.find_patient_duplicates(null, '  synthetic ASHA verma ', null, 36)$$),
  'Synthetic Asha Verma same_name_age', 'the same name and an age within two years is a candidate; a different age is not');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select string_agg(full_name || ' ' || array_to_string(reasons, '+'), '|') from public.find_patient_duplicates(null, 'Synthetic Ravi Kumar', '1974-05-05', null)$$),
  'Synthetic Ravi Kumar same_name_dob', 'the same name and date of birth is a candidate');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select count(*)::text from public.find_patient_duplicates(null, 'Synthetic Ravi Kumar', null, 70)$$),
  '0', 'the same name alone, with no matching age or date of birth, is not a candidate');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select (select count(*) from public.find_patient_duplicates('12345', 'ab', null, 30))::text || ',' || (select count(*) from public.find_patient_duplicates('5000000111', null, null, null))::text$$),
  '0,0', 'a short name with no mobile, and a number that is not an Indian mobile, find nothing');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000301', 'c1010000-0000-4000-8000-00000000000c',
  $$select count(*)::text from public.find_patient_duplicates('9000000555', null, null, null)$$), '0',
  'a clinic without full access gets no duplicates');

-- 5. register_patient ---------------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select public.register_patient('c1010000-0000-4000-8000-00000000000a',
      '{"full_name":"Synthetic Registered One","phone":"9000000701","age":29,"sex":"female","ai_processing_objected":true}'::jsonb,
      'c1010000-0000-4000-8000-0000000c0001')$$,
  $$select (select count(*) from public.patients where full_name = 'Synthetic Registered One' and ai_processing_objected
              and objected_at is not null and objection_recorded_by = 'c1010000-0000-4000-8000-000000000106'
              and created_by = 'c1010000-0000-4000-8000-000000000106' and phone = '+919000000701' and age = 29)::text$$),
  '1', 'a receptionist registers a patient: stored with the objection, its stamp and the actor');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select public.register_patient('c1010000-0000-4000-8000-00000000000a',
      '{"full_name":"Synthetic Registered Two","phone":"9000000702","age":29,"ai_processing_objected":true}'::jsonb,
      'c1010000-0000-4000-8000-0000000c0002')$$,
  $$select (select count(*) from public.audit_logs a join public.patients p on p.id = a.entity_id
             where p.full_name = 'Synthetic Registered Two' and a.action in ('patient.create', 'patient.ai_objection.set'))::text$$),
  '2', 'the registration is audited (patient.create) and so is the objection (patient.ai_objection.set)');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select public.register_patient('c1010000-0000-4000-8000-00000000000a',
      '{"full_name":"Synthetic Registered Three","phone":"9000000703","age":29}'::jsonb, 'c1010000-0000-4000-8000-0000000c0003')$$,
  $$select (select count(*) from public.patients where full_name = 'Synthetic Registered Three' and not ai_processing_objected and objected_at is null)::text$$),
  '1', 'without the key the objection is false and unstamped');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select (a.r ->> 'patient_id' = b.r ->> 'patient_id')::text from
      (select public.register_patient('c1010000-0000-4000-8000-00000000000a',
         '{"full_name":"Synthetic Registered Four","phone":"9000000704","age":29}'::jsonb, 'c1010000-0000-4000-8000-0000000c0004') r) a,
      (select public.register_patient('c1010000-0000-4000-8000-00000000000a',
         '{"full_name":"Synthetic Registered Four","phone":"9000000704","age":29}'::jsonb, 'c1010000-0000-4000-8000-0000000c0004') r) b$$,
  $$select (select count(*) from public.patients where full_name = 'Synthetic Registered Four')::text$$),
  '1', 'the same request id registers once');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select public.register_patient('c1010000-0000-4000-8000-00000000000a', '{"full_name":"Synthetic Bad","phone":"9000000705","age":29,"role":"x"}'::jsonb,
      'c1010000-0000-4000-8000-0000000c0005')$$),
  'error:P0001:INPUT_INVALID', 'an unknown key is refused');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select public.register_patient('c1010000-0000-4000-8000-00000000000a', '{"full_name":"Synthetic Bad","phone":"9000000706","age":29,"ai_processing_objected":"yes"}'::jsonb,
      'c1010000-0000-4000-8000-0000000c0006')$$),
  'error:P0001:INPUT_INVALID', 'a non-boolean objection is refused');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000106', 'c1010000-0000-4000-8000-00000000000a',
  $$select public.register_patient('c1010000-0000-4000-8000-00000000000b', '{"full_name":"Synthetic Elsewhere","phone":"9000000707","age":29}'::jsonb,
      'c1010000-0000-4000-8000-0000000c0007')$$),
  'error:P0002:PATIENT_NOT_FOUND', 'acting in A, naming clinic B, is refused');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000105', 'c1010000-0000-4000-8000-00000000000a',
  $$select public.register_patient('c1010000-0000-4000-8000-00000000000a', '{"full_name":"Synthetic Nurse Reg","phone":"9000000708","age":29}'::jsonb,
      'c1010000-0000-4000-8000-0000000c0008')$$,
  $$select (select count(*) from public.patients where full_name = 'Synthetic Nurse Reg')::text$$),
  '1', 'a nurse registers a patient (patients:edit)');
select is(pg_temp.as_user('c1010000-0000-4000-8000-000000000301', 'c1010000-0000-4000-8000-00000000000c',
  $$select public.register_patient('c1010000-0000-4000-8000-00000000000c', '{"full_name":"Synthetic Locked Reg","phone":"9000000709","age":29}'::jsonb,
      'c1010000-0000-4000-8000-0000000c0009')$$),
  'error:P0002:PATIENT_NOT_FOUND', 'a clinic without full access cannot register a patient');

select * from finish();
rollback;
