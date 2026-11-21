-- clinical_review_fixes.test.sql — V2-09a 09A-06a (migration 000111; 09A-REVIEW-TRIAGE.md, ruling R-A). One section per fixed row:
--   S-1 / A-4  no member updates a lab document row (storage_path, patient_id, visit_id, uploaded_by, title, is_abnormal);
--   S-2 / A-1  only the visit's signer stores the canonical Rx object and sets the PDF pair, and only for an object the signer stored (no adoption of a
--              planted object); owners, colleagues and the service role are refused;
--   S-3        the signer may clear a pair whose object is missing (and nobody else may; nobody may when the object exists);
--   S-4        a header's keys never change, for the service role and postgres too (no draft header grafted onto a sealed visit);
--   S-5        share_token_object returns the prescription's recorded hash;
--   A-3        the reopen refuses RX_ARCHIVE_PENDING while the latest signed header has no archive, and is admitted once it has one;
--   A-5        the amendment snapshot records reason_for_visit and location_id;
--   S-7        no member inserts an amendment row; the reason is 10 to 500 characters for every writer;
--   S-9        no TRUNCATE or TRIGGER privilege on the sealed tables for service_role, authenticated or anon;
--   S-10       a visit the caller cannot see is not "sealed" for the pair (refused, not admitted).
-- Synthetic data only; the file rolls back.
begin;
select plan(40);

-- Fixtures ----------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1110000-0000-4000-8000-000000000101', 'c111-owner-a@example.test'),
  ('c1110000-0000-4000-8000-000000000102', 'c111-doctor-a@example.test'),
  ('c1110000-0000-4000-8000-000000000103', 'c111-doctor2-a@example.test'),
  ('c1110000-0000-4000-8000-000000000104', 'c111-nurse-a@example.test'),
  ('c1110000-0000-4000-8000-000000000105', 'c111-receptionist-a@example.test');
insert into public.tenants (id, name) values ('c1110000-0000-4000-8000-00000000000a', 'Synthetic 09A-06a Clinic A');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id = 'c1110000-0000-4000-8000-00000000000a';
insert into public.memberships (user_id, tenant_id, role) values
  ('c1110000-0000-4000-8000-000000000101', 'c1110000-0000-4000-8000-00000000000a', 'owner'),
  ('c1110000-0000-4000-8000-000000000102', 'c1110000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1110000-0000-4000-8000-000000000103', 'c1110000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1110000-0000-4000-8000-000000000104', 'c1110000-0000-4000-8000-00000000000a', 'nurse'),
  ('c1110000-0000-4000-8000-000000000105', 'c1110000-0000-4000-8000-00000000000a', 'receptionist');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1110000-0000-4000-8000-000000001001', 'c1110000-0000-4000-8000-00000000000a', 'Synthetic Review Patient', '+919000011101', 'c1110000-0000-4000-8000-000000000101'),
  ('c1110000-0000-4000-8000-000000001002', 'c1110000-0000-4000-8000-00000000000a', 'Synthetic Other Patient', '+919000011102', 'c1110000-0000-4000-8000-000000000101');
insert into public.clinic_locations (id, tenant_id, name) values
  ('c1110000-0000-4000-8000-0000000000f1', 'c1110000-0000-4000-8000-00000000000a', 'Synthetic Annex');

-- Visits of the doctor (102), all open at first: 2001..2004 and 2006 get a header; 2005 is a draft with a draft header (S-4); 2007 has no header (A-3 control).
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by, reason_for_visit, location_id)
  select ('c1110000-0000-4000-8000-0000000020' || n)::uuid, 'c1110000-0000-4000-8000-00000000000a', 'c1110000-0000-4000-8000-000000001001',
         'c1110000-0000-4000-8000-000000000102', 'walk_in', 'waiting', 'c1110000-0000-4000-8000-000000000101',
         'Synthetic reason ' || n, 'c1110000-0000-4000-8000-0000000000f1'
    from unnest(array['01', '02', '03', '04', '05', '06', '07']) n;
