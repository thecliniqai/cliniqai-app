-- session_bootstrap.test.sql — V2-09e 09E-13 (R-13; migration 000131; threats T-09E-10: another clinic's data in the bootstrap, a field beyond the
-- allow-list (a fee, an invoice, the access level, a permission) held in the browser for the session, a version that is not the data's).
-- public.session_bootstrap(tenant): what the shell holds in memory for the session, in one STABLE INVOKER read.
--   1. grants and shape: INVOKER, STABLE, search_path pinned, EXECUTE for authenticated only;
--   2. refusals (NULL): another clinic, a forged or unknown tenant, no membership, a removed member, no session, a NULL tenant; every member role answers,
--      and the member of a clinic that is not full too (the shell's redirect decides that, from the database, on each request);
--   3. the exact allow-list: every key path of the answer (at every level, arrays included) is exactly the listed set; no fee, price, invoice, payment,
--      subscription, access, entitlement or permission key at any level;
--   4. versions.settings equals clinic_versions, also after a settings change in the same transaction;
--   5. the values: profile, clinic (zone resolved, Asia/Kolkata when unset or unknown), role, the doctor directory (doctors and the practising owner; not an
--      admin, a receptionist or a removed doctor; a missing name), the caller's own clinics only, the Rx print display fields.
-- Every call runs under the real principal. The file rolls back. Synthetic data only.
begin;
select plan(30);

insert into auth.users (id, email) values
  ('c1310000-0000-4000-8000-000000000101', 'c131-owner-a@example.test'),
  ('c1310000-0000-4000-8000-000000000102', 'c131-doctor1-a@example.test'),
  ('c1310000-0000-4000-8000-000000000103', 'c131-doctor2-a@example.test'),
  ('c1310000-0000-4000-8000-000000000104', 'c131-receptionist-a@example.test'),
  ('c1310000-0000-4000-8000-000000000105', 'c131-nurse-a@example.test'),
  ('c1310000-0000-4000-8000-000000000106', 'c131-admin-a@example.test'),
  ('c1310000-0000-4000-8000-000000000107', 'c131-removed-a@example.test'),
  ('c1310000-0000-4000-8000-000000000108', 'c131-dual-a-b@example.test'),
  ('c1310000-0000-4000-8000-000000000201', 'c131-owner-b@example.test'),
  ('c1310000-0000-4000-8000-000000000301', 'c131-outsider@example.test'),
  ('c1310000-0000-4000-8000-000000000401', 'c131-owner-c@example.test');
insert into public.tenants (id, name, timezone, owner_is_practicing_doctor, rx_paper_size, rx_letterhead_mode, letterhead_top_margin, letterhead_bottom_margin) values
  ('c1310000-0000-4000-8000-00000000000a', 'Synthetic 000131 Clinic A', 'asia/kolkata', true, 'A5', 'preprinted_letterhead', 120, 70),
  ('c1310000-0000-4000-8000-00000000000b', 'Synthetic 000131 Clinic B', 'America/New_York', true, 'A4', 'blank_paper', null, null),
  ('c1310000-0000-4000-8000-00000000000c', 'Synthetic 000131 Clinic C', 'Europe/London', false, 'A4', 'blank_paper', null, null);
-- A's subscription is full (trialing); B and C stay incomplete (not full).
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id = 'c1310000-0000-4000-8000-00000000000a' and s.status = 'incomplete';
-- Created in this order (the directory's order is membership creation): the owner, doctor 1, doctor 2 (no name), then the others.
insert into public.memberships (user_id, tenant_id, role, full_name, default_specialty, created_at) values
  ('c1310000-0000-4000-8000-000000000101', 'c1310000-0000-4000-8000-00000000000a', 'owner', 'Synthetic Owner A', null, now() - interval '9 minutes'),
  ('c1310000-0000-4000-8000-000000000102', 'c1310000-0000-4000-8000-00000000000a', 'doctor', 'Synthetic Doctor One', 'general_medicine', now() - interval '8 minutes'),
  ('c1310000-0000-4000-8000-000000000103', 'c1310000-0000-4000-8000-00000000000a', 'doctor', '  ', null, now() - interval '7 minutes'),
  ('c1310000-0000-4000-8000-000000000104', 'c1310000-0000-4000-8000-00000000000a', 'receptionist', 'Synthetic Receptionist A', null, now() - interval '6 minutes'),
  ('c1310000-0000-4000-8000-000000000105', 'c1310000-0000-4000-8000-00000000000a', 'nurse', null, null, now() - interval '5 minutes'),
  ('c1310000-0000-4000-8000-000000000106', 'c1310000-0000-4000-8000-00000000000a', 'admin', 'Synthetic Admin A', null, now() - interval '4 minutes'),
  ('c1310000-0000-4000-8000-000000000108', 'c1310000-0000-4000-8000-00000000000a', 'receptionist', 'Synthetic Dual Member', null, now() - interval '3 minutes'),
  ('c1310000-0000-4000-8000-000000000201', 'c1310000-0000-4000-8000-00000000000b', 'owner', 'Synthetic Owner B', null, now() - interval '9 minutes'),
  ('c1310000-0000-4000-8000-000000000108', 'c1310000-0000-4000-8000-00000000000b', 'nurse', 'Synthetic Dual Member', null, now() - interval '2 minutes'),
  ('c1310000-0000-4000-8000-000000000401', 'c1310000-0000-4000-8000-00000000000c', 'owner', 'Synthetic Owner C', null, now() - interval '9 minutes');
insert into public.memberships (user_id, tenant_id, role, full_name, status, removed_at) values
  ('c1310000-0000-4000-8000-000000000107', 'c1310000-0000-4000-8000-00000000000a', 'doctor', 'Synthetic Removed Doctor', 'removed', now());

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
create function pg_temp.uid(p_user text) returns uuid language sql as $f$ select ('c1310000-0000-4000-8000-000000000' || p_user)::uuid $f$;
create function pg_temp.tid(p_tenant text) returns uuid language sql as $f$ select ('c1310000-0000-4000-8000-00000000000' || p_tenant)::uuid $f$;
-- The bootstrap as a user: the jsonb text, or 'NULL'.
create function pg_temp.boot(p_user text, p_tenant text default 'a') returns text language sql as $f$
  select pg_temp.as_user(pg_temp.uid(p_user), format($q$ select coalesce(public.session_bootstrap(%L)::text, 'NULL') $q$, pg_temp.tid(p_tenant)))
$f$;
-- Every key path of a jsonb value: `a`, `a.b`, `list[].c` (array elements share one path).
create function pg_temp.paths(j jsonb, prefix text default '') returns setof text language plpgsql as $f$
declare k text; v jsonb; e jsonb;
begin
  if jsonb_typeof(j) = 'object' then
    for k, v in select * from jsonb_each(j) loop
      return next prefix || k;
      return query select * from pg_temp.paths(v, prefix || k || '.');
    end loop;
  elsif jsonb_typeof(j) = 'array' then
    for e in select * from jsonb_array_elements(j) loop
      return query select * from pg_temp.paths(e, rtrim(prefix, '.') || '[].');
    end loop;
  end if;
end;
$f$;
create function pg_temp.path_set(p_json text) returns text language sql as $f$
  select string_agg(distinct p, ',' order by p) from pg_temp.paths(p_json::jsonb) p
$f$;

-- 1. Grants and shape -------------------------------------------------------------------------------------------------------
select is((select p.prosecdef::text || ':' || p.provolatile::text || ':' || array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'public.session_bootstrap(uuid)'::regprocedure),
  'false:s:search_path=""', 'session_bootstrap is a STABLE INVOKER function with search_path pinned');
select is((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text)
             from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid = 'public.session_bootstrap(uuid)'::regprocedure and a.grantee <> p.proowner),
  'authenticated:EXECUTE', 'EXECUTE is granted to authenticated only (not PUBLIC, anon or service_role)');
select throws_ok($$ set local role anon; select public.session_bootstrap('c1310000-0000-4000-8000-00000000000a') $$, '42501', null, 'anon cannot execute it');
select throws_ok($$ set local role service_role; select public.session_bootstrap('c1310000-0000-4000-8000-00000000000a') $$, '42501', null, 'service_role cannot execute it (no service-role path)');

-- 2. Refusals: all NULL; every member answers ---------------------------------------------------------------------------------
select is(pg_temp.boot('201', 'a'), 'NULL', 'the owner of B asking for A gets NULL (another clinic): nothing of A comes back');
select is(pg_temp.boot('101', 'b'), 'NULL', 'the owner of A asking for B gets NULL');
select is(pg_temp.as_user(pg_temp.uid('101'), $q$ select coalesce(public.session_bootstrap('c1310000-0000-4000-8000-0000000000ff')::text, 'NULL') $q$), 'NULL', 'an unknown (forged) tenant gets NULL');
select is(pg_temp.boot('301', 'a'), 'NULL', 'a user with no membership gets NULL');
select is(pg_temp.boot('107', 'a'), 'NULL', 'a removed member gets NULL');
select is((select coalesce(public.session_bootstrap('c1310000-0000-4000-8000-00000000000a')::text, 'NULL')), 'NULL', 'no session gets NULL');
select is(pg_temp.as_user(pg_temp.uid('101'), $q$ select coalesce(public.session_bootstrap(null)::text, 'NULL') $q$), 'NULL', 'a NULL tenant gets NULL');
select is((select string_agg(r, ',' order by r) from unnest(array['101', '102', '103', '104', '105', '106', '108']) r where pg_temp.boot(r, 'a') <> 'NULL'),
  '101,102,103,104,105,106,108', 'every active member of A answers, whatever the role (owner, doctors, receptionist, nurse, admin)');
select isnt(pg_temp.boot('401', 'c'), 'NULL', 'the owner of a clinic that is not full answers (display data; the shell''s redirect is decided by the database per request)');

-- 3. The exact allow-list -------------------------------------------------------------------------------------------------------
select is(pg_temp.path_set(pg_temp.boot('104', 'a')),
  'clinic,clinic.id,clinic.name,clinic.zone,clinics,clinics[].id,clinics[].name,doctors,doctors[].full_name,doctors[].id,doctors[].specialty,profile,profile.full_name,profile.id,role,rx_print,rx_print.bottom_margin,rx_print.letterhead_mode,rx_print.paper_size,rx_print.top_margin,versions,versions.settings',
  'every key path of the answer is exactly the allow-list (a key outside it at any level fails)');
select is(pg_temp.path_set(pg_temp.boot('101', 'a')), pg_temp.path_set(pg_temp.boot('104', 'a')), 'the owner''s answer has the same key paths as the receptionist''s (no role sees more)');
select is((select count(*)::integer from pg_temp.paths(pg_temp.boot('101', 'a')::jsonb) p
            where p ~* '(fee|price|invoice|payment|bill|subscription|access|entitle|permission|plan|amount)'), 0,
  'no fee, price, invoice, payment, subscription, access, entitlement or permission key at any level');
select is(jsonb_typeof(pg_temp.boot('104', 'a')::jsonb -> 'role'), 'string', 'role is one word (display only)');

-- 4. Versions -------------------------------------------------------------------------------------------------------------------
select is((pg_temp.boot('104', 'a')::jsonb #>> '{versions,settings}')::bigint,
  (select cv.version from public.clinic_versions cv where cv.tenant_id = pg_temp.tid('a') and cv.domain = 'settings'),
  'versions.settings equals clinic_versions');
update public.tenants set name = 'Synthetic 000131 Clinic A Renamed' where id = pg_temp.tid('a');
select is((pg_temp.boot('104', 'a')::jsonb #>> '{versions,settings}')::bigint,
  (select cv.version from public.clinic_versions cv where cv.tenant_id = pg_temp.tid('a') and cv.domain = 'settings'),
  'after a rename the version still equals clinic_versions, from the same statement as the new name');
select is(pg_temp.boot('104', 'a')::jsonb #>> '{clinic,name}', 'Synthetic 000131 Clinic A Renamed', 'the new name is answered with it');

-- 5. Values ---------------------------------------------------------------------------------------------------------------------
select is(pg_temp.boot('104', 'a')::jsonb -> 'profile',
  jsonb_build_object('id', pg_temp.uid('104'), 'full_name', 'Synthetic Receptionist A'), 'profile: the caller and the display name of their membership');
select is(pg_temp.boot('105', 'a')::jsonb #>> '{profile,full_name}', null, 'profile: a member with no display name answers null');
select is(pg_temp.boot('104', 'a')::jsonb -> 'clinic',
  jsonb_build_object('id', pg_temp.tid('a'), 'name', 'Synthetic 000131 Clinic A Renamed', 'zone', 'Asia/Kolkata'), 'clinic: id, name and the zone resolved case-insensitively');
select is(pg_temp.boot('401', 'c')::jsonb #>> '{clinic,zone}', 'Europe/London', 'clinic: each clinic answers its own zone (tenants.timezone is NOT NULL and IANA-checked; Asia/Kolkata is only the function''s fallback)');
select is(pg_temp.boot('201', 'b')::jsonb #>> '{clinic,zone}', 'America/New_York', 'clinic: the zone stays per clinic');
select is((select string_agg(r || ':' || (pg_temp.boot(r, 'a')::jsonb ->> 'role'), ',' order by r) from unnest(array['101', '102', '104', '105', '106']) r),
  '101:owner,102:doctor,104:receptionist,105:nurse,106:admin', 'role: the caller''s role in the clinic');
select is(pg_temp.boot('104', 'a')::jsonb -> 'doctors',
  jsonb_build_array(
    jsonb_build_object('id', pg_temp.uid('101'), 'full_name', 'Synthetic Owner A', 'specialty', null),
    jsonb_build_object('id', pg_temp.uid('102'), 'full_name', 'Synthetic Doctor One', 'specialty', 'general_medicine'),
    jsonb_build_object('id', pg_temp.uid('103'), 'full_name', 'Doctor', 'specialty', null)),
  'doctors: the practising owner and the active doctors by membership creation ("Doctor" for a missing name); no admin, receptionist, nurse or removed doctor');
select is(pg_temp.boot('401', 'c')::jsonb -> 'doctors', '[]'::jsonb, 'doctors: an owner who does not practise is not listed');
select is(pg_temp.boot('108', 'a')::jsonb -> 'clinics',
  (select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.id) from public.tenants t where t.id in (pg_temp.tid('a'), pg_temp.tid('b'))),
  'clinics: the dual member''s own two clinics (the switcher), and no other');
select is(pg_temp.boot('104', 'a')::jsonb -> 'rx_print',
  jsonb_build_object('paper_size', 'A5', 'letterhead_mode', 'preprinted_letterhead', 'top_margin', 120, 'bottom_margin', 70),
  'rx_print: the display fields of the print settings');

select * from finish();
rollback;
