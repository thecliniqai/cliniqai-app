-- stale_write_refusal.test.sql — V2-09e 09E-07 (R-19, R-17; migration 000126; threat T-09E-09: a lost update from a screen that is behind the database).
-- The ten queue and billing commands take the row version the screen showed (visits.row_version, or invoices.row_version) as their LAST parameter, DEFAULT NULL:
--   1. catalogue: one overload each, the new parameter last with a NULL default, DEFINER with the pinned settings, EXECUTE for authenticated only (record_payment also
--      service_role, as before), nothing for anon or PUBLIC;
--   2. each visit command (check_in_visit, start_consultation, complete_visit, mark_no_show, cancel_visit, reschedule_visit, confirm_appointment, complete_and_bill):
--      a stale version is ROW_CHANGED (P0001) and nothing changes (the visit, the audit rows, the claim rows, the payments, the webhook queue); the current version is
--      accepted and the result carries the new row_version; a replay of the same request id with the now-stale version answers the STORED result; a call without the
--      parameter (the running app during a deploy) still resolves;
--   3. billing: collect_payment against the visit's live invoice (a version given when there is none is refused too) and record_payment (a replay by command id answers
--      first, whatever the version): the same;
--   4. order: permission and clinic come BEFORE the version (a role without the permission and another clinic's owner never learn that a version differs);
--   5. a refusal rolls the claim back: the same request id is accepted afterwards with the current version.
-- Every call runs under the real principal. The file rolls back. Synthetic data only.
begin;
select plan(79);

insert into auth.users (id, email) values
  ('c1260000-0000-4000-8000-000000000101', 'c126-owner-a@example.test'),
  ('c1260000-0000-4000-8000-000000000102', 'c126-doctor-a@example.test'),
  ('c1260000-0000-4000-8000-000000000104', 'c126-nurse-a@example.test'),
  ('c1260000-0000-4000-8000-000000000105', 'c126-receptionist-a@example.test'),
  ('c1260000-0000-4000-8000-000000000201', 'c126-owner-b@example.test');
insert into public.tenants (id, name) values
  ('c1260000-0000-4000-8000-00000000000a', 'Synthetic 000126 Clinic A'),
  ('c1260000-0000-4000-8000-00000000000b', 'Synthetic 000126 Clinic B');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1260000-0000-4000-8000-00000000000a', 'c1260000-0000-4000-8000-00000000000b') and s.status = 'incomplete';
insert into public.memberships (user_id, tenant_id, role, full_name) values
  ('c1260000-0000-4000-8000-000000000101', 'c1260000-0000-4000-8000-00000000000a', 'owner', 'Synthetic Owner'),
  ('c1260000-0000-4000-8000-000000000102', 'c1260000-0000-4000-8000-00000000000a', 'doctor', 'Synthetic Doctor'),
  ('c1260000-0000-4000-8000-000000000104', 'c1260000-0000-4000-8000-00000000000a', 'nurse', null),
  ('c1260000-0000-4000-8000-000000000105', 'c1260000-0000-4000-8000-00000000000a', 'receptionist', null),
  ('c1260000-0000-4000-8000-000000000201', 'c1260000-0000-4000-8000-00000000000b', 'owner', null);
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1260000-0000-4000-8000-000000001001', 'c1260000-0000-4000-8000-00000000000a', 'Synthetic Stale Patient', '+919000012601', 'c1260000-0000-4000-8000-000000000101');

-- Visits. xx01 is the one the stale and replay cases use, xx02 the one a call without the parameter uses. All are marked overbooked, so no slot rule gets in the way;
-- a "bump" below moves the version with a listed column (estimated_duration_minutes).
-- 21 cancel, 22 reschedule, 23 confirm (booked, ahead); 24 no-show (booked, an hour past); 25 check in, 26 start consultation (booked, now);
-- 27 complete at the desk (waiting walk-in); 28 sign and bill (in consultation with a clinical note); 29 collect (completed); 30 record payment (completed).
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by, scheduled_at, estimated_duration_minutes, is_overbooked)
select ('c1260000-0000-4000-8000-0000000020' || lpad((n * 10 + k)::text, 2, '0'))::uuid,
       'c1260000-0000-4000-8000-00000000000a', 'c1260000-0000-4000-8000-000000001001', 'c1260000-0000-4000-8000-000000000102',
       'scheduled', 'booked', 'c1260000-0000-4000-8000-000000000101',
       case when n in (1, 2, 3) then now() + interval '1 day' + (n * 20 + k) * interval '1 minute'
            when n = 4 then now() - interval '2 hours' - k * interval '20 minutes'
            else now() end,
       20, true
  from generate_series(1, 6) n, generate_series(1, 2) k;
