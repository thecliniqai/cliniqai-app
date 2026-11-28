-- sign_and_bill_context.test.sql — V2-10 10-02 (D-10; migration 000141; threat T-10-04: another clinic's or another doctor's bill, a field beyond the
-- allow-list, a version that is not the visit's).
-- public.sign_and_bill_context(tenant, visit): what Sign & Bill reads when it opens, in one STABLE INVOKER read.
--   1. grants and shape: INVOKER, STABLE, search_path pinned, EXECUTE for authenticated only;
--   2. refusals (NULL): another clinic (either id), a forged tenant, no session, NULL arguments, a doctor on another doctor's visit, a role with neither
--      billing:collect nor consultations:edit (nurse), a user with no membership; the visit's own doctor, a receptionist (billing:collect), the admin and
--      the owner answer;
--   3. the exact allow-list of key paths (with and without an invoice); no patient, name, phone or note key at any level;
--   4. values: the clinic's fees (650 / 300; null when the clinic set none), methods, the visit's row_version and status (also after the visit moved, from
--      the same statement), the live invoice with its paid total (null with none, null for a cancelled one).
-- Every call runs under the real principal. The file rolls back. Synthetic data only.
begin;
select plan(30);

insert into auth.users (id, email) values
  ('c1410000-0000-4000-8000-000000000101', 'c141-owner-a@example.test'),
  ('c1410000-0000-4000-8000-000000000102', 'c141-doctor1-a@example.test'),
  ('c1410000-0000-4000-8000-000000000103', 'c141-doctor2-a@example.test'),
  ('c1410000-0000-4000-8000-000000000104', 'c141-receptionist-a@example.test'),
  ('c1410000-0000-4000-8000-000000000105', 'c141-nurse-a@example.test'),
  ('c1410000-0000-4000-8000-000000000106', 'c141-admin-a@example.test'),
  ('c1410000-0000-4000-8000-000000000201', 'c141-owner-b@example.test'),
  ('c1410000-0000-4000-8000-000000000301', 'c141-outsider@example.test');
insert into public.tenants (id, name, default_consultation_fee, default_followup_fee, accepted_payment_methods) values
  ('c1410000-0000-4000-8000-00000000000a', 'Synthetic 000141 Clinic A', 650, 300, array['cash', 'upi']),
  ('c1410000-0000-4000-8000-00000000000b', 'Synthetic 000141 Clinic B', null, null, array['cash', 'upi', 'card']);
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1410000-0000-4000-8000-00000000000a', 'c1410000-0000-4000-8000-00000000000b') and s.status = 'incomplete';
insert into public.memberships (user_id, tenant_id, role, full_name) values
  ('c1410000-0000-4000-8000-000000000101', 'c1410000-0000-4000-8000-00000000000a', 'owner', 'Synthetic Owner A'),
  ('c1410000-0000-4000-8000-000000000102', 'c1410000-0000-4000-8000-00000000000a', 'doctor', 'Synthetic Doctor One'),
  ('c1410000-0000-4000-8000-000000000103', 'c1410000-0000-4000-8000-00000000000a', 'doctor', 'Synthetic Doctor Two'),
  ('c1410000-0000-4000-8000-000000000104', 'c1410000-0000-4000-8000-00000000000a', 'receptionist', 'Synthetic Receptionist A'),
  ('c1410000-0000-4000-8000-000000000105', 'c1410000-0000-4000-8000-00000000000a', 'nurse', 'Synthetic Nurse A'),
  ('c1410000-0000-4000-8000-000000000106', 'c1410000-0000-4000-8000-00000000000a', 'admin', 'Synthetic Admin A'),
  ('c1410000-0000-4000-8000-000000000201', 'c1410000-0000-4000-8000-00000000000b', 'owner', 'Synthetic Owner B');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1410000-0000-4000-8000-000000001001', 'c1410000-0000-4000-8000-00000000000a', 'Synthetic Bill Patient A', '+919000014101', 'c1410000-0000-4000-8000-000000000101'),
  ('c1410000-0000-4000-8000-000000001002', 'c1410000-0000-4000-8000-00000000000b', 'Synthetic Bill Patient B', '+919000014102', 'c1410000-0000-4000-8000-000000000201');
-- 2001: doctor one's waiting visit (no invoice); 2002: doctor one's visit with a live invoice and two payments; 2003: a visit whose only invoice was cancelled;
-- 2004: clinic B's visit.
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1410000-0000-4000-8000-000000002001', 'c1410000-0000-4000-8000-00000000000a', 'c1410000-0000-4000-8000-000000001001', 'c1410000-0000-4000-8000-000000000102', 'walk_in', 'waiting', 'c1410000-0000-4000-8000-000000000104'),
  ('c1410000-0000-4000-8000-000000002002', 'c1410000-0000-4000-8000-00000000000a', 'c1410000-0000-4000-8000-000000001001', 'c1410000-0000-4000-8000-000000000102', 'walk_in', 'waiting', 'c1410000-0000-4000-8000-000000000104'),
  ('c1410000-0000-4000-8000-000000002003', 'c1410000-0000-4000-8000-00000000000a', 'c1410000-0000-4000-8000-000000001001', 'c1410000-0000-4000-8000-000000000102', 'walk_in', 'waiting', 'c1410000-0000-4000-8000-000000000104'),
  ('c1410000-0000-4000-8000-000000002004', 'c1410000-0000-4000-8000-00000000000b', 'c1410000-0000-4000-8000-000000001002', 'c1410000-0000-4000-8000-000000000201', 'walk_in', 'waiting', 'c1410000-0000-4000-8000-000000000201');
insert into public.invoices (id, tenant_id, visit_id, patient_id, invoice_number, subtotal, total_amount, status) values
  ('c1410000-0000-4000-8000-000000003001', 'c1410000-0000-4000-8000-00000000000a', 'c1410000-0000-4000-8000-000000002002', 'c1410000-0000-4000-8000-000000001001', 'INV-C141-1', 650, 650, 'issued'),
  ('c1410000-0000-4000-8000-000000003002', 'c1410000-0000-4000-8000-00000000000a', 'c1410000-0000-4000-8000-000000002003', 'c1410000-0000-4000-8000-000000001001', 'INV-C141-2', 400, 400, 'cancelled');
insert into public.payments (id, tenant_id, invoice_id, amount, payment_method, recorded_by) values
  ('c1410000-0000-4000-8000-000000004001', 'c1410000-0000-4000-8000-00000000000a', 'c1410000-0000-4000-8000-000000003001', 200, 'cash', 'c1410000-0000-4000-8000-000000000104'),
  ('c1410000-0000-4000-8000-000000004002', 'c1410000-0000-4000-8000-00000000000a', 'c1410000-0000-4000-8000-000000003001', 150.50, 'upi', 'c1410000-0000-4000-8000-000000000104');

-- p_active: the session's active clinic (the x-clinicos-tenant header the app sends).
create function pg_temp.as_user(p_user uuid, p_sql text, p_active uuid default null) returns text language plpgsql as $f$
declare v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', case when p_active is null then '' else json_build_object('x-clinicos-tenant', p_active)::text end, true);
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
create function pg_temp.uid(p_user text) returns uuid language sql as $f$ select ('c1410000-0000-4000-8000-000000000' || p_user)::uuid $f$;
create function pg_temp.tid(p_tenant text) returns uuid language sql as $f$ select ('c1410000-0000-4000-8000-00000000000' || p_tenant)::uuid $f$;
create function pg_temp.vid(p_visit text) returns uuid language sql as $f$ select ('c1410000-0000-4000-8000-00000000' || p_visit)::uuid $f$;
-- The context as a user whose session's active clinic is the one asked for (as the app calls it): the jsonb text, or 'NULL'.
create function pg_temp.ctx(p_user text, p_visit text, p_tenant text default 'a') returns text language sql as $f$
  select pg_temp.as_user(pg_temp.uid(p_user), format($q$ select coalesce(public.sign_and_bill_context(%L, %L)::text, 'NULL') $q$, pg_temp.tid(p_tenant), pg_temp.vid(p_visit)), pg_temp.tid(p_tenant))
$f$;
create function pg_temp.paths(j jsonb, prefix text default '') returns setof text language plpgsql as $f$
declare k text; v jsonb; e jsonb;
begin
  if jsonb_typeof(j) = 'object' then
    for k, v in select * from jsonb_each(j) loop
      return next prefix || k;
      return query select * from pg_temp.paths(v, prefix || k || '.');
    end loop;
  elsif jsonb_typeof(j) = 'array' then
    for e in select * from jsonb_array_elements(j) loop
      return query select * from pg_temp.paths(e, rtrim(prefix, '.') || '[].');
    end loop;
  end if;
end;
$f$;
create function pg_temp.path_set(p_json text) returns text language sql as $f$
  select string_agg(distinct p, ',' order by p) from pg_temp.paths(p_json::jsonb) p
$f$;

-- 1. Grants and shape -------------------------------------------------------------------------------------------------------
select is((select p.prosecdef::text || ':' || p.provolatile::text || ':' || array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'public.sign_and_bill_context(uuid,uuid)'::regprocedure),
  'false:s:search_path=""', 'sign_and_bill_context is a STABLE INVOKER function with search_path pinned');
select is((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text)
             from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid = 'public.sign_and_bill_context(uuid,uuid)'::regprocedure and a.grantee <> p.proowner),
  'authenticated:EXECUTE', 'EXECUTE is granted to authenticated only (not PUBLIC, anon or service_role)');
