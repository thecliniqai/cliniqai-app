-- queue_tokens.test.sql — V2-05 plan 05-08 (P1-40, DB-09; R-18, R-19, R-42; threat T-05-21; roadmap V2-05
-- acceptance 7 "50 parallel check-ins produce 50 distinct tokens with the IST date" — the date half; the parallel half
-- is tests/integration/queue-token-concurrency.spec.ts).
--   1. `tenant_local_date` at the IST day boundary (18:30 UTC) and for a clinic in another zone;
--   2. catalogue: `next_queue_token` is SECURITY DEFINER with search_path '' and a lock_timeout, executable by
--      `authenticated` only; `tenant_local_date` is STABLE and invoker; the counter table has RLS, no policy and no
--      privilege for the API roles;
--   3. `next_queue_token` as a receptionist acting in the visit's clinic: tokens 1, 2, … dated
--      `tenant_local_date(clinic, now())`; a token inserted without the counter is never issued again;
--   4. refusals (42501): another clinic's visit, a dual member acting in the other clinic, a visit that does not
--      exist, anon; the counter cannot be read or written by a member.
-- Synthetic data only; the file rolls back.
begin;
select plan(26);

insert into auth.users (id, email) values
  ('c0820000-0000-4000-8000-000000000101', 'c082-owner-a@example.test'),
  ('c0820000-0000-4000-8000-000000000102', 'c082-doctor-a@example.test'),
  ('c0820000-0000-4000-8000-000000000103', 'c082-receptionist-a@example.test'),
  ('c0820000-0000-4000-8000-000000000104', 'c082-nurse-a@example.test'),
  ('c0820000-0000-4000-8000-000000000201', 'c082-owner-b@example.test'),
  ('c0820000-0000-4000-8000-000000000301', 'c082-dual@example.test');
insert into public.tenants (id, name, timezone) values
  ('c0820000-0000-4000-8000-00000000000a', 'Synthetic 05-08 Token Clinic A', 'Asia/Kolkata'),
  ('c0820000-0000-4000-8000-00000000000b', 'Synthetic 05-08 Token Clinic B', 'Asia/Kolkata'),
  ('c0820000-0000-4000-8000-00000000000c', 'Synthetic 05-08 Eastern Clinic', 'America/New_York');
insert into public.memberships (user_id, tenant_id, role) values
  ('c0820000-0000-4000-8000-000000000101', 'c0820000-0000-4000-8000-00000000000a', 'owner'),
  ('c0820000-0000-4000-8000-000000000102', 'c0820000-0000-4000-8000-00000000000a', 'doctor'),
  ('c0820000-0000-4000-8000-000000000103', 'c0820000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c0820000-0000-4000-8000-000000000104', 'c0820000-0000-4000-8000-00000000000a', 'nurse'),
  ('c0820000-0000-4000-8000-000000000201', 'c0820000-0000-4000-8000-00000000000b', 'owner'),
  ('c0820000-0000-4000-8000-000000000301', 'c0820000-0000-4000-8000-00000000000a', 'doctor'),
  ('c0820000-0000-4000-8000-000000000301', 'c0820000-0000-4000-8000-00000000000b', 'receptionist');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c0820000-0000-4000-8000-000000001001', 'c0820000-0000-4000-8000-00000000000a', 'Synthetic Token Patient A', '+919000000821', 'c0820000-0000-4000-8000-000000000101'),
  ('c0820000-0000-4000-8000-000000002001', 'c0820000-0000-4000-8000-00000000000b', 'Synthetic Token Patient B', '+919000000822', 'c0820000-0000-4000-8000-000000000201');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by) values
  ('c0820000-0000-4000-8000-000000001101', 'c0820000-0000-4000-8000-00000000000a', 'c0820000-0000-4000-8000-000000001001', 'c0820000-0000-4000-8000-000000000102', 'walk_in', 'c0820000-0000-4000-8000-000000000101'),
  ('c0820000-0000-4000-8000-000000001102', 'c0820000-0000-4000-8000-00000000000a', 'c0820000-0000-4000-8000-000000001001', 'c0820000-0000-4000-8000-000000000102', 'walk_in', 'c0820000-0000-4000-8000-000000000101'),
  ('c0820000-0000-4000-8000-000000001103', 'c0820000-0000-4000-8000-00000000000a', 'c0820000-0000-4000-8000-000000001001', 'c0820000-0000-4000-8000-000000000102', 'walk_in', 'c0820000-0000-4000-8000-000000000101'),
  ('c0820000-0000-4000-8000-000000002101', 'c0820000-0000-4000-8000-00000000000b', 'c0820000-0000-4000-8000-000000002001', 'c0820000-0000-4000-8000-000000000201', 'walk_in', 'c0820000-0000-4000-8000-000000000201');

