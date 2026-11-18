-- api_keys_notices_columns.test.sql — V2-05 fix plan 05-11b, findings M-APIKEY (05a review RLS M-1, IND M4, INT L-6)
-- and M-NOTICE (RLS M-2, IND M3), migration 000073.
-- Before 000073 an admin could re-key, un-revoke or re-attribute the owner's export-scoped API key and delete keys
-- (erasing audit attribution), and any recipient could rewrite a broadcast notice's content and link. Now members
-- update only an API key's name and revocation (once), and only a notice's read state; the API-key guard covers every
-- path that carries a session.
-- Synthetic data only (key hashes are repeat()-built); every probe and the file roll back.
begin;
select plan(26);

-- Fixtures ---------------------------------------------------------------------------------------------------------
-- Clinic A: owner (OA), admin (AD), receptionist (RC). OA's export-scoped key, a revoked key, a broadcast notice and a
-- reception notice.
insert into auth.users (id, email) values
  ('b11b0000-0000-4000-8000-000000000301', 'b11b-key-owner@example.test'),
  ('b11b0000-0000-4000-8000-000000000302', 'b11b-key-admin@example.test'),
  ('b11b0000-0000-4000-8000-000000000303', 'b11b-key-reception@example.test');
insert into public.tenants (id, name) values ('b11b0000-0000-4000-8000-00000000030a', 'Synthetic 05-11b Keys Clinic');
insert into public.memberships (user_id, tenant_id, role) values
  ('b11b0000-0000-4000-8000-000000000301', 'b11b0000-0000-4000-8000-00000000030a', 'owner'),
  ('b11b0000-0000-4000-8000-000000000302', 'b11b0000-0000-4000-8000-00000000030a', 'admin'),
  ('b11b0000-0000-4000-8000-000000000303', 'b11b0000-0000-4000-8000-00000000030a', 'receptionist');
insert into public.api_keys (id, tenant_id, name, key_prefix, key_hash, created_by, scopes, revoked_at) values
  ('b11b0000-0000-4000-8000-000000003001', 'b11b0000-0000-4000-8000-00000000030a', 'Owner export key', 'fixture-own',
   repeat('7', 64), 'b11b0000-0000-4000-8000-000000000301', '{exports:create}', null),
  ('b11b0000-0000-4000-8000-000000003002', 'b11b0000-0000-4000-8000-00000000030a', 'Old key', 'fixture-old',
   repeat('8', 64), 'b11b0000-0000-4000-8000-000000000301', '{}', '2030-01-01T00:00:00Z');
insert into public.in_app_notifications (id, tenant_id, recipient_user_id, recipient_role, category, event_type, title, message, link_url) values
  ('b11b0000-0000-4000-8000-000000003101', 'b11b0000-0000-4000-8000-00000000030a', null, null, 'system', 'synthetic',
   'Broadcast', 'Synthetic broadcast', '/settings'),
  ('b11b0000-0000-4000-8000-000000003102', 'b11b0000-0000-4000-8000-00000000030a', null, 'receptionist', 'queue', 'synthetic',
   'Reception', 'Synthetic reception notice', '/queue');

-- Helper: as the user acting in clinic A: run p_sql; rows affected, 'denied:<message>' (42501) or
-- 'error:<sqlstate>:<message>'. With p_postgres the statement runs as postgres (no privilege or RLS check) with the
-- user's session claims: what a SECURITY DEFINER path or a wider future grant would do. Always rolled back.
create function pg_temp.as_user(p_user uuid, p_sql text, p_postgres boolean default false) returns text
language plpgsql as $f$
declare
  v_rows bigint;
  v_out text;
