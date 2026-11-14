-- invitation_binding.test.sql — V2-05 fix plan 05-11b, finding H-INVITE (05a review RLS H-1), migration 000071.
-- Before 000071 an admin (staff:invite) could read the pending owner invitation's token_hash and redeem it from a
-- second account of their own, which became an owner. Now:
--   1. token_hash is not readable by authenticated (column grants); the other columns still are (staff page);
--   2. consume_invitation needs the caller's CONFIRMED email to equal the invited address; the hash alone is not
--      enough; the invitee still joins with the invited role, exactly once.
-- Synthetic data only (example.test addresses, repeat()-built hashes); every probe and the file roll back.
begin;
select plan(14);

-- Fixtures ---------------------------------------------------------------------------------------------------------
-- Clinic A: owner (OA), admin (AD). Accounts with no membership: the admin's second account (SP), the invited
-- partner (INV, confirmed), an unconfirmed holder of the invited address of a second invitation (UNC).
insert into auth.users (id, email, email_confirmed_at) values
  ('b11b0000-0000-4000-8000-000000000101', 'b11b-owner-a@example.test', now()),
  ('b11b0000-0000-4000-8000-000000000102', 'b11b-admin-a@example.test', now()),
  ('b11b0000-0000-4000-8000-000000000103', 'b11b-admin-second@example.test', now()),
  ('b11b0000-0000-4000-8000-000000000104', 'B11B-Partner@Example.test', now()),
  ('b11b0000-0000-4000-8000-000000000105', 'b11b-unconfirmed@example.test', null);
insert into public.tenants (id, name) values ('b11b0000-0000-4000-8000-00000000000a', 'Synthetic 05-11b Clinic A');
insert into public.memberships (user_id, tenant_id, role) values
  ('b11b0000-0000-4000-8000-000000000101', 'b11b0000-0000-4000-8000-00000000000a', 'owner'),
  ('b11b0000-0000-4000-8000-000000000102', 'b11b0000-0000-4000-8000-00000000000a', 'admin');
-- The owner's pending "owner" invitation for the partner, and a doctor invitation for the unconfirmed address.
insert into public.invitations (id, tenant_id, role, invited_address, token_hash, expires_at, created_by) values
  ('b11b0000-0000-4000-8000-000000001001', 'b11b0000-0000-4000-8000-00000000000a', 'owner', 'b11b-partner@example.test',
   repeat('d', 64), now() + interval '7 days', 'b11b0000-0000-4000-8000-000000000101'),
  ('b11b0000-0000-4000-8000-000000001002', 'b11b0000-0000-4000-8000-00000000000a', 'doctor', 'b11b-unconfirmed@example.test',
   repeat('e', 64), now() + interval '7 days', 'b11b0000-0000-4000-8000-000000000101');