-- The single value p_sql returns as the user (anon when null) with the x-clinicos-tenant header p_header; a 42501 is
-- 'denied:<message>', any other error 'error:<sqlstate>'. Not rolled back (a token issued here stays issued, as in
-- a request that commits), so later assertions see the counter advance.
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

-- 1. Clinic-local date ------------------------------------------------------------------------------------------------
select is(public.tenant_local_date('c0820000-0000-4000-8000-00000000000a', '2026-11-13 19:00:00+00'), '2026-11-14'::date,
  'IST clinic: 19:00 UTC on 13 Nov is 14 Nov (00:30 IST)');
select is(public.tenant_local_date('c0820000-0000-4000-8000-00000000000a', '2026-11-13 18:29:59+00'), '2026-11-13'::date,
  'IST clinic: 18:29:59 UTC is still 13 Nov (23:59:59 IST)');
select is(public.tenant_local_date('c0820000-0000-4000-8000-00000000000a', '2026-11-13 18:30:00+00'), '2026-11-14'::date,
  'IST clinic: 18:30 UTC is 14 Nov (00:00 IST)');
select is(public.tenant_local_date('c0820000-0000-4000-8000-00000000000c', '2026-11-13 19:00:00+00'), '2026-11-13'::date,
  'America/New_York clinic: the same instant is still 13 Nov');
select is(public.tenant_local_date('c0820000-0000-4000-8000-00000000000c', '2026-11-14 05:00:00+00'), '2026-11-14'::date,
  'America/New_York clinic: its own midnight (05:00 UTC) starts 14 Nov');
set local timezone = 'UTC';
select isnt(public.tenant_local_date('c0820000-0000-4000-8000-00000000000a', '2026-11-13 19:00:00+00'),
  ('2026-11-13 19:00:00+00'::timestamptz)::date, 'the clinic date is not the server-zone date (what CURRENT_DATE gave)');
reset timezone;

-- 2. Catalogue --------------------------------------------------------------------------------------------------------
select is(
  (select prosecdef::text || ':' || provolatile::text || ':' || array_to_string(proconfig, ',') from pg_proc
    where oid = 'public.next_queue_token(uuid)'::regprocedure),
  'true:v:search_path="",lock_timeout=5s', 'next_queue_token: SECURITY DEFINER, VOLATILE, search_path '''', lock_timeout 5s');
select is(
  array[has_function_privilege('anon', 'public.next_queue_token(uuid)', 'EXECUTE'),
        has_function_privilege('authenticated', 'public.next_queue_token(uuid)', 'EXECUTE'),
        has_function_privilege('service_role', 'public.next_queue_token(uuid)', 'EXECUTE')],
  array[false, true, false], 'next_queue_token: EXECUTE for authenticated only');
select is(
  (select prosecdef::text || ':' || provolatile::text || ':' || array_to_string(proconfig, ',') from pg_proc
    where oid = 'public.tenant_local_date(uuid, timestamptz)'::regprocedure),
  'false:s:search_path=""', 'tenant_local_date: SECURITY INVOKER, STABLE, search_path ''''');
select is(
  array[has_function_privilege('anon', 'public.tenant_local_date(uuid, timestamptz)', 'EXECUTE'),
        has_function_privilege('authenticated', 'public.tenant_local_date(uuid, timestamptz)', 'EXECUTE'),
        has_function_privilege('service_role', 'public.tenant_local_date(uuid, timestamptz)', 'EXECUTE')],
  array[false, true, true], 'tenant_local_date: EXECUTE for authenticated and service_role, not anon');
select is(
  (select relrowsecurity from pg_class where oid = 'public.queue_token_counters'::regclass), true,
  'queue_token_counters has RLS enabled');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'queue_token_counters'), 0,
  'queue_token_counters has no policy');
select is(
  (select array_agg(has_table_privilege(r, 'public.queue_token_counters', p) order by r, p)
     from unnest(array['anon', 'authenticated']) r, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p),
  array_fill(false, array[10]), 'anon and authenticated hold no privilege on queue_token_counters');

-- 3. Issuing tokens ---------------------------------------------------------------------------------------------------
select is(pg_temp.val_as('c0820000-0000-4000-8000-000000000103', 'c0820000-0000-4000-8000-00000000000a',
  $$select row(token_number, token_date)::text from public.next_queue_token('c0820000-0000-4000-8000-000000001101')$$),
  row(1, public.tenant_local_date('c0820000-0000-4000-8000-00000000000a', now()))::text,
  'receptionist acting in A: token 1, dated the clinic-local today');
