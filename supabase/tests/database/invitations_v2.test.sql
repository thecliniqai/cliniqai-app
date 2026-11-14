-- invitations_v2.test.sql — V2-05 plan 05-07a (AUTH-06 backend, AUTH-D1, SEC-08, AUTH §3.2; rulings R-30, R-32, R-38;
-- threats T-05-27, T-05-28, T-05-30). Migration 000088_invitations_v2. The roadmap's "invite pgTAP cases":
--   1. catalogue: token_hash nullable, the new columns, one pending invitation per address, no INSERT policy and no
--      INSERT privilege for anon/authenticated (a direct insert is 42501), exact EXECUTE grants, search_path, the
--      service-role functions refuse a JWT caller even with a leaked grant (SYSTEM_ONLY, the R-38 session-role rule);
--   2. invite_staff: the session clinic checked against staff:invite, owner-only owner/admin invitations, the dual
--      member acting in A cannot invite into B, input checks, an existing member refused, a duplicate pending invite
--      returns the same id with exactly one job, an expired pending one is revoked first, the invite and its job roll
--      back together;
--   3. tokens minted at send time: invitation_issue_token for the current version only; resend bumps the version, kills
--      the old link and enqueues a second job with a new dedupe key; revoke; peek_invitation statuses without the
--      address;
--   4. consume: mismatched email, expired, revoked, reused, unconfirmed (user path refused, system path ok and
--      idempotent), re-inviting a removed member reactivates the same row, an active member is refused, audit rows.
-- Synthetic data only (example.test addresses, generated hashes); the file rolls back.
begin;
select plan(75);

-- Fixtures --------------------------------------------------------------------------------------------------------------
-- Clinic A: owner (OA), admin (AD), receptionist (RC), a removed admin (RA), a removed nurse (RN, re-invited below).
-- Clinic B: owner (OB). dual = receptionist in A, owner in B. Accounts without a membership: the invitee (IV, confirmed),
-- an unconfirmed invitee (UN), a stranger (ST, confirmed).
insert into auth.users (id, email, email_confirmed_at) values
  ('c5070000-0000-4000-8000-000000000101', 'c507-owner-a@example.test', now()),
  ('c5070000-0000-4000-8000-000000000102', 'c507-admin-a@example.test', now()),
  ('c5070000-0000-4000-8000-000000000103', 'c507-receptionist-a@example.test', now()),
  ('c5070000-0000-4000-8000-000000000104', 'c507-removed-admin@example.test', now()),
  ('c5070000-0000-4000-8000-000000000105', 'c507-returning-nurse@example.test', now()),
  ('c5070000-0000-4000-8000-000000000201', 'c507-owner-b@example.test', now()),
  ('c5070000-0000-4000-8000-000000000301', 'c507-dual@example.test', now()),
  ('c5070000-0000-4000-8000-000000000401', 'C507-Invitee@Example.test', now()),
  ('c5070000-0000-4000-8000-000000000402', 'c507-unconfirmed@example.test', null),
  ('c5070000-0000-4000-8000-000000000403', 'c507-stranger@example.test', now());
insert into public.tenants (id, name) values
  ('c5070000-0000-4000-8000-00000000000a', 'Synthetic 05-07a Clinic A'),
  ('c5070000-0000-4000-8000-00000000000b', 'Synthetic 05-07a Clinic B');
-- V2-05 05-09c (R-25): this file's clinics are trialing on the Standard price (full access once 05-10a reads it).
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in (select t.id from public.tenants t where t.created_at = now()) and s.status = 'incomplete';
insert into public.memberships (id, user_id, tenant_id, role, status, removed_at) values
  ('c5070000-0000-4000-8000-00000000a101', 'c5070000-0000-4000-8000-000000000101', 'c5070000-0000-4000-8000-00000000000a', 'owner', 'active', null),
  ('c5070000-0000-4000-8000-00000000a102', 'c5070000-0000-4000-8000-000000000102', 'c5070000-0000-4000-8000-00000000000a', 'admin', 'active', null),
  ('c5070000-0000-4000-8000-00000000a103', 'c5070000-0000-4000-8000-000000000103', 'c5070000-0000-4000-8000-00000000000a', 'receptionist', 'active', null),
  ('c5070000-0000-4000-8000-00000000a104', 'c5070000-0000-4000-8000-000000000104', 'c5070000-0000-4000-8000-00000000000a', 'admin', 'removed', now()),
  ('c5070000-0000-4000-8000-00000000a105', 'c5070000-0000-4000-8000-000000000105', 'c5070000-0000-4000-8000-00000000000a', 'nurse', 'removed', now()),
  ('c5070000-0000-4000-8000-00000000b201', 'c5070000-0000-4000-8000-000000000201', 'c5070000-0000-4000-8000-00000000000b', 'owner', 'active', null),
  ('c5070000-0000-4000-8000-00000000a301', 'c5070000-0000-4000-8000-000000000301', 'c5070000-0000-4000-8000-00000000000a', 'receptionist', 'active', null),
  ('c5070000-0000-4000-8000-00000000b301', 'c5070000-0000-4000-8000-000000000301', 'c5070000-0000-4000-8000-00000000000b', 'owner', 'active', null);
