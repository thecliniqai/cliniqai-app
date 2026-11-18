-- Migration: 000086_drop_v1_subscription_tables.sql
-- V2-05 plan 05-09c step 2 (SUB-01 "drop v1 subscriptions/payment_records"; rulings R-10, R-36; research §E).
--
-- The v1 SaaS tables `public.subscriptions` and `public.payment_records` are replaced by `tenant_subscriptions` and
-- `subscription_events` (05-09a); `saas_payments`/`saas_invoices` arrive with their first writer in V2-13b (R-10). Their
-- two readers (`features/billing/subscription.ts`, `app/(dashboard)/settings/billing/page.tsx`) switch to
-- `tenant_subscriptions` + `my_tenant_access` in the same commit (R-36: the staging-only race on that one owner page
-- is accepted). No app path ever wrote them (no row exists locally or in staging seeds; production is new). Nothing
-- depends on them: no FK points at either table, no view, and no function body names them except the test-only RLS
-- catalogue helper below. Contract-only: the drop is the named destructive statement of this plan.
--
-- `public.get_tenant_table_rls_policies()` (000005, service_role only; `tests/helpers/rls.ts`) lists the tenant-owned
-- tables it inspects by name: the two dropped names are replaced by `tenant_subscriptions` (same signature, security,
-- search_path and grants; CREATE OR REPLACE keeps the ACL).

DROP TABLE public.payment_records;
DROP TABLE public.subscriptions;

CREATE OR REPLACE FUNCTION public.get_tenant_table_rls_policies()
 RETURNS TABLE(table_name text, rls_enabled boolean, policy_name text, roles text[], cmd text, qual text, with_check text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
  SELECT
    c.relname::TEXT AS table_name,
    c.relrowsecurity AS rls_enabled,
    p.polname::TEXT AS policy_name,
    ARRAY(SELECT rolname::TEXT FROM pg_roles WHERE oid = ANY(p.polroles)) AS roles,
    p.polcmd::TEXT AS cmd,
    pg_get_expr(p.polqual, p.polrelid) AS qual,
    pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname IN (
      'tenants',
      'memberships',
      'invitations',
      'tenant_subscriptions',
      'patients',
      'audit_logs',
      'consent_records'
    )
  ORDER BY c.relname, p.polname;
$function$;
