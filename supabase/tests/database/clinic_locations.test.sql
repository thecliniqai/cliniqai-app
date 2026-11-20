-- clinic_locations.test.sql — V2-07 plan 07-00 (R-5 branch hook, R-2 command_results; migration 000095).
--   1. Every clinic has exactly one default location (the backfill and the tenants trigger); a new clinic gets "Main";
--      a second default is refused; a non-default location may exist.
--   2. visits, queue_tokens and invoices get the clinic's default location when the writer names none (also an explicit
--      NULL), keep a location the writer names, and refuse another clinic's location (composite FK, 23503); the column
--      is NOT NULL; no row of any clinic is left without a same-clinic location.
--   3. A location in use cannot be deleted (RESTRICT); deleting a clinic still cascades through all of it.
--   4. RLS and grants: members read their active clinic's locations only; nobody but the owner role writes; anon reads
--      nothing.
--   5. command_results: RLS on, no policy, no privilege for any API role; command_claim / command_complete are definer
--      with search_path '' and lock_timeout 2s, executable by no API role since 000099 (07-04a F-4: only the definer
--      commands call them); command_hash_key (000099, G-8): RLS on, no policy, no privilege, one 32-byte key, and the
--      keyed request hash is stable for one payload, differs per payload and is not executable by any API role.
-- Synthetic data only; the file rolls back.
begin;
select plan(42);

insert into auth.users (id, email) values
  ('c0950000-0000-4000-8000-000000000101', 'c095-owner-a@example.test'),
  ('c0950000-0000-4000-8000-000000000201', 'c095-owner-b@example.test');
insert into public.tenants (id, name) values
  ('c0950000-0000-4000-8000-00000000000a', 'Synthetic 07-00 Clinic A'),
  ('c0950000-0000-4000-8000-00000000000b', 'Synthetic 07-00 Clinic B');