-- the ids above are c126...-0000000020<n><k>: 2011/2012 cancel, 2021/2022 reschedule, 2031/2032 confirm, 2041/2042 no-show, 2051/2052 check in, 2061/2062 start.
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by, estimated_duration_minutes) values
  ('c1260000-0000-4000-8000-000000002071', 'c1260000-0000-4000-8000-00000000000a', 'c1260000-0000-4000-8000-000000001001', 'c1260000-0000-4000-8000-000000000102', 'walk_in', 'waiting', 'c1260000-0000-4000-8000-000000000101', 20),
  ('c1260000-0000-4000-8000-000000002072', 'c1260000-0000-4000-8000-00000000000a', 'c1260000-0000-4000-8000-000000001001', 'c1260000-0000-4000-8000-000000000102', 'walk_in', 'waiting', 'c1260000-0000-4000-8000-000000000101', 20),
  ('c1260000-0000-4000-8000-000000002081', 'c1260000-0000-4000-8000-00000000000a', 'c1260000-0000-4000-8000-000000001001', 'c1260000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1260000-0000-4000-8000-000000000101', 20),
  ('c1260000-0000-4000-8000-000000002082', 'c1260000-0000-4000-8000-00000000000a', 'c1260000-0000-4000-8000-000000001001', 'c1260000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1260000-0000-4000-8000-000000000101', 20),
  ('c1260000-0000-4000-8000-000000002091', 'c1260000-0000-4000-8000-00000000000a', 'c1260000-0000-4000-8000-000000001001', 'c1260000-0000-4000-8000-000000000102', 'walk_in', 'completed', 'c1260000-0000-4000-8000-000000000101', 20),
  ('c1260000-0000-4000-8000-000000002092', 'c1260000-0000-4000-8000-00000000000a', 'c1260000-0000-4000-8000-000000001001', 'c1260000-0000-4000-8000-000000000102', 'walk_in', 'completed', 'c1260000-0000-4000-8000-000000000101', 20),
  ('c1260000-0000-4000-8000-000000002101', 'c1260000-0000-4000-8000-00000000000a', 'c1260000-0000-4000-8000-000000001001', 'c1260000-0000-4000-8000-000000000102', 'walk_in', 'completed', 'c1260000-0000-4000-8000-000000000101', 20),
  ('c1260000-0000-4000-8000-000000002102', 'c1260000-0000-4000-8000-00000000000a', 'c1260000-0000-4000-8000-000000001001', 'c1260000-0000-4000-8000-000000000102', 'walk_in', 'completed', 'c1260000-0000-4000-8000-000000000101', 20);
-- (the walk-in rows above: 2071/2072 complete at the desk, 2081/2082 sign and bill, 2091/2092 collect, 2101/2102 record payment)
update public.clinical_notes set clinical_notes = 'Synthetic note so the sign-off has content'
 where visit_id in ('c1260000-0000-4000-8000-000000002081', 'c1260000-0000-4000-8000-000000002082');
-- Invoices: 2091 and 2101 have a live invoice (issued), 2102 too; 2092 has none; 2102's is the one a call without the parameter pays.
insert into public.invoices (id, tenant_id, visit_id, patient_id, invoice_number, total_amount) values
  ('c1260000-0000-4000-8000-0000000b2091', 'c1260000-0000-4000-8000-00000000000a', 'c1260000-0000-4000-8000-000000002091', 'c1260000-0000-4000-8000-000000001001', 'C126-1', 500),
  ('c1260000-0000-4000-8000-0000000b2101', 'c1260000-0000-4000-8000-00000000000a', 'c1260000-0000-4000-8000-000000002101', 'c1260000-0000-4000-8000-000000001001', 'C126-2', 400),
  ('c1260000-0000-4000-8000-0000000b2102', 'c1260000-0000-4000-8000-00000000000a', 'c1260000-0000-4000-8000-000000002102', 'c1260000-0000-4000-8000-000000001001', 'C126-3', 400);

