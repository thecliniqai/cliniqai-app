-- rx_lines_command.test.sql — V2-09c 09C-01 (R-2, R-3, R-12; migration 000117_rx_lines_command).
--
-- 1. The print columns: tenants.rx_paper_size and rx_letterhead_mode (defaults, CHECKs), the margins' 0 to 300 CHECK, prescriptions.paper_size (default,
--    CHECK, and no request path may change it after the INSERT: no UPDATE privilege on the column), cdci_generics.substance_ids (default, GIN index).
-- 2. The medicine search: the 4-argument DEFINER function of 000061 is gone; public.search_medicines(uuid, text, integer) is a STABLE INVOKER read with EXECUTE
--    for authenticated only; a prescriber finds a catalogue row with no dose, the caller's own custom medicine first with the stored dose, never another
--    doctor's; a role without prescriptions:edit and another clinic's session get nothing; `%` and `_` match themselves; tsquery syntax is data.
-- 3. The command public.change_prescription: catalog (definer, pinned settings, EXECUTE for authenticated only), an add creates the header once with the
--    clinic's paper size and letterhead mode, the item, the doctor's custom medicine (use_count + 1) and one audit row with counts only, replay and
--    IDEMPOTENCY_MISMATCH, update (dose fields only, same id), remove, sort order continues, an item of another visit is ITEM_NOT_FOUND with nothing
--    written, the role matrix, another clinic, sealed / unsigned completed / cancelled are DRAFT_LOCKED, an amending visit is admitted, input validation.
-- 4. The contract: authenticated holds no INSERT, UPDATE or DELETE on prescription_items, no INSERT on prescriptions, no INSERT or UPDATE on
--    doctor_custom_medicines (each direct write is 42501), the PDF-pair UPDATE on prescriptions stays, and the 09A guards still fire for a definer body
--    that writes with the caller's JWT.
-- Every call runs under the real principal (set local role, JWT claims, the x-clinicos-tenant header). The file rolls back. Synthetic data only.
begin;
select plan(64);

-- Fixtures ----------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1170000-0000-4000-8000-000000000101', 'c117-owner-a@example.test'),
  ('c1170000-0000-4000-8000-000000000102', 'c117-doctor-a@example.test'),
  ('c1170000-0000-4000-8000-000000000103', 'c117-admin-a@example.test'),
  ('c1170000-0000-4000-8000-000000000104', 'c117-nurse-a@example.test'),
  ('c1170000-0000-4000-8000-000000000105', 'c117-receptionist-a@example.test'),
  ('c1170000-0000-4000-8000-000000000106', 'c117-doctor2-a@example.test'),
  ('c1170000-0000-4000-8000-000000000201', 'c117-owner-b@example.test');
insert into public.tenants (id, name) values
  ('c1170000-0000-4000-8000-00000000000a', 'Synthetic 09C-01 Clinic A'),
  ('c1170000-0000-4000-8000-00000000000b', 'Synthetic 09C-01 Clinic B');
