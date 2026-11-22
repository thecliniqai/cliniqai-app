-- clinical_seal.test.sql — V2-09a 09A-01 (R-2 to R-7; migration 000107). After sign-off the record cannot change for ANY writer.
--
-- 1. Matrix: every role x operation x state. Roles: owner, doctor, admin, nurse, receptionist of clinic A, owner of clinic B, anon,
--    service_role, postgres. Operations: the visit (signature, re-sign, status, specialty, date, location, reason, creator, delete), the
--    clinical note (update, delete), diagnoses, Rx items and follow-ups (insert, update, delete), amendment revisions (update, delete).
--    States: draft (open consultation), sealed (signed and completed, with an earlier amendment behind it), amending (signed and reopened).
--    Every probe runs in a subtransaction that is rolled back, so each one sees the same rows. Expected: sealed refuses every role on every
--    path (the privileged roles with the guard's own fixed name), draft and amending admit content writes for the writers RLS admits and
--    still refuse signature, status, creator and revision changes; clinic B and anon never change anything.
-- 2. A throwaway SECURITY DEFINER function that rewrites a signed note is refused as the doctor and as service_role (R-3 for definer code).
-- 3. R-4a, R-7: a tenant purge cascades through a sealed visit (as postgres and as service_role); a system-path DELETE of a sealed visit or of an
--    amendment row with the clinic still present is refused.
-- 4. R-4c: a system path may INSERT an already-signed visit; child rows added to it are refused.
-- 5. Objects: the three new triggers, INVOKER functions with search_path pinned and no EXECUTE for the API roles.
-- Synthetic data only; the file rolls back.
begin;
-- 000103 (08-04a): UPDATE on public.visits is narrowed for authenticated to specialty, metadata and updated_at. This file proves the guards
-- (defence in depth, independent of the column grant), so the grant is widened for this transaction only.
grant update on table public.visits to authenticated;
-- 000112 (09B-01): follow_ups_one_per_visit, so the follow-up insert probe is the upsert the draft command makes (the BEFORE INSERT seal guard still fires first).
-- 000112 (09B-01, R-3): UPDATE on public.clinical_notes is narrowed for authenticated to (vitals) and INSERT, UPDATE and DELETE on public.follow_ups are revoked
-- (save_consultation_draft is the writer). This file proves the guards, triggers and policies themselves (defence in depth, independent of the grants), so the
-- grants are widened for this transaction only; the narrowing is proven in consult_draft_save.test.sql.
grant update on table public.clinical_notes to authenticated;
grant insert, update, delete on table public.follow_ups to authenticated;
-- 000117 (09C-01, R-2): INSERT, UPDATE and DELETE on public.prescription_items, INSERT on public.prescriptions and INSERT, UPDATE on public.doctor_custom_medicines
-- are revoked from authenticated (change_prescription is the writer). This file proves the guards, triggers and policies themselves (defence in depth,
-- independent of the grants), so the grants are widened for this transaction only; the narrowing is proven in rx_lines_command.test.sql.
grant insert, update, delete on table public.prescription_items to authenticated;
grant insert on table public.prescriptions to authenticated;
grant insert, update on table public.doctor_custom_medicines to authenticated;
select plan(31);

-- Fixtures ----------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1070000-0000-4000-8000-000000000101', 'c107-owner-a@example.test'),
  ('c1070000-0000-4000-8000-000000000102', 'c107-doctor-a@example.test'),
  ('c1070000-0000-4000-8000-000000000103', 'c107-admin-a@example.test'),
  ('c1070000-0000-4000-8000-000000000104', 'c107-nurse-a@example.test'),
  ('c1070000-0000-4000-8000-000000000105', 'c107-receptionist-a@example.test'),
  ('c1070000-0000-4000-8000-000000000201', 'c107-owner-b@example.test');
insert into public.tenants (id, name) values
  ('c1070000-0000-4000-8000-00000000000a', 'Synthetic 09A-01 Clinic A'),
  ('c1070000-0000-4000-8000-00000000000b', 'Synthetic 09A-01 Clinic B');
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in ('c1070000-0000-4000-8000-00000000000a', 'c1070000-0000-4000-8000-00000000000b');
insert into public.memberships (user_id, tenant_id, role) values
  ('c1070000-0000-4000-8000-000000000101', 'c1070000-0000-4000-8000-00000000000a', 'owner'),
  ('c1070000-0000-4000-8000-000000000102', 'c1070000-0000-4000-8000-00000000000a', 'doctor'),
  ('c1070000-0000-4000-8000-000000000103', 'c1070000-0000-4000-8000-00000000000a', 'admin'),
  ('c1070000-0000-4000-8000-000000000104', 'c1070000-0000-4000-8000-00000000000a', 'nurse'),
  ('c1070000-0000-4000-8000-000000000105', 'c1070000-0000-4000-8000-00000000000a', 'receptionist'),
  ('c1070000-0000-4000-8000-000000000201', 'c1070000-0000-4000-8000-00000000000b', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c1070000-0000-4000-8000-000000001001', 'c1070000-0000-4000-8000-00000000000a', 'Synthetic Seal Patient', '+919000010701',
   'c1070000-0000-4000-8000-000000000101');
insert into public.clinic_locations (id, tenant_id, name) values
  ('c1070000-0000-4000-8000-0000000000f1', 'c1070000-0000-4000-8000-00000000000a', 'Synthetic Annex');

-- D 2001 draft (in consultation), S 2002 sealed (signed, amended once, re-signed), M 2003 amending (signed, reopened).
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1070000-0000-4000-8000-000000002001', 'c1070000-0000-4000-8000-00000000000a', 'c1070000-0000-4000-8000-000000001001',
   'c1070000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1070000-0000-4000-8000-000000000101'),
  ('c1070000-0000-4000-8000-000000002002', 'c1070000-0000-4000-8000-00000000000a', 'c1070000-0000-4000-8000-000000001001',
   'c1070000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1070000-0000-4000-8000-000000000101'),
  ('c1070000-0000-4000-8000-000000002003', 'c1070000-0000-4000-8000-00000000000a', 'c1070000-0000-4000-8000-000000001001',
   'c1070000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1070000-0000-4000-8000-000000000101');
