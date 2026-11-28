-- today_signals.test.sql — V2-08 08-03a (R-10, T-08-01; migration 000102), revised by 09E-04 (R-18; migration 000123).
-- The live signals: PHI-free private broadcasts on today:<tenant_id>, written by private.clinic_bump from the statement triggers of
-- 000123 (visits, queue_tokens, invoices, invoice_items, payments, clinical_notes vitals, ...), read through one SELECT policy on realtime.messages.
--   1. objects: the helper, the sender, the bump, the statement triggers (shapes), the policy, no INSERT policy;
--   2. the policy's test (authz.today_topic_allowed): member of the topic's clinic, active, appointments:view, clinic
--      access level full; every other topic shape refused; no active-clinic header needed;
--   3. payloads: a signal is {domain, version} and nothing else (realtime.send adds the message id), on the clinic's own topic;
--   4. a failing send does not abort the clinical write.
-- Which table and column moves which domain, once per transaction, rollback and counts: clinic_versions.test.sql.
-- Delivery over a real socket is in tests/realtime/today-signals.spec.ts. Synthetic data only; the file rolls back.
begin;
select plan(31);

insert into auth.users (id, email) values
  ('c1020000-0000-4000-8000-000000000101', 'c102-owner-a@example.test'),
  ('c1020000-0000-4000-8000-000000000102', 'c102-doctor-a@example.test'),
  ('c1020000-0000-4000-8000-000000000104', 'c102-receptionist-a@example.test'),
  ('c1020000-0000-4000-8000-000000000105', 'c102-nurse-a@example.test'),
  ('c1020000-0000-4000-8000-000000000201', 'c102-owner-b@example.test'),
  ('c1020000-0000-4000-8000-000000000301', 'c102-dual@example.test');
insert into public.tenants (id, name) values
  ('c1020000-0000-4000-8000-00000000000a', 'Synthetic 000102 Clinic A'),
  ('c1020000-0000-4000-8000-00000000000b', 'Synthetic 000102 Clinic B');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1020000-0000-4000-8000-00000000000a', 'c1020000-0000-4000-8000-00000000000b') and s.status = 'incomplete';
insert into public.memberships (user_id, tenant_id, role) values
  ('c1020000-0000-4000-8000-000000000101', 'c1020000-0000-4000-8000-00000000000a', 'owner'),
  ('c1020000-0000-4000-8000-000000000102', 'c1020000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1020000-0000-4000-8000-000000000104', 'c1020000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c1020000-0000-4000-8000-000000000105', 'c1020000-0000-4000-8000-00000000000a', 'nurse'),
  ('c1020000-0000-4000-8000-000000000201', 'c1020000-0000-4000-8000-00000000000b', 'owner'),
  ('c1020000-0000-4000-8000-000000000301', 'c1020000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c1020000-0000-4000-8000-000000000301', 'c1020000-0000-4000-8000-00000000000b', 'receptionist');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1020000-0000-4000-8000-000000001001', 'c1020000-0000-4000-8000-00000000000a', 'Synthetic Patient One', '+919000010001', 'c1020000-0000-4000-8000-000000000101');

-- The helper's answer for `p_topic` as `p_user`, with NO active-clinic header (a Realtime socket has none).
create function pg_temp.allowed(p_user uuid, p_topic text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '', true);
  begin
    set local role authenticated;
    v_out := authz.today_topic_allowed(p_topic)::text;
    reset role;
  exception when others then
    reset role; v_out := 'error:' || sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$f$;

-- 1. Objects ------------------------------------------------------------------------------------------------------------
select is(
  (select p.prosecdef::text || ':' || p.provolatile::text || ':' || array_to_string(p.proconfig, ',') from pg_proc p
    where p.oid = 'authz.today_topic_allowed(text)'::regprocedure),
  'true:s:search_path=""', 'authz.today_topic_allowed is a STABLE definer function with search_path pinned');
select is(
  (select string_agg(a.grantee::regrole::text, ',' order by a.grantee::regrole::text)
     from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.oid = 'authz.today_topic_allowed(text)'::regprocedure and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner),
  'authenticated', 'EXECUTE: authenticated only (no PUBLIC, anon or service_role grant)');
select is(
  (select string_agg(p.oid::regprocedure::text || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ','), ';' order by p.oid::regprocedure::text)
     from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('clinic_bump', 'today_signal_send')),
  'private.clinic_bump(uuid[],text):true:search_path="";private.today_signal_send(uuid,text,bigint):true:search_path=""',
  'the bump and the sender are definer functions with search_path pinned');
select is(
  (select count(*)::int from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.pronamespace = 'private'::regnamespace and (p.proname in ('clinic_bump', 'today_signal_send') or p.proname like 'cv\_%')
      and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner),
  0, 'neither the bump, the sender nor any statement trigger function has an API grant');

select is(
  (select count(*)::int from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = 'today_signal'), 0,
  'the 000102 row trigger function private.today_signal() is gone (000123)');
