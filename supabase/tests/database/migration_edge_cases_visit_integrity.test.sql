-- migration_edge_cases_visit_integrity.test.sql — V2-05 fix plan 05-11a (05a review triage M-DURATION, M-TOKEN,
-- H-VISIT signer FK; "legacy-data diagnostics before VALIDATE"; pattern of migration_edge_cases_overlap.test.sql).
--
-- On this transaction's copy of the schema the three constraints 000068 adds are removed, the legacy rows the 000069
-- diagnostics look for are planted (D6d: durations 0, negative, 2e9, including zero-length slots that overlap a
-- booking once 5 minutes long; D9t: tokens 0 and 2147483647 and a counter pushed past 9999; D5s: a visit signed by a
-- user outside the clinic), and 000068's ADD ... NOT VALID and 000069's statements are replayed VERBATIM
-- (tests/ci/visit-integrity-inline.spec.ts pins them byte-identical to the migrations). The clamp and renumbering
-- bring D6d and D9t to 0 without tripping visits_no_double_booking or the token key, and VALIDATE then succeeds; the
-- non-member signer has no automatic remedy, so VALIDATE of the FK fails with 23503 (the migration stops) until the
-- row is corrected. Everything is rolled back; synthetic data only.
begin;
select plan(17);

insert into auth.users (id, email) values
  ('c11b0000-0000-4000-8000-000000000101', 'c11b-owner@example.test'),
  ('c11b0000-0000-4000-8000-000000000102', 'c11b-doctor@example.test'),
  ('c11b0000-0000-4000-8000-000000000201', 'c11b-outsider@example.test');
insert into public.tenants (id, name) values
  ('c11b0000-0000-4000-8000-00000000000a', 'Synthetic 05-11a Legacy Clinic'),
  ('c11b0000-0000-4000-8000-00000000000b', 'Synthetic 05-11a Other Clinic');
insert into public.memberships (user_id, tenant_id, role) values
  ('c11b0000-0000-4000-8000-000000000101', 'c11b0000-0000-4000-8000-00000000000a', 'owner'),
  ('c11b0000-0000-4000-8000-000000000102', 'c11b0000-0000-4000-8000-00000000000a', 'doctor'),
  ('c11b0000-0000-4000-8000-000000000201', 'c11b0000-0000-4000-8000-00000000000b', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c11b0000-0000-4000-8000-000000001001', 'c11b0000-0000-4000-8000-00000000000a', 'Synthetic Legacy Patient', '+919000001111', 'c11b0000-0000-4000-8000-000000000101');

-- The diagnostics (scripts/db/diagnostics.sql D6d, D9t, D5s), restricted to the fixture clinic.
create function pg_temp.d6d() returns int language sql as $f$
  select count(*)::int from public.visits
   where estimated_duration_minutes not between 5 and 480 and tenant_id = 'c11b0000-0000-4000-8000-00000000000a'
$f$;
create function pg_temp.d9t() returns int language sql as $f$
  select count(*)::int from public.queue_tokens
   where token_number not between 1 and 9999 and tenant_id = 'c11b0000-0000-4000-8000-00000000000a'
$f$;
create function pg_temp.d5s() returns int language sql as $f$
  select count(*)::int from public.visits v
   where v.signed_by is not null and v.tenant_id = 'c11b0000-0000-4000-8000-00000000000a'
     and not exists (select 1 from public.memberships m where m.tenant_id = v.tenant_id and m.user_id = v.signed_by)
$f$;

select is(pg_temp.d6d() + pg_temp.d9t() + pg_temp.d5s(), 0, 'D6d, D9t and D5s are 0 for the fixture clinic before the edge cases are planted');

alter table public.visits drop constraint visits_duration_range;
alter table public.queue_tokens drop constraint queue_tokens_token_range;
alter table public.visits drop constraint visits_tenant_signed_by_fkey;

-- 3001 a normal 15-minute booking at 10:00; 3002 zero-length at 10:14 (overlaps 3001 once 5 minutes long);
-- 3003 zero-length alone at 11:00; 3004 a walk-in of -10 minutes; 3005/3006 two zero-length slots at 14:00;
-- 3007 a slot of 2e9 minutes at 16:00; 3008 signed by a user outside the clinic; 3009 zero-length the next morning,
-- inside 3007's old range but outside its clamped 480 minutes (the clamp must never pass through an overlap).
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at, estimated_duration_minutes, created_by) values
  ('c11b0000-0000-4000-8000-000000003001', 'c11b0000-0000-4000-8000-00000000000a', 'c11b0000-0000-4000-8000-000000001001',
   'c11b0000-0000-4000-8000-000000000102', 'scheduled', 'booked', '2030-05-06 10:00+05:30', 15, 'c11b0000-0000-4000-8000-000000000101'),
  ('c11b0000-0000-4000-8000-000000003002', 'c11b0000-0000-4000-8000-00000000000a', 'c11b0000-0000-4000-8000-000000001001',
   'c11b0000-0000-4000-8000-000000000102', 'scheduled', 'booked', '2030-05-06 10:14+05:30', 0, 'c11b0000-0000-4000-8000-000000000101'),
  ('c11b0000-0000-4000-8000-000000003003', 'c11b0000-0000-4000-8000-00000000000a', 'c11b0000-0000-4000-8000-000000001001',
   'c11b0000-0000-4000-8000-000000000102', 'scheduled', 'booked', '2030-05-06 11:00+05:30', 0, 'c11b0000-0000-4000-8000-000000000101'),
  ('c11b0000-0000-4000-8000-000000003004', 'c11b0000-0000-4000-8000-00000000000a', 'c11b0000-0000-4000-8000-000000001001',
   'c11b0000-0000-4000-8000-000000000102', 'walk_in', 'waiting', null, -10, 'c11b0000-0000-4000-8000-000000000101'),
  ('c11b0000-0000-4000-8000-000000003005', 'c11b0000-0000-4000-8000-00000000000a', 'c11b0000-0000-4000-8000-000000001001',
   'c11b0000-0000-4000-8000-000000000102', 'scheduled', 'booked', '2030-05-06 14:00+05:30', 0, 'c11b0000-0000-4000-8000-000000000101'),
  ('c11b0000-0000-4000-8000-000000003006', 'c11b0000-0000-4000-8000-00000000000a', 'c11b0000-0000-4000-8000-000000001001',
   'c11b0000-0000-4000-8000-000000000102', 'scheduled', 'confirmed', '2030-05-06 14:00+05:30', 0, 'c11b0000-0000-4000-8000-000000000101'),
  ('c11b0000-0000-4000-8000-000000003007', 'c11b0000-0000-4000-8000-00000000000a', 'c11b0000-0000-4000-8000-000000001001',
   'c11b0000-0000-4000-8000-000000000102', 'scheduled', 'booked', '2030-05-06 16:00+05:30', 2000000000, 'c11b0000-0000-4000-8000-000000000101'),
  ('c11b0000-0000-4000-8000-000000003009', 'c11b0000-0000-4000-8000-00000000000a', 'c11b0000-0000-4000-8000-000000001001',
   'c11b0000-0000-4000-8000-000000000102', 'scheduled', 'booked', '2030-05-07 10:00+05:30', 0, 'c11b0000-0000-4000-8000-000000000101');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, signed_at, signed_by, created_by) values
  ('c11b0000-0000-4000-8000-000000003008', 'c11b0000-0000-4000-8000-00000000000a', 'c11b0000-0000-4000-8000-000000001001',
   'c11b0000-0000-4000-8000-000000000102', 'walk_in', 'completed', '2030-05-06 17:00+05:30', 'c11b0000-0000-4000-8000-000000000201',
   'c11b0000-0000-4000-8000-000000000101');
