-- prescription_seal.test.sql — V2-09a 09A-02 (R-8, R-9, R-10; migration 000108). A signed prescription header cannot be rewritten by anyone, a request
-- path creates at most one header per visit, sign-off still seals, and finalizing an amendment re-issues the prescription event.
--
-- 1. Matrix: header operations x state x role. Operations: UPDATE of version, status, signed_at, amendment_reason (the columns only the commands
--    change), of pdf_storage_path, letterhead_mode and updated_at (the columns a request path may still write, 000108), DELETE, INSERT of version 1
--    and of version 2 on a visit with no header. States: draft, sealed, amending. Roles: owner, doctor, admin, nurse, receptionist of clinic A,
--    owner of clinic B, anon, service_role, postgres. Every probe runs in a rolled-back subtransaction.
-- 2. The column grant (has_column_privilege): authenticated updates only pdf_storage_path, pdf_sha256 and updated_at (000109; 000108 had letterhead_mode instead of the hash).
-- 3. Sign order: the sign-off command still seals a visit with two unsealed active headers (it seals before it signs now).
-- 4. Finalize: reopen and finalize as the doctor give header version 2, one prescription.issued outbox row per version with the key
--    `...:signed` and `...:signed:v2`, `version` in the data, nothing on replay, nothing for a visit with no header.
-- Synthetic data only; the file rolls back.
begin;
select plan(33);

-- Fixtures ----------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1080000-0000-4000-8000-000000000101', 'c108-owner-a@example.test'),
  ('c1080000-0000-4000-8000-000000000102', 'c108-doctor-a@example.test'),
  ('c1080000-0000-4000-8000-000000000103', 'c108-admin-a@example.test'),
  ('c1080000-0000-4000-8000-000000000104', 'c108-nurse-a@example.test'),
  ('c1080000-0000-4000-8000-000000000105', 'c108-receptionist-a@example.test'),
  ('c1080000-0000-4000-8000-000000000201', 'c108-owner-b@example.test');
insert into public.tenants (id, name) values
  ('c1080000-0000-4000-8000-00000000000a', 'Synthetic 09A-02 Clinic A'),
  ('c1080000-0000-4000-8000-00000000000b', 'Synthetic 09A-02 Clinic B');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-00000000000b');
insert into public.memberships (user_id, tenant_id, role) values
  ('c1080000-0000-4000-8000-000000000101', 'c1080000-0000-4000-8000-00000000000a', 'owner'),
  ('c1080000-0000-4000-8000-000000000102', 'c1080000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1080000-0000-4000-8000-000000000103', 'c1080000-0000-4000-8000-00000000000a', 'admin'),
  ('c1080000-0000-4000-8000-000000000104', 'c1080000-0000-4000-8000-00000000000a', 'nurse'),
  ('c1080000-0000-4000-8000-000000000105', 'c1080000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c1080000-0000-4000-8000-000000000201', 'c1080000-0000-4000-8000-00000000000b', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1080000-0000-4000-8000-000000001001', 'c1080000-0000-4000-8000-00000000000a', 'Synthetic Rx Seal Patient', '+919000010801',
   'c1080000-0000-4000-8000-000000000101');

-- Visits with a header: D 2001 draft, S 2002 sealed, M 2003 amending. Visits with no header: Dn 2011 draft, Sn 2012 sealed, Mn 2013 amending.
-- All start open (in_consultation); S, M, Sn, Mn are signed (and M, Mn reopened) below the way production does (R-15).
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by)
  select ('c1080000-0000-4000-8000-0000000020' || n)::uuid, 'c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000001001',
         'c1080000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1080000-0000-4000-8000-000000000101'
    from unnest(array['01', '02', '03', '11', '12', '13']) n;
