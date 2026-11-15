-- 05-07a mutant: inviter role from any membership of the clinic (no active-clinic binding, no staff:invite, no status).
CREATE OR REPLACE FUNCTION private.invitation_inviter_role(p_tenant UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT m.role
      FROM public.memberships m
     WHERE m.user_id = auth.uid()
       AND m.tenant_id = p_tenant
       AND m.role IN ('owner', 'admin', 'receptionist')
$$;
