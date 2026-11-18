-- remove_member.test.sql — V2-05 plan 05-05 (AUTH-05, SEC-07, AUTH §3.6; rulings R-14, R-32, R-42, R-43; threats
-- T-05-24, T-05-25, T-05-26). Migration 000087_membership_status.
--   1. catalogue: the status columns, the CHECKs, no member may write them, exact EXECUTE grants and search_path of
--      remove_member / session_is_live;
--   2. remove_member refusals: anon, no JWT, no staff:invite, admin removing an owner/admin, the last owner, self,
--      a bad reason, an unknown id, a member already removed, and the dual member acting in A on a clinic-B member;
--   3. effects of one removal: status/removed_at/removed_by, the target's API keys and pending invitations of THAT
--      clinic revoked (other clinic and other states untouched), every auth.sessions row of the target deleted with its
--      refresh tokens (another user's kept), one audit row with counts only, the returned counts;
--   4. fail-soft session revocation (R-43): with the session delete refused (42501, as a hosted database might), the
--      membership is still removed and sessions_revoked is NULL;
--   5. status in the helper bodies (acceptance 4): the removed member, JWT still valid, has no active clinic, no
--      member clinic, reads 0 rows and is refused by bound definer functions; a suspended member alike; a member
--      removed in A but active in B falls back to B;
--   6. change_member_role ignores non-active rows; consume_invitation refuses a revoked invitation;
--   7. session_is_live.
-- Synthetic data only; the file rolls back.
begin;
select plan(81);

-- Fixtures --------------------------------------------------------------------------------------------------------------
-- Clinic A: two owners, two admins, a doctor, a second doctor, a nurse, a receptionist, a suspended doctor.
-- Clinic B: owner, doctor. Clinic C: a single owner.
-- dual = admin in A, owner in B; dd = doctor in A and in B (the main removal target).
insert into auth.users (id, email, email_confirmed_at) values
  ('c5050000-0000-4000-8000-000000000101', 'c505-owner1-a@example.test', now()),
  ('c5050000-0000-4000-8000-000000000102', 'c505-owner2-a@example.test', now()),
  ('c5050000-0000-4000-8000-000000000103', 'c505-admin-a@example.test', now()),
  ('c5050000-0000-4000-8000-000000000104', 'c505-admin2-a@example.test', now()),
  ('c5050000-0000-4000-8000-000000000105', 'c505-doctor-a@example.test', now()),
  ('c5050000-0000-4000-8000-000000000106', 'c505-nurse-a@example.test', now()),
  ('c5050000-0000-4000-8000-000000000107', 'c505-receptionist-a@example.test', now()),
  ('c5050000-0000-4000-8000-000000000108', 'c505-suspended-a@example.test', now()),
  ('c5050000-0000-4000-8000-000000000109', 'c505-doctor2-a@example.test', now()),
  ('c5050000-0000-4000-8000-000000000201', 'c505-owner-b@example.test', now()),
  ('c5050000-0000-4000-8000-000000000202', 'c505-doctor-b@example.test', now()),
  ('c5050000-0000-4000-8000-000000000301', 'c505-dual@example.test', now()),
  ('c5050000-0000-4000-8000-000000000302', 'c505-dd@example.test', now()),
  ('c5050000-0000-4000-8000-000000000401', 'c505-owner-c@example.test', now()),
  ('c5050000-0000-4000-8000-000000000501', 'c505-invitee@example.test', now());
insert into public.tenants (id, name) values
  ('c5050000-0000-4000-8000-00000000000a', 'Synthetic 05-05 Clinic A'),
  ('c5050000-0000-4000-8000-00000000000b', 'Synthetic 05-05 Clinic B'),
  ('c5050000-0000-4000-8000-00000000000c', 'Synthetic 05-05 Clinic C');
-- V2-05 05-09c (R-25): this file's clinics are trialing on the Standard price (full access once 05-10a reads it).
update public.tenant_subscriptions s
   set status = 'trialing', trial_start = now(), trial_end = now() + interval '14 days',
       access_ends_at = now() + interval '15 days', trial_consumed = true,
       plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id
                         where p.code = 'standard' order by pp.active_from limit 1)
 where s.tenant_id in (select t.id from public.tenants t where t.created_at = now()) and s.status = 'incomplete';
