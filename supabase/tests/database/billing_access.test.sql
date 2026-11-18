-- billing_access.test.sql — V2-05 plan 05-09a (SUB-01; SUBSCRIPTIONS_AND_PLANS.md §4, §6.1, §6.2, §11 "DB (time
-- travel)"; acceptance 8, function half; roadmap test "time-travel pgTAP for trial, grace, expiry and archive").
-- billing_internal.tenant_access_level(p_tenant, p_now) is called as postgres with p_now moved around the boundaries
-- (pgTAP's now() is frozen per transaction, research Pitfall 10, so time travel goes through p_now only):
--   incomplete → onboarding; trialing before trial_end, inside the pending-charge buffer, at and after access_ends_at;
--   a cancelled trial locks exactly at trial_end (no buffer); an active subscription cancelling locks at
--   current_period_end; past_due locks at least(grace_until, halted_at); grace and buffer 0; comp on incomplete and on
--   expired → full, an elapsed comp → locked, comp on purged → none; archived → locked; a stale or NULL access_ends_at
--   → locked; no row → NULL (never full).
-- billing_internal.start_trial (T1): the SUB §4 anchor (T0 10 Nov 2026 15:20 IST → trial_end 24 Nov 2026 10:00 IST),
-- access_ends_at = trial_end + pending_charge_buffer_hours (24, or 0), one event, version + 1; its refusals.
-- Synthetic data only; the file rolls back.
begin;
select plan(45);

-- Clinics (the tenants trigger gives each an `incomplete` row; each scenario then shapes its row) --------------------
insert into public.tenants (id, name)
select ('c09a0000-0000-4000-8000-0000000000' || lpad(to_hex(n), 2, '0'))::uuid, 'Synthetic Billing Clinic ' || n
  from generate_series(1, 20) n;

create temp table c09a_p (p timestamptz) on commit drop;
insert into c09a_p values ('2030-06-10 12:00:00+05:30');
create function pg_temp.t(n int) returns uuid language sql immutable as
  $$ select ('c09a0000-0000-4000-8000-0000000000' || lpad(to_hex(n), 2, '0'))::uuid $$;
create function pg_temp.lvl(n int, at timestamptz) returns text language sql stable as
  $$ select billing_internal.tenant_access_level(pg_temp.t(n), at) $$;
create function pg_temp.std_price() returns uuid language sql stable as
  $$ select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id where p.code = 'standard'
      order by pp.active_from limit 1 $$;

-- 1 incomplete --------------------------------------------------------------------------------------------------------
select is(pg_temp.lvl(1, (select p from c09a_p)), 'onboarding', 'incomplete → onboarding');

-- 2 trialing, not cancelling: trial_end T, access_ends_at T + 24 h ---------------------------------------------------
update public.tenant_subscriptions set status = 'trialing', plan_price_id = pg_temp.std_price(),
       trial_start = (select p from c09a_p) - interval '10 days', trial_end = (select p from c09a_p),
       access_ends_at = (select p from c09a_p) + interval '24 hours'
 where tenant_id = pg_temp.t(2);
select is(pg_temp.lvl(2, (select p from c09a_p) - interval '1 day'), 'full', 'trialing before trial_end → full');
select is(pg_temp.lvl(2, (select p from c09a_p) + interval '12 hours'), 'full', 'trialing inside the pending-charge buffer → full');
select is(pg_temp.lvl(2, (select p from c09a_p) + interval '24 hours' - interval '1 second'), 'full', 'trialing one second before access_ends_at → full');
select is(pg_temp.lvl(2, (select p from c09a_p) + interval '24 hours'), 'locked', 'trialing exactly at access_ends_at → locked');
select is(pg_temp.lvl(2, (select p from c09a_p) + interval '30 days'), 'locked', 'trialing long after access_ends_at (stale status, no job ran) → locked');

-- 3 trial cancelled: access_ends_at = trial_end (no buffer) ----------------------------------------------------------
update public.tenant_subscriptions set status = 'trialing', plan_price_id = pg_temp.std_price(),
       trial_start = (select p from c09a_p) - interval '10 days', trial_end = (select p from c09a_p),
       cancel_at_period_end = true, canceled_at = (select p from c09a_p) - interval '2 days', cancel_source = 'owner',
       access_ends_at = (select p from c09a_p)
 where tenant_id = pg_temp.t(3);
select is(pg_temp.lvl(3, (select p from c09a_p) - interval '1 second'), 'full', 'cancelled trial one second before trial_end → full');
select is(pg_temp.lvl(3, (select p from c09a_p)), 'locked', 'cancelled trial → locked exactly at trial_end (no buffer)');

-- 4 active, cancelling at period end ---------------------------------------------------------------------------------
update public.tenant_subscriptions set status = 'active', plan_price_id = pg_temp.std_price(),
       current_period_start = (select p from c09a_p) - interval '1 month', current_period_end = (select p from c09a_p),
       cancel_at_period_end = true, cancel_source = 'owner', access_ends_at = (select p from c09a_p)
 where tenant_id = pg_temp.t(4);
select is(pg_temp.lvl(4, (select p from c09a_p) - interval '1 second'), 'full', 'active and cancelling, before current_period_end → full');
select is(pg_temp.lvl(4, (select p from c09a_p)), 'locked', 'active and cancelling → locked at current_period_end');

-- 5 active, not cancelling: period end + buffer ----------------------------------------------------------------------
update public.tenant_subscriptions set status = 'active', plan_price_id = pg_temp.std_price(),
       current_period_start = (select p from c09a_p) - interval '1 month', current_period_end = (select p from c09a_p),
       access_ends_at = (select p from c09a_p) + interval '24 hours'
 where tenant_id = pg_temp.t(5);
select is(pg_temp.lvl(5, (select p from c09a_p) + interval '23 hours'), 'full', 'active, renewal debit in flight (inside the buffer) → full');
select is(pg_temp.lvl(5, (select p from c09a_p) + interval '24 hours'), 'locked', 'active past current_period_end + buffer with no renewal recorded → locked');

-- 6 past_due: grace first / halted first -----------------------------------------------------------------------------
update public.tenant_subscriptions set status = 'past_due', plan_price_id = pg_temp.std_price(),
       past_due_since = (select p from c09a_p) - interval '2 days', grace_until = (select p from c09a_p) + interval '2 days',
       access_ends_at = (select p from c09a_p) + interval '2 days'
 where tenant_id = pg_temp.t(6);
select is(pg_temp.lvl(6, (select p from c09a_p) + interval '1 day'), 'full', 'past_due inside grace → full');
select is(pg_temp.lvl(6, (select p from c09a_p) + interval '2 days'), 'locked', 'past_due → locked at grace_until');
update public.tenant_subscriptions set status = 'past_due', plan_price_id = pg_temp.std_price(),
       past_due_since = (select p from c09a_p) - interval '2 days', grace_until = (select p from c09a_p) + interval '5 days',
       halted_at = (select p from c09a_p), access_ends_at = least((select p from c09a_p) + interval '5 days', (select p from c09a_p))
 where tenant_id = pg_temp.t(7);
select is(pg_temp.lvl(7, (select p from c09a_p) - interval '1 second'), 'full', 'past_due before halted_at (grace later) → full');
select is(pg_temp.lvl(7, (select p from c09a_p)), 'locked', 'past_due → locked at halted_at when the provider halts before grace ends');

-- 7 grace 0: a failed debit locks at once ----------------------------------------------------------------------------
update public.tenant_subscriptions set status = 'past_due', plan_price_id = pg_temp.std_price(),
       past_due_since = (select p from c09a_p), grace_until = (select p from c09a_p), access_ends_at = (select p from c09a_p)
 where tenant_id = pg_temp.t(8);
select is(pg_temp.lvl(8, (select p from c09a_p)), 'locked', 'grace 0: past_due locks at the failed debit');

-- 8 comp ------------------------------------------------------------------------------------------------------------
update public.tenant_subscriptions set comp_until = (select p from c09a_p) + interval '1 year' where tenant_id = pg_temp.t(9);
select is(pg_temp.lvl(9, (select p from c09a_p)), 'full', 'comp on incomplete → full');
update public.tenant_subscriptions set status = 'expired', expired_at = (select p from c09a_p) - interval '3 days',
       access_ends_at = (select p from c09a_p) - interval '3 days', comp_until = (select p from c09a_p) + interval '1 day'
 where tenant_id = pg_temp.t(10);
select is(pg_temp.lvl(10, (select p from c09a_p)), 'full', 'comp on expired → full');
select is(pg_temp.lvl(10, (select p from c09a_p) + interval '1 day'), 'locked', 'an elapsed comp on expired → locked');
update public.tenant_subscriptions set status = 'purged', purged_at = (select p from c09a_p) - interval '1 day',
       comp_until = (select p from c09a_p) + interval '1 year'
 where tenant_id = pg_temp.t(11);
select is(pg_temp.lvl(11, (select p from c09a_p)), 'none', 'comp on purged → none (a tombstone stays dead)');

-- 9 expired, archived, NULL access_ends_at, no row -------------------------------------------------------------------
update public.tenant_subscriptions set status = 'expired', expired_at = (select p from c09a_p) - interval '1 day',
       access_ends_at = (select p from c09a_p) - interval '1 day'
 where tenant_id = pg_temp.t(12);
select is(pg_temp.lvl(12, (select p from c09a_p)), 'locked', 'expired → locked');
update public.tenant_subscriptions set status = 'archived', archived_at = (select p from c09a_p) - interval '1 day'
 where tenant_id = pg_temp.t(13);
select is(pg_temp.lvl(13, (select p from c09a_p)), 'locked', 'archived → locked');
update public.tenant_subscriptions set status = 'active', plan_price_id = pg_temp.std_price(), access_ends_at = null
 where tenant_id = pg_temp.t(14);
select is(pg_temp.lvl(14, (select p from c09a_p)), 'locked', 'active with a NULL access_ends_at → locked (fails closed)');
update public.tenant_subscriptions set status = 'purged', purged_at = (select p from c09a_p) where tenant_id = pg_temp.t(15);
select is(pg_temp.lvl(15, (select p from c09a_p)), 'none', 'purged → none');
delete from public.tenant_subscriptions where tenant_id = pg_temp.t(16);
select is(pg_temp.lvl(16, (select p from c09a_p)), null, 'no subscription row → NULL, never full');
select is(billing_internal.tenant_access_level('c09a0000-0000-4000-8000-00000000ffff', (select p from c09a_p)), null,
  'an unknown clinic → NULL');

-- 10 start_trial (T1): SUB §4 worked example -------------------------------------------------------------------------
select lives_ok($$select billing_internal.start_trial(pg_temp.t(17), pg_temp.std_price(), '2026-11-10 15:20:00+05:30')$$,
  'start_trial moves an incomplete clinic to trialing');
select is((select status from public.tenant_subscriptions where tenant_id = pg_temp.t(17)), 'trialing', 'status trialing');
select is((select trial_start from public.tenant_subscriptions where tenant_id = pg_temp.t(17)), '2026-11-10 15:20:00+05:30'::timestamptz,
  'trial_start = T0');
select is((select trial_end from public.tenant_subscriptions where tenant_id = pg_temp.t(17)), '2026-11-24 10:00:00+05:30'::timestamptz,
  'trial_end = the IST date of T0 + 14 days at 10:00 IST (SUB §4: 24 Nov 2026, 10:00)');
select is((select access_ends_at from public.tenant_subscriptions where tenant_id = pg_temp.t(17)), '2026-11-25 10:00:00+05:30'::timestamptz,
  'access_ends_at = trial_end + the 24 h pending-charge buffer');
select is((select (version, trial_consumed, plan_price_id = pg_temp.std_price())::text from public.tenant_subscriptions where tenant_id = pg_temp.t(17)),
  '(2,t,t)', 'version + 1, trial consumed, Standard price recorded');
select is((select count(*)::int from public.subscription_events
            where tenant_id = pg_temp.t(17) and type = 'trial.started' and from_status = 'incomplete' and to_status = 'trialing'
              and occurred_at = '2026-11-10 15:20:00+05:30'), 1, 'exactly one trial.started event at T0');
select is(pg_temp.lvl(17, '2026-11-25 09:59:59+05:30'), 'full', 'the started trial is full until access_ends_at');
select is(pg_temp.lvl(17, '2026-11-25 10:00:00+05:30'), 'locked', 'and locked from access_ends_at (no charge recorded)');

-- buffer 0: access_ends_at = trial_end
update public.platform_settings set pending_charge_buffer_hours = 0 where id;
select lives_ok($$select billing_internal.start_trial(pg_temp.t(18), pg_temp.std_price(), '2026-11-10 23:59:00+05:30')$$,
  'start_trial with the buffer set to 0');
select is((select access_ends_at = trial_end and trial_end = '2026-11-24 10:00:00+05:30'::timestamptz
             from public.tenant_subscriptions where tenant_id = pg_temp.t(18)), true,
  'buffer 0: access_ends_at = trial_end (late-evening signup still anchors on the IST date)');
select is(pg_temp.lvl(18, '2026-11-24 10:00:00+05:30'), 'locked', 'buffer 0: locked exactly at trial_end');
update public.platform_settings set pending_charge_buffer_hours = 24 where id;

-- refusals
select throws_ok($$select billing_internal.start_trial(pg_temp.t(17), pg_temp.std_price(), '2026-11-11 10:00:00+05:30')$$,
  'P0001', 'SUBSCRIPTION_STATE_INVALID', 'a clinic that is not incomplete cannot start a trial');
update public.tenant_subscriptions set trial_consumed = true where tenant_id = pg_temp.t(19);
select throws_ok($$select billing_internal.start_trial(pg_temp.t(19), pg_temp.std_price(), '2026-11-11 10:00:00+05:30')$$,
  'P0001', 'TRIAL_ALREADY_CONSUMED', 'one trial per clinic');
select throws_ok($$select billing_internal.start_trial(pg_temp.t(20), pg_temp.std_price(), '2025-06-01 10:00:00+05:30')$$,
  'P0001', 'PLAN_PRICE_INVALID', 'a price not yet active at p_now is refused');
select throws_ok($$select billing_internal.start_trial(pg_temp.t(20), gen_random_uuid(), '2026-11-11 10:00:00+05:30')$$,
  'P0001', 'PLAN_PRICE_INVALID', 'an unknown price is refused');
select throws_ok($$select billing_internal.start_trial('c09a0000-0000-4000-8000-00000000ffff', pg_temp.std_price(), '2026-11-11 10:00:00+05:30')$$,
  'P0002', 'SUBSCRIPTION_NOT_FOUND', 'an unknown clinic is not found');
select is((select status from public.tenant_subscriptions where tenant_id = pg_temp.t(20)), 'incomplete',
  'a refused start_trial changes nothing');

select * from finish();
rollback;
