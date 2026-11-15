-- 05-12 reviewer reproductions (AI H-1/M-1/L-1/L-3, ACC M-1/L-1, IND M-1/M-2/L-2..L-7), run unchanged before the fix
-- (database at 000091) and after it (000093). Prints `label | observed`. Synthetic data only; one transaction, rolled
-- back. Run: docker exec -i supabase_db_clinicos psql -U postgres -qAt -F ' | ' < repro-05-12.sql
begin;
-- Fixtures -----------------------------------------------------------------------------------------------------------
-- A: AI clinic (trialing; trial started 02:00 IST yesterday). C: delivery, invitation and removal clinic (trialing).
-- D: referral directory target. E: an expired clinic with a shared prescription.
insert into auth.users (id, email) values
  ('d5120000-0000-4000-8000-000000000101', 'd512-owner-a@example.test'),
  ('d5120000-0000-4000-8000-000000000102', 'd512-admin-a@example.test'),
  ('d5120000-0000-4000-8000-000000000103', 'd512-doctor-a@example.test'),
  ('d5120000-0000-4000-8000-000000000104', 'd512-doctor2-a@example.test'),
  ('d5120000-0000-4000-8000-000000000105', 'd512-nurse-a@example.test'),
  ('d5120000-0000-4000-8000-000000000106', 'd512-receptionist-a@example.test'),
  ('d5120000-0000-4000-8000-000000000301', 'd512-owner-c@example.test'),
  ('d5120000-0000-4000-8000-000000000302', 'd512-admin-c@example.test'),
  ('d5120000-0000-4000-8000-000000000303', 'd512-doctor-c@example.test'),
  ('d5120000-0000-4000-8000-000000000304', 'd512-nurse-c@example.test'),
  ('d5120000-0000-4000-8000-000000000400', 'd512-owner-d@example.test'),
  ('d5120000-0000-4000-8000-000000000401', 'd512-doctor-d@example.test'),
  ('d5120000-0000-4000-8000-000000000402', 'd512-removed-doctor-d@example.test'),
  ('d5120000-0000-4000-8000-000000000500', 'd512-owner-e@example.test'),
  ('d5120000-0000-4000-8000-000000000501', 'd512-doctor-e@example.test');
insert into public.tenants (id, name, referral_directory_listed) values
  ('d5120000-0000-4000-8000-00000000000a', 'Synthetic 05-12 Repro Clinic A', false),
  ('d5120000-0000-4000-8000-00000000000c', 'Synthetic 05-12 Repro Clinic C', false),
  ('d5120000-0000-4000-8000-00000000000d', 'Synthetic 05-12 Repro Clinic D', true),
  ('d5120000-0000-4000-8000-00000000000e', 'Synthetic 05-12 Repro Clinic E', false);
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
 where tenant_id = 'd5120000-0000-4000-8000-00000000000a';
update public.tenant_subscriptions set status = 'expired', access_ends_at = now() - interval '1 day'
 where tenant_id = 'd5120000-0000-4000-8000-00000000000e';
insert into public.memberships (user_id, tenant_id, role, full_name, medical_council_reg_no) values
  ('d5120000-0000-4000-8000-000000000101', 'd5120000-0000-4000-8000-00000000000a', 'owner', null, null),
  ('d5120000-0000-4000-8000-000000000102', 'd5120000-0000-4000-8000-00000000000a', 'admin', null, null),
  ('d5120000-0000-4000-8000-000000000103', 'd5120000-0000-4000-8000-00000000000a', 'doctor', null, null),
  ('d5120000-0000-4000-8000-000000000104', 'd5120000-0000-4000-8000-00000000000a', 'doctor', null, null),
  ('d5120000-0000-4000-8000-000000000105', 'd5120000-0000-4000-8000-00000000000a', 'nurse', null, null),
  ('d5120000-0000-4000-8000-000000000106', 'd5120000-0000-4000-8000-00000000000a', 'receptionist', null, null),
  ('d5120000-0000-4000-8000-000000000301', 'd5120000-0000-4000-8000-00000000000c', 'owner', null, null),
  ('d5120000-0000-4000-8000-000000000302', 'd5120000-0000-4000-8000-00000000000c', 'admin', 'Synthetic Admin C', null),
  ('d5120000-0000-4000-8000-000000000303', 'd5120000-0000-4000-8000-00000000000c', 'doctor', 'Synthetic Doctor C', null),
  ('d5120000-0000-4000-8000-000000000304', 'd5120000-0000-4000-8000-00000000000c', 'nurse', null, null),
  ('d5120000-0000-4000-8000-000000000400', 'd5120000-0000-4000-8000-00000000000d', 'owner', null, null),
  ('d5120000-0000-4000-8000-000000000401', 'd5120000-0000-4000-8000-00000000000d', 'doctor', null, null),
  ('d5120000-0000-4000-8000-000000000402', 'd5120000-0000-4000-8000-00000000000d', 'doctor', null, null),
  ('d5120000-0000-4000-8000-000000000500', 'd5120000-0000-4000-8000-00000000000e', 'owner', null, null),
  ('d5120000-0000-4000-8000-000000000501', 'd5120000-0000-4000-8000-00000000000e', 'doctor', 'Synthetic Doctor E', 'SYN-REG-512');
