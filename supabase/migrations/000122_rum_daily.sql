-- Migration: 000122_rum_daily.sql
-- V2-09e 09E-02 (R-20, decision 10; threats T-09E-14, T-09E-15): real-user monitoring without a vendor, stored in the project's own
-- (India-resident) Postgres. The browser sends batches of timings to `POST /api/rum`; the route calls
-- `public.ops_ingest_rum(environment, release, samples)`; each sample becomes +1 in a histogram bucket of `ops.rum_daily`.
--
--   * What is stored: day (UTC), environment, release, screen, metric, device class, network class, bucket, count. No tenant, user,
--     URL, id, text or time of day. Every dimension is a closed list checked here again (a second line behind the route's zod).
--   * `ops` stays unserved: no grant to anon, authenticated or service_role on the schema or the tables, RLS on with no policy.
--     The only door is the definer function, executable by `authenticated` alone.
--   * A sample with an unknown key, a value outside a closed list, a non-numeric or out-of-range value, or a batch of more than
--     60 samples refuses the whole call and writes nothing.
--   * A daily total cap (`ops.rum_daily_cap()`) sends the rest of the day's samples to `ops.rum_overflow` (T-09E-15).
--   * `ops.rum_report(p_days)`: p50, p75, p95 (bucket upper bounds) and the count per environment, screen, metric and device;
--     postgres only (the PO runs it in the SQL editor).
--   * Retention: `ops.cleanup()` also deletes rum rows older than 90 days (its latest body is 000040).
--   * `pg_stat_statements` (the database report of 09E-02 step 3) is created in the `extensions` schema if the project lacks it
--     (on by default in hosted projects; the local stack has it).

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------------------------------------------------

CREATE TABLE ops.rum_daily (
    day DATE NOT NULL,
    environment TEXT NOT NULL CHECK (environment IN ('development', 'test', 'e2e', 'ci', 'staging', 'production')),
    release TEXT NOT NULL CHECK (release ~ '^([0-9a-f]{7,40}|unknown)$'),
    screen TEXT NOT NULL CHECK (screen IN ('today', 'schedule', 'patients', 'patient', 'consult', 'visits', 'billing', 'settings', 'staff', 'other')),
    metric TEXT NOT NULL CHECK (metric IN (
        'lcp', 'inp', 'cls', 'ttfb', 'fcp', 'nav_data_ready', 'load_data_ready', 'search_server', 'search_device',
        'save_reversible', 'save_confirmed', 'finish_confirmed', 'live_reread', 'live_dropped', 'live_reconnect')),
    device TEXT NOT NULL CHECK (device IN ('phone', 'tablet', 'desktop')),
    net TEXT NOT NULL CHECK (net IN ('slow-2g', '2g', '3g', '4g', 'unknown')),
    bucket SMALLINT NOT NULL CHECK (bucket BETWEEN 0 AND 40),
    count BIGINT NOT NULL CHECK (count >= 1),
    PRIMARY KEY (day, environment, release, screen, metric, device, net, bucket)
);

COMMENT ON TABLE ops.rum_daily IS
    'V2-09e 09E-02 (R-20): real-user timing histograms, one row per day and closed-list combination; count = samples in the bucket. '
    'No tenant, user, URL, id, text or time of day. Written only by public.ops_ingest_rum; read by ops.rum_report (postgres).';

CREATE TABLE ops.rum_overflow (
    day DATE PRIMARY KEY,
    dropped BIGINT NOT NULL DEFAULT 0 CHECK (dropped >= 0)
);

COMMENT ON TABLE ops.rum_overflow IS
    'V2-09e 09E-02 (T-09E-15): samples dropped per UTC day because the daily total cap (ops.rum_daily_cap) was reached.';

ALTER TABLE ops.rum_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.rum_overflow ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ops.rum_daily, ops.rum_overflow FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Cap, bucket bounds and bucketing (functions, so a change is one reviewed migration)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION ops.rum_daily_cap()
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT 500000::bigint;
$$;

COMMENT ON FUNCTION ops.rum_daily_cap() IS
    'V2-09e 09E-02 (T-09E-15): real-user samples accepted per UTC day; later samples only increment ops.rum_overflow.';

-- Upper bounds of the buckets: bucket i (1-based) holds values <= bound i and > bound i-1; one more bucket holds everything above the
-- last bound. Milliseconds for the timings, unitless for CLS; the count metrics have no bounds (bucket 0).
CREATE FUNCTION ops.rum_bounds(p_metric TEXT)
RETURNS NUMERIC[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_metric = 'cls' THEN ARRAY[0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1, 2, 5]::numeric[]
        WHEN p_metric IN ('live_dropped', 'live_reconnect') THEN NULL::numeric[]
        ELSE ARRAY[10, 20, 30, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000, 30000, 60000]::numeric[]
    END;
$$;

COMMENT ON FUNCTION ops.rum_bounds(TEXT) IS
    'V2-09e 09E-02: the fixed, log-spaced bucket upper bounds of a metric (ms; CLS unitless); NULL for the count metrics.';

CREATE FUNCTION ops.rum_bucket(p_metric TEXT, p_value NUMERIC)
RETURNS SMALLINT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN ops.rum_bounds(p_metric) IS NULL THEN 0
        ELSE coalesce(
            (SELECT min(t.i) FROM unnest(ops.rum_bounds(p_metric)) WITH ORDINALITY AS t(bound, i) WHERE p_value <= t.bound),
            cardinality(ops.rum_bounds(p_metric)) + 1
        )
    END::smallint;
$$;

COMMENT ON FUNCTION ops.rum_bucket(TEXT, NUMERIC) IS
    'V2-09e 09E-02: the bucket of a value: the first bound that is >= the value (1-based), one past the last bound above it, 0 for count metrics.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Ingest
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION public.ops_ingest_rum(p_environment TEXT, p_release TEXT, p_samples JSONB)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    c_screens CONSTANT TEXT[] := ARRAY['today', 'schedule', 'patients', 'patient', 'consult', 'visits', 'billing', 'settings', 'staff', 'other'];
    c_metrics CONSTANT TEXT[] := ARRAY[
        'lcp', 'inp', 'cls', 'ttfb', 'fcp', 'nav_data_ready', 'load_data_ready', 'search_server', 'search_device',
        'save_reversible', 'save_confirmed', 'finish_confirmed', 'live_reread', 'live_dropped', 'live_reconnect'];
    c_devices CONSTANT TEXT[] := ARRAY['phone', 'tablet', 'desktop'];
    c_nets CONSTANT TEXT[] := ARRAY['slow-2g', '2g', '3g', '4g', 'unknown'];
    c_keys CONSTANT TEXT[] := ARRAY['device', 'metric', 'net', 'screen', 'value'];
    v_release TEXT := coalesce(nullif(p_release, ''), 'unknown');
    v_day DATE := (now() AT TIME ZONE 'utc')::date;
    v_n INTEGER;
    v_sample JSONB;
    v_value NUMERIC;
    v_metric TEXT;
    v_used BIGINT;
    v_room BIGINT;
    v_accepted INTEGER;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'rum: not signed in' USING ERRCODE = '42501';
    END IF;
    IF p_environment IS NULL OR p_environment NOT IN ('development', 'test', 'e2e', 'ci', 'staging', 'production') THEN
        RAISE EXCEPTION 'rum: refused' USING ERRCODE = '22023';
    END IF;
    IF v_release !~ '^([0-9a-f]{7,40}|unknown)$' THEN
        RAISE EXCEPTION 'rum: refused' USING ERRCODE = '22023';
    END IF;
    IF p_samples IS NULL OR jsonb_typeof(p_samples) <> 'array' THEN
        RAISE EXCEPTION 'rum: refused' USING ERRCODE = '22023';
    END IF;
    v_n := jsonb_array_length(p_samples);
    IF v_n > 60 THEN
        RAISE EXCEPTION 'rum: refused' USING ERRCODE = '22023';
    END IF;
    IF v_n = 0 THEN
        RETURN;
    END IF;

    -- Every sample is checked before anything is written; the first bad one refuses the batch (the message never echoes input).
    FOR v_sample IN SELECT e FROM jsonb_array_elements(p_samples) AS e LOOP
        IF jsonb_typeof(v_sample) <> 'object'
           OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_sample) AS k) IS DISTINCT FROM c_keys
           OR jsonb_typeof(v_sample -> 'screen') <> 'string' OR jsonb_typeof(v_sample -> 'metric') <> 'string'
           OR jsonb_typeof(v_sample -> 'device') <> 'string' OR jsonb_typeof(v_sample -> 'net') <> 'string'
           OR jsonb_typeof(v_sample -> 'value') <> 'number'
        THEN
            RAISE EXCEPTION 'rum: refused' USING ERRCODE = '22023';
        END IF;
        IF NOT ((v_sample ->> 'screen') = ANY (c_screens))
           OR NOT ((v_sample ->> 'metric') = ANY (c_metrics))
           OR NOT ((v_sample ->> 'device') = ANY (c_devices))
           OR NOT ((v_sample ->> 'net') = ANY (c_nets))
        THEN
            RAISE EXCEPTION 'rum: refused' USING ERRCODE = '22023';
        END IF;
        v_metric := v_sample ->> 'metric';
        v_value := (v_sample ->> 'value')::numeric;
        IF v_metric IN ('live_dropped', 'live_reconnect') THEN
            IF v_value < 0 OR v_value > 1000 THEN RAISE EXCEPTION 'rum: refused' USING ERRCODE = '22023'; END IF;
        ELSIF v_metric = 'cls' THEN
            IF v_value < 0 OR v_value > 100 THEN RAISE EXCEPTION 'rum: refused' USING ERRCODE = '22023'; END IF;
        ELSE
            IF v_value < 0 OR v_value > 600000 THEN RAISE EXCEPTION 'rum: refused' USING ERRCODE = '22023'; END IF;
        END IF;
    END LOOP;

    -- Daily total cap (T-09E-15): what does not fit goes to the overflow counter.
    SELECT coalesce(sum(r.count), 0) INTO v_used FROM ops.rum_daily r WHERE r.day = v_day;
    v_room := greatest(ops.rum_daily_cap() - v_used, 0);
    v_accepted := least(v_n::bigint, v_room)::integer;

    IF v_accepted > 0 THEN
        INSERT INTO ops.rum_daily (day, environment, release, screen, metric, device, net, bucket, count)
        SELECT v_day, p_environment, v_release, s.screen, s.metric, s.device, s.net, ops.rum_bucket(s.metric, s.value), count(*)
          FROM (
              SELECT e ->> 'screen' AS screen, e ->> 'metric' AS metric, e ->> 'device' AS device, e ->> 'net' AS net,
                     (e ->> 'value')::numeric AS value
                FROM jsonb_array_elements(p_samples) WITH ORDINALITY AS t(e, ord)
               WHERE t.ord <= v_accepted
          ) s
         GROUP BY s.screen, s.metric, s.device, s.net, ops.rum_bucket(s.metric, s.value)
        ON CONFLICT (day, environment, release, screen, metric, device, net, bucket)
        DO UPDATE SET count = ops.rum_daily.count + EXCLUDED.count;
    END IF;

    IF v_accepted < v_n THEN
        INSERT INTO ops.rum_overflow (day, dropped) VALUES (v_day, v_n - v_accepted)
        ON CONFLICT (day) DO UPDATE SET dropped = ops.rum_overflow.dropped + EXCLUDED.dropped;
    END IF;
