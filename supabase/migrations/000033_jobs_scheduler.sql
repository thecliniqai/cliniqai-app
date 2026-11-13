-- Migration: 000033_jobs_scheduler.sql
-- V2-04 plan 04-02: the scheduler (P0-12, C22, RL-23; rulings R-12, R-16, R-17, R-21, R-32, R-34; threats T-04-01,
-- T-04-02, T-04-18, T-04-20).
--
-- pg_cron → ops.kick_job_runner() → Vault → pg_net → POST /api/jobs/run, every minute (R-12), plus the reaper and the
-- cron-history cleanup. Defined here so the schedule lives in the repo (C22).
--
--   * Both extensions are created here. A project without them fails this migration loudly (R-34: the PO confirms
--     availability on the staging Free project, 04-P1, before approving the migrate run).
--   * The runner URL and its bearer secret live only in Supabase Vault (`jobs_runner_url`, `jobs_runner_secret`), set
--     per environment by the PO (04-P9), never in a migration or in git. Without both the kick is a no-op: local stacks
--     and CI have no secrets, so the every-minute job sends nothing there.
--   * pg_net's default request timeout is 2 s; the runner's budget is 25 s, so the request waits 30 s (R-17).
--   * The URL must be https, or plain http to a loopback/Docker-host name (local end-to-end check only, R-21). The
--     secret must be at least 32 printable characters without spaces (no header injection).
--
-- R-16 (revoke `net` from API roles), as built: pg_net's objects are owned by `supabase_admin`, which also grants
-- USAGE/EXECUTE on them to anon/authenticated (Supabase's `grant_pg_net_access` event trigger) and leaves the queue
-- tables to PUBLIC. Migrations run as `postgres`, which is neither superuser nor the grantor, so `REVOKE … FROM anon,
-- authenticated` is a no-op here ("WARNING: no privileges could be revoked"; evidence/04-02/pg-net-revoke-probe.txt).
-- No such statement is shipped: it would read as a control that does not exist. What holds instead (asserted by
-- tests/jobs/scheduler-migration-db.spec.ts): `net` is not an API schema (PostgREST refuses it for anon and a signed-in
-- user), no function in an API schema references `net.`, only ops.kick_job_runner() reads the runner secret and no
-- API role can execute it or read Vault, the secret authorises nothing but the idempotent runner (never the service
-- key), and it sits in
-- net.http_request_queue only until the pg_net worker sends the request. The residual is raised for a ruling in
-- 04-02-SCHEDULER.md.
--
-- pg_cron runs in GMT on Supabase: `15 0 * * *` is 05:45 IST (docs/runbooks/jobs.md).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. The kick: Vault → pg_net (owner `postgres`; pg_cron runs it as `postgres`)
-- ---------------------------------------------------------------------------------------------------------------------

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

    RETURN net.http_post(
        url := v_url,
        body := jsonb_build_object('source', 'pg_cron'),
        params := '{}'::jsonb,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
        timeout_milliseconds := 30000
    );
END;
$$;

COMMENT ON FUNCTION ops.kick_job_runner() IS
    'V2-04 04-02: POSTs {"source":"pg_cron"} to the Vault-held jobs_runner_url with the Vault-held jobs_runner_secret as '
    'bearer (pg_net, 30 s timeout, R-17); returns the pg_net request id, or NULL without a request when either secret is '
    'missing. Refuses a non-https URL (loopback/Docker host excepted) and a malformed secret. pg_cron only; no API role.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Drill enqueue (SQL editor only, R-32)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.drill_enqueue(
    p_kind TEXT,
    p_count INTEGER DEFAULT 1,
    p_spread INTERVAL DEFAULT '0',
    p_max_attempts INTEGER DEFAULT 2
)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_i INTEGER;
BEGIN
    IF p_kind IS NULL OR p_kind !~ '^drill\.[a-z_]+$' OR char_length(p_kind) > 64 THEN
        RAISE EXCEPTION 'drill_kind_refused' USING ERRCODE = '22023';
    END IF;
    IF p_count IS NULL OR p_count NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'drill_count_out_of_range' USING ERRCODE = '22023';
    END IF;
    IF p_spread IS NULL OR p_spread < interval '0' OR p_spread > interval '1 day' THEN
        RAISE EXCEPTION 'drill_spread_out_of_range' USING ERRCODE = '22023';
    END IF;
    IF p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 20 THEN
        RAISE EXCEPTION 'drill_max_attempts_out_of_range' USING ERRCODE = '22023';
    END IF;

    FOR v_i IN 1..p_count LOOP
        PERFORM ops.enqueue_job(
            p_kind,
            NULL,
            '{}'::jsonb,
            'drill:' || p_kind || ':' || gen_random_uuid()::text,
            now() + CASE WHEN p_count = 1 THEN interval '0'
                         ELSE p_spread * ((v_i - 1)::double precision / (p_count - 1)) END,
            p_max_attempts
        );
    END LOOP;
    RETURN p_count;
END;
$$;

COMMENT ON FUNCTION ops.drill_enqueue(TEXT, INTEGER, INTERVAL, INTEGER) IS
    'V2-04 04-02 (R-32): enqueues p_count jobs of a drill.* kind (empty payload, no tenant, dedupe drill:<kind>:<uuid>), '
    'run_at spread evenly over p_spread. The app runs drill kinds only with JOBS_DRILL_ENABLED=true (refused in '
    'production). Executable by postgres only (SQL editor).';

REVOKE ALL ON FUNCTION ops.kick_job_runner() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.drill_enqueue(TEXT, INTEGER, INTERVAL, INTEGER) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Schedules (name-keyed: re-applying updates the row instead of adding one)
-- ---------------------------------------------------------------------------------------------------------------------

SELECT cron.schedule('jobs-kick', '* * * * *', 'select ops.kick_job_runner()');
SELECT cron.schedule('jobs-reap', '* * * * *', 'select ops.reap_jobs()');
-- Pitfall 10: pg_cron never trims its own history (1 440+ rows a day per job on a 500 MB database, T-04-18).
SELECT cron.schedule(
    'cron-history-cleanup',
    '15 0 * * *',
    $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);
