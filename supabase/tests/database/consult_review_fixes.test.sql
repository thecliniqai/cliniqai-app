-- consult_review_fixes.test.sql — V2-09b 09B-06a (09B-REVIEW-TRIAGE.md; migration 000116_consult_review_fixes).
--
--   A-4        patient_documents.client_request_id: a nullable uuid, unique per clinic (partial index); a second row with the same id in the same clinic is
--              refused (23505), another clinic and null ids are unaffected.
--   S-2 / A-8  a document linked to a visit is refused (DOCUMENT_VISIT_LOCKED, 42501) unless the visit is open: a sealed, an unsigned completed and a
--              cancelled visit refuse it for the doctor, the service role and the table owner; a draft, a waiting and an amending visit take it, and a
--              document with no visit is unaffected. The trigger function is INVOKER with search_path pinned and no EXECUTE for any API role.
--   S-7        the two 000115 trigger functions carry no EXECUTE for PUBLIC, anon, authenticated or service_role.
--   S-4        save_consultation_draft refuses vitals outside vitalsSchema (ranges, integers, systolic above diastolic, sugar_type), complaints with
--              unknown keys or wrong types, and a follow-up date before the clinic's today or after today + 366; the boundaries are accepted, and a
--              follow-up date the visit already holds is accepted unchanged.
-- Every call runs under the real principal (set local role, JWT claims, the x-clinicos-tenant header). The file rolls back. Synthetic data only.
begin;
select plan(48);

-- Fixtures ----------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1160000-0000-4000-8000-000000000101', 'c116-owner-a@example.test'),
  ('c1160000-0000-4000-8000-000000000102', 'c116-doctor-a@example.test'),
  ('c1160000-0000-4000-8000-000000000104', 'c116-nurse-a@example.test'),
  ('c1160000-0000-4000-8000-000000000201', 'c116-owner-b@example.test');
insert into public.tenants (id, name) values
  ('c1160000-0000-4000-8000-00000000000a', 'Synthetic 09B-06a Clinic A'),
  ('c1160000-0000-4000-8000-00000000000b', 'Synthetic 09B-06a Clinic B');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1160000-0000-4000-8000-00000000000a', 'c1160000-0000-4000-8000-00000000000b');