select is(pg_temp.val_as('c0820000-0000-4000-8000-000000000104', 'c0820000-0000-4000-8000-00000000000a',
  $$select token_number::text from public.next_queue_token('c0820000-0000-4000-8000-000000001102')$$),
  '2', 'nurse acting in A (appointments:edit): token 2');
select is(
  (select last_token from public.queue_token_counters
    where tenant_id = 'c0820000-0000-4000-8000-00000000000a'
      and date = public.tenant_local_date('c0820000-0000-4000-8000-00000000000a', now())),
  2, 'the counter row holds the last issued token');
-- A token written without the counter (a fixture or a system path) is folded in.
insert into public.queue_tokens (tenant_id, visit_id, date, token_number) values
  ('c0820000-0000-4000-8000-00000000000a', 'c0820000-0000-4000-8000-000000001103',
   public.tenant_local_date('c0820000-0000-4000-8000-00000000000a', now()), 7);
select is(pg_temp.val_as('c0820000-0000-4000-8000-000000000103', 'c0820000-0000-4000-8000-00000000000a',
  $$select token_number::text from public.next_queue_token('c0820000-0000-4000-8000-000000001101')$$),
  '8', 'a token inserted without the counter (7) is never issued again: next is 8');
select is(pg_temp.val_as('c0820000-0000-4000-8000-000000000301', 'c0820000-0000-4000-8000-00000000000b',
  $$select token_number::text from public.next_queue_token('c0820000-0000-4000-8000-000000002101')$$),
  '1', 'dual member acting in B: clinic B has its own counter (token 1)');
-- Another day's counter does not affect today's.
insert into public.queue_token_counters (tenant_id, date, last_token) values
  ('c0820000-0000-4000-8000-00000000000b', public.tenant_local_date('c0820000-0000-4000-8000-00000000000b', now()) - 1, 40);
select is(pg_temp.val_as('c0820000-0000-4000-8000-000000000201', 'c0820000-0000-4000-8000-00000000000b',
  $$select token_number::text from public.next_queue_token('c0820000-0000-4000-8000-000000002101')$$),
  '2', 'yesterday''s counter (40) does not affect today''s numbering');

-- 4. Refusals ---------------------------------------------------------------------------------------------------------
select is(pg_temp.val_as('c0820000-0000-4000-8000-000000000103', 'c0820000-0000-4000-8000-00000000000a',
  $$select token_number::text from public.next_queue_token('c0820000-0000-4000-8000-000000002101')$$),
  'denied:forbidden', 'receptionist of A on clinic B''s visit: 42501 (no appointments:edit in B)');
select is(pg_temp.val_as('c0820000-0000-4000-8000-000000000301', 'c0820000-0000-4000-8000-00000000000a',
  $$select token_number::text from public.next_queue_token('c0820000-0000-4000-8000-000000002101')$$),
  'denied:forbidden', 'dual member acting in A on clinic B''s visit: 42501 (R-42)');
select is(pg_temp.val_as('c0820000-0000-4000-8000-000000000103', 'c0820000-0000-4000-8000-00000000000a',
  $$select token_number::text from public.next_queue_token('c0820000-0000-4000-8000-00000000ffff')$$),
  'denied:forbidden', 'a visit that does not exist: 42501 (no existence oracle)');
select alike(pg_temp.val_as(null, null,
  $$select token_number::text from public.next_queue_token('c0820000-0000-4000-8000-000000001101')$$),
  'denied:permission denied for function next_queue_token%', 'anon cannot execute next_queue_token');
select alike(pg_temp.val_as('c0820000-0000-4000-8000-000000000101', 'c0820000-0000-4000-8000-00000000000a',
  $$select count(*)::text from public.queue_token_counters$$),
  'denied:permission denied for table queue_token_counters%', 'an owner cannot read the counter');
select alike(pg_temp.val_as('c0820000-0000-4000-8000-000000000101', 'c0820000-0000-4000-8000-00000000000a',
  $$update public.queue_token_counters set last_token = 0 returning last_token::text$$),
  'denied:permission denied for table queue_token_counters%', 'an owner cannot rewind the counter (T-05-21)');
select is(
  (select last_token from public.queue_token_counters
    where tenant_id = 'c0820000-0000-4000-8000-00000000000a'
      and date = public.tenant_local_date('c0820000-0000-4000-8000-00000000000a', now())),
  8, 'the refused calls left the counter unchanged');

select * from finish();
rollback;