-- Helper: the single value p_sql returns as the user with the x-clinicos-tenant header (none when null);
-- 'denied:<message>' for 42501, 'error:<sqlstate>:<message>' otherwise. Always rolled back.
create function pg_temp.val_as(p_user uuid, p_header uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    perform set_config('request.headers',
      case when p_header is null then '' else json_build_object('x-clinicos-tenant', p_header)::text end, true);
    set local role authenticated;
    execute p_sql into v_out;
    raise exception 'b11b sentinel' using errcode = 'P0S11';
  exception
    when sqlstate 'P0S11' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

-- As the user, in a subtransaction that is KEPT (for the consume that must stick): returns the value or the error.
create function pg_temp.keep_as(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare
  v_out text;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '', true);
  begin
    set local role authenticated;
    execute p_sql into v_out;
    reset role;
  exception
    when insufficient_privilege then reset role; v_out := 'denied:' || sqlerrm;
    when others then reset role; v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

-- 1. token_hash is not readable ------------------------------------------------------------------------------------
select is(pg_temp.val_as('b11b0000-0000-4000-8000-000000000102', 'b11b0000-0000-4000-8000-00000000000a',
  $$select token_hash from public.invitations where id = 'b11b0000-0000-4000-8000-000000001001'$$),
  'denied:permission denied for table invitations', 'an admin cannot read the owner invitation''s token_hash (H-INVITE)');
select is(pg_temp.val_as('b11b0000-0000-4000-8000-000000000101', 'b11b0000-0000-4000-8000-00000000000a',
  $$select token_hash from public.invitations where id = 'b11b0000-0000-4000-8000-000000001001'$$),
  'denied:permission denied for table invitations', 'not even the owner reads a token_hash back');
select is(pg_temp.val_as('b11b0000-0000-4000-8000-000000000102', 'b11b0000-0000-4000-8000-00000000000a',
  $$select count(*)::text from public.invitations where token_hash = repeat('d', 64)$$),
  'denied:permission denied for table invitations', 'nor filter on it (no oracle)');
select is(pg_temp.val_as('b11b0000-0000-4000-8000-000000000102', 'b11b0000-0000-4000-8000-00000000000a',
  $$select string_agg(role || '/' || invited_address, ',' order by role) from public.invitations$$),
  'doctor/b11b-unconfirmed@example.test,owner/b11b-partner@example.test',
  'the staff page columns stay readable for staff:invite');
select ok(not has_column_privilege('authenticated', 'public.invitations', 'token_hash', 'SELECT')
          and has_column_privilege('authenticated', 'public.invitations', 'token_hash', 'INSERT')
          and not has_table_privilege('anon', 'public.invitations', 'SELECT'),
  'catalogue: no SELECT on token_hash for authenticated (INSERT kept), nothing for anon');

-- 2. consume_invitation binds the invitee ---------------------------------------------------------------------------
select is(pg_temp.val_as('b11b0000-0000-4000-8000-000000000103', null,
  $$select public.consume_invitation(repeat('d', 64))::text$$),
  'denied:INVITATION_EMAIL_MISMATCH', 'the admin''s second account cannot redeem the owner invitation (H-INVITE repro)');
select is((select count(*)::int from public.memberships where user_id = 'b11b0000-0000-4000-8000-000000000103'), 0,
  'and is not a member of the clinic');
select is(pg_temp.val_as('b11b0000-0000-4000-8000-000000000102', null,
  $$select public.consume_invitation(repeat('d', 64))::text$$),
  'denied:INVITATION_EMAIL_MISMATCH', 'nor can the admin''s own account');
select is(pg_temp.val_as('b11b0000-0000-4000-8000-000000000105', null,
  $$select public.consume_invitation(repeat('e', 64))::text$$),
  'denied:INVITATION_EMAIL_UNCONFIRMED', 'the invited address with an unconfirmed email cannot redeem yet');
select is(pg_temp.val_as('b11b0000-0000-4000-8000-000000000104', null,
  $$select public.consume_invitation(repeat('f', 64))::text$$),
  'error:P0001:Invalid invitation token', 'an unknown hash keeps its message');
select is(pg_temp.keep_as('b11b0000-0000-4000-8000-000000000104', $$select public.consume_invitation(repeat('d', 64))::text$$),
  'b11b0000-0000-4000-8000-00000000000a',
  'the invitee (confirmed, address equal ignoring case) redeems it and gets the clinic id');
select is((select role from public.memberships where user_id = 'b11b0000-0000-4000-8000-000000000104'
             and tenant_id = 'b11b0000-0000-4000-8000-00000000000a'), 'owner', 'with the invited role');
select is((select consumed_by::text from public.invitations where id = 'b11b0000-0000-4000-8000-000000001001'),
  'b11b0000-0000-4000-8000-000000000104', 'and the invitation records who consumed it');
select is(pg_temp.val_as('b11b0000-0000-4000-8000-000000000104', null,
  $$select public.consume_invitation(repeat('d', 64))::text$$),
  'error:P0001:Invitation has already been used', 'a second redemption is refused');

select * from finish();
rollback;
