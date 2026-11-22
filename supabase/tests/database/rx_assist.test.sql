-- rx_assist.test.sql — V2-09c 09C-03 (R-9, R-10; AI-08, SA-02; migration 000119_rx_assist).
--
-- 1. consult_assist_context, the two Rx outputs (rx_favourites and diagnoses[].rx), from the calling doctor's OWN signed history only:
--    - doctor A1's favourites are ranked by recent use (a medicine prescribed three times first, then two, then one; a recent single use before an old one),
--      only the signed version of a signed visit counts (an unsigned visit, a header that is not active and an open amendment are left out);
--    - another doctor of the same clinic (A2) and a doctor of another clinic (B) never appear in A1's output, and A1 never in theirs (SA-02, roadmap acceptance 4);
--    - `usual` reproduces STORED values: the most frequent exact (dosage, timing, duration), ties to the most recent, a stored null timing stays null, and it is
--      null when the stored dose is incomplete; nothing is invented;
--    - a catalogue medicine carries its brand id and the substance ids of its generic; names, counts and catalogue ids only (no uuid anywhere);
--    - the bundle of a diagnosis: medicines in at least 40 % of the signed visits with it (exactly 40 % passes), at least 2 such visits, never an open amendment's;
--    - at most 12 favourites; a nurse, a receptionist and an admin get the empty result (rx_favourites []), and so does another clinic's owner asking for this clinic.
-- 2. repeat_visit_plan: catalog and grants (EXECUTE for authenticated only), the role matrix, the copy of diagnoses and lines (stored values exactly, a null timing
--    stays null), replay, a second run copying nothing, the counts-only audit row, a line that matches a recorded allergy left out and reported by its source item
--    id, a source of another patient / another clinic / not signed read as not found, a sealed target refused, the closed parts and a different visit required.
-- Every call runs under the real principal. The file rolls back. Synthetic data only.
begin;
select plan(55);

-- Fixtures ----------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1190000-0000-4000-8000-000000000101', 'c119-owner-a@example.test'),
  ('c1190000-0000-4000-8000-000000000102', 'c119-doctor-a1@example.test'),
  ('c1190000-0000-4000-8000-000000000103', 'c119-doctor-a2@example.test'),
  ('c1190000-0000-4000-8000-000000000104', 'c119-admin-a@example.test'),
  ('c1190000-0000-4000-8000-000000000105', 'c119-nurse-a@example.test'),
  ('c1190000-0000-4000-8000-000000000106', 'c119-receptionist-a@example.test'),
  ('c1190000-0000-4000-8000-000000000107', 'c119-doctor-a3@example.test'),
  ('c1190000-0000-4000-8000-000000000201', 'c119-owner-b@example.test');
insert into public.tenants (id, name) values
  ('c1190000-0000-4000-8000-00000000000a', 'Synthetic 09C-03 Clinic A'),
  ('c1190000-0000-4000-8000-00000000000b', 'Synthetic 09C-03 Clinic B');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-00000000000b');
