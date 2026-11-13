# V2-04 adversarial review, group A: job queue core, scheduler, runner auth

- Scope: `git diff origin/feature/v2...0dc606b` for migrations 000031, 000033, 000034; `lib/jobs/**` (runner, claim,
  registry, types, auth, enqueue); `app/api/jobs/run/route.ts`; `proxy.ts`; `lib/supabase/system.ts`; runner env keys
  (`lib/env.ts`, `lib/env-server.ts`).
- Reviewer: isolated adversarial reviewer, fresh context. Implementer records were opened only after the findings below
  were written, to check whether each one was already known (none was).
- Method: code reading, then probes on the local stack (migrations at 000040). The stack was not reset. The vault and
  pg_net probes ran in transactions that were rolled back. The double-claim and attempt-burn probes needed committed
  rows. They used throwaway `drill.zz*` kinds, and those rows were deleted afterwards. No secret value was printed.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 5 |
| Info | 4 |

No High or Critical. Fencing, grants, the HMAC token and the route's auth ordering held up under every attack listed below.

---

## Medium

### M-1: The runner's batch math always claims one job at a time, so tenant fairness becomes global FIFO and one clinic's backlog delays every other clinic

- `lib/jobs/internal/runner.ts:163-166` computes `batch = min(opts.batch, max(1, floor(left / worst)))`.
- `app/api/jobs/run/route.ts:34-37` passes a 25 s budget and batch 25. The most expensive registered kind costs 13 s:
  `message.send` / `message.reply_unmatched` take `maxDurationMs` 12 000 (`lib/jobs/internal/handlers/message-send.ts:165`)
  plus the 1 s finish margin.
- So `floor(≤25000 / 13000) = 1` on every iteration. Every `claim_jobs` call in production uses `p_batch = 1`.
- In `claim_jobs`, `due_tenants` is `LIMIT p_batch` ordered by each tenant's oldest due job
  (`supabase/migrations/000031_jobs_queue.sql:198-208`). With `p_batch = 1` it picks the one tenant with the oldest work.
  That makes the claim plain FIFO by `run_at`.
- The SQL fairness (`per_tenant`, the LATERAL) only works for `p_batch > 1`. 04-01 tested it at batch 10, but the route
  never uses that. TARGET §8 ("no tenant can starve others") and T-04-07/D1 are not met in the deployed configuration.

**Exploit:** a member of clinic A bulk-enqueues N messages (for example a reminder run across every patient, through
the legitimate `enqueue_message`). Each runner pass does roughly budget ÷ per-job time jobs, one claim at a time. Clinic
B's appointment confirmations queued after that wait behind all N of A's jobs, which can be tens of minutes. Nothing
malicious is needed; any large clinic triggers it.

**Repro** (local, rolled back; verified):

```sql
begin;
create temp table t2 as select id from public.tenants order by id limit 2;
select count(ops.enqueue_job('drill.zzfair', (select id from t2 order by id limit 1), '{}', 'zzfair:a:'||g,
       now() - interval '10 minutes' + g*interval '1 second', 3)) from generate_series(1,30) g;
select ops.enqueue_job('drill.zzfair', (select id from t2 order by id desc limit 1), '{}', 'zzfair:b',
       now() - interval '1 minute', 3);
-- 12 claims at the runner's effective batch (1): all 12 go to tenant A, 0 to B
-- the same rows claimed with batch 25: B is included (11 rows, 10 A + 1 B)
rollback;
```

Observed: `claims 1..12 → B: 0, A: 12`; with `p_batch 25`, B is included.

**Fix (pick one):**
1. Claim `opts.batch` (or a fixed fair batch such as 10) independent of the worst-case cost, and keep the existing
   `release_job` for whatever no longer fits. This is cheap because release returns the attempt. Add a runner-level
   test with the route constants asserting that two tenants interleave.
2. Keep batch = 1 but make tenant selection round-robin: order `due_tenants` by the tenant's last claim time (for
   example `max(first_claimed_at)` or a small `ops.job_tenant_cursor`) instead of by oldest due work.

If you fix this with (1), fix L-1 in the same change.

---

## Low

### L-1: Attempts are counted at claim, so jobs claimed with a job that crashes the pass lose attempts without running, and can be dead-lettered `lease_expired` (latent today)

- `000031:229-235` increments `attempts` for every row claimed.
- When the pass dies, for example:
  - the function is killed at 60 s,
  - the event loop blocks,
  - an OOM,
  - or a queue RPC throws (`runner.ts:191-197` stops the pass and leaves the leases),

  every claimed job that never started keeps its lease. It is re-claimed with `attempts + 1`. After `max_attempts`,
  `ops.reap_jobs` (`000031:383`) dead-letters it as `lease_expired`.
- For `message.send` the dead trigger fails the patient message. A poison job at the head of a batch takes its unstarted
  neighbours with it every cycle.
- Today M-1 caps every batch at one job, so the blast radius is that one job. The issue becomes live as soon as batches
  grow.