update public.clinical_notes set clinical_notes = 'Synthetic note' where tenant_id = 'c1110000-0000-4000-8000-00000000000a';
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id)
  select ('c1110000-0000-4000-8000-0000000030' || right(v.id::text, 2))::uuid, v.tenant_id, v.id, v.patient_id, v.doctor_id
    from public.visits v where right(v.id::text, 2) in ('01', '02', '03', '04', '05', '06');
insert into public.prescription_items (prescription_id, medicine_name, dosage, duration)
  select p.id, 'Synthetic medicine', '1-0-1', '5 days' from public.prescriptions p where p.tenant_id = 'c1110000-0000-4000-8000-00000000000a';

-- Kept calls, as a user acting in clinic A: the value of the one column p_sql returns, or the refusal.
create function pg_temp.call_as(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c1110000-0000-4000-8000-00000000000a')::text, true);
  begin
    set local role authenticated;
    execute p_sql into v_out;
    reset role;
    v_out := coalesce(v_out, 'none');
  exception
    when insufficient_privilege then reset role; v_out := 'denied:' || sqlerrm;
    when others then reset role; v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  return v_out;
end
$f$;
-- Probes, rolled back: 'ok:<rows>' or the refusal. p_user null: the system path as p_db_role (service_role or postgres).
create function pg_temp.attempt(p_db_role text, p_user uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
  v_n bigint;
begin
  begin
    perform set_config('request.jwt.claims', case when p_user is null then json_build_object('role', p_db_role)::text
                                                  else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
    perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c1110000-0000-4000-8000-00000000000a')::text, true);
    if p_db_role <> 'postgres' then
      execute 'set local role ' || quote_ident(p_db_role);
    end if;
    execute p_sql;
    get diagnostics v_n = row_count;
    raise exception using errcode = 'ROLLB', message = 'ok:' || v_n;
  exception
    when sqlstate 'ROLLB' then v_out := sqlerrm;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  return v_out;
end
$f$;

-- The doctor signs 2001, 2002, 2003, 2004, 2006 and 2007 through the command (R-15).
do $do$
declare
  n text;
begin
  foreach n in array array['01', '02', '03', '04', '06', '07'] loop
    perform pg_temp.call_as('c1110000-0000-4000-8000-000000000102',
      format($q$select public.sign_consultation('c1110000-0000-4000-8000-00000000000a', %L, gen_random_uuid())::text$q$, 'c1110000-0000-4000-8000-0000000020' || n));
  end loop;
end $do$;
select is((select string_agg(right(v.id::text, 2) || ':' || v.status || ':' || coalesce(v.signed_by = 'c1110000-0000-4000-8000-000000000102', false)::text, ',' order by v.id)
             from public.visits v where v.tenant_id = 'c1110000-0000-4000-8000-00000000000a'),
  '01:completed:true,02:completed:true,03:completed:true,04:completed:true,05:waiting:false,06:completed:true,07:completed:true',
  'fixture: the doctor signed every visit but 2005 (a draft)');

-- Objects at the canonical keys: 2001 the signer's own upload; 2002 an object the OWNER put there; 2003 an object with no owner (the service role or a storage
-- admin); 2004 the signer's upload, archived below and then removed. Recorded the way the storage API records an upload (owner_id = the uploader).
insert into storage.objects (bucket_id, name, owner, owner_id) values
  ('prescriptions', 'c1110000-0000-4000-8000-00000000000a/c1110000-0000-4000-8000-000000002001/rx_v1.pdf', 'c1110000-0000-4000-8000-000000000102', 'c1110000-0000-4000-8000-000000000102'),
  ('prescriptions', 'c1110000-0000-4000-8000-00000000000a/c1110000-0000-4000-8000-000000002002/rx_v1.pdf', 'c1110000-0000-4000-8000-000000000101', 'c1110000-0000-4000-8000-000000000101'),
  ('prescriptions', 'c1110000-0000-4000-8000-00000000000a/c1110000-0000-4000-8000-000000002003/rx_v1.pdf', null, null),
  ('prescriptions', 'c1110000-0000-4000-8000-00000000000a/c1110000-0000-4000-8000-000000002004/rx_v1.pdf', 'c1110000-0000-4000-8000-000000000102', 'c1110000-0000-4000-8000-000000000102');

-- S-2 / A-1: the pair -------------------------------------------------------------------------------------------------------
create function pg_temp.set_pair(p_visit text) returns text language sql as $f$
  select format($q$update public.prescriptions set pdf_storage_path = 'c1110000-0000-4000-8000-00000000000a/c1110000-0000-4000-8000-0000000020%s/rx_v1.pdf', pdf_sha256 = repeat('a', 64)
                    where visit_id = 'c1110000-0000-4000-8000-0000000020%s'$q$, p_visit, p_visit)
$f$;
select is(array[pg_temp.attempt('authenticated', 'c1110000-0000-4000-8000-000000000101', pg_temp.set_pair('01')),
                pg_temp.attempt('authenticated', 'c1110000-0000-4000-8000-000000000103', pg_temp.set_pair('01')),
                pg_temp.attempt('service_role', null, pg_temp.set_pair('01')),
                pg_temp.attempt('postgres', null, pg_temp.set_pair('01'))],
  array['denied:RX_PDF_SIGNER_ONLY', 'denied:RX_PDF_SIGNER_ONLY', 'denied:RX_PDF_SIGNER_ONLY', 'denied:RX_PDF_SIGNER_ONLY'],
  'R-A: the owner, a colleague doctor, the service role and postgres cannot set the pair of a visit they did not sign');
select is(pg_temp.attempt('authenticated', 'c1110000-0000-4000-8000-000000000101', pg_temp.set_pair('02')), 'denied:RX_PDF_SIGNER_ONLY',
  'the owner cannot record the object the owner planted either');
select is(pg_temp.attempt('authenticated', 'c1110000-0000-4000-8000-000000000102', pg_temp.set_pair('02')), 'denied:RX_PDF_OBJECT_INVALID',
  'S-2: the signer cannot adopt an object another member stored at the key');
select is(pg_temp.attempt('authenticated', 'c1110000-0000-4000-8000-000000000102', pg_temp.set_pair('03')), 'denied:RX_PDF_OBJECT_INVALID',
  'nor an object with no owner (the service role or storage admin put it there)');
select is(pg_temp.attempt('authenticated', 'c1110000-0000-4000-8000-000000000102', pg_temp.set_pair('06')), 'denied:RX_PDF_OBJECT_INVALID',
  'S-3: a pair naming no object is refused (no poisoned hash for a missing archive)');
select is(pg_temp.attempt('authenticated', 'c1110000-0000-4000-8000-000000000102',
            $$update public.prescriptions set pdf_storage_path = 'c1110000-0000-4000-8000-00000000000a/c1110000-0000-4000-8000-000000002001/rx_v1.pdf' where visit_id = 'c1110000-0000-4000-8000-000000002001'$$),
  'denied:RX_PDF_PATH_INVALID', 'the path and the hash are set together (a path alone is refused)');
select is(pg_temp.call_as('c1110000-0000-4000-8000-000000000102', pg_temp.set_pair('01') || ' returning pdf_sha256 is not null'), 'true',
  'the signer records the pair of the object the signer stored');
select is(pg_temp.call_as('c1110000-0000-4000-8000-000000000102', pg_temp.set_pair('04') || ' returning pdf_sha256 is not null'), 'true',
  'and of 2004 (archived, its object removed below)');

-- S-2: the storage INSERT policy (signer only) --------------------------------------------------------------------------------
create function pg_temp.upload(p_visit text) returns text language sql as $f$
  select format($q$insert into storage.objects (bucket_id, name) values ('prescriptions', 'c1110000-0000-4000-8000-00000000000a/c1110000-0000-4000-8000-0000000020%s/rx_v1.pdf')$q$, p_visit)
$f$;
select is(array[pg_temp.attempt('authenticated', 'c1110000-0000-4000-8000-000000000101', pg_temp.upload('06')),
                pg_temp.attempt('authenticated', 'c1110000-0000-4000-8000-000000000103', pg_temp.upload('06'))],
  array['denied:new row violates row-level security policy for table "objects"', 'denied:new row violates row-level security policy for table "objects"'],
  'R-A: the owner and a colleague doctor cannot store the canonical object of a visit they did not sign');
select is(pg_temp.attempt('authenticated', 'c1110000-0000-4000-8000-000000000102', pg_temp.upload('06')), 'ok:1',
  'the signer can (control)');

-- S-3: a broken pair -------------------------------------------------------------------------------------------------------
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'prescriptions' and name like '%/c1110000-0000-4000-8000-000000002004/rx_v1.pdf';
create function pg_temp.clear_pair(p_visit text) returns text language sql as $f$
  select format($q$update public.prescriptions set pdf_storage_path = null, pdf_sha256 = null where visit_id = 'c1110000-0000-4000-8000-0000000020%s'$q$, p_visit)
$f$;
select is(array[pg_temp.attempt('authenticated', 'c1110000-0000-4000-8000-000000000101', pg_temp.clear_pair('04')),
                pg_temp.attempt('authenticated', 'c1110000-0000-4000-8000-000000000103', pg_temp.clear_pair('04')),
                pg_temp.attempt('service_role', null, pg_temp.clear_pair('04'))],
  array['denied:RX_PDF_WRITE_ONCE', 'denied:RX_PDF_WRITE_ONCE', 'denied:RX_PDF_WRITE_ONCE'],
  'S-3: nobody but the signer clears a pair, even when its object is missing');
select is(pg_temp.attempt('authenticated', 'c1110000-0000-4000-8000-000000000102', pg_temp.clear_pair('01')), 'denied:RX_PDF_WRITE_ONCE',
  'the signer cannot clear a pair whose object exists');
select is(pg_temp.attempt('authenticated', 'c1110000-0000-4000-8000-000000000102',
            $$update public.prescriptions set pdf_sha256 = null where visit_id = 'c1110000-0000-4000-8000-000000002004'$$),
  'denied:RX_PDF_WRITE_ONCE', 'nor half of a pair');
select is(pg_temp.call_as('c1110000-0000-4000-8000-000000000102', pg_temp.clear_pair('04') || ' returning coalesce(pdf_sha256, ''cleared'')'), 'cleared',
  'the signer clears the pair whose object is missing, so the archive can be retried');

-- S-10: a visit the caller cannot see is not sealed for the pair (simulated: the visits SELECT policy hides every visit; owner DDL, rolled back) ---------
alter policy visits_select on public.visits using (false);
select is(pg_temp.attempt('authenticated', 'c1110000-0000-4000-8000-000000000102', pg_temp.set_pair('06')), 'denied:RX_PDF_NOT_SEALED',
  'S-10: the pair of a visit the caller cannot see is refused (no "invisible = sealed" grant), even for the signer and with the signer''s object');
alter policy visits_select on public.visits using (tenant_id in (select authz.tenant_ids_with('appointments:view')));
select is(pg_temp.attempt('authenticated', 'c1110000-0000-4000-8000-000000000102', pg_temp.set_pair('06')), 'denied:RX_PDF_OBJECT_INVALID',
  'control: with the visit visible, the same write reaches the object check (2006 has no object yet)');

-- S-4: the header keys -----------------------------------------------------------------------------------------------------
select is(array[pg_temp.attempt('service_role', null, $$update public.prescriptions set visit_id = 'c1110000-0000-4000-8000-000000002007' where id = 'c1110000-0000-4000-8000-000000003005'$$),
                pg_temp.attempt('postgres', null, $$update public.prescriptions set visit_id = 'c1110000-0000-4000-8000-000000002007' where id = 'c1110000-0000-4000-8000-000000003005'$$)],
  array['denied:PRESCRIPTION_KEY_IMMUTABLE', 'denied:PRESCRIPTION_KEY_IMMUTABLE'],
  'S-4: the service role and postgres cannot move a draft header onto a sealed visit');
select is(array[pg_temp.attempt('service_role', null, $$update public.prescriptions set patient_id = 'c1110000-0000-4000-8000-000000001002' where id = 'c1110000-0000-4000-8000-000000003005'$$),
                pg_temp.attempt('service_role', null, $$update public.prescriptions set doctor_id = 'c1110000-0000-4000-8000-000000000103' where id = 'c1110000-0000-4000-8000-000000003005'$$)],
  array['denied:PRESCRIPTION_KEY_IMMUTABLE', 'denied:PRESCRIPTION_KEY_IMMUTABLE'], 'nor change its patient or doctor');
select is(pg_temp.attempt('service_role', null, $$update public.prescriptions set amendment_reason = 'Synthetic draft edit' where id = 'c1110000-0000-4000-8000-000000003005'$$),
  'ok:1', 'control: the service role still edits a draft header (the v1 API path)');
select is((select string_agg(right(visit_id::text, 2), ',' order by visit_id) from public.prescriptions where tenant_id = 'c1110000-0000-4000-8000-00000000000a'),
  '01,02,03,04,05,06', 'every header is still on its own visit');

-- S-5: the share link's object carries the recorded hash -------------------------------------------------------------------
insert into public.document_share_tokens (tenant_id, resource_type, resource_id, token_hash, expires_at, created_by) values
  ('c1110000-0000-4000-8000-00000000000a', 'prescription', 'c1110000-0000-4000-8000-000000003001', public.share_token_hash(repeat('t', 40)), now() + interval '1 day', 'c1110000-0000-4000-8000-000000000102'),
  ('c1110000-0000-4000-8000-00000000000a', 'prescription', 'c1110000-0000-4000-8000-000000003006', public.share_token_hash(repeat('u', 40)), now() + interval '1 day', 'c1110000-0000-4000-8000-000000000102');
select is((select public.share_token_object(repeat('t', 40), array['prescription']) ->> 'sha256'), repeat('a', 64),
  'S-5: share_token_object returns the archived prescription''s recorded SHA-256');
select is((select (public.share_token_object(repeat('u', 40), array['prescription']) ->> 'sha256') is null
                  and (public.share_token_object(repeat('u', 40), array['prescription']) ->> 'storage_path') is null), true,
  'and no hash and no path for a prescription not archived yet (the link answers "being prepared")');

-- A-3: no reopen while the signed version has no archive ------------------------------------------------------------------------
select is(pg_temp.call_as('c1110000-0000-4000-8000-000000000102',
  $$select public.reopen_visit_for_amendment('c1110000-0000-4000-8000-00000000000a', 'c1110000-0000-4000-8000-000000002006', 'Synthetic amendment reason for the test', gen_random_uuid())::text$$),
  'error:P0001:RX_ARCHIVE_PENDING', 'A-3: a signed visit whose Rx has no archived PDF cannot be reopened');
select is((select status || ':' || current_revision from public.visits where id = 'c1110000-0000-4000-8000-000000002006'), 'completed:1',
  'the visit stays sealed and no revision was taken');
select is(pg_temp.call_as('c1110000-0000-4000-8000-000000000102',
  $$select (public.reopen_visit_for_amendment('c1110000-0000-4000-8000-00000000000a', 'c1110000-0000-4000-8000-000000002007', 'Synthetic amendment reason for the test', gen_random_uuid()) ->> 'revision_number')$$),
  '1', 'a signed visit with no prescription reopens (control)');
-- The signer archives 2006 (the object was uploaded above as the signer through the policy probe, which rolled back: store it again as the signer's upload).
insert into storage.objects (bucket_id, name, owner, owner_id) values
  ('prescriptions', 'c1110000-0000-4000-8000-00000000000a/c1110000-0000-4000-8000-000000002006/rx_v1.pdf', 'c1110000-0000-4000-8000-000000000102', 'c1110000-0000-4000-8000-000000000102');
select is(pg_temp.call_as('c1110000-0000-4000-8000-000000000102', pg_temp.set_pair('06') || ' returning pdf_sha256 is not null'), 'true',
  'the signer archives the signed version');
select is(pg_temp.call_as('c1110000-0000-4000-8000-000000000102',
  $$select (public.reopen_visit_for_amendment('c1110000-0000-4000-8000-00000000000a', 'c1110000-0000-4000-8000-000000002006', 'Synthetic amendment reason for the test', gen_random_uuid()) ->> 'revision_number')$$),
  '1', 'and the reopen is admitted');

-- A-5: the snapshot records reason_for_visit and location_id ---------------------------------------------------------------------
select is((select (snapshot -> 'visit' ->> 'reason_for_visit') || ':' || (snapshot -> 'visit' ->> 'location_id') from public.visit_revisions
            where visit_id = 'c1110000-0000-4000-8000-000000002006'),
  'Synthetic reason 06:c1110000-0000-4000-8000-0000000000f1', 'A-5: the amendment snapshot holds the signed reason for visit and location');
select is((select snapshot -> 'prescription' ->> 'pdf_sha256' from public.visit_revisions where visit_id = 'c1110000-0000-4000-8000-000000002006'), repeat('a', 64),
  'and the archived pair of the signed version');

-- S-7: amendment rows -----------------------------------------------------------------------------------------------------
select is(array[pg_temp.attempt('authenticated', 'c1110000-0000-4000-8000-000000000101',
                  $$insert into public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason) values ('c1110000-0000-4000-8000-00000000000a', 'c1110000-0000-4000-8000-000000002001', 'c1110000-0000-4000-8000-000000000101', 'Synthetic forged amendment')$$),
                pg_temp.attempt('authenticated', 'c1110000-0000-4000-8000-000000000102',
                  $$insert into public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason) values ('c1110000-0000-4000-8000-00000000000a', 'c1110000-0000-4000-8000-000000002001', 'c1110000-0000-4000-8000-000000000102', 'Synthetic forged amendment')$$)],
  array['denied:permission denied for table visit_revisions', 'denied:permission denied for table visit_revisions'],
  'S-7: neither the owner nor the signer writes an amendment row directly (the commands are the writers)');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'visit_revisions' and cmd = 'INSERT'), 0,
  'visit_revisions has no INSERT policy');