select is(
  (select count(*)::int from pg_trigger t where not t.tgisinternal and t.tgname like '%today\_signal%'), 0,
  'no row-level *_today_signal* trigger remains (000123)');
select is(
  (select count(*)::int from pg_trigger t join pg_proc f on f.oid = t.tgfoid
    where not t.tgisinternal and f.pronamespace = 'private'::regnamespace and f.proname like 'cv\_%'
      and (t.tgtype & 1) = 0 and (t.tgtype & 2) = 0 and (t.tgtype & 64) = 0),
  27, 'the 27 statement triggers (22 of 000123, 5 of 000127): AFTER, FOR EACH STATEMENT, one event each');

select is(
  (select string_agg(p.polcmd::text || ':' || coalesce((select string_agg(r.rolname, ',') from pg_roles r where r.oid = any (p.polroles)), 'public'), ';')
     from pg_policy p where p.polrelid = 'realtime.messages'::regclass),
  'r:authenticated', 'realtime.messages has exactly one policy: SELECT for authenticated (no INSERT or ALL policy)');
select matches(
  (select pg_get_expr(p.polqual, p.polrelid) from pg_policy p where p.polrelid = 'realtime.messages'::regclass and p.polname = 'today_signals_select'),
  'extension = ''broadcast''::text\) AND \(topic = realtime\.topic\(\)\) AND authz\.today_topic_allowed\(topic\)',
  'the policy admits only broadcast messages whose own topic is the session topic and passes the helper (000106, S-7)');

-- 2. The helper ---------------------------------------------------------------------------------------------------------
select is(pg_temp.allowed('c1020000-0000-4000-8000-000000000104', 'today:c1020000-0000-4000-8000-00000000000a'), 'true', 'a receptionist of A may read today:<A>');
select is(pg_temp.allowed('c1020000-0000-4000-8000-000000000105', 'today:c1020000-0000-4000-8000-00000000000a'), 'true', 'a nurse of A may read today:<A>');
select is(pg_temp.allowed('c1020000-0000-4000-8000-000000000102', 'today:c1020000-0000-4000-8000-00000000000a'), 'true', 'a doctor of A may read today:<A>');
select is(pg_temp.allowed('c1020000-0000-4000-8000-000000000101', 'today:c1020000-0000-4000-8000-00000000000a'), 'true', 'the owner of A may read today:<A>');
select is(pg_temp.allowed('c1020000-0000-4000-8000-000000000201', 'today:c1020000-0000-4000-8000-00000000000a'), 'false', 'the owner of B may not read today:<A>');
select is(pg_temp.allowed('c1020000-0000-4000-8000-000000000301', 'today:c1020000-0000-4000-8000-00000000000a'), 'true', 'a member of both clinics reads today:<A> without any active-clinic header');
select is(pg_temp.allowed('c1020000-0000-4000-8000-000000000301', 'today:c1020000-0000-4000-8000-00000000000b'), 'true', 'and today:<B> too: the topic names the clinic');
select is(
  (select string_agg(pg_temp.allowed('c1020000-0000-4000-8000-000000000104', t), ',' order by t) from unnest(array[
     'today:C1020000-0000-4000-8000-00000000000A', 'today:*', 'today:', 'today', '',
     'today:c1020000-0000-4000-8000-00000000000a:x', 'xtoday:c1020000-0000-4000-8000-00000000000a',
     'other:c1020000-0000-4000-8000-00000000000a', 'today:c1020000-0000-4000-8000-00000000000a%',
     'today:c1020000-0000-4000-8000-00000000000a ']) t),
  'false,false,false,false,false,false,false,false,false,false', 'every topic of another shape is refused (case, wildcard, suffix, prefix, empty)');
select is(authz.today_topic_allowed(null), false, 'a null topic is refused');
select is(
  (select authz.today_topic_allowed('today:c1020000-0000-4000-8000-00000000000a')), false, 'no session (no auth.uid()): refused');
select is(
  (select coalesce(pg_temp.allowed('c1020000-0000-4000-8000-000000000999', 'today:c1020000-0000-4000-8000-00000000000a'), 'x')), 'false', 'a user without any membership is refused');

update public.memberships set status = 'suspended'
 where user_id = 'c1020000-0000-4000-8000-000000000104' and tenant_id = 'c1020000-0000-4000-8000-00000000000a';
select is(pg_temp.allowed('c1020000-0000-4000-8000-000000000104', 'today:c1020000-0000-4000-8000-00000000000a'), 'false', 'a suspended member is refused');
update public.memberships set status = 'removed', removed_at = now()
 where user_id = 'c1020000-0000-4000-8000-000000000105' and tenant_id = 'c1020000-0000-4000-8000-00000000000a';
select is(pg_temp.allowed('c1020000-0000-4000-8000-000000000105', 'today:c1020000-0000-4000-8000-00000000000a'), 'false', 'a removed member is refused');

update public.tenant_subscriptions set status = 'expired', access_ends_at = now() - interval '1 day'
 where tenant_id = 'c1020000-0000-4000-8000-00000000000b';
