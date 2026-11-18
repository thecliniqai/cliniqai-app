-- Migration: 000042_ops_review_fixes.sql
-- V2-04 plan 04-07c (review triage 04-07: M-BACKUPAUTH, M-RESTORE, Lows L-1 and L-4 of review C). Next free number
-- after 04-07a's 000041 (R-39).
--
--   1. ops.backup_runs.archive_sha256 (M-BACKUPAUTH, review C M-2): the SHA-256 of the uploaded `.tar.age`, written by
--      ops/backup/backup.sh. It is one of the records outside the bucket (with the backup.yml job summary and its
--      `backup-evidence` artifact) that ops/restore-drill/run.sh `--expect-sha256` checks before decrypting: the R2
--      token can replace an object but cannot write here. Required on new `ok` rows (NOT VALID: rows written before
--      this migration keep a null digest; expand step, no contract needed).
--   2. ops.ensure_schedules(p_activate_kick) (M-RESTORE, independent review M4): a restore excludes cron.job (the drill
--      must never call the environment the dump came from) and replays the migration history, so `staging.yml` migrate
--      never re-runs the cron.schedule calls of 000033/000035/000039/000040. This idempotent function re-creates the
--      nine schedules on a restored project (runbook docs/runbooks/backup-restore.md §8), `jobs-kick` inactive until
--      the pending-jobs review, then `select ops.ensure_schedules(true)` activates it. The drill checks it
--      (supabase/tests/restore_drill_checks.sql) inside its rolled-back transaction. A later migration that adds a
--      schedule replaces this function too (tests/ops/ensure-schedules-db.spec.ts compares it with cron.job).
--   3. ops.evaluate_alerts() (review C L-1): the cooldown applies per rule, not per episode. A re-opened alert (a
--      flapping condition, one a tenant can drive) is not notified while the rule's previous notification, sent or
--      tried, is inside the cooldown; it is notified at the first evaluation after the cooldown if still open.
--   4. ops.evaluate_alerts() (review C L-4): R-51 stops retrying a notification whose latest try died with
--      `alert_channel_unconfigured` (no OPS_ALERT_EMAIL, or EMAIL_PROVIDER=disabled). The alert records the terminal
--      state in `notify_stopped_code` and stays open and unsent in the ops report; once the channel is configured,
--      `update ops.alerts set notify_stopped_code = null where status = 'open'` resumes the retries (runbook jobs.md).
--
-- Access: unchanged model. Every new or replaced function runs as postgres only (no API role, nothing to PUBLIC).

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Backup archive digest
-- ---------------------------------------------------------------------------------------------------------------------

ALTER TABLE ops.backup_runs
    ADD COLUMN archive_sha256 TEXT CONSTRAINT backup_runs_archive_sha256_check CHECK (archive_sha256 ~ '^[0-9a-f]{64}$');

ALTER TABLE ops.backup_runs
    ADD CONSTRAINT backup_runs_ok_has_digest CHECK (status <> 'ok' OR archive_sha256 IS NOT NULL) NOT VALID;

COMMENT ON COLUMN ops.backup_runs.archive_sha256 IS
    'V2-04 04-07c (M-BACKUPAUTH): SHA-256 (hex) of the uploaded age archive; a restore passes it as --expect-sha256 and '
    'refuses any other archive before decrypting. Required on ok rows written from 000042 on.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Schedules a restore re-creates
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION ops.ensure_schedules(p_activate_kick BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
    r RECORD;
    v_job RECORD;
    v_id BIGINT;
    v_expected TEXT[] := '{}';
    v_created TEXT[] := '{}';
    v_updated TEXT[] := '{}';
    v_inactive TEXT[] := '{}';
    v_activated TEXT[] := '{}';
BEGIN
    IF pg_catalog.to_regclass('cron.job') IS NULL THEN
        RAISE EXCEPTION 'pg_cron_missing' USING ERRCODE = '55000';
    END IF;

    -- The schedules of migrations 000033, 000035, 000039 and 000040, verbatim (name-keyed: cron.schedule with an
    -- existing name updates that row instead of adding one).
    FOR r IN
        SELECT s.name, s.schedule, s.command
          FROM (VALUES
              ('jobs-kick', '* * * * *', 'select ops.kick_job_runner()'),
              ('jobs-reap', '* * * * *', 'select ops.reap_jobs()'),
              ('cron-history-cleanup', '15 0 * * *',
               $c$delete from cron.job_run_details where end_time < now() - interval '7 days'$c$),
              ('delivery-reap', '* * * * *', 'select ops.reap_delivery_rows()'),
              ('ops-evaluate-alerts', '*/5 * * * *', 'select ops.evaluate_alerts()'),
              ('ops-heartbeat', '0 */6 * * *', 'select ops.heartbeat()'),
              ('ops-quota-snapshot', '30 21 * * *', 'select ops.quota_snapshot()'),
              ('ops-quota-weekly-summary', '30 3 * * 1', 'select ops.enqueue_quota_weekly_summary()'),
              ('ops-cleanup', '45 21 * * *', 'select ops.cleanup()')
          ) AS s(name, schedule, command)
    LOOP
        v_expected := v_expected || r.name;
        SELECT j.jobid, j.schedule, j.command, j.active
          INTO v_job
          FROM cron.job j
         WHERE j.jobname = r.name AND j.username = current_user;

        IF NOT FOUND THEN
            v_id := cron.schedule(r.name, r.schedule, r.command);
            v_created := v_created || r.name;
            -- Never start sending on a restored project before its pending jobs were reviewed (runbook §8).
            IF r.name = 'jobs-kick' AND NOT p_activate_kick THEN
                PERFORM cron.alter_job(v_id, active => false);
                v_inactive := v_inactive || r.name;
            END IF;
        ELSE
            IF v_job.schedule IS DISTINCT FROM r.schedule OR v_job.command IS DISTINCT FROM r.command THEN
                PERFORM cron.schedule(r.name, r.schedule, r.command);
                v_updated := v_updated || r.name;
            END IF;
            IF r.name = 'jobs-kick' AND p_activate_kick AND NOT v_job.active THEN
                PERFORM cron.alter_job(v_job.jobid, active => true);
                v_activated := v_activated || r.name;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'expected', to_jsonb(v_expected),
        'created', to_jsonb(v_created),
        'updated', to_jsonb(v_updated),
        'inactive', to_jsonb(v_inactive),
        'activated', to_jsonb(v_activated)
    );
