-- clinical_notes_backfill.test.sql — V2-05 plan 05-02a (roadmap V2-05 "migration tests on a copy seeded with the
-- diagnostics' edge cases", clinical-split half; R-2, R-4).
--
-- On this transaction's copy of the schema the 05-02a state is undone (the CHECK dropped, the insert trigger disabled),
-- visits carrying every shape of clinical content are planted as they existed before 000053 (SQL NULL, JSON null,
-- empty and populated values, unicode, long text, arrays with NULL elements), and 000053's backfill, clear and CHECK
-- statements are replayed VERBATIM (pinned byte-identical to the migration by tests/ci/clinical-notes-backfill-inline
-- .spec.ts). The backfill is lossless (every old column equals the new row, coalesced to the new defaults), idempotent,
-- the clear empties every moved column, and the CHECK validates afterwards. Rolled back; synthetic data only.
begin;
select plan(9);

insert into auth.users (id, email) values ('cf100000-0000-4000-8000-000000000101', 'bf-doctor@example.test');
insert into public.tenants (id, name) values ('cf100000-0000-4000-8000-00000000000a', 'Synthetic Backfill Clinic');
insert into public.memberships (user_id, tenant_id, role) values ('cf100000-0000-4000-8000-000000000101', 'cf100000-0000-4000-8000-00000000000a', 'doctor');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values ('cf100000-0000-4000-8000-000000001001', 'cf100000-0000-4000-8000-00000000000a', 'Synthetic Backfill Patient', '+919000000501', 'cf100000-0000-4000-8000-000000000101');

-- Back to the pre-000053 shape of visits for this transaction.
alter table public.visits drop constraint visits_clinical_content_moved;
alter table public.visits disable trigger visits_create_clinical_notes;
delete from public.clinical_notes;

insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, created_by, vitals, chief_complaints, clinical_notes, specialty_data, investigations_advised, advice, created_at, updated_at)
select 'cf100000-0000-4000-8000-00000000000a', 'cf100000-0000-4000-8000-000000001001', 'cf100000-0000-4000-8000-000000000101', 'walk_in', 'cf100000-0000-4000-8000-000000000101',
  case g % 5 when 0 then null when 1 then '{}'::jsonb when 2 then jsonb_build_object('systolic', 100 + g % 60, 'diastolic', 60 + g % 30, 'recorded_by', 'cf100000-0000-4000-8000-000000000101') when 3 then 'null'::jsonb else jsonb_build_object('nested', jsonb_build_object('a', array[g, g + 1])) end,
  case g % 4 when 0 then null when 1 then '[]'::jsonb when 2 then jsonb_build_array(jsonb_build_object('complaint', 'Synthetic complaint ' || g, 'duration', g || ' days')) else 'null'::jsonb end,
  case g % 4 when 0 then null when 1 then '' when 2 then 'Synthetic note ' || g || E'\nline two — unicode ✓ é 漢' else repeat('x', 5000 + g) end,
  case g % 3 when 0 then null when 1 then '{}'::jsonb else jsonb_build_object('pediatrics', jsonb_build_object('weight_percentile', g % 100)) end,
  case g % 3 when 0 then null when 1 then '{}'::text[] else array['CBC', 'Synthetic test ' || g, null] end,
  case g % 3 when 0 then null when 1 then '{}'::text[] else array['Rest', 'Fluids ' || g] end,
  now() - (g || ' hours')::interval,
  now() - (g || ' minutes')::interval
from generate_series(1, 120) g;

create temp table before_backfill on commit drop as
  select id, tenant_id, vitals, chief_complaints, clinical_notes, specialty_data, investigations_advised, advice, created_at, updated_at
    from public.visits;

-- 000053 step 5, verbatim.
INSERT INTO public.clinical_notes
  (visit_id, tenant_id, vitals, chief_complaints, clinical_notes, specialty_data, investigations_advised, advice,
   created_at, updated_at)
SELECT v.id, v.tenant_id,
       COALESCE(v.vitals, '{}'::jsonb),
       COALESCE(v.chief_complaints, '[]'::jsonb),
       v.clinical_notes,
       COALESCE(v.specialty_data, '{}'::jsonb),
       COALESCE(v.investigations_advised, '{}'::text[]),
       COALESCE(v.advice, '{}'::text[]),
       v.created_at,
       COALESCE(v.updated_at, v.created_at)
  FROM public.visits v
