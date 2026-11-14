-- platform_rpcs.test.sql — V2-05 plan 05-09b (SUB-01 transition RPCs, AI-18 availability switch;
-- SUBSCRIPTIONS_AND_PLANS.md §6.2, §8.1, §9.2, §11 "DB (security)"; acceptance 13 second half; threat T-05-33).
--   1. catalogue: platform_admins / platform_audit_log are closed (RLS on, no policy, no API-role write, service_role
--      SELECT only); is_platform_admin and the five platform.* RPCs are SECURITY DEFINER with search_path '' and exactly
--      their EXECUTE grantees; the internal helpers are executable by no API role;
--   2. is_platform_admin(): an active admin row AND aal2;
--   3. the actor rule (SUB §8.1), for every RPC: a non-admin JWT caller, an aal1 admin, and a non-admin naming a real
--      admin in p_actor are all refused (42501 PLATFORM_ADMIN_REQUIRED); postgres and service_role with a null, unknown
--      or revoked p_actor are refused (42501 PLATFORM_ACTOR_INVALID); an aal2 admin naming another admin is recorded
--      as themselves (channel ui); postgres with a valid p_actor is recorded as that admin (channel sql); a refused
--      call writes nothing;
--   4. set_product_availability refuses purchasable = true without a price active now that has a provider plan id
--      (acceptance 13), then allows it after create_plan_price; create_plan_price versions prices;
--   5. extend_trial, set_comp, grant_override: state, access_ends_at, version, one event and one audit row each;
--   6. admin grants and revocations made in SQL are audited; the audit trail is append-only for every API role.
-- Synthetic data only; the file rolls back.
begin;
select plan(80);

-- Fixtures (synthetic, inlined) --------------------------------------------------------------------------------------
-- Users: two active admins, one revoked admin, one ordinary user (owner of clinic A).
insert into auth.users (id, email) values
  ('c9b00000-0000-4000-8000-000000000001', 'c9b-admin1@example.test'),
  ('c9b00000-0000-4000-8000-000000000002', 'c9b-admin2@example.test'),
  ('c9b00000-0000-4000-8000-000000000003', 'c9b-revoked@example.test'),
  ('c9b00000-0000-4000-8000-000000000004', 'c9b-user@example.test');
insert into public.platform_admins (user_id, granted_by) values
  ('c9b00000-0000-4000-8000-000000000001', null),
  ('c9b00000-0000-4000-8000-000000000002', 'c9b00000-0000-4000-8000-000000000001'),
  ('c9b00000-0000-4000-8000-000000000003', 'c9b00000-0000-4000-8000-000000000001');
update public.platform_admins set revoked_at = now() where user_id = 'c9b00000-0000-4000-8000-000000000003';

-- Clinics (the tenants trigger gives each an `incomplete` row; shaped below as postgres).
insert into public.tenants (id, name) values
  ('c9b00000-0000-4000-8000-00000000000a', 'Synthetic 05-09b Trial Clinic'),
  ('c9b00000-0000-4000-8000-00000000000b', 'Synthetic 05-09b Incomplete Clinic'),
  ('c9b00000-0000-4000-8000-00000000000c', 'Synthetic 05-09b Expired Clinic'),
  ('c9b00000-0000-4000-8000-00000000000d', 'Synthetic 05-09b Purged Clinic'),
  ('c9b00000-0000-4000-8000-00000000000e', 'Synthetic 05-09b Cancelling Trial Clinic'),
  ('c9b00000-0000-4000-8000-00000000000f', 'Synthetic 05-09b Active Clinic'),
  ('c9b00000-0000-4000-8000-000000000010', 'Synthetic 05-09b Stale Trial Clinic');
insert into public.memberships (user_id, tenant_id, role) values
  ('c9b00000-0000-4000-8000-000000000004', 'c9b00000-0000-4000-8000-00000000000a', 'owner');
create temp table c9b_std on commit drop as
  select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id where p.code = 'standard' order by pp.active_from limit 1;
update public.tenant_subscriptions s set status = 'trialing', plan_price_id = (select id from c9b_std),
       trial_start = now() - interval '2 days', trial_end = now() + interval '12 days',
       access_ends_at = now() + interval '13 days', trial_consumed = true
 where tenant_id in ('c9b00000-0000-4000-8000-00000000000a', 'c9b00000-0000-4000-8000-00000000000e');
update public.tenant_subscriptions set cancel_at_period_end = true, canceled_at = now(), cancel_source = 'owner'
 where tenant_id = 'c9b00000-0000-4000-8000-00000000000e';
update public.tenant_subscriptions s set status = 'trialing', plan_price_id = (select id from c9b_std),
       trial_start = now() - interval '20 days', trial_end = now() - interval '6 days',
       access_ends_at = now() - interval '5 days', trial_consumed = true
 where tenant_id = 'c9b00000-0000-4000-8000-000000000010';
