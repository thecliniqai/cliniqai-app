-- ai_gating_l2.test.sql — V2-05 plan 05-10c (AI-06 L2 database part, AI-03; AI_STRATEGY §4.6 "AI access across the
-- subscription lifecycle"; PO-21, PO-25, C48; acceptance 13 gating half; threats T-05-37, T-05-38).
-- The gating contract of public.ai_preflight(p_feature, p_visit_id), called as the signed-in doctor of clinic A on A's
-- visit, over a GENERATED table:
--   subscription state (trialing, active Standard, active + override, comp, locked, incomplete)
--   × owner opt-in (on/off) × patient objection (on/off) × kill switch (on/off) × quota (below / at the limit)
-- = 96 rows, each compared with an oracle written here independently of the function (precedence: locked, killed,
-- not_entitled, not_opted_in, patient_objected, over_quota, ok). Then the single facts: trialing has ai.scribe with
-- exactly 1,500 drafts (1,499 used → ok, 1,500 → over_quota); active Standard → not_entitled (PO-25 default,
-- acceptance 13); a receptionist, a nurse and an admin → forbidden; another clinic's visit, a visit of the clinic the
-- caller is not acting in (R-42), a non-member and anon → forbidden / no access; an unknown feature raises.
-- Synthetic data only; every probe and the file roll back.
begin;
select plan(115);

-- Fixtures -----------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a1c00000-0000-4000-8000-000000000101', 'a1c-owner-a@example.test'),
  ('a1c00000-0000-4000-8000-000000000102', 'a1c-admin-a@example.test'),
  ('a1c00000-0000-4000-8000-000000000103', 'a1c-doctor-a@example.test'),
  ('a1c00000-0000-4000-8000-000000000104', 'a1c-nurse-a@example.test'),
  ('a1c00000-0000-4000-8000-000000000105', 'a1c-receptionist-a@example.test'),
  ('a1c00000-0000-4000-8000-000000000201', 'a1c-owner-b@example.test'),
  ('a1c00000-0000-4000-8000-000000000202', 'a1c-doctor-b@example.test'),
  ('a1c00000-0000-4000-8000-000000000301', 'a1c-dual@example.test'),
  ('a1c00000-0000-4000-8000-000000000401', 'a1c-stranger@example.test');
insert into public.tenants (id, name) values
  ('a1c00000-0000-4000-8000-00000000000a', 'Synthetic AI Clinic A'),
  ('a1c00000-0000-4000-8000-00000000000b', 'Synthetic AI Clinic B');
-- 05-09c: this file's clinics are trialing on the Standard price (full access) unless a probe reshapes A.
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now() - interval '1 day', trial_end = now() + interval '13 days',
       access_ends_at = now() + interval '14 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in (select t.id from public.tenants t where t.created_at = now()) and s.status = 'incomplete';
insert into public.memberships (user_id, tenant_id, role) values
  ('a1c00000-0000-4000-8000-000000000101', 'a1c00000-0000-4000-8000-00000000000a', 'owner'),
  ('a1c00000-0000-4000-8000-000000000102', 'a1c00000-0000-4000-8000-00000000000a', 'admin'),
  ('a1c00000-0000-4000-8000-000000000103', 'a1c00000-0000-4000-8000-00000000000a', 'doctor'),
  ('a1c00000-0000-4000-8000-000000000104', 'a1c00000-0000-4000-8000-00000000000a', 'nurse'),
  ('a1c00000-0000-4000-8000-000000000105', 'a1c00000-0000-4000-8000-00000000000a', 'receptionist'),
  ('a1c00000-0000-4000-8000-000000000201', 'a1c00000-0000-4000-8000-00000000000b', 'owner'),
  ('a1c00000-0000-4000-8000-000000000202', 'a1c00000-0000-4000-8000-00000000000b', 'doctor'),
  ('a1c00000-0000-4000-8000-000000000301', 'a1c00000-0000-4000-8000-00000000000a', 'doctor'),
  ('a1c00000-0000-4000-8000-000000000301', 'a1c00000-0000-4000-8000-00000000000b', 'doctor');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('a1c00000-0000-4000-8000-000000001001', 'a1c00000-0000-4000-8000-00000000000a', 'Synthetic AI Patient A', '+919000000801',
   'a1c00000-0000-4000-8000-000000000101'),
  ('a1c00000-0000-4000-8000-000000002001', 'a1c00000-0000-4000-8000-00000000000b', 'Synthetic AI Patient B', '+919000000802',
   'a1c00000-0000-4000-8000-000000000201');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by) values
  ('a1c00000-0000-4000-8000-000000001002', 'a1c00000-0000-4000-8000-00000000000a', 'a1c00000-0000-4000-8000-000000001001',
   'a1c00000-0000-4000-8000-000000000103', 'walk_in', 'a1c00000-0000-4000-8000-000000000101'),
  ('a1c00000-0000-4000-8000-000000002002', 'a1c00000-0000-4000-8000-00000000000b', 'a1c00000-0000-4000-8000-000000002001',
   'a1c00000-0000-4000-8000-000000000202', 'walk_in', 'a1c00000-0000-4000-8000-000000000201');
