-- clinic_versions.test.sql — V2-09e 09E-04 (R-18, R-19; migration 000123; threats T-09E-05, T-09E-06).
-- Clinic versions and the live signal: one version per clinic and domain, raised once per transaction by statement-level triggers,
-- one PHI-free signal {domain, version} per clinic, domain and transaction.
--   1. grants and RLS: a member reads only their clinic's versions; nobody writes; anon reads nothing;
--   2. a transaction that inserts 20 visits of A and 3 of B raises each clinic's schedule and queue by exactly 1 and writes exactly one
--      message per clinic and domain (payload keys domain and version only); a second transaction raises by 2; a rolled-back one leaves
--      versions and messages unchanged;
--   3. every table and event maps to the domains listed in the plan, and a column that is not listed moves nothing;
--   4. a failing send does not roll back the write;
--   5. row_version moves only on the listed columns and a written value is overridden;
--   6. clinic_live_state: the four versions and the access level for a member; NULL for another clinic, a non-member and no clinic.
-- A pgTAP file is one transaction: `pg_temp.fresh()` clears the once-per-transaction marker (last_xact) and the messages, which is what a
-- new transaction would find (tests/realtime/today-signals.spec.ts proves two real transactions over the wire). Synthetic data only.
begin;
select plan(107);

insert into auth.users (id, email) values
  ('c1230000-0000-4000-8000-000000000101', 'c123-owner-a@example.test'),
  ('c1230000-0000-4000-8000-000000000102', 'c123-doctor-a@example.test'),
  ('c1230000-0000-4000-8000-000000000201', 'c123-owner-b@example.test'),
  ('c1230000-0000-4000-8000-000000000301', 'c123-outsider@example.test');
insert into public.tenants (id, name) values
  ('c1230000-0000-4000-8000-00000000000a', 'Synthetic 000123 Clinic A'),
  ('c1230000-0000-4000-8000-00000000000b', 'Synthetic 000123 Clinic B'),
  ('c1230000-0000-4000-8000-00000000000c', 'Synthetic 000123 Clinic C (locked)');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-00000000000b') and s.status = 'incomplete';
