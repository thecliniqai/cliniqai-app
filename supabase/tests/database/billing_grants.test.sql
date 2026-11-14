-- billing_grants.test.sql — V2-05 plan 05-09a (SUB-01; SUBSCRIPTIONS_AND_PLANS.md §6.2 "Exposure rules", §11 "DB
-- (security)"; AI_STRATEGY.md §4.6 write protection; research Pitfall 6; acceptance 9; threats T-05-24, T-05-25).
-- Catalogue loops, not hand lists, so a function or table added later is covered automatically:
--   1. no function in billing_internal is executable by authenticated or anon (acceptance 9), and neither role has
--      USAGE on the schema; service_role has; every function there pins search_path '';
--   2. platform: USAGE for authenticated and service_role, never anon;
--   3. no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER for anon or authenticated on any gating table; SELECT only
--      where the matrix says (catalogue + the clinic's own subscription and events), never for anon;
--   4. subscription_events is append-only by grants, also for the service role;
--   5. the caller-bound wrappers: authenticated only; a member of A asking my_tenant_access(B) gets NULL, its own clinic
--      its level, anon is refused; tenant_access_for_system is service_role only; a direct call into billing_internal
--      as authenticated fails with 42501.
-- Synthetic data only; the file rolls back.
begin;
select plan(24);

-- 1. -----------------------------------------------------------------------------------------------------------------
select cmp_ok((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'billing_internal'),
  '>=', 5, 'the loop sees the billing_internal functions (sanity)');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'billing_internal' and has_function_privilege('authenticated', p.oid, 'EXECUTE') $$,
  'authenticated cannot execute any billing_internal function (acceptance 9)');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'billing_internal' and has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'anon cannot execute any billing_internal function');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'billing_internal' and has_function_privilege('public', p.oid, 'EXECUTE') $$,
  'PUBLIC holds EXECUTE on no billing_internal function');
