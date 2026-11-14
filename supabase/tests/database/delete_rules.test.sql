-- delete_rules.test.sql — V2-05 plan 05-04 (P1-08, BACKEND C4, research Pitfall 11; R-21, R-22; T-05-06, T-05-07).
--
-- 1. RESTRICT proof (as postgres): clinical and financial history cannot be deleted from under its children; the only
--    non-RESTRICT references to patients/visits/invoices/prescriptions are the planned CASCADE items and SET NULL links.
-- 2. The DELETE policy catalogue is exactly the 05-04 set: no parent DELETE policy, no FOR ALL policy (which would also
--    grant DELETE), every DELETE policy on the authz helpers (active clinic) and never on the legacy rules.
-- 3. Real principals (JWT claims + the x-clinicos-tenant header, R-42): no member deletes a visit or a prescription;
--    the three silent no-ops of Pitfall 11 now delete for the role that performs them (doctor: Rx item, diagnosis;
--    receptionist: invoice item) and still filter to 0 rows for everyone else.
-- 4. Deleting a TENANT still cascades every row of that clinic to 0 (teardown and future purge, research Pitfall 4).
-- Every probe runs in a subtransaction that is always rolled back; the file rolls back. Synthetic data only.
begin;
select plan(35);

-- Fixtures (synthetic) -------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('de000000-0000-4000-8000-000000000101', 'del-owner-a@example.test'),
  ('de000000-0000-4000-8000-000000000102', 'del-admin-a@example.test'),
  ('de000000-0000-4000-8000-000000000103', 'del-doctor-a@example.test'),
  ('de000000-0000-4000-8000-000000000104', 'del-nurse-a@example.test'),
  ('de000000-0000-4000-8000-000000000105', 'del-receptionist-a@example.test'),
  ('de000000-0000-4000-8000-000000000201', 'del-owner-b@example.test'),
  ('de000000-0000-4000-8000-000000000301', 'del-dual@example.test');
insert into public.tenants (id, name) values
  ('de000000-0000-4000-8000-00000000000a', 'Synthetic Delete Clinic A'),
  ('de000000-0000-4000-8000-00000000000b', 'Synthetic Delete Clinic B');
insert into public.memberships (user_id, tenant_id, role) values
  ('de000000-0000-4000-8000-000000000101', 'de000000-0000-4000-8000-00000000000a', 'owner'),
  ('de000000-0000-4000-8000-000000000102', 'de000000-0000-4000-8000-00000000000a', 'admin'),
  ('de000000-0000-4000-8000-000000000103', 'de000000-0000-4000-8000-00000000000a', 'doctor'),
  ('de000000-0000-4000-8000-000000000104', 'de000000-0000-4000-8000-00000000000a', 'nurse'),
  ('de000000-0000-4000-8000-000000000105', 'de000000-0000-4000-8000-00000000000a', 'receptionist'),
  ('de000000-0000-4000-8000-000000000201', 'de000000-0000-4000-8000-00000000000b', 'owner'),
  ('de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-00000000000a', 'doctor'),
  ('de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-00000000000b', 'receptionist');
-- P1: has visits; P2: only a consent record; P3: no history.
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('de000000-0000-4000-8000-000000001001', 'de000000-0000-4000-8000-00000000000a', 'Synthetic Delete Patient 1', '+919000000201', 'de000000-0000-4000-8000-000000000101'),
  ('de000000-0000-4000-8000-000000001002', 'de000000-0000-4000-8000-00000000000a', 'Synthetic Delete Patient 2', '+919000000202', 'de000000-0000-4000-8000-000000000101'),
  ('de000000-0000-4000-8000-000000001003', 'de000000-0000-4000-8000-00000000000a', 'Synthetic Delete Patient 3', '+919000000203', 'de000000-0000-4000-8000-000000000101');
