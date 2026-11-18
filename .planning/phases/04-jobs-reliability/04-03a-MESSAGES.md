---
phase: 04
plan: 04-03a
subsystem: jobs/messages (enqueue RPC, message.send, delivery reaper, P0-12 lint)
status: complete
requirements: [P0-12]
plan_head_before: 03e2c24
---

# 04-03a record: message enqueue RPC + `message.send`; inline dispatch removed

**Outcome:** done locally. A request path never sends a patient message: it calls `public.enqueue_message` (members)
or `public.enqueue_message_system` (service role), the row's trigger creates one `message.send` job, and the runner
sends. Nothing contacted MSG91 or any hosted service (recording/disabled/sink providers; the MSG91 class only behind
MSW, with every socket to its host dialled to 127.0.0.1; the synthetic-number refusal still fires before any request).
No `--linked`, no `db push`, no `msg91:*`. Base: `03e2c24` (the orchestrator's docs commit landed before this plan's
first commit; the plan started at `16aad5e`). Commits are listed in the 04-03a rows of `04-WAVE-NOTES.md` context and
by `git log 03e2c24..` (`feat`/`refactor`/`test`/`docs(v2-04): 04-03a …`).

## What shipped

| Area | Change |
|---|---|
| Migration **`000035_message_enqueue.sql`** (000034 was taken by R-49) | `communication_queue.dedupe_key` (1..200) + unique `(tenant_id, dedupe_key)` where not null; `ops.message_templates(template_id, channel, unmatched_ok)` seeded with the 8 feature templates, the 2 SMS fallbacks and the 5 bot replies (`bot_not_found` unmatched_ok); `private.indian_mobile_national`, `private.message_subject`, `private.enqueue_message_internal` (definer, no API role, R-44: template allow-list per channel, recipient = patient's or guardian's national number, params and metadata ≤ 4 KB, `ON CONFLICT … DO NOTHING` → `{id,status,deduped}`); `public.enqueue_message` (authenticated; R-6: every given subject row must be in `p_tenant_id` and `p_tenant_id` must be a membership, else `P0002 SUBJECT_MISMATCH`; a patient that is not the visit's → `P0001 SUBJECT_MISMATCH`; `created_by = auth.uid()`; `metadata.system_actor` stripped); `public.enqueue_message_system` (service role, `auth.uid()` null, closed actor set, tenant from the subject, `metadata.system_actor`); AFTER INSERT trigger → `ops.enqueue_job('message.send', tenant, {queue_id}, 'msg:<id>', next_retry_at, least(max_retries,18)+2)`; `public.communication_queue_dead_letter` (service role); `ops.message_job_dead` trigger on `ops.jobs` (dead `message.send` → open row `dead_letter` `job_dead:<code>` + one "Message Delivery Failed" note, same copy/metadata as the old dispatcher, no phone); `ops.reap_delivery_rows()` + cron `delivery-reap` (processing > 240 s → `failed`/`outcome_unknown`, creates a missing job); contract (below); backfill of a job per open row. `EXPECTED_MIGRATION = "000035"`, snapshot and `types/database.ts` regenerated after `db reset --local`. |
| Contract (pulled forward from 04-03c, orchestrator's done list) | `communication_queue_insert_member` dropped; table- and column-level INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER revoked from `anon, authenticated` (000024's 12 column INSERT grants included); EXECUTE on `communication_queue_claim`/`_finish` revoked from `authenticated`. Members keep SELECT on the status columns. |
| `lib/jobs/enqueue.ts` | `enqueueMessage(ctx, input)` (`p_tenant_id = ctx.tenantId`), `enqueueMessageAsSystem(db, input, actor)`, `EnqueueError` (fixed message, `appError` from `mapDbError`, `code` = reason). No provider or factory import. |
| Handler `message.send` (`lib/jobs/internal/handlers/message-send.ts`, registry) | As planned (step 4): claim → provider with the runner's signal → finish/audit; `retryable:false` → dead-letter at once, no fallback; retryable → `failed`, one SMS fallback (`msg-fallback:<id>`), retry at the row's `next_retry_at`; `dead_letter` → dead. Extra states: `finish_lost` (row reaped under the handler → retry so it is not orphaned), `claim_missed`, `recipient_missing` (non-retryable). |
| Providers | `providerSignal(external, timeoutMs)` (`AbortSignal.any`); MSG91/Twilio/Gupshup take `SendOptions.signal`; `Msg91Provider` `timeoutMs` option; MSG91 failures are codes (`msg91_http_<n>`, `msg91_rejected`, `msg91_request_failed:<tag>`, `msg91_not_configured`), 4xx (not 408/429) and 2xx-error bodies not retryable, 5xx/408/429/network/abort retryable; `MessagingSendResult.code`; disabled and synthetic refusals carry `code`. `SinkProvider` (R-9) and `MESSAGING_PROVIDER=sink` (env schema: refused in production; `ENV_DOCS`; `.env.example` regenerated; `environment.txt.example` staging line now `sink`). `/api/ready` reports `sink` as `disabled`. |
| Call sites | labs, referrals, prescriptions, billing (receipt + consultation documents with `visitId`) → `enqueueMessage(ctx, …)`; scheduling booking with `appointment_booked:<visit>`; `features/appointments/system` → `enqueueMessageAsSystem(sys.db, …, "system:<reason>")` with `appointment_rescheduled:<visit>:<ISO>` / `appointment_cancelled:<visit>`, best effort (`jobs.enqueue.failed`). |
| Removed | `lib/messaging/dispatcher.ts`, `app/api/cron/dispatch-communications/route.ts`, reason `cron.dispatch_communications` (`REASON_OWNER`), its two guard-manifest entries, the inventory register line. |
| Lint (R-33) | `eslint.config.mjs` group `messagingSend` (`P0-12:`): the factory, `sendDirect*` and provider classes from the barrel, and the provider/dev-logger modules by any spelling; allowed in `lib/jobs/internal/**` and `lib/messaging/**`, plus an owner-commented allowance for the inbound messaging route (04-03c deletes it). The runner route does not get it. `scripts/ci/p1-34-counters.mjs` counts `P0-12`. |
| Test lanes | e2e app server on `sink` (guard option `sinkMessaging`); `tests/setup/worker-guard.ts` `mswFetch(hosts)` for MSW 3 (socket-level interception): mocked hosts' sockets dial 127.0.0.1, every other host stays refused. |
| Dependency | `msw` 3.0.3 exact, dev (resolved with `--before=2026-11-06`, `--ignore-scripts`; `lock-linux-check.sh --fix` PASS; `evidence/package-legitimacy.json` plan 04-03a: 40 entries, 0 problems). 04-P15 (PO) still gates the merge. |

## Tests that fail without the change

`evidence/04-03a/before-vitest.txt`: the new/rewritten specs on pre-plan code (`03e2c24`, throwaway worktree, specs +
`worker-guard.ts` copied in): **9 of 9 files fail, 35 tests** (the DB specs fail at import of `lib/jobs/enqueue` /
the handler; contract 16/19, error-map 3, sink 2, p0-12 14).
`evidence/04-03a/negative-enqueue-any-membership.txt`: `enqueue_message` replaced on the live stack by the "any
membership" variant (03-07 finding 2) → the dual-member and non-member-tenant cases fail (B row written); restored
from the migration text (`md5(prosrc)` = snapshot `body_md5`).

| Spec | Proves |
|---|---|
| `tests/jobs/enqueue-message-rpc-db.spec.ts` (17) | receptionist → one row (`created_by`), recipient = patient's number, one `msg:<id>` job; other clinic's patient / visit / missing id → `P0002`, 0 rows; anon 42501; **dual member acting in A for B's patient → P0002, acting in B → one B row**; non-member or null `p_tenant_id` refused; patient ≠ visit's → `P0001 SUBJECT_MISMATCH`, visit alone takes its patient; same key twice → one row (`deduped`); **5 parallel calls with one key → 1 row, 1 job**; stranger/garbage recipient, other template or channel, params > 4 KB refused, respelled own number and guardian accepted; `system_actor` stripped; `EnqueueError` mapping; system RPC: authenticated/anon 42501, unknown actor `ACTOR_INVALID`, known actor → tenant from subject, no creator; **members cannot insert/update/delete queue rows or claim/finish/dead-letter (42501)**; catalogue grants, definer + `search_path=""` for 8 functions, cron `delivery-reap`. |
| `tests/jobs/message-send-handler-db.spec.ts` (6) | tracer (RPC → trigger → job → runner → sent once, audit without phone, signal passed); retryable failure → `failed`, job at the row's `next_retry_at`; booking failing twice → exactly one SMS fallback, last failure → `dead_letter`, job dead, one note without phone; already `sent` → done, no call; disabled → `dead_letter` after 1 attempt, no fallback; synthetic recipient with the real MSG91 class under MSW → `dead_letter`, 0 requests. |
| `tests/jobs/delivery-reap-db.spec.ts` (4) | crash after the row claim (lease expired, row 5 min old) → reaped `failed/outcome_unknown` → sent exactly once; < 240 s not reaped (job retries `delivery_in_progress`); pre-000035 stuck row gets a job and is sent; job reaped dead → row `dead_letter` `job_dead:lease_expired`, one note, no second note on a second dead transition. |
| `tests/jobs/parallel-dispatch-db.spec.ts` (+1) | **8 parallel runners, 200 queued messages, real handler → 200 provider calls, 200 distinct, every row `sent`, every job `done` attempts 1, 200 audit rows (0 duplicates).** |
| `tests/messaging/msg91-contract.spec.ts` (19) | MSW (T-09): flow SMS URL/authkey/body; bulk WhatsApp name, language, positional components incl. URL button; session text; 400/401 → not retryable, code only; 500/503/429/network → retryable; 2xx error body → not retryable; 50 ms `timeoutMs` → aborted < 1 s; runner signal abort < 1 s; no key → not retryable; an unhandled request never reaches MSG91; other hosts still refused. |
| `tests/messaging/sink-provider.spec.ts` (2), `tests/security/p0-12-lint-gates.spec.ts` (27) | sink: success `sink-<uuid>`, 0 fetch, no file, log without phone/template/params; selected by env. P0-12: 11 fail cases (feature, action, page, runner route, enqueue module, other webhook, appointments system, relative/alias/barrel/namespace/re-export), 13 pass cases, real handler/route clean in place and failing at a feature path, census `P0-12 = 0` over app code and > 0 over the fixtures. |
| Rewritten (pitfall 9) | `outbox-queue` (enqueue calls the RPC, provider sees 0 calls; send lifecycle in the handler), `provider-selection` (disabled dead-letters at once), `tokenized-sharing`, `review-fixes-app/db`, `review2-fixes-db`, `share-tokens` (system enqueue with the reschedule dedupe key), `review3-fixes-db` AR3-N1 (member claim → 42501, runner sends), `msg91-provider`/`messaging-provider` (codes), `run-route` (parks other due jobs, sink), `env-schema` (+sink), `health-probes` (+sink), `test-env-guard` (+sink pin), `e2e-app-env`, `error-map` (+4), `p1-34-lint-gates` (census key). |

Guard suite leg 3b (dual member acting in A) passes for every enqueueing action (full lane).

## Gates (tool output, `evidence/04-03a/`)

- `npm run typecheck` clean; `npx eslint .` 0 errors (421 warnings, pre-existing kinds); `npm run inventory` exit 0
  (15/16 D1 modules: `lib/ai/tools/clinical-tools.ts` absent before this plan).
- Full Vitest lane: run 1 (`vitest-full-run1.txt`) 5 failures in 3 files: `run-route.spec` claimed 37 leftover
  `message.send` jobs (root cause: the route now claims `message.send`; fixed by parking other specs' due jobs and
  stubbing `sink`) and four assertions on MSG91's old free-text errors (contract change R-20). Run 2
  (`vitest-full.txt`): **184 files, 3 887 tests passed, 0 failed**; every `cron.job` row active afterwards.
- `npm run db:drift:local`: PASS, 0 statements, 0 allowlisted (`db-drift-local.txt`).
- `npm run e2e:build`: output scan clean (1 356 files) (`e2e-build.txt`).
- `npm run e2e:pr` (desktop, Pixel 7, iPhone 15): **190 passed, 9 skipped, 0 failed, 0 flaky, 0 retried**
  (`e2e-pr.txt`, incl. the unauth sweep's 404 on the deleted cron path). The log carries 5 `[WebServer] ECONNRESET:
  aborted` lines next to the iPhone smoke tests: the server reporting a browser connection closed at page teardown,
  not a test result (no assertion, no retry). 04-02's saved log has no `[WebServer]` lines at all, so this run cannot
  show whether they are new; flagged for the orchestrator, not root-caused here.
- gitleaks 8.30.1 (docker, `--network none`) over the full history after the last commit: no leaks found.

## Deviations

| # | Plan said | Done | Why |
|---|---|---|---|
| D1 | migration `000034` | `000035` | 000034 is R-49's (wave notes) |
| D2 | member INSERT/claim revoke in 04-03c's `000037` | in `000035` for `communication_queue` | orchestrator's 04-03a done list ("authenticated can no longer insert/update/delete queue rows"); no request path writes the table after this plan. 04-03c keeps `webhook_delivery_queue` + backfill (wave note) |
| D3 | `ops.reap_delivery_rows` resets rows | also `ops.enqueue_job` for the row (no-op when it has one) | a stuck pre-000035 row would otherwise never get a job (Rule 2) |
| D4 | — | `metadata` ≤ 4 KB too; in-app recipient must be a member of the clinic; user metadata cannot carry `system_actor`; visit given → patient must be the visit's | Rule 2 (T-04-05) |
| D5 | `enqueueMessage` input "today's minus tenantId/maxRetries" | `runAt` replaces `delayUntil`; `max_retries` fixed at 3 in SQL | callers cannot widen retries (T-04-25) |
| D6 | MSW: "handled requests never reach a socket" | MSW 3 intercepts at the socket; `mswFetch` makes those sockets dial 127.0.0.1 and keeps the guard for every other host; option is `onUnhandledFrame` in msw 3 | msw 3.0.3 API (the plan assumed msw 2's fetch-level interception) |
| D7 | — | handler outcomes `finish_lost`, `claim_missed`, `recipient_missing` | no orphaned row when the reaper wins a race; a row without a phone cannot succeed later |
| D8 | — | `run-route.spec.ts` (04-02's file) parks other due jobs | Rule 1: the shared `message.send` kind made its counts depend on other files |

## Handoffs

See the 04-03a rows in `04-WAVE-NOTES.md` (next migration 000036; contract already applied for
`communication_queue`; shared-kind spec helpers; MSW + `mswFetch`; dead-job trigger and `delivery-reap` for 04-04).
**PO:** staging `MESSAGING_PROVIDER` should become `sink` at the next deploy (`environment.txt.example` §B; R-9);
`disabled` stays valid but dead-letters every message (one in-app note each). **Close:** add the four new
`tests/jobs/*message*`/`delivery-reap`/`enqueue-message-rpc` specs, `tests/messaging/{msg91-contract,sink-provider}`
and `tests/security/p0-12-lint-gates.spec.ts` to `REQUIRED_FILES`.