update public.tenant_subscriptions s set status = 'expired', plan_price_id = (select id from c9b_std),
       current_period_start = now() - interval '40 days', current_period_end = now() - interval '10 days',
       access_ends_at = now() - interval '10 days', expired_at = now() - interval '10 days'
 where tenant_id = 'c9b00000-0000-4000-8000-00000000000c';
update public.tenant_subscriptions set status = 'purged', purged_at = now() - interval '1 day'
 where tenant_id = 'c9b00000-0000-4000-8000-00000000000d';
update public.tenant_subscriptions s set status = 'active', plan_price_id = (select id from c9b_std),
       current_period_start = now() - interval '5 days', current_period_end = now() + interval '25 days',
       access_ends_at = now() + interval '26 days'
 where tenant_id = 'c9b00000-0000-4000-8000-00000000000f';

-- Helper: run p_sql as p_role ('postgres', 'service_role', 'authenticated', 'anon'), with a JWT for p_user (sub,
-- role, aal = p_aal) when given. Returns 'ok' or 'error:<sqlstate>:<message>'. Effects are kept on success unless
-- p_keep is false (then the subtransaction is rolled back with a sentinel); a failure rolls back its subtransaction.
create function pg_temp.do_as(p_role text, p_user uuid, p_aal text, p_sql text, p_keep boolean default true)
returns text language plpgsql as $f$
declare
  v_out text;
begin
  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims',
      case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role, 'aal', p_aal)::text end, true);
    perform set_config('request.headers', '', true);
    if p_role <> 'postgres' then execute format('set local role %I', p_role); end if;
    execute p_sql;
    v_out := 'ok';
    if not p_keep then raise exception 'c9b sentinel' using errcode = 'P0S09'; end if;
    reset role;
    perform set_config('request.jwt.claims', '', true);
  exception
    when sqlstate 'P0S09' then null;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

-- The single value p_sql returns as (p_role, p_user, p_aal); same conventions as do_as, always rolled back.
create function pg_temp.val_as(p_role text, p_user uuid, p_aal text, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims',
      case when p_user is null then '' else json_build_object('sub', p_user, 'role', p_role, 'aal', p_aal)::text end, true);
    perform set_config('request.headers', '', true);
    if p_role <> 'postgres' then execute format('set local role %I', p_role); end if;
    execute p_sql into v_out;
    raise exception 'c9b sentinel' using errcode = 'P0S09';
  exception
    when sqlstate 'P0S09' then null;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

-- One valid call of every platform RPC; %s is the p_actor literal.
create temp table c9b_calls (fn text primary key, tpl text not null) on commit drop;
insert into c9b_calls values
  ('extend_trial', $$select platform.extend_trial('c9b00000-0000-4000-8000-00000000000a', interval '1 day', 'synthetic', %s)$$),
  ('set_comp', $$select platform.set_comp('c9b00000-0000-4000-8000-00000000000c', now() + interval '10 days', 'synthetic', %s)$$),
  ('grant_override', $$select platform.grant_override('c9b00000-0000-4000-8000-00000000000f', 'ai.scribe', true, null, now() + interval '10 days', 'synthetic', %s)$$),
  ('create_plan_price', $$select platform.create_plan_price('ai_voice_receptionist', 'flat_recurring', 99900, 1800, false, null, now() + interval '1 day', %s)$$),
  ('set_product_availability', $$select platform.set_product_availability('ai_voice_receptionist', false, 'coming_soon', %s)$$);

-- Outcome of every call as (role, user, aal) with p_actor = p_actor, rolled back; one row per fn.
create function pg_temp.calls_as(p_role text, p_user uuid, p_aal text, p_actor uuid)
returns table (fn text, outcome text) language sql as $f$
  select c.fn, pg_temp.do_as(p_role, p_user, p_aal, format(c.tpl, quote_nullable(p_actor)), false)
    from c9b_calls c order by c.fn
$f$;

create temp table c9b_audit_before on commit drop as select count(*)::int as n from public.platform_audit_log;

-- 1. Catalogue ------------------------------------------------------------------------------------------------------
select is(
  (select array_agg(c.relrowsecurity order by c.relname) from pg_class c
    where c.oid in ('public.platform_admins'::regclass, 'public.platform_audit_log'::regclass)),
  array[true, true], 'RLS is on for platform_admins and platform_audit_log');
select is_empty(
  $$ select tablename from pg_policies where schemaname = 'public' and tablename in ('platform_admins', 'platform_audit_log') $$,
  'neither platform table has a policy (no tenant role reads or writes them)');
select is_empty(
  $$ select t || ' ' || r || ' ' || pr from unnest(array['public.platform_admins', 'public.platform_audit_log']) t
      cross join unnest(array['anon', 'authenticated']) r
      cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pr
      where case when pr in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') then has_any_column_privilege(r, t, pr)
                 else has_table_privilege(r, t, pr) end $$,
  'anon and authenticated hold no privilege on either platform table');
