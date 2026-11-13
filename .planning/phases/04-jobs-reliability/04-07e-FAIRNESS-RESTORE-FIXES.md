---
phase: 04
plan: 04-07e
subsystem: job queue fairness through the real runner, restore/drill psql sessions and manifest, restore SQL guard
status: complete
plan_head_before: 3947174
---

# 04-07e record: fairness and restore follow-ups (N-1b, N-2b, L-D, L-E, L-F)

**Outcome:** both Mediums and the three Lows of `reviews/v204-review-n1-n2-recheck.md` are fixed, each with a test
that fails without it (negative proofs in `evidence/04-07e/`). Local stack only: every Supabase CLI call `--local`, no
`--linked`, no `db push`, no hosted call, no `.env*` read. Every shell command in an N-2b value is a harmless `echo`
inside a throwaway psql container. Base `3947174`. Commits: `cc53d91` (N-1b, migration 000045), `918397f` (N-2b),
`aee46aa` (Lows), then the docs commit with this record.

## Triage ID → commit → test

| ID | Fix | Commit | Test (fails without the fix) |
|---|---|---|---|
| **N-1b** (Medium; M-FAIR/N-1) | Migration **000045**. (a) A hand-back is not service: every claim keeps the row's previous `last_claimed_at` in the new `ops.jobs.prev_last_claimed_at`; `release_job`, and `defer_job` for a job that never started, put it back. A re-claim of a row whose lease expired before it started keeps the older value too. A started job keeps its stamp (it was served). (b) `claim_jobs` returns `claim_order`, its fair order (round 1 of the round-robin first; within a round least recently served tenant first, then oldest work), and returns the rows in that order. `fairOrder` (`lib/jobs/internal/claim.ts`) starts the batch in `claim_order` instead of re-sorting it by oldest work, which put the tenant with the newest work last and so handed it back pass after pass. Without positions (a database before 000045) it falls back to round-robin in arrival order. The function is dropped and created again (return type gained a column) with the same grants; arguments, `FOR UPDATE SKIP LOCKED`, per-tenant cap and tenant choice are unchanged. `EXPECTED_MIGRATION = "000045"`, snapshot regenerated after `db reset --local` under the run lock, `npm run db:types` (`claim_order`). | `cc53d91` | `parallel-dispatch-db.spec.ts` "hand-backs and batch order through the real runner": (1) the re-checker's probe #8: real `runJobs` passes with `RUN_PASS_CONFIG`, message.send's 12 s bound and 1.5 s per job (8 run, 2 handed back per pass), 10 tenants × 40 jobs + a victim → the victim runs within **2 passes** (with the 04-07b batch order: never in 30); (2) the same at 1.0 s per job; (3) `release_job` restores the stamp, a started + deferred job keeps it; (4) `claim_order` 1..n with a never-served tenant first. The original 10+1 SQL-level case, the 23-tenant bound, the 04-07d runner case and both exactly-once concurrency cases (8 runners × 200 jobs; 8 runners × 200 real message sends) pass unchanged. `runner.spec.ts`: `fairOrder` follows `claim_order`; fallback. `evidence/04-07e/n1b-negative-proof.txt`. |
| **N-2b** (Medium; M-BACKUPAUTH/N-2) | **Every ops/\*\* psql session is restricted.** The drill's restore, counts, checks and self-test queries (new `ops/restore-drill/drill-lib.sh`, sourced by `run.sh`) and `backup.sh` all go through `ops/bin/psql-restricted.sh`; nothing in ops/\*\* calls `psql-docker.sh` directly any more. The wrapper now also forces `standard_conforming_strings = on` and client encoding UTF8: `PGCLIENTENCODING=UTF8`, explicit `SET`s right after `\restrict` (a session SET overrides `ALTER ROLE/DATABASE … SET`), and `PGOPTIONS='-c standard_conforming_strings=on'` on loopback targets. It is always quiet and refuses a call without `-c`/`-f`. **Manifest values are validated and passed quoted.** New `ops/restore-drill/manifest-guard.ts` validates every field the drill reads (counts integers 0..999 999 999; table keys `schema.table` with each part `^[a-z_][a-z0-9_]{0,62}$` and the schema in the dumped-schema allow-list; digests 64 hex; bucket ids and object names; ISO timestamps, versions, environment; no unknown field) and writes a validated copy; `run.sh` reads only that copy. The counts step is a fixed `ops/restore-drill/counts.sql`: keys enter as one quoted variable (`:'tables'`), are matched against the restored catalog (a missing table yields no row, reported by `compare-manifest.ts`), and each count is built with `format('%I.%I')`. `restore_drill_checks.sql` holds no meta-command (DO blocks instead of `\gset`, no `\set`) and uses `:'expected_*'::int`; `drill_checks` also refuses a count that is not digits before psql runs. Runbook §7/§8 and the AWS go-live buildspec embed list updated. | `918397f` | `drill-lib-db.spec.ts` (real drill steps, real psql 17.11, local stack): route 1, the re-checker's count `1 \! echo …` (and a newline variant) → one literal that fails its cast, no echo; route 2, a hostile table key against a scratch database with `ALTER DATABASE … SET standard_conforming_strings = off` → the session reports `on|UTF8`, the key is only a name, no echo; the checks file passes 13/13 restricted and prints no id; `drill_counts` counts real tables and refuses unvalidated keys; the wrapper refuses a stdin-only call. `manifest-guard.spec.ts` (22 cases). `restore-guards.spec.ts`: `run.sh` refuses an archive whose manifest holds both routes before the SQL guard and before the drill stack starts. `evidence/04-07e/n2b-negative-proof.txt`: with the 04-07d drill step psql **ran** the route-1 command; the 04-07d counts step **ran** the route-2 command on the setting-off database (`COUNTS_SQL_EXECUTED`); the 04-07d wrapper gives an `off` session and ignores stdin. |
| **L-D** (Low) | `sql-guard.ts`: a dollar quote directly after a digit (`1$a$`) is refused. Whether the digit ends a number (psql opens a quote) or continues an identifier (it does not) is a distinction the guard does not make, so it refuses the shape; pg_dump does not write it outside function bodies. | `aee46aa` | `restore-guards.spec.ts` "dollar quotes after a digit, U& spellings, …": the re-checker's file and a `2$$` variant. `evidence/04-07e/lows-negative-proof.txt`. |
| **L-E** (Low) | `U&'…'` / `U&"…"` refused; any `set_config(…)` outside a function body other than pg_dump's own `SELECT pg_catalog.set_config('search_path', '', false);` refused (also by a quoted function name, across lines); `SET [SESSION|LOCAL] NAMES` refused (another spelling of `client_encoding`, not in the review). | `aee46aa` | Same describe: `SET U&"…\005f…"`, `ALTER ROLE … SET U&"…"`, the `client_encoding` spelling, a `U&'…'` string, `set_config` with a concatenated name, by quoted name, across lines, `SET NAMES`, `SET SESSION NAMES`. |
| **L-F** (Low) | A comment now separates words in the COPY checks, as in psql's lexer: `COPY(…) TO PROGRAM`, `COPY/**/t FROM PROGRAM`, `TO/* c */PROGRAM` refused, and `COPY/**/t FROM stdin` is read as COPY data. The primary control is server-side: the restore connects as `postgres`, which is not superuser, is not a member of `pg_execute_server_program` and cannot grant it. | `aee46aa`, `918397f` | Same describe (3 spellings). `drill-lib-db.spec.ts` "the restore role cannot run COPY … PROGRAM": `COPY (…) TO PROGRAM` refused (both quoting forms), `GRANT pg_execute_server_program TO postgres` refused ("only superusers can grant them"). |