update public.clinical_notes set clinical_notes = 'Synthetic note' where tenant_id = 'c1070000-0000-4000-8000-00000000000a';
insert into public.consultation_diagnoses (id, tenant_id, visit_id, patient_id, diagnosis_name)
  select ('c1070000-0000-4000-8000-0000000031' || right(v.id::text, 2))::uuid, v.tenant_id, v.id, v.patient_id, 'Synthetic diagnosis'
    from public.visits v where v.tenant_id = 'c1070000-0000-4000-8000-00000000000a';
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id)
  select ('c1070000-0000-4000-8000-0000000032' || right(v.id::text, 2))::uuid, v.tenant_id, v.id, v.patient_id, v.doctor_id
    from public.visits v where v.tenant_id = 'c1070000-0000-4000-8000-00000000000a';
insert into public.prescription_items (prescription_id, medicine_name, dosage, duration)
  select p.id, 'Synthetic medicine', '1-0-1', '5 days' from public.prescriptions p where p.tenant_id = 'c1070000-0000-4000-8000-00000000000a';
insert into public.follow_ups (id, tenant_id, patient_id, visit_id, doctor_id, follow_up_date)
  select ('c1070000-0000-4000-8000-0000000033' || right(v.id::text, 2))::uuid, v.tenant_id, v.patient_id, v.id, v.doctor_id, '2030-03-01'
    from public.visits v where v.tenant_id = 'c1070000-0000-4000-8000-00000000000a';

-- V2-09a 000107 (R-15): the signature and the reopen are written under the doctor's own session, as the commands do.
create function pg_temp.as_actor(p_user uuid, p_sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'c1070000-0000-4000-8000-00000000000a')::text, true);
  execute p_sql;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end
$f$;
do $do$
declare
  d constant uuid := 'c1070000-0000-4000-8000-000000000102';
  s constant uuid := 'c1070000-0000-4000-8000-000000002002';
  m constant uuid := 'c1070000-0000-4000-8000-000000002003';
