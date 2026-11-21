-- doctor_text_macros.test.sql — V2-09b 09B-04b (R-14, T-09B-07; migration 000115_doctor_text_macros).
--
-- public.doctor_text_macros: a doctor's own shorthand macros. Proved here, every statement under the real principal (set local role, JWT claims, the
-- x-clinicos-tenant header):
--   catalog      RLS enabled and not forced to anyone else; authenticated holds S/I/U/D, anon and PUBLIC nothing; four policies, one per command; the
--                composite FK to memberships; the two trigger functions are INVOKER with a pinned search_path
--   own rows     a doctor reads, adds, edits and deletes their own macros; a caller-supplied doctor_id is replaced by the caller (the trigger); an
--                update bumps updated_at and cannot change tenant_id, doctor_id or id
--   isolation    another doctor of the clinic, the owner, an admin, a nurse and a receptionist see none of them and change none; another clinic sees none;
--                nurse, receptionist and admin cannot insert; anon has no privilege
--   shape        the shortcut must be a dot and 1 to 24 of a-z 0-9 _ -; the expansion 1 to 2,000 characters and not blank; unique per doctor and clinic
--                (another doctor may use the same shortcut); the doctor must be a member of the clinic
--   cap          200 macros per doctor and clinic; the 201st is refused (23514, MACRO_LIMIT) and another doctor is not affected
-- The file rolls back. Synthetic data only.
begin;
select plan(46);

-- Fixtures ----------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1150000-0000-4000-8000-000000000101', 'c115-owner-a@example.test'),
  ('c1150000-0000-4000-8000-000000000102', 'c115-doctor-a1@example.test'),
  ('c1150000-0000-4000-8000-000000000103', 'c115-doctor-a2@example.test'),
  ('c1150000-0000-4000-8000-000000000104', 'c115-admin-a@example.test'),
  ('c1150000-0000-4000-8000-000000000105', 'c115-nurse-a@example.test'),
  ('c1150000-0000-4000-8000-000000000106', 'c115-receptionist-a@example.test'),
  ('c1150000-0000-4000-8000-000000000107', 'c115-nonmember@example.test'),
  ('c1150000-0000-4000-8000-000000000201', 'c115-owner-b@example.test');
insert into public.tenants (id, name) values
  ('c1150000-0000-4000-8000-00000000000a', 'Synthetic 09B-04b Clinic A'),
  ('c1150000-0000-4000-8000-00000000000b', 'Synthetic 09B-04b Clinic B');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1150000-0000-4000-8000-00000000000a', 'c1150000-0000-4000-8000-00000000000b');
insert into public.memberships (user_id, tenant_id, role) values
  ('c1150000-0000-4000-8000-000000000101', 'c1150000-0000-4000-8000-00000000000a', 'owner'),
  ('c1150000-0000-4000-8000-000000000102', 'c1150000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1150000-0000-4000-8000-000000000103', 'c1150000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1150000-0000-4000-8000-000000000104', 'c1150000-0000-4000-8000-00000000000a', 'admin'),
  ('c1150000-0000-4000-8000-000000000105', 'c1150000-0000-4000-8000-00000000000a', 'nurse'),
  ('c1150000-0000-4000-8000-000000000106', 'c1150000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c1150000-0000-4000-8000-000000000201', 'c1150000-0000-4000-8000-00000000000b', 'owner');

-- Doctor A1 owns two macros; doctor A2 owns one with the same shortcut as A1's first; owner B has one.
insert into public.doctor_text_macros (id, tenant_id, doctor_id, shortcut, expansion, created_at, updated_at) values
  ('c1150000-0000-4000-8000-000000003001', 'c1150000-0000-4000-8000-00000000000a', 'c1150000-0000-4000-8000-000000000102', '.ur', 'Plenty of oral fluids, rest and review if the fever persists beyond three days', now() - interval '1 day', now() - interval '1 day'),
  ('c1150000-0000-4000-8000-000000003002', 'c1150000-0000-4000-8000-00000000000a', 'c1150000-0000-4000-8000-000000000102', '.fv', 'Fever workup advised', now() - interval '1 day', now() - interval '1 day'),
  ('c1150000-0000-4000-8000-000000003003', 'c1150000-0000-4000-8000-00000000000a', 'c1150000-0000-4000-8000-000000000103', '.ur', 'Doctor two text', now(), now()),
  ('c1150000-0000-4000-8000-000000003004', 'c1150000-0000-4000-8000-00000000000b', 'c1150000-0000-4000-8000-000000000201', '.ur', 'Clinic B text', now(), now());

