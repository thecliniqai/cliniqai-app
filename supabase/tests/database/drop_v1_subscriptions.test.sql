-- drop_v1_subscriptions.test.sql — V2-05 plan 05-09c step 2 (SUB-01 "drop v1 subscriptions/payment_records"; R-10,
-- R-36; migration 000086).
--   1. the v1 SaaS tables are gone (their readers moved to tenant_subscriptions + my_tenant_access in the same commit);
--   2. the test-only RLS catalogue helper inspects tenant_subscriptions instead, with its grants unchanged
--      (service_role only, SECURITY DEFINER).
-- The file rolls back.
begin;
select plan(4);

select hasnt_table('public', 'subscriptions', 'the v1 public.subscriptions table is dropped');
select hasnt_table('public', 'payment_records', 'the v1 public.payment_records table is dropped');
select set_eq(
  $$ select distinct table_name from public.get_tenant_table_rls_policies() $$,
  array['tenants', 'memberships', 'invitations', 'tenant_subscriptions', 'patients', 'audit_logs', 'consent_records']::text[],
  'get_tenant_table_rls_policies inspects tenant_subscriptions in place of the two dropped tables');
select is(
  (select p.prosecdef::text || ':' || coalesce((
            select string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ',' order by 1)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '')
     from pg_proc p where p.oid = 'public.get_tenant_table_rls_policies()'::regprocedure),
  'true:service_role', 'the replaced helper keeps SECURITY DEFINER and EXECUTE for service_role only');

select * from finish();
rollback;