begin
  perform pg_temp.as_actor(d, format($q$update public.visits set status = 'completed', signed_at = now(), signed_by = %L where id in (%L, %L)$q$, d, s, m));
  -- S was amended once: revision row, reopen, re-sign (a later clock reading so the signature changes within this transaction).
  perform pg_temp.as_actor(d, format($q$insert into public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason)
    values ('c1070000-0000-4000-8000-00000000000a', %L, %L, 'Synthetic amendment reason')$q$, s, d));
  perform pg_temp.as_actor(d, format($q$update public.visits set status = 'in_consultation' where id = %L$q$, s));
  perform pg_temp.as_actor(d, format($q$update public.visits set status = 'completed', signed_at = clock_timestamp(), signed_by = %L where id = %L$q$, d, s));
  -- M is reopened and stays open.
  perform pg_temp.as_actor(d, format($q$insert into public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason)
    values ('c1070000-0000-4000-8000-00000000000a', %L, %L, 'Synthetic amendment reason')$q$, m, d));
  perform pg_temp.as_actor(d, format($q$update public.visits set status = 'in_consultation' where id = %L$q$, m));
end $do$;

select is((select string_agg(v.id::text || ':' || v.status || ':' || (v.signed_at is not null)::text, ',' order by v.id) from public.visits v
            where v.tenant_id = 'c1070000-0000-4000-8000-00000000000a'),
  'c1070000-0000-4000-8000-000000002001:in_consultation:false,c1070000-0000-4000-8000-000000002002:completed:true,'
  'c1070000-0000-4000-8000-000000002003:in_consultation:true',
  'fixture: D is a draft, S is sealed (signed, completed), M is amending (signed, reopened)');

-- The probe: one statement as one role, rolled back; 'ok:<rows>', 'denied:<42501 message>' or 'error:<sqlstate>:<message>'.
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

create temp table roles (role text, db_role text, uid uuid, tenant uuid, privileged boolean);
insert into roles values
  ('owner',        'authenticated', 'c1070000-0000-4000-8000-000000000101', 'c1070000-0000-4000-8000-00000000000a', true),
  ('doctor',       'authenticated', 'c1070000-0000-4000-8000-000000000102', 'c1070000-0000-4000-8000-00000000000a', true),
  ('admin',        'authenticated', 'c1070000-0000-4000-8000-000000000103', 'c1070000-0000-4000-8000-00000000000a', false),
  ('nurse',        'authenticated', 'c1070000-0000-4000-8000-000000000104', 'c1070000-0000-4000-8000-00000000000a', false),
  ('receptionist', 'authenticated', 'c1070000-0000-4000-8000-000000000105', 'c1070000-0000-4000-8000-00000000000a', false),
  ('owner_b',      'authenticated', 'c1070000-0000-4000-8000-000000000201', 'c1070000-0000-4000-8000-00000000000b', false),
  ('anon',         'anon',          null,                                   'c1070000-0000-4000-8000-00000000000a', false),
  ('service_role', 'service_role',  null,                                   'c1070000-0000-4000-8000-00000000000a', true),
  ('postgres',     'postgres',      null,                                   'c1070000-0000-4000-8000-00000000000a', true);

create temp table states (state text, visit uuid);
insert into states values
  ('draft',    'c1070000-0000-4000-8000-000000002001'),
  ('sealed',   'c1070000-0000-4000-8000-000000002002'),
  ('amending', 'c1070000-0000-4000-8000-000000002003');

