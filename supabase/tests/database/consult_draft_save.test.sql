-- consult_draft_save.test.sql — V2-09b 09B-01 (R-2, R-3; migration 000112_consult_draft_save).
--
-- 1. The version: clinical_notes.draft_version (default 0, CHECK >= 0) is raised by exactly 1 on every committed UPDATE, as authenticated (its
--    one column grant), as the service role and as the table owner, and a caller-supplied value is ignored; the trigger fires after the seal
--    guard, so a refused write on a sealed row keeps its version.
-- 2. The grants (the contract after the writer inventory): UPDATE on clinical_notes for authenticated is (vitals) only; INSERT, UPDATE and DELETE
--    on follow_ups are revoked; the service role keeps its own. One follow-up per visit (partial unique index).
-- 3. The command public.save_consultation_draft: catalog (definer, pinned settings, EXECUTE for authenticated only), the happy path with its audit
--    row, only the keys present are written, a stale version is DRAFT_CONFLICT with the row unchanged, replay and IDEMPOTENCY_MISMATCH, the
--    follow-up upsert, change and delete, a waiting visit is started once, the role matrix, another clinic, sealed / unsigned completed /
--    cancelled are DRAFT_LOCKED with nothing written, an amending visit is admitted, vitals attribution, input validation, a vitals write by the
--    nurse makes the doctor's stale save conflict, and all-or-nothing under a fault after the notes write.
-- Every call runs under the real principal (set local role, JWT claims, the x-clinicos-tenant header). The file rolls back. Synthetic data only.
begin;
select plan(60);

-- Fixtures ----------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1120000-0000-4000-8000-000000000101', 'c112-owner-a@example.test'),
  ('c1120000-0000-4000-8000-000000000102', 'c112-doctor-a@example.test'),
  ('c1120000-0000-4000-8000-000000000103', 'c112-admin-a@example.test'),
  ('c1120000-0000-4000-8000-000000000104', 'c112-nurse-a@example.test'),
  ('c1120000-0000-4000-8000-000000000105', 'c112-receptionist-a@example.test'),
  ('c1120000-0000-4000-8000-000000000201', 'c112-owner-b@example.test');
insert into public.tenants (id, name) values
  ('c1120000-0000-4000-8000-00000000000a', 'Synthetic 09B-01 Clinic A'),
  ('c1120000-0000-4000-8000-00000000000b', 'Synthetic 09B-01 Clinic B');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1120000-0000-4000-8000-00000000000a', 'c1120000-0000-4000-8000-00000000000b');
insert into public.memberships (user_id, tenant_id, role) values
  ('c1120000-0000-4000-8000-000000000101', 'c1120000-0000-4000-8000-00000000000a', 'owner'),
  ('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1120000-0000-4000-8000-000000000103', 'c1120000-0000-4000-8000-00000000000a', 'admin'),
  ('c1120000-0000-4000-8000-000000000104', 'c1120000-0000-4000-8000-00000000000a', 'nurse'),
  ('c1120000-0000-4000-8000-000000000105', 'c1120000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c1120000-0000-4000-8000-000000000201', 'c1120000-0000-4000-8000-00000000000b', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1120000-0000-4000-8000-000000001001', 'c1120000-0000-4000-8000-00000000000a', 'Synthetic Draft Patient', '+919000011201',
   'c1120000-0000-4000-8000-000000000101');

