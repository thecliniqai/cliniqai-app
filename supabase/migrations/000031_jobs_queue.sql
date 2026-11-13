-- Migration: 000031_jobs_queue.sql
-- V2-04 plan 04-01: job queue core (P0-12, ADR-009, TARGET_ARCHITECTURE §8; rulings R-7, R-22; threats T-04-03,
-- T-04-07, T-04-09, T-04-10).
--
-- One durable queue for background work. Request paths never run side effects (messages, webhooks) themselves: they
-- write a row, and the runner (`lib/jobs/internal/runner.ts`, called by `/api/jobs/run` from 04-02 on) claims due rows
-- and runs a handler per kind.
--
--   * Claim: `public.claim_jobs` locks due rows with `FOR UPDATE SKIP LOCKED`, so parallel runners never claim the
--     same row, and stamps each claimed row with a fresh `lease_token` and `locked_until = now() + lease`.
--   * Fencing: `complete_job` / `fail_job` / `release_job` change a row only while it is `running` under the caller's
--     token. A runner whose lease expired and whose row was re-claimed by another runner gets `false` / `stale` and
--     changes nothing.
--   * Attempts are counted at claim (a handler that crashes the runner still consumes an attempt: poison-pill
--     protection, T-04-09). An expired lease with attempts left is simply claimable again; `ops.reap_jobs()`
--     dead-letters expired leases with no attempts left.
--   * Backoff: exponential with jitter (30 s · 2^(attempt-1) · [0.5, 1], capped at 6 h), or the handler's retry time
--     (capped at 1 day).
--   * Tenant fairness: the claim takes at most `p_per_tenant` rows per tenant per batch from the tenants with the oldest
--     due work, so one tenant's backlog cannot starve the others (TARGET §8).
--   * `dedupe_key` is NOT NULL UNIQUE (R-7): every enqueue names its idempotency key; a repeat returns the first id.
--
-- Access: the tables live in `ops` (no USAGE for any API role, not in `[api] schemas`, RLS on with no policy). The
-- runner RPCs are public SECURITY DEFINER functions executable by `service_role` only; `ops.enqueue_job` and
-- `ops.reap_jobs` are executable by no API role (definer functions, triggers and pg_cron call them). Payloads carry ids
-- only and `last_error` carries a machine code only (T-04-10): a code outside the code shape is stored as
-- `invalid_error_code`.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------------------------------------------------

CREATE TABLE ops.jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind ~ '^[a-z]+(\.[a-z_]+)+$' AND char_length(kind) <= 64),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 4096),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'dead', 'cancelled')),
    run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
    locked_until TIMESTAMPTZ,
    lease_token UUID,
    locked_by TEXT CHECK (char_length(locked_by) <= 64),
    first_claimed_at TIMESTAMPTZ,
    last_lease_expired_at TIMESTAMPTZ,
    last_error TEXT CHECK (char_length(last_error) <= 500),
    dedupe_key TEXT NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    CONSTRAINT jobs_dedupe_key UNIQUE (dedupe_key),
    CONSTRAINT jobs_running_has_lease CHECK (
        status <> 'running' OR (lease_token IS NOT NULL AND locked_until IS NOT NULL)
    )
);

CREATE INDEX jobs_pending_run_at ON ops.jobs (run_at) WHERE status = 'pending';
CREATE INDEX jobs_running_locked_until ON ops.jobs (locked_until) WHERE status = 'running';
CREATE INDEX jobs_tenant_id ON ops.jobs (tenant_id);
CREATE INDEX jobs_status_finished_at ON ops.jobs (status, finished_at);

COMMENT ON TABLE ops.jobs IS
    'V2-04 04-01: background job queue (TARGET §8). Claimed with FOR UPDATE SKIP LOCKED and fenced by lease_token. '
    'Payloads carry ids only; last_error carries a machine code only. Access only through the jobs functions.';