-- exp_*: NULL = not asserted; 'ok' = admitted for the privileged roles; otherwise a regex over the refusal (matched after 'denied:').
-- {v} is the visit, {rx} its header, {doc} the doctor, {own} the owner, {loc2} the second location.
create temp table ops (op text, sql text, exp_draft text, exp_sealed text, exp_amending text);
insert into ops values
  ('visit: clear the signature',  $$update public.visits set signed_at = null, signed_by = null where id = '{v}'$$, null, 'VISIT_SIGNOFF_FORBIDDEN', 'VISIT_SIGNOFF_FORBIDDEN'),
  ('visit: re-sign',              $$update public.visits set signed_at = clock_timestamp(), signed_by = '{doc}' where id = '{v}'$$, null, 'VISIT_SIGNOFF_FORBIDDEN', 'VISIT_SIGNOFF_FORBIDDEN'),
  ('visit: status cancelled',     $$update public.visits set status = 'cancelled' where id = '{v}'$$, null, 'VISIT_SIGNED_STATUS_FORBIDDEN', 'VISIT_SIGNED_STATUS_FORBIDDEN'),
  ('visit: reopen (status)',      $$update public.visits set status = 'in_consultation' where id = '{v}'$$, null, 'VISIT_SIGNED_STATUS_FORBIDDEN|VISIT_REOPEN_NEEDS_AMENDMENT', null),
  ('visit: specialty',            $$update public.visits set specialty = 'dental' where id = '{v}'$$, 'ok', 'VISIT_SIGNED_FIELD_IMMUTABLE', 'ok'),
  ('visit: scheduled_at',         $$update public.visits set scheduled_at = '2031-01-01 09:00+05:30' where id = '{v}'$$, 'ok', 'VISIT_SIGNED_FIELD_IMMUTABLE', 'ok'),
  ('visit: location_id',          $$update public.visits set location_id = '{loc2}' where id = '{v}'$$, 'ok', 'VISIT_SIGNED_FIELD_IMMUTABLE', 'ok'),
  ('visit: reason_for_visit',     $$update public.visits set reason_for_visit = 'rewritten reason' where id = '{v}'$$, 'ok', 'VISIT_SIGNED_FIELD_IMMUTABLE', 'ok'),
  ('visit: created_by',           $$update public.visits set created_by = '{doc}' where id = '{v}'$$, null, 'VISIT_SIGNED_FIELD_IMMUTABLE|VISIT_ACTOR_IMMUTABLE', 'VISIT_SIGNED_FIELD_IMMUTABLE|VISIT_ACTOR_IMMUTABLE'),
  ('visit: delete',               $$delete from public.visits where id = '{v}'$$, null, 'VISIT_SIGNED_DELETE_FORBIDDEN|permission denied', 'VISIT_SIGNED_DELETE_FORBIDDEN|permission denied'),
  ('note: update',                $$update public.clinical_notes set clinical_notes = 'rewritten note' where visit_id = '{v}'$$, 'ok', 'CLINICAL_NOTES_VISIT_SIGNED', 'ok'),
  ('note: delete',                $$delete from public.clinical_notes where visit_id = '{v}'$$, 'ok', 'CLINICAL_NOTES_VISIT_SIGNED|permission denied', 'ok'),
  ('diagnosis: insert',           $$insert into public.consultation_diagnoses (tenant_id, visit_id, patient_id, diagnosis_name) select tenant_id, id, patient_id, 'Added diagnosis' from public.visits where id = '{v}'$$, 'ok', 'DIAGNOSIS_VISIT_SIGNED', 'ok'),
  ('diagnosis: update',           $$update public.consultation_diagnoses set diagnosis_name = 'Rewritten diagnosis' where visit_id = '{v}'$$, 'ok', 'DIAGNOSIS_VISIT_SIGNED', 'ok'),
  ('diagnosis: delete',           $$delete from public.consultation_diagnoses where visit_id = '{v}'$$, 'ok', 'DIAGNOSIS_VISIT_SIGNED', 'ok'),
  ('rx item: insert',             $$insert into public.prescription_items (prescription_id, medicine_name, dosage, duration) values ('{rx}', 'Added medicine', '1-0-1', '3 days')$$, 'ok', 'PRESCRIPTION_ITEM_VISIT_SIGNED', 'ok'),
  ('rx item: update',             $$update public.prescription_items set dosage = '9-9-9' where prescription_id = '{rx}'$$, 'ok', 'PRESCRIPTION_ITEM_VISIT_SIGNED', 'ok'),
  ('rx item: delete',             $$delete from public.prescription_items where prescription_id = '{rx}'$$, 'ok', 'PRESCRIPTION_ITEM_VISIT_SIGNED', 'ok'),
  ('follow-up: insert',           $$insert into public.follow_ups (tenant_id, patient_id, visit_id, doctor_id, follow_up_date) select tenant_id, patient_id, id, doctor_id, '2030-04-01' from public.visits where id = '{v}' on conflict (tenant_id, visit_id) where visit_id is not null do update set follow_up_date = excluded.follow_up_date$$, 'ok', 'FOLLOW_UP_VISIT_SIGNED', 'ok'),
  ('follow-up: update',           $$update public.follow_ups set follow_up_date = '2031-01-01' where visit_id = '{v}'$$, 'ok', 'FOLLOW_UP_VISIT_SIGNED', 'ok'),
  ('follow-up: delete',           $$delete from public.follow_ups where visit_id = '{v}'$$, 'ok', 'FOLLOW_UP_VISIT_SIGNED', 'ok'),
  ('revision: update',            $$update public.visit_revisions set amendment_reason = 'edited reason' where visit_id = '{v}'$$, null, 'REVISION_IMMUTABLE|permission denied', 'REVISION_IMMUTABLE|permission denied'),
  ('revision: delete',            $$delete from public.visit_revisions where visit_id = '{v}'$$, null, 'REVISION_IMMUTABLE|permission denied', 'REVISION_IMMUTABLE|permission denied');