update public.clinical_notes set clinical_notes = 'Synthetic note' where tenant_id = 'c1080000-0000-4000-8000-00000000000a';
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id)
  select ('c1080000-0000-4000-8000-0000000030' || right(v.id::text, 2))::uuid, v.tenant_id, v.id, v.patient_id, v.doctor_id
    from public.visits v where right(v.id::text, 2) in ('01', '02', '03');
insert into public.prescription_items (prescription_id, medicine_name, dosage, duration)
  select p.id, 'Synthetic medicine', '1-0-1', '5 days' from public.prescriptions p where p.tenant_id = 'c1080000-0000-4000-8000-00000000000a';

create function pg_temp.as_actor(p_user uuid, p_sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c1080000-0000-4000-8000-00000000000a')::text, true);
  execute p_sql;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end
$f$;
do $do$
declare
  d constant uuid := 'c1080000-0000-4000-8000-000000000102';
begin
  perform pg_temp.as_actor(d, format($q$update public.visits set status = 'completed', signed_at = now(), signed_by = %L
    where id in ('c1080000-0000-4000-8000-000000002002', 'c1080000-0000-4000-8000-000000002003',
                 'c1080000-0000-4000-8000-000000002012', 'c1080000-0000-4000-8000-000000002013')$q$, d));
  perform pg_temp.as_actor(d, $q$insert into public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason)
    select 'c1080000-0000-4000-8000-00000000000a', v, 'c1080000-0000-4000-8000-000000000102', 'Synthetic amendment reason'
      from unnest(array['c1080000-0000-4000-8000-000000002003'::uuid, 'c1080000-0000-4000-8000-000000002013'::uuid]) v$q$);
  perform pg_temp.as_actor(d, $q$update public.visits set status = 'in_consultation'
    where id in ('c1080000-0000-4000-8000-000000002003', 'c1080000-0000-4000-8000-000000002013')$q$);
end $do$;
select is((select string_agg(right(v.id::text, 2) || ':' || v.status || ':' || (v.signed_at is not null)::text, ',' order by v.id) from public.visits v
            where v.tenant_id = 'c1080000-0000-4000-8000-00000000000a'),
  '01:in_consultation:false,02:completed:true,03:in_consultation:true,11:in_consultation:false,12:completed:true,13:in_consultation:true',
  'fixture: 01 and 11 are drafts, 02 and 12 are sealed, 03 and 13 are amending');

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

create temp table roles (role text, db_role text, uid uuid, tenant uuid, actor uuid, kind text);
insert into roles values
  ('owner',        'authenticated', 'c1080000-0000-4000-8000-000000000101', 'c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000000101', 'usr'),
  ('doctor',       'authenticated', 'c1080000-0000-4000-8000-000000000102', 'c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000000102', 'usr'),
  ('admin',        'authenticated', 'c1080000-0000-4000-8000-000000000103', 'c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000000103', 'other'),
  ('nurse',        'authenticated', 'c1080000-0000-4000-8000-000000000104', 'c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000000104', 'other'),
  ('receptionist', 'authenticated', 'c1080000-0000-4000-8000-000000000105', 'c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000000105', 'other'),
  ('owner_b',      'authenticated', 'c1080000-0000-4000-8000-000000000201', 'c1080000-0000-4000-8000-00000000000b', 'c1080000-0000-4000-8000-000000000201', 'other'),
  ('anon',         'anon',          null,                                   'c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000000102', 'other'),
  ('service_role', 'service_role',  null,                                   'c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000000102', 'sys'),
  ('postgres',     'postgres',      null,                                   'c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000000102', 'sys');

-- visit: the visit with a header; empty: the visit with none.
create temp table states (state text, visit uuid, empty uuid);
insert into states values
  ('draft',    'c1080000-0000-4000-8000-000000002001', 'c1080000-0000-4000-8000-000000002011'),
  ('sealed',   'c1080000-0000-4000-8000-000000002002', 'c1080000-0000-4000-8000-000000002012'),
  ('amending', 'c1080000-0000-4000-8000-000000002003', 'c1080000-0000-4000-8000-000000002013');