-- The clinics are trialing on the Standard price so they keep full access (the RLS helpers read the access level).
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c0950000-0000-4000-8000-00000000000a', 'c0950000-0000-4000-8000-00000000000b');
insert into public.memberships (user_id, tenant_id, role) values
  ('c0950000-0000-4000-8000-000000000101', 'c0950000-0000-4000-8000-00000000000a', 'owner'),
  ('c0950000-0000-4000-8000-000000000201', 'c0950000-0000-4000-8000-00000000000b', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c0950000-0000-4000-8000-000000001001', 'c0950000-0000-4000-8000-00000000000a', 'Synthetic Location Patient A', '+919000000951', 'c0950000-0000-4000-8000-000000000101'),
  ('c0950000-0000-4000-8000-000000002001', 'c0950000-0000-4000-8000-00000000000b', 'Synthetic Location Patient B', '+919000000952', 'c0950000-0000-4000-8000-000000000201');

create function pg_temp.val_as(p_user uuid, p_header uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
  perform set_config('request.headers',
    case when p_header is null then '' else json_build_object('x-clinicos-tenant', p_header)::text end, true);
  begin
    if p_user is null then set local role anon; else set local role authenticated; end if;
    execute p_sql into v_out;
    reset role;
  exception
    when insufficient_privilege then reset role; v_out := 'denied:' || sqlerrm;
    when others then reset role; v_out := 'error:' || sqlstate;
  end;
  return v_out;
end;
$f$;

-- 1. Defaults ---------------------------------------------------------------------------------------------------------
select is(
  (select count(*)::int from public.tenants t
    where (select count(*) from public.clinic_locations l where l.tenant_id = t.id and l.is_default) <> 1),
  0, 'every clinic (existing ones backfilled, new ones by the trigger) has exactly one default location');
select is(
  (select array_agg(l.name || ':' || l.is_default::text) from public.clinic_locations l where l.tenant_id = 'c0950000-0000-4000-8000-00000000000a'),
  array['Main:true'], 'a new clinic gets its default location "Main"');
select throws_ok(
  $$ insert into public.clinic_locations (tenant_id, name, is_default) values ('c0950000-0000-4000-8000-00000000000a', 'Second default', true) $$,
  '23505', null, 'a second default location of one clinic is refused');
select lives_ok(
  $$ insert into public.clinic_locations (id, tenant_id, name) values ('c0950000-0000-4000-8000-000000003001', 'c0950000-0000-4000-8000-00000000000a', 'Synthetic Annex') $$,
  'a non-default location of the same clinic may exist');
select throws_ok(
  $$ insert into public.clinic_locations (tenant_id, name) values ('c0950000-0000-4000-8000-00000000000a', '   ') $$,
  '23514', null, 'a blank location name is refused');
select is(
  (select count(*)::int from public.clinic_locations l where l.tenant_id = 'c0950000-0000-4000-8000-00000000000b' and l.is_default),
  1, 'clinic B has its own default, separate from A''s');

-- 2. location_id on visits, queue_tokens, invoices --------------------------------------------------------------------
select is(
  (select array_agg(c.table_name::text || ':' || c.is_nullable order by c.table_name)
     from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'location_id' and c.table_name in ('visits', 'queue_tokens', 'invoices')),
  array['invoices:NO', 'queue_tokens:NO', 'visits:NO'], 'location_id is NOT NULL on visits, queue_tokens and invoices');

insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by) values
  ('c0950000-0000-4000-8000-000000001101', 'c0950000-0000-4000-8000-00000000000a', 'c0950000-0000-4000-8000-000000001001', 'c0950000-0000-4000-8000-000000000101', 'walk_in', 'c0950000-0000-4000-8000-000000000101'),
  ('c0950000-0000-4000-8000-000000002101', 'c0950000-0000-4000-8000-00000000000b', 'c0950000-0000-4000-8000-000000002001', 'c0950000-0000-4000-8000-000000000201', 'walk_in', 'c0950000-0000-4000-8000-000000000201');
select is(
  (select v.location_id from public.visits v where v.id = 'c0950000-0000-4000-8000-000000001101'),
  (select l.id from public.clinic_locations l where l.tenant_id = 'c0950000-0000-4000-8000-00000000000a' and l.is_default),
  'a visit inserted without a location gets the clinic''s default');
select is(
  (select v.location_id from public.visits v where v.id = 'c0950000-0000-4000-8000-000000002101'),
  (select l.id from public.clinic_locations l where l.tenant_id = 'c0950000-0000-4000-8000-00000000000b' and l.is_default),
  'a visit of clinic B gets B''s default, not A''s');

insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by, location_id) values
  ('c0950000-0000-4000-8000-000000001102', 'c0950000-0000-4000-8000-00000000000a', 'c0950000-0000-4000-8000-000000001001', 'c0950000-0000-4000-8000-000000000101', 'walk_in', 'c0950000-0000-4000-8000-000000000101', null),
  ('c0950000-0000-4000-8000-000000001103', 'c0950000-0000-4000-8000-00000000000a', 'c0950000-0000-4000-8000-000000001001', 'c0950000-0000-4000-8000-000000000101', 'walk_in', 'c0950000-0000-4000-8000-000000000101', 'c0950000-0000-4000-8000-000000003001');
select is(
  (select v.location_id from public.visits v where v.id = 'c0950000-0000-4000-8000-000000001102'),
  (select l.id from public.clinic_locations l where l.tenant_id = 'c0950000-0000-4000-8000-00000000000a' and l.is_default),
  'an explicit NULL location is filled with the default too (NOT NULL never trips for an unaware writer)');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by, location_id) values
  ('c0950000-0000-4000-8000-000000001104', 'c0950000-0000-4000-8000-00000000000a', 'c0950000-0000-4000-8000-000000001001', 'c0950000-0000-4000-8000-000000000101', 'walk_in', 'c0950000-0000-4000-8000-000000000101', '00000000-0000-0000-0000-000000000000');
select is(
  (select v.location_id from public.visits v where v.id = 'c0950000-0000-4000-8000-000000001104'),
  (select l.id from public.clinic_locations l where l.tenant_id = 'c0950000-0000-4000-8000-00000000000a' and l.is_default),
  'the nil uuid (the column default, named explicitly) is replaced by the default location, never stored');