update public.tenants set rx_paper_size = 'A5', rx_letterhead_mode = 'preprinted_letterhead' where id = 'c1170000-0000-4000-8000-00000000000a';
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1170000-0000-4000-8000-00000000000a', 'c1170000-0000-4000-8000-00000000000b');
insert into public.memberships (user_id, tenant_id, role) values
  ('c1170000-0000-4000-8000-000000000101', 'c1170000-0000-4000-8000-00000000000a', 'owner'),
  ('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1170000-0000-4000-8000-000000000103', 'c1170000-0000-4000-8000-00000000000a', 'admin'),
  ('c1170000-0000-4000-8000-000000000104', 'c1170000-0000-4000-8000-00000000000a', 'nurse'),
  ('c1170000-0000-4000-8000-000000000105', 'c1170000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c1170000-0000-4000-8000-000000000106', 'c1170000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1170000-0000-4000-8000-000000000201', 'c1170000-0000-4000-8000-00000000000b', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1170000-0000-4000-8000-000000001001', 'c1170000-0000-4000-8000-00000000000a', 'Synthetic Rx Patient', '+919000011701', 'c1170000-0000-4000-8000-000000000101'),
  ('c1170000-0000-4000-8000-000000001002', 'c1170000-0000-4000-8000-00000000000b', 'Synthetic Rx Patient B', '+919000011702', 'c1170000-0000-4000-8000-000000000201');

-- D 2001 draft (in consultation, the main visit), E 2002 in consultation (the second visit: a foreign item id), S 2003 sealed (signed), C 2004 cancelled,
-- U 2005 completed unsigned, M 2006 amending (signed, reopened), R 2007 in consultation (the role matrix), G 2008 sealed with a header (the guard probe).
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by)
select ('c1170000-0000-4000-8000-00000000' || v.n)::uuid, 'c1170000-0000-4000-8000-00000000000a', 'c1170000-0000-4000-8000-000000001001',
       'c1170000-0000-4000-8000-000000000102', 'walk_in', v.st, 'c1170000-0000-4000-8000-000000000101'
  from (values ('2001', 'in_consultation'), ('2002', 'in_consultation'), ('2003', 'in_consultation'), ('2004', 'cancelled'), ('2005', 'completed'),
               ('2006', 'in_consultation'), ('2007', 'in_consultation'), ('2008', 'in_consultation')) as v(n, st);
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1170000-0000-4000-8000-000000003001', 'c1170000-0000-4000-8000-00000000000b', 'c1170000-0000-4000-8000-000000001002', 'c1170000-0000-4000-8000-000000000201', 'walk_in', 'in_consultation', 'c1170000-0000-4000-8000-000000000201');

-- Catalogue and custom medicines (global reference rows and the two doctors' own).
insert into public.cdci_medicines_search (id, brand_name, generic_name, dose_form) values
  ('test-cdci-09c-pg-1', 'Qzxpg Alpha 500', 'Qzxpgol 500 mg', 'Tablet'),
  ('test-cdci-09c-pg-2', 'Qzxpg Beta 250', 'Qzxpgin 250 mg', 'Capsule'),
  ('test-cdci-09c-pg-3', 'Qzxpg 50% Special', 'Qzxpgam', 'Syrup'),
  ('test-cdci-09c-pg-4', 'Qzxpg_Under', 'Qzxpgum', 'Syrup'),
  ('test-cdci-09c-pg-5', 'Qzxpgxbeta', 'Qzxpgxx', 'Syrup');
insert into public.doctor_custom_medicines (tenant_id, doctor_id, medicine_name, generic_name, dose_form, default_dosage, default_timing, default_duration, use_count) values
  ('c1170000-0000-4000-8000-00000000000a', 'c1170000-0000-4000-8000-000000000102', 'Qzxpg Own Mix', 'Qzxpg mix', 'Syrup', '1-0-1', 'After food', '3 days', 9),
  ('c1170000-0000-4000-8000-00000000000a', 'c1170000-0000-4000-8000-000000000106', 'Qzxpg Other Doctors Mix', 'Qzxpg other', 'Syrup', '1-1-1', NULL, '2 days', 4);

-- The signature and the reopen are written under the doctor's own session, as the commands do (09A R-15).
create function pg_temp.as_actor(p_user uuid, p_sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c1170000-0000-4000-8000-00000000000a')::text, true);
  execute p_sql;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end
$f$;
update public.clinical_notes set clinical_notes = 'Synthetic signed note' where visit_id in
  ('c1170000-0000-4000-8000-000000002003', 'c1170000-0000-4000-8000-000000002006', 'c1170000-0000-4000-8000-000000002008');
-- The guard probe's header exists before the visit is sealed (a header is never added to a sealed visit, 000108).
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id, version, status)
values ('c1170000-0000-4000-8000-0000000d0008', 'c1170000-0000-4000-8000-00000000000a', 'c1170000-0000-4000-8000-000000002008', 'c1170000-0000-4000-8000-000000001001', 'c1170000-0000-4000-8000-000000000102', 1, 'active');
do $do$
declare
  d constant uuid := 'c1170000-0000-4000-8000-000000000102';
begin
  perform pg_temp.as_actor(d, format($q$update public.visits set status = 'completed', signed_at = now(), signed_by = %L
    where id in ('c1170000-0000-4000-8000-000000002003', 'c1170000-0000-4000-8000-000000002006', 'c1170000-0000-4000-8000-000000002008')$q$, d));
  perform pg_temp.as_actor(d, format($q$insert into public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason)
    values ('c1170000-0000-4000-8000-00000000000a', 'c1170000-0000-4000-8000-000000002006', %L, 'Synthetic amendment reason')$q$, d));
  perform pg_temp.as_actor(d, $q$update public.visits set status = 'in_consultation' where id = 'c1170000-0000-4000-8000-000000002006'$q$);
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
  select pg_temp.act('authenticated', p_user, 'c1170000-0000-4000-8000-00000000000a',
    format('select public.change_prescription(%L, %L, %L::jsonb, %L)::text', 'c1170000-0000-4000-8000-00000000000a', p_visit, p_changes, p_req))
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


