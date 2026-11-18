-- invitation_accept_context.test.sql — V2-05 plan 05-07b (AUTH-06 app paths; rulings R-38, R-44; threats T-05-27,
-- T-05-29). Migration 000089_invitation_accept_context: what the invite-acceptance system path may learn about a token
-- hash, and who may ask.
--   1. catalogue: SECURITY DEFINER, search_path '', EXECUTE for service_role only; authenticated/anon refused, and with a
--      leaked grant a JWT caller is still refused (SYSTEM_ONLY, the session-role rule R-38);
--   2. statuses: malformed and unknown hashes are not_found; used, revoked and expired invitations return the status
--      only (no address, no account);
--   3. a pending invitation returns the invited address (trimmed, lower-cased) and the account that owns it: none (new
--      invitee), an unconfirmed one, a confirmed one (matched ignoring case and spaces); a deleted account is ignored;
--      two live accounts for one address raise INVITATION_ACCOUNT_AMBIGUOUS.
-- Synthetic data only (example.test addresses, generated hashes); the file rolls back.
begin;
select plan(17);

-- Fixtures --------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at, deleted_at) values
  ('c5076000-0000-4000-8000-000000000101', 'c507b-owner@example.test', now(), null),
  ('c5076000-0000-4000-8000-000000000201', 'C507B-Confirmed@Example.test', now(), null),
  ('c5076000-0000-4000-8000-000000000202', 'c507b-unconfirmed@example.test', null, null),
  ('c5076000-0000-4000-8000-000000000203', 'c507b-deleted@example.test', now(), now()),
  ('c5076000-0000-4000-8000-000000000204', 'c507b-twice@example.test', now(), null),
  ('c5076000-0000-4000-8000-000000000205', 'C507B-TWICE@example.test', null, null);
insert into public.tenants (id, name) values ('c5076000-0000-4000-8000-00000000000a', 'Synthetic 05-07b Clinic');
insert into public.memberships (user_id, tenant_id, role) values
  ('c5076000-0000-4000-8000-000000000101', 'c5076000-0000-4000-8000-00000000000a', 'owner');
insert into public.invitations (id, tenant_id, role, invited_address, token_hash, expires_at, created_by, consumed_at,
                                consumed_by, revoked_at) values
  ('c5076000-0000-4000-8000-00000000f001', 'c5076000-0000-4000-8000-00000000000a', 'doctor', 'c507b-new@example.test',
   encode(sha256('c507b-new'::bytea), 'hex'), now() + interval '1 day', 'c5076000-0000-4000-8000-000000000101', null, null, null),
  ('c5076000-0000-4000-8000-00000000f002', 'c5076000-0000-4000-8000-00000000000a', 'nurse', ' c507b-confirmed@example.test ',
   encode(sha256('c507b-confirmed'::bytea), 'hex'), now() + interval '1 day', 'c5076000-0000-4000-8000-000000000101', null, null, null),
  ('c5076000-0000-4000-8000-00000000f003', 'c5076000-0000-4000-8000-00000000000a', 'nurse', 'c507b-unconfirmed@example.test',
   encode(sha256('c507b-unconfirmed'::bytea), 'hex'), now() + interval '1 day', 'c5076000-0000-4000-8000-000000000101', null, null, null),
  ('c5076000-0000-4000-8000-00000000f004', 'c5076000-0000-4000-8000-00000000000a', 'nurse', 'c507b-deleted@example.test',
   encode(sha256('c507b-deleted'::bytea), 'hex'), now() + interval '1 day', 'c5076000-0000-4000-8000-000000000101', null, null, null),
  ('c5076000-0000-4000-8000-00000000f005', 'c5076000-0000-4000-8000-00000000000a', 'nurse', 'c507b-twice@example.test',
   encode(sha256('c507b-twice'::bytea), 'hex'), now() + interval '1 day', 'c5076000-0000-4000-8000-000000000101', null, null, null),
  ('c5076000-0000-4000-8000-00000000f006', 'c5076000-0000-4000-8000-00000000000a', 'nurse', 'c507b-used@example.test',
   encode(sha256('c507b-used'::bytea), 'hex'), now() + interval '1 day', 'c5076000-0000-4000-8000-000000000101', now(),
   'c5076000-0000-4000-8000-000000000201', null),
  ('c5076000-0000-4000-8000-00000000f007', 'c5076000-0000-4000-8000-00000000000a', 'nurse', 'c507b-revoked@example.test',
   encode(sha256('c507b-revoked'::bytea), 'hex'), now() + interval '1 day', 'c5076000-0000-4000-8000-000000000101', null, null, now()),
  ('c5076000-0000-4000-8000-00000000f008', 'c5076000-0000-4000-8000-00000000000a', 'nurse', 'c507b-expired@example.test',
   encode(sha256('c507b-expired'::bytea), 'hex'), now() - interval '1 minute', 'c5076000-0000-4000-8000-000000000101', null, null, null);

-- Run p_sql (one value) as p_role with a JWT for p_user; effects always rolled back. Returns the value,
-- 'denied:<message>' (42501) or 'error:<sqlstate>:<message>'.
create function pg_temp.run(p_role text, p_user uuid, p_sql text) returns text
language plpgsql as $f$
declare
  v_out text;
