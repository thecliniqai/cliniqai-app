-- Migration: 000040_ops_heartbeat_quota_report.sql
-- V2-04 plan 04-06: heartbeat (FT-03), quota monitor (FT-04 job part), ops retention (R-2, V2-03 R-27) and the
-- counts-only staging ops report (R-28). Rulings R-2, R-5, R-8, R-28, R-36, R-46, R-51; threats T-04-10, T-04-17,
-- T-04-18. Planned as 000039; 000039 went to 04-04, so this is the next free number (R-39).
--
--   * Heartbeat: pg_cron 'ops-heartbeat' (0 */6 * * *: 05:30, 11:30, 17:30, 23:30 IST) inserts one row into
--     ops.heartbeats. Rule `heartbeat_gap` (warn) fires when heartbeats exist and the newest is older than 7 h. Pause
--     warnings reach the PO through the Supabase organisation email (04-P7).
--   * Quota (R-8): pg_cron 'ops-quota-snapshot' (30 21 * * *: 03:00 IST) records the database size, the Storage bytes
--     (sum of storage.objects metadata sizes) and an MAU estimate (auth users signed in during the current UTC calendar
--     month) against ops.quota_limits for the plan in ops.settings (seeded Free: 500 MB, 1 GB, 50 000 MAU; decimal
--     units, conservative). Levels: >= 70 % critical, >= 60 % upgrade_trigger, else ok; no limit -> unknown. Rules
--     `quota_upgrade_trigger` (warn) and `quota_critical` (critical) read the newest snapshot. Weekly summary: pg_cron
--     'ops-quota-weekly-summary' (30 3 * * 1: Monday 09:00 IST) opens one `info` alert `quota_weekly_summary` per ISO
--     week and enqueues its alert.notify job; the rule keeps it open until its email is recorded as sent (R-51 retries,
--     at most 24 h), then the evaluator resolves it. Egress is not measured here: it stays the PO's monthly dashboard
--     check (the email says so).
--   * Retention (R-2, V2-03 R-27): pg_cron 'ops-cleanup' (45 21 * * *: 03:15 IST) runs ops.cleanup(): jobs done or
--     cancelled > 7 d, dead > 30 d; runner runs > 14 d; inbound webhook events > 30 d; resolved alerts > 180 d;
--     heartbeats > 90 d; quota snapshots and backup runs > 400 d; ops.purge_error_events('180 days') (03-09b, also
--     prunes old overflow counters). The newest heartbeat, quota snapshot, ok runner run and backup run per environment
--     are always kept, so a stopped schedule keeps firing its alert instead of being purged into silence.
--     cron.job_run_details stays with 04-02's 'cron-history-cleanup'.
--   * Ops report (R-28, T-04-17): ops.report_all(p_hours) returns counts, timestamps, kinds, rule names and codes only
--     (no ids, names, phones, emails, payloads or messages). It is definer and executable by no API role; the PO grants
--     EXECUTE (and USAGE on ops) to the staging read-only role clinicos_drift_ro (docs/runbooks/jobs.md §13, 04-P10),
--     which exists only on staging, so the grant is runbook SQL, not a migration.
--
-- Access: every table lives in `ops` (no USAGE for any API role), RLS on with no policy, every privilege revoked from
-- the API roles. Every function is executable by `postgres` only (pg_cron runs as postgres).

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Heartbeat (FT-03)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE TABLE ops.heartbeats (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'pg_cron' CHECK (source IN ('pg_cron', 'manual')),
    at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX heartbeats_at ON ops.heartbeats (at);

COMMENT ON TABLE ops.heartbeats IS
    'V2-04 04-06 (FT-03): one row per pg_cron heartbeat (every 6 h). Read by the heartbeat_gap alert and the ops report.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Quota (FT-04, R-8)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE TABLE ops.settings (
    key TEXT PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,62}$'),
    value TEXT NOT NULL CHECK (char_length(value) BETWEEN 1 AND 200)
);

COMMENT ON TABLE ops.settings IS
    'V2-04 04-06: operational settings. `plan` names the Supabase plan whose rows in ops.quota_limits apply.';

