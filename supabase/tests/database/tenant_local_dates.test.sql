-- tenant_local_dates.test.sql — V2-05 plan 05-08 (V2-03 R-33 carry-over; R-19; V2-03 03-05 clinic-date parity).
-- `queue_tokens.date` and `patient_documents.report_date` no longer default to CURRENT_DATE (the server's UTC date):
--   1. neither column has a default; both are filled by a BEFORE INSERT trigger;
--   2. an omitted value becomes `tenant_local_date(tenant_id, now())`, for postgres, service_role and a member
--      (authenticated) alike; an explicit value is kept;
--   3. the zone rules of `tenant_local_date` match `lib/datetime` `resolveTimeZone`: IANA names (any case), ECMA-402
--      UTC offsets read east-positive, and anything unusable (an unknown name, an abbreviation, a blank) falls back to
--      Asia/Kolkata without an error. The app-side half of the parity is tests/integration/ist-boundaries.spec.ts.
-- Synthetic data only; the file rolls back.
begin;
select plan(20);

insert into auth.users (id, email) values
  ('c0830000-0000-4000-8000-000000000101', 'c083-owner@example.test'),
  ('c0830000-0000-4000-8000-000000000102', 'c083-receptionist@example.test');
insert into public.tenants (id, name, timezone) values
  ('c0830000-0000-4000-8000-00000000000a', 'Synthetic 05-08 Date Clinic', 'Asia/Kolkata'),
  ('c0830000-0000-4000-8000-0000000000b1', 'Synthetic Zone Unknown', 'Not/AZone'),
  ('c0830000-0000-4000-8000-0000000000b2', 'Synthetic Zone Abbreviation', 'IST'),
  ('c0830000-0000-4000-8000-0000000000b3', 'Synthetic Zone Blank', ''),
  ('c0830000-0000-4000-8000-0000000000b4', 'Synthetic Zone Lower Case', 'america/new_york'),
  ('c0830000-0000-4000-8000-0000000000b5', 'Synthetic Zone Offset East', '+05:30'),
  ('c0830000-0000-4000-8000-0000000000b6', 'Synthetic Zone Offset West', '-05:00'),
  ('c0830000-0000-4000-8000-0000000000b7', 'Synthetic Zone Offset Compact', '-0500'),
  ('c0830000-0000-4000-8000-0000000000b8', 'Synthetic Zone Etc', 'Etc/GMT+5');
insert into public.memberships (user_id, tenant_id, role) values
  ('c0830000-0000-4000-8000-000000000101', 'c0830000-0000-4000-8000-00000000000a', 'owner'),
  ('c0830000-0000-4000-8000-000000000102', 'c0830000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c0830000-0000-4000-8000-000000000101', 'c0830000-0000-4000-8000-0000000000b1', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c0830000-0000-4000-8000-000000001001', 'c0830000-0000-4000-8000-00000000000a', 'Synthetic Date Patient', '+919000000831', 'c0830000-0000-4000-8000-000000000101'),
  ('c0830000-0000-4000-8000-000000001002', 'c0830000-0000-4000-8000-0000000000b1', 'Synthetic Date Patient B1', '+919000000832', 'c0830000-0000-4000-8000-000000000101');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by)
select ('c0830000-0000-4000-8000-0000000011' || lpad(g::text, 2, '0'))::uuid, 'c0830000-0000-4000-8000-00000000000a',
       'c0830000-0000-4000-8000-000000001001', 'c0830000-0000-4000-8000-000000000101', 'walk_in', 'c0830000-0000-4000-8000-000000000101'
  from generate_series(1, 4) g;
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by) values
  ('c0830000-0000-4000-8000-000000001201', 'c0830000-0000-4000-8000-0000000000b1', 'c0830000-0000-4000-8000-000000001002',
   'c0830000-0000-4000-8000-000000000101', 'walk_in', 'c0830000-0000-4000-8000-000000000101');

