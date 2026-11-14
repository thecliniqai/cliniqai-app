-- subscription_invariant.test.sql — V2-05 plan 05-09a (SUB-01; ruling R-24; roadmap V2-05 note "from V2-05 onward
-- create_clinic_with_owner creates incomplete tenants, so seeds must set a subscription row").
-- One mechanism, the AFTER INSERT trigger `tenants_create_subscription`, gives every clinic exactly one `incomplete`
-- tenant_subscriptions row, whoever creates it:
--   - a service-role insert into tenants; a postgres insert (migrations, seeds); `create_clinic_with_owner` as a
--     signed-in user (onboarding): each → exactly one row, status incomplete, access level onboarding;
--   - a second row for the same clinic is impossible (PK), and a pre-existing row is left untouched;
--   - every clinic in the database has its row (the 000082 backfill);
--   - deleting a clinic cascades to its subscription and events (teardown and the future purge depend on it).
-- Synthetic data only; the file rolls back.
begin;
select plan(14);

insert into auth.users (id, email) values ('c09e0000-0000-4000-8000-000000000101', 'c09e-founder@example.test');

-- The trigger itself ---------------------------------------------------------------------------------------------------
select is(
  (select row(t.tgenabled, (t.tgtype & 1) = 1, (t.tgtype & 2) = 0, (t.tgtype & 4) = 4, p.prosecdef,
              coalesce('search_path=""' = any(p.proconfig), false))::text
     from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.tenants'::regclass and t.tgname = 'tenants_create_subscription'),
  '(O,t,t,t,t,t)', 'tenants_create_subscription: enabled, FOR EACH ROW, AFTER INSERT, SECURITY DEFINER, search_path ''''');

-- A service-role insert ------------------------------------------------------------------------------------------------
set local role service_role;
insert into public.tenants (id, name) values ('c09e0000-0000-4000-8000-00000000000a', 'Synthetic Invariant Clinic A');
reset role;
select is((select count(*)::int from public.tenant_subscriptions where tenant_id = 'c09e0000-0000-4000-8000-00000000000a'), 1,
  'a service-role tenants insert yields exactly one subscription row');
select is((select row(status, plan_price_id is null, comp_until is null, trial_consumed, version)::text
             from public.tenant_subscriptions where tenant_id = 'c09e0000-0000-4000-8000-00000000000a'),
  '(incomplete,t,t,f,1)', 'and it is incomplete, with no price, comp or trial');
select is(billing_internal.tenant_access_level('c09e0000-0000-4000-8000-00000000000a', now()), 'onboarding',
  'so the new clinic is onboarding, never full');

-- A postgres insert (migrations, seeds) --------------------------------------------------------------------------------
insert into public.tenants (id, name) values ('c09e0000-0000-4000-8000-00000000000b', 'Synthetic Invariant Clinic B');
select is((select count(*)::int from public.tenant_subscriptions where tenant_id = 'c09e0000-0000-4000-8000-00000000000b' and status = 'incomplete'), 1,
  'a postgres tenants insert yields exactly one incomplete row');

-- create_clinic_with_owner (onboarding, signed in) ---------------------------------------------------------------------
create temp table c09e_created (tenant_id uuid) on commit drop;
set local role authenticated;
do $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c09e0000-0000-4000-8000-000000000101', 'role', 'authenticated')::text, true);
  perform set_config('c09e.created', public.create_clinic_with_owner('Synthetic Onboarding Clinic')::text, true);
  perform set_config('request.jwt.claims', '', true);
end
$$;
reset role;
insert into c09e_created values (current_setting('c09e.created')::uuid);
select is((select count(*)::int from public.tenant_subscriptions s join c09e_created c on c.tenant_id = s.tenant_id), 1,
  'create_clinic_with_owner yields exactly one subscription row');
select is((select s.status from public.tenant_subscriptions s join c09e_created c on c.tenant_id = s.tenant_id), 'incomplete',
  'and the new clinic starts incomplete (R-24; roadmap V2-05 note)');
select is((select count(*)::int from public.memberships m join c09e_created c on c.tenant_id = m.tenant_id
            where m.user_id = 'c09e0000-0000-4000-8000-000000000101' and m.role = 'owner'), 1,
  'create_clinic_with_owner is otherwise unchanged: the caller is the owner');

-- Exactly one -----------------------------------------------------------------------------------------------------------
select throws_ok($$insert into public.tenant_subscriptions (tenant_id, status) values ('c09e0000-0000-4000-8000-00000000000a', 'trialing')$$,
  '23505', null, 'a second subscription row for a clinic is impossible (PK tenant_id)');
update public.tenant_subscriptions set status = 'active', version = 7 where tenant_id = 'c09e0000-0000-4000-8000-00000000000b';
select is(array[has_function_privilege('authenticated', 'private.tenants_create_subscription()', 'EXECUTE'),
                 has_function_privilege('service_role', 'private.tenants_create_subscription()', 'EXECUTE')],
  array[false, false], 'the trigger function is executable by no API role (it runs only as the trigger)');
insert into public.tenant_subscriptions (tenant_id, status) values ('c09e0000-0000-4000-8000-00000000000b', 'incomplete')
  on conflict (tenant_id) do nothing;
select is((select row(status, version)::text from public.tenant_subscriptions where tenant_id = 'c09e0000-0000-4000-8000-00000000000b'),
  '(active,7)', 'the trigger''s ON CONFLICT DO NOTHING never resets an existing row');

-- Backfill: every clinic has its row ------------------------------------------------------------------------------------
select is_empty($$ select t.id from public.tenants t where not exists (select 1 from public.tenant_subscriptions s where s.tenant_id = t.id) $$,
  'every clinic in the database has a subscription row (000082 backfill + trigger)');

-- Cascade --------------------------------------------------------------------------------------------------------------
insert into public.subscription_events (tenant_id, type, actor_type) values ('c09e0000-0000-4000-8000-00000000000a', 'synthetic.probe', 'system');
delete from public.tenants where id = 'c09e0000-0000-4000-8000-00000000000a';
select is((select count(*)::int from public.tenant_subscriptions where tenant_id = 'c09e0000-0000-4000-8000-00000000000a'), 0,
  'deleting a clinic removes its subscription row (cascade)');
select is((select count(*)::int from public.subscription_events where tenant_id = 'c09e0000-0000-4000-8000-00000000000a'), 0,
  'and its events (the append-only grants do not block the owner-run cascade, Pitfall 5)');

select * from finish();
rollback;