-- Runs one statement under a real principal and returns 'ok:<result>' or 'error:<sqlstate>:<message>'.
create function pg_temp.act(p_db_role text, p_user uuid, p_header uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_res text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_user is null then json_build_object('role', p_db_role)::text
                                                  else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
    perform set_config('request.headers', json_build_object('x-clinicos-tenant', p_header)::text, true);
    execute 'set local role ' || quote_ident(p_db_role);
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
-- As the user ending in `p_user` in clinic A (or the given clinic header).
create function pg_temp.as_a(p_user text, p_sql text) returns text language sql as $f$
  select pg_temp.act('authenticated', ('c1150000-0000-4000-8000-000000000' || p_user)::uuid, 'c1150000-0000-4000-8000-00000000000a', p_sql)
$f$;
create function pg_temp.sees(p_user text) returns text language sql as $f$
  select pg_temp.as_a(p_user, 'select coalesce(string_agg(shortcut, '','' order by shortcut), '''') from public.doctor_text_macros')
$f$;

-- 1. Catalog --------------------------------------------------------------------------------------------------------------
select is((select relrowsecurity from pg_class where oid = 'public.doctor_text_macros'::regclass), true, 'row level security is enabled');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'doctor_text_macros'), 4, 'four policies: one per command');
select is((select string_agg(distinct cmd, ',' order by cmd) from pg_policies where schemaname = 'public' and tablename = 'doctor_text_macros'),
  'DELETE,INSERT,SELECT,UPDATE', 'the commands are SELECT, INSERT, UPDATE and DELETE');
select is((select string_agg(p, ',' order by p) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
            where has_table_privilege('authenticated', 'public.doctor_text_macros', p)), 'DELETE,INSERT,SELECT,UPDATE', 'authenticated holds S/I/U/D');
select is((select count(*)::int from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p where has_table_privilege('anon', 'public.doctor_text_macros', p)),
  0, 'anon holds no privilege');
select is((select count(*)::int from pg_trigger t where t.tgrelid = 'public.doctor_text_macros'::regclass and not t.tgisinternal
             and t.tgname in ('doctor_text_macros_before_insert', 'doctor_text_macros_before_update')), 2, 'the two triggers exist');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' and p.proname in ('doctor_text_macros_before_insert', 'doctor_text_macros_before_update')
              and not p.prosecdef and p.proconfig::text like '%search_path%'), 2, 'both trigger functions are invoker with a pinned search_path');
select is((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'doctor_text_macros_tenant_doctor_fkey'),
  'FOREIGN KEY (doctor_id, tenant_id) REFERENCES memberships(user_id, tenant_id) ON DELETE RESTRICT', 'the doctor must be a member of the clinic (composite FK)');

-- 2. The doctor's own rows --------------------------------------------------------------------------------------------------
select is(pg_temp.sees('102'), 'ok:.fv,.ur', 'doctor A1 sees their two macros and nothing else');
select is(pg_temp.as_a('102', $q$with x as (insert into public.doctor_text_macros (tenant_id, doctor_id, shortcut, expansion)
  values ('c1150000-0000-4000-8000-00000000000a', 'c1150000-0000-4000-8000-000000000102', '.new1', 'New macro') returning 1) select count(*)::text from x$q$),
  'ok:1', 'a doctor adds a macro');
select is(pg_temp.as_a('102', $q$with x as (insert into public.doctor_text_macros (tenant_id, doctor_id, shortcut, expansion)
  values ('c1150000-0000-4000-8000-00000000000a', 'c1150000-0000-4000-8000-000000000103', '.forged', 'Forged owner') returning doctor_id) select doctor_id::text from x$q$),
  'ok:c1150000-0000-4000-8000-000000000102', 'a caller-supplied doctor_id is replaced by the caller (the BEFORE INSERT trigger)');
select is((select doctor_id::text from public.doctor_text_macros where shortcut = '.forged' and tenant_id = 'c1150000-0000-4000-8000-00000000000a'),
  'c1150000-0000-4000-8000-000000000102', 'the stored row belongs to the caller, not to the doctor named in the insert');
select is((select count(*)::int from public.doctor_text_macros where doctor_id = 'c1150000-0000-4000-8000-000000000103'), 1, 'doctor A2 gained no macro from the forged insert');
select is(pg_temp.as_a('102', $q$with x as (update public.doctor_text_macros set expansion = 'Edited text' where id = 'c1150000-0000-4000-8000-000000003002' returning 1)
  select count(*)::text from x$q$), 'ok:1', 'a doctor edits their own macro');
select is((select expansion from public.doctor_text_macros where id = 'c1150000-0000-4000-8000-000000003002'), 'Edited text', 'the edit is stored');
select ok((select updated_at > created_at from public.doctor_text_macros where id = 'c1150000-0000-4000-8000-000000003002'), 'updated_at moves on an edit');
select alike(pg_temp.as_a('102', $q$update public.doctor_text_macros set doctor_id = 'c1150000-0000-4000-8000-000000000103' where id = 'c1150000-0000-4000-8000-000000003002'$q$),
  'error:23514:MACRO_IMMUTABLE%', 'a macro cannot be handed to another doctor');
select alike(pg_temp.as_a('102', $q$update public.doctor_text_macros set tenant_id = 'c1150000-0000-4000-8000-00000000000b' where id = 'c1150000-0000-4000-8000-000000003002'$q$),
  'error:23514:MACRO_IMMUTABLE%', 'a macro cannot be moved to another clinic');
select is(pg_temp.as_a('102', $q$with x as (delete from public.doctor_text_macros where shortcut = '.new1' returning 1) select count(*)::text from x$q$),
  'ok:1', 'a doctor deletes their own macro');

-- 3. Isolation ---------------------------------------------------------------------------------------------------------------
select is(pg_temp.sees('103'), 'ok:.ur', 'doctor A2 sees only their own macro');
select is(pg_temp.sees('101'), 'ok:', 'the owner does not see a doctor''s macros');
select is(pg_temp.sees('104'), 'ok:', 'an admin sees none');
select is(pg_temp.sees('105'), 'ok:', 'a nurse sees none');
select is(pg_temp.sees('106'), 'ok:', 'a receptionist sees none');
select is(pg_temp.act('authenticated', 'c1150000-0000-4000-8000-000000000201', 'c1150000-0000-4000-8000-00000000000b',
  'select coalesce(string_agg(expansion, '','' order by expansion), '''') from public.doctor_text_macros'), 'ok:Clinic B text', 'another clinic''s owner sees only their own');