insert into public.memberships (user_id, tenant_id, role) values
  ('c1230000-0000-4000-8000-000000000101', 'c1230000-0000-4000-8000-00000000000a', 'owner'),
  ('c1230000-0000-4000-8000-000000000102', 'c1230000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1230000-0000-4000-8000-000000000201', 'c1230000-0000-4000-8000-00000000000b', 'owner'),
  ('c1230000-0000-4000-8000-000000000101', 'c1230000-0000-4000-8000-00000000000c', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1230000-0000-4000-8000-000000001001', 'c1230000-0000-4000-8000-00000000000a', 'Synthetic Patient A', '+919000012301', 'c1230000-0000-4000-8000-000000000101'),
  ('c1230000-0000-4000-8000-000000001002', 'c1230000-0000-4000-8000-00000000000b', 'Synthetic Patient B', '+919000012302', 'c1230000-0000-4000-8000-000000000201');

-- A new transaction as far as the bump can tell: the marker cleared, the messages gone.
create function pg_temp.fresh() returns void language sql as $f$
  update public.clinic_versions set last_xact = null;
  delete from realtime.messages;
$f$;
create function pg_temp.vers(p_tenant uuid) returns text language sql as $f$
  select string_agg(domain || '=' || version, ',' order by domain) from public.clinic_versions where tenant_id = p_tenant
$f$;
-- Runs `p_sql` as a new transaction would and returns the domains of clinic A whose version rose (and the signals' domains, which must agree).
create function pg_temp.moved(p_sql text) returns text language plpgsql as $f$
declare
  v_before jsonb; v_after jsonb; v_moved text; v_sent text;
begin
  perform pg_temp.fresh();
  select jsonb_object_agg(domain, version) into v_before from public.clinic_versions where tenant_id = 'c1230000-0000-4000-8000-00000000000a';
  execute p_sql;
  select jsonb_object_agg(domain, version) into v_after from public.clinic_versions where tenant_id = 'c1230000-0000-4000-8000-00000000000a';
  select coalesce(string_agg(k, ',' order by k), '-') into v_moved from jsonb_object_keys(v_after) k where v_after->k is distinct from v_before->k;
  select coalesce(string_agg(payload->>'domain', ',' order by payload->>'domain'), '-') into v_sent
    from realtime.messages where topic = 'today:c1230000-0000-4000-8000-00000000000a';
  return case when v_moved = v_sent then v_moved else 'MISMATCH moved=' || v_moved || ' sent=' || v_sent end;
end;
$f$;
create function pg_temp.as_user(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '', true);
  begin
    set local role authenticated;
    execute p_sql into v_out;
    reset role;
  exception when others then
    reset role; v_out := 'error:' || sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$f$;

-- 1. Grants and RLS ---------------------------------------------------------------------------------------------------------
select is((select relrowsecurity from pg_class where oid = 'public.clinic_versions'::regclass), true, 'RLS is on');
select is(
  (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
     from pg_class c cross join lateral aclexplode(c.relacl) a where c.oid = 'public.clinic_versions'::regclass and a.grantee <> c.relowner),
  'authenticated:SELECT', 'the only grant is SELECT for authenticated (no anon, no service_role, no write)');
select is(
  (select string_agg(p.polcmd::text || ':' || coalesce((select string_agg(r.rolname, ',') from pg_roles r where r.oid = any (p.polroles)), 'public'), ';')
     from pg_policy p where p.polrelid = 'public.clinic_versions'::regclass),
  'r:authenticated', 'one policy: SELECT for authenticated');
select matches(
  (select pg_get_expr(p.polqual, p.polrelid) from pg_policy p where p.polrelid = 'public.clinic_versions'::regclass),
  'authz\.member_tenant_ids', 'the policy is bound to the caller''s own clinics (authz.member_tenant_ids)');
select is((select count(*)::int from public.clinic_versions where tenant_id = 'c1230000-0000-4000-8000-00000000000a'), 4, 'a new clinic has its four rows (the tenants trigger)');
select is((select string_agg(domain || '=' || version, ',' order by domain) from public.clinic_versions where tenant_id = 'c1230000-0000-4000-8000-00000000000b' and domain in ('billing', 'queue')),
  'billing=0,queue=0', 'a clinic that nothing touched sits at version 0');
select is((select count(*)::int from public.tenants t where (select count(*) from public.clinic_versions v where v.tenant_id = t.id) <> 4), 0,
  'every clinic has exactly four rows (existing clinics were backfilled)');
select throws_ok($$ insert into public.clinic_versions (tenant_id, domain) values ('c1230000-0000-4000-8000-00000000000a', 'billing') $$, '23505', null, 'a duplicate (clinic, domain) is refused');
select throws_ok($$ insert into public.clinic_versions (tenant_id, domain) select id, 'patients' from public.tenants limit 1 $$, '23514', null, 'a domain outside the four is refused');

select is(pg_temp.as_user('c1230000-0000-4000-8000-000000000102',
  $$ select count(*)::text from public.clinic_versions $$), '4', 'a doctor of A reads exactly the four rows of A (not B, not C)');
select is(pg_temp.as_user('c1230000-0000-4000-8000-000000000102',
  $$ select count(*)::text from public.clinic_versions where tenant_id = 'c1230000-0000-4000-8000-00000000000b' $$), '0', 'and none of clinic B');
select is(pg_temp.as_user('c1230000-0000-4000-8000-000000000301',
  $$ select count(*)::text from public.clinic_versions $$), '0', 'a user with no membership reads nothing');
select is(pg_temp.as_user('c1230000-0000-4000-8000-000000000101',
  $$ select count(*)::text from public.clinic_versions $$), '8', 'an owner of two clinics reads both (A and the locked C: the lock does not hide versions, so a locked device learns it)');
select is(pg_temp.as_user('c1230000-0000-4000-8000-000000000102',
  $$ with u as (update public.clinic_versions set version = 99 returning 1) select count(*)::text from u $$), 'error:42501', 'a member cannot update a version');
select is(pg_temp.as_user('c1230000-0000-4000-8000-000000000102',
  $$ with d as (delete from public.clinic_versions returning 1) select count(*)::text from d $$), 'error:42501', 'a member cannot delete a version');
select is(pg_temp.as_user('c1230000-0000-4000-8000-000000000102',
  $$ with i as (insert into public.clinic_versions (tenant_id, domain) values ('c1230000-0000-4000-8000-00000000000a', 'billing') returning 1) select count(*)::text from i $$), 'error:42501', 'a member cannot insert one');
select is((select count(*)::int from public.clinic_versions where version = 99), 0, 'no version was changed by the attempts');
select throws_ok($$ set local role anon; select count(*) from public.clinic_versions $$, '42501', null, 'anon cannot read');
reset role;

-- 2. One signal per clinic, domain and transaction -----------------------------------------------------------------------------
select pg_temp.fresh();
create temp table c123_before as select tenant_id, domain, version from public.clinic_versions;
grant select on c123_before to public;
insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, status, created_by, scheduled_at)
select 'c1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000001001', 'c1230000-0000-4000-8000-000000000102', 'walk_in', 'booked',
       'c1230000-0000-4000-8000-000000000101', now() + (g || ' minutes')::interval from generate_series(1, 20) g;
insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, status, created_by)
select 'c1230000-0000-4000-8000-00000000000b', 'c1230000-0000-4000-8000-000000001002', 'c1230000-0000-4000-8000-000000000201', 'walk_in', 'booked',
       'c1230000-0000-4000-8000-000000000201' from generate_series(1, 3);
