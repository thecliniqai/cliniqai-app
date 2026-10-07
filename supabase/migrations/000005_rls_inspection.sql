-- Migration 000005_rls_inspection.sql
-- Catalog-level verification RPC for Row Level Security and policy assertions (Plan 01-05)

CREATE OR REPLACE FUNCTION public.get_tenant_table_rls_policies()
RETURNS TABLE (
  table_name TEXT,
  rls_enabled BOOLEAN,
  policy_name TEXT,
  roles TEXT[],
  cmd TEXT,
  qual TEXT,
  with_check TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
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
      'subscriptions',
      'payment_records',
      'patients',
      'audit_logs',
      'consent_records'
    )
  ORDER BY c.relname, p.polname;
$$;

-- Secure the function: only service_role (used by server admin & test harness) can execute
REVOKE EXECUTE ON FUNCTION public.get_tenant_table_rls_policies() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_tenant_table_rls_policies() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_tenant_table_rls_policies() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_table_rls_policies() TO service_role;
