-- Migration: 000067_api_key_scope_guard.sql
-- V2-05 plan 05-06 (P1-11; rulings 01-09, R-13, R-42; threat T-05-19). Follow-up to 000062.
--
-- `api_keys.scopes` (000062) gates the `/api/v1` patient export on `exports:create`. The api_keys INSERT/UPDATE
-- policies admit `clinic:manage` (owners and admins), but `exports:create` is the owner's alone (ruling 01-09): without
-- this guard an admin could give a key the scope through the Data API and export what the admin may not export in the
-- app. `private.api_keys_scope_guard` (BEFORE INSERT OR UPDATE OF scopes): a signed-in caller may ADD a scope only if
-- they hold that scope's permission in the key's clinic, which must be the active clinic (`public.has_permission`,
-- R-42); else 42501 API_KEY_SCOPE_FORBIDDEN. Removing a scope is always allowed; system writers (no JWT user: service
-- role, postgres, the operator runbook) are not limited. SECURITY INVOKER (has_permission is the definer); no API grant.
-- The `auth.uid()` test is its own statement (05-02c wave note: PostgreSQL checks EXECUTE on every function of an
-- expression when it starts). Machine reason registered in `lib/db/errors.ts`.

CREATE FUNCTION private.api_keys_scope_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_scope TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
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

CREATE TRIGGER api_keys_scope_guard
BEFORE INSERT OR UPDATE OF scopes ON public.api_keys
FOR EACH ROW
EXECUTE FUNCTION private.api_keys_scope_guard();