INSERT INTO ops.settings (key, value) VALUES ('plan', 'free') ON CONFLICT (key) DO NOTHING;

CREATE TABLE ops.quota_limits (
    plan TEXT NOT NULL CHECK (plan ~ '^[a-z][a-z0-9_]{0,30}$'),
    metric TEXT NOT NULL CHECK (metric IN ('db_bytes', 'storage_bytes', 'mau')),
    limit_value NUMERIC NOT NULL CHECK (limit_value > 0),
    PRIMARY KEY (plan, metric)
);

COMMENT ON TABLE ops.quota_limits IS
    'V2-04 04-06 (FT-04): plan limits in decimal units (bytes, users). Free is seeded; an upgrade is a reviewed '
    'migration that adds the new plan''s rows and updates ops.settings.plan.';

INSERT INTO ops.quota_limits (plan, metric, limit_value) VALUES
    ('free', 'db_bytes', 500000000),
    ('free', 'storage_bytes', 1000000000),
    ('free', 'mau', 50000)
ON CONFLICT (plan, metric) DO NOTHING;

CREATE TABLE ops.quota_snapshots (
    id BIGSERIAL PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    plan TEXT NOT NULL CHECK (plan ~ '^[a-z][a-z0-9_]{0,30}$'),
    db_bytes BIGINT NOT NULL CHECK (db_bytes >= 0),
    storage_bytes BIGINT NOT NULL CHECK (storage_bytes >= 0),
    mau_estimate INTEGER NOT NULL CHECK (mau_estimate >= 0),
    limits JSONB NOT NULL CHECK (jsonb_typeof(limits) = 'object' AND octet_length(limits::text) <= 512),
    levels JSONB NOT NULL CHECK (jsonb_typeof(levels) = 'object' AND octet_length(levels::text) <= 512)
);

CREATE INDEX quota_snapshots_at ON ops.quota_snapshots (at);

COMMENT ON TABLE ops.quota_snapshots IS
    'V2-04 04-06 (FT-04): daily usage snapshot (database bytes, Storage bytes, MAU estimate) with the limits and levels '
    'that applied. Counts only.';

ALTER TABLE ops.heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.quota_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.quota_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ops.heartbeats, ops.settings, ops.quota_limits, ops.quota_snapshots
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE ops.heartbeats_id_seq, ops.quota_snapshots_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Functions
-- ---------------------------------------------------------------------------------------------------------------------