-- 1. Columns -----------------------------------------------------------------------------------------------------------------
select is((select column_default || ':' || is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'tenants' and column_name = 'rx_paper_size'),
  '''A4''::text:NO', 'tenants.rx_paper_size: NOT NULL DEFAULT A4');
select is((select column_default || ':' || is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'tenants' and column_name = 'rx_letterhead_mode'),
  '''blank_paper''::text:NO', 'tenants.rx_letterhead_mode: NOT NULL DEFAULT blank_paper');
select alike(pg_temp.act('postgres', null, 'c1170000-0000-4000-8000-00000000000a', $$update public.tenants set rx_paper_size = 'A3' where id = 'c1170000-0000-4000-8000-00000000000a'$$),
  'error:23514:%', 'a paper size other than A4 or A5 is refused (CHECK)');
select alike(pg_temp.act('postgres', null, 'c1170000-0000-4000-8000-00000000000a', $$update public.tenants set letterhead_top_margin = 301 where id = 'c1170000-0000-4000-8000-00000000000a'$$),
  'error:23514:%', 'a letterhead margin over 300 points is refused (CHECK)');
select is(pg_temp.act('postgres', null, 'c1170000-0000-4000-8000-00000000000a', $$update public.tenants set letterhead_top_margin = 300, letterhead_bottom_margin = 0 where id = 'c1170000-0000-4000-8000-00000000000a' returning letterhead_top_margin::text$$),
  'ok:300', '0 and 300 points are admitted');
select is((select column_default || ':' || is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'prescriptions' and column_name = 'paper_size'),
  '''A4''::text:NO', 'prescriptions.paper_size: NOT NULL DEFAULT A4');
select is(has_column_privilege('authenticated', 'public.prescriptions', 'paper_size', 'UPDATE')::text, 'false',
  'no request path may change paper_size after the INSERT (no UPDATE privilege on the column)');
select is(has_column_privilege('authenticated', 'public.prescriptions', 'pdf_storage_path', 'UPDATE')::text, 'true',
  'the PDF pair stays updatable for the signer''s archive (R-A)');
select is((select column_default || ':' || is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'cdci_generics' and column_name = 'substance_ids'),
  '''{}''::text[]:NO', 'cdci_generics.substance_ids: text[] NOT NULL DEFAULT {}');
select is((select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'cdci_generics' and indexname = 'idx_cdci_generics_substance_ids' and indexdef like '%USING gin%'),
  1, 'substance_ids has a GIN index');

-- 2. The medicine search -------------------------------------------------------------------------------------------------------
select is(to_regprocedure('public.search_medicines(text, uuid, uuid, integer)')::text, null, 'the 4-argument DEFINER search of 000061 is gone');
select is((select prosecdef::text || ':' || provolatile::text from pg_proc where oid = 'public.search_medicines(uuid, text, integer)'::regprocedure), 'false:s',
  'the new search is INVOKER and STABLE');
select is((select string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ',' order by 1)
             from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where p.oid = 'public.search_medicines(uuid, text, integer)'::regprocedure and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner),
  'authenticated', 'EXECUTE is held by authenticated only');
select alike(pg_temp.search('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-00000000000a', 'qzxpg own'), 'ok:Qzxpg Own Mix|custom|1-0-1|After food|3 days;%',
  'the doctor''s own custom medicine is found first, with the stored dose');
select is((select count(*)::int from public.doctor_custom_medicines where medicine_name = 'Qzxpg Other Doctors Mix') = 1 and pg_temp.search('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-00000000000a', 'other doctors') not like '%Other Doctors%', true,
  'another doctor''s custom medicine is never returned, although the table''s SELECT policy would show it');
select is(pg_temp.act('authenticated', 'c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-00000000000a',
    $$select count(*) filter (where kind = 'cdci' and (dosage is not null or timing is not null or duration is not null))::text || ':' || count(*) filter (where kind = 'cdci' and medicine_name = 'Qzxpg Alpha 500' and generic_name = 'Qzxpgol 500 mg' and substance_ids = '{}')::text from public.search_medicines('c1170000-0000-4000-8000-00000000000a', 'qzxpg alpha', 15)$$),
  'ok:0:1', 'a catalogue row carries no dosage, timing or duration (nothing is invented) and its substance ids are empty until the CDCI load');
select is((select pg_temp.search('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-00000000000a', 'qzxpg')), 'ok:Qzxpg Own Mix|custom|1-0-1|After food|3 days;Qzxpg 50% Special|cdci|-|-|-;Qzxpg Alpha 500|cdci|-|-|-;Qzxpg Beta 250|cdci|-|-|-;Qzxpg_Under|cdci|-|-|-;Qzxpgxbeta|cdci|-|-|-',
  'the caller''s own medicine first, then the catalogue by rank and name');
select is(pg_temp.act('authenticated', 'c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-00000000000a',
    $$select string_agg(medicine_name, ';' order by medicine_name) from public.search_medicines('c1170000-0000-4000-8000-00000000000a', '50%', 15) where medicine_name like 'Qzxpg%'$$),
  'ok:Qzxpg 50% Special', '% in the query matches itself, not everything (of this file''s rows: other rows of a shared catalogue may match too)');
select is(pg_temp.act('authenticated', 'c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-00000000000a',
    $$select string_agg(medicine_name, ';' order by medicine_name) from public.search_medicines('c1170000-0000-4000-8000-00000000000a', 'pg_u', 15) where medicine_name like 'Qzxpg%'$$),
  'ok:Qzxpg_Under', '_ in the query matches itself, not any character (of this file''s rows)');
select alike(pg_temp.search('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-00000000000a', '(qzxpg & !beta) | x:*'), 'ok:%', 'tsquery syntax is data: no error');
select is(pg_temp.search('c1170000-0000-4000-8000-000000000104', 'c1170000-0000-4000-8000-00000000000a', 'qzxpg alpha'), 'ok:', 'a role without prescriptions:edit gets nothing');
select is(pg_temp.search('c1170000-0000-4000-8000-000000000201', 'c1170000-0000-4000-8000-00000000000a', 'qzxpg alpha'), 'ok:', 'a session of another clinic naming this clinic gets nothing');
select is(pg_temp.act('anon', null, 'c1170000-0000-4000-8000-00000000000a', $$select count(*)::text from public.search_medicines('c1170000-0000-4000-8000-00000000000a', 'qzxpg', 5)$$) like 'error:42501%', true,
  'anon cannot execute the search');

-- 3. The command: catalog -------------------------------------------------------------------------------------------------------
select is((select prosecdef::text || ':' || (proconfig @> array['search_path=""'])::text || ':' || (proconfig @> array['lock_timeout=2s'])::text
             from pg_proc where oid = 'public.change_prescription(uuid, uuid, jsonb, uuid)'::regprocedure), 'true:true:true',
  'change_prescription is DEFINER with search_path and lock_timeout pinned');
select is((select string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ',' order by 1)
             from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where p.oid = 'public.change_prescription(uuid, uuid, jsonb, uuid)'::regprocedure and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner),
  'authenticated', 'EXECUTE is held by authenticated only');