create function pg_temp.vid(p text) returns uuid language sql as $f$ select ('c1260000-0000-4000-8000-00000000' || p)::uuid $f$;
create function pg_temp.rid(n int) returns uuid language sql as $f$ select ('c1260000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $f$;
create function pg_temp.bump_visit(p text) returns void language sql as $f$
  update public.visits set estimated_duration_minutes = case when estimated_duration_minutes = 20 then 25 else 20 end where id = pg_temp.vid(p)
$f$;
create function pg_temp.bump_invoice(p text) returns void language sql as $f$
  insert into public.invoice_items (tenant_id, invoice_id, item_type, description, unit_price, quantity, total_price)
  values ('c1260000-0000-4000-8000-00000000000a', ('c1260000-0000-4000-8000-0000000b' || p)::uuid, 'consultation', 'Synthetic added item', 600, 1, 600)
$f$;
create function pg_temp.vv(p text) returns text language sql as $f$ select row_version::text from public.visits where id = pg_temp.vid(p) $f$;
create function pg_temp.iv(p text) returns text language sql as $f$ select row_version::text from public.invoices where id = ('c1260000-0000-4000-8000-0000000b' || p)::uuid $f$;
-- Everything a refused command must leave alone: the clinic's audit rows, claims, payments and webhook queue, and the visit's own state.
create function pg_temp.fp(p text default null) returns text language sql as $f$
  select (select count(*) from public.audit_logs where tenant_id = 'c1260000-0000-4000-8000-00000000000a') || '/'
      || (select count(*) from private.command_results where tenant_id = 'c1260000-0000-4000-8000-00000000000a') || '/'
      || (select count(*) from public.payments where tenant_id = 'c1260000-0000-4000-8000-00000000000a') || '/'
      || (select count(*) from public.webhook_delivery_queue where tenant_id = 'c1260000-0000-4000-8000-00000000000a') || '/'
      || coalesce((select status || '|' || coalesce(scheduled_at::text, '-') || '|' || row_version from public.visits where id = pg_temp.vid(p)), '-')
$f$;
-- Run one statement as a user; the answer as text (the jsonb result), or 'error:<sqlstate>:<message>'. A success stays in the file's transaction.
create function pg_temp.call(p_user text, p_sql text) returns text language plpgsql as $f$
declare v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', ('c1260000-0000-4000-8000-000000000' || p_user)::uuid, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '', true);
  begin
    set local role authenticated;
    execute p_sql into v_out;
    reset role;
  exception when others then
    reset role; v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$f$;
-- The key of a result, or the error text.
create function pg_temp.key(p_res text, p_key text) returns text language sql as $f$
  select case when p_res like 'error:%' then p_res else (p_res::jsonb ->> p_key) end
$f$;
-- The command call strings (tenant A, the given request number and optional version clause).
create function pg_temp.q(p_fn text, p_args text) returns text language sql as $f$
  select format('select public.%s(%s)::text', p_fn, p_args)
$f$;
create function pg_temp.t() returns text language sql as $f$ select quote_literal('c1260000-0000-4000-8000-00000000000a') $f$;

-- 1. Catalogue ----------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('check_in_visit', 'start_consultation', 'complete_visit', 'mark_no_show', 'cancel_visit', 'reschedule_visit',
                                                           'confirm_appointment', 'complete_and_bill', 'collect_payment', 'record_payment')), 10,
  'catalogue: exactly one overload of each of the ten commands (R-17: no old signature is left behind)');
select is((select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('check_in_visit', 'start_consultation', 'complete_visit', 'mark_no_show', 'cancel_visit', 'reschedule_visit',
                                                           'confirm_appointment', 'complete_and_bill')
              and (p.proargnames)[array_length(p.proargnames, 1)] = 'p_expected_version'
              and p.pronargdefaults >= 1 and pg_get_expr(p.proargdefaults, 0) like '%NULL::bigint'),
  'cancel_visit,check_in_visit,complete_and_bill,complete_visit,confirm_appointment,mark_no_show,reschedule_visit,start_consultation',
  'catalogue: the eight visit commands end with p_expected_version bigint DEFAULT NULL');
select is((select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('collect_payment', 'record_payment')
              and (p.proargnames)[array_length(p.proargnames, 1)] = 'p_expected_invoice_version' and pg_get_expr(p.proargdefaults, 0) like '%NULL::bigint'),
  'collect_payment,record_payment', 'catalogue: the two billing commands end with p_expected_invoice_version bigint DEFAULT NULL');
select is((select string_agg(p.proname || ':' || p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), ''), ';' order by p.proname)
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('check_in_visit', 'start_consultation', 'complete_visit', 'mark_no_show', 'cancel_visit', 'reschedule_visit',
                                                           'confirm_appointment', 'complete_and_bill', 'collect_payment', 'record_payment')),
  (select string_agg(x || ':true:search_path="",lock_timeout=2s', ';' order by x)
     from unnest(array['check_in_visit', 'start_consultation', 'complete_visit', 'mark_no_show', 'cancel_visit', 'reschedule_visit', 'confirm_appointment',
                       'complete_and_bill', 'collect_payment', 'record_payment']) x),
  'catalogue: all ten stay SECURITY DEFINER with search_path "" and lock_timeout 2s');