-- V1: full history; V2: no children; V3: only an invoice; V4: only a prescription.
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by) values
  ('de000000-0000-4000-8000-000000001011', 'de000000-0000-4000-8000-00000000000a', 'de000000-0000-4000-8000-000000001001', 'de000000-0000-4000-8000-000000000103', 'walk_in', 'de000000-0000-4000-8000-000000000101'),
  ('de000000-0000-4000-8000-000000001012', 'de000000-0000-4000-8000-00000000000a', 'de000000-0000-4000-8000-000000001001', 'de000000-0000-4000-8000-000000000103', 'walk_in', 'de000000-0000-4000-8000-000000000101'),
  ('de000000-0000-4000-8000-000000001013', 'de000000-0000-4000-8000-00000000000a', 'de000000-0000-4000-8000-000000001001', 'de000000-0000-4000-8000-000000000103', 'walk_in', 'de000000-0000-4000-8000-000000000101'),
  ('de000000-0000-4000-8000-000000001014', 'de000000-0000-4000-8000-00000000000a', 'de000000-0000-4000-8000-000000001001', 'de000000-0000-4000-8000-000000000103', 'walk_in', 'de000000-0000-4000-8000-000000000101');
-- 05-02a: every visit gets a clinical_notes row (trigger); V2 stays childless for the controls below. The notes row's
-- own RESTRICT is proven in clinical_notes.test.sql.
delete from public.clinical_notes where visit_id = 'de000000-0000-4000-8000-000000001012';
-- I1 (V1): item + payment; I2 (V3): item only.
insert into public.invoices (id, tenant_id, visit_id, patient_id, invoice_number) values
  ('de000000-0000-4000-8000-000000001021', 'de000000-0000-4000-8000-00000000000a', 'de000000-0000-4000-8000-000000001011', 'de000000-0000-4000-8000-000000001001', 'DEL-0001'),
  ('de000000-0000-4000-8000-000000001022', 'de000000-0000-4000-8000-00000000000a', 'de000000-0000-4000-8000-000000001013', 'de000000-0000-4000-8000-000000001001', 'DEL-0002');
insert into public.invoice_items (id, tenant_id, invoice_id, item_type, description) values
  ('de000000-0000-4000-8000-000000002001', 'de000000-0000-4000-8000-00000000000a', 'de000000-0000-4000-8000-000000001021', 'consultation', 'Synthetic item 1'),
  ('de000000-0000-4000-8000-000000002003', 'de000000-0000-4000-8000-00000000000a', 'de000000-0000-4000-8000-000000001022', 'consultation', 'Synthetic item 2');
insert into public.payments (id, tenant_id, invoice_id, amount, payment_method, recorded_by) values
  ('de000000-0000-4000-8000-000000002002', 'de000000-0000-4000-8000-00000000000a', 'de000000-0000-4000-8000-000000001021', 100, 'cash', 'de000000-0000-4000-8000-000000000105');
-- RX1 (V1) and RX2 (V4), one item each.
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id) values
  ('de000000-0000-4000-8000-000000001031', 'de000000-0000-4000-8000-00000000000a', 'de000000-0000-4000-8000-000000001011', 'de000000-0000-4000-8000-000000001001', 'de000000-0000-4000-8000-000000000103'),
  ('de000000-0000-4000-8000-000000001032', 'de000000-0000-4000-8000-00000000000a', 'de000000-0000-4000-8000-000000001014', 'de000000-0000-4000-8000-000000001001', 'de000000-0000-4000-8000-000000000103');
insert into public.prescription_items (id, prescription_id, medicine_name, dosage, duration) values
  ('de000000-0000-4000-8000-000000002004', 'de000000-0000-4000-8000-000000001031', 'Synthetic medicine 1', '1-0-1', '5 days'),
  ('de000000-0000-4000-8000-000000002005', 'de000000-0000-4000-8000-000000001032', 'Synthetic medicine 2', '1-0-1', '5 days');
insert into public.consultation_diagnoses (id, tenant_id, visit_id, patient_id, diagnosis_name) values
  ('de000000-0000-4000-8000-000000002006', 'de000000-0000-4000-8000-00000000000a', 'de000000-0000-4000-8000-000000001011', 'de000000-0000-4000-8000-000000001001', 'Synthetic diagnosis');
insert into public.follow_ups (id, tenant_id, patient_id, visit_id, doctor_id, follow_up_date) values
  ('de000000-0000-4000-8000-000000002007', 'de000000-0000-4000-8000-00000000000a', 'de000000-0000-4000-8000-000000001001', 'de000000-0000-4000-8000-000000001011', 'de000000-0000-4000-8000-000000000103', '2030-01-01');
