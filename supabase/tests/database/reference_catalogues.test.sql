-- reference_catalogues.test.sql — V2-09e 09E-09 (R-5, R-6; migration 000128; threats: a catalogue read past its permission or for another clinic,
-- a stale catalogue on the device because a reload did not change its version, the device's search order drifting from SQL).
--   1. public.reference_catalogues: RLS on, SELECT for authenticated only, no write for any API role, both rows seeded, the CHECK;
--   2. private.reference_catalogue_bump: definer, search_path pinned, no API grant; the five statement triggers;
--   3. each trigger moves ITS catalogue's version on insert, update, delete and truncate and leaves the other one alone;
--   4. public.reference_shard: STABLE INVOKER, EXECUTE authenticated only; NULL without the catalogue's permission, for another clinic, a forged or
--      unknown tenant, a clinic that is not full, no session, an unknown catalogue, a negative or out-of-range shard;
--   5. the shard shapes (exact keys, the version of the same snapshot, row arrays by id, the 12,000-brand shards and the generic position);
--   6. the three searches order equal-ranked names by lower(name) COLLATE "C" (a name the database's default collation would order otherwise).
-- Every read runs under the real principal. The file rolls back. Synthetic data only.
begin;
select plan(84);

insert into auth.users (id, email) values
  ('c1280000-0000-4000-8000-000000000101', 'c128-owner-a@example.test'),
  ('c1280000-0000-4000-8000-000000000102', 'c128-doctor-a@example.test'),
  ('c1280000-0000-4000-8000-000000000103', 'c128-admin-a@example.test'),
  ('c1280000-0000-4000-8000-000000000104', 'c128-nurse-a@example.test'),
  ('c1280000-0000-4000-8000-000000000105', 'c128-receptionist-a@example.test'),
  ('c1280000-0000-4000-8000-000000000201', 'c128-owner-b@example.test'),
  ('c1280000-0000-4000-8000-000000000301', 'c128-outsider@example.test'),
  ('c1280000-0000-4000-8000-000000000401', 'c128-owner-c@example.test');
insert into public.tenants (id, name) values
  ('c1280000-0000-4000-8000-00000000000a', 'Synthetic 000128 Clinic A'),
  ('c1280000-0000-4000-8000-00000000000b', 'Synthetic 000128 Clinic B'),
  ('c1280000-0000-4000-8000-00000000000c', 'Synthetic 000128 Clinic C (not full)');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1280000-0000-4000-8000-00000000000a', 'c1280000-0000-4000-8000-00000000000b') and s.status = 'incomplete';
insert into public.memberships (user_id, tenant_id, role) values
  ('c1280000-0000-4000-8000-000000000101', 'c1280000-0000-4000-8000-00000000000a', 'owner'),
  ('c1280000-0000-4000-8000-000000000102', 'c1280000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1280000-0000-4000-8000-000000000103', 'c1280000-0000-4000-8000-00000000000a', 'admin'),
  ('c1280000-0000-4000-8000-000000000104', 'c1280000-0000-4000-8000-00000000000a', 'nurse'),
  ('c1280000-0000-4000-8000-000000000105', 'c1280000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c1280000-0000-4000-8000-000000000201', 'c1280000-0000-4000-8000-00000000000b', 'owner'),
  ('c1280000-0000-4000-8000-000000000401', 'c1280000-0000-4000-8000-00000000000c', 'owner');

create function pg_temp.as_user(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '', true);
  begin
    set local role authenticated;
    execute p_sql into v_out;
    reset role;
  exception when others then
    reset role; v_out := 'error:' || sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$f$;
-- A shard as a user of clinic A (or p_tenant): the jsonb text, or 'NULL'.
create function pg_temp.shard(p_user text, p_catalogue text, p_shard integer default 0, p_tenant text default 'c1280000-0000-4000-8000-00000000000a') returns text language sql as $f$
  select pg_temp.as_user(('c1280000-0000-4000-8000-000000000' || p_user)::uuid,
    format($q$ select coalesce(public.reference_shard(%L, %L, %s)::text, 'NULL') $q$, p_tenant, p_catalogue, coalesce(p_shard::text, 'NULL')))
$f$;
-- Which catalogue versions a statement moved: 'cdci', 'diagnoses', 'cdci,diagnoses' or 'none'.
create function pg_temp.bumped(p_sql text) returns text language plpgsql as $f$
declare v_before jsonb; v_after jsonb;
begin
  select jsonb_object_agg(catalogue, version) into v_before from public.reference_catalogues;
  execute p_sql;
  select jsonb_object_agg(catalogue, version) into v_after from public.reference_catalogues;
  return coalesce((select string_agg(k, ',' order by k) from jsonb_object_keys(v_after) k where v_after -> k <> v_before -> k), 'none');
end;
$f$;

-- 1. The table ---------------------------------------------------------------------------------------------------------------------
select is((select relrowsecurity from pg_class where oid = 'public.reference_catalogues'::regclass), true, 'reference_catalogues has RLS on');
select is((select string_agg(grantee || ':' || privilege_type, ',' order by grantee, privilege_type) from information_schema.role_table_grants
            where table_schema = 'public' and table_name = 'reference_catalogues' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
  'authenticated:SELECT', 'only authenticated holds a privilege on reference_catalogues: SELECT');
select is((select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, ','), ';') from pg_policies where tablename = 'reference_catalogues'),
  'reference_catalogues_select:SELECT:authenticated', 'one policy: SELECT for authenticated');
select is((select string_agg(catalogue, ',' order by catalogue) from public.reference_catalogues), 'cdci,diagnoses', 'both catalogue rows are seeded');
select throws_ok($$ insert into public.reference_catalogues values ('medicines', gen_random_uuid(), now()) $$, '23514', null, 'the CHECK refuses another catalogue name');
select is(pg_temp.as_user('c1280000-0000-4000-8000-000000000102', $$ select count(*)::text from public.reference_catalogues $$), '2', 'a signed-in member reads both rows');
select is(pg_temp.as_user('c1280000-0000-4000-8000-000000000102', $$ update public.reference_catalogues set version = gen_random_uuid() returning 'written' $$), 'error:42501', 'authenticated cannot update a version');
select throws_ok($$ set local role anon; select count(*) from public.reference_catalogues $$, '42501', null, 'anon cannot read the versions');
select throws_ok($$ set local role service_role; update public.reference_catalogues set changed_at = now() $$, '42501', null, 'service_role cannot write a version');

-- 2. The bump and its triggers -----------------------------------------------------------------------------------------------------
select is((select p.prosecdef::text || ':' || array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'private.reference_catalogue_bump()'::regprocedure),
  'true:search_path=""', 'the bump is a definer function with search_path pinned');
select is((select count(*)::int from pg_proc p cross join lateral aclexplode(p.proacl) a
            where p.oid = 'private.reference_catalogue_bump()'::regprocedure and a.grantee::regrole::text in ('anon', 'authenticated', 'service_role', '-')), 0,
  'the bump has no API grant');
select is((select string_agg(c.relname || ':' || replace(encode(t.tgargs, 'escape'), '\000', ''), ',' order by c.relname)
             from pg_trigger t join pg_class c on c.oid = t.tgrelid
            where not t.tgisinternal and t.tgfoid = 'private.reference_catalogue_bump()'::regprocedure
              and (t.tgtype & 1) = 0 and (t.tgtype & 2) = 0 and (t.tgtype & 60) = 60),
  'cdci_brands:cdci,cdci_generics:cdci,cdci_medicines_search:cdci,cdci_substances:cdci,opd_diagnoses:diagnoses',
  'five AFTER statement triggers on insert, update, delete and truncate, each naming its catalogue');

-- 3. Each trigger moves its catalogue only -----------------------------------------------------------------------------------------------
select is(pg_temp.bumped($$ insert into public.cdci_substances (id, substance_name) values ('test-ref-sub-128-a', 'Qzxrefsubstance') $$), 'cdci', 'cdci_substances insert moves cdci only');
select is(pg_temp.bumped($$ update public.cdci_substances set substance_name = 'Qzxrefsubstance one' where id = 'test-ref-sub-128-a' $$), 'cdci', 'cdci_substances update moves cdci only');
select is(pg_temp.bumped($$ delete from public.cdci_substances where id = 'test-ref-sub-128-a' $$), 'cdci', 'cdci_substances delete moves cdci only');
select is(pg_temp.bumped($$ insert into public.cdci_generics (id, generic_name) values ('test-ref-gen-128-a', 'Qzxrefgeneric') $$), 'cdci', 'cdci_generics insert moves cdci only');
select is(pg_temp.bumped($$ update public.cdci_generics set generic_name = 'Qzxrefgeneric one' where id = 'test-ref-gen-128-a' $$), 'cdci', 'cdci_generics update moves cdci only');
select is(pg_temp.bumped($$ delete from public.cdci_generics where id = 'test-ref-gen-128-a' $$), 'cdci', 'cdci_generics delete moves cdci only');
select is(pg_temp.bumped($$ insert into public.cdci_brands (id, brand_name) values ('test-ref-brand-128-a', 'Qzxrefbrand') $$), 'cdci', 'cdci_brands insert moves cdci only');
select is(pg_temp.bumped($$ update public.cdci_brands set brand_name = 'Qzxrefbrand one' where id = 'test-ref-brand-128-a' $$), 'cdci', 'cdci_brands update moves cdci only');
select is(pg_temp.bumped($$ delete from public.cdci_brands where id = 'test-ref-brand-128-a' $$), 'cdci', 'cdci_brands delete moves cdci only');
select is(pg_temp.bumped($$ insert into public.cdci_medicines_search (id, brand_name) values ('test-ref-brand-128-a', 'Qzxrefbrand') $$), 'cdci', 'cdci_medicines_search insert moves cdci only');
select is(pg_temp.bumped($$ update public.cdci_medicines_search set brand_name = 'Qzxrefbrand one' where id = 'test-ref-brand-128-a' $$), 'cdci', 'cdci_medicines_search update moves cdci only');
select is(pg_temp.bumped($$ delete from public.cdci_medicines_search where id = 'test-ref-brand-128-a' $$), 'cdci', 'cdci_medicines_search delete moves cdci only');
select is(pg_temp.bumped($$ insert into public.opd_diagnoses (id, name) values ('c1280000-0000-4000-8000-00000000d001', 'Qzxrefdiagnosis') $$), 'diagnoses', 'opd_diagnoses insert moves diagnoses only');
select is(pg_temp.bumped($$ update public.opd_diagnoses set name = 'Qzxrefdiagnosis one' where id = 'c1280000-0000-4000-8000-00000000d001' $$), 'diagnoses', 'opd_diagnoses update moves diagnoses only');
select is(pg_temp.bumped($$ delete from public.opd_diagnoses where id = 'c1280000-0000-4000-8000-00000000d001' $$), 'diagnoses', 'opd_diagnoses delete moves diagnoses only');
select is(pg_temp.bumped($$ update public.cdci_substances set substance_name = substance_name where false $$), 'cdci', 'a statement that touches no row still moves its catalogue (statement level: the version never lags a write)');
-- TRUNCATE (rolled back with the file): the reload path of a seed.
select is(pg_temp.bumped($$ truncate public.cdci_substances $$), 'cdci', 'cdci_substances truncate moves cdci only');
select is(pg_temp.bumped($$ truncate public.cdci_generics $$), 'cdci', 'cdci_generics truncate moves cdci only');
select is(pg_temp.bumped($$ truncate public.cdci_brands $$), 'cdci', 'cdci_brands truncate moves cdci only');
select is(pg_temp.bumped($$ truncate public.cdci_medicines_search $$), 'cdci', 'cdci_medicines_search truncate moves cdci only');
select is(pg_temp.bumped($$ truncate public.opd_diagnoses $$), 'diagnoses', 'opd_diagnoses truncate moves diagnoses only');
select is((select count(*)::int from public.reference_catalogues where changed_at = now()), 2, 'changed_at is the writing transaction''s now()');

-- Catalogue fixtures (the tables are empty after the truncates above): substances, generics, brands with their search rows, diagnoses.
insert into public.cdci_substances (id, substance_name) values
  ('test-ref-sub-128-2', 'Qzxtiea'), ('test-ref-sub-128-1', 'Qzxtie-b'), ('test-ref-sub-128-3', 'Ämoxicillin Qzx');
insert into public.cdci_generics (id, generic_name, substance_ids) values
  ('test-ref-gen-128-b', 'Qzxgeneric Beta', array['test-ref-sub-128-2']),
  ('test-ref-gen-128-a', 'Qzxgeneric Alpha', array['test-ref-sub-128-1', 'test-ref-sub-128-3']);
insert into public.cdci_brands (id, brand_name, generic_id) values
  ('test-ref-brand-128-1', 'Qzxtie-b', 'test-ref-gen-128-b'),
  ('test-ref-brand-128-2', 'Qzxtiea', 'test-ref-gen-128-a'),
  ('test-ref-brand-128-3', 'Qzxnogeneric', null);
insert into public.cdci_medicines_search (id, brand_name, generic_name, dose_form) values
  ('test-ref-brand-128-1', 'Qzxtie-b', 'Qzxgeneric Beta', 'Tablet'),
  ('test-ref-brand-128-2', 'Qzxtiea', 'Qzxgeneric Alpha', 'Syrup'),
  ('test-ref-brand-128-3', 'Qzxnogeneric', null, null);
insert into public.opd_diagnoses (id, name, icd11_code, snomed_concept_id, is_chronic, specialties, synonyms) values
  ('c1280000-0000-4000-8000-00000000d002', 'Qzxtiea', 'XX1', '111', true, array['general'], array['Qzxsyn']),
  ('c1280000-0000-4000-8000-00000000d001', 'Qzxtie-b', null, null, false, null, null);

-- 4. reference_shard: grants and refusals ------------------------------------------------------------------------------------------------
select is((select p.prosecdef::text || ':' || p.provolatile::text || ':' || array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'public.reference_shard(uuid, text, integer)'::regprocedure),
  'false:s:search_path=""', 'reference_shard is a STABLE INVOKER function with search_path pinned');
select is((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text)
             from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid = 'public.reference_shard(uuid, text, integer)'::regprocedure and a.grantee <> p.proowner),
  'authenticated:EXECUTE', 'EXECUTE is granted to authenticated only (not PUBLIC, anon or service_role)');
