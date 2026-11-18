-- gate_close_05b.test.sql — V2-05 05b gate close (migration 000094; `reviews/v205b-review-reverify.md`, CTO ruling
-- 2026-11-15 in `05b-REVIEW-TRIAGE.md`).
--   1. N-1: `ai_commit` decides expiry at the wall clock (`clock_timestamp()`) after taking the usage-row lock, not at
--      the transaction start: a reservation that expires while the committing transaction is open is refused and no
--      unit is added. (The lock-order half needs two sessions: tests/ai/ai-commit-expiry-race.spec.ts.)
--   2. N-2: every `invite_staff` answer names the STORED role (`role`), including a `deduped` answer. (The concurrent
--      branch, where the stored role differs from the requested one, needs two sessions:
--      tests/staff/invite-dedupe-role.spec.ts.)
--   3. CTO ruling: an owner who holds the doctor permissions may clear a patient's AI objection, audited; admins and
--      nurses may not; doctor and receptionist still may.
-- Synthetic data only; every probe and the file roll back.
begin;
select plan(12);

-- Fixtures -----------------------------------------------------------------------------------------------------------
-- A: one trialing clinic with every role, one patient and one visit; the owner opted in to AI.
insert into auth.users (id, email) values
  ('c5130000-0000-4000-8000-000000000101', 'c513-owner-a@example.test'),
  ('c5130000-0000-4000-8000-000000000102', 'c513-admin-a@example.test'),
  ('c5130000-0000-4000-8000-000000000103', 'c513-doctor-a@example.test'),
  ('c5130000-0000-4000-8000-000000000105', 'c513-nurse-a@example.test'),
  ('c5130000-0000-4000-8000-000000000106', 'c513-receptionist-a@example.test');
insert into public.tenants (id, name) values ('c5130000-0000-4000-8000-00000000000a', 'Synthetic 05b Gate Clinic A');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id = 'c5130000-0000-4000-8000-00000000000a' and s.status = 'incomplete';
insert into public.memberships (user_id, tenant_id, role) values
  ('c5130000-0000-4000-8000-000000000101', 'c5130000-0000-4000-8000-00000000000a', 'owner'),
  ('c5130000-0000-4000-8000-000000000102', 'c5130000-0000-4000-8000-00000000000a', 'admin'),
  ('c5130000-0000-4000-8000-000000000103', 'c5130000-0000-4000-8000-00000000000a', 'doctor'),
  ('c5130000-0000-4000-8000-000000000105', 'c5130000-0000-4000-8000-00000000000a', 'nurse'),
  ('c5130000-0000-4000-8000-000000000106', 'c5130000-0000-4000-8000-00000000000a', 'receptionist');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c5130000-0000-4000-8000-000000001001', 'c5130000-0000-4000-8000-00000000000a', 'Synthetic Patient G', '+919000005131',
   'c5130000-0000-4000-8000-000000000101');

-- Helpers ------------------------------------------------------------------------------------------------------------
-- Runs (who, sql) pairs in order inside one subtransaction and returns the last statement's single value. `who` is a
-- user id (authenticated, no tenant header: every user here has one clinic) or 'postgres'. 'denied:<msg>' (42501) /
-- 'error:<sqlstate>:<msg>' for the first failure. Always rolled back.
create function pg_temp.seq(variadic p text[]) returns text language plpgsql as $f$
declare
  v_out text;
  i int := 1;
begin
  begin
    while i < array_length(p, 1) loop
      reset role;
      perform set_config('request.headers', '', true);
      if p[i] = 'postgres' then
        perform set_config('request.jwt.claims', '', true);
      else
        perform set_config('request.jwt.claims', json_build_object('sub', p[i], 'role', 'authenticated')::text, true);
        set local role authenticated;
      end if;
      execute p[i + 1] into v_out;
      i := i + 2;
    end loop;
    reset role;
    raise exception 'c513 sentinel' using errcode = 'P0S13';
  exception
    when sqlstate 'P0S13' then null;
    when insufficient_privilege then reset role; v_out := 'denied:' || sqlerrm;
    when others then reset role; v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

