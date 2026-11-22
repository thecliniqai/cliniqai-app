-- rx_review_fixes.test.sql — V2-09c 09C-06a (migration 000120_rx_review_fixes; 09C-REVIEW-SEC S-1, S-2, S-5, S-6, S-7; 09C-REVIEW-A A-7, A-8).
--
-- 1. S-1: the rule matches by substance OR name (a coded allergy is caught by the printed name when the line's ids say another substance); change_prescription
--    refuses a catalogue id whose brand is not the line's medicine and stores the catalogue's name, generic and form; repeat_visit_plan copies a line with a
--    forged id as a medicine outside the catalogue (an allergen line is left out); rx_allergy_context shows the match of a forged-id line.
-- 2. S-2: every allergy write leaves a counts-only patient.allergies_change row (a nurse's direct UPDATE, a system write, the command); a write that does not
--    change the allergies leaves none.
-- 3. S-5: patients.allergies has no default; an insert without it is "not recorded".
-- 4. S-6: record_patient_allergies refuses an erased and a deleted patient.
-- 5. S-7: a member reads only their own custom medicines.
-- 6. A-8: record_patient_allergies(…, p_expected, …) replaces the 4-argument function; a stored list that differs from p_expected is ALLERGIES_CHANGED and
--    nothing is written; a replay after a commit is answered as a replay.
-- (S-8, the FOR SHARE read, needs two sessions: tests/prescriptions/rx-review-fixes-db.spec.ts.) Every call runs under the real principal. The file rolls
-- back. Synthetic data only.
begin;
select plan(39);

-- Fixtures ----------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1200000-0000-4000-8000-000000000101', 'c120-owner-a@example.test'),
  ('c1200000-0000-4000-8000-000000000102', 'c120-doctor-a@example.test'),
  ('c1200000-0000-4000-8000-000000000104', 'c120-nurse-a@example.test'),
  ('c1200000-0000-4000-8000-000000000105', 'c120-receptionist-a@example.test'),
  ('c1200000-0000-4000-8000-000000000106', 'c120-doctor2-a@example.test'),
  ('c1200000-0000-4000-8000-000000000201', 'c120-owner-b@example.test');
insert into public.tenants (id, name) values
  ('c1200000-0000-4000-8000-00000000000a', 'Synthetic 09C-06a Clinic A'),
  ('c1200000-0000-4000-8000-00000000000b', 'Synthetic 09C-06a Clinic B');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1200000-0000-4000-8000-00000000000a', 'c1200000-0000-4000-8000-00000000000b');
insert into public.memberships (user_id, tenant_id, role) values
  ('c1200000-0000-4000-8000-000000000101', 'c1200000-0000-4000-8000-00000000000a', 'owner'),
  ('c1200000-0000-4000-8000-000000000102', 'c1200000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1200000-0000-4000-8000-000000000104', 'c1200000-0000-4000-8000-00000000000a', 'nurse'),
  ('c1200000-0000-4000-8000-000000000105', 'c1200000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c1200000-0000-4000-8000-000000000106', 'c1200000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1200000-0000-4000-8000-000000000201', 'c1200000-0000-4000-8000-00000000000b', 'owner');
-- P1 is allergic to the coded substance Qzxrfamox; P2 is not recorded (the S-2 writes); P3 erased, P4 deleted (S-6); P5 knows Qzxrfsulfa, P6 is not
-- recorded (A-8). The allergies are named explicitly: the column has no default any more (S-5).
insert into public.patients (id, tenant_id, full_name, phone, created_by, allergies) values
  ('c1200000-0000-4000-8000-000000001001', 'c1200000-0000-4000-8000-00000000000a', 'Synthetic Fix Patient One', '+919000012001', 'c1200000-0000-4000-8000-000000000101', array['Qzxrfamox']),
  ('c1200000-0000-4000-8000-000000001002', 'c1200000-0000-4000-8000-00000000000a', 'Synthetic Fix Patient Two', '+919000012002', 'c1200000-0000-4000-8000-000000000101', null),
  ('c1200000-0000-4000-8000-000000001003', 'c1200000-0000-4000-8000-00000000000a', 'Synthetic Fix Patient Three', '+919000012003', 'c1200000-0000-4000-8000-000000000101', null),
  ('c1200000-0000-4000-8000-000000001004', 'c1200000-0000-4000-8000-00000000000a', 'Synthetic Fix Patient Four', '+919000012004', 'c1200000-0000-4000-8000-000000000101', null),
  ('c1200000-0000-4000-8000-000000001005', 'c1200000-0000-4000-8000-00000000000a', 'Synthetic Fix Patient Five', '+919000012005', 'c1200000-0000-4000-8000-000000000101', array['Qzxrfsulfa']),
  ('c1200000-0000-4000-8000-000000001006', 'c1200000-0000-4000-8000-00000000000a', 'Synthetic Fix Patient Six', '+919000012006', 'c1200000-0000-4000-8000-000000000101', null);
update public.patients set is_deleted = true, erased_at = now(), erasure_reason = 'Synthetic erasure', full_name = 'Erased' where id = 'c1200000-0000-4000-8000-000000001003';
update public.patients set is_deleted = true where id = 'c1200000-0000-4000-8000-000000001004';

-- The catalogue (global reference rows): two substances, their generics, a brand of each.
insert into public.cdci_substances (id, substance_name) values ('test-sub-09c-rf-amox', 'Qzxrfamox'), ('test-sub-09c-rf-para', 'Qzxrfpara');
insert into public.cdci_generics (id, generic_name, substance_ids) values
  ('test-gen-09c-rf-amox', 'Qzxrfamox', array['test-sub-09c-rf-amox']), ('test-gen-09c-rf-para', 'Qzxrfpara', array['test-sub-09c-rf-para']);
insert into public.cdci_brands (id, brand_name, generic_id) values
  ('test-cdci-09c-rf-amox', 'Qzxrfamoxbrand 500', 'test-gen-09c-rf-amox'), ('test-cdci-09c-rf-para', 'Qzxrfparabrand 500', 'test-gen-09c-rf-para');
insert into public.cdci_medicines_search (id, brand_name, generic_name, dose_form) values
  ('test-cdci-09c-rf-amox', 'Qzxrfamoxbrand 500', 'Qzxrfamox', 'Capsule'), ('test-cdci-09c-rf-para', 'Qzxrfparabrand 500', 'Qzxrfpara', 'Tablet');

-- Visits of P1: D 2001 and E 2002 drafts (the commands), T 2003 the repeat target, S 2004 the signed source whose header holds three lines written before the
-- fix could refuse them: a line named for the allergen with the paracetamol brand's id (forged), a plain line with the same forged id, the real brand.
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by)
select ('c1200000-0000-4000-8000-00000000' || v.n)::uuid, 'c1200000-0000-4000-8000-00000000000a', 'c1200000-0000-4000-8000-000000001001',
       'c1200000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1200000-0000-4000-8000-000000000101'
  from (values ('2001'), ('2002'), ('2003'), ('2004')) as v(n);
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id, version, status)
values ('c1200000-0000-4000-8000-0000000d2004', 'c1200000-0000-4000-8000-00000000000a', 'c1200000-0000-4000-8000-000000002004', 'c1200000-0000-4000-8000-000000001001', 'c1200000-0000-4000-8000-000000000102', 1, 'active'),
       ('c1200000-0000-4000-8000-0000000d2002', 'c1200000-0000-4000-8000-00000000000a', 'c1200000-0000-4000-8000-000000002002', 'c1200000-0000-4000-8000-000000001001', 'c1200000-0000-4000-8000-000000000102', 1, 'active');
