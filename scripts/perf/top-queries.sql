-- top-queries.sql: the database's heaviest statements, from pg_stat_statements (V2-09e 09E-02, R-20, step 3).
--
-- READ ONLY: one SELECT, no reset. The product owner runs it in the Supabase SQL editor on staging (agents never connect to staging);
-- `npm run perf:db-top` runs the same SELECT against the LOCAL stack. Statement text is normalised by Postgres ($1, $2 for literals).
--
-- Per statement: how often it ran, rows returned, mean and max milliseconds, total milliseconds, and its rank by total time and by
-- mean time. Only statements in the top 25 of either ranking are listed (`ranked_by` says which; a statement in both is listed once with
-- both ranks). To measure one run on staging, ask the PO to reset first (`select extensions.pg_stat_statements_reset();`) in the editor.
with s as (
  select
    left(regexp_replace(query, '\s+', ' ', 'g'), 400) as query,
    calls,
    rows,
    round(mean_exec_time::numeric, 2) as mean_ms,
    round(max_exec_time::numeric, 2) as max_ms,
    round(total_exec_time::numeric, 2) as total_ms,
    row_number() over (order by total_exec_time desc) as rank_total,
    row_number() over (order by mean_exec_time desc) as rank_mean
  from extensions.pg_stat_statements
  where dbid = (select oid from pg_database where datname = current_database())
    and query not ilike '%pg_stat_statements%'
)
select rank_total, rank_mean, query, calls, rows, mean_ms, max_ms, total_ms
from s
where rank_total <= 25 or rank_mean <= 25
order by least(rank_total, rank_mean), rank_total;
