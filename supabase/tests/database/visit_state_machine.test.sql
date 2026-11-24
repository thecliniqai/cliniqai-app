-- visit_state_machine.test.sql — V2-08 08-01b (R-7, R-8; migration 000100).
-- The visit state machine: private.visit_transition_allowed is the R-7 table, and the BEFORE UPDATE OF status trigger
-- visits_status_transition_guard refuses every other status change for every writer (VISIT_TRANSITION_INVALID, P0001).
-- Every status x status x signed combination is tried against a real row. The two desk commands' behaviour is in
-- tests/queue/*.spec.ts; their grants and settings are checked here.
-- Synthetic data only; the file rolls back.
begin;
-- 000103 (08-04a): UPDATE on public.visits is narrowed for authenticated to specialty, metadata and updated_at. This file proves the
-- guards, triggers and RLS policies themselves (defence in depth, independent of the column grant), so the grant is widened for
-- this transaction only; the narrowing itself is proven in staff_scheduling.test.sql.
grant update on table public.visits to authenticated;
select plan(14);

insert into auth.users (id, email) values
  ('c1000000-0000-4000-8000-000000000101', 'c100-owner-a@example.test'),
  ('c1000000-0000-4000-8000-000000000102', 'c100-doctor-a@example.test'),
  ('c1000000-0000-4000-8000-000000000104', 'c100-receptionist-a@example.test');
insert into public.tenants (id, name) values ('c1000000-0000-4000-8000-00000000000a', 'Synthetic 000100 Clinic A');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in (select t.id from public.tenants t where t.created_at = now()) and s.status = 'incomplete';
insert into public.memberships (user_id, tenant_id, role) values
  ('c1000000-0000-4000-8000-000000000101', 'c1000000-0000-4000-8000-00000000000a', 'owner'),
  ('c1000000-0000-4000-8000-000000000102', 'c1000000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1000000-0000-4000-8000-000000000104', 'c1000000-0000-4000-8000-00000000000a', 'receptionist');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1000000-0000-4000-8000-000000001001', 'c1000000-0000-4000-8000-00000000000a', 'Synthetic Patient One', '+919000010001', 'c1000000-0000-4000-8000-000000000101');

-- The R-7 table, written out again here (the migration's function and the TS table are checked against it).
create temp table sm_statuses(s text primary key) on commit drop;
insert into sm_statuses values ('booked'), ('confirmed'), ('waiting'), ('in_consultation'), ('completed'), ('cancelled'), ('no_show');
create temp table sm_allowed(from_s text, to_s text, signed boolean) on commit drop;
insert into sm_allowed (from_s, to_s, signed)
select f, t, sg from (values
  ('booked', 'confirmed'), ('booked', 'waiting'), ('confirmed', 'waiting'), ('no_show', 'waiting'),
  ('booked', 'booked'), ('confirmed', 'booked'), ('no_show', 'booked'),
  ('booked', 'no_show'), ('confirmed', 'no_show'),
  ('booked', 'cancelled'), ('confirmed', 'cancelled'), ('waiting', 'cancelled'),
  ('waiting', 'in_consultation'), ('waiting', 'completed'), ('in_consultation', 'completed')
) a(f, t) cross join (values (false), (true)) b(sg);
insert into sm_allowed values ('completed', 'in_consultation', true);

-- Inserts a visit in `p_from` (signed or not, on the system path) and tries to move it to `p_to`: 'ok' or the error.
create function pg_temp.try_move(p_from text, p_to text, p_signed boolean) returns text language plpgsql as $f$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, signed_at, signed_by, created_by)
  values (v_id, 'c1000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-000000001001',
          'c1000000-0000-4000-8000-000000000102', 'walk_in', p_from,
          case when p_signed then now() else null end,
          case when p_signed then 'c1000000-0000-4000-8000-000000000102'::uuid else null end,
          'c1000000-0000-4000-8000-000000000101');
  begin
    update public.visits set status = p_to where id = v_id;
    return 'ok';
  exception when others then
    return sqlstate || ':' || sqlerrm;
  end;
end;
$f$;

-- The single value p_sql returns as the user acting in clinic A; a 42501 is 'denied:<message>', any other error
-- 'error:<sqlstate>:<message>'. Claims are cleared afterwards.
create function pg_temp.as_user(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c1000000-0000-4000-8000-00000000000a')::text, true);
  begin
    set local role authenticated;
    execute p_sql into v_out;
    reset role;
    v_out := coalesce(v_out, 'none');
  exception
    when insufficient_privilege then reset role; v_out := 'denied:' || sqlerrm;
    when others then reset role; v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  return v_out;
end;
$f$;

-- 1. Objects ------------------------------------------------------------------------------------------------------------
select has_trigger('public', 'visits', 'visits_status_transition_guard', 'visits carries the status transition guard');
select matches(
  (select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgrelid = 'public.visits'::regclass and t.tgname = 'visits_status_transition_guard'),
  'BEFORE UPDATE OF status ON public\.visits FOR EACH ROW WHEN \(\(old\.status IS DISTINCT FROM new\.status\)\)',
  'it fires BEFORE UPDATE OF status, only when the status changes');
select is(
  (select p.provolatile::text || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ',') from pg_proc p
    where p.oid = 'private.visit_transition_allowed(text, text, boolean)'::regprocedure),
  'i:false:search_path=""', 'visit_transition_allowed is IMMUTABLE, SECURITY INVOKER, search_path pinned');
select is(
  (select p.prosecdef::text || ':' || array_to_string(p.proconfig, ',') from pg_proc p
    where p.oid = 'private.visits_status_transition_guard()'::regprocedure),
  'true:search_path=""', 'the guard is a definer trigger function with search_path pinned (it calls the private function)');

-- 2. The table ----------------------------------------------------------------------------------------------------------
select set_eq(
  $$ select f.s as from_s, t.s as to_s, sg as signed from sm_statuses f cross join sm_statuses t cross join (values (false), (true)) b(sg)
      where private.visit_transition_allowed(f.s, t.s, sg) $$,
  $$ select from_s, to_s, signed from sm_allowed $$,
  'visit_transition_allowed lists exactly the R-7 pairs (7 x 7 x signed)');
-- V2-09a 000107 (R-5): visits_integrity_guard now refuses EVERY status change of a signed visit on the system path (VISIT_SIGNED_STATUS_FORBIDDEN,
-- 42501), which fires before this guard. To keep proving the transition table for the signed rows on its own, the integrity guard is switched
-- off for this one statement (owner DDL in the test transaction, enabled again right after; R-3 keeps this out of reach of every request path).
alter table public.visits disable trigger visits_integrity_guard;
select set_eq(
  $$ select f.s as from_s, t.s as to_s, sg as signed from sm_statuses f cross join sm_statuses t cross join (values (false), (true)) b(sg)
      where f.s <> t.s and pg_temp.try_move(f.s, t.s, sg) = 'ok' $$,
  $$ select from_s, to_s, signed from sm_allowed where from_s <> to_s $$,
  'the trigger lets exactly the listed status changes through, and refuses every other one (7 x 7 x signed)');
alter table public.visits enable trigger visits_integrity_guard;
select is(
  (select string_agg(s.s, ',' order by s.s) from sm_statuses s where pg_temp.try_move(s.s, s.s, false) = 'ok'),
  'booked,cancelled,completed,confirmed,in_consultation,no_show,waiting',
  'a write that leaves the status unchanged is not a transition, in every status');
select is(pg_temp.try_move('cancelled', 'booked', false), 'P0001:VISIT_TRANSITION_INVALID',
  'a refused change raises VISIT_TRANSITION_INVALID (P0001)');
select is(pg_temp.try_move('completed', 'in_consultation', false), 'P0001:VISIT_TRANSITION_INVALID',
  'an unsigned completed visit never reopens');

-- 3. Every writer, and the signed reopen ----------------------------------------------------------------------------------
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, signed_at, signed_by, created_by) values
  ('c1000000-0000-4000-8000-000000002001', 'c1000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-000000001001',
   'c1000000-0000-4000-8000-000000000102', 'walk_in', 'completed', now(), 'c1000000-0000-4000-8000-000000000102',
   'c1000000-0000-4000-8000-000000000101'),
  ('c1000000-0000-4000-8000-000000002002', 'c1000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-000000001001',
   'c1000000-0000-4000-8000-000000000102', 'walk_in', 'cancelled', null, null, 'c1000000-0000-4000-8000-000000000101');
select is(pg_temp.as_user('c1000000-0000-4000-8000-000000000104',
  $$update public.visits set status = 'waiting' where id = 'c1000000-0000-4000-8000-000000002002' returning 'ok'$$),
  'error:P0001:VISIT_TRANSITION_INVALID', 'a signed-in receptionist cannot revive a cancelled visit either');
select is(pg_temp.as_user('c1000000-0000-4000-8000-000000000102',
  $$update public.visits set status = 'in_consultation' where id = 'c1000000-0000-4000-8000-000000002001' returning 'ok'$$),
  'denied:VISIT_REOPEN_NEEDS_AMENDMENT',
  'the signed reopen is listed, but a plain UPDATE still needs the amendment snapshot: only reopen_visit_for_amendment does it');

-- 4. Grants and settings --------------------------------------------------------------------------------------------------
select is(
  (select string_agg(f.fn || ':' || has_function_privilege('authenticated', f.fn, 'EXECUTE')::text || ':'
                     || has_function_privilege('anon', f.fn, 'EXECUTE')::text || ':' || has_function_privilege('service_role', f.fn, 'EXECUTE')::text,
                     ',' order by f.fn)
     from (values ('public.start_consultation(uuid, uuid, uuid, bigint)'), ('public.complete_visit(uuid, uuid, uuid, bigint)')) f(fn)),
  'public.complete_visit(uuid, uuid, uuid, bigint):true:false:false,public.start_consultation(uuid, uuid, uuid, bigint):true:false:false',
  'start_consultation and complete_visit: EXECUTE for authenticated only (no anon, no service role)');
select is(
  (select string_agg(f.fn || ':' || has_function_privilege('authenticated', f.fn, 'EXECUTE')::text || ':' || has_function_privilege('service_role', f.fn, 'EXECUTE')::text,
                     ',' order by f.fn)
     from (values ('private.visit_transition_allowed(text, text, boolean)'), ('private.visits_status_transition_guard()'),
                  ('private.step_check_in(uuid, uuid, text)')) f(fn)),
  'private.step_check_in(uuid, uuid, text):false:false,private.visit_transition_allowed(text, text, boolean):false:false,private.visits_status_transition_guard():false:false',
  'the state machine and the check-in step have no API grant');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ','), ',' order by p.proname)
     from pg_proc p where p.oid in ('public.start_consultation(uuid, uuid, uuid, bigint)'::regprocedure, 'public.complete_visit(uuid, uuid, uuid, bigint)'::regprocedure)),
  'complete_visit:true:search_path="",lock_timeout=2s,start_consultation:true:search_path="",lock_timeout=2s',
  'the two commands are definer functions with search_path pinned and lock_timeout 2s');

select * from finish();
rollback;
