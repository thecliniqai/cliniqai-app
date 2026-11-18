-- Migration: 000039_ops_alerts.sql
-- V2-04 plan 04-04: alerts (P1-25 alerts part; rulings R-1, R-5, R-32, R-36, R-41, R-46; threats T-04-09, T-04-10,
-- T-04-22). Planned as 000038; 000037/000038 went to 04-03c, so this is the next free number (R-39).
--
-- pg_cron → ops.evaluate_alerts() every 5 minutes → one row per firing rule in ops.alerts → an `alert.notify` job →
-- the job runner → lib/email EmailSender → OPS_ALERT_EMAIL (R-1: email only). Evaluation is pure SQL, so it keeps
-- running (and the open alerts stay visible to the ops report, 04-06) while the app is down.
--
--   * ops.alert_rules: one row per rule (severity, the rule function's name, enabled, cooldown, parameters). A rule
--     function `ops.alert_rule_<x>(p_params jsonb)` returns one row `(firing boolean, details jsonb)`; details hold
--     counts, rule parameters, ISO timestamps and at most 10 job ids, never a name, phone, email, payload or message
--     (T-04-10, T-04-22). The function is stored by name (text), not as `regprocedure`: pg_upgrade refuses user tables
--     with reg* columns other than regclass/regtype/regrole, and Supabase major upgrades use pg_upgrade.
--   * ops.alerts: at most one open alert per rule (unique partial index). Firing → open or refresh (count + 1,
--     last_seen, details, clean_evaluations 0). Newly opened, or last notified longer ago than the rule's cooldown →
--     one `alert.notify` job for notification n = notify_count + 1, keyed `alert:<id>:<n>`, so a persistent condition
--     sends one email per cooldown, and a repeated evaluation cannot enqueue a second job for the same notification.
--     Not firing → clean_evaluations + 1; resolved at 2.
--   * At-least-once (ruling R-51, reverses 04-04 D7): a notification that has not been recorded as sent (its job died,
--     e.g. the provider was down or the channel unconfigured) is enqueued again by the next evaluation at least 15
--     minutes after the previous try, while no try of it is still pending or running, keyed `alert:<id>:<n>:r<try>`,
--     until notified_at/notify_count record it. The handler sends nothing for an n already recorded and passes the
--     provider idempotency key `ops-alert/<id>/<n>`, so a successful notification is emailed once.
--   * Recursion guard (R-36): `alert.notify` jobs never count toward `dead_letter`; the retry above is rate-limited
--     (one try per 15 minutes per alert), so a broken channel cannot flood the queue.
--   * public.ops_alert_payload / public.ops_alert_notified: the handler's two RPCs, service_role only.
--   * readiness_probe(p_expected_migration) (R-41, revised for V2-03 M-PROBE): same signature, still booleans only and
--     anon only; adds jobs_backlog, jobs_dead_24h, runner_stale, alerts_critical_open, each an indexed EXISTS.
--
-- Access: both tables live in `ops` (no USAGE for any API role), RLS on with no policy, every privilege revoked from
-- the API roles. Rule functions and the evaluator are executable by `postgres` only (pg_cron runs as postgres).

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Indexes the rules and the probe read (ops.jobs from 04-01)
-- ---------------------------------------------------------------------------------------------------------------------

-- queue_lag: jobs first claimed in the last window.
CREATE INDEX IF NOT EXISTS jobs_first_claimed_at ON ops.jobs (first_claimed_at) WHERE first_claimed_at IS NOT NULL;
-- lease_expiry: re-claims and reaps of an expired lease in the last window.
CREATE INDEX IF NOT EXISTS jobs_last_lease_expired_at ON ops.jobs (last_lease_expired_at)
    WHERE last_lease_expired_at IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------------------------------------------------

CREATE TABLE ops.alert_rules (
    rule TEXT PRIMARY KEY CHECK (rule ~ '^[a-z][a-z0-9_]{1,62}$'),
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'warn', 'info')),
    fn TEXT NOT NULL CHECK (fn ~ '^ops\.alert_rule_[a-z0-9_]{1,40}$'),
    enabled BOOLEAN NOT NULL DEFAULT true,
    cooldown_minutes INTEGER NOT NULL DEFAULT 60 CHECK (cooldown_minutes BETWEEN 5 AND 10080),
    params JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(params) = 'object' AND octet_length(params::text) <= 1024),
    description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 300)
);

