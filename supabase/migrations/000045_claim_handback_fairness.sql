-- Migration: 000045_claim_handback_fairness.sql
-- V2-04 plan 04-07e (adversarial re-check finding N-1b, follow-up of N-1 / triage M-FAIR). Next free number after
-- 04-07d's 000044.
--
-- 000044 rotates the claimed tenants least recently served first, where "served" is the newest `last_claimed_at` over
-- a tenant's jobs, stamped by every claim. Through the real runner that is not enough: a pass whose budget runs out
-- part-way through a batch hands the jobs it did not reach back unstarted (`release_job`), and those kept the stamp,
-- so their tenants went to the back of the rotation without having run anything. Together with the runner starting the
-- tenant with the newest work last in every batch, the re-checker's probe (10 tenants x 40 jobs from 30 minutes ago,
-- an 11th tenant's job from 1 minute ago, message.send's 12 s bound, 1.5 s per job, so about 8 of 10 jobs per pass)
-- never ran the 11th tenant's job in 30 passes: it was claimed and handed back every time. TARGET_ARCHITECTURE §8.
--
-- Fix, in two parts (this migration, and lib/jobs/internal/claim.ts):
--   1. A hand-back is not service. Every claim keeps the row's previous stamp in the new `prev_last_claimed_at`, and
--      `release_job` (and `defer_job` for a job that never started) puts it back, so a tenant whose job was handed
--      back unstarted keeps its place at the front of the rotation. A re-claim of a row whose lease expired before it
--      started keeps the older value too (its last claim never ran either). A started job keeps its stamp: it was
--      served.
--   2. `claim_jobs` returns each row's position in the fair order (`claim_order`: round 1 of the round-robin first,
--      within a round the least recently served tenant first, then the oldest work) and returns the rows in that
--      order. The runner starts the batch in exactly this order instead of re-sorting it by oldest work, which always
--      put the tenant with the newest work (the one waiting longest for a turn) last, i.e. first to be handed back.
--   With both, a tenant whose job is handed back is first in line at the next claim, and a never-served tenant is
--   started at the head of its first batch.
--
-- Unchanged from 000044: one statement with `FOR UPDATE SKIP LOCKED` (atomic; concurrent runners take disjoint rows),
-- at most p_per_tenant rows per tenant, at most p_batch tenants chosen least recently served first, round-robin within
-- the batch, a fresh lease token per row, no attempt counted at claim, `last_claimed_at` stamped on every claim, the
-- arguments, and service_role-only access. The return type gains one column, so the function is dropped and created
-- again in this migration's transaction with the same grants (only the runner calls it; callers that read the other
-- columns are unaffected). No backfill: `prev_last_claimed_at` is only read by a hand-back of a row claimed after this
-- migration, and every claim writes it.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Column (expand; nullable, no default, no rewrite)
-- ---------------------------------------------------------------------------------------------------------------------

ALTER TABLE ops.jobs ADD COLUMN prev_last_claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN ops.jobs.prev_last_claimed_at IS
    'V2-04 04-07e (N-1b): last_claimed_at as it was before the current claim (the value a hand-back of an unstarted '
    'job restores, so a hand-back never counts as service for the tenant rotation).';

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Claim: same choice and order as 000044, previous stamp kept, fair position returned
-- ---------------------------------------------------------------------------------------------------------------------

