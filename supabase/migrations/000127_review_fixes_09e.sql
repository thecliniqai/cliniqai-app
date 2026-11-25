-- Migration: 000127_review_fixes_09e.sql
-- V2-09e 09E-14a (fix round after the two isolated reviews of PR 1): number 000127 was reserved for reference_catalogues; the later reserved numbers move up by one
-- (reference_catalogues 000128, schedule_range 000129, session_bootstrap 000130), see 09E-NOTES.
--
-- 1. The Today board's patient and follow-up facts move the queue domain (independent review M4). `today_board` (000125) reads patients.full_name, phone, sex, age,
--    date_of_birth and allergies (a flag) and the visit's follow_ups row; a change to any of them from another device left an open Today showing the old value
--    until something else moved. Statement-level AFTER triggers with transition tables, the pattern of 000123 (private.clinic_bump, once per transaction and clinic):
--      patients   UPDATE  moves queue when full_name, phone, sex, age, date_of_birth or allergies changes   (listed)
--                         moves nothing for: abha_id, address, ai_processing_objected, chronic_conditions, created_at, created_by, emergency_contact, erased_at,
--                         erasure_reason, guardian_name, guardian_phone, guardian_relationship, hfr_facility_id, id, is_deleted, national_health_id, objected_at,
--                         objection_recorded_by, preferred_language, status, tenant_id, updated_at, whatsapp_opt_out   (not listed: the board does not read them)
--      patients   DELETE  moves queue (the board's row loses its patient)
--      patients   INSERT  moves nothing (a patient with no visit is not on the board; the visit insert moves queue)
--      follow_ups INSERT, DELETE  move queue (all rows)
--      follow_ups UPDATE  moves queue when follow_up_date, visit_id or created_at changes   (listed; the board reads the visit's newest follow-up by created_at)
--                         moves nothing for: doctor_id, id, notes, patient_id, status, tenant_id   (not listed)
--    Lock order: these statements take the queue version row only (private.clinic_bump), so they add no new order to the one documented in 09E-NOTES
--    (queue, schedule, billing, settings, always in that order inside one transaction).
-- 2. ops_ingest_rum (000122) answers an active member only and gives one account a share of the day's cap (independent review L-1). A signed-in account with no clinic, or a
--    member calling the function directly in a loop, could fill the whole daily cap and so blind everyone else's timings. Now: no active membership is refused (42501,
--    as the route already requires); one account's accepted samples are capped at ops.rum_user_daily_cap() a day (the rest count as overflow, like the total cap). The
--    per-account counter is ops.rum_user_daily(day, user_key bytea, samples): user_key is sha256(user id || day), so it names no one across days; rows of earlier days
--    are deleted by the next call; no API role has any privilege on it and RLS is on with no policy (as ops.rum_daily).
-- Per-migration checklist: three private definer functions (no API grant) with their triggers, one ops table (RLS on, no policy, no API grant), one ops function, one
-- replaced definer function with the same signature and grants (EXECUTE authenticated only). No change to a policy of a public table.

-- 1. Triggers ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION private.cv_patients_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM private.clinic_bump(
        (SELECT array_agg(DISTINCT n.tenant_id ORDER BY n.tenant_id)
           FROM new_rows n JOIN old_rows o ON o.id = n.id
          WHERE o.full_name IS DISTINCT FROM n.full_name
             OR o.phone IS DISTINCT FROM n.phone
             OR o.sex IS DISTINCT FROM n.sex
             OR o.age IS DISTINCT FROM n.age
             OR o.date_of_birth IS DISTINCT FROM n.date_of_birth
             OR o.allergies IS DISTINCT FROM n.allergies),
        'queue');
    RETURN NULL;
END;
$$;
CREATE FUNCTION private.cv_patients_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM private.clinic_bump((SELECT array_agg(DISTINCT c.tenant_id ORDER BY c.tenant_id) FROM changed_rows c), 'queue');
    RETURN NULL;
END;
$$;
CREATE TRIGGER patients_clinic_version_update AFTER UPDATE ON public.patients
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_patients_update();
CREATE TRIGGER patients_clinic_version_delete AFTER DELETE ON public.patients
    REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_patients_delete();

CREATE FUNCTION private.cv_follow_ups_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM private.clinic_bump((SELECT array_agg(DISTINCT c.tenant_id ORDER BY c.tenant_id) FROM changed_rows c), 'queue');
    RETURN NULL;
END;
$$;
CREATE FUNCTION private.cv_follow_ups_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM private.clinic_bump(
        (SELECT array_agg(DISTINCT n.tenant_id ORDER BY n.tenant_id)
           FROM new_rows n JOIN old_rows o ON o.id = n.id
          WHERE o.follow_up_date IS DISTINCT FROM n.follow_up_date
             OR o.visit_id IS DISTINCT FROM n.visit_id
             OR o.created_at IS DISTINCT FROM n.created_at),
        'queue');
    RETURN NULL;
END;
$$;
CREATE TRIGGER follow_ups_clinic_version_insert AFTER INSERT ON public.follow_ups
    REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_follow_ups_change();
CREATE TRIGGER follow_ups_clinic_version_delete AFTER DELETE ON public.follow_ups
    REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_follow_ups_change();
CREATE TRIGGER follow_ups_clinic_version_update AFTER UPDATE ON public.follow_ups
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_follow_ups_update();

REVOKE ALL ON FUNCTION private.cv_patients_update(), private.cv_patients_delete(), private.cv_follow_ups_change(), private.cv_follow_ups_update()
    FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.cv_patients_update() IS 'V2-09e 09E-14a: statement trigger: patients update of full_name, phone, sex, age, date_of_birth, allergies -> queue.';
COMMENT ON FUNCTION private.cv_patients_delete() IS 'V2-09e 09E-14a: statement trigger: patients delete -> queue.';
COMMENT ON FUNCTION private.cv_follow_ups_change() IS 'V2-09e 09E-14a: statement trigger: follow_ups insert, delete -> queue.';
COMMENT ON FUNCTION private.cv_follow_ups_update() IS 'V2-09e 09E-14a: statement trigger: follow_ups update of follow_up_date, visit_id, created_at -> queue.';

-- 2. RUM: a share per account, membership required ---------------------------------------------------------------------------
CREATE TABLE ops.rum_user_daily (
    day DATE NOT NULL,
    user_key BYTEA NOT NULL,
    samples BIGINT NOT NULL CHECK (samples >= 1),
    PRIMARY KEY (day, user_key)
);
COMMENT ON TABLE ops.rum_user_daily IS
    'V2-09e 09E-14a (L-1): samples one account was accepted for today, keyed by sha256(user id || day) so the key names no one across days. Written only by public.ops_ingest_rum, which deletes earlier days.';
ALTER TABLE ops.rum_user_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ops.rum_user_daily FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION ops.rum_user_daily_cap()
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT 20000::bigint;
$$;
COMMENT ON FUNCTION ops.rum_user_daily_cap() IS
    'V2-09e 09E-14a (L-1): samples one account may add per UTC day (4 % of ops.rum_daily_cap()); later samples count in ops.rum_overflow.';
REVOKE ALL ON FUNCTION ops.rum_user_daily_cap() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ops_ingest_rum(p_environment TEXT, p_release TEXT, p_samples JSONB)
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
    v_user_key BYTEA;
    v_user_used BIGINT;
    v_user_room BIGINT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'rum: not signed in' USING ERRCODE = '42501';
    END IF;
    -- 09E-14a (L-1): a member of at least one active clinic only, as the route requires (a direct call with any signed-in account no longer counts).
    IF NOT EXISTS (SELECT 1 FROM authz.member_tenant_ids() AS m(tenant_id)) THEN
        RAISE EXCEPTION 'rum: refused' USING ERRCODE = '42501';
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

    -- 09E-14a (L-1): one account may use only its share of the day's cap (ops.rum_user_daily_cap()), so it cannot fill the cap for everyone. The counter's key is a
    -- one-way hash scoped to the UTC day (it names no one the next day and is deleted with the day); rows of earlier days are removed here.
    DELETE FROM ops.rum_user_daily u WHERE u.day < v_day;
    v_user_key := sha256(convert_to(auth.uid()::text || ':' || v_day::text, 'UTF8'));
    SELECT u.samples INTO v_user_used FROM ops.rum_user_daily u WHERE u.day = v_day AND u.user_key = v_user_key;
    v_user_room := greatest(ops.rum_user_daily_cap() - coalesce(v_user_used, 0), 0);
    v_accepted := least(v_n::bigint, v_room, v_user_room)::integer;
    IF v_accepted > 0 THEN
        INSERT INTO ops.rum_user_daily (day, user_key, samples) VALUES (v_day, v_user_key, v_accepted)
        ON CONFLICT (day, user_key) DO UPDATE SET samples = ops.rum_user_daily.samples + EXCLUDED.samples;
    END IF;

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
    'V2-09e 09E-02 (R-20, T-09E-14), 09E-14a (L-1): adds up to 60 real-user timing samples to ops.rum_daily histograms. Active members of a clinic only. Closed lists for screen, metric, '
    'device and net; exactly the keys screen/metric/device/net/value; a numeric value in range; any other shape refuses the whole call and '
    'writes nothing. Stores no tenant, user, URL, id or text. A daily cap, and one account''s share of it, send the rest to ops.rum_overflow.';

REVOKE ALL ON FUNCTION public.ops_ingest_rum(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ops_ingest_rum(TEXT, TEXT, JSONB) TO authenticated;