insert into public.memberships (id, user_id, tenant_id, role, status) values
  ('c5050000-0000-4000-8000-00000000a101', 'c5050000-0000-4000-8000-000000000101', 'c5050000-0000-4000-8000-00000000000a', 'owner', 'active'),
  ('c5050000-0000-4000-8000-00000000a102', 'c5050000-0000-4000-8000-000000000102', 'c5050000-0000-4000-8000-00000000000a', 'owner', 'active'),
  ('c5050000-0000-4000-8000-00000000a103', 'c5050000-0000-4000-8000-000000000103', 'c5050000-0000-4000-8000-00000000000a', 'admin', 'active'),
  ('c5050000-0000-4000-8000-00000000a104', 'c5050000-0000-4000-8000-000000000104', 'c5050000-0000-4000-8000-00000000000a', 'admin', 'active'),
  ('c5050000-0000-4000-8000-00000000a105', 'c5050000-0000-4000-8000-000000000105', 'c5050000-0000-4000-8000-00000000000a', 'doctor', 'active'),
  ('c5050000-0000-4000-8000-00000000a106', 'c5050000-0000-4000-8000-000000000106', 'c5050000-0000-4000-8000-00000000000a', 'nurse', 'active'),
  ('c5050000-0000-4000-8000-00000000a107', 'c5050000-0000-4000-8000-000000000107', 'c5050000-0000-4000-8000-00000000000a', 'receptionist', 'active'),
  ('c5050000-0000-4000-8000-00000000a108', 'c5050000-0000-4000-8000-000000000108', 'c5050000-0000-4000-8000-00000000000a', 'doctor', 'suspended'),
  ('c5050000-0000-4000-8000-00000000a109', 'c5050000-0000-4000-8000-000000000109', 'c5050000-0000-4000-8000-00000000000a', 'doctor', 'active'),
  ('c5050000-0000-4000-8000-00000000b201', 'c5050000-0000-4000-8000-000000000201', 'c5050000-0000-4000-8000-00000000000b', 'owner', 'active'),
  ('c5050000-0000-4000-8000-00000000b202', 'c5050000-0000-4000-8000-000000000202', 'c5050000-0000-4000-8000-00000000000b', 'doctor', 'active'),
  ('c5050000-0000-4000-8000-00000000a301', 'c5050000-0000-4000-8000-000000000301', 'c5050000-0000-4000-8000-00000000000a', 'admin', 'active'),
  ('c5050000-0000-4000-8000-00000000b301', 'c5050000-0000-4000-8000-000000000301', 'c5050000-0000-4000-8000-00000000000b', 'owner', 'active'),
  ('c5050000-0000-4000-8000-00000000a302', 'c5050000-0000-4000-8000-000000000302', 'c5050000-0000-4000-8000-00000000000a', 'doctor', 'active'),
  ('c5050000-0000-4000-8000-00000000b302', 'c5050000-0000-4000-8000-000000000302', 'c5050000-0000-4000-8000-00000000000b', 'doctor', 'active'),
  ('c5050000-0000-4000-8000-00000000c401', 'c5050000-0000-4000-8000-000000000401', 'c5050000-0000-4000-8000-00000000000c', 'owner', 'active');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c5050000-0000-4000-8000-000000001001', 'c5050000-0000-4000-8000-00000000000a', 'Synthetic Patient A', '+919000000501',
   'c5050000-0000-4000-8000-000000000101');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by) values
  ('c5050000-0000-4000-8000-000000001002', 'c5050000-0000-4000-8000-00000000000a', 'c5050000-0000-4000-8000-000000001001',
   'c5050000-0000-4000-8000-000000000302', 'walk_in', 'c5050000-0000-4000-8000-000000000101');
-- The main target (dd): keys and invitations in A and B, two sessions with refresh tokens. The nurse has a session too.
insert into public.api_keys (id, tenant_id, name, key_prefix, key_hash, created_by, revoked_at) values
  ('c5050000-0000-4000-8000-00000000e001', 'c5050000-0000-4000-8000-00000000000a', 'Synthetic key A1', 'synthpfx-a1', repeat('a', 64), 'c5050000-0000-4000-8000-000000000302', null),
  ('c5050000-0000-4000-8000-00000000e002', 'c5050000-0000-4000-8000-00000000000a', 'Synthetic key A2', 'synthpfx-a2', repeat('b', 64), 'c5050000-0000-4000-8000-000000000302', null),
  ('c5050000-0000-4000-8000-00000000e003', 'c5050000-0000-4000-8000-00000000000a', 'Synthetic key A3', 'synthpfx-a3', repeat('c', 64), 'c5050000-0000-4000-8000-000000000302', '2026-01-01T00:00:00Z'),
  ('c5050000-0000-4000-8000-00000000e004', 'c5050000-0000-4000-8000-00000000000b', 'Synthetic key B1', 'synthpfx-b1', repeat('d', 64), 'c5050000-0000-4000-8000-000000000302', null),
  ('c5050000-0000-4000-8000-00000000e005', 'c5050000-0000-4000-8000-00000000000a', 'Synthetic key A owner', 'synthpfx-a4', repeat('e', 64), 'c5050000-0000-4000-8000-000000000101', null);
