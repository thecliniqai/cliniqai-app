-- billing_rpc_only.test.sql — V2-05 fix plan 05-11b, finding M-INVOICE billing part (05a review IND M2, RLS L-1,
-- IND Info 3), migration 000072.
-- Before 000072 the doctor of a visit could set its invoice to paid (or zero it) with no payment, and a collector could
-- insert a payment row directly, bypassing record_payment. Now:
--   1. no API role updates invoices (totals and status are derived), an INSERT cannot start an invoice as paid, and
--      its total is the formula's;
--   2. no API role inserts payments; record_payment (SECURITY DEFINER, billing:collect in the active clinic) is the
--      only way to pay, and still writes the payment, the status, the audit row;
--   3. adding or removing a charge recomputes the totals and the paid/issued status in the database.
-- Synthetic data only; every probe and the file roll back.
begin;
select plan(25);

-- Fixtures ---------------------------------------------------------------------------------------------------------
-- Clinic A: owner (OA), receptionist (RC), doctor (DR), nurse (NU). One patient, DR's visit, its invoice (issued, one
-- 500 charge), and a second visit of DR without an invoice.
insert into auth.users (id, email) values
  ('b11b0000-0000-4000-8000-000000000201', 'b11b-bill-owner@example.test'),
  ('b11b0000-0000-4000-8000-000000000202', 'b11b-bill-reception@example.test'),
  ('b11b0000-0000-4000-8000-000000000203', 'b11b-bill-doctor@example.test'),
  ('b11b0000-0000-4000-8000-000000000204', 'b11b-bill-nurse@example.test');
insert into public.tenants (id, name) values ('b11b0000-0000-4000-8000-00000000020a', 'Synthetic 05-11b Billing Clinic');
insert into public.memberships (user_id, tenant_id, role) values
  ('b11b0000-0000-4000-8000-000000000201', 'b11b0000-0000-4000-8000-00000000020a', 'owner'),
  ('b11b0000-0000-4000-8000-000000000202', 'b11b0000-0000-4000-8000-00000000020a', 'receptionist'),
  ('b11b0000-0000-4000-8000-000000000203', 'b11b0000-0000-4000-8000-00000000020a', 'doctor'),
  ('b11b0000-0000-4000-8000-000000000204', 'b11b0000-0000-4000-8000-00000000020a', 'nurse');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('b11b0000-0000-4000-8000-000000002001', 'b11b0000-0000-4000-8000-00000000020a', 'Synthetic Bill Patient', '+919000000811',
   'b11b0000-0000-4000-8000-000000000201');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by) values
  ('b11b0000-0000-4000-8000-000000002002', 'b11b0000-0000-4000-8000-00000000020a', 'b11b0000-0000-4000-8000-000000002001',
   'b11b0000-0000-4000-8000-000000000203', 'walk_in', 'b11b0000-0000-4000-8000-000000000201'),
  ('b11b0000-0000-4000-8000-000000002003', 'b11b0000-0000-4000-8000-00000000020a', 'b11b0000-0000-4000-8000-000000002001',
   'b11b0000-0000-4000-8000-000000000203', 'walk_in', 'b11b0000-0000-4000-8000-000000000201');
insert into public.invoices (id, tenant_id, visit_id, patient_id, invoice_number, subtotal, total_amount, status) values
  ('b11b0000-0000-4000-8000-000000002005', 'b11b0000-0000-4000-8000-00000000020a', 'b11b0000-0000-4000-8000-000000002002',
   'b11b0000-0000-4000-8000-000000002001', 'B11B-0001', 500, 500, 'issued');
insert into public.invoice_items (id, tenant_id, invoice_id, item_type, description, unit_price, quantity, total_price) values
  ('b11b0000-0000-4000-8000-000000002006', 'b11b0000-0000-4000-8000-00000000020a', 'b11b0000-0000-4000-8000-000000002005',
   'consultation', 'Synthetic consultation', 500, 1, 500);