-- Pre-existing invitations of clinic A (inserted as postgres): an expired pending one, and one each for the
-- consume refusals (expired, revoked with its hash kept, used, unconfirmed invitee).
insert into public.invitations (id, tenant_id, role, invited_address, token_hash, expires_at, created_by, created_at,
                                consumed_at, consumed_by, revoked_at) values
  ('c5070000-0000-4000-8000-00000000f001', 'c5070000-0000-4000-8000-00000000000a', 'nurse', 'c507-late@example.test',
   null, now() - interval '1 hour', 'c5070000-0000-4000-8000-000000000101', now() - interval '4 days', null, null, null),
  ('c5070000-0000-4000-8000-00000000f002', 'c5070000-0000-4000-8000-00000000000a', 'nurse', 'c507-expired@example.test',
   encode(sha256('c507-expired'::bytea), 'hex'), now() - interval '1 minute', 'c5070000-0000-4000-8000-000000000101', now() - interval '4 days', null, null, null),
  ('c5070000-0000-4000-8000-00000000f003', 'c5070000-0000-4000-8000-00000000000a', 'nurse', 'c507-revoked@example.test',
   encode(sha256('c507-revoked'::bytea), 'hex'), now() + interval '1 day', 'c5070000-0000-4000-8000-000000000101', now(), null, null, now()),
  ('c5070000-0000-4000-8000-00000000f004', 'c5070000-0000-4000-8000-00000000000a', 'nurse', 'c507-stranger@example.test',
   encode(sha256('c507-used'::bytea), 'hex'), now() + interval '1 day', 'c5070000-0000-4000-8000-000000000101', now(), now(), 'c5070000-0000-4000-8000-000000000403', null),
  ('c5070000-0000-4000-8000-00000000f005', 'c5070000-0000-4000-8000-00000000000a', 'doctor', 'c507-unconfirmed@example.test',
   encode(sha256('c507-unconfirmed'::bytea), 'hex'), now() + interval '1 day', 'c5070000-0000-4000-8000-000000000101', now(), null, null, null),
  ('c5070000-0000-4000-8000-00000000f006', 'c5070000-0000-4000-8000-00000000000b', 'doctor', 'c507-b-invitee@example.test',
   null, now() + interval '1 day', 'c5070000-0000-4000-8000-000000000201', now(), null, null, null);

-- Helpers ---------------------------------------------------------------------------------------------------------------
-- Run p_sql (one value) as p_role ('authenticated', 'anon', 'service_role', 'postgres'), with a JWT for p_user and the
-- x-clinicos-tenant header p_header; keep its effects only when p_keep. Returns the value, 'denied:<message>' (42501)
-- or 'error:<sqlstate>:<message>'.
create function pg_temp.run(p_role text, p_user uuid, p_header uuid, p_sql text, p_keep boolean) returns text
language plpgsql as $f$
declare
  v_out text;
begin
  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims',
      case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
    perform set_config('request.headers',
      case when p_header is null then '' else json_build_object('x-clinicos-tenant', p_header)::text end, true);
    execute format('set local role %I', p_role);
    execute p_sql into v_out;
    reset role;
    if not p_keep then
      raise exception 'c507 sentinel' using errcode = 'P0S07';
    end if;
  exception
    when sqlstate 'P0S07' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  return v_out;
end;
$f$;
create function pg_temp.u(p_user uuid, p_header uuid, p_sql text) returns text language sql as
  $$ select pg_temp.run('authenticated', p_user, p_header, p_sql, false) $$;
create function pg_temp.uk(p_user uuid, p_header uuid, p_sql text) returns text language sql as
  $$ select pg_temp.run('authenticated', p_user, p_header, p_sql, true) $$;
create function pg_temp.svc(p_sql text) returns text language sql as
  $$ select pg_temp.run('service_role', null, null, p_sql, true) $$;