select is(
  (select string_agg(v.tenant_id::text || ':' || v.domain || '+' || (v.version - b.version), ',' order by v.tenant_id, v.domain)
     from public.clinic_versions v join c123_before b using (tenant_id, domain)
    where v.version <> b.version and v.tenant_id in ('c1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-00000000000b')),
  'c1230000-0000-4000-8000-00000000000a:queue+1,c1230000-0000-4000-8000-00000000000a:schedule+1,c1230000-0000-4000-8000-00000000000b:queue+1,c1230000-0000-4000-8000-00000000000b:schedule+1',
  '20 visits of A and 3 of B in one transaction raise each clinic''s queue and schedule by exactly 1 (billing and settings do not move)');
select is((select count(*)::int from realtime.messages where topic = 'today:c1230000-0000-4000-8000-00000000000a'), 2, 'exactly two messages for A (queue, schedule), not 20');
select is((select count(*)::int from realtime.messages where topic = 'today:c1230000-0000-4000-8000-00000000000b'), 2, 'exactly two messages for B');
select is((select count(*)::int from realtime.messages), 4, 'four messages in all: one per clinic and domain');
select is(
  (select count(*)::int from realtime.messages m
    where (select array_agg(k order by k) from jsonb_object_keys(m.payload) as t(k)) = array['domain', 'id', 'version']
      and m.payload->>'id' = m.id::text and m.extension = 'broadcast' and m.private and m.event = 'today'),
  4, 'every payload has exactly the keys domain and version (plus the message''s own random id), a private broadcast named today');
select is(
  (select count(*)::int from realtime.messages m join public.clinic_versions v
      on v.tenant_id = substr(m.topic, 7)::uuid and v.domain = m.payload->>'domain' and v.version = (m.payload->>'version')::bigint),
  4, 'each signal carries the version the table holds');

-- A second transaction: +2 in all. A rolled-back one: nothing.
select pg_temp.fresh();
update public.visits set status = 'waiting' where tenant_id = 'c1230000-0000-4000-8000-00000000000a' and status = 'booked';
select is(
  (select string_agg(v.domain || '+' || (v.version - b.version), ',' order by v.domain)
     from public.clinic_versions v join c123_before b using (tenant_id, domain)
    where v.version <> b.version and v.tenant_id = 'c1230000-0000-4000-8000-00000000000a'),
  'queue+2,schedule+2', 'a second transaction raises each of them by one more (2 in all)');
select is((select count(*)::int from realtime.messages where topic = 'today:c1230000-0000-4000-8000-00000000000a'), 2, 'and sent its own two messages (20 rows updated, still 2)');

select pg_temp.fresh();
create temp table c123_mid as select tenant_id, domain, version from public.clinic_versions;
savepoint rolled;
insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, status, created_by)
values ('c1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000001001', 'c1230000-0000-4000-8000-000000000102', 'walk_in', 'booked', 'c1230000-0000-4000-8000-000000000101');
select cmp_ok((select count(*)::int from realtime.messages), '>', 0, 'inside the transaction the write has raised the versions and written messages');
rollback to savepoint rolled;
select is((select count(*)::int from realtime.messages), 0, 'a rolled-back write leaves no message');
select is(
  (select count(*)::int from public.clinic_versions v join c123_mid b using (tenant_id, domain) where v.version <> b.version or v.last_xact is not null),
  0, 'and leaves every version and marker as it was');

