-- billing_entitlements.test.sql — V2-05 plan 05-09a (SUB-01, AI-18; SUBSCRIPTIONS_AND_PLANS.md §7.2 resolution order,
-- §7.3, §11 "Entitlements"; PO-21, PO-25; acceptance 13, entitlement half; research Pitfall 8).
-- billing_internal.has_entitlement / entitlement_limit, called as postgres with p_now:
--   trialing (start_trial on Standard) → ai.scribe on with a 1,500-draft limit, Smart Assist on, the deferred AI keys off;
--   active Standard → ai.scribe off and 0 drafts (PO-25 default), Smart Assist on;
--   an override grants its own limit and stops at expires_at; an override can switch a key off;
--   a locked or onboarding clinic has no key at all, override or not; a comped clinic without a price has no plan keys
--   (Pitfall 8) and gets them once the price is set; an unknown key is off.
-- public.my_entitlements(p_tenant): the caller's own clinic only (a member of B gets no rows for A; anon cannot call).
-- Synthetic data only; the file rolls back.
begin;
select plan(30);

insert into auth.users (id, email) values
  ('c09b0000-0000-4000-8000-000000000101', 'c09b-owner-a@example.test'),
  ('c09b0000-0000-4000-8000-000000000201', 'c09b-owner-b@example.test');
insert into public.tenants (id, name)
select ('c09b0000-0000-4000-8000-0000000000' || lpad(to_hex(n), 2, '0'))::uuid, 'Synthetic Entitlement Clinic ' || n
  from generate_series(1, 8) n;
insert into public.memberships (user_id, tenant_id, role) values
  ('c09b0000-0000-4000-8000-000000000101', 'c09b0000-0000-4000-8000-000000000001', 'owner'),
  ('c09b0000-0000-4000-8000-000000000201', 'c09b0000-0000-4000-8000-000000000002', 'owner');

create function pg_temp.t(n int) returns uuid language sql immutable as
  $$ select ('c09b0000-0000-4000-8000-0000000000' || lpad(to_hex(n), 2, '0'))::uuid $$;
create function pg_temp.std_price() returns uuid language sql stable as
  $$ select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id where p.code = 'standard'
      order by pp.active_from limit 1 $$;
create function pg_temp.has(n int, k text, at timestamptz) returns boolean language sql stable as
  $$ select billing_internal.has_entitlement(pg_temp.t(n), k, at) $$;
create function pg_temp.lim(n int, k text, at timestamptz) returns bigint language sql stable as
  $$ select billing_internal.entitlement_limit(pg_temp.t(n), k, at) $$;
