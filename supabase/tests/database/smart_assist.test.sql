-- smart_assist.test.sql — V2-08 08-05 (migration 000105).
--   AI-14  private.name_normalize (pure, immutable) and its trigram index; public.find_patient_duplicates with the Smart Assist rules
--          (entitled: similar names, strength) and without them (the 08-02 rules, every row possible); 10,000 patients use the index
--          and answer in under 50 ms.
--   AI-13  public.slot_suggestion_context: invoker read, the caller's clinic only, counts and a band.
-- Synthetic data only; every probe and the file roll back.
begin;
select plan(30);

insert into auth.users (id, email) values
  ('c1050000-0000-4000-8000-000000000101', 'c105-owner@example.test'),
  ('c1050000-0000-4000-8000-000000000106', 'c105-receptionist@example.test'),
  ('c1050000-0000-4000-8000-000000000201', 'c105-owner-b@example.test'),
  ('c1050000-0000-4000-8000-000000000301', 'c105-owner-c@example.test');
insert into public.tenants (id, name) values
  ('c1050000-0000-4000-8000-00000000000a', 'Synthetic 08-05 Clinic A'),
  ('c1050000-0000-4000-8000-00000000000b', 'Synthetic 08-05 Clinic B'),
  ('c1050000-0000-4000-8000-00000000000c', 'Synthetic 08-05 Clinic C (no Smart Assist)');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1050000-0000-4000-8000-00000000000a', 'c1050000-0000-4000-8000-00000000000b', 'c1050000-0000-4000-8000-00000000000c');
insert into public.tenant_entitlement_overrides (tenant_id, key, enabled, reason) values
  ('c1050000-0000-4000-8000-00000000000c', 'assist.duplicates', false, 'Synthetic test: Smart Assist duplicates off');
insert into public.memberships (user_id, tenant_id, role, full_name) values
  ('c1050000-0000-4000-8000-000000000101', 'c1050000-0000-4000-8000-00000000000a', 'owner', 'Synthetic Owner'),
  ('c1050000-0000-4000-8000-000000000106', 'c1050000-0000-4000-8000-00000000000a', 'receptionist', 'Synthetic Receptionist'),
  ('c1050000-0000-4000-8000-000000000201', 'c1050000-0000-4000-8000-00000000000b', 'owner', 'Synthetic Owner B'),
  ('c1050000-0000-4000-8000-000000000301', 'c1050000-0000-4000-8000-00000000000c', 'owner', 'Synthetic Owner C');
insert into public.patients (id, tenant_id, full_name, phone, age, sex, date_of_birth, created_by) values
  ('c1050000-0000-4000-8000-000000001001', 'c1050000-0000-4000-8000-00000000000a', 'Mohammed Rafi', '+919000000111', 35, 'male', '1990-02-03', 'c1050000-0000-4000-8000-000000000101'),
  ('c1050000-0000-4000-8000-000000001002', 'c1050000-0000-4000-8000-00000000000a', 'Kavita Rao', '+919000000222', 62, 'female', null, 'c1050000-0000-4000-8000-000000000101'),
  ('c1050000-0000-4000-8000-000000001101', 'c1050000-0000-4000-8000-00000000000b', 'Mohammed Rafi', '+919000000111', 35, 'male', '1990-02-03', 'c1050000-0000-4000-8000-000000000201'),
  ('c1050000-0000-4000-8000-000000001201', 'c1050000-0000-4000-8000-00000000000c', 'Mohammed Rafi', '+919000000111', 35, 'male', '1990-02-03', 'c1050000-0000-4000-8000-000000000301');

create function pg_temp.as_user(p_user uuid, p_header uuid, p_sql text) returns text
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
    raise exception 'c105 sentinel' using errcode = 'P0S03';
  exception
    when sqlstate 'P0S03' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

-- Milliseconds of p_sql run as the user (after one warm-up run); always rolled back.
create function pg_temp.ms_as_user(p_user uuid, p_header uuid, p_sql text) returns numeric
language plpgsql as $f$
declare
  v_t0 timestamptz;
  v_ms numeric;