-- 3. Every table and event ------------------------------------------------------------------------------------------------------
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1230000-0000-4000-8000-000000002001', 'c1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000001001',
   'c1230000-0000-4000-8000-000000000102', 'walk_in', 'booked', 'c1230000-0000-4000-8000-000000000101');
select is(pg_temp.moved($$ insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1230000-0000-4000-8000-000000002002', 'c1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000001001',
   'c1230000-0000-4000-8000-000000000102', 'walk_in', 'booked', 'c1230000-0000-4000-8000-000000000101') $$), 'queue,schedule', 'visits insert -> queue, schedule');
select is(pg_temp.moved($$ update public.visits set status = 'waiting' where id = 'c1230000-0000-4000-8000-000000002001' $$), 'queue,schedule', 'visits status -> queue, schedule');
select is(pg_temp.moved($$ update public.visits set scheduled_at = now() + interval '3 hours' where id = 'c1230000-0000-4000-8000-000000002001' $$), 'schedule', 'visits scheduled_at -> schedule');
select is(pg_temp.moved($$ update public.visits set doctor_id = 'c1230000-0000-4000-8000-000000000101' where id = 'c1230000-0000-4000-8000-000000002001' $$), 'schedule', 'visits doctor_id -> schedule');
select is(pg_temp.moved($$ update public.visits set estimated_duration_minutes = 45 where id = 'c1230000-0000-4000-8000-000000002001' $$), 'schedule', 'visits estimated_duration_minutes -> schedule');
select is(pg_temp.moved($$ update public.visits set is_overbooked = true where id = 'c1230000-0000-4000-8000-000000002001' $$), 'schedule', 'visits is_overbooked -> schedule');
select is(pg_temp.moved($$ update public.visits set origin_type = 'scheduled', scheduled_at = now() + interval '3 hours' where id = 'c1230000-0000-4000-8000-000000002001' $$), 'schedule', 'visits origin_type -> schedule');
select is(pg_temp.moved($$ update public.visits set reason_for_visit = 'synthetic', metadata = '{"k": 1}'::jsonb, updated_at = now() where id = 'c1230000-0000-4000-8000-000000002001' $$), '-', 'visits reason_for_visit, metadata, updated_at (not listed) -> nothing');
select is(pg_temp.moved($$ update public.visits set status = status where id = 'c1230000-0000-4000-8000-000000002001' $$), '-', 'visits: a listed column written with its own value -> nothing');
select is(pg_temp.moved($$ update public.visits set status = 'cancelled' where id = 'c1230000-0000-4000-8000-0000000099ff' $$), '-', 'visits: a statement that touched no row -> nothing');

select is(pg_temp.moved($$ insert into public.queue_tokens (id, tenant_id, visit_id, token_number, date, priority) values
  ('c1230000-0000-4000-8000-000000004001', 'c1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000002001', 1, current_date, 'normal') $$), 'queue', 'queue_tokens insert -> queue');
select is(pg_temp.moved($$ update public.queue_tokens set called_at = now() where id = 'c1230000-0000-4000-8000-000000004001' $$), 'queue', 'queue_tokens update -> queue');
select is(pg_temp.moved($$ update public.clinical_notes set vitals = '{"pulse": 80}'::jsonb where visit_id = 'c1230000-0000-4000-8000-000000002001' $$), 'queue', 'clinical_notes vitals -> queue');
select is(pg_temp.moved($$ update public.clinical_notes set clinical_notes = 'synthetic note', advice = array['rest'] where visit_id = 'c1230000-0000-4000-8000-000000002001' $$), '-', 'clinical_notes: any other column -> nothing');

select is(pg_temp.moved($$ insert into public.invoices (id, tenant_id, visit_id, patient_id, invoice_number, total_amount) values
  ('c1230000-0000-4000-8000-000000003001', 'c1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000002001', 'c1230000-0000-4000-8000-000000001001', 'INV-C123-1', 100) $$), 'billing', 'invoices insert -> billing');
