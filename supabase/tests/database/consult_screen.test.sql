-- consult_screen.test.sql — V2-09e 09E-05 (R-8, R-9; migration 000124; threats: data of another clinic or another doctor in the consult's one read).
-- public.consult_screen(tenant, visit): the consult in one read, a STABLE INVOKER function composed of existing reads.
--   1. grants and shape: INVOKER, search_path pinned, EXECUTE for authenticated only;
--   2. refusals: another clinic's visit, a forged tenant, a visit that is not in the tenant, a role without consultations:view, no membership, no session
--      and NULL arguments all return NULL (never an error that tells them apart);
--   3. the role x part matrix: owner, the visit's doctor, another doctor, nurse (labs part, no lists, no macros, no learned order);
--   4. the record states: a draft reads the editable parts, a sealed, an unsigned completed and a cancelled record do not; an amending one carries the
--      amendment (reason and opened at) and the editable parts again;
--   5. the caller's OWN lists only (custom medicines, custom diagnoses, templates, macros): another doctor's rows never appear, the caps hold;
--   6. entitlements: an entitlement off removes its part; a clinic that is not full has no assist part at all;
--   7. the parts' content: diagnoses, prescription items and latest version, the history without the current visit, documents newest first,
--      follow-up, upcoming instants, allergy context, token number.
-- Every call runs under the real principal. The file rolls back. Synthetic data only.
begin;
select plan(73);

-- Fixtures ----------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1240000-0000-4000-8000-000000000101', 'c124-owner-a@example.test'),
  ('c1240000-0000-4000-8000-000000000102', 'c124-doctor-a@example.test'),
  ('c1240000-0000-4000-8000-000000000103', 'c124-admin-a@example.test'),
  ('c1240000-0000-4000-8000-000000000104', 'c124-nurse-a@example.test'),
  ('c1240000-0000-4000-8000-000000000105', 'c124-receptionist-a@example.test'),
  ('c1240000-0000-4000-8000-000000000106', 'c124-doctor2-a@example.test'),
  ('c1240000-0000-4000-8000-000000000201', 'c124-owner-b@example.test'),
  ('c1240000-0000-4000-8000-000000000301', 'c124-outsider@example.test'),
  ('c1240000-0000-4000-8000-000000000401', 'c124-owner-c@example.test');
insert into public.tenants (id, name) values
  ('c1240000-0000-4000-8000-00000000000a', 'Synthetic 000124 Clinic A'),
  ('c1240000-0000-4000-8000-00000000000b', 'Synthetic 000124 Clinic B'),
  ('c1240000-0000-4000-8000-00000000000c', 'Synthetic 000124 Clinic C (not full)');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-00000000000b') and s.status = 'incomplete';
insert into public.memberships (user_id, tenant_id, role) values
  ('c1240000-0000-4000-8000-000000000101', 'c1240000-0000-4000-8000-00000000000a', 'owner'),
  ('c1240000-0000-4000-8000-000000000102', 'c1240000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1240000-0000-4000-8000-000000000103', 'c1240000-0000-4000-8000-00000000000a', 'admin'),
  ('c1240000-0000-4000-8000-000000000104', 'c1240000-0000-4000-8000-00000000000a', 'nurse'),
  ('c1240000-0000-4000-8000-000000000105', 'c1240000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c1240000-0000-4000-8000-000000000106', 'c1240000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1240000-0000-4000-8000-000000000201', 'c1240000-0000-4000-8000-00000000000b', 'owner'),
  ('c1240000-0000-4000-8000-000000000401', 'c1240000-0000-4000-8000-00000000000c', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by, allergies, chronic_conditions) values
  ('c1240000-0000-4000-8000-000000001001', 'c1240000-0000-4000-8000-00000000000a', 'Synthetic Screen Patient A', '+919000012401', 'c1240000-0000-4000-8000-000000000101', array['Qzscrallergen'], array['Synthetic condition']),
  ('c1240000-0000-4000-8000-000000001002', 'c1240000-0000-4000-8000-00000000000b', 'Synthetic Screen Patient B', '+919000012402', 'c1240000-0000-4000-8000-000000000201', null, '{}'),
  ('c1240000-0000-4000-8000-000000001003', 'c1240000-0000-4000-8000-00000000000c', 'Synthetic Screen Patient C', '+919000012403', 'c1240000-0000-4000-8000-000000000401', null, '{}');

-- Visits of patient A: 2001 a draft (in consultation), 2002 sealed (completed, signed), 2003 amending (in consultation, signed), 2004 completed and unsigned,
-- 2005 cancelled, 2006 an earlier signed history visit with a diagnosis and a prescription, 2007 a booked visit two days ahead (the follow-up display rule).
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by, scheduled_at) values
  ('c1240000-0000-4000-8000-000000002001', 'c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000001001', 'c1240000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1240000-0000-4000-8000-000000000101', now()),
  ('c1240000-0000-4000-8000-000000002004', 'c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000001001', 'c1240000-0000-4000-8000-000000000102', 'walk_in', 'completed', 'c1240000-0000-4000-8000-000000000101', now()),
  ('c1240000-0000-4000-8000-000000002005', 'c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000001001', 'c1240000-0000-4000-8000-000000000102', 'walk_in', 'cancelled', 'c1240000-0000-4000-8000-000000000101', now()),
  ('c1240000-0000-4000-8000-000000002007', 'c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000001001', 'c1240000-0000-4000-8000-000000000102', 'scheduled', 'booked', 'c1240000-0000-4000-8000-000000000101', now() + interval '2 days'),
  ('c1240000-0000-4000-8000-000000003001', 'c1240000-0000-4000-8000-00000000000b', 'c1240000-0000-4000-8000-000000001002', 'c1240000-0000-4000-8000-000000000201', 'walk_in', 'in_consultation', 'c1240000-0000-4000-8000-000000000201', now()),
  ('c1240000-0000-4000-8000-000000004001', 'c1240000-0000-4000-8000-00000000000c', 'c1240000-0000-4000-8000-000000001003', 'c1240000-0000-4000-8000-000000000401', 'walk_in', 'in_consultation', 'c1240000-0000-4000-8000-000000000401', now()),
  ('c1240000-0000-4000-8000-000000002006', 'c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000001001', 'c1240000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1240000-0000-4000-8000-000000000101', now() - interval '30 days');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by, signed_at, signed_by, scheduled_at) values
  ('c1240000-0000-4000-8000-000000002002', 'c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000001001', 'c1240000-0000-4000-8000-000000000102', 'walk_in', 'completed', 'c1240000-0000-4000-8000-000000000101', now(), 'c1240000-0000-4000-8000-000000000102', now()),
  ('c1240000-0000-4000-8000-000000002003', 'c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000001001', 'c1240000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1240000-0000-4000-8000-000000000101', now(), 'c1240000-0000-4000-8000-000000000102', now());