-- Day 2030-05-06: token 3 in range, then a forged 0 and 2147483647 (in that creation order); the counter was pushed
-- past 9999 by a fold-in of a forged row.
insert into public.queue_tokens (id, tenant_id, visit_id, date, token_number, created_at) values
  ('c11b0000-0000-4000-8000-000000004001', 'c11b0000-0000-4000-8000-00000000000a', 'c11b0000-0000-4000-8000-000000003001', '2030-05-06', 3, '2030-05-06 09:00+05:30'),
  ('c11b0000-0000-4000-8000-000000004002', 'c11b0000-0000-4000-8000-00000000000a', 'c11b0000-0000-4000-8000-000000003003', '2030-05-06', 2147483647, '2030-05-06 09:02+05:30'),
  ('c11b0000-0000-4000-8000-000000004003', 'c11b0000-0000-4000-8000-00000000000a', 'c11b0000-0000-4000-8000-000000003004', '2030-05-06', 0, '2030-05-06 09:01+05:30');
insert into public.queue_token_counters (tenant_id, date, last_token) values
  ('c11b0000-0000-4000-8000-00000000000a', '2030-05-06', 50000);

select is(pg_temp.d6d(), 7, 'D6d finds the seven planted durations (0, 0, -10, 0, 0, 2e9, 0)');
select is(pg_temp.d9t(), 2, 'D9t finds the two planted tokens (0, 2147483647)');
select is(pg_temp.d5s(), 1, 'D5s finds the planted non-member signer');

-- 000068's statements, verbatim.
ALTER TABLE public.visits
    ADD CONSTRAINT visits_duration_range CHECK (estimated_duration_minutes BETWEEN 5 AND 480) NOT VALID;
ALTER TABLE public.queue_tokens
    ADD CONSTRAINT queue_tokens_token_range CHECK (token_number BETWEEN 1 AND 9999) NOT VALID;
ALTER TABLE public.visits
    ADD CONSTRAINT visits_tenant_signed_by_fkey FOREIGN KEY (signed_by, tenant_id)
    REFERENCES public.memberships (user_id, tenant_id) ON DELETE RESTRICT NOT VALID;