insert into public.memberships (user_id, tenant_id, role) values
  ('c1160000-0000-4000-8000-000000000101', 'c1160000-0000-4000-8000-00000000000a', 'owner'),
  ('c1160000-0000-4000-8000-000000000102', 'c1160000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1160000-0000-4000-8000-000000000104', 'c1160000-0000-4000-8000-00000000000a', 'nurse'),
  ('c1160000-0000-4000-8000-000000000201', 'c1160000-0000-4000-8000-00000000000b', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1160000-0000-4000-8000-000000001001', 'c1160000-0000-4000-8000-00000000000a', 'Synthetic Review Patient', '+919000011601', 'c1160000-0000-4000-8000-000000000101'),
  ('c1160000-0000-4000-8000-000000001002', 'c1160000-0000-4000-8000-00000000000b', 'Synthetic Review Patient B', '+919000011602', 'c1160000-0000-4000-8000-000000000201');

-- D 2001 draft (in consultation), W 2002 waiting, S 2003 sealed, U 2004 completed unsigned, C 2005 cancelled, M 2006 amending, F 2007 in consultation
-- with a stored follow-up dated ten days ago (the unchanged-date case), V 2008 in consultation (the S-4 probes). B 3001 in clinic B.
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1160000-0000-4000-8000-000000002001', 'c1160000-0000-4000-8000-00000000000a', 'c1160000-0000-4000-8000-000000001001', 'c1160000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1160000-0000-4000-8000-000000000101'),
  ('c1160000-0000-4000-8000-000000002002', 'c1160000-0000-4000-8000-00000000000a', 'c1160000-0000-4000-8000-000000001001', 'c1160000-0000-4000-8000-000000000102', 'walk_in', 'waiting', 'c1160000-0000-4000-8000-000000000101'),
  ('c1160000-0000-4000-8000-000000002003', 'c1160000-0000-4000-8000-00000000000a', 'c1160000-0000-4000-8000-000000001001', 'c1160000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1160000-0000-4000-8000-000000000101'),
  ('c1160000-0000-4000-8000-000000002004', 'c1160000-0000-4000-8000-00000000000a', 'c1160000-0000-4000-8000-000000001001', 'c1160000-0000-4000-8000-000000000102', 'walk_in', 'completed', 'c1160000-0000-4000-8000-000000000101'),
  ('c1160000-0000-4000-8000-000000002005', 'c1160000-0000-4000-8000-00000000000a', 'c1160000-0000-4000-8000-000000001001', 'c1160000-0000-4000-8000-000000000102', 'walk_in', 'cancelled', 'c1160000-0000-4000-8000-000000000101'),
  ('c1160000-0000-4000-8000-000000002006', 'c1160000-0000-4000-8000-00000000000a', 'c1160000-0000-4000-8000-000000001001', 'c1160000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1160000-0000-4000-8000-000000000101'),
  ('c1160000-0000-4000-8000-000000002007', 'c1160000-0000-4000-8000-00000000000a', 'c1160000-0000-4000-8000-000000001001', 'c1160000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1160000-0000-4000-8000-000000000101'),
  ('c1160000-0000-4000-8000-000000002008', 'c1160000-0000-4000-8000-00000000000a', 'c1160000-0000-4000-8000-000000001001', 'c1160000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1160000-0000-4000-8000-000000000101'),
  ('c1160000-0000-4000-8000-000000003001', 'c1160000-0000-4000-8000-00000000000b', 'c1160000-0000-4000-8000-000000001002', 'c1160000-0000-4000-8000-000000000201', 'walk_in', 'in_consultation', 'c1160000-0000-4000-8000-000000000201');
insert into public.follow_ups (tenant_id, patient_id, visit_id, doctor_id, follow_up_date, notes, status) values
  ('c1160000-0000-4000-8000-00000000000a', 'c1160000-0000-4000-8000-000000001001', 'c1160000-0000-4000-8000-000000002007', 'c1160000-0000-4000-8000-000000000102',
   public.tenant_local_date('c1160000-0000-4000-8000-00000000000a', now()) - 10, 'Synthetic older follow-up', 'scheduled');

-- The signature and the reopen are written under the doctor's own session, as the commands do (09A R-15).
create function pg_temp.as_actor(p_user uuid, p_sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c1160000-0000-4000-8000-00000000000a')::text, true);
  execute p_sql;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end
$f$;
do $do$
declare
  d constant uuid := 'c1160000-0000-4000-8000-000000000102';
begin
  perform pg_temp.as_actor(d, format($q$update public.visits set status = 'completed', signed_at = now(), signed_by = %L
    where id in ('c1160000-0000-4000-8000-000000002003', 'c1160000-0000-4000-8000-000000002006')$q$, d));
  perform pg_temp.as_actor(d, format($q$insert into public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason)
    values ('c1160000-0000-4000-8000-00000000000a', 'c1160000-0000-4000-8000-000000002006', %L, 'Synthetic amendment reason')$q$, d));
  perform pg_temp.as_actor(d, $q$update public.visits set status = 'in_consultation' where id = 'c1160000-0000-4000-8000-000000002006'$q$);
end
$do$;

-- Runs one statement under a real principal and returns 'ok:<result>' or 'error:<sqlstate>:<message>'.
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
-- A document row as the given database role and user (null user: no session) for visit `p_visit` (null: the patient's record), with request id `p_req`.
create function pg_temp.doc(p_db_role text, p_user text, p_visit text, p_req text default null, p_tenant text default 'a') returns text language sql as $f$
  select pg_temp.act(p_db_role,
    case when p_user is null then null else ('c1160000-0000-4000-8000-000000000' || p_user)::uuid end,
    ('c1160000-0000-4000-8000-00000000000' || p_tenant)::uuid,
    format($q$insert into public.patient_documents (tenant_id, patient_id, visit_id, title, original_filename, storage_path, file_size_bytes, mime_type,
                 report_date, uploaded_by, client_request_id)
              values (%L, %L, %L, 'Synthetic report', 'report.pdf', %L, 10, 'application/pdf', current_date, %L, %L)
              returning 'stored'$q$,
      'c1160000-0000-4000-8000-00000000000' || p_tenant,
      case when p_tenant = 'a' then 'c1160000-0000-4000-8000-000000001001' else 'c1160000-0000-4000-8000-000000001002' end,
      case when p_visit is null then null else 'c1160000-0000-4000-8000-00000000' || p_visit end,
      format('tenants/c1160000-0000-4000-8000-00000000000%s/patients/%s/labs/%s.pdf', p_tenant,
             case when p_tenant = 'a' then 'c1160000-0000-4000-8000-000000001001' else 'c1160000-0000-4000-8000-000000001002' end, gen_random_uuid()),
      case when p_tenant = 'a' then 'c1160000-0000-4000-8000-000000000102' else 'c1160000-0000-4000-8000-000000000201' end,
      p_req))
$f$;
-- The draft command as the doctor of clinic A on visit `p_visit`, at its current version.
create function pg_temp.save(p_visit text, p_patch jsonb) returns text language sql as $f$
  select pg_temp.act('authenticated', 'c1160000-0000-4000-8000-000000000102', 'c1160000-0000-4000-8000-00000000000a',
    format('select (public.save_consultation_draft(%L, %L, %s, %L::jsonb, %L) ->> %L)', 'c1160000-0000-4000-8000-00000000000a',
           'c1160000-0000-4000-8000-00000000' || p_visit,
           (select n.draft_version from public.clinical_notes n where n.visit_id = ('c1160000-0000-4000-8000-00000000' || p_visit)::uuid),
           p_patch, gen_random_uuid(), 'replayed'))
$f$;
create function pg_temp.fu(p_days int) returns jsonb language sql as $f$
  select jsonb_build_object('follow_up_date', to_char(public.tenant_local_date('c1160000-0000-4000-8000-00000000000a', now()) + p_days, 'YYYY-MM-DD'), 'notes', null)
$f$;
-- The function exists and has no ACL entry for PUBLIC, anon, authenticated or service_role (by name: the file runs, and fails, without 000116).
create function pg_temp.no_api_execute(p_fn text) returns boolean language sql as $f$
  select to_regprocedure(p_fn) is not null
     and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                      where p.oid = to_regprocedure(p_fn) and a.privilege_type = 'EXECUTE'
                        and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))))