select is(array[pg_temp.attempt('service_role', null,
                  $$insert into public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason) values ('c1110000-0000-4000-8000-00000000000a', 'c1110000-0000-4000-8000-000000002001', 'c1110000-0000-4000-8000-000000000102', '  too short ')$$),
                pg_temp.attempt('service_role', null,
                  format($q$insert into public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason) values ('c1110000-0000-4000-8000-00000000000a', 'c1110000-0000-4000-8000-000000002001', 'c1110000-0000-4000-8000-000000000102', %L)$q$, repeat('x', 501)))],
  array['error:23514:new row for relation "visit_revisions" violates check constraint "visit_revisions_amendment_reason_length"',
        'error:23514:new row for relation "visit_revisions" violates check constraint "visit_revisions_amendment_reason_length"'],
  'the reason is 10 to 500 characters (trimmed) for every writer, the service role included');
select is((select convalidated from pg_constraint where conname = 'visit_revisions_amendment_reason_length'), true, 'and the CHECK is validated');

-- S-1 / A-4: lab documents --------------------------------------------------------------------------------------------------
insert into public.patient_documents (id, tenant_id, patient_id, visit_id, title, original_filename, storage_path, file_size_bytes, mime_type, uploaded_by, is_abnormal) values
  ('c1110000-0000-4000-8000-00000000d001', 'c1110000-0000-4000-8000-00000000000a', 'c1110000-0000-4000-8000-000000001001', 'c1110000-0000-4000-8000-000000002001',
   'Synthetic CBC', 'cbc.pdf', 'tenants/c1110000-0000-4000-8000-00000000000a/patients/c1110000-0000-4000-8000-000000001001/labs/cbc.pdf', 10, 'application/pdf',
   'c1110000-0000-4000-8000-000000000104', false);
