-- rx_pdf_write_once.test.sql — V2-09a 09A-03 (R-12, R-13 Rx part; migration 000109). The prescription PDF pair (pdf_storage_path, pdf_sha256) is write-once on every
-- path and in every state, a signed header changes in nothing else, the header carries the hash column, and the amendment's finalize clears the pair
-- while the signed version's pair survives in the revision snapshot.
--
-- 1. Matrix: PDF-pair operations x state x role. States: draft (D), sealed with no PDF archived (S), sealed and archived (A), amending with the signed
--    version's pair still on the header (M), sealed with a legacy path and no hash (L). Roles: owner and doctor (the request path, column grant), service_role and
--    postgres (the system path), plus admin, nurse, receptionist, another clinic's owner and anon (never change a header). Every probe runs in a
--    rolled-back subtransaction.
-- 2. The column and its CHECKs; the column grant (authenticated: pdf_storage_path, pdf_sha256, updated_at only).
-- 3. INSERT carries no pair.
-- 4. Lifecycle through the commands: sign, archive, reopen, finalize: the pair is cleared, the snapshot holds it, version 2 is archived once at its own key.
-- Synthetic data only; the file rolls back.
begin;
select plan(28);

-- Fixtures ----------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1090000-0000-4000-8000-000000000101', 'c109-owner-a@example.test'),
  ('c1090000-0000-4000-8000-000000000102', 'c109-doctor-a@example.test'),
  ('c1090000-0000-4000-8000-000000000103', 'c109-admin-a@example.test'),
  ('c1090000-0000-4000-8000-000000000104', 'c109-nurse-a@example.test'),
  ('c1090000-0000-4000-8000-000000000105', 'c109-receptionist-a@example.test'),
  ('c1090000-0000-4000-8000-000000000201', 'c109-owner-b@example.test');
insert into public.tenants (id, name) values
  ('c1090000-0000-4000-8000-00000000000a', 'Synthetic 09A-03 Clinic A'),
  ('c1090000-0000-4000-8000-00000000000b', 'Synthetic 09A-03 Clinic B');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1090000-0000-4000-8000-00000000000a', 'c1090000-0000-4000-8000-00000000000b');
insert into public.memberships (user_id, tenant_id, role) values
  ('c1090000-0000-4000-8000-000000000101', 'c1090000-0000-4000-8000-00000000000a', 'owner'),
  ('c1090000-0000-4000-8000-000000000102', 'c1090000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1090000-0000-4000-8000-000000000103', 'c1090000-0000-4000-8000-00000000000a', 'admin'),
  ('c1090000-0000-4000-8000-000000000104', 'c1090000-0000-4000-8000-00000000000a', 'nurse'),
  ('c1090000-0000-4000-8000-000000000105', 'c1090000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c1090000-0000-4000-8000-000000000201', 'c1090000-0000-4000-8000-00000000000b', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1090000-0000-4000-8000-000000001001', 'c1090000-0000-4000-8000-00000000000a', 'Synthetic Rx Pdf Patient', '+919000010901',
   'c1090000-0000-4000-8000-000000000101');

-- Visits with a header: D 2001 draft, S 2002 sealed, A 2003 sealed and archived, M 2004 amending (archived before it was reopened), L 2005 sealed with a legacy path.
-- E 2011 is a draft with no header (INSERT probes). All start open; the others are signed the way production does (R-15).
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by)
  select ('c1090000-0000-4000-8000-0000000020' || n)::uuid, 'c1090000-0000-4000-8000-00000000000a', 'c1090000-0000-4000-8000-000000001001',
         'c1090000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1090000-0000-4000-8000-000000000101'
    from unnest(array['01', '02', '03', '04', '05', '11']) n;
update public.clinical_notes set clinical_notes = 'Synthetic note' where tenant_id = 'c1090000-0000-4000-8000-00000000000a';
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id)
  select ('c1090000-0000-4000-8000-0000000030' || right(v.id::text, 2))::uuid, v.tenant_id, v.id, v.patient_id, v.doctor_id
    from public.visits v where right(v.id::text, 2) in ('01', '02', '03', '04', '05');