select is(pg_temp.moved($$ update public.invoices set total_amount = 120 where id = 'c1230000-0000-4000-8000-000000003001' $$), 'billing', 'invoices total_amount -> billing');
select is(pg_temp.moved($$ update public.invoices set status = 'cancelled' where id = 'c1230000-0000-4000-8000-000000003001' $$), 'billing', 'invoices status -> billing');
select is(pg_temp.moved($$ update public.invoices set discount = 5, updated_at = now() where id = 'c1230000-0000-4000-8000-000000003001' $$), '-', 'invoices discount, updated_at (not listed for the signal) -> nothing');
select is(pg_temp.moved($$ insert into public.invoice_items (id, tenant_id, invoice_id, item_type, description, unit_price, quantity, total_price) values
  ('c1230000-0000-4000-8000-000000005001', 'c1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000003001', 'consultation', 'Synthetic item', 50, 1, 50) $$), 'billing', 'invoice_items insert -> billing');
select is(pg_temp.moved($$ update public.invoice_items set description = 'Synthetic item 2' where id = 'c1230000-0000-4000-8000-000000005001' $$), 'billing', 'invoice_items update -> billing');
select is(pg_temp.moved($$ delete from public.invoice_items where id = 'c1230000-0000-4000-8000-000000005001' $$), 'billing', 'invoice_items delete -> billing');
select is(pg_temp.moved($$ insert into public.payments (id, tenant_id, invoice_id, amount, payment_method, recorded_by) values
  ('c1230000-0000-4000-8000-000000006001', 'c1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000003001', 10, 'cash', 'c1230000-0000-4000-8000-000000000101') $$), 'billing', 'payments insert -> billing');
select is(pg_temp.moved($$ update public.payments set notes = 'synthetic' where id = 'c1230000-0000-4000-8000-000000006001' $$), 'billing', 'payments update -> billing');

select is(pg_temp.moved($$ insert into public.schedule_blocks (id, tenant_id, doctor_id, start_time, end_time, created_by) values
  ('c1230000-0000-4000-8000-000000007001', 'c1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000000102', '2030-01-01T09:00:00Z', '2030-01-01T10:00:00Z', 'c1230000-0000-4000-8000-000000000101') $$), 'schedule', 'schedule_blocks insert -> schedule');
select is(pg_temp.moved($$ update public.schedule_blocks set reason = 'synthetic' where id = 'c1230000-0000-4000-8000-000000007001' $$), 'schedule', 'schedule_blocks update -> schedule');
select is(pg_temp.moved($$ delete from public.schedule_blocks where id = 'c1230000-0000-4000-8000-000000007001' $$), 'schedule', 'schedule_blocks delete -> schedule');
select is(pg_temp.moved($$ insert into public.waitlist_entries (id, tenant_id, patient_id, target_date, created_by) values
  ('c1230000-0000-4000-8000-000000008001', 'c1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000001001', '2030-01-01', 'c1230000-0000-4000-8000-000000000101') $$), 'schedule', 'waitlist_entries insert -> schedule');
select is(pg_temp.moved($$ update public.waitlist_entries set notes = 'synthetic' where id = 'c1230000-0000-4000-8000-000000008001' $$), 'schedule', 'waitlist_entries update -> schedule');
select is(pg_temp.moved($$ delete from public.waitlist_entries where id = 'c1230000-0000-4000-8000-000000008001' $$), 'schedule', 'waitlist_entries delete -> schedule');