update public.memberships set status = 'removed', removed_at = now()
 where user_id = 'd5120000-0000-4000-8000-000000000402' and tenant_id = 'd5120000-0000-4000-8000-00000000000d';
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('d5120000-0000-4000-8000-000000001001', 'd5120000-0000-4000-8000-00000000000a', 'Synthetic Patient A', '+919000005121', 'd5120000-0000-4000-8000-000000000101'),
  ('d5120000-0000-4000-8000-000000003001', 'd5120000-0000-4000-8000-00000000000c', 'Synthetic Patient C', '+919000005123', 'd5120000-0000-4000-8000-000000000301'),
  ('d5120000-0000-4000-8000-000000005001', 'd5120000-0000-4000-8000-00000000000e', 'Synthetic Patient E', '+919000005125', 'd5120000-0000-4000-8000-000000000500');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by) values
  ('d5120000-0000-4000-8000-000000001002', 'd5120000-0000-4000-8000-00000000000a', 'd5120000-0000-4000-8000-000000001001',
   'd5120000-0000-4000-8000-000000000103', 'walk_in', 'd5120000-0000-4000-8000-000000000101'),
  ('d5120000-0000-4000-8000-000000005002', 'd5120000-0000-4000-8000-00000000000e', 'd5120000-0000-4000-8000-000000005001',
   'd5120000-0000-4000-8000-000000000501', 'walk_in', 'd5120000-0000-4000-8000-000000000500');
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id) values
  ('d5120000-0000-4000-8000-000000005003', 'd5120000-0000-4000-8000-00000000000e', 'd5120000-0000-4000-8000-000000005002',
   'd5120000-0000-4000-8000-000000005001', 'd5120000-0000-4000-8000-000000000501');
insert into public.document_share_tokens (id, tenant_id, resource_type, resource_id, token_hash, created_by) values
  ('d5120000-0000-4000-8000-000000005004', 'd5120000-0000-4000-8000-00000000000e', 'prescription', 'd5120000-0000-4000-8000-000000005003',
   public.share_token_hash('d512-synthetic-prescription-token-for-clinic-e-01'), 'd5120000-0000-4000-8000-000000000500');
insert into public.webhook_subscriptions (id, tenant_id, endpoint_url, event_types, signing_secret, is_active, created_by) values
  ('d5120000-0000-4000-8000-000000003008', 'd5120000-0000-4000-8000-00000000000c', 'https://hooks.example.test/d512', array['ping'],
   'whsec_' || repeat('5', 48), true, 'd5120000-0000-4000-8000-000000000302');
update public.platform_settings
   set ai_features = ai_features || '{"ai.scribe": true, "ai.scribe.voice": true, "ai.voice_receptionist": true}'::jsonb where id;
insert into public.tenant_ai_settings (tenant_id, enabled, accepted_terms_version, accepted_by, accepted_at) values
  ('d5120000-0000-4000-8000-00000000000a', true, '2026-11', 'd5120000-0000-4000-8000-000000000101', now());

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
    raise exception 'd512 sentinel' using errcode = 'P0S12';
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
  select 'with i as (insert into public.ai_usage_monthly (tenant_id, period, feature, units) values (''d5120000-0000-4000-8000-00000000000a'', '
      || quote_literal(coalesce(p_period, pg_temp.trial_key())) || ', ''ai.scribe'', ' || p_units || ') returning 1) select count(*)::text from i'
$f$;
create function pg_temp.set_tz(p_zone text, p_tenant text default 'd5120000-0000-4000-8000-00000000000a') returns text language sql stable as $f$
  select 'with u as (update public.tenants set timezone = ' || quote_literal(p_zone) || ' where id = ' || quote_literal(p_tenant)
      || ' returning 1) select count(*)::text from u'
