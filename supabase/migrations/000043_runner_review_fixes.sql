-- Migration: 000043_runner_review_fixes.sql
-- V2-04 plan 04-07b (review triage 04-07: M-FAIR, M-ATTEMPT, Lows L-5 and I-3 of review A). Next free number after
-- 04-07c's 000042 (R-39).
--
--   1. Attempts are counted when a handler starts, not at claim (M-ATTEMPT; review A L-1, independent review M2).
--      `claim_jobs` no longer touches `attempts`; it clears the new `started_at`. The runner calls the new fenced
--      `public.start_job(id, lease_token)` just before the handler runs: it counts the attempt, stamps `started_at` and
--      returns the attempt number (NULL when the lease is no longer this caller's, has expired, or was already started).
--      So a job claimed by a pass that crashed before reaching it (killed at 60 s, a queue RPC that failed, a poison
--      neighbour in the batch) is re-claimed after its lease with its attempts unchanged and is never dead-lettered
--      `lease_expired` without having run. Poison-pill protection (T-04-09) is unchanged for a job that did start: its
--      attempt was counted before the crash, and `ops.reap_jobs()` dead-letters it at `max_attempts` as before.
--      `release_job` hands back only an unstarted job and has no attempt to return any more. `fail_job` counts the
--      attempt itself when the job was never started (unknown kind, invalid payload, or a runner deployed before this
--      migration), so a failure always costs one attempt.
--   2. `public.defer_job(id, lease_token, code, retry_at)` (independent review M2): a handler that started but found
--      nothing to do yet (the delivery row is still `processing` under another sender, not due yet, or the row claim
--      missed) hands the job back to `retry_at` and the attempt it counted is returned. Bounded: 20 deferrals per job
--      (`ops.jobs.deferrals`); after that a deferral is an ordinary retryable failure that keeps the attempt, so a
--      job that never makes progress still reaches `max_attempts`. `retry_at` is clamped to [now + 5 s, now + 1 day].
--   3. Tenant fairness in every batch (M-FAIR; review A M-1, independent review M1): `claim_jobs` picks rows
--      round-robin across the claimed tenants (each tenant's oldest row first, then each tenant's second, ...), not
--      oldest-first across the locked rows, so a tenant with an older backlog gets at most one row more than any other
--      due tenant in a batch whatever p_per_tenant is. The runner now claims batches larger than one (see
--      lib/jobs/internal/runner.ts) and processes them in the same round-robin order.
--   4. `runner_stale` (review A L-5): the alert rule and the readiness flag count only runner passes started by the
--      scheduler (`source = 'pg_cron'`). A manual pass (runbook jobs.md §5) or a replayed token with a manual body no
--      longer hides a broken pg_cron / pg_net kick.
--   (I-3, jobs of a kind no deployment registers: already covered. `queue_oldest_due` counts every pending row
--   whatever its kind, so such a row fires it after 5 minutes; tests/jobs/runner-review-fixes-db.spec.ts proves it.)
--
-- Access: unchanged model. start_job / defer_job are SECURITY DEFINER with an empty search_path, executable by
-- service_role only (the runner); replaced functions keep their signatures and grants.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------------------------------------------------

ALTER TABLE ops.jobs
    ADD COLUMN started_at TIMESTAMPTZ,
    ADD COLUMN deferrals INTEGER NOT NULL DEFAULT 0 CONSTRAINT jobs_deferrals_check CHECK (deferrals >= 0);

COMMENT ON COLUMN ops.jobs.started_at IS
    'V2-04 04-07b (M-ATTEMPT): when the handler of the current lease started (start_job); NULL from each claim until '
    'then. An expired lease that never started is re-claimed without spending an attempt.';
COMMENT ON COLUMN ops.jobs.deferrals IS
    'V2-04 04-07b: hand-backs by defer_job that returned their attempt (at most 20 per job).';

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Claim: no attempt counted, round-robin across tenants
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_jobs(
    p_kinds TEXT[],
    p_batch INTEGER,
    p_lease_seconds INTEGER,
    p_worker TEXT,
    p_per_tenant INTEGER DEFAULT 10
)
RETURNS TABLE (
    id UUID,
    kind TEXT,
    tenant_id UUID,
    payload JSONB,
    attempts INTEGER,
    max_attempts INTEGER,
    lease_token UUID,
    run_at TIMESTAMPTZ
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
#variable_conflict use_column
DECLARE
    -- Groups the tenant-less jobs (tenant_id NULL) as one "tenant" for fairness.
    v_none CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    IF p_kinds IS NULL OR cardinality(p_kinds) NOT BETWEEN 1 AND 50
       OR p_batch IS NULL OR p_batch NOT BETWEEN 1 AND 100
       OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 900
       OR p_per_tenant IS NULL OR p_per_tenant NOT BETWEEN 1 AND 100
       OR p_worker IS NULL OR btrim(p_worker) = '' THEN
        RAISE EXCEPTION 'invalid_claim' USING ERRCODE = '22023';
    END IF;

    -- Due = pending and run_at reached, or running with an expired lease and attempts left (a crashed or timed-out
    -- runner's job; a job that never started has attempts < max_attempts by construction). The due condition is
    -- repeated inside the locking subquery so that a row another runner claimed and committed after this statement's
    -- snapshot is re-checked on its new version and skipped.
    RETURN QUERY
    WITH due_tenants AS (
        -- The tenants with the oldest due work, at most one batch of them.
        SELECT coalesce(d.tenant_id, v_none) AS t, min(d.run_at) AS oldest
        FROM ops.jobs d
        WHERE d.kind = ANY (p_kinds)
          AND ((d.status = 'pending' AND d.run_at <= now())
               OR (d.status = 'running' AND d.locked_until < now() AND d.attempts < d.max_attempts))
        GROUP BY 1
        ORDER BY 2
        LIMIT p_batch
    ),
    locked AS (
        -- Up to p_per_tenant unlocked due rows per tenant (the per-tenant LIMIT in a LATERAL; FOR UPDATE cannot share a
        -- query level with the window function below, which therefore sits in its own CTE).
        SELECT x.id, x.run_at, dt.t, dt.oldest
        FROM due_tenants dt
        CROSS JOIN LATERAL (
            SELECT j.id, j.run_at
            FROM ops.jobs j
            WHERE ((dt.t = v_none AND j.tenant_id IS NULL) OR j.tenant_id = dt.t)
              AND j.kind = ANY (p_kinds)
              AND ((j.status = 'pending' AND j.run_at <= now())
                   OR (j.status = 'running' AND j.locked_until < now() AND j.attempts < j.max_attempts))
            ORDER BY j.run_at, j.id
            LIMIT p_per_tenant
            FOR UPDATE OF j SKIP LOCKED
        ) x
    ),
    ranked AS (
        SELECT l.id, l.run_at, l.t, l.oldest,
               row_number() OVER (PARTITION BY l.t ORDER BY l.run_at, l.id) AS turn
        FROM locked l
    ),
    fair AS (
        -- Round-robin: every tenant's first row, then every tenant's second, ...; within a round, oldest work first.
        SELECT r.id FROM ranked r ORDER BY r.turn, r.oldest, r.t, r.run_at, r.id LIMIT p_batch
    )
    UPDATE ops.jobs j
       SET status = 'running',
           locked_until = now() + make_interval(secs => p_lease_seconds),
           lease_token = gen_random_uuid(),
           locked_by = left(btrim(p_worker), 64),
           started_at = NULL,
           first_claimed_at = coalesce(j.first_claimed_at, now()),
           -- Old-row value: a re-claim of a running row means its previous lease expired.
           last_lease_expired_at = CASE WHEN j.status = 'running' THEN now() ELSE j.last_lease_expired_at END,
           updated_at = now()
      FROM fair f
     WHERE j.id = f.id
    RETURNING j.id, j.kind, j.tenant_id, j.payload, j.attempts, j.max_attempts, j.lease_token, j.run_at;
END;
$$;

COMMENT ON FUNCTION public.claim_jobs(TEXT[], INTEGER, INTEGER, TEXT, INTEGER) IS
    'V2-04 04-01, 04-07b: claims up to p_batch due jobs of p_kinds (FOR UPDATE SKIP LOCKED), at most p_per_tenant per '
    'tenant, round-robin across tenants, with a fresh lease token per row. Counts no attempt (start_job does); '
    'attempts returned = attempts already spent. service_role only (the runner).';

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Start: the attempt is counted here
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION public.start_job(p_id UUID, p_lease_token UUID)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_attempts INTEGER;
BEGIN
    UPDATE ops.jobs j
       SET attempts = j.attempts + 1,
           started_at = now(),
           updated_at = now()
     WHERE j.id = p_id
       AND j.lease_token = p_lease_token
       AND j.status = 'running'
       AND j.started_at IS NULL
       AND j.locked_until > now()
       AND j.attempts < j.max_attempts
    RETURNING j.attempts INTO v_attempts;
    RETURN v_attempts;
END;
$$;

COMMENT ON FUNCTION public.start_job(UUID, UUID) IS
    'V2-04 04-07b (M-ATTEMPT): the runner is about to run the handler of a job it holds: counts the attempt, stamps '
    'started_at, returns the attempt number. NULL (nothing changed) for a stale or expired lease or a job already '
    'started under this lease. service_role only.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Finish: fail counts an unstarted attempt; release hands back unstarted jobs only; defer returns the attempt
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fail_job(
    p_id UUID,
    p_lease_token UUID,
    p_error_code TEXT,
    p_retryable BOOLEAN,
    p_retry_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_attempts INTEGER;
    v_max INTEGER;
    v_retry BOOLEAN;
BEGIN
    IF p_retryable IS NULL THEN
        RAISE EXCEPTION 'invalid_fail' USING ERRCODE = '22023';
    END IF;

    SELECT j.attempts + CASE WHEN j.started_at IS NULL THEN 1 ELSE 0 END, j.max_attempts
      INTO v_attempts, v_max
      FROM ops.jobs j
     WHERE j.id = p_id AND j.lease_token = p_lease_token AND j.status = 'running'
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'stale';
    END IF;
    v_retry := p_retryable AND v_attempts < v_max;

    UPDATE ops.jobs j
       SET attempts = v_attempts,
           status = CASE WHEN v_retry THEN 'pending' ELSE 'dead' END,
           run_at = CASE
               WHEN v_retry THEN greatest(
                   now(),
                   least(
                       now() + INTERVAL '1 day',
                       coalesce(
                           p_retry_at,
                           now() + least(INTERVAL '6 hours', INTERVAL '30 seconds' * power(2, v_attempts - 1))
                                   * (0.5 + random() / 2)
                       )
                   )
               )
               ELSE j.run_at
           END,
           finished_at = CASE WHEN v_retry THEN NULL ELSE now() END,
           locked_until = NULL,
           lease_token = NULL,
           locked_by = NULL,
           last_error = ops.job_error_code(p_error_code),
           updated_at = now()
     WHERE j.id = p_id;

    RETURN CASE WHEN v_retry THEN 'pending' ELSE 'dead' END;
END;
$$;

COMMENT ON FUNCTION public.fail_job(UUID, UUID, TEXT, BOOLEAN, TIMESTAMPTZ) IS
    'V2-04 04-01, 04-07b: fails a running job under its current lease (counting the attempt if it was never started): '
    'retryable with attempts left -> pending with exponential backoff and jitter (or p_retry_at, capped at 1 day); '
    'otherwise dead. Returns pending | dead | stale. service_role only.';

CREATE OR REPLACE FUNCTION public.release_job(p_id UUID, p_lease_token UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
BEGIN
    UPDATE ops.jobs j
       SET status = 'pending',
           first_claimed_at = CASE WHEN j.attempts = 0 THEN NULL ELSE j.first_claimed_at END,
           locked_until = NULL,
           lease_token = NULL,
           locked_by = NULL,
           updated_at = now()
     WHERE j.id = p_id AND j.lease_token = p_lease_token AND j.status = 'running' AND j.started_at IS NULL;
    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.release_job(UUID, UUID) IS
    'V2-04 04-01, 04-07b: hands back a claimed job the runner did not start (pending again; no attempt was counted). '
    'Refused (false) for a started job or a stale lease. service_role only.';

CREATE FUNCTION public.defer_job(p_id UUID, p_lease_token UUID, p_error_code TEXT, p_retry_at TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    -- Free deferrals per job; after these a deferral keeps its attempt (a job that never progresses still ends).
    v_max_deferrals CONSTANT INTEGER := 20;
    v_started BOOLEAN;
    v_deferrals INTEGER;
BEGIN
    IF p_retry_at IS NULL THEN
        RAISE EXCEPTION 'invalid_defer' USING ERRCODE = '22023';
    END IF;

    SELECT j.started_at IS NOT NULL, j.deferrals
      INTO v_started, v_deferrals
      FROM ops.jobs j
     WHERE j.id = p_id AND j.lease_token = p_lease_token AND j.status = 'running'
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'stale';
    END IF;
    IF v_deferrals >= v_max_deferrals THEN
        RETURN public.fail_job(p_id, p_lease_token, p_error_code, true, p_retry_at);
    END IF;

    UPDATE ops.jobs j
       SET status = 'pending',
           attempts = CASE WHEN v_started THEN greatest(j.attempts - 1, 0) ELSE j.attempts END,
           deferrals = j.deferrals + 1,
           run_at = greatest(now() + INTERVAL '5 seconds', least(now() + INTERVAL '1 day', p_retry_at)),
           finished_at = NULL,
           locked_until = NULL,
           lease_token = NULL,
           locked_by = NULL,
           last_error = ops.job_error_code(p_error_code),
           updated_at = now()
     WHERE j.id = p_id;
    RETURN 'deferred';
END;
$$;

COMMENT ON FUNCTION public.defer_job(UUID, UUID, TEXT, TIMESTAMPTZ) IS
    'V2-04 04-07b (independent review M2): a started job that found nothing to do yet goes back to pending at '
    'p_retry_at (clamped to [now + 5 s, now + 1 day]) and its attempt is returned, at most 20 times per job; then it '
    'is an ordinary retryable failure. Returns deferred | pending | dead | stale. service_role only.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. runner_stale counts scheduler-triggered passes only (review A L-5)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.alert_rule_runner_stale(p_params JSONB)
RETURNS TABLE (firing BOOLEAN, details JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH p AS (
        SELECT coalesce((p_params ->> 'threshold_minutes')::int, 5) AS threshold_minutes
    ),
    s AS (
        SELECT EXISTS (SELECT 1 FROM vault.secrets v WHERE v.name = 'jobs_runner_url') AS configured,
               (SELECT max(r.started_at) FROM ops.job_runner_runs r WHERE r.ok AND r.source = 'pg_cron') AS last_ok
    )
    SELECT s.configured AND (s.last_ok IS NULL OR s.last_ok <= now() - make_interval(mins => p.threshold_minutes)),
           jsonb_build_object(
               'threshold_minutes', p.threshold_minutes,
               'last_ok_at', CASE WHEN s.last_ok IS NULL THEN NULL
                                  ELSE to_char(s.last_ok AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END
           )
      FROM p, s;
$$;

COMMENT ON FUNCTION ops.alert_rule_runner_stale(JSONB) IS
    'V2-04 04-04, 04-07b: fires when a runner is configured (Vault jobs_runner_url) and no pg_cron-triggered runner '
    'pass started ok within threshold_minutes (manual passes do not count).';

REVOKE ALL ON FUNCTION ops.alert_rule_runner_stale(JSONB) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.readiness_probe(p_expected_migration TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_since TIMESTAMPTZ := now() - INTERVAL '24 hours';
    v_due TIMESTAMPTZ := now() - INTERVAL '15 minutes';
    v_job_due TIMESTAMPTZ := now() - INTERVAL '5 minutes';
BEGIN
    RETURN jsonb_build_object(
        'db', true,
        -- Only an exact six-digit version is looked up (primary key); anything else answers null.
        'schema_current', CASE
            WHEN p_expected_migration IS NULL OR p_expected_migration !~ '^[0-9]{6}$' THEN NULL
            ELSE EXISTS (
                SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version = p_expected_migration
            )
        END,
        -- Each flag is one EXISTS over an index: idx_comm_queue_dispatch / idx_webhook_queue_status_retry for the
        -- backlog, idx_comm_queue_failed_updated / idx_webhook_queue_failed_updated for recent failures.
        'messages_backlog', EXISTS (
            SELECT 1 FROM public.communication_queue q
            WHERE q.status IN ('pending', 'processing') AND q.next_retry_at < v_due
        ),
        'messages_failed_24h', EXISTS (
            SELECT 1 FROM public.communication_queue q
            WHERE q.status IN ('failed', 'dead_letter') AND q.updated_at >= v_since
        ),
        'webhooks_backlog', EXISTS (
            SELECT 1 FROM public.webhook_delivery_queue w
            WHERE w.status = 'pending' AND w.next_retry_at < v_due
        ),
        'webhooks_failed_24h', EXISTS (
            SELECT 1 FROM public.webhook_delivery_queue w
            WHERE w.status = 'failed' AND w.updated_at >= v_since
        ),
        -- 04-04 (R-41): jobs_pending_run_at, jobs_status_finished_at, secrets_name_idx + job_runner_runs_started_at,
        -- alerts_open_severity.
        'jobs_backlog', EXISTS (
            SELECT 1 FROM ops.jobs j WHERE j.status = 'pending' AND j.run_at < v_job_due
        ),
        'jobs_dead_24h', EXISTS (
            SELECT 1 FROM ops.jobs j WHERE j.status = 'dead' AND j.finished_at >= v_since
        ),
        -- 04-07b (review A L-5): only scheduler-triggered passes keep the runner fresh.
        'runner_stale', EXISTS (SELECT 1 FROM vault.secrets v WHERE v.name = 'jobs_runner_url')
            AND NOT EXISTS (
                SELECT 1 FROM ops.job_runner_runs r
                WHERE r.started_at > v_job_due AND r.ok AND r.source = 'pg_cron'
            ),
        'alerts_critical_open', EXISTS (
            SELECT 1 FROM ops.alerts a WHERE a.status = 'open' AND a.severity = 'critical'
        )
    );
END;
$$;

COMMENT ON FUNCTION public.readiness_probe(TEXT) IS
    'V2-03 03-01/03-13c, V2-04 04-04/04-07b: readiness booleans for /api/ready (no counts, no version; each flag an '
    'indexed EXISTS; runner_stale counts pg_cron passes only). anon only.';

REVOKE ALL ON FUNCTION public.readiness_probe(TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.readiness_probe(TEXT) TO anon;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Privileges: the new runner RPCs for service_role only
-- ---------------------------------------------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.start_job(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.defer_job(UUID, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_job(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.defer_job(UUID, UUID, TEXT, TIMESTAMPTZ) TO service_role;
