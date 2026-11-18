-- IR2-L3 (plan 01-09; pgTAP since V2-05 05-01a): migration 000021 brings old memberships rows into range before it
-- validates its CHECKs, so a database holding a slot length of 121..180 or a malformed availability_schedule (both
-- accepted before 000021) can still be migrated.
--
-- Run by `npm run test:pgtap` (supabase test db --local supabase/tests/database), local stack only. One transaction,
-- rolled back: the planted tenant, users and memberships never persist.
--
-- Steps: drop the two CHECKs, plant pre-000021 rows (synthetic tenant and users), show that adding the CHECK without the
-- clean-up fails (control), re-run 000021's memberships section, assert the rows were clamped/reset, valid rows
-- untouched, and both CHECKs validated.
--
-- The legacy psql script re-ran the whole migration with `\ir ../migrations/000021_review_fixes.sql`; pg_prove runs in
-- a container where supabase/migrations is not mounted (research A7), so the section this test exercises (000021 §4) is
-- inlined between the `verbatim` markers below. It must stay byte-identical to the migration
-- (tests/ci/pgtap-legacy-inline.spec.ts); 000021 itself is immutable (scripts/ci/migration-immutability.mjs).
begin;
select plan(7);

alter table public.memberships drop constraint if exists memberships_slot_duration_bounds;
alter table public.memberships drop constraint if exists memberships_availability_schedule_shape;

create temp table _ids on commit drop as
select gen_random_uuid() as tenant_id, gen_random_uuid() as u_long, gen_random_uuid() as u_bad_schedule,
       gen_random_uuid() as u_ok;

insert into public.tenants (id, name) select tenant_id, 'Synthetic IR2-L3 Clinic' from _ids;
insert into auth.users (id, email)
select u, 'ir2-l3-' || u::text || '@example.com'
from _ids, lateral (values (u_long), (u_bad_schedule), (u_ok)) as x(u);

insert into public.memberships (tenant_id, user_id, role, default_slot_duration_minutes, availability_schedule)
select tenant_id, u_long, 'doctor', 180,
       '{"monday": {"enabled": true, "shifts": [{"start": "09:00", "end": "12:00"}]}}'::jsonb from _ids
union all
select tenant_id, u_bad_schedule, 'doctor', 3, '{"funday": {"enabled": true, "shifts": []}}'::jsonb from _ids
union all
select tenant_id, u_ok, 'doctor', 20,
       '{"tuesday": {"enabled": true, "shifts": [{"start": "10:00", "end": "13:00"}]}}'::jsonb from _ids;

-- 1. Control: without the clean-up the CHECK cannot be added and validated (throws_ok runs it in a subtransaction).
select throws_ok(
  $$ alter table public.memberships add constraint _ir2_l3_probe
       check (default_slot_duration_minutes is null or default_slot_duration_minutes between 5 and 120) $$,
  '23514',
  null,
  'control: the slot-length CHECK fails on the planted rows without the clean-up'
);