insert into public.memberships (user_id, tenant_id, role) values
  ('c1190000-0000-4000-8000-000000000101', 'c1190000-0000-4000-8000-00000000000a', 'owner'),
  ('c1190000-0000-4000-8000-000000000102', 'c1190000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1190000-0000-4000-8000-000000000103', 'c1190000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1190000-0000-4000-8000-000000000104', 'c1190000-0000-4000-8000-00000000000a', 'admin'),
  ('c1190000-0000-4000-8000-000000000105', 'c1190000-0000-4000-8000-00000000000a', 'nurse'),
  ('c1190000-0000-4000-8000-000000000106', 'c1190000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c1190000-0000-4000-8000-000000000107', 'c1190000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1190000-0000-4000-8000-000000000201', 'c1190000-0000-4000-8000-00000000000b', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1190000-0000-4000-8000-000000001001', 'c1190000-0000-4000-8000-00000000000a', 'Synthetic Assist Patient', '+919000011901', 'c1190000-0000-4000-8000-000000000101'),
  ('c1190000-0000-4000-8000-000000001003', 'c1190000-0000-4000-8000-00000000000a', 'Synthetic Other Patient', '+919000011903', 'c1190000-0000-4000-8000-000000000101'),
  ('c1190000-0000-4000-8000-000000001002', 'c1190000-0000-4000-8000-00000000000b', 'Synthetic Assist Patient B', '+919000011902', 'c1190000-0000-4000-8000-000000000201');

-- One catalogue medicine with a substance (global reference rows, as the allergy fixtures do).
insert into public.cdci_substances (id, substance_name) values ('test-sub-09c-assist', 'Qzxassistol');
insert into public.cdci_generics (id, generic_name, substance_ids) values ('test-gen-09c-assist', 'Qzxassistol', array['test-sub-09c-assist']);
insert into public.cdci_brands (id, brand_name, generic_id) values ('test-cdci-09c-assist', 'Cat Brand Tablet', 'test-gen-09c-assist');
insert into public.cdci_medicines_search (id, brand_name, generic_name, dose_form) values ('test-cdci-09c-assist', 'Cat Brand Tablet', 'Qzxassistol', 'Tablet');

-- One visit with its diagnosis, its header and its lines, written as the draft it starts as and then signed under the doctor's own session as the sign-off
-- does (the header's signature first, 09A R-15); the signature is then back-dated with the triggers off (this transaction only, as consult_assist_context does).
-- p_state: signed | unsigned (stays a draft) | superseded (the header is "amended") | amending (signed, then reopened).
create function pg_temp.mk_visit(p_n int, p_tenant uuid, p_patient uuid, p_doctor uuid, p_dx text, p_items jsonb, p_days int, p_state text default 'signed')
returns void language plpgsql as $f$
declare
  v_id uuid := ('c1190000-0000-4000-8000-0000000' || lpad(p_n::text, 5, '0'))::uuid;
  v_rx uuid := ('c1190000-0000-4000-8000-0000001' || lpad(p_n::text, 5, '0'))::uuid;
  v_it jsonb;
  v_i int := 0;
begin
  insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by)
  values (v_id, p_tenant, p_patient, p_doctor, 'walk_in', 'in_consultation', p_doctor);
  if p_dx is not null then
    insert into public.consultation_diagnoses (tenant_id, visit_id, patient_id, diagnosis_name, icd11_code, is_chronic)
    values (p_tenant, v_id, p_patient, p_dx, 'MG26', false);
  end if;
  if jsonb_array_length(p_items) > 0 then
    insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id, version, status)
    values (v_rx, p_tenant, v_id, p_patient, p_doctor, 1, case when p_state = 'superseded' then 'amended' else 'active' end);
    for v_it in select e from jsonb_array_elements(p_items) e loop
      insert into public.prescription_items (tenant_id, prescription_id, medicine_name, generic_name, dose_form, dosage, timing, duration, cdci_brand_id, sort_order)
      values (p_tenant, v_rx, v_it ->> 'n', v_it ->> 'g', v_it ->> 'f', coalesce(v_it ->> 'd', '1-0-1'), v_it ->> 't', coalesce(v_it ->> 'u', '5 days'), v_it ->> 'b', v_i);
      v_i := v_i + 1;
    end loop;
    if p_state <> 'unsigned' then
      update public.prescriptions set signed_at = now() where id = v_rx;
    end if;
  end if;
  if p_state = 'unsigned' then
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_doctor, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', p_tenant)::text, true);
  update public.visits set status = 'completed', signed_at = now(), signed_by = p_doctor where id = v_id;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  set local session_replication_role = replica;
  update public.visits set signed_at = now() - (p_days || ' days')::interval,
                           status = case when p_state = 'amending' then 'in_consultation' else 'completed' end
   where id = v_id;
  update public.prescriptions set signed_at = now() - (p_days || ' days')::interval where visit_id = v_id and signed_at is not null;
  set local session_replication_role = origin;
end
$f$;

-- Doctor A1 (patient P): three signed Viral fever visits, a signed Migraine visit, an unsigned Viral fever draft, a signed visit whose header is superseded,
-- an open amendment, a signed visit whose stored dose is incomplete, and five signed Cough visits (two with a medicine: exactly 40 %).
select pg_temp.mk_visit(1, 'c1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000001001', 'c1190000-0000-4000-8000-000000000102', 'Viral fever',
  '[{"n":"Paracetamol 650","d":"1-0-1","t":"After food","u":"5 days"},{"n":"Azithro 500","d":"1-0-0","t":null,"u":"3 days"}]'::jsonb, 60);
