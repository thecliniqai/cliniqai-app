-- review_fixes_05b.test.sql — V2-05 fix plan 05-12 (05b review triage; migrations 000092, 000093).
--   1. H-AITZ: an owner or admin changing `tenants.timezone` mid-trial or mid-month opens no new AI pool (the trial key
--      is the IST date of the stored trial start, the month the IST month); the zone must be an IANA name (CHECK,
--      validated) and every change is audited.
--   2. M-AIEXP: an expired reservation cannot be committed (the reviewer's 1,499 + expired + new case ends at 1,500).
--      IND L-6: only the reserving user (or the system path) commits or releases a reservation.
--   3. IND L-2: the quota key comes from the feature's entitlement row; an unmetered AI feature is refused.
--   4. M-CANCEL: a cancelled (tenant_not_full) message.send / webhook.deliver job closes its delivery row (redacted
--      like the dead path) and backfill_delivery_jobs does not recreate it; a cancelled email.invite stays resendable.
--   5. M-REINVITE: re-inviting an address with another role replaces the pending invitation (new id, new email job).
--   6. IND L-3 / ACC L-1: removal disables the member's webhook subscriptions and rotates their secrets.
--      IND L-5: the owner of a locked clinic may still remove staff; an admin may not.
--   7. IND L-7: a referral cannot name a removed doctor of the target clinic.
--   8. IND L-4: an expired clinic's prescription link answers only the SUB-D6 verification metadata.
--   9. AI L-3: clearing a patient's AI objection is audited and limited to doctor or receptionist.
-- Synthetic data only; every probe and the file roll back.
begin;
select plan(42);

-- Fixtures -----------------------------------------------------------------------------------------------------------
-- A: AI clinic (trialing; trial started 02:00 IST yesterday). C: delivery, invitation and removal clinic (trialing).
-- D: referral directory target. E: an expired clinic with a shared prescription.
insert into auth.users (id, email) values
  ('c5120000-0000-4000-8000-000000000101', 'c512-owner-a@example.test'),
  ('c5120000-0000-4000-8000-000000000102', 'c512-admin-a@example.test'),
  ('c5120000-0000-4000-8000-000000000103', 'c512-doctor-a@example.test'),
  ('c5120000-0000-4000-8000-000000000104', 'c512-doctor2-a@example.test'),
  ('c5120000-0000-4000-8000-000000000105', 'c512-nurse-a@example.test'),
  ('c5120000-0000-4000-8000-000000000106', 'c512-receptionist-a@example.test'),
  ('c5120000-0000-4000-8000-000000000301', 'c512-owner-c@example.test'),
  ('c5120000-0000-4000-8000-000000000302', 'c512-admin-c@example.test'),
  ('c5120000-0000-4000-8000-000000000303', 'c512-doctor-c@example.test'),
  ('c5120000-0000-4000-8000-000000000304', 'c512-nurse-c@example.test'),
  ('c5120000-0000-4000-8000-000000000400', 'c512-owner-d@example.test'),
  ('c5120000-0000-4000-8000-000000000401', 'c512-doctor-d@example.test'),
  ('c5120000-0000-4000-8000-000000000402', 'c512-removed-doctor-d@example.test'),
  ('c5120000-0000-4000-8000-000000000500', 'c512-owner-e@example.test'),
  ('c5120000-0000-4000-8000-000000000501', 'c512-doctor-e@example.test');
insert into public.tenants (id, name, referral_directory_listed) values
  ('c5120000-0000-4000-8000-00000000000a', 'Synthetic 05-12 Clinic A', false),
  ('c5120000-0000-4000-8000-00000000000c', 'Synthetic 05-12 Clinic C', false),
  ('c5120000-0000-4000-8000-00000000000d', 'Synthetic 05-12 Clinic D', true),
  ('c5120000-0000-4000-8000-00000000000e', 'Synthetic 05-12 Clinic E', false);
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in (select t.id from public.tenants t where t.created_at = now()) and s.status = 'incomplete';
-- Clinic A's trial started at 02:00 IST yesterday: 20:30 UTC the day before, so a zone west of UTC−5:30 reads another
-- calendar date for the same instant (the reviewers' lever).
update public.tenant_subscriptions
   set trial_start = (date_trunc('day', now() at time zone 'Asia/Kolkata') - interval '1 day' + interval '2 hours') at time zone 'Asia/Kolkata'
 where tenant_id = 'c5120000-0000-4000-8000-00000000000a';
update public.tenant_subscriptions set status = 'expired', access_ends_at = now() - interval '1 day'
 where tenant_id = 'c5120000-0000-4000-8000-00000000000e';
insert into public.memberships (user_id, tenant_id, role, full_name, medical_council_reg_no) values
  ('c5120000-0000-4000-8000-000000000101', 'c5120000-0000-4000-8000-00000000000a', 'owner', null, null),
  ('c5120000-0000-4000-8000-000000000102', 'c5120000-0000-4000-8000-00000000000a', 'admin', null, null),
  ('c5120000-0000-4000-8000-000000000103', 'c5120000-0000-4000-8000-00000000000a', 'doctor', null, null),
  ('c5120000-0000-4000-8000-000000000104', 'c5120000-0000-4000-8000-00000000000a', 'doctor', null, null),
  ('c5120000-0000-4000-8000-000000000105', 'c5120000-0000-4000-8000-00000000000a', 'nurse', null, null),
  ('c5120000-0000-4000-8000-000000000106', 'c5120000-0000-4000-8000-00000000000a', 'receptionist', null, null),
  ('c5120000-0000-4000-8000-000000000301', 'c5120000-0000-4000-8000-00000000000c', 'owner', null, null),
  ('c5120000-0000-4000-8000-000000000302', 'c5120000-0000-4000-8000-00000000000c', 'admin', 'Synthetic Admin C', null),
  ('c5120000-0000-4000-8000-000000000303', 'c5120000-0000-4000-8000-00000000000c', 'doctor', 'Synthetic Doctor C', null),
  ('c5120000-0000-4000-8000-000000000304', 'c5120000-0000-4000-8000-00000000000c', 'nurse', null, null),
  ('c5120000-0000-4000-8000-000000000400', 'c5120000-0000-4000-8000-00000000000d', 'owner', null, null),
  ('c5120000-0000-4000-8000-000000000401', 'c5120000-0000-4000-8000-00000000000d', 'doctor', null, null),
  ('c5120000-0000-4000-8000-000000000402', 'c5120000-0000-4000-8000-00000000000d', 'doctor', null, null),
  ('c5120000-0000-4000-8000-000000000500', 'c5120000-0000-4000-8000-00000000000e', 'owner', null, null),
  ('c5120000-0000-4000-8000-000000000501', 'c5120000-0000-4000-8000-00000000000e', 'doctor', 'Synthetic Doctor E', 'SYN-REG-512');
update public.memberships set status = 'removed', removed_at = now()
 where user_id = 'c5120000-0000-4000-8000-000000000402' and tenant_id = 'c5120000-0000-4000-8000-00000000000d';
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c5120000-0000-4000-8000-000000001001', 'c5120000-0000-4000-8000-00000000000a', 'Synthetic Patient A', '+919000005121', 'c5120000-0000-4000-8000-000000000101'),
  ('c5120000-0000-4000-8000-000000003001', 'c5120000-0000-4000-8000-00000000000c', 'Synthetic Patient C', '+919000005123', 'c5120000-0000-4000-8000-000000000301'),
  ('c5120000-0000-4000-8000-000000005001', 'c5120000-0000-4000-8000-00000000000e', 'Synthetic Patient E', '+919000005125', 'c5120000-0000-4000-8000-000000000500');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by) values
  ('c5120000-0000-4000-8000-000000001002', 'c5120000-0000-4000-8000-00000000000a', 'c5120000-0000-4000-8000-000000001001',
   'c5120000-0000-4000-8000-000000000103', 'walk_in', 'c5120000-0000-4000-8000-000000000101'),
  ('c5120000-0000-4000-8000-000000005002', 'c5120000-0000-4000-8000-00000000000e', 'c5120000-0000-4000-8000-000000005001',
   'c5120000-0000-4000-8000-000000000501', 'walk_in', 'c5120000-0000-4000-8000-000000000500');
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id) values
  ('c5120000-0000-4000-8000-000000005003', 'c5120000-0000-4000-8000-00000000000e', 'c5120000-0000-4000-8000-000000005002',
   'c5120000-0000-4000-8000-000000005001', 'c5120000-0000-4000-8000-000000000501');
