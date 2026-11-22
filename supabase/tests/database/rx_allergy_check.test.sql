-- rx_allergy_check.test.sql — V2-09c 09C-02 (R-6, R-7, R-8; migration 000118_rx_allergy_check).
--
-- 1. prescription_items.allergy_override: the shape CHECK (a valid object is admitted; a missing key, a reason under 5 characters and an extra key are
--    refused), the substance-name index, the helpers' grants (authenticated only).
-- 2. The rule private.rx_allergy_matches (a coded allergy by substance, an uncoded one or a line without ids by whole words) and the allergy coding.
-- 3. change_prescription: a matching add without a reason is ALLERGY_MATCH (nothing written, no audit row) as the doctor and the owner; with a reason the
--    line stores the override and the audit counts it without the text; an update confirms; a reason on a clean change is ignored; the entitlement kill
--    switch; not recorded and none are not checked.
-- 4. record_patient_allergies: catalog and grants, the list, the audit row, duplicates, the role matrix (the front desk cannot), another clinic.
-- 5. The registration normaliser keeps NULL for an absent or null allergies and [] for an explicit []; the two INVOKER reads (rx_allergy_context,
--    search_substances) return nothing across clinics.
-- Every call runs under the real principal. The file rolls back. Synthetic data only.
begin;
select plan(43);

-- Fixtures ----------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1180000-0000-4000-8000-000000000101', 'c117-owner-a@example.test'),
  ('c1180000-0000-4000-8000-000000000102', 'c117-doctor-a@example.test'),
  ('c1180000-0000-4000-8000-000000000103', 'c117-admin-a@example.test'),
  ('c1180000-0000-4000-8000-000000000104', 'c117-nurse-a@example.test'),
  ('c1180000-0000-4000-8000-000000000105', 'c117-receptionist-a@example.test'),
  ('c1180000-0000-4000-8000-000000000106', 'c117-doctor2-a@example.test'),
  ('c1180000-0000-4000-8000-000000000201', 'c117-owner-b@example.test');
insert into public.tenants (id, name) values
  ('c1180000-0000-4000-8000-00000000000a', 'Synthetic 09C-01 Clinic A'),
  ('c1180000-0000-4000-8000-00000000000b', 'Synthetic 09C-01 Clinic B');
update public.tenants set rx_paper_size = 'A5', rx_letterhead_mode = 'preprinted_letterhead' where id = 'c1180000-0000-4000-8000-00000000000a';
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1180000-0000-4000-8000-00000000000a', 'c1180000-0000-4000-8000-00000000000b');
insert into public.memberships (user_id, tenant_id, role) values
  ('c1180000-0000-4000-8000-000000000101', 'c1180000-0000-4000-8000-00000000000a', 'owner'),
  ('c1180000-0000-4000-8000-000000000102', 'c1180000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1180000-0000-4000-8000-000000000103', 'c1180000-0000-4000-8000-00000000000a', 'admin'),
  ('c1180000-0000-4000-8000-000000000104', 'c1180000-0000-4000-8000-00000000000a', 'nurse'),
  ('c1180000-0000-4000-8000-000000000105', 'c1180000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c1180000-0000-4000-8000-000000000106', 'c1180000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1180000-0000-4000-8000-000000000201', 'c1180000-0000-4000-8000-00000000000b', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1180000-0000-4000-8000-000000001001', 'c1180000-0000-4000-8000-00000000000a', 'Synthetic Rx Patient', '+919000011701', 'c1180000-0000-4000-8000-000000000101'),
  ('c1180000-0000-4000-8000-000000001002', 'c1180000-0000-4000-8000-00000000000b', 'Synthetic Rx Patient B', '+919000011702', 'c1180000-0000-4000-8000-000000000201');

-- D 2001 draft (in consultation, the main visit), E 2002 in consultation (the second visit: a foreign item id), S 2003 sealed (signed), C 2004 cancelled,
-- U 2005 completed unsigned, M 2006 amending (signed, reopened), R 2007 in consultation (the role matrix), G 2008 sealed with a header (the guard probe).
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by)
select ('c1180000-0000-4000-8000-00000000' || v.n)::uuid, 'c1180000-0000-4000-8000-00000000000a', 'c1180000-0000-4000-8000-000000001001',
       'c1180000-0000-4000-8000-000000000102', 'walk_in', v.st, 'c1180000-0000-4000-8000-000000000101'
  from (values ('2001', 'in_consultation'), ('2002', 'in_consultation'), ('2003', 'in_consultation'), ('2004', 'cancelled'), ('2005', 'completed'),
               ('2006', 'in_consultation'), ('2007', 'in_consultation'), ('2008', 'in_consultation')) as v(n, st);
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1180000-0000-4000-8000-000000003001', 'c1180000-0000-4000-8000-00000000000b', 'c1180000-0000-4000-8000-000000001002', 'c1180000-0000-4000-8000-000000000201', 'walk_in', 'in_consultation', 'c1180000-0000-4000-8000-000000000201');

