-- Migration: 000028_ops_error_events.sql
-- V2-03 plan 03-09b: error sink (P1-25, FT-07 sink, C39/PO-12, rulings R-7, R-18, R-27; threats T-03-02, T-03-03,
-- T-03-14).
--
-- Server errors captured by `instrumentation.ts` `onRequestError` land in `ops.error_events`, in the project's own
-- (India-resident) Postgres. The app writes them through one anon-executable SECURITY DEFINER function,
-- `public.ops_ingest_error(p_ingest_key, p_event)`, with a plain `fetch` and the publishable key: no service-role
-- client and no new client factory (R-7).
--
--   * Schema `ops` has no grant to anon, authenticated or service_role and is not in `[api] schemas`, so PostgREST
--     never serves it. RLS is enabled on both tables with no policy (defence in depth if a grant is ever added).
--   * The ingest key is never stored. The vault secret `ops_error_ingest_key_sha256` holds the lowercase hex SHA-256
--     of the key (PO action E9 on staging; the test lanes install the hash of a synthetic local key). A missing secret
--     refuses every call.
--   * The event is a closed set of keys with fixed shapes and lengths; anything else is refused. The message is
--     re-scrubbed here (emails, digit runs of 6+, query strings) as a second line behind the app's scrubber.
--   * One row per (fingerprint, UTC day): repeats increment `count` and `last_seen`. New fingerprints per day are
--     capped (`ops.error_sink_daily_cap()`); beyond the cap the day's overflow counter increments instead (T-03-02).
--   * Retention (FT-07): `ops.purge_error_events(interval default '180 days')` and `ops.error_events_size()` exist now
--     and are granted to no API role; scheduling the purge is V2-04 (R-27).
--
-- The ops day is the UTC day: error buckets are an operations concern with no clinic time zone.

CREATE SCHEMA IF NOT EXISTS ops;
REVOKE ALL ON SCHEMA ops FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ops.error_events (
    id BIGSERIAL PRIMARY KEY,
    fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    occurred_on DATE NOT NULL,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    count INTEGER NOT NULL DEFAULT 1 CHECK (count >= 1),
    environment TEXT NOT NULL CHECK (environment IN ('development', 'test', 'e2e', 'ci', 'staging', 'production')),
    release TEXT CHECK (release ~ '^[0-9a-f]{7,40}$'),
    route_path TEXT CHECK (route_path ~ '^/[A-Za-z0-9_./()\[\]@~+-]{0,199}$'),
    route_type TEXT CHECK (route_type IN ('render', 'route', 'action', 'proxy')),
    method TEXT CHECK (method ~ '^[A-Z]{1,10}$'),
    error_name TEXT NOT NULL CHECK (error_name ~ '^[A-Za-z0-9_.$-]{1,80}$'),
    error_code TEXT CHECK (error_code ~ '^[A-Za-z0-9_.-]{1,40}$'),
    digest TEXT CHECK (digest ~ '^[A-Za-z0-9_-]{1,64}$'),
    message TEXT NOT NULL CHECK (char_length(message) <= 500),
    frames TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(frames) <= 20),
    request_id UUID,
    tenant_id UUID,
    user_id UUID,
    CONSTRAINT error_events_fingerprint_day UNIQUE (fingerprint, occurred_on)
);