## Decisions and deviations

- **N-1b: restore the stamp, not stamp at start.** The review offered either. Stamping only at `start_job` would leave
  concurrent claimers with no rotation signal until a job starts, and every SQL-level path that finishes a job
  without `start_job` (unknown kind, invalid payload) would stop counting as a claim. Keeping the claim stamp and
  restoring it on a hand-back changes nothing else, and the 04-07d SQL-level specs pass unchanged. A runner that
  crashes after claiming leaves its unstarted jobs stamped until the lease expires (the re-claim then keeps the older
  value). That costs at most one rotation turn per crash.
- **N-1b: both parts are needed.** `n1b-negative-proof.txt`: with the 000045 SQL but the 04-07b `fairOrder`, probe
  #8 still never ran the victim: the restore kept it never-served, so the SQL chose it at every claim, but the runner
  moved it to the end of the batch, where it was handed back each time. With the new `fairOrder` but the 000044 SQL, the runner-level probe passes
  through the arrival-order fallback, but the restore and `claim_order` tests fail. The restore is the guarantee that
  a hand-back costs no turn, whatever the order a future runner uses.
- **N-2b: PGOPTIONS only on loopback targets.** Supabase's poolers (the session pooler is the backup and real-restore
  URL) are not known to pass startup options through, and this cannot be tested locally. The explicit session `SET`
  right after `\restrict` covers every target. It runs before any caller SQL and overrides role and database settings,
  so PGOPTIONS adds nothing there. A login event trigger could flip the setting at connect, but creating one needs
  superuser. On the drill and local stacks both are in place.
