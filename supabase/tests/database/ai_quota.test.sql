-- ai_quota.test.sql — V2-05 plan 05-10c (AI-03 database part; AI_STRATEGY §4.6 quota, opt-in, objection, write
-- protection; R-33; threats T-05-37, T-05-38).
--   reservations: an expired reservation does not count, a live one does; the trial period key ('trial:<IST date of
--   trial_start>') is used while trialing and the IST month afterwards, whatever the clinic's zone (05-12); the timeout is clamped to 10…300 s (+30 s);
--   reserve raises AI_<CODE> for every refusal; commit adds exactly one unit, release none; another clinic's
--   reservation is not found; a role without consultations:edit cannot commit or release;
--   opt-in: only the owner of the active, full clinic; enabling records terms version, who and when, and audits;
--   disabling keeps the acceptance; no terms version → refused;
--   objection: stamped from the flag and auth.uid() by the trigger; the stamp columns cannot be written directly;
--   another clinic's member cannot set it (every clinic role holds patients:edit, matrix.ts);
--   grants: no API-role DML on tenant_ai_settings, ai_usage_monthly, ai_quota_reservations; anon executes nothing.
-- Synthetic data only; every probe and the file roll back.
begin;
select plan(41);

-- Fixtures -----------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a1d00000-0000-4000-8000-000000000101', 'a1d-owner-a@example.test'),
  ('a1d00000-0000-4000-8000-000000000102', 'a1d-admin-a@example.test'),
  ('a1d00000-0000-4000-8000-000000000103', 'a1d-doctor-a@example.test'),
  ('a1d00000-0000-4000-8000-000000000104', 'a1d-nurse-a@example.test'),
  ('a1d00000-0000-4000-8000-000000000105', 'a1d-receptionist-a@example.test'),
  ('a1d00000-0000-4000-8000-000000000201', 'a1d-owner-b@example.test'),
  ('a1d00000-0000-4000-8000-000000000202', 'a1d-doctor-b@example.test');
insert into public.tenants (id, name) values
  ('a1d00000-0000-4000-8000-00000000000a', 'Synthetic Quota Clinic A'),
  ('a1d00000-0000-4000-8000-00000000000b', 'Synthetic Quota Clinic B');
-- 05-09c: trialing on the Standard price (full access; ai.scribe with 1,500 drafts).
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now() - interval '1 day', trial_end = now() + interval '13 days',
       access_ends_at = now() + interval '14 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in (select t.id from public.tenants t where t.created_at = now()) and s.status = 'incomplete';
insert into public.memberships (user_id, tenant_id, role) values
  ('a1d00000-0000-4000-8000-000000000101', 'a1d00000-0000-4000-8000-00000000000a', 'owner'),
  ('a1d00000-0000-4000-8000-000000000102', 'a1d00000-0000-4000-8000-00000000000a', 'admin'),
  ('a1d00000-0000-4000-8000-000000000103', 'a1d00000-0000-4000-8000-00000000000a', 'doctor'),
  ('a1d00000-0000-4000-8000-000000000104', 'a1d00000-0000-4000-8000-00000000000a', 'nurse'),
  ('a1d00000-0000-4000-8000-000000000105', 'a1d00000-0000-4000-8000-00000000000a', 'receptionist'),
  ('a1d00000-0000-4000-8000-000000000201', 'a1d00000-0000-4000-8000-00000000000b', 'owner'),
  ('a1d00000-0000-4000-8000-000000000202', 'a1d00000-0000-4000-8000-00000000000b', 'doctor');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('a1d00000-0000-4000-8000-000000001001', 'a1d00000-0000-4000-8000-00000000000a', 'Synthetic Quota Patient A', '+919000000811',
   'a1d00000-0000-4000-8000-000000000101'),
  ('a1d00000-0000-4000-8000-000000002001', 'a1d00000-0000-4000-8000-00000000000b', 'Synthetic Quota Patient B', '+919000000812',
   'a1d00000-0000-4000-8000-000000000201');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by) values
  ('a1d00000-0000-4000-8000-000000001002', 'a1d00000-0000-4000-8000-00000000000a', 'a1d00000-0000-4000-8000-000000001001',
   'a1d00000-0000-4000-8000-000000000103', 'walk_in', 'a1d00000-0000-4000-8000-000000000101'),
  ('a1d00000-0000-4000-8000-000000002002', 'a1d00000-0000-4000-8000-00000000000b', 'a1d00000-0000-4000-8000-000000002001',
   'a1d00000-0000-4000-8000-000000000202', 'walk_in', 'a1d00000-0000-4000-8000-000000000201');
