-- referrals_rules.test.sql — V2-05 plan 05-06 (P1-10, P1-11; R-35, R-42; threats T-05-18, T-05-19).
-- Migration 000062 `referrals_directory_consent`:
--   1. the target of a referral must be a clinic listed in the referral directory, and never the referral's own clinic
--      (P0001 REFERRAL_TARGET_NOT_LISTED), for every writer (a signed-in doctor and postgres alike); on UPDATE only a
--      changed target is checked, so a clinic that leaves the directory does not freeze referrals it already received;
--   2. a history snapshot needs the patient's consent (P0001 REFERRAL_CONSENT_REQUIRED), on INSERT and UPDATE;
--   3. the receiver-column guard (000021/000054) is unchanged: the target clinic may only acknowledge (regression);
--   4. `referral_directory_search`: consultations:edit in the active clinic; listed clinics only, never the caller's
--      own; `id` and `name` only; at most 20 rows; short queries return nothing; LIKE wildcards are literal;
--   5. `tenants.referral_directory_listed` (default false) is set through the clinic:manage UPDATE policy;
--   6. `api_keys.scopes` is a closed set (exports:create), default empty; adding a scope needs its permission in the
--      key's active clinic (000067 `api_keys_scope_guard`: an admin cannot give a key exports:create, ruling 01-09).
--      Since 000073 (05-11b, M-APIKEY) members update only a key's name and revocation: scopes are set at creation
--      (guarded) or by a system writer.
-- Every probe runs in a subtransaction that is always rolled back; the file rolls back. Synthetic data only.
begin;
select plan(48);

-- Fixtures (synthetic, inlined) --------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('e0600000-0000-4000-8000-000000000101', 'rr-owner-a@example.test'),
  ('e0600000-0000-4000-8000-000000000102', 'rr-admin-a@example.test'),
  ('e0600000-0000-4000-8000-000000000103', 'rr-doctor-a@example.test'),
  ('e0600000-0000-4000-8000-000000000105', 'rr-nurse-a@example.test'),
  ('e0600000-0000-4000-8000-000000000106', 'rr-receptionist-a@example.test'),
  ('e0600000-0000-4000-8000-000000000201', 'rr-owner-b@example.test'),
  ('e0600000-0000-4000-8000-000000000202', 'rr-doctor-b@example.test');
-- A (unlisted) refers patients; B and D are listed; C is not.
insert into public.tenants (id, name, referral_directory_listed) values
  ('e0600000-0000-4000-8000-00000000000a', 'Synthetic Referral Clinic A', false),
  ('e0600000-0000-4000-8000-00000000000b', 'Synthetic Referral Clinic B', true),
  ('e0600000-0000-4000-8000-00000000000c', 'Synthetic Referral Clinic C', false),
  ('e0600000-0000-4000-8000-00000000000d', 'Synthetic Referral Clinic D', true);
-- 25 listed clinics for the row cap.
insert into public.tenants (id, name, referral_directory_listed)
select ('e0600000-0000-4000-8000-0000000100' || lpad(g::text, 2, '0'))::uuid, 'Synthetic Referral Bulk ' || lpad(g::text, 2, '0'), true
from generate_series(1, 25) g;
insert into public.memberships (user_id, tenant_id, role) values
  ('e0600000-0000-4000-8000-000000000101', 'e0600000-0000-4000-8000-00000000000a', 'owner'),
  ('e0600000-0000-4000-8000-000000000102', 'e0600000-0000-4000-8000-00000000000a', 'admin'),
  ('e0600000-0000-4000-8000-000000000103', 'e0600000-0000-4000-8000-00000000000a', 'doctor'),
  ('e0600000-0000-4000-8000-000000000105', 'e0600000-0000-4000-8000-00000000000a', 'nurse'),
  ('e0600000-0000-4000-8000-000000000106', 'e0600000-0000-4000-8000-00000000000a', 'receptionist'),
  ('e0600000-0000-4000-8000-000000000201', 'e0600000-0000-4000-8000-00000000000b', 'owner'),
  ('e0600000-0000-4000-8000-000000000202', 'e0600000-0000-4000-8000-00000000000b', 'doctor');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('e0600000-0000-4000-8000-000000001001', 'e0600000-0000-4000-8000-00000000000a', 'Synthetic Referral Patient',
   '+919000000601', 'e0600000-0000-4000-8000-000000000101');