-- {v} the header's visit, {n} the visit with no header, {actor} the doctor of the row, {t} the clinic. exp_*: NULL not asserted, 'ok' admitted,
-- otherwise a regex over the refusal message. sys = service_role and postgres; usr = the owner and the doctor.
create temp table ops (op text, sql text, sys_d text, sys_s text, sys_a text, usr_d text, usr_s text, usr_a text);
insert into ops values
  ('update version',         $$update public.prescriptions set version = version + 1 where visit_id = '{v}'$$,
     'ok', 'RX_SEALED', 'ok', 'permission denied', 'permission denied', 'permission denied'),
  ('update status',          $$update public.prescriptions set status = 'amended' where visit_id = '{v}'$$,
     'ok', 'RX_SEALED', 'ok', 'permission denied', 'permission denied', 'permission denied'),
  ('update signed_at',       $$update public.prescriptions set signed_at = now() where visit_id = '{v}'$$,
     'ok', 'RX_SEALED', 'ok', 'permission denied', 'permission denied', 'permission denied'),
  ('update amendment_reason',$$update public.prescriptions set amendment_reason = 'rewritten reason' where visit_id = '{v}'$$,
     'ok', 'RX_SEALED', 'ok', 'permission denied', 'permission denied', 'permission denied'),
  -- V2-09a 000109 (R-12): the PDF pair is write-once and only for a signed header of a sealed visit; the headers of this file are unsigned, so a path is
  -- refused in every state (the pair's own cases are in rx_pdf_write_once.test.sql). letterhead_mode is set at INSERT only: no request-path grant, and frozen once sealed.
  ('update pdf_storage_path',$$update public.prescriptions set pdf_storage_path = '{t}/{v}/rx_v1.pdf' where visit_id = '{v}'$$,
     'RX_PDF_NOT_SEALED', 'RX_PDF_NOT_SEALED', 'RX_PDF_NOT_SEALED', 'RX_PDF_NOT_SEALED', 'RX_PDF_NOT_SEALED', 'RX_PDF_NOT_SEALED'),
  ('update letterhead_mode', $$update public.prescriptions set letterhead_mode = 'preprinted_letterhead' where visit_id = '{v}'$$,
     'ok', 'RX_SEALED', 'ok', 'permission denied', 'permission denied', 'permission denied'),
  ('update updated_at',      $$update public.prescriptions set updated_at = now() where visit_id = '{v}'$$,
     'ok', 'ok', 'ok', 'ok', 'ok', 'ok'),
  ('delete header',          $$delete from public.prescriptions where visit_id = '{v}'$$,
     'ok', 'RX_SEALED', 'ok', 'permission denied', 'permission denied', 'permission denied'),
  ('insert version 1',       $$insert into public.prescriptions (tenant_id, visit_id, patient_id, doctor_id, version) values ('{t}', '{n}', 'c1080000-0000-4000-8000-000000001001', '{actor}', 1)$$,
     'ok', 'PRESCRIPTION_VISIT_SIGNED', 'ok', 'ok', 'PRESCRIPTION_VISIT_SIGNED', 'ok'),
  ('insert version 2',       $$insert into public.prescriptions (tenant_id, visit_id, patient_id, doctor_id, version) values ('{t}', '{n}', 'c1080000-0000-4000-8000-000000001001', '{actor}', 2)$$,
     'ok', 'PRESCRIPTION_VISIT_SIGNED', 'ok', 'PRESCRIPTION_VERSION_FORBIDDEN', 'PRESCRIPTION_VISIT_SIGNED', 'PRESCRIPTION_VERSION_FORBIDDEN');

create temp table res as
select o.op, s.state, k.role, k.kind,
       case k.kind when 'sys' then (case s.state when 'draft' then o.sys_d when 'sealed' then o.sys_s else o.sys_a end)
                   else (case s.state when 'draft' then o.usr_d when 'sealed' then o.usr_s else o.usr_a end) end as expected,
       pg_temp.attempt(k.db_role, k.uid, k.tenant,
         replace(replace(replace(replace(replace(o.sql, '{v}', s.visit::text), '{n}', s.empty::text), '{actor}', k.actor::text), '{t}', k.tenant::text),
                 '{t2}', k.tenant::text)) as outcome
  from ops o cross join states s cross join roles k;

-- 1. The matrix ---------------------------------------------------------------------------------------------------------
select is((select count(*)::int from res), 10 * 3 * 9, 'the matrix ran every operation in every state as every role (10 x 3 x 9)');
select is((select string_agg(op || '/' || state || '/' || role || ' => ' || outcome, '; ') from res where outcome ~ '^error:'), null,
  'no probe failed for a reason other than the seal and the grants (no undefined column, no unique violation)');
select is((select string_agg(op || '/' || role || ' => ' || outcome, '; ') from res
            where state = 'sealed' and op not in ('update updated_at') and outcome ~ '^ok:[1-9]'), null,
  'SEALED: no role changes, deletes or adds a header of a sealed visit (updated_at is the only column left open; the PDF pair is write-once, 000109)');
select is((select string_agg(op || '/' || role || ' => ' || outcome, '; ') from res
            where kind = 'sys' and expected is not null and expected <> 'ok' and outcome !~ ('^denied:(' || expected || ')')), null,
  'service_role and postgres are refused with the guard''s own fixed name where the visit is sealed (RX_SEALED, PRESCRIPTION_VISIT_SIGNED)');
select is((select string_agg(op || '/' || state || '/' || role || ' => ' || outcome, '; ') from res
            where kind = 'sys' and expected = 'ok' and outcome !~ '^ok:1'), null,
  'service_role and postgres still write a draft and an amending visit''s header (the v1 API, the commands) and updated_at of a sealed one');
select is((select string_agg(op || '/' || state || '/' || role || ' => ' || outcome, '; ') from res
            where kind = 'usr' and expected is not null and expected <> 'ok' and outcome !~ ('^denied:(' || expected || ')')), null,
  'owner and doctor: the commands'' columns and DELETE are refused by privilege, a second version by PRESCRIPTION_VERSION_FORBIDDEN, a sealed visit by the guard');
select is((select string_agg(op || '/' || state || '/' || role || ' => ' || outcome, '; ') from res
            where kind = 'usr' and expected = 'ok' and outcome !~ '^ok:1'), null,
  'owner and doctor still write updated_at of any header and a first version 1 on an open visit');
select is((select string_agg(op || '/' || state || '/' || role || ' => ' || outcome, '; ') from res
            where role in ('owner_b', 'anon') and outcome ~ '^ok:[1-9]'), null,
  'another clinic''s owner and anon never change a header in any state');
select is((select string_agg(op || '/' || state || '/' || role || ' => ' || outcome, '; ') from res
            where role in ('admin', 'nurse', 'receptionist') and op in ('update version', 'update status', 'update signed_at', 'update amendment_reason', 'delete header') and outcome ~ '^ok:[1-9]'), null,
  'admin, nurse and receptionist cannot change the commands'' columns or delete a header in any state');

-- 2. The column grant -------------------------------------------------------------------------------------------------------
select is((select array_agg(a.attname::text order by a.attname) from pg_attribute a
            where a.attrelid = 'public.prescriptions'::regclass and a.attnum > 0 and not a.attisdropped
              and has_column_privilege('authenticated', 'public.prescriptions', a.attname, 'UPDATE')),
  array['pdf_sha256', 'pdf_storage_path', 'updated_at'], 'authenticated may UPDATE pdf_storage_path, pdf_sha256 and updated_at only (R-8, narrowed by 000109)');
select is((select array_agg(a.attname::text order by a.attname) from pg_attribute a
            where a.attrelid = 'public.prescriptions'::regclass and a.attnum > 0 and not a.attisdropped
              and has_column_privilege('anon', 'public.prescriptions', a.attname, 'UPDATE')), null, 'anon may UPDATE no column');
select is(array[has_table_privilege('authenticated', 'public.prescriptions', 'DELETE'), has_table_privilege('authenticated', 'public.prescriptions', 'INSERT'),
                has_table_privilege('authenticated', 'public.prescriptions', 'UPDATE')],
  array[false, true, false], 'authenticated holds no table-wide UPDATE and no DELETE on prescriptions; INSERT stays (the first header)');
select has_trigger('public', 'prescriptions', 'prescriptions_seal_guard', 'prescriptions carries the seal guard');
select is(
  (select p.proname || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ',') || ':' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
     || ':' || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
     from pg_proc p where p.oid = 'private.prescriptions_seal_guard()'::regprocedure),
  'prescriptions_seal_guard:false:search_path="":false:false', 'the seal guard is SECURITY INVOKER, search_path pinned, no EXECUTE for the API roles');