-- 1. N-1: expiry at the wall clock ----------------------------------------------------------------------------------
-- 1,499 of the trial's 1,500 used; the doctor's reservation `r` lives until `clock_timestamp() + p_ms`. The whole file
-- is one transaction, so `now()` stays at its start: before 000094 a reservation that expired a moment ago still
-- compared as live.
create function pg_temp.usage_and_reservation(p_ms int) returns text language sql as $f$
  select format($q$
    with u as (insert into public.ai_usage_monthly (tenant_id, period, feature, units)
               values ('c5130000-0000-4000-8000-00000000000a', 'trial:2026-11-01', 'ai.scribe', 1499) returning 1),
         r as (insert into public.ai_quota_reservations (id, tenant_id, feature, period, expires_at, created_by)
               values ('c5130000-0000-4000-8000-000000002001', 'c5130000-0000-4000-8000-00000000000a', 'ai.scribe',
                       'trial:2026-11-01', clock_timestamp() + make_interval(secs => %s / 1000.0),
                       'c5130000-0000-4000-8000-000000000103') returning 1)
    select (select count(*) from u)::text || (select count(*) from r)::text $q$, p_ms)
$f$;
-- The commit's outcome as text, so a later step of the same probe can read the usage row (system path).
create function pg_temp.try_commit(p_id uuid) returns text language plpgsql as $f$
begin
  return public.ai_commit(p_id)::text;
exception when sqlstate 'P0001' then
  return sqlerrm;
end;
$f$;
create function pg_temp.units() returns text language sql as $f$
  select $q$ select coalesce((select units::text from public.ai_usage_monthly
                                where tenant_id = 'c5130000-0000-4000-8000-00000000000a' and period = 'trial:2026-11-01'
                                  and feature = 'ai.scribe'), 'none') $q$
$f$;

select is(pg_temp.seq(
    'postgres', pg_temp.usage_and_reservation(300),
    'postgres', 'select pg_sleep(0.6)::text',
    'c5130000-0000-4000-8000-000000000103', $$ select public.ai_commit('c5130000-0000-4000-8000-000000002001')::text $$),
  'error:P0001:AI_RESERVATION_EXPIRED',
  'N-1: a reservation that expired while the committing transaction was open is refused (wall clock, not transaction start)');
select is(pg_temp.seq(
    'postgres', pg_temp.usage_and_reservation(300),
    'postgres', 'select pg_sleep(0.6)::text',
    'postgres', $$ select pg_temp.try_commit('c5130000-0000-4000-8000-000000002001') $$,
    'postgres', pg_temp.units()),
  '1499', 'N-1: the refused commit adds no unit: the period stays at 1,499 of 1,500');
select is(pg_temp.seq(
    'postgres', pg_temp.usage_and_reservation(300),
    'postgres', 'select pg_sleep(0.6)::text',
    'postgres', $$ select public.ai_commit('c5130000-0000-4000-8000-000000002001')::text $$),
  'error:P0001:AI_RESERVATION_EXPIRED', 'N-1: the system path is refused the same way (no bypass)');
select is(pg_temp.seq(
    'postgres', pg_temp.usage_and_reservation(300000),
    'postgres', 'select pg_sleep(0.6)::text',
    'c5130000-0000-4000-8000-000000000103', $$ select public.ai_commit('c5130000-0000-4000-8000-000000002001')::text $$),
  '1500', 'N-1 control: a reservation still live at the wall clock commits to exactly 1,500');
select is(pg_temp.seq(
    'postgres', pg_temp.usage_and_reservation(300000),
    'c5130000-0000-4000-8000-000000000103', $$ select public.ai_commit('c5130000-0000-4000-8000-000000002001')::text $$,
    'c5130000-0000-4000-8000-000000000103', $$ select public.ai_commit('c5130000-0000-4000-8000-000000002001')::text $$),
  'error:P0002:AI_RESERVATION_NOT_FOUND', 'N-1 control: a reservation commits once; a second commit finds nothing');

