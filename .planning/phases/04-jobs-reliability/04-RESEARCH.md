# Phase 04 (V2-04): Jobs reliability - Research

**Researched:** 2026-11-13
**Domain:** Postgres job queue (claim/lease/reaper), pg_cron + pg_net scheduler, outbox dispatch, inbound-webhook idempotency, ops alerting, Supabase Free-tier compensating controls (backups, heartbeat, quota)
**Confidence:** MEDIUM-HIGH (codebase and local-stack facts verified this session; AWS/Supabase-hosted facts cited or assumed as marked)

> No CONTEXT.md exists for this phase (`init.phase-op 04` → `has_context: false`). Constraints come from CLAUDE.md and the
> approved v2 docs, which the project treats as locked (CLAUDE.md "Sources of truth ... do not contradict").
> V2-03 (platform hygiene) is being implemented concurrently on `v2/phase-03-platform-hygiene`; its outputs
> (`lib/env.ts` zod schema, `lib/supabase/system.ts` `getSystemDb(reason)`, `lib/log/**`, `ops.error_events`,
> `lib/datetime/**`, staging) are treated as forthcoming dependencies. Nothing below plans V2-03 work.

<user_constraints>
## User Constraints (from approved docs; no CONTEXT.md)

### Locked Decisions
- **C22 (scheduler):** "pg_cron + pg_net calling `/api/jobs/run`, defined in a migration so it is visible in the repo and
  independent of the Vercel plan. Vercel Cron is not used" [VERIFIED: docs/v2/V2_MASTER_ROADMAP.md:259].
- **ADR-0005 D3 + register:** "Request-path enqueue of messages and webhook events uses one SECURITY DEFINER enqueue RPC
  that derives the tenant from `auth.uid()` and accepts no tenant argument (V2-04 ...)"; register entries
  "`lib/messaging/dispatcher.ts`, `lib/webhooks/**` and `app/api/cron/**`: until V2-04, which adds the enqueue RPC and
  replaces the cron runners with `app/api/jobs/run`"; "From V2-04 the register holds only the `/api/v1` entry"
  [VERIFIED: docs/adr/0005-confine-service-role-client.md:40-43, 58-59, 86].
- **ADR-0005 D2:** `getSystemDb(reason)` importable only from `lib/jobs/**` (internal part), `features/*/system.ts`,
  `app/api/{jobs,webhooks}/**`; `lib/jobs/**` split into an enqueue surface (never calls `getSystemDb`) and an internal
  part (claim, handlers, runner) importable only from `app/api/jobs/**` [VERIFIED: docs/adr/0005-confine-service-role-client.md:29-38].
- **ADR-009 / TARGET_ARCHITECTURE §3.6, §8:** generic `jobs` table + existing delivery tables; `claim_jobs(kinds, batch,
  lease_seconds)` with `FOR UPDATE SKIP LOCKED` and `locked_until`; expired leases claimable again; pg_cron every minute
  → pg_net POST `/api/jobs/run` "authenticated by a rotating secret"; idempotent handlers (dedupe keys, provider message
  IDs); exponential backoff with jitter; dead letters kept 30 days; per-tenant cap per batch; alert on queue lag, dead
  letters and lease expiries [VERIFIED: docs/v2/TARGET_ARCHITECTURE.md:153, 158, 365-379; docs/v2/ARCHITECTURE_DECISIONS.md:147-167].
- **V2-04 scope / plans / acceptance (roadmap §12.2, verbatim acceptance):** "the parallel-dispatcher test shows 0
  duplicate sends; a stuck `processing` row is reclaimed; queue lag p95 < 2 min in staging (**Assumption (validate)**);
  an alert fires in the staging drill; an encrypted dump of staging lands in the `ap-south-1` bucket twice a day and a
  deliberately failed run raises an alert; the first restore drill rebuilds staging data in a local stack and passes the
  pgTAP RLS suite, with RPO and RTO recorded; the heartbeat row is written every 6 h; the quota job reports database,
  Storage and MAU usage against the 60 %/70 % thresholds." Plans: "04-01 claim/lease/reaper RPC; 04-02 scheduler +
  `/api/jobs/run`; 04-03 remove inline dispatch + webhook idempotency; 04-04 dead-letter and lag alerts; 04-05 FT-02
  backup job + first restore drill; 04-06 FT-03 heartbeat + FT-04 quota monitor." Tests: "concurrency (T-07 subset) with
  N parallel dispatchers; reaper test; MSW contract for MSG91; scheduler migration test on the local stack; the scripted
  restore drill; a quota-threshold unit test." Evidence: "CI links; the staging alert-drill record; the restore-drill
  record in VERIFICATION_LOG; a bucket listing (object names and sizes only, never contents)."
  [VERIFIED: docs/v2/V2_MASTER_ROADMAP.md:772-781].
- **FT-02:** "`supabase db dump` (schema, data, roles) plus Storage object sync, twice a day, from a scheduled task in AWS
  `ap-south-1` (never a GitHub-hosted runner, PO-23(h)); encrypted with age before upload; versioned S3 bucket in
  `ap-south-1` with 30-day retention; failure alert; an on-demand dump before every production migration and purge
  batch; monthly restore drill into a local stack, logged in VERIFICATION_LOG; RPO ≤ 12 h, RTO ≤ 4 h (validate)"
  [VERIFIED: docs/v2/V2_MASTER_ROADMAP.md:570]. Bucket rule: "age encryption before upload, SSE-KMS, versioned bucket,
  30 days; bucket lifecycle: expire current versions at 30 days and noncurrent versions 1 day after they become
  noncurrent, and remove expired delete markers; the FT-02 acceptance check verifies this rule" [VERIFIED: V2_MASTER_ROADMAP.md:366].
  Times: "**twice a day** (02:00 and 14:00 IST)"; "Connect through Supabase's session pooler if direct IPv4 is
  unavailable"; "the private key is held offline by the PO (password manager) with a second copy for break-glass"
  [VERIFIED: docs/v2/INFRASTRUCTURE_ASSESSMENT.md:262-263].
- **FT-03:** "pg_cron heartbeat every 6 h; pause-warning emails to a monitored inbox" [VERIFIED: V2_MASTER_ROADMAP.md:571].
- **FT-04:** "weekly job recording database size, Storage bytes and MAU, alerting at 60 % (upgrade trigger) and 70 %; the
  PO's monthly egress check" (compression is V2-09c) [VERIFIED: V2_MASTER_ROADMAP.md:572]. 60 % levels: "database 300 MB,
  Storage 600 MB, egress 3 GB in a month, MAU 30,000" [VERIFIED: V2_MASTER_ROADMAP.md:378].
- **P1-25 (alerts part) / error sink:** errors go to "`ops.error_events` ... (short retention, alerting through the V2-04
  alert route)" [VERIFIED: V2_MASTER_ROADMAP.md:250].
- **PO-23(h):** "GitHub Actions CI and Claude Code development sessions (code and synthetic data only, never production
  data; the production backup job therefore runs in AWS `ap-south-1`, not on a GitHub-hosted runner, FT-02)"
  [VERIFIED: V2_MASTER_ROADMAP.md:85].
- **pg_cron on Free:** "Confirmed on the staging Free project before the V2-04 scheduler migration merges"
  [VERIFIED: V2_MASTER_ROADMAP.md:375].
- **RL-23 (V2-02 ruling):** "Cron secret compare is `!==` | Recorded for V2-04 (cron replaced by `app/api/jobs/run`)"
  [VERIFIED: .planning/phases/02-ci-e2e-foundations/02-PLAN.md:464].

### Claude's Discretion (delegated to the agent acting as CTO; PO approves at the gate)
- Exact table/RPC names, lease length, batch size, backoff curve, alert thresholds and channel, the AWS runtime for the
  backup task, encryption key custody details, retention of ops tables, restore-drill mechanics.

### Deferred Ideas (OUT OF SCOPE for V2-04)
- Messaging governance at enqueue/send (P1-13, V2-12), reminder producers (P1-14, V2-12), webhook hardening F5
  (`redirect: 'manual'`, IP pinning, `webhook-id` header, Vault-encrypted signing secrets), retention/purge jobs (P1-17,
  V2-13), enqueue *inside* the business transaction for every command (P1-05/F3, V2-07; V2-04 only provides the SQL
  enqueue functions they will call), external uptime monitor and ≥180-day log drain (V2-15), production FT-02 stack
  (V2-15), Pro upgrade (V2-16), FT-04 client-side compression (V2-09c), the generated pgTAP RLS matrix (V2-05 05-01).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| P0-12 | "Atomic job claim + lease + reaper; scheduler per C22; remove inline `dispatchPendingQueue` and fire-and-forget webhook dispatch; webhook idempotency" | §Current State 1-6; Patterns 1-4; Code Examples A-E; Pitfalls 1-9 |
| FT-03 | pg_cron heartbeat every 6 h; pause warnings to a monitored inbox | Pattern 7; Pitfall 11; PO action P-3 |
| P1-25 (part) | Dead-letter and queue-lag alerts (V2-04 alert route; also carries `ops.error_events` alerts) | Pattern 5; ruling R-1, R-5 |
| FT-02 (part) | Backup job built and drilled on staging (production instance in V2-15) | Pattern 6; Code Examples F-H; PO actions P-4…P-9 |
| FT-04 (part) | Quota monitor job (DB, Storage, MAU vs 60 %/70 %) | Pattern 7; Code Example I; ruling R-8 |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Never read/print `.env*`; never run tests, seeds or scripts against hosted Supabase; local stack only
  (`npx supabase start -x studio,edge-runtime,logflare,vector,imgproxy,supavisor`, `npx supabase db reset --local`);
  never `--linked`, never `db push`. NEVER run `seed:cdci*`, `seed:diagnoses`, `msg91:*` or `--env-file=.env` scripts.
  (Note: `npx supabase status -o json` shows `linked_project_ref` — the repo is linked to a hosted project; any
  `--linked` command would hit it.)
- Every tenant table has `tenant_id` + RLS; no service-role client in request paths unless the plan says so; every
  route authenticates, checks permission, derives the tenant from the session.
- No PHI or secrets in logs, fixtures, prompts, commits or docs; synthetic data only.
- Schema changes only via new files in `supabase/migrations/` (expand → migrate → contract); never edit an applied
  migration.
- **Background jobs are idempotent and claim work atomically.** (This phase is the implementation of that rule.)
- No new dependency without stating why in the plan.
- Branch `v2/phase-04-jobs-reliability` off `feature/v2`; PR into `feature/v2`; never touch `main`; no force-push.
- DoD: tests assert real outcomes (no source-grep tests); typecheck/lint/tests green; CI green with 0 retried tests (a
  retry-only pass is a defect); evidence produced by tools (`node scripts/phase-evidence.mjs ...`); isolated reviewer +
  adversarial second review for migrations/RLS/permissions/PHI (this phase qualifies: migrations, grants, secrets,
  backups).
- `.planning/PO-ACTIONS.md` convention: "Agents never wait on these: the code ships behind interfaces with
  local/offline implementations and flags that default **off**" [VERIFIED: .planning/PO-ACTIONS.md:3-5].

## Summary

The messaging outbox is in better shape than VERIFICATION_LOG's D16/F-3b rows (written before V2-01) suggest: since
migration 000024 each `communication_queue` row is claimed atomically by a single conditional `UPDATE` (`status IN
('pending','failed') → 'processing'`), so two dispatchers cannot both send the same row today. What is still broken is
everything around that claim: there is **no lease and no reaper** (a crash after claim leaves the row in `processing`
forever), **no scheduler** (only two `app/api/cron/*` routes that nothing calls, guarded by a non-constant-time `!==`
compare), **inline dispatch on every request** (all 8 `enqueueMessage` call sites send synchronously inside the user's
request), **fire-and-forget webhook dispatch** (`import("./dispatcher").then(...)` after insert), a **non-atomic
webhook dispatcher** (read → POST → update with no claim; overlapping runs double-deliver), **no inbound-webhook
idempotency** (an MSG91 retry re-runs bot replies and side effects, and the bot replies bypass the queue entirely via
`sendDirectWhatsApp`), and a latent bug where **webhook events are silently dropped for non-admin roles** (the enqueue
reads `webhook_subscriptions` under an owner/admin-only RLS policy).