select pg_temp.mk_visit(2, 'c1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000001001', 'c1190000-0000-4000-8000-000000000102', 'Viral fever',
  '[{"n":"Paracetamol 650","d":"1-0-1","t":"After food","u":"5 days"},{"n":"Tie Tablet","d":"1-0-1","t":"After food","u":"5 days"},{"n":"Cat Brand Tablet","g":"Qzxassistol","f":"Tablet","b":"test-cdci-09c-assist","d":"1-0-0","t":null,"u":"5 days"},{"n":"Cetirizine 10","d":"0-0-1","t":null,"u":"5 days"}]'::jsonb, 5);
select pg_temp.mk_visit(3, 'c1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000001001', 'c1190000-0000-4000-8000-000000000102', 'Viral fever',
  '[{"n":"Paracetamol 650","d":"1-0-1","t":"After food","u":"3 days"},{"n":"Tie Tablet","d":"0-0-1","t":null,"u":"7 days"},{"n":"Cat Brand Tablet","g":"Qzxassistol","f":"Tablet","b":"test-cdci-09c-assist","d":"1-0-0","t":null,"u":"5 days"}]'::jsonb, 1);
select pg_temp.mk_visit(4, 'c1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000001001', 'c1190000-0000-4000-8000-000000000102', 'Migraine',
  '[{"n":"Sumatriptan 50","d":"SOS","t":null,"u":"1 day"}]'::jsonb, 1);
select pg_temp.mk_visit(5, 'c1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000001001', 'c1190000-0000-4000-8000-000000000102', 'Viral fever',
  '[{"n":"Unsigned Medicine X"}]'::jsonb, 0, 'unsigned');
select pg_temp.mk_visit(6, 'c1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000001001', 'c1190000-0000-4000-8000-000000000102', 'Superseded Dx',
  '[{"n":"Superseded Medicine"}]'::jsonb, 2, 'superseded');
select pg_temp.mk_visit(7, 'c1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000001001', 'c1190000-0000-4000-8000-000000000102', 'Amendment Dx',
  '[{"n":"Amendment Medicine"}]'::jsonb, 2, 'amending');
select pg_temp.mk_visit(10, 'c1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000001001', 'c1190000-0000-4000-8000-000000000102', 'Blank Dx',
  '[{"n":"Blank Usual Tablet","d":"","u":"3 days"}]'::jsonb, 3);
select pg_temp.mk_visit(g, 'c1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000001001', 'c1190000-0000-4000-8000-000000000102', 'Cough',
  case when g in (11, 12) then '[{"n":"Forty Percent Syrup","d":"1-0-0","t":"After food","u":"5 days"}]'::jsonb else '[]'::jsonb end, 10)
  from generate_series(11, 15) g;
-- Doctor A2 (same clinic, same patient): two signed Viral fever visits with a medicine of their own. Doctor B1 (another clinic): one.
select pg_temp.mk_visit(g, 'c1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000001001', 'c1190000-0000-4000-8000-000000000103', 'Viral fever',
  '[{"n":"Doctor A2 Only Syrup","d":"1-1-1","t":"With food","u":"4 days"}]'::jsonb, 2)
  from generate_series(21, 22) g;
select pg_temp.mk_visit(31, 'c1190000-0000-4000-8000-00000000000b', 'c1190000-0000-4000-8000-000000001002', 'c1190000-0000-4000-8000-000000000201', 'Viral fever',
  '[{"n":"Clinic B Only Tablet"}]'::jsonb, 2);
-- Doctor A3: one signed visit with 13 distinct medicines (the favourites are capped at 12).
select pg_temp.mk_visit(41, 'c1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000001001', 'c1190000-0000-4000-8000-000000000107', 'Many',
  (select jsonb_agg(jsonb_build_object('n', 'Many Med ' || lpad(g::text, 2, '0'))) from generate_series(1, 13) g), 1);
