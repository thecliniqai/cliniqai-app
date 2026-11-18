-- Migration: 000064_queue_token_counters.sql
-- V2-05 plan 05-08 step 3 (P1-40, DB-09; rulings R-18, R-19; threat T-05-21; roadmap V2-05 acceptance 7; V2-03 R-33).
--
-- Queue tokens are numbered by a per-clinic, per-day counter row instead of `MAX(token_number) + 1`. Before this,
-- `generate_daily_queue_token` read the day's maximum without a lock, so two check-ins at the same moment both got
-- the same number and the second insert failed on `uq_tenant_date_token` (or, without the unique key, the clinic would
-- call two patients with one token).
--
-- 1. `public.queue_token_counters (tenant_id, date, last_token)`: one row per clinic and clinic day. RLS on, no policy,
--    and no privilege for PUBLIC, `anon` or `authenticated` (T-05-21: a member can neither read nor rewind it); only
--    `next_queue_token` (definer) writes it. `tenant_id -> tenants` CASCADE (tenant purge, test teardown). Seeded from
--    the existing `queue_tokens` (max token per clinic and date), so numbering continues where it is.
-- 2. `public.tenant_local_date(p_tenant, p_at)`: the calendar date of `p_at` in the clinic's zone (`tenants.timezone`),
--    with the same rules as `lib/datetime` `resolveTimeZone` (DEFAULT_CLINIC_TZ = Asia/Kolkata), so SQL and the app
--    never disagree about a clinic's "today":
--      - an IANA zone name (matched case-insensitively against `pg_timezone_names`, as Intl does) is used;
--      - a UTC offset in the ECMA-402 forms `±HH`, `±HHMM`, `±HH:MM` is used as a fixed offset east of UTC (Intl's
--        meaning; PostgreSQL's POSIX reading of `+05:30` would be the opposite sign, so it is never passed through);
--      - anything else (an unknown name, an abbreviation such as `IST`, a blank) falls back to Asia/Kolkata, never an
--        error. `Asia/Kolkata` itself (every clinic's default) skips the catalogue lookup.
--    SECURITY INVOKER and STABLE: under RLS a caller resolves only clinics they belong to (another clinic's zone reads
--    as the default, which reveals nothing). EXECUTE for `authenticated` and `service_role` (the date triggers of
--    the next migration run it as the inserting role).
-- 3. `public.next_queue_token(p_visit_id) RETURNS TABLE (token_number, token_date)`: SECURITY DEFINER (R-18, deviates
--    from BACKEND C6 "INVOKER": an invoker function would need UPDATE on the counter, letting any member rewind it).
--    The clinic comes from the visit, never from the caller; the caller must hold `appointments:edit` in that clinic
--    as its ACTIVE clinic (`has_permission`, R-42), else 42501 (also for a visit that does not exist, so the function
--    is no existence oracle). The day is `tenant_local_date(clinic, now())`, so the caller cannot choose it. The
--    counter is advanced with one `INSERT … ON CONFLICT DO UPDATE … RETURNING` (research Pattern 5): concurrent
--    callers serialise on the counter row and each gets the next number. The day's `MAX(token_number)` is folded in
--    (`greatest`), so a token inserted without the counter (a fixture, a system path) is never handed out twice.
--    `SET lock_timeout = '5s'` bounds the wait for the row lock (55P03 -> CONFLICT LOCK_TIMEOUT); no function-level
--    statement_timeout (V2-03 03-07 finding 3). EXECUTE for `authenticated` only (revoked from `service_role`,
--    which Supabase's default privileges would grant: no system path issues tokens).
--    `generate_daily_queue_token` stays (no caller after this plan) until the 05b contract (05-b0, R-37).
-- Per-migration checklist: new table closed (RLS on, revokes) with its matrix row (`rpc_only` for every operation);
-- new functions pin search_path '' with fully qualified names, revoke PUBLIC/anon and grant explicitly; the definer
-- function is classified in `definer_functions.test.sql`; the seed is idempotent.

-- 1. Counter table -----------------------------------------------------------------------------------------------------
CREATE TABLE public.queue_token_counters (
    tenant_id UUID NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    date DATE NOT NULL,
    last_token INTEGER NOT NULL CHECK (last_token >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, date)
);

COMMENT ON TABLE public.queue_token_counters IS
    'Last queue token issued per clinic and clinic day; written only by next_queue_token (V2-05 05-08, R-18). No tenant-role access.';

ALTER TABLE public.queue_token_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.queue_token_counters FROM PUBLIC, anon, authenticated;

INSERT INTO public.queue_token_counters (tenant_id, date, last_token)
SELECT q.tenant_id, q.date, max(q.token_number)
FROM public.queue_tokens q
GROUP BY q.tenant_id, q.date
ON CONFLICT (tenant_id, date) DO UPDATE
    SET last_token = greatest(public.queue_token_counters.last_token, excluded.last_token);

-- 2. Clinic-local date ------------------------------------------------------------------------------------------------
CREATE FUNCTION public.tenant_local_date(p_tenant uuid, p_at timestamptz)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
    v_tz TEXT;
    v_zone TEXT;
    v_offset TEXT[];
BEGIN
    SELECT t.timezone INTO v_tz FROM public.tenants t WHERE t.id = p_tenant;

    IF v_tz IS NULL OR v_tz = 'Asia/Kolkata' THEN
        RETURN (p_at AT TIME ZONE 'Asia/Kolkata')::date;
    END IF;

    -- ECMA-402 offset forms: +HH, +HHMM, +HH:MM (east of UTC for '+', as Intl reads them).
    v_offset := pg_catalog.regexp_match(v_tz, '^([+-])([01][0-9]|2[0-3])(?::?([0-5][0-9]))?$');
    IF v_offset IS NOT NULL THEN
        RETURN ((p_at AT TIME ZONE 'UTC')
                + CASE WHEN v_offset[1] = '-' THEN -1 ELSE 1 END
                  * pg_catalog.make_interval(hours => v_offset[2]::int, mins => coalesce(v_offset[3], '0')::int))::date;
    END IF;

    SELECT z.name INTO v_zone
    FROM pg_catalog.pg_timezone_names z
    WHERE lower(z.name) = lower(v_tz)
    ORDER BY z.name
    LIMIT 1;

    RETURN (p_at AT TIME ZONE coalesce(v_zone, 'Asia/Kolkata'))::date;
END;
$$;

COMMENT ON FUNCTION public.tenant_local_date(uuid, timestamptz) IS
    'Calendar date of p_at in the clinic''s zone; unusable zone values fall back to Asia/Kolkata, as lib/datetime resolveTimeZone does (V2-05 05-08, V2-03 R-33).';

REVOKE ALL ON FUNCTION public.tenant_local_date(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_local_date(uuid, timestamptz) TO authenticated, service_role;

-- 3. Token RPC --------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.next_queue_token(p_visit_id uuid)
RETURNS TABLE (token_number integer, token_date date)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
    v_tenant UUID;
    v_date DATE;
    v_token INTEGER;
BEGIN
    SELECT v.tenant_id INTO v_tenant FROM public.visits v WHERE v.id = p_visit_id;

    IF v_tenant IS NULL OR NOT public.has_permission(v_tenant, 'appointments:edit') THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    v_date := public.tenant_local_date(v_tenant, now());

    INSERT INTO public.queue_token_counters AS c (tenant_id, date, last_token)
    VALUES (
        v_tenant,
        v_date,
        coalesce((SELECT max(q.token_number) FROM public.queue_tokens q
                   WHERE q.tenant_id = v_tenant AND q.date = v_date), 0) + 1
    )
    ON CONFLICT (tenant_id, date) DO UPDATE
        SET last_token = greatest(
                c.last_token,
                coalesce((SELECT max(q.token_number) FROM public.queue_tokens q
                           WHERE q.tenant_id = v_tenant AND q.date = v_date), 0)
            ) + 1,
            updated_at = now()
    RETURNING c.last_token INTO v_token;

    RETURN QUERY SELECT v_token, v_date;
END;
$$;

COMMENT ON FUNCTION public.next_queue_token(uuid) IS
    'Next queue token of the visit''s clinic for the clinic-local today; appointments:edit in the active clinic, else 42501 (V2-05 05-08, R-18).';

REVOKE ALL ON FUNCTION public.next_queue_token(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.next_queue_token(uuid) TO authenticated;