-- >>> verbatim 000021_review_fixes.sql §4 (lines 559-628)
-- 4. Scheduling bounds on memberships -----------------------------------------------------------------------------
-- Mirrors doctorWeeklyScheduleSchema (features/settings/schema.ts): an object keyed by weekday; each day
-- {enabled: boolean, shifts: [{start: "HH:MM", end: "HH:MM"}]} with start < end and at most 8 shifts. Days may be
-- missing (the reschedule route treats a missing day as closed).
CREATE OR REPLACE FUNCTION public.is_valid_weekly_schedule(p_schedule JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_day TEXT;
    v_val JSONB;
    v_shift JSONB;
BEGIN
    IF p_schedule IS NULL THEN
        RETURN TRUE;
    END IF;
    IF jsonb_typeof(p_schedule) <> 'object' THEN
        RETURN FALSE;
    END IF;

    FOR v_day, v_val IN SELECT e.key, e.value FROM jsonb_each(p_schedule) e LOOP
        IF v_day NOT IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday') THEN
            RETURN FALSE;
        END IF;
        IF jsonb_typeof(v_val) <> 'object'
           OR jsonb_typeof(v_val -> 'enabled') IS DISTINCT FROM 'boolean'
           OR jsonb_typeof(v_val -> 'shifts') IS DISTINCT FROM 'array'
           OR jsonb_array_length(v_val -> 'shifts') > 8 THEN
            RETURN FALSE;
        END IF;
        FOR v_shift IN SELECT s.value FROM jsonb_array_elements(v_val -> 'shifts') s LOOP
            IF jsonb_typeof(v_shift) <> 'object'
               OR jsonb_typeof(v_shift -> 'start') IS DISTINCT FROM 'string'
               OR jsonb_typeof(v_shift -> 'end') IS DISTINCT FROM 'string'
               OR (v_shift ->> 'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
               OR (v_shift ->> 'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
               OR (v_shift ->> 'start') >= (v_shift ->> 'end') THEN
                RETURN FALSE;
            END IF;
        END LOOP;
    END LOOP;

    RETURN TRUE;
END;
$$;

-- IR2-L3 (plan 01-09; this file was edited after review under a recorded exception: never pushed, applied only to the
-- local stack). Migrate before the contract: rows written before these bounds existed (the service accepted slot lengths
-- up to 180, and any availability_schedule shape) are brought into range, so VALIDATE cannot fail on old data. A slot
-- length is clamped to 5..120; a schedule that is not a valid weekly schedule is reset to the column default.
UPDATE public.memberships
SET default_slot_duration_minutes = LEAST(GREATEST(default_slot_duration_minutes, 5), 120)
WHERE default_slot_duration_minutes IS NOT NULL
  AND default_slot_duration_minutes NOT BETWEEN 5 AND 120;

UPDATE public.memberships
SET availability_schedule = DEFAULT
WHERE NOT public.is_valid_weekly_schedule(availability_schedule);

ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_slot_duration_bounds;
ALTER TABLE public.memberships ADD CONSTRAINT memberships_slot_duration_bounds
    CHECK (default_slot_duration_minutes IS NULL OR default_slot_duration_minutes BETWEEN 5 AND 120) NOT VALID;
ALTER TABLE public.memberships VALIDATE CONSTRAINT memberships_slot_duration_bounds;

ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_availability_schedule_shape;
ALTER TABLE public.memberships ADD CONSTRAINT memberships_availability_schedule_shape
    CHECK (public.is_valid_weekly_schedule(availability_schedule)) NOT VALID;
ALTER TABLE public.memberships VALIDATE CONSTRAINT memberships_availability_schedule_shape;
-- <<< verbatim

-- 2-3. A slot length above the bound is clamped to 120; its valid schedule is untouched.
select is(
  (select m.default_slot_duration_minutes from public.memberships m, _ids i
    where m.tenant_id = i.tenant_id and m.user_id = i.u_long),
  120,
  'slot length 180 is clamped to 120'
);
select is(
  (select m.availability_schedule -> 'monday' -> 'shifts' -> 0 ->> 'start' from public.memberships m, _ids i
    where m.tenant_id = i.tenant_id and m.user_id = i.u_long),
  '09:00',
  'a valid schedule is not changed'
);

-- 4-5. A slot length below the bound is clamped to 5; a malformed schedule is reset to the column default.
select is(
  (select m.default_slot_duration_minutes from public.memberships m, _ids i
    where m.tenant_id = i.tenant_id and m.user_id = i.u_bad_schedule),
  5,
  'slot length 3 is clamped to 5'
);
select ok(
  (select not (m.availability_schedule ? 'funday')
          and public.is_valid_weekly_schedule(m.availability_schedule)
          and m.availability_schedule ? 'monday'
     from public.memberships m, _ids i
    where m.tenant_id = i.tenant_id and m.user_id = i.u_bad_schedule),
  'a malformed schedule is reset to the column default'
);

-- 6. An in-range slot length is not changed.
select is(
  (select m.default_slot_duration_minutes from public.memberships m, _ids i
    where m.tenant_id = i.tenant_id and m.user_id = i.u_ok),
  20,
  'an in-range slot length is not changed'
);

-- 7. Both CHECKs are present and validated.
select is(
  (select count(*)::int from pg_catalog.pg_constraint
    where conrelid = 'public.memberships'::regclass
      and conname in ('memberships_slot_duration_bounds', 'memberships_availability_schedule_shape')
      and convalidated),
  2,
  'memberships_slot_duration_bounds and memberships_availability_schedule_shape are present and validated'
);

select * from finish();
rollback;