ON CONFLICT (visit_id) DO NOTHING;

select is((select count(*)::int from public.clinical_notes), (select count(*)::int from public.visits), 'the backfill creates one clinical_notes row per visit');
select is_empty($$select b.id from before_backfill b left join public.clinical_notes n on n.visit_id = b.id
   where n.visit_id is null
      or n.tenant_id is distinct from b.tenant_id
      or n.vitals is distinct from coalesce(b.vitals, '{}'::jsonb)
      or n.chief_complaints is distinct from coalesce(b.chief_complaints, '[]'::jsonb)
      or n.clinical_notes is distinct from b.clinical_notes
      or n.specialty_data is distinct from coalesce(b.specialty_data, '{}'::jsonb)
      or n.investigations_advised is distinct from coalesce(b.investigations_advised, '{}'::text[])
      or n.advice is distinct from coalesce(b.advice, '{}'::text[])
      or n.created_at is distinct from b.created_at
      or n.updated_at is distinct from coalesce(b.updated_at, b.created_at)$$,
  'lossless: every old column equals its clinical_notes value (coalesced to the new defaults), timestamps kept');
select is((select count(*)::int from public.clinical_notes n join before_backfill b on b.id = n.visit_id
            where b.tenant_id = 'cf100000-0000-4000-8000-00000000000a' and b.clinical_notes is not null and n.clinical_notes = b.clinical_notes), 90,
  'every non-null note (including the empty string and 5 kB texts) is carried as is');
select is((select count(*)::int from public.clinical_notes where tenant_id = 'cf100000-0000-4000-8000-00000000000a' and vitals = 'null'::jsonb), 24, 'a JSON null value is carried as is (not turned into a default)');

-- Idempotent: a second run inserts nothing and changes nothing.
create temp table after_first on commit drop as select * from public.clinical_notes;
INSERT INTO public.clinical_notes
  (visit_id, tenant_id, vitals, chief_complaints, clinical_notes, specialty_data, investigations_advised, advice,
   created_at, updated_at)
SELECT v.id, v.tenant_id,
       COALESCE(v.vitals, '{}'::jsonb),
       COALESCE(v.chief_complaints, '[]'::jsonb),
       v.clinical_notes,
       COALESCE(v.specialty_data, '{}'::jsonb),
       COALESCE(v.investigations_advised, '{}'::text[]),
       COALESCE(v.advice, '{}'::text[]),
       v.created_at,
       COALESCE(v.updated_at, v.created_at)
  FROM public.visits v
ON CONFLICT (visit_id) DO NOTHING;
select set_eq($$select * from public.clinical_notes$$, $$select * from after_first$$, 'running the backfill again changes nothing (idempotent)');

-- 000053 step 6, verbatim.
UPDATE public.visits
   SET vitals = NULL, chief_complaints = NULL, clinical_notes = NULL, specialty_data = NULL,
       investigations_advised = NULL, advice = NULL
 WHERE vitals IS NOT NULL OR chief_complaints IS NOT NULL OR clinical_notes IS NOT NULL
    OR specialty_data IS NOT NULL OR investigations_advised IS NOT NULL OR advice IS NOT NULL;

select is((select count(*)::int from public.visits where vitals is not null or chief_complaints is not null or clinical_notes is not null
            or specialty_data is not null or investigations_advised is not null or advice is not null), 0,
  'the clear empties every moved column on visits');
select set_eq($$select * from public.clinical_notes$$, $$select * from after_first$$, 'the clear leaves the clinical_notes rows untouched');

ALTER TABLE public.visits ADD CONSTRAINT visits_clinical_content_moved CHECK (
      (vitals IS NULL OR vitals = '{}'::jsonb)
  AND (chief_complaints IS NULL OR chief_complaints = '[]'::jsonb)
  AND clinical_notes IS NULL
  AND (specialty_data IS NULL OR specialty_data = '{}'::jsonb)
  AND (investigations_advised IS NULL OR investigations_advised = '{}'::text[])
  AND (advice IS NULL OR advice = '{}'::text[])
);

select ok((select convalidated from pg_constraint where conname = 'visits_clinical_content_moved'), 'the CHECK is added VALID over the cleared rows');
select throws_ok($$update public.visits set clinical_notes = 'Synthetic' where tenant_id = 'cf100000-0000-4000-8000-00000000000a'$$, '23514', null,
  'after the replay, clinical text cannot be written into visits');

select * from finish();
rollback;
