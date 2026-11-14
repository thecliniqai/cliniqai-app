-- Migration: 000063_visits_no_double_booking.sql
-- V2-05 plan 05-08 step 2 (P1-39, DB-08; ruling R-11; threat T-05-20; roadmap V2-05 acceptance 6).
--
-- Two overlapping, non-overbooked scheduled appointments of the same doctor in the same clinic cannot both exist.
-- Before this, the only check was the app's read-then-insert in `checkSlotAvailability` (features/visits/
-- scheduling-service.ts), so two receptionists booking the same slot at the same moment both succeeded.
--
-- 1. `btree_gist` (contrib, shipped with the Supabase image) in schema `extensions`: the `=` columns of a GiST
--    exclusion constraint need its uuid operator class.
-- 2. `public.visit_slot(p_at, p_mins)`: the appointment's half-open slot `[p_at, p_at + p_mins minutes)`, so 10:00-10:15
--    and 10:15-10:30 do not overlap. IMMUTABLE through a wrapper (R-11): `timestamptz + interval` is only STABLE and an
--    index expression must be immutable (the roadmap's inline SQL is rejected); an interval of minutes only never
--    depends on `TimeZone` (only day and month parts do), so the wrapper's IMMUTABLE label is true. The inserting
--    role needs EXECUTE (index expressions are permission-checked when evaluated), so `authenticated` and
--    `service_role` hold it; PUBLIC and `anon` do not.
-- 3. `visits_no_double_booking`: EXCLUDE USING gist (tenant_id =, doctor_id =, visit_slot(...) &&) for rows that are
--    scheduled, have a time, are not overbooked and are not cancelled or no-show. The predicate matches diagnostics D6
--    (BACKEND_MIGRATION_PLAN §3) plus `scheduled_at IS NOT NULL`: a null time would give an unbounded range that
--    overlaps every slot. Created VALID (an exclusion constraint cannot be NOT VALID; research Pitfall 2) after D6 = 0
--    (`evidence/05a/diagnostics/before-05-08.json`); a database with an overlap fails here with 23P01 and the remedy is
--    to mark one of the pair `is_overbooked` (proven by `migration_edge_cases_overlap.test.sql`).
--    A violation is SQLSTATE 23P01, mapped by `lib/db/errors.ts` to CONFLICT with reason VISITS_NO_DOUBLE_BOOKING.
--    An update is checked too (a reschedule into a taken slot, or a cancelled visit restored into one); a row never
--    conflicts with its own previous version.
-- Per-migration checklist: no new table; the new function pins search_path '', revokes PUBLIC/anon and grants
-- exactly the roles that insert visits; no data is changed.

-- 1. Extension ---------------------------------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- 2. Immutable slot wrapper --------------------------------------------------------------------------------------------
CREATE FUNCTION public.visit_slot(p_at timestamptz, p_mins integer)
RETURNS tstzrange
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT pg_catalog.tstzrange(p_at, p_at + pg_catalog.make_interval(mins => p_mins), '[)')
$$;

COMMENT ON FUNCTION public.visit_slot(timestamptz, integer) IS
    'Half-open slot [p_at, p_at + p_mins minutes) of a scheduled visit; IMMUTABLE wrapper for the visits_no_double_booking exclusion constraint (V2-05 05-08, R-11).';

REVOKE ALL ON FUNCTION public.visit_slot(timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visit_slot(timestamptz, integer) TO authenticated, service_role;

-- 3. Exclusion constraint ----------------------------------------------------------------------------------------------
ALTER TABLE public.visits
    ADD CONSTRAINT visits_no_double_booking
    EXCLUDE USING gist (
        tenant_id WITH =,
        doctor_id WITH =,
        public.visit_slot(scheduled_at, estimated_duration_minutes) WITH &&
    )
    WHERE (
        origin_type = 'scheduled'
        AND scheduled_at IS NOT NULL
        AND NOT is_overbooked
        AND status NOT IN ('cancelled', 'no_show')
    );

COMMENT ON CONSTRAINT visits_no_double_booking ON public.visits IS
    'No two overlapping non-overbooked scheduled visits of one doctor in one clinic (V2-05 05-08, DB-08). 23P01 -> CONFLICT VISITS_NO_DOUBLE_BOOKING.';
