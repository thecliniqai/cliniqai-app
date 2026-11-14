-- billing_catalogue.test.sql — V2-05 plan 05-09a (SUB-01 seeds, AI-18; SUBSCRIPTIONS_AND_PLANS.md §4, §7.1, §7.3,
-- §8.1; AI_STRATEGY.md §6.2; PO-20, PO-21, PO-25; acceptance 12 and 13 "no product purchasable except Standard").
--   1. the Standard price: base 149900 paise at 1800 bp, GST-exclusive → generated charge 176882 (acceptance 12); the
--      generated column rounds half-up per price; an inclusive price is refused (the expression is exclusive-only);
--   2. products: only `standard` is purchasable; `ai_assist` and `ai_voice_receptionist` are `coming_soon` addons with
--      no active price carrying a provider plan id; `standard_trial` is hidden and is Standard's trial plan;
--   3. entitlement keys (AI §6.2) and the plan grid: Standard has Smart Assist and core, AI off with 0 drafts (PO-25);
--      the trial plan adds ai.scribe with 1,500 drafts (PO-21); the deferred AI keys are off on every plan;
--   4. platform_settings: one row, SUB §4 defaults, every AI feature flag present;
--   5. what a signed-in user reads: plans/prices/entitlements of non-hidden plans only; anon nothing.
-- Synthetic data only; the file rolls back.
begin;
select plan(30);

-- 1. -----------------------------------------------------------------------------------------------------------------
select is(
  (select row(pp.base_amount_paise, pp.tax_rate_bp, pp.tax_inclusive, pp.charge_amount_paise)::text
     from public.plan_prices pp join public.plans p on p.id = pp.plan_id where p.code = 'standard'),
  '(149900,1800,f,176882)', 'Standard: base 149900 paise, 1800 bp, GST-exclusive → charge 176882 paise (acceptance 12)');
select is(
  (select row(pp.billing_model, pp.currency, pp."interval", pp.interval_count, pp.provider, pp.provider_plan_id is null)::text
     from public.plan_prices pp join public.plans p on p.id = pp.plan_id where p.code = 'standard'),
  '(flat_recurring,INR,month,1,razorpay,t)', 'Standard: flat monthly INR price, Razorpay, provider plan id set later (V2-13b)');
select is((select count(*)::int from public.plan_prices pp join public.plans p on p.id = pp.plan_id where p.code = 'standard'), 1,
  'exactly one Standard price is seeded');
insert into public.plans (id, code, kind, category, name) values ('c09c0000-0000-4000-8000-000000000001', 'c09c_probe', 'addon', 'core', 'Synthetic probe');
insert into public.plan_prices (id, plan_id, billing_model, base_amount_paise, tax_rate_bp) values
  ('c09c0000-0000-4000-8000-000000000011', 'c09c0000-0000-4000-8000-000000000001', 'metered', 99900, 1800),
  ('c09c0000-0000-4000-8000-000000000012', 'c09c0000-0000-4000-8000-000000000001', 'metered', 1, 5000),
  ('c09c0000-0000-4000-8000-000000000013', 'c09c0000-0000-4000-8000-000000000001', 'metered', 3, 1800);
select is((select charge_amount_paise from public.plan_prices where id = 'c09c0000-0000-4000-8000-000000000011'), 117882::bigint,
  'charge is computed, not stored by hand: 99900 @ 1800 bp → 117882');
select is((select array_agg(charge_amount_paise order by id) from public.plan_prices
            where id in ('c09c0000-0000-4000-8000-000000000012', 'c09c0000-0000-4000-8000-000000000013')),
  array[2, 4]::bigint[], 'tax rounds half-up to the paisa (1 @ 50 % → 2; 3 @ 18 % = 3.54 → 4)');
select throws_ok($$insert into public.plan_prices (plan_id, billing_model, base_amount_paise, tax_rate_bp, tax_inclusive)
                   values ('c09c0000-0000-4000-8000-000000000001', 'metered', 100, 1800, true)$$,
  '23514', null, 'a GST-inclusive price is refused (PO-20; the generated charge assumes an exclusive base)');
select throws_ok($$update public.plan_prices set charge_amount_paise = 1 where id = 'c09c0000-0000-4000-8000-000000000011'$$,
  '428C9', null, 'charge_amount_paise cannot be written');
select throws_ok($$insert into public.plan_prices (plan_id, billing_model, base_amount_paise, tax_rate_bp)
                   values ('c09c0000-0000-4000-8000-000000000001', 'flat_recurring', 100, 1800)$$,
  '23514', null, 'a flat_recurring price needs its interval');

-- 2. -----------------------------------------------------------------------------------------------------------------
delete from public.plan_prices where plan_id = 'c09c0000-0000-4000-8000-000000000001';
delete from public.plans where id = 'c09c0000-0000-4000-8000-000000000001';
select set_eq($$ select code from public.plans where purchasable $$, array['standard'],
  'no product is purchasable except Standard (acceptance 13)');
select set_eq($$ select code from public.plans $$, array['standard', 'standard_trial', 'ai_assist', 'ai_voice_receptionist'],
  'the four seeded products');
select is(
  (select array_agg(row(code, kind, category, purchasable, visibility)::text order by code) from public.plans
    where code in ('ai_assist', 'ai_voice_receptionist')),
  array['(ai_assist,addon,ai,f,coming_soon)', '(ai_voice_receptionist,addon,ai,f,coming_soon)'],
  'AI products are coming-soon add-ons, not purchasable (AI-18, PO-21)');
select is_empty(
  $$ select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
      where p.code in ('ai_assist', 'ai_voice_receptionist') and pp.provider_plan_id is not null
        and pp.active_from <= now() and (pp.active_until is null or now() < pp.active_until) $$,
  'no AI product has an active price with a provider plan id');