-- A refers to B (listed): one without and one with a consented history snapshot.
insert into public.referrals (id, tenant_id, patient_id, referral_type, referring_doctor_id, referred_to_name,
                              reason_for_referral, target_tenant_id, patient_consents_history_sharing,
                              consented_history_snapshot) values
  ('e0600000-0000-4000-8000-000000001002', 'e0600000-0000-4000-8000-00000000000a', 'e0600000-0000-4000-8000-000000001001',
   'in_network', 'e0600000-0000-4000-8000-000000000103', 'Synthetic Clinic B', 'Synthetic reason',
   'e0600000-0000-4000-8000-00000000000b', false, null),
  ('e0600000-0000-4000-8000-000000001003', 'e0600000-0000-4000-8000-00000000000a', 'e0600000-0000-4000-8000-000000001001',
   'in_network', 'e0600000-0000-4000-8000-000000000103', 'Synthetic Clinic B', 'Synthetic reason',
   'e0600000-0000-4000-8000-00000000000b', true, '{"encounters": []}'::jsonb);

-- Two API keys of A: one with the export scope, one without.
insert into public.api_keys (id, tenant_id, name, key_prefix, key_hash, created_by, scopes) values
  ('e0600000-0000-4000-8000-000000003001', 'e0600000-0000-4000-8000-00000000000a', 'Synthetic scoped key',
   'rr-prefix-05', repeat('e', 64), 'e0600000-0000-4000-8000-000000000101', array['exports:create']),
  ('e0600000-0000-4000-8000-000000003002', 'e0600000-0000-4000-8000-00000000000a', 'Synthetic unscoped key',
   'rr-prefix-06', repeat('f', 64), 'e0600000-0000-4000-8000-000000000101', '{}');

-- Helpers ----------------------------------------------------------------------------------------------------------
-- As postgres: p_sql in a subtransaction that is ALWAYS rolled back; 'ok' or '<sqlstate>:<message>'.
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
begin
  begin
    execute p_sql;
    raise exception 'rr sentinel' using errcode = 'P0S06';
  exception when others then
    if sqlstate = 'P0S06' then return 'ok'; end if;
    return sqlstate || ':' || sqlerrm;
  end;
end;
$f$;

-- As a signed-in user (anon when p_user is null) with the x-clinicos-tenant header p_header (none when null): the rows
-- p_sql affected/returned, or (p_value) the single value it returns; 'denied:<message>' (42501) or
-- 'error:<sqlstate>:<message>'. Always rolled back.
create function pg_temp.as_user(p_user uuid, p_header uuid, p_sql text, p_value boolean default false) returns text
language plpgsql as $f$
declare
  v_rows bigint;
  v_out text;
begin
  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims',
      case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
    perform set_config('request.headers',
      case when p_header is null then '' else json_build_object('x-clinicos-tenant', p_header)::text end, true);
    if p_user is null then set local role anon; else set local role authenticated; end if;
    if p_value then
      execute p_sql into v_out;
    else
      execute p_sql;
      get diagnostics v_rows = row_count;
      v_out := v_rows::text;
    end if;
    raise exception 'rr sentinel' using errcode = 'P0S06';
  exception
    when sqlstate 'P0S06' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

