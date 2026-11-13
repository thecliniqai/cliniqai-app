# V2-04 wave notes (orchestrator)

Cross-plan handoffs raised by implementers. Each later plan's implementer must read this file. Each plan commits only
its own rows.

| From | For | Note |
|---|---|---|
| 04-01 | 04-05a / orchestrator | Migration `000031_jobs_queue.sql` is committed (`60e339c`) with `EXPECTED_MIGRATION = "000031"`, the regenerated `scripts/drift/schema-snapshot.txt` and `types/database.ts`. The primary stack was reset with it (04-01 is wave 1's resetter). 04-05a: apply `000032` with `npx supabase migration up --local` (no reset needed), then bump to `000032` and regenerate the snapshot on top of this commit. |
| 04-01 | 04-02 / 04-03a / 04-03b / 04-04 / 04-06 / close | Queue core done (record `04-01-QUEUE.md`): runner RPCs `claim_jobs`/`complete_job`/`fail_job`/`release_job`/`jobs_runner_begin`/`jobs_runner_end` (service_role only), `ops.enqueue_job(kind, tenant, payload, dedupe_key, run_at, max_attempts)` and `ops.reap_jobs()` (no API role). `runJobs` takes the client and config (no env, no `getSystemDb`) and returns `stale`/`released` too. Plan deviations: fairness by a per-tenant LATERAL (the `batch*4` window starved a tenant behind an older backlog), added `release_job`, error codes outside the code shape stored as `invalid_error_code`. Handler codes must be machine words. Close: add the four `tests/jobs/*.spec.ts` to `REQUIRED_FILES`. |