begin
  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims',
      case when p_user is null then json_build_object('role', 'service_role')::text
           else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
    perform set_config('request.headers', json_build_object('x-clinicos-tenant', 'b11b0000-0000-4000-8000-00000000030a')::text, true);
    if p_user is null then set local role service_role;
    elsif not p_postgres then set local role authenticated;
    end if;
    execute p_sql;
    get diagnostics v_rows = row_count;
    v_out := v_rows::text;
    raise exception 'b11b sentinel' using errcode = 'P0S11';
  exception
    when sqlstate 'P0S11' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

-- 1. API keys: the reviewers' attacks ------------------------------------------------------------------------------------
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000302',
  $$update public.api_keys set key_hash = repeat('9', 64), key_prefix = 'fixture-adm' where id = 'b11b0000-0000-4000-8000-000000003001'$$),
  'denied:permission denied for table api_keys', 'an admin cannot re-key the owner''s export-scoped key (RLS M-1 repro)');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000302',
  $$update public.api_keys set created_by = 'b11b0000-0000-4000-8000-000000000302' where id = 'b11b0000-0000-4000-8000-000000003001'$$),
  'denied:permission denied for table api_keys', 'nor re-attribute it');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000302',
  $$update public.api_keys set scopes = '{}' where id = 'b11b0000-0000-4000-8000-000000003001'$$),
  'denied:permission denied for table api_keys', 'scopes are not updatable by members');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000302',
  $$update public.api_keys set revoked_at = null where id = 'b11b0000-0000-4000-8000-000000003002'$$),
  'denied:API_KEY_REVOKED', 'a revoked key cannot be un-revoked');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000301',
  $$update public.api_keys set revoked_at = now() where id = 'b11b0000-0000-4000-8000-000000003002'$$),
  'denied:API_KEY_REVOKED', 'nor its revocation time moved, even by the owner');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000302',
  $$delete from public.api_keys where id = 'b11b0000-0000-4000-8000-000000003001'$$),
  'denied:permission denied for table api_keys', 'keys are revoked, never deleted (INT L-6: audit attribution survives)');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000302',
  $$insert into public.api_keys (tenant_id, name, key_prefix, key_hash, created_by)
    values ('b11b0000-0000-4000-8000-00000000030a', 'Planted', 'fixture-pla', repeat('a', 64), 'b11b0000-0000-4000-8000-000000000301')$$),
  'denied:API_KEY_ACTOR_INVALID', 'a key cannot be created in the owner''s name');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000302',
  $$insert into public.api_keys (tenant_id, name, key_prefix, key_hash, created_by, scopes)
    values ('b11b0000-0000-4000-8000-00000000030a', 'Scoped', 'fixture-sco', repeat('a', 64), 'b11b0000-0000-4000-8000-000000000302', '{exports:create}')$$),
  'denied:API_KEY_SCOPE_FORBIDDEN', 'the 000067 scope rule still holds on INSERT');

-- 2. API keys: what the app does still works ------------------------------------------------------------------------------
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000302',
  $$insert into public.api_keys (tenant_id, name, key_prefix, key_hash, created_by)
    values ('b11b0000-0000-4000-8000-00000000030a', 'Admin key', 'fixture-new', repeat('a', 64), 'b11b0000-0000-4000-8000-000000000302')$$),
  '1', 'an admin creates a key in their own name (createApiKey)');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000302',
  $$update public.api_keys set revoked_at = now(), updated_at = now() where id = 'b11b0000-0000-4000-8000-000000003001'$$),
  '1', 'and revokes a key (revokeApiKey)');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000302',
  $$update public.api_keys set name = 'Renamed' where id = 'b11b0000-0000-4000-8000-000000003001'$$),
  '1', 'and renames one');
select is(pg_temp.as_user(null,
  $$update public.api_keys set last_used_at = now() where id = 'b11b0000-0000-4000-8000-000000003001'$$),
  '1', 'the v1 authenticator (service role) still stamps last_used_at');