$f$;
-- Clinic A active after its trial, with an ai.scribe override of 50 drafts a month.
create function pg_temp.active_a() returns text language sql stable as $f$
  select 'with u as (update public.tenant_subscriptions set status = ''active'', trial_start = null, trial_end = null, '
      || 'current_period_start = now() - interval ''1 day'', current_period_end = now() + interval ''29 days'', '
      || 'access_ends_at = now() + interval ''30 days'' where tenant_id = ''d5120000-0000-4000-8000-00000000000a'' returning 1), '
      || 'o as (insert into public.tenant_entitlement_overrides (tenant_id, key, enabled, limit_value, reason) values '
      || '(''d5120000-0000-4000-8000-00000000000a'', ''ai.scribe'', true, null, ''Synthetic''), '
      || '(''d5120000-0000-4000-8000-00000000000a'', ''ai.scribe.monthly_drafts'', true, 50, ''Synthetic'') returning 1) '
      || 'select ((select count(*) from u) + (select count(*) from o))::text'
$f$;
create function pg_temp.lock_c() returns text language sql stable as $f$
  select 'with u as (update public.tenant_subscriptions set access_ends_at = now() - interval ''1 hour'' '
      || 'where tenant_id = ''d5120000-0000-4000-8000-00000000000c'' returning 1) select count(*)::text from u'
$f$;
create function pg_temp.renew_c() returns text language sql stable as $f$
  select 'with u as (update public.tenant_subscriptions set access_ends_at = now() + interval ''30 days'' '
      || 'where tenant_id = ''d5120000-0000-4000-8000-00000000000c'' returning 1) select count(*)::text from u'
$f$;


create temp table repro(n serial, label text, observed text);
create function pg_temp.r(p_label text, p_value text) returns void language sql as $$ insert into repro (label, observed) values (p_label, coalesce(p_value, 'NULL')) $$;

-- AI H-1 / ACC M-1: the trial pool and the clinic's time zone ------------------------------------------------------
select pg_temp.r('AI H-1 P1.0 preflight with 1,500 used in the IST trial key (expect over_quota)', pg_temp.seq(
  'postgres', pg_temp.used(1500), 'd5120000-0000-4000-8000-000000000103', $q$ select public.ai_preflight('ai.scribe', 'd5120000-0000-4000-8000-000000001002') $q$));
select pg_temp.r('AI H-1 P1.1 owner sets timezone ''-23'' through the table grant', pg_temp.seq(
  'd5120000-0000-4000-8000-000000000101', pg_temp.set_tz('-23'), 'postgres', $q$ select timezone from public.tenants where id = 'd5120000-0000-4000-8000-00000000000a' $q$));
select pg_temp.r('AI H-1 P1.2 preflight after the owner set ''-23''', pg_temp.seq(
  'postgres', pg_temp.used(1500), 'd5120000-0000-4000-8000-000000000101', pg_temp.set_tz('-23'),
  'd5120000-0000-4000-8000-000000000103', $q$ select public.ai_preflight('ai.scribe', 'd5120000-0000-4000-8000-000000001002') $q$));
select pg_temp.r('AI H-1 P1.2b preflight after the owner set the IANA zone Etc/GMT+12 (UTC-12)', pg_temp.seq(
  'postgres', pg_temp.used(1500), 'd5120000-0000-4000-8000-000000000101', pg_temp.set_tz('Etc/GMT+12'),
  'd5120000-0000-4000-8000-000000000103', $q$ select public.ai_preflight('ai.scribe', 'd5120000-0000-4000-8000-000000001002') $q$));
select pg_temp.r('AI H-1 P1.5 admin (not owner) sets ''+00''', pg_temp.seq(
  'd5120000-0000-4000-8000-000000000102', pg_temp.set_tz('+00')));
select pg_temp.r('AI H-1 P1.6 audit rows for one owner zone change', pg_temp.seq(
  'd5120000-0000-4000-8000-000000000101', pg_temp.set_tz('Etc/GMT+12'),
  'postgres', $q$ select count(*)::text from public.audit_logs where tenant_id = 'd5120000-0000-4000-8000-00000000000a' and entity_type = 'tenant' $q$));
-- Distinct trial pools reachable: the period booked by a reservation under each zone the owner may set.
create function pg_temp.pool_under(p_zone text) returns text language sql as $f$
  select pg_temp.seq('d5120000-0000-4000-8000-000000000101', pg_temp.set_tz(p_zone),
    'd5120000-0000-4000-8000-000000000103', $q$ select public.ai_reserve('ai.scribe', 'd5120000-0000-4000-8000-000000001002', 60)::text $q$,
    'postgres', $q$ select period from public.ai_quota_reservations where tenant_id = 'd5120000-0000-4000-8000-00000000000a' $q$)