select is(
  array[has_table_privilege('service_role', 'public.platform_admins', 'SELECT'),
        has_table_privilege('service_role', 'public.platform_admins', 'INSERT'),
        has_table_privilege('service_role', 'public.platform_admins', 'UPDATE'),
        has_table_privilege('service_role', 'public.platform_admins', 'DELETE'),
        has_table_privilege('service_role', 'public.platform_audit_log', 'SELECT'),
        has_table_privilege('service_role', 'public.platform_audit_log', 'INSERT'),
        has_table_privilege('service_role', 'public.platform_audit_log', 'UPDATE'),
        has_table_privilege('service_role', 'public.platform_audit_log', 'DELETE'),
        has_table_privilege('service_role', 'public.platform_audit_log', 'TRUNCATE')],
  array[true, false, false, false, true, false, false, false, false],
  'service_role reads both platform tables and writes neither (audit trail append-only by grants)');
select set_eq(
  $$ select p.proname || ':' || p.prosecdef || ':' || coalesce('search_path=""' = any(p.proconfig), false) || ':' ||
            coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ',' order by 1)
                        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'platform' $$,
  array['extend_trial:true:true:authenticated,service_role', 'set_comp:true:true:authenticated,service_role',
        'grant_override:true:true:authenticated,service_role', 'create_plan_price:true:true:authenticated,service_role',
        'set_product_availability:true:true:authenticated,service_role']::text[],
  'platform has exactly the five RPCs: SECURITY DEFINER, search_path '''', EXECUTE for authenticated and service_role only');
select is(
  (select p.prosecdef::text || ':' || coalesce('search_path=""' = any(p.proconfig), false) || ':' ||
          coalesce((select string_agg(a.grantee::regrole::text, ',' order by 1)
                      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '')
     from pg_proc p where p.oid = 'public.is_platform_admin()'::regprocedure),
  'true:true:authenticated', 'is_platform_admin: SECURITY DEFINER, search_path '''', EXECUTE for authenticated only');
select is_empty(
  $$ select f from unnest(array['private.platform_actor(uuid)', 'private.platform_reason(text)', 'private.platform_admins_audit()']) f
      where has_function_privilege('authenticated', f::regprocedure, 'EXECUTE')
         or has_function_privilege('anon', f::regprocedure, 'EXECUTE')
         or has_function_privilege('service_role', f::regprocedure, 'EXECUTE')
         or has_function_privilege('public', f::regprocedure, 'EXECUTE') $$,
  'the actor, reason and admin-audit helpers are executable by no API role');

-- 2. is_platform_admin() -----------------------------------------------------------------------------------------------
select is(pg_temp.val_as('authenticated', 'c9b00000-0000-4000-8000-000000000001', 'aal2', 'select public.is_platform_admin()'),
  'true', 'an active admin with an aal2 session is a platform admin');
select is(pg_temp.val_as('authenticated', 'c9b00000-0000-4000-8000-000000000001', 'aal1', 'select public.is_platform_admin()'),
  'false', 'the same admin at aal1 is not (MFA required)');
select is(pg_temp.val_as('authenticated', 'c9b00000-0000-4000-8000-000000000003', 'aal2', 'select public.is_platform_admin()'),
  'false', 'a revoked admin at aal2 is not');
select is(pg_temp.val_as('authenticated', 'c9b00000-0000-4000-8000-000000000004', 'aal2', 'select public.is_platform_admin()'),
  'false', 'an ordinary user at aal2 is not');
select alike(pg_temp.do_as('anon', null, null, 'select public.is_platform_admin()'), 'error:42501:%',
  'anon cannot call is_platform_admin');

-- 3. The actor rule ----------------------------------------------------------------------------------------------------
select is_empty(
  $$ select fn || ' ' || outcome from pg_temp.calls_as('postgres', null, null, 'c9b00000-0000-4000-8000-000000000001')
      where outcome <> 'ok' $$,
  'control: every RPC succeeds as postgres with an active admin as p_actor');
select is_empty(
  $$ select fn || ' ' || outcome from pg_temp.calls_as('authenticated', 'c9b00000-0000-4000-8000-000000000004', 'aal2', null)
      where outcome <> 'error:42501:PLATFORM_ADMIN_REQUIRED' $$,
  'a non-admin authenticated caller is refused by every RPC (forbidden)');
select is_empty(
  $$ select fn || ' ' || outcome from pg_temp.calls_as('authenticated', 'c9b00000-0000-4000-8000-000000000001', 'aal1', null)
      where outcome <> 'error:42501:PLATFORM_ADMIN_REQUIRED' $$,
  'an admin at aal1 is refused by every RPC (forbidden)');