insert into public.prescription_items (tenant_id, prescription_id, medicine_name, generic_name, dose_form, dosage, timing, duration, cdci_brand_id, sort_order) values
  ('c1200000-0000-4000-8000-00000000000a', 'c1200000-0000-4000-8000-0000000d2004', 'Qzxrfamox 500', 'Qzxrfamox', null, '1-0-1', null, '5 days', 'test-cdci-09c-rf-para', 0),
  ('c1200000-0000-4000-8000-00000000000a', 'c1200000-0000-4000-8000-0000000d2004', 'Qzxrfplain 10', null, null, '0-0-1', null, '3 days', 'test-cdci-09c-rf-para', 1),
  ('c1200000-0000-4000-8000-00000000000a', 'c1200000-0000-4000-8000-0000000d2004', 'Qzxrfparabrand 500', 'Qzxrfpara', 'Tablet', '1-1-1', null, '3 days', 'test-cdci-09c-rf-para', 2),
  ('c1200000-0000-4000-8000-00000000000a', 'c1200000-0000-4000-8000-0000000d2002', 'Qzxrfamox 500', 'Qzxrfamox', null, '1-0-1', null, '5 days', 'test-cdci-09c-rf-para', 0);
update public.prescriptions set signed_at = now() where id = 'c1200000-0000-4000-8000-0000000d2004';
update public.clinical_notes set clinical_notes = 'Synthetic signed note' where visit_id = 'c1200000-0000-4000-8000-000000002004';
do $do$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c1200000-0000-4000-8000-000000000102', 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c1200000-0000-4000-8000-00000000000a')::text, true);
  update public.visits set status = 'completed', signed_at = now(), signed_by = 'c1200000-0000-4000-8000-000000000102' where id = 'c1200000-0000-4000-8000-000000002004';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end