-- The happy path: the first add on a fresh visit creates the header with the clinic's print settings.
create temp table first_add as
  select pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002001', '{"add":[{"medicine_name":"Qzxpg Alpha 500","generic_name":"Qzxpgol 500 mg","dose_form":"Tablet","dosage":"1-0-0","timing":null,"duration":"5 days","cdci_brand_id":"test-cdci-09c-pg-1"}]}', 'c1170000-0000-4000-8000-00000000f001') as out;
select is((select (pg_temp.jres(out) ->> 'replayed') || ':' || jsonb_array_length(pg_temp.jres(out) -> 'added_item_ids') from first_add), 'false:1', 'an add answers the new item id');
select is((select p.paper_size || ':' || p.letterhead_mode || ':' || p.version || ':' || p.status || ':' || (p.doctor_id = 'c1170000-0000-4000-8000-000000000102')::text
             from public.prescriptions p where p.visit_id = 'c1170000-0000-4000-8000-000000002001'),
  'A5:preprinted_letterhead:1:active:true', 'the header is created once with the clinic''s paper size and letterhead mode, by the caller');
select is((select i.medicine_name || '|' || i.dosage || '|' || coalesce(i.timing, 'NULL') || '|' || i.duration || '|' || i.sort_order || '|' || i.cdci_brand_id
             from public.prescription_items i join public.prescriptions p on p.id = i.prescription_id where p.visit_id = 'c1170000-0000-4000-8000-000000002001'),
  'Qzxpg Alpha 500|1-0-0|NULL|5 days|0|test-cdci-09c-pg-1', 'the item is stored as sent: no timing is invented');
