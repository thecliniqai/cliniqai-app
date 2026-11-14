-- Migration: 000073_api_keys_notices_columns.sql
-- V2-05 fix plan 05-11b, findings M-APIKEY (05a review RLS M-1, IND M4, INT L-6) and M-NOTICE (RLS M-2, IND M3).
-- Root cause of both: the row policies were right, but a table-wide UPDATE grant let a member write every column.
--
-- M-APIKEY. Before: `authenticated` held UPDATE on every api_keys column and 000067's scope guard fired only on
-- `UPDATE OF scopes`, so an admin could point the owner's export-scoped key at a secret they know (`key_hash`),
-- un-revoke a revoked key and keep `created_by` as the owner; DELETE nulled the key's audit attribution.
--   1. UPDATE is limited to `name`, `revoked_at` and `updated_at` (column grants); DELETE is revoked and
--      `api_keys_delete` dropped (keys are revoked, never deleted, so `audit_logs.api_key_id` survives; matrix:
--      rpc_only).
--   2. `private.api_keys_scope_guard` now fires BEFORE INSERT OR UPDATE of ANY column (the function keeps its name).
--      On the user path (a session, `auth.uid()` set):
--        - INSERT: `created_by` must be the caller (42501 API_KEY_ACTOR_INVALID);
--        - UPDATE: `id`, `tenant_id`, `key_hash`, `key_prefix`, `created_by`, `created_at` never change
--          (42501 API_KEY_IMMUTABLE); a revoked key stays revoked at its revocation time (42501 API_KEY_REVOKED);
--        - both: adding a scope needs that permission in the key's clinic, the active clinic (000067, unchanged).
--      System writers (service role: the v1 authenticator's `last_used_at`, seeds, the runbook) are not limited.
--
-- M-NOTICE. Before: `authenticated` held UPDATE on every in_app_notifications column, so any recipient of a broadcast
-- or role notice could rewrite its title, message and link for every colleague (phishing `link_url` in the drawer).
--   3. UPDATE is limited to the read columns `is_read`, `read_at` (column grants). Content, addressing and links are
--      written only by the system paths (service role; INSERT was already revoked, 000059).
--   4. `in_app_notifications_update` WITH CHECK now mirrors USING (the recipient rule), not just the tenant.
--   5. `in_app_notifications_link_url_relative` CHECK (NOT VALID: new rows only): a link is an in-app path
--      (`/...`, never `//host` or `/\host`). Every writer in the app already uses relative paths; VALIDATE is a
--      05-b0 contract step.
-- Per-migration checklist: no new table or function; grants only narrow; no data changed. Expand-safe: the app updates
-- only `revoked_at`/`updated_at` (revoke) and `is_read`/`read_at` (mark read), and never deletes a key.

-- 1. api_keys grants ---------------------------------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON public.api_keys FROM anon, authenticated;
GRANT UPDATE (name, revoked_at, updated_at) ON public.api_keys TO authenticated;
DROP POLICY api_keys_delete ON public.api_keys;

-- 2. api_keys guard on every path ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.api_keys_scope_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_scope TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.created_by IS DISTINCT FROM v_uid THEN
            RAISE EXCEPTION 'API_KEY_ACTOR_INVALID' USING ERRCODE = '42501';
        END IF;
    ELSE
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
           OR NEW.key_hash IS DISTINCT FROM OLD.key_hash
           OR NEW.key_prefix IS DISTINCT FROM OLD.key_prefix
           OR NEW.created_by IS DISTINCT FROM OLD.created_by
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'API_KEY_IMMUTABLE' USING ERRCODE = '42501';
        END IF;
        IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
            RAISE EXCEPTION 'API_KEY_REVOKED' USING ERRCODE = '42501';
        END IF;
    END IF;

    FOREACH v_scope IN ARRAY coalesce(NEW.scopes, '{}'::TEXT[]) LOOP
        IF TG_OP = 'INSERT' OR NOT (v_scope = ANY (coalesce(OLD.scopes, '{}'::TEXT[]))) THEN
            IF NOT public.has_permission(NEW.tenant_id, v_scope) THEN
                RAISE EXCEPTION 'API_KEY_SCOPE_FORBIDDEN' USING ERRCODE = '42501';
            END IF;
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.api_keys_scope_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER api_keys_scope_guard ON public.api_keys;
CREATE TRIGGER api_keys_scope_guard
BEFORE INSERT OR UPDATE ON public.api_keys
FOR EACH ROW
EXECUTE FUNCTION private.api_keys_scope_guard();

-- 3. in_app_notifications grants ----------------------------------------------------------------------------------------
REVOKE UPDATE ON public.in_app_notifications FROM anon, authenticated;
GRANT UPDATE (is_read, read_at) ON public.in_app_notifications TO authenticated;

-- 4. UPDATE policy: WITH CHECK = USING ----------------------------------------------------------------------------------
DROP POLICY in_app_notifications_update ON public.in_app_notifications;
CREATE POLICY in_app_notifications_update ON public.in_app_notifications
    FOR UPDATE TO authenticated
    USING (
        tenant_id IN (SELECT authz.full_tenant_ids())
        AND (
            recipient_user_id = (SELECT auth.uid())
            OR (
                recipient_user_id IS NULL
                AND (
                    recipient_role IS NULL
                    OR EXISTS (
                        SELECT 1
                          FROM public.memberships m
                         WHERE m.tenant_id = in_app_notifications.tenant_id
                           AND m.user_id = (SELECT auth.uid())
                           AND (m.role = in_app_notifications.recipient_role
                                OR (m.role IN ('owner', 'admin')
                                    AND in_app_notifications.recipient_role IN ('owner', 'admin', 'receptionist')))
                    )
                )
            )
        )
    )
    WITH CHECK (
        tenant_id IN (SELECT authz.full_tenant_ids())
        AND (
            recipient_user_id = (SELECT auth.uid())
            OR (
                recipient_user_id IS NULL
                AND (
                    recipient_role IS NULL
                    OR EXISTS (
                        SELECT 1
                          FROM public.memberships m
                         WHERE m.tenant_id = in_app_notifications.tenant_id
                           AND m.user_id = (SELECT auth.uid())
                           AND (m.role = in_app_notifications.recipient_role
                                OR (m.role IN ('owner', 'admin')
                                    AND in_app_notifications.recipient_role IN ('owner', 'admin', 'receptionist')))
                    )
                )
            )
        )
    );

-- 5. Relative links only (new rows) --------------------------------------------------------------------------------------
ALTER TABLE public.in_app_notifications
    ADD CONSTRAINT in_app_notifications_link_url_relative
    CHECK (link_url IS NULL OR link_url ~ '^/([^/\\]|$)') NOT VALID;