$do$;
-- Doctor 2's own custom medicine (S-7).
insert into public.doctor_custom_medicines (tenant_id, doctor_id, medicine_name, default_dosage, default_duration)
values ('c1200000-0000-4000-8000-00000000000a', 'c1200000-0000-4000-8000-000000000106', 'Qzxrf doctor2 custom', '1-1-1', '10 days');

-- Runs one statement under a real principal and returns 'ok:<result>' or 'error:<sqlstate>:<message>'; the work is kept when it succeeds and undone when it fails.
create function pg_temp.act(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_res text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c1200000-0000-4000-8000-00000000000a')::text, true);
    execute 'set local role authenticated';
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
create function pg_temp.jres(p_out text) returns jsonb language sql as $f$ select substr(p_out, 4)::jsonb $f$;
create function pg_temp.change(p_visit uuid, p_changes jsonb) returns text language sql as $f$
  select pg_temp.act('c1200000-0000-4000-8000-000000000102',
    format('select public.change_prescription(%L, %L, %L::jsonb, gen_random_uuid())::text', 'c1200000-0000-4000-8000-00000000000a', p_visit, p_changes))
$f$;
create function pg_temp.record(p_user uuid, p_patient uuid, p_list jsonb, p_expected jsonb, p_req uuid default gen_random_uuid()) returns text language sql as $f$
  select pg_temp.act(p_user,
    format('select public.record_patient_allergies(%L, %L, %L::jsonb, %L::jsonb, %L)::text', 'c1200000-0000-4000-8000-00000000000a', p_patient, p_list, p_expected, p_req))
$f$;
create function pg_temp.items_of(p_visit uuid) returns text language sql as $f$
  select coalesce(string_agg(i.medicine_name || '|' || coalesce(i.generic_name, '-') || '|' || coalesce(i.dose_form, '-') || '|' || coalesce(i.cdci_brand_id, '-'), ';' order by i.sort_order), '')
    from public.prescription_items i join public.prescriptions p on p.id = i.prescription_id where p.visit_id = p_visit
$f$;
create function pg_temp.changes_of(p_patient uuid) returns text language sql as $f$
  select coalesce(string_agg(a.actor_type || '/' || a.actor_role || ':' || a.metadata::text, ';' order by a.id), '')
    from public.audit_logs a where a.action = 'patient.allergies_change' and a.entity_id = p_patient
$f$;

-- 1. S-1 ----------------------------------------------------------------------------------------------------------------------------------------------
select is(private.rx_allergy_matches(array['Qzxrfamox'], array['test-sub-09c-rf-para'], array['Qzxrfamox 500', 'Qzxrfamox']), array['Qzxrfamox'],
  'a coded allergy matches a line named for it even when the line''s ids say another substance (substance OR name)');
select is(private.rx_allergy_matches(array['Qzxrfamox'], array['test-sub-09c-rf-para'], array['Qzxrfparabrand 500', 'Qzxrfpara']), array[]::text[],
  'a coded allergy does not match a line of another substance with another name');
select is(pg_temp.change('c1200000-0000-4000-8000-000000002001',
    '{"add":[{"medicine_name":"Qzxrfamox 500","generic_name":"Qzxrfamox","dosage":"1-0-1","duration":"5 days","cdci_brand_id":"test-cdci-09c-rf-para"}]}'),
  'error:P0001:INPUT_INVALID', 'the review''s P1 exploit (the allergen''s name with another brand''s id) is INPUT_INVALID');
select is(pg_temp.items_of('c1200000-0000-4000-8000-000000002001'), '', 'and nothing is written');
select is(pg_temp.change('c1200000-0000-4000-8000-000000002001',
    '{"add":[{"medicine_name":"Qzxrfsafe 10","dosage":"1-0-1","duration":"5 days","cdci_brand_id":"test-cdci-09c-rf-para"}]}'),
  'error:P0001:INPUT_INVALID', 'any name that is not the brand''s is INPUT_INVALID');
select alike(pg_temp.change('c1200000-0000-4000-8000-000000002001',
    '{"add":[{"medicine_name":"  qzxrfparabrand   500 ","generic_name":"Qzxrfamox","dose_form":"Syrup","dosage":"1-0-1","duration":"5 days","cdci_brand_id":"test-cdci-09c-rf-para"}]}'),
  'ok:%', 'the brand''s own name (case and spacing aside) is admitted, whatever generic and form are sent');
select is(pg_temp.items_of('c1200000-0000-4000-8000-000000002001'), 'Qzxrfparabrand 500|Qzxrfpara|Tablet|test-cdci-09c-rf-para',
  'and the catalogue''s name, generic and form are stored, not the sent ones');
select is(pg_temp.change('c1200000-0000-4000-8000-000000002001',
    '{"add":[{"medicine_name":"Qzxrfamoxbrand 500","dosage":"1-0-1","duration":"5 days","cdci_brand_id":"test-cdci-09c-rf-amox"}]}'),
  'error:P0001:ALLERGY_MATCH', 'the allergen''s real brand is still ALLERGY_MATCH');
select is(pg_temp.act('c1200000-0000-4000-8000-000000000102',
    $$select (public.rx_allergy_context('c1200000-0000-4000-8000-00000000000a', 'c1200000-0000-4000-8000-000000002002') -> 'items' -> 0 -> 'matches')::text$$),
  'ok:["Qzxrfamox"]', 'rx_allergy_context shows the match of a stored line with a forged id (the review''s P1 context read), so Sign is blocked');
select is(pg_temp.jres(pg_temp.act('c1200000-0000-4000-8000-000000000102',
    $$select public.repeat_visit_plan('c1200000-0000-4000-8000-00000000000a', 'c1200000-0000-4000-8000-000000002003', 'c1200000-0000-4000-8000-000000002004', array['prescription'], gen_random_uuid())::text$$)) -> 'skipped_item_ids',
  (select jsonb_agg(i.id) from public.prescription_items i where i.prescription_id = 'c1200000-0000-4000-8000-0000000d2004' and i.medicine_name = 'Qzxrfamox 500'),
  'repeat_visit_plan leaves out the allergen line whose stored id says another substance');
select is(pg_temp.items_of('c1200000-0000-4000-8000-000000002003'), 'Qzxrfplain 10|-|-|-;Qzxrfparabrand 500|Qzxrfpara|Tablet|test-cdci-09c-rf-para',
  'and copies a line with a forged id without the id (a medicine outside the catalogue), the real brand with its id');

-- 2. S-2 ----------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.act('c1200000-0000-4000-8000-000000000104',
    $$update public.patients set allergies = array[E'line1\nline2', 'Qzxrfdust'] where id = 'c1200000-0000-4000-8000-000000001002' returning 'updated'$$),
  'ok:updated', 'a nurse can still write the column directly (no grant narrowing, ruling R-AL)');