begin
  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    perform set_config('request.headers', json_build_object('x-clinicos-tenant', p_header)::text, true);
    set local role authenticated;
    execute p_sql;
    v_t0 := clock_timestamp();
    execute p_sql;
    v_ms := extract(epoch from clock_timestamp() - v_t0) * 1000;
    raise exception 'c105 sentinel' using errcode = 'P0S03';
  exception
    when sqlstate 'P0S03' then null;
  end;
  return v_ms;
end;
$f$;

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

-- 1. private.name_normalize -----------------------------------------------------------------------------------------------
select is(private.name_normalize('Dr. Mohd  Rafi'), 'mohamed rafi', 'name_normalize: lower case, punctuation and the honorific dropped, Mohd as mohammed (letters collapsed)');
select is(private.name_normalize('Rakesh Kr Sharma'), private.name_normalize('Rakesh Kumar Sharma'), 'name_normalize: Kr is Kumar');
select is(private.name_normalize('Smt Meena Devi'), private.name_normalize('Shrimati Mina Devi'), 'name_normalize: Smt is Shrimati, ee is i');
select is(private.name_normalize('Sharma Rakesh'), private.name_normalize('rakesh  SHARMA.'), 'name_normalize: word order, case and punctuation do not matter');
select is(private.name_normalize(null) || '|' || private.name_normalize('  . ') || '|' || private.name_normalize('Dr'), '||', 'name_normalize: nothing in, nothing out');
select is((select provolatile::text || proparallel::text from pg_proc where oid = 'private.name_normalize(text)'::regprocedure), 'is', 'name_normalize is IMMUTABLE and PARALLEL SAFE (the expression of an index)');
select is((select has_function_privilege('authenticated', 'private.name_normalize(text)', 'EXECUTE')::text
           || has_function_privilege('service_role', 'private.name_normalize(text)', 'EXECUTE')::text
           || has_function_privilege('anon', 'private.name_normalize(text)', 'EXECUTE')::text), 'truetruefalse',
  'name_normalize: EXECUTE for authenticated and service_role (the index expression runs as the inserting role), not anon');
select alike((select indexdef from pg_indexes where schemaname = 'public' and indexname = 'idx_patients_name_normalized_trgm'),
  '%USING gin (private.name_normalize(full_name)%gin_trgm_ops)%', 'a trigram GIN index exists on the normalised name');

-- 2. catalog --------------------------------------------------------------------------------------------------------------
select is((select prosecdef::text || array_to_string(proconfig, ',') from pg_proc where oid = 'public.find_patient_duplicates(text,text,date,integer)'::regprocedure),
  'truesearch_path=""', 'find_patient_duplicates is SECURITY DEFINER (the planner cannot use the trigram index under RLS) with search_path pinned');
select is((select prosecdef::text || array_to_string(proconfig, ',') from pg_proc where oid = 'public.slot_suggestion_context(uuid,uuid)'::regprocedure),
  'falsesearch_path=""', 'slot_suggestion_context is SECURITY INVOKER with search_path pinned');
select set_eq(
  $$select p.proname || ':' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end
      from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid in ('public.find_patient_duplicates(text,text,date,integer)'::regprocedure, 'public.slot_suggestion_context(uuid,uuid)'::regprocedure)
       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner$$,
  $$values ('find_patient_duplicates:authenticated'), ('slot_suggestion_context:authenticated')$$,
  'EXECUTE: authenticated only (not PUBLIC, anon or service_role)');
select is(pg_get_function_result('public.slot_suggestion_context(uuid,uuid)'::regprocedure),
  'TABLE(avg_consult_minutes integer, consult_samples integer, preferred_band text)', 'slot_suggestion_context returns counts and a band only');

-- 3. find_patient_duplicates: Smart Assist ----------------------------------------------------------------------------------
select is(pg_temp.as_user('c1050000-0000-4000-8000-000000000106', 'c1050000-0000-4000-8000-00000000000a',
  $$select string_agg(full_name || ':' || strength || ':' || array_to_string(reasons, '+'), '|') from public.find_patient_duplicates('9000000111', 'Md Rafi', null, null)$$),
  'Mohammed Rafi:strong:same_mobile', 'entitled: the same mobile with a short-form name is strong');