update public.clinical_notes set clinical_notes = 'Synthetic draft note', advice = array['Synthetic advice'] where visit_id = 'c1240000-0000-4000-8000-000000002001';
insert into public.follow_ups (tenant_id, patient_id, visit_id, doctor_id, follow_up_date, notes) values
  ('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000001001', 'c1240000-0000-4000-8000-000000002001', 'c1240000-0000-4000-8000-000000000102', current_date + 7, 'Synthetic follow-up');
insert into public.visit_revisions (tenant_id, visit_id, revision_number, amended_by, amendment_reason, snapshot) values
  ('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002003', 1, 'c1240000-0000-4000-8000-000000000102', 'Synthetic amendment reason', '{}'::jsonb);
insert into public.consultation_diagnoses (tenant_id, visit_id, patient_id, diagnosis_name, created_at) values
  ('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001', 'c1240000-0000-4000-8000-000000001001', 'Synthetic diagnosis one', now() - interval '2 minutes'),
  ('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001', 'c1240000-0000-4000-8000-000000001001', 'Synthetic diagnosis two', now() - interval '1 minute'),
  ('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002006', 'c1240000-0000-4000-8000-000000001001', 'Synthetic history diagnosis', now() - interval '30 days');
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id, version, status) values
  ('c1240000-0000-4000-8000-0000000d2001', 'c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001', 'c1240000-0000-4000-8000-000000001001', 'c1240000-0000-4000-8000-000000000102', 1, 'active'),
  ('c1240000-0000-4000-8000-0000000d2006', 'c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002006', 'c1240000-0000-4000-8000-000000001001', 'c1240000-0000-4000-8000-000000000102', 1, 'active');