-- 1. Catalogue --------------------------------------------------------------------------------------------------------
select is(
  (select array_agg(coalesce(column_default::text, '<none>') order by table_name) from information_schema.columns
    where table_schema = 'public' and ((table_name = 'queue_tokens' and column_name = 'date')
                                    or (table_name = 'patient_documents' and column_name = 'report_date'))),
  array['<none>', '<none>'], 'patient_documents.report_date and queue_tokens.date have no default (was CURRENT_DATE)');
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and is_nullable = 'NO' and ((table_name = 'queue_tokens' and column_name = 'date')
                                    or (table_name = 'patient_documents' and column_name = 'report_date'))),
  2, 'both columns stay NOT NULL');
select set_eq(
  $$ select tgrelid::regclass::text || ':' || tgname || ':' || tgfoid::regproc::text from pg_trigger
      where tgrelid in ('public.queue_tokens'::regclass, 'public.patient_documents'::regclass) and not tgisinternal
        and (tgtype & 2) = 2 and (tgtype & 4) = 4 $$,
  array['queue_tokens:queue_tokens_fill_date:private.queue_tokens_fill_date',
        'patient_documents:patient_documents_fill_report_date:private.patient_documents_fill_report_date'],
  'each table has its BEFORE INSERT fill trigger');
select is(
  (select array_agg(has_function_privilege(r, f, 'EXECUTE') order by f, r)
     from unnest(array['anon', 'authenticated', 'service_role']) r,
          unnest(array['private.queue_tokens_fill_date()', 'private.patient_documents_fill_report_date()']) f),
  array_fill(false, array[6]), 'no API role may execute the trigger functions directly');

-- 2. Filling ----------------------------------------------------------------------------------------------------------
insert into public.queue_tokens (tenant_id, visit_id, token_number) values
  ('c0830000-0000-4000-8000-00000000000a', 'c0830000-0000-4000-8000-000000001101', 1);
select is((select date from public.queue_tokens where visit_id = 'c0830000-0000-4000-8000-000000001101'),
  public.tenant_local_date('c0830000-0000-4000-8000-00000000000a', now()), 'postgres: an omitted queue token date is the clinic-local today');
insert into public.queue_tokens (tenant_id, visit_id, date, token_number) values
  ('c0830000-0000-4000-8000-00000000000a', 'c0830000-0000-4000-8000-000000001102', '2030-01-01', 2);
select is((select date from public.queue_tokens where visit_id = 'c0830000-0000-4000-8000-000000001102'),
  '2030-01-01'::date, 'an explicit queue token date is kept');

set local role service_role;
insert into public.queue_tokens (tenant_id, visit_id, token_number) values
  ('c0830000-0000-4000-8000-00000000000a', 'c0830000-0000-4000-8000-000000001103', 3);
reset role;
select is((select date from public.queue_tokens where visit_id = 'c0830000-0000-4000-8000-000000001103'),
  public.tenant_local_date('c0830000-0000-4000-8000-00000000000a', now()), 'service_role: an omitted date is filled too');

do $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c0830000-0000-4000-8000-000000000102', 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c0830000-0000-4000-8000-00000000000a')::text, true);
end
$$;
set local role authenticated;
select lives_ok($$insert into public.queue_tokens (tenant_id, visit_id, token_number) values
  ('c0830000-0000-4000-8000-00000000000a', 'c0830000-0000-4000-8000-000000001104', 4)$$,
  'a receptionist inserts a queue token without a date (the trigger runs as the member)');
reset role;
select is((select date from public.queue_tokens where visit_id = 'c0830000-0000-4000-8000-000000001104'),
  public.tenant_local_date('c0830000-0000-4000-8000-00000000000a', now()), 'authenticated: the omitted date is the clinic-local today');