select is(pg_temp.as_user('c1050000-0000-4000-8000-000000000106', 'c1050000-0000-4000-8000-00000000000a',
  $$select string_agg(full_name || ':' || strength || ':' || array_to_string(reasons, '+'), '|') from public.find_patient_duplicates('9899900000', 'Rafi Mohd', '1990-02-03', 36)$$),
  'Mohammed Rafi:strong:same_name_dob+same_name_age', 'entitled: a similar name (word order, short form) with the same date of birth is strong, with the age evidence too');
select is(pg_temp.as_user('c1050000-0000-4000-8000-000000000106', 'c1050000-0000-4000-8000-00000000000a',
  $$select string_agg(full_name || ':' || strength, '|') from public.find_patient_duplicates('9000000222', 'Arjun Rao', null, 9)$$),
  'Kavita Rao:possible', 'entitled: the same mobile with another name (a family number) is possible');
select is(pg_temp.as_user('c1050000-0000-4000-8000-000000000106', 'c1050000-0000-4000-8000-00000000000a',
  $$select count(*)::text from public.find_patient_duplicates('9899900000', 'Rafi Mohd', null, null)$$),
  '0', 'entitled: a similar name alone (no mobile, date of birth or age evidence) is not a candidate');
select is(pg_temp.as_user('c1050000-0000-4000-8000-000000000201', 'c1050000-0000-4000-8000-00000000000b',
  $$select string_agg(id::text, '|') from public.find_patient_duplicates('9000000111', 'Md Rafi', null, null)$$),
  'c1050000-0000-4000-8000-000000001101', 'clinic B sees only its own patient with the same number');

-- 4. without the entitlement: the 08-02 rules, every row possible --------------------------------------------------------------
select is(pg_temp.as_user('c1050000-0000-4000-8000-000000000301', 'c1050000-0000-4000-8000-00000000000c',
  $$select string_agg(full_name || ':' || strength || ':' || array_to_string(reasons, '+'), '|') from public.find_patient_duplicates('9000000111', 'Md Rafi', null, null)$$),
  'Mohammed Rafi:possible:same_mobile', 'not entitled: the same mobile is still found, as possible');
select is(pg_temp.as_user('c1050000-0000-4000-8000-000000000301', 'c1050000-0000-4000-8000-00000000000c',
  $$select count(*)::text from public.find_patient_duplicates('9899900000', 'Rafi Mohammed', '1990-02-03', null)$$),
  '0', 'not entitled: a similar (not equal) name with the same date of birth is not a candidate');
select is(pg_temp.as_user('c1050000-0000-4000-8000-000000000301', 'c1050000-0000-4000-8000-00000000000c',
  $$select string_agg(strength || ':' || array_to_string(reasons, '+'), '|') from public.find_patient_duplicates('9899900000', ' MOHAMMED rafi ', '1990-02-03', null)$$),
  'possible:same_name_dob', 'not entitled: the exact name (any case) with the date of birth is the basic rule, possible');
select is(pg_temp.as_user('c1050000-0000-4000-8000-000000000106', 'c1050000-0000-4000-8000-00000000000a',
  $$select count(*)::text from public.find_patient_duplicates('1', null, null, null)$$), '0', 'no mobile and no name: nothing');

-- 5. slot_suggestion_context ----------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c1050000-0000-4000-8000-000000000106', 'c1050000-0000-4000-8000-00000000000a',
  $$select coalesce(avg_consult_minutes::text, 'null') || ',' || consult_samples || ',' || coalesce(preferred_band, 'null')
      from public.slot_suggestion_context('c1050000-0000-4000-8000-000000000101', 'c1050000-0000-4000-8000-000000001001')$$),
  'null,0,null', 'a receptionist reads the context: no samples and no history, nulls');
select is(pg_temp.as_user('c1050000-0000-4000-8000-000000000106', 'c1050000-0000-4000-8000-00000000000a',
  $$select count(*)::text from public.slot_suggestion_context(null, null)$$), '0', 'no doctor, no row');