update public.platform_settings set ai_features = ai_features || '{"ai.scribe": true}'::jsonb where id;
-- Both clinics opted in (as postgres; the RPC is tested in section 3).
insert into public.tenant_ai_settings (tenant_id, enabled, accepted_terms_version, accepted_by, accepted_at) values
  ('a1d00000-0000-4000-8000-00000000000a', true, '2026-11', 'a1d00000-0000-4000-8000-000000000101', now()),
  ('a1d00000-0000-4000-8000-00000000000b', true, '2026-11', 'a1d00000-0000-4000-8000-000000000201', now());

-- Helpers ------------------------------------------------------------------------------------------------------------
-- The single value p_sql returns as p_user (anon when null), after p_setup as postgres; with p_probe, the value p_probe
-- returns as postgres afterwards (same subtransaction). 'denied:<msg>' / 'error:<sqlstate>:<msg>'. Always rolled back.
create function pg_temp.val_as(p_user uuid, p_sql text, p_setup text default null, p_probe text default null) returns text
language plpgsql as $f$
declare
  v_out text;
begin
  begin
    if p_setup is not null then execute p_setup; end if;
    perform set_config('request.jwt.claims',
      case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
    perform set_config('request.headers', '', true);
    if p_user is null then set local role anon; else set local role authenticated; end if;
    execute p_sql into v_out;
    if p_probe is not null then
      reset role;
      execute p_probe into v_out;
    end if;
    raise exception 'a1d sentinel' using errcode = 'P0S11';
  exception
    when sqlstate 'P0S11' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;
create function pg_temp.trial_period() returns text language sql stable as
  $$ select 'trial:' || to_char((now() - interval '1 day') at time zone 'Asia/Kolkata', 'YYYY-MM-DD') $$;
create function pg_temp.month_period() returns text language sql stable as
  $$ select to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM') $$;
create function pg_temp.used(p_units int) returns text language sql stable as $f$
  select 'insert into public.ai_usage_monthly (tenant_id, period, feature, units) values (''a1d00000-0000-4000-8000-00000000000a'', '
      || quote_literal(pg_temp.trial_period()) || ', ''ai.scribe'', ' || p_units || '); '
$f$;
-- A reservation of clinic A in the trial period that expired an hour ago (or is live for p_live), made by the doctor of
-- clinic A (05-12, IND L-6: only the reserving user commits or releases it).
create function pg_temp.reservation(p_id text, p_live boolean, p_tenant text default 'a1d00000-0000-4000-8000-00000000000a') returns text
language sql stable as $f$
  select 'insert into public.ai_quota_reservations (id, tenant_id, feature, period, created_at, expires_at, created_by) values ('
      || quote_literal(p_id) || ', ' || quote_literal(p_tenant) || ', ''ai.scribe'', ' || quote_literal(pg_temp.trial_period()) || ', '
      || case when p_live then 'now(), now() + interval ''60 seconds''' else 'now() - interval ''2 hours'', now() - interval ''1 hour''' end
      || ', ''a1d00000-0000-4000-8000-000000000103''); '
$f$;
create function pg_temp.active_month_sql() returns text language sql stable as $f$
  select 'update public.tenant_subscriptions set status = ''active'', trial_start = null, trial_end = null, '
      || 'current_period_start = now() - interval ''1 day'', current_period_end = now() + interval ''29 days'', '
      || 'access_ends_at = now() + interval ''30 days'' where tenant_id = ''a1d00000-0000-4000-8000-00000000000a''; '
      || 'insert into public.tenant_entitlement_overrides (tenant_id, key, enabled, limit_value, reason) values '
      || '(''a1d00000-0000-4000-8000-00000000000a'', ''ai.scribe'', true, null, ''Synthetic''), '
      || '(''a1d00000-0000-4000-8000-00000000000a'', ''ai.scribe.monthly_drafts'', true, 50, ''Synthetic''); '
$f$;

-- 1. Reservations and periods ------------------------------------------------------------------------------------------
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_preflight('ai.scribe', 'a1d00000-0000-4000-8000-000000001002') $$,
  pg_temp.used(1499) || pg_temp.reservation('a1d00000-0000-4000-8000-00000000e001', false)),
  'ok', '1,499 used + one EXPIRED reservation → ok (an expired reservation stops counting at expires_at)');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_preflight('ai.scribe', 'a1d00000-0000-4000-8000-000000001002') $$,
  pg_temp.used(1499) || pg_temp.reservation('a1d00000-0000-4000-8000-00000000e002', true)),
  'over_quota', '1,499 used + one LIVE reservation → over_quota');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_reserve('ai.scribe', 'a1d00000-0000-4000-8000-000000001002', 60)::text $$,
  pg_temp.used(1499) || pg_temp.reservation('a1d00000-0000-4000-8000-00000000e003', true)),
  'error:P0001:AI_OVER_QUOTA', 'ai_reserve at the limit (units + live reservations) raises AI_OVER_QUOTA');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_reserve('ai.scribe', 'a1d00000-0000-4000-8000-000000001002', 60)::text $$,
  pg_temp.used(1499) || pg_temp.reservation('a1d00000-0000-4000-8000-00000000e004', false),
  $$ select count(*)::text from public.ai_quota_reservations where tenant_id = 'a1d00000-0000-4000-8000-00000000000a' and expires_at > now() $$),
  '1', 'ai_reserve with only an expired reservation at limit − 1 succeeds: one live reservation');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_reserve('ai.scribe', 'a1d00000-0000-4000-8000-000000001002', 60)::text $$, null,
  $$ select period from public.ai_quota_reservations where tenant_id = 'a1d00000-0000-4000-8000-00000000000a' $$),
  pg_temp.trial_period(), 'while trialing the reservation is booked to the trial period (trial:<IST date of trial_start>, PO-21)');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_reserve('ai.scribe', 'a1d00000-0000-4000-8000-000000001002', 60)::text $$, pg_temp.active_month_sql(),
  $$ select period from public.ai_quota_reservations where tenant_id = 'a1d00000-0000-4000-8000-00000000000a' $$),
  pg_temp.month_period(), 'after the trial (active + override) the reservation is booked to the IST month');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_reserve('ai.scribe', 'a1d00000-0000-4000-8000-000000001002', 60)::text $$,
  'update public.tenants set timezone = ''Pacific/Kiritimati'' where id = ''a1d00000-0000-4000-8000-00000000000a''; '
  || pg_temp.active_month_sql(),
  $$ select (period = to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM'))::text from public.ai_quota_reservations
      where tenant_id = 'a1d00000-0000-4000-8000-00000000000a' $$),
  'true', 'the month is the IST month whatever the clinic''s zone (05-12, H-AITZ: AI §4.6 "IST calendar month"; was the clinic''s own)');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_reserve('ai.scribe', 'a1d00000-0000-4000-8000-000000001002', 1)::text $$, null,
  $$ select extract(epoch from (expires_at - now()))::int::text from public.ai_quota_reservations where tenant_id = 'a1d00000-0000-4000-8000-00000000000a' $$),
  '40', 'p_timeout_s 1 is clamped to 10 s: the reservation expires 10 + 30 s after now()');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_reserve('ai.scribe', 'a1d00000-0000-4000-8000-000000001002', 100000)::text $$, null,
  $$ select extract(epoch from (expires_at - now()))::int::text from public.ai_quota_reservations where tenant_id = 'a1d00000-0000-4000-8000-00000000000a' $$),
  '330', 'p_timeout_s 100000 is clamped to 300 s: the reservation expires 300 + 30 s after now()');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select (public.ai_reserve('ai.scribe', 'a1d00000-0000-4000-8000-000000001002', 60) is not null
             and public.ai_reserve('ai.scribe', 'a1d00000-0000-4000-8000-000000001002', 60) is not null)::text $$,
  pg_temp.used(1498),
  $$ select count(*)::text from public.ai_quota_reservations where tenant_id = 'a1d00000-0000-4000-8000-00000000000a' $$),
  '2', 'two reservations fit at limit − 2');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select (public.ai_reserve('ai.scribe', 'a1d00000-0000-4000-8000-000000001002', 60) is not null
             and public.ai_reserve('ai.scribe', 'a1d00000-0000-4000-8000-000000001002', 60) is not null)::text $$,
  pg_temp.used(1499)),
  'error:P0001:AI_OVER_QUOTA', 'the second reservation at limit − 1 is refused (the first one counts while live)');

