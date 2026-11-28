-- billing_invariants.test.sql — V2-10 plan 10-01 (migration 000140; D-1, D-2, D-6, D-7, D-8, D-15; threat T-10-03).
--   1. private.invoice_counters is closed (RLS on, no policy, no privilege for any API role); the numbering functions
--      (indian_fy, next_invoice_number) and step_create_invoice are executable by no API role; the count-based
--      public.generate_tenant_invoice_number is gone.
--   2. FY: the shared case table (tests/fixtures/fy-cases.json, embedded verbatim below and compared by tests/money/fy.spec.ts)
--      passes private.indian_fy (dates) and private.next_invoice_number (instants: 31 Mar 23:59:59 / 1 Apr 00:00 in an
--      Asia/Kolkata clinic and in an America/New_York clinic).
--   3. The counter runs per clinic and per FY, from 1, five digits, wider past 99999.
--   4. create_invoice numbers a new clinic's first bill INV/<fy of today>/00001; a cancelled or no-show visit is refused with
--      VISIT_NOT_BILLABLE and the counter does not move; a discount above the subtotal is INPUT_INVALID.
--   5. Each header CHECK refuses its violation (23514, by name) and every one is validated; the status CHECK admits void.
--   6. invoices_one_live_per_visit excludes void as well as cancelled; step_create_invoice bills a visit whose bill is void.
-- Synthetic data only; the file rolls back.
begin;
select plan(37);

-- Fixtures ----------------------------------------------------------------------------------------------------------------
-- Clinic K (Asia/Kolkata) and clinic N (America/New_York), one owner each; clinic C and D for the counter cases.
insert into auth.users (id, email) values
  ('c1400000-0000-4000-8000-000000000101', 'c140-owner-k@example.test'),
  ('c1400000-0000-4000-8000-000000000102', 'c140-owner-n@example.test');
insert into public.tenants (id, name, timezone) values
  ('c1400000-0000-4000-8000-00000000000a', 'Synthetic 10-01 Clinic K', 'Asia/Kolkata'),
  ('c1400000-0000-4000-8000-00000000000b', 'Synthetic 10-01 Clinic N', 'America/New_York'),
  ('c1400000-0000-4000-8000-00000000000c', 'Synthetic 10-01 Clinic C', 'Asia/Kolkata'),
  ('c1400000-0000-4000-8000-00000000000d', 'Synthetic 10-01 Clinic D', 'Asia/Kolkata');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in (select t.id from public.tenants t where t.created_at = now()) and s.status = 'incomplete';
insert into public.memberships (user_id, tenant_id, role) values
  ('c1400000-0000-4000-8000-000000000101', 'c1400000-0000-4000-8000-00000000000a', 'owner'),
  ('c1400000-0000-4000-8000-000000000102', 'c1400000-0000-4000-8000-00000000000b', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1400000-0000-4000-8000-000000001001', 'c1400000-0000-4000-8000-00000000000a', 'Synthetic FY Patient', '+919000001401',
   'c1400000-0000-4000-8000-000000000101');
-- Visits of clinic K: 1101 waiting (billed by the command), 1102 cancelled, 1103 no-show, 1104 for the CHECK probes,
-- 1105 for the one-live index, 1106 whose bill is void (billed again by the command), 1107 discount probe.
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by)
select ('c1400000-0000-4000-8000-00000000110' || g)::uuid, 'c1400000-0000-4000-8000-00000000000a',
       'c1400000-0000-4000-8000-000000001001', 'c1400000-0000-4000-8000-000000000101', 'walk_in',
       case g when 2 then 'cancelled' when 3 then 'no_show' else 'waiting' end,
       'c1400000-0000-4000-8000-000000000101'
  from generate_series(1, 7) g;

-- As the owner of clinic K, acting in K: run p_sql and return its single value, or 'error:<sqlstate>:<message>'.
create function pg_temp.as_owner_k(p_sql text) returns text
language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c1400000-0000-4000-8000-000000000101', 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c1400000-0000-4000-8000-00000000000a')::text, true);
  begin
    set local role authenticated;
    execute p_sql into v_out;
    reset role;
  exception when others then
    reset role;
    v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

-- 1. Catalogue -------------------------------------------------------------------------------------------------------------
select is(
  (select c.relrowsecurity::text || ':' || (select count(*)::text from pg_policies p where p.schemaname = 'private' and p.tablename = 'invoice_counters')
     from pg_class c where c.oid = 'private.invoice_counters'::regclass),
  'true:0', 'invoice_counters: RLS enabled, no policy');
