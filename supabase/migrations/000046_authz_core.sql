-- Migration: 000046_authz_core.sql
-- V2-05 plan 05-01b (P1-01, ADR-006 / C19, PO-3, rulings R-6, R-14, R-41, R-42; V2-03 03-07 D1 finding 2).
-- Next free number after V2-04's 000045.
--
-- The fixed-signature authorisation helpers every later V2-05 policy calls, and the database's notion of the
-- session's ACTIVE tenant. No policy changes here: `public.current_user_tenant_ids()` keeps today's "any membership"
-- behaviour (now through `authz.member_tenant_ids()`), so every existing policy and RPC means what it meant before.
-- 05-02b/05-02c move each policy to the bound helpers; 05-05 (membership status) and 05-10a (access level) change
-- helper BODIES only (R-14); the signatures are pinned by supabase/tests/database/authz_helpers.test.sql.
--
-- Active tenant (R-42). `lib/supabase/server.ts` `createClient()` sends the request header `x-clinicos-tenant` = the
-- `clinic_active_tenant` cookie when it is UUID-shaped. PostgREST and the Storage API expose request headers to SQL
-- as the JSON GUC `request.headers` (lower-case names); `authz.active_tenant_id()` accepts the named tenant only when
-- the caller is a member there, otherwise the caller's only membership when there is exactly one (the rule
-- `lib/auth/tenant.ts` `getActiveMembership()` applies to the same cookie), otherwise null. A forged header can
-- therefore only name another clinic the caller already belongs to (T-05-40). Proven end to end through PostgREST and
-- Storage by tests/authz/active-tenant-carrier.spec.ts.
--
-- Permission set (PO-3, R-6): new key `billing:collect` (owner, admin, receptionist); receptionist gains
-- `patients:edit`, `billing:view`, `billing:collect`. The CASE below is `lib/permissions/matrix.ts` verbatim; the
-- parity spec (tests/permissions/has-permission-parity.spec.ts) compares them through `public.permission_matrix()`.
-- The two SQL role lists that copy `billing:view` for receipt sharing follow it (section 4), so a receptionist's
-- receipt share is not refused in SQL after the app allowed it.
-- Deviation from the plan text "owner `true`": the owner branch is `true` for every KNOWN key only, so a misspelt key
-- in a future policy denies everyone (and the generated matrix shows it) instead of silently admitting owners.
--
-- Hygiene (R-13, T-05-14): schema `authz` is not in `[api] schemas` (PostgREST cannot call it); every function has
-- `search_path = ''` and fully qualified names; EXECUTE is revoked from PUBLIC and anon on every function and granted
-- explicitly. A per-schema `ALTER DEFAULT PRIVILEGES ... REVOKE` cannot remove the built-in PUBLIC EXECUTE on new
-- functions (it only revokes per-schema grants), so instead authz_helpers.test.sql pins the exact ACL of every
-- function in `authz`: a later function created without its REVOKEs fails that test.
-- `service_role` gets USAGE on `authz` and EXECUTE on the two static functions only, so the invoker
-- `public.permission_matrix()` works for it (the parity spec); it bypasses RLS and gets nothing from the session
-- helpers (no JWT subject).

CREATE SCHEMA authz;
REVOKE ALL ON SCHEMA authz FROM PUBLIC;
GRANT USAGE ON SCHEMA authz TO authenticated, service_role;

COMMENT ON SCHEMA authz IS
    'V2-05 05-01b: fixed-signature RLS helpers (ADR-006, R-14, R-42). Not exposed through the Data API.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Static permission data (IMMUTABLE, invoker)
-- ---------------------------------------------------------------------------------------------------------------------