CREATE INDEX IF NOT EXISTS error_events_occurred_on ON ops.error_events (occurred_on);
CREATE INDEX IF NOT EXISTS error_events_request_id ON ops.error_events (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS error_events_last_seen ON ops.error_events (last_seen);

COMMENT ON TABLE ops.error_events IS
    'V2-03 03-09b: scrubbed server errors, one row per fingerprint and UTC day. No PHI, free text, query string or '
    'header is ever stored; request_id/tenant_id/user_id are UUIDs only. Written only by public.ops_ingest_error.';

CREATE TABLE IF NOT EXISTS ops.error_event_overflow (
    day DATE PRIMARY KEY,
    dropped INTEGER NOT NULL DEFAULT 0 CHECK (dropped >= 0)
);

COMMENT ON TABLE ops.error_event_overflow IS
    'V2-03 03-09b: events dropped per UTC day because the daily new-fingerprint cap was reached (T-03-02).';

ALTER TABLE ops.error_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.error_event_overflow ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA ops FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ops FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Daily cap of new fingerprints (a function, so a change is one reviewed migration)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.error_sink_daily_cap()
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT 500;
$$;

COMMENT ON FUNCTION ops.error_sink_daily_cap() IS
    'V2-03 03-09b: new error fingerprints accepted per UTC day; later new fingerprints only increment the overflow.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Ingest: public.ops_ingest_error(p_ingest_key, p_event)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ops_ingest_error(p_ingest_key TEXT, p_event JSONB)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '1s'
AS $$
DECLARE
    v_expected TEXT;
    v_today DATE := (now() AT TIME ZONE 'UTC')::date;
    v_key TEXT;
    v_environment TEXT;
    v_release TEXT;
    v_route_path TEXT;
    v_route_type TEXT;
    v_method TEXT;
    v_error_name TEXT;
    v_error_code TEXT;
    v_digest TEXT;
    v_message TEXT;
    v_frames TEXT[] := '{}';
    v_frame TEXT;
    v_frame_json JSONB;
    v_request_id UUID;
    v_tenant_id UUID;
    v_user_id UUID;
    v_fingerprint TEXT;
    v_new_today INTEGER;
BEGIN
    -- Authentication: the key's SHA-256 against the vault secret. The key itself is never stored or echoed.
    SELECT lower(btrim(s.decrypted_secret)) INTO v_expected
    FROM vault.decrypted_secrets s
    WHERE s.name = 'ops_error_ingest_key_sha256'
    ORDER BY s.created_at DESC
    LIMIT 1;

    IF v_expected IS NULL OR v_expected !~ '^[0-9a-f]{64}$'
       OR p_ingest_key IS NULL OR char_length(p_ingest_key) < 32 OR char_length(p_ingest_key) > 256
       OR encode(extensions.digest(p_ingest_key, 'sha256'), 'hex') <> v_expected THEN
        RAISE EXCEPTION 'ingest_refused' USING ERRCODE = '42501';
    END IF;

    -- Shape: a JSON object of at most 16 KiB with known keys only.
    IF p_event IS NULL OR jsonb_typeof(p_event) <> 'object' OR pg_column_size(p_event) > 16384 THEN
        RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(p_event) LOOP
        IF v_key NOT IN ('environment', 'release', 'route_path', 'route_type', 'method', 'error_name', 'error_code',
                         'digest', 'message', 'frames', 'request_id', 'tenant_id', 'user_id') THEN
            RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023';
        END IF;
        IF v_key <> 'frames' AND jsonb_typeof(p_event -> v_key) NOT IN ('string', 'null') THEN
            RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023';
        END IF;
    END LOOP;

    v_environment := p_event ->> 'environment';
    v_release := p_event ->> 'release';
    v_route_path := p_event ->> 'route_path';
    v_route_type := p_event ->> 'route_type';
    v_method := p_event ->> 'method';
    v_error_name := p_event ->> 'error_name';
    v_error_code := p_event ->> 'error_code';
    v_digest := p_event ->> 'digest';
    v_message := coalesce(p_event ->> 'message', '');

    IF v_environment IS NULL OR v_environment NOT IN ('development', 'test', 'e2e', 'ci', 'staging', 'production')
       OR (v_release IS NOT NULL AND v_release !~ '^[0-9a-f]{7,40}$')
       OR (v_route_path IS NOT NULL AND v_route_path !~ '^/[A-Za-z0-9_./()\[\]@~+-]{0,199}$')
       OR (v_route_type IS NOT NULL AND v_route_type NOT IN ('render', 'route', 'action', 'proxy'))
       OR (v_method IS NOT NULL AND v_method !~ '^[A-Z]{1,10}$')
       OR v_error_name IS NULL OR v_error_name !~ '^[A-Za-z0-9_.$-]{1,80}$'
       OR (v_error_code IS NOT NULL AND v_error_code !~ '^[A-Za-z0-9_.-]{1,40}$')
       OR (v_digest IS NOT NULL AND v_digest !~ '^[A-Za-z0-9_-]{1,64}$')
       OR char_length(v_message) > 500 THEN
        RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023';
    END IF;

    IF p_event ? 'frames' AND jsonb_typeof(p_event -> 'frames') <> 'null' THEN
        IF jsonb_typeof(p_event -> 'frames') <> 'array' OR jsonb_array_length(p_event -> 'frames') > 20 THEN
            RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023';
        END IF;
        FOR v_frame_json IN SELECT f FROM jsonb_array_elements(p_event -> 'frames') AS a(f) LOOP
            IF jsonb_typeof(v_frame_json) <> 'string' THEN
                RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023';
            END IF;
            v_frame := v_frame_json #>> '{}';
            IF v_frame !~ '^[A-Za-z0-9_./()\[\]@~+:-]{1,200}:[0-9]{1,7}$' THEN
                RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023';
            END IF;
            v_frames := v_frames || v_frame;
        END LOOP;
    END IF;

    BEGIN
        v_request_id := (p_event ->> 'request_id')::uuid;
        v_tenant_id := (p_event ->> 'tenant_id')::uuid;
        v_user_id := (p_event ->> 'user_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023';
    END;

    -- Second scrub behind the app's (lib/observability/scrub.ts): emails, query strings, digit runs of 6 or more.
    v_message := regexp_replace(v_message, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[EMAIL]', 'g');
    v_message := regexp_replace(v_message, '\?[^[:space:]"''<>]+', '?[QUERY]', 'g');
    v_message := regexp_replace(v_message, '[0-9]{6,}', '[NUMBER]', 'g');

    v_fingerprint := encode(extensions.digest(concat_ws(chr(31),
        v_environment, coalesce(v_route_path, ''), coalesce(v_route_type, ''), coalesce(v_method, ''),
        v_error_name, coalesce(v_error_code, ''), v_message, array_to_string(v_frames[1:5], chr(30))
    ), 'sha256'), 'hex');

    -- A repeat of today's fingerprint: count it.
    UPDATE ops.error_events e
       SET count = e.count + 1,
           last_seen = now(),
           release = coalesce(v_release, e.release),
           digest = coalesce(v_digest, e.digest),
           request_id = coalesce(v_request_id, e.request_id),
           tenant_id = coalesce(v_tenant_id, e.tenant_id),
           user_id = coalesce(v_user_id, e.user_id)
     WHERE e.fingerprint = v_fingerprint AND e.occurred_on = v_today;
    IF FOUND THEN
        RETURN;
    END IF;

    -- A new fingerprint: serialise the cap check per day so concurrent callers cannot overshoot it.
    PERFORM pg_advisory_xact_lock(hashtext('ops.error_events.new'), (v_today - DATE '2000-01-01'));
    SELECT count(*) INTO v_new_today FROM ops.error_events e WHERE e.occurred_on = v_today;
    IF v_new_today >= ops.error_sink_daily_cap() THEN
        INSERT INTO ops.error_event_overflow AS o (day, dropped) VALUES (v_today, 1)
        ON CONFLICT (day) DO UPDATE SET dropped = o.dropped + 1;
        RETURN;
    END IF;

    INSERT INTO ops.error_events AS e (
        fingerprint, occurred_on, environment, release, route_path, route_type, method, error_name, error_code,
        digest, message, frames, request_id, tenant_id, user_id
    ) VALUES (
        v_fingerprint, v_today, v_environment, v_release, v_route_path, v_route_type, v_method, v_error_name,
        v_error_code, v_digest, v_message, v_frames, v_request_id, v_tenant_id, v_user_id
    )
    ON CONFLICT (fingerprint, occurred_on) DO UPDATE
       SET count = e.count + 1,
           last_seen = now(),
           release = coalesce(excluded.release, e.release),
           digest = coalesce(excluded.digest, e.digest),
           request_id = coalesce(excluded.request_id, e.request_id),
           tenant_id = coalesce(excluded.tenant_id, e.tenant_id),
           user_id = coalesce(excluded.user_id, e.user_id);
END;
$$;

COMMENT ON FUNCTION public.ops_ingest_error(TEXT, JSONB) IS
    'V2-03 03-09b: error-sink ingest (anon-executable by design; refused without the ingest key whose SHA-256 is the '
    'vault secret ops_error_ingest_key_sha256). Closed event shape, per-day fingerprint upsert, daily cap.';

REVOKE ALL ON FUNCTION public.ops_ingest_error(TEXT, JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ops_ingest_error(TEXT, JSONB) TO anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Retention (FT-07): purge and size, for the V2-04 scheduler and operators. No API role may execute them.
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.purge_error_events(p_older_than INTERVAL DEFAULT INTERVAL '180 days')
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    IF p_older_than IS NULL OR p_older_than < INTERVAL '1 day' THEN
        RAISE EXCEPTION 'invalid_retention' USING ERRCODE = '22023';
    END IF;
    DELETE FROM ops.error_events e WHERE e.last_seen < now() - p_older_than;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    DELETE FROM ops.error_event_overflow o WHERE o.day < ((now() - p_older_than) AT TIME ZONE 'UTC')::date;
    RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION ops.purge_error_events(INTERVAL) IS
    'V2-03 03-09b (FT-07, R-27): deletes error events not seen within the retention window (default 180 days) and '
    'older overflow counters; returns the number of events deleted. Scheduled in V2-04.';

CREATE OR REPLACE FUNCTION ops.error_events_size()
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'rows', (SELECT count(*) FROM ops.error_events),
        'bytes', pg_total_relation_size('ops.error_events'::regclass),
        'oldest_last_seen', (SELECT min(e.last_seen) FROM ops.error_events e)
    );
$$;

COMMENT ON FUNCTION ops.error_events_size() IS
    'V2-03 03-09b (FT-07): row count, total bytes and oldest last_seen of ops.error_events, for retention monitoring.';

REVOKE ALL ON FUNCTION ops.error_sink_daily_cap() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.purge_error_events(INTERVAL) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ops.error_events_size() FROM PUBLIC, anon, authenticated, service_role;
