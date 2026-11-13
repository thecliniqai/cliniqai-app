-- Migration: 000030_session_age_token_hook.sql
-- V2-03 plan 03-13e: review finding H-AUTH residual (03-13-REVIEW-TRIAGE.md; review IND H-1, review D H-1).
--
-- Expand only: three new functions in `private` and USAGE on `private` for supabase_auth_admin. No table, column or
-- row changes.
--
-- The problem. A session established with an emailed code (OTP sign-in, recovery, invite, magic link, signup or
-- email-change verification) proves control of the mailbox, not knowledge of the password, and Supabase lets such a
-- session change the password through `PUT /auth/v1/user` without the current one. 03-13a bounded it in the app:
-- proxy.ts ends an emailed-code session 600 s after the code was used, and a completed reset signs out (R-35). GoTrue
-- itself had no bound: a stolen refresh token from such a session could be refreshed straight at GoTrue, never
-- touching the app, and the fresh access token used for `PUT /auth/v1/user` at any age.
--
-- The fix, at the token issuer. `private.session_age_token_hook` is a Supabase Auth Custom Access Token hook
-- (`[auth.hook.custom_access_token]` in supabase/config.toml; staging/production enable it in the dashboard, PO
-- action 03-E3). GoTrue calls it, as `supabase_auth_admin`, before it signs EVERY access token: sign-in, code
-- verification and refresh. The hook reads only the event's `claims.amr` (GoTrue builds it from
-- auth.mfa_amr_claims; the timestamp of a factor never moves on refresh) and the database clock:
--   * an emailed-code factor is every `amr` method NOT in private.session_age_non_mailbox_methods() (password and
--     the MFA factors); an unknown method counts as an emailed code (fail closed, 03-13a L-2);
--   * a password factor LATER than the newest emailed-code factor makes it a password session: unchanged;
--   * an emailed-code session whose newest emailed-code factor is more than private.session_age_fresh_seconds()
--     (600) old gets an error, so GoTrue refuses to mint the token (the refresh fails with 403);
--   * a younger one is passed through unchanged (its access token keeps the normal 900 s lifetime: GoTrue reports the
--     session's `expires_at` from its own config, not from a hook-lowered `exp`, so capping `exp` here would make every
--     client and the proxy disagree with GoTrue about expiry; see 03-13e-TOKEN-HOOK.md);
--   * an `amr` that is missing, empty or malformed: refused (fail closed).
-- The list and the 600 s are the same as lib/auth/session-age.ts (NON_MAILBOX_METHODS, FRESH_MAILBOX_SESSION_SECONDS);
-- tests/auth/session-age-token-hook-db.spec.ts fails if they drift apart.
--
-- No test switch: the hook reads now(). Tests craft the hook input (old amr timestamps) or age a real session's
-- auth.mfa_amr_claims row on the local stack.
--
-- Privileges (Supabase Auth hooks guidance): SECURITY INVOKER (runs as supabase_auth_admin, which needs nothing but
-- the event), search_path pinned to '', EXECUTE for supabase_auth_admin only, revoked from PUBLIC, anon, authenticated
-- and service_role. `private` is not served by PostgREST.

GRANT USAGE ON SCHEMA private TO supabase_auth_admin;

-- ---------------------------------------------------------------------------------------------------------------------
-- Shared constants (mirrored by lib/auth/session-age.ts)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.session_age_non_mailbox_methods()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT ARRAY['password', 'totp', 'mfa/totp', 'mfa/phone', 'mfa/webauthn']::TEXT[];
$$;

COMMENT ON FUNCTION private.session_age_non_mailbox_methods() IS
    'V2-03 03-13e: amr methods that are not an emailed code (= lib/auth/session-age.ts NON_MAILBOX_METHODS). Any other '
    'method, known or not, counts as an emailed code.';

CREATE OR REPLACE FUNCTION private.session_age_fresh_seconds()
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT 600;
$$;

COMMENT ON FUNCTION private.session_age_fresh_seconds() IS
    'V2-03 03-13e: seconds an emailed-code session may live after the code was used (A00-5, AUTH §3.5; = '
    'lib/auth/session-age.ts FRESH_MAILBOX_SESSION_SECONDS).';

-- ---------------------------------------------------------------------------------------------------------------------
-- The Custom Access Token hook
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.session_age_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_claims JSONB := event -> 'claims';
    v_amr JSONB := event -> 'claims' -> 'amr';
    v_non_mailbox TEXT[] := private.session_age_non_mailbox_methods();
    v_entry JSONB;
    v_method TEXT;
    v_ts NUMERIC;
    v_newest_mailbox NUMERIC;
    v_newest_password NUMERIC;
    v_deadline NUMERIC;
    v_refused CONSTANT JSONB := jsonb_build_object(
        'error', jsonb_build_object('http_code', 403, 'message', 'Session expired. Sign in again.')
    );
BEGIN
    IF jsonb_typeof(v_claims) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_amr) IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_amr) = 0 THEN
        RETURN v_refused;
    END IF;

    FOR v_entry IN SELECT e.value FROM jsonb_array_elements(v_amr) AS e(value) LOOP
        IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
           OR jsonb_typeof(v_entry -> 'method') IS DISTINCT FROM 'string'
           OR jsonb_typeof(v_entry -> 'timestamp') IS DISTINCT FROM 'number' THEN
            RETURN v_refused;
        END IF;
        v_method := v_entry ->> 'method';
        v_ts := (v_entry ->> 'timestamp')::NUMERIC;
        IF v_method = ANY (v_non_mailbox) THEN
            IF v_method = 'password' THEN
                v_newest_password := greatest(v_newest_password, v_ts);
            END IF;
        ELSE
            v_newest_mailbox := greatest(v_newest_mailbox, v_ts);
        END IF;
    END LOOP;

    -- No emailed-code factor, or the password was proven after it: a password session, left alone.
    IF v_newest_mailbox IS NULL OR (v_newest_password IS NOT NULL AND v_newest_password > v_newest_mailbox) THEN
        RETURN event;
    END IF;

    v_deadline := v_newest_mailbox + private.session_age_fresh_seconds();
    IF extract(epoch FROM now()) > v_deadline THEN
        RETURN v_refused;
    END IF;
    RETURN event;
END;
$$;

COMMENT ON FUNCTION private.session_age_token_hook(JSONB) IS
    'V2-03 03-13e (H-AUTH): Supabase Auth Custom Access Token hook. Refuses to mint a token for an emailed-code session '
    'more than 600 s after the code (unknown amr methods count as emailed codes; unreadable amr refused). Otherwise the '
    'event is returned unchanged.';

REVOKE ALL ON FUNCTION private.session_age_non_mailbox_methods() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.session_age_fresh_seconds() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.session_age_token_hook(JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.session_age_non_mailbox_methods() TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.session_age_fresh_seconds() TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.session_age_token_hook(JSONB) TO supabase_auth_admin;