insert into public.prescription_items (tenant_id, prescription_id, medicine_name, dosage, duration, sort_order) values
  ('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-0000000d2001', 'Synthetic medicine two', '1-0-1', '5 days', 1),
  ('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-0000000d2001', 'Synthetic medicine one', '0-0-1', '3 days', 0),
  ('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-0000000d2006', 'Synthetic history medicine', '1-1-1', '3 days', 0);
-- The history visit is signed after its diagnosis and prescription are written (the seal guards refuse writes to a signed visit).
do $do$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c1240000-0000-4000-8000-000000000102', 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c1240000-0000-4000-8000-00000000000a')::text, true);
  update public.visits set status = 'completed', signed_at = now(), signed_by = 'c1240000-0000-4000-8000-000000000102' where id = 'c1240000-0000-4000-8000-000000002006';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end
$do$;
insert into public.patient_documents (id, tenant_id, patient_id, visit_id, title, original_filename, storage_path, file_size_bytes, mime_type, report_date, uploaded_by, created_at) values
  ('c1240000-0000-4000-8000-0000000e0001', 'c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000001001', null, 'Synthetic older report', 'older.pdf', 'tenants/c1240000-0000-4000-8000-00000000000a/patients/c1240000-0000-4000-8000-000000001001/older.pdf', 1000, 'application/pdf', current_date - 10, 'c1240000-0000-4000-8000-000000000101', now() - interval '10 days'),
  ('c1240000-0000-4000-8000-0000000e0002', 'c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000001001', 'c1240000-0000-4000-8000-000000002001', 'Synthetic newer report', 'newer.pdf', 'tenants/c1240000-0000-4000-8000-00000000000a/patients/c1240000-0000-4000-8000-000000001001/newer.pdf', 2000, 'application/pdf', current_date, 'c1240000-0000-4000-8000-000000000101', now());
-- Lists: doctor 1 owns one of each, doctor 2 owns one of each with other names (the leak probe), the owner has none.
insert into public.doctor_custom_medicines (tenant_id, doctor_id, medicine_name, default_dosage, use_count) values
  ('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000102', 'Synthetic own medicine', '1-0-1', 3),
  ('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000106', 'Synthetic other doctor medicine', '1-1-1', 9);
insert into public.doctor_custom_diagnoses (tenant_id, doctor_id, diagnosis_name, use_count) values
  ('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000102', 'Synthetic own diagnosis', 2),
  ('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000106', 'Synthetic other doctor diagnosis', 7);
insert into public.doctor_prescription_templates (tenant_id, doctor_id, template_name, items) values
  ('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000102', 'Synthetic own template', '[]'::jsonb),
  ('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000106', 'Synthetic other doctor template', '[]'::jsonb);
insert into public.doctor_text_macros (tenant_id, doctor_id, shortcut, expansion) values
  ('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000102', '.own', 'Synthetic own macro'),
  ('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000106', '.other', 'Synthetic other doctor macro');

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
-- The read as a user: the whole jsonb (text) or one path of it; 'NULL' for a NULL result, 'absent' for a missing key.
create function pg_temp.screen(p_user text, p_visit text, p_tenant text default 'c1240000-0000-4000-8000-00000000000a') returns text language sql as $f$
  select pg_temp.as_user(('c1240000-0000-4000-8000-000000000' || p_user)::uuid,
    format($q$ select coalesce(public.consult_screen(%L, %L)::text, 'NULL') $q$, p_tenant, 'c1240000-0000-4000-8000-00000000' || p_visit))
$f$;
create function pg_temp.keys(p_user text, p_visit text, p_tenant text default 'c1240000-0000-4000-8000-00000000000a') returns text language sql as $f$
  select pg_temp.as_user(('c1240000-0000-4000-8000-000000000' || p_user)::uuid,
    format($q$ select coalesce((select string_agg(k, ',' order by k) from jsonb_object_keys(public.consult_screen(%L, %L)) k), 'NULL') $q$,
           p_tenant, 'c1240000-0000-4000-8000-00000000' || p_visit))
