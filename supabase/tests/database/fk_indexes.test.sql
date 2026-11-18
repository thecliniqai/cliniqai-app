-- fk_indexes.test.sql — V2-05 plan 05-08 step 5 (P2-08 FK part; research "FKs without a supporting index"; risk K-2).
-- Catalogue loop: every foreign key in the app schemas (public, ops, private, authz, and the billing/platform schemas
-- once 05b creates them) has a non-partial index whose first N key columns are exactly the FK's N columns, in any
-- order. A new FK without one fails here with its name. Before 05-08: 31 FKs in public (actor and doctor references to
-- auth.users, referrals.target_tenant_id) had none.
begin;
select plan(4);

create temp view c084_fks as
select n.nspname as schema, c.conrelid::regclass::text as tbl, c.conname, c.conrelid, c.conkey
  from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  join pg_namespace n on n.oid = r.relnamespace
 where c.contype = 'f'
   and n.nspname in ('public', 'ops', 'private', 'authz', 'billing_internal', 'platform');

create temp view c084_uncovered as
select f.schema || '.' || f.conname as fk
  from c084_fks f
 where not exists (
   select 1
     from pg_index i
    where i.indrelid = f.conrelid
      and i.indpred is null
      and i.indnkeyatts >= cardinality(f.conkey)
      and (select array_agg(k order by k) from unnest((string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(f.conkey)]) k)
        = (select array_agg(k order by k) from unnest(f.conkey) k)
 );

select cmp_ok((select count(*)::int from c084_fks), '>=', 100, 'the loop sees the app schemas'' foreign keys (sanity)');
select is_empty($$ select fk from c084_uncovered $$, 'every foreign key has an index whose leading columns are its columns');
select ok(
  exists (select 1 from pg_index i where i.indrelid = 'public.visits'::regclass and i.indpred is null
             and (string_to_array(i.indkey::text, ' ')::int2[])[1] =
                 (select attnum from pg_attribute where attrelid = 'public.visits'::regclass and attname = 'doctor_id')),
  'visits.doctor_id -> auth.users is covered by an index leading with doctor_id');

-- The check really detects a gap: a probe FK without an index is reported.
create table public.c084_probe (id uuid primary key, actor uuid references auth.users (id));
select is(
  (select array_agg(fk) from c084_uncovered where fk like 'public.c084_probe%'),
  array['public.c084_probe_actor_fkey'], 'a new FK without its index is reported by name');

select * from finish();
rollback;