-- 2. N-2: the stored role in every invite_staff answer --------------------------------------------------------------
create function pg_temp.invite(p_email text, p_role text) returns text language sql as $f$
  select format($q$ select (r ->> 'deduped') || '|' || coalesce(r ->> 'role', 'no-role') || '|' || coalesce(r ->> 'replaced_role', '-')
                      from public.invite_staff('c5130000-0000-4000-8000-00000000000a', %L, %L) r $q$, p_email, p_role)
$f$;
select is(pg_temp.seq(
    'c5130000-0000-4000-8000-000000000101', pg_temp.invite('c513-new-nurse@example.test', 'nurse')),
  'false|nurse|-', 'N-2: a new invitation answers its role');
select is(pg_temp.seq(
    'c5130000-0000-4000-8000-000000000101', pg_temp.invite('c513-new-nurse@example.test', 'nurse'),
    'c5130000-0000-4000-8000-000000000102', pg_temp.invite('C513-New-Nurse@example.test ', 'nurse')),
  'true|nurse|-', 'N-2: a deduped answer names the stored role');
select is(pg_temp.seq(
    'c5130000-0000-4000-8000-000000000101', pg_temp.invite('c513-new-nurse@example.test', 'nurse'),
    'c5130000-0000-4000-8000-000000000101', pg_temp.invite('c513-new-nurse@example.test', 'receptionist')),
  'false|receptionist|nurse', 'N-2: a replacing answer names the new stored role and the replaced one');

-- 3. CTO ruling: who may clear a patient's AI objection -------------------------------------------------------------
create function pg_temp.objected() returns text language sql as $f$
  select 'with u as (update public.patients set ai_processing_objected = true where id = ''c5130000-0000-4000-8000-000000001001'' returning 1) select count(*)::text from u'
$f$;
create function pg_temp.clear() returns text language sql as $f$
  select 'with u as (update public.patients set ai_processing_objected = false where id = ''c5130000-0000-4000-8000-000000001001'' returning 1) select count(*)::text from u'
$f$;
create function pg_temp.audit() returns text language sql as $f$
  select $q$ select string_agg(action || '|' || coalesce(actor_id::text, '-') || '|' || actor_role || '|' || metadata::text, ',' order by id)
               from public.audit_logs where entity_type = 'patient' and entity_id = 'c5130000-0000-4000-8000-000000001001' $q$
$f$;
select is(pg_temp.seq(
    'postgres', pg_temp.objected(),
    'c5130000-0000-4000-8000-000000000101', pg_temp.clear()),
  '1', 'ruling: the owner (who holds every doctor permission) clears a patient''s AI objection');
select is(pg_temp.seq(
    'postgres', pg_temp.objected(),
    'c5130000-0000-4000-8000-000000000101', pg_temp.clear(),
    'postgres', pg_temp.audit()),
  'patient.ai_objection.set|-|system|{},patient.ai_objection.cleared|c5130000-0000-4000-8000-000000000101|owner|{}',
  'ruling: the owner''s clear is audited with actor and role, no PHI');
select is(pg_temp.seq('postgres', pg_temp.objected(), 'c5130000-0000-4000-8000-000000000102', pg_temp.clear())
          || '/' || pg_temp.seq('postgres', pg_temp.objected(), 'c5130000-0000-4000-8000-000000000105', pg_temp.clear()),
  'denied:AI_OBJECTION_CLEAR_FORBIDDEN/denied:AI_OBJECTION_CLEAR_FORBIDDEN',
  'ruling: an admin and a nurse still cannot clear it');
select is(pg_temp.seq('postgres', pg_temp.objected(), 'c5130000-0000-4000-8000-000000000103', pg_temp.clear())
          || '/' || pg_temp.seq('postgres', pg_temp.objected(), 'c5130000-0000-4000-8000-000000000106', pg_temp.clear()),
  '1/1', 'ruling: the doctor and the receptionist still can');

select * from finish();
rollback;