-- reserve raises the preflight code for every refusal
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000105',
  $$ select public.ai_reserve('ai.scribe', 'a1d00000-0000-4000-8000-000000001002', 60)::text $$),
  'error:P0001:AI_FORBIDDEN', 'ai_reserve as a receptionist raises AI_FORBIDDEN');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_reserve('ai.scribe', 'a1d00000-0000-4000-8000-000000002002', 60)::text $$),
  'error:P0001:AI_FORBIDDEN', 'ai_reserve on another clinic''s visit raises AI_FORBIDDEN');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_reserve('ai.scribe', 'a1d00000-0000-4000-8000-000000001002', 60)::text $$,
  'update public.tenant_subscriptions set access_ends_at = now() - interval ''1 day'' where tenant_id = ''a1d00000-0000-4000-8000-00000000000a''; '),
  'error:P0001:AI_LOCKED', 'ai_reserve for a locked clinic raises AI_LOCKED');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_reserve('ai.scribe', 'a1d00000-0000-4000-8000-000000001002', 60)::text $$,
  'update public.platform_settings set ai_features = ai_features || ''{"ai.scribe": false}''::jsonb where id; '),
  'error:P0001:AI_KILLED', 'ai_reserve with the kill switch on raises AI_KILLED');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_reserve('ai.scribe', 'a1d00000-0000-4000-8000-000000001002', 60)::text $$,
  'update public.tenant_subscriptions set status = ''active'', trial_start = null, trial_end = null, '
  || 'current_period_end = now() + interval ''29 days'', access_ends_at = now() + interval ''30 days'' '
  || 'where tenant_id = ''a1d00000-0000-4000-8000-00000000000a''; '),
  'error:P0001:AI_NOT_ENTITLED', 'ai_reserve for active Standard raises AI_NOT_ENTITLED (PO-25)');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_reserve('ai.scribe', 'a1d00000-0000-4000-8000-000000001002', 60)::text $$,
  'update public.tenant_ai_settings set enabled = false where tenant_id = ''a1d00000-0000-4000-8000-00000000000a''; '),
  'error:P0001:AI_NOT_OPTED_IN', 'ai_reserve without the owner''s opt-in raises AI_NOT_OPTED_IN');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_reserve('ai.scribe', 'a1d00000-0000-4000-8000-000000001002', 60)::text $$,
  'update public.patients set ai_processing_objected = true where id = ''a1d00000-0000-4000-8000-000000001001''; '),
  'error:P0001:AI_PATIENT_OBJECTED', 'ai_reserve for an objecting patient raises AI_PATIENT_OBJECTED');