-- Every permission key except the wildcard `*` (lib/permissions/matrix.ts `Permission`). Expands the owner's `*` and
-- is the key list the parity spec compares with the TypeScript union.
CREATE FUNCTION authz.permission_keys()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT ARRAY[
        'clinic:manage', 'clinic:view',
        'staff:invite', 'staff:view',
        'billing:view', 'billing:collect',
        'patients:view', 'patients:edit',
        'appointments:view', 'appointments:edit',
        'prescriptions:view', 'prescriptions:edit',
        'consultations:view', 'consultations:edit',
        'vitals:view', 'vitals:edit',
        'labs:view', 'labs:edit',
        'reports:view',
        'exports:create'
    ]::TEXT[]
$$;

-- The hard-coded role -> permission CASE (C19): lib/permissions/matrix.ts `ROLE_PERMISSIONS` verbatim.
CREATE FUNCTION authz.role_has_permission(p_role TEXT, p_perm TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT COALESCE(CASE p_role
        WHEN 'owner' THEN p_perm = ANY (authz.permission_keys())
        WHEN 'admin' THEN p_perm = ANY (ARRAY[
            'clinic:manage', 'clinic:view', 'staff:invite', 'staff:view', 'billing:view', 'billing:collect',
            'patients:view', 'patients:edit', 'appointments:view', 'appointments:edit', 'reports:view'
        ]::TEXT[])
        WHEN 'doctor' THEN p_perm = ANY (ARRAY[
            'clinic:view', 'staff:view', 'patients:view', 'patients:edit', 'appointments:view', 'appointments:edit',
            'prescriptions:view', 'prescriptions:edit', 'consultations:view', 'consultations:edit', 'vitals:view',
            'vitals:edit', 'labs:view', 'labs:edit'
        ]::TEXT[])
        WHEN 'receptionist' THEN p_perm = ANY (ARRAY[
            'clinic:view', 'staff:view', 'billing:view', 'billing:collect', 'patients:view', 'patients:edit',
            'appointments:view', 'appointments:edit'
        ]::TEXT[])
        WHEN 'nurse' THEN p_perm = ANY (ARRAY[
            'clinic:view', 'staff:view', 'patients:view', 'patients:edit', 'appointments:view', 'appointments:edit',
            'consultations:view', 'vitals:view', 'vitals:edit', 'labs:view', 'labs:edit'
        ]::TEXT[])
        ELSE FALSE
    END, FALSE)
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Session helpers (STABLE, SECURITY DEFINER: they read `memberships` without RLS recursion)
-- ---------------------------------------------------------------------------------------------------------------------

-- The session's active tenant (R-42): the tenant named by the `x-clinicos-tenant` request header when the caller is a
-- member there; else the caller's only membership when there is exactly one; else null. A header that is not
-- UUID-shaped or names a clinic the caller does not belong to selects nothing by itself (no error). No JWT subject ->
-- null. 05-05 adds `status = 'active'`.
CREATE FUNCTION authz.active_tenant_id()
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

    IF v_named ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN
        SELECT m.tenant_id INTO v_tenant
          FROM public.memberships m
         WHERE m.user_id = v_uid
           AND m.tenant_id = v_named::UUID;
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

-- Every clinic the caller belongs to (the clinic switcher): used only for `tenants` SELECT and the caller's own
-- `memberships` rows (R-40), and by the `current_user_tenant_ids()` shim until 05-02c. 05-05 adds `status = 'active'`.
CREATE FUNCTION authz.member_tenant_ids()
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

-- The active tenant when it is one of the caller's memberships: 0 or 1 row, bound to the active tenant (03-07 finding
-- 2). 05-05 adds `status = 'active'`; 05-10a adds access level `full`.
CREATE FUNCTION authz.full_tenant_ids()
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

-- The policy workhorse: the full (active) tenant when the caller's role there grants `p_perm`.
CREATE FUNCTION authz.tenant_ids_with(p_perm TEXT)
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

-- SaaS billing (SUB §7.2 `current_user_billing_tenant_ids()`, R-26): the active tenant when the caller is its owner or
-- admin. 05-05 adds `status = 'active'`; 05-10a allows access levels full, locked and onboarding.
CREATE FUNCTION authz.billing_tenant_ids()
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

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Public entry points
-- ---------------------------------------------------------------------------------------------------------------------

