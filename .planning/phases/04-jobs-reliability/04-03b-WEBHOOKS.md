---
phase: 04
plan: 04-03b
subsystem: jobs/webhooks (enqueue RPC, webhook.deliver, delivery contract, P0-12 lint)
status: complete
requirements: [P0-12]
plan_head_before: dbc3d12
---

# 04-03b record: webhook enqueue RPC + `webhook.deliver`; fire-and-forget removed; role drop fixed

**Outcome:** done locally. A request path never delivers a webhook: it calls `public.enqueue_webhook_event` (members)
or `public.enqueue_webhook_event_system` (service role); the delivery row's trigger creates one `webhook.deliver` job;
the runner delivers through the V2-03 pinned transport. Doctor and receptionist actions now produce webhook events
(the owner/admin-only RLS drop is fixed, R-19). Nothing contacted a receiver or a hosted service (injected
`request`/`resolve` seams, the lane's socket guard). No `--linked`, no `db push`. Base `dbc3d12`; commits `e79dda8`,
`10f5109`, `5ed5067`, `3fc5e33`, `3b7ea01` and the docs commit (`git log dbc3d12..`, `…(v2-04): 04-03b …`;
`c9611ce` on the branch is the orchestrator's ROADMAP commit, not this plan's).

## What shipped

| Area | Change |
|---|---|
| Migration **`000036_webhook_enqueue.sql`** (plan said 000035; 000035 is 04-03a's) | `webhook_delivery_queue.event_key` (1..200) + unique `(subscription_id, event_key)` where not null; `last_error` (code, ≤ 200); status CHECK `pending/processing/delivered/failed` (out-of-set rows → `failed`, `NOT VALID` then `VALIDATE`); AFTER INSERT trigger → `ops.enqueue_job('webhook.deliver', tenant, {delivery_id}, 'wh:<id>', next_retry_at, least(max_retries,5)+2)`; `private.outbox_payment_recorded` writes `event_key = payment.recorded:<payment_id>` (same signature/checks as 000029, `ON CONFLICT DO NOTHING`); `public.webhook_delivery_claim` / `webhook_delivery_finish` (service role; V2-03 curve 1 m/5 m/15 m/1 h, attempts against `least(max_retries,5)`, terminal `failed`); `private.webhook_event_subject` (closed set, data from the subject row, state check, `TimeZone=UTC`) + `private.enqueue_webhook_internal` (definer, no API role, subscriptions read as definer, envelope text built once) ; `public.enqueue_webhook_event` (R-6: subject tenant = `p_tenant_id` and a membership else `P0002 SUBJECT_MISMATCH`; ping owner/admin else 42501, 5 per tenant per 60 s under a per-tenant xact lock else `RATE_LIMITED`); `public.enqueue_webhook_event_system` (service role, 04-03a actor set, no ping); dead `webhook.deliver` job → open row `failed`/`job_dead:<code>`; `ops.reap_delivery_rows()` also reaps webhook rows (processing > 240 s → `failed`/`outcome_unknown`, re-claimable); contract (below); a job for every open `pending` row. `EXPECTED_MIGRATION = "000036"`, snapshot + `types/database.ts` regenerated after `db reset --local`; `db:drift:local` PASS. |
| Contract (pulled forward, user's done list "members can't write the delivery table") | `webhook_queue_owner_admin` (FOR ALL) → `webhook_queue_select_owner_admin` (FOR SELECT); `REVOKE ALL` from `anon, authenticated`, `GRANT SELECT` to `authenticated` (delivery logs keep working); claim/finish not executable by members. |
| Event set (enumerated from the call sites) | `appointment.rescheduled` (visits: `appointment_id`, `scheduled_at` as PostgREST writes it; key adds `:<scheduled_at>`), `appointment.cancelled` (visits, state `cancelled`: `appointment_id`, `reason` from `metadata.cancellation_reason`), `visit.completed` (visits, state `completed`: `visit_id`, `patient_id`, `doctor_id`, `completed_at` = `signed_at`), `prescription.issued` (prescriptions: `prescription_id`, `patient_id`, `visit_id`), `lab_result.ready` (patient_documents: `document_id`, `patient_id`, `title`), `ping` (webhook_subscriptions: `type`, `message`, `timestamp`). Every field is derivable from its subject; no call site had to be raised. |
| `lib/webhooks/dispatcher.ts` | Pure `deliverWebhook({ endpointUrl, signingSecret, rawBody, signal, allowHttp?, resolve?, request?, fetch? }) → { ok, status, durationMs, errorCode, retryable }` on `resolveWebhookTarget` + `generateWebhookSignature` + `postPinned` (runner signal added to the transport's own 5 s bound through the `request` seam); SSRF refusal = 400 `ssrf_blocked` not retryable; non-2xx `http_<n>` and network errors retryable. `dispatchWebhookQueueItem`, `dispatchPendingWebhookQueue`, `calculateWebhookBackoff`, `MAX_WEBHOOK_RETRIES` deleted (now SQL). `signer/ssrf/transport` unchanged. |
| Handler `webhook.deliver` (`lib/jobs/internal/handlers/webhook-deliver.ts`, registry) | As planned (step 3), `maxDurationMs` 8 000: claim → inactive 410 / subscription of another clinic 403 + `webhooks.queue_item.tenant_mismatch` warn, no POST → `deliverWebhook` → finish; delivered → done, pending → retry at the row's `next_retry_at`, failed → dead; `finish_lost`, `delivery_in_progress`, `not_due`, `claim_missed` as in `message.send`. |
| `lib/jobs/enqueue.ts` | `enqueueWebhookEvent(ctx, event, subjectId)` (`p_tenant_id = ctx.tenantId`; ping targets the subscription), `enqueueWebhookEventAsSystem(db, event, subjectId, actor)`, `WebhookEventType`, `EnqueuedWebhookEvent`; errors as `EnqueueError` with fixed messages. |
| Call sites | labs, prescriptions, consultation (`visit.completed`; the duplicate `prescription.issued` now collapses to one per prescription through the event key, intended change for 04-SUMMARY), `features/appointments/system.ts` (`system:<reason>`), v1 lab-orders/prescriptions (`system:api_v1`); all best effort as before. `testPingWebhook` checks `clinic:manage`, enqueues, returns `{ success: true, queued: true }`; the in-service ping count moved into the RPC. |
| UI (R-26) | The ping chip is replaced by a status line in a full-width row under the subscription: polite live region (`role="status"`, rendered visually hidden before a result), tied to the button by `aria-describedby`, copy "Test ping queued. The result appears in Delivery logs within about a minute."; the button reads "Queuing..." while pending. |
| Removed | `lib/webhooks/outbox.ts` (background `dispatchWebhookQueueItem`, the 03-10 second writer), `app/api/cron/webhooks/route.ts` (now 404) and reason `cron.webhooks` (`REASON_OWNER`), its two guard-manifest entries, the `testPingWebhook` leg-3 control exemption, the inventory D1 line. |
| Lint (R-33) | `eslint.config.mjs` group `webhookDeliver` (`P0-12:`): `@/lib/webhooks/dispatcher` and `@/lib/webhooks/transport` by any spelling only from `lib/jobs/internal/**` and `lib/webhooks/**` (type imports allowed). Fixtures `webhook-fire-and-forget.ts`, `webhook-transport-imports.ts`. |
| Docs | `docs/runbooks/jobs.md` §10 (webhooks); `deferred-items.md` (pre-existing page contrast/layout, V2-06). |

## Tests that fail without the change

`evidence/04-03b/before-vitest.txt`: the new and rewritten specs on pre-plan code (`dbc3d12`, throwaway worktree, specs
and fixtures copied in) **with the stack reset to 000035**: **8 of 8 files fail, 24 tests** (DB specs fail at import of
the new surface; record-payment on the missing `event_key`; error-map 2; P0-12 11). The same run's probe on the old code
shows the two defects directly: a receptionist's `prescription.issued` queued **0 rows** with an active subscription
(R-19 drop), and enqueue started **1 background POST** (03-10 fire-and-forget).
`evidence/04-03b/negative-enqueue-any-membership.txt`: `enqueue_webhook_event` replaced on the live stack by the "any
membership" variant (03-07 finding 2) → the dual-member test fails (B row written); restored from the migration text
(snapshot `--check` PASS).

| Spec | Proves |
|---|---|
| `tests/jobs/enqueue-webhook-rpc-db.spec.ts` (20) | the receptionist's/doctor's RLS still hides subscriptions; **receptionist and doctor each → one row for the subscribed endpoint, none for inactive/unsubscribed, one `wh:<id>` job (max 7)**, data exactly the call site's fields; enqueue surface returns ids; other clinic's / missing subject → `P0002`, `EnqueueError NOT_FOUND`; **dual member in A for B's prescription → P0002, 0 rows; in B → one B row**; non-member / null tenant / anon refused; events outside the set → `EVENT_NOT_ALLOWED`, subscription id on a lifecycle event → `INPUT_INVALID`; `visit.completed`/`appointment.cancelled` need the state, data from the row; rescheduled key per time; `lab_result.ready` title; same event twice → 0 new, **5 parallel → 1 row, 1 job**; ping: receptionist 42501, other clinic P0002, admin → one row for that subscription only, sixth → `RATE_LIMITED`; system RPC: authenticated/anon 42501, unknown actor, ping, missing subject refused, tenant from subject; **members (owner/admin) cannot INSERT (incl. the E-1 PoC)/UPDATE/DELETE delivery rows (42501) or claim/finish**; catalogue grants, definer + `search_path=""`. |
| `tests/jobs/webhook-deliver-handler-db.spec.ts` (15) | **tracer** (receptionist → RPC → row → job → runner → one POST to the vetted address, `servername`/`Host` = name, body = stored text, signature verifies, job done attempt 1, second pass sends nothing); 500 → pending 1 m, job `run_at` = row's `next_retry_at`; curve 1/5/15/60 min then terminal at 5; resolver `10.0.0.5` → failed 400 no POST, job dead; 302 → one request, not followed, pending; `max_retries = 50` → 5 POSTs then failed; forged service-role row naming B's subscription → failed 403, no POST, warning without the secret; inactive → 410; delivered/failed rows never reclaimed; **two concurrent handlers → one POST**; **8 parallel runners × 120 deliveries → 120 POSTs, 120 distinct, all delivered, every job done at attempt 1**; crash after claim → reaper `outcome_unknown` → delivered once; < 240 s not reaped; dead job → `job_dead:lease_expired`; **real transport through the job path: socket aimed at the vetted address, never the name or loopback (resolver consulted once)**. |
| `tests/billing/record-payment-rpc.spec.ts` (+) | the `record_payment` outbox row has `event_key = payment.recorded:<payment_id>` and its pending `webhook.deliver` job. |
| `tests/api/webhooks-outbox.spec.ts` (rewritten, pitfall 9) | **enqueue performs no POST** (no `https`/`http.request`, no non-loopback fetch; before: background dispatch); unsubscribed/inactive; two subscribers; DB failure → fixed `EnqueueError`; **test ping → `{ success: true, queued: true }`, one row, no POST**; delivery/backoff/http/allowHttp/private DNS/302 through the handler. Cron section removed with the route. |
| `tests/api/webhook-dispatch-hardening.spec.ts` (rewritten) | 03-13d assertions through `webhook.deliver`: pinning (host = address, port, path, SNI/Host, signal, body), real-transport socket target, member insert of the E-1 PoC now 42501 and a forged row refused without sending (pinned and fetch seams), retry cap 5, negative retry count, 5-pings-per-minute limit, origin-only audit. |
| `tests/security/p0-12-lint-gates.spec.ts` (41) | the fire-and-forget fixture fails at a feature, action, v1 route, appointments system, runner route and enqueue paths; transport/relative/namespace/re-export and `./dispatcher`/`./transport.ts` spellings fail; pass in `lib/jobs/internal/**`, `lib/webhooks/**`, tests; real handler and deliverer clean in place, the handler fails at a feature path; outbox and cron route gone; census floor. |
| Guard suite | `testPingWebhook` passes legs 3 and 3b including the positive control (before: exempt). |
| `tests/e2e/settings/developer-test-ping.spec.ts` (desktop-chrome, pixel-7) | owner pings a seeded endpoint → status line (polite, described-by), one `ping` row and one pending job; at 360/820/1280: status visible, 0 serious/critical axe on `#webhook-subscriptions` (full page attached), no horizontal scroll at 360. |
| Also updated | `tests/db/error-map.spec.ts` (+2), `tests/security/system-db.spec.ts` (reason `jobs.run`), `tests/observability/no-raw-error-logging.spec.ts` (cron case removed), `tests/e2e/security/unauth-pages.spec.ts` (`/api/cron/webhooks` 404). |

## Gates (tool output, `evidence/04-03b/`)

- `npm run typecheck` clean (`typecheck.txt`); `npx eslint .` 0 errors, 401 warnings (pre-existing kinds; 421 at
  04-03a) (`eslint.txt`); `npm run inventory` exit 0, 0 flagged (`inventory.txt`); snapshot `--check` PASS;
  `npm run db:drift:local` PASS, 0 statements (`db-drift-local.txt`).
- Full Vitest lane (`npm run test:db`, `vitest-full.txt`): **186 files, 3 932 tests passed, 0 failed**; every
  `cron.job` row active afterwards; no `.planning/dev-messages.txt`.
- `npm run e2e:build` clean (`e2e-build.txt`); `npm run e2e:pr` (`e2e-pr.txt`): **192 passed, 9 skipped, 0 failed,
  0 flaky, 0 retried**. The first lane run failed only the new spec (full-page axe: pre-existing sidebar/header
  contrast) and its screenshots showed the inline status line squeezing then overflowing the actions cell; fixed in
  `3b7ea01` (row layout, axe scoped to the changed list, pre-existing findings in `deferred-items.md`).
- gitleaks 8.30.1 (docker) over the full history after the last commit: see the hand-back (run after this record's
  commit).

## `[WebServer] Error [ECONNRESET]: aborted` (04-03a hand-over): root-caused, benign client aborts

They recur (6 in `e2e-pr.txt`: iPhone 15 only, after register-patient and the five smoke tests; no assertion, no retry).
- The frames `abortIncoming (node:_http_server:845)` ← `socketOnClose (:839)` ← `Socket.emit` ← `TCP` are Node's own
  path for "the client closed the socket while a request was still open"; `evidence/04-03b/econnreset-repro.cjs.txt`
  reproduces exactly these four frames with a loopback client that closes mid-request (`econnreset-repro.txt`).
- `econnreset-inflight-probe.txt` (temporary probe, not committed; source `econnreset-inflight-probe.spec.ts.txt`): when
  the smoke flow's assertions finish, the landing page still has a server-action `POST /` and four RSC link prefetches
  (`/cabin`, `/queue`, `/visits`, `/calendar`) open, on both engines; only WebKit's context close produces the server
  error (one line, after the iPhone test), Chromium's does not. The server is not at fault and no data path is
  affected. Optional hardening (not done, test-only): wait for network idle before ending the smoke test.

## Deviations

| # | Plan said | Done | Why |
|---|---|---|---|
| D1 | migration `000035` | `000036` | 000035 is 04-03a's (wave notes) |
| D2 | revoke of member writes on `webhook_delivery_queue` in 04-03c's contract | in `000036` | user's done list; no request path writes the table after this plan |
| D3 | claim accepts `pending, failed` | `pending` or `failed` with `last_error = outcome_unknown` | a terminal `failed` row must never be re-POSTed by a stray job (Rule 1); `outcome_unknown` is the reaper's marker |
| D4 | — | `last_error` column; webhook leg in `ops.reap_delivery_rows()`; job backfill for open rows | the dead-job trigger and finish need a code column; at-least-once after a crash (R-7); open rows had only the deleted cron route (Rule 2) |
| D5 | — | `visit.completed` / `appointment.cancelled` require the subject's state (`EVENT_NOT_ALLOWED`) | a member could otherwise announce a completion that did not happen (T-04-06, Rule 2) |
| D6 | the subscription list status line "in place of the status/duration chip" | a full-width row under the subscription | the inline line broke the actions cell at 1280 (e2e screenshots) |
| D7 | — | `tests/security/guard-routes.spec.ts` parks other files' due jobs before the runner control leg | Rule 1: guard-actions → guard-routes order made the control send 36 `message.send` jobs and write `communication_sent` audit rows inside "wrote nothing" (04-03a latent order dependency, `guard-routes-order-dependency.txt`) |
| D8 | 3xx "→ failed delivery" | a failed attempt (pending, retried), as V2-03 | no behaviour change beyond the plan; the redirect is never followed |
| D9 | `scheduled_at` sent as the caller's string | the stored instant as PostgREST writes it (`…+00:00`) | data built in SQL (R-26); same value |

## Handoffs

See the 04-03b rows in `04-WAVE-NOTES.md` (next migration 000037; `webhook_delivery_queue` contract already applied;
`webhook-helpers.ts`; guard-routes parking; dead-job behaviour for 04-04). **04-SUMMARY:** `prescription.issued` is now
announced once per prescription (consultation + draft creation collapse through the event key). **Close:** add
`tests/jobs/{enqueue-webhook-rpc-db,webhook-deliver-handler-db}.spec.ts` to `REQUIRED_FILES`.