insert into public.patient_documents (id, tenant_id, patient_id, title, original_filename, storage_path, file_size_bytes, mime_type, uploaded_by) values
  ('c0830000-0000-4000-8000-000000002001', 'c0830000-0000-4000-8000-00000000000a', 'c0830000-0000-4000-8000-000000001001', 'Synthetic report',
   'synthetic.pdf', 'tenants/c0830000-0000-4000-8000-00000000000a/patients/c0830000-0000-4000-8000-000000001001/labs/c0830000-0000-4000-8000-000000002001.pdf',
   1, 'application/pdf', 'c0830000-0000-4000-8000-000000000101');
select is((select report_date from public.patient_documents where id = 'c0830000-0000-4000-8000-000000002001'),
  public.tenant_local_date('c0830000-0000-4000-8000-00000000000a', now()), 'an omitted lab report date is the clinic-local today');
insert into public.patient_documents (id, tenant_id, patient_id, title, original_filename, storage_path, file_size_bytes, mime_type, report_date, uploaded_by) values
  ('c0830000-0000-4000-8000-000000002002', 'c0830000-0000-4000-8000-00000000000a', 'c0830000-0000-4000-8000-000000001001', 'Synthetic report 2',
   'synthetic2.pdf', 'tenants/c0830000-0000-4000-8000-00000000000a/patients/c0830000-0000-4000-8000-000000001001/labs/c0830000-0000-4000-8000-000000002002.pdf',
   1, 'application/pdf', '2029-12-31', 'c0830000-0000-4000-8000-000000000101');
select is((select report_date from public.patient_documents where id = 'c0830000-0000-4000-8000-000000002002'),
  '2029-12-31'::date, 'an explicit lab report date is kept');
insert into public.queue_tokens (tenant_id, visit_id, token_number) values
  ('c0830000-0000-4000-8000-0000000000b1', 'c0830000-0000-4000-8000-000000001201', 1);
select is((select date from public.queue_tokens where visit_id = 'c0830000-0000-4000-8000-000000001201'),
  (now() at time zone 'Asia/Kolkata')::date, 'a clinic with an invalid zone gets the Asia/Kolkata date, no error');

-- 3. Zone rules (fixed instant 2026-11-14 03:00 UTC = 08:30 IST on 14 Nov = 22:00 on 13 Nov at UTC-5) -------------------
select is(public.tenant_local_date('c0830000-0000-4000-8000-0000000000b1', '2026-11-14 03:00+00'), '2026-11-14'::date,
  'unknown zone name -> Asia/Kolkata');
select is(public.tenant_local_date('c0830000-0000-4000-8000-0000000000b2', '2026-11-13 19:00+00'), '2026-11-14'::date,
  'abbreviation IST -> Asia/Kolkata (never PostgreSQL''s abbreviation table, where IST is +02)');
select is(public.tenant_local_date('c0830000-0000-4000-8000-0000000000b3', '2026-11-14 03:00+00'), '2026-11-14'::date,
  'blank zone -> Asia/Kolkata');
select is(public.tenant_local_date('c0830000-0000-4000-8000-0000000000b4', '2026-11-14 03:00+00'), '2026-11-13'::date,
  'lower-case IANA name is honoured (america/new_york -> 13 Nov)');
select is(public.tenant_local_date('c0830000-0000-4000-8000-0000000000b5', '2026-11-13 19:00+00'), '2026-11-14'::date,
  'offset +05:30 is east of UTC (14 Nov)');
select is(public.tenant_local_date('c0830000-0000-4000-8000-0000000000b6', '2026-11-14 03:00+00'), '2026-11-13'::date,
  'offset -05:00 is west of UTC (13 Nov; PostgreSQL''s POSIX reading would say 14 Nov)');
select is(public.tenant_local_date('c0830000-0000-4000-8000-0000000000b7', '2026-11-14 03:00+00'), '2026-11-13'::date,
  'compact offset -0500 is west of UTC');
select is(public.tenant_local_date('c0830000-0000-4000-8000-0000000000b8', '2026-11-14 03:00+00'), '2026-11-13'::date,
  'Etc/GMT+5 follows the tz database (UTC-5)');

select * from finish();
rollback;