select throws_ok($$ set local role anon; select public.reference_shard('c1280000-0000-4000-8000-00000000000a', 'substances', 0) $$, '42501', null, 'anon cannot execute it');
select throws_ok($$ set local role service_role; select public.reference_shard('c1280000-0000-4000-8000-00000000000a', 'substances', 0) $$, '42501', null, 'service_role cannot execute it');
select is((select coalesce(public.reference_shard('c1280000-0000-4000-8000-00000000000a', 'substances', 0)::text, 'NULL')), 'NULL', 'no session: NULL');
select is(pg_temp.shard('105', 'substances'), 'NULL', 'a receptionist (no consultations:view) gets no substances');
select is(pg_temp.shard('103', 'substances'), 'NULL', 'an admin (no consultations:view) gets no substances');
select is(pg_temp.shard('105', 'diagnoses'), 'NULL', 'a receptionist gets no diagnoses');
select is(pg_temp.shard('104', 'medicines'), 'NULL', 'a nurse (no prescriptions:edit) gets no medicines');
select is(pg_temp.shard('103', 'medicines'), 'NULL', 'an admin gets no medicines');
select is(pg_temp.shard('201', 'substances'), 'NULL', 'the owner of B naming clinic A (a forged tenant) gets NULL');
select is(pg_temp.shard('102', 'substances', 0, 'c1280000-0000-4000-8000-00000000000b'), 'NULL', 'a doctor of A naming clinic B gets NULL');
select is(pg_temp.shard('301', 'substances'), 'NULL', 'a user with no membership gets NULL');
select is(pg_temp.shard('401', 'substances', 0, 'c1280000-0000-4000-8000-00000000000c'), 'NULL', 'the owner of a clinic that is not full gets NULL');
select is(pg_temp.shard('101', 'substances', 0, 'c1280000-0000-4000-8000-0000000000ff'), 'NULL', 'an unknown tenant gets NULL');
select is(pg_temp.shard('101', 'patients'), 'NULL', 'an unknown catalogue gets NULL');
select is(pg_temp.shard('101', 'substances', -1), 'NULL', 'a negative shard gets NULL');
select is(pg_temp.shard('101', 'substances', 1), 'NULL', 'substances has one shard: shard 1 is NULL');
select is(pg_temp.shard('101', 'diagnoses', 1), 'NULL', 'diagnoses has one shard: shard 1 is NULL');
select is(pg_temp.shard('101', 'substances', null), 'NULL', 'a NULL shard gets NULL');
select is(pg_temp.as_user('c1280000-0000-4000-8000-000000000101', $$ select coalesce(public.reference_shard(null, 'substances', 0)::text, 'NULL') $$), 'NULL', 'a NULL tenant gets NULL');
select is(pg_temp.as_user('c1280000-0000-4000-8000-000000000101', $$ select coalesce(public.reference_shard('c1280000-0000-4000-8000-00000000000a', null, 0)::text, 'NULL') $$), 'NULL', 'a NULL catalogue gets NULL');