$f$;

-- A-4: the request id --------------------------------------------------------------------------------------------------------------
select is((select data_type || ':' || is_nullable from information_schema.columns
            where table_schema = 'public' and table_name = 'patient_documents' and column_name = 'client_request_id'), 'uuid:YES',
  'A-4: patient_documents.client_request_id is a nullable uuid');
select is((select pg_get_indexdef(indexrelid) from pg_index where indexrelid = to_regclass('public.patient_documents_client_request_unique')),
  'CREATE UNIQUE INDEX patient_documents_client_request_unique ON public.patient_documents USING btree (tenant_id, client_request_id) WHERE (client_request_id IS NOT NULL)',
  'A-4: one row per clinic and request id (partial unique index)');
select is(pg_temp.doc('authenticated', '102', '2001', 'c1160000-0000-4000-8000-00000000a001'), 'ok:stored', 'A-4: the first upload with a request id is stored');
select matches(pg_temp.doc('authenticated', '102', '2001', 'c1160000-0000-4000-8000-00000000a001'), '^error:23505:',
  'A-4: a second row with the same request id in the same clinic is refused');
select is(pg_temp.act('postgres', null, 'c1160000-0000-4000-8000-00000000000a',
            $$select count(*)::text from public.patient_documents where tenant_id = 'c1160000-0000-4000-8000-00000000000a' and client_request_id = 'c1160000-0000-4000-8000-00000000a001'$$),
  'ok:1', 'A-4: one row of the clinic holds that request id');
select is(pg_temp.doc('authenticated', '201', '3001', 'c1160000-0000-4000-8000-00000000a001', 'b'), 'ok:stored',
  'A-4: another clinic may hold the same request id');
select is(pg_temp.doc('authenticated', '102', '2001') || pg_temp.doc('authenticated', '102', '2001'), 'ok:storedok:stored',
  'A-4: rows without a request id are not constrained');