select is((select string_agg(p.proname || ':' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text || has_function_privilege('anon', p.oid, 'EXECUTE')::text
                              || has_function_privilege('service_role', p.oid, 'EXECUTE')::text || has_function_privilege('public', p.oid, 'EXECUTE')::text, ';' order by p.proname)
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('check_in_visit', 'start_consultation', 'complete_visit', 'mark_no_show', 'cancel_visit', 'reschedule_visit',
                                                           'confirm_appointment', 'complete_and_bill', 'collect_payment', 'record_payment')),
  'cancel_visit:truefalsefalsefalse;check_in_visit:truefalsefalsefalse;collect_payment:truefalsefalsefalse;complete_and_bill:truefalsefalsefalse;complete_visit:truefalsefalsefalse;confirm_appointment:truefalsefalsefalse;mark_no_show:truefalsefalsefalse;record_payment:truefalsetruefalse;reschedule_visit:truefalsefalsefalse;start_consultation:truefalsefalsefalse',
  'grants: EXECUTE for authenticated only (record_payment also service_role, as before); anon and PUBLIC nothing');

-- 2. cancel_visit ---------------------------------------------------------------------------------------------------------------
create temp table fp0(k text primary key, v text) on commit drop;
select pg_temp.bump_visit('2011');
insert into fp0 select 'cancel', pg_temp.fp('2011');
select is(pg_temp.vv('2011'), '1', 'cancel: a listed column moved the version (the stale version below is real)');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('cancel_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2011')) || ', ''other'', ' || quote_literal(pg_temp.rid(1)) || ', null, false, false, 0')), 'row_version'),
  'error:P0001:ROW_CHANGED', 'cancel: a stale version is ROW_CHANGED (P0001)');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('cancel_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2011')) || ', ''other'', ' || quote_literal(pg_temp.rid(1)) || ', null, false, false, 5')), 'row_version'),
  'error:P0001:ROW_CHANGED', 'cancel: a version from the future is refused too (it differs)');
select is(pg_temp.fp('2011'), (select v from fp0 where k = 'cancel'), 'cancel: the refusals wrote nothing (visit, audit rows, claims, payments, webhook queue)');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('cancel_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2011')) || ', ''other'', ' || quote_literal(pg_temp.rid(1)) || ', null, false, false, 1')), 'row_version'),
  pg_temp.vv('2011'), 'cancel: the current version is accepted, and the result carries the new row_version');
select is(pg_temp.vv('2011'), '2', 'cancel: the visit moved to version 2 (status changed)');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('cancel_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2011')) || ', ''other'', ' || quote_literal(pg_temp.rid(1)) || ', null, false, false, 1')), 'row_version'),
  '2', 'cancel: a replay of the same request id with the now-stale version answers the STORED result');
select is((select count(*)::int from public.audit_logs where tenant_id = 'c1260000-0000-4000-8000-00000000000a' and action = 'visit.cancel' and entity_id = pg_temp.vid('2011')), 1,
  'cancel: and wrote no second audit row');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('cancel_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2012')) || ', ''other'', ' || quote_literal(pg_temp.rid(2)))), 'visit_id'),
  pg_temp.vid('2012')::text, 'cancel: a call without the parameter still resolves (the running app during a deploy)');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('cancel_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('9999')) || ', ''other'', ' || quote_literal(pg_temp.rid(3)) || ', null, false, false, 99')), 'visit_id'),
  'error:P0002:VISIT_NOT_FOUND', 'cancel: a visit that is not in the clinic, with a version, is not found (the lock decides before the version is compared)');
select is(pg_temp.key(pg_temp.call('201', pg_temp.q('cancel_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2012')) || ', ''other'', ' || quote_literal(pg_temp.rid(4)) || ', null, false, false, 99')), 'visit_id'),
  'error:P0002:VISIT_NOT_FOUND', 'cancel: another clinic''s owner naming clinic A with a stale version is not found (the clinic check comes before the version)');

-- 3. reschedule_visit -----------------------------------------------------------------------------------------------------------
select pg_temp.bump_visit('2021');
insert into fp0 select 'resched', pg_temp.fp('2021');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('reschedule_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2021')) || ', ' || quote_literal((now() + interval '3 days')::text) || ', ' || quote_literal(pg_temp.rid(11)) || ', null, null, true, false, false, false, 0')), 'row_version'),
  'error:P0001:ROW_CHANGED', 'reschedule: a stale version is ROW_CHANGED');