-- ISO-8601 UTC text of a timestamp (the shape the alert email and the report checker accept).
CREATE FUNCTION ops.utc_text(p_at TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT CASE WHEN p_at IS NULL THEN NULL
                ELSE pg_catalog.to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END;
$$;

CREATE FUNCTION ops.heartbeat()
RETURNS TIMESTAMPTZ
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    INSERT INTO ops.heartbeats (source) VALUES ('pg_cron') RETURNING at;
$$;

COMMENT ON FUNCTION ops.heartbeat() IS
    'V2-04 04-06 (FT-03): records one pg_cron heartbeat. pg_cron every 6 h; postgres only.';

-- The quota threshold math (roadmap "quota-threshold unit test"): exact numeric comparison, no rounding.
CREATE FUNCTION ops.quota_level(p_used NUMERIC, p_limit NUMERIC)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_limit IS NULL OR p_limit <= 0 OR p_used IS NULL THEN 'unknown'
        WHEN p_used * 100 >= p_limit * 70 THEN 'critical'
        WHEN p_used * 100 >= p_limit * 60 THEN 'upgrade_trigger'
        ELSE 'ok'
    END;
$$;

COMMENT ON FUNCTION ops.quota_level(NUMERIC, NUMERIC) IS
    'V2-04 04-06 (FT-04, R-5): ok below 60 % of the limit, upgrade_trigger from 60 %, critical from 70 %, unknown '
    'without a positive limit.';

-- Flat alert details of one snapshot: numbers, ISO timestamps and level words (keys ending in _level) only.
CREATE FUNCTION ops.quota_details(p_snapshot_id BIGINT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH q AS (
        SELECT s.*,
               (s.limits ->> 'db_bytes')::numeric AS db_limit,
               (s.limits ->> 'storage_bytes')::numeric AS storage_limit,
               (s.limits ->> 'mau')::numeric AS mau_limit
          FROM ops.quota_snapshots s
         WHERE s.id = p_snapshot_id
    )
    SELECT coalesce((
        SELECT jsonb_build_object(
                   'snapshot_at', ops.utc_text(q.at),
                   'db_bytes', q.db_bytes,
                   'db_limit_bytes', q.db_limit,
                   'db_percent', CASE WHEN q.db_limit > 0 THEN round(q.db_bytes * 100.0 / q.db_limit, 1) END,
                   'db_level', q.levels ->> 'db_bytes',
                   'storage_bytes', q.storage_bytes,
                   'storage_limit_bytes', q.storage_limit,
                   'storage_percent', CASE WHEN q.storage_limit > 0 THEN round(q.storage_bytes * 100.0 / q.storage_limit, 1) END,
                   'storage_level', q.levels ->> 'storage_bytes',
                   'mau_estimate', q.mau_estimate,
                   'mau_limit', q.mau_limit,
                   'mau_percent', CASE WHEN q.mau_limit > 0 THEN round(q.mau_estimate * 100.0 / q.mau_limit, 1) END,
                   'mau_level', q.levels ->> 'mau'
               )
          FROM q
    ), '{}'::jsonb);
$$;

CREATE FUNCTION ops.quota_snapshot()
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
    v_plan TEXT := coalesce((SELECT s.value FROM ops.settings s WHERE s.key = 'plan'), 'free');
    v_db BIGINT := pg_catalog.pg_database_size(pg_catalog.current_database());
    v_storage BIGINT;
    v_mau INTEGER;
    v_limits JSONB;
    v_levels JSONB;
    v_row ops.quota_snapshots%ROWTYPE;
BEGIN
    -- Storage: the size Supabase Storage records per object (a non-numeric size counts as 0).
    SELECT coalesce(sum(CASE WHEN (o.metadata ->> 'size') ~ '^[0-9]{1,18}$' THEN (o.metadata ->> 'size')::bigint ELSE 0 END), 0)
      INTO v_storage
      FROM storage.objects o;
    -- MAU proxy (research A7): users who signed in during the current UTC calendar month.
    SELECT count(*)::integer
      INTO v_mau
      FROM auth.users u
     WHERE u.last_sign_in_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
    SELECT coalesce(jsonb_object_agg(l.metric, l.limit_value), '{}'::jsonb)
      INTO v_limits
      FROM ops.quota_limits l
     WHERE l.plan = v_plan;
    v_levels := jsonb_build_object(
        'db_bytes', ops.quota_level(v_db, (v_limits ->> 'db_bytes')::numeric),
        'storage_bytes', ops.quota_level(v_storage, (v_limits ->> 'storage_bytes')::numeric),
        'mau', ops.quota_level(v_mau, (v_limits ->> 'mau')::numeric)
    );

    INSERT INTO ops.quota_snapshots (plan, db_bytes, storage_bytes, mau_estimate, limits, levels)
    VALUES (v_plan, v_db, v_storage, v_mau, v_limits, v_levels)
    RETURNING * INTO v_row;

    RETURN jsonb_build_object(
        'id', v_row.id,
        'at', ops.utc_text(v_row.at),
        'plan', v_row.plan,
        'db_bytes', v_row.db_bytes,
        'storage_bytes', v_row.storage_bytes,
        'mau_estimate', v_row.mau_estimate,
        'limits', v_row.limits,
        'levels', v_row.levels
    );
END;
$$;

COMMENT ON FUNCTION ops.quota_snapshot() IS
    'V2-04 04-06 (FT-04, R-8): records database, Storage and MAU usage against the plan limits (60 %/70 % levels). '
    'pg_cron daily; postgres only.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Alert rules (04-04 registry: one INSERT per rule; definer, empty search_path, postgres only)
-- ---------------------------------------------------------------------------------------------------------------------

-- heartbeat_gap (warn, R-5): heartbeats are recorded and the newest is older than the threshold (default 7 h).
CREATE FUNCTION ops.alert_rule_heartbeat_gap(p_params JSONB)
RETURNS TABLE (firing BOOLEAN, details JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH p AS (
        SELECT coalesce((p_params ->> 'max_age_minutes')::int, 420) AS max_age_minutes
    ),
    h AS (
        SELECT max(b.at) AS last_at FROM ops.heartbeats b
    )
    SELECT h.last_at IS NOT NULL AND h.last_at < now() - make_interval(mins => p.max_age_minutes),
           jsonb_build_object(
               'max_age_minutes', p.max_age_minutes,
               'last_heartbeat_at', ops.utc_text(h.last_at),
               'age_minutes', CASE WHEN h.last_at IS NULL THEN NULL
                                   ELSE floor(extract(epoch FROM (now() - h.last_at)) / 60)::bigint END
           )
      FROM p, h;
$$;

-- quota_upgrade_trigger (warn, R-8): the newest snapshot has a metric at 60 % or more and none at 70 % or more.
CREATE FUNCTION ops.alert_rule_quota_upgrade_trigger(p_params JSONB)
RETURNS TABLE (firing BOOLEAN, details JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH s AS (
        SELECT q.id, q.levels FROM ops.quota_snapshots q ORDER BY q.at DESC, q.id DESC LIMIT 1
    )
    SELECT coalesce((
               SELECT EXISTS (SELECT 1 FROM jsonb_each_text(s.levels) l WHERE l.value = 'upgrade_trigger')
                      AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(s.levels) l WHERE l.value = 'critical')
                 FROM s
           ), false),
           coalesce((SELECT ops.quota_details(s.id) FROM s), '{}'::jsonb);
$$;

-- quota_critical (critical, R-8): the newest snapshot has a metric at 70 % or more of its limit.
CREATE FUNCTION ops.alert_rule_quota_critical(p_params JSONB)
RETURNS TABLE (firing BOOLEAN, details JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH s AS (
        SELECT q.id, q.levels FROM ops.quota_snapshots q ORDER BY q.at DESC, q.id DESC LIMIT 1
    )
    SELECT coalesce((
               SELECT EXISTS (SELECT 1 FROM jsonb_each_text(s.levels) l WHERE l.value = 'critical') FROM s
           ), false),
           coalesce((SELECT ops.quota_details(s.id) FROM s), '{}'::jsonb);
$$;

-- quota_weekly_summary (info, R-8): fires while this week's summary alert is open and its email is not yet recorded
-- as sent (at most deliver_hours), so the evaluator re-tries it (R-51) and resolves it once sent. Details are the
-- alert's own (opened by ops.enqueue_quota_weekly_summary), so a refresh never changes them.
CREATE FUNCTION ops.alert_rule_quota_weekly_summary(p_params JSONB)
RETURNS TABLE (firing BOOLEAN, details JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH p AS (
        SELECT coalesce((p_params ->> 'deliver_hours')::int, 24) AS deliver_hours
    ),
    a AS (
        SELECT al.details
          FROM ops.alerts al, p
         WHERE al.rule = 'quota_weekly_summary'
           AND al.status = 'open'
           AND al.notify_count = 0
           AND al.first_seen > now() - make_interval(hours => p.deliver_hours)
         LIMIT 1
    )
    SELECT EXISTS (SELECT 1 FROM a), coalesce((SELECT a.details FROM a), '{}'::jsonb);
$$;

REVOKE ALL ON FUNCTION ops.alert_rule_heartbeat_gap(JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.alert_rule_quota_upgrade_trigger(JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.alert_rule_quota_critical(JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.alert_rule_quota_weekly_summary(JSONB) FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO ops.alert_rules (rule, severity, fn, cooldown_minutes, params, description) VALUES
    ('heartbeat_gap', 'warn', 'ops.alert_rule_heartbeat_gap', 360, '{"max_age_minutes": 420}',
     'Heartbeats are recorded and the newest is older than the threshold: the 6-hourly pg_cron heartbeat stopped.'),
    ('quota_upgrade_trigger', 'warn', 'ops.alert_rule_quota_upgrade_trigger', 1440, '{}',
     'The newest quota snapshot has a metric at 60 % or more of the plan limit (none at 70 %): plan the upgrade.'),
    ('quota_critical', 'critical', 'ops.alert_rule_quota_critical', 1440, '{}',
     'The newest quota snapshot has a metric at 70 % or more of the plan limit.'),
    ('quota_weekly_summary', 'info', 'ops.alert_rule_quota_weekly_summary', 10080, '{"deliver_hours": 24}',
     'Weekly quota summary (opened Monday 09:00 IST): open until its email is recorded as sent, at most 24 h.')
ON CONFLICT (rule) DO NOTHING;

-- Weekly summary (R-8): one info alert per ISO week (Monday 00:00 UTC), from a fresh snapshot, with its alert.notify
-- job (notification 1, dedupe alert:<id>:1) enqueued the way ops.evaluate_alerts() does. Returns the alert id, or NULL
-- when this week's summary exists or the rule is disabled.
CREATE FUNCTION ops.enqueue_quota_weekly_summary()
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
    v_now_utc TIMESTAMP := now() AT TIME ZONE 'UTC';
    v_week_start TIMESTAMPTZ := date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    v_severity TEXT;
    v_snapshot JSONB;
    v_details JSONB;
    v_alert UUID;
    v_job UUID;
BEGIN
    -- Same lock as the evaluator: the two never interleave on ops.alerts.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ops.evaluate_alerts'));

    SELECT r.severity INTO v_severity FROM ops.alert_rules r WHERE r.rule = 'quota_weekly_summary' AND r.enabled;
    IF v_severity IS NULL THEN
        RETURN NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM ops.alerts a WHERE a.rule = 'quota_weekly_summary' AND a.first_seen >= v_week_start) THEN
        RETURN NULL;
    END IF;

    -- A previous week's summary still open (never sent within its window) is closed; the report keeps showing it.
    UPDATE ops.alerts a
       SET status = 'resolved', resolved_at = now()
     WHERE a.rule = 'quota_weekly_summary' AND a.status = 'open';

    v_snapshot := ops.quota_snapshot();
    v_details := ops.quota_details((v_snapshot ->> 'id')::bigint)
        || jsonb_build_object(
               'iso_year', extract(isoyear FROM v_now_utc)::int,
               'iso_week', extract(week FROM v_now_utc)::int
           );

    INSERT INTO ops.alerts (rule, severity, details)
    VALUES ('quota_weekly_summary', v_severity, v_details)
    RETURNING id INTO v_alert;

    v_job := ops.enqueue_job(
        'alert.notify',
        NULL,
        jsonb_build_object('alert_id', v_alert, 'seq', 1),
        'alert:' || v_alert::text || ':1',
        now(),
        5
    );
    UPDATE ops.alerts a
       SET notify_seq_enqueued = 1, notify_tries = 1, notify_enqueued_at = now(), notify_job_id = v_job
     WHERE a.id = v_alert;
    RETURN v_alert;
END;
$$;

COMMENT ON FUNCTION ops.enqueue_quota_weekly_summary() IS
    'V2-04 04-06 (R-8): opens this ISO week''s info alert quota_weekly_summary from a fresh quota snapshot and '
    'enqueues its email (alert.notify). Idempotent per ISO week. pg_cron Monday 03:30 UTC; postgres only.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Retention (R-2, V2-03 R-27)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION ops.cleanup()
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
    RETURN v_out;
END;
$$;

COMMENT ON FUNCTION ops.cleanup() IS
    'V2-04 04-06 (R-2, V2-03 R-27): deletes ops rows past their retention (jobs done/cancelled 7 d, dead 30 d; runner '
    'runs 14 d; inbound events 30 d; resolved alerts 180 d; heartbeats 90 d; quota snapshots and backup runs 400 d; '
    'error events 180 d) and returns the counts. Keeps the newest heartbeat, snapshot, ok runner run and backup run per '
    'environment. pg_cron daily; postgres only.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Ops report (R-28, T-04-17): counts and timestamps only
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION ops.report_all(p_hours INTEGER DEFAULT 48)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := now();
    v_since TIMESTAMPTZ;
BEGIN
    IF p_hours IS NULL OR p_hours < 1 OR p_hours > 336 THEN
        RAISE EXCEPTION 'invalid_report_window' USING ERRCODE = '22023';
    END IF;
    v_since := v_now - make_interval(hours => p_hours);

    RETURN jsonb_build_object(
        'report_version', 1,
        'generated_at', ops.utc_text(v_now),
        'window_hours', p_hours,
        'jobs', jsonb_build_object(
            -- Jobs created in the window, plus every job still pending or running.
            'by_kind_status', (
                SELECT coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'status', x.status, 'count', x.n)
                                          ORDER BY x.kind, x.status), '[]'::jsonb)
                  FROM (SELECT j.kind, j.status, count(*) AS n
                          FROM ops.jobs j
                         WHERE j.created_at >= v_since OR j.status IN ('pending', 'running')
                         GROUP BY j.kind, j.status) x
            ),
            -- Queue lag: first claim minus run_at over jobs first claimed in the window (same rule as queue_lag).
            'lag', (
                SELECT jsonb_build_object(
                           'samples', count(*),
                           'p50_seconds', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY s.lag))::numeric, 1),
                           'p95_seconds', round((percentile_cont(0.95) WITHIN GROUP (ORDER BY s.lag))::numeric, 1),
                           'max_seconds', round(max(s.lag)::numeric, 1)
                       )
                  FROM (SELECT extract(epoch FROM (j.first_claimed_at - j.run_at)) AS lag
                          FROM ops.jobs j
                         WHERE j.first_claimed_at >= v_since AND j.first_claimed_at >= j.run_at) s
            )
        ),
        'dead_last_24h', (
            SELECT jsonb_build_object(
                       'total', coalesce(sum(x.n), 0),
                       'by_kind', coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'count', x.n) ORDER BY x.kind)
                                               FILTER (WHERE x.kind IS NOT NULL), '[]'::jsonb)
                   )
              FROM (SELECT j.kind, count(*) AS n
                      FROM ops.jobs j
                     WHERE j.status = 'dead' AND j.finished_at >= v_now - INTERVAL '24 hours'
                     GROUP BY j.kind) x
        ),
        'runner', jsonb_build_object(
            'configured', EXISTS (SELECT 1 FROM vault.secrets v WHERE v.name = 'jobs_runner_url'),
            'runs', (SELECT count(*) FROM ops.job_runner_runs r WHERE r.started_at >= v_since),
            'ok_runs', (SELECT count(*) FROM ops.job_runner_runs r WHERE r.started_at >= v_since AND r.ok),
            -- Largest time between consecutive ok passes in the window, the last one measured to now.
            'largest_ok_gap_seconds', (
                SELECT round(max(g.gap)::numeric, 1)
                  FROM (SELECT extract(epoch FROM (lead(r.started_at, 1, v_now) OVER (ORDER BY r.started_at, r.id)
                                                   - r.started_at)) AS gap
                          FROM ops.job_runner_runs r
                         WHERE r.ok AND r.started_at >= v_since) g
            ),
            'last_ok_age_seconds', (
                SELECT round(extract(epoch FROM (v_now - max(r.started_at)))::numeric, 1)
                  FROM ops.job_runner_runs r WHERE r.ok
            )
        ),
        -- Open alerts and alerts seen in the window (newest 100): rule, state and delivery facts; never details.
        'alerts', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'rule', a.rule,
                       'severity', a.severity,
                       'status', a.status,
                       'opened', ops.utc_text(a.first_seen),
                       'last_seen', ops.utc_text(a.last_seen),
                       'resolved_at', ops.utc_text(a.resolved_at),
                       'count', a.count,
                       'notified', a.notified_at IS NOT NULL,
                       'notify_count', a.notify_count,
                       'notify_tries', a.notify_tries,
                       'unsent', a.notify_seq_enqueued > a.notify_count,
                       'provider_id_present', a.provider_message_id IS NOT NULL
                   ) ORDER BY a.first_seen DESC, a.rule), '[]'::jsonb)
              FROM (SELECT al.*
                      FROM ops.alerts al
                     WHERE al.status = 'open' OR al.last_seen >= v_since
                     ORDER BY al.first_seen DESC
                     LIMIT 100) a
        ),
        'heartbeats', (
            SELECT jsonb_build_object(
                       'count', count(*),
                       'at', coalesce(jsonb_agg(ops.utc_text(h.at) ORDER BY h.at), '[]'::jsonb),
                       -- Largest time between consecutive heartbeats in the window, the last one measured to now.
                       'largest_gap_seconds', round(max(h.gap)::numeric, 1),
                       -- From the first heartbeat in the window to now (how long the gap figure covers).
                       'covered_seconds', round(extract(epoch FROM (v_now - min(h.at)))::numeric, 1),
                       'last_at', ops.utc_text((SELECT max(k.at) FROM ops.heartbeats k))
                   )
              FROM (SELECT b.at,
                           extract(epoch FROM (lead(b.at, 1, v_now) OVER (ORDER BY b.at, b.id) - b.at)) AS gap
                      FROM ops.heartbeats b
                     WHERE b.at >= v_since
                     ORDER BY b.at
                     LIMIT 500) h
        ),
        'quota', (
            SELECT jsonb_build_object(
                       'at', ops.utc_text(q.at),
                       'plan', q.plan,
                       'db_bytes', q.db_bytes,
                       'storage_bytes', q.storage_bytes,
                       'mau_estimate', q.mau_estimate,
                       'limits', q.limits,
                       'levels', q.levels
                   )
              FROM ops.quota_snapshots q
             ORDER BY q.at DESC, q.id DESC
             LIMIT 1
        ),
        'backups', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'environment', b.environment,
                       'started_at', ops.utc_text(b.started_at),
                       'finished_at', ops.utc_text(b.finished_at),
                       'status', b.status,
                       'archive_bytes', b.archive_bytes,
                       'duration_s', b.duration_s,
                       'error_code', b.error_code
                   ) ORDER BY b.started_at, b.id), '[]'::jsonb)
              FROM (SELECT k.* FROM ops.backup_runs k WHERE k.started_at >= v_since
                     ORDER BY k.started_at DESC, k.id DESC LIMIT 200) b
        ),
        -- Row counts of the ops tables (growth against the 500 MB database, T-04-18).
        'tables', jsonb_build_object(
            'jobs', (SELECT count(*) FROM ops.jobs),
            'job_runner_runs', (SELECT count(*) FROM ops.job_runner_runs),
            'alerts', (SELECT count(*) FROM ops.alerts),
            'heartbeats', (SELECT count(*) FROM ops.heartbeats),
            'quota_snapshots', (SELECT count(*) FROM ops.quota_snapshots),
            'backup_runs', (SELECT count(*) FROM ops.backup_runs),
            'inbound_webhook_events', (SELECT count(*) FROM ops.inbound_webhook_events),
            'error_events', (SELECT count(*) FROM ops.error_events)
        )
    );