create temp table res as
select o.op, s.state, k.role, k.privileged,
       case s.state when 'draft' then o.exp_draft when 'sealed' then o.exp_sealed else o.exp_amending end as expected,
       pg_temp.attempt(k.db_role, k.uid, k.tenant,
         replace(replace(replace(replace(replace(o.sql, '{v}', s.visit::text),
           '{rx}', ('c1070000-0000-4000-8000-0000000032' || right(s.visit::text, 2))),
           '{doc}', 'c1070000-0000-4000-8000-000000000102'), '{own}', 'c1070000-0000-4000-8000-000000000101'),
           '{loc2}', 'c1070000-0000-4000-8000-0000000000f1')) as outcome
  from ops o cross join states s cross join roles k;

-- 1. The matrix -----------------------------------------------------------------------------------------------------------
select is((select count(*)::int from res), 23 * 3 * 9, 'the matrix ran every operation in every state as every role (23 x 3 x 9)');
select is((select string_agg(op || '/' || state || '/' || role || ' => ' || outcome, '; ') from res where outcome ~ '^error:42[0-9A-Z]{3}'), null,
  'no probe failed for a reason other than the seal (no undefined column, syntax or type error in the matrix)');
select is((select string_agg(op || '/' || role || ' => ' || outcome, '; ') from res where state = 'sealed' and outcome ~ '^ok:[1-9]'), null,
  'SEALED: no role changes, adds or deletes a row of a sealed record (visit, note, diagnosis, Rx item, follow-up, revision)');
select is((select string_agg(op || '/' || role || ' => ' || outcome, '; ') from res
            where state = 'sealed' and privileged and expected is not null and outcome !~ ('^denied:(' || expected || ')')), null,
  'SEALED: the owner, the doctor, service_role and postgres are each refused with the guard''s own fixed name');
select is((select string_agg(op || '/' || role || ' => ' || outcome, '; ') from res
            where state = 'sealed' and role in ('service_role', 'postgres') and outcome !~ '^denied:'), null,
  'SEALED: service_role and postgres (the system path) are refused on every operation, including the visit itself');
select is((select string_agg(op || '/' || role || ' => ' || outcome, '; ') from res
            where state in ('sealed', 'amending', 'draft') and role in ('owner_b', 'anon') and outcome ~ '^ok:[1-9]'), null,
  'another clinic''s owner and anon never change a row in any state');
select is((select string_agg(op || '/' || role || ' => ' || outcome, '; ') from res
            where state = 'amending' and privileged and expected is not null and expected <> 'ok' and outcome !~ ('^denied:(' || expected || ')')), null,
  'AMENDING: signature, re-sign, status, creator, delete and revision changes are refused for the owner, doctor, service_role and postgres');
select is((select string_agg(op || '/' || role || ' => ' || outcome, '; ') from res
            where state = 'amending' and role in ('doctor', 'service_role', 'postgres') and expected = 'ok' and outcome !~ '^ok:[1-9]'
              and not (role = 'doctor' and op = 'note: delete')), null,
  'AMENDING: content writes (note, diagnoses, Rx items, follow-ups, specialty, date, location, reason) are admitted for the doctor and the system path');