create temp table doc_res as
select r.uid, c.col,
       pg_temp.attempt('authenticated', r.uid, format('update public.patient_documents set %s where id = %L', c.assign, 'c1110000-0000-4000-8000-00000000d001')) as outcome
  from (values ('c1110000-0000-4000-8000-000000000101'::uuid), ('c1110000-0000-4000-8000-000000000102'::uuid), ('c1110000-0000-4000-8000-000000000104'::uuid)) r(uid)
 cross join (values
   ('storage_path', $$storage_path = 'tenants/c1110000-0000-4000-8000-00000000000a/patients/c1110000-0000-4000-8000-000000001001/labs/forged.pdf'$$),
   ('patient_id', $$patient_id = 'c1110000-0000-4000-8000-000000001002'$$),
   ('visit_id', $$visit_id = null$$),
   ('uploaded_by', $$uploaded_by = 'c1110000-0000-4000-8000-000000000101'$$),
   ('title', $$title = 'Forged'$$),
   ('is_abnormal', $$is_abnormal = true$$)) c(col, assign);
select is((select string_agg(right(uid::text, 3) || '/' || col || ' => ' || outcome, '; ') from doc_res where outcome <> 'denied:permission denied for table patient_documents'), null,
  'S-1: the owner, the doctor and the nurse (labs:edit) cannot rewrite a lab document''s path, patient, visit, uploader, title or abnormal flag');