select is(
  (select array_agg(has_table_privilege(r, 'private.invoice_counters', p) order by r, p)
     from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p),
  array_fill(false, array[12]), 'invoice_counters: no table privilege for anon, authenticated or service_role');
select is(
  (select array_agg(has_function_privilege(r, f, 'EXECUTE') order by f, r)
     from unnest(array['anon', 'authenticated', 'service_role']) r,
          unnest(array['private.indian_fy(date)', 'private.next_invoice_number(uuid, timestamptz)',
                       'private.step_create_invoice(uuid, uuid, jsonb, numeric, numeric)']) f),
  array_fill(false, array[9]), 'no API role may execute indian_fy, next_invoice_number or step_create_invoice (D-15)');
select hasnt_function('public', 'generate_tenant_invoice_number', array['uuid'],
  'the count-based public.generate_tenant_invoice_number is dropped (D-15)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname ~ 'invoice_number'
      and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))),
  0, 'no numbering function of public or private is executable by authenticated or anon');
select is(
  (select array_agg(p.proconfig::text order by p.proname) from pg_proc p
    where p.oid in ('private.indian_fy(date)'::regprocedure, 'private.next_invoice_number(uuid, timestamptz)'::regprocedure)),
  array['{"search_path=\"\""}', '{"search_path=\"\"",lock_timeout=5s}'], 'both pin search_path to empty; the counter wait is bounded (5s)');

-- 2. The shared FY case table ----------------------------------------------------------------------------------------------
create temp table fy_cases (doc jsonb) on commit drop;
insert into fy_cases (doc) values (
-- fy-cases:begin
$json${
  "$comment": "V2-10 10-01 (D-6): the one FY case table. lib/fy (tests/money/fy.spec.ts) and private.indian_fy / private.next_invoice_number (supabase/tests/database/billing_invariants.test.sql, which embeds this JSON verbatim between its fy-cases markers) must both pass it. Synthetic values only.",
  "dates": [
    { "date": "2026-04-01", "fy": "2026-27" },
    { "date": "2026-11-28", "fy": "2026-27" },
    { "date": "2026-12-31", "fy": "2026-27" },
    { "date": "2027-01-01", "fy": "2026-27" },
    { "date": "2027-03-31", "fy": "2026-27" },
    { "date": "2027-04-01", "fy": "2027-28" },
    { "date": "2026-03-31", "fy": "2025-26" },
    { "date": "2028-02-29", "fy": "2027-28" },
    { "date": "1999-04-01", "fy": "1999-00" },
    { "date": "2000-03-31", "fy": "1999-00" },
    { "date": "2099-04-01", "fy": "2099-00" }
  ],
  "instants": [
    { "at": "2027-03-31T18:29:59Z", "tz": "Asia/Kolkata", "fy": "2026-27", "label": "31 Mar 2027 23:59:59 IST" },
    { "at": "2027-03-31T18:30:00Z", "tz": "Asia/Kolkata", "fy": "2027-28", "label": "1 Apr 2027 00:00 IST" },
    { "at": "2027-04-01T03:59:59Z", "tz": "America/New_York", "fy": "2026-27", "label": "31 Mar 2027 23:59:59 EDT" },
    { "at": "2027-04-01T04:00:00Z", "tz": "America/New_York", "fy": "2027-28", "label": "1 Apr 2027 00:00 EDT" },
    { "at": "2027-03-31T20:00:00Z", "tz": "America/New_York", "fy": "2026-27", "label": "already 1 Apr in IST, still 31 Mar in New York" }
  ]
}
$json$
-- fy-cases:end
);
select is((select jsonb_array_length(doc -> 'dates') + jsonb_array_length(doc -> 'instants') from fy_cases), 16,
  'the case table has 11 dates and 5 instants');
select is(
  (select coalesce(array_agg((d ->> 'date') || ' -> ' || private.indian_fy((d ->> 'date')::date)), '{}')
     from fy_cases, jsonb_array_elements(doc -> 'dates') d
    where private.indian_fy((d ->> 'date')::date) <> d ->> 'fy'),
  '{}'::text[], 'private.indian_fy passes every date of the shared case table');