$f$;
create function pg_temp.part(p_user text, p_visit text, p_path text, p_tenant text default 'c1240000-0000-4000-8000-00000000000a') returns text language sql as $f$
  select pg_temp.as_user(('c1240000-0000-4000-8000-000000000' || p_user)::uuid,
    format($q$ select coalesce((public.consult_screen(%L, %L) #>> %L::text[])::text, 'absent') $q$,
           p_tenant, 'c1240000-0000-4000-8000-00000000' || p_visit, p_path))
$f$;

-- 1. Grants and shape ---------------------------------------------------------------------------------------------------
select is((select p.prosecdef::text || ':' || p.provolatile::text || ':' || array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'public.consult_screen(uuid, uuid)'::regprocedure),
  'false:s:search_path=""', 'consult_screen is a STABLE INVOKER function with search_path pinned');
select is((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text)
             from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid = 'public.consult_screen(uuid, uuid)'::regprocedure and a.grantee <> p.proowner),
  'authenticated:EXECUTE', 'EXECUTE is granted to authenticated only (not PUBLIC, anon or service_role)');
select throws_ok($$ set local role anon; select public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001') $$, '42501', null, 'anon cannot execute it');
select throws_ok($$ set local role service_role; select public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001') $$, '42501', null, 'service_role cannot execute it (no service-role path)');

-- 2. Refusals: all of them NULL -------------------------------------------------------------------------------------------
select is(pg_temp.screen('102', '3001', 'c1240000-0000-4000-8000-00000000000b'), 'NULL', 'a doctor of A asking for clinic B and its visit gets NULL');
select is(pg_temp.screen('102', '3001'), 'NULL', 'a doctor of A asking for B''s visit under A gets NULL');
select is(pg_temp.screen('102', '2001', 'c1240000-0000-4000-8000-00000000000b'), 'NULL', 'a forged tenant (B) with A''s visit gets NULL');
select is(pg_temp.screen('201', '2001', 'c1240000-0000-4000-8000-00000000000b'), 'NULL', 'the owner of B asking for A''s visit under B gets NULL');
select is(pg_temp.screen('201', '2001'), 'NULL', 'the owner of B asking for A''s visit under A gets NULL');
select is(pg_temp.screen('105', '2001'), 'NULL', 'a receptionist (no consultations:view) gets NULL');
select is(pg_temp.screen('103', '2001'), 'NULL', 'an admin (no consultations:view) gets NULL');
select is(pg_temp.screen('301', '2001'), 'NULL', 'a user with no membership gets NULL');
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000102', $$ select coalesce(public.consult_screen(null, 'c1240000-0000-4000-8000-000000002001')::text, 'NULL') $$), 'NULL', 'a NULL tenant gets NULL');
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000102', $$ select coalesce(public.consult_screen('c1240000-0000-4000-8000-00000000000a', null)::text, 'NULL') $$), 'NULL', 'a NULL visit gets NULL');
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000102', $$ select coalesce(public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-0000000000ff')::text, 'NULL') $$), 'NULL', 'an unknown visit gets NULL');
select is((select coalesce(public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001')::text, 'NULL')), 'NULL', 'with no session (no auth.uid()) the read is NULL');

-- 3. The role x part matrix -------------------------------------------------------------------------------------------------
select is(pg_temp.keys('102', '2001'),
  'allergy_context,amendment,assist_context,diagnoses,documents,entitlements,follow_up,history,macros,my_lists,notes,patient,prescription,snapshot,token_number,upcoming,visit',
  'the visit''s doctor on a draft: every part');
select is(pg_temp.keys('101', '2001'),
  'allergy_context,amendment,assist_context,diagnoses,documents,entitlements,follow_up,history,macros,my_lists,notes,patient,prescription,snapshot,token_number,upcoming,visit',
  'the owner on a draft: every part');
select is(pg_temp.keys('106', '2001'),
  'allergy_context,amendment,assist_context,diagnoses,documents,entitlements,follow_up,history,macros,my_lists,notes,patient,prescription,snapshot,token_number,upcoming,visit',
  'another doctor of the clinic on a draft: every part (the read is clinic-wide, only the lists and macros are the caller''s own)');
select is(pg_temp.keys('104', '2001'),
  'allergy_context,amendment,diagnoses,documents,entitlements,follow_up,history,notes,patient,prescription,snapshot,token_number,upcoming,visit',
  'a nurse: no assist_context, macros or my_lists (consultations:edit and prescriptions:edit are missing); the labs part stays (labs:view)');
select is(jsonb_array_length(pg_temp.part('104', '2001', '{upcoming}')::jsonb), 1, 'the nurse gets the upcoming part too (the page read it for anyone with consultations:view on an editable record)');
select is(pg_temp.part('104', '2001', '{my_lists}'), 'absent', 'a nurse has no my_lists');
select is(pg_temp.part('102', '2001', '{visit,id}'), 'c1240000-0000-4000-8000-000000002001', 'the visit part carries the visit');
select is(pg_temp.part('102', '2001', '{patient,full_name}'), 'Synthetic Screen Patient A', 'the patient part carries the patient');
select is(pg_temp.part('102', '2001', '{notes,clinical_notes}'), 'Synthetic draft note', 'the notes part carries the clinical note');
select is(pg_temp.part('102', '2001', '{notes,draft_version}'), '1', 'the notes part carries draft_version (the fixture''s note update raised it to 1)');
select is(pg_temp.part('104', '2001', '{notes,clinical_notes}'), 'Synthetic draft note', 'a nurse (consultations:view) reads the same notes row');

-- 4. Record states -----------------------------------------------------------------------------------------------------------
select is(pg_temp.keys('102', '2002'),
  'allergy_context,amendment,diagnoses,documents,entitlements,follow_up,history,my_lists,notes,patient,prescription,snapshot,token_number,visit',
  'a sealed record: no learned order, no macros, no upcoming; snapshot (any record), lists, documents and history stay');
select is(pg_temp.keys('102', '2004'),
  'allergy_context,amendment,diagnoses,documents,entitlements,follow_up,history,my_lists,notes,patient,prescription,snapshot,token_number,visit',
  'an unsigned completed record: not editable, so no learned order, macros or upcoming');
select is(pg_temp.keys('102', '2005'),
  'allergy_context,amendment,diagnoses,documents,entitlements,follow_up,history,my_lists,notes,patient,prescription,snapshot,token_number,visit',
  'a cancelled record: not editable');
select is(pg_temp.keys('102', '2003'),
  'allergy_context,amendment,assist_context,diagnoses,documents,entitlements,follow_up,history,macros,my_lists,notes,patient,prescription,snapshot,token_number,upcoming,visit',
  'an amending record: editable again, every part');
select is(pg_temp.part('102', '2003', '{amendment,reason}'), 'Synthetic amendment reason', 'an amending record carries the reason of its latest revision');
select isnt(pg_temp.part('102', '2003', '{amendment,opened_at}'), 'absent', 'and when it was opened');
select is(pg_temp.part('102', '2001', '{amendment}'), 'absent', 'a draft has no amendment (JSON null reads as absent)');
select is(pg_temp.part('102', '2002', '{amendment}'), 'absent', 'a sealed record has no amendment');
select is(pg_temp.part('102', '2002', '{visit,signed_at}') is not null, true, 'the visit part of a sealed record keeps signed_at');
select is(pg_temp.part('102', '2002', '{visit,status}'), 'completed', 'and its status (recordState is applied by the page from these two)');

-- 5. The caller's own lists only ----------------------------------------------------------------------------------------------------
select is(pg_temp.part('102', '2001', '{my_lists,custom_medicines,0,medicine_name}'), 'Synthetic own medicine', 'doctor 1 gets own custom medicine');
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000102', $$ select (jsonb_array_length(public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001') #> '{my_lists,custom_medicines}'))::text $$), '1', 'and only that one (another doctor''s medicine is not returned)');
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000102', $$ select (jsonb_array_length(public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001') #> '{my_lists,custom_diagnoses}'))::text $$), '1', 'one custom diagnosis, the caller''s');
select is(pg_temp.part('102', '2001', '{my_lists,custom_diagnoses,0,diagnosis_name}'), 'Synthetic own diagnosis', 'and it is the caller''s own');
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000102', $$ select (jsonb_array_length(public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001') #> '{my_lists,templates}'))::text $$), '1', 'one template, the caller''s');
select is(pg_temp.part('102', '2001', '{my_lists,templates,0,template_name}'), 'Synthetic own template', 'and it is the caller''s own');
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000102', $$ select (jsonb_array_length(public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001') -> 'macros'))::text $$), '1', 'one macro, the caller''s');
select is(pg_temp.part('102', '2001', '{macros,0,shortcut}'), '.own', 'and it is the caller''s own');
select is(pg_temp.part('106', '2001', '{my_lists,custom_medicines,0,medicine_name}'), 'Synthetic other doctor medicine', 'doctor 2 gets doctor 2''s medicine');
select is(pg_temp.part('106', '2001', '{my_lists,templates,0,template_name}'), 'Synthetic other doctor template', 'doctor 2 gets doctor 2''s template');
select is(pg_temp.part('106', '2001', '{macros,0,shortcut}'), '.other', 'doctor 2 gets doctor 2''s macro');
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000101', $$ select (public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001') #> '{my_lists}')::text $$),
  '{"templates": [], "custom_diagnoses": [], "custom_medicines": []}', 'the owner holds no list rows, so sees three empty lists (not the doctors'')');
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000101', $$ select (public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001') -> 'macros')::text $$), '[]', 'and no macros');
-- The caps: 501 custom medicines and 101 templates of doctor 1 come back as 500 and 100, by use_count and name.
insert into public.doctor_custom_medicines (tenant_id, doctor_id, medicine_name, use_count)
select 'c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000102', 'Synthetic bulk medicine ' || lpad(n::text, 4, '0'), 1 from generate_series(1, 510) n;
insert into public.doctor_prescription_templates (tenant_id, doctor_id, template_name, items)
select 'c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000102', 'Synthetic bulk template ' || lpad(n::text, 4, '0'), '[]'::jsonb from generate_series(1, 110) n;
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000102', $$ select (jsonb_array_length(public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001') #> '{my_lists,custom_medicines}'))::text $$), '500', 'custom medicines are capped at 500');
select is(pg_temp.part('102', '2001', '{my_lists,custom_medicines,0,medicine_name}'), 'Synthetic own medicine', 'ordered by use_count (the used one first)');
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000102', $$ select (jsonb_array_length(public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001') #> '{my_lists,templates}'))::text $$), '100', 'templates are capped at 100');