**Repro** (local; committed throwaway rows, deleted after; verified):
`ops.drill_enqueue('drill.zzreview', 3, '0', 2)`, then `claim_jobs(..., 25, 10, 'crash1', 10)` (do not finish), sleep
11 s, claim again, sleep 11 s, then `ops.reap_jobs()`. Result: `dead | attempts 2 | lease_expired | 3`. All three are
dead-lettered, although none of them was ever handed to a handler.

**Fix:**
- Count the attempt when the handler starts: a fenced `public.start_job(id, lease_token)` that increments `attempts`
  and sets a `started_at`. Have claim not count, and have the reaper or re-claim treat "claimed, never started"
  separately.
- At minimum, in the `runJobs` catch block, best-effort `release_job` every claimed job that was not started.

### L-2: A handler timeout drops the lease while the abandoned handler may still be running

- `runner.ts:86-99` races the handler against `AbortSignal.timeout`. On timeout, `processJob` calls `fail_job(...,
  retryable)` (`runner.ts:125-131`), which clears `lease_token` and sets `pending` with a backoff as short as 15 s.
- The abandoned promise keeps running wherever it ignores the signal: DB writes after a provider accepted a send, the
  audit insert, the SMS fallback.
- On Vercel, a frozen instance resumes pending promises on its next invocation. So the abandoned run can finish after
  another runner has re-claimed the job, and fencing does not stop it because the old holder gave up its token
  voluntarily.
- The delivery-row claims in 04-03a/b reduce the impact, but the queue-level guarantee "one live holder per job" is
  broken.

**Fix:** on `handler_timeout`, do not release the lease early. Fail with `retryAt ≥ now + leaseSeconds`, or leave the
row `running` until its lease expires. Add a runner spec in which a handler ignores the signal, and assert that no
second claim succeeds while it is still running.

### L-3: The route has no hard wall-clock bound on queue RPCs, so the 60 s Vercel limit is not guaranteed

- The system client sets no fetch timeout or abort signal (`lib/supabase/system.ts`). `service_role` has no
  `statement_timeout` (probe: `rolconfig` empty). Each RPC is bounded only by the `authenticator` login setting (8 s)
  when PostgREST is healthy, and not at all on a network stall.
- Worst case with a healthy PostgREST: 25 s budget + the last finish RPC + `jobs_runner_end` (8 s) + a slow begin.
  That is about 49 s, which is under 60 s but with little headroom.
- A stalled connection exceeds the limit, the function is killed, and L-1 then applies.

**Fix:**
- Give `getSystemDb("jobs.run")` a `global.fetch` that uses `AbortSignal.timeout(~5 s)`.
- Have `runJobs` stop claiming once `remaining()` falls below a fixed reserve that covers `jobs_runner_end`.
- Optionally `ALTER ROLE service_role SET statement_timeout` (needs a ruling).

### L-4: An invalid `retryAt` from any handler aborts the whole pass

- `claim.ts:98` calls `retryAt.toISOString()`. For an `Invalid Date` (a handler building `new Date(undefined)` or
  `new Date("garbage")`) it throws `RangeError` before the RPC.
- The error escapes `processJob` and reaches the catch at `runner.ts:191`. The pass stops with `ok=false`, the job keeps
  its lease, and L-1 applies.
- Current handlers derive `retryAt` from DB timestamps, but the runner trusts handler output at this one point.

**Fix:** in `processJob`, accept `retryAt` only if `Number.isFinite(retryAt.getTime())`; otherwise drop it and use the
default backoff. Add a unit case.

### L-5: The `runner_stale` alert accepts any successful pass, including a manual one

- `000039_ops_alerts.sql:231-232` takes `max(started_at)` over `ops.job_runner_runs WHERE ok`, whatever the `source`.
- `source` is caller-chosen in the route body (`route.ts:40,94`).
- A manual call, or a replay inside the 120 s window (R-49), resets the alert while pg_cron or pg_net is broken. For
  example, a pg_net worker lag over 120 s makes every scheduled kick 401.

**Fix:** filter `r.source = 'pg_cron'`, or add a separate "no pg_cron pass in N minutes" rule.

---

## Info

### I-1: The pg_net queue residual (R-16 → R-49) is confirmed, and only the token is exposed

Probe, rolled back: two vault secrets were created and `ops.kick_job_runner()` was called. Results:

- **Token in the queue:** the `net.http_request_queue` header does not contain the secret. It is
  `Bearer v1.<ts>.<64 hex>`, with `ts` within 5 s of `clock_timestamp()`. Its HMAC verifies against
  `extensions.hmac('jobs-run|v1|'||ts, secret, 'sha256')`, and the request timeout is 30 000 ms.
- **Queue readability:** `anon`, `authenticated`, `service_role` and `authenticator` have `USAGE` on `net` and `SELECT`
  on `http_request_queue` / `_http_response`. As `authenticated` (set role) the queue row was visible. This is
  reachable only by a database login: PostgREST `Accept-Profile: net|ops|vault` returns 406, a GraphQL introspection
  shows no net/ops/vault types, and anon `rpc/claim_jobs` returns 401.