COMMENT ON TABLE ops.alert_rules IS
    'V2-04 04-04: alert rules evaluated by ops.evaluate_alerts() every 5 minutes. fn names ops.alert_rule_<x>(jsonb), '
    'which returns (firing, details) with counts, parameters, timestamps and ids only. Runbook: docs/runbooks/jobs.md.';

CREATE TABLE ops.alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule TEXT NOT NULL REFERENCES ops.alert_rules (rule) ON UPDATE CASCADE,
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'warn', 'info')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    count INTEGER NOT NULL DEFAULT 1 CHECK (count >= 1),
    details JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 4096),
    clean_evaluations INTEGER NOT NULL DEFAULT 0 CHECK (clean_evaluations >= 0),
    notified_at TIMESTAMPTZ,
    notify_count INTEGER NOT NULL DEFAULT 0 CHECK (notify_count >= 0),
    -- R-51: the notification last enqueued (n), how many tries of it, when, and the job of the latest try.
    notify_seq_enqueued INTEGER NOT NULL DEFAULT 0 CHECK (notify_seq_enqueued >= 0),
    notify_tries INTEGER NOT NULL DEFAULT 0 CHECK (notify_tries >= 0),
    notify_enqueued_at TIMESTAMPTZ,
    notify_job_id UUID,
    provider_message_id TEXT CHECK (char_length(provider_message_id) <= 200),
    resolved_at TIMESTAMPTZ,
    CONSTRAINT alerts_resolved_has_time CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
);

CREATE UNIQUE INDEX alerts_one_open_per_rule ON ops.alerts (rule) WHERE status = 'open';
CREATE INDEX alerts_open_severity ON ops.alerts (severity) WHERE status = 'open';
CREATE INDEX alerts_last_seen ON ops.alerts (last_seen);

COMMENT ON TABLE ops.alerts IS
    'V2-04 04-04: one row per alert episode (at most one open per rule). Counts, parameters, timestamps and ids only. '
    'Written by ops.evaluate_alerts() and public.ops_alert_notified(); read by the alert.notify job and the ops report.';

ALTER TABLE ops.alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ops.alert_rules, ops.alerts FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Rule functions: (p_params jsonb) -> (firing, details). Definer, empty search_path, postgres only.
-- ---------------------------------------------------------------------------------------------------------------------