-- The allergy catalogue (global reference rows): two substances, a generic holding both, a brand of it, a brand with no substances.
insert into public.cdci_substances (id, substance_name) values ('test-sub-09c-pg-amox', 'Qzxpgamoxil'), ('test-sub-09c-pg-clav', 'Qzxpgclavulan');
insert into public.cdci_generics (id, generic_name, substance_ids) values ('test-gen-09c-pg-combo', 'Qzxpgamoxil + Qzxpgclavulan', array['test-sub-09c-pg-amox', 'test-sub-09c-pg-clav']);
insert into public.cdci_brands (id, brand_name, generic_id) values ('test-cdci-09c-pg-combo', 'Qzxpgaugment 625', 'test-gen-09c-pg-combo'), ('test-cdci-09c-pg-bare', 'Qzxpgbare', null);
insert into public.cdci_medicines_search (id, brand_name, generic_name, dose_form) values
  ('test-cdci-09c-pg-combo', 'Qzxpgaugment 625', 'Qzxpgamoxil + Qzxpgclavulan', 'Tablet'), ('test-cdci-09c-pg-bare', 'Qzxpgbare', 'Qzxpgbareol', 'Syrup');
-- Patients: P1 knows an allergy (a coded one and a free-text brand), P2 is "none", P3 is "not recorded" (the visits below use P1 unless noted).
update public.patients set allergies = array['Qzxpgamoxil', 'Augmentin'] where id = 'c1180000-0000-4000-8000-000000001001';

-- The signature and the reopen are written under the doctor's own session, as the commands do (09A R-15).
create function pg_temp.as_actor(p_user uuid, p_sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c1180000-0000-4000-8000-00000000000a')::text, true);
  execute p_sql;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end
$f$;
update public.clinical_notes set clinical_notes = 'Synthetic signed note' where visit_id in
  ('c1180000-0000-4000-8000-000000002003', 'c1180000-0000-4000-8000-000000002006', 'c1180000-0000-4000-8000-000000002008');
-- The guard probe's header exists before the visit is sealed (a header is never added to a sealed visit, 000108).
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id, version, status)
values ('c1180000-0000-4000-8000-0000000d0008', 'c1180000-0000-4000-8000-00000000000a', 'c1180000-0000-4000-8000-000000002008', 'c1180000-0000-4000-8000-000000001001', 'c1180000-0000-4000-8000-000000000102', 1, 'active');
do $do$
declare
  d constant uuid := 'c1180000-0000-4000-8000-000000000102';
begin
  perform pg_temp.as_actor(d, format($q$update public.visits set status = 'completed', signed_at = now(), signed_by = %L
    where id in ('c1180000-0000-4000-8000-000000002003', 'c1180000-0000-4000-8000-000000002006', 'c1180000-0000-4000-8000-000000002008')$q$, d));
  perform pg_temp.as_actor(d, format($q$insert into public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason)
    values ('c1180000-0000-4000-8000-00000000000a', 'c1180000-0000-4000-8000-000000002006', %L, 'Synthetic amendment reason')$q$, d));
  perform pg_temp.as_actor(d, $q$update public.visits set status = 'in_consultation' where id = 'c1180000-0000-4000-8000-000000002006'$q$);
end
$do$;

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
-- The command as one user of clinic A: change(user, visit, changes, request id).
create function pg_temp.change(p_user uuid, p_visit uuid, p_changes jsonb, p_req uuid default gen_random_uuid()) returns text language sql as $f$
  select pg_temp.act('authenticated', p_user, 'c1180000-0000-4000-8000-00000000000a',
    format('select public.change_prescription(%L, %L, %L::jsonb, %L)::text', 'c1180000-0000-4000-8000-00000000000a', p_visit, p_changes, p_req))
$f$;
create function pg_temp.jres(p_out text) returns jsonb language sql as $f$
  select case when p_out like 'ok:%' then substr(p_out, 4)::jsonb else null end