select alike(pg_temp.act('authenticated', 'c1150000-0000-4000-8000-000000000102', 'c1150000-0000-4000-8000-00000000000b', $q$with x as (insert into public.doctor_text_macros
  (tenant_id, doctor_id, shortcut, expansion) values ('c1150000-0000-4000-8000-00000000000b', 'c1150000-0000-4000-8000-000000000102', '.xb', 'Into another clinic') returning 1)
  select count(*)::text from x$q$), 'error:42501:%', 'a doctor cannot add a macro to a clinic they are not a member of');
select is(pg_temp.as_a('103', $q$with x as (update public.doctor_text_macros set expansion = 'Hijacked' where id = 'c1150000-0000-4000-8000-000000003001' returning 1)
  select count(*)::text from x$q$), 'ok:0', 'another doctor cannot edit a macro');
select is(pg_temp.as_a('103', $q$with x as (delete from public.doctor_text_macros where id = 'c1150000-0000-4000-8000-000000003001' returning 1)
  select count(*)::text from x$q$), 'ok:0', 'another doctor cannot delete a macro');
select is(pg_temp.as_a('101', $q$with x as (delete from public.doctor_text_macros where id = 'c1150000-0000-4000-8000-000000003001' returning 1)
  select count(*)::text from x$q$), 'ok:0', 'the owner cannot delete a doctor''s macro');
select is((select expansion from public.doctor_text_macros where id = 'c1150000-0000-4000-8000-000000003001'),
  'Plenty of oral fluids, rest and review if the fever persists beyond three days', 'doctor A1''s first macro is untouched by every foreign attempt');
select alike(pg_temp.as_a('105', $q$insert into public.doctor_text_macros (tenant_id, doctor_id, shortcut, expansion)
  values ('c1150000-0000-4000-8000-00000000000a', 'c1150000-0000-4000-8000-000000000105', '.nn', 'Nurse text')$q$), 'error:42501:%', 'a nurse cannot insert');
