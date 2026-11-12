-- IR2-L3 (plan 01-09): migration 000021 brings old memberships rows into range before it validates its CHECKs, so a
-- database holding a slot length of 121..180 or a malformed availability_schedule (both accepted before 000021) can
-- still be migrated.
--
-- Run against the LOCAL stack only, from the repository root:
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/memberships_bounds_cleanup.sql
-- One transaction, rolled back. Prints "PASS: ..." on success; a failed assertion raises an exception.
--
-- Steps: drop the two CHECKs, plant pre-000021 rows (synthetic tenant and users), show that adding the CHECK without the
-- clean-up fails (control), re-run 000021, assert the rows were clamped/reset, valid rows untouched, and both CHECKs
-- validated.
\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_slot_duration_bounds;
ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_availability_schedule_shape;

CREATE TEMP TABLE _ids ON COMMIT DROP AS
SELECT gen_random_uuid() AS tenant_id, gen_random_uuid() AS u_long, gen_random_uuid() AS u_bad_schedule,
       gen_random_uuid() AS u_ok;

INSERT INTO public.tenants (id, name) SELECT tenant_id, 'Synthetic IR2-L3 Clinic' FROM _ids;
INSERT INTO auth.users (id, email)
SELECT u, 'ir2-l3-' || u::TEXT || '@example.com'
FROM _ids, LATERAL (VALUES (u_long), (u_bad_schedule), (u_ok)) AS x(u);

INSERT INTO public.memberships (tenant_id, user_id, role, default_slot_duration_minutes, availability_schedule)
SELECT tenant_id, u_long, 'doctor', 180,
       '{"monday": {"enabled": true, "shifts": [{"start": "09:00", "end": "12:00"}]}}'::JSONB FROM _ids
UNION ALL
SELECT tenant_id, u_bad_schedule, 'doctor', 3, '{"funday": {"enabled": true, "shifts": []}}'::JSONB FROM _ids
UNION ALL
SELECT tenant_id, u_ok, 'doctor', 20,
       '{"tuesday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}]}}'::JSONB FROM _ids;

-- Control: without the clean-up the CHECK cannot be added and validated.
DO $control$
BEGIN
    BEGIN
        ALTER TABLE public.memberships ADD CONSTRAINT _ir2_l3_probe
            CHECK (default_slot_duration_minutes IS NULL OR default_slot_duration_minutes BETWEEN 5 AND 120);
        RAISE EXCEPTION 'FAIL: control: the CHECK validated over the planted rows (check is not discriminating)';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'control ok: the CHECK fails on the planted rows without the clean-up';
    END;
END;
$control$;

SET LOCAL check_function_bodies = off;
\ir ../migrations/000021_review_fixes.sql
SET LOCAL check_function_bodies = on;

DO $assert$
DECLARE
    i _ids;
    v_slot INTEGER;
    v_sched JSONB;
BEGIN
    SELECT * INTO i FROM _ids;

    SELECT default_slot_duration_minutes, availability_schedule INTO v_slot, v_sched
    FROM public.memberships WHERE tenant_id = i.tenant_id AND user_id = i.u_long;
    IF v_slot <> 120 THEN RAISE EXCEPTION 'FAIL: slot 180 not clamped to 120 (got %)', v_slot; END IF;
    IF v_sched -> 'monday' -> 'shifts' -> 0 ->> 'start' <> '09:00' THEN
        RAISE EXCEPTION 'FAIL: a valid schedule was changed';
    END IF;

    SELECT default_slot_duration_minutes, availability_schedule INTO v_slot, v_sched
    FROM public.memberships WHERE tenant_id = i.tenant_id AND user_id = i.u_bad_schedule;
    IF v_slot <> 5 THEN RAISE EXCEPTION 'FAIL: slot 3 not clamped to 5 (got %)', v_slot; END IF;
    IF v_sched ? 'funday' OR NOT public.is_valid_weekly_schedule(v_sched) OR NOT (v_sched ? 'monday') THEN
        RAISE EXCEPTION 'FAIL: malformed schedule not reset to the column default';
    END IF;

    SELECT default_slot_duration_minutes INTO v_slot
    FROM public.memberships WHERE tenant_id = i.tenant_id AND user_id = i.u_ok;
    IF v_slot <> 20 THEN RAISE EXCEPTION 'FAIL: an in-range slot length was changed'; END IF;

    IF (SELECT count(*) FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.memberships'::regclass
          AND conname IN ('memberships_slot_duration_bounds', 'memberships_availability_schedule_shape')
          AND convalidated) <> 2 THEN
        RAISE EXCEPTION 'FAIL: the two memberships CHECKs are not both present and validated';
    END IF;

    RAISE NOTICE 'PASS: 000021 clamps slot lengths to 5..120 and resets malformed schedules before validating its CHECKs; transaction rolled back';
END;
$assert$;

ROLLBACK;
