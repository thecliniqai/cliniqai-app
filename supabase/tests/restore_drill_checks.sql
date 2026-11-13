-- Restore-drill checks (V2-04 04-05a, FT-02, ruling R-11): run against a database just restored from a backup archive
-- by ops/restore-drill/run.sh, and against the primary local stack by tests/ops/restore-drill-checks-db.spec.ts.
-- 04-07c: also proves the runbook's schedule re-creation (ops.ensure_schedules(), migration 000042) on the restore.
-- V2-05 (05-01) replaces this file with its generated pgTAP RLS matrix.
--
-- psql variables (manifest-derived; the drill passes them from manifest-guard.ts's validated copy, the spec computes them
-- live; pass -v ON_ERROR_STOP=1 as well):
--   expected_policies   count of pg_policies in public + storage
--   expected_functions  count of non-extension functions in public, private, ops
--   expected_users      count of auth.users rows
--
-- 04-07e (N-2b): the drill runs this file through ops/bin/psql-restricted.sh, so it holds no psql meta-command (not
-- even set or gset; no backslash at all), and every variable is used quoted (`:'name'`): psql escapes a quoted value
-- as one literal and never re-lexes it, so a value can only fail its ::int cast, never start a meta-command or end the
-- literal early.
--
-- Everything runs inside BEGIN … ROLLBACK: the probe clinic and patient inserted below never persist. finish(true)
-- raises when any test failed, so psql (ON_ERROR_STOP) exits non-zero and the drill fails. Output is TAP with counts
-- and table names only (no row data).
set standard_conforming_strings = on;
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(13);

-- 1. RLS is on for every public table (the failing table names are listed in the diagnostics).
select is_empty(
  $$ select c.relname::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
      order by 1 $$,
  'RLS is enabled on every public table'
);

-- 2-4. The restored policy, function and user counts equal the manifest.
select is(
  (select count(*)::int from pg_policies where schemaname in ('public', 'storage')),
  :'expected_policies'::int,
  'policy count (public, storage) equals the manifest'
);
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private', 'ops')
      and not exists (select 1 from pg_depend d
                       where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')),
  :'expected_functions'::int,
  'function count (public, private, ops) equals the manifest'
);
select is((select count(*)::int from auth.users), :'expected_users'::int, 'auth.users count equals the manifest');

-- 5-6. No schedule and no queued outbound HTTP request came back with the data (research pitfall 8, T-04-13): a drill
-- stack must never call the environment the dump came from.
select is(
  case when to_regclass('cron.job') is null then 0
       else (xpath('/row/c/text()', query_to_xml('select count(*) as c from cron.job', false, true, '')))[1]::text::int
  end,
  0,
  'cron.job is empty'
);
select is(
  case when to_regclass('net.http_request_queue') is null then 0
       else (xpath('/row/c/text()', query_to_xml('select count(*) as c from net.http_request_queue', false, true, '')))[1]::text::int
  end,
  0,
  'net.http_request_queue is empty'
);

-- 7-9. The real-restore path re-creates the schedules (04-07c, M-RESTORE; runbook backup-restore.md §8 step 4): on the
-- restored database ops.ensure_schedules() yields exactly the migrations' nine pg_cron jobs, `jobs-kick` inactive until
-- the pending-jobs review. Rolled back with everything else, so the drill stack still never schedules anything.
select lives_ok('select ops.ensure_schedules()', 'ops.ensure_schedules() runs on the restored database');
select is(
  (select array_agg(jobname::text order by jobname) from cron.job),
  array['cron-history-cleanup', 'delivery-reap', 'jobs-kick', 'jobs-reap', 'ops-cleanup', 'ops-evaluate-alerts',
        'ops-heartbeat', 'ops-quota-snapshot', 'ops-quota-weekly-summary']::text[],
  'the restore re-creates the expected pg_cron schedule set'
);
select is(
  (select array_agg(jobname::text order by jobname) from cron.job where not active),
  array['jobs-kick']::text[],
  'jobs-kick is re-created inactive (pending jobs reviewed first); every other schedule is active'
);

-- 10-13. Tenant isolation probe: a restored member U of clinic A must see none of a second clinic B's rows.
select isnt_empty(
  $$ select 1 from public.memberships m join auth.users u on u.id = m.user_id $$,
  'a restored membership exists to probe tenant isolation'
);
-- The probe ids live in transaction-local settings (rolled back with everything else), not in psql variables, and are
-- set inside a DO block so that no id is printed.
do $$
declare
  r record;
begin
  select m.user_id, m.tenant_id into r
    from public.memberships m join auth.users u on u.id = m.user_id
   order by m.created_at, m.id
   limit 1;
  if found then
    perform set_config('restore_drill.probe_user', r.user_id::text, true),
            set_config('restore_drill.probe_tenant', r.tenant_id::text, true),
            set_config('restore_drill.probe_tenant_b', gen_random_uuid()::text, true);
  end if;
end $$;

insert into public.tenants (id, name)
values (current_setting('restore_drill.probe_tenant_b')::uuid, 'Restore drill probe clinic');
insert into public.patients (tenant_id, full_name, phone, created_by)
values (current_setting('restore_drill.probe_tenant_b')::uuid, 'Restore Drill Probe', '+910000000000',
        current_setting('restore_drill.probe_user')::uuid);

select is(
  (select count(*)::int from public.patients where tenant_id = current_setting('restore_drill.probe_tenant_b')::uuid),
  1,
  'the probe clinic holds one synthetic patient (seen as postgres)'
);

set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', current_setting('restore_drill.probe_user'), 'role', 'authenticated')::text,
                     true);
end $$;

select isnt_empty(
  format('select 1 from public.tenants where id = %L', current_setting('restore_drill.probe_tenant')),
  'the probe member sees its own clinic (claims applied)'
);
select is_empty(
  format(
    $$ with tenant_tables as materialized (
         select c.oid::regclass as rel
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
          where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
            and has_table_privilege(c.oid, 'SELECT'))
       select rel::text
         from tenant_tables
        where (xpath('/row/c/text()',
                     query_to_xml(format('select count(*) as c from %%s where tenant_id = %%L', rel, %L::uuid),
                                  false, true, '')))[1]::text::int > 0
        order by 1 $$,
    current_setting('restore_drill.probe_tenant_b')),
  'no table with a tenant_id shows the probe member a row of another clinic'
);

select * from finish(true);
rollback;
