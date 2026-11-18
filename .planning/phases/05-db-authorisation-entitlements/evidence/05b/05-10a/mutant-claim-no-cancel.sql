CREATE OR REPLACE FUNCTION public.claim_jobs(p_kinds text[], p_batch integer, p_lease_seconds integer, p_worker text, p_per_tenant integer DEFAULT 10)
 RETURNS TABLE(id uuid, kind text, tenant_id uuid, payload jsonb, attempts integer, max_attempts integer, lease_token uuid, run_at timestamp with time zone, claim_order integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
#variable_conflict use_column
DECLARE
    -- Groups the tenant-less jobs (tenant_id NULL) as one "tenant" for fairness.
    v_none CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
    -- 05-10a (R-27): kinds that still run for a clinic that is not `full` (closed set; V2-13b adds owner billing
    -- notices). Empty in V2-05.
    v_exempt CONSTANT TEXT[] := ARRAY[]::TEXT[];
BEGIN
    IF p_kinds IS NULL OR cardinality(p_kinds) NOT BETWEEN 1 AND 50
       OR p_batch IS NULL OR p_batch NOT BETWEEN 1 AND 100
       OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 900
       OR p_per_tenant IS NULL OR p_per_tenant NOT BETWEEN 1 AND 100
       OR p_worker IS NULL OR btrim(p_worker) = '' THEN
        RAISE EXCEPTION 'invalid_claim' USING ERRCODE = '22023';
    END IF;

    -- 05-10a (R-27): due jobs of a clinic whose access level is not `full` are cancelled, never claimed, so a locked
    -- clinic sends no patient message and none is sent late after a renewal. Rows another runner holds are skipped.


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
$function$;