insert into public.prescription_items (prescription_id, medicine_name, dosage, duration)
  select p.id, 'Synthetic medicine', '1-0-1', '5 days' from public.prescriptions p where p.tenant_id = 'c1090000-0000-4000-8000-00000000000a';

create function pg_temp.as_actor(p_user uuid, p_sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c1090000-0000-4000-8000-00000000000a')::text, true);
  execute p_sql;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end
$f$;
do $do$
declare
  d constant uuid := 'c1090000-0000-4000-8000-000000000102';
begin
  perform pg_temp.as_actor(d, format($q$update public.visits set status = 'completed', signed_at = now(), signed_by = %L
    where id in ('c1090000-0000-4000-8000-000000002002', 'c1090000-0000-4000-8000-000000002003',
                 'c1090000-0000-4000-8000-000000002004', 'c1090000-0000-4000-8000-000000002005')$q$, d));
end $do$;
-- The headers are signed (sign-off seals the active headers; here the same write, while the visits are already signed, so the guard is bypassed for this one
-- fixture statement the way a pre-000108 sign-off would have: owner DDL in this rolled-back transaction).
alter table public.prescriptions disable trigger prescriptions_seal_guard;
update public.prescriptions set signed_at = now() - interval '1 day' where tenant_id = 'c1090000-0000-4000-8000-00000000000a'
   and visit_id in ('c1090000-0000-4000-8000-000000002002', 'c1090000-0000-4000-8000-000000002003', 'c1090000-0000-4000-8000-000000002004', 'c1090000-0000-4000-8000-000000002005');
alter table public.prescriptions enable trigger prescriptions_seal_guard;
-- A: archived. M: archived, then reopened. L: a legacy path with no hash.
update public.prescriptions set pdf_storage_path = tenant_id::text || '/' || visit_id::text || '/rx_v1.pdf', pdf_sha256 = repeat('b', 64)
 where visit_id in ('c1090000-0000-4000-8000-000000002003', 'c1090000-0000-4000-8000-000000002004');
update public.prescriptions set pdf_storage_path = tenant_id::text || '/' || visit_id::text || '/rx_v1.pdf'
 where visit_id = 'c1090000-0000-4000-8000-000000002005';
do $do$
declare
  d constant uuid := 'c1090000-0000-4000-8000-000000000102';
begin
  perform pg_temp.as_actor(d, $q$insert into public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason)
    values ('c1090000-0000-4000-8000-00000000000a', 'c1090000-0000-4000-8000-000000002004', 'c1090000-0000-4000-8000-000000000102', 'Synthetic amendment reason')$q$);
  perform pg_temp.as_actor(d, $q$update public.visits set status = 'in_consultation' where id = 'c1090000-0000-4000-8000-000000002004'$q$);
end $do$;
select is((select string_agg(right(v.id::text, 2) || ':' || v.status || ':' || (v.signed_at is not null)::text || ':' || coalesce(p.pdf_sha256 is not null, false)::text
                              || ':' || coalesce((p.pdf_storage_path is not null)::text, '-'), ',' order by v.id)
             from public.visits v left join public.prescriptions p on p.visit_id = v.id where v.tenant_id = 'c1090000-0000-4000-8000-00000000000a'),
  '01:in_consultation:false:false:false,02:completed:true:false:false,03:completed:true:true:true,04:in_consultation:true:true:true,05:completed:true:false:true,11:in_consultation:false:false:false',
  'fixture: D open, S sealed unarchived, A sealed archived, M amending with its pair, L sealed with a legacy path and no hash');