$f$;
select pg_temp.r('AI H-1 distinct trial keys reachable (zones -23, Etc/GMT+12, Asia/Kolkata, Pacific/Kiritimati, +23)',
  (select string_agg(distinct v, ' ' order by v) from (select pg_temp.pool_under(z) v from unnest(array['-23', 'Etc/GMT+12', 'Asia/Kolkata', 'Pacific/Kiritimati', '+23']) z) x
    where v like 'trial:%'));
select pg_temp.r('AI H-1 pools that still answer ok with 1,500 used in the IST key (one per zone; 0 = no extra pool)',
  (select count(*)::text from unnest(array['-23', 'Etc/GMT+12', 'America/Adak', 'Pacific/Kiritimati', '+23']) z
    where pg_temp.seq('postgres', pg_temp.used(1500), 'd5120000-0000-4000-8000-000000000101', pg_temp.set_tz(z),
                      'd5120000-0000-4000-8000-000000000103', $q$ select public.ai_preflight('ai.scribe', 'd5120000-0000-4000-8000-000000001002') $q$) = 'ok'));

-- AI M-1: an expired reservation committed -----------------------------------------------------------------------------
select pg_temp.r('AI M-1 P2.4 units vs limit 1500 after committing a new and an expired reservation', pg_temp.seq(
  'postgres', pg_temp.used(1499),
  'd5120000-0000-4000-8000-000000000103', $q$ select set_config('d512.r1', public.ai_reserve('ai.scribe', 'd5120000-0000-4000-8000-000000001002', 10)::text, true) $q$,
  'postgres', $q$ with u as (update public.ai_quota_reservations set created_at = now() - interval '10 minutes', expires_at = now() - interval '1 minute' where id = current_setting('d512.r1')::uuid returning 1) select count(*)::text from u $q$,
  'd5120000-0000-4000-8000-000000000103', $q$ select set_config('d512.r2', public.ai_reserve('ai.scribe', 'd5120000-0000-4000-8000-000000001002', 10)::text, true) $q$,
  'd5120000-0000-4000-8000-000000000103', $q$ select public.ai_commit(current_setting('d512.r2')::uuid)::text $q$,
  'd5120000-0000-4000-8000-000000000103', $q$ select public.ai_commit(current_setting('d512.r1')::uuid)::text $q$));

-- IND L-6: another member commits or releases a colleague's reservation -------------------------------------------------
select pg_temp.r('IND L-6 another doctor commits the reservation', pg_temp.seq(
  'd5120000-0000-4000-8000-000000000103', $q$ select set_config('d512.r', public.ai_reserve('ai.scribe', 'd5120000-0000-4000-8000-000000001002', 60)::text, true) $q$,
  'd5120000-0000-4000-8000-000000000104', $q$ select public.ai_commit(current_setting('d512.r')::uuid)::text $q$));
select pg_temp.r('IND L-6 another doctor releases the reservation', pg_temp.seq(
  'd5120000-0000-4000-8000-000000000103', $q$ select set_config('d512.r', public.ai_reserve('ai.scribe', 'd5120000-0000-4000-8000-000000001002', 60)::text, true) $q$,
  'd5120000-0000-4000-8000-000000000104', $q$ select public.ai_release(current_setting('d512.r')::uuid)::text $q$));

-- IND L-2: the quota key of a non-scribe feature --------------------------------------------------------------------------
select pg_temp.r('IND L-2 ai.voice_receptionist with an override (enabled, 5 minutes): preflight', pg_temp.seq(
  'postgres', $q$ with o as (insert into public.tenant_entitlement_overrides (tenant_id, key, enabled, limit_value, reason) values
     ('d5120000-0000-4000-8000-00000000000a', 'ai.voice_receptionist', true, null, 'Synthetic'),
     ('d5120000-0000-4000-8000-00000000000a', 'ai.voice_receptionist.monthly_minutes', true, 5, 'Synthetic') returning 1) select count(*)::text from o $q$,
  'd5120000-0000-4000-8000-000000000103', $q$ select public.ai_preflight('ai.voice_receptionist', 'd5120000-0000-4000-8000-000000001002') $q$));
