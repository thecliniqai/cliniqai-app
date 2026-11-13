# 04-01 Job queue core: `ops.jobs`, claim / lease / fencing / reaper, runner library

Plan: `04-PLAN.md` §04-01 (P0-12, ADR-009, TARGET_ARCHITECTURE §8, R-7, R-22). Wave 1, stack resetter of the wave.
Branch `v2/phase-04-jobs-reliability`; pre-plan HEAD `118b3ae`.

## What shipped

| Commit | What |
|---|---|
| `60e339c` | `supabase/migrations/000031_jobs_queue.sql` + `EXPECTED_MIGRATION = "000031"` + regenerated `scripts/drift/schema-snapshot.txt` + `types/database.ts` (one commit, R-45) |
| `db06f32` | `04-WAVE-NOTES.md` row for 04-05a (migration committed, apply 000032 with `migration up --local`) |
| `63b18ba` | `lib/jobs/internal/{types,claim,runner}.ts` |
| `8907737` | `tests/jobs/{helpers.ts, claim-grants-db, parallel-dispatch-db, reaper-db, runner}.spec.ts` + negative-proof evidence |

### Migration 000031 (SQL objects)

- `ops.jobs` as specified (TARGET §8 names, R-22): `dedupe_key text NOT NULL UNIQUE` (R-7), `kind` pattern + ≤ 64,
  payload ≤ 4096 bytes, `max_attempts` 1..20, `last_error` ≤ 500, the four indexes. RLS on, no policy; `REVOKE ALL`
  from `PUBLIC, anon, authenticated, service_role`; `ops` stays without USAGE for any API role.
- `ops.job_runner_runs` (counts, `ok`, `error_code` only), same lockdown, index on `started_at` for the 04-04 alert.
- `ops.enqueue_job` (insert or return the existing id for the key), `ops.reap_jobs()`, `ops.job_error_code(text)`:
  no API role may execute them.
- `public.claim_jobs`, `complete_job`, `fail_job`, `release_job`, `jobs_runner_begin`, `jobs_runner_end`: SECURITY
  DEFINER, `search_path = ''`, EXECUTE for `service_role` only. Writers carry `SET lock_timeout = '2s'` (03-07 finding
  3: no function-level `statement_timeout`). Bad arguments raise `22023` with a fixed word; no `P0001` reason is
  raised (these RPCs are runner-internal, never mapped by `lib/db/errors.ts`, so no `RPC_REASON_CODES` entry).

### Claim, lease, fencing (how exactly-once holds in normal operation)

1. `claim_jobs` locks due rows with `FOR UPDATE OF j SKIP LOCKED`; the due condition is repeated inside the locking
   subquery, so a row another runner claimed and committed after this statement's snapshot is re-checked on its new
   version (READ COMMITTED EvalPlanQual) and skipped. Each claimed row gets `attempts + 1`, a fresh `lease_token` and
   `locked_until = now() + lease`.
2. `complete_job` / `fail_job` / `release_job` change a row only `WHERE id = … AND lease_token = … AND status =
   'running'`. A runner whose lease expired and whose row was re-claimed gets `false` / `stale` and changes nothing.
3. An expired lease with attempts left is simply claimable again (re-claim stamps `last_lease_expired_at`);
   `ops.reap_jobs()` dead-letters expired leases with no attempts left (`lease_expired`). pg_cron schedules it in 04-02.
4. Backoff: `30 s · 2^(attempt-1) · [0.5, 1]`, capped at 6 h; a handler's `retryAt` is honoured, capped at 1 day.

### Runner (`lib/jobs/internal/runner.ts`)