-- 5. Shapes -------------------------------------------------------------------------------------------------------------------------------
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.shard('104', 'substances')::jsonb) k), 'catalogue,rows,shard,shards,version',
  'a substance shard has exactly catalogue, version, shard, shards, rows');
select is(pg_temp.shard('104', 'substances')::jsonb - 'rows' - 'version', '{"catalogue": "substances", "shard": 0, "shards": 1}'::jsonb, 'substances: shard 0 of 1 (the nurse holds consultations:view)');
select is((pg_temp.shard('102', 'substances')::jsonb ->> 'version')::uuid, (select version from public.reference_catalogues where catalogue = 'cdci'), 'the substance shard carries the cdci version of the same snapshot');
select is(pg_temp.shard('102', 'substances')::jsonb -> 'rows', '[["test-ref-sub-128-1", "Qzxtie-b"], ["test-ref-sub-128-2", "Qzxtiea"], ["test-ref-sub-128-3", "Ämoxicillin Qzx"]]'::jsonb,
  'substance rows are [id, name] ordered by id, non-ASCII names kept');
select is((pg_temp.shard('101', 'diagnoses')::jsonb ->> 'version')::uuid, (select version from public.reference_catalogues where catalogue = 'diagnoses'), 'the diagnosis shard carries the diagnoses version');
select is(pg_temp.shard('104', 'diagnoses')::jsonb -> 'rows',
  '[["c1280000-0000-4000-8000-00000000d001", "Qzxtie-b", null, null, false, [], []], ["c1280000-0000-4000-8000-00000000d002", "Qzxtiea", "XX1", "111", true, ["general"], ["Qzxsyn"]]]'::jsonb,
  'diagnosis rows are [id, name, icd11, snomed, chronic, specialties, synonyms] by id; NULL arrays are empty arrays');