select throws_ok($$ set local role anon; select public.sign_and_bill_context('c1410000-0000-4000-8000-00000000000a', 'c1410000-0000-4000-8000-000000002001') $$, '42501', null, 'anon cannot execute it');
select throws_ok($$ set local role service_role; select public.sign_and_bill_context('c1410000-0000-4000-8000-00000000000a', 'c1410000-0000-4000-8000-000000002001') $$, '42501', null, 'service_role cannot execute it (no service-role path)');

-- 2. Refusals and who answers ------------------------------------------------------------------------------------------------
select is(pg_temp.ctx('201', '2001', 'a'), 'NULL', 'the owner of B asking for A''s visit in A gets NULL (another clinic)');
select is(pg_temp.ctx('101', '2004', 'a'), 'NULL', 'the owner of A asking for B''s visit under A gets NULL (the visit is not A''s)');
select is(pg_temp.ctx('101', '2001', 'b'), 'NULL', 'the owner of A asking under B gets NULL (not a member of B)');
select is(pg_temp.as_user(pg_temp.uid('101'), $q$ select coalesce(public.sign_and_bill_context('c1410000-0000-4000-8000-0000000000ff', 'c1410000-0000-4000-8000-000000002001')::text, 'NULL') $q$), 'NULL', 'an unknown (forged) tenant gets NULL');
select is((select coalesce(public.sign_and_bill_context('c1410000-0000-4000-8000-00000000000a', 'c1410000-0000-4000-8000-000000002001')::text, 'NULL')), 'NULL', 'no session gets NULL');
select is(pg_temp.as_user(pg_temp.uid('101'), $q$ select coalesce(public.sign_and_bill_context(null, 'c1410000-0000-4000-8000-000000002001')::text, 'NULL') $q$, pg_temp.tid('a')), 'NULL', 'a NULL tenant gets NULL');
select is(pg_temp.as_user(pg_temp.uid('101'), $q$ select coalesce(public.sign_and_bill_context('c1410000-0000-4000-8000-00000000000a', null)::text, 'NULL') $q$, pg_temp.tid('a')), 'NULL', 'a NULL visit gets NULL');
select is(pg_temp.ctx('103', '2001'), 'NULL', 'a doctor asking for another doctor''s visit gets NULL (consultations:edit is not enough without billing:collect)');
select is(pg_temp.ctx('105', '2001'), 'NULL', 'a nurse (neither billing:collect nor consultations:edit) gets NULL');
select is(pg_temp.ctx('301', '2001'), 'NULL', 'a user with no membership gets NULL');
select is((select string_agg(r, ',' order by r) from unnest(array['101', '102', '103', '104', '105', '106']) r where pg_temp.ctx(r, '2001') <> 'NULL'),
  '101,102,104,106', 'the visit''s own doctor, the receptionist (billing:collect), the admin and the owner answer; the other doctor and the nurse do not');