create function pg_temp.attempt(p_db_role text, p_user uuid, p_tenant uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
  v_n bigint;
begin
  begin
    perform set_config('request.jwt.claims', case when p_user is null then json_build_object('role', p_db_role)::text
                                                  else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
    perform set_config('request.headers', json_build_object('x-clinicos-tenant', p_tenant)::text, true);
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

create temp table roles (role text, db_role text, uid uuid, tenant uuid, kind text);
insert into roles values
  ('owner',        'authenticated', 'c1090000-0000-4000-8000-000000000101', 'c1090000-0000-4000-8000-00000000000a', 'usr'),
  ('doctor',       'authenticated', 'c1090000-0000-4000-8000-000000000102', 'c1090000-0000-4000-8000-00000000000a', 'usr'),
  ('admin',        'authenticated', 'c1090000-0000-4000-8000-000000000103', 'c1090000-0000-4000-8000-00000000000a', 'other'),
  ('nurse',        'authenticated', 'c1090000-0000-4000-8000-000000000104', 'c1090000-0000-4000-8000-00000000000a', 'other'),
  ('receptionist', 'authenticated', 'c1090000-0000-4000-8000-000000000105', 'c1090000-0000-4000-8000-00000000000a', 'other'),
  ('owner_b',      'authenticated', 'c1090000-0000-4000-8000-000000000201', 'c1090000-0000-4000-8000-00000000000b', 'other'),
  ('anon',         'anon',          null,                                   'c1090000-0000-4000-8000-00000000000a', 'other'),
  ('service_role', 'service_role',  null,                                   'c1090000-0000-4000-8000-00000000000a', 'sys'),
  ('postgres',     'postgres',      null,                                   'c1090000-0000-4000-8000-00000000000a', 'sys');

create temp table states (state text, visit uuid);
insert into states values
  ('D', 'c1090000-0000-4000-8000-000000002001'), ('S', 'c1090000-0000-4000-8000-000000002002'), ('A', 'c1090000-0000-4000-8000-000000002003'),
  ('M', 'c1090000-0000-4000-8000-000000002004'), ('L', 'c1090000-0000-4000-8000-000000002005');

-- {v} the visit, {t} the clinic. e_*: 'ok' admitted (1 row), otherwise a regex over the refusal. e_usr: the request path (owner, doctor); e_sys: service_role and postgres.
-- Expectations are in the state order D, S, A, M, L; '|' separates them.
create temp table ops (op text, sql text, e_sys text, e_usr text);
insert into ops values
  ('set the pair at the canonical key',
   $$update public.prescriptions set pdf_storage_path = '{t}/{v}/rx_v1.pdf', pdf_sha256 = repeat('a', 64) where visit_id = '{v}'$$,
   'RX_PDF_NOT_SEALED|ok|RX_PDF_WRITE_ONCE|RX_PDF_WRITE_ONCE|ok', null),
  ('set the hash only',
   $$update public.prescriptions set pdf_sha256 = repeat('c', 64) where visit_id = '{v}'$$,
   'RX_PDF_NOT_SEALED|RX_PDF_PATH_INVALID|RX_PDF_WRITE_ONCE|RX_PDF_WRITE_ONCE|ok', null),
  ('set the pair at another version''s key',
   $$update public.prescriptions set pdf_storage_path = '{t}/{v}/rx_v9.pdf', pdf_sha256 = repeat('a', 64) where visit_id = '{v}'$$,
   'RX_PDF_NOT_SEALED|RX_PDF_PATH_INVALID|RX_PDF_WRITE_ONCE|RX_PDF_WRITE_ONCE|RX_PDF_WRITE_ONCE', null),
  ('set the pair at another visit''s key',
   $$update public.prescriptions set pdf_storage_path = '{t}/c1090000-0000-4000-8000-0000000020ff/rx_v1.pdf', pdf_sha256 = repeat('a', 64) where visit_id = '{v}'$$,
   'RX_PDF_NOT_SEALED|RX_PDF_PATH_INVALID|RX_PDF_WRITE_ONCE|RX_PDF_WRITE_ONCE|RX_PDF_WRITE_ONCE', null),
  ('clear the pair',
   $$update public.prescriptions set pdf_storage_path = null, pdf_sha256 = null where visit_id = '{v}'$$,
   'ok|ok|RX_PDF_WRITE_ONCE|RX_PDF_WRITE_ONCE|RX_PDF_WRITE_ONCE', null),
  ('clear the hash only',
   $$update public.prescriptions set pdf_sha256 = null where visit_id = '{v}'$$,
   'ok|ok|RX_PDF_WRITE_ONCE|RX_PDF_WRITE_ONCE|ok', null),
  ('raise the version and clear the pair',
   $$update public.prescriptions set version = version + 1, pdf_storage_path = null, pdf_sha256 = null where visit_id = '{v}'$$,
   'ok|RX_SEALED|RX_SEALED|ok|RX_SEALED', array_to_string(array_fill('permission denied'::text, array[5]), '|')),
  ('raise the version and keep the pair',
   $$update public.prescriptions set version = version + 1 where visit_id = '{v}'$$,
   'ok|RX_SEALED|RX_SEALED|RX_PDF_PATH_INVALID|RX_SEALED', array_to_string(array_fill('permission denied'::text, array[5]), '|')),
  ('update letterhead_mode',
   $$update public.prescriptions set letterhead_mode = 'preprinted_letterhead' where visit_id = '{v}'$$,
   'ok|RX_SEALED|RX_SEALED|ok|RX_SEALED', array_to_string(array_fill('permission denied'::text, array[5]), '|')),
  ('update updated_at',
   $$update public.prescriptions set updated_at = now() where visit_id = '{v}'$$,
   'ok|ok|ok|ok|ok', null);
update ops set e_usr = e_sys where e_usr is null;

create temp table res as
select o.op, s.state, k.role, k.kind,
       (string_to_array(case k.kind when 'sys' then o.e_sys else o.e_usr end, '|'))[array_position(array['D', 'S', 'A', 'M', 'L'], s.state)] as expected,
       pg_temp.attempt(k.db_role, k.uid, k.tenant, replace(replace(o.sql, '{v}', s.visit::text), '{t}', k.tenant::text)) as outcome
  from ops o cross join states s cross join roles k;

-- 1. The matrix ---------------------------------------------------------------------------------------------------------
select is((select count(*)::int from res), 10 * 5 * 9, 'the matrix ran every operation in every state as every role (10 x 5 x 9)');
select is((select string_agg(op || '/' || state || '/' || role || ' => ' || outcome, '; ') from res where outcome ~ '^error:'), null,
  'no probe failed for a reason other than the guard and the grants (no undefined column, no unexpected constraint)');
select is((select string_agg(op || '/' || state || '/' || role || ' => ' || outcome, '; ') from res
            where kind in ('sys', 'usr') and role in ('owner', 'doctor', 'service_role', 'postgres') and expected = 'ok' and outcome !~ '^ok:1'), null,
  'owner, doctor, service_role and postgres: the admitted writes of the matrix take effect on the one header');
select is((select string_agg(op || '/' || state || '/' || role || ' => ' || outcome, '; ') from res
            where role in ('owner', 'doctor', 'service_role', 'postgres') and expected <> 'ok' and expected <> 'permission denied' and outcome !~ ('^denied:(' || expected || ')$')), null,
  'every refused write carries the guard''s own fixed name (RX_PDF_NOT_SEALED, RX_PDF_PATH_INVALID, RX_PDF_WRITE_ONCE, RX_SEALED), for the request path and the system path alike');
select is((select string_agg(op || '/' || state || '/' || role || ' => ' || outcome, '; ') from res
            where role in ('owner', 'doctor') and expected = 'permission denied' and outcome !~ '^denied:permission denied'), null,
  'version and letterhead_mode are not writable by the request path at all (column grant)');
select is((select string_agg(op || '/' || state || '/' || role || ' => ' || outcome, '; ') from res
            where kind = 'other' and outcome ~ '^ok:[1-9]'), null,
  'admin, nurse, receptionist, another clinic''s owner and anon change no header in any state');
-- Every write that was admitted wrote exactly what it said: re-read the fixtures (every probe rolled back).
select is((select string_agg(right(visit_id::text, 2) || ':' || version::text || ':' || coalesce(pdf_storage_path, '-') || ':' || coalesce(left(pdf_sha256, 1), '-') || ':' || letterhead_mode, ',' order by visit_id)
             from public.prescriptions where tenant_id = 'c1090000-0000-4000-8000-00000000000a'),
  '01:1:-:-:blank_paper,02:1:-:-:blank_paper,03:1:c1090000-0000-4000-8000-00000000000a/c1090000-0000-4000-8000-000000002003/rx_v1.pdf:b:blank_paper,'
  '04:1:c1090000-0000-4000-8000-00000000000a/c1090000-0000-4000-8000-000000002004/rx_v1.pdf:b:blank_paper,'
  '05:1:c1090000-0000-4000-8000-00000000000a/c1090000-0000-4000-8000-000000002005/rx_v1.pdf:-:blank_paper',
  'the probes rolled back: the fixtures are unchanged');

-- 2. The column, its CHECKs and the grant --------------------------------------------------------------------------------
select is((select data_type || ':' || is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'prescriptions' and column_name = 'pdf_sha256'),
  'text:YES', 'prescriptions.pdf_sha256 exists and is nullable (legacy rows stay valid)');
select is((select array_agg(c.conname::text order by c.conname) from pg_constraint c
            where c.conrelid = 'public.prescriptions'::regclass and c.conname in ('prescriptions_pdf_sha256_shape', 'prescriptions_pdf_hash_needs_path') and c.convalidated),
  array['prescriptions_pdf_hash_needs_path', 'prescriptions_pdf_sha256_shape'], 'both CHECKs exist and are validated');
select is(pg_temp.attempt('postgres', null, 'c1090000-0000-4000-8000-00000000000a',
  $$update public.prescriptions set pdf_storage_path = 'c1090000-0000-4000-8000-00000000000a/c1090000-0000-4000-8000-000000002002/rx_v1.pdf', pdf_sha256 = 'XYZ' where visit_id = 'c1090000-0000-4000-8000-000000002002'$$),
  'error:23514:new row for relation "prescriptions" violates check constraint "prescriptions_pdf_sha256_shape"',
  'a hash that is not 64 lower-case hex characters is refused by the CHECK (the guard admits the canonical path)');
select is(pg_temp.attempt('postgres', null, 'c1090000-0000-4000-8000-00000000000a',
  $$update public.prescriptions set pdf_sha256 = upper(repeat('a', 64)) where visit_id = 'c1090000-0000-4000-8000-000000002005'$$),
  'error:23514:new row for relation "prescriptions" violates check constraint "prescriptions_pdf_sha256_shape"', 'upper-case hex is refused too');
-- The guard refuses a hash without a path first; the CHECK is the second line (shown with the guard off: owner DDL in this rolled-back transaction).
alter table public.prescriptions disable trigger prescriptions_seal_guard;
select is(pg_temp.attempt('postgres', null, 'c1090000-0000-4000-8000-00000000000a',
  $$update public.prescriptions set pdf_sha256 = repeat('a', 64) where visit_id = 'c1090000-0000-4000-8000-000000002002'$$),
  'error:23514:new row for relation "prescriptions" violates check constraint "prescriptions_pdf_hash_needs_path"', 'with the guard off, the CHECK still refuses a hash with no path');
alter table public.prescriptions enable trigger prescriptions_seal_guard;
select is((select array_agg(a.attname::text order by a.attname) from pg_attribute a
            where a.attrelid = 'public.prescriptions'::regclass and a.attnum > 0 and not a.attisdropped
              and has_column_privilege('authenticated', 'public.prescriptions', a.attname, 'UPDATE')),
  array['pdf_sha256', 'pdf_storage_path', 'updated_at'], 'authenticated may UPDATE pdf_storage_path, pdf_sha256 and updated_at only (letterhead_mode is set at INSERT, R-12)');
select is((select array_agg(a.attname::text order by a.attname) from pg_attribute a
            where a.attrelid = 'public.prescriptions'::regclass and a.attnum > 0 and not a.attisdropped
              and has_column_privilege('service_role', 'public.prescriptions', a.attname, 'UPDATE') is false), null,
  'service_role keeps its table-wide UPDATE (the v1 API); the seal guard binds it');

-- 3. INSERT carries no pair -----------------------------------------------------------------------------------------------
select is(pg_temp.attempt('postgres', null, 'c1090000-0000-4000-8000-00000000000a',
  $$insert into public.prescriptions (tenant_id, visit_id, patient_id, doctor_id, pdf_storage_path) values ('c1090000-0000-4000-8000-00000000000a', 'c1090000-0000-4000-8000-000000002011', 'c1090000-0000-4000-8000-000000001001', 'c1090000-0000-4000-8000-000000000102', 'c1090000-0000-4000-8000-00000000000a/c1090000-0000-4000-8000-000000002011/rx_v1.pdf')$$),
  'denied:RX_PDF_NOT_SEALED', 'a header is not inserted with a path (system path)');
select is(pg_temp.attempt('authenticated', 'c1090000-0000-4000-8000-000000000102', 'c1090000-0000-4000-8000-00000000000a',
  $$insert into public.prescriptions (tenant_id, visit_id, patient_id, doctor_id, pdf_storage_path, pdf_sha256) values ('c1090000-0000-4000-8000-00000000000a', 'c1090000-0000-4000-8000-000000002011', 'c1090000-0000-4000-8000-000000001001', 'c1090000-0000-4000-8000-000000000102', 'c1090000-0000-4000-8000-00000000000a/c1090000-0000-4000-8000-000000002011/rx_v1.pdf', repeat('a', 64))$$),
  'denied:RX_PDF_NOT_SEALED', 'nor with a path and a hash (request path)');
select is(pg_temp.attempt('authenticated', 'c1090000-0000-4000-8000-000000000102', 'c1090000-0000-4000-8000-00000000000a',
  $$insert into public.prescriptions (tenant_id, visit_id, patient_id, doctor_id) values ('c1090000-0000-4000-8000-00000000000a', 'c1090000-0000-4000-8000-000000002011', 'c1090000-0000-4000-8000-000000001001', 'c1090000-0000-4000-8000-000000000102')$$),
  'ok:1', 'a plain first header is still admitted (control)');

-- 4. Lifecycle through the commands ---------------------------------------------------------------------------------------
create function pg_temp.call_as(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c1090000-0000-4000-8000-00000000000a')::text, true);
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
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1090000-0000-4000-8000-000000002031', 'c1090000-0000-4000-8000-00000000000a', 'c1090000-0000-4000-8000-000000001001',
   'c1090000-0000-4000-8000-000000000102', 'walk_in', 'waiting', 'c1090000-0000-4000-8000-000000000101');
update public.clinical_notes set clinical_notes = 'Synthetic note' where visit_id = 'c1090000-0000-4000-8000-000000002031';
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id, version) values
  ('c1090000-0000-4000-8000-000000003031', 'c1090000-0000-4000-8000-00000000000a', 'c1090000-0000-4000-8000-000000002031',
   'c1090000-0000-4000-8000-000000001001', 'c1090000-0000-4000-8000-000000000102', 1);
insert into public.prescription_items (prescription_id, medicine_name, dosage, duration) values
  ('c1090000-0000-4000-8000-000000003031', 'Synthetic medicine', '1-0-1', '5 days');
select is(pg_temp.call_as('c1090000-0000-4000-8000-000000000102',
  $$select (public.sign_consultation('c1090000-0000-4000-8000-00000000000a', 'c1090000-0000-4000-8000-000000002031', 'c1090000-0000-4000-8000-0000000c0011') ->> 'sealed_prescriptions')$$),
  '1', 'sign-off seals the header (no PDF pair yet)');
select is(pg_temp.call_as('c1090000-0000-4000-8000-000000000102',
  $$update public.prescriptions set pdf_storage_path = 'c1090000-0000-4000-8000-00000000000a/c1090000-0000-4000-8000-000000002031/rx_v1.pdf', pdf_sha256 = repeat('d', 64)
     where id = 'c1090000-0000-4000-8000-000000003031' and pdf_sha256 is null returning 'archived'$$),
  'archived', 'the doctor archives the signed version once (the generator''s UPDATE ... WHERE pdf_sha256 IS NULL)');
select is(pg_temp.call_as('c1090000-0000-4000-8000-000000000102',
  $$with u as (update public.prescriptions set pdf_storage_path = 'c1090000-0000-4000-8000-00000000000a/c1090000-0000-4000-8000-000000002031/rx_v1.pdf', pdf_sha256 = repeat('e', 64)
     where id = 'c1090000-0000-4000-8000-000000003031' and pdf_sha256 is null returning 1) select count(*)::text from u$$),
  '0', 'a second archiver''s UPDATE ... WHERE pdf_sha256 IS NULL matches no row: the first hash stands');
-- A pgTAP file is one transaction: the sign-off time is moved a day back (guard off, rolled back) so that finalize's new signature differs from the old one.
alter table public.visits disable trigger visits_integrity_guard;
update public.visits set signed_at = now() - interval '1 day' where id = 'c1090000-0000-4000-8000-000000002031';
alter table public.visits enable trigger visits_integrity_guard;
select is(pg_temp.call_as('c1090000-0000-4000-8000-000000000102',
  $$select (public.reopen_visit_for_amendment('c1090000-0000-4000-8000-00000000000a', 'c1090000-0000-4000-8000-000000002031', 'Synthetic amendment reason for the test', 'c1090000-0000-4000-8000-0000000c0012') ->> 'revision_number')$$),
  '1', 'reopened');
select is(pg_temp.call_as('c1090000-0000-4000-8000-000000000102',
  $$select (public.finalize_visit_amendment('c1090000-0000-4000-8000-00000000000a', 'c1090000-0000-4000-8000-000000002031', 'c1090000-0000-4000-8000-0000000c0013') ->> 'version')$$),
  '2', 'finalized: version 2');
select is((select version::text || ':' || coalesce(pdf_storage_path, 'null') || ':' || coalesce(pdf_sha256, 'null') from public.prescriptions where id = 'c1090000-0000-4000-8000-000000003031'),
  '2:null:null', 'finalize cleared the PDF pair in the statement that raised the version');
select is((select (r.snapshot -> 'prescription' ->> 'pdf_storage_path') || ':' || (r.snapshot -> 'prescription' ->> 'pdf_sha256') || ':' || (r.snapshot -> 'prescription' ->> 'version')
             from public.visit_revisions r where r.visit_id = 'c1090000-0000-4000-8000-000000002031'),
  'c1090000-0000-4000-8000-00000000000a/c1090000-0000-4000-8000-000000002031/rx_v1.pdf:' || repeat('d', 64) || ':1',
  'the revision snapshot holds the signed version''s path and hash (the whole header row is snapshotted)');
select is(pg_temp.call_as('c1090000-0000-4000-8000-000000000102',
  $$update public.prescriptions set pdf_storage_path = 'c1090000-0000-4000-8000-00000000000a/c1090000-0000-4000-8000-000000002031/rx_v1.pdf', pdf_sha256 = repeat('d', 64)
     where id = 'c1090000-0000-4000-8000-000000003031' returning 'x'$$),
  'denied:RX_PDF_PATH_INVALID', 'the old key cannot be written back onto version 2');
select is(pg_temp.call_as('c1090000-0000-4000-8000-000000000102',
  $$update public.prescriptions set pdf_storage_path = 'c1090000-0000-4000-8000-00000000000a/c1090000-0000-4000-8000-000000002031/rx_v2.pdf', pdf_sha256 = repeat('f', 64)
     where id = 'c1090000-0000-4000-8000-000000003031' and pdf_sha256 is null returning 'archived'$$),
  'archived', 'version 2 is archived once at its own key');
select is(pg_temp.call_as('c1090000-0000-4000-8000-000000000102',
  $$update public.prescriptions set pdf_sha256 = repeat('1', 64) where id = 'c1090000-0000-4000-8000-000000003031' returning 'x'$$),
  'denied:RX_PDF_WRITE_ONCE', 'and its hash cannot be replaced');

select * from finish();
rollback;