select is(pg_temp.moved($$ insert into public.memberships (user_id, tenant_id, role) values ('c1230000-0000-4000-8000-000000000301', 'c1230000-0000-4000-8000-00000000000a', 'receptionist') $$), 'schedule,settings', 'memberships insert -> schedule, settings');
select is(pg_temp.moved($$ update public.memberships set default_slot_duration_minutes = 25 where user_id = 'c1230000-0000-4000-8000-000000000102' and tenant_id = 'c1230000-0000-4000-8000-00000000000a' $$), 'schedule,settings', 'memberships default_slot_duration_minutes -> schedule, settings');
select is(pg_temp.moved($$ update public.memberships set availability_schedule = jsonb_build_object('monday', '{"enabled": true, "shifts": [{"start": "09:00", "end": "17:00"}]}'::jsonb) where user_id = 'c1230000-0000-4000-8000-000000000102' and tenant_id = 'c1230000-0000-4000-8000-00000000000a' $$), 'schedule,settings', 'memberships availability_schedule -> schedule, settings');
select is(pg_temp.moved($$ update public.memberships set full_name = 'Synthetic Doctor' where user_id = 'c1230000-0000-4000-8000-000000000102' and tenant_id = 'c1230000-0000-4000-8000-00000000000a' $$), 'schedule,settings', 'memberships full_name -> schedule, settings');
select is(pg_temp.moved($$ update public.memberships set role = 'nurse' where user_id = 'c1230000-0000-4000-8000-000000000301' and tenant_id = 'c1230000-0000-4000-8000-00000000000a' $$), 'schedule,settings', 'memberships role -> schedule, settings');
select is(pg_temp.moved($$ update public.memberships set status = 'suspended' where user_id = 'c1230000-0000-4000-8000-000000000301' and tenant_id = 'c1230000-0000-4000-8000-00000000000a' $$), 'schedule,settings', 'memberships status -> schedule, settings');
select is(pg_temp.moved($$ update public.memberships set phone = '+919000099999', qualifications = 'MBBS', default_specialty = 'general' where user_id = 'c1230000-0000-4000-8000-000000000102' and tenant_id = 'c1230000-0000-4000-8000-00000000000a' $$), '-', 'memberships phone, qualifications, default_specialty (not listed) -> nothing');
select is(pg_temp.moved($$ delete from public.memberships where user_id = 'c1230000-0000-4000-8000-000000000301' and tenant_id = 'c1230000-0000-4000-8000-00000000000a' $$), 'schedule,settings', 'memberships delete -> schedule, settings');

select is(pg_temp.moved($$ update public.tenants set name = 'Synthetic 000123 Clinic A2' where id = 'c1230000-0000-4000-8000-00000000000a' $$), 'settings', 'tenants name -> settings');
select is(pg_temp.moved($$ update public.tenants set timezone = 'Asia/Kolkata', rx_paper_size = 'A5' where id = 'c1230000-0000-4000-8000-00000000000a' $$), 'settings', 'tenants rx_paper_size -> settings');
select is(pg_temp.moved($$ update public.tenants set address = 'Synthetic address 1' where id = 'c1230000-0000-4000-8000-00000000000a' $$), 'settings', 'tenants address (shown on the letterhead) -> settings');
select is(pg_temp.moved($$ update public.tenants set default_consultation_fee = 700, default_followup_fee = 300, specialties = array['general'], accepted_payment_methods = array['cash'] where id = 'c1230000-0000-4000-8000-00000000000a' $$), '-', 'tenants fees, specialties, payment methods (not listed) -> nothing');
select is(pg_temp.moved($$ update public.tenants set updated_at = now() where id = 'c1230000-0000-4000-8000-00000000000b' $$), '-', 'tenants of another clinic, updated_at only -> nothing');
select is(pg_temp.moved($$ update public.tenants set name = 'Synthetic 000123 Clinic B2' where id = 'c1230000-0000-4000-8000-00000000000b' $$), '-', 'a change in clinic B moves nothing in A (A''s versions and A''s topic stay as they were)');
select is((select count(*)::int from realtime.messages where topic = 'today:c1230000-0000-4000-8000-00000000000b'), 1, 'and B has its own one signal');

select is(pg_temp.moved($$ with t as (insert into public.tenants (id, name) values ('c1230000-0000-4000-8000-0000000000d1', 'Synthetic 000123 Clinic D') returning id) select 1 $$), '-', 'a new clinic does not move A');
select is((select count(*)::int from public.clinic_versions where tenant_id = 'c1230000-0000-4000-8000-0000000000d1'), 4, 'and gets its own four rows');
select lives_ok($$ delete from public.tenants where id = 'c1230000-0000-4000-8000-0000000000d1' $$, 'deleting a clinic (its members and rows cascade) does not fail on its version rows');
select is((select count(*)::int from public.clinic_versions where tenant_id = 'c1230000-0000-4000-8000-0000000000d1'), 0, 'and takes the rows with it');

-- 4. A failing send never aborts the write --------------------------------------------------------------------------------------
select pg_temp.fresh();
create or replace function private.today_signal_send(p_tenant_id uuid, p_domain text, p_version bigint)
returns void language plpgsql security definer set search_path = '' as $f$
begin
  raise exception 'synthetic realtime fault';
end;
$f$;
select lives_ok($$ insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1230000-0000-4000-8000-000000002003', 'c1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000001001',
   'c1230000-0000-4000-8000-000000000102', 'walk_in', 'booked', 'c1230000-0000-4000-8000-000000000101') $$, 'with the sender failing, the visit insert still commits');