select is_empty(
  $$ select fn || ' ' || outcome from pg_temp.calls_as('authenticated', 'c9b00000-0000-4000-8000-000000000004', 'aal2',
                                                       'c9b00000-0000-4000-8000-000000000001')
      where outcome <> 'error:42501:PLATFORM_ADMIN_REQUIRED' $$,
  'a non-admin JWT caller naming a real admin in p_actor is still refused by every RPC (p_actor is ignored for JWT callers)');
select is_empty(
  $$ select fn || ' ' || outcome from pg_temp.calls_as('authenticated', 'c9b00000-0000-4000-8000-000000000003', 'aal2', null)
      where outcome <> 'error:42501:PLATFORM_ADMIN_REQUIRED' $$,
  'a revoked admin at aal2 is refused by every RPC');
select is_empty(
  $$ select fn || ' ' || outcome from pg_temp.calls_as('postgres', null, null, null)
      where outcome <> 'error:42501:PLATFORM_ACTOR_INVALID' $$,
  'postgres with a null p_actor is refused by every RPC');
select is_empty(
  $$ select fn || ' ' || outcome from pg_temp.calls_as('postgres', null, null, 'c9b00000-0000-4000-8000-000000000003')
      where outcome <> 'error:42501:PLATFORM_ACTOR_INVALID' $$,
  'postgres with a revoked admin as p_actor is refused by every RPC');
select is_empty(
  $$ select fn || ' ' || outcome from pg_temp.calls_as('postgres', null, null, 'c9b00000-0000-4000-8000-000000000004')
      where outcome <> 'error:42501:PLATFORM_ACTOR_INVALID' $$,
  'postgres with a non-admin user as p_actor is refused by every RPC');
select is_empty(
  $$ select fn || ' ' || outcome from pg_temp.calls_as('service_role', null, null, null)
      where outcome <> 'error:42501:PLATFORM_ACTOR_INVALID' $$,
  'service_role with a null p_actor is refused by every RPC');
select is_empty(
  $$ select fn || ' ' || outcome from pg_temp.calls_as('service_role', null, null, 'c9b00000-0000-4000-8000-000000000002')
      where outcome <> 'ok' $$,
  'service_role with an active admin as p_actor succeeds on every RPC');
select is_empty(
  $$ select fn || ' ' || outcome from pg_temp.calls_as('anon', null, null, 'c9b00000-0000-4000-8000-000000000001')
      where outcome not like 'error:42501:permission denied for schema platform%' $$,
  'anon cannot reach the platform schema');
select is((select count(*)::int from public.platform_audit_log) - (select n from c9b_audit_before), 0,
  'no refused (or rolled-back) call left an audit row');

-- An aal2 admin naming ANOTHER admin as p_actor is recorded as themselves, channel ui.
select is(pg_temp.do_as('authenticated', 'c9b00000-0000-4000-8000-000000000001', 'aal2',
  $$select platform.set_comp('c9b00000-0000-4000-8000-00000000000c', now() + interval '30 days', 'pilot clinic', 'c9b00000-0000-4000-8000-000000000002')$$),
  'ok', 'an aal2 admin may call set_comp');
select is(
  (select actor_id::text || ':' || channel || ':' || action || ':' || target_tenant_id::text from public.platform_audit_log
    where target_tenant_id = 'c9b00000-0000-4000-8000-00000000000c' order by occurred_at desc, id limit 1),
  'c9b00000-0000-4000-8000-000000000001:ui:subscription.set_comp:c9b00000-0000-4000-8000-00000000000c',
  'the audit row records the CALLER (not the p_actor they passed) and channel ui');
select is(
  (select actor_type || ':' || actor_id::text || ':' || (payload ->> 'channel') from public.subscription_events
    where tenant_id = 'c9b00000-0000-4000-8000-00000000000c' and type = 'comp.set'),
  'platform_admin:c9b00000-0000-4000-8000-000000000001:ui', 'the subscription event records the caller too');

-- 4. Product availability and prices (acceptance 13; AI-18) ------------------------------------------------------------
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.set_product_availability('ai_assist', true, 'public', 'c9b00000-0000-4000-8000-000000000001')$$),
  'error:P0001:PRODUCT_PRICE_REQUIRED',
  'set_product_availability(ai_assist, true, public) as postgres is refused: no active price with a provider plan id (acceptance 13)');
select is((select purchasable::text || ':' || visibility from public.plans where code = 'ai_assist'), 'false:coming_soon',
  'ai_assist is unchanged by the refused call');
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.create_plan_price('ai_assist', 'flat_recurring', 49900, 1800, false, null, now(), 'c9b00000-0000-4000-8000-000000000001')$$),
  'ok', 'a price without a provider plan id may be prepared');
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.set_product_availability('ai_assist', true, 'public', 'c9b00000-0000-4000-8000-000000000001')$$),
  'error:P0001:PRODUCT_PRICE_REQUIRED', 'a price without a provider plan id does not make the product purchasable');
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.create_plan_price('ai_assist', 'flat_recurring', 49900, 1800, false, 'plan_SynthAssist01', now() + interval '1 hour', 'c9b00000-0000-4000-8000-000000000001')$$),
  'ok', 'a provider price scheduled for later is created');
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.set_product_availability('ai_assist', true, 'public', 'c9b00000-0000-4000-8000-000000000001')$$),
  'error:P0001:PRODUCT_PRICE_REQUIRED', 'a provider price that is not active yet does not count');