select is(pg_temp.changes_of('c1200000-0000-4000-8000-000000001002'), 'user/nurse:{"added": 2, "removed": 0, "allergies_count": 2}',
  'but the write leaves one counts-only patient.allergies_change row with the nurse as the actor (the review''s P4b)');
select is((select count(*)::int from public.audit_logs where action = 'patient.allergies_change' and entity_id = 'c1200000-0000-4000-8000-000000001002'
             and (metadata::text like '%line1%' or metadata::text like '%Qzxrfdust%')), 0, 'the row never holds an allergy string');
select is(pg_temp.act('c1200000-0000-4000-8000-000000000104',
    $$update public.patients set allergies = array[]::text[] where id = 'c1200000-0000-4000-8000-000000001002' returning 'emptied'$$),
  'ok:emptied', 'emptying the list directly');
select is(split_part(pg_temp.changes_of('c1200000-0000-4000-8000-000000001002'), ';', 2), 'user/nurse:{"added": 0, "removed": 2, "allergies_count": 0}',
  'is recorded as two removed (no longer without a trace)');
update public.patients set allergies = null where id = 'c1200000-0000-4000-8000-000000001002';
select is(split_part(pg_temp.changes_of('c1200000-0000-4000-8000-000000001002'), ';', 3), 'system/system:{"added": 0, "removed": 0, "allergies_count": null}',
  'a write without a session (the service role) is recorded as the system, null = not recorded');