-- dead_letter (warn, R-5): any job dead (except alert.notify, R-36), message row dead-lettered or webhook delivery
-- failed in the window.
CREATE FUNCTION ops.alert_rule_dead_letter(p_params JSONB)
RETURNS TABLE (firing BOOLEAN, details JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH p AS (
        SELECT coalesce((p_params ->> 'window_minutes')::int, 15) AS window_minutes
    ),
    w AS (
        SELECT p.window_minutes, now() - make_interval(mins => p.window_minutes) AS since FROM p
    ),
    jobs AS (
        SELECT count(*) AS n
          FROM ops.jobs j, w
         WHERE j.status = 'dead' AND j.finished_at >= w.since AND j.kind <> 'alert.notify'
    ),
    ids AS (
        SELECT coalesce(jsonb_agg(x.id ORDER BY x.finished_at DESC, x.id), '[]'::jsonb) AS ids
          FROM (
              SELECT j.id, j.finished_at
                FROM ops.jobs j, w
               WHERE j.status = 'dead' AND j.finished_at >= w.since AND j.kind <> 'alert.notify'
               ORDER BY j.finished_at DESC, j.id
               LIMIT 10
          ) x
    ),
    msgs AS (
        SELECT count(*) AS n
          FROM public.communication_queue q, w
         WHERE q.status = 'dead_letter' AND q.updated_at >= w.since
    ),
    hooks AS (
        SELECT count(*) AS n
          FROM public.webhook_delivery_queue d, w
         WHERE d.status = 'failed' AND d.updated_at >= w.since
    )
    SELECT (jobs.n + msgs.n + hooks.n) > 0,
           jsonb_build_object(
               'window_minutes', w.window_minutes,
               'jobs_dead', jobs.n,
               'messages_dead_letter', msgs.n,
               'webhooks_failed', hooks.n,
               'job_ids', ids.ids
           )
      FROM w, jobs, ids, msgs, hooks;
$$;

-- queue_lag (warn, R-5): p95 of first_claimed_at - run_at over jobs first claimed in the window, with enough samples.
-- A job retried before its first claim was recorded cannot have run_at > first_claimed_at; such rows are skipped.
CREATE FUNCTION ops.alert_rule_queue_lag(p_params JSONB)
RETURNS TABLE (firing BOOLEAN, details JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH p AS (
        SELECT coalesce((p_params ->> 'window_minutes')::int, 15) AS window_minutes,
               coalesce((p_params ->> 'threshold_seconds')::int, 120) AS threshold_seconds,
               coalesce((p_params ->> 'min_samples')::int, 5) AS min_samples
    ),
    s AS (
        SELECT count(*) AS n,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (j.first_claimed_at - j.run_at))) AS p95
          FROM ops.jobs j, p
         WHERE j.first_claimed_at >= now() - make_interval(mins => p.window_minutes)
           AND j.first_claimed_at >= j.run_at
    )
    SELECT s.n >= p.min_samples AND coalesce(s.p95, 0) > p.threshold_seconds,
           jsonb_build_object(
               'window_minutes', p.window_minutes,
               'threshold_seconds', p.threshold_seconds,
               'min_samples', p.min_samples,
               'samples', s.n,
               'p95_seconds', round(coalesce(s.p95, 0)::numeric, 1)
           )
      FROM p, s;
$$;