-- S-2 / A-8: open visits only ------------------------------------------------------------------------------------------------------
select is(pg_temp.doc('authenticated', '102', '2001'), 'ok:stored', 'S-2: the doctor attaches a report to a draft visit');
select is(pg_temp.doc('authenticated', '102', '2002'), 'ok:stored', 'S-2: ... and to a waiting visit');
select is(pg_temp.doc('authenticated', '102', '2006'), 'ok:stored', 'S-2: ... and to a visit reopened for amendment');
select is(pg_temp.doc('authenticated', '104', '2001'), 'ok:stored', 'S-2: the nurse attaches a report to a draft visit');
select is(pg_temp.doc('authenticated', '104', null), 'ok:stored', 'S-2: a document with no visit (the patient record) is unaffected');
select is(pg_temp.doc('authenticated', '102', '2003'), 'error:42501:DOCUMENT_VISIT_LOCKED', 'S-2: the doctor cannot attach a report to a sealed visit');
select is(pg_temp.doc('authenticated', '102', '2004'), 'error:42501:DOCUMENT_VISIT_LOCKED', 'S-2: ... nor to an unsigned completed visit');
select is(pg_temp.doc('authenticated', '102', '2005'), 'error:42501:DOCUMENT_VISIT_LOCKED', 'S-2: ... nor to a cancelled visit');
select is(pg_temp.doc('authenticated', '104', '2003'), 'error:42501:DOCUMENT_VISIT_LOCKED', 'S-2: the nurse cannot attach a report to a sealed visit');
select is(pg_temp.doc('service_role', null, '2003'), 'error:42501:DOCUMENT_VISIT_LOCKED', 'S-2: the service role cannot attach a report to a sealed visit');
select is(pg_temp.doc('postgres', null, '2004'), 'error:42501:DOCUMENT_VISIT_LOCKED', 'S-2: the table owner cannot attach a report to a completed visit');
select is((select count(*)::int from public.patient_documents where visit_id in
            ('c1160000-0000-4000-8000-000000002003', 'c1160000-0000-4000-8000-000000002004', 'c1160000-0000-4000-8000-000000002005')), 0,
  'S-2: no document is linked to the closed visits');
select is((select prosecdef::text || ':' || (proconfig @> array['search_path=""'])::text from pg_proc
            where oid = to_regprocedure('private.patient_documents_visit_open()')), 'false:true',
  'S-2: the trigger function is INVOKER with search_path pinned');
select ok(pg_temp.no_api_execute('private.patient_documents_visit_open()'), 'S-2: the trigger function has no EXECUTE for PUBLIC or an API role');
select is((select tgtype::int & 2 <> 0 and tgtype::int & 4 <> 0 and tgtype::int & 16 = 0 from pg_trigger
            where tgrelid = 'public.patient_documents'::regclass and tgname = 'patient_documents_visit_open'), true,
  'S-2: it fires BEFORE INSERT (not on UPDATE)');

-- S-7 ------------------------------------------------------------------------------------------------------------------------------
select ok(pg_temp.no_api_execute('private.doctor_text_macros_before_insert()'), 'S-7: the macros insert trigger function has no EXECUTE for PUBLIC or an API role');
select ok(pg_temp.no_api_execute('private.doctor_text_macros_before_update()'), 'S-7: the macros update trigger function has no EXECUTE for PUBLIC or an API role');

-- S-4: the draft command's input checks -------------------------------------------------------------------------------------------
select is(pg_temp.save('2008', '{"vitals": {"systolic": 251}}'), 'error:P0001:INPUT_INVALID', 'S-4: systolic above 250 is refused');
select is(pg_temp.save('2008', '{"vitals": {"systolic": 49}}'), 'error:P0001:INPUT_INVALID', 'S-4: systolic below 50 is refused');
select is(pg_temp.save('2008', '{"vitals": {"pulse": 72.5}}'), 'error:P0001:INPUT_INVALID', 'S-4: a fractional pulse is refused (an integer field)');
select is(pg_temp.save('2008', '{"vitals": {"spo2": 101}}'), 'error:P0001:INPUT_INVALID', 'S-4: SpO2 above 100 is refused');
select is(pg_temp.save('2008', '{"vitals": {"sugar": 1e308}}'), 'error:P0001:INPUT_INVALID', 'S-4: a sugar of 1e308 is refused');
select is(pg_temp.save('2008', '{"vitals": {"temperature": 111}}'), 'error:P0001:INPUT_INVALID', 'S-4: a temperature above 110 is refused');
select is(pg_temp.save('2008', '{"vitals": {"systolic": 80, "diastolic": 90}}'), 'error:P0001:INPUT_INVALID', 'S-4: systolic not above diastolic is refused');
select is(pg_temp.save('2008', '{"vitals": {"sugar": 120, "sugar_type": "postprandial"}}'), 'error:P0001:INPUT_INVALID', 'S-4: an unknown sugar_type is refused');
select is(pg_temp.save('2008', '{"vitals": {"systolic": 250, "diastolic": 30, "temperature": 98.6, "weight": 0.5, "spo2": 100, "sugar": 1000, "sugar_type": "pp", "bmi": 22.4}}'),
  'ok:false', 'S-4: the boundary values and a decimal temperature are accepted');