-- Helpers ----------------------------------------------------------------------------------------------------------
-- As the user acting in p_header: run p_sql; return the rows affected/returned ('ok' for a value-returning p_sql when
-- p_value), 'denied:<message>' (42501) or 'error:<sqlstate>:<message>'. Rolled back unless p_keep.
create function pg_temp.as_user(p_user uuid, p_header uuid, p_sql text, p_keep boolean default false) returns text
language plpgsql as $f$
declare
  v_rows bigint;
  v_out text;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers',
    case when p_header is null then '' else json_build_object('x-clinicos-tenant', p_header)::text end, true);
  begin
    set local role authenticated;
    execute p_sql;
    get diagnostics v_rows = row_count;
    v_out := v_rows::text;
    reset role;
    if not p_keep then
      raise exception 'b11b sentinel' using errcode = 'P0S11';
    end if;
  exception
    when sqlstate 'P0S11' then null;
    when insufficient_privilege then reset role; v_out := 'denied:' || sqlerrm;
    when others then reset role; v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

create function pg_temp.pay_sql(p_amount numeric, p_cmd text) returns text language sql as $f$
  select format($q$select public.record_payment('b11b0000-0000-4000-8000-00000000020a',
      'b11b0000-0000-4000-8000-000000002005', %s, 'cash', '', %L::uuid)$q$, p_amount, p_cmd)
$f$;

create function pg_temp.invoice_state() returns text language sql as $f$
  select subtotal || '/' || total_amount || '/' || status from public.invoices where id = 'b11b0000-0000-4000-8000-000000002005'
$f$;

-- 1. invoices are not updatable ------------------------------------------------------------------------------------
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000203', 'b11b0000-0000-4000-8000-00000000020a',
  $$update public.invoices set status = 'paid', total_amount = 0 where id = 'b11b0000-0000-4000-8000-000000002005'$$),
  'denied:permission denied for table invoices', 'the visit''s doctor cannot mark the invoice paid or zero it (IND M2 repro)');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000202', 'b11b0000-0000-4000-8000-00000000020a',
  $$update public.invoices set status = 'paid' where id = 'b11b0000-0000-4000-8000-000000002005'$$),
  'denied:permission denied for table invoices', 'nor can a collector: paid comes only from record_payment');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000201', 'b11b0000-0000-4000-8000-00000000020a',
  $$update public.invoices set discount = 500 where id = 'b11b0000-0000-4000-8000-000000002005'$$),
  'denied:permission denied for table invoices', 'nor the owner (totals are derived)');
select is(pg_temp.invoice_state(), '500.00/500.00/issued', 'the invoice is unchanged');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000203', 'b11b0000-0000-4000-8000-00000000020a',
  $$insert into public.invoices (tenant_id, visit_id, patient_id, invoice_number, subtotal, total_amount, status)
    values ('b11b0000-0000-4000-8000-00000000020a', 'b11b0000-0000-4000-8000-000000002003',
            'b11b0000-0000-4000-8000-000000002001', 'B11B-0002', 300, 0, 'paid')$$),
  'denied:INVOICE_STATUS_RPC_ONLY', 'Sign & Bill cannot create an invoice that is already paid');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000203', 'b11b0000-0000-4000-8000-00000000020a',
  $$insert into public.invoices (tenant_id, visit_id, patient_id, invoice_number, subtotal, discount, tax, total_amount, status)
    values ('b11b0000-0000-4000-8000-00000000020a', 'b11b0000-0000-4000-8000-000000002003',
            'b11b0000-0000-4000-8000-000000002001', 'B11B-0002', 300, -50, 0, 0, 'issued')$$),
  'error:P0001:INPUT_INVALID', 'a negative discount is refused');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000203', 'b11b0000-0000-4000-8000-00000000020a',
  $$insert into public.invoices (id, tenant_id, visit_id, patient_id, invoice_number, subtotal, discount, tax, total_amount, status)
    values ('b11b0000-0000-4000-8000-000000002007', 'b11b0000-0000-4000-8000-00000000020a',
            'b11b0000-0000-4000-8000-000000002003', 'b11b0000-0000-4000-8000-000000002001', 'B11B-0002', 300, 20, 5, 1,
            'issued')$$, true),
  '1', 'the doctor''s Sign & Bill INSERT still works');
select is((select total_amount::text from public.invoices where id = 'b11b0000-0000-4000-8000-000000002007'), '285.00',
  'and its total is the formula''s (300 - 20 + 5), not the typed 1');