$f$;
create function pg_temp.items_of(p_visit uuid) returns bigint language sql as $f$
  select count(*) from public.prescription_items i join public.prescriptions p on p.id = i.prescription_id where p.visit_id = p_visit
$f$;
create function pg_temp.search(p_user uuid, p_tenant uuid, p_query text) returns text language sql as $f$
  select pg_temp.act('authenticated', p_user, p_tenant,
    format('select coalesce(string_agg(medicine_name || ''|'' || kind || ''|'' || coalesce(dosage, ''-'') || ''|'' || coalesce(timing, ''-'') || ''|'' || coalesce(duration, ''-''), '';'' order by ord), '''') from (select row_number() over () as ord, * from public.search_medicines(%L, %L, 15)) s', p_tenant, p_query))
$f$;



-- 1. The column, the CHECK, the index, the grants ------------------------------------------------------------------------------------------
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id, version, status)
values ('c1180000-0000-4000-8000-0000000d0001', 'c1180000-0000-4000-8000-00000000000a', 'c1180000-0000-4000-8000-000000002007', 'c1180000-0000-4000-8000-000000001001', 'c1180000-0000-4000-8000-000000000102', 1, 'active');
select is(pg_temp.act('postgres', null, 'c1180000-0000-4000-8000-00000000000a',
    $$insert into public.prescription_items (tenant_id, prescription_id, medicine_name, dosage, duration, allergy_override)
      values ('c1180000-0000-4000-8000-00000000000a', 'c1180000-0000-4000-8000-0000000d0001', 'Shape ok', '1', '1 day',
              '{"reason":"Tolerated before","allergens":["Qzxpgamoxil"],"by":"c1180000-0000-4000-8000-000000000102","at":"2031-01-15T10:00:00Z"}') returning medicine_name$$),
  'ok:Shape ok', 'a valid allergy_override is admitted');
select is((select count(*)::int from (values
    ('{"reason":"Tolerated before","allergens":["x"],"by":"c1180000-0000-4000-8000-000000000102"}'),
    ('{"reason":"no","allergens":["x"],"by":"c1180000-0000-4000-8000-000000000102","at":"2031-01-15T10:00:00Z"}'),
    ('{"reason":"Tolerated before","allergens":[],"by":"c1180000-0000-4000-8000-000000000102","at":"2031-01-15T10:00:00Z"}'),
    ('{"reason":"Tolerated before","allergens":["x"],"by":"not-a-uuid","at":"2031-01-15T10:00:00Z"}'),
    ('{"reason":"Tolerated before","allergens":["x"],"by":"c1180000-0000-4000-8000-000000000102","at":"2031-01-15T10:00:00Z","extra":1}'),
    ('{"reason":"Tolerated before","allergens":[1],"by":"c1180000-0000-4000-8000-000000000102","at":"2031-01-15T10:00:00Z"}'),
    ('"just a string"')) v(j)
    where pg_temp.act('postgres', null, 'c1180000-0000-4000-8000-00000000000a',
      format($q$insert into public.prescription_items (tenant_id, prescription_id, medicine_name, dosage, duration, allergy_override)
                values ('c1180000-0000-4000-8000-00000000000a', 'c1180000-0000-4000-8000-0000000d0001', 'Shape bad', '1', '1 day', %L::jsonb) returning 'x'$q$, v.j)) like 'error:23514:%'),
  7, 'seven malformed overrides are refused by the CHECK (a missing key, a short reason, no allergens, a bad id, an extra key, a non-string allergen, a scalar)');
select is((select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'cdci_substances' and indexname = 'idx_cdci_substances_name_lower'), 1, 'the substance-name index exists');
select is((select string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ',' order by 1)
             from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where p.oid = 'private.rx_allergy_matches(text[], text[], text[])'::regprocedure and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner),
  'authenticated', 'the rule helper is executable by authenticated only');
select is((select string_agg(distinct g, ',' order by g) from (select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as g
             from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where p.oid in ('private.allergy_substance_ids(text[])'::regprocedure, 'private.rx_line_substance_ids(text, text)'::regprocedure)
              and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) x),
  'authenticated', 'and so are the two lookups');

-- 2. The rule -------------------------------------------------------------------------------------------------------------------------------
select is(private.allergy_substance_ids(array['  QZXPGAMOXIL ', 'Penicillin']), array['test-sub-09c-pg-amox'], 'an allergy string equal to a substance name (any case, trimmed) codes to its id; other strings code to nothing');
select is(private.rx_line_substance_ids('test-cdci-09c-pg-combo', null), array['test-sub-09c-pg-amox', 'test-sub-09c-pg-clav'], 'a brand codes to its generic''s substance ids');
select is(private.rx_line_substance_ids('test-cdci-09c-pg-bare', null), array[]::text[], 'a brand with no generic, and a custom line, have none');
select is(private.rx_allergy_matches(array['Qzxpgamoxil'], array['test-sub-09c-pg-amox'], array['x']), array['Qzxpgamoxil'], 'a coded allergy matches by substance');
select is(private.rx_allergy_matches(array['Qzxpgamoxil'], array[]::text[], array['Qzxpgamoxil 500 mg']), array['Qzxpgamoxil'], 'a coded allergy and a line with no ids match by name');
select is(private.rx_allergy_matches(array['pen'], array[]::text[], array['Ampen forte']), array[]::text[], 'a word inside a longer word does not match');
select is(private.rx_allergy_matches(array['Augmentin'], array['test-sub-09c-pg-amox'], array['Augmentin 625 Duo']), array['Augmentin'], 'a brand recorded as the allergy is checked by name even when the line has substances');

-- 3. change_prescription ---------------------------------------------------------------------------------------------------------------------
select alike(pg_temp.change('c1180000-0000-4000-8000-000000000102', 'c1180000-0000-4000-8000-000000002001',
    '{"add":[{"medicine_name":"Qzxpgaugment 625","dosage":"1-0-1","duration":"5 days","cdci_brand_id":"test-cdci-09c-pg-combo"}]}'),
  'error:P0001:ALLERGY_MATCH%', 'the doctor: a matching add without a reason is ALLERGY_MATCH');
select alike(pg_temp.change('c1180000-0000-4000-8000-000000000101', 'c1180000-0000-4000-8000-000000002001',
    '{"add":[{"medicine_name":"Augmentin 625","dosage":"1-0-1","duration":"5 days"}]}'),
  'error:P0001:ALLERGY_MATCH%', 'the owner: a custom line matching a free-text allergy by name is ALLERGY_MATCH too');
select is((select count(*)::int from public.prescriptions where visit_id = 'c1180000-0000-4000-8000-000000002001') + (select count(*)::int from public.audit_logs where action = 'prescription.lines_change'), 0,
  'nothing was written: no header, no audit row');
create temp table allergy_add as
  select pg_temp.change('c1180000-0000-4000-8000-000000000102', 'c1180000-0000-4000-8000-000000002001',
    '{"add":[{"medicine_name":"Qzxpgaugment 625","dosage":"1-0-1","duration":"5 days","cdci_brand_id":"test-cdci-09c-pg-combo"},{"medicine_name":"Plain custom","dosage":"1-0-0","duration":"3 days"}],"allergy_override_reason":"Tolerated before, patient informed"}') as out;
select is((select (pg_temp.jres(out) ->> 'replayed') from allergy_add), 'false', 'with a reason the same change is admitted');
select is((select i.allergy_override ->> 'reason' || '|' || (i.allergy_override -> 'allergens')::text || '|' || (i.allergy_override ->> 'by' = 'c1180000-0000-4000-8000-000000000102')::text
             from public.prescription_items i join public.prescriptions p on p.id = i.prescription_id
            where p.visit_id = 'c1180000-0000-4000-8000-000000002001' and i.medicine_name = 'Qzxpgaugment 625'),
  'Tolerated before, patient informed|["Qzxpgamoxil"]|true', 'the matching line stores the reason, the matched allergens and the actor');
select is((select allergy_override is null from public.prescription_items i join public.prescriptions p on p.id = i.prescription_id
            where p.visit_id = 'c1180000-0000-4000-8000-000000002001' and i.medicine_name = 'Plain custom'), true, 'a line that matches nothing carries no override');
select is((select metadata::text from public.audit_logs where action = 'prescription.lines_change' and entity_id = (select id from public.prescriptions where visit_id = 'c1180000-0000-4000-8000-000000002001')),
  '{"added": 2, "removed": 0, "updated": 0, "allergy_overrides": 1}', 'the audit row counts the override and holds no text');
select is((select count(*)::int from public.audit_logs where metadata::text like '%Tolerated%'), 0, 'the reason is in no audit row');
select alike(pg_temp.change('c1180000-0000-4000-8000-000000000102', 'c1180000-0000-4000-8000-000000002002',
    '{"add":[{"medicine_name":"Qzxpgaugment 625","dosage":"1-0-1","duration":"5 days","cdci_brand_id":"test-cdci-09c-pg-combo"}],"allergy_override_reason":"no"}'),
  'error:P0001:INPUT_INVALID%', 'a reason under 5 characters is INPUT_INVALID');
-- an update confirms a matching line; a plain update is not refused
update public.patients set allergies = null where id = 'c1180000-0000-4000-8000-000000001001';
create temp table allergy_first as
  select pg_temp.change('c1180000-0000-4000-8000-000000000102', 'c1180000-0000-4000-8000-000000002002',
    '{"add":[{"medicine_name":"Qzxpgaugment 625","dosage":"1-0-1","duration":"5 days","cdci_brand_id":"test-cdci-09c-pg-combo"}]}') as out;
select is((select (pg_temp.jres(out) ->> 'replayed') from allergy_first), 'false', 'not recorded (NULL): nothing is checked');
update public.patients set allergies = array['Qzxpgamoxil'] where id = 'c1180000-0000-4000-8000-000000001001';
select alike(pg_temp.change('c1180000-0000-4000-8000-000000000102', 'c1180000-0000-4000-8000-000000002002',
    format('{"update":[{"id":%s,"duration":"7 days"}]}', to_json((select i.id from public.prescription_items i join public.prescriptions p on p.id = i.prescription_id where p.visit_id = 'c1180000-0000-4000-8000-000000002002' limit 1)))::jsonb),
  'ok:%', 'a plain dose update of a matching line is not refused');
select alike(pg_temp.change('c1180000-0000-4000-8000-000000000102', 'c1180000-0000-4000-8000-000000002002',
    format('{"update":[{"id":%s,"dosage":"1-0-1"}],"allergy_override_reason":"Reviewed with the patient"}', to_json((select i.id from public.prescription_items i join public.prescriptions p on p.id = i.prescription_id where p.visit_id = 'c1180000-0000-4000-8000-000000002002' limit 1)))::jsonb),
  'ok:%', 'an update with a reason confirms it');
select is((select allergy_override ->> 'reason' from public.prescription_items i join public.prescriptions p on p.id = i.prescription_id where p.visit_id = 'c1180000-0000-4000-8000-000000002002' limit 1), 'Reviewed with the patient', 'and stores the override');
-- the kill switch
insert into public.tenant_entitlement_overrides (tenant_id, key, enabled, reason) values ('c1180000-0000-4000-8000-00000000000a', 'assist.allergy_check', false, 'Synthetic test: off');
select alike(pg_temp.change('c1180000-0000-4000-8000-000000000102', 'c1180000-0000-4000-8000-000000002007',
    '{"add":[{"medicine_name":"Qzxpgaugment 625","dosage":"1-0-1","duration":"5 days","cdci_brand_id":"test-cdci-09c-pg-combo"}]}'),
  'ok:%', 'with assist.allergy_check overridden off the add needs no reason');
delete from public.tenant_entitlement_overrides where tenant_id = 'c1180000-0000-4000-8000-00000000000a' and key = 'assist.allergy_check';

-- 4. record_patient_allergies ----------------------------------------------------------------------------------------------------------------
select is((select prosecdef::text || ':' || (proconfig @> array['search_path=""'])::text || ':' || (proconfig @> array['lock_timeout=2s'])::text
             from pg_proc where oid = 'public.record_patient_allergies(uuid, uuid, jsonb, uuid)'::regprocedure), 'true:true:true', 'record_patient_allergies is DEFINER with search_path and lock_timeout pinned');
create function pg_temp.record(p_user uuid, p_patient uuid, p_list jsonb, p_tenant uuid default 'c1180000-0000-4000-8000-00000000000a', p_req uuid default gen_random_uuid()) returns text language sql as $f$
  select pg_temp.act('authenticated', p_user, 'c1180000-0000-4000-8000-00000000000a',
    format('select public.record_patient_allergies(%L, %L, %L::jsonb, %L)::text', p_tenant, p_patient, p_list, p_req))
$f$;
select is((pg_temp.jres(pg_temp.record('c1180000-0000-4000-8000-000000000102', 'c1180000-0000-4000-8000-000000001001', '["Qzxpgamoxil", " qzxpgAMOXIL", "Penicillin"]')) ->> 'allergies_count'), '2', 'a list is recorded with duplicates removed');
select is((select allergies from public.patients where id = 'c1180000-0000-4000-8000-000000001001'), array['Qzxpgamoxil', 'Penicillin'], 'and stored as given');
select is((select metadata::text from public.audit_logs where action = 'patient.allergies_record' and entity_id = 'c1180000-0000-4000-8000-000000001001'), '{"coded_count": 1, "allergies_count": 2}', 'the audit row holds counts only');
select is((pg_temp.jres(pg_temp.record('c1180000-0000-4000-8000-000000000102', 'c1180000-0000-4000-8000-000000001001', '[]')) ->> 'allergies_count'), '0', '[] is recorded as none');
select is((select allergies from public.patients where id = 'c1180000-0000-4000-8000-000000001001'), array[]::text[], 'stored as an empty list, not NULL');
select is((select count(*)::int from (values
    (pg_temp.record('c1180000-0000-4000-8000-000000000103', 'c1180000-0000-4000-8000-000000001001', '["x"]')),
    (pg_temp.record('c1180000-0000-4000-8000-000000000105', 'c1180000-0000-4000-8000-000000001001', '["x"]'))) r(o) where o like 'error:42501:FORBIDDEN%'), 2, 'the admin and the receptionist (the front desk) cannot record allergies');
select alike(pg_temp.record('c1180000-0000-4000-8000-000000000104', 'c1180000-0000-4000-8000-000000001001', '["Sulfa"]'), 'ok:%', 'the nurse (patients:edit and consultations:view) can');
select alike(pg_temp.act('authenticated', 'c1180000-0000-4000-8000-000000000201', 'c1180000-0000-4000-8000-00000000000b',
    format('select public.record_patient_allergies(%L, %L, %L::jsonb, gen_random_uuid())::text', 'c1180000-0000-4000-8000-00000000000a', 'c1180000-0000-4000-8000-000000001001', '["x"]')),
  'error:P0002:PATIENT_NOT_FOUND%', 'another clinic is PATIENT_NOT_FOUND');
select alike(pg_temp.record('c1180000-0000-4000-8000-000000000102', 'c1180000-0000-4000-8000-000000001001', (select jsonb_agg('A' || g) from generate_series(1, 51) g)), 'error:P0001:INPUT_INVALID%', '51 strings are INPUT_INVALID');

-- 5. The normaliser and the reads ---------------------------------------------------------------------------------------------------------------
select is(private.patient_input_normalize('{"full_name":"Synthetic N","phone":"9810000099"}'::jsonb) -> 'allergies', 'null'::jsonb, 'an absent allergies stays null (not recorded)');
select is(private.patient_input_normalize('{"full_name":"Synthetic N","phone":"9810000099","allergies":null}'::jsonb) -> 'allergies', 'null'::jsonb, 'a null allergies stays null');
select is(private.patient_input_normalize('{"full_name":"Synthetic N","phone":"9810000099","allergies":[]}'::jsonb) -> 'allergies', '[]'::jsonb, 'an explicit [] stays [] (no known allergies)');
select is(pg_temp.act('authenticated', 'c1180000-0000-4000-8000-000000000201', 'c1180000-0000-4000-8000-00000000000b',
    format('select public.rx_allergy_context(%L, %L)::text', 'c1180000-0000-4000-8000-00000000000a', 'c1180000-0000-4000-8000-000000002001')), 'ok:', 'rx_allergy_context reads nothing across clinics');
select is(pg_temp.act('authenticated', 'c1180000-0000-4000-8000-000000000201', 'c1180000-0000-4000-8000-00000000000b',
    format('select count(*)::text from public.search_substances(%L, %L, 5)', 'c1180000-0000-4000-8000-00000000000a', 'qzxpg')), 'ok:0', 'search_substances reads nothing across clinics');
select is(pg_temp.act('authenticated', 'c1180000-0000-4000-8000-000000000102', 'c1180000-0000-4000-8000-00000000000a',
    format('select string_agg(substance_name, %L order by substance_name) from public.search_substances(%L, %L, 5)', ',', 'c1180000-0000-4000-8000-00000000000a', 'qzxpg')), 'ok:Qzxpgamoxil,Qzxpgclavulan', 'search_substances finds the substances for a clinical role');
select is(pg_temp.act('authenticated', 'c1180000-0000-4000-8000-000000000105', 'c1180000-0000-4000-8000-00000000000a',
    format('select count(*)::text from public.search_substances(%L, %L, 5)', 'c1180000-0000-4000-8000-00000000000a', 'qzxpg')), 'ok:0', 'and finds nothing for the front desk');

select * from finish();
rollback;
