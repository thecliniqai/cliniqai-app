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

**Staging and production never share a runner secret (ruling, 04-07 triage; owner: this runbook).** The runner token
(`v1.<ts>.<hmac>`, R-49) is not bound to an environment: a token minted with one project's secret is valid for any
deployment that holds the same secret. Generate each environment's `JOBS_RUNNER_SECRET` separately with
`openssl rand -hex 32`, never copy one into the other (Vercel or Vault), and rotate both if they were ever equal (§3).
The env schema cannot compare values across deployments, so this is a setup rule: the go-live checklist (V2-15) and
every rotation record in `docs/ops/secret-rotation.md` confirm "staging and production runner secrets differ".

**After a restore (FT-02):** Vault and `cron.job` are not in the dumps, and the restored migration history means no
migration re-creates the schedules. `select ops.ensure_schedules();` (migration 000042, postgres) re-creates the nine
schedules with `jobs-kick` **inactive**; review pending jobs, re-create both Vault secrets as above, then
`select ops.ensure_schedules(true);` activates `jobs-kick` (docs/runbooks/backup-restore.md §8).

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
`net._http_response` is trimmed by pg_net itself. Every `ops` table's retention is `ops.cleanup()` (04-06, §13).

## 9. Patient messages (`message.send`, V2-04 04-03a)

No request path sends a message (P0-12, R-33; ESLint `P0-12` zone). A request enqueues; the runner sends.

```
server action / system module
   └─► public.enqueue_message (member)  |  public.enqueue_message_system (service role, closed actor set)
         tenant = the subject row's (the visit, else the patient); a member's active tenant (ctx.tenantId) must
         equal it and be a membership, else P0002 SUBJECT_MISMATCH (R-6)
         └─► private.enqueue_message_internal: template in ops.message_templates for the channel, recipient = the
             patient's or guardian's number (R-24), params ≤ 4 KB, dedupe key → communication_queue row (pending)
               └─► AFTER INSERT trigger → ops.enqueue_job('message.send', tenant, {queue_id}, 'msg:<id>',
                   next_retry_at, max_retries + 2)
runner → handler message.send → communication_queue_claim → provider (runner's abort signal, 10 s bound)
   success → communication_queue_finish(sent) + communication_sent audit row (no phone) → job done
   retryable failure → finish(failed): the row's own backoff (1, 5, 15 min) → job retries at next_retry_at;
                       a WhatsApp booking/reschedule gets one SMS fallback (dedupe msg-fallback:<queue_id>)
   not retryable (disabled provider, synthetic recipient, MSG91 4xx, no recipient) → communication_queue_dead_letter
   last failure / dead job → row dead_letter + one "Message Delivery Failed" in-app note (trigger on ops.jobs)
pg_cron 'delivery-reap' * * * * * → ops.reap_delivery_rows(): rows in processing > 240 s → failed / outcome_unknown
```