-- 2. payments only through record_payment ------------------------------------------------------------------------------
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000202', 'b11b0000-0000-4000-8000-00000000020a',
  $$insert into public.payments (tenant_id, invoice_id, amount, payment_method)
    values ('b11b0000-0000-4000-8000-00000000020a', 'b11b0000-0000-4000-8000-000000002005', 500, 'cash')$$),
  'denied:permission denied for table payments', 'a collector cannot insert a payment directly (IND Info 3)');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000203', 'b11b0000-0000-4000-8000-00000000020a',
  pg_temp.pay_sql(500, 'b11b0000-0000-4000-8000-00000000c001')),
  'denied:FORBIDDEN', 'the doctor cannot pay through record_payment either (billing:collect)');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000204', 'b11b0000-0000-4000-8000-00000000020a',
  pg_temp.pay_sql(500, 'b11b0000-0000-4000-8000-00000000c002')),
  'denied:FORBIDDEN', 'nor the nurse (no billing:collect)');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000202', 'b11b0000-0000-4000-8000-00000000020a',
  pg_temp.pay_sql(600, 'b11b0000-0000-4000-8000-00000000c003')),
  'error:P0001:OVERPAYMENT', 'the overpayment check still holds');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000202', 'b11b0000-0000-4000-8000-00000000020a',
  pg_temp.pay_sql(200, 'b11b0000-0000-4000-8000-00000000c004'), true),
  '1', 'the receptionist records a 200 payment through record_payment');
select is(pg_temp.invoice_state(), '500.00/500.00/issued', 'a partial payment keeps it issued');
select is((select recorded_by::text from public.payments where command_id = 'b11b0000-0000-4000-8000-00000000c004'),
  'b11b0000-0000-4000-8000-000000000202', 'the payment names the receptionist');
select is((select count(*)::int from public.audit_logs where tenant_id = 'b11b0000-0000-4000-8000-00000000020a'
            and action = 'invoice.payment_recorded' and actor_id = 'b11b0000-0000-4000-8000-000000000202'), 1,
  'and is audited in the same call');

-- 3. charges recompute the totals and the status ----------------------------------------------------------------------
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000202', 'b11b0000-0000-4000-8000-00000000020a',
  $$insert into public.invoice_items (id, tenant_id, invoice_id, item_type, description, unit_price, quantity, total_price)
    values ('b11b0000-0000-4000-8000-000000002008', 'b11b0000-0000-4000-8000-00000000020a',
            'b11b0000-0000-4000-8000-000000002005', 'procedure', 'Synthetic dressing', 150, 1, 150)$$, true),
  '1', 'the receptionist adds a 150 charge');
select is(pg_temp.invoice_state(), '650.00/650.00/issued', 'subtotal and total follow the items');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000202', 'b11b0000-0000-4000-8000-00000000020a',
  pg_temp.pay_sql(450, 'b11b0000-0000-4000-8000-00000000c005'), true),
  '1', 'the balance is paid through record_payment');
select is(pg_temp.invoice_state(), '650.00/650.00/paid', 'the invoice is paid');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000202', 'b11b0000-0000-4000-8000-00000000020a',
  $$insert into public.invoice_items (id, tenant_id, invoice_id, item_type, description, unit_price, quantity, total_price)
    values ('b11b0000-0000-4000-8000-000000002009', 'b11b0000-0000-4000-8000-00000000020a',
            'b11b0000-0000-4000-8000-000000002005', 'other', 'Synthetic extra', 100, 1, 100)$$, true),
  '1', 'a later charge is added');
select is(pg_temp.invoice_state(), '750.00/750.00/issued', 'and reopens the balance (issued)');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000202', 'b11b0000-0000-4000-8000-00000000020a',
  $$delete from public.invoice_items where id = 'b11b0000-0000-4000-8000-000000002009'$$, true),
  '1', 'removing that charge');
select is(pg_temp.invoice_state(), '650.00/650.00/paid', 'settles it again');

-- 4. catalogue -----------------------------------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.invoices', 'UPDATE')
          and not has_any_column_privilege('authenticated', 'public.invoices', 'UPDATE')
          and not has_any_column_privilege('authenticated', 'public.payments', 'INSERT')
          and (select prosecdef from pg_proc where oid = 'public.record_payment(uuid,uuid,numeric,text,text,uuid,text,text)'::regprocedure),
  'catalogue: no UPDATE on invoices, no INSERT on payments for authenticated; record_payment is SECURITY DEFINER');

select * from finish();
rollback;
