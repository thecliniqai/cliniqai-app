---
phase: 04
plan: 04-03c
subsystem: jobs/inbound (MSG91 webhook idempotency, queued bot replies, contract step, ADR-0005 register, Send Email hook dedupe)
status: complete
requirements: [P0-12, RL-23]
plan_head_before: 6cb887e
---

# 04-03c record: inbound idempotency, bot replies via the queue, contract step, register shrink, hook dedupe

**Outcome:** done locally. The MSG91 webhook changes state at most once per callback and sends nothing: replies are
queued and the job runner sends them. The Send Email hook sends an auth email once across server instances. The
contract step is in a migration that checks itself against the catalogue. The ADR-0005 exception register holds only the
`/api/v1` entry. Nothing contacted MSG91, Resend or any hosted service (Mailpit, recording providers, in-process
routes); no `--linked`, no `db push`, no `msg91:*`, no `.env*` read. Base `6cb887e`; commits (`git log 6cb887e..`):
`bf0a4eb` (000037, inbound route, replies, replay), `9252f9f` (hook dedupe, A3 zone), `ea8ca92` (register shrink),
`af3fc0b` (000038 contract), `4f7f6a7` (e2e), `5e78a9b` (test teardown), then the docs commit.

## What shipped

| Area | Change |
|---|---|
| Migration **`000037_inbound_idempotency.sql`** (plan: 000036; 000036 is 04-03b's) | `ops.inbound_webhook_events(provider msg91 \| supabase_auth_hook, dedupe_key ≤ 200, received_at, processed_at, outcome processed \| ignored \| failed, attempts)`, unique `(provider, dedupe_key)`, index on `received_at` (04-06 purge, 30 d), RLS on, no API role; `public.inbound_webhook_begin` → `process` / `duplicate` / `in_flight` (a `failed` or 5-minute-stale unfinished claim → `process`, attempts + 1); `public.inbound_webhook_finish` (`failed` leaves `processed_at` null); `public.communication_queue_apply_dlr` (one row per provider id, else no-op; monotonic; status + `communication_dlr_<status>` audit row in one transaction; `error_message` = a code, default `dlr_failed`; returns `{queue_id, tenant_id, applied, new_status, message_type}` + `recipient_phone` when applied); `public.enqueue_unmatched_reply_system` (actor `system:messaging_webhook` only, `+91[6-9]…` only, `unmatched_ok` WhatsApp template only → tenant-less `message.reply_unmatched` job, 3 attempts); BEFORE UPDATE trigger `jobs_reply_unmatched_redact` (`payload := {"redacted": true}` when the job leaves pending/running); `ops.replay_job(id)` (R-35, postgres only). All service-role functions revoke `PUBLIC, anon, authenticated`. `EXPECTED_MIGRATION = "000037"`, snapshot and `types/database.ts` regenerated after `db reset --local`. |
| Inbound route (`app/api/webhooks/messaging/[provider]/route.ts`) | Secret check unchanged (constant time, 401 before any DB access). Then `inboundDedupeKey(event, rawBody)` (`lib/messaging/webhook-helpers.ts`): `dlr:<requestId>:<status>`; inbound → `in:<message id>` from `uuid` / `message_uuid` / `messageId` / `message_id` when it is a printable id, else `in:sha256:<hex of raw body>`; > 200 chars → `<prefix>:sha256:<hex>`. `begin` error → 500; `duplicate` / `in_flight` → 200, no effect (`messaging.inbound.duplicate`). DLR → `communication_queue_apply_dlr`, urgent note only when a `failed` report applied (copy unchanged). Replies: five `enqueueMessageAsSystem(…, "system:messaging_webhook")` with `dedupeKey "bot:<key>:<template>"`, recipient = the stored number (AR-L1); unmatched Indian sender → `enqueueUnmatchedReplyAsSystem`. `finish(processed \| ignored)`; an exception → `finish(failed)` + 500. Visit confirm now selects the changed row and audits only when it changed. |
| Handler `message.reply_unmatched` (`lib/jobs/internal/handlers/message-reply-unmatched.ts`, registry) | Payload `{ to: +91…, template_id: "bot_not_found" }` (strict); sends with the runner's signal, fixed copy (unchanged text); success → done, `retryable: false` → dead at once, else retry (runner backoff); `maxDurationMs` 12 000. |
| `lib/jobs/enqueue.ts` | `enqueueUnmatchedReplyAsSystem(db, { to, templateId, dedupeKey })`, `UnmatchedReplyTemplate`. |
| Removed | `sendDirectSms` / `sendDirectWhatsApp` (`lib/messaging/index.ts`); the inbound route's P0-12 allowance zone. The names stay in the P0-12 banned list. `scripts/msg91-test-send.ts` (operator script, never run) uses `getMessagingProvider("msg91").sendWhatsApp`. |
| Send Email hook (R-43) | `features/auth/system.ts` (`server-only`): `authHookDeliveryBegin` / `authHookDeliveryFinish` on `getSystemDb("auth.send_email_hook")` (new `REASON_OWNER` entry → `features/auth/system`); id must match `^[A-Za-z0-9_.-]{1,128}$` else `skipped`; any error → `unavailable` + `auth.email.dedupe_unavailable` (warn, code only). Route: after signature + payload + per-instance memory: `duplicate` → 200 (`auth.email.duplicate`, `webhook_id_seen`), `in_flight` → hook error 409 (`reason in_flight`), `process`/`unavailable`/`skipped` → send; `finish(processed \| failed)` after `process`/`unavailable`. The Resend idempotency key (`idempotencyKeyFor`) is unchanged. |
| ESLint | A3 zone: exactly `app/api/auth/send-email/route.ts` may import `@/features/auth/system` (`A3_AUTH_ONLY` refuses every other `features/*/system`; the factory stays refused). V2-04 register zone deleted; `lib/webhooks/**` keeps only `webhookDeliver`; the register is one list `ADR0005_REGISTER = ["app/api/v1/**", "lib/api/**"]`, exported as `P134_CENSUS.exceptionRegister`. |
| Counters / evidence script | `scripts/ci/p1-34-counters.mjs`: `exception_register`, `exception_register_entries` (**2**; V2-03: 5), `exception_register_importers` (13 files, all `app/api/v1/**`). `scripts/phase-evidence.mjs`: `cron_route_files` (0). `evidence/04-03c/p1-34-counters.json` (tool output): 0 boundary messages for every id incl. P0-12, one factory. |
| Migration **`000038_queue_contract.sql`** (plan: 000037) | Re-applies the member-side revokes of 000035/000036 idempotently, drops anon's remaining privileges on both queues, revokes EXECUTE on claim/finish from `PUBLIC, anon, authenticated`; a DO block **fails the migration** if any API role can write either table (table or column level, via `has_table_privilege` / `has_any_column_privilege`), anon can read one, a non-SELECT policy remains, or anon/authenticated can execute the claim/finish/dead-letter/apply-dlr/inbound/system-enqueue functions; `ops.backfill_delivery_jobs()` (processing > 240 s → failed/`outcome_unknown` first; one job per open row without one: messages `pending`/`failed`, webhooks `pending` or `failed` + `outcome_unknown`) and one call. `EXPECTED_MIGRATION = "000038"`, snapshot regenerated, types unchanged (ops only). |
| Test lane | `tests/setup/teardown.ts` deletes `ops.inbound_webhook_events` rows received since the run marker (the table has no tenant; every hook call records a key). |
| Docs | `docs/runbooks/staging.md` §6 "Migrate before promote" (R-38); `docs/runbooks/jobs.md` §11 (inbound flow, triage table, dead-letter replay, contract), §9 rows updated; `docs/runbooks/auth-email.md` (shared webhook-id record); `04-ADR0005-PROPOSALS.md` (A2, A3, register state; proposed, not applied). |

## Tests that fail without the change

`evidence/04-03c/before-vitest.txt`: the new and rewritten specs (and the copied fixtures/helpers) on pre-plan code
(`6cb887e`, throwaway worktree, stack reset to 000036): **11 of 12 files fail, 70 tests** (+ the three DB specs fail at
import of the new handler/system module). `tests/db/error-map.spec.ts` passes before (an unregistered P0001 reason
already maps to CONFLICT with its reason; the new `JOB_NOT_REPLAYABLE` entry only makes the registry complete).
`evidence/04-03c/before-probe.txt` (temporary probe, source `before-probe.spec.ts.txt`, not committed) shows the
defects directly on the old code: **the same Delivered report twice → 2 audit rows; the same confirm reply twice → 2
direct `appointment_confirmed_ack` sends from the request; the same signed hook delivery on two instances → 2 Mailpit
messages.**

| Spec | Proves |
|---|---|
| `tests/messaging/inbound-dedupe-db.spec.ts` (21, new) | **tracer**: confirm posted twice → visit confirmed once, 1 audit row, 1 queued `appointment_confirmed_ack` (recipient = patient) with 1 `message.send` job, second answer 200; **5 parallel posts → one effect, one reply**; body without id keyed by hash, byte-identical retry duplicate (1 triage note, 1 reply); distinct ids are distinct events; 6-min-stale claim → reprocessed once (attempts 2); recent unfinished claim → 200, no effect; `failed` claim → reprocessed; **same Delivered twice → 1 audit row** (and a direct RPC repeat `applied: false`); Failed after Delivered stays delivered; Delivered after Read stays read; Failed on a sent urgent message → `dead_letter` `dlr_failed`, 1 audit row, 1 note; **RPC error → 500, key `failed`, retry applies once (attempts 2)**; unknown id → `ignored`; **unmatched Indian sender → one `message.reply_unmatched` job (also posted twice); runner pass with a recording provider → sent once with the runner's signal, job done, payload `{"redacted": true}`**; disabled provider → dead at attempt 1, redacted; foreign sender → no job; the dedupe row holds no phone or body; the four new RPCs → 42501 for a member and anon; the unmatched RPC refuses another actor, non-Indian / bare numbers, a matched-only template, an empty key. Every case: the provider factory is never called by the request. |
| `tests/messaging/msg91-webhook.spec.ts` (rewritten, pitfall 9) | sections 2-5 on the local stack: confirm/cancel/reschedule/triage replies asserted as queued rows to the recipient (reschedule URL only in the queued params, never the response), free text never cancels, DLR delivered/read/failed + urgent note, no-request-id DLR opens no DB client; sections 1 and 6 unchanged. |
| `tests/security/webhook-lockdown.spec.ts` (rewritten) | the P0-03 suite with replies asserted as rows/jobs (no `sendDirectWhatsApp` spy); synthetic numbers; each post carries its own message id; AR-L1/AR2-L3/AR3-N3: no reply about the visit, unmatched Indian senders → reply jobs, foreign or bare senders → none; DLR: a late Failed leaves `delivered`, Failed on a sent row → `dead_letter` `dlr_failed`; provider factory never called. |
| `tests/messaging/two-way-bot.spec.ts` (+4), `tests/messaging/messaging-provider.spec.ts` (+1) | key shapes (DLR id+status, ignored statuses, message id vs hash, bad ids, ≤ 200, no sender digits); the barrel exports no `sendDirect*`. |
| `tests/security/p0-12-lint-gates.spec.ts` (46) | a direct send, the factory, the provider classes and the namespace barrel **fail at the inbound route** (before: allowance pass); the reply handler lints clean in place; the inbound route's config carries the messagingSend group and a send added to its source fails in place. |
| `tests/security/p1-34-lint-gates.spec.ts` (150) | the factory at `lib/webhooks/x.ts`, `lib/messaging/dispatcher.ts`, `app/api/cron/x/route.ts` **fails** (before: register pass); `app/api/v1/x/route.ts` and `lib/api/x.ts` pass; `auth-system-import.ts` passes at the hook route and fails at `app/api/auth/other/route.ts` and a feature; the factory, another domain and sharing fail at the hook route; counters: register = `["app/api/v1/**", "lib/api/**"]`, 2 < 5 entries, importers only `/api/v1`. |
| `tests/integration/auth/send-email-hook-dedupe-db.spec.ts` (6, new, Mailpit) | **same delivery on two instances → 1 email (before: 2)**; provider failure (closed loopback port) → 500, key `failed`, retry on another instance → 1 email, attempts 2; seeded in-flight id → 409, 0 emails; store outage (stubbed `getSystemDb`) → still 1 email, warn line with a code, no address; odd id → sent, no row; row columns = provider, id, timestamps, outcome, attempts only (no address/code/token hash). `send-email-hook.spec.ts` keeps its cases (now also through the shared layer); `send-email-hook-resend.spec.ts` bypasses the shared layer (its global fetch stub only knows Resend). |
| `tests/jobs/replay-job-db.spec.ts` (4, new) | dead `message.send` (row dead-lettered by the trigger) → job pending/attempts 0/due, row pending/retry 0/no error, runner sends once; dead `webhook.deliver` → row pending; not dead / unknown / unmatched reply → `JOB_NOT_REPLAYABLE` (and the reply payload is redacted at dead); no API role can execute it. |
| `tests/jobs/queue-grants-db.spec.ts` (10, new) | member insert/claim/finish → 42501; owner insert of a delivery row for its own subscription, update of `status`/`max_retries`/`retry_count`, delete → 42501; `listDeliveryLogs` still returns the row; enqueue RPCs work; catalogue: anon nothing, authenticated SELECT only, SELECT-only policies, no API EXECUTE; **the migration's assertion block raises when an INSERT or EXECUTE grant is put back** (rolled-back session). Before: 1 of 10 fails (the rest was pulled forward into 000035/000036 by 04-03a/b and is re-proven here). |
| `tests/jobs/backfill-db.spec.ts` (4, new) | open row without a job → 1 job, second call still 1; stale processing → `failed`/`outcome_unknown` then a job, < 240 s untouched; webhook pending and reaper-failed rows get a job, terminal failed does not, stuck processing reaped; postgres only. |
| e2e `tests/e2e/security/cron-routes-removed.spec.ts` (new) | `GET`/`POST` on both former cron paths → 404 with and without a bearer (desktop-chrome, pixel-7). |

## Gates (tool output, `evidence/04-03c/`)

- `typecheck.txt` exit 0; `eslint.txt` 0 errors (exit 0); `inventory.txt` exit 0; schema snapshot `--check` PASS;
  `db-drift-local.txt` PASS (0 statements).
- Full Vitest lane run 1 (`vitest-full-run1.txt`, after `af3fc0b`): **191 files, 3 993 tests passed, 0 failed**; every
  `cron.job` active afterwards (4/4); no `.planning/dev-messages.txt`. It left 17 `supabase_auth_hook` keys in the store
  (no tenant, so the teardown did not reach them): fixed in `5e78a9b` (teardown deletes the run's keys). Run 2
  (`vitest-full-run2.txt`, on `5e78a9b`): **191 files, 3 993 tests passed, 0 failed**; `cron.job` 4/4 active,
  `ops.inbound_webhook_events` and `message.reply_unmatched` jobs empty afterwards, no `.planning/dev-messages.txt`.
- `e2e-build.txt`: output scan clean (1 307 files). `e2e-pr.txt` (desktop, Pixel 7, iPhone 15): **196 passed,
  9 skipped, 0 failed, 0 flaky, 0 retried**. The 6 `[WebServer] ECONNRESET: aborted` lines are the benign WebKit
  page-teardown aborts 04-03b root-caused (`04-03b-WEBHOOKS.md`), not test results.
- gitleaks 8.30.1 (docker) over the full history after the last commit: see the hand-back.

## Deviations

| # | Plan said | Done | Why |
|---|---|---|---|
| D1 | migrations `000036`, `000037` | `000037`, `000038` | next free numbers after 04-03b (R-39) |
| D2 | the contract migration revokes member writes and replaces the webhook `FOR ALL` policy | already done in 000035/000036 (04-03a/b, wave notes); 000038 re-applies idempotently, adds anon's remaining privileges, **asserts the whole contract in the migration**, and backfills | nothing left to revoke for the first time; an in-migration assertion makes a regression on any environment fail loudly (Rule 2) |
| D3 | inbound key = the inbound message's own id "if `parseMsg91Payload` exposes one (read it at execution)" | it exposed none; `messageId` added, read from `uuid` / `message_uuid` / `messageId` / `message_id` (printable, ≤ 128), else `sha256(rawBody)` | the field name is not verified against a live MSG91 inbound payload (agents may not call MSG91); V2-12 confirms it; the hash fallback still dedupes a byte-identical retry |
| D4 | — | DLR `failed`: `error_message` and the audit `reason` are a code (`dlr_failed` unless MSG91 sends a code-shaped reason); the urgent note's copy is unchanged | free provider text can carry personal data; `error_message` holds codes since 04-03a. `webhook-lockdown` expectation changed from the free text to `dlr_failed` |
| D5 | DLR "`failed` never overwrites `delivered`" | as planned; the 01-10 lockdown case "Delivered, then Failed → dead_letter" is rewritten (a late Failed leaves `delivered`; Failed on a sent row → `dead_letter`) | the plan's monotonic rule contradicts the old case; the plan wins |
| D6 | unmatched sender → reply | only an Indian mobile in E.164 gets one (the RPC's rule); a foreign sender gets nothing (before: a direct send to any number) | T-04-16 (cost) and R-24; the plan's RPC contract |
| D7 | "an exception → finish(failed) and 500" | state-change and DLR errors → 500; a **bot-reply enqueue error is logged and the callback finishes** (best effort, as the direct send was) | a retry could not re-run the state change (a cancelled visit no longer resolves), so failing the callback would not re-queue the reply; the enqueue is deduplicated either way |
| D8 | — | the confirm audit row is written only by the call whose update changed the visit | a concurrent or repeated confirm must not add a second audit row (exactly-once effect) |
| D9 | hook: `process` → send, then finish | `finish` also after `unavailable` (fails open) | if `begin` committed but its answer was lost, `finish(processed)` still records the delivery |
| D10 | — | `tests/setup/teardown.ts` deletes the run's `ops.inbound_webhook_events` rows | the table has no tenant; without it every lane run leaves hook keys behind (17 after run 1) |
| D11 | — | `ops.replay_job` refuses `message.reply_unmatched` | its phone is erased at dead (R-25); a replay could only dead-letter again |
| D12 | `send-email-hook.spec.ts` keeps its cases | kept; `send-email-hook-resend.spec.ts` mocks `features/auth/system` to `skipped` | its global `fetch` stub accepts only the Resend URL, so the shared layer's DB calls would hit the stub; the shared layer is proven in the new DB spec |
| D13 | counters: `system_module_importers` lists only allow-listed paths and the register | plus `exception_register*` fields read from the config the zones are built from | "smaller register" becomes a number the census reports (2 vs 5), not a reading of the config |

## Handoffs

See the 04-03c rows in `04-WAVE-NOTES.md`. **PO (04-P14):** confirm A2 and A3 (`04-ADR0005-PROPOSALS.md`), R-43, R-38
(expand and contract in one PR) and the runbook "migrate before promote" order. **V2-12:** confirm the MSG91 inbound
message-id field name (D3). **Close:** add `tests/messaging/inbound-dedupe-db.spec.ts`,
`tests/integration/auth/send-email-hook-dedupe-db.spec.ts`, `tests/jobs/{replay-job,queue-grants,backfill}-db.spec.ts`
to `REQUIRED_FILES`.