The recommended design is the one the architecture already locks: an `ops.jobs` table claimed with
`FOR UPDATE SKIP LOCKED` plus a lease token (fencing), attempts counted at claim, exponential backoff with jitter, dead
state after `max_attempts`, a pg_cron reaper, and a pg_cron job that calls `/api/jobs/run` every minute through pg_net
with a bearer secret read from Supabase Vault. pg_cron 1.6.4, pg_net 0.20.4 and Vault 0.3.1 are all present in the local
stack (Postgres 17.11): `create extension`, `cron.schedule` and `vault.create_secret` were exercised in a rolled-back
transaction this session. Two security facts surfaced: installing pg_net grants `anon`/`authenticated` USAGE on schema
`net`, EXECUTE on `net.http_post` and SELECT on `net.http_request_queue` (where Supabase warns the decrypted header sits
until sent), so the scheduler migration must revoke those; and pg_net's default request timeout is 2 s, far shorter than
a runner pass.

FT-02 should be built as infrastructure-as-code in `ops/backup/` (one CloudFormation stack: KMS key, versioned
SSE-KMS bucket with the exact lifecycle rule, a CodeBuild project triggered by EventBridge Scheduler at 02:00/14:00
`Asia/Kolkata`, SNS email on failure plus a "no success in 18 h" alarm, and a read-only GitHub OIDC evidence role).
Everything except the AWS side is buildable and testable locally: the dump/encrypt/manifest script runs against the
local stack, the local Supabase Storage S3 endpoint stands in as an S3-compatible target, and the restore drill restores
into a second, separately-ported local stack and runs a drill pgTAP file. The heartbeat and quota monitor are pure SQL
pg_cron jobs writing `ops.*` rows and raising `ops.alerts`, delivered by the runner as email.

**Primary recommendation:** Build `ops.jobs` + `jobs_claim/complete/fail/reap` (04-01) and the Vault-driven
pg_cron→pg_net→`/api/jobs/run` runner (04-02) first; then move every send behind them via SECURITY DEFINER enqueue RPCs
with dedupe keys and an inbound-event dedupe table (04-03); run the AWS backup stack as a parallel PO-dependent track
from day one because its external lead time is the longest.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Job storage, claim, lease, backoff, dead state, reaper | Database (`ops` schema, SECURITY DEFINER RPCs) | — | Atomicity needs row locks in one statement; DB is the only shared state across serverless invocations |
| Schedule (every minute, 6 h, daily) | Database (pg_cron) | — | C22: schedule lives in a migration next to the data |
| Trigger HTTP call to the runner | Database (pg_net + Vault) | — | C22; Vault keeps URL/secret out of migrations |
| Run handlers (send WhatsApp/SMS, deliver webhooks, send alert email) | API / Backend (`app/api/jobs/run` → `lib/jobs` internal) | External providers (MSG91, tenant webhook endpoints, SES) | External calls never inside a DB transaction (TARGET §6 rule 1) |
| Enqueue from request paths | Database (SECURITY DEFINER enqueue RPC) | API (`lib/jobs` enqueue surface on the user client) | ADR-0005 D3; tenant derived in SQL, never from caller input |
| Inbound webhook idempotency | API (`app/api/webhooks/messaging/[provider]`) | Database (`ops.inbound_webhook_events` unique key) | Dedupe must be atomic → unique constraint |
| Alert evaluation | Database (pg_cron SQL `ops.evaluate_alerts()`) | API (runner delivers `alert.notify` email) | Evaluation must not depend on the app being up; delivery needs the email transport |
| Backups, encryption, upload | AWS ap-south-1 (CodeBuild + S3 + KMS) | Database (staging writes `ops.backup_runs` row) | PO-23(h): never a GitHub-hosted runner for real data |
| Backup failure alerting | AWS (EventBridge rule + CloudWatch alarm → SNS email) | Database (in-app `backup_stale` alert) | Two independent paths; AWS side works when the app is down |
| Restore drill | Developer machine (local Supabase stack) | — | 2-project Free cap → no hosted restore target (FT-01) |
| Heartbeat, quota snapshot | Database (pg_cron SQL) | API (alert delivery) | Pure SQL reads of `pg_database_size`, `storage.objects`, `auth.*` |

## Current State (verified this session)

### 1. Queue/outbox tables and migrations

`ls supabase/migrations | wc -l` → 24 files (`000001_foundation.sql` … `000024_queue_payload_and_live_invoice.sql`).

| Table | Defined | Status values (verbatim) | Claim today |
|---|---|---|---|
| `public.communication_queue` | 000014:12-33; columns added 000016, 000024 | `CHECK (status IN ('pending', 'processing', 'sent', 'delivered', 'read', 'failed', 'cancelled', 'dead_letter'));` [VERIFIED: supabase/migrations/000016_comm_queue_delivery_status.sql:8-10] | `communication_queue_claim(p_id UUID)`: single `UPDATE ... SET status = 'processing' ... WHERE q.id = p_id AND q.status IN ('pending', 'failed') AND q.next_retry_at <= now() AND (v_uid IS NULL OR (q.created_by = v_uid AND ...)) RETURNING q.*` [VERIFIED: 000024_queue_payload_and_live_invoice.sql:155-177] |
| `public.webhook_delivery_queue` | 000018:123-138 | `status TEXT NOT NULL DEFAULT 'pending',` — **no CHECK constraint** [VERIFIED: 000018_api_keys_webhooks_dpdp.sql:129]; values written by code: `"delivered"`, `"pending"`, `"failed"` (lib/webhooks/dispatcher.ts:7) | **None.** `.select(...).eq("id", ...)` then `fetch` then `.update(...)` [VERIFIED: lib/webhooks/dispatcher.ts:54-58, 133-142, 158-166] |
| generic `jobs` | does not exist | — | — |
| `cron`, `net`, `vault`, `ops` | no migration creates pg_cron/pg_net or an `ops` schema (grep of `cron\|pg_net` in migrations returns nothing); `ops` arrives with V2-03 (`ops.error_events`) | — | — |

`communication_queue` columns relevant to leases: `retry_count INTEGER NOT NULL DEFAULT 0`, `max_retries INTEGER NOT NULL
DEFAULT 3`, `next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at` [VERIFIED: 000014:24-26, 32]. No
`locked_until`, no lease token. Finish backoff: `WHEN q.retry_count + 1 <= 1 THEN now() + INTERVAL '1 minute'`,
`WHEN q.retry_count + 1 = 2 THEN now() + INTERVAL '5 minutes'`, `ELSE now() + INTERVAL '15 minutes'`; dead letter
`WHEN q.retry_count + 1 >= q.max_retries THEN 'dead_letter'` [VERIFIED: 000024:200-211]. Members hold column-level
INSERT/SELECT only and EXECUTE on claim/finish (`GRANT EXECUTE ON FUNCTION public.communication_queue_claim(UUID) TO
authenticated, service_role;`) [VERIFIED: 000024:119-131, 180, 231]. A trigger redacts link-bearing payload values once a
row reaches `('sent', 'delivered', 'read', 'dead_letter', 'cancelled')` [VERIFIED: 000024:92-113].

Webhook RLS: `CREATE POLICY "webhook_subs_owner_admin"` ... `AND memberships.role IN ('owner', 'admin')` (FOR ALL) on
`webhook_subscriptions`, and the same shape on `webhook_delivery_queue` [VERIFIED: 000018:100-119, 146-166].
`signing_secret TEXT NOT NULL` is plaintext [VERIFIED: 000018:89] (F5, deferred).

### 2. Dispatch code

- `lib/messaging/dispatcher.ts` [VERIFIED: read in full]:
  - `enqueueMessage` inserts, then **dispatches inline** unless `delayUntil`: lines 106-113
    (`await dispatchQueuedMessage(db, enqueued.id);` inside `try { } catch { /* Best effort */ }`).
  - `dispatchQueuedMessage` (155-256): claim RPC → send → `communication_queue_finish` → audit row on sent; in-app
    "Message Delivery Failed" on dead letter; **SMS fallback enqueue** (241-253) — which itself dispatches inline.
  - `dispatchPendingQueue` (262-298): non-atomic `select id ... in status pending/failed ... limit` then per-row claim
    (the per-row claim makes it duplicate-safe; the select is just a hint list).
- `lib/webhooks/outbox.ts` `enqueueWebhookEvent` (27-120): queries active subscriptions **on the caller's client**,
  inserts rows with `payload: rawPayload` (raw TEXT for stable HMAC), then **fire-and-forget**
  `import("./dispatcher").then(({ dispatchWebhookQueueItem }) => { ... dispatchWebhookQueueItem(db, item.id).catch(...) })`
  (lines 98-113).
- `lib/webhooks/dispatcher.ts` `dispatchWebhookQueueItem` (47-227): idempotency check is a read (`if (item.status ===
  "delivered")`, 64-72) — not a claim; SSRF check (`allowHttp: isTest` from `process.env.NODE_ENV === "test" ||
  Boolean(process.env.VITEST)`, 94-97 — E-6 test-env branch, removed by V2-03 03-10); 5 s timeout; backoff 1m/5m/15m/1h/6h
  (31-37); terminal state `"failed"` (there is no `dead_letter` for webhooks).
- `app/api/cron/dispatch-communications/route.ts` and `app/api/cron/webhooks/route.ts`: GET+POST, `if (!cronSecret ||
  authHeader !== \`Bearer ${cronSecret}\`)` (line 9), `getAdminClient()` (line 18), `limit: 50` [VERIFIED].
- Inbound `app/api/webhooks/messaging/[provider]/route.ts`: header secret verified in constant time
  (`timingSafeEqual(sha256(given), sha256(expected))`, lib/messaging/webhook-helpers.ts:40-46); DLR branch updates status
  by `external_message_id` with no dedupe (37-181); **5 direct sends** via `sendDirectWhatsApp` that bypass the queue
  (lines 278, 329, 376, 418, 446); `in_app_notifications` message includes the patient phone
  (`(${queueItem.recipient_phone})`, line 172 — P1-13 territory, flagged for V2-12).
- Messaging provider factory `lib/messaging/index.ts`: `MESSAGING_PROVIDER` default `"dev"`; "If MSG91_AUTH_KEY is not
  configured ... fall back to DevLoggerProvider" (27-31); `MessagingProvider` interface (`lib/messaging/types.ts:31-44`)
  with `DevLoggerProvider`, `Msg91Provider`, `TwilioProvider`, `GupshupProvider`. The offline provider exists behind the
  interface. `Msg91Provider` `fetch` calls have **no timeout** (msg91.ts:47, 115, 182) and no idempotency key.
  `DevLoggerProvider` logs the recipient phone and appends to `.planning/dev-messages.txt`.
- Test lane forces `MESSAGING_PROVIDER: ["dev"]` [VERIFIED: tests/setup/test-env.ts:23]; e2e sets `CRON_SECRET:
  "e2e-not-real"` [VERIFIED: tests/e2e/support/app-env.ts:79].

### 3. Inline dispatch sites (request path)