create temp table c507 (k text primary key, v text) on commit drop;

-- 1. Catalogue ----------------------------------------------------------------------------------------------------------
select col_is_null('public', 'invitations', 'token_hash', 'token_hash is nullable (minted at send time, R-30)');
select ok(
  (select count(*) = 3 from information_schema.columns where table_schema = 'public' and table_name = 'invitations'
     and column_name in ('token_version', 'last_sent_at', 'send_count')),
  'invitations has token_version, last_sent_at, send_count');
select ok(
  (select indisunique and pg_get_indexdef(indexrelid) ~ 'lower\(invited_address\)'
          and pg_get_expr(indpred, indrelid) ~ 'consumed_at IS NULL' and pg_get_expr(indpred, indrelid) ~ 'revoked_at IS NULL'
     from pg_index where indexrelid = 'public.invitations_one_pending_per_address'::regclass),
  'one pending invitation per clinic and address (unique partial index on lower(invited_address))');
select is_empty(
  $$ select policyname from pg_policies where schemaname = 'public' and tablename = 'invitations' and cmd in ('INSERT', 'ALL') $$,
  'no INSERT policy on invitations');
select ok(
  not has_any_column_privilege('authenticated', 'public.invitations', 'INSERT')
  and not has_any_column_privilege('anon', 'public.invitations', 'INSERT'),
  'anon and authenticated hold no INSERT on invitations (invite_staff only)');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000101', null,
  $$ with i as (insert into public.invitations (tenant_id, role, invited_address, expires_at, created_by)
                values ('c5070000-0000-4000-8000-00000000000a', 'doctor', 'c507-direct@example.test', now() + interval '1 day', auth.uid())
                returning 1) select count(*)::text from i $$),
  'denied:permission denied for table invitations', 'an owner''s direct INSERT into invitations is refused (42501)');
