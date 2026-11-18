-- 05-12 mutant: the pre-fix period rule (000091) behind the new helper: the clinic's own zone via tenant_local_date.
CREATE OR REPLACE FUNCTION private.ai_period(p_tenant uuid, p_at timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN s.status = 'trialing' AND s.trial_start IS NOT NULL
            THEN 'trial:' || to_char(public.tenant_local_date(p_tenant, s.trial_start), 'YYYY-MM-DD')
        ELSE to_char(public.tenant_local_date(p_tenant, p_at), 'YYYY-MM') END
      FROM (SELECT 1) one
      LEFT JOIN public.tenant_subscriptions s ON s.tenant_id = p_tenant
$$;