select pg_temp.r('IND L-2 ai.scribe.voice (no limit key): preflight', pg_temp.seq(
  'd5120000-0000-4000-8000-000000000103', $q$ select public.ai_preflight('ai.scribe.voice', 'd5120000-0000-4000-8000-000000001002') $q$));

-- AI L-1 / IND M-1: a cancelled reminder ------------------------------------------------------------------------------------
select pg_temp.r('AI L-1 P5.1 / IND M-1 job | last_error | queue row | document_url after the lapse and a claim', pg_temp.seq(
  'd5120000-0000-4000-8000-000000000301', $q$ select set_config('d512.q', public.enqueue_message('d5120000-0000-4000-8000-00000000000c',
      'd5120000-0000-4000-8000-000000003001', null, 'whatsapp', 'prescription_ready', 'prescription_ready',
      '{"patient_name": "Synthetic Patient C", "document_url": "https://example.test/r/synthetic"}'::jsonb, '+919000005123', null, null) ->> 'id', true) $q$,
  'postgres', pg_temp.lock_c(),
  'postgres', $q$ select count(*)::text from public.claim_jobs(array['message.send'], 100, 60, 'repro-d512', 100) $q$,
  'postgres', $q$ select j.status || ' | ' || j.last_error || ' | ' || q.status || ' | ' || (q.template_params ->> 'document_url')
                   from public.communication_queue q join ops.jobs j on j.dedupe_key = 'msg:' || q.id::text where q.id = current_setting('d512.q')::uuid $q$));
select pg_temp.r('AI L-1 P5.2-P5.4 cleanup after 8 days | renewal | backfill | the reminder claimed again', pg_temp.seq(
  'd5120000-0000-4000-8000-000000000301', $q$ select set_config('d512.q', public.enqueue_message('d5120000-0000-4000-8000-00000000000c',
      'd5120000-0000-4000-8000-000000003001', null, 'whatsapp', 'prescription_ready', 'prescription_ready',
      '{"patient_name": "Synthetic Patient C"}'::jsonb, '+919000005123', null, null) ->> 'id', true) $q$,
  'postgres', pg_temp.lock_c(),
  'postgres', $q$ select count(*)::text from public.claim_jobs(array['message.send'], 100, 60, 'repro-d512', 100) $q$,
  'postgres', $q$ with u as (update ops.jobs set finished_at = now() - interval '8 days', updated_at = now() - interval '8 days', created_at = now() - interval '8 days'
                              where dedupe_key = 'msg:' || current_setting('d512.q') returning 1) select count(*)::text from u $q$,
  'postgres', $q$ select set_config('d512.clean', (select count(*) from ops.jobs where dedupe_key = 'msg:' || current_setting('d512.q'))::text, true) $q$,
  'postgres', $q$ with d as (delete from ops.jobs where dedupe_key = 'msg:' || current_setting('d512.q') and status = 'cancelled' and finished_at < now() - interval '7 days' returning 1) select count(*)::text from d $q$,
  'postgres', pg_temp.renew_c(),
  'postgres', $q$ select set_config('d512.backfill', ops.backfill_delivery_jobs()::text, true) $q$,
  'postgres', $q$ select 'jobs deleted ' || current_setting('d512.clean') || ' | renewed | backfill created ' || current_setting('d512.backfill')
                         || ' | claimed again ' || (select count(*) from public.claim_jobs(array['message.send'], 100, 60, 'repro-d512b', 100) c
                                                      where c.payload ->> 'queue_id' = current_setting('d512.q'))::text $q$));

-- IND M-2: re-invite with another role -----------------------------------------------------------------------------------
select pg_temp.r('IND M-2 invite admin then receptionist: second answer | stored pending role | email.invite jobs', pg_temp.seq(
  'd5120000-0000-4000-8000-000000000301', $q$ select public.invite_staff('d5120000-0000-4000-8000-00000000000c', 'd512-reinvite@example.test', 'admin') ->> 'deduped' $q$,
  'd5120000-0000-4000-8000-000000000301', $q$ select set_config('d512.a', (public.invite_staff('d5120000-0000-4000-8000-00000000000c', 'd512-reinvite@example.test', 'receptionist') - 'id' - 'expires_at')::text, true) $q$,
  'postgres', $q$ select current_setting('d512.a') || ' | ' || (select role from public.invitations where invited_address = 'd512-reinvite@example.test' and revoked_at is null and consumed_at is null)
                         || ' | ' || (select count(*) from ops.jobs j join public.invitations i on j.payload ->> 'invitation_id' = i.id::text
                                       where i.invited_address = 'd512-reinvite@example.test' and j.kind = 'email.invite')::text $q$));