insert into public.document_share_tokens (id, tenant_id, resource_type, resource_id, token_hash, created_by) values
  ('c5120000-0000-4000-8000-000000005004', 'c5120000-0000-4000-8000-00000000000e', 'prescription', 'c5120000-0000-4000-8000-000000005003',
   public.share_token_hash('c512-synthetic-prescription-token-for-clinic-e-01'), 'c5120000-0000-4000-8000-000000000500');
insert into public.webhook_subscriptions (id, tenant_id, endpoint_url, event_types, signing_secret, is_active, created_by) values
  ('c5120000-0000-4000-8000-000000003008', 'c5120000-0000-4000-8000-00000000000c', 'https://hooks.example.test/c512', array['ping'],
   'whsec_' || repeat('5', 48), true, 'c5120000-0000-4000-8000-000000000302');
update public.platform_settings
   set ai_features = ai_features || '{"ai.scribe": true, "ai.scribe.voice": true, "ai.voice_receptionist": true}'::jsonb where id;
insert into public.tenant_ai_settings (tenant_id, enabled, accepted_terms_version, accepted_by, accepted_at) values
  ('c5120000-0000-4000-8000-00000000000a', true, '2026-11', 'c5120000-0000-4000-8000-000000000101', now());

-- Helpers ------------------------------------------------------------------------------------------------------------
-- Runs (who, sql) pairs in order inside one subtransaction and returns the last statement's single value. `who` is a
-- user id (authenticated, no tenant header: every user here has one clinic), 'postgres', 'anon' or 'service_role'.
-- 'denied:<msg>' (42501) / 'error:<sqlstate>:<msg>' for the first failure. Always rolled back.
create function pg_temp.seq(variadic p text[]) returns text language plpgsql as $f$
declare
  v_out text;
  i int := 1;
begin
  begin
    while i < array_length(p, 1) loop
      reset role;
      perform set_config('request.headers', '', true);
      if p[i] in ('postgres', 'anon', 'service_role') then
        perform set_config('request.jwt.claims', '', true);
        if p[i] = 'anon' then set local role anon; elsif p[i] = 'service_role' then set local role service_role; end if;
      else
        perform set_config('request.jwt.claims', json_build_object('sub', p[i], 'role', 'authenticated')::text, true);
        set local role authenticated;
      end if;
      execute p[i + 1] into v_out;
      i := i + 2;
    end loop;
    reset role;
    raise exception 'c512 sentinel' using errcode = 'P0S12';
  exception
    when sqlstate 'P0S12' then null;
    when insufficient_privilege then reset role; v_out := 'denied:' || sqlerrm;
    when others then reset role; v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;
