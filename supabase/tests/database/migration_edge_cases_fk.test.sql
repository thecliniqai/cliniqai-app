-- migration_edge_cases_fk.test.sql — V2-05 plan 05-03 (roadmap V2-05 test "migration tests on a copy seeded with the
-- diagnostics' edge cases", FK half; R-12, R-15; BACKEND §3 D1/D5, §6 C2-C3).
--
-- On this transaction's copy of the schema, each case removes one composite FK, plants the edge case the diagnostics
-- look for, and replays the expand → validate path of 000049/000050: re-adding the FK NOT VALID succeeds (existing rows
-- are not checked), VALIDATE fails 23503 while the row is there, the diagnostics query (BACKEND §3 D1 / D5 verbatim)
-- finds it, and once the row is corrected VALIDATE succeeds. The prescription_items case replays 000048's backfill
-- statement (verbatim, pinned by tests/ci/fk-edge-cases-inline.spec.ts) on an item that predates the column. Everything is rolled back; synthetic data only.
begin;
select plan(21);

insert into auth.users (id, email) values ('ed000000-0000-4000-8000-000000000101', 'edge-doctor-a@example.test'), ('ed000000-0000-4000-8000-000000000201', 'edge-owner-b@example.test');
insert into public.tenants (id, name) values ('ed000000-0000-4000-8000-00000000000a', 'Synthetic Edge Clinic A'), ('ed000000-0000-4000-8000-00000000000b', 'Synthetic Edge Clinic B');
insert into public.memberships (user_id, tenant_id, role) values ('ed000000-0000-4000-8000-000000000101', 'ed000000-0000-4000-8000-00000000000a', 'doctor'), ('ed000000-0000-4000-8000-000000000201', 'ed000000-0000-4000-8000-00000000000b', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('ed000000-0000-4000-8000-000000001001', 'ed000000-0000-4000-8000-00000000000a', 'Synthetic Edge Patient A', '+919000000201', 'ed000000-0000-4000-8000-000000000101'),
  ('ed000000-0000-4000-8000-000000001002', 'ed000000-0000-4000-8000-00000000000b', 'Synthetic Edge Patient B', '+919000000202', 'ed000000-0000-4000-8000-000000000201');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by) values
  ('ed000000-0000-4000-8000-000000001003', 'ed000000-0000-4000-8000-00000000000a', 'ed000000-0000-4000-8000-000000001001', 'ed000000-0000-4000-8000-000000000101', 'walk_in', 'ed000000-0000-4000-8000-000000000101');
insert into public.webhook_subscriptions (id, tenant_id, endpoint_url, event_types, signing_secret) values
  ('ed000000-0000-4000-8000-000000001006', 'ed000000-0000-4000-8000-00000000000a', 'https://hooks.example.test/edge-a', array['ping'], repeat('s', 32)),
  ('ed000000-0000-4000-8000-000000001007', 'ed000000-0000-4000-8000-00000000000b', 'https://hooks.example.test/edge-b', array['ping'], repeat('s', 32));
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id) values ('ed000000-0000-4000-8000-000000001009', 'ed000000-0000-4000-8000-00000000000a', 'ed000000-0000-4000-8000-000000001003', 'ed000000-0000-4000-8000-000000001001', 'ed000000-0000-4000-8000-000000000101');

-- Case 1 (D1, DB-01): a tenant-A visit naming a tenant-B patient -------------------------------------------------------
alter table public.visits drop constraint visits_tenant_patient_fkey;
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by) values ('ed000000-0000-4000-8000-000000001004', 'ed000000-0000-4000-8000-00000000000a', 'ed000000-0000-4000-8000-000000001002', 'ed000000-0000-4000-8000-000000000101', 'walk_in', 'ed000000-0000-4000-8000-000000000101');
select is((select count(*)::int from visits v join patients p on p.id = v.patient_id where v.tenant_id <> p.tenant_id), 1, 'D1 (visits→patients) finds the planted cross-tenant visit');
select lives_ok($$alter table public.visits add constraint visits_tenant_patient_fkey foreign key (tenant_id, patient_id)
                  references public.patients (tenant_id, id) on delete restrict not valid$$,
  'D1: the composite FK is added NOT VALID over the bad row (expand)');
select throws_ok($$alter table public.visits validate constraint visits_tenant_patient_fkey$$, '23503', null,
  'D1: VALIDATE fails while the cross-tenant visit exists');
select lives_ok($$update public.visits set patient_id = 'ed000000-0000-4000-8000-000000001001' where id = 'ed000000-0000-4000-8000-000000001004'$$, 'D1: the row is corrected to its own clinic''s patient');
select is((select count(*)::int from visits v join patients p on p.id = v.patient_id where v.tenant_id <> p.tenant_id), 0, 'D1 is 0 after the correction');
select lives_ok($$alter table public.visits validate constraint visits_tenant_patient_fkey$$, 'D1: VALIDATE succeeds once D1 = 0');

