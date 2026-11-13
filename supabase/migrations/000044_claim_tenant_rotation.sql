-- Migration: 000044_claim_tenant_rotation.sql
-- V2-04 plan 04-07d (re-verification finding N-1, follow-up of triage M-FAIR). Next free number after 04-07b's 000043.
--
-- 000043's `claim_jobs` spread each batch round-robin across the claimed tenants, but it chose those tenants by their
-- oldest due work (`due_tenants … ORDER BY min(run_at) LIMIT p_batch`). With p_batch (10) or more tenants holding
-- older backlogs, every other tenant waited until those backlogs drained: the re-verifier's repro (10 tenants × 40 jobs
-- from 30 minutes ago, an 11th tenant's single job from 1 minute ago, each batch marked done) first claimed the 11th
-- tenant in batch 41 of 45. TARGET_ARCHITECTURE §8: no tenant can starve others.
--
-- Fix: tenants are chosen least recently served first. Every claim stamps `ops.jobs.last_claimed_at = now()` on the rows
-- it takes (a re-claim too, unlike `first_claimed_at`), and a tenant's "last served" time is the newest
-- `last_claimed_at` over its jobs (index `jobs_tenant_last_claimed_at`, one backward index probe per due tenant). Due
-- tenants are ordered by that time, never-served first, then by their oldest due work. Each batch serves up to p_batch
-- distinct tenants (round 1 of the round-robin gives every chosen tenant a row), and the tenants it served go to the
-- back of the rotation, so with N tenants that have due work a tenant is served within ceil(N / p_batch) claims of
-- becoming due, however old or large the others' backlogs are. For the repro above: within 2 claims.
--
-- Unchanged from 000043: the claim is one statement with `FOR UPDATE SKIP LOCKED` (atomic; concurrent runners take
-- disjoint rows), at most p_per_tenant rows per tenant, round-robin within the batch, a fresh lease token per row, no
-- attempt counted (start_job does), the same grants (service_role only) and signature. No new table: the rotation
-- state lives on the rows the claim already writes, so concurrent claimers never contend on a cursor row.
-- Existing rows start with last_claimed_at NULL (no backfill): at deploy every tenant counts as never served, which
-- orders them by oldest work exactly as 000043 did, and the rotation takes over from the first claim.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Column and index (expand; nullable, no default, no rewrite)
-- ---------------------------------------------------------------------------------------------------------------------

ALTER TABLE ops.jobs ADD COLUMN last_claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN ops.jobs.last_claimed_at IS
    'V2-04 04-07d (N-1): when a claim last took this row (every claim, re-claims included). The newest value over a '
    'tenant''s jobs is that tenant''s last-served time, which claim_jobs rotates on.';

CREATE INDEX jobs_tenant_last_claimed_at ON ops.jobs (tenant_id, last_claimed_at);

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Claim: least recently served tenants first
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
        -- query level with the window function below, which therefore sits in its own CTE).
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
        -- tenant), so every chosen tenant with an unlocked due row gets one.
        SELECT r.id FROM ranked r
        ORDER BY r.turn, r.served ASC NULLS FIRST, r.oldest, r.t, r.run_at, r.id
        LIMIT p_batch
    )
    UPDATE ops.jobs j
       SET status = 'running',
           locked_until = now() + make_interval(secs => p_lease_seconds),
           lease_token = gen_random_uuid(),
           locked_by = left(btrim(p_worker), 64),
           started_at = NULL,
           first_claimed_at = coalesce(j.first_claimed_at, now()),
           last_claimed_at = now(),
           -- Old-row value: a re-claim of a running row means its previous lease expired.
           last_lease_expired_at = CASE WHEN j.status = 'running' THEN now() ELSE j.last_lease_expired_at END,
           updated_at = now()
      FROM fair f
     WHERE j.id = f.id
    RETURNING j.id, j.kind, j.tenant_id, j.payload, j.attempts, j.max_attempts, j.lease_token, j.run_at;
END;
$$;

COMMENT ON FUNCTION public.claim_jobs(TEXT[], INTEGER, INTEGER, TEXT, INTEGER) IS
    'V2-04 04-01, 04-07b, 04-07d: claims up to p_batch due jobs of p_kinds (FOR UPDATE SKIP LOCKED), at most '
    'p_per_tenant per tenant, from the least recently served tenants (N-1), round-robin across them, with a fresh lease '
    'token per row; stamps last_claimed_at. Counts no attempt (start_job does); attempts returned = attempts already '
    'spent. service_role only (the runner).';