select is((select storage_path || ':' || patient_id || ':' || title || ':' || is_abnormal from public.patient_documents where id = 'c1110000-0000-4000-8000-00000000d001'),
  'tenants/c1110000-0000-4000-8000-00000000000a/patients/c1110000-0000-4000-8000-000000001001/labs/cbc.pdf:c1110000-0000-4000-8000-000000001001:Synthetic CBC:false',
  'and the row is unchanged');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'patient_documents' and cmd = 'UPDATE'), 0,
  'patient_documents has no UPDATE policy');

-- S-9: TRUNCATE and TRIGGER --------------------------------------------------------------------------------------------------
select is((select string_agg(t || ':' || r || ':' || p, ', ')
             from unnest(array['visits', 'clinical_notes', 'prescriptions', 'prescription_items', 'consultation_diagnoses', 'follow_ups', 'visit_revisions', 'patient_documents']) t
            cross join unnest(array['service_role', 'authenticated', 'anon']) r
            cross join unnest(array['TRUNCATE', 'TRIGGER']) p
            where has_table_privilege(r, 'public.' || t, p)), null,
  'S-9: service_role, authenticated and anon hold neither TRUNCATE nor TRIGGER on the sealed tables');
select is(pg_temp.attempt('service_role', null, 'truncate public.prescription_items'), 'denied:permission denied for table prescription_items',
  'the service role cannot TRUNCATE a sealed table (no row trigger would fire)');
select is(pg_temp.attempt('service_role', null, 'truncate public.tenants cascade'), 'denied:permission denied for table visits',
  'nor reach one through TRUNCATE ... CASCADE');

select * from finish();
rollback;
