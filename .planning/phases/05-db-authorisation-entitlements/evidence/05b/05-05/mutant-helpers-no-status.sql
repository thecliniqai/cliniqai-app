-- 05-05 mutant: the 000086 helper bodies (no membership status filter).
-- 2. Helper bodies (R-14: same signatures, volatility, definer flag, search_path and ACL) ------------------------------
CREATE OR REPLACE FUNCTION authz.active_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_headers TEXT := NULLIF(current_setting('request.headers', true), '');
    v_named TEXT;
    v_tenant UUID;
    v_only UUID[];
BEGIN
    IF v_uid IS NULL THEN
        RETURN NULL;
    END IF;

    -- Nested, so the cast runs only on valid JSON (AND does not promise an evaluation order).
    IF v_headers IS NOT NULL AND pg_catalog.pg_input_is_valid(v_headers, 'json') THEN
        IF pg_catalog.json_typeof(v_headers::json) = 'object' THEN
            v_named := v_headers::json ->> 'x-clinicos-tenant';
        END IF;
    END IF;

    -- 05-05: only an ACTIVE membership can be the active clinic (a removed/suspended one is as if absent).
    IF v_named ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN
        SELECT m.tenant_id INTO v_tenant
          FROM public.memberships m
         WHERE m.user_id = v_uid
           AND m.tenant_id = v_named::UUID
;
        IF v_tenant IS NOT NULL THEN
            RETURN v_tenant;
        END IF;
    END IF;

    SELECT ARRAY(
        SELECT m.tenant_id FROM public.memberships m WHERE m.user_id = v_uid LIMIT 2
    ) INTO v_only;
    IF pg_catalog.cardinality(v_only) = 1 THEN
        RETURN v_only[1];
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION authz.member_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT m.tenant_id
      FROM public.memberships m
     WHERE m.user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION authz.full_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT m.tenant_id
      FROM public.memberships m
     WHERE m.user_id = auth.uid()
       AND m.tenant_id = authz.active_tenant_id()
$$;

CREATE OR REPLACE FUNCTION authz.tenant_ids_with(p_perm TEXT)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT m.tenant_id
      FROM public.memberships m
     WHERE m.user_id = auth.uid()
       AND m.tenant_id IN (SELECT authz.full_tenant_ids())
       AND authz.role_has_permission(m.role, p_perm)
$$;

CREATE OR REPLACE FUNCTION authz.billing_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT m.tenant_id
      FROM public.memberships m
     WHERE m.user_id = auth.uid()
       AND m.tenant_id = authz.active_tenant_id()
       AND m.role IN ('owner', 'admin')
$$;