select is((select string_agg(op || '/' || role || ' => ' || outcome, '; ') from res
            where state = 'draft' and role in ('doctor', 'service_role', 'postgres') and expected = 'ok' and outcome !~ '^ok:[1-9]'
              and not (role = 'doctor' and op = 'note: delete')), null,
  'DRAFT: the same content writes are admitted for the doctor and the system path (control: the sealed refusals are the seal, not a broken fixture)');
select is((select string_agg(op || '/' || role || ' => ' || outcome, '; ') from res
            where state = 'draft' and role in ('service_role', 'postgres') and op = 'visit: re-sign' and outcome !~ '^denied:VISIT_SIGNOFF_FORBIDDEN'), null,
  'DRAFT: the system path cannot sign a draft either (R-5, N-9)');
select is((select string_agg(op || '/' || role || ' => ' || outcome, '; ') from res
            where state = 'draft' and role in ('service_role', 'postgres') and op = 'visit: clear the signature' and outcome !~ '^ok:1'), null,
  'DRAFT: a system-path write that leaves the signature empty is still a normal write');

-- 2. R-3: definer code is no exception -----------------------------------------------------------------------------------
create function public.zz_seal_probe(p_visit uuid) returns void language plpgsql security definer set search_path = '' as $f$
begin
  update public.clinical_notes set clinical_notes = 'rewritten by a definer function' where visit_id = p_visit;
end
$f$;
grant execute on function public.zz_seal_probe(uuid) to authenticated, service_role;
select is(pg_temp.attempt('authenticated', 'c1070000-0000-4000-8000-000000000102', 'c1070000-0000-4000-8000-00000000000a',
  $$select public.zz_seal_probe('c1070000-0000-4000-8000-000000002002')$$), 'denied:CLINICAL_NOTES_VISIT_SIGNED',
  'a SECURITY DEFINER function called as the doctor cannot rewrite a sealed note (R-3)');
select is(pg_temp.attempt('service_role', null, 'c1070000-0000-4000-8000-00000000000a',
  $$select public.zz_seal_probe('c1070000-0000-4000-8000-000000002002')$$), 'denied:CLINICAL_NOTES_VISIT_SIGNED',
  'the same function called as service_role cannot either (R-3)');
select is(pg_temp.attempt('authenticated', 'c1070000-0000-4000-8000-000000000102', 'c1070000-0000-4000-8000-00000000000a',
  $$select public.zz_seal_probe('c1070000-0000-4000-8000-000000002003')$$), 'ok:1',
  'control: the function does write a note of an amending visit, so the refusal above is the seal');
select is((select clinical_notes from public.clinical_notes where visit_id = 'c1070000-0000-4000-8000-000000002002'), 'Synthetic note',
  'the sealed note is unchanged after every probe');

-- 3. R-4a, R-7: cascade exceptions ---------------------------------------------------------------------------------------
-- A decoy amendment row on an unsigned visit (the system path may leave one) is append-only as well.
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by) values
  ('c1070000-0000-4000-8000-000000002009', 'c1070000-0000-4000-8000-00000000000a', 'c1070000-0000-4000-8000-000000001001',
   'c1070000-0000-4000-8000-000000000102', 'walk_in', 'in_consultation', 'c1070000-0000-4000-8000-000000000101');
-- (the user path refuses a revision on an unsigned visit, AMENDMENT_VISIT_NOT_SIGNED; the system path may leave one, as a decoy row)
insert into public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason)
  values ('c1070000-0000-4000-8000-00000000000a', 'c1070000-0000-4000-8000-000000002009', 'c1070000-0000-4000-8000-000000000102', 'Synthetic decoy');
select is(pg_temp.attempt('postgres', null, 'c1070000-0000-4000-8000-00000000000a',
  $$delete from public.clinical_notes where visit_id = 'c1070000-0000-4000-8000-000000002009'$$), 'ok:1',
  'a draft visit''s note can be removed by the system path (nothing is sealed)');