select is(pg_temp.fp('2021'), (select v from fp0 where k = 'resched'), 'reschedule: nothing written (the visit keeps its time, no audit row, no claim, no webhook event)');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('reschedule_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2021')) || ', ' || quote_literal((now() + interval '3 days')::text) || ', ' || quote_literal(pg_temp.rid(11)) || ', null, null, true, false, false, false, 1')), 'row_version'),
  pg_temp.vv('2021'), 'reschedule: the current version is accepted and the result carries the new row_version (the same request id as the refused call: the claim rolled back)');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('reschedule_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2021')) || ', ' || quote_literal((now() + interval '3 days')::text) || ', ' || quote_literal(pg_temp.rid(11)) || ', null, null, true, false, false, false, 0')), 'row_version'),
  pg_temp.vv('2021'), 'reschedule: a replay with a stale version answers the stored result');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('reschedule_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2022')) || ', ' || quote_literal((now() + interval '4 days')::text) || ', ' || quote_literal(pg_temp.rid(12)) || ', null, null, true')), 'visit_id'),
  pg_temp.vid('2022')::text, 'reschedule: a call without the parameter still resolves');

-- 4. confirm_appointment and mark_no_show ----------------------------------------------------------------------------------------
select pg_temp.bump_visit('2031');
insert into fp0 select 'confirm', pg_temp.fp('2031');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('confirm_appointment', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2031')) || ', ' || quote_literal(pg_temp.rid(21)) || ', 0')), 'row_version'),
  'error:P0001:ROW_CHANGED', 'confirm: a stale version is ROW_CHANGED');
select is(pg_temp.fp('2031'), (select v from fp0 where k = 'confirm'), 'confirm: nothing written');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('confirm_appointment', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2031')) || ', ' || quote_literal(pg_temp.rid(21)) || ', 1')), 'row_version'),
  pg_temp.vv('2031'), 'confirm: the current version is accepted, the result carries the new row_version');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('confirm_appointment', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2031')) || ', ' || quote_literal(pg_temp.rid(21)) || ', 0')), 'row_version'),
  pg_temp.vv('2031'), 'confirm: a replay with a stale version answers the stored result');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('confirm_appointment', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2032')) || ', ' || quote_literal(pg_temp.rid(22)))), 'visit_id'),
  pg_temp.vid('2032')::text, 'confirm: a call without the parameter still resolves');

select pg_temp.bump_visit('2041');
insert into fp0 select 'noshow', pg_temp.fp('2041');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('mark_no_show', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2041')) || ', ' || quote_literal(pg_temp.rid(31)) || ', 0')), 'row_version'),
  'error:P0001:ROW_CHANGED', 'no-show: a stale version is ROW_CHANGED');
select is(pg_temp.fp('2041'), (select v from fp0 where k = 'noshow'), 'no-show: nothing written');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('mark_no_show', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2041')) || ', ' || quote_literal(pg_temp.rid(31)) || ', 1')), 'row_version'),
  pg_temp.vv('2041'), 'no-show: the current version is accepted, the result carries the new row_version');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('mark_no_show', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2041')) || ', ' || quote_literal(pg_temp.rid(31)) || ', 0')), 'row_version'),
  pg_temp.vv('2041'), 'no-show: a replay with a stale version answers the stored result');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('mark_no_show', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2042')) || ', ' || quote_literal(pg_temp.rid(32)))), 'visit_id'),
  pg_temp.vid('2042')::text, 'no-show: a call without the parameter still resolves');

-- 5. check_in_visit and start_consultation ---------------------------------------------------------------------------------------
select pg_temp.bump_visit('2051');
insert into fp0 select 'checkin', pg_temp.fp('2051');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('check_in_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2051')) || ', ''normal'', ' || quote_literal(pg_temp.rid(41)) || ', 0')), 'row_version'),
  'error:P0001:ROW_CHANGED', 'check in: a stale version is ROW_CHANGED');
select is(pg_temp.fp('2051'), (select v from fp0 where k = 'checkin'), 'check in: nothing written (no queue token, no status move, no claim)');
select is((select count(*)::int from public.queue_tokens where visit_id = pg_temp.vid('2051')), 0, 'check in: and no queue token exists');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('check_in_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2051')) || ', ''normal'', ' || quote_literal(pg_temp.rid(41)) || ', 1')), 'row_version'),
  pg_temp.vv('2051'), 'check in: the current version is accepted, the result carries the new row_version');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('check_in_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2051')) || ', ''normal'', ' || quote_literal(pg_temp.rid(41)) || ', 0')), 'row_version'),
  pg_temp.vv('2051'), 'check in: a replay with a stale version answers the stored result');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('check_in_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2052')) || ', ''normal'', ' || quote_literal(pg_temp.rid(42)))), 'visit_id'),
  pg_temp.vid('2052')::text, 'check in: a call without the parameter still resolves');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('check_in_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('9999')) || ', ''normal'', ' || quote_literal(pg_temp.rid(43)) || ', 0')), 'visit_id'),
  'error:P0002:VISIT_NOT_FOUND', 'check in: an unknown visit with a version is not found');

