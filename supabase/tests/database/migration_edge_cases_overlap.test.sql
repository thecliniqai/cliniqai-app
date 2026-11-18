-- migration_edge_cases_overlap.test.sql — V2-05 plan 05-08 (roadmap V2-05 test "migration tests on a copy seeded with
-- the diagnostics' edge cases", overlap half; R-11, R-15; BACKEND §3 D6, §6 C7; research Pitfall 2).
--
-- On this transaction's copy of the schema: the exclusion constraint is removed, the edge case diagnostics D6 looks
-- for is planted (two overlapping non-overbooked scheduled visits of one doctor), and the migration's statement is
-- replayed. An exclusion constraint cannot be added NOT VALID, so re-adding it over the overlap fails with 23P01 (the
-- reason the plan runs D6 first and stops on a non-zero count); the BACKEND C7 remedy (mark one of the pair
-- is_overbooked) brings D6 to 0 and the constraint is then created. Everything is rolled back; synthetic data only.
begin;
select plan(9);

insert into auth.users (id, email) values
  ('c0810000-0000-4000-8000-000000000101', 'c081-owner@example.test'),
  ('c0810000-0000-4000-8000-000000000102', 'c081-doctor@example.test');
insert into public.tenants (id, name) values ('c0810000-0000-4000-8000-00000000000a', 'Synthetic 05-08 Overlap Clinic');
insert into public.memberships (user_id, tenant_id, role) values
  ('c0810000-0000-4000-8000-000000000101', 'c0810000-0000-4000-8000-00000000000a', 'owner'),
  ('c0810000-0000-4000-8000-000000000102', 'c0810000-0000-4000-8000-00000000000a', 'doctor');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('c0810000-0000-4000-8000-000000001001', 'c0810000-0000-4000-8000-00000000000a', 'Synthetic Overlap Patient', '+919000000811', 'c0810000-0000-4000-8000-000000000101');

-- Only this file's clinic is counted, so rows of a concurrent seed cannot change the result.
create function pg_temp.d6() returns int language sql as $f$
  -- D6 (BACKEND §3, scripts/db/diagnostics.sql), restricted to the fixture clinic.
  select count(*)::int from visits a join visits b
    on a.tenant_id=b.tenant_id and a.doctor_id=b.doctor_id and a.id<b.id
   and tstzrange(a.scheduled_at, a.scheduled_at + make_interval(mins=>a.estimated_duration_minutes))
    && tstzrange(b.scheduled_at, b.scheduled_at + make_interval(mins=>b.estimated_duration_minutes))
  where a.origin_type='scheduled' and b.origin_type='scheduled'
    and not a.is_overbooked and not b.is_overbooked
    and a.status not in ('cancelled','no_show') and b.status not in ('cancelled','no_show')
    and a.tenant_id = 'c0810000-0000-4000-8000-00000000000a'
$f$;

select is(pg_temp.d6(), 0, 'D6 is 0 for the fixture clinic before the edge case is planted');

alter table public.visits drop constraint visits_no_double_booking;
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at, estimated_duration_minutes, created_by) values
  ('c0810000-0000-4000-8000-000000002001', 'c0810000-0000-4000-8000-00000000000a', 'c0810000-0000-4000-8000-000000001001',
   'c0810000-0000-4000-8000-000000000102', 'scheduled', 'booked', '2030-02-04 10:00+05:30', 15, 'c0810000-0000-4000-8000-000000000101'),
  ('c0810000-0000-4000-8000-000000002002', 'c0810000-0000-4000-8000-00000000000a', 'c0810000-0000-4000-8000-000000001001',
   'c0810000-0000-4000-8000-000000000102', 'scheduled', 'confirmed', '2030-02-04 10:10+05:30', 15, 'c0810000-0000-4000-8000-000000000101');
select is(pg_temp.d6(), 1, 'D6 finds the planted overlapping pair');

-- The migration's statement, verbatim.
select throws_ok($$
alter table public.visits
    add constraint visits_no_double_booking
    exclude using gist (
        tenant_id with =,
        doctor_id with =,
        public.visit_slot(scheduled_at, estimated_duration_minutes) with &&
    )
    where (
        origin_type = 'scheduled'
        and scheduled_at is not null
        and not is_overbooked
        and status not in ('cancelled', 'no_show')
    )$$, '23P01', null, 'creating the constraint over the overlap fails with 23P01 (it cannot be added NOT VALID)');
select throws_ok($$alter table public.visits add constraint visits_no_double_booking_nv
    exclude using gist (tenant_id with =, doctor_id with =, public.visit_slot(scheduled_at, estimated_duration_minutes) with &&)
    not valid$$, '0A000', null, 'an exclusion constraint cannot be NOT VALID (research Pitfall 2)');
select throws_ok($$alter table public.visits add constraint visits_no_double_booking_inline
    exclude using gist (tenant_id with =, doctor_id with =,
                        tstzrange(scheduled_at, scheduled_at + make_interval(mins => estimated_duration_minutes)) with &&)$$,
  '42P17', null, 'the roadmap''s inline expression is rejected (timestamptz + interval is not IMMUTABLE; R-11)');

-- BACKEND C7 remedy: flag one of the pair as an intentional overbooking.
update public.visits set is_overbooked = true where id = 'c0810000-0000-4000-8000-000000002002';
select is(pg_temp.d6(), 0, 'D6 is 0 once one of the pair is marked is_overbooked');
select lives_ok($$
alter table public.visits
    add constraint visits_no_double_booking
    exclude using gist (
        tenant_id with =,
        doctor_id with =,
        public.visit_slot(scheduled_at, estimated_duration_minutes) with &&
    )
    where (
        origin_type = 'scheduled'
        and scheduled_at is not null
        and not is_overbooked
        and status not in ('cancelled', 'no_show')
    )$$, 'the constraint is created once D6 = 0');
select throws_ok($$update public.visits set is_overbooked = false where id = 'c0810000-0000-4000-8000-000000002002'$$,
  '23P01', null, 'the re-created constraint holds: un-flagging the overbooking is refused');
select is((select convalidated from pg_constraint where conrelid = 'public.visits'::regclass and conname = 'visits_no_double_booking'),
  true, 'the re-created constraint is valid');

select * from finish();
rollback;