insert into public.invitations (id, tenant_id, role, invited_address, token_hash, expires_at, created_by, consumed_at, consumed_by) values
  ('c5050000-0000-4000-8000-00000000f001', 'c5050000-0000-4000-8000-00000000000a', 'nurse', 'c505-pending-a@example.test', repeat('1', 64), now() + interval '3 days', 'c5050000-0000-4000-8000-000000000302', null, null),
  ('c5050000-0000-4000-8000-00000000f002', 'c5050000-0000-4000-8000-00000000000a', 'nurse', 'c505-used-a@example.test', repeat('2', 64), now() + interval '3 days', 'c5050000-0000-4000-8000-000000000302', now(), 'c5050000-0000-4000-8000-000000000106'),
  ('c5050000-0000-4000-8000-00000000f003', 'c5050000-0000-4000-8000-00000000000b', 'nurse', 'c505-pending-b@example.test', repeat('3', 64), now() + interval '3 days', 'c5050000-0000-4000-8000-000000000302', null, null),
  ('c5050000-0000-4000-8000-00000000f004', 'c5050000-0000-4000-8000-00000000000a', 'nurse', 'c505-invitee@example.test', repeat('4', 64), now() + interval '3 days', 'c5050000-0000-4000-8000-000000000101', null, null);
insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  ('c5050000-0000-4000-8000-00000000d001', 'c5050000-0000-4000-8000-000000000302', now(), now(), 'aal1'),
  ('c5050000-0000-4000-8000-00000000d002', 'c5050000-0000-4000-8000-000000000302', now(), now(), 'aal1'),
  ('c5050000-0000-4000-8000-00000000d003', 'c5050000-0000-4000-8000-000000000106', now(), now(), 'aal1'),
  ('c5050000-0000-4000-8000-00000000d004', 'c5050000-0000-4000-8000-000000000109', now(), now(), 'aal1'),
  ('c5050000-0000-4000-8000-00000000d005', 'c5050000-0000-4000-8000-000000000106', now(), now() - interval '1 day', 'aal1');
update auth.sessions set not_after = now() - interval '1 hour' where id = 'c5050000-0000-4000-8000-00000000d005';
insert into auth.refresh_tokens (token, user_id, session_id, revoked, created_at, updated_at) values
  ('c505-synthetic-rt-1', 'c5050000-0000-4000-8000-000000000302', 'c5050000-0000-4000-8000-00000000d001', false, now(), now()),
  ('c505-synthetic-rt-2', 'c5050000-0000-4000-8000-000000000302', 'c5050000-0000-4000-8000-00000000d002', false, now(), now()),
  ('c505-synthetic-rt-3', 'c5050000-0000-4000-8000-000000000106', 'c5050000-0000-4000-8000-00000000d003', false, now(), now());

-- Helpers ---------------------------------------------------------------------------------------------------------------
-- As a signed-in user (anon when p_user is null; extra JWT claims in p_claims) with the x-clinicos-tenant header
-- p_header: run p_sql (returning one value) and KEEP its effects. Returns the value, 'denied:<message>' (42501) or
-- 'error:<sqlstate>:<message>' (a refused call's effects are rolled back with its subtransaction).
create function pg_temp.exec_as(p_user uuid, p_header uuid, p_sql text, p_claims jsonb default '{}'::jsonb) returns text
language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims',
    case when p_user is null then '' else (jsonb_build_object('sub', p_user, 'role', 'authenticated') || p_claims)::text end, true);
  perform set_config('request.headers',
    case when p_header is null then '' else json_build_object('x-clinicos-tenant', p_header)::text end, true);
  begin
    if p_user is null then set local role anon; else set local role authenticated; end if;
    execute p_sql into v_out;
    reset role;
  exception
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  return v_out;
end;
$f$;