-- Each instant through next_invoice_number in a clinic of that zone (K: Asia/Kolkata, N: America/New_York).
select is(
  (select coalesce(array_agg((i ->> 'label') || ' -> ' || n.num), '{}')
     from fy_cases, jsonb_array_elements(doc -> 'instants') i,
          lateral (select private.next_invoice_number(
                      case i ->> 'tz' when 'Asia/Kolkata' then 'c1400000-0000-4000-8000-00000000000a'::uuid
                                      else 'c1400000-0000-4000-8000-00000000000b'::uuid end,
                      (i ->> 'at')::timestamptz) as num) n
    where split_part(n.num, '/', 2) <> i ->> 'fy'),
  '{}'::text[], 'next_invoice_number takes the FY from the clinic-local date of every instant of the case table');
select is(private.next_invoice_number('c1400000-0000-4000-8000-00000000000a', '2027-03-31 18:29:59+00'), 'INV/2026-27/00002',
  'IST clinic, 31 Mar 2027 23:59:59: the previous FY (its second number after the case table)');
select is(private.next_invoice_number('c1400000-0000-4000-8000-00000000000a', '2027-03-31 18:30:00+00'), 'INV/2027-28/00002',
  'IST clinic, 1 Apr 2027 00:00: the new FY has its own counter');
select is(private.next_invoice_number('c1400000-0000-4000-8000-00000000000b', '2027-03-31 20:00:00+00'), 'INV/2026-27/00003',
  'New York clinic at 1 Apr 01:30 IST: still 31 Mar there, so the previous FY');

-- 3. Counter per clinic and FY ---------------------------------------------------------------------------------------------
select is(private.next_invoice_number('c1400000-0000-4000-8000-00000000000c', '2026-11-28 06:00:00+00'), 'INV/2026-27/00001',
  'clinic C: the first number of FY 2026-27 is 00001');
select is(private.next_invoice_number('c1400000-0000-4000-8000-00000000000c', '2026-11-28 06:00:01+00'), 'INV/2026-27/00002',
  'clinic C: then 00002');
select is(private.next_invoice_number('c1400000-0000-4000-8000-00000000000d', '2026-11-28 06:00:02+00'), 'INV/2026-27/00001',
  'clinic D counts on its own: 00001');
select is(private.next_invoice_number('c1400000-0000-4000-8000-00000000000c', '2027-05-01 06:00:00+00'), 'INV/2027-28/00001',
  'clinic C, next FY: 00001 again');
select is(
  (select array_agg(c.tenant_id::text || ':' || c.fy || ':' || c.last_value order by c.tenant_id, c.fy) from private.invoice_counters c
    where c.tenant_id in ('c1400000-0000-4000-8000-00000000000c', 'c1400000-0000-4000-8000-00000000000d')),
  array['c1400000-0000-4000-8000-00000000000c:2026-27:2', 'c1400000-0000-4000-8000-00000000000c:2027-28:1',
        'c1400000-0000-4000-8000-00000000000d:2026-27:1'],
  'one counter row per clinic and FY');
update private.invoice_counters set last_value = 99999
 where tenant_id = 'c1400000-0000-4000-8000-00000000000d' and fy = '2026-27';
select is(private.next_invoice_number('c1400000-0000-4000-8000-00000000000d', '2026-11-28 06:00:03+00'), 'INV/2026-27/100000',
  'past 99999 the number widens (never cut to five digits)');

-- 4. create_invoice ---------------------------------------------------------------------------------------------------------
select is(
  pg_temp.as_owner_k($$select public.create_invoice('c1400000-0000-4000-8000-00000000000a', 'c1400000-0000-4000-8000-000000001101',
      '[{"item_type":"consultation","description":"Synthetic consultation","unit_price":650,"quantity":1}]'::jsonb,
      'c1400000-0000-4000-8000-000000009001') ->> 'invoice_number'$$),
  'INV/' || private.indian_fy(public.tenant_local_date('c1400000-0000-4000-8000-00000000000a', now())) || '/' ||
    -- the case-table instants above used K's counters of 2026-27 and 2027-28 (two numbers each)
    case private.indian_fy(public.tenant_local_date('c1400000-0000-4000-8000-00000000000a', now()))
      when '2026-27' then '00003' when '2027-28' then '00003' else '00001' end,
  'create_invoice numbers the bill from the clinic''s FY counter (INV/<fy>/NNNNN)');
select is(
  (select i.subtotal::text || '|' || i.discount::text || '|' || i.tax::text || '|' || i.total_amount::text || '|' || i.status from public.invoices i
    where i.visit_id = 'c1400000-0000-4000-8000-000000001101'),
  '650.00|0.00|0.00|650.00|issued', 'its header adds up and it is issued');
