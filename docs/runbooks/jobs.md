# Runbook: background jobs and the scheduler

V2-04 plan 04-02 (P0-12, C22, RL-23). Rulings R-12, R-17, R-18, R-21, R-32, R-34, R-49 (supersedes R-16's revoke clause). Threats T-04-01, T-04-02,
T-04-18, T-04-20. Later plans add their sections (04-03a message sends, 04-03b webhook delivery, 04-03c inbound
idempotency, 04-04 alerts, 04-06 heartbeat, quota and the ops report). The PO does every hosted step; agents never set
hosted secrets, never run SQL against a hosted project and never call a hosted runner.

## 1. Architecture

```
pg_cron  'jobs-kick'  * * * * *  ──► ops.kick_job_runner()  (SECURITY DEFINER, owner postgres)
                                        │ reads Vault: jobs_runner_url, jobs_runner_secret
                                        │ none set → returns NULL, sends nothing (local stacks, CI)
                                        ▼
                                        │ token = v1.<unix_ts>.<hex hmac_sha256(secret, 'jobs-run|v1|' || unix_ts)>  (R-49)
                                  net.http_post(url, {"source":"pg_cron"}, Authorization: Bearer <token>, 30 s)
                                        ▼  (sent by the pg_net worker after the cron transaction commits)
POST /api/jobs/run  ──► isAuthorisedRunner (|now − ts| ≤ 120 s; HMAC of current or NEXT, timingSafeEqual) ── else 401
                    ──► runJobs(getSystemDb("jobs.run"), budget 25 s, batch 25, lease 120 s, ≤ 10 per tenant)
                    ──► public.claim_jobs (FOR UPDATE SKIP LOCKED, lease token) → handler → complete/fail_job
pg_cron  'jobs-reap'  * * * * *  ──► ops.reap_jobs()   (dead-letters expired leases with no attempts left)
pg_cron  'cron-history-cleanup'  15 0 * * *  ──► deletes cron.job_run_details older than 7 days
```

| Piece | Where |
|---|---|
| Schedules, kick, drill enqueue | `supabase/migrations/000033_jobs_scheduler.sql`; the token-sending kick `000034_jobs_runner_token.sql` (R-49) |
| Queue, claim, fencing, reaper | `supabase/migrations/000031_jobs_queue.sql`; runner `lib/jobs/internal/runner.ts` (record 04-01) |
| Route | `app/api/jobs/run/route.ts` (`POST` only; other methods 405 `Allow: POST`; `maxDuration` 60 s) |
| Bearer check | `lib/jobs/auth.ts` (`isAuthorisedRunner`, `mintRunnerToken`) |
| Handlers | `lib/jobs/internal/registry.ts` (the route claims exactly these kinds); drills in `handlers/drill.ts` |
| Env | `JOBS_RUNNER_SECRET` (required in staging/production, 32+ printable characters, not the `CRON_SECRET`), `JOBS_RUNNER_SECRET_NEXT` (rotation only), `JOBS_DRILL_ENABLED` (default false, refused in production) |

Timeouts (R-17, pitfall 1/2): pg_net waits 30 s (its default of 2 s would record every call as a timeout); the runner
stops claiming at 25 s and never starts a job it cannot finish inside the budget; the function may run 60 s (Vercel
Hobby maximum); a lease is 120 s, so a live pass never loses its lease; provider calls abort at 10 s (messaging) and 5 s
(webhooks).

Times: **pg_cron runs in GMT on Supabase.** `* * * * *` is every minute everywhere; `15 0 * * *` is 00:15 GMT =
**05:45 IST**.

Response body: `{ ok, claimed, done, retried, dead, durationMs }` (counts only; `ok` is false when a queue RPC failed
and the pass stopped early, with the code in `ops.job_runner_runs.error_code`). The route never returns ids, payloads or
error text.

## 2. Per-environment setup (Vault SQL, names only)

The migration creates the schedules on every project; they do nothing until Vault holds **both** secrets.

**Local and CI:** nothing. No Vault secrets, so `jobs-kick` is a no-op; `jobs-reap` and the cleanup run harmlessly. The
test lanes pause every `cron.job` row for the duration of a run (`tests/setup/cron-pause.ts`) and resume them after.

**Staging (PO actions 04-P1, 04-P8, 04-P9):**

1. 04-P1: confirm `pg_cron`, `pg_net`, `supabase_vault` are available, then approve the `staging.yml` migrate run that
   carries `000033_jobs_scheduler.sql` (it fails loudly if an extension is missing, R-34).
2. 04-P8: Vercel `clinicos-staging` → `JOBS_RUNNER_SECRET` = output of `openssl rand -hex 32` (Sensitive; a new value,
   never the `CRON_SECRET`), `JOBS_DRILL_ENABLED=false`. Redeploy. Check: `POST /api/jobs/run` without a bearer → 401.
3. 04-P9: staging SQL editor, after the migrate run:

   ```sql
   select vault.create_secret('<the JOBS_RUNNER_SECRET value>', 'jobs_runner_secret');
   select vault.create_secret('https://staging.<domain>/api/jobs/run', 'jobs_runner_url');
   -- verify (names and dates only, never values):
   select name, created_at, updated_at from vault.secrets where name like 'jobs_runner_%';
   ```

   The URL must be `https://` (the kick refuses plain http to anything but `127.0.0.1`, `localhost` and
   `host.docker.internal`, and refuses userinfo in the URL). The secret must be 32-512 printable characters without
   spaces (same rule as the env schema).

**Production (V2-15):** the same three steps on the production project with its own secret.

**After a restore (FT-02):** Vault is not in the dumps. Pause `jobs-kick` (§4), review pending jobs, then re-create both
Vault secrets as above (docs/runbooks/backup-restore.md).

## 3. Rotating the runner secret

1. New value: `openssl rand -hex 32`. Vercel: set `JOBS_RUNNER_SECRET_NEXT` = new value. Redeploy. The route now accepts
   tokens signed with the old or the new secret.
2. Vault (SQL editor): `select vault.update_secret((select id from vault.secrets where name = 'jobs_runner_secret'), '<new value>');`
3. Wait two minutes; check §6 that kicks answer 200.
4. Vercel: `JOBS_RUNNER_SECRET` = new value, delete `JOBS_RUNNER_SECRET_NEXT`. Redeploy. Tokens signed with the old
   value are now refused.
5. Record the date (names only) in `docs/ops/secret-rotation.md`.

The schema refuses `JOBS_RUNNER_SECRET_NEXT` without a current secret or equal to it. Rotate at once if the value may
have leaked: the worst a leaked runner secret allows is extra runner passes (idempotent: only due work runs; no data is
returned). The secret itself is never sent (R-49); only tokens are.

## 4. Pausing and resuming

```sql
select jobid, jobname, schedule, active from cron.job order by jobname;
select cron.alter_job((select jobid from cron.job where jobname = 'jobs-kick'), active := false);  -- pause
select cron.alter_job((select jobid from cron.job where jobname = 'jobs-kick'), active := true);   -- resume
```

Pausing `jobs-kick` stops all background sends (jobs stay `pending` and run on resume, in `run_at` order). Pause
`jobs-reap` too if leases must not be dead-lettered while the runner is stopped. Removing the Vault URL also stops the
kick (it returns NULL).

## 5. Manual run and drills

Manual run (idempotent, only due work runs). The route never accepts the raw secret: mint a token that is valid for
120 s (the clock of the machine running this must be within a minute or so of real time):

```bash
ts=$(date +%s)
sig=$(printf 'jobs-run|v1|%s' "$ts" | openssl dgst -sha256 -hmac "$JOBS_RUNNER_SECRET" | awk '{print $NF}')
curl -s -X POST https://staging.<domain>/api/jobs/run \
  -H "Authorization: Bearer v1.$ts.$sig" -H "Content-Type: application/json" -d '{"source":"manual"}'
```

(In TypeScript: `mintRunnerToken(secret)` from `lib/jobs/auth.ts`.)

Drill (staging only, R-32): set `JOBS_DRILL_ENABLED=true` in Vercel and redeploy, then in the SQL editor:

```sql
select ops.drill_enqueue('drill.noop', 20, interval '10 minutes');   -- 20 no-op jobs spread over 10 minutes
-- lag per job (queue lag acceptance: p95 < 2 min)
select percentile_cont(0.95) within group (order by extract(epoch from first_claimed_at - run_at))
  from ops.jobs where kind = 'drill.noop' and first_claimed_at is not null;
delete from ops.jobs where kind = 'drill.noop';
```

`ops.drill_enqueue(kind, count default 1, spread default 0, max_attempts default 2)`: `drill.*` kinds only, 1-500 jobs,
spread 0-1 day; executable by `postgres` only (no API role). Set `JOBS_DRILL_ENABLED=false` again afterwards; without
it the runner never claims drill kinds (they stay `pending`).

Local end to end (macOS only, R-21; CI tests the database half and the route half separately because the database
container cannot reach the app on a Linux runner):

```bash
npm run e2e:build && npx tsx scripts/ops/scheduler-local-e2e.ts
```

It starts the e2e build on 127.0.0.1:3100, writes Vault secrets pointing at `http://host.docker.internal:3100`, turns
`jobs-kick` on, enqueues 5 `drill.noop`, waits up to 150 s, records the lag in
`.planning/phases/04-jobs-reliability/evidence/scheduler-local-e2e.json` and restores everything. On Linux it exits 2.

## 6. Troubleshooting

```sql
-- Did the schedules run? (status, timing; never contains the secret)
select j.jobname, d.status, d.start_time, d.end_time, left(d.return_message, 80)
  from cron.job_run_details d join cron.job j using (jobid)
 order by d.start_time desc limit 20;

-- What did the runner answer? (pg_net keeps responses for a few hours)
select id, status_code, timed_out, left(error_msg, 80), created
  from net._http_response order by created desc limit 20;

-- Runner passes (counts and a code only)
select started_at, source, claimed, done, retried, dead, ok, error_code
  from ops.job_runner_runs order by started_at desc limit 20;

-- Queue state
select kind, status, count(*), min(run_at) from ops.jobs group by 1, 2 order by 1, 2;
```

| Symptom | Likely cause |
|---|---|
| `jobs-kick` runs `succeeded` but no `_http_response` rows | Vault secrets missing (kick returns NULL by design) |
| `cron.job_run_details.return_message` = `jobs_runner_url_refused` / `jobs_runner_secret_refused` | the Vault URL is not https (or carries userinfo) / the Vault secret is too short or has spaces |
| `status_code` 401 | Vault secret and `JOBS_RUNNER_SECRET` (or `_NEXT`) differ; the database and app clocks differ by more than 120 s (token refused as stale/future); or the env schema refused the deployment's secret |
| `timed_out` true | the function took more than 30 s (should not happen: budget 25 s) or the URL is unreachable |
| `status_code` 405 | the URL points at a GET, or a redirect turned POST into GET (use the final https URL) |
| runner runs with `ok = false` | a queue RPC failed (`error_code` is the SQLSTATE); unfinished jobs are re-claimed after their lease |
| jobs `pending` forever | `jobs-kick` paused, Vault URL wrong, or no handler for the kind in this deployment |

## 7. Security notes (T-04-01, T-04-02)

- The runner secret authorises one thing: a runner pass over **due** work. It is never the service key and never the
  `CRON_SECRET`. The route answers 401 before any body read or database access, compares in constant time and returns
  counts only.
- **The secret never leaves the database (R-49).** pg_net's objects are owned by `supabase_admin`, which grants anon and
  authenticated on `net` and leaves `net.http_request_queue` readable by PUBLIC; the `postgres` migration role cannot
  revoke those grants (R-16's revoke clause is superseded). So the kick sends only a token: `v1.<unix_ts>.<hex
  hmac_sha256(secret, 'jobs-run|v1|' || unix_ts)>`. The route accepts it for 120 s either side of its own clock, against
  the current or next secret, in constant time; malformed, stale, future and wrong-secret tokens get 401 with no detail.
  anon and authenticated cannot log in and cannot reach `net` through the API (`net` is not an API schema; PostgREST
  answers PGRST106; no function in an API schema references `net.`).
- **Accepted residual (R-49):** any role that can log in to the database can read a queued token while it waits for the
  pg_net worker and replay it within its 120 s window. A replay only runs the idempotent runner over due work.
- `service_role` holds Supabase's default Vault grant (not reachable through the API). No API role may execute
  `ops.kick_job_runner()` or `ops.drill_enqueue()` or use `cron`.

## 8. Retention

`cron-history-cleanup` keeps 7 days of `cron.job_run_details` (pitfall 10; about 1 440 rows a day per schedule).
`net._http_response` is trimmed by pg_net itself. `ops.jobs` and `ops.job_runner_runs` retention arrives with 04-06.