-- Same, but always rolled back (a probe that must leave no trace).
create function pg_temp.try_as(p_user uuid, p_header uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  begin
    v_out := pg_temp.exec_as(p_user, p_header, p_sql);
    raise exception 'c505 sentinel' using errcode = 'P0S05';
  exception
    when sqlstate 'P0S05' then null;
  end;
  return v_out;
end;
$f$;

-- 1. Catalogue ----------------------------------------------------------------------------------------------------------
select has_column('public', 'memberships', 'status', 'memberships.status exists');
select col_default_is('public', 'memberships', 'status', 'active'::text, 'memberships.status defaults to active');
select throws_ok(
  $$ update public.memberships set status = 'paused' where id = 'c5050000-0000-4000-8000-00000000a106' $$,
  '23514', null, 'memberships.status accepts only active, suspended, removed');
select throws_ok(
  $$ update public.memberships set status = 'removed' where id = 'c5050000-0000-4000-8000-00000000a106' $$,
  '23514', null, 'a removed membership needs removed_at (and only a removed one has it)');
select ok(
  not has_column_privilege('authenticated', 'public.memberships', 'status', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.memberships', 'removed_at', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.memberships', 'removed_by', 'UPDATE')
  and not has_column_privilege('anon', 'public.memberships', 'status', 'UPDATE'),
  'no API role may write status, removed_at or removed_by (a member cannot reactivate themself)');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000108', 'c5050000-0000-4000-8000-00000000000a',
  $$ with u as (update public.memberships set status = 'active' where user_id = auth.uid() returning 1) select count(*)::text from u $$),
  'denied:permission denied for table memberships', 'a suspended member''s own UPDATE of status is refused (42501)');
select ok(
  has_column_privilege('authenticated', 'public.invitations', 'revoked_at', 'SELECT')
  and has_column_privilege('authenticated', 'public.invitations', 'revoked_by', 'SELECT')
  and not has_column_privilege('authenticated', 'public.invitations', 'token_hash', 'SELECT'),
  'invitations.revoked_at/revoked_by are readable by members; token_hash still is not (000071)');
