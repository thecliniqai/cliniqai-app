CREATE OR REPLACE FUNCTION authz.full_tenant_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    SELECT m.tenant_id
      FROM public.memberships m
     WHERE m.user_id = auth.uid()
       AND m.tenant_id = authz.active_tenant_id()
       AND billing_internal.tenant_access_level(m.tenant_id, now()) = 'full'
$function$