-- 2. Commit and release --------------------------------------------------------------------------------------------
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_commit('a1d00000-0000-4000-8000-00000000e010')::text $$,
  pg_temp.used(7) || pg_temp.reservation('a1d00000-0000-4000-8000-00000000e010', true),
  $$ select (select units from public.ai_usage_monthly where tenant_id = 'a1d00000-0000-4000-8000-00000000000a')::text
            || '/' || (select count(*) from public.ai_quota_reservations where id = 'a1d00000-0000-4000-8000-00000000e010')::text $$),
  '8/0', 'ai_commit adds exactly one unit (7 → 8) and deletes the reservation');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_commit('a1d00000-0000-4000-8000-00000000e011')::text $$,
  pg_temp.reservation('a1d00000-0000-4000-8000-00000000e011', true)),
  '1', 'ai_commit without a usage row creates it with 1 unit');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_release('a1d00000-0000-4000-8000-00000000e012')::text $$,
  pg_temp.used(7) || pg_temp.reservation('a1d00000-0000-4000-8000-00000000e012', true),
  $$ select (select units from public.ai_usage_monthly where tenant_id = 'a1d00000-0000-4000-8000-00000000000a')::text
            || '/' || (select count(*) from public.ai_quota_reservations where id = 'a1d00000-0000-4000-8000-00000000e012')::text $$),
  '7/0', 'ai_release deletes the reservation and adds no unit');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_release('a1d00000-0000-4000-8000-00000000e013')::text $$),
  'false', 'ai_release of an unknown reservation answers false');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_commit('a1d00000-0000-4000-8000-00000000e014')::text $$,
  pg_temp.reservation('a1d00000-0000-4000-8000-00000000e014', true, 'a1d00000-0000-4000-8000-00000000000b'),
  $$ select count(*)::text from public.ai_quota_reservations where id = 'a1d00000-0000-4000-8000-00000000e014' $$),
  'error:P0002:AI_RESERVATION_NOT_FOUND', 'another clinic''s reservation cannot be committed (not found)');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_release('a1d00000-0000-4000-8000-00000000e015')::text $$,
  pg_temp.reservation('a1d00000-0000-4000-8000-00000000e015', true, 'a1d00000-0000-4000-8000-00000000000b'),
  $$ select count(*)::text from public.ai_quota_reservations where id = 'a1d00000-0000-4000-8000-00000000e015' $$),
  '1', 'another clinic''s reservation cannot be released (it stays)');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000105',
  $$ select public.ai_commit('a1d00000-0000-4000-8000-00000000e016')::text $$,
  pg_temp.reservation('a1d00000-0000-4000-8000-00000000e016', true)),
  'error:P0001:AI_FORBIDDEN', 'a receptionist cannot commit a reservation');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000104',
  $$ select public.ai_release('a1d00000-0000-4000-8000-00000000e017')::text $$,
  pg_temp.reservation('a1d00000-0000-4000-8000-00000000e017', true)),
  'error:P0001:AI_FORBIDDEN', 'a nurse cannot release a reservation');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.ai_commit('a1d00000-0000-4000-8000-00000000e018')::text $$,
  pg_temp.used(3) || pg_temp.reservation('a1d00000-0000-4000-8000-00000000e018', true)
  || 'update public.tenant_subscriptions set access_ends_at = now() - interval ''1 day'' where tenant_id = ''a1d00000-0000-4000-8000-00000000000a''; '),
  '4', 'a call reserved before a lock is still metered: ai_commit works at any access level');