-- 3. The exact allow-list -----------------------------------------------------------------------------------------------------
select is(pg_temp.path_set(pg_temp.ctx('102', '2001')),
  'fee,fee.consultation,fee.followup,invoice,methods,visit,visit.id,visit.row_version,visit.status',
  'every key path of the answer without an invoice is exactly the allow-list');
select is(pg_temp.path_set(pg_temp.ctx('102', '2002')),
  'fee,fee.consultation,fee.followup,invoice,invoice.id,invoice.paid,invoice.row_version,invoice.total,methods,visit,visit.id,visit.row_version,visit.status',
  'every key path of the answer with an invoice is exactly the allow-list');
select is(pg_temp.path_set(pg_temp.ctx('104', '2002')), pg_temp.path_set(pg_temp.ctx('102', '2002')), 'the receptionist''s answer has the same key paths as the doctor''s (no role sees more)');
select is((select count(*)::integer from pg_temp.paths(pg_temp.ctx('101', '2002')::jsonb) p
            where p ~* '(patient|name|phone|note|diagnos|prescri|doctor|email|address)'), 0,
  'no patient, name, phone, note, diagnosis, prescription, doctor, email or address key at any level');

-- 4. Values ---------------------------------------------------------------------------------------------------------------------
select is(pg_temp.ctx('102', '2001')::jsonb -> 'fee', '{"consultation": 650.00, "followup": 300.00}'::jsonb, 'fee: the clinic''s consultation and follow-up fee as stored (650 / 300)');
select is(pg_temp.ctx('201', '2004', 'b')::jsonb -> 'fee', '{"consultation": null, "followup": null}'::jsonb, 'fee: a clinic that set none answers null (never a made-up 500)');
select is(pg_temp.ctx('102', '2001')::jsonb -> 'methods', '["cash", "upi"]'::jsonb, 'methods: the clinic''s accepted payment methods');
select is(pg_temp.ctx('102', '2001')::jsonb -> 'visit',
  jsonb_build_object('id', pg_temp.vid('2001'), 'row_version', (select v.row_version from public.visits v where v.id = pg_temp.vid('2001')), 'status', 'waiting'),
  'visit: id, the row_version in the table and the status');