select is(
  (select count(*)::int from public.plan_prices pp join public.plans p on p.id = pp.plan_id
    where p.code = 'ai_assist' and pp.active_until is null),
  1, 'the scheduled version closed the prepared one (one open version per model)');
-- Make the scheduled version start now (synthetic: shift the window instead of waiting an hour).
update public.plan_prices set active_from = now() - interval '1 second'
 where provider_plan_id = 'plan_SynthAssist01';
update public.plan_prices pp set active_from = now() - interval '2 seconds', active_until = now() - interval '1 second'
  from public.plans p
 where p.id = pp.plan_id and p.code = 'ai_assist' and pp.provider_plan_id is null;
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.set_product_availability('ai_assist', true, 'public', 'c9b00000-0000-4000-8000-000000000001')$$),
  'ok', 'after create_plan_price with a provider plan id (active now), the product can be made purchasable');
select is((select purchasable::text || ':' || visibility from public.plans where code = 'ai_assist'), 'true:public',
  'ai_assist is now purchasable and public');
select is(
  (select (payload -> 'before' ->> 'purchasable') || ':' || (payload -> 'after' ->> 'purchasable') || ':' || channel || ':' || actor_id::text
     from public.platform_audit_log where action = 'catalogue.set_product_availability' and payload ->> 'plan_code' = 'ai_assist'),
  'false:true:sql:c9b00000-0000-4000-8000-000000000001', 'one audit row with before/after, channel sql and the p_actor admin');
select is(
  (select pp.charge_amount_paise::text || ':' || pp."interval" || ':' || pp.interval_count || ':' || pp.tax_inclusive
     from public.plan_prices pp where pp.provider_plan_id = 'plan_SynthAssist01'),
  '58882:month:1:false', 'the new price derives its charge (49900 @ 1800 bp) and is monthly, GST-exclusive');
select is(
  (select count(*)::int from public.platform_audit_log where action = 'catalogue.create_plan_price' and payload ->> 'plan_code' = 'ai_assist'),
  2, 'each created price has an audit row');
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.set_product_availability('standard_trial', true, 'public', 'c9b00000-0000-4000-8000-000000000001')$$),
  'error:P0001:PRODUCT_STATE_INVALID', 'a trial plan can never be made purchasable');
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.set_product_availability('no_such_plan', false, 'hidden', 'c9b00000-0000-4000-8000-000000000001')$$),
  'error:P0002:PLAN_NOT_FOUND', 'an unknown plan code is not found');
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.set_product_availability('ai_voice_receptionist', false, 'everywhere', 'c9b00000-0000-4000-8000-000000000001')$$),
  'error:P0001:INPUT_INVALID', 'an unknown visibility is invalid input');
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.set_product_availability('standard', false, 'public', 'c9b00000-0000-4000-8000-000000000001')$$, false),
  'ok', 'withdrawing a product from sale needs no price');
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.set_product_availability('standard', true, 'public', 'c9b00000-0000-4000-8000-000000000001')$$, false),
  'error:P0001:PRODUCT_PRICE_REQUIRED',
  'Standard itself cannot be (re)made purchasable until its price carries a provider plan id (V2-13b)');

-- create_plan_price versioning and refusals
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.create_plan_price('standard', 'flat_recurring', 179900, 1800, false, 'plan_SynthStd02', now() + interval '30 days', 'c9b00000-0000-4000-8000-000000000001')$$),
  'ok', 'a new Standard price version is created for a future date');
select is(
  (select pp.active_until = (select active_from from public.plan_prices where provider_plan_id = 'plan_SynthStd02')
     from public.plan_prices pp where pp.id = (select id from c9b_std)),
  true, 'the seeded Standard price closes exactly when the new version starts (grandfathered rows stay)');
select is((select plan_price_id from public.tenant_subscriptions where tenant_id = 'c9b00000-0000-4000-8000-00000000000f'),
  (select id from c9b_std), 'existing subscriptions keep their price row');
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.create_plan_price('standard', 'flat_recurring', 179900, 1800, false, null, now() + interval '10 days', 'c9b00000-0000-4000-8000-000000000001')$$),
  'error:P0001:PLAN_PRICE_INVALID', 'a version that does not start after every existing version is refused');