`runJobs({ db, budgetMs, batch, leaseSeconds, perTenant, worker, source, kinds, handlers, now? })` →
`{ claimed, done, retried, dead, stale, released, durationMs }`. Claims only kinds whose handler fits the remaining
budget (`maxDurationMs + 1 s`) and sizes the claim to `floor(remaining / worst cost)`; a claimed job the budget no
longer covers is released unstarted. Unknown kind → dead `unknown_kind`; zod failure → dead `invalid_payload`; throw →
retry with `errorTag(err)`; outliving `maxDurationMs` → retry `handler_timeout` (the handler's `ctx.signal` aborts).
Codes pass `jobErrorCode` (≤ 64 of `[A-Za-z0-9_.:-]`, no 6+ digit run, else `error`) and the database re-checks with
`ops.job_error_code` (else `invalid_error_code`). One `jobs.run.completed` log line (count, durationMs) and, on a
failed queue RPC, one `jobs.run.failed` (code). No env reads, no `getSystemDb`, no payload or kind in logs.

## Deviations from the plan (all Rule 1/2, inside this plan's own files)

| # | Plan said | Done | Why |
|---|---|---|---|
| D1 | Fairness: CTE `locked` takes the first `p_batch * 4` due rows by `run_at`, then `row_number() … <= p_per_tenant` | `due_tenants` (the ≤ `p_batch` tenants with the oldest due work, GROUP BY) `CROSS JOIN LATERAL` (≤ `p_per_tenant` rows each, `FOR UPDATE SKIP LOCKED`), then the oldest `p_batch` | With the window, a tenant whose backlog is older than everyone else's fills all `4 · batch` rows: the claim returns only `per_tenant` rows of that tenant and the others starve (TARGET §8: "no tenant can starve others"). The plan's own fairness case fails with the window when A's 100 jobs are older than B's 5; the spec makes A older on purpose. Cost: one GROUP BY over the due rows per claim (small queues on Free; indexed). Pitfall 4 still holds: no window function next to `FOR UPDATE` |
| D2 | five RPCs | + `public.release_job(id, token)` | "never starts a job when the remaining budget is below `maxDurationMs + 1000`": without a release, a claimed-but-unstarted job would sit leased until expiry and burn an attempt (could dead-letter work that never ran). Fenced like the others; service_role only; covered in `reaper-db` and `runner` specs |
| D3 | `last_error = left(p_error_code, 500)` | `ops.job_error_code()`: a code outside `^[A-Za-z0-9_.:-]{1,64}$` or with a 6+ digit run is stored as `invalid_error_code` | T-04-10 defence in depth: a handler bug can never put a phone or message into `last_error` (spec seeds a synthetic phone) |
| D4 | `ops.jobs` columns | + `CHECK jsonb_typeof(payload) = 'object'`, `attempts >= 0`, `dedupe_key` length ≥ 1, `jobs_running_has_lease` | Invariants the runner relies on; additive |
| D5 | result `{ claimed, done, retried, dead, durationMs }` | + `stale`, `released` | Fencing refusals and releases are visible to the caller (04-02 route) instead of silently dropped |

## Tests (fail without the change)

All four files are new; without migration 000031 every DB case fails (no `claim_jobs`/`ops.jobs`), and without
`lib/jobs/internal/**` none compiles.

- `tests/jobs/parallel-dispatch-db.spec.ts` (3): tracer (one SQL-enqueued job → `done`, `attempts = 1`); 8 parallel
  `runJobs` over 200 jobs in 3 tenants → 200 handled, 200 distinct, all `done` with `attempts = 1`, claimed counts sum
  to 200; fairness (A 100 older jobs, B 5 → 5 + 5).
- `tests/jobs/reaper-db.spec.ts` (10): re-claim after expiry (same id, attempts 2, new token,
  `last_lease_expired_at`); stale token `complete_job` → false and `fail_job` → `stale` with the row unchanged; reaper
  dead-letters only expired leases with no attempts left; backoff in [15 s, 30 s] on attempt 1 (exact, `run_at -
  updated_at`, no sleeps); `retryAt` honoured and capped; last attempt → dead; non-retryable → dead; attempts climb to
  `max_attempts` then dead; free-text code → `invalid_error_code`; `release_job`.
- `tests/jobs/claim-grants-db.spec.ts` (11): anon and a signed-in owner get `42501` from all six RPCs; service role
  succeeds; out-of-range claim args → `22023`; PostgREST serves no `jobs` (`PGRST205` public, `PGRST106` ops); no
  schema/table/sequence privilege for anon/authenticated/service_role; RLS on, 0 policies; dedupe → one row, same id;
  NULL key → `23502` (insert and enqueue); bad kind / non-object / oversize payload → `23514`; every new function
  `prosecdef` + `search_path=""`; public RPCs `false,false,true`, ops functions `false,false,false`.
- `tests/jobs/runner.spec.ts` (9, unit, fake RPC client): unknown kind / invalid payload non-retryable; thrown error
  with a synthetic phone → `fail_job` gets `TypeError` only, phone absent from calls and captured stdout/stderr;
  handler free-text codes replaced; 3 s budget + 5 s handler → no claim, no start; claim sizing + release; outcome
  mapping and `jobs_runner_end` counts; fencing refusal → stale; handler timeout → `handler_timeout`; failed RPC →
  `ok = false` with the code, never the message.

Determinism: no sleeps; time moves by rewriting `locked_until`/`run_at` in SQL; the backoff window is read as
`run_at - updated_at` (one transaction's `now()`); each spec uses job kinds unique to its run, so no other file sees
its rows. The parallel case's assertion is an invariant of the claim, not of the interleaving.

**Negative proofs (tool output, `evidence/04-01/`):** with `FOR UPDATE OF j SKIP LOCKED` removed from `claim_jobs`
the parallel case handles 300 ids for 200 jobs (`negative-claim-without-skip-locked.txt`); with the lease-token
predicate removed from `complete_job` the fencing case fails (`negative-complete-without-fencing.txt`). Both functions
were restored from the migration text afterwards; their `md5(prosrc)` equals the snapshot's `body_md5`.

## Handoffs

- **04-02:** pass `getSystemDb("jobs.run")` as `db`; budget 25 s, lease 120 s (R-17); schedule `ops.reap_jobs()`.
  `runJobs` returns `stale`/`released` too. `RunnerSource` is `pg_cron | manual | test`.
- **04-03a/b:** triggers call `ops.enqueue_job(kind, tenant, payload, dedupe_key, run_at, max_attempts)`; payload is a
  JSON object ≤ 4 KB with ids only; handler codes must be machine words (else stored as `invalid_error_code`).
- **04-04:** `ops.job_runner_runs.started_at` (indexed) for `runner_stale`; `last_lease_expired_at` for
  `lease_expiry`; `status = 'dead'` + `finished_at` for `dead_letter`; `first_claimed_at - run_at` for lag.
- **04-06:** retention for `ops.jobs` (done/cancelled 7 d, dead 30 d) and `ops.job_runner_runs` (14 d) via
  `(status, finished_at)` / `started_at`.
- **Close:** add the four `tests/jobs/*.spec.ts` files to `REQUIRED_FILES`.
