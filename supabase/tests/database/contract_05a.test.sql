-- contract_05a.test.sql — V2-05 plan 05-b0 (expand → migrate → contract; R-2, R-37; P1-40; 05a triage "link_url
-- VALIDATE → 05-b0"; 05-02c wave note "legacy helpers: drop candidates for 05-b0"). Migration 000079_contract_05a.
-- The contract steps of 05a are in force:
--   1. the six clinical columns are gone from `visits` (their content lives in `clinical_notes` since 000053) and so is
--      the 000053 "moved" CHECK that guarded them; the content columns still exist on `clinical_notes`;
--   2. `generate_daily_queue_token` (MAX()+1, replaced by the counter in 000064 and by `issue_queue_token` in 000068) and
--      the two legacy "any membership" helpers `current_user_has_role` / `current_user_is_admin_or_owner` (no caller
--      since 000061) are dropped; the member helper `current_user_tenant_ids` and `issue_queue_token` stay;
--   3. `in_app_notifications_link_url_relative` is VALID (after diagnostic D11n = 0) and still refuses an off-site link.
-- Synthetic data only; the file rolls back.
begin;
select plan(18);

-- 1. -----------------------------------------------------------------------------------------------------------------
select hasnt_column('public', 'visits', 'vitals', 'visits.vitals is dropped (05-b0)');
select hasnt_column('public', 'visits', 'chief_complaints', 'visits.chief_complaints is dropped (05-b0)');
select hasnt_column('public', 'visits', 'clinical_notes', 'visits.clinical_notes is dropped (05-b0)');
select hasnt_column('public', 'visits', 'specialty_data', 'visits.specialty_data is dropped (05-b0)');
select hasnt_column('public', 'visits', 'investigations_advised', 'visits.investigations_advised is dropped (05-b0)');
select hasnt_column('public', 'visits', 'advice', 'visits.advice is dropped (05-b0)');
select is_empty(
  $$ select conname from pg_constraint where conrelid = 'public.visits'::regclass and conname = 'visits_clinical_content_moved' $$,
  'the 000053 "moved" CHECK is dropped with the columns it guarded');
select is(
  (select array_agg(column_name::text order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'clinical_notes'
      and column_name in ('vitals', 'chief_complaints', 'clinical_notes', 'specialty_data', 'investigations_advised', 'advice')),
  array['advice', 'chief_complaints', 'clinical_notes', 'investigations_advised', 'specialty_data', 'vitals'],
  'the six content columns live on clinical_notes');

-- 2. -----------------------------------------------------------------------------------------------------------------
select hasnt_function('public', 'generate_daily_queue_token', array['uuid', 'date'],
  'generate_daily_queue_token(uuid, date) is dropped (P1-40; replaced by issue_queue_token)');
select hasnt_function('public', 'current_user_has_role', array['uuid', 'text[]'],
  'the legacy helper current_user_has_role(uuid, text[]) is dropped');
select hasnt_function('public', 'current_user_is_admin_or_owner', array['uuid'],
  'the legacy helper current_user_is_admin_or_owner(uuid) is dropped');
select is_empty(
  $$ select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.proname in ('generate_daily_queue_token', 'current_user_has_role', 'current_user_is_admin_or_owner') $$,
  'no overload of a dropped function is left in any schema');
select has_function('public', 'issue_queue_token', array['uuid', 'text'], 'the replacement issue_queue_token(uuid, text) stays');
select has_function('public', 'current_user_tenant_ids', 'the member helper current_user_tenant_ids() stays (R-42)');

-- 3. -----------------------------------------------------------------------------------------------------------------
select is(
  (select convalidated from pg_constraint
    where conrelid = 'public.in_app_notifications'::regclass and conname = 'in_app_notifications_link_url_relative'),
  true, 'in_app_notifications_link_url_relative is VALID (VALIDATE after D11n, 05a triage)');

insert into public.tenants (id, name) values ('c0790000-0000-4000-8000-00000000000a', 'Synthetic 000079 Clinic');
select throws_ok(
  $$insert into public.in_app_notifications (tenant_id, category, event_type, title, message, link_url)
    values ('c0790000-0000-4000-8000-00000000000a', 'system', 'synthetic.probe', 'Synthetic', 'Synthetic', '//evil.example')$$,
  '23514', null, 'a protocol-relative link is still refused');
select lives_ok(
  $$insert into public.in_app_notifications (tenant_id, category, event_type, title, message, link_url)
    values ('c0790000-0000-4000-8000-00000000000a', 'system', 'synthetic.probe', 'Synthetic', 'Synthetic', '/patients')$$,
  'an in-app path is still accepted');
select is(
  (select count(*)::int from public.in_app_notifications
    where link_url is not null and link_url !~ '^/([^/\\[:cntrl:][:space:]][^[:cntrl:][:space:]]*)?$'),
  0, 'D11n is 0 after the VALIDATE (no stored link the check refuses)');

select * from finish();
rollback;
