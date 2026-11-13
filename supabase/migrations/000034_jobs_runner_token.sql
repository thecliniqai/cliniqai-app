-- Migration: 000034_jobs_runner_token.sql
-- V2-04 plan 04-02, ruling R-49 (supersedes R-16's revoke clause; threat T-04-02).
--
-- 000033 sent the Vault-held runner secret itself as the bearer. pg_net keeps each request in
-- net.http_request_queue until its worker sends it, and that table is readable by every database login role (owner
-- supabase_admin; the `postgres` migration role cannot revoke its grants, evidence/04-02/pg-net-revoke-probe.txt). From
-- here the secret never leaves the database: the kick sends a short-lived token
--
--     Authorization: Bearer v1.<unix_ts>.<hex hmac_sha256(key = secret, data = 'jobs-run|v1|' || unix_ts)>
--
-- and `/api/jobs/run` (lib/jobs/auth.ts) accepts it only within 120 s of its own clock, against the current or the
-- next secret, in constant time. Residual (accepted, R-49): a token read from the queue can be replayed for up to
-- 120 s; a replay only runs the idempotent runner over due work.
--
-- Everything else is as in 000033 (Vault names, NULL without secrets, URL and secret refusals, 30 s timeout, R-17).
-- 000033 is applied and never edited; this replaces the function body only (same signature, owner and grants).

CREATE OR REPLACE FUNCTION ops.kick_job_runner()
RETURNS BIGINT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_url TEXT;
    v_secret TEXT;
    v_ts BIGINT;
    v_token TEXT;
BEGIN
    SELECT s.decrypted_secret INTO v_url
      FROM vault.decrypted_secrets s
     WHERE s.name = 'jobs_runner_url'
     ORDER BY s.created_at DESC
     LIMIT 1;
    SELECT s.decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets s
     WHERE s.name = 'jobs_runner_secret'
     ORDER BY s.created_at DESC
     LIMIT 1;

    -- Not configured (local stacks, CI): no request.
    IF v_url IS NULL OR v_secret IS NULL OR btrim(v_url) = '' OR btrim(v_secret) = '' THEN
        RETURN NULL;
    END IF;

    -- https anywhere; plain http only to a loopback or Docker-host name. No userinfo, no IPv6 literal, no whitespace.
    IF NOT (
        v_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[!-~]*)?$'
        OR v_url ~ '^http://(127\.0\.0\.1|localhost|host\.docker\.internal)(:[0-9]{1,5})?(/[!-~]*)?$'
    ) THEN
        RAISE EXCEPTION 'jobs_runner_url_refused' USING ERRCODE = '22023';
    END IF;
    IF v_secret !~ '^[!-~]+$' OR char_length(v_secret) NOT BETWEEN 32 AND 512 THEN
        RAISE EXCEPTION 'jobs_runner_secret_refused' USING ERRCODE = '22023';
    END IF;

    -- R-49: a token derived from the secret, never the secret. clock_timestamp(): the wall clock when the request is
    -- built (the cron transaction is short; pg_net sends right after it commits).
    v_ts := floor(extract(epoch FROM clock_timestamp()))::BIGINT;
    v_token := 'v1.' || v_ts::TEXT || '.'
        || encode(extensions.hmac('jobs-run|v1|' || v_ts::TEXT, v_secret, 'sha256'), 'hex');

    RETURN net.http_post(
        url := v_url,
        body := jsonb_build_object('source', 'pg_cron'),
        params := '{}'::jsonb,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
        timeout_milliseconds := 30000
    );
END;
$$;

COMMENT ON FUNCTION ops.kick_job_runner() IS
    'V2-04 04-02 (R-17, R-49): POSTs {"source":"pg_cron"} to the Vault-held jobs_runner_url with the bearer '
    'v1.<unix_ts>.<hex hmac_sha256(jobs_runner_secret, ''jobs-run|v1|'' || unix_ts)> (pg_net, 30 s timeout); the secret '
    'itself never leaves the database. Returns the pg_net request id, or NULL without a request when either secret is '
    'missing. Refuses a non-https URL (loopback/Docker host excepted) and a malformed secret. pg_cron only; no API role.';

REVOKE ALL ON FUNCTION ops.kick_job_runner() FROM PUBLIC, anon, authenticated, service_role;