All 8 `enqueueMessage` callers omit `delayUntil` (grep: only `lib/messaging/governance.ts` mentions it, and governance
has no callers), so every one sends inline:
`features/labs/service.ts:457`, `features/visits/scheduling-service.ts:500`, `features/appointments/system.ts:68, 183`,
`features/referrals/service.ts:610`, `features/prescriptions/service.ts:747`, `features/billing/service.ts:1178, 1395`.
Webhook enqueues (fire-and-forget): `features/labs/service.ts:159`, `features/appointments/system.ts:92, 149`,
`features/consultation/service.ts:727, 743`, `features/prescriptions/service.ts:137`, `features/webhooks/service.ts:263`
(test ping, then **synchronous** `dispatchWebhookQueueItem(supabase, enqueued[0].id)` at 280),
`app/api/v1/lab-orders/route.ts:243`, `app/api/v1/prescriptions/route.ts:269`. Direct sends: the 5 inbound-webhook sites
above; `scripts/msg91-test-send.ts` (never run).

**Latent defect (new finding):** `enqueueWebhookEvent` reads `webhook_subscriptions` on `ctx.db`; RLS lets only
owner/admin see them, so consultation/prescription/lab events triggered by a doctor or receptionist enqueue **nothing**
and return `[]` silently [VERIFIED: lib/webhooks/outbox.ts:39-62 + 000018:100-119]. The SECURITY DEFINER enqueue RPC
fixes this.

### 4. Retry / dead letter today

Messages: retry via `next_retry_at` + `dead_letter` in `communication_queue_finish`; nothing reprocesses them because
nothing calls the cron route. Rows stuck in `processing` are never recovered (no reaper). Webhooks: `pending` with
backoff, terminal `failed`, nothing reprocesses. No alerting beyond an in-app notification row on dead letter.

### 5. Scheduler config