-- 6. Entitlements ---------------------------------------------------------------------------------------------------------------------
select is(pg_temp.part('102', '2001', '{entitlements,assist.shorthand}'), 'true', 'the standard plan holds assist.shorthand');
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000102', $$ select (select count(*) from jsonb_object_keys(public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001') -> 'entitlements'))::text $$), '11', 'the entitlements part holds the eleven assist.* keys and no other');
insert into public.tenant_entitlement_overrides (tenant_id, key, enabled, reason) values
  ('c1240000-0000-4000-8000-00000000000a', 'assist.shorthand', false, 'Synthetic override'),
  ('c1240000-0000-4000-8000-00000000000a', 'assist.snapshot', false, 'Synthetic override'),
  ('c1240000-0000-4000-8000-00000000000a', 'assist.followup', false, 'Synthetic override');
select is(pg_temp.part('102', '2001', '{entitlements,assist.shorthand}'), 'false', 'an override turns assist.shorthand off');
select is(pg_temp.keys('102', '2001'),
  'allergy_context,amendment,assist_context,diagnoses,documents,entitlements,follow_up,history,my_lists,notes,patient,prescription,token_number,visit',
  'with shorthand, snapshot and follow-up off the macros, snapshot and upcoming parts are absent');
update public.tenant_entitlement_overrides set enabled = false where tenant_id = 'c1240000-0000-4000-8000-00000000000a' and key in ('assist.shorthand', 'assist.snapshot', 'assist.followup');
insert into public.tenant_entitlement_overrides (tenant_id, key, enabled, reason) values
  ('c1240000-0000-4000-8000-00000000000a', 'assist.terminology', false, 'Synthetic override'),
  ('c1240000-0000-4000-8000-00000000000a', 'assist.frequent_rx', false, 'Synthetic override');
