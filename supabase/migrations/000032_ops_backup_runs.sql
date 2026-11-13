-- Migration: 000032_ops_backup_runs.sql
-- V2-04 plan 04-05a: backup run log (FT-02; rulings R-2, R-3, R-14, R-41; threats T-04-10, T-04-11).
--
-- One row per run of ops/backup/backup.sh (AWS CodeBuild for staging/production, the local self-test for `local`).
-- The job writes it as `postgres` through psql after the encrypted archive is uploaded (`ok`), or best-effort when a
-- step failed (`failed` + a machine error code). 04-04's `backup_stale` alert and 04-06's ops report read it.
--
-- Counts only (T-04-10): `manifest_counts` holds row counts per table and object count/bytes per bucket, never object
-- names or row data; `object_key` is `<env>/<UTC timestamp>.tar.age` (no tenant or patient data). Retention 400 days
-- (R-2) is applied by 04-06's `ops.cleanup`.
--
-- Access: `ops` has no USAGE for any API role and is not in `[api] schemas`; RLS on with no policy; every privilege
-- revoked from the API roles.

CREATE TABLE ops.backup_runs (
    id BIGSERIAL PRIMARY KEY,
    environment TEXT NOT NULL CHECK (environment IN ('local', 'staging', 'production')),
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('ok', 'failed')),
    object_key TEXT CHECK (
        char_length(object_key) <= 200
        AND object_key ~ '^[a-z0-9-]+/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.tar\.age$'
    ),
    archive_bytes BIGINT CHECK (archive_bytes >= 0),
    duration_s INTEGER CHECK (duration_s >= 0),
    manifest_counts JSONB CHECK (
        manifest_counts IS NULL
        OR (jsonb_typeof(manifest_counts) = 'object' AND octet_length(manifest_counts::text) <= 65536)
    ),
    error_code TEXT CHECK (char_length(error_code) <= 64 AND error_code ~ '^[a-z][a-z0-9_]*$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT backup_runs_ok_has_archive CHECK (status <> 'ok' OR (object_key IS NOT NULL AND archive_bytes IS NOT NULL)),
    CONSTRAINT backup_runs_failed_has_code CHECK (status <> 'failed' OR error_code IS NOT NULL)
);

CREATE INDEX backup_runs_environment_started_at ON ops.backup_runs (environment, started_at DESC);
CREATE INDEX backup_runs_created_at ON ops.backup_runs (created_at);

COMMENT ON TABLE ops.backup_runs IS
    'V2-04 04-05a: one row per FT-02 backup run (counts, sizes, an object key and an error code only; no object names '
    'or row data). Written as postgres by ops/backup/backup.sh; read by the backup_stale alert and the ops report.';

ALTER TABLE ops.backup_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ops.backup_runs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE ops.backup_runs_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- Dead-man for the scheduler (R-41): true when a runner is configured (Vault holds `jobs_runner_url`, 04-02 / 04-P9)
-- and no runner pass finished ok in the last 15 minutes. backup.sh fails its build on true (exit 3), so the CodeBuild
-- failure rule emails through SNS independently of the app. Called as postgres only.
CREATE FUNCTION ops.backup_runner_stale()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'jobs_runner_url')
       AND NOT EXISTS (
           SELECT 1
             FROM ops.job_runner_runs r
            WHERE r.ok
              AND coalesce(r.finished_at, r.started_at) > now() - interval '15 minutes'
       );
$$;

COMMENT ON FUNCTION ops.backup_runner_stale() IS
    'V2-04 04-05a (R-41): backup.sh dead-man check; true = a configured job runner has no ok pass in 15 minutes.';

REVOKE EXECUTE ON FUNCTION ops.backup_runner_stale() FROM PUBLIC, anon, authenticated, service_role;