select is(pg_temp.allowed('c1020000-0000-4000-8000-000000000201', 'today:c1020000-0000-4000-8000-00000000000b'), 'false', 'a member of a locked clinic is refused');
select is(pg_temp.allowed('c1020000-0000-4000-8000-000000000101', 'today:c1020000-0000-4000-8000-00000000000a'), 'true', 'a clinic that is not locked is unaffected');

-- 3. Payloads -----------------------------------------------------------------------------------------------------------
-- One transaction: each domain is raised once (the first statement), so the whole sequence below sends one signal per domain.
update public.clinic_versions set last_xact = null;
delete from realtime.messages;
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1020000-0000-4000-8000-000000002001', 'c1020000-0000-4000-8000-00000000000a', 'c1020000-0000-4000-8000-000000001001',
   'c1020000-0000-4000-8000-000000000102', 'walk_in', 'booked', 'c1020000-0000-4000-8000-000000000101');
update public.visits set status = 'waiting' where id = 'c1020000-0000-4000-8000-000000002001';
insert into public.queue_tokens (tenant_id, visit_id, token_number, date, priority) values
  ('c1020000-0000-4000-8000-00000000000a', 'c1020000-0000-4000-8000-000000002001', 1, current_date, 'normal');
update public.clinical_notes set vitals = '{"pulse": 72}'::jsonb where visit_id = 'c1020000-0000-4000-8000-000000002001';
insert into public.invoices (id, tenant_id, visit_id, patient_id, invoice_number, total_amount) values
  ('c1020000-0000-4000-8000-000000003001', 'c1020000-0000-4000-8000-00000000000a', 'c1020000-0000-4000-8000-000000002001',
   'c1020000-0000-4000-8000-000000001001', 'INV-C102-1', 100);
insert into public.payments (tenant_id, invoice_id, amount, payment_method, recorded_by) values
  ('c1020000-0000-4000-8000-00000000000a', 'c1020000-0000-4000-8000-000000003001', 100, 'cash', 'c1020000-0000-4000-8000-000000000101');

select set_eq(
  $$ select payload->>'domain' from realtime.messages where topic = 'today:c1020000-0000-4000-8000-00000000000a' $$,
  $$ values ('queue'), ('schedule'), ('billing') $$,
  'the visit, token, vitals, invoice and payment writes of one transaction signal the queue, schedule and billing domains');
select is(
  (select count(*)::int from realtime.messages where topic = 'today:c1020000-0000-4000-8000-00000000000a'), 3,
  'three messages: one per domain, not one per row');
select is(
  (select count(*)::int from realtime.messages m where m.topic = 'today:c1020000-0000-4000-8000-00000000000a'
      and (select array_agg(k order by k) from jsonb_object_keys(m.payload) as t(k)) = array['domain', 'id', 'version']
      and m.payload->>'id' = m.id::text
      and (m.payload->>'version')::bigint = (select v.version from public.clinic_versions v
                                              where v.tenant_id = 'c1020000-0000-4000-8000-00000000000a' and v.domain = m.payload->>'domain')),
  3, 'every payload has exactly the keys domain and version (the version in the table), plus the message''s own random id that realtime.send adds');
select is(
  (select string_agg(distinct m.extension || ':' || m.private::text || ':' || m.event, ',') from realtime.messages m where m.topic = 'today:c1020000-0000-4000-8000-00000000000a'),
  'broadcast:true:today', 'every message is a private broadcast with the event name today');
select is(
  (select count(*)::int from realtime.messages where topic = 'today:c1020000-0000-4000-8000-00000000000b'), 0, 'nothing was sent on the other clinic''s topic');

delete from realtime.messages where topic = 'today:c1020000-0000-4000-8000-00000000000a';
update public.clinic_versions set last_xact = null;
update public.visits set reason_for_visit = 'synthetic' where id = 'c1020000-0000-4000-8000-000000002001';
select is((select count(*)::int from realtime.messages where topic = 'today:c1020000-0000-4000-8000-00000000000a'), 0,
  'a write that leaves every listed column alone sends nothing (the once-per-transaction marker was cleared first)');

-- 4. A failing send never aborts the write -----------------------------------------------------------------------------
create or replace function private.today_signal_send(p_tenant_id uuid, p_domain text, p_version bigint)
returns void language plpgsql security definer set search_path = '' as $f$
begin
  raise exception 'synthetic realtime fault';
end;
$f$;
update public.clinic_versions set last_xact = null;
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1020000-0000-4000-8000-000000002002', 'c1020000-0000-4000-8000-00000000000a', 'c1020000-0000-4000-8000-000000001001',
   'c1020000-0000-4000-8000-000000000102', 'walk_in', 'booked', 'c1020000-0000-4000-8000-000000000101');
update public.visits set status = 'waiting' where id = 'c1020000-0000-4000-8000-000000002002';
select is((select status from public.visits where id = 'c1020000-0000-4000-8000-000000002002'), 'waiting',
  'with the sender failing, the visit insert and the status change still commit');

select * from finish();
rollback;