select is(pg_temp.keys('102', '2001'),
  'allergy_context,amendment,diagnoses,documents,entitlements,follow_up,history,my_lists,notes,patient,prescription,token_number,visit',
  'with terminology and frequent_rx off as well, the learned order is absent too');
delete from public.tenant_entitlement_overrides where tenant_id = 'c1240000-0000-4000-8000-00000000000a';
-- Clinic C is not full (onboarding, no subscription window): consultations:view is not held there (the permission helpers only count full clinics), so the read is NULL.
select is(pg_temp.screen('401', '4001', 'c1240000-0000-4000-8000-00000000000c'), 'NULL', 'a clinic that is not full gets NULL (the layout redirects it before the page asks)');

-- 7. Content of the parts --------------------------------------------------------------------------------------------------------------
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000102', $$ select (select string_agg(d ->> 'diagnosis_name', ',' order by ord) from jsonb_array_elements(public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001') -> 'diagnoses') with ordinality as t(d, ord)) $$),
  'Synthetic diagnosis one,Synthetic diagnosis two', 'diagnoses are the visit''s, oldest first');
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000102', $$ select (select string_agg(d ->> 'medicine_name', ',' order by ord) from jsonb_array_elements(public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001') #> '{prescription,items}') with ordinality as t(d, ord)) $$),
  'Synthetic medicine one,Synthetic medicine two', 'the prescription items come in sort order');