-- D 2001 draft (in consultation), W 2002 waiting, S 2003 sealed (signed), C 2004 cancelled, U 2005 completed unsigned, M 2006 amending (signed, reopened),
-- F 2007 in consultation (the fault visit), N 2008 in consultation (the nurse's vitals).
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1120000-0000-4000-8000-000000002001', 'c1120000-0000-4000-8000-00000000000a', 'c1120000-0000-4000-8000-000000001001', 'c1120000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1120000-0000-4000-8000-000000000101'),
  ('c1120000-0000-4000-8000-000000002002', 'c1120000-0000-4000-8000-00000000000a', 'c1120000-0000-4000-8000-000000001001', 'c1120000-0000-4000-8000-000000000102', 'walk_in', 'waiting', 'c1120000-0000-4000-8000-000000000101'),
  ('c1120000-0000-4000-8000-000000002003', 'c1120000-0000-4000-8000-00000000000a', 'c1120000-0000-4000-8000-000000001001', 'c1120000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1120000-0000-4000-8000-000000000101'),
  ('c1120000-0000-4000-8000-000000002004', 'c1120000-0000-4000-8000-00000000000a', 'c1120000-0000-4000-8000-000000001001', 'c1120000-0000-4000-8000-000000000102', 'walk_in', 'cancelled', 'c1120000-0000-4000-8000-000000000101'),
  ('c1120000-0000-4000-8000-000000002005', 'c1120000-0000-4000-8000-00000000000a', 'c1120000-0000-4000-8000-000000001001', 'c1120000-0000-4000-8000-000000000102', 'walk_in', 'completed', 'c1120000-0000-4000-8000-000000000101'),
  ('c1120000-0000-4000-8000-000000002006', 'c1120000-0000-4000-8000-00000000000a', 'c1120000-0000-4000-8000-000000001001', 'c1120000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1120000-0000-4000-8000-000000000101'),
  ('c1120000-0000-4000-8000-000000002007', 'c1120000-0000-4000-8000-00000000000a', 'c1120000-0000-4000-8000-000000001001', 'c1120000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1120000-0000-4000-8000-000000000101'),
  ('c1120000-0000-4000-8000-000000002008', 'c1120000-0000-4000-8000-00000000000a', 'c1120000-0000-4000-8000-000000001001', 'c1120000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1120000-0000-4000-8000-000000000101');
-- A visit of clinic B (for the cross-clinic probe).
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1120000-0000-4000-8000-000000001002', 'c1120000-0000-4000-8000-00000000000b', 'Synthetic Draft Patient B', '+919000011202',
   'c1120000-0000-4000-8000-000000000201');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1120000-0000-4000-8000-000000003001', 'c1120000-0000-4000-8000-00000000000b', 'c1120000-0000-4000-8000-000000001002', 'c1120000-0000-4000-8000-000000000201', 'walk_in', 'in_consultation', 'c1120000-0000-4000-8000-000000000201');

-- The signature and the reopen are written under the doctor's own session, as the commands do (09A R-15).
create function pg_temp.as_actor(p_user uuid, p_sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c1120000-0000-4000-8000-00000000000a')::text, true);
  execute p_sql;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end
$f$;
update public.clinical_notes set clinical_notes = 'Synthetic signed note' where visit_id in
  ('c1120000-0000-4000-8000-000000002003', 'c1120000-0000-4000-8000-000000002006');
do $do$
declare
  d constant uuid := 'c1120000-0000-4000-8000-000000000102';
begin
  perform pg_temp.as_actor(d, format($q$update public.visits set status = 'completed', signed_at = now(), signed_by = %L
    where id in ('c1120000-0000-4000-8000-000000002003', 'c1120000-0000-4000-8000-000000002006')$q$, d));
  perform pg_temp.as_actor(d, format($q$insert into public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason)
    values ('c1120000-0000-4000-8000-00000000000a', 'c1120000-0000-4000-8000-000000002006', %L, 'Synthetic amendment reason')$q$, d));
  perform pg_temp.as_actor(d, $q$update public.visits set status = 'in_consultation' where id = 'c1120000-0000-4000-8000-000000002006'$q$);
end
$do$;