-- Clinic A's trial pool as the fix defines it: the IST date of the stored trial start (02:00 IST yesterday).
create function pg_temp.trial_key() returns text language sql stable as
  $$ select 'trial:' || to_char(date_trunc('day', now() at time zone 'Asia/Kolkata') - interval '1 day', 'YYYY-MM-DD') $$;
create function pg_temp.used(p_units int, p_period text default null) returns text language sql stable as $f$
  select 'with i as (insert into public.ai_usage_monthly (tenant_id, period, feature, units) values (''c5120000-0000-4000-8000-00000000000a'', '
      || quote_literal(coalesce(p_period, pg_temp.trial_key())) || ', ''ai.scribe'', ' || p_units || ') returning 1) select count(*)::text from i'
$f$;
create function pg_temp.set_tz(p_zone text, p_tenant text default 'c5120000-0000-4000-8000-00000000000a') returns text language sql stable as $f$
  select 'with u as (update public.tenants set timezone = ' || quote_literal(p_zone) || ' where id = ' || quote_literal(p_tenant)
      || ' returning 1) select count(*)::text from u'
$f$;
-- Clinic A active after its trial, with an ai.scribe override of 50 drafts a month.
create function pg_temp.active_a() returns text language sql stable as $f$
  select 'with u as (update public.tenant_subscriptions set status = ''active'', trial_start = null, trial_end = null, '
      || 'current_period_start = now() - interval ''1 day'', current_period_end = now() + interval ''29 days'', '
      || 'access_ends_at = now() + interval ''30 days'' where tenant_id = ''c5120000-0000-4000-8000-00000000000a'' returning 1), '
      || 'o as (insert into public.tenant_entitlement_overrides (tenant_id, key, enabled, limit_value, reason) values '
      || '(''c5120000-0000-4000-8000-00000000000a'', ''ai.scribe'', true, null, ''Synthetic''), '
      || '(''c5120000-0000-4000-8000-00000000000a'', ''ai.scribe.monthly_drafts'', true, 50, ''Synthetic'') returning 1) '
      || 'select ((select count(*) from u) + (select count(*) from o))::text'
$f$;
create function pg_temp.lock_c() returns text language sql stable as $f$
  select 'with u as (update public.tenant_subscriptions set access_ends_at = now() - interval ''1 hour'' '
      || 'where tenant_id = ''c5120000-0000-4000-8000-00000000000c'' returning 1) select count(*)::text from u'
$f$;
create function pg_temp.renew_c() returns text language sql stable as $f$
  select 'with u as (update public.tenant_subscriptions set access_ends_at = now() + interval ''30 days'' '
      || 'where tenant_id = ''c5120000-0000-4000-8000-00000000000c'' returning 1) select count(*)::text from u'
$f$;

-- 1. H-AITZ ------------------------------------------------------------------------------------------------------------
select is(pg_temp.seq(
    'postgres', pg_temp.used(1500),
    'c5120000-0000-4000-8000-000000000101', pg_temp.set_tz('Etc/GMT+12'),
    'c5120000-0000-4000-8000-000000000103', $$ select public.ai_preflight('ai.scribe', 'c5120000-0000-4000-8000-000000001002') $$),
  'over_quota', 'H-AITZ: 1,500 trial drafts used; the OWNER moves the clinic to UTC−12 mid-trial: still over_quota (no new pool)');
select is(pg_temp.seq(
    'postgres', pg_temp.used(1500),
    'c5120000-0000-4000-8000-000000000102', pg_temp.set_tz('America/Adak'),
    'c5120000-0000-4000-8000-000000000103', $$ select public.ai_reserve('ai.scribe', 'c5120000-0000-4000-8000-000000001002', 60)::text $$),
  'error:P0001:AI_OVER_QUOTA', 'H-AITZ: the ADMIN moves the zone mid-trial: ai_reserve still raises AI_OVER_QUOTA');
select is(pg_temp.seq(
    'c5120000-0000-4000-8000-000000000101', pg_temp.set_tz('Etc/GMT+12'),
    'c5120000-0000-4000-8000-000000000103', $$ select public.ai_reserve('ai.scribe', 'c5120000-0000-4000-8000-000000001002', 60)::text $$,
    'postgres', $$ select period from public.ai_quota_reservations where tenant_id = 'c5120000-0000-4000-8000-00000000000a' $$),
  pg_temp.trial_key(), 'H-AITZ: after a zone change the reservation is booked to the IST date of the stored trial start');
select is(pg_temp.seq(
    'postgres', pg_temp.active_a(),
    'c5120000-0000-4000-8000-000000000101', pg_temp.set_tz('Etc/GMT+12'),
    'postgres', $$ select private.ai_period('c5120000-0000-4000-8000-00000000000a', '2026-11-30 20:00:00+00') $$),
  '2026-12', 'H-AITZ: at 20:00 UTC on 30 Nov (1 Dec IST) a UTC−12 clinic is metered in the IST month 2026-12');
select is(pg_temp.seq(
    'postgres', pg_temp.active_a(),
    'c5120000-0000-4000-8000-000000000101', pg_temp.set_tz('Pacific/Kiritimati'),
    'postgres', $$ select private.ai_period('c5120000-0000-4000-8000-00000000000a', '2026-11-30 17:00:00+00') $$),
  '2026-11', 'H-AITZ: at 17:00 UTC on 30 Nov (still 30 Nov IST) a UTC+14 clinic is metered in the IST month 2026-11');