-- 3. Owner opt-in ----------------------------------------------------------------------------------------------------
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000101',
  $$ select (s.enabled, s.accepted_terms_version, s.accepted_by)::text from public.set_ai_opt_in('a1d00000-0000-4000-8000-00000000000a', true, '2026-11.1') s $$,
  'delete from public.tenant_ai_settings where tenant_id = ''a1d00000-0000-4000-8000-00000000000a''; '),
  '(t,2026-11.1,a1d00000-0000-4000-8000-000000000101)', 'the owner opts in: terms version and the owner recorded');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000101',
  $$ select public.set_ai_opt_in('a1d00000-0000-4000-8000-00000000000a', true, '2026-11.1') is not null $$,
  'delete from public.tenant_ai_settings where tenant_id = ''a1d00000-0000-4000-8000-00000000000a''; ',
  $$ select (action || ':' || (metadata ->> 'terms_version') || ':' || actor_id::text) from public.audit_logs
      where tenant_id = 'a1d00000-0000-4000-8000-00000000000a' and entity_type = 'tenant_ai_settings' $$),
  'ai.opt_in.enabled:2026-11.1:a1d00000-0000-4000-8000-000000000101', 'opting in writes one audit row');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000101',
  $$ select (s.enabled, s.accepted_terms_version, s.accepted_by)::text from public.set_ai_opt_in('a1d00000-0000-4000-8000-00000000000a', false, null) s $$),
  '(f,2026-11,a1d00000-0000-4000-8000-000000000101)', 'opting out switches it off and keeps the last acceptance');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000102',
  $$ select public.set_ai_opt_in('a1d00000-0000-4000-8000-00000000000a', true, '2026-11')::text $$),
  'denied:AI_OPT_IN_OWNER_ONLY', 'an admin cannot opt the clinic in (owner only, R-33)');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000103',
  $$ select public.set_ai_opt_in('a1d00000-0000-4000-8000-00000000000a', true, '2026-11')::text $$),
  'denied:AI_OPT_IN_OWNER_ONLY', 'a doctor cannot opt the clinic in');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000201',
  $$ select public.set_ai_opt_in('a1d00000-0000-4000-8000-00000000000a', true, '2026-11')::text $$),
  'denied:AI_OPT_IN_OWNER_ONLY', 'the owner of another clinic cannot opt clinic A in');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000101',
  $$ select public.set_ai_opt_in('a1d00000-0000-4000-8000-00000000000a', true, '2026-11')::text $$,
  'update public.tenant_subscriptions set access_ends_at = now() - interval ''1 day'' where tenant_id = ''a1d00000-0000-4000-8000-00000000000a''; '),
  'denied:AI_OPT_IN_OWNER_ONLY', 'the owner of a locked clinic cannot opt in (the clinic reads as another clinic, 05-10a)');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000101',
  $$ select public.set_ai_opt_in('a1d00000-0000-4000-8000-00000000000a', true, null)::text $$),
  'error:P0001:AI_TERMS_VERSION_INVALID', 'enabling without a terms version is refused');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000105',
  $$ select count(*)::text from public.tenant_ai_settings $$),
  '1', 'every role of the clinic (clinic:view) reads its own opt-in row, and only its own');