| Question | Answer |
|---|---|
| Which provider sends? | `MESSAGING_PROVIDER`: `sink` on staging until V2-12 (R-9: succeeds, sends nothing, logs a count), `disabled` dead-letters at once, `dev` writes `.planning/dev-messages.txt` (local only), `msg91` real (production; V2-12). The e2e lane runs `sink`. |
| A message did not arrive | `select status, retry_count, error_message, next_retry_at from public.communication_queue where id = '<id>'` and `select status, attempts, last_error, run_at from ops.jobs where dedupe_key = 'msg:<id>'` (SQL editor, codes only). `error_message` is a code (`msg91_http_400`, `provider_disabled`, `synthetic_recipient`, `outcome_unknown`, `job_dead:<code>`). |
| Duplicate sends? | Normal operation sends once (job claim + lease fencing + the row claim; `tests/jobs/parallel-dispatch-db.spec.ts`). A crash between the provider call and the finish re-sends after the reaper (at-least-once, R-7; MSG91 has no idempotency key). |
| Stuck in `processing` | The reaper fixes it within ~5 min (240 s + the next minute); the job retries it. |
| Dead letters | Replay one with `select ops.replay_job('<job id>')` in the SQL editor (§11, R-35). |
| Templates | Only `ops.message_templates` ids per channel; V2-12 adds templates by migration. A new template id in code fails with `TEMPLATE_NOT_ALLOWED` until its migration lands. |
| Removed | `/api/cron/dispatch-communications` (404) and its `cron.dispatch_communications` reason; 04-03c: `sendDirectSms` / `sendDirectWhatsApp` (the inbound webhook's bot replies are queued, §11). |

## 10. Outbound webhooks (`webhook.deliver`, V2-04 04-03b)

No request path delivers a webhook (P0-12, R-33; ESLint `P0-12` zone: `@/lib/webhooks/dispatcher` and
`@/lib/webhooks/transport` only from `lib/jobs/internal/**` and `lib/webhooks/**`). A request enqueues; the runner delivers.

```
server action / system module / v1 route
   └─► public.enqueue_webhook_event (member)  |  public.enqueue_webhook_event_system (service role, closed actor set)
         closed event set: appointment.rescheduled, appointment.cancelled, visit.completed, prescription.issued,
         lab_result.ready (+ ping, members only, owner/admin, 5 per clinic per 60 s)
         tenant = the subject row's; a member's active tenant (ctx.tenantId) must equal it and be a membership, else
         P0002 SUBJECT_MISMATCH (R-6); the event data is built in SQL from the subject row (R-26, no caller payload)
         └─► private.enqueue_webhook_internal: the clinic's active subscriptions for the event, read as definer (every
             role's events are queued, R-19) → one webhook_delivery_queue row per subscription, event_key
             <event>:<subject>[:<scheduled_at>] / ping:<uuid> / payment.recorded:<payment_id> (the same event queues once)
               └─► AFTER INSERT trigger → ops.enqueue_job('webhook.deliver', tenant, {delivery_id}, 'wh:<id>',
                   next_retry_at, least(max_retries, 5) + 2)
record_payment → private.outbox_payment_recorded → the same table and trigger
runner → handler webhook.deliver → webhook_delivery_claim (pending → processing; one handler per row)
   subscription inactive → failed 410; subscription of another clinic → failed 403 + webhooks.queue_item.tenant_mismatch
   deliverWebhook: SSRF check (resolve once) → HMAC over the stored text → POST pinned to the checked address
                   (SNI/Host = name, no redirects, 5 s bound, runner signal)
   → webhook_delivery_finish: 2xx delivered → job done; other status or network error → pending at 1 m, 5 m, 15 m, 1 h
     → job retries at next_retry_at; the 5th failed attempt (least(max_retries, 5)) or an SSRF refusal → failed → dead
   dead job → an open row failed (last_error job_dead:<code>)
pg_cron 'delivery-reap' → ops.reap_delivery_rows(): webhook rows in processing > 240 s → failed / outcome_unknown
   (re-claimable: at-least-once)
```

| Question | Answer |
|---|---|
| An integrator did not receive an event | `select status, retry_count, response_status, last_error, next_retry_at, event_key from public.webhook_delivery_queue where id = '<id>'` and `select status, attempts, last_error, run_at from ops.jobs where dedupe_key = 'wh:<id>'` (SQL editor, codes only). `last_error`: `http_<status>`, `ssrf_blocked`, `request_failed:<tag>`, `timeout`, `subscription_inactive`, `subscription_tenant_mismatch`, `outcome_unknown`, `job_dead:<code>`. |
| Nothing was queued for a doctor's or receptionist's action | Fixed in 04-03b (R-19). If still 0: no active subscription of that clinic lists the event, or the event was already queued for that subject (event key). |
| Duplicate deliveries? | Normal operation delivers once (job claim + lease fencing + the row claim; `tests/jobs/webhook-deliver-handler-db.spec.ts`, 8 runners). A crash between the POST and the finish re-delivers after the reaper (at-least-once, R-7); receivers dedupe on the envelope `id`. |
| Test ping | Queued (R-26): the developer settings show "Test ping queued. The result appears in Delivery logs within about a minute."; the result is the ping row in Delivery logs. |
| Who can write the delivery table? | Nobody but the definer writers, triggers and the service role (000036): members keep SELECT (owner/admin, the delivery logs). |
| Removed | `/api/cron/webhooks` (404), its `cron.webhooks` reason, `lib/webhooks/outbox.ts` and the enqueue-time background dispatch (the 03-10 second writer). |

## 11. Inbound messaging webhook and dead-letter replay (V2-04 04-03c)

The MSG91 webhook (`POST /api/webhooks/messaging/msg91`) changes state at most once per callback and never sends
(P0-12, R-25, T-04-08).

```
POST /api/webhooks/messaging/msg91
   x-webhook-secret checked in constant time (401 before any database access; unchanged since P0-03)
   key = inboundDedupeKey(event, rawBody):
         delivery report  → dlr:<requestId>:<status>      (no request id, or a status other than delivered/read/failed:
                                                            200, nothing to do)
         inbound message  → in:<message id>  when the payload carries uuid / message_uuid / messageId / message_id
                            in:sha256:<hex of the raw body>  otherwise (a provider retry repeats the body byte for byte)
   public.inbound_webhook_begin('msg91', key) → ops.inbound_webhook_events (provider, key, timestamps, outcome; no payload)
         duplicate (finished before) / in_flight (another instance is on it) → 200, no effect
         process → apply:
            delivery report → public.communication_queue_apply_dlr (monotonic: delivered never overwrites read, failed
                              never overwrites delivered or read; status + audit row in one transaction; a repeat changes
                              nothing) → the urgent "WhatsApp Delivery Failed" note only when a failed report applied
            reply           → visit change (status-guarded, unchanged rules) → the bot reply QUEUED:
                              enqueueMessageAsSystem(…, dedupeKey 'bot:<key>:<template>', 'system:messaging_webhook')
                              (a communication_queue row the clinic sees in its log; message.send sends it)
            unmatched sender (Indian mobile only) → enqueue_unmatched_reply_system → job message.reply_unmatched
                              {to, template_id}, no tenant, dedupe 'bot:<key>:bot_not_found'; the phone is erased
                              (payload {"redacted": true}) the moment the job leaves pending/running
         → inbound_webhook_finish(processed | ignored); an exception → finish(failed) and 500, so MSG91 retries
           (the retry is safe: every effect is status-guarded or deduplicated)
   a claim left unfinished for 5 minutes (a crashed instance) or marked failed is processed again by the next delivery
```

| Question | Answer |
|---|---|
| Did a callback arrive? | `select provider, dedupe_key, received_at, processed_at, outcome, attempts from ops.inbound_webhook_events where dedupe_key = '<key>'` (SQL editor). Delivery-report keys are `dlr:<request id>:<status>`; the request id is MSG91's, not personal data. |
| A patient's reply did nothing | `outcome = 'ignored'`: no matching message (`replyMsgId` unknown, or the reply came from another number, AR-L1), or the visit was no longer booked/confirmed (AR2-L4). `failed` with `processed_at` null: the next MSG91 retry processes it. |
| Was the bot reply sent? | It is a queued message: `select status, error_message from public.communication_queue where dedupe_key like 'bot:%' and appointment_id = '<visit id>'`, then §9. The unmatched reply: `select status, attempts, last_error from ops.jobs where kind = 'message.reply_unmatched' and dedupe_key = 'bot:<key>:bot_not_found'` (its payload is `{"redacted": true}` once finished). |
| Message id field | The inbound message id is read from `uuid`, `message_uuid`, `messageId` or `message_id` (not yet verified against a live MSG91 inbound payload; V2-12 confirms it with the real provider). Without one the key is the raw body's hash, which still dedupes a byte-identical retry. |
| Send Email hook | The same store holds the hook's `webhook-id` (provider `supabase_auth_hook`, R-43; `docs/runbooks/auth-email.md`): a retry on another instance answers 200 without sending, an id another instance is sending right now answers 409 (GoTrue retries), and a store outage never blocks the email (fails open). |
| Retention | Rows are kept 30 days (R-2); the purge is 04-06's `ops.cleanup`. |

**Dead-letter replay (R-35).** In the Supabase SQL editor (role `postgres`; no API role can call it):

```sql
-- 1. find it (codes only)
select id, kind, last_error, finished_at from ops.jobs where status = 'dead' order by finished_at desc limit 20;
-- 2. replay it: the job goes back to pending (attempts 0, due now); a message.send / webhook.deliver delivery row goes
--    back to pending with retry_count 0 and no error, so the runner sends it on its next pass (≤ 1 minute)
select ops.replay_job('<job id>');
```

`JOB_NOT_REPLAYABLE`: the id is unknown, the job is not `dead`, or it is a `message.reply_unmatched` job (its phone was
erased; the sender gets a reply again only if they write again), or (04-07a, M-REPLAY, migration 000041) a
`message.send` whose row was redacted when it dead-lettered. **A dead-lettered share message (prescription, invoice or
lab-report link) cannot be replayed:** its link and token were scrubbed to `[redacted]`, so a replay would send a broken
link. Re-share it from the app (the record's Share action), which mints a new link and enqueues a new message. Replay
only after fixing the cause in `last_error`
(provider down, template missing, endpoint fixed); a replayed message that fails again dead-letters again (no second
"Message Delivery Failed" note). Record the replay (job id, reason) in the incident note.

**Contract (000038).** Members cannot write `communication_queue` or `webhook_delivery_queue` at all (only the
enqueue RPCs, the triggers and the runner do); the migration checks this against the catalogue and fails if any
privilege is back. `ops.backfill_delivery_jobs()` (postgres only) gives every open delivery row its job; it ran once in
the migration and can be run again safely (it returns the number of jobs it created).


## 12. Alerts (V2-04 04-04)

P1-25 (alerts part), rulings R-1 (email only), R-5 (rules), R-36 (recursion guard), R-41 (readiness flags), R-46
(error-sink rules); threats T-04-09, T-04-10, T-04-22. Migration `000039_ops_alerts.sql`.

```
pg_cron 'ops-evaluate-alerts' */5 * * * *  ──► ops.evaluate_alerts()   (pure SQL: runs while the app is down)
   for each enabled rule in ops.alert_rules: ops.alert_rule_<x>(params) → (firing, details)
   firing     → open or refresh ops.alerts (one open row per rule; count + 1, last_seen, details)
                new alert, or notified longer ago than the rule's cooldown
                  → ops.enqueue_job('alert.notify', null, {alert_id, seq}, 'alert:<id>:<seq>')
   not firing → clean_evaluations + 1; resolved after 2 clean evaluations (10 minutes)
runner (/api/jobs/run) ──► alert.notify ──► public.ops_alert_payload ──► getEmailSender().send(OPS_ALERT_EMAIL,
                           "[clinicos <APP_ENV>] <SEVERITY> <rule>", tag ops-alert, idempotency key ops-alert/<id>/<seq>)
                       ──► public.ops_alert_notified(id, provider message id, seq)
```

**Channel.** Email only (R-1), through the same `EMAIL_PROVIDER` as auth email (Resend until go-live, SES after;
Mailpit locally). `OPS_ALERT_EMAIL` is required in production, optional in staging. Without it (or with
`EMAIL_PROVIDER=disabled`) the `alert.notify` job dies with `alert_channel_unconfigured`; the alert stays open with
`notified_at` null and the ops report (04-06) shows it as unsent. That code is terminal (04-07c, review C L-4): the next
evaluation records `notify_stopped_code = 'alert_channel_unconfigured'` on the alert and stops retrying (instead of a
dead job every 15 minutes). After configuring the channel, resume with
`update ops.alerts set notify_stopped_code = null where status = 'open';` (SQL editor): the next evaluation tries
again. Backups also alert on their own path (the `backup-alert.yml` issue, 04-05a), so a broken app channel never
hides a failed backup.

**What an alert email contains.** Environment, rule, severity, status, alert id, first and last seen (IST and UTC), the
number of firing evaluations, the notification number, the details and the runbook anchor below. Details are written
only when they are numbers, booleans, ISO timestamps or UUIDs (job ids); anything else is counted as `omitted`. No
names, phones, emails, payloads or messages ever (the rule functions produce counts; the renderer re-checks).

**Noise control.** One open alert per rule; a persistent condition sends one email per cooldown (`cooldown_minutes`,
default 60; `error_sink_overflow` 6 h, `error_sink_size` 24 h, `backup_stale` 3 h; 04-06: `heartbeat_gap` 6 h, the two
quota rules 24 h, the weekly summary 7 days). The job's dedupe key
`alert:<id>:<seq>` makes a repeated evaluation unable to enqueue a second email for the same notification, and the
handler sends nothing when `notify_count` already covers it. A dead `alert.notify` never counts toward `dead_letter`
(R-36). The cooldown is **per rule, across episodes** (04-07c, review C L-1, migration 000042): an alert that resolves
and re-opens (a flapping condition, which a tenant can drive, e.g. a webhook endpoint that fails intermittently) is not
emailed while the rule's previous notification, sent or only tried, is inside the cooldown; it is emailed at the first
evaluation after the cooldown if it is still open. Alert email shares `EMAIL_PROVIDER` with auth email, so this also
protects the provider's daily quota.

**At-least-once (R-51).** A notification that was never recorded as sent (its job died: provider down, channel
unconfigured) is enqueued again by the next evaluation at least 15 minutes after the previous try, as long as no try of
it is still pending or running, keyed `alert:<id>:<seq>:r<try>`, until it is sent; a failed re-notification is retried
as the same `seq` (never skipped). Still one email per successful notification: the handler skips a `seq` already
recorded and the provider gets the idempotency key `ops-alert/<id>/<seq>`. Watch `notify_tries` on `ops.alerts` for a
channel that keeps failing. Exception: a try that died with `alert_channel_unconfigured` ends the retries (see
**Channel** above; `notify_stopped_code`).

### Rules

| Rule | Severity | Fires when (defaults in `ops.alert_rules.params`) |
|---|---|---|
| `dead_letter` | warn | a job went `dead` (any kind except `alert.notify`), a message row became `dead_letter`, or a webhook delivery became `failed`, in the last 15 min |
| `queue_lag` | warn | p95 of `first_claimed_at − run_at` over jobs first claimed in the last 15 min > 120 s, with ≥ 5 samples |
| `queue_oldest_due` | critical | a `pending` job is due for more than 5 min |
| `runner_stale` | critical | Vault holds `jobs_runner_url` and no runner pass started `ok` in 5 min (silent on local and CI stacks) |
| `lease_expiry` | warn | more than 3 job leases expired in the last 15 min |
| `error_burst` | warn | more than 20 server errors (`ops.error_events` counts seen in the last 10 min) |
| `error_sink_overflow` | warn | the error sink dropped events today or yesterday (UTC): its daily cap of 500 new fingerprints was hit |
| `error_sink_size` | warn | `ops.error_events` is larger than 50 MB (10 % of the Free database) |
| `backup_stale` | critical | backups are recorded and none finished `ok` in 13 h, or the latest run failed |
| `heartbeat_gap` | warn | heartbeats are recorded and the newest is older than 7 h (420 min; the heartbeat runs every 6 h) (04-06) |
| `quota_upgrade_trigger` | warn | the newest quota snapshot has a metric at 60 % or more of the plan limit and none at 70 % (04-06) |
| `quota_critical` | critical | the newest quota snapshot has a metric at 70 % or more of the plan limit (04-06) |
| `quota_weekly_summary` | info | this week's summary (opened Monday 09:00 IST) is open and not yet emailed; resolves once sent (04-06) |

```sql
-- open alerts (counts and ids only)
select rule, severity, first_seen, last_seen, count, notified_at, notify_count, details
  from ops.alerts where status = 'open' order by severity, first_seen;
-- did the email go out?
select status, attempts, last_error from ops.jobs where kind = 'alert.notify' order by created_at desc limit 20;
-- evaluate now (postgres only), e.g. after a fix, instead of waiting 5 minutes
select ops.evaluate_alerts();
-- silence a noisy rule for a while (record it in the incident note; re-enable afterwards)
update ops.alert_rules set enabled = false where rule = '<rule>';
```

A rule parameter is changed in a reviewed migration (`update ops.alert_rules set params = …`), never by hand in staging
or production (the drift check compares `ops`).

### dead_letter

Find the jobs: `select id, kind, last_error, finished_at from ops.jobs where id = any('{<job_ids>}')`. `last_error` is a
code: fix the cause (provider down, template refused, endpoint gone), then replay with `ops.replay_job(id)` (§11).
`messages_dead_letter` / `webhooks_failed` without dead jobs: a delivery report said `failed` (§11) or the reaper
marked a stuck delivery `outcome_unknown` (§10). A `drill.always_fail` job is the alert drill (below).

### queue_lag

The runner is keeping up too slowly. Check runner passes (§6): `claimed` near the batch (25) every minute means more work
than one pass per minute drains; long `durationMs` means slow providers. Check `cron.job_run_details` for `jobs-kick`
gaps and pg_net `timed_out`. Lag acceptance is p95 < 2 min (roadmap V2-04).

### queue_oldest_due

Due work is not being claimed. Usual causes, in order: `jobs-kick` paused or failing (§6), the deployment has no handler
for the kind (`job_ids` → `kind`), the runner returns 401 (secret/clock, §6), the app is down. `runner_stale` usually
fires with it when the runner itself is down; an `alert.notify` job cannot be delivered while the runner is down, so read
open alerts in the SQL editor or the ops report.

### runner_stale

No successful runner pass in 5 minutes while the scheduler is configured. Check §6 in order: `cron.job_run_details`
(`jobs-kick` ran?), `net._http_response` (status 401/405/5xx or `timed_out`), `ops.job_runner_runs` (`ok = false` and its
`error_code`). The backup job has its own stricter dead-man (`ops.backup_runner_stale()`, 15 min).

### lease_expiry

Handlers ran past their lease (120 s) or the function was killed (Vercel timeout, deploy mid-pass). The re-claimed jobs
finish exactly once (fencing), but repeated expiries burn attempts. Check the `job_ids` kinds and their providers'
latency; a deploy during a pass explains a one-off.

### error_burst

Many server errors in 10 minutes. Read the sink: `select error_name, error_code, route_path, count, last_seen from
ops.error_events order by last_seen desc limit 20` (scrubbed: no PHI). A release that broke a route shows one
fingerprint with a large count; roll back per `docs/runbooks/staging.md`.

### error_sink_overflow

More than 500 new error fingerprints in a UTC day: later new errors are counted, not stored. Usually an error whose
message varies per call (an id in it) or an attack. Find the noisy fingerprints of the day (`group by error_name,
route_path`), fix the source; the cap resets at 00:00 UTC (05:30 IST).

### error_sink_size

`ops.error_events` above 50 MB. The 180-day purge (`ops.purge_error_events()`, scheduled by 04-06's `ops.cleanup`) should
keep it far below: check that the cleanup schedule runs; purge earlier with `select ops.purge_error_events(interval '30
days')` if the database nears its Free-plan limit.

### backup_stale

No `ok` backup in 13 hours, or the latest run failed. `select environment, started_at, status, error_code from
ops.backup_runs order by started_at desc limit 10`, then `docs/runbooks/backup-restore.md` (the failed workflow run and its
issue carry the step that failed). It resolves after the next `ok` run.

### heartbeat_gap

The 6-hourly pg_cron heartbeat stopped: no `ops.heartbeats` row for 7 hours. Usual causes: the project was paused (Free
plan inactivity; the PO gets the Supabase organisation email, 04-P7), pg_cron is down, or the `ops-heartbeat` row was
deactivated (`select jobname, active from cron.job`; `cron.job_run_details` for its last runs). A paused project raises
nothing here (nothing runs): the pause email and the uptime monitor (V2-15) cover it. Resolves after the next heartbeat
(§13).

### quota_upgrade_trigger

A Free-plan metric reached 60 % of its limit (details: `db_*`, `storage_*`, `mau_*` with bytes/users, limit, percent
and level). Roadmap §9.1: this is the upgrade trigger. Check the growth (`select at, db_bytes, storage_bytes,
mau_estimate from ops.quota_snapshots order by at desc limit 14`), the biggest tables (`ops-report` artifact `tables`
block; `pg_total_relation_size`), and plan the Pro upgrade with the PO. Re-sent at most once a day while it lasts (§13).

### quota_critical

A metric reached 70 % of its limit. Upgrade now or free space: Supabase restricts a Free project that exceeds its
database size (read-only mode). Short-term relief: `select ops.cleanup();` early, `select ops.purge_error_events(interval
'30 days');`, and check `cron.job_run_details` / `net._http_response` sizes. After an upgrade, add the new plan's rows to
`ops.quota_limits` and set `ops.settings.plan` in a reviewed migration (§13).

### quota_weekly_summary

Not a problem: the Monday summary of database, Storage and MAU usage against the plan limits, with each level. Egress
is not measured by the job: check Egress in the Supabase dashboard (Organization → Usage) once a month (FT-04). If this
email does not arrive on a Monday, see §13 (the summary is re-tried every 15 minutes for 24 hours, R-51).

### Alert drill

**Local (what CI runs, `tests/jobs/alert-drill-db.spec.ts`):** a `drill.always_fail` job dies after two runner passes,
`ops.evaluate_alerts()` opens `dead_letter`, the runner sends one email to `ops-alerts@example.test` through Mailpit.

**Staging (PO, roadmap "an alert fires in the staging drill"; 04-P7, P8, P9, P12):** with `OPS_ALERT_EMAIL` set in
Vercel `clinicos-staging` (Production scope) and redeployed, the scheduler configured (§2) and `JOBS_DRILL_ENABLED=true`
for the drill (redeploy):

```sql
select ops.drill_enqueue('drill.always_fail', 1, interval '0', 2);
-- wait about 2-3 minutes (two runner passes with backoff), then:
select status, attempts, last_error from ops.jobs where kind = 'drill.always_fail';   -- dead | 2 | drill_failure
select ops.evaluate_alerts();                                                          -- or wait for the 5-minute schedule
select rule, notified_at, notify_count from ops.alerts where status = 'open' and rule = 'dead_letter';
-- within a minute: notified_at set, notify_count 1, and one "[clinicos staging] WARN dead_letter" email in the inbox
delete from ops.jobs where kind = 'drill.always_fail';
```

Then set `JOBS_DRILL_ENABLED=false` again and redeploy. The alert resolves by itself 10 minutes after the drill job
leaves the 15-minute window. Record the drill (time, alert id, provider message id; never the inbox content) in the
phase evidence.

### Readiness flags (R-41)

`/api/ready` returns `jobs: { backlog, dead24h, runnerStale, alertsCriticalOpen }`, booleans only (a due job waiting over
5 min; a job dead in 24 h; a configured runner with no ok pass in 5 min; an open critical alert). They never change the
status code; the uptime monitor (V2-15) decides what pages.

## 13. Heartbeat, quota, retention and the ops report (V2-04 04-06)

FT-03, FT-04 (job part), R-2, R-8, R-28, V2-03 R-27; threats T-04-10, T-04-15, T-04-17, T-04-18. Migration
`000040_ops_heartbeat_quota_report.sql`. Times below are GMT (pg_cron) with IST.

| Schedule | GMT | IST | Does |
|---|---|---|---|
| `ops-heartbeat` `0 */6 * * *` | 00, 06, 12, 18:00 | 05:30, 11:30, 17:30, 23:30 | `ops.heartbeat()`: one `ops.heartbeats` row (`source = pg_cron`) |
| `ops-quota-snapshot` `30 21 * * *` | 21:30 | 03:00 | `ops.quota_snapshot()`: database bytes, Storage bytes, MAU estimate vs `ops.quota_limits` |
| `ops-cleanup` `45 21 * * *` | 21:45 | 03:15 | `ops.cleanup()`: retention below, returns the deleted counts |
| `ops-quota-weekly-summary` `30 3 * * 1` | Mon 03:30 | Mon 09:00 | `ops.enqueue_quota_weekly_summary()`: one `info` email per ISO week |

### Heartbeat (FT-03)

`ops.heartbeat()` inserts one row every 6 hours; rule `heartbeat_gap` (warn) fires when rows exist and the newest is
older than 7 hours. It proves pg_cron is alive inside the database; the per-minute runner calls (§1) are the stronger
"project is active" signal. Supabase's pause and quota warnings go to the organisation's billing email, which must be the
monitored ops inbox (04-P7). Manual check: `select max(at) from ops.heartbeats;`.

### Quota (FT-04, R-8)

`ops.quota_snapshot()` records `pg_database_size()`, the sum of `storage.objects.metadata->>'size'` and the MAU estimate
(users with `last_sign_in_at` in the current UTC calendar month; Supabase counts MAU per billing cycle, so this is a
proxy), with the limits of the plan named in `ops.settings` (`plan = free`: 500 MB database, 1 GB Storage, 50 000 MAU,
decimal units). `ops.quota_level(used, limit)`: `ok` below 60 %, `upgrade_trigger` from 60 %, `critical` from 70 %,
`unknown` without a limit. Rules `quota_upgrade_trigger` (warn) and `quota_critical` (critical) read the newest snapshot
(one alert at a time: critical wins), cooldown 24 h. Egress is not measurable from SQL and stays the PO's monthly
dashboard check (the weekly email says so).

Weekly summary: every Monday 09:00 IST `ops.enqueue_quota_weekly_summary()` takes a fresh snapshot and opens one `info`
alert `quota_weekly_summary` (at most one per ISO week; a second call returns null) with its `alert.notify` job; the
email lists each metric's bytes or users, limit, percent and level, plus the egress note. The rule keeps the alert open
while the email is unsent (R-51 re-tries every 15 minutes, up to 24 hours) and the evaluator resolves it two
evaluations after it is sent.

On a plan upgrade (a reviewed migration, never by hand): `insert into ops.quota_limits (plan, metric, limit_value)
values ('pro', 'db_bytes', …), ('pro', 'storage_bytes', …), ('pro', 'mau', …); update ops.settings set value = 'pro'
where key = 'plan';` with the limits from the plan page at that time.

```sql
select at, db_bytes, storage_bytes, mau_estimate, levels from ops.quota_snapshots order by at desc limit 7;
select ops.quota_snapshot();               -- a snapshot now (postgres only)
```

### Retention (R-2, V2-03 R-27)

| Table | Kept | Column |
|---|---|---|
| `ops.jobs` `done`/`cancelled` | 7 days | `finished_at` (else `updated_at`) |
| `ops.jobs` `dead` | 30 days | `finished_at` (else `updated_at`); `pending`/`running` never |
| `ops.job_runner_runs` | 14 days, plus the newest `ok` pass | `started_at` |
| `ops.inbound_webhook_events` | 30 days | `received_at` |
| `ops.alerts` resolved | 180 days; open alerts never | `resolved_at` |
| `ops.heartbeats` | 90 days, plus the newest | `at` |
| `ops.quota_snapshots` | 400 days, plus the newest | `at` |
| `ops.backup_runs` | 400 days, plus the newest per environment | `created_at` |
| `ops.error_events` (+ overflow counters) | 180 days | `last_seen` (`ops.purge_error_events`, 03-09b) |
| `cron.job_run_details` | 7 days | 04-02's `cron-history-cleanup` (§8) |

The newest heartbeat, snapshot, ok runner pass and backup run stay so a schedule that stopped long ago keeps its alert
firing instead of being purged into silence. `ops.error_events` holds no tenant or user id today (null by design,
03-09b); if a later phase fills them, DPDP erasure must cover the table. Run it early with `select ops.cleanup();`
(postgres only; returns the counts).

### Ops report (R-28)

`ops.report_all(p_hours int default 48)` (definer; no API role may execute it) returns one JSON object: job counts by
kind and status and queue lag p50/p95/max (`first_claimed_at − run_at`, jobs first claimed in the window), jobs dead in
24 h by kind, runner passes (runs, ok runs, largest gap between ok passes, last ok age, `configured`), alerts (rule,
severity, status, timestamps, count, `notified`, `notify_count`, `notify_tries`, `unsent`, `provider_id_present`; never
details or ids), heartbeats (timestamps, largest gap, covered seconds), the latest quota snapshot, backup runs (status,
sizes, codes; no object key) and ops table row counts. Counts, timestamps, job kinds, rule names and codes only.

**PO action 04-P10 (staging SQL editor, once, after the migrate run with 000040).** The read-only role from
`docs/runbooks/staging.md` §3 gets the schema usage and the one function, nothing else (no table grant):

```sql
grant usage on schema ops to clinicos_drift_ro;
grant execute on function ops.report_all(integer) to clinicos_drift_ro;
```

**Workflow `.github/workflows/ops-report.yml`** (daily 05:00 GMT = 10:30 IST, or Actions → "Staging ops report" → Run
workflow; schedules fire once the default branch is `feature/v2`, RL-3). Environment `staging-readonly`, secret
`STAGING_DB_URL_RO`, variable `SUPABASE_PROJECT_REF_STAGING`. Steps: the target guard (`--mask`);
`scripts/ops/ops-report.mjs` refuses any user but `clinicos_drift_ro` (or `clinicos_drift_ro.<ref>` on the pooler), then
runs psql 17 from the digest-pinned image with the connection passed as `PG*` variables by name, inside one read-only
transaction whose first statement refuses a role with a superuser/createrole/createdb/replication/bypassrls attribute,
a membership in another role, a write privilege on any table (outside pg_net's `net` schema, writable by every role on
Supabase) or a create privilege; then `select ops.report_all(48)`; `scripts/ops/check-ops-report.ts` checks the schema
(exact keys and shapes) and scans for phone-, email- and UUID-shaped strings. The job fails only on a refusal, a missing
grant or a schema/PII violation; acceptance results are data. Artifact `ops-report` (`ops-report.json`, `check.json`),
30 days.

| Exit of `ops-report.mjs` / message | Meaning |
|---|---|
| `REFUSED STAGING_DB_URL_RO: …` | not the staging project, or not the read-only role's URL |
| `REFUSED the credentials are not read-only (<reason>)` | the role can change something (`role_attributes`, `role_membership`, `table_write_privilege`, `create_privilege`) or the transaction is not read-only: fix the role (staging.md §3), never the guard |
| `reading ops.report_all failed … 04-P10 grant` | run the two statements above |

**Verify (Claude, read-only):** `gh run list --workflow ops-report.yml --limit 1 --json conclusion,url,headSha`, `gh run
download <id> -n ops-report`, then
`npx tsx scripts/ops/check-ops-report.ts ops-report.json --require heartbeat,quota` (after ≥ 24 h of heartbeats), `--require
lag,alert-drill` after the drill (04-P12), `--require backups` once backups run (04-P6). Requirements: `lag` p95 < 120 s
with ≥ 100 samples; `heartbeat` largest gap ≤ 6 h 15 min over ≥ 24 h; `quota` a snapshot with the three metrics and
levels; `alert-drill` a `dead_letter` alert emailed with a provider id; `backups` ≥ 2 ok staging backups in every full
IST day of the window. Exit 0 pass, 1 failed, 2 usage. The same checker accepts the SQL editor's export of
`select ops.report_all(48);` (`[{"report_all": {…}}]`).