select is(
  (select string_agg(a.grantee::regrole::text, ',' order by 1) from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.remove_member(uuid,text)'::regprocedure and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner),
  'authenticated', 'remove_member: EXECUTE for authenticated only (not PUBLIC, anon or service_role)');
select is(
  (select string_agg(a.grantee::regrole::text, ',' order by 1) from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.session_is_live()'::regprocedure and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner),
  'authenticated', 'session_is_live: EXECUTE for authenticated only');
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
    where p.oid in ('public.remove_member(uuid,text)'::regprocedure, 'public.session_is_live()'::regprocedure)),
  'remove_member and session_is_live are SECURITY DEFINER with search_path ''''');

-- 2. Refusals (each probe rolled back) ----------------------------------------------------------------------------------
select is(pg_temp.try_as(null, null,
  $$ select public.remove_member('c5050000-0000-4000-8000-00000000a106', 'Synthetic reason')::text $$),
  'denied:permission denied for function remove_member', 'anon cannot execute remove_member');
select throws_ok(
  $$ select public.remove_member('c5050000-0000-4000-8000-00000000a106', 'Synthetic reason') $$,
  '42501', 'ACTOR_INVALID', 'without a JWT (postgres, no auth.uid()) remove_member names no actor and refuses');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000107', null,
  $$ select public.remove_member('c5050000-0000-4000-8000-00000000a106', 'Synthetic reason')::text $$),
  'denied:STAFF_REMOVE_FORBIDDEN', 'a receptionist (no staff:invite) cannot remove a nurse');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000105', null,
  $$ select public.remove_member('c5050000-0000-4000-8000-00000000a106', 'Synthetic reason')::text $$),
  'denied:STAFF_REMOVE_FORBIDDEN', 'a doctor (no staff:invite) cannot remove a nurse');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000103', null,
  $$ select public.remove_member('c5050000-0000-4000-8000-00000000a101', 'Synthetic reason')::text $$),
  'denied:OWNER_REQUIRED', 'an admin removing an owner is refused (42501)');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000103', null,
  $$ select public.remove_member('c5050000-0000-4000-8000-00000000a104', 'Synthetic reason')::text $$),
  'denied:OWNER_REQUIRED', 'an admin removing another admin is refused (42501)');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000103', null,
  $$ select public.remove_member('c5050000-0000-4000-8000-00000000a103', 'Synthetic reason')::text $$),
  'denied:OWNER_REQUIRED', 'an admin cannot remove themself either (an admin target needs an owner)');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000401', null,
  $$ select public.remove_member('c5050000-0000-4000-8000-00000000c401', 'Synthetic reason')::text $$),
  'error:P0001:LAST_OWNER', 'the clinic''s only active owner cannot be removed');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000101', null,
  $$ select public.remove_member('c5050000-0000-4000-8000-00000000a101', 'Synthetic reason')::text $$),
  'error:P0001:SELF_REMOVAL', 'an owner (with a co-owner) cannot remove themself');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000101', null,
  $$ select public.remove_member('c5050000-0000-4000-8000-00000000a106', '   ')::text $$),
  'error:P0001:INPUT_INVALID', 'a blank reason is refused');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000101', null,
  format('select public.remove_member(%L, %L)::text', 'c5050000-0000-4000-8000-00000000a106', 'Synthetic' || chr(10) || 'reason')),
  'error:P0001:INPUT_INVALID', 'a reason with a control character is refused');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000101', null,
  format('select public.remove_member(%L, %L)::text', 'c5050000-0000-4000-8000-00000000a106', repeat('r', 501))),
  'error:P0001:INPUT_INVALID', 'a reason over 500 characters is refused');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000101', null,
  $$ select public.remove_member('c5050000-0000-4000-8000-00000000ffff', 'Synthetic reason')::text $$),
  'error:P0002:MEMBER_NOT_FOUND', 'an unknown membership id is not found');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000101', null,
  $$ select public.remove_member('c5050000-0000-4000-8000-00000000b202', 'Synthetic reason')::text $$),
  'error:P0002:MEMBER_NOT_FOUND', 'an owner of A removing a clinic-B member: not found (existence not revealed)');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000301', 'c5050000-0000-4000-8000-00000000000a',
  $$ select public.remove_member('c5050000-0000-4000-8000-00000000b202', 'Synthetic reason')::text $$),
  'error:P0002:MEMBER_NOT_FOUND', 'a dual member acting in A cannot remove a member of B, where they are the owner (R-42)');
select ok(pg_temp.try_as('c5050000-0000-4000-8000-000000000301', 'c5050000-0000-4000-8000-00000000000b',
  $$ select public.remove_member('c5050000-0000-4000-8000-00000000b202', 'Synthetic reason')::text $$) like '{%',
  'the same dual member acting in B removes the B member (control)');
select is((select count(*)::int from public.memberships where status = 'removed' and id::text like 'c5050000-%'),
  0, 'no refused or rolled-back probe removed anyone');

-- 3. Effects of one removal: an admin of A removes dd (doctor in A and in B) --------------------------------------------
create temp table c505_out (k text primary key, v text) on commit drop;
insert into c505_out values ('removal', pg_temp.exec_as('c5050000-0000-4000-8000-000000000103', null,
  $$ select public.remove_member('c5050000-0000-4000-8000-00000000a302', '  Synthetic removal reason  ')::text $$));

select is((select v::jsonb from c505_out where k = 'removal'),
  '{"user_id": "c5050000-0000-4000-8000-000000000302", "keys_revoked": 2, "invites_revoked": 1, "webhooks_disabled": 0, "sessions_revoked": 2}'::jsonb,
  'remove_member returns the user and the counts (2 keys, 1 invitation, no webhook subscription (05-12), 2 sessions)');
select ok((select status = 'removed' and removed_at is not null and removed_by = 'c5050000-0000-4000-8000-000000000103'
             from public.memberships where id = 'c5050000-0000-4000-8000-00000000a302'),
  'the membership is removed, with removed_at and removed_by = the caller');
select is((select status from public.memberships where id = 'c5050000-0000-4000-8000-00000000b302'), 'active',
  'the same person''s membership of clinic B is untouched');
select is((select count(*)::int from public.memberships where id = 'c5050000-0000-4000-8000-00000000a302'), 1,
  'the row is kept (never deleted: it is the RESTRICT parent of the doctor''s visits)');
select set_eq(
  $$ select id::text from public.api_keys where created_by = 'c5050000-0000-4000-8000-000000000302'
      and revoked_at is not null and revoked_at > '2026-06-01' $$,
  array['c5050000-0000-4000-8000-00000000e001', 'c5050000-0000-4000-8000-00000000e002'],
  'the target''s two live API keys of clinic A are revoked now');
select is((select revoked_at from public.api_keys where id = 'c5050000-0000-4000-8000-00000000e003'), '2026-01-01T00:00:00Z'::timestamptz,
  'an already revoked key keeps its first revocation time');
select ok((select bool_and(revoked_at is null) from public.api_keys
            where id in ('c5050000-0000-4000-8000-00000000e004', 'c5050000-0000-4000-8000-00000000e005')),
  'the target''s key in clinic B and another member''s key in A stay live');
select ok((select revoked_at is not null and revoked_by = 'c5050000-0000-4000-8000-000000000103'
             from public.invitations where id = 'c5050000-0000-4000-8000-00000000f001'),
  'the target''s pending invitation of clinic A is revoked by the caller');
select ok((select bool_and(revoked_at is null) from public.invitations
            where id in ('c5050000-0000-4000-8000-00000000f002', 'c5050000-0000-4000-8000-00000000f003', 'c5050000-0000-4000-8000-00000000f004')),
  'a consumed invitation, the target''s invitation of B and another member''s invitation are untouched');
select is((select count(*)::int from auth.sessions where user_id = 'c5050000-0000-4000-8000-000000000302'), 0,
  'every auth.sessions row of the removed user is deleted (R-43)');
select is((select count(*)::int from auth.refresh_tokens where user_id = 'c5050000-0000-4000-8000-000000000302'), 0,
  'their refresh tokens went with the sessions (cascade): no refresh is possible');
select is((select count(*)::int from auth.sessions where user_id = 'c5050000-0000-4000-8000-000000000106'), 2,
  'another user''s sessions are kept');
select is(
  (select jsonb_build_object('tenant', tenant_id, 'actor', actor_id, 'role', actor_role, 'type', entity_type, 'entity', entity_id,
                             'metadata', metadata)
     from public.audit_logs where action = 'staff.removed' and entity_id = 'c5050000-0000-4000-8000-00000000a302'),
  jsonb_build_object('tenant', 'c5050000-0000-4000-8000-00000000000a', 'actor', 'c5050000-0000-4000-8000-000000000103',
                     'role', 'admin', 'type', 'membership', 'entity', 'c5050000-0000-4000-8000-00000000a302',
                     'metadata', jsonb_build_object('target_user_id', 'c5050000-0000-4000-8000-000000000302', 'role', 'doctor',
                                                    'reason', 'Synthetic removal reason', 'keys_revoked', 2,
                                                    'invites_revoked', 1, 'webhooks_disabled', 0, 'sessions_revoked', 2)),
  'one audit row staff.removed: actor = the caller, counts only (no key, invitation or session ids), the trimmed reason');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000103', null,
  $$ select public.remove_member('c5050000-0000-4000-8000-00000000a302', 'Synthetic reason')::text $$),
  'error:P0001:MEMBER_NOT_ACTIVE', 'removing the same member again is refused');
select is((select count(*)::int from public.visits where id = 'c5050000-0000-4000-8000-000000001002'
             and doctor_id = 'c5050000-0000-4000-8000-000000000302'), 1,
  'the removed doctor''s visit history is intact');

-- 4. Fail-soft session revocation (R-43) ----------------------------------------------------------------------------------
-- The local `postgres` cannot revoke its DELETE on auth.sessions (granted by supabase_auth_admin), so a BEFORE DELETE
-- trigger raises the same SQLSTATE a hosted refusal would (42501). Everything, the trigger and its lock included, is
-- rolled back with the probe's subtransaction; the probe returns what it saw.
create function pg_temp.failsoft_probe() returns text language plpgsql as $f$
declare
  v_out text;
begin
  begin
    create function public.c505_refuse_session_delete() returns trigger language plpgsql as $t$
    begin
      raise exception 'permission denied for table sessions' using errcode = '42501';
    end;
    $t$;
    create trigger c505_refuse_session_delete before delete on auth.sessions
      for each row execute function public.c505_refuse_session_delete();
    v_out := pg_temp.exec_as('c5050000-0000-4000-8000-000000000101', null,
      $$ select public.remove_member('c5050000-0000-4000-8000-00000000a109', 'Synthetic reason')::text $$);
    v_out := v_out
      || '|' || (select status from public.memberships where id = 'c5050000-0000-4000-8000-00000000a109')
      || '|' || (select count(*) from auth.sessions where user_id = 'c5050000-0000-4000-8000-000000000109')
      || '|' || (select (metadata ->> 'sessions_revoked') is null from public.audit_logs
                  where action = 'staff.removed' and entity_id = 'c5050000-0000-4000-8000-00000000a109');
    raise exception 'c505 sentinel' using errcode = 'P0S05';
  exception
    when sqlstate 'P0S05' then null;
  end;
  return v_out;
end;
$f$;
insert into c505_out values ('failsoft', pg_temp.failsoft_probe());
select is(split_part((select v from c505_out where k = 'failsoft'), '|', 1)::jsonb,
  '{"user_id": "c5050000-0000-4000-8000-000000000109", "keys_revoked": 0, "invites_revoked": 0, "webhooks_disabled": 0, "sessions_revoked": null}'::jsonb,
  'with the session delete refused, remove_member still succeeds and reports sessions_revoked = null');
select is(split_part((select v from c505_out where k = 'failsoft'), '|', 2), 'removed',
  'the refusal never undoes the removal: the membership is removed');
select is(split_part((select v from c505_out where k = 'failsoft'), '|', 3), '1',
  'the session the database refused to delete is still there (the 900 s token is then the bound)');
select is(split_part((select v from c505_out where k = 'failsoft'), '|', 4), 'true',
  'the audit row records sessions_revoked as null');
select ok(not exists (select 1 from pg_trigger where tgname = 'c505_refuse_session_delete')
          and (select status from public.memberships where id = 'c5050000-0000-4000-8000-00000000a109') = 'active',
  'the fault and the probe left nothing behind');

-- 5. Status in the helper bodies (acceptance 4): the nurse is removed (only clinic A), her JWT is still valid ------------
insert into c505_out values ('nurse', pg_temp.exec_as('c5050000-0000-4000-8000-000000000101', null,
  $$ select public.remove_member('c5050000-0000-4000-8000-00000000a106', 'Synthetic reason')::text $$));
select ok((select v like '{%' from c505_out where k = 'nurse'), 'setup: the owner removed the nurse');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000106', null, $$ select coalesce(authz.active_tenant_id()::text, 'none') $$),
  'none', 'removed member: no active clinic');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000106', 'c5050000-0000-4000-8000-00000000000a',
  $$ select coalesce(authz.active_tenant_id()::text, 'none') $$),
  'none', 'removed member naming her clinic in the header: still no active clinic');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000106', null, $$ select count(*)::text from public.current_user_tenant_ids() $$),
  '0', 'removed member: no member clinic (switcher, my_tenant_access)');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000106', null, $$ select count(*)::text from public.patients $$),
  '0', 'removed member reads 0 patients');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000106', null, $$ select count(*)::text from public.visits $$),
  '0', 'removed member reads 0 visits');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000106', null, $$ select count(*)::text from public.memberships $$),
  '0', 'removed member does not even see her own membership row');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000106', null, $$ select count(*)::text from public.tenants $$),
  '0', 'removed member resolves no clinic (tenants)');
select alike(pg_temp.try_as('c5050000-0000-4000-8000-000000000106', null,
  $$ with i as (insert into public.patients (tenant_id, full_name, phone, created_by)
                values ('c5050000-0000-4000-8000-00000000000a', 'Synthetic Insert', '+919000000599', auth.uid()) returning 1)
     select count(*)::text from i $$),
  'denied:%', 'removed member cannot write a patient');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000106', null,
  $$ select public.log_audit('c5050000-0000-4000-8000-00000000000a', 'patient.view', 'patient', null, null)::text $$),
  'denied:ACTOR_INVALID', 'removed member cannot write an audit row (log_audit)');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000106', null,
  $$ select token_number::text from public.issue_queue_token('c5050000-0000-4000-8000-000000001002') $$),
  'denied:forbidden', 'removed member cannot check a patient in (issue_queue_token)');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000106', null,
  $$ select public.has_permission('c5050000-0000-4000-8000-00000000000a', 'appointments:view')::text $$),
  'false', 'removed member: has_permission is false');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000106', null,
  $$ select coalesce(public.my_tenant_access('c5050000-0000-4000-8000-00000000000a')::text, 'none') $$),
  'none', 'removed member: my_tenant_access answers nothing for the clinic');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000108', 'c5050000-0000-4000-8000-00000000000a',
  $$ select coalesce(authz.active_tenant_id()::text, 'none') || '/' || (select count(*) from public.patients) $$),
  'none/0', 'suspended member (header A): no active clinic, 0 patients');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000108', 'c5050000-0000-4000-8000-00000000000a',
  $$ select public.has_permission('c5050000-0000-4000-8000-00000000000a', 'consultations:view')::text $$),
  'false', 'suspended member: has_permission is false');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000302', 'c5050000-0000-4000-8000-00000000000a',
  $$ select authz.active_tenant_id()::text || '/' || (select count(*) from public.patients where tenant_id = 'c5050000-0000-4000-8000-00000000000a') $$),
  'c5050000-0000-4000-8000-00000000000b/0',
  'removed in A, active in B: the header naming A falls back to B (the sole active clinic) and A reads nothing');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000105', null,
  $$ select authz.active_tenant_id()::text || '/' || (select count(*) from public.patients) $$),
  'c5050000-0000-4000-8000-00000000000a/1', 'control: an active doctor of A is bound to A and reads the patient');

-- 6. change_member_role ignores non-active rows; consume_invitation refuses a revoked invitation ------------------------
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000101', null,
  $$ select (public.change_member_role('c5050000-0000-4000-8000-00000000a106', 'doctor')).role $$),
  'error:P0002:not_found', 'change_member_role: a removed member has no role to change');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000101', null,
  $$ select (public.change_member_role('c5050000-0000-4000-8000-00000000a108', 'nurse')).role $$),
  'error:P0002:not_found', 'change_member_role: nor a suspended one');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000106', 'c5050000-0000-4000-8000-00000000000a',
  $$ select (public.change_member_role('c5050000-0000-4000-8000-00000000a105', 'nurse')).role $$),
  'error:P0002:not_found', 'change_member_role: a removed caller changes nothing');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000101', null,
  $$ select (public.change_member_role('c5050000-0000-4000-8000-00000000a105', 'nurse')).role $$),
  'nurse', 'change_member_role: control, an active member''s role changes');
insert into c505_out values ('owner2', pg_temp.exec_as('c5050000-0000-4000-8000-000000000101', null,
  $$ select public.remove_member('c5050000-0000-4000-8000-00000000a102', 'Synthetic reason')::text $$));
select ok((select v like '{%' from c505_out where k = 'owner2'), 'an owner removes the co-owner');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000101', null,
  $$ select (public.change_member_role('c5050000-0000-4000-8000-00000000a101', 'admin')).role $$),
  'error:P0001:last_owner', 'change_member_role: a removed co-owner does not count, the remaining owner is the last one');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000101', null,
  $$ select public.remove_member('c5050000-0000-4000-8000-00000000a101', 'Synthetic reason')::text $$),
  'error:P0001:LAST_OWNER', 'remove_member: nor can the now-only owner be removed');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000501', null,
  $$ select public.consume_invitation(repeat('4', 64))::text $$),
  'c5050000-0000-4000-8000-00000000000a', 'consume_invitation: control, the invitee redeems a live invitation');
update public.invitations set revoked_at = now(), revoked_by = 'c5050000-0000-4000-8000-000000000101'
 where id = 'c5050000-0000-4000-8000-00000000f004';
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000501', null,
  $$ select public.consume_invitation(repeat('4', 64))::text $$),
  'error:P0001:INVITATION_REVOKED', 'consume_invitation: a revoked invitation is dead');
select is(pg_temp.try_as('c5050000-0000-4000-8000-000000000501', null,
  $$ select public.consume_invitation(repeat('1', 64))::text $$),
  'error:P0001:INVITATION_REVOKED', 'consume_invitation: so is the one remove_member revoked');

-- 7. session_is_live ------------------------------------------------------------------------------------------------------
insert into auth.sessions (id, user_id, created_at, updated_at, aal, not_after) values
  ('c5050000-0000-4000-8000-00000000d006', 'c5050000-0000-4000-8000-000000000105', now(), now(), 'aal1', null),
  ('c5050000-0000-4000-8000-00000000d007', 'c5050000-0000-4000-8000-000000000101', now(), now(), 'aal1', null),
  ('c5050000-0000-4000-8000-00000000d008', 'c5050000-0000-4000-8000-000000000105', now(), now(), 'aal1', now() - interval '1 minute');
select is(pg_temp.exec_as('c5050000-0000-4000-8000-000000000105', null, $$ select public.session_is_live()::text $$,
  '{"session_id": "c5050000-0000-4000-8000-00000000d006"}'), 'true', 'session_is_live: the caller''s live session');
select is(pg_temp.exec_as('c5050000-0000-4000-8000-000000000302', null, $$ select public.session_is_live()::text $$,
  '{"session_id": "c5050000-0000-4000-8000-00000000d001"}'), 'false', 'session_is_live: false for the removed user''s deleted session');
select is(pg_temp.exec_as('c5050000-0000-4000-8000-000000000105', null, $$ select public.session_is_live()::text $$,
  '{"session_id": "c5050000-0000-4000-8000-00000000d007"}'), 'false', 'session_is_live: another user''s session id does not count');
select is(pg_temp.exec_as('c5050000-0000-4000-8000-000000000105', null, $$ select public.session_is_live()::text $$,
  '{"session_id": "c5050000-0000-4000-8000-00000000d008"}'), 'false', 'session_is_live: an expired session (not_after) is not live');
select is(pg_temp.exec_as('c5050000-0000-4000-8000-000000000105', null, $$ select public.session_is_live()::text $$),
  'false', 'session_is_live: no session_id claim is not live');
select is(pg_temp.exec_as('c5050000-0000-4000-8000-000000000105', null, $$ select public.session_is_live()::text $$,
  '{"session_id": "not-a-session-id"}'), 'false', 'session_is_live: a malformed session_id is not live (no cast error)');
select is(pg_temp.exec_as(null, null, $$ select public.session_is_live()::text $$),
  'denied:permission denied for function session_is_live', 'session_is_live: anon cannot execute it');

select * from finish();
rollback;