-- 3. API keys: the guard covers every path with a session -----------------------------------------------------------------
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000302',
  $$update public.api_keys set key_hash = repeat('9', 64) where id = 'b11b0000-0000-4000-8000-000000003001'$$, true),
  'denied:API_KEY_IMMUTABLE', 'with the privilege (a definer path or a wider grant) a session still cannot re-key');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000302',
  $$update public.api_keys set tenant_id = tenant_id, created_by = 'b11b0000-0000-4000-8000-000000000302' where id = 'b11b0000-0000-4000-8000-000000003001'$$, true),
  'denied:API_KEY_IMMUTABLE', 'nor re-attribute');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000302',
  $$update public.api_keys set scopes = '{exports:create}' where id = 'b11b0000-0000-4000-8000-000000003002'$$, true),
  'denied:API_KEY_SCOPE_FORBIDDEN', 'nor add a scope');
select is((select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges
            where table_schema = 'public' and table_name = 'api_keys' and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  'name,revoked_at,updated_at', 'catalogue: members update name, revoked_at, updated_at only');
select ok(not has_table_privilege('authenticated', 'public.api_keys', 'DELETE')
          and not exists (select 1 from pg_policy where polrelid = 'public.api_keys'::regclass and polcmd = 'd'),
  'catalogue: no DELETE privilege or policy on api_keys');
select is((select pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.api_keys'::regclass and tgname = 'api_keys_scope_guard'),
  'CREATE TRIGGER api_keys_scope_guard BEFORE INSERT OR UPDATE ON public.api_keys FOR EACH ROW EXECUTE FUNCTION private.api_keys_scope_guard()',
  'catalogue: the guard fires on every INSERT and UPDATE, not only UPDATE OF scopes');

-- 4. Notices ---------------------------------------------------------------------------------------------------------------
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000303',
  $$update public.in_app_notifications set message = 'Re-enter your password', link_url = '/login'
     where id = 'b11b0000-0000-4000-8000-000000003101'$$),
  'denied:permission denied for table in_app_notifications', 'a receptionist cannot rewrite a broadcast notice (RLS M-2 repro)');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000303',
  $$update public.in_app_notifications set title = 'Action needed' where id = 'b11b0000-0000-4000-8000-000000003102'$$),
  'denied:permission denied for table in_app_notifications', 'nor the reception notice owners and admins also see');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000303',
  $$update public.in_app_notifications set recipient_user_id = 'b11b0000-0000-4000-8000-000000000301'
     where id = 'b11b0000-0000-4000-8000-000000003101'$$),
  'denied:permission denied for table in_app_notifications', 'nor re-address one');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000303',
  $$update public.in_app_notifications set is_read = true, read_at = now() where id = 'b11b0000-0000-4000-8000-000000003102'$$),
  '1', 'marking a notice read still works (markNotificationRead)');
select is((select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges
            where table_schema = 'public' and table_name = 'in_app_notifications' and grantee = 'authenticated'
              and privilege_type = 'UPDATE'),
  'is_read,read_at', 'catalogue: members update the read state only');
select is((select pg_get_expr(polwithcheck, polrelid) = pg_get_expr(polqual, polrelid) from pg_policy
            where polrelid = 'public.in_app_notifications'::regclass and polname = 'in_app_notifications_update'),
  true, 'the UPDATE policy''s WITH CHECK is its USING (the recipient rule), not only the tenant');
select throws_ok(
  $$insert into public.in_app_notifications (tenant_id, category, event_type, title, message, link_url)
    values ('b11b0000-0000-4000-8000-00000000030a', 'system', 'synthetic', 'T', 'M', 'https://evil.example/login')$$,
  '23514', null, 'a new notice cannot link off the app (absolute URL)');
select throws_ok(
  $$insert into public.in_app_notifications (tenant_id, category, event_type, title, message, link_url)
    values ('b11b0000-0000-4000-8000-00000000030a', 'system', 'synthetic', 'T', 'M', '//evil.example/login')$$,
  '23514', null, 'nor protocol-relative');

select * from finish();
rollback;