-- Runs one statement under a real principal and returns 'ok:<result>' or 'error:<sqlstate>:<message>'; the work is kept when it succeeds and undone when it fails.
create function pg_temp.act(p_db_role text, p_user uuid, p_tenant uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_res text;
begin
  begin
    perform set_config('request.jwt.claims', case when p_user is null then json_build_object('role', p_db_role)::text
                                                  else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
    perform set_config('request.headers', json_build_object('x-clinicos-tenant', p_tenant)::text, true);
    if p_db_role <> 'postgres' then
      execute 'set local role ' || quote_ident(p_db_role);
    end if;
    execute p_sql into v_res;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    return 'ok:' || coalesce(v_res, '');
  exception when others then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.headers', '', true);
    return 'error:' || sqlstate || ':' || sqlerrm;
  end;
end
$f$;
-- The command as one user of clinic A: save(visit, expected version, patch, request id).
create function pg_temp.save(p_user uuid, p_visit uuid, p_version int, p_patch jsonb, p_req uuid default gen_random_uuid()) returns text language sql as $f$
  select pg_temp.act('authenticated', p_user, 'c1120000-0000-4000-8000-00000000000a',
    format('select public.save_consultation_draft(%L, %L, %s, %L::jsonb, %L)::text', 'c1120000-0000-4000-8000-00000000000a', p_visit, p_version, p_patch, p_req))
$f$;
create function pg_temp.version_of(p_visit uuid) returns int language sql as $f$
  select draft_version from public.clinical_notes where visit_id = p_visit
$f$;
create function pg_temp.jres(p_out text) returns jsonb language sql as $f$
  select case when p_out like 'ok:%' then substr(p_out, 4)::jsonb else null end
$f$;

-- 1. The column and the trigger -------------------------------------------------------------------------------------------------
select is((select column_default || ':' || is_nullable from information_schema.columns
            where table_schema = 'public' and table_name = 'clinical_notes' and column_name = 'draft_version'), '0:NO',
  'draft_version: integer NOT NULL DEFAULT 0');
select is((select pg_get_constraintdef(oid) from pg_constraint where conname = 'clinical_notes_draft_version_check'), 'CHECK ((draft_version >= 0))',
  'a CHECK keeps the version at 0 or more');
select is((select prosecdef::text || ':' || (proconfig @> array['search_path=""'])::text from pg_proc where oid = 'private.clinical_notes_version_bump()'::regprocedure), 'false:true',
  'the bump trigger function is INVOKER with search_path pinned');
select is((select string_agg(t.tgname, ',' order by t.tgname) from pg_trigger t where t.tgrelid = 'public.clinical_notes'::regclass
            and t.tgname in ('clinical_notes_guard', 'clinical_notes_version_bump') and not t.tgisinternal),
  'clinical_notes_guard,clinical_notes_version_bump', 'both BEFORE UPDATE triggers exist; the bump sorts after the guard');

-- 2. The bump on every path ----------------------------------------------------------------------------------------------------
select is(pg_temp.version_of('c1120000-0000-4000-8000-000000002001'), 0, 'a new row starts at version 0');
select is(pg_temp.act('postgres', null, 'c1120000-0000-4000-8000-00000000000a', $$update public.clinical_notes set clinical_notes = 'by owner' where visit_id = 'c1120000-0000-4000-8000-000000002001' returning draft_version::text$$),
  'ok:1', 'the table owner''s update raises it by one');
select is(pg_temp.act('service_role', null, 'c1120000-0000-4000-8000-00000000000a', $$update public.clinical_notes set clinical_notes = 'by service' where visit_id = 'c1120000-0000-4000-8000-000000002001' returning draft_version::text$$),
  'ok:2', 'the service role''s update raises it by one');
select is(pg_temp.act('authenticated', 'c1120000-0000-4000-8000-000000000104', 'c1120000-0000-4000-8000-00000000000a', $$update public.clinical_notes set vitals = '{"pulse": 80}'::jsonb where visit_id = 'c1120000-0000-4000-8000-000000002001' returning draft_version::text$$),
  'ok:3', 'the nurse''s vitals update (authenticated, the one column grant) raises it by one');
select is(pg_temp.act('postgres', null, 'c1120000-0000-4000-8000-00000000000a', $$update public.clinical_notes set draft_version = 99 where visit_id = 'c1120000-0000-4000-8000-000000002001' returning draft_version::text$$),
  'ok:4', 'a caller-supplied value is ignored: 99 becomes the old value + 1');
select is(pg_temp.act('postgres', null, 'c1120000-0000-4000-8000-00000000000a', $$update public.clinical_notes set clinical_notes = 'rewrite' where visit_id = 'c1120000-0000-4000-8000-000000002003' returning 'x'$$) ~ 'CLINICAL_NOTES_VISIT_SIGNED', true,
  'a sealed row is refused by the seal guard first, for the owner too');
select is(pg_temp.version_of('c1120000-0000-4000-8000-000000002003'), 1, 'and the refused write did not bump the sealed row''s version (1 is the fixture''s own note write before the sign-off)');

-- 3. The grants -----------------------------------------------------------------------------------------------------------------
select is((select has_column_privilege('authenticated', 'public.clinical_notes', 'vitals', 'UPDATE')::text || ','
         || has_column_privilege('authenticated', 'public.clinical_notes', 'clinical_notes', 'UPDATE')::text || ','
         || has_column_privilege('authenticated', 'public.clinical_notes', 'draft_version', 'UPDATE')::text || ','
         || has_table_privilege('authenticated', 'public.clinical_notes', 'UPDATE')::text), 'true,false,false,false',
  'authenticated may update only the vitals column of clinical_notes (not the content, not the version, not the whole table)');
select is((select has_table_privilege('service_role', 'public.clinical_notes', 'UPDATE')::text), 'true', 'the service role keeps its UPDATE');
select is((select has_table_privilege('authenticated', 'public.follow_ups', 'SELECT')::text || ','
         || has_table_privilege('authenticated', 'public.follow_ups', 'INSERT')::text || ','
         || has_table_privilege('authenticated', 'public.follow_ups', 'UPDATE')::text || ','
         || has_table_privilege('authenticated', 'public.follow_ups', 'DELETE')::text), 'true,false,false,false',
  'follow_ups: authenticated reads, and INSERT, UPDATE, DELETE are revoked');
select is((select has_table_privilege('service_role', 'public.follow_ups', 'INSERT')::text), 'true', 'the service role keeps its follow_ups privileges');
select is((select (pg_get_indexdef(i.indexrelid) ~ 'UNIQUE.*\(tenant_id, visit_id\) WHERE \(visit_id IS NOT NULL\)')::text
            from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = 'follow_ups_one_per_visit'), 'true',
  'one follow-up per visit: a partial unique index on (tenant_id, visit_id) where visit_id is not null');

-- 4. The command: catalog ---------------------------------------------------------------------------------------------------------
select is((select prosecdef::text || ':' || (proconfig @> array['search_path=""'])::text || ':' || (proconfig @> array['lock_timeout=2s'])::text
            from pg_proc where oid = 'public.save_consultation_draft(uuid, uuid, integer, jsonb, uuid)'::regprocedure), 'true:true:true',
  'save_consultation_draft is SECURITY DEFINER with search_path and lock_timeout pinned');
select is((select has_function_privilege('authenticated', 'public.save_consultation_draft(uuid, uuid, integer, jsonb, uuid)', 'EXECUTE')::text || ','
         || has_function_privilege('anon', 'public.save_consultation_draft(uuid, uuid, integer, jsonb, uuid)', 'EXECUTE')::text || ','
         || has_function_privilege('service_role', 'public.save_consultation_draft(uuid, uuid, integer, jsonb, uuid)', 'EXECUTE')::text),
  'true,false,false', 'EXECUTE for authenticated only (not anon, not service_role)');
select is((select has_function_privilege('authenticated', 'private.step_start_consultation(uuid, uuid)', 'EXECUTE')::text || ','
         || has_function_privilege('service_role', 'private.step_start_consultation(uuid, uuid)', 'EXECUTE')::text), 'false,false',
  'the shared start step has no API grant');

-- 5. The command: behaviour -------------------------------------------------------------------------------------------------------
-- D is at version 4 after section 2; start from a clean visit for the version arithmetic.
select is(pg_temp.jres(pg_temp.save('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-000000002001', 4, '{"clinical_notes": "first note", "advice": ["Steam inhalation"]}'::jsonb))
  - 'replayed', '{"visit_id": "c1120000-0000-4000-8000-000000002001", "draft_version": 5, "started": false}'::jsonb,
  'the doctor saves the note and the advice at the version they read: version + 1, nothing started');
select is((select clinical_notes || '|' || advice[1] from public.clinical_notes where visit_id = 'c1120000-0000-4000-8000-000000002001'), 'first note|Steam inhalation', 'the keys are written');
select is((select metadata from public.audit_logs where tenant_id = 'c1120000-0000-4000-8000-00000000000a' and action = 'consultation.draft_save'
            and entity_id = 'c1120000-0000-4000-8000-000000002001' order by id desc limit 1),
  '{"fields_changed": ["clinical_notes", "advice"], "draft_version": 5, "conflict_overwrite": false}'::jsonb, 'one audit row: the fields, the new version and the overwrite flag (no content)');
select is(pg_temp.save('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-000000002001', 4, '{"clinical_notes": "stale write"}'::jsonb),
  'error:P0001:DRAFT_CONFLICT', 'a save made against a stale version is DRAFT_CONFLICT');
select is((select clinical_notes || '|' || draft_version from public.clinical_notes where visit_id = 'c1120000-0000-4000-8000-000000002001'), 'first note|5',
  'and the row is unchanged');
select is(pg_temp.jres(pg_temp.save('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-000000002001', 5, '{"investigations_advised": ["CBC"]}'::jsonb))->>'draft_version', '6',
  'only the keys present are written: the investigations change and the note and the advice stay');
select is((select clinical_notes || '|' || advice[1] || '|' || investigations_advised[1] from public.clinical_notes where visit_id = 'c1120000-0000-4000-8000-000000002001'),
  'first note|Steam inhalation|CBC', 'the note and the advice are untouched by a patch that does not name them');

-- replay and mismatch
select ok(set_config('c112.req', gen_random_uuid()::text, true) is not null, 'fixture: a request id for the replay cases');
select is(pg_temp.jres(pg_temp.save('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-000000002001', 6, '{"clinical_notes": "replayed"}'::jsonb, current_setting('c112.req')::uuid))->>'draft_version', '7',
  'a fresh request id saves (version 7)');
select is(pg_temp.jres(pg_temp.save('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-000000002001', 6, '{"clinical_notes": "replayed"}'::jsonb, current_setting('c112.req')::uuid)),
  '{"started": false, "visit_id": "c1120000-0000-4000-8000-000000002001", "replayed": true, "draft_version": 7}'::jsonb,
  'the same id with the same input replays the first result and changes nothing');
select is((select draft_version from public.clinical_notes where visit_id = 'c1120000-0000-4000-8000-000000002001') || '|' ||
          (select count(*) from public.audit_logs where tenant_id = 'c1120000-0000-4000-8000-00000000000a' and action = 'consultation.draft_save' and entity_id = 'c1120000-0000-4000-8000-000000002001'),
  '7|3', 'the replay wrote no second version and no second audit row (three saves, three rows)');
select is(pg_temp.save('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-000000002001', 6, '{"clinical_notes": "another payload"}'::jsonb, current_setting('c112.req')::uuid),
  'error:P0001:IDEMPOTENCY_MISMATCH', 'the same id with another patch is IDEMPOTENCY_MISMATCH');
select is(pg_temp.save('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-000000002001', 5, '{"clinical_notes": "replayed"}'::jsonb, current_setting('c112.req')::uuid),
  'error:P0001:IDEMPOTENCY_MISMATCH', 'the same id with another expected version is IDEMPOTENCY_MISMATCH');

-- follow-up upsert, change and delete (09B-06a, S-4: a follow-up falls from the clinic's today to +366 days, so the dates are relative to it)
do $$
begin
  perform set_config('c112.d1', to_char(public.tenant_local_date('c1120000-0000-4000-8000-00000000000a', now()) + 20, 'YYYY-MM-DD'), true);
  perform set_config('c112.d2', to_char(public.tenant_local_date('c1120000-0000-4000-8000-00000000000a', now()) + 30, 'YYYY-MM-DD'), true);
end
$$;
select is(pg_temp.jres(pg_temp.save('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-000000002001', 7, format('{"follow_up": {"interval": "1_week", "follow_up_date": "%s", "notes": "review"}}', current_setting('c112.d1'))::jsonb))->>'draft_version', '8',
  'the doctor sets a follow-up');
select ok(pg_temp.save('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-000000002001', 8, format('{"follow_up": {"follow_up_date": "%s"}}', current_setting('c112.d2'))::jsonb) like 'ok:%', 'the doctor changes the follow-up');
select is((select count(*)::text || '|' || min(follow_up_date)::text || '|' || coalesce(min(notes), 'null') || '|' || min(doctor_id::text) || '|' || min(status) from public.follow_ups
            where visit_id = 'c1120000-0000-4000-8000-000000002001'),
  '1|' || current_setting('c112.d2') || '|null|c1120000-0000-4000-8000-000000000102|scheduled', 'a second follow-up patch changes the one row (still one row per visit)');
select ok(pg_temp.save('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-000000002001', 9, '{"follow_up": null}'::jsonb) like 'ok:%', 'the doctor clears the follow-up');
select is((select count(*) from public.follow_ups where visit_id = 'c1120000-0000-4000-8000-000000002001'), 0::bigint, 'follow_up null deletes it');

-- a waiting visit is started once
select is(pg_temp.jres(pg_temp.save('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-000000002002', 0, '{"clinical_notes": "note on a waiting visit"}'::jsonb))->>'started', 'true',
  'a waiting visit is started by its first draft save (the doctor also holds appointments:edit)');
select is((select v.status || '|' || (select count(*) from public.audit_logs a where a.entity_id = v.id and a.action = 'visit.consultation_start') from public.visits v
            where v.id = 'c1120000-0000-4000-8000-000000002002'), 'in_consultation|1', 'status in_consultation with one visit.consultation_start audit row');
select is(pg_temp.jres(pg_temp.save('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-000000002002', 1, '{"clinical_notes": "second"}'::jsonb))->>'started', 'false',
  'a later save starts nothing and writes no second start row');
select is((select count(*) from public.audit_logs where entity_id = 'c1120000-0000-4000-8000-000000002002' and action = 'visit.consultation_start'), 1::bigint,
  'still exactly one start audit row');

-- vitals attribution
select ok(pg_temp.save('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-000000002001', 10, '{"vitals": {"pulse": 80, "recorded_by": "c1120000-0000-4000-8000-000000000999"}}'::jsonb) like 'ok:%',
  'the doctor saves vitals naming a forged recorder (version 11)');
select is((select vitals ->> 'recorded_by' from public.clinical_notes where visit_id = 'c1120000-0000-4000-8000-000000002001'), 'c1120000-0000-4000-8000-000000000102',
  'changed measurements record the actor, never a caller-chosen recorder');
select ok(pg_temp.act('authenticated', 'c1120000-0000-4000-8000-000000000104', 'c1120000-0000-4000-8000-00000000000a',
  $$update public.clinical_notes set vitals = '{"pulse": 90, "recorded_by": "c1120000-0000-4000-8000-000000000104"}'::jsonb where visit_id = 'c1120000-0000-4000-8000-000000002001' returning 'x'$$) like 'ok:%',
  'the nurse records vitals directly (version 12)');
select is(pg_temp.save('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-000000002001', 11, '{"clinical_notes": "written before the nurse''s vitals"}'::jsonb), 'error:P0001:DRAFT_CONFLICT',
  'the nurse''s vitals write raised the version, so a doctor''s save made before it conflicts at the database');
select ok(pg_temp.save('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-000000002001', 12, '{"vitals": {"pulse": 90, "temperature": null}}'::jsonb) like 'ok:%',
  'the doctor then saves the same measurements at the new version');
select is((select vitals ->> 'recorded_by' from public.clinical_notes where visit_id = 'c1120000-0000-4000-8000-000000002001'), 'c1120000-0000-4000-8000-000000000104',
  'unchanged measurements keep the nurse as the recorder (a doctor''s save does not re-attribute)');

-- roles and clinics
select is(pg_temp.jres(pg_temp.save('c1120000-0000-4000-8000-000000000101', 'c1120000-0000-4000-8000-000000002007', 0, '{"advice": ["Rest"]}'::jsonb))->>'draft_version', '1', 'the owner may save');
select is((select string_agg(r.n || '=' || pg_temp.save(r.u, 'c1120000-0000-4000-8000-000000002007', 1, '{"advice": ["Rest more"]}'::jsonb), ',' order by r.n)
             from (values ('admin', 'c1120000-0000-4000-8000-000000000103'::uuid), ('nurse', 'c1120000-0000-4000-8000-000000000104'::uuid),
                          ('receptionist', 'c1120000-0000-4000-8000-000000000105'::uuid)) r(n, u)),
  'admin=error:42501:FORBIDDEN,nurse=error:42501:FORBIDDEN,receptionist=error:42501:FORBIDDEN', 'admin, nurse and receptionist are refused (consultations:edit)');
select is(pg_temp.act('authenticated', 'c1120000-0000-4000-8000-000000000201', 'c1120000-0000-4000-8000-00000000000b',
    format('select public.save_consultation_draft(%L, %L, 0, %L::jsonb, gen_random_uuid())::text', 'c1120000-0000-4000-8000-00000000000a', 'c1120000-0000-4000-8000-000000002007', '{"advice": ["x"]}')),
  'error:P0002:VISIT_NOT_FOUND', 'another clinic''s owner naming clinic A is not found');
select is(pg_temp.act('authenticated', 'c1120000-0000-4000-8000-000000000201', 'c1120000-0000-4000-8000-00000000000b',
    format('select public.save_consultation_draft(%L, %L, 0, %L::jsonb, gen_random_uuid())::text', 'c1120000-0000-4000-8000-00000000000b', 'c1120000-0000-4000-8000-000000002007', '{"advice": ["x"]}')),
  'error:P0002:VISIT_NOT_FOUND', 'and clinic A''s visit named inside clinic B is not found either');
select is((select advice[1] from public.clinical_notes where visit_id = 'c1120000-0000-4000-8000-000000002007'), 'Rest', 'no refused call changed clinic A''s row');

-- sealed, unsigned completed, cancelled: DRAFT_LOCKED, nothing written; amending is admitted
select is((select string_agg(r.n || '=' || pg_temp.save('c1120000-0000-4000-8000-000000000102', r.v, 0, format('{"clinical_notes": "rewrite", "follow_up": {"follow_up_date": "%s"}}', current_setting('c112.d1'))::jsonb), ',' order by r.n)
             from (values ('sealed', 'c1120000-0000-4000-8000-000000002003'::uuid), ('completed', 'c1120000-0000-4000-8000-000000002005'::uuid),
                          ('cancelled', 'c1120000-0000-4000-8000-000000002004'::uuid)) r(n, v)),
  'cancelled=error:P0001:DRAFT_LOCKED,completed=error:P0001:DRAFT_LOCKED,sealed=error:P0001:DRAFT_LOCKED', 'sealed, unsigned completed and cancelled visits are DRAFT_LOCKED');
select is((select (select clinical_notes from public.clinical_notes where visit_id = 'c1120000-0000-4000-8000-000000002003') || '|'
          || (select count(*) from public.follow_ups where visit_id in ('c1120000-0000-4000-8000-000000002003', 'c1120000-0000-4000-8000-000000002004', 'c1120000-0000-4000-8000-000000002005'))), 'Synthetic signed note|0',
  'with the signed note and the follow-ups unchanged');
select is(pg_temp.jres(pg_temp.save('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-000000002006', 1, '{"clinical_notes": "amended note"}'::jsonb))->>'draft_version', '2',
  'a visit reopened for amendment takes the draft');

-- input validation
select is((select string_agg(r.n || '=' || pg_temp.save('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-000000002008', 0, r.p), ',' order by r.n)
             from (values ('empty', '{}'::jsonb), ('unknown', '{"status": "completed"}'::jsonb), ('notes_type', '{"clinical_notes": 5}'::jsonb),
                          ('specialty', '{"specialty": "cardiology"}'::jsonb), ('follow_date', '{"follow_up": {"follow_up_date": "2031-02-31"}}'::jsonb),
                          ('follow_key', '{"follow_up": {"follow_up_date": "2031-02-01", "status": "attended"}}'::jsonb), ('vitals_key', '{"vitals": {"hacked": 1}}'::jsonb),
                          ('provenance', '{"provenance": {"ai_assisted": true, "x": 1}}'::jsonb), ('list_type', '{"advice": [1]}'::jsonb),
                          ('array_patch', '[1]'::jsonb), ('big', jsonb_build_object('clinical_notes', repeat('x', 270000)))) r(n, p)),
  'array_patch=error:P0001:INPUT_INVALID,big=error:P0001:INPUT_INVALID,empty=error:P0001:INPUT_INVALID,follow_date=error:P0001:INPUT_INVALID,follow_key=error:P0001:INPUT_INVALID,list_type=error:P0001:INPUT_INVALID,notes_type=error:P0001:INPUT_INVALID,provenance=error:P0001:INPUT_INVALID,specialty=error:P0001:INPUT_INVALID,unknown=error:P0001:INPUT_INVALID,vitals_key=error:P0001:INPUT_INVALID',
  'an empty patch, an unknown key, a wrong type, a bad specialty, a bad date, an unknown follow-up or vitals key, a bad provenance key, a non-string list item, a non-object patch and a patch over 256 kB are INPUT_INVALID');
select is(pg_temp.jres(pg_temp.save('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-000000002008', 0,
    '{"provenance": {"ai_assisted": true, "ai_sections_used": ["notes"]}, "specialty": "dental", "conflict_overwrite": true}'::jsonb))->>'draft_version', '1',
  'a valid provenance, a specialty change and the overwrite flag are accepted');
select is((select v.specialty || '|' || (v.metadata ->> 'ai_assisted') || '|' || (select a.metadata ->> 'conflict_overwrite' from public.audit_logs a
            where a.entity_id = v.id and a.action = 'consultation.draft_save' order by a.id desc limit 1) from public.visits v where v.id = 'c1120000-0000-4000-8000-000000002008'),
  'dental|true|true', 'the specialty and the provenance are written to the visit, and the overwrite is audited');

-- all or nothing: a fault after the notes write undoes the whole save
create function pg_temp.fault() returns trigger language plpgsql as $f$ begin raise exception 'SPIKE_FAULT' using errcode = 'XX000'; end $f$;
create trigger c112_fault before insert on public.follow_ups for each row
  when (new.visit_id = 'c1120000-0000-4000-8000-000000002008') execute function pg_temp.fault();
select is(pg_temp.save('c1120000-0000-4000-8000-000000000102', 'c1120000-0000-4000-8000-000000002008', 1, format('{"clinical_notes": "must not persist", "follow_up": {"follow_up_date": "%s"}}', current_setting('c112.d2'))::jsonb),
  'error:XX000:SPIKE_FAULT', 'a fault in the follow-up write fails the save');
select is((select coalesce(clinical_notes, 'null') || '|' || draft_version || '|' || (select count(*) from public.follow_ups where visit_id = 'c1120000-0000-4000-8000-000000002008') || '|'
          || (select count(*) from public.audit_logs where entity_id = 'c1120000-0000-4000-8000-000000002008' and action = 'consultation.draft_save')
          from public.clinical_notes where visit_id = 'c1120000-0000-4000-8000-000000002008'),
  'null|1|0|1', 'and nothing of it persists: the notes, the version, the follow-up and the audit row are as before the failed call');

select * from finish();
rollback;