select is((select count(*)::int || ':' || (metadata ->> 'added') || (metadata ->> 'updated') || (metadata ->> 'removed') || ':' || (select count(*) from jsonb_object_keys(metadata))
             from public.audit_logs where tenant_id = 'c1170000-0000-4000-8000-00000000000a' and action = 'prescription.lines_change'
              and entity_id = (select id from public.prescriptions where visit_id = 'c1170000-0000-4000-8000-000000002001') group by metadata), '1:100:3',
  'one audit row with counts only (added, updated, removed)');
select is((select count(*)::int from public.doctor_custom_medicines where medicine_name = 'Qzxpg Alpha 500'), 0, 'a catalogue medicine does not join the doctor''s custom list');

-- A custom line: the doctor's list gains it with the line's dose as their stored values; the same medicine again raises use_count.
select is((pg_temp.jres(pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002001', '{"add":[{"medicine_name":"Qzxpg Custom Drop","dosage":"1-1-1","timing":"With food","duration":"7 days","special_instructions":"Shake well"}]}')) ->> 'replayed'),
  'false', 'a custom line is added');
select is((select default_dosage || '|' || default_timing || '|' || default_duration || '|' || use_count from public.doctor_custom_medicines
            where medicine_name = 'Qzxpg Custom Drop' and doctor_id = 'c1170000-0000-4000-8000-000000000102'), '1-1-1|With food|7 days|1',
  'the custom medicine is stored with the line''s dose, use_count 1');
select is((pg_temp.jres(pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002002', '{"add":[{"medicine_name":"Qzxpg Custom Drop","dosage":"1-0-1","duration":"3 days"}]}')) ->> 'replayed'),
  'false', 'the same medicine on another visit');
select is((select default_dosage || '|' || coalesce(default_timing, 'NULL') || '|' || use_count from public.doctor_custom_medicines
            where medicine_name = 'Qzxpg Custom Drop' and doctor_id = 'c1170000-0000-4000-8000-000000000102'), '1-0-1|NULL|2',
  'use_count rises by one and the stored dose follows the latest line (a null timing stays null)');
select is((select string_agg(i.sort_order::text, ',' order by i.sort_order) from public.prescription_items i join public.prescriptions p on p.id = i.prescription_id
            where p.visit_id = 'c1170000-0000-4000-8000-000000002001'), '0,1', 'sort orders are contiguous in array order');

-- Replay and mismatch.
select is((pg_temp.jres(pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002001', '{"add":[{"medicine_name":"Qzxpg Alpha 500","generic_name":"Qzxpgol 500 mg","dose_form":"Tablet","dosage":"1-0-0","timing":null,"duration":"5 days","cdci_brand_id":"test-cdci-09c-pg-1"}]}', 'c1170000-0000-4000-8000-00000000f001')) ->> 'replayed'),
  'true', 'the same request id replays the first result');
select is(pg_temp.items_of('c1170000-0000-4000-8000-000000002001')::int, 2, 'a replay writes nothing');
select alike(pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002001', '{"add":[{"medicine_name":"Other","dosage":"1-0-0","duration":"1 day"}]}', 'c1170000-0000-4000-8000-00000000f001'),
  'error:P0001:IDEMPOTENCY_MISMATCH%', 'the same id for other changes is IDEMPOTENCY_MISMATCH');

-- Update: dose fields only, same id; remove.
create temp table ids as select i.id, i.medicine_name from public.prescription_items i join public.prescriptions p on p.id = i.prescription_id where p.visit_id = 'c1170000-0000-4000-8000-000000002001';
select is((pg_temp.jres(pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002001',
    jsonb_build_object('update', jsonb_build_array(jsonb_build_object('id', (select id from ids where medicine_name = 'Qzxpg Alpha 500'), 'duration', '10 days', 'timing', 'After food')))::jsonb)) ->> 'replayed'),
  'false', 'an update is accepted');
select is((select i.medicine_name || '|' || i.dosage || '|' || i.timing || '|' || i.duration || '|' || (i.id = (select id from ids where medicine_name = 'Qzxpg Alpha 500'))::text
             from public.prescription_items i where i.id = (select id from ids where medicine_name = 'Qzxpg Alpha 500')),
  'Qzxpg Alpha 500|1-0-0|After food|10 days|true', 'only the dose fields named change; the medicine and the id stay');
select alike(pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002002',
    jsonb_build_object('update', jsonb_build_array(jsonb_build_object('id', (select id from ids where medicine_name = 'Qzxpg Alpha 500'), 'duration', '1 day')))::jsonb),
  'error:P0002:ITEM_NOT_FOUND%', 'an item of another visit is ITEM_NOT_FOUND');
select is((select duration from public.prescription_items where id = (select id from ids where medicine_name = 'Qzxpg Alpha 500')), '10 days', 'and nothing is changed');
select alike(pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002002',
    jsonb_build_object('add', jsonb_build_array(jsonb_build_object('medicine_name', 'Qzxpg Must Not Persist', 'dosage', '1-0-0', 'duration', '1 day')),
                       'remove', jsonb_build_array((select id from ids where medicine_name = 'Qzxpg Alpha 500')))::jsonb),
  'error:P0002:ITEM_NOT_FOUND%', 'a remove of another visit''s item refuses the whole change');
select is((select count(*)::int from public.prescription_items where medicine_name = 'Qzxpg Must Not Persist'), 0, 'the add in the same change did not persist');
select is((pg_temp.jres(pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002001',
    jsonb_build_object('remove', jsonb_build_array((select id from ids where medicine_name = 'Qzxpg Alpha 500')),
                       'add', jsonb_build_array(jsonb_build_object('medicine_name', 'Qzxpg Third', 'dosage', '0-0-1', 'duration', '2 days')))::jsonb)) ->> 'replayed'),
  'false', 'remove and add in one change');
select is((select string_agg(i.medicine_name || ':' || i.sort_order, ',' order by i.sort_order) from public.prescription_items i join public.prescriptions p on p.id = i.prescription_id
            where p.visit_id = 'c1170000-0000-4000-8000-000000002001'), 'Qzxpg Custom Drop:1,Qzxpg Third:2', 'the item is gone and the next sort order follows the highest');

-- The role matrix and another clinic.
select alike(pg_temp.change('c1170000-0000-4000-8000-000000000101', 'c1170000-0000-4000-8000-000000002007', '{"add":[{"medicine_name":"Qzxpg Owner Line","dosage":"1-0-0","duration":"1 day"}]}'), 'ok:%', 'the owner may prescribe');
select alike(pg_temp.change('c1170000-0000-4000-8000-000000000106', 'c1170000-0000-4000-8000-000000002007', '{"add":[{"medicine_name":"Qzxpg Doctor Two Line","dosage":"1-0-0","duration":"1 day"}]}'), 'ok:%',
  'a second doctor of the clinic continues the prescription (the header stays the first prescriber''s)');
select is((select count(*)::int from (values (pg_temp.change('c1170000-0000-4000-8000-000000000103', 'c1170000-0000-4000-8000-000000002007', '{"add":[{"medicine_name":"x","dosage":"1","duration":"1 day"}]}')),
                                              (pg_temp.change('c1170000-0000-4000-8000-000000000104', 'c1170000-0000-4000-8000-000000002007', '{"add":[{"medicine_name":"x","dosage":"1","duration":"1 day"}]}')),
                                              (pg_temp.change('c1170000-0000-4000-8000-000000000105', 'c1170000-0000-4000-8000-000000002007', '{"add":[{"medicine_name":"x","dosage":"1","duration":"1 day"}]}'))) r(o)
            where o like 'error:42501:FORBIDDEN%'), 3, 'admin, nurse and receptionist are FORBIDDEN');
select alike(pg_temp.act('authenticated', 'c1170000-0000-4000-8000-000000000201', 'c1170000-0000-4000-8000-00000000000b',
    format('select public.change_prescription(%L, %L, %L::jsonb, gen_random_uuid())::text', 'c1170000-0000-4000-8000-00000000000a', 'c1170000-0000-4000-8000-000000002001', '{"remove":["c1170000-0000-4000-8000-0000000000aa"]}')),
  'error:P0002:VISIT_NOT_FOUND%', 'another clinic''s session naming this clinic is VISIT_NOT_FOUND');
select alike(pg_temp.act('authenticated', 'c1170000-0000-4000-8000-000000000201', 'c1170000-0000-4000-8000-00000000000b',
    format('select public.change_prescription(%L, %L, %L::jsonb, gen_random_uuid())::text', 'c1170000-0000-4000-8000-00000000000b', 'c1170000-0000-4000-8000-000000002001', '{"add":[{"medicine_name":"x","dosage":"1","duration":"1 day"}]}')),
  'error:P0002:VISIT_NOT_FOUND%', 'a visit of another clinic is VISIT_NOT_FOUND');

-- Record states.
select is((select count(*)::int from (values
    (pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002003', '{"add":[{"medicine_name":"x","dosage":"1","duration":"1 day"}]}')),
    (pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002004', '{"add":[{"medicine_name":"x","dosage":"1","duration":"1 day"}]}')),
    (pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002005', '{"add":[{"medicine_name":"x","dosage":"1","duration":"1 day"}]}'))) r(o)
    where o like 'error:P0001:DRAFT_LOCKED%'), 3, 'a sealed, a cancelled and an unsigned completed visit are DRAFT_LOCKED');
select is((select count(*)::int from public.prescriptions where visit_id in ('c1170000-0000-4000-8000-000000002003', 'c1170000-0000-4000-8000-000000002004', 'c1170000-0000-4000-8000-000000002005')), 0,
  'and no header was created on them');
select alike(pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002006', '{"add":[{"medicine_name":"Qzxpg Amended Line","dosage":"1-0-0","duration":"1 day"}]}'), 'ok:%', 'an amending visit takes a change');

-- Input validation: each is INPUT_INVALID (P0001) and writes nothing.
select is((select count(*)::int from (values
    (pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002001', '{}')),
    (pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002001', '{"add":[]}')),
    (pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002001', '{"swap":[]}')),
    (pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002001', '{"add":[{"medicine_name":"x","dosage":"1","duration":"1 day","sort_order":3}]}')),
    (pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002001', '{"add":[{"medicine_name":"x","dosage":"","duration":"1 day"}]}')),
    (pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002001', '{"add":[{"medicine_name":"x","dosage":"1"}]}')),
    (pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002001', '{"add":[{"medicine_name":"x","dosage":"1","duration":"1 day","cdci_brand_id":"no-such-brand"}]}')),
    (pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002001', ('{"add":[{"medicine_name":"x","dosage":"1","duration":"1 day","special_instructions":"' || repeat('y', 501) || '"}]}')::jsonb)),
    (pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002001', '{"update":[{"id":"c1170000-0000-4000-8000-0000000000aa"}]}')),
    (pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002001', '{"remove":["not-a-uuid"]}')),
    (pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002001', '{"remove":["c1170000-0000-4000-8000-0000000000aa","c1170000-0000-4000-8000-0000000000aa"]}')),
    (pg_temp.change('c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-000000002001', ('{"add":' || (select jsonb_agg(jsonb_build_object('medicine_name', 'm' || g, 'dosage', '1', 'duration', '1 day'))::text from generate_series(1, 31) g) || '}')::jsonb))
  ) r(o) where o like 'error:P0001:INPUT_INVALID%'), 12, 'twelve malformed change sets are INPUT_INVALID');
select is(pg_temp.items_of('c1170000-0000-4000-8000-000000002001')::int, 2, 'and none of them wrote an item');

-- 4. The contract ----------------------------------------------------------------------------------------------------------------
select is((select string_agg(p, ',' order by p) from (select p from unnest(array['INSERT', 'UPDATE', 'DELETE']) p where has_table_privilege('authenticated', 'public.prescription_items', p)) x), null,
  'authenticated holds no INSERT, UPDATE or DELETE on prescription_items');
select is(has_table_privilege('authenticated', 'public.prescription_items', 'SELECT')::text, 'true', 'and still reads them');
select is(has_table_privilege('authenticated', 'public.prescriptions', 'INSERT')::text, 'false', 'authenticated holds no INSERT on prescriptions');
select is(has_table_privilege('authenticated', 'public.doctor_custom_medicines', 'INSERT')::text || ':' || has_table_privilege('authenticated', 'public.doctor_custom_medicines', 'UPDATE'), 'false:false',
  'authenticated holds no INSERT or UPDATE on doctor_custom_medicines');
select alike(pg_temp.act('authenticated', 'c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-00000000000a',
    $$insert into public.prescription_items (tenant_id, prescription_id, medicine_name, dosage, duration) select tenant_id, id, 'Direct', '1', '1 day' from public.prescriptions where visit_id = 'c1170000-0000-4000-8000-000000002001'$$),
  'error:42501:%', 'a direct JWT insert of an item is refused');
select alike(pg_temp.act('authenticated', 'c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-00000000000a',
    $$update public.prescription_items set dosage = 'Direct' where medicine_name = 'Qzxpg Third'$$),
  'error:42501:%', 'a direct JWT update of an item is refused');
select alike(pg_temp.act('authenticated', 'c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-00000000000a',
    $$delete from public.prescription_items where medicine_name = 'Qzxpg Third'$$),
  'error:42501:%', 'a direct JWT delete of an item is refused');

-- The 09A guards still fire for a definer body that writes with the caller's JWT (the property change_prescription relies on).
create function public.zz_definer_write(p_prescription uuid) returns void language plpgsql security definer set search_path = '' as $f$
begin
  insert into public.prescription_items (tenant_id, prescription_id, medicine_name, dosage, duration)
  values ('c1170000-0000-4000-8000-00000000000a', p_prescription, 'Definer write', '1', '1 day');
end
$f$;
grant execute on function public.zz_definer_write(uuid) to authenticated;
select alike(pg_temp.act('authenticated', 'c1170000-0000-4000-8000-000000000102', 'c1170000-0000-4000-8000-00000000000a',
    $$select public.zz_definer_write('c1170000-0000-4000-8000-0000000d0008')::text$$),
  'error:42501:PRESCRIPTION_ITEM_VISIT_SIGNED%', 'on a sealed visit the integrity guard refuses a definer write made under the doctor''s JWT');

select * from finish();
rollback;