-- 000069's statements, verbatim.
UPDATE public.visits
   SET estimated_duration_minutes = 480
 WHERE estimated_duration_minutes > 480;

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

UPDATE public.queue_token_counters c
   SET last_token = coalesce((SELECT max(q.token_number) FROM public.queue_tokens q
                               WHERE q.tenant_id = c.tenant_id AND q.date = c.date), 0),
       updated_at = now()
 WHERE c.last_token > 9999;

select is(
  (select array_agg(id::text || ':' || estimated_duration_minutes || ':' || is_overbooked order by id) from public.visits
    where tenant_id = 'c11b0000-0000-4000-8000-00000000000a' and id <> 'c11b0000-0000-4000-8000-000000003008'),
  array['c11b0000-0000-4000-8000-000000003001:15:false', 'c11b0000-0000-4000-8000-000000003002:5:true',
        'c11b0000-0000-4000-8000-000000003003:5:false', 'c11b0000-0000-4000-8000-000000003004:5:false',
        'c11b0000-0000-4000-8000-000000003005:5:true', 'c11b0000-0000-4000-8000-000000003006:5:true',
        'c11b0000-0000-4000-8000-000000003007:480:false', 'c11b0000-0000-4000-8000-000000003009:5:false'],
  'durations clamped to 5..480; a zero-length slot that now overlaps a booking (or another clamped slot) is marked overbooked, the rest untouched');
select is(pg_temp.d6d(), 0, 'D6d is 0 after the clamp');
select is(
  (select array_agg(id::text || ':' || token_number order by id) from public.queue_tokens
    where tenant_id = 'c11b0000-0000-4000-8000-00000000000a'),
  array['c11b0000-0000-4000-8000-000000004001:3', 'c11b0000-0000-4000-8000-000000004002:5',
        'c11b0000-0000-4000-8000-000000004003:4'],
  'out-of-range tokens renumbered after the day''s highest in-range token (3), in creation order');
select is(pg_temp.d9t(), 0, 'D9t is 0 after the renumbering');
select is((select last_token from public.queue_token_counters
            where tenant_id = 'c11b0000-0000-4000-8000-00000000000a' and date = '2030-05-06'), 5,
  'the counter pushed past 9999 restarts at the day''s highest stored token');

ALTER TABLE public.visits VALIDATE CONSTRAINT visits_duration_range;
ALTER TABLE public.queue_tokens VALIDATE CONSTRAINT queue_tokens_token_range;
select is(
  (select array_agg(conname || ':' || convalidated order by conname) from pg_constraint
    where conname in ('visits_duration_range', 'queue_tokens_token_range')),
  array['queue_tokens_token_range:true', 'visits_duration_range:true'],
  'VALIDATE of the duration and token constraints succeeds on the corrected rows');
select throws_ok($$alter table public.visits validate constraint visits_tenant_signed_by_fkey$$, '23503', null,
  'the non-member signer has no automatic remedy: VALIDATE fails with 23503 and the migration stops (D5s must be 0)');
-- Remedy decided with the clinic for this synthetic row: the record names its real signer (a member).
update public.visits set signed_by = 'c11b0000-0000-4000-8000-000000000102' where id = 'c11b0000-0000-4000-8000-000000003008';
select is(pg_temp.d5s(), 0, 'D5s is 0 after the row is corrected');
ALTER TABLE public.visits VALIDATE CONSTRAINT visits_tenant_signed_by_fkey;
select is((select convalidated from pg_constraint where conname = 'visits_tenant_signed_by_fkey'), true,
  'then VALIDATE of the signer FK succeeds');

-- The constraints hold for new writes.
select throws_ok($$update public.visits set estimated_duration_minutes = 0 where id = 'c11b0000-0000-4000-8000-000000003001'$$,
  '23514', null, 'visits_duration_range refuses a new zero-length slot');
select throws_ok($$update public.queue_tokens set token_number = 10000 where id = 'c11b0000-0000-4000-8000-000000004001'$$,
  '23514', null, 'queue_tokens_token_range refuses a new out-of-range token');
select throws_ok($$update public.visits set signed_by = 'c11b0000-0000-4000-8000-000000000201'
  where id = 'c11b0000-0000-4000-8000-000000003001'$$, '23503', null, 'visits_tenant_signed_by_fkey refuses a new non-member signer');
select is((select count(*)::int from public.visits a join public.visits b
            on a.tenant_id = b.tenant_id and a.doctor_id = b.doctor_id and a.id < b.id
           and public.visit_slot(a.scheduled_at, a.estimated_duration_minutes) && public.visit_slot(b.scheduled_at, b.estimated_duration_minutes)
           where a.tenant_id = 'c11b0000-0000-4000-8000-00000000000a' and a.origin_type = 'scheduled' and b.origin_type = 'scheduled'
             and not a.is_overbooked and not b.is_overbooked and a.status not in ('cancelled', 'no_show')
             and b.status not in ('cancelled', 'no_show')), 0,
  'D6 (overlap) stays 0 for the fixture clinic: the clamp created no double booking');

select * from finish();
rollback;