insert into public.consent_records (id, tenant_id, patient_id, consent_type, status, recorded_by) values
  ('de000000-0000-4000-8000-000000002008', 'de000000-0000-4000-8000-00000000000a', 'de000000-0000-4000-8000-000000001002', 'teleconsultation', 'granted', 'de000000-0000-4000-8000-000000000101');

-- Helpers ----------------------------------------------------------------------------------------------------------
-- As postgres: runs one statement in a subtransaction that is ALWAYS rolled back; 'ok' or the SQLSTATE it raised.
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
begin
  begin
    execute p_sql;
    raise exception 'del sentinel' using errcode = 'P0S01';
  exception when others then
    if sqlstate = 'P0S01' then return 'ok'; end if;
    return sqlstate;
  end;
end;
$f$;

-- As a signed-in user (JWT claims; x-clinicos-tenant header when p_header is given): rows affected by p_sql, or
-- 'denied' (42501) / 'error:<sqlstate>'. Always rolled back, like the generated matrix cells.
create function pg_temp.as_user(p_user uuid, p_header uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_rows bigint;
  v_out text;
begin
  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    perform set_config('request.headers',
      case when p_header is null then '' else json_build_object('x-clinicos-tenant', p_header)::text end, true);
    set local role authenticated;
    execute p_sql;
    get diagnostics v_rows = row_count;
    v_out := v_rows::text;
    raise exception 'del sentinel' using errcode = 'P0S01';
  exception
    when sqlstate 'P0S01' then null;
    when insufficient_privilege then v_out := 'denied';
    when others then v_out := 'error:' || sqlstate;
  end;
  return v_out;
end;
$f$;

-- Rows of tenant p_tenant in every table with a single-column FK to public.tenants (any schema).
create function pg_temp.tenant_rows(p_tenant uuid) returns table (tbl text, n bigint) language plpgsql as $f$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass::text as rel, a.attname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.tenants'::regclass and array_length(c.conkey, 1) = 1
  loop
    tbl := r.rel || '.' || r.attname;
    execute format('select count(*) from %s where %I = $1', r.rel, r.attname) into n using p_tenant;
    return next;
  end loop;
end;
$f$;

-- 1. RESTRICT proof (as postgres) -----------------------------------------------------------------------------------
select is(pg_temp.try($$delete from public.patients where id = 'de000000-0000-4000-8000-000000001001'$$), '23503',
  'a patient with visits cannot be deleted (RESTRICT)');
select is(pg_temp.try($$delete from public.patients where id = 'de000000-0000-4000-8000-000000001002'$$), '23503',
  'a patient with only a consent record cannot be deleted (RESTRICT)');
select is(pg_temp.try($$delete from public.patients where id = 'de000000-0000-4000-8000-000000001003'$$), 'ok',
  'control: a patient with no history can be deleted by the superuser');
select is(pg_temp.try($$delete from public.visits where id = 'de000000-0000-4000-8000-000000001013'$$), '23503',
  'a visit with an invoice cannot be deleted (RESTRICT)');
select is(pg_temp.try($$delete from public.visits where id = 'de000000-0000-4000-8000-000000001014'$$), '23503',
  'a visit with a prescription cannot be deleted (RESTRICT)');
select is(pg_temp.try($$delete from public.visits where id = 'de000000-0000-4000-8000-000000001011'$$), '23503',
  'a visit with clinical and financial history cannot be deleted (RESTRICT)');
select is(pg_temp.try($$delete from public.visits where id = 'de000000-0000-4000-8000-000000001012'$$), 'ok',
  'control: a visit with no children can be deleted by the superuser');
select is(pg_temp.try($$delete from public.invoices where id = 'de000000-0000-4000-8000-000000001021'$$), '23503',
  'an invoice with a payment cannot be deleted (RESTRICT)');
select is(pg_temp.try($q$do $d$ begin
    delete from public.invoices where id = 'de000000-0000-4000-8000-000000001022';
    if exists (select 1 from public.invoice_items where invoice_id = 'de000000-0000-4000-8000-000000001022') then
      raise exception 'items survived' using errcode = 'P0S02';
    end if;
  end $d$$q$), 'ok',
  'an invoice without payments can be deleted and its items cascade');
select is(pg_temp.try($q$do $d$ begin
    delete from public.prescriptions where id = 'de000000-0000-4000-8000-000000001032';
    if exists (select 1 from public.prescription_items where prescription_id = 'de000000-0000-4000-8000-000000001032') then
      raise exception 'items survived' using errcode = 'P0S02';
    end if;
  end $d$$q$), 'ok',
  'a prescription (as postgres) can be deleted and its items cascade');
select is(pg_temp.try($$delete from public.memberships where user_id = 'de000000-0000-4000-8000-000000000103' and tenant_id = 'de000000-0000-4000-8000-00000000000a'$$), '23503',
  'the membership of a doctor named on visits cannot be deleted (RESTRICT)');
select set_eq(
  $$select conname::text, confdeltype::text from pg_constraint
    where contype = 'f' and confrelid in ('public.patients'::regclass, 'public.visits'::regclass,
                                           'public.invoices'::regclass, 'public.prescriptions'::regclass)
      and confdeltype <> 'r'$$,
  $$values ('invoice_items_tenant_invoice_fkey', 'c'), ('prescription_items_tenant_prescription_fkey', 'c'),
           ('follow_ups_tenant_visit_fkey', 'n'), ('patient_documents_tenant_visit_fkey', 'n'),
           ('referrals_tenant_visit_fkey', 'n'), ('communication_queue_tenant_appointment_fkey', 'n')$$,
  'every other reference to a patient, visit, invoice or prescription is RESTRICT (P1-08: no CASCADE of history)');

-- 2. The DELETE policy catalogue ----------------------------------------------------------------------------------
select set_eq(
  $$select tablename::text, policyname::text from pg_policies where schemaname = 'public' and cmd in ('DELETE', 'ALL')$$,
  $$values ('api_key_usage_daily', 'api_key_usage_daily_delete'), ('api_keys', 'api_keys_delete'),
           ('consultation_diagnoses', 'consultation_diagnoses_delete'),
           ('doctor_custom_diagnoses', 'doctor_custom_diagnoses_delete'),
           ('doctor_custom_medicines', 'doctor_custom_medicines_delete'),
           ('doctor_prescription_templates', 'doctor_prescription_templates_delete'),
           ('follow_ups', 'follow_ups_delete'), ('in_app_notifications', 'in_app_notifications_delete'),
           ('invoice_items', 'invoice_items_delete'), ('patient_documents', 'patient_documents_delete'),
           ('prescription_items', 'prescription_items_delete'), ('schedule_blocks', 'schedule_blocks_delete'),
           ('webhook_subscriptions', 'webhook_subscriptions_delete')$$,
  'the DELETE policies are exactly the 05-04 set (no visits, prescriptions, queue_tokens, waitlist_entries, referrals, ...)');
select is_empty(
  $$select tablename from pg_policies where schemaname = 'public' and cmd = 'ALL'$$,
  'no FOR ALL policy is left on a public table (it would also grant DELETE)');
select is_empty(
  $$select policyname from pg_policies where schemaname = 'public' and cmd = 'DELETE'
      and (qual ~ 'current_user_tenant_ids|memberships' or qual !~ 'authz\.(tenant_ids_with|full_tenant_ids)')$$,
  'every DELETE policy binds the active clinic through the authz helpers, never the legacy rules');

-- 3. Real principals ------------------------------------------------------------------------------------------------
select is(pg_temp.as_user('de000000-0000-4000-8000-000000000101', null,
  $$delete from public.visits where id = 'de000000-0000-4000-8000-000000001012'$$), '0',
  'the owner cannot delete a visit, even one without children (visits_delete_member dropped)');
select is(pg_temp.as_user('de000000-0000-4000-8000-000000000102', null,
  $$delete from public.visits where id = 'de000000-0000-4000-8000-000000001012'$$), '0',
  'an admin cannot delete a visit');
select is(pg_temp.as_user('de000000-0000-4000-8000-000000000101', null,
  $$delete from public.prescriptions where id = 'de000000-0000-4000-8000-000000001032'$$), '0',
  'the owner cannot delete a prescription');
select is(pg_temp.as_user('de000000-0000-4000-8000-000000000101', null,
  $$delete from public.patients where id = 'de000000-0000-4000-8000-000000001003'$$), '0',
  'the owner cannot delete a patient');
select is(pg_temp.as_user('de000000-0000-4000-8000-000000000103', null,
  $$delete from public.prescription_items where id = 'de000000-0000-4000-8000-000000002004'$$), '1',
  'a doctor deletes a draft Rx item (was a silent no-op: owner/admin-only policy)');
select is(pg_temp.as_user('de000000-0000-4000-8000-000000000104', null,
  $$delete from public.prescription_items where id = 'de000000-0000-4000-8000-000000002004'$$), '0',
  'a nurse cannot delete an Rx item');
select is(pg_temp.as_user('de000000-0000-4000-8000-000000000105', null,
  $$delete from public.prescription_items where id = 'de000000-0000-4000-8000-000000002004'$$), '0',
  'a receptionist cannot delete an Rx item');
select is(pg_temp.as_user('de000000-0000-4000-8000-000000000102', null,
  $$delete from public.prescription_items where id = 'de000000-0000-4000-8000-000000002004'$$), '0',
  'an admin cannot delete an Rx item (R-9: no clinical access)');
select is(pg_temp.as_user('de000000-0000-4000-8000-000000000103', null,
  $$delete from public.consultation_diagnoses where id = 'de000000-0000-4000-8000-000000002006'$$), '1',
  'a doctor removes a diagnosis (was a silent no-op: owner/admin-only policy)');
select is(pg_temp.as_user('de000000-0000-4000-8000-000000000105', null,
  $$delete from public.consultation_diagnoses where id = 'de000000-0000-4000-8000-000000002006'$$), '0',
  'a receptionist cannot remove a diagnosis');
select is(pg_temp.as_user('de000000-0000-4000-8000-000000000105', null,
  $$delete from public.invoice_items where id = 'de000000-0000-4000-8000-000000002001'$$), '1',
  'a receptionist deletes an invoice item (was a silent no-op: no DELETE policy)');
select is(pg_temp.as_user('de000000-0000-4000-8000-000000000103', null,
  $$delete from public.invoice_items where id = 'de000000-0000-4000-8000-000000002001'$$), '0',
  'a doctor cannot delete an invoice item (billing:collect, PO-3)');
select is(pg_temp.as_user('de000000-0000-4000-8000-000000000103', null,
  $$delete from public.follow_ups where id = 'de000000-0000-4000-8000-000000002007'$$), '1',
  'a doctor clears a follow-up (was a silent no-op: owner/admin-only policy)');
select is(pg_temp.as_user('de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-00000000000a',
  $$delete from public.consultation_diagnoses where id = 'de000000-0000-4000-8000-000000002006'$$), '1',
  'a dual member acting in clinic A (doctor there) removes an A diagnosis');
select is(pg_temp.as_user('de000000-0000-4000-8000-000000000301', 'de000000-0000-4000-8000-00000000000b',
  $$delete from public.consultation_diagnoses where id = 'de000000-0000-4000-8000-000000002006'$$), '0',
  'the same dual member acting in clinic B cannot delete an A row (active-tenant binding, R-42)');
select is(pg_temp.as_user('de000000-0000-4000-8000-000000000301', null,
  $$delete from public.consultation_diagnoses where id = 'de000000-0000-4000-8000-000000002006'$$), '0',
  'a dual member with no active clinic deletes nothing');
select is(pg_temp.as_user('de000000-0000-4000-8000-000000000201', null,
  $$delete from public.invoice_items where id = 'de000000-0000-4000-8000-000000002001'$$), '0',
  'clinic B''s owner cannot delete a clinic-A invoice item');

-- 4. Deleting the tenant cascades every row of the clinic -----------------------------------------------------------
select cmp_ok((select count(*)::int from pg_temp.tenant_rows('de000000-0000-4000-8000-00000000000a') where n > 0), '>=', 11,
  'before: clinic A has rows in at least 11 tenant tables');
select lives_ok($$delete from public.tenants where id = 'de000000-0000-4000-8000-00000000000a'$$,
  'deleting clinic A as postgres succeeds although its children RESTRICT each other');
select is((select coalesce(sum(n), 0)::int from pg_temp.tenant_rows('de000000-0000-4000-8000-00000000000a')), 0,
  'after: no row of clinic A is left in any table with a tenant foreign key');

select * from finish();
rollback;