-- Another patient of clinic A with a signed visit (a source that is not this patient's).
select pg_temp.mk_visit(8, 'c1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000001003', 'c1190000-0000-4000-8000-000000000102', 'Other Dx',
  '[{"n":"Other Patient Medicine"}]'::jsonb, 4);
-- Targets for the repeat command (drafts of doctor A1 for patient P) and a sealed one (v1).
select pg_temp.mk_visit(61, 'c1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000001001', 'c1190000-0000-4000-8000-000000000102', null, '[]'::jsonb, 0, 'unsigned');
select pg_temp.mk_visit(62, 'c1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000001001', 'c1190000-0000-4000-8000-000000000102', null, '[]'::jsonb, 0, 'unsigned');
select pg_temp.mk_visit(63, 'c1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000001001', 'c1190000-0000-4000-8000-000000000102', null, '[]'::jsonb, 0, 'unsigned');

-- Runs one statement under a real principal and returns 'ok:<result>' or 'error:<sqlstate>:<message>'; the work is kept when it succeeds and undone when it fails.
create function pg_temp.act(p_db_role text, p_user uuid, p_tenant uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_res text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_user is null then json_build_object('role', p_db_role)::text
                                                  else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
    perform set_config('request.headers', json_build_object('x-clinicos-tenant', p_tenant)::text, true);
    if p_db_role <> 'postgres' then
      execute 'set local role ' || quote_ident(p_db_role);
    end if;
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
create function pg_temp.ctx(p_user uuid, p_header uuid, p_arg uuid) returns jsonb language sql as $f$
  select case when o like 'ok:%' then substr(o, 4)::jsonb end
    from (select pg_temp.act('authenticated', p_user, p_header, format('select public.consult_assist_context(%L)::text', p_arg)) as o) x
$f$;
create function pg_temp.as_a(p_user text) returns jsonb language sql as $f$
  select pg_temp.ctx(('c1190000-0000-4000-8000-000000000' || p_user)::uuid, 'c1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-00000000000a')
$f$;
create function pg_temp.names(p_arr jsonb) returns text language sql as $f$
  select coalesce(string_agg(e ->> 'name', ',' order by ord), '') from jsonb_array_elements(p_arr) with ordinality as t(e, ord)
$f$;
create function pg_temp.fav(p_user text, p_name text) returns jsonb language sql as $f$
  select e from jsonb_array_elements(pg_temp.as_a(p_user) -> 'rx_favourites') e where e ->> 'name' = p_name
$f$;
create function pg_temp.bundle(p_user text, p_dx text) returns jsonb language sql as $f$
  select d -> 'rx' from jsonb_array_elements(pg_temp.as_a(p_user) -> 'diagnoses') d where d ->> 'name' = p_dx
$f$;
-- The repeat command as `p_user` in clinic A: target visit n, source visit n, the parts as a text array literal, the request id.
create function pg_temp.repeat(p_user text, p_target int, p_source int, p_parts text, p_req uuid default gen_random_uuid()) returns text language sql as $f$
  select pg_temp.act('authenticated', ('c1190000-0000-4000-8000-000000000' || p_user)::uuid, 'c1190000-0000-4000-8000-00000000000a',
    format('select public.repeat_visit_plan(%L, %L, %L, (%s)::text[], %L)::text', 'c1190000-0000-4000-8000-00000000000a',
           ('c1190000-0000-4000-8000-0000000' || lpad(p_target::text, 5, '0')), ('c1190000-0000-4000-8000-0000000' || lpad(p_source::text, 5, '0')), p_parts, p_req))
$f$;
create function pg_temp.res(p_out text) returns jsonb language sql as $f$ select case when p_out like 'ok:%' then substr(p_out, 4)::jsonb end $f$;
create function pg_temp.items_of(p_visit int) returns text language sql as $f$
  select coalesce(string_agg(i.medicine_name || '|' || i.dosage || '|' || coalesce(i.timing, 'NULL') || '|' || i.duration, ';' order by i.sort_order), '')
    from public.prescription_items i join public.prescriptions p on p.id = i.prescription_id
   where p.visit_id = ('c1190000-0000-4000-8000-0000000' || lpad(p_visit::text, 5, '0'))::uuid
$f$;

-- 1. consult_assist_context: favourites ---------------------------------------------------------------------------------------------
select is(pg_temp.names(pg_temp.as_a('102') -> 'rx_favourites'),
  'Paracetamol 650,Cat Brand Tablet,Tie Tablet,Forty Percent Syrup,Sumatriptan 50,Blank Usual Tablet,Other Patient Medicine,Cetirizine 10,Azithro 500',
  'A1: favourites are ranked by recent use over all their patients (three uses first, then two, a recent single use before an old one)');
select is((pg_temp.fav('102', 'Paracetamol 650') ->> 'n')::int, 3, 'A1: Paracetamol 650 appears in three signed visits');
select ok(pg_temp.names(pg_temp.as_a('102') -> 'rx_favourites') !~ 'Unsigned|Superseded|Amendment',
  'A1: an unsigned visit, a header that is not active and an open amendment are not counted');
select ok(pg_temp.names(pg_temp.as_a('102') -> 'rx_favourites') !~ 'A2 Only|Clinic B',
  'SA-02: another doctor of the clinic and a doctor of another clinic never appear in A1''s favourites');
select is(pg_temp.names(pg_temp.as_a('103') -> 'rx_favourites'), 'Doctor A2 Only Syrup', 'A2 sees only their own medicine, never A1''s');
select is(pg_temp.names(pg_temp.ctx('c1190000-0000-4000-8000-000000000201', 'c1190000-0000-4000-8000-00000000000b', 'c1190000-0000-4000-8000-00000000000b') -> 'rx_favourites'),
  'Clinic B Only Tablet', 'the other clinic''s doctor sees only their own');
select is((select count(*)::int from jsonb_array_elements(pg_temp.as_a('107') -> 'rx_favourites')), 12, 'at most 12 favourites');

-- 2. usual: stored values only --------------------------------------------------------------------------------------------------------
select is(pg_temp.fav('102', 'Paracetamol 650') -> 'usual', '{"dosage": "1-0-1", "timing": "After food", "duration": "5 days"}'::jsonb,
  'usual = the most frequent exact triple (5 days twice, 3 days once)');
select is(jsonb_typeof(pg_temp.fav('102', 'Azithro 500') -> 'usual' -> 'timing'), 'null', 'a stored null timing stays null (no "After food" is invented)');
select is(pg_temp.fav('102', 'Azithro 500') -> 'usual' ->> 'duration', '3 days', 'the stored duration is returned as stored');
select is(pg_temp.fav('102', 'Tie Tablet') -> 'usual', '{"dosage": "0-0-1", "timing": null, "duration": "7 days"}'::jsonb,
  'a tie between two triples goes to the most recent one');
select is(jsonb_typeof(pg_temp.fav('102', 'Blank Usual Tablet') -> 'usual'), 'null', 'a stored dose with no dosage has no usual (the screen opens the dose builder)');
select is(pg_temp.fav('102', 'Cat Brand Tablet') ->> 'cdci_brand_id', 'test-cdci-09c-assist', 'a catalogue medicine carries its brand id');
select is(pg_temp.fav('102', 'Cat Brand Tablet') -> 'substance_ids', '["test-sub-09c-assist"]'::jsonb, 'and the substance ids of its generic (the screen''s allergy pre-check)');
select is(jsonb_array_length(pg_temp.fav('102', 'Paracetamol 650') -> 'substance_ids'), 0, 'a medicine with no catalogue substances has none (checked by name only)');
select is((select string_agg(distinct k, ',' order by k) from jsonb_array_elements(pg_temp.as_a('102') -> 'rx_favourites') e, jsonb_object_keys(e) k),
  'cdci_brand_id,dose_form,generic_name,n,name,substance_ids,usual', 'a favourite carries names, catalogue ids, a count and the usual dose only');

-- 3. Bundles ---------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.names(pg_temp.bundle('102', 'Viral fever')), 'Paracetamol 650,Cat Brand Tablet,Tie Tablet',
  'Viral fever: the medicines in at least 40 % of A1''s three signed visits (33 % is out), most frequent first');
select is(pg_temp.bundle('102', 'Viral fever') -> 2 -> 'usual', '{"dosage": "0-0-1", "timing": null, "duration": "7 days"}'::jsonb, 'the bundle''s usual comes from the visits with that diagnosis');
select is(pg_temp.bundle('102', 'Migraine'), '[]'::jsonb, 'a diagnosis with one signed visit has no bundle (at least two visits)');
select is(pg_temp.names(pg_temp.bundle('102', 'Cough')), 'Forty Percent Syrup', 'exactly 40 % passes (2 of 5 visits)');
select is(pg_temp.bundle('102', 'Superseded Dx'), '[]'::jsonb, 'a header that is not active gives no bundle');
select is(pg_temp.bundle('102', 'Amendment Dx'), '[]'::jsonb, 'an open amendment gives no bundle');
select is(pg_temp.names(pg_temp.bundle('103', 'Viral fever')), 'Doctor A2 Only Syrup', 'A2''s Viral fever bundle holds only A2''s medicine');
select ok(pg_temp.as_a('102')::text !~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'no patient, visit, prescription or item id appears anywhere in the output');

-- 4. Who gets the result ---------------------------------------------------------------------------------------------------------------
select is(pg_temp.as_a('101') -> 'rx_favourites', '[]'::jsonb, 'the owner has no signed visit of their own: no favourites');
select is(pg_temp.as_a('105') -> 'rx_favourites', '[]'::jsonb, 'a nurse gets the empty result');
select is(pg_temp.as_a('106') -> 'rx_favourites', '[]'::jsonb, 'a receptionist gets the empty result');
select is(pg_temp.as_a('104') -> 'rx_favourites', '[]'::jsonb, 'an admin gets the empty result');
select is(pg_temp.ctx('c1190000-0000-4000-8000-000000000201', 'c1190000-0000-4000-8000-00000000000b', 'c1190000-0000-4000-8000-00000000000a') -> 'rx_favourites', '[]'::jsonb,
  'another clinic''s owner asking for this clinic gets the empty result');

-- 5. repeat_visit_plan: catalog and roles ------------------------------------------------------------------------------------------------
select is((select prosecdef::text || ':' || (proconfig @> array['search_path=""'])::text || ':' || (proconfig @> array['lock_timeout=2s'])::text
            from pg_proc where oid = 'public.repeat_visit_plan(uuid, uuid, uuid, text[], uuid)'::regprocedure), 'true:true:true',
  'repeat_visit_plan is SECURITY DEFINER with search_path and lock_timeout pinned');
select is((select has_function_privilege('authenticated', 'public.repeat_visit_plan(uuid, uuid, uuid, text[], uuid)', 'EXECUTE')::text || ','
         || has_function_privilege('anon', 'public.repeat_visit_plan(uuid, uuid, uuid, text[], uuid)', 'EXECUTE')::text || ','
         || has_function_privilege('service_role', 'public.repeat_visit_plan(uuid, uuid, uuid, text[], uuid)', 'EXECUTE')::text),
  'true,false,false', 'EXECUTE for authenticated only');
select ok(pg_temp.act('anon', null, 'c1190000-0000-4000-8000-00000000000a',
  $$select public.repeat_visit_plan('c1190000-0000-4000-8000-00000000000a', gen_random_uuid(), gen_random_uuid(), array['diagnoses'], gen_random_uuid())::text$$) like 'error:42501:%',
  'no session (anon) cannot execute it');
select ok(pg_temp.repeat('105', 61, 2, $$array['prescription']$$) like 'error:42501:%', 'a nurse is refused (prescriptions:edit)');
select ok(pg_temp.repeat('106', 61, 2, $$array['prescription']$$) like 'error:42501:%', 'a receptionist is refused');
select ok(pg_temp.repeat('104', 61, 2, $$array['prescription']$$) like 'error:42501:%', 'an admin is refused');
select is(pg_temp.items_of(61), '', 'nothing was written by the refused calls');

-- 6. The copy ---------------------------------------------------------------------------------------------------------------------------
do $do$ begin perform pg_temp.repeat('102', 61, 2, $$array['diagnoses','prescription']$$, 'c1190000-0000-4000-8000-0000000f0001'); end $do$;
select is((select count(*)::int from public.consultation_diagnoses where visit_id = 'c1190000-0000-4000-8000-000000000061' and diagnosis_name = 'Viral fever'), 1,
  'the source''s diagnosis is copied');
select is(pg_temp.items_of(61), 'Paracetamol 650|1-0-1|After food|5 days;Tie Tablet|1-0-1|After food|5 days;Cat Brand Tablet|1-0-0|NULL|5 days;Cetirizine 10|0-0-1|NULL|5 days',
  'the source''s signed lines are copied in order with their stored values; a null timing stays null');
select is(pg_temp.res(pg_temp.repeat('102', 61, 2, $$array['diagnoses','prescription']$$, 'c1190000-0000-4000-8000-0000000f0001')) ->> 'replayed', 'true',
  'the same request id replays the first result');
select is((select count(*)::int from public.prescription_items i join public.prescriptions p on p.id = i.prescription_id where p.visit_id = 'c1190000-0000-4000-8000-000000000061'), 4,
  'a replay writes nothing new');
select is(pg_temp.res(pg_temp.repeat('102', 61, 2, $$array['diagnoses','prescription']$$)) - 'prescription_id' - 'added_item_ids' - 'replayed',
  '{"diagnoses_added": 0, "skipped_item_ids": []}'::jsonb, 'a second run with a new id copies nothing (a medicine or diagnosis already there is skipped)');
select is((select metadata::text from public.audit_logs where action = 'visit.repeat_plan' and entity_id = 'c1190000-0000-4000-8000-000000000061' order by id limit 1),
  '{"added": 4, "skipped": 0, "diagnoses_added": 1}', 'the audit row carries counts only');

-- 7. An allergy match is left out and reported by its source item id -------------------------------------------------------------------------
update public.patients set allergies = array['Cetirizine'] where id = 'c1190000-0000-4000-8000-000000001001';
select is(pg_temp.res(pg_temp.repeat('102', 62, 2, $$array['prescription']$$)) -> 'skipped_item_ids',
  (select to_jsonb(array_agg(i.id)) from public.prescription_items i where i.prescription_id = 'c1190000-0000-4000-8000-000000100002' and i.medicine_name = 'Cetirizine 10'),
  'the line matching the recorded allergy is returned by its source item id');
select is(pg_temp.items_of(62), 'Paracetamol 650|1-0-1|After food|5 days;Tie Tablet|1-0-1|After food|5 days;Cat Brand Tablet|1-0-0|NULL|5 days',
  'and is not copied; the other three are');
select is((select metadata::text from public.audit_logs where action = 'visit.repeat_plan' and entity_id = 'c1190000-0000-4000-8000-000000000062' order by id limit 1),
  '{"added": 3, "skipped": 1, "diagnoses_added": 0}', 'the audit row counts the skipped line');

-- 8. Sources and targets that are refused ------------------------------------------------------------------------------------------------
select ok(pg_temp.repeat('102', 63, 8, $$array['prescription']$$) like 'error:P0002:%', 'another patient''s signed visit reads as not found');
select ok(pg_temp.repeat('102', 63, 5, $$array['prescription']$$) like 'error:P0002:%', 'a visit that is not signed reads as not found');
select ok(pg_temp.repeat('102', 63, 7, $$array['prescription']$$) like 'error:P0002:%', 'an open amendment is not a signed source');
select ok(pg_temp.repeat('102', 63, 31, $$array['prescription']$$) like 'error:P0002:%', 'another clinic''s visit reads as not found');
select ok(pg_temp.repeat('102', 1, 2, $$array['prescription']$$) like 'error:P0001:DRAFT_LOCKED%', 'a sealed target is DRAFT_LOCKED');
select ok(pg_temp.repeat('102', 63, 63, $$array['prescription']$$) like 'error:P0001:INPUT_INVALID%', 'the source must be a different visit');
select ok(pg_temp.repeat('102', 63, 2, $$array['nothing']$$) like 'error:P0001:INPUT_INVALID%', 'an unknown part is refused');
select ok(pg_temp.repeat('102', 63, 2, $$array['diagnoses','diagnoses']$$) like 'error:P0001:INPUT_INVALID%', 'a part named twice is refused');
select ok(pg_temp.act('authenticated', 'c1190000-0000-4000-8000-000000000201', 'c1190000-0000-4000-8000-00000000000b',
  $$select public.repeat_visit_plan('c1190000-0000-4000-8000-00000000000a', 'c1190000-0000-4000-8000-000000000063', 'c1190000-0000-4000-8000-000000000002', array['prescription'], gen_random_uuid())::text$$)
  like 'error:P0002:%', 'another clinic''s owner naming this clinic''s visits finds nothing');
select is(pg_temp.items_of(63), '', 'nothing was written by the refused calls');

select * from finish();
rollback;