select is(
  (select row(s.kind, s.purchasable, s.visibility, s.trial_days is null)::text from public.plans s where s.code = 'standard_trial'),
  '(trial,f,hidden,t)', 'standard_trial is a hidden, non-purchasable trial plan');
select is(
  (select row(p.kind, p.category, p.visibility, p.trial_days, p.first_charge_grace_days, p.renewal_grace_days, t.code)::text
     from public.plans p join public.plans t on t.id = p.trial_plan_id where p.code = 'standard'),
  '(base,core,public,14,4,7,standard_trial)', 'Standard: public base plan, 14-day trial on standard_trial, grace 4/7');
select throws_ok($$update public.plans set purchasable = true where code = 'standard_trial'$$, '23514', null,
  'a trial plan can never be purchasable');

-- 3. -----------------------------------------------------------------------------------------------------------------
select set_eq($$ select key from public.entitlement_keys $$,
  array['core.*', 'messaging.monthly_quota', 'assist.terminology', 'assist.frequent_rx', 'assist.shorthand', 'assist.snapshot',
        'assist.slots', 'assist.duplicates', 'assist.followup', 'assist.allergy_check', 'assist.dup_therapy', 'assist.help',
        'assist.vitals', 'ai.scribe', 'ai.scribe.monthly_drafts', 'ai.scribe.voice', 'ai.operations_copilot',
        'ai.clinical_copilot', 'ai.patient_advice', 'ai.voice_receptionist', 'ai.voice_receptionist.monthly_minutes'],
  'the AI §6.2 / SUB §7.3 entitlement keys');
select set_eq($$ select key from public.entitlement_keys where kind = 'limit' $$,
  array['messaging.monthly_quota', 'ai.scribe.monthly_drafts', 'ai.voice_receptionist.monthly_minutes'], 'the three limit keys');
create temp view c09c_grid as
  select p.code, pe.key, pe.enabled, pe.limit_value from public.plan_entitlements pe join public.plans p on p.id = pe.plan_id;
select set_eq($$ select key from c09c_grid where code = 'standard' and enabled $$,
  $$ select key from public.entitlement_keys where key like 'assist.%' or key in ('core.*', 'messaging.monthly_quota') $$,
  'Standard enables exactly Smart Assist, core and the messaging quota');
select is((select row(enabled, limit_value)::text from c09c_grid where code = 'standard' and key = 'ai.scribe.monthly_drafts'), '(f,0)',
  'Standard: ai.scribe.monthly_drafts 0 (PO-25 default)');
select set_eq($$ select key from c09c_grid where code = 'standard_trial' and enabled $$,
  $$ select key from c09c_grid where code = 'standard' and enabled union select 'ai.scribe' union select 'ai.scribe.monthly_drafts' $$,
  'standard_trial = Standard + the AI scribe Preview');
select is((select limit_value from c09c_grid where code = 'standard_trial' and key = 'ai.scribe.monthly_drafts'), 1500::bigint,
  'standard_trial: 1,500 drafts (PO-21)');
select is_empty(
  $$ select code || ' ' || key from c09c_grid
      where key in ('ai.operations_copilot', 'ai.clinical_copilot', 'ai.patient_advice', 'ai.scribe.voice') and enabled $$,
  'the deferred AI keys are off on every plan');
select is(
  (select count(*)::int from c09c_grid where code in ('standard', 'standard_trial')
      and key in ('ai.operations_copilot', 'ai.clinical_copilot', 'ai.patient_advice', 'ai.scribe.voice')),
  8, 'and their rows are present (explicit off) on Standard and the trial plan');

-- 4. -----------------------------------------------------------------------------------------------------------------
select is(
  (select row(count(*), min(lock_window_days), min(purge_after_days), min(pending_charge_buffer_hours),
              min(gst_retention_months), min(log_retention_days), min(sac))::text from public.platform_settings),
  '(1,30,180,24,72,365,998314)', 'platform_settings: one row with the SUB §4 defaults');
select set_eq($$ select jsonb_object_keys(ai_features) from public.platform_settings $$,
  $$ select key from public.entitlement_keys where key like 'ai.%' and kind = 'boolean' $$,
  'every AI feature flag is present in ai_features (the kill switch, AI-03)');
select throws_ok($$insert into public.platform_settings (id) values (false)$$, '23514', null, 'a second settings row is refused');

-- 5. -----------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values ('c09c0000-0000-4000-8000-000000000101', 'c09c-user@example.test');
create function pg_temp.val_as(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  begin
    perform set_config('request.jwt.claims',
      case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
    if p_user is null then set local role anon; else set local role authenticated; end if;
    execute p_sql into v_out;
    raise exception 'c09c sentinel' using errcode = 'P0S0C';
  exception
    when sqlstate 'P0S0C' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;
select is(pg_temp.val_as('c09c0000-0000-4000-8000-000000000101', $$select string_agg(code, ',' order by code) from public.plans$$),
  'ai_assist,ai_voice_receptionist,standard', 'a signed-in user lists the non-hidden products only');
select is(pg_temp.val_as('c09c0000-0000-4000-8000-000000000101',
            $$select count(*)::text from public.plan_entitlements pe join public.plans p on p.id = pe.plan_id where p.code = 'standard_trial'$$),
  '0', 'the hidden trial plan''s entitlements are not listed');
select is(pg_temp.val_as('c09c0000-0000-4000-8000-000000000101', $$select charge_amount_paise::text from public.plan_prices$$),
  '176882', 'the Standard price is listed with its charge');
select matches(pg_temp.val_as(null, $$select count(*)::text from public.plans$$), '^denied:', 'anon cannot read the catalogue');

select * from finish();
rollback;