-- Case 2 (D5, DB-02): a tenant-A visit whose doctor is not a member of A ------------------------------------------------
alter table public.visits drop constraint visits_tenant_doctor_fkey;
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by) values ('ed000000-0000-4000-8000-000000001005', 'ed000000-0000-4000-8000-00000000000a', 'ed000000-0000-4000-8000-000000001001', 'ed000000-0000-4000-8000-000000000201', 'walk_in', 'ed000000-0000-4000-8000-000000000101');
select is((select count(*)::int from visits v where not exists (select 1 from memberships m where m.tenant_id=v.tenant_id and m.user_id=v.doctor_id)), 1, 'D5 finds the planted visit of a non-member doctor');
select lives_ok($$alter table public.visits add constraint visits_tenant_doctor_fkey foreign key (doctor_id, tenant_id)
                  references public.memberships (user_id, tenant_id) on delete restrict not valid$$,
  'D5: the doctor FK is added NOT VALID over the bad row (expand)');
select throws_ok($$alter table public.visits validate constraint visits_tenant_doctor_fkey$$, '23503', null,
  'D5: VALIDATE fails while the non-member doctor''s visit exists');
select lives_ok($$update public.visits set doctor_id = 'ed000000-0000-4000-8000-000000000101' where id = 'ed000000-0000-4000-8000-000000001005'$$, 'D5: the visit is reassigned to a member doctor');
select is((select count(*)::int from visits v where not exists (select 1 from memberships m where m.tenant_id=v.tenant_id and m.user_id=v.doctor_id)), 0, 'D5 is 0 after the correction');
select lives_ok($$alter table public.visits validate constraint visits_tenant_doctor_fkey$$, 'D5: VALIDATE succeeds once D5 = 0');

-- Case 3 (D1x, M-XTENANT-WH): a tenant-A webhook delivery naming tenant B's subscription --------------------------------
alter table public.webhook_delivery_queue drop constraint webhook_delivery_queue_tenant_subscription_fkey;
insert into public.webhook_delivery_queue (id, tenant_id, subscription_id, event_type, payload, status) values ('ed000000-0000-4000-8000-000000001008', 'ed000000-0000-4000-8000-00000000000a', 'ed000000-0000-4000-8000-000000001007', 'ping', '{}', 'delivered');
select lives_ok($$alter table public.webhook_delivery_queue add constraint webhook_delivery_queue_tenant_subscription_fkey
                  foreign key (tenant_id, subscription_id) references public.webhook_subscriptions (tenant_id, id) on delete cascade not valid$$,
  'M-XTENANT-WH: the composite FK is added NOT VALID over the bad row (expand)');
select throws_ok($$alter table public.webhook_delivery_queue validate constraint webhook_delivery_queue_tenant_subscription_fkey$$, '23503', null,
  'M-XTENANT-WH: VALIDATE fails while the cross-tenant delivery exists');
select lives_ok($$update public.webhook_delivery_queue set subscription_id = 'ed000000-0000-4000-8000-000000001006' where id = 'ed000000-0000-4000-8000-000000001008'$$, 'M-XTENANT-WH: the row is corrected');
select lives_ok($$alter table public.webhook_delivery_queue validate constraint webhook_delivery_queue_tenant_subscription_fkey$$,
  'M-XTENANT-WH: VALIDATE succeeds once corrected');

-- Case 4 (000048): an item that predates prescription_items.tenant_id is backfilled from its prescription ------------
alter table public.prescription_items alter column tenant_id drop not null;
alter table public.prescription_items disable trigger prescription_items_fill_tenant;
insert into public.prescription_items (id, prescription_id, medicine_name, dosage, duration) values ('ed000000-0000-4000-8000-00000000100a', 'ed000000-0000-4000-8000-000000001009', 'Synthetic', '1-0-1', '5 days');
alter table public.prescription_items enable trigger prescription_items_fill_tenant;
select is((select tenant_id from public.prescription_items where id = 'ed000000-0000-4000-8000-00000000100a'), null::uuid, '000048: the planted item has no tenant_id (as before the column)');
select lives_ok($$UPDATE public.prescription_items i
   SET tenant_id = p.tenant_id
  FROM public.prescriptions p
 WHERE p.id = i.prescription_id
   AND i.tenant_id IS NULL$$, '000048: the backfill statement runs');
select is((select tenant_id from public.prescription_items where id = 'ed000000-0000-4000-8000-00000000100a'), 'ed000000-0000-4000-8000-00000000000a'::uuid, '000048: the backfill gives the item its prescription''s tenant');
select lives_ok($$alter table public.prescription_items alter column tenant_id set not null$$, '000048: NOT NULL is enforceable after the backfill');
select is((select count(*)::int from public.prescription_items i join public.prescriptions p on p.id = i.prescription_id
            where i.tenant_id is distinct from p.tenant_id), 0, '000048: no item disagrees with its prescription''s tenant');
select * from finish();
rollback;