-- ADR-006's name. Caller- and active-tenant-bound: true only when `p_tenant` is the caller's active tenant and the
-- caller's role there grants `p_perm`. For V2-07 RPCs and guard triggers; inherits 05-05/05-10a through the helpers.
CREATE FUNCTION public.has_permission(p_tenant UUID, p_perm TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p_tenant IS NOT NULL
       AND EXISTS (SELECT 1 FROM authz.tenant_ids_with(p_perm) t WHERE t = p_tenant)
$$;

-- Every (role, permission) pair the CASE grants, for the parity spec (R-41: static data, exposed on purpose).
CREATE FUNCTION public.permission_matrix()
RETURNS TABLE (role TEXT, perm TEXT)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT r.role, k.perm
      FROM unnest(ARRAY['owner', 'admin', 'doctor', 'receptionist', 'nurse']::TEXT[]) AS r(role)
     CROSS JOIN unnest(authz.permission_keys()) AS k(perm)
     WHERE authz.role_has_permission(r.role, k.perm)
     ORDER BY r.role, k.perm
$$;

-- Same signature, still SECURITY DEFINER, existing grants kept by CREATE OR REPLACE: every legacy policy and RPC that
-- calls it keeps today's "any membership" meaning. 05-02c moves every user to the bound helpers.
CREATE OR REPLACE FUNCTION public.current_user_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT authz.member_tenant_ids()
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. PO-3 knock-on: the two SQL role lists that mirror `billing:view` (receipt sharing) follow the new key set
-- ---------------------------------------------------------------------------------------------------------------------
-- Receptionists now hold `billing:view`, so the app lets them share a receipt (`shareReceiptViaWhatsApp`, guarded by
-- `billing:view`; `SHARE_LINK_PERMISSIONS.invoice`). The database's copies of that rule must agree, or the share is
-- refused in SQL after the app allowed it: `share_type_roles('invoice')` (000021; parity in
-- tests/security/review-fixes-db.spec.ts) and the `receipt_issued` template's `request_roles` (000041; parity in
-- tests/jobs/enqueue-message-rpc-db.spec.ts). Same function body otherwise; grants kept by CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.share_type_roles(p_type TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_type
        WHEN 'prescription'     THEN ARRAY['owner', 'doctor', 'nurse']
        WHEN 'invoice'          THEN ARRAY['owner', 'admin', 'doctor', 'receptionist', 'nurse']
        WHEN 'patient_document' THEN ARRAY['owner', 'admin', 'doctor', 'receptionist', 'nurse']
        WHEN 'referral'         THEN ARRAY['owner', 'admin', 'doctor', 'receptionist', 'nurse']
        WHEN 'appointment'      THEN ARRAY['owner', 'admin', 'doctor', 'receptionist', 'nurse']
        ELSE ARRAY[]::TEXT[]
    END;
$$;

-- Idempotent: sets the value, whatever it was.
UPDATE ops.message_templates
   SET request_roles = ARRAY['owner', 'admin', 'receptionist']::TEXT[]
 WHERE template_id = 'receipt_issued';

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Grants (exact; pinned by authz_helpers.test.sql)
-- ---------------------------------------------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION authz.permission_keys() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION authz.role_has_permission(TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION authz.active_tenant_id() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION authz.member_tenant_ids() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION authz.full_tenant_ids() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION authz.tenant_ids_with(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION authz.billing_tenant_ids() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.has_permission(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.permission_matrix() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION authz.permission_keys() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION authz.role_has_permission(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION authz.active_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION authz.member_tenant_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION authz.full_tenant_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION authz.tenant_ids_with(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION authz.billing_tenant_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.permission_matrix() TO authenticated, service_role;