select is(pg_temp.seq(
    'postgres', pg_temp.active_a(),
    'postgres', pg_temp.used(50, to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM')),
    'c5120000-0000-4000-8000-000000000101', pg_temp.set_tz('Etc/GMT+12'),
    'c5120000-0000-4000-8000-000000000101', pg_temp.set_tz('Pacific/Kiritimati'),
    'c5120000-0000-4000-8000-000000000103', $$ select public.ai_preflight('ai.scribe', 'c5120000-0000-4000-8000-000000001002') $$),
  'over_quota', 'H-AITZ: an override clinic at its 50 monthly drafts stays over_quota after zone changes mid-month');
select is(pg_temp.seq('postgres', $$ select private.ai_period('c5120000-0000-4000-8000-00000000000a', now()) $$), pg_temp.trial_key(),
  'H-AITZ: the trial period is trial:<IST date of the stored trial_start>');
select is(pg_temp.seq(
    'c5120000-0000-4000-8000-000000000101', pg_temp.set_tz('Not/AZone')),
  'error:23514:new row for relation "tenants" violates check constraint "tenants_timezone_iana"',
  'H-AITZ: an unknown zone name is refused (CHECK tenants_timezone_iana)');
select is(pg_temp.seq('c5120000-0000-4000-8000-000000000101', pg_temp.set_tz('+05:30'))
          || '/' || pg_temp.seq('c5120000-0000-4000-8000-000000000101', pg_temp.set_tz('IST'))
          || '/' || pg_temp.seq('c5120000-0000-4000-8000-000000000101', pg_temp.set_tz('')),
  'error:23514:new row for relation "tenants" violates check constraint "tenants_timezone_iana"/'
  || 'error:23514:new row for relation "tenants" violates check constraint "tenants_timezone_iana"/'
  || 'error:23514:new row for relation "tenants" violates check constraint "tenants_timezone_iana"',
  'H-AITZ: an offset, an abbreviation that is not a zone name, and a blank are refused');
select is(pg_temp.seq('c5120000-0000-4000-8000-000000000101', pg_temp.set_tz('asia/kolkata')),
  '1', 'H-AITZ: a zone name in another case is accepted (as tenant_local_date and Intl read it)');
select is(pg_temp.seq(
    'c5120000-0000-4000-8000-000000000101', pg_temp.set_tz('Etc/GMT+12'),
    'postgres', $$ select string_agg(action || '|' || actor_id || '|' || actor_role || '|' || actor_type || '|' || (metadata ->> 'from') || '|' || (metadata ->> 'to'), ',')
                     from public.audit_logs where tenant_id = 'c5120000-0000-4000-8000-00000000000a' and entity_type = 'tenant' $$),
  'clinic.timezone_changed|c5120000-0000-4000-8000-000000000101|owner|user|Asia/Kolkata|Etc/GMT+12',
  'H-AITZ: the zone change is audited (actor, role, old and new zone)');
select ok((select convalidated from pg_constraint where conname = 'tenants_timezone_iana' and conrelid = 'public.tenants'::regclass),
  'H-AITZ: the CHECK is validated (000093): every existing clinic holds an IANA zone');

-- 2. M-AIEXP and IND L-6 -------------------------------------------------------------------------------------------------
select is(pg_temp.seq(
    'postgres', pg_temp.used(3),
    'c5120000-0000-4000-8000-000000000103', $$ select set_config('c512.rid', public.ai_reserve('ai.scribe', 'c5120000-0000-4000-8000-000000001002', 60)::text, true) $$,
    'postgres', $$ with u as (update public.ai_quota_reservations set created_at = now() - interval '10 minutes', expires_at = now() - interval '1 minute'
                               where id = current_setting('c512.rid')::uuid returning 1) select count(*)::text from u $$,
    'c5120000-0000-4000-8000-000000000103', $$ select public.ai_commit(current_setting('c512.rid')::uuid)::text $$),
  'error:P0001:AI_RESERVATION_EXPIRED', 'M-AIEXP: committing a reservation that has expired raises AI_RESERVATION_EXPIRED');
select is(pg_temp.seq(
    'postgres', pg_temp.used(1499),
    'c5120000-0000-4000-8000-000000000103', $$ select set_config('c512.r1', public.ai_reserve('ai.scribe', 'c5120000-0000-4000-8000-000000001002', 10)::text, true) $$,
    'postgres', $$ with u as (update public.ai_quota_reservations set created_at = now() - interval '10 minutes', expires_at = now() - interval '1 minute'
                               where id = current_setting('c512.r1')::uuid returning 1) select count(*)::text from u $$,
    'c5120000-0000-4000-8000-000000000103', $$ select set_config('c512.r2', public.ai_reserve('ai.scribe', 'c5120000-0000-4000-8000-000000001002', 10)::text, true) $$,
    'c5120000-0000-4000-8000-000000000103', $$ select public.ai_commit(current_setting('c512.r2')::uuid)::text $$,
    'c5120000-0000-4000-8000-000000000103', $$ select public.ai_commit(current_setting('c512.r1')::uuid)::text $$),
  'error:P0001:AI_RESERVATION_EXPIRED',
  'M-AIEXP (reviewer P2): 1,499 used + a reservation that expired; a new one commits (1,500), the expired one is refused (before: 1,501)');
select is(pg_temp.seq(
    'postgres', pg_temp.used(1499),
    'c5120000-0000-4000-8000-000000000103', $$ select set_config('c512.rid', public.ai_reserve('ai.scribe', 'c5120000-0000-4000-8000-000000001002', 10)::text, true) $$,
    'c5120000-0000-4000-8000-000000000103', $$ select public.ai_commit(current_setting('c512.rid')::uuid)::text $$),
  '1500', 'M-AIEXP: a live reservation at 1,499 commits to exactly the limit');
select is(pg_temp.seq(
    'c5120000-0000-4000-8000-000000000103', $$ select set_config('c512.rid', public.ai_reserve('ai.scribe', 'c5120000-0000-4000-8000-000000001002', 60)::text, true) $$,
    'postgres', $$ select created_by::text from public.ai_quota_reservations where id = current_setting('c512.rid')::uuid $$),
  'c5120000-0000-4000-8000-000000000103', 'IND L-6: ai_reserve records the reserving user');
select is(pg_temp.seq(
    'c5120000-0000-4000-8000-000000000103', $$ select set_config('c512.rid', public.ai_reserve('ai.scribe', 'c5120000-0000-4000-8000-000000001002', 60)::text, true) $$,
    'c5120000-0000-4000-8000-000000000104', $$ select public.ai_commit(current_setting('c512.rid')::uuid)::text $$),
  'error:P0002:AI_RESERVATION_NOT_FOUND', 'IND L-6: another doctor of the clinic cannot commit the reservation');
select is(pg_temp.seq(
    'c5120000-0000-4000-8000-000000000103', $$ select set_config('c512.rid', public.ai_reserve('ai.scribe', 'c5120000-0000-4000-8000-000000001002', 60)::text, true) $$,
    'c5120000-0000-4000-8000-000000000104', $$ select public.ai_release(current_setting('c512.rid')::uuid)::text $$,
    'postgres', $$ select count(*)::text from public.ai_quota_reservations where id = current_setting('c512.rid')::uuid $$),
  '1', 'IND L-6: another doctor of the clinic cannot release it either (it stays)');
select is(pg_temp.seq(
    'postgres', pg_temp.used(7),
    'c5120000-0000-4000-8000-000000000103', $$ select set_config('c512.rid', public.ai_reserve('ai.scribe', 'c5120000-0000-4000-8000-000000001002', 60)::text, true) $$,
    'service_role', $$ select public.ai_commit(current_setting('c512.rid')::uuid)::text $$),
  '8', 'IND L-6: the system path (service_role session) commits any reservation');

-- 3. IND L-2 / I-5: the quota key ---------------------------------------------------------------------------------------
select is(pg_temp.seq(
    'c5120000-0000-4000-8000-000000000103', $$ select public.ai_preflight('ai.scribe.voice', 'c5120000-0000-4000-8000-000000001002') $$),
  'error:P0001:AI_QUOTA_NOT_CONFIGURED', 'IND L-2: an AI feature without a quota key is refused as not configured (not a silent over_quota)');
select is(pg_temp.seq(
    'postgres', $$ with o as (insert into public.tenant_entitlement_overrides (tenant_id, key, enabled, limit_value, reason) values
                   ('c5120000-0000-4000-8000-00000000000a', 'ai.voice_receptionist', true, null, 'Synthetic'),
                   ('c5120000-0000-4000-8000-00000000000a', 'ai.voice_receptionist.monthly_minutes', true, 5, 'Synthetic') returning 1)
                   select count(*)::text from o $$,
    'c5120000-0000-4000-8000-000000000103', $$ select public.ai_preflight('ai.voice_receptionist', 'c5120000-0000-4000-8000-000000001002') $$),
  'ok', 'IND L-2: a feature metered by another limit key (voice minutes) reads its own limit: ok, not over_quota');
select is(pg_temp.seq('postgres', $$ select string_agg(key || '>' || quota_key, ',' order by key) from public.entitlement_keys where quota_key is not null $$),
  'ai.scribe>ai.scribe.monthly_drafts,ai.voice_receptionist>ai.voice_receptionist.monthly_minutes',
  'IND L-2: the quota keys of the catalogue');

-- 4. M-CANCEL ----------------------------------------------------------------------------------------------------------
select is(pg_temp.seq(
    'c5120000-0000-4000-8000-000000000301', $$ select set_config('c512.qid', public.enqueue_message('c5120000-0000-4000-8000-00000000000c',
        'c5120000-0000-4000-8000-000000003001', null, 'whatsapp', 'prescription_ready', 'prescription_ready',
        '{"patient_name": "Synthetic Patient C", "document_url": "https://example.test/r/synthetic"}'::jsonb, '+919000005123', null, null) ->> 'id', true) $$,
    'postgres', pg_temp.lock_c(),
    'postgres', $$ select count(*)::text from public.claim_jobs(array['message.send'], 100, 60, 'pgtap-c512', 100) $$,
    'postgres', $$ select j.status || '|' || j.last_error || '|' || q.status || '|' || coalesce(q.error_message, '-') || '|' || (q.template_params ->> 'document_url')
                     from public.communication_queue q join ops.jobs j on j.dedupe_key = 'msg:' || q.id::text
                    where q.id = current_setting('c512.qid')::uuid $$),
  'cancelled|tenant_not_full|cancelled|job_cancelled:tenant_not_full|[redacted]',
  'M-CANCEL: a reminder enqueued through enqueue_message, then the clinic locks: the job is cancelled and the queue row closed and scrubbed');
select is(pg_temp.seq(
    'c5120000-0000-4000-8000-000000000301', $$ select set_config('c512.qid', public.enqueue_message('c5120000-0000-4000-8000-00000000000c',
        'c5120000-0000-4000-8000-000000003001', null, 'whatsapp', 'appointment_booked', 'appointment_booked',
        '{"patient_name": "Synthetic Patient C"}'::jsonb, '+919000005123', null, null) ->> 'id', true) $$,
    'postgres', pg_temp.lock_c(),
    'postgres', $$ select count(*)::text from public.claim_jobs(array['message.send'], 100, 60, 'pgtap-c512', 100) $$,
    'postgres', $$ with d as (delete from ops.jobs where dedupe_key = 'msg:' || current_setting('c512.qid') returning 1) select count(*)::text from d $$,
    'postgres', pg_temp.renew_c(),
    'postgres', $$ select ops.backfill_delivery_jobs()::text $$,
    'postgres', $$ select (select count(*) from ops.jobs where dedupe_key = 'msg:' || current_setting('c512.qid'))::text || '|'
                          || (select status from public.communication_queue where id = current_setting('c512.qid')::uuid) $$),
  '0|cancelled', 'M-CANCEL: after cleanup and a renewal, backfill_delivery_jobs does not recreate the closed reminder');
select is(pg_temp.seq(
    'c5120000-0000-4000-8000-000000000301', $$ select set_config('c512.wid', public.enqueue_webhook_event('c5120000-0000-4000-8000-00000000000c', 'ping',
        'c5120000-0000-4000-8000-000000003008', 'c5120000-0000-4000-8000-000000003008') -> 'delivery_ids' ->> 0, true) $$,
    'postgres', pg_temp.lock_c(),
    'postgres', $$ select count(*)::text from public.claim_jobs(array['webhook.deliver'], 100, 60, 'pgtap-c512', 100) $$,
    'postgres', $$ with d as (delete from ops.jobs where dedupe_key = 'wh:' || current_setting('c512.wid') returning 1) select count(*)::text from d $$,
    'postgres', pg_temp.renew_c(),
    'postgres', $$ select ops.backfill_delivery_jobs()::text $$,
    'postgres', $$ select w.status || '|' || coalesce(w.last_error, '-') || '|' || (select count(*) from ops.jobs j where j.dedupe_key = 'wh:' || w.id::text)
                     from public.webhook_delivery_queue w where w.id = current_setting('c512.wid')::uuid $$),
  'failed|job_cancelled:tenant_not_full|0', 'M-CANCEL: a cancelled webhook delivery is closed (failed) and not recreated by the backfill');
select is(pg_temp.seq(
    'c5120000-0000-4000-8000-000000000301', $$ select set_config('c512.iid', public.invite_staff('c5120000-0000-4000-8000-00000000000c', 'c512-cancelled-invite@example.test', 'nurse') ->> 'id', true) $$,
    'postgres', pg_temp.lock_c(),
    'postgres', $$ select count(*)::text from public.claim_jobs(array['email.invite'], 100, 60, 'pgtap-c512', 100) $$,
    'postgres', pg_temp.renew_c(),
    'c5120000-0000-4000-8000-000000000301', $$ select public.resend_invitation(current_setting('c512.iid')::uuid) ->> 'token_version' $$,
    'postgres', $$ select string_agg(replace(j.dedupe_key, current_setting('c512.iid'), 'ID') || ':' || j.status, ',' order by j.dedupe_key)
                          || '|' || (select (revoked_at is null and consumed_at is null)::text
                                       from public.invitations where id = current_setting('c512.iid')::uuid)
                     from ops.jobs j where j.payload ->> 'invitation_id' = current_setting('c512.iid') $$),
  'invite:ID:v1:cancelled,invite:ID:v2:pending|true',
  'M-CANCEL: a cancelled email.invite leaves the invitation pending; after renewal it is resent (version 2, a new job)');

-- 5. M-REINVITE --------------------------------------------------------------------------------------------------------
select is(pg_temp.seq(
    'c5120000-0000-4000-8000-000000000301', $$ select set_config('c512.first', public.invite_staff('c5120000-0000-4000-8000-00000000000c', 'c512-reinvite@example.test', 'admin') ->> 'id', true) $$,
    'c5120000-0000-4000-8000-000000000301', $$ select set_config('c512.second', (public.invite_staff('c5120000-0000-4000-8000-00000000000c', 'c512-reinvite@example.test', 'receptionist') - 'id' - 'expires_at')::text, true) $$,
    'postgres', $$ select current_setting('c512.second') || '|'
                          || (select string_agg(role || ':' || (revoked_at is not null)::text, ',' order by created_at, role)
                                from public.invitations where tenant_id = 'c5120000-0000-4000-8000-00000000000c' and invited_address = 'c512-reinvite@example.test') || '|'
                          || (select count(*) from ops.jobs j join public.invitations i on j.payload ->> 'invitation_id' = i.id::text
                               where i.invited_address = 'c512-reinvite@example.test' and j.kind = 'email.invite')::text $$),
  '{"deduped": false, "replaced_role": "admin"}|admin:true,receptionist:false|2',
  'M-REINVITE: re-inviting as receptionist replaces the pending admin invitation (revoked), a new one is created and emailed');
select is(pg_temp.seq(
    'c5120000-0000-4000-8000-000000000301', $$ select set_config('c512.first', public.invite_staff('c5120000-0000-4000-8000-00000000000c', 'c512-same@example.test', 'nurse') ->> 'id', true) $$,
    'c5120000-0000-4000-8000-000000000301', $$ select ((public.invite_staff('c5120000-0000-4000-8000-00000000000c', 'c512-same@example.test', 'nurse') ->> 'id') = current_setting('c512.first'))::text
                                               || '/' || (public.invite_staff('c5120000-0000-4000-8000-00000000000c', 'c512-same@example.test', 'nurse') ->> 'deduped') $$),
  'true/true', 'M-REINVITE: the same address and role is still deduped (same invitation, no new email)');
select is(pg_temp.seq(
    'c5120000-0000-4000-8000-000000000301', $$ select public.invite_staff('c5120000-0000-4000-8000-00000000000c', 'c512-pending-admin@example.test', 'admin') ->> 'deduped' $$,
    'c5120000-0000-4000-8000-000000000302', $$ select public.invite_staff('c5120000-0000-4000-8000-00000000000c', 'c512-pending-admin@example.test', 'nurse')::text $$),
  'denied:OWNER_REQUIRED', 'M-REINVITE: an admin cannot replace a pending admin invitation (revoking it is owner-only)');
select is(pg_temp.seq(
    'c5120000-0000-4000-8000-000000000301', $$ select public.invite_staff('c5120000-0000-4000-8000-00000000000c', 'c512-audit@example.test', 'doctor') ->> 'deduped' $$,
    'c5120000-0000-4000-8000-000000000301', $$ select public.invite_staff('c5120000-0000-4000-8000-00000000000c', 'c512-audit@example.test', 'nurse') ->> 'replaced_role' $$,
    'postgres', $$ select string_agg(a.action || ':' || coalesce(a.metadata ->> 'replaced_by_role', a.metadata ->> 'replaced_role', '-'), ',' order by a.id)
                     from public.audit_logs a join public.invitations i on i.id = a.entity_id
                    where i.invited_address = 'c512-audit@example.test' $$),
  'staff.invited:-,staff.invite_revoked:nurse,staff.invited:doctor',
  'M-REINVITE: the replacement is audited (revocation names the new role, the new invitation the replaced one)');

-- 6. remove_member: webhooks (IND L-3, ACC L-1) and the owner of a locked clinic (IND L-5) -------------------------------
select is(pg_temp.seq(
    'c5120000-0000-4000-8000-000000000301', $$ select (public.remove_member((select id from public.memberships where user_id = 'c5120000-0000-4000-8000-000000000302'
        and tenant_id = 'c5120000-0000-4000-8000-00000000000c'), 'Synthetic removal reason') ->> 'webhooks_disabled') $$,
    'postgres', $$ select (select (metadata ->> 'webhooks_disabled') from public.audit_logs where tenant_id = 'c5120000-0000-4000-8000-00000000000c' and action = 'staff.removed')
                          || '|' || is_active::text || '|' || (signing_secret <> 'whsec_' || repeat('5', 48))::text || '|' || (signing_secret ~ '^whsec_[0-9a-f]{48}$')::text
                     from public.webhook_subscriptions where id = 'c5120000-0000-4000-8000-000000003008' $$),
  '1|false|true|true', 'IND L-3: removing the admin disables their webhook subscription, rotates its secret, and audits the count');
-- The membership id is read as postgres: a locked clinic's owner reads no other membership row (RLS, 05-10a).
create function pg_temp.nurse_c_id() returns text language sql stable as $f$
  select 'select set_config(''c512.mid'', (select id::text from public.memberships where user_id = ''c5120000-0000-4000-8000-000000000304'' '
      || 'and tenant_id = ''c5120000-0000-4000-8000-00000000000c''), true)'
$f$;
select is(pg_temp.seq(
    'postgres', pg_temp.lock_c(),
    'postgres', pg_temp.nurse_c_id(),
    'c5120000-0000-4000-8000-000000000301', $$ select (public.remove_member(current_setting('c512.mid')::uuid, 'Synthetic dismissal') ->> 'user_id') $$,
    'postgres', $$ select status || '|' || (select actor_role from public.audit_logs where tenant_id = 'c5120000-0000-4000-8000-00000000000c' and action = 'staff.removed')
                     from public.memberships where user_id = 'c5120000-0000-4000-8000-000000000304' $$),
  'removed|owner', 'IND L-5: the owner of a LOCKED clinic removes a nurse (same rules, audited)');
select is(pg_temp.seq(
    'postgres', pg_temp.lock_c(),
    'postgres', pg_temp.nurse_c_id(),
    'c5120000-0000-4000-8000-000000000302', $$ select public.remove_member(current_setting('c512.mid')::uuid, 'Synthetic dismissal')::text $$),
  'error:P0002:MEMBER_NOT_FOUND', 'IND L-5: an admin of a locked clinic still cannot remove staff');

-- 7. IND L-7: the referral target doctor must be active ----------------------------------------------------------------
select is(pg_temp.seq('postgres', $$ with r as (insert into public.referrals (tenant_id, patient_id, referral_type, referring_doctor_id, referred_to_name,
                                                   reason_for_referral, target_tenant_id, target_doctor_id) values
    ('c5120000-0000-4000-8000-00000000000a', 'c5120000-0000-4000-8000-000000001001', 'in_network', 'c5120000-0000-4000-8000-000000000103',
     'Synthetic Clinic D', 'Synthetic reason', 'c5120000-0000-4000-8000-00000000000d', 'c5120000-0000-4000-8000-000000000402') returning 1)
    select count(*)::text from r $$),
  'error:P0001:REFERRAL_TARGET_DOCTOR_INVALID', 'IND L-7: a referral to a REMOVED doctor of the target clinic is refused');
select is(pg_temp.seq('postgres', $$ with r as (insert into public.referrals (tenant_id, patient_id, referral_type, referring_doctor_id, referred_to_name,
                                                   reason_for_referral, target_tenant_id, target_doctor_id) values
    ('c5120000-0000-4000-8000-00000000000a', 'c5120000-0000-4000-8000-000000001001', 'in_network', 'c5120000-0000-4000-8000-000000000103',
     'Synthetic Clinic D', 'Synthetic reason', 'c5120000-0000-4000-8000-00000000000d', 'c5120000-0000-4000-8000-000000000401') returning 1)
    select count(*)::text from r $$),
  '1', 'IND L-7: an active doctor of the target clinic is accepted');

-- 8. IND L-4: SUB-D6 verification metadata ------------------------------------------------------------------------------
select is(pg_temp.seq('anon', $$ select string_agg(k, ',' order by k) from jsonb_object_keys(
    public.resolve_share_token('c512-synthetic-prescription-token-for-clinic-e-01', array['prescription'])) k $$),
  'access,clinic,resource_type,restricted,status,verification',
  'IND L-4: the expired clinic''s prescription answers only status, restricted, access, type, clinic and verification');
select is(pg_temp.seq(
    'anon', $$ select set_config('c512.share', public.resolve_share_token('c512-synthetic-prescription-token-for-clinic-e-01', array['prescription'])::text, true) $$,
    'postgres', $$ select ((r -> 'verification') - 'issued_on')::text || '|' || (r -> 'clinic')::text || '|'
                          || ((r -> 'verification' ->> 'issued_on') = to_char(public.tenant_local_date('c5120000-0000-4000-8000-00000000000e', now()), 'YYYY-MM-DD'))::text
                     from (select current_setting('c512.share')::jsonb r) x $$),
  '{"valid": true, "doctor_name": "Synthetic Doctor E", "doctor_registration_number": "SYN-REG-512"}|{"name": "Synthetic 05-12 Clinic E"}|true',
  'IND L-4: verification = valid, doctor name, registration number, issue date; clinic = name only');
select is(pg_temp.seq('anon', $$ select (position('Synthetic Patient E' in r::text) = 0 and r ? 'restricted' and not (r ? 'patient_name')
                                          and not (r ? 'original_filename') and not (r ? 'title'))::text
    from public.resolve_share_token('c512-synthetic-prescription-token-for-clinic-e-01', array['prescription']) r $$),
  'true', 'IND L-4: no patient name, title or file name in the restricted answer');

-- 9. AI L-3: the patient objection ---------------------------------------------------------------------------------------
create function pg_temp.objected() returns text language sql stable as $f$
  select 'with u as (update public.patients set ai_processing_objected = true where id = ''c5120000-0000-4000-8000-000000001001'' returning 1) select count(*)::text from u'
$f$;
create function pg_temp.clear() returns text language sql stable as $f$
  select 'with u as (update public.patients set ai_processing_objected = false where id = ''c5120000-0000-4000-8000-000000001001'' returning 1) select count(*)::text from u'
$f$;
select is(pg_temp.seq('postgres', pg_temp.objected(), 'c5120000-0000-4000-8000-000000000105', pg_temp.clear()),
  'denied:AI_OBJECTION_CLEAR_FORBIDDEN', 'AI L-3: a nurse cannot clear a patient''s AI objection');
select is(pg_temp.seq('postgres', pg_temp.objected(), 'c5120000-0000-4000-8000-000000000101', pg_temp.clear())
          || '/' || pg_temp.seq('postgres', pg_temp.objected(), 'c5120000-0000-4000-8000-000000000102', pg_temp.clear()),
  'denied:AI_OBJECTION_CLEAR_FORBIDDEN/denied:AI_OBJECTION_CLEAR_FORBIDDEN', 'AI L-3: nor can the owner or an admin (AI §4.6: doctor or receptionist)');
select is(pg_temp.seq(
    'postgres', pg_temp.objected(),
    'c5120000-0000-4000-8000-000000000106', pg_temp.clear(),
    'postgres', $$ select string_agg(action || '|' || coalesce(actor_id::text, '-') || '|' || actor_role || '|' || metadata::text, ',' order by id)
                     from public.audit_logs where entity_type = 'patient' and entity_id = 'c5120000-0000-4000-8000-000000001001' $$),
  'patient.ai_objection.set|-|system|{},patient.ai_objection.cleared|c5120000-0000-4000-8000-000000000106|receptionist|{}',
  'AI L-3: a receptionist clears it; setting and clearing are both audited (actor, no PHI)');
select is(pg_temp.seq(
    'c5120000-0000-4000-8000-000000000103', pg_temp.objected(),
    'c5120000-0000-4000-8000-000000000103', pg_temp.clear(),
    'postgres', $$ select string_agg(action || '|' || actor_role, ',' order by id)
                     from public.audit_logs where entity_type = 'patient' and entity_id = 'c5120000-0000-4000-8000-000000001001' $$),
  'patient.ai_objection.set|doctor,patient.ai_objection.cleared|doctor', 'AI L-3: the doctor sets and clears it, audited');

select * from finish();
rollback;