select is((select count(*)::int from public.visits where id = 'c1230000-0000-4000-8000-000000002003'), 1, 'the row is there');
select is((select count(*)::int from realtime.messages), 0, 'no message was written (the send failed)');
select cmp_ok((select version from public.clinic_versions where tenant_id = 'c1230000-0000-4000-8000-00000000000a' and domain = 'queue')::int, '>', 0, 'the version still rose (a device that missed the signal learns it from the next check)');

-- 5. Row versions ---------------------------------------------------------------------------------------------------------------------
select is((select row_version::text from public.visits where id = 'c1230000-0000-4000-8000-000000002003'), '0', 'a new visit starts at row_version 0');
update public.visits set status = 'waiting' where id = 'c1230000-0000-4000-8000-000000002003';
select is((select row_version::text from public.visits where id = 'c1230000-0000-4000-8000-000000002003'), '1', 'a status change raises it by 1');
update public.visits set scheduled_at = now() + interval '1 day', doctor_id = 'c1230000-0000-4000-8000-000000000101', is_overbooked = true where id = 'c1230000-0000-4000-8000-000000002003';
select is((select row_version::text from public.visits where id = 'c1230000-0000-4000-8000-000000002003'), '2', 'several listed columns in one update raise it once');
update public.visits set metadata = '{"reminder_sent": true}'::jsonb, reason_for_visit = 'synthetic', updated_at = now() where id = 'c1230000-0000-4000-8000-000000002003';
select is((select row_version::text from public.visits where id = 'c1230000-0000-4000-8000-000000002003'), '2', 'metadata, reason_for_visit and updated_at do not move it');
update public.visits set reason_for_visit = 'synthetic 2', row_version = 99 where id = 'c1230000-0000-4000-8000-000000002003';
select is((select row_version::text from public.visits where id = 'c1230000-0000-4000-8000-000000002003'), '2', 'a written row_version is overridden (unlisted update)');
update public.visits set patient_id = 'c1230000-0000-4000-8000-000000001001', estimated_duration_minutes = 40, row_version = 99 where id = 'c1230000-0000-4000-8000-000000002003';
select is((select row_version::text from public.visits where id = 'c1230000-0000-4000-8000-000000002003'), '3', 'and overridden on a listed update too (2 + 1, not 99)');
update public.visits set origin_type = 'scheduled', scheduled_at = now() + interval '2 days' where id = 'c1230000-0000-4000-8000-000000002003';
select is((select row_version::text from public.visits where id = 'c1230000-0000-4000-8000-000000002003'), '4', 'origin_type raises it (signed_at and patient_id are listed too; both are immutable outside the sign-off commands, which the command tests cover)');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by, row_version) values
  ('c1230000-0000-4000-8000-000000002004', 'c1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000001001',
   'c1230000-0000-4000-8000-000000000102', 'walk_in', 'booked', 'c1230000-0000-4000-8000-000000000101', 50);
select is((select row_version::text from public.visits where id = 'c1230000-0000-4000-8000-000000002004'), '0', 'an insert that names a row_version still starts at 0');

-- The invoice went through an item insert and delete (the totals follow the items) and a payment above: its row_version is relative to now.
create temp table c123_inv as select row_version as v from public.invoices where id = 'c1230000-0000-4000-8000-000000003001';
select cmp_ok((select v from c123_inv)::int, '>', 0, 'invoice: the total, status and totals-follow-items updates above raised it (listed columns)');
update public.invoices set updated_at = now(), row_version = 400 where id = 'c1230000-0000-4000-8000-000000003001';
select is((select row_version from public.invoices where id = 'c1230000-0000-4000-8000-000000003001'), (select v from c123_inv), 'invoice: updated_at does not move it and a written value is overridden');
update public.invoices set tax = 3 where id = 'c1230000-0000-4000-8000-000000003001';
select is((select row_version from public.invoices where id = 'c1230000-0000-4000-8000-000000003001'), (select v + 1 from c123_inv), 'invoice: tax raises it by 1');
update public.invoices set discount = 7, subtotal = 90 where id = 'c1230000-0000-4000-8000-000000003001';
select is((select row_version from public.invoices where id = 'c1230000-0000-4000-8000-000000003001'), (select v + 2 from c123_inv), 'invoice: discount and subtotal in one update raise it once');
insert into public.invoices (id, tenant_id, visit_id, patient_id, invoice_number, total_amount, row_version) values
  ('c1230000-0000-4000-8000-000000003002', 'c1230000-0000-4000-8000-00000000000a', 'c1230000-0000-4000-8000-000000002004', 'c1230000-0000-4000-8000-000000001001', 'INV-C123-2', 10, 70);