-- IND L-3 / ACC L-1: a removed admin's webhook subscription --------------------------------------------------------------
select pg_temp.r('IND L-3 / ACC L-1 the removed admin''s subscription: is_active | secret unchanged', pg_temp.seq(
  'd5120000-0000-4000-8000-000000000301', $q$ select public.remove_member((select id from public.memberships where user_id = 'd5120000-0000-4000-8000-000000000302'
      and tenant_id = 'd5120000-0000-4000-8000-00000000000c'), 'Synthetic removal reason')::text $q$,
  'postgres', $q$ select is_active::text || ' | ' || (signing_secret = 'whsec_' || repeat('5', 48))::text from public.webhook_subscriptions where id = 'd5120000-0000-4000-8000-000000003008' $q$));

-- IND L-5: the owner of a locked clinic removes staff -------------------------------------------------------------------
select pg_temp.r('IND L-5 the owner of a locked clinic removes a nurse', pg_temp.seq(
  'postgres', pg_temp.lock_c(),
  'postgres', $q$ select set_config('d512.m', (select id::text from public.memberships where user_id = 'd5120000-0000-4000-8000-000000000304' and tenant_id = 'd5120000-0000-4000-8000-00000000000c'), true) $q$,
  'd5120000-0000-4000-8000-000000000301', $q$ select coalesce(public.remove_member(current_setting('d512.m')::uuid, 'Synthetic dismissal') ->> 'user_id', '-') $q$,
  'postgres', $q$ select status from public.memberships where id = current_setting('d512.m')::uuid $q$));

-- IND L-7: a referral to a removed doctor --------------------------------------------------------------------------------
select pg_temp.r('IND L-7 referral to a REMOVED doctor of the target clinic', pg_temp.seq('postgres', $q$ with r as (insert into public.referrals (tenant_id, patient_id, referral_type, referring_doctor_id, referred_to_name,
    reason_for_referral, target_tenant_id, target_doctor_id) values
    ('d5120000-0000-4000-8000-00000000000a', 'd5120000-0000-4000-8000-000000001001', 'in_network', 'd5120000-0000-4000-8000-000000000103',
     'Synthetic Clinic D', 'Synthetic reason', 'd5120000-0000-4000-8000-00000000000d', 'd5120000-0000-4000-8000-000000000402') returning 1)
    select count(*)::text || ' row inserted' from r $q$));

-- IND L-4: the restricted prescription answer ---------------------------------------------------------------------------
select pg_temp.r('IND L-4 keys of the expired clinic''s prescription answer', pg_temp.seq('anon', $q$ select string_agg(k, ',' order by k) from jsonb_object_keys(
    public.resolve_share_token('d512-synthetic-prescription-token-for-clinic-e-01', array['prescription'])) k $q$));
select pg_temp.r('IND L-4 the answer contains the patient''s name', pg_temp.seq('anon', $q$ select (position('Synthetic Patient E' in
    public.resolve_share_token('d512-synthetic-prescription-token-for-clinic-e-01', array['prescription'])::text) > 0)::text $q$));

-- AI L-3: clearing a patient's objection ----------------------------------------------------------------------------------
select pg_temp.r('AI L-3 P3.4 a nurse clears the objection (rows changed)', pg_temp.seq(
  'postgres', $q$ with u as (update public.patients set ai_processing_objected = true where id = 'd5120000-0000-4000-8000-000000001001' returning 1) select count(*)::text from u $q$,
  'd5120000-0000-4000-8000-000000000105', $q$ with u as (update public.patients set ai_processing_objected = false where id = 'd5120000-0000-4000-8000-000000001001' returning 1) select count(*)::text from u $q$));
select pg_temp.r('AI L-3 P3.5 audit rows after a doctor sets and a receptionist clears it', pg_temp.seq(
  'd5120000-0000-4000-8000-000000000103', $q$ with u as (update public.patients set ai_processing_objected = true where id = 'd5120000-0000-4000-8000-000000001001' returning 1) select count(*)::text from u $q$,
  'd5120000-0000-4000-8000-000000000106', $q$ with u as (update public.patients set ai_processing_objected = false where id = 'd5120000-0000-4000-8000-000000001001' returning 1) select count(*)::text from u $q$,
  'postgres', $q$ select count(*)::text from public.audit_logs where entity_type = 'patient' and entity_id = 'd5120000-0000-4000-8000-000000001001' $q$));

select label, observed from repro order by n;
rollback;
