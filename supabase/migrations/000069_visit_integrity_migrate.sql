-- Migration: 000069_visit_integrity_migrate.sql
-- V2-05 fix plan 05-11a step 2 (M-DURATION, M-TOKEN, H-VISIT signer membership). MIGRATE + VALIDATE the three
-- constraints 000068 added NOT VALID. Run the diagnostics first (`npm run db:diagnostics -- --label <label>`; markers
-- D6d, D9t and D5s in scripts/db/diagnostics.sql count exactly the rows each step below changes or refuses). The
-- counts are also raised as NOTICEs here (numbers only, no row data).
--
-- 1. Durations outside 5..480 minutes are clamped into the range (triage M-DURATION "clamp of legacy rows"). A slot
--    shorter than 5 minutes that would overlap another live slot of the same doctor once it is 5 minutes long is
--    marked `is_overbooked` in the same write (it already was double-booked in practice: a zero-length slot overlapped
--    nothing), so the clamp cannot fail on visits_no_double_booking. Shrinking a huge slot never creates an overlap.
--    Every row is written exactly once with its final, in-range value (000068's NOT VALID check applies to new row
--    versions).
-- 2. Queue tokens outside 1..9999 (only a forged row can be one) are renumbered after the highest in-range token of
--    their clinic day, in creation order; a counter pushed past 9999 by such a row is brought back to the day's
--    highest stored token, so the day can issue tokens again.
-- 3. A signer who is not a member of the visit's clinic has no automatic remedy (rewriting a signature would forge
--    one): VALIDATE fails with 23503 and the migration stops, as for 05-03's composite FKs. D5s must be 0 first; the
--    remedy is decided per row with the clinic (pinned in migration_edge_cases_visit_integrity.test.sql).
-- 4. VALIDATE visits_duration_range, queue_tokens_token_range, visits_tenant_signed_by_fkey.
-- The statements of steps 1-2 are replayed verbatim on planted legacy rows by
-- supabase/tests/database/migration_edge_cases_visit_integrity.test.sql (tests/ci/visit-integrity-inline.spec.ts).

DO $$
DECLARE
    v_duration integer;
    v_token integer;
    v_signer integer;
BEGIN
    SELECT count(*) INTO v_duration FROM public.visits WHERE estimated_duration_minutes NOT BETWEEN 5 AND 480;
    SELECT count(*) INTO v_token FROM public.queue_tokens WHERE token_number NOT BETWEEN 1 AND 9999;
    SELECT count(*) INTO v_signer FROM public.visits v
     WHERE v.signed_by IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.tenant_id = v.tenant_id AND m.user_id = v.signed_by);
    RAISE NOTICE '05-11a diagnostics: D6d durations out of range = %, D9t tokens out of range = %, D5s non-member signers = %',
        v_duration, v_token, v_signer;
END;
$$;

-- 1a. Shrink slots longer than 480 minutes (never creates an overlap). Each row is written once and lands in range,
-- because the NOT VALID check already applies to every new row version.
UPDATE public.visits
   SET estimated_duration_minutes = 480
 WHERE estimated_duration_minutes > 480;

-- 1b. Lengthen slots shorter than 5 minutes to 5; in the same write, a live scheduled slot that would then overlap
-- another live slot of the doctor (compared at its clamped length) is marked overbooked. Short rows not yet written
-- still have an empty range, so no intermediate state overlaps.
UPDATE public.visits x
   SET estimated_duration_minutes = 5,
       is_overbooked = x.is_overbooked OR (
           x.origin_type = 'scheduled' AND x.scheduled_at IS NOT NULL
           AND x.status NOT IN ('cancelled', 'no_show')
           AND EXISTS (
               SELECT 1 FROM public.visits y
                WHERE y.tenant_id = x.tenant_id AND y.doctor_id = x.doctor_id AND y.id <> x.id
                  AND y.origin_type = 'scheduled' AND y.scheduled_at IS NOT NULL AND NOT y.is_overbooked
                  AND y.status NOT IN ('cancelled', 'no_show')
                  AND public.visit_slot(y.scheduled_at, least(greatest(y.estimated_duration_minutes, 5), 480))
                      && public.visit_slot(x.scheduled_at, 5)))
 WHERE x.estimated_duration_minutes < 5;

-- 2a. Renumber out-of-range tokens after the day's highest in-range token.
WITH bad AS (
    SELECT q.id, q.tenant_id, q.date,
           row_number() OVER (PARTITION BY q.tenant_id, q.date ORDER BY q.created_at, q.id) AS n
      FROM public.queue_tokens q
     WHERE q.token_number NOT BETWEEN 1 AND 9999
), renumbered AS (
    SELECT b.id,
           coalesce((SELECT max(g.token_number) FROM public.queue_tokens g
                      WHERE g.tenant_id = b.tenant_id AND g.date = b.date
                        AND g.token_number BETWEEN 1 AND 9999), 0) + b.n AS token_number
      FROM bad b
)
UPDATE public.queue_tokens q
   SET token_number = r.token_number
  FROM renumbered r
 WHERE q.id = r.id;

-- 2b. A counter pushed past 9999 restarts from the day's highest stored token.
UPDATE public.queue_token_counters c
   SET last_token = coalesce((SELECT max(q.token_number) FROM public.queue_tokens q
                               WHERE q.tenant_id = c.tenant_id AND q.date = c.date), 0),
       updated_at = now()
 WHERE c.last_token > 9999;

-- 3-4. Validate.
ALTER TABLE public.visits VALIDATE CONSTRAINT visits_duration_range;
ALTER TABLE public.queue_tokens VALIDATE CONSTRAINT queue_tokens_token_range;
ALTER TABLE public.visits VALIDATE CONSTRAINT visits_tenant_signed_by_fkey;