DROP FUNCTION public.claim_jobs(TEXT[], INTEGER, INTEGER, TEXT, INTEGER);

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
    run_at TIMESTAMPTZ,
    claim_order INTEGER
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
    WITH due AS (
        SELECT coalesce(d.tenant_id, v_none) AS t, min(d.run_at) AS oldest
        FROM ops.jobs d
        WHERE d.kind = ANY (p_kinds)
          AND ((d.status = 'pending' AND d.run_at <= now())
               OR (d.status = 'running' AND d.locked_until < now() AND d.attempts < d.max_attempts))
        GROUP BY 1
    ),
    due_tenants AS (
        -- N-1: least recently served first (never served first), then oldest due work; at most one batch of tenants.
        -- N-1b: a hand-back restores the row's previous stamp, so only claims that were started count here.
        SELECT du.t, du.oldest, s.served
        FROM due du
        CROSS JOIN LATERAL (
            SELECT CASE
                       WHEN du.t = v_none THEN
                           (SELECT max(n.last_claimed_at) FROM ops.jobs n WHERE n.tenant_id IS NULL)
                       ELSE
                           (SELECT max(m.last_claimed_at) FROM ops.jobs m WHERE m.tenant_id = du.t)
                   END AS served
        ) s
        ORDER BY s.served ASC NULLS FIRST, du.oldest, du.t
        LIMIT p_batch
    ),
    locked AS (
        -- Up to p_per_tenant unlocked due rows per tenant (the per-tenant LIMIT in a LATERAL; FOR UPDATE cannot share a
        -- query level with the window functions below, which therefore sit in their own CTEs).
        SELECT x.id, x.run_at, dt.t, dt.oldest, dt.served
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
        SELECT l.id, l.run_at, l.t, l.oldest, l.served,
               row_number() OVER (PARTITION BY l.t ORDER BY l.run_at, l.id) AS turn
        FROM locked l
    ),
    fair AS (
        -- Round-robin: every chosen tenant's first row, then every tenant's second, ...; within a round, the least
        -- recently served tenant first, then the oldest work. Round 1 has at most p_batch rows (one per chosen
        -- tenant), so every chosen tenant with an unlocked due row gets one. claim_order is this position (1 = first);
        -- the runner starts the batch in this order (N-1b).
        SELECT o.id, o.claim_order
        FROM (
            SELECT r.id,
                   row_number() OVER (ORDER BY r.turn, r.served ASC NULLS FIRST, r.oldest, r.t, r.run_at, r.id)
                       AS claim_order
            FROM ranked r
        ) o
        WHERE o.claim_order <= p_batch
    ),
    claimed AS (
        UPDATE ops.jobs j
           SET status = 'running',
               locked_until = now() + make_interval(secs => p_lease_seconds),
               lease_token = gen_random_uuid(),
               locked_by = left(btrim(p_worker), 64),
               started_at = NULL,
               first_claimed_at = coalesce(j.first_claimed_at, now()),
               -- N-1b: the stamp a hand-back restores. A re-claim of a row whose lease expired before it started keeps
               -- the older value (that claim never ran either). Old-row values on the right-hand side.
               prev_last_claimed_at = CASE
                   WHEN j.status = 'running' AND j.started_at IS NULL THEN j.prev_last_claimed_at
                   ELSE j.last_claimed_at
               END,
               last_claimed_at = now(),
               -- Old-row value: a re-claim of a running row means its previous lease expired.
               last_lease_expired_at = CASE WHEN j.status = 'running' THEN now() ELSE j.last_lease_expired_at END,
               updated_at = now()
          FROM fair f
         WHERE j.id = f.id
        RETURNING j.id, j.kind, j.tenant_id, j.payload, j.attempts, j.max_attempts, j.lease_token, j.run_at,
                  f.claim_order::INTEGER AS claim_order
    )
    SELECT c.id, c.kind, c.tenant_id, c.payload, c.attempts, c.max_attempts, c.lease_token, c.run_at, c.claim_order
    FROM claimed c
    ORDER BY c.claim_order;
END;
$$;

COMMENT ON FUNCTION public.claim_jobs(TEXT[], INTEGER, INTEGER, TEXT, INTEGER) IS
    'V2-04 04-01, 04-07b, 04-07d, 04-07e: claims up to p_batch due jobs of p_kinds (FOR UPDATE SKIP LOCKED), at most '
    'p_per_tenant per tenant, from the least recently served tenants (N-1), round-robin across them, with a fresh lease '
    'token per row; stamps last_claimed_at (keeping the previous value for a hand-back, N-1b) and returns the rows in '
    'fair order with claim_order (1 = start first). Counts no attempt (start_job does); attempts returned = attempts '
    'already spent. service_role only (the runner).';

REVOKE ALL ON FUNCTION public.claim_jobs(TEXT[], INTEGER, INTEGER, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_jobs(TEXT[], INTEGER, INTEGER, TEXT, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Hand-backs restore the previous stamp (a job that never started was not service)
-- ---------------------------------------------------------------------------------------------------------------------

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
           -- N-1b: the claim being handed back never ran, so it does not move the tenant back in the rotation.
           last_claimed_at = j.prev_last_claimed_at,
           locked_until = NULL,
           lease_token = NULL,
           locked_by = NULL,
           updated_at = now()
     WHERE j.id = p_id AND j.lease_token = p_lease_token AND j.status = 'running' AND j.started_at IS NULL;
    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.release_job(UUID, UUID) IS
    'V2-04 04-01, 04-07b, 04-07e: hands back a claimed job the runner did not start (pending again; no attempt was '
    'counted; its last_claimed_at goes back to the value before this claim, so the hand-back does not count as service '
    'for the tenant rotation). Refused (false) for a started job or a stale lease. service_role only.';

CREATE OR REPLACE FUNCTION public.defer_job(p_id UUID, p_lease_token UUID, p_error_code TEXT, p_retry_at TIMESTAMPTZ)
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
           -- N-1b: a started job's handler ran (service); one that never started is a hand-back like release_job.
           last_claimed_at = CASE WHEN v_started THEN j.last_claimed_at ELSE j.prev_last_claimed_at END,
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
    'V2-04 04-07b, 04-07e: a started job that found nothing to do yet goes back to pending at p_retry_at (clamped to '
    '[now + 5 s, now + 1 day]) and its attempt is returned, at most 20 times per job; then it is an ordinary retryable '
    'failure. A job deferred before it started also gets its previous last_claimed_at back (N-1b). Returns '
    'deferred | pending | dead | stale. service_role only.';