END;
$$;

COMMENT ON FUNCTION ops.ensure_schedules(BOOLEAN) IS
    'V2-04 04-07c (M-RESTORE): idempotently (re-)creates the nine pg_cron schedules of the migrations, e.g. after a '
    'restore (cron.job is not in the dump). A newly created jobs-kick stays inactive unless p_activate_kick; '
    'ensure_schedules(true) activates it after the pending-jobs review. Returns the names expected/created/updated/'
    'inactive/activated. postgres only (SQL editor, restore runbook §8).';

REVOKE ALL ON FUNCTION ops.ensure_schedules(BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3-4. Alerts: per-rule cooldown (L-1) and a terminal state for an unconfigured channel (L-4)
-- ---------------------------------------------------------------------------------------------------------------------

ALTER TABLE ops.alerts
    ADD COLUMN notify_stopped_code TEXT
        CONSTRAINT alerts_notify_stopped_code_check CHECK (notify_stopped_code IN ('alert_channel_unconfigured'));

COMMENT ON COLUMN ops.alerts.notify_stopped_code IS
    'V2-04 04-07c (L-4): set when the latest try of the unsent notification died with a code no retry can fix '
    '(alert_channel_unconfigured); R-51 retries stop. Clear it after configuring the channel to resume.';

-- The per-rule cooldown reads the rule's previous episodes.
CREATE INDEX alerts_rule ON ops.alerts (rule);

CREATE OR REPLACE FUNCTION ops.evaluate_alerts()
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
    v_rule_last TIMESTAMPTZ;
    v_try_error TEXT;
    v_try_status TEXT;
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
            -- Every enqueued notification is recorded as sent: a new one only while firing, when this episode has
            -- none yet or its last sent one is older than the cooldown, AND (L-1) no earlier episode of the same rule
            -- was notified or tried inside the cooldown. A deferred episode is notified once the cooldown has passed.
            IF coalesce(v_firing, false)
               AND (v_alert.notify_seq_enqueued = 0
                    OR (v_alert.notified_at IS NOT NULL
                        AND v_alert.notified_at < now() - make_interval(mins => r.cooldown_minutes))) THEN
                SELECT max(greatest(a.notified_at, a.notify_enqueued_at))
                  INTO v_rule_last
                  FROM ops.alerts a
                 WHERE a.rule = r.rule AND a.id <> v_alert.id;
                IF v_rule_last IS NULL OR v_rule_last < now() - make_interval(mins => r.cooldown_minutes) THEN
                    v_seq := v_alert.notify_count + 1;
                    v_try := 1;
                END IF;
            END IF;
        ELSIF v_alert.notify_stopped_code IS NULL
              AND v_alert.notify_enqueued_at < now() - c_retry THEN
            SELECT j.status, j.last_error INTO v_try_status, v_try_error
              FROM ops.jobs j
             WHERE j.id = v_alert.notify_job_id;
            IF v_try_status = 'dead' AND v_try_error = 'alert_channel_unconfigured' THEN
                -- L-4: no retry can deliver it; record the terminal state instead of a dead job every 15 minutes. The
                -- link to the dead try is dropped, so clearing notify_stopped_code (channel configured) resumes R-51.
                UPDATE ops.alerts a SET notify_stopped_code = v_try_error, notify_job_id = NULL WHERE a.id = v_alert.id;
            ELSIF v_try_status IS NULL OR v_try_status NOT IN ('pending', 'running') THEN
                -- R-51: notification n was enqueued but never recorded as sent and no try of it is in flight.
                v_seq := v_alert.notify_seq_enqueued;
                v_try := v_alert.notify_tries + 1;
            END IF;
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
    'V2-04 04-04, 04-07c: evaluates every enabled rule in ops.alert_rules; opens/refreshes/resolves ops.alerts and '
    'enqueues one alert.notify job per new alert or per expired cooldown (dedupe alert:<id>:<n>); the cooldown is per '
    'rule across episodes (L-1). Re-tries a notification not recorded as sent every 15 minutes while none is in flight '
    '(R-51), except after a try died with alert_channel_unconfigured (notify_stopped_code, L-4). Returns the number of '
    'firing rules. pg_cron every 5 minutes; postgres only.';

REVOKE ALL ON FUNCTION ops.evaluate_alerts() FROM PUBLIC, anon, authenticated, service_role;