END;
$$;

COMMENT ON FUNCTION public.ops_ingest_rum(TEXT, TEXT, JSONB) IS
    'V2-09e 09E-02 (R-20, T-09E-14): adds up to 60 real-user timing samples to ops.rum_daily histograms. Closed lists for screen, metric, '
    'device and net; exactly the keys screen/metric/device/net/value; a numeric value in range; any other shape refuses the whole call and '
    'writes nothing. Stores no tenant, user, URL, id or text. A daily cap sends the rest to ops.rum_overflow. Signed-in callers only.';

REVOKE ALL ON FUNCTION public.ops_ingest_rum(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ops_ingest_rum(TEXT, TEXT, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION ops.rum_daily_cap() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.rum_bounds(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.rum_bucket(TEXT, NUMERIC) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Report (the PO runs it in the SQL editor)
-- ---------------------------------------------------------------------------------------------------------------------

-- The upper bound of a bucket as a number (Infinity for the bucket above the last bound, NULL for the count metrics).
CREATE FUNCTION ops.rum_edge(p_metric TEXT, p_bucket SMALLINT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN ops.rum_bounds(p_metric) IS NULL THEN NULL
        WHEN p_bucket > cardinality(ops.rum_bounds(p_metric)) THEN 'Infinity'::numeric
        ELSE (ops.rum_bounds(p_metric))[p_bucket]
    END;
$$;

COMMENT ON FUNCTION ops.rum_edge(TEXT, SMALLINT) IS
    'V2-09e 09E-02: the upper bound of a bucket (Infinity above the last bound; NULL for the count metrics).';


CREATE FUNCTION ops.rum_report(p_days INTEGER DEFAULT 7)
RETURNS TABLE (environment TEXT, screen TEXT, metric TEXT, device TEXT, samples BIGINT, p50 NUMERIC, p75 NUMERIC, p95 NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH picked AS (
        SELECT r.environment, r.screen, r.metric, r.device, r.bucket, sum(r.count)::bigint AS n
          FROM ops.rum_daily r
         WHERE r.day > (now() AT TIME ZONE 'utc')::date - greatest(coalesce(p_days, 7), 1)
         GROUP BY r.environment, r.screen, r.metric, r.device, r.bucket
    ), running AS (
        SELECT p.*, sum(p.n) OVER (PARTITION BY p.environment, p.screen, p.metric, p.device ORDER BY p.bucket) AS cum,
               sum(p.n) OVER (PARTITION BY p.environment, p.screen, p.metric, p.device) AS total
          FROM picked p
    )
    SELECT g.environment, g.screen, g.metric, g.device, max(g.total)::bigint AS samples,
           min(ops.rum_edge(g.metric, g.bucket)) FILTER (WHERE g.cum >= 0.50 * g.total) AS p50,
           min(ops.rum_edge(g.metric, g.bucket)) FILTER (WHERE g.cum >= 0.75 * g.total) AS p75,
           min(ops.rum_edge(g.metric, g.bucket)) FILTER (WHERE g.cum >= 0.95 * g.total) AS p95
      FROM running g
     GROUP BY g.environment, g.screen, g.metric, g.device
     ORDER BY g.environment, g.screen, g.metric, g.device;
$$;

COMMENT ON FUNCTION ops.rum_report(INTEGER) IS
    'V2-09e 09E-02 (R-20): sample count and p50/p75/p95 (bucket upper bounds, ms; CLS unitless) per environment, screen, metric and device '
    'over the last p_days UTC days. Count metrics report samples only. Executable by no API role; the PO runs it in the SQL editor.';

REVOKE ALL ON FUNCTION ops.rum_edge(TEXT, SMALLINT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.rum_report(INTEGER) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Retention: ops.cleanup() (body of 000040) also removes real-user rows past 90 days
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.cleanup()
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
    v_out JSONB := '{}'::jsonb;
    v_n INTEGER;
BEGIN
    DELETE FROM ops.jobs j
     WHERE j.status IN ('done', 'cancelled') AND coalesce(j.finished_at, j.updated_at) < now() - INTERVAL '7 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('jobs_finished', v_n);

    DELETE FROM ops.jobs j
     WHERE j.status = 'dead' AND coalesce(j.finished_at, j.updated_at) < now() - INTERVAL '30 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('jobs_dead', v_n);

    DELETE FROM ops.job_runner_runs r
     WHERE r.started_at < now() - INTERVAL '14 days'
       AND r.id IS DISTINCT FROM (
           SELECT k.id FROM ops.job_runner_runs k WHERE k.ok ORDER BY k.started_at DESC, k.id DESC LIMIT 1
       );
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('job_runner_runs', v_n);

    DELETE FROM ops.inbound_webhook_events e WHERE e.received_at < now() - INTERVAL '30 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('inbound_webhook_events', v_n);

    DELETE FROM ops.alerts a WHERE a.status = 'resolved' AND a.resolved_at < now() - INTERVAL '180 days';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('alerts', v_n);

    DELETE FROM ops.heartbeats h
     WHERE h.at < now() - INTERVAL '90 days'
       AND h.id IS DISTINCT FROM (SELECT k.id FROM ops.heartbeats k ORDER BY k.at DESC, k.id DESC LIMIT 1);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('heartbeats', v_n);

    DELETE FROM ops.quota_snapshots q
     WHERE q.at < now() - INTERVAL '400 days'
       AND q.id IS DISTINCT FROM (SELECT k.id FROM ops.quota_snapshots k ORDER BY k.at DESC, k.id DESC LIMIT 1);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('quota_snapshots', v_n);

    DELETE FROM ops.backup_runs b
     WHERE b.created_at < now() - INTERVAL '400 days'
       AND b.id NOT IN (
           SELECT DISTINCT ON (k.environment) k.id
             FROM ops.backup_runs k
            ORDER BY k.environment, k.started_at DESC, k.id DESC
       );
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('backup_runs', v_n);

    v_out := v_out || jsonb_build_object('error_events', ops.purge_error_events(INTERVAL '180 days'));

    -- V2-09e 09E-02: real-user timing histograms and their overflow counter, 90 days.
    DELETE FROM ops.rum_daily d WHERE d.day < (now() AT TIME ZONE 'utc')::date - 90;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('rum_daily', v_n);

    DELETE FROM ops.rum_overflow o WHERE o.day < (now() AT TIME ZONE 'utc')::date - 90;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('rum_overflow', v_n);

    RETURN v_out;
END;
$$;

COMMENT ON FUNCTION ops.cleanup() IS
    'V2-04 04-06 (R-2, V2-03 R-27), V2-09e 09E-02: deletes ops rows past their retention (jobs done/cancelled 7 d, dead 30 d; runner '
    'runs 14 d; inbound events 30 d; resolved alerts 180 d; heartbeats 90 d; quota snapshots and backup runs 400 d; '
    'error events 180 d; real-user timing rows rum_daily and rum_overflow 90 d) and returns the counts. Keeps the newest heartbeat, snapshot, ok runner run and backup run per '
    'environment. pg_cron daily; postgres only.';