begin
  begin
    perform set_config('request.jwt.claims',
      case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
    execute format('set local role %I', p_role);
    execute p_sql into v_out;
    reset role;
    raise exception 'c507b sentinel' using errcode = 'P0S7B';
  exception
    when sqlstate 'P0S7B' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end;
$f$;
create function pg_temp.ctx(p_secret text) returns jsonb language sql as
  $$ select pg_temp.run('service_role', null,
       format('select public.invitation_accept_context(%L)::text', encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')))::jsonb $$;

-- 1. Catalogue ----------------------------------------------------------------------------------------------------------
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
    where p.oid = 'public.invitation_accept_context(text)'::regprocedure),
  'invitation_accept_context is SECURITY DEFINER with search_path ''''');
select set_eq(
  $$ select a.grantee::regrole::text from pg_proc p, aclexplode(p.proacl) a
      where p.oid = 'public.invitation_accept_context(text)'::regprocedure and a.privilege_type = 'EXECUTE'
        and a.grantee <> p.proowner $$,
  array['service_role'],
  'only service_role may execute invitation_accept_context');
select is(pg_temp.run('authenticated', 'c5076000-0000-4000-8000-000000000101',
  $$ select public.invitation_accept_context(repeat('0', 64))::text $$),
  'denied:permission denied for function invitation_accept_context', 'authenticated cannot execute it');
select is(pg_temp.run('anon', null, $$ select public.invitation_accept_context(repeat('0', 64))::text $$),
  'denied:permission denied for function invitation_accept_context', 'anon cannot execute it');
-- A leaked grant (inside this probe only) still refuses a JWT caller: the session role must be service_role (R-38).
create function pg_temp.leaked_grant_probe() returns text language plpgsql as $f$
declare
  v_out text;
begin
  begin
    grant execute on function public.invitation_accept_context(text) to authenticated;
    v_out := pg_temp.run('authenticated', 'c5076000-0000-4000-8000-000000000101',
      format('select public.invitation_accept_context(%L)::text', encode(sha256('c507b-new'::bytea), 'hex')));
    raise exception 'c507b sentinel' using errcode = 'P0S7B';
  exception
    when sqlstate 'P0S7B' then null;
  end;
  return v_out;
end;
$f$;
select is(pg_temp.leaked_grant_probe(), 'denied:SYSTEM_ONLY',
  'with a leaked grant a JWT caller is still refused (SYSTEM_ONLY, R-38)');

-- 2. Statuses without data ----------------------------------------------------------------------------------------------
select is(pg_temp.run('service_role', null, $$ select public.invitation_accept_context('not-a-hash')::text $$)::jsonb,
  '{"status": "not_found"}'::jsonb, 'a malformed hash is not_found');
select is(pg_temp.ctx('c507b-unknown'), '{"status": "not_found"}'::jsonb, 'an unknown hash is not_found');
select is(pg_temp.ctx('c507b-used'), '{"status": "used"}'::jsonb, 'a used invitation: the status only');
select is(pg_temp.ctx('c507b-revoked'), '{"status": "revoked"}'::jsonb, 'a revoked invitation: the status only');
select is(pg_temp.ctx('c507b-expired'), '{"status": "expired"}'::jsonb, 'an expired invitation: the status only');

-- 3. Pending: the address and its account ------------------------------------------------------------------------------
select is(pg_temp.ctx('c507b-new'),
  '{"status": "pending", "invited_address": "c507b-new@example.test", "user_id": null, "email_confirmed": false}'::jsonb,
  'a new invitee: the address, no account');
select is(pg_temp.ctx('c507b-confirmed'),
  '{"status": "pending", "invited_address": "c507b-confirmed@example.test", "user_id": "c5076000-0000-4000-8000-000000000201", "email_confirmed": true}'::jsonb,
  'a confirmed account owns the address (matched ignoring case and spaces)');
select is(pg_temp.ctx('c507b-unconfirmed'),
  '{"status": "pending", "invited_address": "c507b-unconfirmed@example.test", "user_id": "c5076000-0000-4000-8000-000000000202", "email_confirmed": false}'::jsonb,
  'an unconfirmed account owns the address');
select is(pg_temp.ctx('c507b-deleted') ->> 'user_id', null, 'a deleted account is ignored (treated as no account)');
select is(pg_temp.run('service_role', null,
  format('select public.invitation_accept_context(%L)::text', encode(sha256('c507b-twice'::bytea), 'hex'))),
  'error:P0001:INVITATION_ACCOUNT_AMBIGUOUS', 'two live accounts for one address are refused, never guessed');
select is(pg_temp.run('postgres', null,
  format('select public.invitation_accept_context(%L)::text', encode(sha256('c507b-new'::bytea), 'hex')))::jsonb ->> 'status',
  'pending', 'postgres (migrations, operators) may call it too');
select is((select count(*)::int from public.invitations where tenant_id = 'c5076000-0000-4000-8000-00000000000a'
            and (consumed_at is null) and revoked_at is null and send_count = 0), 6,
  'the lookups changed nothing (no invitation consumed, revoked or re-sent)');

select * from finish();
rollback;