select is(pg_temp.as_user('c1050000-0000-4000-8000-000000000106', 'c1050000-0000-4000-8000-00000000000b',
  $$select count(*)::text from public.slot_suggestion_context('c1050000-0000-4000-8000-000000000201', null)$$), '1',
  'a header naming a clinic the user does not belong to changes nothing: the user''s own clinic answers, never clinic B''s');

insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by, scheduled_at) values
  ('c1050000-0000-4000-8000-000000002001', 'c1050000-0000-4000-8000-00000000000a', 'c1050000-0000-4000-8000-000000001001',
   'c1050000-0000-4000-8000-000000000101', 'scheduled', 'completed', 'c1050000-0000-4000-8000-000000000101', (current_date - 3) + time '12:30'),
  ('c1050000-0000-4000-8000-000000002002', 'c1050000-0000-4000-8000-00000000000a', 'c1050000-0000-4000-8000-000000001001',
   'c1050000-0000-4000-8000-000000000101', 'scheduled', 'completed', 'c1050000-0000-4000-8000-000000000101', (current_date - 2) + time '12:45');
select is(pg_temp.as_user('c1050000-0000-4000-8000-000000000106', 'c1050000-0000-4000-8000-00000000000a',
  $$select preferred_band from public.slot_suggestion_context('c1050000-0000-4000-8000-000000000101', 'c1050000-0000-4000-8000-000000001001')$$),
  'evening', 'the patient''s band is the most frequent time of day of attended visits in the clinic zone (12:30 and 12:45 UTC are 18:00 and 18:15 in Asia/Kolkata)');
select is(pg_temp.as_user('c1050000-0000-4000-8000-000000000201', 'c1050000-0000-4000-8000-00000000000b',
  $$select coalesce(preferred_band, 'null') from public.slot_suggestion_context('c1050000-0000-4000-8000-000000000201', 'c1050000-0000-4000-8000-000000001001')$$),
  'null', 'clinic B''s owner asking about clinic A''s patient gets no band (the caller''s clinic only)');

-- 6. 10,000 patients: the trigram indexes serve the lookup and it answers in under 50 ms --------------------------------------
insert into public.patients (tenant_id, full_name, phone, age, created_by)
select 'c1050000-0000-4000-8000-00000000000a', 'Synthetic Filler ' || md5(n::text) || ' Person', '+9170' || lpad((10000000 + n)::text, 8, '0'), 20 + (n % 50),
       'c1050000-0000-4000-8000-000000000101'
  from generate_series(1, 10000) n;
analyze public.patients;
select is((select count(*)::int from public.patients where tenant_id = 'c1050000-0000-4000-8000-00000000000a'), 10002, 'the seed holds 10,002 patients in clinic A');
set local enable_seqscan = off;
select alike(pg_temp.plan_of(format($$select id from public.patients where tenant_id = 'c1050000-0000-4000-8000-00000000000a'
   and private.name_normalize(full_name) operator(%I.%%) 'mohamed rafi'$$, (select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm'))),
  '%idx_patients_name_normalized_trgm%'::text, 'the name rule uses the normalised-name trigram index at 10,000 patients'::text);
reset enable_seqscan;
select cmp_ok(pg_temp.ms_as_user('c1050000-0000-4000-8000-000000000106', 'c1050000-0000-4000-8000-00000000000a',
  $$select count(*) from public.find_patient_duplicates('9000000111', 'Md Rafi', '1990-02-03', 36)$$), '<', 50::numeric,
  'the Smart Assist duplicate lookup answers in under 50 ms at 10,000 patients (mobile and name)');
select cmp_ok(pg_temp.ms_as_user('c1050000-0000-4000-8000-000000000106', 'c1050000-0000-4000-8000-00000000000a',
  $$select count(*) from public.find_patient_duplicates('9899900000', 'Rafi Mohammed', '1990-02-03', 36)$$), '<', 50::numeric,
  'and under 50 ms for a name only (no mobile match)');

select * from finish();
rollback;