END;
$$;

COMMENT ON FUNCTION ops.report_all(INTEGER) IS
    'V2-04 04-06 (R-28, T-04-17): the staging ops report: job counts by kind and status, queue lag, runner passes, '
    'alerts (state only), heartbeats, the latest quota snapshot, backup runs and ops table sizes. Counts, timestamps, '
    'kinds, rule names and codes only. Executable by no API role; the PO grants it to clinicos_drift_ro on staging.';

REVOKE ALL ON FUNCTION ops.utc_text(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.heartbeat() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.quota_level(NUMERIC, NUMERIC) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.quota_details(BIGINT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.quota_snapshot() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.enqueue_quota_weekly_summary() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.cleanup() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.report_all(INTEGER) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Schedules (GMT; name-keyed, so re-applying updates the row instead of adding one)
-- ---------------------------------------------------------------------------------------------------------------------

SELECT cron.schedule('ops-heartbeat', '0 */6 * * *', 'select ops.heartbeat()');
SELECT cron.schedule('ops-quota-snapshot', '30 21 * * *', 'select ops.quota_snapshot()');
SELECT cron.schedule('ops-quota-weekly-summary', '30 3 * * 1', 'select ops.enqueue_quota_weekly_summary()');
SELECT cron.schedule('ops-cleanup', '45 21 * * *', 'select ops.cleanup()');