select alike(pg_temp.as_a('106', $q$insert into public.doctor_text_macros (tenant_id, doctor_id, shortcut, expansion)
  values ('c1150000-0000-4000-8000-00000000000a', 'c1150000-0000-4000-8000-000000000106', '.rr', 'Reception text')$q$), 'error:42501:%', 'a receptionist cannot insert');
select alike(pg_temp.as_a('104', $q$insert into public.doctor_text_macros (tenant_id, doctor_id, shortcut, expansion)
  values ('c1150000-0000-4000-8000-00000000000a', 'c1150000-0000-4000-8000-000000000104', '.aa', 'Admin text')$q$), 'error:42501:%', 'an admin cannot insert');
select alike(pg_temp.act('anon', null, 'c1150000-0000-4000-8000-00000000000a', 'select count(*)::text from public.doctor_text_macros'),
  'error:42501:%', 'anon has no privilege');

-- 4. Shape ------------------------------------------------------------------------------------------------------------------
create function pg_temp.add(p_shortcut text, p_expansion text) returns text language sql as $f$
  select pg_temp.as_a('103', format($q$with x as (insert into public.doctor_text_macros (tenant_id, doctor_id, shortcut, expansion)
    values ('c1150000-0000-4000-8000-00000000000a', 'c1150000-0000-4000-8000-000000000103', %L, %L) returning 1) select count(*)::text from x$q$, p_shortcut, p_expansion))
$f$;
select is((select string_agg(left(pg_temp.add(s, 'x'), 9), ',' order by s)
             from unnest(array['ur', '.', '.UR', '.a b', '.é', '.' || repeat('a', 25), '.a.b']) s),
  'error:235,error:235,error:235,error:235,error:235,error:235,error:235', 'a shortcut must be a dot and 1 to 24 of a-z, 0-9, underscore and hyphen');
select is(pg_temp.add('.' || repeat('a', 24), 'x'), 'ok:1', 'a 24-character shortcut is allowed');
select is(pg_temp.add('.a_b-9', 'x'), 'ok:1', 'digits, underscore and hyphen are allowed');
select alike(pg_temp.add('.blank', '   '), 'error:23514:%', 'a blank expansion is refused');
select alike(pg_temp.add('.long', repeat('x', 2001)), 'error:23514:%', 'an expansion over 2,000 characters is refused');
select is(pg_temp.add('.max', repeat('x', 2000)), 'ok:1', 'an expansion of exactly 2,000 characters is allowed');
select alike(pg_temp.add('.ur', 'again'), 'error:23505:%', 'the same shortcut twice for one doctor is refused');
select alike(pg_temp.act('postgres', null, 'c1150000-0000-4000-8000-00000000000a', $q$insert into public.doctor_text_macros (tenant_id, doctor_id, shortcut, expansion)
  values ('c1150000-0000-4000-8000-00000000000a', 'c1150000-0000-4000-8000-000000000107', '.nm', 'Not a member')$q$), 'error:23503:%', 'a doctor who is not a member of the clinic is refused');

-- 5. The cap: 200 per doctor and clinic ----------------------------------------------------------------------------------------
select is(pg_temp.as_a('102', $q$with x as (insert into public.doctor_text_macros (tenant_id, doctor_id, shortcut, expansion)
  select 'c1150000-0000-4000-8000-00000000000a', 'c1150000-0000-4000-8000-000000000102', '.m' || g, 'Macro ' || g from generate_series(1, 197) g returning 1)
  select count(*)::text from x$q$), 'ok:197', 'a doctor fills the allowance (3 existing + 197)');
select is((select count(*)::int from public.doctor_text_macros where doctor_id = 'c1150000-0000-4000-8000-000000000102'), 200, 'the doctor holds exactly 200 macros');
select alike(pg_temp.as_a('102', $q$with x as (insert into public.doctor_text_macros (tenant_id, doctor_id, shortcut, expansion)
  values ('c1150000-0000-4000-8000-00000000000a', 'c1150000-0000-4000-8000-000000000102', '.m201', 'One too many') returning 1) select count(*)::text from x$q$), 'error:23514:MACRO_LIMIT%', 'the 201st macro is refused');
select is(pg_temp.add('.still', 'another doctor is not affected'), 'ok:1', 'another doctor can still add one');

select * from finish();
rollback;