update public.patients set full_name = 'Synthetic Fix Patient Two Renamed' where id = 'c1200000-0000-4000-8000-000000001002';
update public.patients set allergies = null where id = 'c1200000-0000-4000-8000-000000001002';
select is((select count(*)::int from public.audit_logs where action = 'patient.allergies_change' and entity_id = 'c1200000-0000-4000-8000-000000001002'), 3,
  'a write that does not change the allergies leaves no row');
select alike(pg_temp.record('c1200000-0000-4000-8000-000000000102', 'c1200000-0000-4000-8000-000000001002', '["Qzxrfpollen"]', 'null'), 'ok:%',
  'the command records a list');
select is(split_part(pg_temp.changes_of('c1200000-0000-4000-8000-000000001002'), ';', 4), 'user/doctor:{"added": 1, "removed": 0, "allergies_count": 1}',
  'and its write is recorded by the same trigger beside the command''s own row');
select is((select prosecdef::text || ':' || (proconfig @> array['search_path=""'])::text || ':' || has_function_privilege('authenticated', oid, 'execute')::text
             from pg_proc where oid = 'private.patients_allergies_audit()'::regprocedure), 'true:true:false', 'the trigger function is DEFINER, pinned, not executable by members');

-- 3. S-5 ----------------------------------------------------------------------------------------------------------------------------------------------
select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'patients' and column_name = 'allergies'), null,
  'patients.allergies has no default');
insert into public.patients (id, tenant_id, full_name, phone, created_by)
values ('c1200000-0000-4000-8000-000000001007', 'c1200000-0000-4000-8000-00000000000a', 'Synthetic Fix Patient Seven', '+919000012007', 'c1200000-0000-4000-8000-000000000101');
select is((select allergies from public.patients where id = 'c1200000-0000-4000-8000-000000001007'), null, 'an insert that names no allergies is not recorded, not "No known allergies"');

-- 4. S-6 ----------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.record('c1200000-0000-4000-8000-000000000102', 'c1200000-0000-4000-8000-000000001003', '["Synthetic allergen"]', 'null'),
  'error:P0002:PATIENT_NOT_FOUND', 'an erased patient is PATIENT_NOT_FOUND (the review''s S-6 proof)');
select is((select allergies from public.patients where id = 'c1200000-0000-4000-8000-000000001003'), null, 'and nothing is stored on the erased record');
select is(pg_temp.record('c1200000-0000-4000-8000-000000000102', 'c1200000-0000-4000-8000-000000001004', '["Synthetic allergen"]', 'null'),
  'error:P0002:PATIENT_NOT_FOUND', 'a deleted patient is PATIENT_NOT_FOUND');