select is_empty(
  $$ select tpl || ' ' || pg_temp.do_as('postgres', null, null, format(tpl, quote_literal('c9b00000-0000-4000-8000-000000000001')), false)
       from unnest(array[
         $q$select platform.create_plan_price('standard', 'flat_recurring', 179900, 1800, true, null, now() + interval '60 days', %s)$q$,
         $q$select platform.create_plan_price('standard', 'metered', 179900, 1800, false, null, now() + interval '60 days', %s)$q$,
         $q$select platform.create_plan_price('standard_trial', 'flat_recurring', 179900, 1800, false, null, now() + interval '60 days', %s)$q$]) tpl
      where pg_temp.do_as('postgres', null, null, format(tpl, quote_literal('c9b00000-0000-4000-8000-000000000001')), false)
            <> 'error:P0001:PLAN_PRICE_INVALID' $$,
  'GST-inclusive, non-flat and trial-plan prices are refused (PLAN_PRICE_INVALID)');
select is_empty(
  $$ select tpl from unnest(array[
         $q$select platform.create_plan_price('standard', 'flat_recurring', 179900, 1800, false, null, now() - interval '1 day', %s)$q$,
         $q$select platform.create_plan_price('standard', 'flat_recurring', 0, 1800, false, null, now() + interval '60 days', %s)$q$,
         $q$select platform.create_plan_price('standard', 'flat_recurring', 179900, 10001, false, null, now() + interval '60 days', %s)$q$]) tpl
      where pg_temp.do_as('postgres', null, null, format(tpl, quote_literal('c9b00000-0000-4000-8000-000000000001')), false)
            <> 'error:P0001:INPUT_INVALID' $$,
  'a backdated start, a zero amount and a rate above 100 % are invalid input');

-- 5. extend_trial ------------------------------------------------------------------------------------------------------
create temp table c9b_trial_before on commit drop as
  select trial_end, access_ends_at, version from public.tenant_subscriptions where tenant_id = 'c9b00000-0000-4000-8000-00000000000a';
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.extend_trial('c9b00000-0000-4000-8000-00000000000a', interval '7 days', 'pilot clinic', 'c9b00000-0000-4000-8000-000000000002')$$),
  'ok', 'extend_trial runs as postgres with an admin p_actor');
select is(
  (select s.trial_end - b.trial_end from public.tenant_subscriptions s, c9b_trial_before b
    where s.tenant_id = 'c9b00000-0000-4000-8000-00000000000a'),
  interval '7 days', 'extend_trial moves trial_end by the interval');
select is(
  (select s.access_ends_at - s.trial_end from public.tenant_subscriptions s where s.tenant_id = 'c9b00000-0000-4000-8000-00000000000a'),
  interval '24 hours', 'access_ends_at = the new trial_end + the pending-charge buffer (not cancelling)');
select is(
  (select s.version - b.version from public.tenant_subscriptions s, c9b_trial_before b
    where s.tenant_id = 'c9b00000-0000-4000-8000-00000000000a'),
  1, 'extend_trial bumps the version once');
select is(
  (select count(*)::int || ':' || min(actor_id::text) || ':' || min(reason) || ':' || min(payload ->> 'channel')
     from public.subscription_events where tenant_id = 'c9b00000-0000-4000-8000-00000000000a' and type = 'trial.extended'),
  '1:c9b00000-0000-4000-8000-000000000002:pilot clinic:sql', 'extend_trial writes exactly one event, with the actor, reason and channel');
select is(
  (select count(*)::int || ':' || min(channel) || ':' || min(actor_id::text) from public.platform_audit_log
    where action = 'subscription.extend_trial' and target_tenant_id = 'c9b00000-0000-4000-8000-00000000000a'),
  '1:sql:c9b00000-0000-4000-8000-000000000002', 'extend_trial writes exactly one audit row');
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.extend_trial('c9b00000-0000-4000-8000-00000000000e', interval '3 days', 'pilot clinic', 'c9b00000-0000-4000-8000-000000000001')$$),
  'ok', 'extend_trial on a cancelling trial');
select is(
  (select access_ends_at = trial_end from public.tenant_subscriptions where tenant_id = 'c9b00000-0000-4000-8000-00000000000e'),
  true, 'a cancelling trial ends at trial_end with no buffer (nothing is pending)');
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.extend_trial('c9b00000-0000-4000-8000-000000000010', interval '10 days', 'pilot clinic', 'c9b00000-0000-4000-8000-000000000001')$$),
  'ok', 'extend_trial on a trial that already ran out');
select is(billing_internal.tenant_access_level('c9b00000-0000-4000-8000-000000000010', now()), 'full',
  'the clinic whose trial had run out has full access again');