select is(pg_temp.attempt('postgres', null, 'c1070000-0000-4000-8000-00000000000a',
  $$delete from public.visit_revisions where visit_id = 'c1070000-0000-4000-8000-000000002009'$$), 'denied:REVISION_IMMUTABLE',
  'an amendment row is never deleted while its visit exists, signed or not (R-7)');

-- A whole clinic is purged (as postgres, and as service_role if it holds the privilege): the cascade passes the seal (R-4a).
create function pg_temp.seed_purge_clinic(p_t uuid, p_u uuid, p_p uuid, p_v uuid) returns void language plpgsql as $f$
begin
  insert into auth.users (id, email) values (p_u, 'c107-' || p_t::text || '@example.test');
  insert into public.tenants (id, name) values (p_t, 'Synthetic 09A-01 Purge ' || p_t::text);
  update public.tenant_subscriptions set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
         access_ends_at = now() + interval '15 days', trial_consumed = true,
         plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id where p.code = 'standard' order by pp.active_from limit 1)
   where tenant_id = p_t;
  insert into public.memberships (user_id, tenant_id, role) values (p_u, p_t, 'owner');
  insert into public.patients (id, tenant_id, full_name, phone, created_by) values (p_p, p_t, 'Synthetic Purge Patient', '+919000010702', p_u);
  insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, created_by)
    values (p_v, p_t, p_p, p_u, 'walk_in', 'in_consultation', p_u);
  update public.clinical_notes set clinical_notes = 'Synthetic purge note' where visit_id = p_v;
  insert into public.consultation_diagnoses (tenant_id, visit_id, patient_id, diagnosis_name) values (p_t, p_v, p_p, 'Synthetic diagnosis');
  insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id) values (p_v, p_t, p_v, p_p, p_u);
  insert into public.prescription_items (prescription_id, medicine_name, dosage, duration) values (p_v, 'Synthetic medicine', '1-0-1', '5 days');
  insert into public.follow_ups (tenant_id, patient_id, visit_id, doctor_id, follow_up_date) values (p_t, p_p, p_v, p_u, '2030-03-01');
  perform set_config('request.jwt.claims', json_build_object('sub', p_u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-clinicos-tenant', p_t)::text, true);
  update public.visits set status = 'completed', signed_at = now(), signed_by = p_u where id = p_v;
  insert into public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason) values (p_t, p_v, p_u, 'Synthetic amendment reason');
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end
$f$;
do $do$ begin
  perform pg_temp.seed_purge_clinic('c1070000-0000-4000-8000-0000000000c1', 'c1070000-0000-4000-8000-0000000003c1',
    'c1070000-0000-4000-8000-0000000013c1', 'c1070000-0000-4000-8000-0000000023c1');
  perform pg_temp.seed_purge_clinic('c1070000-0000-4000-8000-0000000000c2', 'c1070000-0000-4000-8000-0000000003c2',
    'c1070000-0000-4000-8000-0000000013c2', 'c1070000-0000-4000-8000-0000000023c2');
end $do$;
select is((select count(*)::int from public.visits where tenant_id in ('c1070000-0000-4000-8000-0000000000c1', 'c1070000-0000-4000-8000-0000000000c2')
             and signed_at is not null), 2, 'fixture: two purge clinics, each with a signed visit, notes, diagnosis, header, item, follow-up and revision');
select is(pg_temp.attempt('postgres', null, 'c1070000-0000-4000-8000-0000000000c1',
  $$delete from public.visits where id = 'c1070000-0000-4000-8000-0000000023c1'$$), 'denied:VISIT_SIGNED_DELETE_FORBIDDEN',
  'R-4a (negative): with the clinic still present, a system-path DELETE of its signed visit is refused');
select lives_ok($$delete from public.tenants where id = 'c1070000-0000-4000-8000-0000000000c1'$$,
  'R-4a: deleting a clinic as postgres cascades through its sealed visit, notes, diagnoses, header, items, follow-up and revision');
select is((select count(*)::int from (
    select 1 from public.visits where tenant_id = 'c1070000-0000-4000-8000-0000000000c1'
    union all select 1 from public.clinical_notes where tenant_id = 'c1070000-0000-4000-8000-0000000000c1'
    union all select 1 from public.consultation_diagnoses where tenant_id = 'c1070000-0000-4000-8000-0000000000c1'
    union all select 1 from public.prescription_items where tenant_id = 'c1070000-0000-4000-8000-0000000000c1'
    union all select 1 from public.follow_ups where tenant_id = 'c1070000-0000-4000-8000-0000000000c1'
    union all select 1 from public.visit_revisions where tenant_id = 'c1070000-0000-4000-8000-0000000000c1') x), 0,
  'nothing of that clinic remains');
create function pg_temp.purge_as_service_role(p_t uuid) returns text language plpgsql as $f$
begin
  set local role service_role;
  begin
    delete from public.tenants where id = p_t;
    reset role;
    return 'deleted';
  exception when others then
    reset role;
    return sqlstate || ':' || sqlerrm;
  end;
end
$f$;
select is(pg_temp.purge_as_service_role('c1070000-0000-4000-8000-0000000000c2'), 'deleted',
  'R-4a: the same cascade as service_role (the role of the run teardown and a tenant purge job)');
select is((select count(*)::int from public.visits where tenant_id = 'c1070000-0000-4000-8000-0000000000c2'), 0, 'and nothing of the second clinic remains');

-- 4. R-4c: a system path may insert a signed visit, and then add nothing to it -------------------------------------------
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, signed_at, signed_by, created_by) values
  ('c1070000-0000-4000-8000-000000002010', 'c1070000-0000-4000-8000-00000000000a', 'c1070000-0000-4000-8000-000000001001',
   'c1070000-0000-4000-8000-000000000102', 'walk_in', 'completed', now(), 'c1070000-0000-4000-8000-000000000102',
   'c1070000-0000-4000-8000-000000000101');