update public.visits set status = 'in_consultation' where id = 'c1410000-0000-4000-8000-000000002001';
select is((pg_temp.ctx('102', '2001')::jsonb #>> '{visit,row_version}')::bigint, (select v.row_version from public.visits v where v.id = pg_temp.vid('2001')),
  'after the visit moved the answer carries its new row_version');
select cmp_ok((pg_temp.ctx('102', '2001')::jsonb #>> '{visit,row_version}')::bigint, '>', 0::bigint, 'the visit''s row_version moved with the status change');
select is(pg_temp.ctx('102', '2001')::jsonb #>> '{visit,status}', 'in_consultation', 'the status is the new one, from the same statement as the version');
select is(pg_temp.ctx('102', '2001')::jsonb -> 'invoice', 'null'::jsonb, 'invoice: null for a visit with no invoice');
select is(pg_temp.ctx('102', '2002')::jsonb -> 'invoice',
  jsonb_build_object('id', 'c1410000-0000-4000-8000-000000003001'::uuid, 'row_version', (select i.row_version from public.invoices i where i.id = 'c1410000-0000-4000-8000-000000003001'), 'total', 650.00, 'paid', 350.50),
  'invoice: the live invoice with its total and the sum of its payments (200 + 150.50)');
select is(pg_temp.ctx('102', '2003')::jsonb -> 'invoice', 'null'::jsonb, 'invoice: a cancelled invoice is not the live one (null)');
update public.tenants set default_consultation_fee = 725.50 where id = 'c1410000-0000-4000-8000-00000000000a';
select is(pg_temp.ctx('104', '2001')::jsonb #>> '{fee,consultation}', '725.50', 'a fee changed in Settings is answered at once (read, never held)');

select * from finish();
rollback;