select is(pg_temp.shard('102', 'medicines', 0)::jsonb - 'rows' - 'version', '{"catalogue": "medicines", "shard": 0, "shards": 2}'::jsonb, 'medicines: shard 0 of 2 (generics, then one shard of three brands)');
select is(pg_temp.shard('102', 'medicines', 0)::jsonb -> 'rows',
  '[["test-ref-gen-128-a", "Qzxgeneric Alpha", ["test-ref-sub-128-1", "test-ref-sub-128-3"]], ["test-ref-gen-128-b", "Qzxgeneric Beta", ["test-ref-sub-128-2"]]]'::jsonb,
  'medicine shard 0 is the generics [id, name, substance_ids] by id');
select is(pg_temp.shard('101', 'medicines', 1)::jsonb -> 'rows',
  '[["test-ref-brand-128-1", "Qzxtie-b", 1, "Tablet"], ["test-ref-brand-128-2", "Qzxtiea", 0, "Syrup"], ["test-ref-brand-128-3", "Qzxnogeneric", null, null]]'::jsonb,
  'medicine shard 1 is the brands [id, brand_name, generic_row, dose_form] by id; generic_row is the generic''s position in shard 0, NULL without one');
select is((pg_temp.shard('102', 'medicines', 1)::jsonb ->> 'version')::uuid, (select version from public.reference_catalogues where catalogue = 'cdci'), 'medicines share the cdci version');
select is(pg_temp.shard('102', 'medicines', 2), 'NULL', 'a brand shard past the last is NULL');
-- 12,000 brands per shard: 24,001 more brands make 24,004 = two full shards and one of four.
insert into public.cdci_medicines_search (id, brand_name)
select 'test-ref-brand-128-z' || lpad(g::text, 5, '0'), 'Qzxbulk ' || g from generate_series(1, 24001) g;
select is((pg_temp.shard('102', 'medicines', 0)::jsonb ->> 'shards')::int, 4, '24,004 brands: generics plus three brand shards');
select is(jsonb_array_length(pg_temp.shard('102', 'medicines', 1)::jsonb -> 'rows'), 12000, 'the first brand shard holds 12,000 rows');
select is(jsonb_array_length(pg_temp.shard('102', 'medicines', 2)::jsonb -> 'rows'), 12000, 'the second brand shard holds 12,000 rows');
select is(jsonb_array_length(pg_temp.shard('102', 'medicines', 3)::jsonb -> 'rows'), 4, 'the last brand shard holds the remaining 4');
select is((select count(distinct e ->> 0)::int from generate_series(1, 3) s cross join lateral jsonb_array_elements(pg_temp.shard('102', 'medicines', s)::jsonb -> 'rows') e), 24004,
  'every brand is in exactly one shard');