select is((select signed_at is not null from public.visits where id = 'c1070000-0000-4000-8000-000000002010'), true,
  'R-4c: the system path may INSERT a visit that is already signed (seeds, imports)');
select is(pg_temp.attempt('service_role', null, 'c1070000-0000-4000-8000-00000000000a',
  $$insert into public.consultation_diagnoses (tenant_id, visit_id, patient_id, diagnosis_name)
    values ('c1070000-0000-4000-8000-00000000000a', 'c1070000-0000-4000-8000-000000002010', 'c1070000-0000-4000-8000-000000001001', 'Late diagnosis')$$),
  'denied:DIAGNOSIS_VISIT_SIGNED', 'R-4c: a child row cannot be added to it afterwards');
select is(pg_temp.attempt('service_role', null, 'c1070000-0000-4000-8000-00000000000a',
  $$update public.clinical_notes set clinical_notes = 'late note' where visit_id = 'c1070000-0000-4000-8000-000000002010'$$),
  'denied:CLINICAL_NOTES_VISIT_SIGNED', 'R-4c: nor can its note be filled in afterwards');

-- 5. Objects ---------------------------------------------------------------------------------------------------------------
select has_trigger('public', 'visits', 'visits_sealed_delete_guard', 'visits carries the sealed-delete guard');
select has_trigger('public', 'clinical_notes', 'clinical_notes_delete_guard', 'clinical_notes carries the delete guard');
select has_trigger('public', 'visit_revisions', 'visit_revisions_append_only', 'visit_revisions carries the append-only guard');
select is(
  (select string_agg(p.proname || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ',') || ':'
          || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text || ':' || has_function_privilege('service_role', p.oid, 'EXECUTE')::text,
          ',' order by p.proname)
     from pg_proc p where p.oid in ('private.visits_sealed_delete_guard()'::regprocedure, 'private.visit_revisions_append_only()'::regprocedure,
                                    'private.visits_integrity_guard()'::regprocedure, 'private.follow_ups_integrity_guard()'::regprocedure)),
  'follow_ups_integrity_guard:false:search_path="":false:false,visit_revisions_append_only:false:search_path="":false:false,'
  'visits_integrity_guard:false:search_path="":false:false,visits_sealed_delete_guard:false:search_path="":false:false',
  'the guards are SECURITY INVOKER with search_path pinned and no EXECUTE for the API roles (no new definer surface)');

select * from finish();
rollback;