-- 3. Sign order ---------------------------------------------------------------------------------------------------------
-- Two active headers on one waiting visit: the sign-off seals both (before it signs the visit) and refuses nothing it did before.
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1080000-0000-4000-8000-000000002021', 'c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000001001',
   'c1080000-0000-4000-8000-000000000102', 'walk_in', 'waiting', 'c1080000-0000-4000-8000-000000000101');
update public.clinical_notes set clinical_notes = 'Synthetic note' where visit_id = 'c1080000-0000-4000-8000-000000002021';
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id, version) values
  ('c1080000-0000-4000-8000-000000003021', 'c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000002021',
   'c1080000-0000-4000-8000-000000001001', 'c1080000-0000-4000-8000-000000000102', 1),
  ('c1080000-0000-4000-8000-000000003022', 'c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000002021',
   'c1080000-0000-4000-8000-000000001001', 'c1080000-0000-4000-8000-000000000102', 2);
-- A call that keeps its effects: the value of the one column p_sql returns, as the user acting in clinic A.
create function pg_temp.call_as(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c1080000-0000-4000-8000-00000000000a')::text, true);
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
-- 000111 (09A-06a, ruling R-A, review A-3): the reopen refuses RX_ARCHIVE_PENDING until the signed version is archived, and only the signer archives it:
-- an object the signer owns at the canonical key (inserted here the way the storage API records an upload, owner_id = the signer) and the pair, set
-- under the signer's own claims. Returns the header id (the UPDATE's RETURNING) or the refusal.
create function pg_temp.archive_rx_as(p_signer uuid, p_rx uuid) returns text language plpgsql as $f$
declare
  v_path text;