select set_eq(
  $$ select p.proname || ':' || coalesce((
            select string_agg(a.grantee::regrole::text, ',' order by a.grantee::regrole::text)
              from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('invite_staff', 'resend_invitation', 'revoke_invitation', 'invitation_issue_token',
                          'peek_invitation', 'consume_invitation', 'consume_invitation_for') $$,
  array['invite_staff:authenticated', 'resend_invitation:authenticated', 'revoke_invitation:authenticated',
        'invitation_issue_token:service_role', 'peek_invitation:anon,authenticated',
        'consume_invitation:authenticated', 'consume_invitation_for:service_role'],
  'exact EXECUTE grantees: user RPCs authenticated, token minting and the system consume service_role, peek anon too');
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('invite_staff', 'resend_invitation', 'revoke_invitation', 'invitation_issue_token',
                        'peek_invitation', 'consume_invitation', 'consume_invitation_for')),
  'every invitation RPC is SECURITY DEFINER with search_path ''''');
select is_empty(
  $$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname like 'invitation\_%'
        and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE')
             or has_function_privilege('service_role', p.oid, 'EXECUTE')
             or not (p.proconfig @> array['search_path=""'])) $$,
  'the private invitation helpers are executable by no API role and pin search_path');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000101', null,
  $$ select public.invitation_issue_token('c5070000-0000-4000-8000-00000000f006', 1) $$),
  'denied:permission denied for function invitation_issue_token', 'authenticated cannot execute invitation_issue_token');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000401', null,
  $$ select public.consume_invitation_for('c5070000-0000-4000-8000-000000000401', repeat('0', 64))::text $$),
  'denied:permission denied for function consume_invitation_for', 'authenticated cannot execute consume_invitation_for');
-- Even with a leaked grant (granted inside this probe only), a JWT caller is refused by the session-role rule (R-38).
create function pg_temp.leaked_grant_probe() returns text language plpgsql as $f$
declare
  v_out text;
begin
  begin
    grant execute on function public.invitation_issue_token(uuid, integer) to authenticated;
    grant execute on function public.consume_invitation_for(uuid, text) to authenticated;
    v_out := pg_temp.run('authenticated', 'c5070000-0000-4000-8000-000000000101', null,
      $$ select public.invitation_issue_token('c5070000-0000-4000-8000-00000000f006', 1) $$, false)
      || '|' || pg_temp.run('authenticated', 'c5070000-0000-4000-8000-000000000401', null,
      $$ select public.consume_invitation_for('c5070000-0000-4000-8000-000000000401', encode(sha256('c507-unconfirmed'::bytea), 'hex'))::text $$, false);
    raise exception 'c507 sentinel' using errcode = 'P0S07';
  exception
    when sqlstate 'P0S07' then null;
  end;
  return v_out;
end;
$f$;
select is(pg_temp.leaked_grant_probe(), 'denied:SYSTEM_ONLY|denied:SYSTEM_ONLY',
  'with a leaked grant a JWT caller is still refused: the session role must be service_role (R-38)');

-- 2. invite_staff -------------------------------------------------------------------------------------------------------
insert into c507 values ('inv1', pg_temp.uk('c5070000-0000-4000-8000-000000000101', null,
  $$ select public.invite_staff('c5070000-0000-4000-8000-00000000000a', '  C507-Invitee@Example.TEST ', 'doctor')::text $$));
select is((select (v::jsonb) - 'id' - 'expires_at' from c507 where k = 'inv1'), '{"deduped": false}'::jsonb,
  'the owner invites a doctor: a new invitation, not deduped');
select ok((select i.invited_address = 'c507-invitee@example.test' and i.token_hash is null and i.token_version = 1
                  and i.send_count = 0 and i.created_by = 'c5070000-0000-4000-8000-000000000101' and i.role = 'doctor'
                  and i.expires_at = now() + interval '72 hours'
                  and (c.v::jsonb ->> 'expires_at')::timestamptz = i.expires_at
             from public.invitations i, c507 c where c.k = 'inv1' and i.id = (c.v::jsonb ->> 'id')::uuid),
  'stored lower-case, no token yet (minted at send), version 1, 72 h expiry, created_by = the caller');
select is((select jsonb_build_object('kind', j.kind, 'tenant', j.tenant_id, 'payload', j.payload, 'key', j.dedupe_key,
                                     'max', j.max_attempts, 'status', j.status)
             from ops.jobs j, c507 c where c.k = 'inv1' and j.payload ->> 'invitation_id' = c.v::jsonb ->> 'id'),
  (select jsonb_build_object('kind', 'email.invite', 'tenant', 'c5070000-0000-4000-8000-00000000000a',
                             'payload', jsonb_build_object('invitation_id', (v::jsonb ->> 'id')::uuid, 'token_version', 1),
                             'key', 'invite:' || (v::jsonb ->> 'id') || ':v1', 'max', 5, 'status', 'pending')
     from c507 where k = 'inv1'),
  'exactly one email.invite job in the same transaction: payload {invitation_id, token_version}, no token, key invite:<id>:v1');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000102', null,
  $$ select (public.invite_staff('c5070000-0000-4000-8000-00000000000a', 'c507-invitee@example.test', 'nurse') ->> 'id')
            || '/' || (public.invite_staff('c5070000-0000-4000-8000-00000000000a', 'c507-invitee@example.test', 'nurse') ->> 'deduped') $$),
  (select (v::jsonb ->> 'id') || '/true' from c507 where k = 'inv1'),
  'a duplicate pending invite (any case, by another inviter) returns the same id with deduped = true');
insert into c507 values ('inv1dup', pg_temp.uk('c5070000-0000-4000-8000-000000000101', null,
  $$ select public.invite_staff('c5070000-0000-4000-8000-00000000000a', 'c507-invitee@example.test', 'doctor')::text $$));
select is((select count(*)::int from ops.jobs j, c507 c where c.k = 'inv1' and j.payload ->> 'invitation_id' = c.v::jsonb ->> 'id'),
  1, 'and the duplicate enqueued nothing: still exactly one job');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000102', null,
  $$ select public.invite_staff('c5070000-0000-4000-8000-00000000000a', 'c507-new-admin@example.test', 'admin')::text $$),
  'denied:OWNER_REQUIRED', 'an admin inviting an admin is refused (owner only)');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000102', null,
  $$ select public.invite_staff('c5070000-0000-4000-8000-00000000000a', 'c507-new-owner@example.test', 'owner')::text $$),
  'denied:OWNER_REQUIRED', 'an admin inviting an owner is refused');
select is(pg_temp.uk('c5070000-0000-4000-8000-000000000102', null,
  $$ select public.invite_staff('c5070000-0000-4000-8000-00000000000a', 'c507-new-nurse@example.test', 'nurse') ->> 'deduped' $$),
  'false', 'an admin invites a nurse');
select is(pg_temp.uk('c5070000-0000-4000-8000-000000000101', null,
  $$ select public.invite_staff('c5070000-0000-4000-8000-00000000000a', 'c507-new-admin@example.test', 'admin') ->> 'deduped' $$),
  'false', 'the owner invites an admin');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000103', null,
  $$ select public.invite_staff('c5070000-0000-4000-8000-00000000000a', 'c507-new-nurse@example.test', 'nurse')::text $$),
  'denied:STAFF_INVITE_FORBIDDEN', 'a receptionist (no staff:invite) cannot invite');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000104', null,
  $$ select public.invite_staff('c5070000-0000-4000-8000-00000000000a', 'c507-new-nurse@example.test', 'nurse')::text $$),
  'denied:STAFF_INVITE_FORBIDDEN', 'a removed admin (valid JWT) cannot invite (05-05 status)');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000301', 'c5070000-0000-4000-8000-00000000000a',
  $$ select public.invite_staff('c5070000-0000-4000-8000-00000000000b', 'c507-new-b@example.test', 'admin')::text $$),
  'denied:STAFF_INVITE_FORBIDDEN', 'a dual member acting in A cannot invite into B, where they are the owner (R-42)');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000301', 'c5070000-0000-4000-8000-00000000000b',
  $$ select public.invite_staff('c5070000-0000-4000-8000-00000000000b', 'c507-new-b@example.test', 'admin') ->> 'deduped' $$),
  'false', 'acting in B the same owner invites an admin into B (control)');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000101', null,
  $$ select public.invite_staff(null, 'c507-new-nurse@example.test', 'nurse')::text $$),
  'denied:STAFF_INVITE_FORBIDDEN', 'no clinic named: refused');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000101', null,
  $$ select public.invite_staff('c5070000-0000-4000-8000-00000000000a', 'not an address', 'nurse')::text $$),
  'error:P0001:INPUT_INVALID', 'a malformed address is refused');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000101', null,
  $$ select public.invite_staff('c5070000-0000-4000-8000-00000000000a', 'c507-new-nurse@example.test', 'superuser')::text $$),
  'error:P0001:INPUT_INVALID', 'an unknown role is refused');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000101', null,
  $$ select public.invite_staff('c5070000-0000-4000-8000-00000000000a', 'C507-Admin-A@example.test', 'nurse')::text $$),
  'error:P0001:ALREADY_MEMBER', 'an address that is already an active member of the clinic is refused');
select is(pg_temp.run('anon', null, null,
  $$ select public.invite_staff('c5070000-0000-4000-8000-00000000000a', 'c507-new-nurse@example.test', 'nurse')::text $$, false),
  'denied:permission denied for function invite_staff', 'anon cannot invite');
insert into c507 values ('late', pg_temp.uk('c5070000-0000-4000-8000-000000000101', null,
  $$ select public.invite_staff('c5070000-0000-4000-8000-00000000000a', 'c507-late@example.test', 'nurse')::text $$));
select ok((select (v::jsonb ->> 'deduped') = 'false' and (v::jsonb ->> 'id') <> 'c5070000-0000-4000-8000-00000000f001'
             from c507 where k = 'late'),
  'an expired pending invitation is not returned: a new one is created');
select ok((select revoked_at is not null and revoked_by = 'c5070000-0000-4000-8000-000000000101' and token_hash is null
             from public.invitations where id = 'c5070000-0000-4000-8000-00000000f001'),
  'and the expired one was revoked first');
create function pg_temp.atomic_probe() returns text language plpgsql as $f$
declare
  v_out text;
begin
  begin
    v_out := pg_temp.run('authenticated', 'c5070000-0000-4000-8000-000000000101', null,
      $$ select public.invite_staff('c5070000-0000-4000-8000-00000000000a', 'c507-atomic@example.test', 'nurse') ->> 'id' $$, true);
    perform 1 / 0;  -- a failing statement after the RPC, in the same transaction
  exception
    when division_by_zero then null;
  end;
  return v_out || '|' || (select count(*) from public.invitations where invited_address = 'c507-atomic@example.test')
                || '|' || (select count(*) from ops.jobs where dedupe_key = 'invite:' || v_out || ':v1');
end;
$f$;
select matches(pg_temp.atomic_probe(), '^[0-9a-f-]{36}\|0\|0$',
  'a failing statement after invite_staff rolls back both the invitation and its job');

-- 3. Tokens minted at send time; resend; revoke; peek -------------------------------------------------------------------
insert into c507 values ('tok1', pg_temp.svc(format('select public.invitation_issue_token(%L, 1)', (select v::jsonb ->> 'id' from c507 where k = 'inv1'))));
select matches((select v from c507 where k = 'tok1'), '^[0-9a-f]{64}$', 'invitation_issue_token (service role) returns a 64-hex token once');
select ok((select i.token_hash = encode(sha256(convert_to(c.v, 'UTF8')), 'hex') and i.send_count = 1 and i.last_sent_at is not null
             from public.invitations i, c507 c, c507 d
            where c.k = 'tok1' and d.k = 'inv1' and i.id = (d.v::jsonb ->> 'id')::uuid),
  'only the SHA-256 of the token is stored (as hashInviteToken), send_count 1, last_sent_at set');
select is((select count(*)::int from ops.jobs j, c507 c where c.k = 'tok1' and j.payload::text like '%' || c.v || '%'), 0,
  'the raw token is in no job payload');
select is(pg_temp.run('anon', null, null,
  format('select public.peek_invitation(%L)::text', (select encode(sha256(convert_to(v, 'UTF8')), 'hex') from c507 where k = 'tok1')), false)::jsonb,
  '{"status": "pending", "clinic_name": "Synthetic 05-07a Clinic A", "role": "doctor", "masked_email": "c***@example.test"}'::jsonb,
  'peek_invitation (anon): status, clinic, role and a masked address; nothing else');
insert into c507 values ('resend', pg_temp.uk('c5070000-0000-4000-8000-000000000101', null,
  format('select public.resend_invitation(%L)::text', (select v::jsonb ->> 'id' from c507 where k = 'inv1'))));
select is((select (v::jsonb ->> 'token_version') from c507 where k = 'resend'), '2', 'resend_invitation bumps token_version to 2');
select ok((select i.token_hash is null and i.token_version = 2 from public.invitations i, c507 c
            where c.k = 'inv1' and i.id = (c.v::jsonb ->> 'id')::uuid),
  'and clears the stored hash: the first link is dead now');
select is((select array_agg(j.dedupe_key order by j.dedupe_key) from ops.jobs j, c507 c
            where c.k = 'inv1' and j.payload ->> 'invitation_id' = c.v::jsonb ->> 'id'),
  (select array['invite:' || (v::jsonb ->> 'id') || ':v1', 'invite:' || (v::jsonb ->> 'id') || ':v2'] from c507 where k = 'inv1'),
  'a second job with a new dedupe key (v2)');
select is(pg_temp.svc(format('select coalesce(public.invitation_issue_token(%L, 1), %L)', (select v::jsonb ->> 'id' from c507 where k = 'inv1'), 'null')),
  'null', 'the stale v1 job mints nothing (invitation_issue_token(id, 1) is null)');
select is(pg_temp.run('anon', null, null,
  format('select public.peek_invitation(%L)::text', (select encode(sha256(convert_to(v, 'UTF8')), 'hex') from c507 where k = 'tok1')), false)::jsonb,
  '{"status": "not_found"}'::jsonb, 'the first link''s peek is no longer pending');
insert into c507 values ('tok2', pg_temp.svc(format('select public.invitation_issue_token(%L, 2)', (select v::jsonb ->> 'id' from c507 where k = 'inv1'))));
select matches((select v from c507 where k = 'tok2'), '^[0-9a-f]{64}$', 'the v2 job mints the second link');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000102', null,
  format('select public.resend_invitation(%L)::text', (select id from public.invitations where invited_address = 'c507-new-admin@example.test'))),
  'denied:OWNER_REQUIRED', 'an admin cannot resend an admin invitation');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000103', null,
  format('select public.resend_invitation(%L)::text', (select v::jsonb ->> 'id' from c507 where k = 'inv1'))),
  'denied:STAFF_INVITE_FORBIDDEN', 'a receptionist cannot resend');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000101', null,
  $$ select public.resend_invitation('c5070000-0000-4000-8000-00000000f006')::text $$),
  'error:P0002:INVITATION_NOT_FOUND', 'another clinic''s invitation is not found');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000101', null,
  $$ select public.resend_invitation('c5070000-0000-4000-8000-00000000f004')::text $$),
  'error:P0001:INVITATION_NOT_PENDING', 'a used invitation cannot be resent');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000301', 'c5070000-0000-4000-8000-00000000000a',
  $$ select public.revoke_invitation('c5070000-0000-4000-8000-00000000f006')::text $$),
  'error:P0002:INVITATION_NOT_FOUND', 'a dual member acting in A cannot revoke B''s invitation');
insert into c507 values ('rev', pg_temp.uk('c5070000-0000-4000-8000-000000000101', null,
  format('select public.revoke_invitation(%L)::text', (select id from public.invitations where invited_address = 'c507-new-nurse@example.test'))));
select ok((select i.revoked_at is not null and i.revoked_by = 'c5070000-0000-4000-8000-000000000101' and i.token_hash is null
                  and (c.v::jsonb ->> 'revoked_at')::timestamptz = i.revoked_at
             from public.invitations i, c507 c where c.k = 'rev' and i.invited_address = 'c507-new-nurse@example.test'),
  'revoke_invitation sets revoked_at/by and clears the hash');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000101', null,
  format('select public.revoke_invitation(%L)::text', (select id from public.invitations where invited_address = 'c507-new-nurse@example.test')))::jsonb,
  (select v::jsonb from c507 where k = 'rev'), 'a second revoke returns the same revocation');
select is(pg_temp.svc(format('select coalesce(public.invitation_issue_token(%L, 1), %L)',
  (select id from public.invitations where invited_address = 'c507-new-nurse@example.test'), 'null')),
  'null', 'a revoked invitation mints no token (its queued job sends nothing)');
select is(pg_temp.run('anon', null, null, format('select public.peek_invitation(%L)::text', repeat('a', 64)), false)::jsonb,
  '{"status": "not_found"}'::jsonb, 'peek with an unknown hash: not_found, and nothing else');
select is(pg_temp.run('anon', null, null, $$ select public.peek_invitation('not-a-hash')::text $$, false)::jsonb,
  '{"status": "not_found"}'::jsonb, 'peek with a malformed hash: not_found');
select is(pg_temp.run('anon', null, null,
  format('select public.peek_invitation(%L) ->> %L', encode(sha256('c507-expired'::bytea), 'hex'), 'status'), false),
  'expired', 'peek: an expired invitation');
select is(pg_temp.run('anon', null, null,
  format('select public.peek_invitation(%L) ->> %L', encode(sha256('c507-used'::bytea), 'hex'), 'status'), false),
  'used', 'peek: a used invitation');
select is(pg_temp.run('anon', null, null,
  format('select public.peek_invitation(%L) ->> %L', encode(sha256('c507-revoked'::bytea), 'hex'), 'status'), false),
  'revoked', 'peek: an invitation revoked with its hash kept (staff removal, 05-05)');

-- 4. consume ------------------------------------------------------------------------------------------------------------
select is(pg_temp.u('c5070000-0000-4000-8000-000000000403', null,
  format('select public.consume_invitation(%L)::text', (select encode(sha256(convert_to(v, 'UTF8')), 'hex') from c507 where k = 'tok2'))),
  'denied:INVITATION_EMAIL_MISMATCH', 'a different confirmed account holding the link is refused (T-05-27)');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000401', null,
  format('select public.consume_invitation(%L)::text', encode(sha256('c507-expired'::bytea), 'hex'))),
  'error:P0001:Invitation has expired', 'an expired invitation is refused');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000401', null,
  format('select public.consume_invitation(%L)::text', encode(sha256('c507-revoked'::bytea), 'hex'))),
  'error:P0001:INVITATION_REVOKED', 'a revoked invitation is refused');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000403', null,
  format('select public.consume_invitation(%L)::text', encode(sha256('c507-used'::bytea), 'hex'))),
  'error:P0001:Invitation has already been used', 'a used invitation is refused (single use)');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000401', null,
  format('select public.consume_invitation(%L)::text', (select encode(sha256(convert_to(v, 'UTF8')), 'hex') from c507 where k = 'tok1'))),
  'error:P0001:Invalid invitation token', 'the first (resent-over) link no longer redeems');
insert into c507 values ('acc', pg_temp.uk('c5070000-0000-4000-8000-000000000401', null,
  format('select public.consume_invitation(%L)::text', (select encode(sha256(convert_to(v, 'UTF8')), 'hex') from c507 where k = 'tok2'))));
select is((select v from c507 where k = 'acc'), 'c5070000-0000-4000-8000-00000000000a',
  'the invitee (confirmed, address equal ignoring case) redeems the second link');
select ok((select role = 'doctor' and status = 'active' from public.memberships
            where user_id = 'c5070000-0000-4000-8000-000000000401' and tenant_id = 'c5070000-0000-4000-8000-00000000000a'),
  'and is an active doctor of the clinic');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000401', null,
  format('select public.consume_invitation(%L)::text', (select encode(sha256(convert_to(v, 'UTF8')), 'hex') from c507 where k = 'tok2'))),
  'error:P0001:Invitation has already been used', 'reusing the link is refused');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000402', null,
  format('select public.consume_invitation(%L)::text', encode(sha256('c507-unconfirmed'::bytea), 'hex'))),
  'denied:INVITATION_EMAIL_UNCONFIRMED', 'an unconfirmed invitee cannot redeem on the user path');
select is(pg_temp.svc(format('select public.consume_invitation_for(%L, %L)::text', 'c5070000-0000-4000-8000-000000000402',
  encode(sha256('c507-unconfirmed'::bytea), 'hex'))),
  'c5070000-0000-4000-8000-00000000000a', 'the system path (service role) redeems for the unconfirmed invitee');
select is(pg_temp.svc(format('select public.consume_invitation_for(%L, %L)::text', 'c5070000-0000-4000-8000-000000000402',
  encode(sha256('c507-unconfirmed'::bytea), 'hex'))),
  'c5070000-0000-4000-8000-00000000000a', 'and is idempotent for the same user (a retried acceptance)');
select is((select count(*)::int from public.memberships where user_id = 'c5070000-0000-4000-8000-000000000402'), 1,
  'with exactly one membership');
select is(pg_temp.svc(format('select public.consume_invitation_for(%L, %L)::text', 'c5070000-0000-4000-8000-000000000403',
  encode(sha256('c507-unconfirmed'::bytea), 'hex'))),
  'error:P0001:Invitation has already been used', 'the system path for a different user is refused');
insert into c507 values ('latetok', pg_temp.svc(format('select public.invitation_issue_token(%L, 1)', (select v::jsonb ->> 'id' from c507 where k = 'late'))));
select is(pg_temp.svc(format('select public.consume_invitation_for(%L, %L)::text', 'c5070000-0000-4000-8000-000000000403',
  (select encode(sha256(convert_to(v, 'UTF8')), 'hex') from c507 where k = 'latetok'))),
  'denied:INVITATION_EMAIL_MISMATCH', 'the system path binds the address too: another user''s account is refused');
-- R-32: the removed nurse is invited again and gets her row back.
insert into c507 values ('back', pg_temp.uk('c5070000-0000-4000-8000-000000000101', null,
  $$ select public.invite_staff('c5070000-0000-4000-8000-00000000000a', 'c507-returning-nurse@example.test', 'receptionist') ->> 'id' $$));
insert into c507 values ('backtok', pg_temp.svc(format('select public.invitation_issue_token(%L, 1)', (select v from c507 where k = 'back'))));
select is(pg_temp.uk('c5070000-0000-4000-8000-000000000105', null,
  format('select public.consume_invitation(%L)::text', (select encode(sha256(convert_to(v, 'UTF8')), 'hex') from c507 where k = 'backtok'))),
  'c5070000-0000-4000-8000-00000000000a', 're-inviting a removed member: she redeems the invitation');
select ok((select count(*) = 1 and bool_and(id = 'c5070000-0000-4000-8000-00000000a105' and status = 'active'
                                            and role = 'receptionist' and removed_at is null and removed_by is null)
             from public.memberships where user_id = 'c5070000-0000-4000-8000-000000000105'),
  'the SAME membership row is reactivated with the invited role (R-32)');
select is((select metadata from public.audit_logs where action = 'staff.invite_accepted'
            and entity_id = (select v::uuid from c507 where k = 'back')),
  jsonb_build_object('role', 'receptionist', 'membership_id', 'c5070000-0000-4000-8000-00000000a105', 'reactivated', true),
  'the acceptance is audited (staff.invite_accepted, reactivated)');
insert into public.invitations (tenant_id, role, invited_address, token_hash, expires_at, created_by) values
  ('c5070000-0000-4000-8000-00000000000a', 'nurse', 'c507-admin-a@example.test', encode(sha256('c507-member'::bytea), 'hex'),
   now() + interval '1 day', 'c5070000-0000-4000-8000-000000000101');
select is(pg_temp.u('c5070000-0000-4000-8000-000000000102', null,
  format('select public.consume_invitation(%L)::text', encode(sha256('c507-member'::bytea), 'hex'))),
  'error:P0001:ALREADY_MEMBER', 'an active member cannot redeem an invitation into her own clinic again');
select is((select array_agg(action order by action) from public.audit_logs
            where entity_id = (select (v::jsonb ->> 'id')::uuid from c507 where k = 'inv1')),
  array['staff.invite_accepted', 'staff.invite_resent', 'staff.invited'],
  'the invitation''s life is audited: invited, resent, accepted (counts and role only, no address or token)');

select * from finish();
rollback;