select is(pg_temp.shard('102', 'medicines', 3)::jsonb #>> '{rows,3,0}', 'test-ref-brand-128-z24001', 'brands are paged in id order (the last id is in the last shard)');
select is(pg_temp.shard('102', 'medicines', 4), 'NULL', 'shard 4 of 4 is out of range');
select cmp_ok(octet_length(pg_temp.shard('102', 'medicines', 1)), '<', 1048576, 'a full brand shard is under 1 MB raw');
select is(pg_temp.as_user('c1280000-0000-4000-8000-000000000102', $$ select (public.reference_shard('c1280000-0000-4000-8000-00000000000a', 'substances', 0) ->> 'version') = (select version::text from public.reference_catalogues where catalogue = 'cdci')::text $$),
  'true', 'under the caller''s own JWT the version equals the readable reference_catalogues row');
-- The bump during a transaction: the next shard read carries the new version.
select is(pg_temp.bumped($$ update public.cdci_substances set substance_name = 'Qzxtiea' where id = 'test-ref-sub-128-2' $$), 'cdci', 'an edit of a substance moves cdci');
select is((pg_temp.shard('102', 'substances')::jsonb ->> 'version')::uuid, (select version from public.reference_catalogues where catalogue = 'cdci'), 'the shard read after the edit carries the new version');

-- 6. The tie-breaks: lower(name) COLLATE "C" (en_US puts 'qzxtiea' before 'qzxtie-b'; byte order puts '-' first) ------------------------------------------------
select is(pg_temp.as_user('c1280000-0000-4000-8000-000000000104', $$ select string_agg(id, ',' order by ord) from (select s.id, row_number() over () as ord from public.search_substances('c1280000-0000-4000-8000-00000000000a', 'qzxtie') s) x $$),
  'test-ref-sub-128-1,test-ref-sub-128-2', 'search_substances: two prefix matches order by lower(name) COLLATE "C" (Qzxtie-b before Qzxtiea)');
select is(pg_temp.as_user('c1280000-0000-4000-8000-000000000102', $$ select string_agg(d.name, ',' order by ord) from (select d.name, row_number() over () as ord from public.search_diagnoses('c1280000-0000-4000-8000-00000000000a', array['qzxtie']) d) d $$),
  'Qzxtie-b,Qzxtiea', 'search_diagnoses: two prefix matches order by lower(name) COLLATE "C"');
select is(pg_temp.as_user('c1280000-0000-4000-8000-000000000102', $$ select string_agg(m.medicine_name, ',' order by ord) from (select m.medicine_name, row_number() over () as ord from public.search_medicines('c1280000-0000-4000-8000-00000000000a', 'qzxtie') m) m $$),
  'Qzxtie-b,Qzxtiea', 'search_medicines: two brand-prefix matches order by lower(name) COLLATE "C"');
select is((select ('qzxtie-b' < 'qzxtiea' collate "C")::text || ',' || ('qzxtie-b' < 'qzxtiea' collate "en_US.utf8")::text), 'true,false',
  'control: the two collations disagree on this pair, so the cases above test the tie-break');
select is((select string_agg(p.proname, ',' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('search_substances', 'search_diagnoses', 'search_medicines') and pg_get_functiondef(p.oid) like '%COLLATE "C"%'),
  'search_diagnoses,search_medicines,search_substances', 'all three searches carry the COLLATE "C" tie-break');
select is((select string_agg(a.grantee::regrole::text, ',' order by a.grantee::regrole::text)
             from pg_proc p cross join lateral aclexplode(p.proacl) a
            where p.pronamespace = 'public'::regnamespace and p.proname in ('search_substances', 'search_diagnoses', 'search_medicines') and a.grantee <> p.proowner),
  'authenticated,authenticated,authenticated', 'the replaced searches keep EXECUTE for authenticated only');

select * from finish();
rollback;
