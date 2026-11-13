---
phase: 04-jobs-reliability (V2-04)
review: independent (fresh context; implementer records not read until findings were formed)
scope: git diff origin/feature/v2...0dc606b (branch v2/phase-04-jobs-reliability, PR #6), excluding types/database.ts, package-lock.json, scripts/drift/schema-snapshot.txt, **/evidence/**
reviewed: 2026-11-14
findings:
  critical: 0
  high: 0
  medium: 5
  low: 7
  info: 5
status: issues_found
---

# V2-04 Jobs reliability: independent code review

Requirements used: roadmap §12.2 V2-04 acceptance, `04-PLAN.md` (rulings R-1…R-51), ADR-0005 and
`04-ADR0005-PROPOSALS.md` (A2, A3), CLAUDE.md non-negotiables. Severity: Critical (exploitable or data loss now),
High (breaks a phase objective in normal operation), Medium (breaks an objective or a stated requirement under a
realistic condition), Low (edge case, documentation or plan drift), Info (observation, no change required).

## Medium

### M1. The production runner claims one job at a time, so tenant fairness (TARGET §8) is not delivered and throughput is capped

**Where:** `lib/jobs/internal/runner.ts:159-166`, `app/api/jobs/run/route.ts:34-37`,
`lib/jobs/internal/handlers/message-send.ts:165`, `supabase/migrations/000031_jobs_queue.sql:198-228`.

**What happens:** each claim's batch is `min(opts.batch, floor(left / worst))`, where `worst` is the largest
`maxDurationMs + 1000` among the kinds that still fit. With the route's 25 s budget, `message.send` and
`message.reply_unmatched` (12 s) give `worst = 13 000`, so `floor(24 900 / 13 000) = 1` from the very first claim.
Once less than 13 s is left, the message kinds drop out and `alert.notify` (11 s) keeps the batch at 1. The route's
`BATCH = 25` and `PER_TENANT = 10` never take effect.

`claim_jobs(p_batch = 1)` then reduces to `due_tenants … LIMIT 1` (the tenant with the oldest due job) and
`fair … LIMIT 1`, which is plain oldest-first FIFO. Failure scenario: clinic A enqueues 300 reminders at 09:00:00 and
clinic B books one appointment at 09:00:05. B's booking message waits behind all 300 of A's, across several
one-minute passes. That is the starvation TARGET §8 and the 04-01 record (D1) say the claim prevents. The fairness
spec (`tests/jobs/parallel-dispatch-db.spec.ts:128-156`) passes only because it calls `claim_jobs` directly with
batch 10, a value production never uses.

Side effects:
- Message sending only runs during the first ~12 s of each 25 s pass, which limits throughput against the
  "p95 < 2 min" acceptance under a burst.
- The `locked` CTE still locks up to `p_per_tenant` rows of the chosen tenant (`FOR UPDATE SKIP LOCKED`) while
  claiming one, so a concurrent runner skips that tenant's other rows for the length of the statement.

**Fix:** size the batch from the jobs' actual expected cost, not the worst-case bound. For example: claim
`opts.batch` and release (`release_job`) whatever no longer fits, which the runner already supports. Or claim per
kind with `floor(left / costMs(kind))`. Add a route-level test (real `runJobs` options from the route) that asserts
two tenants interleave.

### M2. In-progress polling uses up job attempts, so a single crash can dead-letter a message that was never sent

**Where:** `lib/jobs/internal/handlers/message-send.ts:95-97` (and `webhook-deliver.ts:65-67`);
`000031_jobs_queue.sql:229-241` (every claim counts an attempt), `:299-300` (`fail_job` → `dead` at `max_attempts`);
`000035_message_enqueue.sql:386` (job `max_attempts = max_retries + 2`), `:518` (delivery reaper waits 240 s),
`:446-452` (`message_job_dead` dead-letters a row still in `processing`).

**What happens:** the delivery row's retry budget and the job's attempt budget are coupled, but a re-claim that only
finds the row still `processing` (`delivery_in_progress`) is charged as a full attempt. One crash costs about three
attempts:
1. the crashed attempt;
2. a re-claim after the 120 s lease, which finds the row `processing` and retries in 60 s;
3. usually one more `delivery_in_progress` before the 240 s delivery reaper frees the row.

There is only a +2 margin. Failure scenario (`max_retries` 3, so job `max_attempts` 5):
- attempts 1 and 2: MSG91 answers 503; the row is `failed`, `retry_count` 2.
- attempt 3: the function is killed after `communication_queue_claim`; the row is `processing`.
- attempt 4 (t ≈ 120-180 s): `delivery_in_progress`.
- attempt 5 (t ≈ 180-240 s): still under 240 s, so `delivery_in_progress` again. `fail_job` returns `dead`, and
  `message_job_dead` moves the row to `dead_letter`.

The message was never sent, although the delivery row had a retry left and its outcome was merely unknown. This
violates the phase objective ("no duplicate or lost messages"). `not_due` and `claim_missed` are charged the same way.

**Fix:** do not count non-attempts. Hand the job back without consuming an attempt (a `reschedule_job(id, token,
run_at)` RPC that restores `attempts`, like `release_job`). Alternatively, reap a delivery row once its job's lease
has expired instead of a fixed 240 s. Add a reaper spec for "crash on attempt 3 of 5 still sends".

### M3. `ops.replay_job` replays dead-lettered messages with their share links already redacted

**Where:** `000037_inbound_idempotency.sql:347-351`; the pre-existing trigger `communication_queue_scrub_payload`
(BEFORE UPDATE: on `dead_letter` it replaces every `*_url` / `*_token` string in `template_params` with
`"[redacted]"`); call sites `features/prescriptions/service.ts` (`document_url`), `features/labs/service.ts:462`,
`features/referrals/service.ts:609`, `features/billing/service.ts:1197,1414-1415`.

**What happens:** `replay_job` sets the row back to `pending` with `retry_count = 0` but leaves `template_params`
as the scrub trigger left them. Failure scenario: a prescription-share WhatsApp message dead-letters (provider
outage). The operator follows `docs/runbooks/jobs.md` §11 and runs `select ops.replay_job(…)`. The patient then
receives the message with `document_url = "[redacted]"`.

R-35 makes replay the only dead-letter recovery path, so every replayed share, receipt, referral or consultation
message is broken. `tests/jobs/replay-job-db.spec.ts` checks status only, never the parameters.

**Fix:** either refuse replay of `message.send` rows whose parameters were redacted (`JOB_NOT_REPLAYABLE`, and the
runbook says "re-share from the app"), or move the redaction off `dead_letter` (keep the parameters until retention
removes them). Add a spec that replays a `document_url` message and asserts the provider receives the original link.

### M4. A real restore leaves the project with no pg_cron schedules, and the runbook does not say to re-create them

**Where:** `ops/backup/backup.sh:245-246` (the `cron.job` data is excluded, correctly for the drill);
`docs/runbooks/backup-restore.md` §8 steps 4-5 (lines 124-127); `supabase/tests/restore_drill_checks.sql` (asserts
`cron.job` is empty).

**What happens:** after the §8 restore into a new project:
- `cron.job` is empty;
- `history_data.sql` marks 000033-000040 as applied, so step 5 ("run staging.yml migrate if newer migrations
  exist") never re-runs the `cron.schedule` calls.

The restored project has no `jobs-kick`, `jobs-reap`, `delivery-reap`, `ops-evaluate-alerts`, `ops-heartbeat`,
quota, cleanup or `cron-history-cleanup` schedule. No message or webhook is ever sent. No alert can fire either,
because `runner_stale` is evaluated by a cron job that no longer exists, and FT-03 and FT-04 stop. Step 4 even says
"Pause the `jobs-kick` cron job", which presumes the job exists. The drill cannot catch this: it asserts the opposite
(empty cron) and never runs the real-restore steps.

**Fix:** add an idempotent `ops/restore/schedules.sql` holding the eight `cron.schedule(...)` calls (or a
`ops.ensure_schedules()` function created by a new migration) and a §8 step that runs it, created inactive for
`jobs-kick` until the pending-jobs review is done. Have the drill evidence record that the real-restore path
re-creates the expected schedule set.

### M5. The `prescription.issued` collapse keeps the draft-time event and drops the sign-time one

**Where:** `000036_webhook_enqueue.sql:365-371` (event key `prescription.issued:<id>`, `o_state_ok = true` in any
state); `features/prescriptions/service.ts:142` (enqueued when the empty draft is created);
`features/consultation/service.ts:741-745` (the sign-time enqueue is now always a no-op).

**What happens:** the plan (04-03b step 4) intends "one event per prescription", but the event that survives is the
one raised when `getOrCreateDraftPrescription` creates an empty draft. The event raised when the consultation is
signed (the prescription is final) is suppressed by the event key. Failure scenario: an integrator that acts on
`prescription.issued` (for example a pharmacy integration) now receives it before any item exists and is never told
when the prescription is actually issued. Before V2-04 it received the event at signing as well. The invariant "no
product behaviour change beyond the listed items" is affected: the plan lists the collapse but not which event
survives.

**Fix:** raise `prescription.issued` only at signing (drop the draft-time enqueue). Or set `o_state_ok` from the
prescription's signed or issued state, so the draft-time call is refused (`EVENT_NOT_ALLOWED`, already caught and
logged) and the sign-time call is the one that queues. Record the choice in 04-SUMMARY.

## Low

### L1. The reschedule webhook key suppresses a legitimate event (A → B → A)
`000036_webhook_enqueue.sql:339`. The key is `appointment.rescheduled:<visit>:<scheduled_at>`. Rescheduling back to
an earlier time reuses the first key, so integrators never learn the visit moved back. **Fix:** include a
monotonically increasing value, for example `visits.updated_at` or a reschedule counter.

### L2. A delivery report that arrives before the finish write is permanently ignored
`000037_inbound_idempotency.sql:171-176` and the route (`app/api/webhooks/messaging/[provider]/route.ts:73-76`).
`external_message_id` is written only by `communication_queue_finish`. A DLR that lands first matches 0 rows, so the
outcome is `ignored` and the key `dlr:<id>:<status>` is recorded as processed. MSG91's retries of that report are then
`duplicate`, and the `delivered`/`failed` transition is lost. **Fix:** finish such a key as `failed` (reprocessable)
when no row matches and the report is recent, or keep unmatched reports for a short window.

### L3. An `in_flight` answer of 200 can lose an inbound callback
`route.ts:68-71`. If MSG91 times out the first delivery and retries while it is still running, the retry gets 200.
If the first processing then fails, it marks the key `failed` and answers 500 on a connection MSG91 has already
abandoned, so no further retry comes. **Fix:** answer `in_flight` with 409 or 503 (as the Send Email hook does), so
the provider retries later.

### L4. A reprocessed callback repeats non-idempotent side effects
`route.ts:379-387` (reschedule front-desk note, plus a new reschedule token on each run) and `:400-409` (triage
note). After a `failed` finish, or a 5-minute in-flight takeover, the receptionist gets duplicate notifications. The
replies themselves are deduplicated. **Fix:** key the notes on the inbound key (a unique `metadata ->> 'inbound_key'`)
or write them after `inbound_webhook_finish`.

### L5. Alert rules that fire on states that are not failures
- `000039_ops_alerts.sql:136-139`: `dead_letter` counts webhook rows in `failed`, including the transient
  `failed/outcome_unknown` rows the delivery reaper creates, so a reclaimed crash raises a false dead-letter alert.
- `000039_ops_alerts.sql:192-198` (`queue_oldest_due`) and `readiness_probe` `jobs_backlog`: these count pending jobs
  of kinds no deployment claims. For example, `drill.*` jobs left after `JOBS_DRILL_ENABLED` is turned off keep a
  critical alert open indefinitely.

**Fix:** exclude `last_error = 'outcome_unknown'`, and restrict the backlog rules to the registered kinds (or
cancel orphaned drill jobs when drills are disabled).

### L6. The test harness re-activates every inactive cron job
`tests/setup/cron-pause.ts:47-50`. `resumeCronJobs` sets every inactive `cron.job` row active, including jobs a
developer had disabled on purpose before the run. **Fix:** resume only the names `pauseCronJobs` returned (persist
them next to the run lock).

### L7. Unrecorded or stale plan and record deviations
- R-49 (HMAC token, superseding R-16's revoke clause) is cited in code, the runbook and PO-ACTIONS but is missing
  from the plan's rulings table (R-48 is followed by R-50).
- 04-05a, R-14, R-30, the plan `key_links` and the "Deviations" section still specify EventBridge, CodeBuild,
  CloudFormation (`stack.template.ts`, `render.ts`, `stack.json`, `backup-evidence.yml`) and an `ap-south-1` bucket.
  What shipped is `backup.yml` on GitHub-hosted runners uploading to Cloudflare R2 (PO answer B-3 and R-48). The
  roadmap's V2-04 acceptance ("lands in the `ap-south-1` bucket") needs an erratum.
- The `000032_ops_backup_runs.sql` header still says "AWS CodeBuild" and "SNS".
- The `ops/backup/backup.sh:5` header says Environment `staging` (it is `staging-backup`).
- `backup-alert.yml` uses a `workflow_run` trigger, which 04-05a's workflow rule excluded. It is safe here: no
  secret, no checkout of run code, `issues: write` only. It should still be recorded.

## Info

- **I1.** `heartbeat_gap` is evaluated by pg_cron, the same thing it monitors. A dead pg_cron is caught only by the
  backup dead-man (exit 3, twice a day) and the daily ops report, which reports it as data and does not fail. This is
  acceptable for FT-03 (pause mitigation), but say so in the runbook.
- **I2.** In an environment without `OPS_ALERT_EMAIL`, R-51 re-enqueues a dead `alert.notify` every 15 minutes for
  each open alert, so `/api/ready` `jobs_dead_24h` stays permanently true. These flags are visible to anonymous
  callers by R-41's design.
- **I3.** `public.enqueue_message` is callable by any member (any role) directly through PostgREST. It has no rate
  limit and accepts a caller-chosen `p_dedupe_key` in the same per-tenant namespace as the system keys (for example
  `appointment_cancelled:<visit>`). This is no wider than the pre-V2-04 member INSERT policy, but V2-05/V2-12 should
  add a role gate and a rate limit, and namespace system keys.
- **I4.** `net.http_request_queue` / `net._http_response` grant SELECT and INSERT to anon/authenticated (pg_net
  default; not reachable through PostgREST). The runner token is readable there and replayable for 120 s (R-49,
  accepted). Any LOGIN role (for example `clinicos_drift_ro` on staging) can read it.
- **I5.** I did not run the DB test lane. Another session held the local-stack run lock throughout (pid 5068, then
  36338), and I did not override it. `npm run typecheck` passed; `npx eslint .` gave 0 errors (382 warnings, all
  pre-existing `no-explicit-any` style).

## Checked and found sound

- **Claim, lease and fencing (000031):**
  - `FOR UPDATE SKIP LOCKED` inside a LATERAL, with the due condition re-checked on the locked row version.
  - Attempts are counted at claim.
  - `complete_job`, `fail_job` and `release_job` are fenced by `lease_token` and `status = 'running'`.
  - The reaper and the claim conditions are disjoint (`attempts < max` vs `>=`).
  - `dedupe_key` is NOT NULL UNIQUE with insert-or-return.
  - Error codes are normalised in SQL and in TS.
- **Parallel dispatch:** the 8-runner × 200-message spec drives the real handler through separate HTTP clients, and
  `fileParallelism: false` isolates queue state. The delivery-level `communication_queue_claim` and
  `webhook_delivery_claim` UPDATEs prevent a double send even with two jobs on one row.
- **Runner auth (`lib/jobs/auth.ts`, 000034):**
  - HMAC-SHA256 token, ±120 s window, canonical timestamp regex.
  - `timingSafeEqual` on equal-length 32-byte buffers against both secrets, with no early exit.
  - Fails closed with no secret or with an environment the schema refuses.
  - The secret is never sent (the queue-row leak is asserted by test).
  - Env schema: 32+ printable characters; `_NEXT` must differ; must differ from `CRON_SECRET`.
  - The route checks auth before reading the body; the body is bounded at 1 KB; 405 for other methods; the proxy
    skips the session refresh.
- **Tenant isolation (A2):**
  - `enqueue_message` and `enqueue_webhook_event` derive the tenant from the subject row, require
    `p_tenant_id ∈ current_user_tenant_ids()`, and give the same `P0002` for missing and foreign rows.
  - System paths use a closed actor set and refuse a JWT caller (`auth.uid() IS NOT NULL`).
  - R-24 recipient allow-list (patient or guardian national number) and template allow-list.
  - Webhook data is built in SQL (R-26); subscriptions are read as definer (R-19 fixed).
  - Ping is limited to owner/admin, 5 per minute, under an advisory lock.
  - The handler re-checks that the subscription's tenant matches the row's.
- **Privileges (live catalogue on the local stack at 000040):**
  - Every new SECURITY DEFINER function has `search_path = ''`.
  - No new `public` function is executable by anon except `readiness_probe`.
  - Runner, delivery and inbound RPCs are executable by `service_role` only.
  - `private.*` writers are executable by no API role.
  - No `ops` function or table is reachable through PUBLIC.
  - `ops` has no API-role USAGE.
  - The queue tables carry no member write privilege (table and column level), and `000038` asserts this in the
    catalogue.
  - `kick_job_runner`, `drill_enqueue`, `replay_job` and the evaluator run as postgres only.
- **Inbound idempotency:**
  - The `(provider, key)` unique store uses `FOR UPDATE` serialisation.
  - Delivery reports apply a monotonic transition plus an audit row in one transaction.
  - Bot replies go through the queue with `bot:<key>:<template>`.
  - The unmatched-sender phone is redacted by a BEFORE UPDATE trigger, and replay of that job is refused.
  - Send Email hook dedupe (A3): ESLint zone limited to the one route; fails open; provider idempotency key.
- **No PHI in job payloads** (ids only, plus the R-25 exception), `last_error`, alert details or email rendering
  (allow-listed value shapes, HTML-escaped), the ops report (counts only, read-only-role guard inside a read-only
  transaction) or the backup row (counts only).
- **Workflows:**
  - `backup.yml`: `feature/v2` only, reviewer-free Environment limited by policy, secrets in step env only,
    `--ignore-scripts`, SHA-pinned actions, no `${{ }}` in `run:`, password via `PGPASSWORD`, masked target guard.
  - `ops-report.yml`: read-only Environment, `*_RO` secret only.
  - `backup-alert.yml`: `issues: write` only, values in env, sparse checkout of the default branch.
  - `staging.yml`: `plan` before `migrate`, full-history `wait-for-release`, `PGPASSWORD`.
- **Backup script:** fails closed on configuration; loopback refused for hosted environments; age with 2+ distinct
  recipients and a header check before upload; `umask 077`, work directory removed; URLs redacted from tool output;
  digest-pinned images; best-effort failed row; dead-man exit 3.