`vercel.json` does not exist (`cat vercel.json` → no such file). No `crons` anywhere; OI-3 ("Is any external or dashboard
cron calling `/api/cron/*`? Is `CRON_SECRET` set?") is still open [VERIFIED: docs/v2/VERIFICATION_LOG.md:185].
`supabase/config.toml`: `schemas = ["public", "storage", "graphql_public"]` (line 6), `extra_search_path = ["public",
"extensions"]` (line 7); no pg_cron/vault settings needed locally [VERIFIED: supabase/config.toml:1-36].

### 6. Local stack capabilities (probed, nothing persisted)

```
$ docker exec supabase_db_clinicos psql -U postgres -d postgres -Atc "show shared_preload_libraries; select name, default_version, installed_version from pg_available_extensions where name in ('pg_cron','pg_net','supabase_vault','pgmq','pgtap','pg_stat_statements') order by 1; select version(); show cron.database_name;"
pg_stat_statements, pgaudit, plpgsql, plpgsql_check, pg_cron, pg_net, pgsodium, auto_explain, pg_tle, plan_filter, supabase_vault
pg_cron|1.6.4|
pg_net|0.20.4|
pg_stat_statements|1.11|1.11
pgmq|1.5.1|
pgtap|1.3.3|
supabase_vault|0.3.1|0.3.1
PostgreSQL 17.11 on aarch64-unknown-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit
postgres
```
In a `BEGIN … ROLLBACK`: `create extension pg_cron` (→ schema `pg_catalog`), `create extension pg_net with schema
extensions`, `cron.schedule('probe-v204','* * * * *',$$select 1$$)` → jobid 1 (`database postgres`, `username
postgres`), `vault.create_secret(...)` → readable in `vault.decrypted_secrets`; `net.http_post(url text, body jsonb,
params jsonb, headers jsonb, timeout_milliseconds integer)`. After rollback, `pg_extension` count for pg_cron/pg_net = 0.
`show cron.timezone` → `GMT`. [VERIFIED: local probe]

Grant probe after `create extension pg_net` (rolled back):
```
net usage auth/anon/service|t|t|t
queue select auth|t
http_post exec auth/anon|t|t
cron usage auth|f
vault usage auth|f
```
[VERIFIED: local probe] → the scheduler migration must `REVOKE` on `net` from `anon, authenticated, PUBLIC`.
`host.docker.internal` resolves inside the DB container on macOS Docker Desktop; `HostConfig.ExtraHosts` is `null`, so on
Linux CI it is **not** guaranteed [VERIFIED: docker inspect] → CI tests must not depend on pg_net reaching the app.

## Standard Stack

### Core (no new runtime dependency)
| Component | Version | Purpose | Why Standard |
|---|---|---|---|
| pg_cron | 1.6.4 (local) | Schedules (1 min kick, reaper, 6 h heartbeat, daily quota, cleanup) | Locked C22; Supabase Cron is pg_cron [CITED: supabase.com/docs/guides/cron] |
| pg_net | 0.20.4 (local) | Async HTTP POST from Postgres to `/api/jobs/run` | Locked C22; "HTTP requests are not started until the transaction is committed" [CITED: supabase.com/docs/guides/database/extensions/pg_net] |
| supabase_vault | 0.3.1 (installed) | Runner URL + bearer secret per environment, out of migrations | Supabase's documented pattern for cron→HTTP [CITED: supabase.com/docs/guides/functions/schedule-functions] |
| Postgres `FOR UPDATE SKIP LOCKED` | PG 17 | Concurrent claim without blocking | Standard Postgres queue pattern (ADR-009) |
| `node:crypto` `timingSafeEqual` | Node 24 | Constant-time secret compare (closes RL-23) | Same pattern already in `webhook-helpers.ts:40-46` |
| age (CLI) | v1.3.2 (2026-08-29) | Encrypt dumps before upload | Locked by FT-02; `gh api repos/FiloSottile/age/releases` [VERIFIED: GitHub API] |
| Supabase CLI `db dump` | repo pin `supabase` 2.120.0 (devDep `^2.15.8`) | roles / schema / data dumps | Supabase's documented backup path [CITED: supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore] |
| PostgreSQL 17 client | AL2023 `postgresql17` | `psql` for manifest + `ops.backup_runs` write; restore | AL2023 ships it in default repos [CITED: repost/AL2023 search result, LOW-MEDIUM] |
| AWS CloudFormation, S3, KMS, CodeBuild, EventBridge Scheduler, SNS, CloudWatch, SSM Parameter Store, IAM OIDC | managed | Backup task as code in ap-south-1 | Scheduler templated targets include "**CodeBuild** – `StartBuild`" [CITED: docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets-templated.html] |

### Supporting (dev/test)
| Library | Version | Purpose | When to Use |
|---|---|---|---|
| `msw` | pin **3.0.3** (published 2026-10-10) | MSG91 HTTP contract tests (TEST_STRATEGY: "Use **MSW** at the HTTP boundary for MSG91") | 04-03 contract tests. **New devDependency — state why in the plan.** |
| pgTAP | 1.3.3 (available locally) | Drill-specific RLS/integrity assertions | Restore drill (04-05) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|---|---|---|
| Custom `ops.jobs` | pgmq 1.5.1 (Supabase Queues, available locally) | ADR-009 lists it as viable, but it has no dedupe key, no per-tenant fairness, needs an exposed `pgmq_public` schema for supabase-js, and one table per queue. Custom table is ~150 lines of SQL, fully testable. **Use custom.** |
| CodeBuild + EventBridge Scheduler | ECS Fargate scheduled task | Needs VPC/subnets, an ECR image and an image-build pipeline. More moving parts for a 2×/day job. |
| CodeBuild | Lambda (container image) | 15-min cap; no Docker, so `supabase db dump` cannot run; must bundle pg_dump 17. Viable fallback. |
| `age` CLI | `age-encryption` npm (typage, verdict OK) | Pure TS, no binary install; but adds a runtime dep to an ops script and the CLI is the reference implementation that streams. Fallback only. |
| SNS email for backup alerts | Slack/WhatsApp | New vendor / template approval; email is already the ops channel (ruling R-1). |

**Installation (dev only, 04-03):**
```bash
npm install --save-dev --save-exact msw@3.0.3
```
Local tool for backup/drill scripts (not an npm dependency): `brew install age` on the PO's machine, or download the
pinned release; CI installs the pinned release with a SHA-256 check.

**Version verification (this session):** `npm view msw dist-tags` → `latest: 3.0.5` (2026-11-11), 3.0.3 published
2026-10-10, engines `node >=22.12.0`, peer deps optional (`typescript >=5.9.x`; installed 5.9.3, vitest 3.2.7, vite
7.3.7). `npm view age-encryption version` → 0.3.1.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---|---|---|---|---|---|---|
| `msw` | npm | project since 2018; latest 3.0.5 published 2026-11-11 | ~33.2M/wk | github.com/mswjs/msw | [SUS] — reason `too-new` (latest release 2 days old) | Flagged — pin **3.0.3** (34 days old), no postinstall; planner adds `checkpoint:human-verify` before install |
| `age-encryption` | npm | 0.3.1 published 2026-08-28 | ~693K/wk | github.com/FiloSottile/typage | [OK] | Approved as fallback only (not recommended primary) |
| `@aws-sdk/client-sesv2` | npm | latest 2026-11-12 | ~9.0M/wk | github.com/aws/aws-sdk-js-v3 | [SUS] — `too-new` | Conditional: only if V2-03 (AUTH-03) ships no reusable email transport; pin a release ≥7 days old; checkpoint |

`postinstall`: none for `msw@3.0.3` (`npm view msw@3.0.3 scripts.postinstall` → empty), none for the others per the
seam. **Packages removed due to [SLOP]:** none. **Packages flagged [SUS]:** `msw`, `@aws-sdk/client-sesv2` (both are
mainstream; the flag is release recency — pinning an older patch resolves it).

## Architecture Patterns

### System Architecture Diagram

```
 Request path (server action / v1 API / inbound webhook)
   │  user JWT client                                   system client (allow-listed paths only)
   ▼                                                     ▼
 public.enqueue_message(...) / public.enqueue_webhook_event(...)   ops.enqueue_*_system(tenant, ...)
   │  SECURITY DEFINER: tenant derived from subject row + membership check; dedupe_key
   ▼  ONE transaction
 communication_queue / webhook_delivery_queue row  +  ops.jobs row (kind, payload{ref}, run_at, dedupe_key UNIQUE)
                                                         │
 pg_cron '* * * * *' ── ops.kick_job_runner() ── Vault(url, secret) ── net.http_post (after commit, timeout 30 s)
                                                         │
                                                         ▼
 POST /api/jobs/run  (Bearer secret, constant-time; middleware bypass; maxDuration 60, budget ~25 s)
   │  getSystemDb("jobs.run")
   ▼
 loop: public.jobs_claim(kinds, batch 25, lease 120 s, worker) ── UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)
   │         returns rows + lease_token, attempts already +1
   ▼
 handler registry (lib/jobs/internal/handlers): message.send │ webhook.deliver │ alert.notify │ test.* (drill)
   │   message.send → communication_queue_claim → provider (MSG91 / dev / sink; 10 s timeout) → communication_queue_finish
   │   webhook.deliver → delivery claim → SSRF check → signed POST (5 s) → delivery finish
   ▼
 jobs_complete(id, token) │ jobs_fail(id, token, error, retryable) → pending+backoff(jitter) │ dead
   ▼
 ops.job_runner_runs (start, end, claimed, ok, failed, dead)  ──►  /api/ready counts (V2-03 health RPC)

 pg_cron '* * * * *'   ops.jobs_reap()          expired leases (attempts ≥ max → dead); delivery rows stuck in processing → failed
 pg_cron '*/5 * * * *' ops.evaluate_alerts()    dead letters, lag p95, oldest due, runner stale, lease expiries, error burst,
                                                 backup stale, heartbeat gap, quota ≥60/70 % → ops.alerts (dedupe, cooldown)
                                                 → enqueue alert.notify job → runner → email (ops inbox)
 pg_cron '0 */6 * * *' ops.heartbeat()          → ops.heartbeats row (FT-03)
 pg_cron daily         ops.quota_snapshot()     → ops.quota_snapshots (FT-04) → alerts at 60 %/70 %
 pg_cron daily         ops.cleanup()            → prune cron.job_run_details (7 d), ops tables per retention

 AWS ap-south-1: EventBridge Scheduler cron(0 2,14 * * ? *) Asia/Kolkata ─► CodeBuild "clinicos-staging-backup"
   SSM SecureString (db url via session pooler, storage S3 keys) ─► supabase db dump ×3 + storage sync + manifest
   ─► tar ─► age -r <primary> -r <break-glass> ─► s3 PutObject (SSE-KMS, versioned, lifecycle 30 d) ─► psql insert ops.backup_runs
   build FAILED/TIMED_OUT ─► EventBridge rule ─► SNS email;  SucceededBuilds < 1 for 18 h ─► CloudWatch alarm ─► SNS email
   GitHub Actions (OIDC, read-only role) ─► list object names + sizes, bucket config ─► evidence artifact

 Restore drill (PO machine): download object ─► age -d ─► second local stack (ports 553xx) ─► psql roles/schema/data
   ─► drill pgTAP + manifest compare ─► RPO/RTO recorded ─► VERIFICATION_LOG
```

### Recommended Project Structure
```
lib/jobs/
├── enqueue.ts            # enqueue surface: calls public.enqueue_* RPCs on the caller's client; never getSystemDb
├── internal/             # importable only from app/api/jobs/** and lib/jobs/internal/** (ESLint, ADR-0005)
│   ├── runner.ts         # claim loop with time budget; records ops.job_runner_runs
│   ├── claim.ts          # jobs_claim / complete / fail wrappers (typed)
│   ├── registry.ts       # kind → handler map; unknown kind → fail non-retryable
│   └── handlers/
│       ├── message-send.ts     # replaces dispatchQueuedMessage
│       ├── webhook-deliver.ts  # replaces dispatchWebhookQueueItem
│       └── alert-notify.ts     # email to OPS_ALERT_EMAIL
└── auth.ts               # constant-time bearer check (current + next secret)
app/api/jobs/run/route.ts # POST only; other methods 405/404
app/api/cron/**           # DELETED
lib/messaging/dispatcher.ts, lib/webhooks/{outbox,dispatcher}.ts  # reduced to pure helpers (send/sign) or removed;
                                                                   # no system-factory import → leave the register
supabase/migrations/0000NN_jobs_queue.sql        # 04-01
supabase/migrations/0000NN_jobs_scheduler.sql    # 04-02
supabase/migrations/0000NN_enqueue_rpcs.sql      # 04-03 (+ inbound dedupe, webhook status CHECK NOT VALID→VALIDATE)
supabase/migrations/0000NN_ops_alerts.sql        # 04-04
supabase/migrations/0000NN_ops_heartbeat_quota.sql # 04-06
supabase/tests/restore_drill_checks.sql          # pgTAP, 04-05
ops/backup/stack.yaml       # CloudFormation (bucket, KMS, roles, CodeBuild + inline buildspec, scheduler, SNS, alarm, OIDC)
ops/backup/backup.sh        # same script the buildspec runs; runnable against the local stack
ops/restore-drill/run.sh    # drill driver; ops/restore-drill/supabase/config.toml (project_id clinicos-drill, ports 553xx)
docs/runbooks/backup-restore.md
.github/workflows/backup-evidence.yml   # OIDC, read-only listing (names/sizes) + bucket config → artifact
```
Migration numbers: take the next free numbers after V2-03 merges (V2-03 03-03 adds a baseline/drift step and migration
immutability; confirm its naming convention at branch time).

### Pattern 1: `ops.jobs` + claim with lease token (04-01)
**What:** single claimable queue; attempts incremented at claim (poison-pill protection); lease token for fencing;
expired leases reclaimable; dead after `max_attempts`.
**When:** every asynchronous side effect.
**Key choices:**
- `dedupe_key TEXT NOT NULL` with `UNIQUE (dedupe_key)`. Do **not** copy TARGET's "`dedupe_key UNIQUE NULLS NOT
  DISTINCT`" literally: with NULLS NOT DISTINCT, a nullable key allows only one NULL row in the whole table (Pitfall 3).
  Recurring kinds put a time bucket in the key (`alert:queue_lag:2026-11-13T10`).
- Statuses: `pending`, `running`, `succeeded`, `dead`, `cancelled`.
- Tenant fairness (TARGET §8): `FOR UPDATE` cannot be combined with window functions, so fairness is a two-step:
  lock up to `batch*4` candidates with SKIP LOCKED, then keep `row_number() over (partition by tenant_id order by
  run_at) <= per_tenant_cap` and update those (the rest are released at statement end). Low cost; include it.
- RLS enabled on `ops.jobs` with no policies; `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; RPC wrappers in
  `public` (PostgREST only exposes `public, storage, graphql_public`) with `REVOKE EXECUTE ... FROM PUBLIC, anon,
  authenticated; GRANT EXECUTE ... TO service_role`. Follow whatever pattern V2-03 sets for `ops.error_events` access.

### Pattern 2: Scheduler = pg_cron → Vault → pg_net (04-02)
- Migration enables `pg_cron` and `pg_net` (`with schema extensions`), revokes `net` privileges from `PUBLIC, anon,
  authenticated`, creates `ops.kick_job_runner()` (SECURITY DEFINER, `search_path=''`) that reads `jobs_runner_url` and
  `jobs_runner_secret` from `vault.decrypted_secrets` and **returns without a request if either is missing** (local/CI
  stacks have no secrets, so the every-minute job is a no-op there).
- `cron.schedule('jobs-kick', '* * * * *', 'select ops.kick_job_runner()')` — name-keyed so re-running the migration
  updates rather than duplicates (verify in the migration test).
- `timeout_milliseconds => 30000` (default is 2000 [CITED: pg_net docs]); the runner budget (~25 s) stays below it.
- Secrets per environment are created by the PO in Vault (never in a migration, never in git); the same secret value is
  set as `JOBS_RUNNER_SECRET` in the app environment. Rotation: app accepts `JOBS_RUNNER_SECRET` and
  `JOBS_RUNNER_SECRET_NEXT`; rotate Vault to NEXT, then promote.
- Supabase's own warning: "Any role that can log in to your database can read the secret key while the request waits"
  and pg_net "writes the decrypted key to `net.http_request_queue` until it sends the request" [CITED:
  supabase.com/docs/guides/functions/schedule-functions] → use a **dedicated** runner secret that authorizes nothing but
  the idempotent runner; never the service-role key; revoke `net` from API roles.
- Middleware: add `/api/jobs/run` to the early-return list beside `/api/health`/`/api/ready` (middleware.ts:18) so the
  per-minute call does not create a Supabase Auth round trip.
- Pausing side effect: each runner pass makes PostgREST calls (claim RPC), i.e. "API calls ... through a connected
  application" — the activity Supabase documents as preventing pause [CITED: supabase.com/docs/guides/platform/free-project-pausing].

### Pattern 3: Enqueue RPCs + dedupe keys (04-03)
- `public.enqueue_message(p_subject_kind, p_subject_id, p_channel, p_message_type, p_template_id, p_template_params,
  p_recipient_phone, p_recipient_user_id, p_metadata, p_run_at, p_dedupe_key)` SECURITY DEFINER: resolves `tenant_id`
  from the subject row (visit / patient / invoice / referral / lab document), requires it ∈
  `current_user_tenant_ids()`, inserts the `communication_queue` row (`created_by = auth.uid()`) and an `ops.jobs` row
  (`kind 'message.send'`, payload `{queue_id}`, dedupe key = caller's business key or `msg:<queue_id>`), returns
  `{id, status}` only. Ruling R-6 explains why the tenant comes from the subject (multi-clinic users have no DB-side
  "active tenant"; `lib/auth/tenant.ts:64-81` uses the `clinic_active_tenant` cookie).
- `public.enqueue_webhook_event(p_event_type, p_subject_kind, p_subject_id, p_payload)` SECURITY DEFINER: same tenant
  derivation; reads active subscriptions **as definer** (fixes the owner/admin-only silent drop), builds the envelope
  text once (stable HMAC), inserts one delivery row per subscription + one `webhook.deliver` job each; unique
  `(subscription_id, event_id)` on the delivery table (outbound idempotency).
- Internal SQL functions `ops.enqueue_message_internal(p_tenant_id, ...)` / `ops.enqueue_webhook_internal(...)` hold the
  logic; the public RPCs wrap them; service-role callers (inbound webhook route, v1 API) and future P1-05 command RPCs
  call the internal ones inside their own transaction.
- Remove: inline dispatch (dispatcher.ts:106-113), fire-and-forget import (outbox.ts:98-113), synchronous test-ping
  dispatch (features/webhooks/service.ts:280 → return `{queued, deliveryId}`; UI shows "queued, delivered within a
  minute"), the 5 `sendDirectWhatsApp` calls in the inbound route (→ `ops.enqueue_message_internal` with dedupe key
  `bot:<inbound-dedupe-key>:<template>`), and the SMS-fallback inline path (fallback becomes an enqueue with dedupe key
  `msg-fallback:<queue_id>`).
- Contract step (same phase, after callers move): `REVOKE EXECUTE` on `communication_queue_claim/finish` from
  `authenticated` (members no longer dispatch); delete `app/api/cron/**`; drop `CRON_SECRET` from env schema, e2e env
  and guard manifest; ESLint register keeps only `/api/v1`.

### Pattern 4: Inbound webhook idempotency (04-03)
`ops.inbound_webhook_events(provider, dedupe_key, received_at, processed_at, outcome)` with `UNIQUE(provider,
dedupe_key)`; no payload stored (PII). Key: DLR → `dlr:<requestId>:<normalisedStatus>`; inbound → provider message id
when present in the payload, else `sha256(rawBody)` (a provider retry resends the identical body). Flow: `INSERT ... ON
CONFLICT DO NOTHING RETURNING`; conflict with `processed_at` set → 200 "duplicate"; conflict with `processed_at` null and
`received_at` older than 5 min → reprocess (crash recovery); else 200 (in flight). Mark processed at the end. Retention
30 days via the cleanup cron. Also make DLR status monotonic (`failed` must not overwrite `delivered`/`read`).

### Pattern 5: Alerts (04-04)
`ops.alerts(rule, dedupe_key, severity, first_seen, last_seen, count, details jsonb (counts/ids only), notified_at,
resolved_at)`; `ops.evaluate_alerts()` every 5 min (pure SQL, works when the app is down); notification = enqueue
`alert.notify` job (dedupe per rule per hour) → runner emails `OPS_ALERT_EMAIL`. Rules and thresholds: ruling R-5.
Staging drill: a `test.always_fail` job kind, enabled only when `JOBS_DRILL_ENABLED=true` (env flag, default off), dead
letters after `max_attempts` → `dead_letter` alert → email; evidence = exported `ops.alerts` row + provider message id.
Gap: if the runner itself is dead, alert *delivery* stops; detection then relies on the AWS backup task (checks
`ops.job_runner_runs` freshness twice a day and fails the build → SNS) and, from V2-15, the external uptime monitor on
`/api/ready` (which should report `jobs_runner_last_success_at` and dead/lag counts).

### Pattern 6: FT-02 backup task (04-05)
- One CloudFormation stack per environment (`clinicos-staging-backup` now; `clinicos-prod-backup` in V2-15, separate
  bucket, KMS key, age keys).
- Buildspec (inline in the template; identical logic in `ops/backup/backup.sh`):
  1. install pinned `age` (SHA-256 checked) and `postgresql17`; Docker (privileged mode) for `supabase db dump`;
  2. `npx --yes supabase@<repo pin> db dump --db-url "$DB_URL" -f roles.sql --role-only`, `-f schema.sql`,
     `-f data.sql --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes -x cron.job
     -x cron.job_run_details -x net.http_request_queue -x net._http_response` (the CLI's data dump includes `auth`,
     `storage`, `cron` and `net` data and excludes `vault` and `supabase_migrations` [VERIFIED: `npx supabase db dump
     --local --data-only --use-copy --dry-run`]); plus `--schema supabase_migrations` schema+data for history;
  3. `aws s3 sync s3://<bucket> ./storage --endpoint-url https://<ref>.storage.supabase.co/storage/v1/s3` per bucket
     (Supabase S3 keys; they "bypass RLS policies" [CITED: supabase.com/docs/guides/storage/s3/authentication]);
  4. `manifest.json`: row count per table, `pg_database_size`, object count/bytes, CLI/pg versions, start/end times;
  5. `tar` → `age -r <primary> -r <breakglass>` → `aws s3 cp --sse aws:kms --sse-kms-key-id <key>` to
     `staging/<UTC timestamp>.tar.age` (names carry no tenant or patient data);
  6. `psql "$DB_URL" -c "insert into ops.backup_runs ..."` (size, duration, object key) → in-app `backup_stale` alert source;
  7. also checks `ops.job_runner_runs` freshness and fails loudly if stale (dead-man for the scheduler).
- Connection: Supabase direct connections are IPv6; "If your network doesn't support IPv6 and you don't have the IPv4
  add-on enabled, use the Session pooler connection string instead" [CITED: Supabase backup-restore guide] → store the
  **session pooler** URI (port 5432) in SSM.
- Bucket: versioning on; default encryption SSE-KMS with bucket key; Block Public Access all four; policy denying
  `aws:SecureTransport = false`; lifecycle `Expiration.Days 30`, `NoncurrentVersionExpiration.NoncurrentDays 1`,
  `ExpiredObjectDeleteMarker true` (S3 behaviour confirmed in VERIFICATION_LOG R6 [VERIFIED: docs/v2/VERIFICATION_LOG.md:447]);
  writer role has `s3:PutObject` on `staging/*` only — **no** `DeleteObject`, no `GetObject`.
- Alerts: EventBridge rule on `CodeBuild Build State Change` with `build-status` in `FAILED`, `TIMED_OUT`, `STOPPED` →
  SNS email; CloudWatch alarm on `AWS/CodeBuild SucceededBuilds` (Sum, period 21600 s, 3 of 3 datapoints < 1,
  `TreatMissingData: breaching`) → SNS (catches "schedule never fired").
- Evidence: `.github/workflows/backup-evidence.yml` assumes a read-only OIDC role (`s3:ListBucket`,
  `s3:ListBucketVersions`, `s3:GetBucketVersioning`, `s3:GetLifecycleConfiguration`, `s3:GetEncryptionConfiguration`,
  `s3:GetBucketPolicy`, `codebuild:ListBuildsForProject`, `codebuild:BatchGetBuilds`) and uploads names/sizes/config as
  an artifact — tool-produced evidence, no object contents ever leave AWS. Repo: `thecliniqai/cliniqai-app`
  [VERIFIED: .planning/PO-ACTIONS.md C-1].
- Restore drill (`ops/restore-drill/run.sh --dump <file.tar.age> --identity <path outside repo>`): starts a second local
  stack from `ops/restore-drill/supabase/config.toml` (own `project_id`, ports 553xx, no migrations folder), restores
  per Supabase's procedure (`psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql
  --command 'SET session_replication_role = replica' --file data.sql` [CITED: Supabase backup-restore guide]) then
  history; runs `supabase/tests/restore_drill_checks.sql` (pgTAP) + manifest compare; prints RPO (incident time − dump
  start) and RTO (drill start → checks green); appends nothing by hand — output is the evidence file.

### Pattern 7: Heartbeat and quota (04-06)
- `ops.heartbeats(source, at)`; `cron.schedule('ops-heartbeat', '0 */6 * * *', 'select ops.heartbeat()')`; alert if no
  row for 7 h. The per-minute runner already generates PostgREST traffic; the heartbeat is the evidence row the
  acceptance asks for. pg_cron counting toward activity remains **Assumption (validate)** (Supabase's pausing page does
  not mention cron [CITED]).
- `ops.quota_limits(plan, metric, limit_bytes_or_count)` seeded for `free` (DB 500 MB, Storage 1 GB, MAU 50,000; decimal
  units = conservative) so the Pro upgrade is a row update; `ops.quota_snapshots(at, db_bytes, storage_bytes,
  mau_estimate)`; `ops.quota_level(used, limit)` returns `ok` (< 60 %), `upgrade_trigger` (≥ 60 %), `critical` (≥ 70 %).
  Sources: `pg_database_size(current_database())`; `sum((metadata->>'size')::bigint) from storage.objects`; MAU proxy =
  distinct users with `auth.users.last_sign_in_at` or an `auth.sessions` refresh in the current calendar month
  [ASSUMED proxy; Supabase's billing MAU definition not verified]. Egress stays a PO monthly dashboard check.

### Anti-Patterns to Avoid
- **Calling the provider inside the claim transaction** — holds row locks across HTTP; claim commits first, send, then
  complete in a new call.
- **Using `updated_at` as the lease** — any unrelated update extends it; use `locked_until` + `lease_token`.
- **Completing without fencing** — a worker whose lease expired must not overwrite a newer claim's outcome
  (`WHERE lease_token = p_token AND status = 'running'`).
- **Service-role key as the cron secret** — it would sit decrypted in `net.http_request_queue` (Supabase warning).
- **Scheduling with environment URLs in migrations** — migrations are shared by local, CI, staging, prod.
- **Restoring `cron.job` rows into the drill stack** — would start calling the staging runner from a laptop (exclude
  `cron.*`/`net.*` data from dumps).
- **Alert bodies with PHI** — alerts carry counts, rule names and queue ids only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Scheduling | A `setInterval`/Vercel Cron/external pinger | pg_cron (C22) | Locked; survives app deploys |
| Outbound HTTP from Postgres | `http` extension (sync) or plpython | pg_net (async, after commit) | Never blocks the transaction |
| Secret storage for the scheduler | GUCs, a table, migration literals | Supabase Vault | Encrypted at rest; per environment |
| File encryption | OpenSSL `enc`, custom AES, gpg passphrases | age (X25519 recipients) | Simple, audited, multi-recipient; locked by FT-02 |
| Postgres dump logic | Hand-written `pg_dump` flag lists | `supabase db dump` (exact flags + sed filters shown by `--dry-run`) | Encodes Supabase role/schema exclusions |
| Backup scheduling/retries | cron on an EC2 box | EventBridge Scheduler (timezone `Asia/Kolkata`, retry policy) | Managed, no host |
| Constant-time compare | `===`/`!==` | `timingSafeEqual(sha256(a), sha256(b))` (existing helper pattern) | Closes RL-23 |
| HTTP mocking for MSG91 | `vi.stubGlobal('fetch')` | MSW `setupServer` | TEST_STRATEGY mandates MSW at the HTTP boundary |
| Bucket retention | A cleanup script | S3 lifecycle rule | Declarative and verifiable by `get-bucket-lifecycle-configuration` |

**Key insight:** every correctness property here (exactly-one claim, lease expiry, dedupe, retention) must be a database
or bucket *constraint*, because the runtime is serverless and can be killed at any point.

## Runtime State Inventory

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | `communication_queue` rows in `pending`/`failed`/`processing` and `webhook_delivery_queue` rows in `pending` on any hosted DB (test project, later staging) have no `ops.jobs` row | Data migration in the 04-03 migration: backfill one `ops.jobs` row per open delivery row (dedupe `msg:<id>` / `wh:<id>`); move `processing` rows older than the lease to `failed` first. Synthetic data only; idempotent via dedupe keys |
| Live service config | OI-3 unresolved: unknown whether any Vercel/dashboard/external cron calls `/api/cron/*` | PO checks Vercel project → Settings → Cron Jobs and any external pinger; routes are deleted in 04-03, so a leftover caller gets 404 (harmless) — record the answer |
| OS-registered state | None — no launchd/systemd/pm2 in this repo (verified: no such files; scheduler is pg_cron) | None |
| Secrets / env vars | `CRON_SECRET` (code: cron routes, guard tests, `tests/e2e/support/app-env.ts:79`, `docs/ops/secret-rotation.md:29`) is retired; new: `JOBS_RUNNER_SECRET`, `JOBS_RUNNER_SECRET_NEXT` (optional), `OPS_ALERT_EMAIL`, `JOBS_DRILL_ENABLED` (default off) in the V2-03 env schema; Vault secrets `jobs_runner_url`, `jobs_runner_secret` per hosted project | Code edit (env schema, tests, docs) + PO sets values (P-2) + PO deletes `CRON_SECRET` from Vercel envs after deploy |
| Build artifacts | None (no compiled artifacts carry these names) | None |

## Common Pitfalls

### Pitfall 1: pg_net's 2-second default timeout
**What goes wrong:** every runner call is recorded as a timeout; if the platform aborts the function on client
disconnect, work is cut mid-batch. **How to avoid:** `timeout_milliseconds => 30000`, runner budget ~25 s, `maxDuration
= 60`, idempotent handlers so a cut batch is safe. **Warning sign:** `net._http_response.timed_out` rows every minute.

### Pitfall 2: lease shorter than the slowest handler
**What goes wrong:** a slow MSG91 call outlives the lease, another runner reclaims and sends again. **How to avoid:**
lease 120 s ≫ provider timeout 10 s (add `AbortSignal.timeout(10_000)` to `Msg91Provider` — it has none today) and ≫
runner budget; fencing on complete; the delivery-row claim (`pending/failed → processing`) as a second guard.

### Pitfall 3: `UNIQUE NULLS NOT DISTINCT` on a nullable dedupe key
Only one NULL is then allowed table-wide; jobs without a key fail on insert. Make `dedupe_key NOT NULL`.

### Pitfall 4: `FOR UPDATE` with window functions
Postgres rejects `FOR UPDATE` in a query with window functions; do fairness in an outer query over a locked inner set.

### Pitfall 5: pg_net privileges granted to API roles
After `create extension pg_net`, `anon`/`authenticated` have USAGE on `net`, EXECUTE on `net.http_post`, SELECT on
`net.http_request_queue` (local probe). Revoke in the migration and assert in the migration test.

### Pitfall 6: CI cannot reach the app from the DB container
`host.docker.internal` is not configured on Linux runners (`ExtraHosts: null`), and the e2e server binds loopback only.
Test the DB side (cron rows, `net.http_request_queue` row created inside a rolled-back transaction) and the route side
separately; do the end-to-end pg_net → app check once locally on macOS and on staging.

### Pitfall 7: unknown-outcome sends after a crash
A crash between the provider call and `finish` leaves the outcome unknown. MSG91 offers no documented idempotency key
[ASSUMED: none found in search]. Ruling R-7: retry (at-least-once) and record `outcome_unknown` in the job error.

### Pitfall 8: dumps that restore jobs and secrets
The CLI data dump includes `cron.job` and `net.*`; restoring them schedules calls from the drill stack. Exclude them.
`vault` is excluded by the CLI, so Vault secrets must be re-provisioned after any real restore (runbook step).

### Pitfall 9: the existing test suites encode inline dispatch
`tests/messaging/outbox-queue.spec.ts:236` ("enqueueMessage dispatches only the row it inserted"),
`tests/security/review3-fixes-db.spec.ts:244-338` (member claims its own row), `tests/messaging/msg91-webhook.spec.ts` and
`tests/security/webhook-lockdown.spec.ts` (spy on `sendDirectWhatsApp`), `tests/api/webhooks-outbox.spec.ts:480-521`
(cron route + `CRON_SECRET`), `tests/security/guard-manifest.ts:189-197` (cron entries). They must be rewritten to the
new contracts in the same PR, not deleted wholesale.

### Pitfall 10: cron history growth on a 500 MB database
"`cron.job_run_details` is never cleaned up automatically" [CITED: supabase.com/docs/guides/cron/quickstart]; at 1 440+
runs/day per job it grows steadily. Schedule the cleanup in the same migration.

### Pitfall 11: Supabase "user activity" vs internal cron
Supabase's pausing page speaks of "user queries"/"API calls" and is silent on cron [CITED]. Do not rely on the
heartbeat alone; the per-minute runner's PostgREST calls are the stronger signal; pause-warning emails must reach the
PO's monitored inbox (PO action).

### Pitfall 12: local `pg_dump` is too old
Host `pg_dump` is 14.21; the stack is 17.11. Use `npx supabase db dump` (Dockerised) or the container's `pg_dump`
17.11 (`docker exec supabase_db_clinicos pg_dump --version`) for local tests.

## Code Examples

> Names below that are not quoted from the repo are **proposals** for the planner (no in-repo source).

### A. Claim / complete / fail (04-01)
```sql
-- Proposed. Source pattern: ADR-009, TARGET_ARCHITECTURE §8.
create table ops.jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','running','succeeded','dead','cancelled')),
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  locked_until timestamptz,
  lease_token uuid,
  locked_by text,
  last_error text check (char_length(last_error) <= 500),
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint jobs_dedupe_key_unique unique (dedupe_key)
);
create index jobs_due_idx on ops.jobs (run_at) where status = 'pending';
create index jobs_lease_idx on ops.jobs (locked_until) where status = 'running';
alter table ops.jobs enable row level security;
revoke all on ops.jobs from public, anon, authenticated;

create or replace function public.jobs_claim(p_kinds text[], p_batch int, p_lease_seconds int,
                                             p_worker text, p_per_tenant int default 10)
returns setof ops.jobs
language plpgsql volatile security definer set search_path = '' as $$
begin
  return query
  with locked as (
    select j.id, j.tenant_id, j.run_at
    from ops.jobs j
    where j.kind = any (p_kinds)
      and ((j.status = 'pending' and j.run_at <= now())
           or (j.status = 'running' and j.locked_until < now() and j.attempts < j.max_attempts))
    order by j.run_at
    limit greatest(p_batch, 1) * 4
    for update skip locked
  ), fair as (
    select id from (
      select l.id, row_number() over (partition by l.tenant_id order by l.run_at) as rn, l.run_at
      from locked l) x
    where x.rn <= p_per_tenant
    order by x.run_at
    limit p_batch
  )
  update ops.jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         locked_until = now() + make_interval(secs => p_lease_seconds),
         lease_token = gen_random_uuid(),
         locked_by = left(p_worker, 64),
         updated_at = now()
    from fair f
   where j.id = f.id
  returning j.*;
end $$;
revoke execute on function public.jobs_claim(text[], int, int, text, int) from public, anon, authenticated;
grant execute on function public.jobs_claim(text[], int, int, text, int) to service_role;

-- jobs_fail: retryable and attempts < max → pending with backoff + jitter; else dead.
--   run_at = now() + least(interval '6 hours', interval '30 seconds' * power(2, attempts - 1)) * (0.5 + random() / 2)
-- jobs_complete / jobs_fail both: WHERE id = p_id AND lease_token = p_token AND status = 'running' (fencing).
-- jobs_reap (pg_cron, every minute): running AND locked_until < now() AND attempts >= max_attempts → dead;
--   communication_queue status 'processing' AND updated_at < now() - interval '5 minutes' → 'failed' (retry path).
```

### B. Scheduler migration (04-02)
```sql
-- Proposed. Source: supabase.com/docs/guides/functions/schedule-functions (Vault + cron + pg_net), local probe.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
revoke usage on schema net from public, anon, authenticated;
revoke all on all tables in schema net from public, anon, authenticated;
revoke execute on all functions in schema net from public, anon, authenticated;

create or replace function ops.kick_job_runner() returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'jobs_runner_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'jobs_runner_secret';
  if v_url is null or v_secret is null then return null; end if;   -- local/CI: no-op
  return net.http_post(
    url := v_url,
    body := jsonb_build_object('source', 'pg_cron'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 30000);
end $$;
revoke execute on function ops.kick_job_runner() from public, anon, authenticated;

select cron.schedule('jobs-kick', '* * * * *', 'select ops.kick_job_runner()');
select cron.schedule('jobs-reap', '* * * * *', 'select ops.jobs_reap()');
select cron.schedule('cron-history-cleanup', '15 0 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$);
```
PO-side, per hosted project (SQL editor; values never in git):
`select vault.create_secret('<https://staging-host>/api/jobs/run', 'jobs_runner_url');`
`select vault.create_secret('<random 64 hex>', 'jobs_runner_secret');`

### C. Runner route (04-02)
```ts
// Proposed: app/api/jobs/run/route.ts
import { NextRequest, NextResponse } from "next/server";
import { isAuthorisedRunner } from "@/lib/jobs/auth";          // sha256 + timingSafeEqual, current + NEXT secret
import { runJobs } from "@/lib/jobs/internal/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isAuthorisedRunner(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false }, { status: 401 });     // fail closed when the secret is unset
  }
  const summary = await runJobs({ budgetMs: 25_000, batch: 25, leaseSeconds: 120 });
  return NextResponse.json({ ok: true, ...summary });            // counts only
}
// GET/PUT/PATCH/DELETE → 405 (no secret in query strings, no GET side effects)
```

### D. Constant-time check (pattern already in repo)
```ts
// Source: lib/messaging/webhook-helpers.ts:40-46 (verbatim pattern)
export function verifyMsg91WebhookSecret(headers: Headers): boolean {
  const expected = process.env.MSG91_WEBHOOK_SECRET;
  if (!expected) return false;
  const given = headers.get(MSG91_WEBHOOK_SECRET_HEADER);
  if (!given) return false;
  return timingSafeEqual(sha256(given), sha256(expected));
}
```

### E. Parallel-dispatcher test shape (04-01/04-03)
```ts
// Proposed: tests/jobs/parallel-dispatch-db.spec.ts (local stack only)
// seed 200 message.send jobs (+ 200 communication_queue rows) via the local service-role client;
// inject a recording provider through the handler registry (no network);
const runs = await Promise.all(Array.from({ length: 8 }, (_, i) =>
  runJobs({ budgetMs: 15_000, batch: 10, leaseSeconds: 60, worker: `w${i}`, provider: recorder })));
expect(recorder.sentQueueIds.length).toBe(200);
expect(new Set(recorder.sentQueueIds).size).toBe(200);   // 0 duplicate sends
// reaper: claim one job with lease 1 s, do not complete, wait 1.5 s → jobs_claim returns it again (attempts 2);
// complete with the first lease_token → refused (fencing); attempts = max → jobs_reap marks it dead.
```

### F. Lifecycle rule (CloudFormation fragment, 04-05)
```yaml
# Proposed: ops/backup/stack.yaml (bucket). Rule text from roadmap §9.1 / VERIFICATION_LOG R6.
LifecycleConfiguration:
  Rules:
    - Id: retain-30-days
      Status: Enabled
      Prefix: ""
      ExpirationInDays: 30
      NoncurrentVersionExpiration: { NoncurrentDays: 1 }
    - Id: remove-expired-delete-markers
      Status: Enabled
      Prefix: ""
      ExpiredObjectDeleteMarker: true
VersioningConfiguration: { Status: Enabled }
BucketEncryption:
  ServerSideEncryptionConfiguration:
    - ServerSideEncryptionByDefault: { SSEAlgorithm: aws:kms, KMSMasterKeyID: !Ref BackupKey }
      BucketKeyEnabled: true
PublicAccessBlockConfiguration:
  { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true }
```
(Within one rule, S3 does not allow `ExpirationInDays` together with `ExpiredObjectDeleteMarker`, hence two rules
[ASSUMED from S3 API rules; validate with `cfn-lint`/a deploy].)

### G. Schedule (CloudFormation fragment)
```yaml
BackupSchedule:
  Type: AWS::Scheduler::Schedule
  Properties:
    ScheduleExpression: cron(0 2,14 * * ? *)
    ScheduleExpressionTimezone: Asia/Kolkata
    FlexibleTimeWindow: { Mode: "OFF" }
    Target:
      Arn: !GetAtt BackupProject.Arn          # CodeBuild StartBuild templated target
      RoleArn: !GetAtt SchedulerRole.Arn
      RetryPolicy: { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 3600 }
```

### H. Restore (Supabase-documented order)
```bash
# Source: supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql --dbname "$DRILL_DB_URL"
```

### I. Quota level (04-06)
```sql
-- Proposed
create or replace function ops.quota_level(p_used numeric, p_limit numeric) returns text
language sql immutable set search_path = '' as $$
  select case when p_limit is null or p_limit <= 0 then 'unknown'
              when p_used >= p_limit * 0.70 then 'critical'
              when p_used >= p_limit * 0.60 then 'upgrade_trigger'
              else 'ok' end $$;
-- unit cases: (299999999, 500000000) → ok; (300000000, 500000000) → upgrade_trigger; (350000000, 500000000) → critical
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Per-request inline sends | Transactional outbox + DB queue + scheduler | ADR-009 (2026-11) | Request latency drops; retries actually happen |
| Vercel Cron | pg_cron + pg_net (C22) | Roadmap round 3 | Schedule independent of the Vercel plan |
| Service key in cron headers (Supabase examples) | Dedicated runner secret | — | Limits blast radius of `net.http_request_queue` exposure |
| `msw` 2.x | `msw` 3.x (3.0.0 on 2026-09-28) | 2026-09 | Node ≥ 22.12; repo is on Node 24 |

**Deprecated/outdated in repo:** `docs/ops/backup-restore.md` and `docs/operations/backups.md` (unverified claims per
INFRA F-4) → replaced by `docs/runbooks/backup-restore.md` (roadmap path; INFRA §4.7 item 1 named `docs/ops/…` — the
roadmap is the newer source; leave a one-line pointer in the old files or delete them, ruling R-10).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | pg_cron and pg_net can be enabled on the staging **Free** project | Stack, Pattern 2 | Scheduler design fails; roadmap requires PO confirmation before the migration merges (P-1) |
| A2 | pg_cron activity counts against Free pausing | Pattern 7 | Mitigated: runner makes PostgREST calls every minute |
| A3 | Supabase Storage S3 protocol is available on Free | Pattern 6 | Fallback: Node script with supabase-js service role (Supabase's documented storage-migration path) |
| A4 | CodeBuild without VPC lacks IPv6, so the session pooler is required | Pattern 6 | None if wrong (pooler works either way) |
| A5 | `postgresql17` is in AL2023 default repos | Stack | Fallback: use the Dockerised `supabase db dump` only and `docker run postgres:17 psql` |
| A6 | MSG91 has no idempotency key for sends | Pitfall 7 | If it has one, use it and tighten R-7 |
| A7 | MAU proxy from `auth.users`/`auth.sessions` approximates Supabase billing MAU | Pattern 7 | Irrelevant at pilot scale (≈25 users vs 50,000) |
| A8 | `cron.schedule(name, ...)` upserts by name in pg_cron 1.6.4 | Pattern 2 | Duplicate jobs after re-run → the migration test catches it |
| A9 | Vercel lets a Node route run ~25-60 s for the runner | Pattern 2 | Lower the budget; batches just get smaller |
| A10 | S3 rejects `Expiration` + `ExpiredObjectDeleteMarker` in one rule | Code F | Template lint/deploy fails fast |
| A11 | RPO ≤ 12 h / RTO ≤ 4 h are achievable (roadmap marks them "validate") | Pattern 6 | Drill records reality; R-4 |
| A12 | Staging uses a sink/dev messaging provider, never real MSG91 | Ruling R-9 | Real WhatsApp to synthetic numbers; CLAUDE.md forbids real sends from scripts |

## Recommended CTO Rulings (Open Questions)

1. **R-1 Alert channel.** Email only for v2.0 UAT: app alerts via the V2-03 SES transport to `OPS_ALERT_EMAIL` (a
   PO-monitored mailbox, also the Supabase pause-warning address); backup alerts via AWS SNS email to the same inbox
   (independent path). No Slack/WhatsApp (new vendor or template approval; PO-23(h)). Severity in the subject line;
   bodies carry counts and ids only.
2. **R-2 Retention of ops data.** `ops.jobs` succeeded 7 days, dead 30 days (TARGET §8); `ops.job_runner_runs` 14 days;
   `cron.job_run_details` 7 days; `ops.inbound_webhook_events` 30 days; `ops.alerts` 180 days (FT-07 spirit);
   `ops.heartbeats` 90 days; `ops.quota_snapshots` and `ops.backup_runs` 400 days (tiny). Backups 30 days (locked).
3. **R-3 Encryption.** age X25519 with **two recipients**: primary (PO password manager) and break-glass (sealed
   offline copy) — losing one key never loses backups. Separate key pairs for staging and production. SSE-KMS with a
   customer-managed key (≈US$1/month) so decrypt can be limited to a restore role; bucket key on.
4. **R-4 RPO/RTO.** Keep roadmap targets (RPO ≤ 12 h, RTO ≤ 4 h) as the pass criteria; record actuals per drill;
   two consecutive failed runs or a failed drill is an early-upgrade trigger (roadmap §9.1 item 3).
5. **R-5 Alert thresholds.** `queue_lag` warn when p95(started − run_at) over 15 min > 2 min, critical when the oldest
   due job > 5 min; `runner_stale` critical when no successful runner pass for 5 min; `dead_letter` warn on any new
   dead job/dead-letter/failed webhook in 15 min (one email per rule per hour); `lease_expiry` warn > 3 reclaims in
   15 min; `error_burst` warn > 20 `ops.error_events` in 10 min; `backup_stale` critical when no success for 13 h;
   `heartbeat_gap` warn at 7 h; quota per FT-04. Cooldown 60 min per rule; auto-resolve after 2 clean evaluations.
6. **R-6 Enqueue RPC tenant derivation.** ADR-0005's "derives the tenant from `auth.uid()`, no tenant argument" is
   implemented as: tenant = the tenant of the subject row, accepted only if it is in `current_user_tenant_ids()`
   (multi-clinic users have no DB-side active tenant). Record as an ADR-0005 clarification (amendment A2) at the gate.
7. **R-7 Delivery semantics.** At-least-once with dedupe keys; normal operation yields exactly-once (claim + fencing +
   delivery-row guard); an unknown outcome after a crash is retried and logged `outcome_unknown`.
8. **R-8 Quota cadence.** Snapshot **daily** (cheap, earlier warning) with an immediate alert at a threshold crossing
   and a **weekly** summary email — satisfies "weekly job" and is strictly safer. Decimal units for limits.
9. **R-9 Staging messaging.** Staging runs a `sink` provider (records ids, never phone numbers, never external calls);
   lag p95 is measured with synthetic jobs through it. Real MSG91 only in V2-12 under its own plan.
10. **R-10 Runbook path.** `docs/runbooks/backup-restore.md` (roadmap). Old `docs/ops/backup-restore.md` and
    `docs/operations/backups.md` get a pointer header and their unverified claims removed.
11. **R-11 Drill RLS suite.** Until V2-05's generated pgTAP matrix exists, the drill runs
    `supabase/tests/restore_drill_checks.sql`: RLS enabled on every `public` table, policy and function counts equal to
    the manifest, `auth.users` count matches, and a cross-tenant `SELECT` as a restored synthetic member of tenant A
    returns 0 rows from tenant B. V2-05 swaps in the matrix.
12. **R-12 Kick frequency.** Every minute (meets p95 < 2 min). No `after()` kick in V2-04 (one dispatch path); revisit
    in V2-12 for conversational bot replies (30-second schedules are supported on PG ≥ 15.1.1.61 [CITED: cron quickstart]).
13. **R-13 pgmq.** Not adopted (see Alternatives).
14. **R-14 Backup runtime.** CodeBuild + EventBridge Scheduler in one CloudFormation stack, deployed by the PO from
    CloudShell; Claude never holds AWS credentials.
15. **Raise now for V2-15 (not decided here):** production restore drills put PHI on the drill machine; recommend an
    ephemeral, encrypted EC2 instance in ap-south-1 (or the PO's FileVault laptop with deletion after) — PO decision.

## External Dependencies (PO actions, in `.planning/PO-ACTIONS.md` format; no secret values)

- **P-1 · Confirm pg_cron and pg_net on the staging Free project** — blocks merging the 04-02 scheduler migration.
  *Do:* Supabase dashboard → staging project → Database → Extensions → search `pg_cron`, `pg_net` → both listed
  (do not enable by hand; the migration does). *Why:* plan availability is not stated by Supabase (A1).
  *Verify (PO runs, pastes output):* `select name, default_version, installed_version from pg_available_extensions
  where name in ('pg_cron','pg_net','supabase_vault');` → 3 rows.
- **P-2 · Runner secret and URL** — blocks staging scheduling (04-02 acceptance). *Do:* generate locally
  `openssl rand -hex 32`; staging SQL editor: `select vault.create_secret('<value>', 'jobs_runner_secret');` and
  `select vault.create_secret('https://<staging-host>/api/jobs/run', 'jobs_runner_url');`; Vercel staging env
  `JOBS_RUNNER_SECRET=<same value>`; after deploy delete `CRON_SECRET` if present (and answer OI-3: any Vercel/external
  cron?). *Verify:* `select name, updated_at from vault.secrets where name like 'jobs_runner_%';` (no values) → 2 rows;
  then `select count(*) from ops.job_runner_runs where started_at > now() - interval '10 minutes';` ≥ 8.
- **P-3 · Monitored ops inbox** — blocks alert drill and FT-03. *Do:* choose the address (e.g. `ops@<PO-19 domain>`);
  make it the Supabase org owner/notification email for staging (pause warnings) and verify it in SES (or confirm SES
  production access from AUTH-03); set Vercel staging `OPS_ALERT_EMAIL`. *Verify:* alert drill email received; SES
  message id recorded in the drill evidence.
- **P-4 · AWS account baseline (shared with SES)** — region `ap-south-1`; root MFA; an admin user/role for the PO; billing
  alarm (e.g. US$10). *Verify:* `aws sts get-caller-identity` and `aws configure get region` in CloudShell → `ap-south-1`.
- **P-5 · age key pairs (staging)** — *Do:* on the PO's machine `brew install age`; `age-keygen -o
  clinicos-staging-primary.agekey` and `age-keygen -o clinicos-staging-breakglass.agekey`; store private files in the
  password manager / sealed offline; give Claude only the two **public** `age1…` recipients. *Verify:* drill decrypt
  succeeds with the primary and (once) with the break-glass key.
- **P-6 · Staging backup credentials in SSM (SecureString, Standard tier)** — *Do:* Systems Manager → Parameter Store →
  Create: `/clinicos/staging/backup/db_url` = Supabase "Connect" → **Session pooler** URI (port 5432, includes the DB
  password); `/clinicos/staging/backup/storage_s3_key_id` and `/clinicos/staging/backup/storage_s3_secret` = Supabase
  Storage → Settings → S3 access keys (if S3 protocol is unavailable on Free, say so → fallback A3).
  *Verify:* `aws ssm describe-parameters --parameter-filters Key=Name,Option=BeginsWith,Values=/clinicos/staging/backup/
  --query 'Parameters[].Name'` → 3 names.
- **P-7 · Deploy the backup stack** — *Do:* CloudShell (ap-south-1) → upload `ops/backup/stack.yaml` →
  `aws cloudformation deploy --stack-name clinicos-staging-backup --template-file stack.yaml --capabilities
  CAPABILITY_NAMED_IAM --parameter-overrides Environment=staging AgeRecipients=<age1…>,<age1…> AlertEmail=<inbox>
  GitHubRepo=thecliniqai/cliniqai-app`; confirm the SNS subscription email. *Unblocks:* FT-02 acceptance.
  *Verify:* `aws s3api get-bucket-versioning --bucket <bucket>` → `Enabled`; `aws s3api get-bucket-lifecycle-configuration
  --bucket <bucket>`; `aws s3api get-bucket-encryption --bucket <bucket>` → `aws:kms`; `aws scheduler get-schedule --name
  clinicos-staging-backup --query '{e:ScheduleExpression,tz:ScheduleExpressionTimezone,state:State}'`;
  `aws sns list-subscriptions-by-topic --topic-arn <arn> --query 'Subscriptions[].SubscriptionArn'` (not
  `PendingConfirmation`).
- **P-8 · GitHub evidence wiring** — *Do:* repo Settings → Secrets and variables → Actions → **Variables**:
  `AWS_BACKUP_EVIDENCE_ROLE_ARN` (stack output), `AWS_REGION=ap-south-1` (role ARNs are not secrets). *Verify:*
  `gh variable list -R thecliniqai/cliniqai-app` shows both; a `backup-evidence` run lists objects (names/sizes only).
- **P-9 · Failed-run drill + first restore drill** — *Do:* temporarily point `/clinicos/staging/backup/db_url` at an
  invalid host (or run StartBuild with an env override `FORCE_FAIL=1`), confirm the SNS email, restore the parameter;
  download the latest `.tar.age` from the S3 console to a local path and tell Claude the path and the identity-file path
  (never paste key contents). *Verify:* drill output file + VERIFICATION_LOG entry.
- **No PO action needed for:** MSW contracts (offline), local scheduler tests, local backup/drill scripts, enqueue RPCs.

## Suggested Execution Order, Sizes, Risks

| Order | Plan | Size | Depends on | Key risk |
|---|---|---|---|---|
| Wave 1 | 04-01 `ops.jobs` + claim/complete/fail/reap RPCs + parallel/reaper/fencing DB tests | M | V2-03 merged (ops schema, system factory, types) | Fairness SQL correctness; grant mistakes |
| Wave 1 (parallel track) | 04-05a `ops/backup/backup.sh` + drill stack + `restore_drill_checks.sql` + `stack.yaml` (lint only) + runbook — all local | M | — | `supabase db dump` flags vs CLI pin; second stack ports |
| Wave 2 | 04-02 scheduler migration + `/api/jobs/run` + middleware bypass + guard manifest (closes RL-23) | S-M | 04-01, P-1 before merge | Revoke on `net`; CI can't reach app |
| Wave 3 | 04-03 enqueue RPCs, remove inline/fire-and-forget/direct sends, inbound dedupe, backfill, test rewrites, MSW contracts, ESLint register shrink | L | 04-02 | Biggest diff; many tests encode old behaviour |
| Wave 3 | 04-04 `ops.alerts` + evaluator + `alert.notify` + drill job kind | M | 04-02, V2-03 email transport + `ops.error_events` | Email transport availability (else SES SDK, SUS-flagged) |
| Wave 4 | 04-06 heartbeat + quota (+ cleanup schedule) | S | 04-02, 04-04 | MAU proxy |
| Wave 4 | 04-05b AWS deploy, twice-daily evidence, failed-run alert, first restore drill | M (PO-heavy) | P-3…P-9 | PO lead time; S3 protocol on Free |

Staging acceptance items (lag p95, alert drill, twice-daily dumps, heartbeat every 6 h) need ≥ 24-48 h of wall-clock
running on staging before the gate.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Docker | local stack, `supabase db dump` | ✓ | 29.7.2 | — |
| Supabase CLI | stack, dumps | ✓ | 2.120.0 (v3.1.0 exists; keep repo pin) | — |
| Local stack (running) | all DB tests | ✓ | Postgres 17.11.0.003 | Shared with concurrent V2-03 work — run V2-04 DB tests only after V2-03 merges |
| pg_cron / pg_net / Vault / pgTAP / pgmq | 04-01…04-06 | ✓ (available; Vault installed) | 1.6.4 / 0.20.4 / 0.3.1 / 1.3.3 / 1.5.1 | — |
| Host `psql`/`pg_dump` | scripts | ✓ but too old | 14.21 | `docker exec supabase_db_clinicos pg_dump` (17.11) or `supabase db dump` |
| age | backup/drill scripts | ✗ | — | `brew install age` (PO-approved dev tool) or pinned release download; CI installs pinned release |
| AWS CLI | PO only (CloudShell) | ✗ locally | — | CloudShell has it; Claude never needs it |
| gpg | — | ✗ | — | not needed |
| Node | app/tests | ✓ | 24.13.0 | — |
| gh | evidence | ✓ | 2.87.2 | — |
| jq | scripts | ✓ | 1.7.1 | — |
| msw | 04-03 tests | ✗ | — | install pinned 3.0.3 |
| Staging Supabase + Vercel staging | 04-02/04/05/06 acceptance | ✗ (V2-03 03-08) | — | Code ships with flags off; acceptance waits |
| AWS account in ap-south-1 | 04-05 | ✗ (PO) | — | Local filesystem/local-S3 target for development |

**Missing, no fallback (blocks acceptance only, not coding):** staging environment, AWS account/stack, ops inbox.
**Missing with fallback:** age (install), msw (install), S3 protocol on Free (supabase-js script).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.7 (+ local Supabase stack), pgTAP 1.3.3 via `psql`/`supabase test db`, Playwright for any UI touch |
| Config file | `vitest.config.ts` (env guard, `fileParallelism: false`, no `.env`) |
| Quick run command | `npx vitest run tests/jobs` (stack up) |
| Full suite command | `npm run test:db` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| P0-12 | 8 parallel runners over 200 jobs → 200 sends, 0 duplicates | DB integration | `npx vitest run tests/jobs/parallel-dispatch-db.spec.ts` | ❌ Wave 0 |
| P0-12 | expired lease reclaimed; stale `processing` delivery row reset; fencing refuses stale token; exhausted → dead | DB integration | `npx vitest run tests/jobs/reaper-db.spec.ts` | ❌ Wave 0 |
| P0-12 | dedupe key: same key twice → one job; grants: anon/authenticated cannot claim or read `ops.jobs` | DB integration | `npx vitest run tests/jobs/claim-grants-db.spec.ts` | ❌ Wave 0 |
| P0-12 | scheduler migration: cron rows present once after two resets; `kick_job_runner()` no-op without Vault; one `net.http_request_queue` row with Bearer header when set (rolled back); `net` revoked from API roles | DB integration | `npx vitest run tests/jobs/scheduler-migration-db.spec.ts` | ❌ Wave 0 |
| P0-12 | `/api/jobs/run`: unset/missing/wrong secret 401, NEXT secret accepted, GET 405, counts only | route unit | `npx vitest run tests/jobs/run-route.spec.ts` + guard manifest | ❌ Wave 0 (manifest exists, entries change) |
| P0-12 | enqueue RPC derives tenant from subject; foreign subject denied; receptionist-triggered webhook event now enqueued | DB integration | `npx vitest run tests/jobs/enqueue-rpc-db.spec.ts` | ❌ Wave 0 |
| P0-12 | no request path dispatches (enqueue returns without provider call) | unit | `npx vitest run tests/messaging/outbox-queue.spec.ts` (rewritten) | ✅ (rewrite) |
| P0-12 | inbound MSG91 retry (same body twice) → one state change, one reply job; DLR monotonic | route + DB | `npx vitest run tests/messaging/msg91-webhook.spec.ts tests/security/webhook-lockdown.spec.ts` (rewritten) | ✅ (rewrite) |
| P0-12 / T-09 | MSG91 contract: URL, `authkey` header, body shape, 4xx/5xx/timeout → failure | MSW contract | `npx vitest run tests/messaging/msg91-contract.spec.ts` | ❌ Wave 0 |
| P1-25 | evaluator raises `dead_letter`, `queue_lag`, `runner_stale`; cooldown dedupes; `alert.notify` job enqueued | DB integration | `npx vitest run tests/jobs/alerts-db.spec.ts` | ❌ Wave 0 |
| FT-03 | heartbeat function writes a row; schedule `0 */6 * * *` registered; gap alert at 7 h | DB integration | `npx vitest run tests/jobs/heartbeat-quota-db.spec.ts` | ❌ Wave 0 |
| FT-04 | `quota_level` boundaries 59.99/60/70 %; snapshot reads db/storage/MAU | DB unit | same file | ❌ Wave 0 |
| FT-02 | backup script against local stack → encrypted archive → drill stack restore → `restore_drill_checks.sql` passes; manifest matches | scripted (nightly CI + manual) | `ops/restore-drill/run.sh --self-test` | ❌ Wave 0 |
| FT-02 | template lint (no AWS) | static | `npx cfn-lint`-free option: `aws cloudformation validate-template` in CloudShell by PO; in CI a YAML schema check | ❌ |
| Staging-only | lag p95 < 2 min, alert drill, twice-daily objects, failed-run alert, heartbeat every 6 h | manual-with-tool-evidence | `backup-evidence.yml` run + exported `ops.*` rows (PO-run SQL) | ❌ |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/jobs` (+ the touched messaging specs)
- **Per wave merge:** `npm run typecheck && npx eslint . && npm run test:db`
- **Phase gate:** `node scripts/phase-evidence.mjs 04-jobs-reliability/evidence 2` + CI run link, 0 retried tests;
  restore-drill output and backup-evidence artifact attached.

### Wave 0 Gaps
- [ ] `tests/jobs/` directory and helpers: seed N jobs + delivery rows on the local stack; recording provider injected
      via the handler registry (no `vi.stubGlobal`).
- [ ] `msw` devDependency (pinned) + `tests/messaging/msg91-contract.spec.ts`; ensure MSW's interceptor coexists with
      `tests/setup/worker-guard.ts` (MSW patches `fetch` after the guard, so mocked hosts never reach the socket guard;
      set `onUnhandledRequest: "error"`).
- [ ] `ops/restore-drill/supabase/config.toml` (second stack) and `supabase/tests/restore_drill_checks.sql`.
- [ ] Nightly workflow job for the backup round-trip (GitHub runner, synthetic local data only — allowed by PO-23(h)).
- [ ] Update `tests/security/guard-manifest.ts` (remove 3 cron entries, add `app/api/jobs/run/route.ts#POST`).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (machine) | Bearer runner secret from Vault/env, constant-time compare, rotation via NEXT secret; fail closed when unset |
| V3 Session Management | no | — |
| V4 Access Control | yes | `ops` schema not exposed; RPCs `REVOKE ... FROM PUBLIC, anon, authenticated`; SECURITY DEFINER with `search_path=''`; tenant derived in SQL; ESLint confinement of `lib/jobs/internal` |
| V5 Input Validation | yes | zod for job payloads per kind and the runner body; MSG91 payload parsing stays tolerant but dedupe keys are bounded |
| V6 Cryptography | yes | age (X25519), SSE-KMS CMK, `timingSafeEqual` over SHA-256; never hand-roll |
| V7 Error/Logging | yes | V2-03 structured logger; no PHI/phone numbers in job errors, alerts or runner responses; `last_error` length-capped |
| V8 Data Protection | yes | Backups encrypted before upload; bucket private, TLS-only; writer cannot read or delete; dumps contain auth data → treat as PHI |
| V10/V12 SSRF / external calls | yes | pg_net only targets the Vault URL; webhook SSRF check unchanged (F5 later) |
| V14 Configuration | yes | New env vars in the zod schema; flags default off |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Runner endpoint brute force / DoS | Spoofing, DoS | 256-bit secret, constant time, POST only, idempotent claim (extra calls only process due work) |
| Secret disclosure via `net.http_request_queue` | Information disclosure | Revoke `net` from API roles; dedicated low-privilege secret; rotate |
| Duplicate patient messages | Tampering/Integrity | SKIP LOCKED claim + lease token fencing + delivery-row guard + dedupe keys |
| Webhook replay (MSG91 retries, attacker with the header secret) | Repudiation/Tampering | Inbound dedupe table; state changes already status-guarded |
| Poison job crash loop | DoS | Attempts counted at claim; dead after max; alert |
| Backup exfiltration | Information disclosure | age + KMS + BPA + least-privilege roles + no GetObject for writer; evidence role lists names only |
| Backup destruction | Tampering | Versioning; writer lacks DeleteObject; lifecycle only path to expiry |
| PHI in alerts/logs | Information disclosure | Counts/ids only; logger redaction (V2-03) |
| Cross-tenant enqueue | Elevation of privilege | Subject-derived tenant + membership check in SQL |

## Sources

### Primary (HIGH confidence — read or executed this session)
- Repo: `lib/messaging/{dispatcher,index,types,webhook-helpers}.ts`, `lib/messaging/providers/msg91.ts`,
  `lib/webhooks/{outbox,dispatcher}.ts`, `app/api/cron/*/route.ts`, `app/api/webhooks/messaging/[provider]/route.ts`,
  `features/webhooks/service.ts`, `features/appointments/system.ts`, `lib/auth/tenant.ts`, `middleware.ts`,
  `supabase/migrations/000014, 000016, 000018, 000024`, `supabase/config.toml`, `vitest.config.ts`,
  `tests/setup/{worker-guard,test-env}.ts`, `.github/workflows/ci.yml`, `docs/adr/0005-confine-service-role-client.md`,
  `docs/v2/{V2_MASTER_ROADMAP,TARGET_ARCHITECTURE,ARCHITECTURE_DECISIONS,BACKEND_MIGRATION_PLAN,INFRASTRUCTURE_ASSESSMENT,TEST_STRATEGY,SECURITY_VERIFICATION_PLAN,VERIFICATION_LOG}.md`,
  `.planning/{ROADMAP,REQUIREMENTS,PO-ACTIONS}.md`, `.planning/phases/02-ci-e2e-foundations/02-PLAN.md`.
- Local stack probes (rolled back): extension availability, `cron.schedule`, Vault, pg_net signatures and grants,
  `cron.timezone`, `host.docker.internal`; `npx supabase db dump --local --dry-run` (schema/data/roles scripts).
- Registries: `npm view` (msw, age-encryption), `gsd-tools package-legitimacy`, GitHub API (age v1.3.2, supabase CLI v3.1.0).

### Secondary (MEDIUM — official docs via WebFetch)
- https://supabase.com/docs/guides/functions/schedule-functions (Vault + cron + pg_net; queue exposure warning)
- https://supabase.com/docs/guides/database/extensions/pg_net (2000 ms default, 6 h TTL, after-commit, 200 req/s)
- https://supabase.com/docs/guides/cron and /cron/quickstart (8 concurrent jobs, ≤10 min, history cleanup, sub-minute)
- https://supabase.com/docs/guides/platform/free-project-pausing (user activity, 1-year restore)
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore (dump/restore commands, pooler)
- https://supabase.com/docs/guides/storage/s3/authentication (S3 endpoint, keys bypass RLS)
- https://supabase.com/pricing (Free limits; cron not listed per plan)
- https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets-templated.html (CodeBuild StartBuild target)

### Tertiary (LOW — search only, flagged)
- AL2023 `postgresql17` package availability (search result summary)
- MSG91 idempotency (no documentation found)
- Third-party claims that pg_cron prevents pausing (vendor blogs; not relied upon)

## Metadata

**Confidence breakdown:**
- Current state: HIGH — every claim read from source this session with line references.
- Queue/scheduler design: HIGH for Postgres mechanics and local availability; MEDIUM for hosted Free availability (A1).
- Backup design: MEDIUM — AWS pieces cited, several runtime details assumed (A3-A5, A10) and to be proven by the first
  CodeBuild run.
- Pitfalls: HIGH (most reproduced locally or read in code).

**Research date:** 2026-11-13
**Valid until:** 2026-12-13 (Supabase/AWS details fast-moving; re-check msw pin and age release at plan time)