select is_empty(
  $$ select tpl from (values
       ($q$select platform.extend_trial('c9b00000-0000-4000-8000-00000000000b', interval '1 day', 'x', %s)$q$, 'error:P0001:SUBSCRIPTION_STATE_INVALID'),
       ($q$select platform.extend_trial('c9b00000-0000-4000-8000-00000000000f', interval '1 day', 'x', %s)$q$, 'error:P0001:SUBSCRIPTION_STATE_INVALID'),
       ($q$select platform.extend_trial('c9b00000-0000-4000-8000-0000000000ff', interval '1 day', 'x', %s)$q$, 'error:P0002:SUBSCRIPTION_NOT_FOUND'),
       ($q$select platform.extend_trial('c9b00000-0000-4000-8000-00000000000a', interval '0', 'x', %s)$q$, 'error:P0001:INPUT_INVALID'),
       ($q$select platform.extend_trial('c9b00000-0000-4000-8000-00000000000a', interval '-1 day', 'x', %s)$q$, 'error:P0001:INPUT_INVALID'),
       ($q$select platform.extend_trial('c9b00000-0000-4000-8000-00000000000a', interval '91 days', 'x', %s)$q$, 'error:P0001:INPUT_INVALID'),
       ($q$select platform.extend_trial('c9b00000-0000-4000-8000-00000000000a', interval '1 day', '  ', %s)$q$, 'error:P0001:INPUT_INVALID')
     ) v(tpl, expected)
      where pg_temp.do_as('postgres', null, null, format(tpl, quote_literal('c9b00000-0000-4000-8000-000000000001')), false) <> expected $$,
  'extend_trial refuses an incomplete or active clinic, an unknown clinic, a non-positive or > 90-day interval and a blank reason');

-- set_comp (the plan's case: an expired clinic becomes full)
select is(billing_internal.tenant_access_level('c9b00000-0000-4000-8000-00000000000c', now()), 'full',
  'set_comp (section 3) made the expired clinic full');
select is((select status from public.tenant_subscriptions where tenant_id = 'c9b00000-0000-4000-8000-00000000000c'), 'expired',
  'its status stays expired (comp is a flag, not a state)');
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.set_comp('c9b00000-0000-4000-8000-00000000000c', null, 'pilot ended', 'c9b00000-0000-4000-8000-000000000001')$$),
  'ok', 'set_comp(null) clears the comp');
select is(billing_internal.tenant_access_level('c9b00000-0000-4000-8000-00000000000c', now()), 'locked',
  'the expired clinic is locked again once the comp is cleared');
select is(
  (select string_agg(type, ',' order by occurred_at, type) from public.subscription_events
    where tenant_id = 'c9b00000-0000-4000-8000-00000000000c' and type like 'comp.%'),
  'comp.cleared,comp.set', 'each comp change wrote one event');
select is_empty(
  $$ select tpl from (values
       ($q$select platform.set_comp('c9b00000-0000-4000-8000-00000000000d', now() + interval '1 day', 'x', %s)$q$, 'error:P0001:SUBSCRIPTION_STATE_INVALID'),
       ($q$select platform.set_comp('c9b00000-0000-4000-8000-00000000000c', now() - interval '1 day', 'x', %s)$q$, 'error:P0001:INPUT_INVALID'),
       ($q$select platform.set_comp('c9b00000-0000-4000-8000-00000000000c', now() + interval '6 years', 'x', %s)$q$, 'error:P0001:INPUT_INVALID'),
       ($q$select platform.set_comp('c9b00000-0000-4000-8000-0000000000ff', now() + interval '1 day', 'x', %s)$q$, 'error:P0002:SUBSCRIPTION_NOT_FOUND')
     ) v(tpl, expected)
      where pg_temp.do_as('postgres', null, null, format(tpl, quote_literal('c9b00000-0000-4000-8000-000000000001')), false) <> expected $$,
  'set_comp refuses a purged clinic, a past or > 5-year end, and an unknown clinic');

-- grant_override (an active Standard clinic: ai.scribe is off by default, PO-25)
select is(billing_internal.has_entitlement('c9b00000-0000-4000-8000-00000000000f', 'ai.scribe', now()), false,
  'control: an active Standard clinic has no ai.scribe');
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.grant_override('c9b00000-0000-4000-8000-00000000000f', 'ai.scribe', true, null, now() + interval '30 days', 'AI pilot', 'c9b00000-0000-4000-8000-000000000001')$$),
  'ok', 'grant_override ai.scribe');
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.grant_override('c9b00000-0000-4000-8000-00000000000f', 'ai.scribe.monthly_drafts', true, 1000, now() + interval '30 days', 'AI pilot', 'c9b00000-0000-4000-8000-000000000001')$$),
  'ok', 'grant_override ai.scribe.monthly_drafts 1000');
select is(pg_temp.do_as('postgres', null, null,
  $$select platform.grant_override('c9b00000-0000-4000-8000-00000000000f', 'ai.scribe.monthly_drafts', true, 1500, now() + interval '30 days', 'AI pilot, raised', 'c9b00000-0000-4000-8000-000000000001')$$),
  'ok', 'a second grant of the same key updates it');