begin
  select p.tenant_id::text || '/' || p.visit_id::text || '/rx_v' || p.version::text || '.pdf' into v_path from public.prescriptions p where p.id = p_rx;
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('prescriptions', v_path, p_signer, p_signer::text);
  return pg_temp.call_as(p_signer, format($q$update public.prescriptions set pdf_storage_path = %L, pdf_sha256 = %L where id = %L returning id$q$,
                                          v_path, encode(sha256(convert_to(v_path, 'UTF8')), 'hex'), p_rx));
end
$f$;
insert into public.webhook_subscriptions (id, tenant_id, endpoint_url, event_types, signing_secret, is_active, created_by) values
  ('c1080000-0000-4000-8000-0000000000e1', 'c1080000-0000-4000-8000-00000000000a', 'https://hooks.example.test/c108',
   array['visit.completed', 'prescription.issued'], 'synthetic-signing-secret', true, 'c1080000-0000-4000-8000-000000000101');
select is(pg_temp.call_as('c1080000-0000-4000-8000-000000000102',
  $$select (public.sign_consultation('c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000002021', 'c1080000-0000-4000-8000-0000000c0001') ->> 'sealed_prescriptions')$$),
  '2', 'sign_consultation seals both active headers (the seal now runs before the visit is signed)');
select is((select status || ':' || (signed_at is not null)::text from public.visits where id = 'c1080000-0000-4000-8000-000000002021'), 'completed:true',
  'and signs the visit');