select is(
  array[has_schema_privilege('authenticated', 'billing_internal', 'USAGE'), has_schema_privilege('anon', 'billing_internal', 'USAGE'),
        has_schema_privilege('service_role', 'billing_internal', 'USAGE')],
  array[false, false, true], 'billing_internal: USAGE for service_role only');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('billing_internal', 'platform')
        and not coalesce('search_path=""' = any(p.proconfig), false) $$,
  'every billing_internal / platform function pins search_path ''''');
select is(
  (select p.prosecdef from pg_proc p where p.oid = 'billing_internal.tenant_access_level(uuid, timestamptz)'::regprocedure),
  true, 'tenant_access_level is SECURITY DEFINER (SUB §6.2)');

-- 2. -----------------------------------------------------------------------------------------------------------------
select is(
  array[has_schema_privilege('authenticated', 'platform', 'USAGE'), has_schema_privilege('anon', 'platform', 'USAGE'),
        has_schema_privilege('service_role', 'platform', 'USAGE')],
  array[true, false, true], 'platform: USAGE for authenticated and service_role, never anon');

-- 3. -----------------------------------------------------------------------------------------------------------------
create temp table c09d_gating (t text primary key, authenticated_select boolean not null) on commit drop;
insert into c09d_gating values
  ('public.plans', true), ('public.plan_prices', true), ('public.entitlement_keys', true), ('public.plan_entitlements', true),
  ('public.tenant_entitlement_overrides', false), ('public.tenant_subscriptions', true), ('public.subscription_events', true),
  ('public.platform_settings', false);
select is_empty(
  $$ select g.t || ' ' || r.rolname || ' ' || pr.priv
       from c09d_gating g
      cross join (values ('anon'), ('authenticated')) r(rolname)
      cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) pr(priv)
      where case when pr.priv in ('INSERT', 'UPDATE', 'REFERENCES') then has_any_column_privilege(r.rolname, g.t, pr.priv)
                 else has_table_privilege(r.rolname, g.t, pr.priv) end $$,
  'no write privilege for anon or authenticated on any gating table (AI §4.6)');
select is_empty(
  $$ select t from c09d_gating where has_any_column_privilege('anon', t, 'SELECT') $$,
  'anon reads no gating table');
select set_eq(
  $$ select t from c09d_gating where has_any_column_privilege('authenticated', t, 'SELECT') $$,
  $$ select t from c09d_gating where authenticated_select $$,
  'authenticated reads exactly the catalogue and the clinic''s own subscription and events (overrides and settings: nothing)');
select is_empty(
  $$ select t from c09d_gating where not (select c.relrowsecurity from pg_class c where c.oid = t::regclass) $$,
  'RLS is on for every gating table');

-- 4. -----------------------------------------------------------------------------------------------------------------
select is(
  array[has_table_privilege('service_role', 'public.subscription_events', 'INSERT'),
        has_table_privilege('service_role', 'public.subscription_events', 'SELECT'),
        has_table_privilege('service_role', 'public.subscription_events', 'UPDATE'),
        has_table_privilege('service_role', 'public.subscription_events', 'DELETE'),
        has_table_privilege('service_role', 'public.subscription_events', 'TRUNCATE')],
  array[true, true, false, false, false], 'subscription_events is append-only by grants, also for the service role (Pitfall 5)');
select is_empty(
  $$ select t.tgname from pg_trigger t where t.tgrelid = 'public.subscription_events'::regclass and not t.tgisinternal $$,
  'and has no trigger (a delete trigger would break the tenant cascade, Pitfall 5)');

-- 5. -----------------------------------------------------------------------------------------------------------------
select is(
  array[has_function_privilege('authenticated', 'public.my_tenant_access(uuid)', 'EXECUTE'),
        has_function_privilege('anon', 'public.my_tenant_access(uuid)', 'EXECUTE'),
        has_function_privilege('authenticated', 'public.my_entitlements(uuid)', 'EXECUTE'),
        has_function_privilege('anon', 'public.my_entitlements(uuid)', 'EXECUTE')],
  array[true, false, true, false], 'the caller-bound wrappers: authenticated only');
select is(
  array[has_function_privilege('service_role', 'public.tenant_access_for_system(uuid)', 'EXECUTE'),
        has_function_privilege('authenticated', 'public.tenant_access_for_system(uuid)', 'EXECUTE'),
        has_function_privilege('anon', 'public.tenant_access_for_system(uuid)', 'EXECUTE')],
  array[true, false, false], 'tenant_access_for_system: service_role only (R-28)');

insert into auth.users (id, email) values
  ('c09d0000-0000-4000-8000-000000000101', 'c09d-owner-a@example.test'),
  ('c09d0000-0000-4000-8000-000000000201', 'c09d-owner-b@example.test'),
  ('c09d0000-0000-4000-8000-000000000301', 'c09d-dual@example.test');
insert into public.tenants (id, name) values
  ('c09d0000-0000-4000-8000-00000000000a', 'Synthetic Grants Clinic A'),
  ('c09d0000-0000-4000-8000-00000000000b', 'Synthetic Grants Clinic B');
insert into public.memberships (user_id, tenant_id, role) values
  ('c09d0000-0000-4000-8000-000000000101', 'c09d0000-0000-4000-8000-00000000000a', 'owner'),
  ('c09d0000-0000-4000-8000-000000000201', 'c09d0000-0000-4000-8000-00000000000b', 'owner'),
  ('c09d0000-0000-4000-8000-000000000301', 'c09d0000-0000-4000-8000-00000000000a', 'doctor'),
  ('c09d0000-0000-4000-8000-000000000301', 'c09d0000-0000-4000-8000-00000000000b', 'receptionist');
update public.tenant_subscriptions set status = 'trialing', trial_start = now() - interval '1 day',
       trial_end = now() + interval '13 days', access_ends_at = now() + interval '14 days'
 where tenant_id = 'c09d0000-0000-4000-8000-00000000000b';

create function pg_temp.val_as(p_user uuid, p_header uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  begin
    perform set_config('request.jwt.claims',
      case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
    perform set_config('request.headers',
      case when p_header is null then '' else json_build_object('x-clinicos-tenant', p_header)::text end, true);
    if p_user is null then set local role anon; else set local role authenticated; end if;
    execute p_sql into v_out;
    v_out := coalesce(v_out, 'null');
    raise exception 'c09d sentinel' using errcode = 'P0S0D';
  exception
    when sqlstate 'P0S0D' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

select is(pg_temp.val_as('c09d0000-0000-4000-8000-000000000101', null, $$select public.my_tenant_access('c09d0000-0000-4000-8000-00000000000b')$$),
  'null', 'my_tenant_access(B) called by a member of A → NULL (SUB §11 cross-tenant)');
select is(pg_temp.val_as('c09d0000-0000-4000-8000-000000000101', null, $$select public.my_tenant_access('c09d0000-0000-4000-8000-00000000000a')$$),
  'onboarding', 'my_tenant_access(A) for its owner → its level (incomplete → onboarding)');
select is(pg_temp.val_as('c09d0000-0000-4000-8000-000000000201', null, $$select public.my_tenant_access('c09d0000-0000-4000-8000-00000000000b')$$),
  'full', 'my_tenant_access(B) for its owner → full (trialing)');
select is(pg_temp.val_as('c09d0000-0000-4000-8000-000000000301', 'c09d0000-0000-4000-8000-00000000000a',
            $$select public.my_tenant_access('c09d0000-0000-4000-8000-00000000000b')$$),
  'full', 'a member of both clinics reads either clinic''s level (member-bound, like the clinic switcher, R-40)');
select is(pg_temp.val_as('c09d0000-0000-4000-8000-000000000101', null, $$select public.my_tenant_access('c09d0000-0000-4000-8000-00000000ffff')$$),
  'null', 'an unknown clinic → NULL');
select matches(pg_temp.val_as(null, null, $$select public.my_tenant_access('c09d0000-0000-4000-8000-00000000000a')$$),
  '^denied:', 'anon cannot call my_tenant_access');
select matches(pg_temp.val_as('c09d0000-0000-4000-8000-000000000101', null,
            $$select billing_internal.tenant_access_level('c09d0000-0000-4000-8000-00000000000a', now() + interval '100 years')$$),
  '^denied:', 'a signed-in user cannot call billing_internal.tenant_access_level directly (no USAGE, no EXECUTE)');
select matches(pg_temp.val_as('c09d0000-0000-4000-8000-000000000101', null,
            $$select public.tenant_access_for_system('c09d0000-0000-4000-8000-00000000000a')$$),
  '^denied:', 'a signed-in user cannot call tenant_access_for_system');

select * from finish();
rollback;