-- An INSERT of a referral from clinic A (patient and doctor of A) to p_target, with the given consent and snapshot.
create function pg_temp.ins(p_id text, p_target text, p_consent boolean default false, p_snapshot text default null)
returns text language sql as $f$
  select format(
    'insert into public.referrals (id, tenant_id, patient_id, referral_type, referring_doctor_id, referred_to_name, '
    'reason_for_referral, target_tenant_id, patient_consents_history_sharing, consented_history_snapshot) values '
    '(%L, ''e0600000-0000-4000-8000-00000000000a'', ''e0600000-0000-4000-8000-000000001001'', %L, '
    '''e0600000-0000-4000-8000-000000000103'', ''Synthetic target'', ''Synthetic reason'', %L, %L, %L::jsonb)',
    p_id, case when p_target is null then 'out_of_network' else 'in_network' end, p_target, p_consent, p_snapshot);
$f$;

-- 1. Target must be listed and not the referral's own clinic ---------------------------------------------------------
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000103', null,
  pg_temp.ins('e0600000-0000-4000-8000-000000002001', 'e0600000-0000-4000-8000-00000000000c')),
  'error:P0001:REFERRAL_TARGET_NOT_LISTED', 'a referral to a clinic not in the directory is refused (before: inserted)');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000103', null,
  pg_temp.ins('e0600000-0000-4000-8000-000000002002', 'e0600000-0000-4000-8000-00000000000b')),
  '1', 'a referral to a listed clinic is inserted');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000103', null,
  pg_temp.ins('e0600000-0000-4000-8000-000000002003', 'e0600000-0000-4000-8000-00000000000a')),
  'error:P0001:REFERRAL_TARGET_NOT_LISTED', 'a referral to the referring clinic itself is refused');
select is(pg_temp.try(
  $$update public.tenants set referral_directory_listed = true where id = 'e0600000-0000-4000-8000-00000000000a';$$ ||
  pg_temp.ins('e0600000-0000-4000-8000-000000002004', 'e0600000-0000-4000-8000-00000000000a')),
  'P0001:REFERRAL_TARGET_NOT_LISTED', 'a self-referral is refused even when the clinic itself is listed');
select is(pg_temp.try(pg_temp.ins('e0600000-0000-4000-8000-000000002005', 'e0600000-0000-4000-8000-00000000000c')),
  'P0001:REFERRAL_TARGET_NOT_LISTED', 'every writer is checked: postgres is refused too');
select is(pg_temp.try(pg_temp.ins('e0600000-0000-4000-8000-000000002006', 'e0600000-0000-4000-8000-00000000ffff')),
  'P0001:REFERRAL_TARGET_NOT_LISTED', 'a target that is no clinic at all is refused by the guard before the FK');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000103', null,
  pg_temp.ins('e0600000-0000-4000-8000-000000002007', null)),
  '1', 'an out-of-network referral (no target clinic) is unaffected');

-- 2. Consent for a history snapshot -----------------------------------------------------------------------------------
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000103', null,
  pg_temp.ins('e0600000-0000-4000-8000-000000002011', 'e0600000-0000-4000-8000-00000000000b', false, '{"encounters": []}')),
  'error:P0001:REFERRAL_CONSENT_REQUIRED', 'a history snapshot without consent is refused (before: inserted)');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000103', null,
  pg_temp.ins('e0600000-0000-4000-8000-000000002012', null, false, '{"encounters": []}')),
  'error:P0001:REFERRAL_CONSENT_REQUIRED', 'a history snapshot without consent is refused without a target too');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000103', null,
  pg_temp.ins('e0600000-0000-4000-8000-000000002013', 'e0600000-0000-4000-8000-00000000000b', true, '{"encounters": []}')),
  '1', 'a history snapshot with consent is inserted');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000103', null,
  pg_temp.ins('e0600000-0000-4000-8000-000000002014', 'e0600000-0000-4000-8000-00000000000b', false, 'null')),
  '1', 'a JSON null snapshot counts as no snapshot');
select is(pg_temp.try($$update public.referrals set patient_consents_history_sharing = false
                         where id = 'e0600000-0000-4000-8000-000000001003'$$),
  'P0001:REFERRAL_CONSENT_REQUIRED', 'withdrawing the consent flag while the snapshot stays is refused');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000103', null,
  $$update public.referrals set consented_history_snapshot = '{"encounters": []}'::jsonb
     where id = 'e0600000-0000-4000-8000-000000001002'$$),
  'error:P0001:REFERRAL_CONSENT_REQUIRED', 'adding a snapshot to a referral without consent is refused');

-- 3. Target changes on UPDATE -----------------------------------------------------------------------------------------
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000103', null,
  $$update public.referrals set target_tenant_id = 'e0600000-0000-4000-8000-00000000000c'
     where id = 'e0600000-0000-4000-8000-000000001002'$$),
  'error:P0001:REFERRAL_TARGET_NOT_LISTED', 're-targeting a referral to an unlisted clinic is refused');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000103', null,
  $$update public.referrals set target_tenant_id = 'e0600000-0000-4000-8000-00000000000d'
     where id = 'e0600000-0000-4000-8000-000000001002'$$),
  '1', 're-targeting a referral to another listed clinic is allowed');
select is(pg_temp.try(
  $$update public.tenants set referral_directory_listed = false where id = 'e0600000-0000-4000-8000-00000000000b';
    set local role authenticated;
    select set_config('request.jwt.claims', '{"sub":"e0600000-0000-4000-8000-000000000103","role":"authenticated"}', true);
    update public.referrals set target_tenant_id = 'e0600000-0000-4000-8000-00000000000b', reason_for_referral = 'Updated'
     where id = 'e0600000-0000-4000-8000-000000001002';$$),
  'ok', 'after the target leaves the directory, an update that keeps the same target still works');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000103', null,
  $$update public.referrals set target_tenant_id = null where id = 'e0600000-0000-4000-8000-000000001002'$$),
  '1', 'clearing the target is allowed');

-- 4. Receiver guard unchanged (regression) -------------------------------------------------------------------------
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000202', null,
  $$update public.referrals set clinical_summary = 'Rewritten by the receiver' where id = 'e0600000-0000-4000-8000-000000001002'$$),
  'denied:referral_target_update_forbidden', 'the receiving clinic still cannot change the clinical summary');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000202', null,
  $$update public.referrals set status = 'acknowledged', acknowledged_at = now() where id = 'e0600000-0000-4000-8000-000000001002'$$),
  '1', 'the receiving clinic still acknowledges');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000202', null,
  $$update public.referrals set target_tenant_id = 'e0600000-0000-4000-8000-00000000000d' where id = 'e0600000-0000-4000-8000-000000001002'$$),
  'denied:referral_target_update_forbidden', 'the receiving clinic cannot forward the referral to another clinic');

-- 5. Directory search ----------------------------------------------------------------------------------------------
select is(pg_get_function_result('public.referral_directory_search(text)'::regprocedure), 'TABLE(id uuid, name text)',
  'referral_directory_search returns id and name only');
select is((select prosecdef from pg_proc where oid = 'public.referral_directory_search(text)'::regprocedure), true,
  'referral_directory_search is SECURITY DEFINER (the caller cannot read other clinics'' tenants rows)');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000103', null,
  $$select string_agg(name, ',' order by name) from public.referral_directory_search('Synthetic Referral Clinic')$$, true),
  'Synthetic Referral Clinic B,Synthetic Referral Clinic D', 'a doctor finds the listed clinics only (not C, not A)');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000202', null,
  $$select string_agg(name, ',' order by name) from public.referral_directory_search('Synthetic Referral Clinic')$$, true),
  'Synthetic Referral Clinic D', 'the caller''s own clinic is never listed (B searching)');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000103', null,
  $$select * from public.referral_directory_search('synthetic referral bulk')$$),
  '20', 'at most 20 rows (25 listed clinics match; case-insensitive)');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000103', null,
  $$select * from public.referral_directory_search('%')$$), '0', 'a lone % is a short query: nothing');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000103', null,
  $$select * from public.referral_directory_search('%Clinic')$$), '0', 'LIKE wildcards are literal (no name contains "%Clinic")');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000103', null,
  $$select * from public.referral_directory_search('Synthetic_Referral')$$), '0', 'an underscore is literal too');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000103', null,
  $$select * from public.referral_directory_search(' S ')$$), '0', 'a query shorter than 2 characters returns nothing');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000105', null,
  $$select * from public.referral_directory_search('Synthetic Referral Clinic')$$),
  'denied:forbidden', 'a nurse (consultations:view only) is refused');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000106', null,
  $$select * from public.referral_directory_search('Synthetic Referral Clinic')$$),
  'denied:forbidden', 'a receptionist is refused');
select alike(pg_temp.as_user(null, null, $$select * from public.referral_directory_search('Synthetic Referral Clinic')$$),
  'denied:permission denied for function%', 'anon cannot execute it');
select is(has_function_privilege('authenticated', 'public.referral_directory_search(text)', 'EXECUTE'), true,
  'authenticated may execute it (the check is inside)');

-- 6. Directory opt-in column ---------------------------------------------------------------------------------------
select col_not_null('public', 'tenants', 'referral_directory_listed', 'tenants.referral_directory_listed is NOT NULL');
select col_default_is('public', 'tenants', 'referral_directory_listed', 'false', 'a clinic starts unlisted');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000101', null,
  $$update public.tenants set referral_directory_listed = true where id = 'e0600000-0000-4000-8000-00000000000a'$$),
  '1', 'the owner (clinic:manage) lists the clinic');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000103', null,
  $$update public.tenants set referral_directory_listed = true where id = 'e0600000-0000-4000-8000-00000000000a'$$),
  '0', 'a doctor cannot list the clinic (no clinic:manage: 0 rows)');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000201', null,
  $$update public.tenants set referral_directory_listed = true where id = 'e0600000-0000-4000-8000-00000000000a'$$),
  '0', 'another clinic''s owner cannot list it');

-- 7. API key scopes ------------------------------------------------------------------------------------------------
select col_default_is('public', 'api_keys', 'scopes', '{}'::text[], 'an API key has no scope by default');
select is(pg_temp.try($$insert into public.api_keys (tenant_id, name, key_prefix, key_hash, created_by, scopes) values
  ('e0600000-0000-4000-8000-00000000000a', 'Synthetic key', 'rr-prefix-01', repeat('a', 64),
   'e0600000-0000-4000-8000-000000000101', array['admin'])$$),
  '23514:new row for relation "api_keys" violates check constraint "api_keys_scopes_known"',
  'an unknown scope is refused (closed set)');
-- Granting a scope needs its permission in the key's (active) clinic: exports:create is the owner's (ruling 01-09).
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000101', null,
  $$insert into public.api_keys (tenant_id, name, key_prefix, key_hash, created_by, scopes) values
    ('e0600000-0000-4000-8000-00000000000a', 'Synthetic owner key', 'rr-prefix-02', repeat('b', 64),
     'e0600000-0000-4000-8000-000000000101', array['exports:create'])$$),
  '1', 'the owner (exports:create) creates a scoped key');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000102', null,
  $$insert into public.api_keys (tenant_id, name, key_prefix, key_hash, created_by, scopes) values
    ('e0600000-0000-4000-8000-00000000000a', 'Synthetic admin key', 'rr-prefix-03', repeat('c', 64),
     'e0600000-0000-4000-8000-000000000102', array['exports:create'])$$),
  'denied:API_KEY_SCOPE_FORBIDDEN', 'an admin (clinic:manage, no exports:create) cannot create a scoped key');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000102', null,
  $$insert into public.api_keys (tenant_id, name, key_prefix, key_hash, created_by) values
    ('e0600000-0000-4000-8000-00000000000a', 'Synthetic admin key', 'rr-prefix-04', repeat('d', 64),
     'e0600000-0000-4000-8000-000000000102')$$),
  '1', 'an admin still creates an unscoped key');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000102', null,
  $$update public.api_keys set scopes = array['exports:create'] where id = 'e0600000-0000-4000-8000-000000003002'$$),
  'denied:permission denied for table api_keys', 'an admin cannot add the scope to a key (no UPDATE on scopes since 000073)');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000102', null,
  $$update public.api_keys set scopes = '{}' where id = 'e0600000-0000-4000-8000-000000003001'$$),
  'denied:permission denied for table api_keys', 'nor remove it (000073: scopes are not member-updatable)');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000102', null,
  $$update public.api_keys set name = 'Renamed' where id = 'e0600000-0000-4000-8000-000000003001'$$),
  '1', 'an admin may rename a scoped key');
select is(pg_temp.as_user('e0600000-0000-4000-8000-000000000101', null,
  $$update public.api_keys set scopes = array['exports:create'] where id = 'e0600000-0000-4000-8000-000000003002'$$),
  'denied:permission denied for table api_keys', 'the owner creates scoped keys but does not add scopes to existing ones (000073)');
select is(pg_temp.try($$update public.api_keys set scopes = array['exports:create'] where id = 'e0600000-0000-4000-8000-000000003002'$$),
  'ok', 'a system writer (no JWT user: the runbook path) is not limited');

select * from finish();
rollback;