-- 5. S-7 ----------------------------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.act('c1200000-0000-4000-8000-000000000104', $$select count(*)::text from public.doctor_custom_medicines where tenant_id = 'c1200000-0000-4000-8000-00000000000a'$$),
  'ok:0', 'a nurse reads no doctor''s custom medicines (the review''s S-7 proof)');
select is(pg_temp.act('c1200000-0000-4000-8000-000000000102', $$select count(*)::text from public.doctor_custom_medicines where doctor_id = 'c1200000-0000-4000-8000-000000000106'$$),
  'ok:0', 'another doctor of the clinic reads none of doctor 2''s');
select is(pg_temp.act('c1200000-0000-4000-8000-000000000106', $$select string_agg(medicine_name, ',') from public.doctor_custom_medicines$$),
  'ok:Qzxrf doctor2 custom', 'doctor 2 reads their own');

-- 6. A-8 ----------------------------------------------------------------------------------------------------------------------------------------------
select is(to_regprocedure('public.record_patient_allergies(uuid, uuid, jsonb, uuid)'), null, 'the 4-argument record_patient_allergies is gone');
select is((select prosecdef::text || ':' || (proconfig @> array['search_path=""'])::text || ':' || (proconfig @> array['lock_timeout=2s'])::text
                  || ':' || has_function_privilege('authenticated', oid, 'execute')::text || ':' || has_function_privilege('anon', oid, 'execute')::text
                  || ':' || has_function_privilege('service_role', oid, 'execute')::text
             from pg_proc where oid = 'public.record_patient_allergies(uuid, uuid, jsonb, jsonb, uuid)'::regprocedure), 'true:true:true:true:false:false',
  'the 5-argument one is DEFINER, pinned, executable by authenticated only');
select is(pg_temp.record('c1200000-0000-4000-8000-000000000102', 'c1200000-0000-4000-8000-000000001005', '["Qzxrfnew"]', 'null'),
  'error:P0001:ALLERGIES_CHANGED', 'an editor that opened on "not recorded" cannot overwrite a recorded list');
select is(pg_temp.record('c1200000-0000-4000-8000-000000000102', 'c1200000-0000-4000-8000-000000001005', '["Qzxrfnew"]', '["Qzxrfother"]'),
  'error:P0001:ALLERGIES_CHANGED', 'nor one that opened on another list (a stale page, the review''s A-8)');
select is((select allergies from public.patients where id = 'c1200000-0000-4000-8000-000000001005'), array['Qzxrfsulfa'], 'the recorded allergy is kept');
select is((select count(*)::int from public.audit_logs where entity_id = 'c1200000-0000-4000-8000-000000001005' and action like 'patient.allergies%'), 0,
  'and no audit row is written for the refused saves');
select is(pg_temp.jres(pg_temp.record('c1200000-0000-4000-8000-000000000102', 'c1200000-0000-4000-8000-000000001005', '["Qzxrfsulfa", "Qzxrfnew"]', '["Qzxrfsulfa"]',
                                      'c1200000-0000-4000-8000-00000000e001')) ->> 'allergies_count', '2', 'the list it opened on is admitted');
select is(pg_temp.jres(pg_temp.record('c1200000-0000-4000-8000-000000000102', 'c1200000-0000-4000-8000-000000001005', '["Qzxrfsulfa", "Qzxrfnew"]', '["Qzxrfsulfa"]',
                                      'c1200000-0000-4000-8000-00000000e001')) ->> 'replayed', 'true', 'a retry of the committed save replays (it is not ALLERGIES_CHANGED)');
select alike(pg_temp.record('c1200000-0000-4000-8000-000000000102', 'c1200000-0000-4000-8000-000000001006', '["Qzxrfnew"]', 'null'), 'ok:%',
  'a patient never recorded takes a list when the editor opened on "not recorded"');
select is(pg_temp.record('c1200000-0000-4000-8000-000000000102', 'c1200000-0000-4000-8000-000000001006', '["Qzxrfnew"]', '{"a":1}'),
  'error:P0001:INPUT_INVALID', 'an expected list that is not a list is INPUT_INVALID');

select * from finish();
rollback;