CREATE TABLE ops.job_runner_runs (
    id BIGSERIAL PRIMARY KEY,
    worker TEXT NOT NULL CHECK (char_length(worker) BETWEEN 1 AND 64),
    source TEXT NOT NULL CHECK (source IN ('pg_cron', 'manual', 'test')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    claimed INTEGER CHECK (claimed >= 0),
    done INTEGER CHECK (done >= 0),
    retried INTEGER CHECK (retried >= 0),
    dead INTEGER CHECK (dead >= 0),
    ok BOOLEAN,
    error_code TEXT CHECK (char_length(error_code) <= 64)
);

CREATE INDEX job_runner_runs_started_at ON ops.job_runner_runs (started_at);

COMMENT ON TABLE ops.job_runner_runs IS
    'V2-04 04-01: one row per runner pass (counts and an error code only), for the stale-runner alert and the report.';

ALTER TABLE ops.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.job_runner_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE ops.jobs, ops.job_runner_runs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE ops.job_runner_runs_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Error codes: a machine code or nothing (T-04-10)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION ops.job_error_code(p_code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_code IS NULL OR btrim(p_code) = '' THEN 'error'
        WHEN p_code ~ '^[A-Za-z0-9_.:-]{1,64}$' AND p_code !~ '[0-9]{6,}' THEN p_code
        ELSE 'invalid_error_code'
    END;
$$;

COMMENT ON FUNCTION ops.job_error_code(TEXT) IS
    'V2-04 04-01: the stored form of a job error code: the code when it is a short machine word without a 6+ digit '
    'run, else invalid_error_code (never free text, which can carry PHI).';

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Enqueue (definer functions and triggers only)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION ops.enqueue_job(
    p_kind TEXT,
    p_tenant_id UUID,
    p_payload JSONB,
    p_dedupe_key TEXT,
    p_run_at TIMESTAMPTZ DEFAULT now(),
    p_max_attempts INTEGER DEFAULT 5
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO ops.jobs (kind, tenant_id, payload, dedupe_key, run_at, max_attempts)
    VALUES (p_kind, p_tenant_id, coalesce(p_payload, '{}'::jsonb), p_dedupe_key, coalesce(p_run_at, now()),
            coalesce(p_max_attempts, 5))
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        SELECT j.id INTO v_id FROM ops.jobs j WHERE j.dedupe_key = p_dedupe_key;
    END IF;
    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION ops.enqueue_job(TEXT, UUID, JSONB, TEXT, TIMESTAMPTZ, INTEGER) IS
    'V2-04 04-01: inserts a job, or returns the id of the job that already holds p_dedupe_key (at-least-once with '
    'dedupe, R-7). Called only by other definer functions and triggers; no API role may execute it.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Claim (lease + fencing token, tenant fairness)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION public.claim_jobs(
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
    -- runner's job). The due condition is repeated inside the locking subquery so that a row another runner claimed
    -- and committed after this statement's snapshot is re-checked on its new version and skipped.
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
        -- Up to p_per_tenant unlocked due rows per tenant (FOR UPDATE cannot sit in a query with a window function,
        -- research pitfall 4; the per-tenant LIMIT in a LATERAL does the same job and still sees every tenant).
        SELECT x.id, x.run_at
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
    fair AS (
        SELECT l.id FROM locked l ORDER BY l.run_at, l.id LIMIT p_batch
    )
    UPDATE ops.jobs j
       SET status = 'running',
           attempts = j.attempts + 1,
           locked_until = now() + make_interval(secs => p_lease_seconds),
           lease_token = gen_random_uuid(),
           locked_by = left(btrim(p_worker), 64),
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
    'V2-04 04-01: claims up to p_batch due jobs of p_kinds (FOR UPDATE SKIP LOCKED), at most p_per_tenant per tenant, '
    'counting an attempt and issuing a fresh lease token per row. service_role only (the runner).';

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Finish (fenced by the lease token)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION public.complete_job(p_id UUID, p_lease_token UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
BEGIN
    UPDATE ops.jobs j
       SET status = 'done',
           finished_at = now(),
           locked_until = NULL,
           lease_token = NULL,
           locked_by = NULL,
           updated_at = now()
     WHERE j.id = p_id AND j.lease_token = p_lease_token AND j.status = 'running';
    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.complete_job(UUID, UUID) IS
    'V2-04 04-01: marks a running job done if p_lease_token is its current lease; returns false (and changes nothing) '
    'for a stale lease holder. service_role only.';

CREATE FUNCTION public.fail_job(
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
    v_status TEXT;
BEGIN
    IF p_retryable IS NULL THEN
        RAISE EXCEPTION 'invalid_fail' USING ERRCODE = '22023';
    END IF;

    UPDATE ops.jobs j
       SET status = CASE WHEN p_retryable AND j.attempts < j.max_attempts THEN 'pending' ELSE 'dead' END,
           run_at = CASE
               WHEN p_retryable AND j.attempts < j.max_attempts THEN greatest(
                   now(),
                   least(
                       now() + INTERVAL '1 day',
                       coalesce(
                           p_retry_at,
                           now() + least(INTERVAL '6 hours', INTERVAL '30 seconds' * power(2, j.attempts - 1))
                                   * (0.5 + random() / 2)
                       )
                   )
               )
               ELSE j.run_at
           END,
           finished_at = CASE WHEN p_retryable AND j.attempts < j.max_attempts THEN NULL ELSE now() END,
           locked_until = NULL,
           lease_token = NULL,
           locked_by = NULL,
           last_error = ops.job_error_code(p_error_code),
           updated_at = now()
     WHERE j.id = p_id AND j.lease_token = p_lease_token AND j.status = 'running'
    RETURNING j.status INTO v_status;

    RETURN coalesce(v_status, 'stale');
END;
$$;

COMMENT ON FUNCTION public.fail_job(UUID, UUID, TEXT, BOOLEAN, TIMESTAMPTZ) IS
    'V2-04 04-01: fails a running job under its current lease: retryable with attempts left -> pending with '
    'exponential backoff and jitter (or p_retry_at, capped at 1 day); otherwise dead. Returns pending | dead | stale. '
    'service_role only.';

CREATE FUNCTION public.release_job(p_id UUID, p_lease_token UUID)
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
           attempts = greatest(j.attempts - 1, 0),
           first_claimed_at = CASE WHEN j.attempts <= 1 THEN NULL ELSE j.first_claimed_at END,
           locked_until = NULL,
           lease_token = NULL,
           locked_by = NULL,
           updated_at = now()
     WHERE j.id = p_id AND j.lease_token = p_lease_token AND j.status = 'running';
    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.release_job(UUID, UUID) IS
    'V2-04 04-01: hands back a claimed job the runner did not start (its time budget ran out): pending again, the '
    'attempt the claim counted is returned. Fenced by the lease token. service_role only.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Reaper: expired leases with no attempts left
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION ops.reap_jobs()
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE ops.jobs j
       SET status = 'dead',
           finished_at = now(),
           last_error = 'lease_expired',
           last_lease_expired_at = now(),
           locked_until = NULL,
           lease_token = NULL,
           locked_by = NULL,
           updated_at = now()
     WHERE j.status = 'running' AND j.locked_until < now() AND j.attempts >= j.max_attempts;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION ops.reap_jobs() IS
    'V2-04 04-01: dead-letters running jobs whose lease expired with no attempts left (last_error lease_expired). '
    'Expired leases with attempts left are claimable again and need no reaping. No API role may execute it.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Runner passes
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION public.jobs_runner_begin(p_worker TEXT, p_source TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    IF p_worker IS NULL OR btrim(p_worker) = '' OR p_source IS NULL OR p_source NOT IN ('pg_cron', 'manual', 'test') THEN
        RAISE EXCEPTION 'invalid_runner' USING ERRCODE = '22023';
    END IF;
    INSERT INTO ops.job_runner_runs (worker, source) VALUES (left(btrim(p_worker), 64), p_source) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.jobs_runner_begin(TEXT, TEXT) IS
    'V2-04 04-01: records the start of a runner pass and returns its id. service_role only.';

CREATE FUNCTION public.jobs_runner_end(
    p_run_id BIGINT,
    p_claimed INTEGER,
    p_done INTEGER,
    p_retried INTEGER,
    p_dead INTEGER,
    p_ok BOOLEAN,
    p_error_code TEXT
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_ok IS NULL OR coalesce(least(p_claimed, p_done, p_retried, p_dead), -1) < 0 THEN
        RAISE EXCEPTION 'invalid_runner' USING ERRCODE = '22023';
    END IF;
    UPDATE ops.job_runner_runs r
       SET finished_at = now(),
           claimed = p_claimed,
           done = p_done,
           retried = p_retried,
           dead = p_dead,
           ok = p_ok,
           error_code = CASE WHEN p_error_code IS NULL THEN NULL ELSE ops.job_error_code(p_error_code) END
     WHERE r.id = p_run_id AND r.finished_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'runner_run_not_found' USING ERRCODE = '22023';
    END IF;
END;
$$;

COMMENT ON FUNCTION public.jobs_runner_end(BIGINT, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, TEXT) IS
    'V2-04 04-01: records the end of a runner pass (counts, ok, an error code). service_role only.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. Privileges: runner RPCs for service_role only; ops functions for no API role
-- ---------------------------------------------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION ops.job_error_code(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.enqueue_job(TEXT, UUID, JSONB, TEXT, TIMESTAMPTZ, INTEGER)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.reap_jobs() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.claim_jobs(TEXT[], INTEGER, INTEGER, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_job(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_job(UUID, UUID, TEXT, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_job(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.jobs_runner_begin(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.jobs_runner_end(BIGINT, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, TEXT)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_jobs(TEXT[], INTEGER, INTEGER, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_job(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_job(UUID, UUID, TEXT, BOOLEAN, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_job(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.jobs_runner_begin(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.jobs_runner_end(BIGINT, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, TEXT)
    TO service_role;