select is(
  billing_internal.has_entitlement('c9b00000-0000-4000-8000-00000000000f', 'ai.scribe', now())::text || ':' ||
  billing_internal.entitlement_limit('c9b00000-0000-4000-8000-00000000000f', 'ai.scribe.monthly_drafts', now()),
  'true:1500', 'the clinic now has ai.scribe with the overriding limit');
select is(
  (select count(*)::int from public.tenant_entitlement_overrides where tenant_id = 'c9b00000-0000-4000-8000-00000000000f'),
  2, 'one override row per key');
select is(
  (select (payload -> 'before' ->> 'limit_value') || ':' || (payload -> 'after' ->> 'limit_value') from public.platform_audit_log
    where action = 'entitlement.grant_override' and payload ->> 'key' = 'ai.scribe.monthly_drafts'
      and target_tenant_id = 'c9b00000-0000-4000-8000-00000000000f' and payload -> 'before' <> 'null'::jsonb),
  '1000:1500', 'the re-grant''s audit row carries before and after');
select is(
  (select count(*)::int from public.subscription_events
    where tenant_id = 'c9b00000-0000-4000-8000-00000000000f' and type = 'entitlement.override_set'),
  3, 'each grant wrote one event');
select is_empty(
  $$ select tpl from (values
       ($q$select platform.grant_override('c9b00000-0000-4000-8000-00000000000f', 'ai.scribe', true, 5, null, 'x', %s)$q$, 'error:P0001:INPUT_INVALID'),
       ($q$select platform.grant_override('c9b00000-0000-4000-8000-00000000000f', 'ai.scribe.monthly_drafts', true, null, null, 'x', %s)$q$, 'error:P0001:INPUT_INVALID'),
       ($q$select platform.grant_override('c9b00000-0000-4000-8000-00000000000f', 'ai.scribe', true, null, now() - interval '1 day', 'x', %s)$q$, 'error:P0001:INPUT_INVALID'),
       ($q$select platform.grant_override('c9b00000-0000-4000-8000-00000000000f', 'ai.no_such_key', true, null, null, 'x', %s)$q$, 'error:P0001:ENTITLEMENT_KEY_UNKNOWN'),
       ($q$select platform.grant_override('c9b00000-0000-4000-8000-00000000000d', 'ai.scribe', true, null, null, 'x', %s)$q$, 'error:P0001:SUBSCRIPTION_STATE_INVALID')
     ) v(tpl, expected)
      where pg_temp.do_as('postgres', null, null, format(tpl, quote_literal('c9b00000-0000-4000-8000-000000000001')), false) <> expected $$,
  'grant_override refuses a limit on a boolean key, an enabled limit key without a limit, a past expiry, an unknown key and a purged clinic');

-- 6. Admin changes are audited; the trail is append-only for API roles --------------------------------------------------
select is(
  (select string_agg(action || ':' || coalesce(actor_id::text, '-'), ',' order by action, actor_id) from public.platform_audit_log
    where payload ->> 'user_id' = 'c9b00000-0000-4000-8000-000000000003'),
  'platform_admin.granted:c9b00000-0000-4000-8000-000000000001,platform_admin.updated:-',
  'granting and revoking an admin in SQL each wrote an audit row (actor = granted_by; a revocation names the session)');
select is(
  (select payload -> 'after' ->> 'revoked_at' is not null from public.platform_audit_log
    where payload ->> 'user_id' = 'c9b00000-0000-4000-8000-000000000003' and action = 'platform_admin.updated'),
  true, 'the revocation row carries the new revoked_at');
select is(pg_temp.do_as('postgres', null, null,
  $$insert into public.platform_audit_log (actor_id, channel, action) values (null, 'sql', 'subscription.set_comp')$$),
  'error:23514:new row for relation "platform_audit_log" violates check constraint "platform_audit_log_actor_known"',
  'an RPC audit row always names its admin');
select is_empty(
  $$ select r || ' ' || o from unnest(array['authenticated', 'service_role']) r
      cross join unnest(array[
        $q$insert into public.platform_audit_log (actor_id, channel, action) values ('c9b00000-0000-4000-8000-000000000001', 'ui', 'subscription.set_comp')$q$,
        $q$update public.platform_audit_log set action = 'subscription.forged'$q$,
        $q$delete from public.platform_audit_log$q$,
        $q$insert into public.platform_admins (user_id) values ('c9b00000-0000-4000-8000-000000000004')$q$,
        $q$update public.platform_admins set revoked_at = null$q$]) o
      where pg_temp.do_as(r, case when r = 'authenticated' then 'c9b00000-0000-4000-8000-000000000001'::uuid end, 'aal2', o, false)
            not like 'error:42501:permission denied%' $$,
  'neither an aal2 admin''s JWT nor the service role can write the audit trail or the admin list directly');

select * from finish();
rollback;