- **N-2b: backup.sh is restricted too** (the task: every ops/\*\* psql). It runs only fixed SQL against the source
  database, so restricted mode costs nothing. Its heredocs now pass `-f -`: the wrapper adds `-c`, and with any `-c`
  psql reads no stdin. The wrapper refuses a call without `-c`/`-f`, because otherwise such a call silently does
  nothing (`storage_policies.sql` would be empty). The CodeBuild go-live design must embed `psql-restricted.sh` too
  (doc updated).
- **N-2b: schema allow-list.** The validator allows only the schemas a Supabase data dump carries: public, private,
  ops, auth, storage, realtime, vault, supabase_functions, supabase_migrations, extensions, graphql, pgsodium. The real
  local dump has 91 tables, all inside it (self-test). A new schema with data needs an entry there; until then the
  drill refuses the archive, which fails closed.
- **N-2b: object names with a backslash or a control character are refused.** The app's object names are ids and
  plain file names. A bucket holding such a name would fail the drill closed until the guard is widened.
- **L-E: `ALTER ROLE … SET` is not refused outright.** pg_dump's role dump writes `ALTER ROLE "anon" SET
  "statement_timeout" …` and similar lines. Those that name either setting are still refused, and so is any `U&`
  spelling of them.

## Residual (documented; controls named)

- **Settings changed by server-side code** stay invisible to any text scan. Examples: a function body, `EXECUTE` of a
  string built from pieces, `DO … ALTER ROLE … SET %I`. A spec asserts that the guard passes such a file, so the
  reliance stays visible. The controls are elsewhere:
  - inside the restore session, restricted mode refuses every meta-command whatever the lexer state (04-07d);
  - in every later session, `psql-restricted.sh` forces the setting on, and archive values reach SQL only quoted.
- **`COPY … PROGRAM` built dynamically** (`EXECUTE 'COPY … PROGRAM …'`) cannot be seen by the guard. The restore role
  lacks `pg_execute_server_program` and cannot grant it (asserted). A future restore target whose connecting role
  holds it would lose this control. The runbook restores as the project's `postgres`, which does not hold it.

## Verification (tool output in `evidence/04-07e/`)

- Negative proofs:
  - `n1b-negative-proof.txt` (probe #8 fails with the 04-07b order; the restore and `claim_order` fail on 000044);
  - `n2b-negative-proof.txt` (route 1 executed on the 04-07d drill step; route 2 executed by the 04-07d counts step;
    the 04-07d wrapper gives an `off` session; `run.sh` without the manifest guard does not refuse);
  - `lows-negative-proof.txt` (15 of 17 fail on the 04-07d guard).
- `restore-drill-selftest-run.txt`, `restore-drill-selftest.json`: `ops/restore-drill/run.sh --self-test` on this tree.
  The real local backup (through the restricted `backup.sh`) passes the manifest guard (91 tables, 3 buckets) and the
  SQL guard (6 files, copies written). It restores through restricted psql into the drill stack and passes
  compare-manifest, the 13 pgTAP checks (restricted) and `check-evidence`.
- `vitest-full.txt`: full `npx vitest run` on `aee46aa`, **211 files, 4397 passed, 0 failed** (first run, nothing
  retried).
- `e2e-pr.txt`: `npm run e2e:build` then `npm run e2e:pr` on `aee46aa`, **196 passed, 9 skipped, 0 failed, 0 retries**.
  The server's `ECONNRESET: aborted` lines come from requests the client aborted during navigation, logged by the web
  server. They are not test results.
- `static.txt`: `npm run typecheck` exit 0; `npx eslint .` 0 errors (382 warnings, as in 04-07d, none on lines this plan
  added); `npm run inventory` exit 0 (0 flagged); `schema-snapshot.mjs --local --check` PASS (2520 lines).
- `gitleaks.txt`: gitleaks docker scan of the history after the 04-07e commits.
- Local stack left clean: the `db reset --local` for 000045 also removed the re-checker's leftover `backup_stale` alert
  and its notify job. After the final self-test: no open alert, no pending or running job, 1 tenant and 5 auth users
  (the seed), and all 9 cron jobs active.

## Not changed (owner)

- `jobs_tenant_id` (single-column index) is still redundant with `jobs_tenant_last_claimed_at`; contract migration,
  V2-14 (as in 04-07d).
- `scripts/ops/ops-report.mjs` and `scripts/drift/*` run psql outside ops/\*\* against our own databases with fixed
  SQL. They are unchanged: no archive input reaches them.