select is(
  (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where d.adrelid = 'public.visits'::regclass and a.attname = 'location_id'),
  '''00000000-0000-0000-0000-000000000000''::uuid', 'the column default is the nil uuid (keeps the generated Insert types optional)');
select is(
  (select v.location_id from public.visits v where v.id = 'c0950000-0000-4000-8000-000000001103'),
  'c0950000-0000-4000-8000-000000003001'::uuid, 'a location the writer names is kept');
select throws_ok(
  $$ insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, created_by, location_id) values
       ('c0950000-0000-4000-8000-00000000000a', 'c0950000-0000-4000-8000-000000001001', 'c0950000-0000-4000-8000-000000000101', 'walk_in', 'c0950000-0000-4000-8000-000000000101',
        (select l.id from public.clinic_locations l where l.tenant_id = 'c0950000-0000-4000-8000-00000000000b' and l.is_default)) $$,
  '23503', null, 'a visit of A naming B''s location is refused by the composite FK');

insert into public.queue_tokens (id, tenant_id, visit_id, token_number) values
  ('c0950000-0000-4000-8000-000000004001', 'c0950000-0000-4000-8000-00000000000a', 'c0950000-0000-4000-8000-000000001101', 1);
select is(
  (select t.location_id from public.queue_tokens t where t.id = 'c0950000-0000-4000-8000-000000004001'),
  (select l.id from public.clinic_locations l where l.tenant_id = 'c0950000-0000-4000-8000-00000000000a' and l.is_default),
  'a queue token inserted without a location gets the clinic''s default');
select throws_ok(
  $$ insert into public.queue_tokens (tenant_id, visit_id, token_number, location_id) values
       ('c0950000-0000-4000-8000-00000000000a', 'c0950000-0000-4000-8000-000000001102', 2,
        (select l.id from public.clinic_locations l where l.tenant_id = 'c0950000-0000-4000-8000-00000000000b' and l.is_default)) $$,
  '23503', null, 'a queue token of A naming B''s location is refused by the composite FK');

insert into public.invoices (id, tenant_id, visit_id, patient_id, invoice_number) values
  ('c0950000-0000-4000-8000-000000005001', 'c0950000-0000-4000-8000-00000000000a', 'c0950000-0000-4000-8000-000000001101', 'c0950000-0000-4000-8000-000000001001', 'LOC-0001');
select is(
  (select i.location_id from public.invoices i where i.id = 'c0950000-0000-4000-8000-000000005001'),
  (select l.id from public.clinic_locations l where l.tenant_id = 'c0950000-0000-4000-8000-00000000000a' and l.is_default),
  'an invoice inserted without a location gets the clinic''s default');
select throws_ok(
  $$ insert into public.invoices (tenant_id, visit_id, patient_id, invoice_number, location_id) values
       ('c0950000-0000-4000-8000-00000000000a', 'c0950000-0000-4000-8000-000000001102', 'c0950000-0000-4000-8000-000000001001', 'LOC-0002',
        (select l.id from public.clinic_locations l where l.tenant_id = 'c0950000-0000-4000-8000-00000000000b' and l.is_default)) $$,
  '23503', null, 'an invoice of A naming B''s location is refused by the composite FK');
select throws_ok(
  $$ update public.visits set location_id = (select l.id from public.clinic_locations l where l.tenant_id = 'c0950000-0000-4000-8000-00000000000b' and l.is_default)
      where id = 'c0950000-0000-4000-8000-000000001101' $$,
  '23503', null, 'moving a visit to another clinic''s location is refused');
select throws_ok(
  $$ update public.visits set location_id = null where id = 'c0950000-0000-4000-8000-000000001101' $$,
  '23502', null, 'a visit cannot lose its location (NOT NULL)');
select is(
  (select (select count(*) from public.visits v left join public.clinic_locations l on l.id = v.location_id and l.tenant_id = v.tenant_id where l.id is null)
        + (select count(*) from public.queue_tokens v left join public.clinic_locations l on l.id = v.location_id and l.tenant_id = v.tenant_id where l.id is null)
        + (select count(*) from public.invoices v left join public.clinic_locations l on l.id = v.location_id and l.tenant_id = v.tenant_id where l.id is null)),
  0::bigint, 'every visit, queue token and invoice has a same-clinic location');
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public'
      and indexname in ('visits_tenant_location_idx', 'queue_tokens_tenant_location_idx', 'invoices_tenant_location_idx')),
  3, 'the three location FKs are indexed (tenant_id, location_id)');

-- 3. Delete rules -----------------------------------------------------------------------------------------------------
select throws_ok(
  $$ delete from public.clinic_locations where id = 'c0950000-0000-4000-8000-000000003001' $$,
  '23503', null, 'a location used by a visit cannot be deleted (RESTRICT)');
select lives_ok(
  $$ delete from public.tenants where id = 'c0950000-0000-4000-8000-00000000000b' $$,
  'deleting a clinic still cascades through its locations and the rows that reference them');
select is((select count(*)::int from public.clinic_locations where tenant_id = 'c0950000-0000-4000-8000-00000000000b'), 0,
  'the deleted clinic''s locations are gone');

-- 4. RLS and grants ---------------------------------------------------------------------------------------------------
select is(
  pg_temp.val_as('c0950000-0000-4000-8000-000000000101', null, $$ select count(*)::text from public.clinic_locations $$),
  (select count(*)::text from public.clinic_locations l where l.tenant_id = 'c0950000-0000-4000-8000-00000000000a'),
  'the owner of A reads A''s locations and nobody else''s');
select is(
  pg_temp.val_as('c0950000-0000-4000-8000-000000000101', null,
    $$ insert into public.clinic_locations (tenant_id, name) values ('c0950000-0000-4000-8000-00000000000a', 'Synthetic Forged') returning 'inserted' $$),
  'denied:permission denied for table clinic_locations', 'a member cannot insert a location');
select is(
  pg_temp.val_as('c0950000-0000-4000-8000-000000000101', null,
    $$ update public.clinic_locations set name = 'Renamed' where tenant_id = 'c0950000-0000-4000-8000-00000000000a' returning 'updated' $$),
  'denied:permission denied for table clinic_locations', 'a member cannot rename a location');
select is(
  pg_temp.val_as('c0950000-0000-4000-8000-000000000101', null, $$ delete from public.clinic_locations where tenant_id = 'c0950000-0000-4000-8000-00000000000a' returning 'deleted' $$),
  'denied:permission denied for table clinic_locations', 'a member cannot delete a location');
select is(
  pg_temp.val_as(null, null, $$ select count(*)::text from public.clinic_locations $$),
  'denied:permission denied for table clinic_locations', 'anon reads no location');
select is(
  pg_temp.val_as('c0950000-0000-4000-8000-000000000101', null, $$ select count(*)::text from public.visits where location_id is not null $$),
  (select count(*)::text from public.visits v where v.tenant_id = 'c0950000-0000-4000-8000-00000000000a'),
  'location_id is readable on visits (SELECT is table-wide)');

-- 5. command_results and the helpers ----------------------------------------------------------------------------------
select is(
  (select c.relrowsecurity::text || ':' || (select count(*)::text from pg_policies p where p.schemaname = 'private' and p.tablename = 'command_results')
     from pg_class c where c.oid = 'private.command_results'::regclass),
  'true:0', 'command_results: RLS enabled, no policy');
select is(
  (select array_agg(r || ':' || has_table_privilege(r, 'private.command_results', 'SELECT')::text
                         || ':' || has_table_privilege(r, 'private.command_results', 'INSERT')::text order by r)
     from unnest(array['anon', 'authenticated', 'service_role']) r),
  array['anon:false:false', 'authenticated:false:false', 'service_role:false:false'], 'command_results: no table privilege for any API role');
select is(
  (select array_agg(p.proname || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ',') order by p.proname)
     from pg_proc p where p.oid in ('private.command_claim(uuid, uuid, text, text, text)'::regprocedure, 'private.command_complete(uuid, uuid, jsonb)'::regprocedure)),
  array['command_claim:true:search_path="",lock_timeout=2s', 'command_complete:true:search_path="",lock_timeout=2s'],
  'command_claim / command_complete: SECURITY DEFINER, search_path empty, lock_timeout 2s');
select is(
  (select array_agg(f || ':' || r || ':' || has_function_privilege(r, f, 'EXECUTE')::text order by f, r)
     from unnest(array['private.command_claim(uuid, uuid, text, text, text)', 'private.command_complete(uuid, uuid, jsonb)']) f
    cross join unnest(array['anon', 'authenticated', 'service_role']) r),
  array['private.command_claim(uuid, uuid, text, text, text):anon:false', 'private.command_claim(uuid, uuid, text, text, text):authenticated:false',
        'private.command_claim(uuid, uuid, text, text, text):service_role:false', 'private.command_complete(uuid, uuid, jsonb):anon:false',
        'private.command_complete(uuid, uuid, jsonb):authenticated:false', 'private.command_complete(uuid, uuid, jsonb):service_role:false'],
  'the claim helpers are executable by no API role (F-4: only the definer command functions call them)');
select is(
  (select array_agg(p.proname || ':' || p.prosecdef::text order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('tenants_create_default_location', 'fill_default_location')),
  array['fill_default_location:true', 'tenants_create_default_location:true'], 'the two trigger functions are definer');
select is(
  (select array_agg(f || ':' || has_function_privilege('authenticated', f, 'EXECUTE')::text order by f)
     from unnest(array['private.tenants_create_default_location()', 'private.fill_default_location()']) f),
  array['private.fill_default_location():false', 'private.tenants_create_default_location():false'], 'the trigger functions are not executable by authenticated');
select alike(
  pg_temp.val_as('c0950000-0000-4000-8000-000000000101', null, $$ select private.command_claim('c0950000-0000-4000-8000-00000000000a', null, 'x', 'h')::text $$),
  'denied:permission denied for function command_claim%', 'command_claim called by a signed-in user directly is refused (no EXECUTE, 42501)');

-- command_hash_key and the keyed request hash (000099, G-8) ---------------------------------------------------------
select is(
  (select c.relrowsecurity::text || ':' || (select count(*)::text from pg_policies p where p.schemaname = 'private' and p.tablename = 'command_hash_key')
          || ':' || (select count(*)::text || '/' || min(octet_length(k.key))::text from private.command_hash_key k)
     from pg_class c where c.oid = 'private.command_hash_key'::regclass),
  'true:0:1/32', 'command_hash_key: RLS enabled, no policy, exactly one 32-byte key');
select is(
  (select array_agg(r || ':' || has_table_privilege(r, 'private.command_hash_key', 'SELECT')::text
                         || ':' || has_function_privilege(r, 'private.command_request_hash(jsonb)', 'EXECUTE')::text order by r)
     from unnest(array['anon', 'authenticated', 'service_role']) r),
  array['anon:false:false', 'authenticated:false:false', 'service_role:false:false'],
  'command_hash_key and command_request_hash: no privilege for any API role');
select is(
  (select private.command_request_hash('{"a": 1, "b": "synthetic"}'::jsonb) = private.command_request_hash('{"b": "synthetic", "a": 1}'::jsonb)
      and private.command_request_hash('{"a": 1}'::jsonb) <> private.command_request_hash('{"a": 2}'::jsonb)
      and private.command_request_hash('{"a": 1}'::jsonb) ~ '^[0-9a-f]{64}$'),
  true, 'the request hash is a 64-hex digest: stable for one payload (key order aside) and different for another');
select is(
  (select private.command_request_hash('{"a": 1}'::jsonb) <> encode(extensions.digest('{"a": 1}', 'sha256'), 'hex')
      and private.command_request_hash('{"a": 1}'::jsonb) <> md5('{"a": 1}')),
  true, 'the request hash is keyed: it is not the plain sha256 or md5 of the payload');

select * from finish();
rollback;
