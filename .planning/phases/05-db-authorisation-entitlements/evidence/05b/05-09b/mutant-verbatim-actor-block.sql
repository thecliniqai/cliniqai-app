CREATE OR REPLACE FUNCTION private.platform_actor(p_actor uuid, OUT actor uuid, OUT channel text)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
    -- The CALLER, not current_user: inside the SECURITY DEFINER RPCs current_user is always their owner.
    v_caller text := current_user;  -- MUTANT: SUB §8.1 verbatim (current_user)
BEGIN
    IF v_caller IN ('postgres', 'service_role') THEN
        -- SQL editor / service role: no JWT. p_actor is required and must be an active platform admin.
        IF p_actor IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.platform_admins a WHERE a.user_id = p_actor AND a.revoked_at IS NULL
        ) THEN
            RAISE 'PLATFORM_ACTOR_INVALID' USING ERRCODE = '42501';
        END IF;
        actor := p_actor;
        channel := 'sql';
    ELSE
        -- Any JWT caller: p_actor is IGNORED; the actor is auth.uid(), and aal2 + platform_admins are required.
        IF NOT public.is_platform_admin() THEN
            RAISE 'PLATFORM_ADMIN_REQUIRED' USING ERRCODE = '42501';
        END IF;
        actor := (SELECT auth.uid());
        channel := 'ui';
    END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.platform_actor(uuid) FROM PUBLIC, anon, authenticated, service_role;