select is((select last_value from private.invoice_counters where tenant_id = 'c1400000-0000-4000-8000-00000000000a'
            and fy = private.indian_fy(public.tenant_local_date('c1400000-0000-4000-8000-00000000000a', now()))),
  (select substring(invoice_number from '/(\d+)$')::int from public.invoices where visit_id = 'c1400000-0000-4000-8000-000000001101'),
  'the counter row holds the number just issued');
select is(
  pg_temp.as_owner_k($$select public.create_invoice('c1400000-0000-4000-8000-00000000000a', 'c1400000-0000-4000-8000-000000001102',
      '[{"item_type":"consultation","description":"Synthetic consultation","unit_price":650,"quantity":1}]'::jsonb,
      'c1400000-0000-4000-8000-000000009002')::text$$),
  'error:P0001:VISIT_NOT_BILLABLE', 'a cancelled visit cannot be billed (D-8)');
select is(
  pg_temp.as_owner_k($$select public.create_invoice('c1400000-0000-4000-8000-00000000000a', 'c1400000-0000-4000-8000-000000001103',
      '[{"item_type":"consultation","description":"Synthetic consultation","unit_price":650,"quantity":1}]'::jsonb,
      'c1400000-0000-4000-8000-000000009003')::text$$),
  'error:P0001:VISIT_NOT_BILLABLE', 'a no-show visit cannot be billed (D-8)');
select is(
  pg_temp.as_owner_k($$select public.create_invoice('c1400000-0000-4000-8000-00000000000a', 'c1400000-0000-4000-8000-000000001107',
      '[{"item_type":"consultation","description":"Synthetic consultation","unit_price":100,"quantity":1}]'::jsonb,
      'c1400000-0000-4000-8000-000000009004', 150, 0)::text$$),
  'error:P0001:INPUT_INVALID', 'a discount above the subtotal is refused (INPUT_INVALID), never clamped to a zero bill');
select is(
  (select count(*)::int from public.invoices where visit_id in ('c1400000-0000-4000-8000-000000001102', 'c1400000-0000-4000-8000-000000001103',
     'c1400000-0000-4000-8000-000000001107')),
  0, 'the refused creates wrote no invoice');
select is((select last_value from private.invoice_counters where tenant_id = 'c1400000-0000-4000-8000-00000000000a'
            and fy = private.indian_fy(public.tenant_local_date('c1400000-0000-4000-8000-00000000000a', now()))),
  (select substring(invoice_number from '/(\d+)$')::int from public.invoices where visit_id = 'c1400000-0000-4000-8000-000000001101'),
  'and did not move the counter (no burnt number)');

-- 5. Header CHECKs ----------------------------------------------------------------------------------------------------------
select throws_ok($$insert into public.invoices (tenant_id, visit_id, patient_id, invoice_number, subtotal, discount, tax, total_amount, status)
  values ('c1400000-0000-4000-8000-00000000000a', 'c1400000-0000-4000-8000-000000001104', 'c1400000-0000-4000-8000-000000001001', 'C140-S', -1, 0, 0, -1, 'issued')$$,
  '23514', null, 'a negative subtotal is refused');
select throws_ok($$insert into public.invoices (tenant_id, visit_id, patient_id, invoice_number, subtotal, discount, tax, total_amount, status)
  values ('c1400000-0000-4000-8000-00000000000a', 'c1400000-0000-4000-8000-000000001104', 'c1400000-0000-4000-8000-000000001001', 'C140-D', 100, -10, 0, 110, 'issued')$$,
  '23514', 'new row for relation "invoices" violates check constraint "invoices_discount_nonnegative"', 'a negative discount is refused');
select throws_ok($$insert into public.invoices (tenant_id, visit_id, patient_id, invoice_number, subtotal, discount, tax, total_amount, status)
  values ('c1400000-0000-4000-8000-00000000000a', 'c1400000-0000-4000-8000-000000001104', 'c1400000-0000-4000-8000-000000001001', 'C140-T', 100, 0, -5, 95, 'issued')$$,
  '23514', 'new row for relation "invoices" violates check constraint "invoices_tax_nonnegative"', 'a negative tax is refused');