select pg_temp.bump_visit('2061');
insert into fp0 select 'start', pg_temp.fp('2061');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('start_consultation', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2061')) || ', ' || quote_literal(pg_temp.rid(51)) || ', 0')), 'row_version'),
  'error:P0001:ROW_CHANGED', 'start consultation: a stale version is ROW_CHANGED');
select is(pg_temp.fp('2061'), (select v from fp0 where k = 'start'), 'start consultation: nothing written');
select is(pg_temp.key(pg_temp.call('105', pg_temp.q('start_consultation', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2061')) || ', ' || quote_literal(pg_temp.rid(52)) || ', 0')), 'row_version'),
  'error:42501:FORBIDDEN', 'start consultation: a receptionist (no consultations:edit) with a stale version is FORBIDDEN, not ROW_CHANGED');
select is(pg_temp.key(pg_temp.call('102', pg_temp.q('start_consultation', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2061')) || ', ' || quote_literal(pg_temp.rid(51)) || ', 1')), 'row_version'),
  pg_temp.vv('2061'), 'start consultation: the current version is accepted, the result carries the new row_version');
select is(pg_temp.key(pg_temp.call('102', pg_temp.q('start_consultation', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2061')) || ', ' || quote_literal(pg_temp.rid(51)) || ', 0')), 'row_version'),
  pg_temp.vv('2061'), 'start consultation: a replay with a stale version answers the stored result');
select is(pg_temp.key(pg_temp.call('102', pg_temp.q('start_consultation', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2062')) || ', ' || quote_literal(pg_temp.rid(53)))), 'visit_id'),
  pg_temp.vid('2062')::text, 'start consultation: a call without the parameter still resolves');

-- 6. complete_visit and complete_and_bill ----------------------------------------------------------------------------------------
select pg_temp.bump_visit('2071');
insert into fp0 select 'complete', pg_temp.fp('2071');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('complete_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2071')) || ', ' || quote_literal(pg_temp.rid(61)) || ', 0')), 'row_version'),
  'error:P0001:ROW_CHANGED', 'complete at the desk: a stale version is ROW_CHANGED');
select is(pg_temp.fp('2071'), (select v from fp0 where k = 'complete'), 'complete at the desk: nothing written');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('complete_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2071')) || ', ' || quote_literal(pg_temp.rid(61)) || ', 1')), 'row_version'),
  pg_temp.vv('2071'), 'complete at the desk: the current version is accepted, the result carries the new row_version');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('complete_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2071')) || ', ' || quote_literal(pg_temp.rid(61)) || ', 0')), 'row_version'),
  pg_temp.vv('2071'), 'complete at the desk: a replay with a stale version answers the stored result');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('complete_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2072')) || ', ' || quote_literal(pg_temp.rid(62)))), 'visit_id'),
  pg_temp.vid('2072')::text, 'complete at the desk: a call without the parameter still resolves');
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('complete_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2072')) || ', ' || quote_literal(pg_temp.rid(63)) || ', 1')), 'already_completed'),
  'true', 'complete at the desk: an already completed visit, current version: answers already_completed (the version of a no-op is still compared)');

