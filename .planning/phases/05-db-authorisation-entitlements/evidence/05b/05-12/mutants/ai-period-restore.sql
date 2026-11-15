CREATE OR REPLACE FUNCTION private.ai_period(p_tenant uuid, p_at timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN s.status = 'trialing' AND s.trial_start IS NOT NULL
            THEN 'trial:' || to_char(s.trial_start AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')
        ELSE to_char(p_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') END
      FROM (SELECT 1) one
      LEFT JOIN public.tenant_subscriptions s ON s.tenant_id = p_tenant
$$;