select is((select row_version::text from public.invoices where id = 'c1230000-0000-4000-8000-000000003002'), '0', 'invoice: an insert that names a row_version still starts at 0');

-- 6. clinic_live_state --------------------------------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c1230000-0000-4000-8000-000000000102', $$ select (select string_agg(k, ',' order by k) from jsonb_object_keys(public.clinic_live_state('c1230000-0000-4000-8000-00000000000a')) k) $$),
  'access,versions', 'a member gets exactly access and versions');
select is(pg_temp.as_user('c1230000-0000-4000-8000-000000000102', $$ select (select string_agg(k, ',' order by k) from jsonb_object_keys(public.clinic_live_state('c1230000-0000-4000-8000-00000000000a')->'versions') k) $$),
  'billing,queue,schedule,settings', 'the versions are the four domains');
select is(pg_temp.as_user('c1230000-0000-4000-8000-000000000102', $$ select public.clinic_live_state('c1230000-0000-4000-8000-00000000000a')->>'access' $$), 'full', 'a clinic in good standing is full');
select is(pg_temp.as_user('c1230000-0000-4000-8000-000000000102', $$ select (public.clinic_live_state('c1230000-0000-4000-8000-00000000000a')->'versions'->>'queue')::bigint
     = (select version from public.clinic_versions where tenant_id = 'c1230000-0000-4000-8000-00000000000a' and domain = 'queue') $$), 'true', 'the versions are the table''s');
select is(pg_temp.as_user('c1230000-0000-4000-8000-000000000101', $$ select public.clinic_live_state('c1230000-0000-4000-8000-00000000000c')->>'access' $$), 'onboarding',
  'a clinic that has not started a plan reports onboarding (so a device learns it is not full)');
select is(pg_temp.as_user('c1230000-0000-4000-8000-000000000102', $$ select coalesce(public.clinic_live_state('c1230000-0000-4000-8000-00000000000b')::text, 'NULL') $$), 'NULL', 'a member of A gets NULL for clinic B');
select is(pg_temp.as_user('c1230000-0000-4000-8000-000000000301', $$ select coalesce(public.clinic_live_state('c1230000-0000-4000-8000-00000000000a')::text, 'NULL') $$), 'NULL', 'a user with no membership gets NULL');
select is(pg_temp.as_user('c1230000-0000-4000-8000-000000000102', $$ select coalesce(public.clinic_live_state(null)::text, 'NULL') $$), 'NULL', 'no clinic gets NULL');
select is(pg_temp.as_user('c1230000-0000-4000-8000-000000000102', $$ select coalesce(public.clinic_live_state('c1230000-0000-4000-8000-0000000000ff')::text, 'NULL') $$), 'NULL', 'an unknown clinic gets NULL');
update public.memberships set status = 'removed', removed_at = now() where user_id = 'c1230000-0000-4000-8000-000000000102' and tenant_id = 'c1230000-0000-4000-8000-00000000000a';
select is(pg_temp.as_user('c1230000-0000-4000-8000-000000000102', $$ select coalesce(public.clinic_live_state('c1230000-0000-4000-8000-00000000000a')::text, 'NULL') $$), 'NULL', 'a removed member gets NULL');
select throws_ok($$ set local role anon; select public.clinic_live_state('c1230000-0000-4000-8000-00000000000a') $$, '42501', null, 'anon cannot execute it');
reset role;
select is(
  (select p.prosecdef::text || ':' || p.provolatile::text || ':' || array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'public.clinic_live_state(uuid)'::regprocedure),
  'false:s:search_path=""', 'clinic_live_state is a STABLE INVOKER function with search_path pinned');
select is(
  (select string_agg(a.grantee::regrole::text, ',' order by a.grantee::regrole::text)
     from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.oid = 'public.clinic_live_state(uuid)'::regprocedure and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner),
  'authenticated', 'EXECUTE: authenticated only');

select * from finish();
rollback;