-- queue_oldest_due (critical, R-5): the oldest due pending job is older than the threshold.
CREATE FUNCTION ops.alert_rule_queue_oldest_due(p_params JSONB)
RETURNS TABLE (firing BOOLEAN, details JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH p AS (
        SELECT coalesce((p_params ->> 'threshold_minutes')::int, 5) AS threshold_minutes
    ),
    old AS (
        SELECT j.id, j.run_at
          FROM ops.jobs j, p
         WHERE j.status = 'pending' AND j.run_at < now() - make_interval(mins => p.threshold_minutes)
         ORDER BY j.run_at, j.id
         LIMIT 10
    ),
    agg AS (
        SELECT count(*) AS n,
               min(old.run_at) AS oldest,
               coalesce(jsonb_agg(old.id ORDER BY old.run_at, old.id), '[]'::jsonb) AS ids
          FROM old
    )
    SELECT agg.n > 0,
           jsonb_build_object(
               'threshold_minutes', p.threshold_minutes,
               'oldest_due_seconds', CASE WHEN agg.oldest IS NULL THEN 0
                                          ELSE floor(extract(epoch FROM (now() - agg.oldest)))::bigint END,
               'job_ids', agg.ids
           )
      FROM p, agg;
$$;

-- runner_stale (critical, R-5, R-41): a runner is configured (Vault holds jobs_runner_url) and no runner pass started
-- ok in the threshold. Silent on stacks without the scheduler secrets (local, CI).
CREATE FUNCTION ops.alert_rule_runner_stale(p_params JSONB)
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
               (SELECT max(r.started_at) FROM ops.job_runner_runs r WHERE r.ok) AS last_ok
    )
    SELECT s.configured AND (s.last_ok IS NULL OR s.last_ok <= now() - make_interval(mins => p.threshold_minutes)),
           jsonb_build_object(
               'threshold_minutes', p.threshold_minutes,
               'last_ok_at', CASE WHEN s.last_ok IS NULL THEN NULL
                                  ELSE to_char(s.last_ok AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END
           )
      FROM p, s;
$$;

-- lease_expiry (warn, R-5): more than the threshold of jobs whose lease expired in the window.
CREATE FUNCTION ops.alert_rule_lease_expiry(p_params JSONB)
RETURNS TABLE (firing BOOLEAN, details JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH p AS (
        SELECT coalesce((p_params ->> 'window_minutes')::int, 15) AS window_minutes,
               coalesce((p_params ->> 'threshold')::int, 3) AS threshold
    ),
    hits AS (
        SELECT j.id, j.last_lease_expired_at
          FROM ops.jobs j, p
         WHERE j.last_lease_expired_at >= now() - make_interval(mins => p.window_minutes)
    ),
    agg AS (
        SELECT count(*) AS n,
               coalesce((SELECT jsonb_agg(x.id ORDER BY x.last_lease_expired_at DESC, x.id)
                           FROM (SELECT h.id, h.last_lease_expired_at FROM hits h
                                  ORDER BY h.last_lease_expired_at DESC, h.id LIMIT 10) x), '[]'::jsonb) AS ids
          FROM hits
    )
    SELECT agg.n > p.threshold,
           jsonb_build_object(
               'window_minutes', p.window_minutes,
               'threshold', p.threshold,
               'lease_expiries', agg.n,
               'job_ids', agg.ids
           )
      FROM p, agg;
$$;

-- error_burst (warn, R-5, V2-03 sink): sum(count) of error_events rows seen in the window above the threshold. A
-- fingerprint that recurred today counts fully (one row per fingerprint and day): a conservative approximation.
CREATE FUNCTION ops.alert_rule_error_burst(p_params JSONB)
RETURNS TABLE (firing BOOLEAN, details JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH p AS (
        SELECT coalesce((p_params ->> 'window_minutes')::int, 10) AS window_minutes,
               coalesce((p_params ->> 'threshold')::int, 20) AS threshold
    ),
    agg AS (
        SELECT coalesce(sum(e.count), 0)::bigint AS events, count(*) AS fingerprints
          FROM ops.error_events e, p
         WHERE e.last_seen >= now() - make_interval(mins => p.window_minutes)
    )
    SELECT agg.events > p.threshold,
           jsonb_build_object(
               'window_minutes', p.window_minutes,
               'threshold', p.threshold,
               'events', agg.events,
               'fingerprints', agg.fingerprints
           )
      FROM p, agg;
$$;

-- error_sink_overflow (warn, R-46, 03-09b handover): the daily cap of new fingerprints was hit today or yesterday
-- (UTC), so events are being dropped.
CREATE FUNCTION ops.alert_rule_error_sink_overflow(p_params JSONB)
RETURNS TABLE (firing BOOLEAN, details JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH d AS (
        SELECT (now() AT TIME ZONE 'UTC')::date AS today
    ),
    agg AS (
        SELECT coalesce(sum(o.dropped) FILTER (WHERE o.day = d.today), 0)::bigint AS dropped_today,
               coalesce(sum(o.dropped) FILTER (WHERE o.day = d.today - 1), 0)::bigint AS dropped_yesterday
          FROM d
          LEFT JOIN ops.error_event_overflow o ON o.day IN (d.today, d.today - 1)
    )
    SELECT (agg.dropped_today + agg.dropped_yesterday) > 0,
           jsonb_build_object(
               'dropped_today', agg.dropped_today,
               'dropped_yesterday', agg.dropped_yesterday,
               'daily_cap', ops.error_sink_daily_cap()
           )
      FROM agg;
$$;

-- error_sink_size (warn, R-46, 03-09b handover): ops.error_events is larger than the threshold (default 50 MB, 10 % of
-- the Free database; the 180-day purge, 04-06, should keep it far below).
CREATE FUNCTION ops.alert_rule_error_sink_size(p_params JSONB)
RETURNS TABLE (firing BOOLEAN, details JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH p AS (
        SELECT coalesce((p_params ->> 'max_bytes')::bigint, 50000000) AS max_bytes
    ),
    s AS (
        SELECT ops.error_events_size() AS v
    )
    SELECT (s.v ->> 'bytes')::bigint > p.max_bytes,
           jsonb_build_object(
               'bytes', (s.v ->> 'bytes')::bigint,
               'rows', (s.v ->> 'rows')::bigint,
               'max_bytes', p.max_bytes
           )
      FROM p, s;
$$;

-- backup_stale (critical, FT-02): at least one backup run is recorded and either none finished ok in the threshold, or
-- the latest run failed (a deliberately failed run raises it at once; the GitHub-side alert covers "never ran").
CREATE FUNCTION ops.alert_rule_backup_stale(p_params JSONB)
RETURNS TABLE (firing BOOLEAN, details JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH p AS (
        SELECT coalesce((p_params ->> 'max_age_hours')::int, 13) AS max_age_hours
    ),
    s AS (
        SELECT EXISTS (SELECT 1 FROM ops.backup_runs b) AS any_run,
               (SELECT max(b.started_at) FROM ops.backup_runs b WHERE b.status = 'ok') AS last_ok,
               (SELECT b.status FROM ops.backup_runs b ORDER BY b.started_at DESC, b.id DESC LIMIT 1) AS latest_status,
               (SELECT count(*) FROM ops.backup_runs b, p
                 WHERE b.status = 'failed' AND b.started_at >= now() - make_interval(hours => p.max_age_hours)) AS failed
    )
    SELECT s.any_run AND (
               s.last_ok IS NULL
               OR s.last_ok < now() - make_interval(hours => p.max_age_hours)
               OR s.latest_status = 'failed'
           ),
           jsonb_build_object(
               'max_age_hours', p.max_age_hours,
               'last_ok_at', CASE WHEN s.last_ok IS NULL THEN NULL
                                  ELSE to_char(s.last_ok AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
               'latest_run_failed', coalesce(s.latest_status = 'failed', false),
               'failed_runs', s.failed
           )
      FROM p, s;
$$;

REVOKE ALL ON FUNCTION ops.alert_rule_dead_letter(JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.alert_rule_queue_lag(JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.alert_rule_queue_oldest_due(JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.alert_rule_runner_stale(JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.alert_rule_lease_expiry(JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.alert_rule_error_burst(JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.alert_rule_error_sink_overflow(JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.alert_rule_error_sink_size(JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.alert_rule_backup_stale(JSONB) FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO ops.alert_rules (rule, severity, fn, cooldown_minutes, params, description) VALUES
    ('dead_letter', 'warn', 'ops.alert_rule_dead_letter', 60, '{"window_minutes": 15}',
     'A job went dead (not alert.notify), a message was dead-lettered or a webhook delivery failed in the window.'),
    ('queue_lag', 'warn', 'ops.alert_rule_queue_lag', 60,
     '{"window_minutes": 15, "threshold_seconds": 120, "min_samples": 5}',
     'p95 of first claim minus run_at over jobs first claimed in the window is above the threshold.'),
    ('queue_oldest_due', 'critical', 'ops.alert_rule_queue_oldest_due', 60, '{"threshold_minutes": 5}',
     'The oldest due pending job has waited longer than the threshold.'),
    ('runner_stale', 'critical', 'ops.alert_rule_runner_stale', 60, '{"threshold_minutes": 5}',
     'A runner is configured in Vault and no runner pass started ok within the threshold.'),
    ('lease_expiry', 'warn', 'ops.alert_rule_lease_expiry', 60, '{"window_minutes": 15, "threshold": 3}',
     'More job leases than the threshold expired in the window.'),
    ('error_burst', 'warn', 'ops.alert_rule_error_burst', 60, '{"window_minutes": 10, "threshold": 20}',
     'More server errors than the threshold were recorded in the window.'),
    ('error_sink_overflow', 'warn', 'ops.alert_rule_error_sink_overflow', 360, '{}',
     'The error sink dropped events today or yesterday (UTC): the daily cap of new fingerprints was reached.'),
    ('error_sink_size', 'warn', 'ops.alert_rule_error_sink_size', 1440, '{"max_bytes": 50000000}',
     'ops.error_events is larger than the threshold.'),
    ('backup_stale', 'critical', 'ops.alert_rule_backup_stale', 180, '{"max_age_hours": 13}',
     'Backups are recorded and none finished ok within the threshold, or the latest run failed.')
ON CONFLICT (rule) DO NOTHING;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. The evaluator (pg_cron, every 5 minutes)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION ops.evaluate_alerts()
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    r RECORD;
    v_fn REGPROCEDURE;
    v_firing BOOLEAN;
    v_details JSONB;
    v_alert ops.alerts%ROWTYPE;
    v_new BOOLEAN;
    v_firing_count INTEGER := 0;
    v_seq INTEGER;
    v_try INTEGER;
    v_job UUID;
    -- R-51: a notification not yet recorded as sent is tried again at most this often.
    c_retry CONSTANT INTERVAL := INTERVAL '15 minutes';
BEGIN
    -- One evaluation at a time (pg_cron and a manual call cannot interleave).
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ops.evaluate_alerts'));

    FOR r IN
        SELECT ar.rule, ar.severity, ar.fn, ar.cooldown_minutes, ar.params
          FROM ops.alert_rules ar
         WHERE ar.enabled
         ORDER BY ar.rule
    LOOP
        v_fn := pg_catalog.to_regprocedure(r.fn || '(jsonb)');
        IF v_fn IS NULL THEN
            RAISE WARNING 'alert_rule_missing_function: %', r.rule;
            CONTINUE;
        END IF;

        BEGIN
            EXECUTE pg_catalog.format('SELECT f.firing, f.details FROM %s($1) f', v_fn::regproc)
               INTO v_firing, v_details
              USING r.params;
        EXCEPTION WHEN OTHERS THEN
            -- One broken rule (e.g. a bad parameter) must not stop the others; it counts neither as firing nor clean.
            RAISE WARNING 'alert_rule_failed: % (%)', r.rule, SQLSTATE;
            CONTINUE;
        END;

        IF v_details IS NULL OR jsonb_typeof(v_details) <> 'object' OR octet_length(v_details::text) > 4096 THEN
            v_details := '{}'::jsonb;
        END IF;

        IF coalesce(v_firing, false) THEN
            v_firing_count := v_firing_count + 1;
            v_new := false;

            UPDATE ops.alerts a
               SET last_seen = now(),
                   count = a.count + 1,
                   details = v_details,
                   severity = r.severity,
                   clean_evaluations = 0
             WHERE a.rule = r.rule AND a.status = 'open'
            RETURNING a.* INTO v_alert;

            IF NOT FOUND THEN
                INSERT INTO ops.alerts (rule, severity, details)
                VALUES (r.rule, r.severity, v_details)
                RETURNING * INTO v_alert;
                v_new := true;
            END IF;

        ELSE
            v_new := false;
            UPDATE ops.alerts a
               SET clean_evaluations = a.clean_evaluations + 1,
                   status = CASE WHEN a.clean_evaluations + 1 >= 2 THEN 'resolved' ELSE 'open' END,
                   resolved_at = CASE WHEN a.clean_evaluations + 1 >= 2 THEN now() ELSE NULL END
             WHERE a.rule = r.rule AND a.status = 'open'
            RETURNING a.* INTO v_alert;
            IF NOT FOUND OR v_alert.status <> 'open' THEN
                CONTINUE;
            END IF;
        END IF;

        -- Notification for the open alert of this rule (v_alert).
        v_seq := NULL;
        IF v_alert.notify_seq_enqueued <= v_alert.notify_count THEN
            -- Every enqueued notification is recorded as sent: a new one only while firing, when the alert is new or
            -- the cooldown since the last sent one has passed.
            IF coalesce(v_firing, false)
               AND (v_new OR (v_alert.notified_at IS NOT NULL
                              AND v_alert.notified_at < now() - make_interval(mins => r.cooldown_minutes))) THEN
                v_seq := v_alert.notify_count + 1;
                v_try := 1;
            END IF;
        ELSIF v_alert.notify_enqueued_at < now() - c_retry
              AND NOT EXISTS (
                  SELECT 1 FROM ops.jobs j
                   WHERE j.id = v_alert.notify_job_id AND j.status IN ('pending', 'running')
              ) THEN
            -- R-51: notification n was enqueued but never recorded as sent and no try of it is in flight.
            v_seq := v_alert.notify_seq_enqueued;
            v_try := v_alert.notify_tries + 1;
        END IF;

        IF v_seq IS NOT NULL THEN
            v_job := ops.enqueue_job(
                'alert.notify',
                NULL,
                jsonb_build_object('alert_id', v_alert.id, 'seq', v_seq),
                'alert:' || v_alert.id::text || ':' || v_seq::text
                    || CASE WHEN v_try > 1 THEN ':r' || v_try::text ELSE '' END,
                now(),
                5
            );
            UPDATE ops.alerts a
               SET notify_seq_enqueued = v_seq,
                   notify_tries = v_try,
                   notify_enqueued_at = now(),
                   notify_job_id = v_job
             WHERE a.id = v_alert.id;
        END IF;
    END LOOP;

    RETURN v_firing_count;
END;
$$;

COMMENT ON FUNCTION ops.evaluate_alerts() IS
    'V2-04 04-04: evaluates every enabled rule in ops.alert_rules; opens/refreshes/resolves ops.alerts and enqueues one '
    'alert.notify job per new alert or per expired cooldown (dedupe alert:<id>:<n>), and re-tries a notification not '
    'recorded as sent every 15 minutes while none is in flight (R-51). Returns the number of firing rules. '
    'pg_cron every 5 minutes; postgres only.';

REVOKE ALL ON FUNCTION ops.evaluate_alerts() FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. The alert.notify handler's RPCs (service_role only)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION public.ops_alert_payload(p_alert_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
               'id', a.id,
               'rule', a.rule,
               'severity', a.severity,
               'status', a.status,
               'first_seen', a.first_seen,
               'last_seen', a.last_seen,
               'count', a.count,
               'details', a.details,
               'notify_count', a.notify_count
           )
      FROM ops.alerts a
     WHERE a.id = p_alert_id;
$$;

COMMENT ON FUNCTION public.ops_alert_payload(UUID) IS
    'V2-04 04-04: the alert an alert.notify job emails (rule, severity, timestamps, count, details; no PHI by '
    'construction). service_role only.';

CREATE FUNCTION public.ops_alert_notified(p_alert_id UUID, p_provider_message_id TEXT, p_seq INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
BEGIN
    IF p_alert_id IS NULL OR p_seq IS NULL OR p_seq < 1 THEN
        RAISE EXCEPTION 'invalid_alert_notified' USING ERRCODE = '22023';
    END IF;

    -- Only the first report of notification n counts (a retried job cannot bump the count twice).
    UPDATE ops.alerts a
       SET notified_at = now(),
           notify_count = p_seq,
           provider_message_id = CASE
               WHEN p_provider_message_id ~ '^[A-Za-z0-9<>@._:+/=-]{1,200}$' THEN p_provider_message_id
               ELSE NULL
           END
     WHERE a.id = p_alert_id AND a.notify_count < p_seq;
    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.ops_alert_notified(UUID, TEXT, INTEGER) IS
    'V2-04 04-04: records that notification p_seq of an alert was accepted by the email provider (notified_at, '
    'notify_count, provider id). Idempotent per p_seq. service_role only.';

REVOKE ALL ON FUNCTION public.ops_alert_payload(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ops_alert_notified(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ops_alert_payload(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_alert_notified(UUID, TEXT, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Readiness (R-41, booleans only; same signature and grants as 000029)
-- ---------------------------------------------------------------------------------------------------------------------

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
        'runner_stale', EXISTS (SELECT 1 FROM vault.secrets v WHERE v.name = 'jobs_runner_url')
            AND NOT EXISTS (
                SELECT 1 FROM ops.job_runner_runs r WHERE r.started_at > v_job_due AND r.ok
            ),
        'alerts_critical_open', EXISTS (
            SELECT 1 FROM ops.alerts a WHERE a.status = 'open' AND a.severity = 'critical'
        )
    );
END;
$$;

COMMENT ON FUNCTION public.readiness_probe(TEXT) IS
    'V2-03 03-01/03-13c, V2-04 04-04: readiness booleans for /api/ready (no counts, no version; each flag an indexed '
    'EXISTS). anon only.';

REVOKE ALL ON FUNCTION public.readiness_probe(TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.readiness_probe(TEXT) TO anon;

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Schedule (name-keyed: re-applying updates the row instead of adding one)
-- ---------------------------------------------------------------------------------------------------------------------

SELECT cron.schedule('ops-evaluate-alerts', '*/5 * * * *', 'select ops.evaluate_alerts()');
