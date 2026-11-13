-- Restore-drill row counts (V2-04 04-07e, adversarial re-check N-2b). Run by ops/restore-drill/run.sh (drill_counts in
-- drill-lib.sh) through ops/bin/psql-restricted.sh against the drill stack, after the restore.
--
-- psql variable:
--   tables   JSON array of "schema.table" keys from the manifest, already validated by manifest-guard.ts
--
-- The SQL text is fixed: the archive-derived keys enter only as one quoted literal (`:'tables'`, escaped by psql and
-- never re-lexed), are matched against the restored catalog by name, and each count query is built with
-- format('%I.%I') from the catalog's own names. A key with no table in the catalog yields no row, which
-- compare-manifest.ts reports as "missing after restore". Output: one `schema.table<TAB>count` line per table.
-- No psql meta-command: the session is restricted.
set standard_conforming_strings = on;

select k.key,
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
  from jsonb_array_elements_text(:'tables'::jsonb) as k(key)
  join pg_catalog.pg_namespace n on n.nspname = split_part(k.key, '.', 1)
  join pg_catalog.pg_class c on c.relnamespace = n.oid
                            and c.relname = split_part(k.key, '.', 2)
                            and c.relkind in ('r', 'p')
 where k.key ~ '^[a-z_][a-z0-9_]{0,62}\.[a-z_][a-z0-9_]{0,62}$'
 order by 1;