The residual is as accepted in R-49. The 000034 header comment states it correctly.

### I-2: `service_role` can read `vault.decrypted_secrets` (Supabase default)

`has_table_privilege('service_role','vault.decrypted_secrets','SELECT') = t`. This cannot be exploited today, because:

- `vault` is not an API schema;
- no `public` function runs caller-controlled dynamic SQL (the `EXECUTE format` uses in 000022, 000035, 000036 and
  000038 have fixed templates);
- the drift role's only function grant (`ops.report_all`) reads `vault.secrets` for existence only.

Keep "no dynamic SQL over caller input in `public` definer or invoker functions" as a standing review rule.

### I-3: Jobs of a kind no deployment registers are never claimed or reaped

`claim_jobs` only sees `p_kinds` = the registry (`registry.ts:25-30`). A `drill.*` row with `JOBS_DRILL_ENABLED`
off, or a kind enqueued before its handler is deployed, stays `pending` forever, and `reap_jobs` only reaps `running`
rows. Confirm that the queue-age / backlog alert (04-04) counts these rows; if it does not, add a rule for "pending
older than X of an unregistered kind".

### I-4: Attacks that did not succeed

- **Double claim:** 8 parallel claimers × 30 calls × batch 25 against 400 due jobs (`claim_jobs`, service_role)
  produced 400 claims, all unique, each with `attempts 1`. The re-check inside the locking subquery plus `SKIP LOCKED`
  is sound.
- **Stale holder:** `complete_job`, `fail_job` and `release_job` all require `lease_token` match and
  `status='running'`, so a re-claimed row rejects the old holder. Leases and `now()` are both DB-side; the app clock
  only drives the budget.
- **Attempts, poison jobs, retry caps:**
  - Attempts are bounded (`max_attempts` 1..20 CHECK).
  - The re-claim of an expired lease requires `attempts < max_attempts`, and the reaper dead-letters the rest.
  - `fail_job` caps `p_retry_at` at 1 day and floors it at `now()`.
  - `release_job` returns exactly the attempt the claim took, so it cannot be used to launder attempts.
- **Grants and search_path:**
  - All queue, scheduler and token functions are `SECURITY DEFINER` with `search_path=''`.
  - Runner RPCs are EXECUTE for `service_role` only. `ops.enqueue_job`, `reap_jobs`, `kick_job_runner` and
    `drill_enqueue` are executable by no API role.
  - `ops` has no USAGE for anon, authenticated, service_role or authenticator. `ops.jobs` has RLS on and no grants.
- **Payload and job-count DoS:** payloads are ≤ 4 KB objects (CHECK); `kind`, `dedupe_key` and `locked_by` are bounded.
  A 200 000-row due backlog (rolled back) still claims in 52 ms at batch 1 and 74 ms at batch 25.
- **HMAC token** (`lib/jobs/auth.ts`):
  - The regex is anchored and canonical: `v1.`, no sign, no leading zero, at most 12 digits, 64 lowercase hex. JS `$`
    does not match before a trailing newline, and duplicate `Authorization` headers are joined by `, ` and fail the
    regex.
  - Negative, float, zero-padded, huge and whitespace timestamps are all refused before any MAC.
  - The skew check is two-sided (120 s).
  - `timingSafeEqual` runs on equal 32-byte buffers against both secrets with no early exit. Length extension does not
    apply to HMAC.
  - With no current secret, nothing authenticates, and a schema-refused environment gives `{}` (fail closed). The env
    schema enforces 32..512 printable characters, NEXT ≠ current and runner ≠ CRON_SECRET, and makes the secret required
    in staging and production.
- **Route:**
  - Auth runs before the body read and before any DB access.
  - The body is bounded at 1 KB (declared length plus streamed count) and parsed with a strict zod schema.
  - 401, 400, 413 and 500 all return the same `{ok:false}` with `no-store`.
  - GET, PUT, PATCH and DELETE return 405 with no side effect.
  - The 500 path logs only `errorTag` and the request id. The response carries counts only.
- **Proxy:** `SESSIONLESS_PATHS` is an exact-match set and skips only the session refresh. The route authenticates
  itself, so path variants (trailing slash, case, encoding) cannot bypass auth; at worst they fall into the session
  branch.

### Low-confidence note (not counted): the token is not bound to an environment

The MAC message is `jobs-run|v1|<ts>`, with no environment or host. If staging and production ever share
`JOBS_RUNNER_SECRET`, a token read from the staging `net` queue authenticates against production for 120 s. The env
schema does not prevent that reuse. Adding `APP_ENV` (or the runner host) to the MAC message in both 0003x SQL and
`auth.ts`, or documenting and checking "distinct per environment", closes it. The impact is limited to running the
idempotent runner.