select is((select count(*)::int from public.prescriptions where visit_id = 'c1080000-0000-4000-8000-000000002021' and signed_at is not null), 2,
  'both headers carry a signature');
select is((select array_agg(event_key order by event_key) from public.webhook_delivery_queue
            where tenant_id = 'c1080000-0000-4000-8000-00000000000a' and event_type = 'prescription.issued'
              and event_key like '%c1080000-0000-4000-8000-00000000302_%'),
  array['prescription.issued:c1080000-0000-4000-8000-000000003021:signed', 'prescription.issued:c1080000-0000-4000-8000-000000003022:signed:v2'],
  'sign-off queued one prescription.issued per sealed header; the key of version 1 is unchanged, version 2 carries :v2 (R-10)');
select is((select (payload::jsonb -> 'data' ->> 'version') from public.webhook_delivery_queue
            where event_key = 'prescription.issued:c1080000-0000-4000-8000-000000003022:signed:v2'), '2', 'the payload carries the version');
select is(pg_temp.call_as('c1080000-0000-4000-8000-000000000102',
  $$select (public.sign_consultation('c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000002021', 'c1080000-0000-4000-8000-0000000c0002') ->> 'visit_id')$$),
  'error:P0001:ALREADY_SIGNED', 'a second sign-off is still refused');

-- 4. Reopen and finalize ---------------------------------------------------------------------------------------------------
-- The visit with one header: sign, reopen, finalize, as the doctor, through the commands.
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1080000-0000-4000-8000-000000002031', 'c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000001001',
   'c1080000-0000-4000-8000-000000000102', 'walk_in', 'waiting', 'c1080000-0000-4000-8000-000000000101'),
  ('c1080000-0000-4000-8000-000000002032', 'c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000001001',
   'c1080000-0000-4000-8000-000000000102', 'walk_in', 'waiting', 'c1080000-0000-4000-8000-000000000101');
update public.clinical_notes set clinical_notes = 'Synthetic note' where visit_id in ('c1080000-0000-4000-8000-000000002031', 'c1080000-0000-4000-8000-000000002032');
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id, version) values
  ('c1080000-0000-4000-8000-000000003031', 'c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000002031',
   'c1080000-0000-4000-8000-000000001001', 'c1080000-0000-4000-8000-000000000102', 1);
insert into public.prescription_items (prescription_id, medicine_name, dosage, duration) values
  ('c1080000-0000-4000-8000-000000003031', 'Synthetic medicine', '1-0-1', '5 days');
select is(pg_temp.call_as('c1080000-0000-4000-8000-000000000102',
  $$select (public.sign_consultation('c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000002031', 'c1080000-0000-4000-8000-0000000c0011') ->> 'sealed_prescriptions')$$),
  '1', 'visit 31 is signed with one header');
-- A pgTAP file is one transaction, so now() is the same instant at sign-off and at finalize and the new signature would equal the old one (in
-- production they are separate transactions). The sign-off time of visit 31 is moved back a day with the guard off (owner DDL in this rolled-back
-- transaction), as if it had been signed yesterday; the reopen then snapshots that time.
alter table public.visits disable trigger visits_integrity_guard;
update public.visits set signed_at = now() - interval '1 day' where id = 'c1080000-0000-4000-8000-000000002031';
alter table public.visits enable trigger visits_integrity_guard;
do $do$ begin
  perform pg_temp.archive_rx_as('c1080000-0000-4000-8000-000000000102', 'c1080000-0000-4000-8000-000000003031');