-- The value p_sql returns as the signed-in user p_user (anon when null); 'denied:<msg>' on 42501. Always rolled back.
create function pg_temp.val_as(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  begin
    perform set_config('request.jwt.claims',
      case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
    perform set_config('request.headers', '', true);
    if p_user is null then set local role anon; else set local role authenticated; end if;
    execute p_sql into v_out;
    raise exception 'c09b sentinel' using errcode = 'P0S09';
  exception
    when sqlstate 'P0S09' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

-- Clinic 1: trialing on Standard from 2030-06-01 (trial plan entitlements) -------------------------------------------
do $$ begin perform billing_internal.start_trial(pg_temp.t(1), pg_temp.std_price(), '2030-06-01 09:00:00+05:30'); end $$;
select is(pg_temp.has(1, 'ai.scribe', '2030-06-05 12:00:00+05:30'), true, 'trialing: ai.scribe on (PO-21 Preview)');
select is(pg_temp.lim(1, 'ai.scribe.monthly_drafts', '2030-06-05 12:00:00+05:30'), 1500::bigint,
  'trialing: ai.scribe.monthly_drafts limit 1,500 for the trial (PO-21)');
select is(pg_temp.has(1, 'assist.terminology', '2030-06-05 12:00:00+05:30'), true, 'trialing: Smart Assist on');
select is(pg_temp.has(1, 'core.*', '2030-06-05 12:00:00+05:30'), true, 'trialing: core on');
select is(pg_temp.has(1, 'ai.operations_copilot', '2030-06-05 12:00:00+05:30'), false, 'trialing: deferred AI keys stay off');
select is(pg_temp.has(1, 'ai.scribe', '2030-06-16 10:00:00+05:30'), false,
  'the trial''s AI keys stop with access (after access_ends_at the clinic is locked)');
select is(pg_temp.lim(1, 'ai.scribe.monthly_drafts', '2030-06-16 10:00:00+05:30'), 0::bigint, 'and the limit is 0 once locked');

-- Clinic 2: active on Standard (base plan entitlements) --------------------------------------------------------------
update public.tenant_subscriptions set status = 'active', plan_price_id = pg_temp.std_price(),
       current_period_start = '2030-06-01 10:00:00+05:30', current_period_end = '2030-07-01 10:00:00+05:30',
       access_ends_at = '2030-07-02 10:00:00+05:30'
 where tenant_id = pg_temp.t(2);
select is(pg_temp.has(2, 'ai.scribe', '2030-06-10 12:00:00+05:30'), false, 'active Standard: ai.scribe off (PO-25 default)');
select is(pg_temp.lim(2, 'ai.scribe.monthly_drafts', '2030-06-10 12:00:00+05:30'), 0::bigint, 'active Standard: 0 drafts');
select is(pg_temp.has(2, 'assist.allergy_check', '2030-06-10 12:00:00+05:30'), true, 'active Standard: Smart Assist on');
select is(pg_temp.has(2, 'messaging.monthly_quota', '2030-06-10 12:00:00+05:30'), true, 'active Standard: messaging quota key on');
select is(pg_temp.lim(2, 'messaging.monthly_quota', '2030-06-10 12:00:00+05:30'), 0::bigint,
  'the messaging quota number is unset until go-live (SUB-D2): read as 0');
select is(pg_temp.has(2, 'no.such_key', '2030-06-10 12:00:00+05:30'), false, 'an unknown key is off');

-- Overrides on clinic 2 ----------------------------------------------------------------------------------------------
insert into public.tenant_entitlement_overrides (tenant_id, key, enabled, limit_value, expires_at, reason) values
  (pg_temp.t(2), 'ai.scribe', true, null, '2030-06-20 00:00:00+05:30', 'Synthetic AI pilot'),
  (pg_temp.t(2), 'ai.scribe.monthly_drafts', true, 200, '2030-06-20 00:00:00+05:30', 'Synthetic AI pilot'),
  (pg_temp.t(2), 'assist.terminology', false, null, null, 'Synthetic defect switch-off');
select is(pg_temp.has(2, 'ai.scribe', '2030-06-10 12:00:00+05:30'), true, 'an override grants ai.scribe to an active Standard clinic');
select is(pg_temp.lim(2, 'ai.scribe.monthly_drafts', '2030-06-10 12:00:00+05:30'), 200::bigint, 'with its own limit');
select is(pg_temp.has(2, 'ai.scribe', '2030-06-20 00:00:00+05:30'), false, 'the override stops at expires_at');
select is(pg_temp.lim(2, 'ai.scribe.monthly_drafts', '2030-06-20 00:00:00+05:30'), 0::bigint, 'and its limit with it (back to the plan''s 0)');
select is(pg_temp.has(2, 'assist.terminology', '2030-06-10 12:00:00+05:30'), false, 'an override can switch a plan key off');
select is(pg_temp.has(2, 'assist.terminology', '2030-07-02 10:00:00+05:30'), false,
  'at access_ends_at the clinic is locked: no key even with overrides');

-- Clinic 3: expired (locked) with an override ------------------------------------------------------------------------
update public.tenant_subscriptions set status = 'expired', plan_price_id = pg_temp.std_price(),
       expired_at = '2030-06-01 10:00:00+05:30', access_ends_at = '2030-06-01 10:00:00+05:30'
 where tenant_id = pg_temp.t(3);
insert into public.tenant_entitlement_overrides (tenant_id, key, enabled, limit_value, reason)
values (pg_temp.t(3), 'ai.scribe', true, 1500, 'Synthetic override on a locked clinic');
select is_empty($$ select key from public.entitlement_keys where billing_internal.has_entitlement(pg_temp.t(3), key, '2030-06-10 12:00:00+05:30') $$,
  'a locked clinic has no entitlement at all, override or not');
select is((select max(billing_internal.entitlement_limit(pg_temp.t(3), key, '2030-06-10 12:00:00+05:30')) from public.entitlement_keys), 0::bigint,
  'and every limit is 0');

-- Clinic 4: incomplete (onboarding) ----------------------------------------------------------------------------------
select is_empty($$ select key from public.entitlement_keys where billing_internal.has_entitlement(pg_temp.t(4), key, '2030-06-10 12:00:00+05:30') $$,
  'an onboarding clinic has no entitlement');

-- Clinic 5: comp without a price (Pitfall 8), then with the Standard price ------------------------------------------
update public.tenant_subscriptions set comp_until = '2031-06-01 00:00:00+05:30' where tenant_id = pg_temp.t(5);
select is(billing_internal.tenant_access_level(pg_temp.t(5), '2030-06-10 12:00:00+05:30'), 'full', 'comp on incomplete is full access');
select is(pg_temp.has(5, 'assist.terminology', '2030-06-10 12:00:00+05:30'), false,
  'but a comp without plan_price_id has no plan keys (research Pitfall 8: seeds must set the price)');
update public.tenant_subscriptions set plan_price_id = pg_temp.std_price() where tenant_id = pg_temp.t(5);
select is(pg_temp.has(5, 'assist.terminology', '2030-06-10 12:00:00+05:30'), true, 'a comp with the Standard price has the Standard keys');
select is(pg_temp.has(5, 'ai.scribe', '2030-06-10 12:00:00+05:30'), false, 'and not the trial''s AI Preview (status is not trialing)');

-- my_entitlements: the caller's own clinic only ----------------------------------------------------------------------
update public.tenant_subscriptions set status = 'trialing', plan_price_id = pg_temp.std_price(),
       trial_start = now() - interval '1 day', trial_end = now() + interval '13 days', access_ends_at = now() + interval '14 days'
 where tenant_id = pg_temp.t(1);
select is(pg_temp.val_as('c09b0000-0000-4000-8000-000000000101',
            $$select enabled::text || ':' || limit_value from public.my_entitlements('c09b0000-0000-4000-8000-000000000001') where key = 'ai.scribe.monthly_drafts'$$),
  'true:1500', 'my_entitlements: the owner of a trialing clinic sees ai.scribe.monthly_drafts 1500');
select is(pg_temp.val_as('c09b0000-0000-4000-8000-000000000101',
            $$select count(*)::text from public.my_entitlements('c09b0000-0000-4000-8000-000000000001')$$),
  (select count(*)::text from public.entitlement_keys), 'my_entitlements: one row per entitlement key');
select is(pg_temp.val_as('c09b0000-0000-4000-8000-000000000201',
            $$select count(*)::text from public.my_entitlements('c09b0000-0000-4000-8000-000000000001')$$),
  '0', 'my_entitlements: a member of another clinic gets no rows');
select matches(pg_temp.val_as(null, $$select count(*)::text from public.my_entitlements('c09b0000-0000-4000-8000-000000000001')$$),
  '^denied:', 'my_entitlements: anon cannot call it');

select * from finish();
rollback;