select throws_ok($$insert into public.invoices (tenant_id, visit_id, patient_id, invoice_number, subtotal, discount, tax, total_amount, status)
  values ('c1400000-0000-4000-8000-00000000000a', 'c1400000-0000-4000-8000-000000001104', 'c1400000-0000-4000-8000-000000001001', 'C140-X', 100, 150, 0, 0, 'issued')$$,
  '23514', 'new row for relation "invoices" violates check constraint "invoices_discount_within_subtotal"', 'a discount above the subtotal is refused');
select throws_ok($$insert into public.invoices (tenant_id, visit_id, patient_id, invoice_number, subtotal, discount, tax, total_amount, status)
  values ('c1400000-0000-4000-8000-00000000000a', 'c1400000-0000-4000-8000-000000001104', 'c1400000-0000-4000-8000-000000001001', 'C140-I', 100, 10, 0, 100, 'issued')$$,
  '23514', 'new row for relation "invoices" violates check constraint "invoices_total_identity"', 'a total that is not subtotal - discount + tax is refused');
select throws_ok($$insert into public.invoices (tenant_id, visit_id, patient_id, invoice_number, subtotal, discount, tax, total_amount, status)
  values ('c1400000-0000-4000-8000-00000000000a', 'c1400000-0000-4000-8000-000000001104', 'c1400000-0000-4000-8000-000000001001', 'C140-V', 100, 0, 0, 100, 'refunded')$$,
  '23514', 'new row for relation "invoices" violates check constraint "invoices_status_check"', 'a status outside the closed set is refused');
select is(
  (select array_agg(c.conname || ':' || c.convalidated order by c.conname) from pg_constraint c
    where c.conrelid = 'public.invoices'::regclass and c.contype = 'c'),
  array['invoices_discount_nonnegative:true', 'invoices_discount_within_subtotal:true', 'invoices_status_check:true',
        'invoices_subtotal_nonnegative:true', 'invoices_tax_nonnegative:true', 'invoices_total_cap:true',
        'invoices_total_identity:true', 'invoices_total_nonnegative:true'],
  'every header CHECK is present and validated (the total cap guards a future column widening)');

-- 6. void: the status exists and frees the visit ---------------------------------------------------------------------------
insert into public.invoices (tenant_id, visit_id, patient_id, invoice_number, subtotal, discount, tax, total_amount, status) values
  ('c1400000-0000-4000-8000-00000000000a', 'c1400000-0000-4000-8000-000000001105', 'c1400000-0000-4000-8000-000000001001', 'C140-VOID', 100, 0, 0, 100, 'void');
select lives_ok($$insert into public.invoices (tenant_id, visit_id, patient_id, invoice_number, subtotal, discount, tax, total_amount, status)
  values ('c1400000-0000-4000-8000-00000000000a', 'c1400000-0000-4000-8000-000000001105', 'c1400000-0000-4000-8000-000000001001', 'C140-LIVE', 100, 0, 0, 100, 'issued')$$,
  'a void invoice does not count as the visit''s live invoice (index widened)');
select throws_ok($$insert into public.invoices (tenant_id, visit_id, patient_id, invoice_number, subtotal, discount, tax, total_amount, status)
  values ('c1400000-0000-4000-8000-00000000000a', 'c1400000-0000-4000-8000-000000001105', 'c1400000-0000-4000-8000-000000001001', 'C140-LIVE2', 100, 0, 0, 100, 'issued')$$,
  '23505', null, 'a second live invoice on the visit is still refused');
insert into public.invoices (tenant_id, visit_id, patient_id, invoice_number, subtotal, discount, tax, total_amount, status) values
  ('c1400000-0000-4000-8000-00000000000a', 'c1400000-0000-4000-8000-000000001106', 'c1400000-0000-4000-8000-000000001001', 'C140-VOID2', 100, 0, 0, 100, 'void');
select is(
  pg_temp.as_owner_k($$select (public.create_invoice('c1400000-0000-4000-8000-00000000000a', 'c1400000-0000-4000-8000-000000001106',
      '[{"item_type":"consultation","description":"Synthetic consultation","unit_price":650,"quantity":1}]'::jsonb,
      'c1400000-0000-4000-8000-000000009006') ->> 'existing')$$),
  'false', 'create_invoice bills a visit whose only bill is void (a new invoice, not the void one)');
select is(
  (select array_agg(status order by status) from public.invoices where visit_id = 'c1400000-0000-4000-8000-000000001106'),
  array['issued', 'void'], 'the void bill keeps its number; the new one is issued');

select * from finish();
rollback;