select pg_temp.bump_visit('2081');
insert into fp0 select 'sign', pg_temp.fp('2081');
select is(pg_temp.key(pg_temp.call('102', pg_temp.q('complete_and_bill', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2081')) || ', ' || quote_literal('[{"item_type":"consultation","description":"Synthetic fee","unit_price":300,"quantity":1}]') || '::jsonb, 0, 0, null, ' || quote_literal(pg_temp.rid(71)) || ', 0')), 'row_version'),
  'error:P0001:ROW_CHANGED', 'sign and bill: a stale version is ROW_CHANGED');
select is(pg_temp.fp('2081'), (select v from fp0 where k = 'sign'), 'sign and bill: nothing written (not signed, no invoice, no audit rows)');
select is((select count(*)::int from public.invoices where visit_id = pg_temp.vid('2081')), 0, 'sign and bill: and no invoice exists');
select is(pg_temp.key(pg_temp.call('105', pg_temp.q('complete_and_bill', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2081')) || ', null, 0, 0, null, ' || quote_literal(pg_temp.rid(72)) || ', 0')), 'row_version'),
  'error:42501:FORBIDDEN', 'sign and bill: a receptionist (no consultations:edit) with a stale version is FORBIDDEN');
select is(pg_temp.key(pg_temp.call('102', pg_temp.q('complete_and_bill', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2081')) || ', ' || quote_literal('[{"item_type":"consultation","description":"Synthetic fee","unit_price":300,"quantity":1}]') || '::jsonb, 0, 0, null, ' || quote_literal(pg_temp.rid(71)) || ', 1')), 'row_version'),
  pg_temp.vv('2081'), 'sign and bill: the current version is accepted, the result carries the new row_version');
select is(pg_temp.key(pg_temp.call('102', pg_temp.q('complete_and_bill', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2081')) || ', ' || quote_literal('[{"item_type":"consultation","description":"Synthetic fee","unit_price":300,"quantity":1}]') || '::jsonb, 0, 0, null, ' || quote_literal(pg_temp.rid(71)) || ', 0')), 'invoice_version'),
  (select i.row_version::text from public.invoices i where i.visit_id = pg_temp.vid('2081')), 'sign and bill: a replay with a stale version answers the stored result (with the invoice version)');
select is(pg_temp.key(pg_temp.call('102', pg_temp.q('complete_and_bill', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2082')) || ', ' || quote_literal('[{"item_type":"consultation","description":"Synthetic fee","unit_price":300,"quantity":1}]') || '::jsonb, 0, 0, null, ' || quote_literal(pg_temp.rid(73)))), 'visit_id'),
  pg_temp.vid('2082')::text, 'sign and bill: a call without the parameter still resolves');

-- 7. collect_payment ------------------------------------------------------------------------------------------------------------
select pg_temp.bump_invoice('2091');
select is(pg_temp.iv('2091'), '1', 'collect: an item added to the invoice moved its version');
create temp table fpi(k text primary key, v text) on commit drop;
insert into fpi select 'collect', pg_temp.fp('2091') || '/' || (select total_amount::text from public.invoices where id = 'c1260000-0000-4000-8000-0000000b2091');
select is(pg_temp.key(pg_temp.call('105', pg_temp.q('collect_payment', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2091')) || ', null, 100, ''cash'', null, null, ' || quote_literal(pg_temp.rid(81)) || ', 0, 0, 0')), 'invoice_version'),
  'error:P0001:ROW_CHANGED', 'collect: a stale invoice version is ROW_CHANGED');
select is(pg_temp.fp('2091') || '/' || (select total_amount::text from public.invoices where id = 'c1260000-0000-4000-8000-0000000b2091'), (select v from fpi where k = 'collect'), 'collect: nothing written (no payment, no audit row, no claim)');
select is(pg_temp.key(pg_temp.call('104', pg_temp.q('collect_payment', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2091')) || ', null, 100, ''cash'', null, null, ' || quote_literal(pg_temp.rid(82)) || ', 0, 0, 0')), 'invoice_version'),
  'error:42501:FORBIDDEN', 'collect: a nurse (no billing:collect) with a stale version is FORBIDDEN');
select is(pg_temp.key(pg_temp.call('105', pg_temp.q('collect_payment', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2091')) || ', null, 100, ''cash'', null, null, ' || quote_literal(pg_temp.rid(81)) || ', 0, 0, 1')), 'invoice_version'),
  pg_temp.iv('2091'), 'collect: the current invoice version is accepted, and the result carries the invoice_version');
select is(pg_temp.key(pg_temp.call('105', pg_temp.q('collect_payment', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2091')) || ', null, 100, ''cash'', null, null, ' || quote_literal(pg_temp.rid(81)) || ', 0, 0, 0')), 'replayed'),
  'true', 'collect: a replay with a stale version answers the stored result');
select is((select count(*)::int from public.payments where invoice_id = 'c1260000-0000-4000-8000-0000000b2091'), 1, 'collect: and records no second payment');
select is(pg_temp.key(pg_temp.call('105', pg_temp.q('collect_payment', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2092')) || ', ' || quote_literal('[{"item_type":"consultation","description":"Synthetic fee","unit_price":200,"quantity":1}]') || '::jsonb, 50, ''cash'', null, null, ' || quote_literal(pg_temp.rid(83)) || ', 0, 0, 0')), 'invoice_version'),
  'error:P0001:ROW_CHANGED', 'collect: a version given when the visit has no live invoice is refused too');
select is((select count(*)::int from public.invoices where visit_id = pg_temp.vid('2092')), 0, 'collect: and no invoice was created by the refused call');
select is(pg_temp.key(pg_temp.call('105', pg_temp.q('collect_payment', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2092')) || ', ' || quote_literal('[{"item_type":"consultation","description":"Synthetic fee","unit_price":200,"quantity":1}]') || '::jsonb, 50, ''cash'', null, null, ' || quote_literal(pg_temp.rid(83)))), 'invoice_created'),
  'true', 'collect: a call without the parameter still resolves (and creates the invoice)');

-- 8. record_payment -------------------------------------------------------------------------------------------------------------
select pg_temp.bump_invoice('2101');
insert into fpi select 'record', pg_temp.fp() || '/' || (select status from public.invoices where id = 'c1260000-0000-4000-8000-0000000b2101');
select is(pg_temp.key(pg_temp.call('105', pg_temp.q('record_payment', pg_temp.t() || ', ' || quote_literal('c1260000-0000-4000-8000-0000000b2101') || ', 100, ''cash'', null, ' || quote_literal(pg_temp.rid(91)) || ', null, null, 0')), 'invoice_version'),
  'error:P0001:ROW_CHANGED', 'record: a stale invoice version is ROW_CHANGED');
select is(pg_temp.fp() || '/' || (select status from public.invoices where id = 'c1260000-0000-4000-8000-0000000b2101'), (select v from fpi where k = 'record'), 'record: nothing written (no payment, no audit row)');
select is(pg_temp.key(pg_temp.call('104', pg_temp.q('record_payment', pg_temp.t() || ', ' || quote_literal('c1260000-0000-4000-8000-0000000b2101') || ', 100, ''cash'', null, ' || quote_literal(pg_temp.rid(92)) || ', null, null, 0')), 'invoice_version'),
  'error:42501:FORBIDDEN', 'record: a nurse (no billing:collect) with a stale version is FORBIDDEN');
select is(pg_temp.key(pg_temp.call('201', pg_temp.q('record_payment', quote_literal('c1260000-0000-4000-8000-00000000000a') || ', ' || quote_literal('c1260000-0000-4000-8000-0000000b2101') || ', 100, ''cash'', null, ' || quote_literal(pg_temp.rid(93)) || ', null, null, 0')), 'invoice_version'),
  'error:P0002:INVOICE_NOT_FOUND', 'record: another clinic''s owner naming clinic A with a stale version is not found');
select is(pg_temp.key(pg_temp.call('105', pg_temp.q('record_payment', pg_temp.t() || ', ' || quote_literal('c1260000-0000-4000-8000-0000000b2101') || ', 100, ''cash'', null, ' || quote_literal(pg_temp.rid(91)) || ', null, null, 1')), 'invoice_version'),
  pg_temp.iv('2101'), 'record: the current version is accepted, and the result carries the invoice_version');
select is(pg_temp.key(pg_temp.call('105', pg_temp.q('record_payment', pg_temp.t() || ', ' || quote_literal('c1260000-0000-4000-8000-0000000b2101') || ', 100, ''cash'', null, ' || quote_literal(pg_temp.rid(91)) || ', null, null, 0')), 'replayed'),
  'true', 'record: a replay by command id with a stale version answers first (it is not ROW_CHANGED)');
select is(pg_temp.key(pg_temp.call('105', pg_temp.q('record_payment', pg_temp.t() || ', ' || quote_literal('c1260000-0000-4000-8000-0000000b2101') || ', 100, ''cash'', null, ' || quote_literal(pg_temp.rid(91)) || ', null, null, 0')), 'invoice_version'),
  pg_temp.iv('2101'), 'record: and the replay carries the current invoice_version');
select is((select count(*)::int from public.payments where invoice_id = 'c1260000-0000-4000-8000-0000000b2101'), 1, 'record: one payment only');
select is(pg_temp.key(pg_temp.call('105', pg_temp.q('record_payment', pg_temp.t() || ', ' || quote_literal('c1260000-0000-4000-8000-0000000b2102') || ', 100, ''cash'', null, ' || quote_literal(pg_temp.rid(94)))), 'invoice_status'),
  'draft', 'record: a call without the parameter still resolves (the running app during a deploy)');
select is(pg_temp.key(pg_temp.call('105', pg_temp.q('record_payment', pg_temp.t() || ', ' || quote_literal('c1260000-0000-4000-8000-0000000b2102') || ', 50, ''cash'', null, ' || quote_literal(pg_temp.rid(95)) || ', null, null, null')), 'invoice_status'),
  'draft', 'record: an explicit NULL version is the same as none');

-- 9. Replays carry no version into the request hash: the same request id with another version is a replay, never IDEMPOTENCY_MISMATCH ------------------------------
select is(pg_temp.key(pg_temp.call('101', pg_temp.q('cancel_visit', pg_temp.t() || ', ' || quote_literal(pg_temp.vid('2011')) || ', ''other'', ' || quote_literal(pg_temp.rid(1)) || ', null, false, false, null')), 'row_version'),
  '2', 'the version is not part of the request hash: the same request id with a NULL version is a replay too');
select is((select count(*)::int from private.command_results where tenant_id = 'c1260000-0000-4000-8000-00000000000a' and client_request_id = pg_temp.rid(1)), 1,
  'and there is exactly one stored claim for it');

select * from finish();
rollback;