end $do$;
select is(pg_temp.call_as('c1080000-0000-4000-8000-000000000102',
  $$select (public.reopen_visit_for_amendment('c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000002031', 'Synthetic amendment reason for the test', 'c1080000-0000-4000-8000-0000000c0012') ->> 'revision_number')$$),
  '1', 'reopened with revision 1');
select is(pg_temp.call_as('c1080000-0000-4000-8000-000000000102',
  $$select (public.finalize_visit_amendment('c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000002031', 'c1080000-0000-4000-8000-0000000c0013') ->> 'version')$$),
  '2', 'finalize gives version 2 (the header row is updated while the visit is open, not sealed)');
select is((select version::text || ':' || (signed_at is not null)::text || ':' || amendment_reason from public.prescriptions where id = 'c1080000-0000-4000-8000-000000003031'),
  '2:true:Synthetic amendment reason for the test', 'the same header row holds version 2, signed, with the amendment reason');
select is((select array_agg(event_key order by event_key) from public.webhook_delivery_queue where event_key like 'prescription.issued:c1080000-0000-4000-8000-000000003031:%'),
  array['prescription.issued:c1080000-0000-4000-8000-000000003031:signed', 'prescription.issued:c1080000-0000-4000-8000-000000003031:signed:v2'],
  'one prescription.issued per version: ...:signed, then ...:signed:v2 (R-10)');
select is((select payload::jsonb -> 'data' ->> 'version' from public.webhook_delivery_queue
            where event_key = 'prescription.issued:c1080000-0000-4000-8000-000000003031:signed:v2'), '2', 'the re-issued event carries version 2');
select is(pg_temp.call_as('c1080000-0000-4000-8000-000000000102',
  $$select (public.finalize_visit_amendment('c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000002031', 'c1080000-0000-4000-8000-0000000c0013') ->> 'replayed')$$),
  'true', 'a replay of the finalize returns the stored result');
select is((select count(*)::int from public.webhook_delivery_queue where event_key like 'prescription.issued:c1080000-0000-4000-8000-000000003031:%'), 2,
  'and queues nothing more');
select is((select count(*)::int from public.visit_revisions where visit_id = 'c1080000-0000-4000-8000-000000002031'), 1, 'one revision row holds the signed version');
-- A visit with no header: sign, reopen, finalize, and no event for it.
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id, version, status) values
  ('c1080000-0000-4000-8000-000000003032', 'c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000002032',
   'c1080000-0000-4000-8000-000000001001', 'c1080000-0000-4000-8000-000000000102', 1, 'cancelled');
select is(pg_temp.call_as('c1080000-0000-4000-8000-000000000102',
  $$select (public.sign_consultation('c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000002032', 'c1080000-0000-4000-8000-0000000c0021') ->> 'sealed_prescriptions')$$),
  '0', 'a visit whose only header is cancelled seals nothing');
alter table public.visits disable trigger visits_integrity_guard;
update public.visits set signed_at = now() - interval '1 day' where id = 'c1080000-0000-4000-8000-000000002032';
alter table public.visits enable trigger visits_integrity_guard;
do $do$ begin
  perform pg_temp.call_as('c1080000-0000-4000-8000-000000000102',
    $q$select (public.reopen_visit_for_amendment('c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000002032', 'Synthetic amendment reason for the test', 'c1080000-0000-4000-8000-0000000c0022') ->> 'revision_number')$q$);
end $do$;
select is(pg_temp.call_as('c1080000-0000-4000-8000-000000000102',
  $$select (public.finalize_visit_amendment('c1080000-0000-4000-8000-00000000000a', 'c1080000-0000-4000-8000-000000002032', 'c1080000-0000-4000-8000-0000000c0023') ->> 'version')$$),
  '2', 'finalize still works when the latest header is not active (it is re-versioned)');
select is((select count(*)::int from public.webhook_delivery_queue where event_key like 'prescription.issued:c1080000-0000-4000-8000-000000003032:%'), 0,
  'and queues no event for a header that is not active');

select * from finish();
rollback;