select is(pg_temp.part('102', '2001', '{prescription,latest_version}'), '1', 'the latest prescription version');
select is(pg_temp.part('102', '2001', '{follow_up,notes}'), 'Synthetic follow-up', 'the follow-up');
select is(pg_temp.part('102', '2001', '{follow_up,follow_up_date}') is not null, true, 'with its date');
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000102', $$ select (select h #>> '{diagnoses,0,diagnosis_name}' from jsonb_array_elements(public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001') -> 'history') h where h ->> 'id' = 'c1240000-0000-4000-8000-000000002006') $$), 'Synthetic history diagnosis', 'the history carries the other encounter''s diagnosis');
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000102', $$ select (select string_agg(h ->> 'id', ',' order by ord) from jsonb_array_elements(public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001') -> 'history') with ordinality as t(h, ord)) $$) not like '%2001%', true, 'the history never lists the visit on screen');
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000102', $$ select (select string_agg(h ->> 'id', ',' order by ord) from jsonb_array_elements(public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001') -> 'history') with ordinality as t(h, ord)) $$) not like '%3001%', true, 'nor another clinic''s visit');
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000102', $$ select (select h #>> '{prescriptions,0,items,0,medicine_name}' from jsonb_array_elements(public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001') -> 'history') h where h ->> 'id' = 'c1240000-0000-4000-8000-000000002006') $$), 'Synthetic history medicine', 'a history encounter carries its active prescription''s lines');
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000102', $$ select (select string_agg(d ->> 'title', ',' order by ord) from jsonb_array_elements(public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001') -> 'documents') with ordinality as t(d, ord)) $$),
  'Synthetic newer report,Synthetic older report', 'documents come newest first');
select is(pg_temp.part('102', '2001', '{documents,0,storage_path}'), 'absent', 'a document carries no storage path');
select is(pg_temp.as_user('c1240000-0000-4000-8000-000000000102', $$ select (jsonb_array_length(public.consult_screen('c1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000002001') -> 'upcoming'))::text $$), '1', 'one upcoming booked visit with this doctor');
select is(pg_temp.part('102', '2001', '{allergy_context,state}'), 'known', 'the allergy context of a patient with a recorded allergy');
select is(pg_temp.part('102', '2001', '{patient,allergies,0}'), 'Qzscrallergen', 'the patient part carries the allergies');

select * from finish();
rollback;