-- The kill switch starts open for ai.scribe (the 000084 seed; set here so the file does not depend on it).
update public.platform_settings set ai_features = ai_features || '{"ai.scribe": true}'::jsonb where id;

-- Helpers ------------------------------------------------------------------------------------------------------------
create function pg_temp.std_price() returns uuid language sql stable as
  $$ select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id where p.code = 'standard'
      order by pp.active_from limit 1 $$;

-- The single value p_sql returns as the signed-in user p_user (anon when null) acting in p_header (none when null);
-- 'denied:<msg>' on 42501, 'error:<sqlstate>:<msg>' otherwise. With p_setup, that SQL runs first as postgres in the
-- same subtransaction. Always rolled back.
create function pg_temp.val_as(p_user uuid, p_header uuid, p_sql text, p_setup text default null) returns text
language plpgsql as $f$
declare
  v_out text;
begin
  begin
    if p_setup is not null then execute p_setup; end if;
    perform set_config('request.jwt.claims',
      case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
    perform set_config('request.headers',
      case when p_header is null then '' else json_build_object('x-clinicos-tenant', p_header)::text end, true);
    if p_user is null then set local role anon; else set local role authenticated; end if;
    execute p_sql into v_out;
    raise exception 'a1c sentinel' using errcode = 'P0S10';
  exception
    when sqlstate 'P0S10' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

-- SQL (as postgres) that puts clinic A in one subscription state. `override`: active Standard plus an override that
-- grants ai.scribe with 200 drafts a month; `comp`: an `incomplete` row comped for a year on the Standard price.
create function pg_temp.state_sql(p_state text) returns text language sql stable as $f$
  select 'delete from public.tenant_entitlement_overrides where tenant_id = ''a1c00000-0000-4000-8000-00000000000a''; '
      || 'update public.tenant_subscriptions set '
      || case p_state
           when 'trialing' then
             'status = ''trialing'', plan_price_id = ' || quote_literal(pg_temp.std_price()) || ', trial_start = now() - interval ''1 day'', '
             || 'trial_end = now() + interval ''13 days'', access_ends_at = now() + interval ''14 days'', comp_until = null, '
             || 'current_period_start = null, current_period_end = null'
           when 'locked' then
             'status = ''trialing'', plan_price_id = ' || quote_literal(pg_temp.std_price()) || ', trial_start = now() - interval ''20 days'', '
             || 'trial_end = now() - interval ''6 days'', access_ends_at = now() - interval ''5 days'', comp_until = null'
           when 'incomplete' then
             'status = ''incomplete'', plan_price_id = null, trial_start = null, trial_end = null, access_ends_at = null, '
             || 'comp_until = null, trial_consumed = false'
           when 'comp' then
             'status = ''incomplete'', plan_price_id = ' || quote_literal(pg_temp.std_price()) || ', trial_start = null, '
             || 'trial_end = null, access_ends_at = null, comp_until = now() + interval ''365 days'', trial_consumed = false'
           else -- active, override
             'status = ''active'', plan_price_id = ' || quote_literal(pg_temp.std_price()) || ', trial_start = null, trial_end = null, '
             || 'current_period_start = now() - interval ''1 day'', current_period_end = now() + interval ''29 days'', '
             || 'access_ends_at = now() + interval ''30 days'', comp_until = null'
         end
      || ' where tenant_id = ''a1c00000-0000-4000-8000-00000000000a''; '
      || case when p_state = 'override' then
           'insert into public.tenant_entitlement_overrides (tenant_id, key, enabled, limit_value, reason) values '
           || '(''a1c00000-0000-4000-8000-00000000000a'', ''ai.scribe'', true, null, ''Synthetic AI override''), '
           || '(''a1c00000-0000-4000-8000-00000000000a'', ''ai.scribe.monthly_drafts'', true, 200, ''Synthetic AI override''); '
         else '' end
$f$;

-- The oracle's period and limit for a state (the trial counts from trial_start, PO-21; otherwise the IST month).
create function pg_temp.period_of(p_state text) returns text language sql stable as $f$
  select case when p_state = 'trialing' then 'trial:' || to_char((now() - interval '1 day') at time zone 'Asia/Kolkata', 'YYYY-MM-DD')
              else to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM') end
$f$;
create function pg_temp.limit_of(p_state text) returns int language sql immutable as
  $$ select case p_state when 'trialing' then 1500 when 'override' then 200 else 1500 end $$;

-- 1. The generated table: 6 × 2 × 2 × 2 × 2 = 96 rows ------------------------------------------------------------------
create temp table l2_cases on commit drop as
select row_number() over (order by s.ord, o.v, j.v, k.v, q.v) as n,
       s.state, o.v as opt_in, j.v as objected, k.v as killed, q.v as at_limit,
       case
         when s.state in ('locked', 'incomplete') then 'locked'
         when k.v then 'killed'
         when s.state in ('active', 'comp') then 'not_entitled'
         when not o.v then 'not_opted_in'
         when j.v then 'patient_objected'
         when q.v then 'over_quota'
         else 'ok'
       end as expected
  from (values (1, 'trialing'), (2, 'active'), (3, 'override'), (4, 'comp'), (5, 'locked'), (6, 'incomplete')) s(ord, state),
       (values (false), (true)) o(v), (values (false), (true)) j(v), (values (false), (true)) k(v), (values (false), (true)) q(v);

create temp table l2_results on commit drop as
select c.n, c.state, c.opt_in, c.objected, c.killed, c.at_limit, c.expected,
       pg_temp.val_as('a1c00000-0000-4000-8000-000000000103', null,
         $$ select public.ai_preflight('ai.scribe', 'a1c00000-0000-4000-8000-000000001002') $$,
         pg_temp.state_sql(c.state)
         || case when c.opt_in then
              'insert into public.tenant_ai_settings (tenant_id, enabled, accepted_terms_version, accepted_by, accepted_at) '
              || 'values (''a1c00000-0000-4000-8000-00000000000a'', true, ''2026-11'', ''a1c00000-0000-4000-8000-000000000101'', now()); '
            else '' end
         || case when c.objected then
              'update public.patients set ai_processing_objected = true where id = ''a1c00000-0000-4000-8000-000000001001''; '
            else '' end
         || case when c.killed then
              'update public.platform_settings set ai_features = ai_features || ''{"ai.scribe": false}''::jsonb where id; '
            else '' end
         || case when c.at_limit then
              'insert into public.ai_usage_monthly (tenant_id, period, feature, units) values (''a1c00000-0000-4000-8000-00000000000a'', '
              || quote_literal(pg_temp.period_of(c.state)) || ', ''ai.scribe'', ' || pg_temp.limit_of(c.state) || '); '
            else '' end) as actual
  from l2_cases c;

select is(r.actual, r.expected,
          format('L2 #%s %s, opt-in %s, objected %s, kill switch %s, quota %s → %s', r.n, r.state,
                 case when r.opt_in then 'on' else 'off' end, case when r.objected then 'yes' else 'no' end,
                 case when r.killed then 'on' else 'off' end, case when r.at_limit then 'at limit' else 'below' end, r.expected))
  from l2_results r order by r.n;

-- 2. Single facts ----------------------------------------------------------------------------------------------------
create function pg_temp.opted_in() returns text language sql stable as $f$
  select 'insert into public.tenant_ai_settings (tenant_id, enabled, accepted_terms_version, accepted_by, accepted_at) '
      || 'values (''a1c00000-0000-4000-8000-00000000000a'', true, ''2026-11'', ''a1c00000-0000-4000-8000-000000000101'', now()); '
$f$;
create function pg_temp.used(p_state text, p_units int) returns text language sql stable as $f$
  select 'insert into public.ai_usage_monthly (tenant_id, period, feature, units) values (''a1c00000-0000-4000-8000-00000000000a'', '
      || quote_literal(pg_temp.period_of(p_state)) || ', ''ai.scribe'', ' || p_units || '); '
$f$;

select is(pg_temp.val_as('a1c00000-0000-4000-8000-000000000103', null,
  $$ select public.ai_preflight('ai.scribe', 'a1c00000-0000-4000-8000-000000001002') $$,
  pg_temp.state_sql('trialing') || pg_temp.opted_in() || pg_temp.used('trialing', 1499)),
  'ok', 'trialing: 1,499 of the trial''s drafts used → ok (PO-21: ai.scribe on during the trial)');
select is(pg_temp.val_as('a1c00000-0000-4000-8000-000000000103', null,
  $$ select public.ai_preflight('ai.scribe', 'a1c00000-0000-4000-8000-000000001002') $$,
  pg_temp.state_sql('trialing') || pg_temp.opted_in() || pg_temp.used('trialing', 1500)),
  'over_quota', 'trialing: the limit is exactly 1,500 drafts for the whole trial (PO-21)');
select is(pg_temp.val_as('a1c00000-0000-4000-8000-000000000103', null,
  $$ select public.ai_preflight('ai.scribe', 'a1c00000-0000-4000-8000-000000001002') $$,
  pg_temp.state_sql('trialing') || pg_temp.opted_in()
  || 'insert into public.ai_usage_monthly (tenant_id, period, feature, units) values (''a1c00000-0000-4000-8000-00000000000a'', '
  || quote_literal(to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM')) || ', ''ai.scribe'', 1500); '),
  'ok', 'trialing: usage booked to a calendar month does not count against the trial period');
select is(pg_temp.val_as('a1c00000-0000-4000-8000-000000000103', null,
  $$ select public.ai_preflight('ai.scribe', 'a1c00000-0000-4000-8000-000000001002') $$,
  pg_temp.state_sql('active') || pg_temp.opted_in()),
  'not_entitled', 'active Standard with opt-in: not_entitled (PO-25 default; acceptance 13 gating half)');
select is(pg_temp.val_as('a1c00000-0000-4000-8000-000000000103', null,
  $$ select public.ai_preflight('ai.scribe', 'a1c00000-0000-4000-8000-000000001002') $$,
  pg_temp.state_sql('override') || pg_temp.opted_in() || pg_temp.used('override', 199)),
  'ok', 'active + override: the override''s own limit (199 of 200 used → ok)');
select is(pg_temp.val_as('a1c00000-0000-4000-8000-000000000105', null,
  $$ select public.ai_preflight('ai.scribe', 'a1c00000-0000-4000-8000-000000001002') $$, pg_temp.opted_in()),
  'forbidden', 'a receptionist (no consultations:edit) → forbidden');
select is(pg_temp.val_as('a1c00000-0000-4000-8000-000000000104', null,
  $$ select public.ai_preflight('ai.scribe', 'a1c00000-0000-4000-8000-000000001002') $$, pg_temp.opted_in()),
  'forbidden', 'a nurse (no consultations:edit) → forbidden');
select is(pg_temp.val_as('a1c00000-0000-4000-8000-000000000102', null,
  $$ select public.ai_preflight('ai.scribe', 'a1c00000-0000-4000-8000-000000001002') $$, pg_temp.opted_in()),
  'forbidden', 'an admin (no clinical access, R-9) → forbidden');
select is(pg_temp.val_as('a1c00000-0000-4000-8000-000000000101', null,
  $$ select public.ai_preflight('ai.scribe', 'a1c00000-0000-4000-8000-000000001002') $$, pg_temp.opted_in()),
  'ok', 'the owner (consultations:edit through *) → ok');
select is(pg_temp.val_as('a1c00000-0000-4000-8000-000000000103', null,
  $$ select public.ai_preflight('ai.scribe', 'a1c00000-0000-4000-8000-000000002002') $$, pg_temp.opted_in()),
  'forbidden', 'another clinic''s visit → forbidden (tenant from the visit, never the caller)');
select is(pg_temp.val_as('a1c00000-0000-4000-8000-000000000301', 'a1c00000-0000-4000-8000-00000000000b',
  $$ select public.ai_preflight('ai.scribe', 'a1c00000-0000-4000-8000-000000001002') $$, pg_temp.opted_in()),
  'forbidden', 'a doctor of A and B acting in B, on A''s visit → forbidden (R-42)');
select is(pg_temp.val_as('a1c00000-0000-4000-8000-000000000301', 'a1c00000-0000-4000-8000-00000000000a',
  $$ select public.ai_preflight('ai.scribe', 'a1c00000-0000-4000-8000-000000001002') $$, pg_temp.opted_in()),
  'ok', 'the same doctor acting in A → ok');
select is(pg_temp.val_as('a1c00000-0000-4000-8000-000000000401', null,
  $$ select public.ai_preflight('ai.scribe', 'a1c00000-0000-4000-8000-000000001002') $$, pg_temp.opted_in()),
  'forbidden', 'a signed-in user of no clinic → forbidden');
select is(pg_temp.val_as('a1c00000-0000-4000-8000-000000000103', null,
  $$ select public.ai_preflight('ai.scribe', 'a1c00000-0000-4000-8000-00000000ffff') $$, pg_temp.opted_in()),
  'forbidden', 'an unknown visit → forbidden');
select alike(pg_temp.val_as(null, null,
  $$ select public.ai_preflight('ai.scribe', 'a1c00000-0000-4000-8000-000000001002') $$),
  'denied:%', 'anon cannot execute ai_preflight');
select is(pg_temp.val_as('a1c00000-0000-4000-8000-000000000103', null,
  $$ select public.ai_preflight('ai.voice_receptionist', 'a1c00000-0000-4000-8000-000000001002') $$,
  pg_temp.opted_in()),
  'not_entitled', 'a deferred AI product (ai.voice_receptionist) is not entitled on the trial (AI-18)');
select is(pg_temp.val_as('a1c00000-0000-4000-8000-000000000103', null,
  $$ select public.ai_preflight('core.*', 'a1c00000-0000-4000-8000-000000001002') $$),
  'error:P0001:AI_FEATURE_UNKNOWN', 'a key that is not an AI feature raises AI_FEATURE_UNKNOWN');
select is(pg_temp.val_as('a1c00000-0000-4000-8000-000000000103', null,
  $$ select public.ai_preflight('ai.scribe', 'a1c00000-0000-4000-8000-000000001002') $$,
  pg_temp.opted_in() || 'update public.platform_settings set ai_features = ai_features - ''ai.scribe'' where id; '),
  'killed', 'a feature missing from platform_settings.ai_features is off (kill switch fails closed)');
select is(pg_temp.val_as('a1c00000-0000-4000-8000-000000000103', null,
  $$ select public.ai_preflight('ai.scribe', 'a1c00000-0000-4000-8000-000000001002') $$,
  'insert into public.tenant_ai_settings (tenant_id, enabled) values (''a1c00000-0000-4000-8000-00000000000a'', false); '),
  'not_opted_in', 'an opt-in row switched off → not_opted_in');

select * from finish();
rollback;