select is((select (vitals ->> 'systolic') || '/' || (vitals ->> 'weight') from public.clinical_notes where visit_id = 'c1160000-0000-4000-8000-000000002008'), '250/0.5',
  'S-4: ... and stored');
select is(pg_temp.save('2008', '{"chief_complaints": [{"symptom": "Fever", "html": "<b>x</b>"}]}'), 'error:P0001:INPUT_INVALID', 'S-4: a complaint with an unknown key is refused');
select is(pg_temp.save('2008', '{"chief_complaints": [{"duration_val": 3, "duration_unit": "days"}]}'), 'error:P0001:INPUT_INVALID', 'S-4: a complaint with no symptom is refused');
select is(pg_temp.save('2008', format('{"chief_complaints": [{"symptom": "%s"}]}', repeat('a', 201))::jsonb), 'error:P0001:INPUT_INVALID',
  'S-4: a symptom of 201 characters is refused');
select is(pg_temp.save('2008', '{"chief_complaints": [{"symptom": 7}]}'), 'error:P0001:INPUT_INVALID', 'S-4: a symptom that is not a string is refused');
select is(pg_temp.save('2008', '{"chief_complaints": [{"symptom": "Fever", "duration_val": 0, "duration_unit": "days"}]}'), 'error:P0001:INPUT_INVALID',
  'S-4: a duration of 0 is refused');
select is(pg_temp.save('2008', '{"chief_complaints": [{"symptom": "Fever", "duration_val": "3", "duration_unit": "days"}]}'), 'error:P0001:INPUT_INVALID',
  'S-4: a duration that is not a number is refused');
select is(pg_temp.save('2008', '{"chief_complaints": [{"symptom": "Fever", "duration_val": 3, "duration_unit": "hours"}]}'), 'error:P0001:INPUT_INVALID',
  'S-4: an unknown duration unit is refused');
select is(pg_temp.save('2008', format('{"chief_complaints": [{"symptom": "Fever", "notes": "%s"}]}', repeat('n', 501))::jsonb), 'error:P0001:INPUT_INVALID',
  'S-4: complaint notes of 501 characters are refused');
select is(pg_temp.save('2008', '{"chief_complaints": [{"id": "c1", "symptom": "Fever", "duration_val": 3, "duration_unit": "days", "notes": null}, {"symptom": "Cough"}]}'),
  'ok:false', 'S-4: complaints with every allowed key, and one with a symptom only, are accepted');
select is(pg_temp.save('2008', jsonb_build_object('follow_up', pg_temp.fu(-1))), 'error:P0001:INPUT_INVALID', 'S-4: a follow-up before the clinic''s today is refused');
select is(pg_temp.save('2008', jsonb_build_object('follow_up', pg_temp.fu(367))), 'error:P0001:INPUT_INVALID', 'S-4: a follow-up 367 days on is refused');
select is(pg_temp.save('2008', jsonb_build_object('follow_up', pg_temp.fu(0))) || pg_temp.save('2008', jsonb_build_object('follow_up', pg_temp.fu(366))),
  'ok:falseok:false', 'S-4: a follow-up today and one 366 days on are accepted');
select is(pg_temp.save('2007', jsonb_build_object('follow_up', pg_temp.fu(-10) || '{"notes": "Synthetic edited note"}')), 'ok:false',
  'S-4: the date the visit''s follow-up already holds is accepted unchanged (its note edited)');
select is(pg_temp.save('2007', jsonb_build_object('follow_up', pg_temp.fu(-9))), 'error:P0001:INPUT_INVALID',
  'S-4: another past date on that visit is refused');

select * from finish();
rollback;
