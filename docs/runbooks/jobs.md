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
erased; the sender gets a reply again only if they write again). Replay only after fixing the cause in `last_error`
(provider down, template missing, endpoint fixed); a replayed message that fails again dead-letters again (no second
"Message Delivery Failed" note). Record the replay (job id, reason) in the incident note.

**Contract (000038).** Members cannot write `communication_queue` or `webhook_delivery_queue` at all (only the
enqueue RPCs, the triggers and the runner do); the migration checks this against the catalogue and fails if any
privilege is back. `ops.backfill_delivery_jobs()` (postgres only) gives every open delivery row its job; it ran once in
the migration and can be run again safely (it returns the number of jobs it created).