-- 4. Patient objection stamp ---------------------------------------------------------------------------------------
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000105',
  $$ with u as (update public.patients set ai_processing_objected = true where id = 'a1d00000-0000-4000-8000-000000001001' returning 1)
     select count(*)::text from u $$, null,
  $$ select (ai_processing_objected, objected_at = now(), objection_recorded_by)::text from public.patients where id = 'a1d00000-0000-4000-8000-000000001001' $$),
  '(t,t,a1d00000-0000-4000-8000-000000000105)', 'a receptionist (patients:edit) records the objection: time and recorder stamped');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000105',
  $$ with u as (update public.patients set objected_at = now() - interval '1 year', objection_recorded_by = 'a1d00000-0000-4000-8000-000000000101'
                 where id = 'a1d00000-0000-4000-8000-000000001001' returning 1) select count(*)::text from u $$, null,
  $$ select (ai_processing_objected, objected_at is null, objection_recorded_by is null)::text from public.patients where id = 'a1d00000-0000-4000-8000-000000001001' $$),
  '(f,t,t)', 'the stamp columns cannot be written directly (recomputed from the flag)');
select is(pg_temp.val_as('a1d00000-0000-4000-8000-000000000202',
  $$ with u as (update public.patients set ai_processing_objected = true where id = 'a1d00000-0000-4000-8000-000000001001' returning 1)
     select count(*)::text from u $$),
  '0', 'a doctor of another clinic cannot set the objection on clinic A''s patient (patients:edit is clinic-bound)');

-- 5. Grants --------------------------------------------------------------------------------------------------------
select is_empty(
  $$ select t || ':' || r || ':' || p from unnest(array['public.tenant_ai_settings', 'public.ai_usage_monthly', 'public.ai_quota_reservations']) t,
            unnest(array['anon', 'authenticated']) r, unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
      where has_table_privilege(r, t, p) $$,
  'no API role may insert, update, delete or truncate the AI gating tables');
select is_empty(
  $$ select f from unnest(array['public.ai_preflight(text,uuid)', 'public.ai_reserve(text,uuid,integer)', 'public.ai_commit(uuid)',
                                'public.ai_release(uuid)', 'public.set_ai_opt_in(uuid,boolean,text)',
                                'private.ai_gate(text,uuid)', 'private.ai_reservation_tenant()']) f
      where has_function_privilege('anon', f, 'EXECUTE')
         or (f like 'private.%' and (has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('service_role', f, 'EXECUTE'))) $$,
  'anon executes none of the AI functions; the private helpers are executable by no API role');

select * from finish();
rollback;
