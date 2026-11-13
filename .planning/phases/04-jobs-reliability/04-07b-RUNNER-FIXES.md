---
phase: 04
plan: 04-07b
subsystem: job queue / runner (review fixes: M-FAIR, M-ATTEMPT, 04-07b Lows; independent review M2)
status: complete
plan_head_before: 2ea058a
---

# 04-07b record: runner review fixes

**Outcome:** every 04-07b item of `04-07-REVIEW-TRIAGE.md` is fixed. Each fix has a test that fails without it
(`evidence/04-07b/negative-proof.txt`: 24 regression tests fail on the HEAD-before runner code with the pre-000043 SQL
bodies, and all of them pass on the fix). The fairness spec now drives the real runner with the route's configuration,
not `claim_jobs` directly. Nothing contacted a hosted service: local stack only, every CLI call `--local`, no
`--linked`, no `db push`, no `.env*` read. Base `2ea058a`. Commits: `07bf651` (000043 and the runner),
`3f32674` (specs), `b67d2ad` (runbook), `37cb3e2` (the route imports `RUN_PASS_CONFIG` through the runner module), and
`8527b9c` (the root cause of an MSW failure that appeared only in the full run, below), then this docs commit.

## Triage ID → commit → test

| ID | Fix | Commit | Test (fails without the fix) |
|---|---|---|---|
| **M-FAIR** (A M-1, IND M1) | The runner claims `RUN_PASS_CONFIG.batch` (10, at most 5 per tenant) instead of `floor(budget / worst cost)`, which was always 1 and made the claim global FIFO. Each job has its own deadline: it starts only if `maxDurationMs + 0.5 s settle grace + 1 s margin` fits the remaining budget. Claimed jobs that no longer fit are released in parallel. `claim_jobs` (000043) picks rows round-robin across tenants: every tenant's oldest first, then every tenant's second, and so on. A tenant with an older backlog therefore cannot fill a batch even when `p_per_tenant` ≥ batch. The runner processes the batch in the same order (`fairOrder`). The route constants moved to `lib/jobs/internal/run-config.ts`, so specs use the real values. | `07bf651` | `parallel-dispatch-db.spec.ts` "review A M-1 repro through the real runner": tenant A has 30 older jobs and tenant B one newer job, with a 12 s bound. B's job runs within the first two; the old runner ran 7 jobs, all A's. Same file, "claim_jobs picks round-robin": batch 10 with per-tenant 10 gives 5 A + 5 B (old SQL: 10 A). `runner.spec.ts` "M-FAIR: … claim batch is 10, not 1", "claimed jobs run round-robin", `fairOrder`. |
| **M-ATTEMPT** (IND M2, A L-1) | Attempts are counted at the start of handling. `claim_jobs` no longer increments `attempts`; it clears the new `ops.jobs.started_at`. The new fenced `public.start_job(id, token)` counts the attempt just before the handler runs and returns its number. It returns NULL on a stale, expired or already-started lease, and then the handler never runs. `release_job` hands back unstarted jobs only, with no attempt to return. `fail_job` counts the attempt itself if the job never started (unknown kind, invalid payload, or a pre-000043 runner). On a pass failure, the runner releases the batch's unstarted jobs as a best effort. Poison-pill protection is unchanged for started jobs. | `07bf651` | `runner-review-fixes-db.spec.ts` "M-ATTEMPT": a `max_attempts 1` job goes through three runner passes that die after their claim (start and release never answer). After each lease expiry and `ops.reap_jobs()` the job is `running` with 0 attempts. The next healthy pass runs it once (attempt 1). Old code: dead-lettered `lease_expired`. Also `runner.spec.ts` "start_job … before the handler", "a refused start never runs the handler", and `reaper-db.spec.ts` (one start per lease, none after expiry, none with a stale token; release refuses a started job). |
| **IND M2** (polling spends attempts) | New `public.defer_job(id, token, code, retry_at)` and handler outcome `{ outcome: "defer", code, retryAt }`. A job that started and found nothing to do yet goes back to pending with its attempt returned. Run time is clamped to [now + 5 s, now + 1 day]. The refund is bounded at 20 deferrals per job (`ops.jobs.deferrals`); after that a deferral is an ordinary retry. `message.send` and `webhook.deliver` defer on `delivery_in_progress`, `not_due` and `claim_missed`. | `07bf651` | `delivery-reap-db.spec.ts` "a crash on attempt 3 of 5 still sends": after five polls while the row is held, the job is still on 3 attempts. Once the delivery reaper frees the row, the message is sent exactly once (attempt 4). Old code: the job was dead-lettered. `runner-review-fixes-db.spec.ts` "defer_job" covers the refund, the ≥ 5 s wait, the stale token, the 20-deferral cap (then dead at `max_attempts`) and NULL → 22023. |
| Low A L-2 (handler timeout) | At `maxDurationMs` the signal aborts. A handler that settles within 0.5 s is finished from its own result, or retried as `handler_timeout` if it threw. A handler that does not settle is **abandoned with its lease**: no `fail_job`, so the job stays `running` until the lease (120 s) expires and no other runner can start it meanwhile. If the handler settles later in the same process, the runner finishes the job under its token. Fencing refuses that if the job was re-claimed. The new count is `abandoned`. | `07bf651` | `runner-review-fixes-db.spec.ts` "L-2": a second runner claims nothing while the lease is held. After the lease expires, a third runner re-claims the job and retries it. The abandoned handler then returns `done`, `complete_job` answers `false`, and the row stays `pending` / `provider_down`. Old code: the job was freed at once. Also `runner.spec.ts` "L-2". |
| Low A L-3 (hard DB timeouts) | Every queue RPC goes through `call()` (`claim.ts`). It passes an `AbortSignal` to the PostgREST builder (`abortSignal`) and also races a timer, so the call rejects with `rpc_timeout` at `rpcTimeoutMs` (route: 4 s) even if the abort is ignored. Worst case for a pass is begin + budget + start/finish of the last job + parallel release + end = 25 + 5 × 4 = 45 s, under `maxDuration` 60 s. | `07bf651` | `runner.spec.ts` "L-3": every RPC carries a signal. A stalled claim ends the pass with `ok=false` and `rpc_timeout`. A stalled finish stops the pass and releases the 2 unstarted jobs of the batch. A stalled `jobs_runner_end` rejects instead of hanging. Old code: all three time out at 20 s. |
| Low A L-4 (invalid `retryAt`) | `retry` or `defer` with a `retryAt` that is not a finite `Date` → `fail_job(…, "invalid_retry_at", retryable)` for that job only. `failJob` also drops such a value. | `07bf651` | `runner-review-fixes-db.spec.ts` "L-4": the bad job is `pending` / `invalid_retry_at`, its neighbour is `done`, and the pass is `ok`. Also `runner.spec.ts` "L-4". |
| Low A L-5 (`runner_stale`) | `ops.alert_rule_runner_stale` and the `readiness_probe` `runner_stale` flag count only passes with `source = 'pg_cron'`. A manual or test pass no longer clears a broken kick. | `07bf651` | `alerts-db.spec.ts` "04-07b: a recent ok pass that pg_cron did not trigger …" and `readiness-probe-db.spec.ts` (manual and test → `runner_stale` true). |
| Accepted item "unknown kind never claimed" (A I-3) | Already covered, so no new rule. `queue_oldest_due` (critical, 04-04) counts every pending row whatever its kind, so such a row fires it after 5 minutes. | — | `runner-review-fixes-db.spec.ts` "I-3" (rolled back). It passes before and after the fix, as expected for existing coverage. |

## Decisions and deviations

- **Count at start, not refund on reclaim.** The triage allowed either. Counting at start also fences the side effect:
  a lease lost before the handler runs (`start_job` → NULL) means the handler never runs. It costs one extra RPC per
  job (local ≈ 5 ms).
- **IND M2 closed fully (`defer_job`).** The triage text named only the "never ran" case, but listed IND M2 as a
  source. The polling scenario is a lost-message bug, and its fix sits in files 04-07b owns (`lib/jobs/internal/**`),
  so it is included. The handler change is limited to the three "nothing to do yet" codes.
- **Abandoned jobs wait for lease expiry (120 s), not the handler's backoff.** A handler that ignores its abort is a
  bug. The queue now keeps "one live holder per job" in that case, at the cost of a slower retry.
- **Route constants changed.** Batch 25 → 10, per tenant 10 → 5, and a new 4 s RPC bound (`RUN_PASS_CONFIG`). Smaller
  batches let the claim pick up newly due tenants more often, and per tenant 5 caps one clinic at half a batch.
- **`ops.job_runner_runs.retried` includes deferrals.** The table has no separate column; `RunJobsResult` reports
  `deferred` and `abandoned` separately.
- **Deploy order.** The migration ships before the app, as always. In the window between them, an old runner on the new
  schema never calls `start_job`, so an attempt killed by a crash is not counted (failures still are: `fail_job`
  counts an unstarted attempt). Apply 000043 and deploy in the same promote (staging runbook §6 "migrate before
  promote").
- **Specs of other plans touched for the contract change:** `webhook-deliver-handler-db` (`defer`), `alerts-db` and
  `readiness-probe-db` (seeded passes now `pg_cron`; manual and test cases added), `claim-grants-db`
  (`start_job`, `defer_job`), `reaper-db` (count at start).

## Full-run failures found and root-caused

The first full Vitest run on `b67d2ad` had 4 failures out of 4318 tests. Both causes were real; neither was retried.

1. **P1-34 lint gate** (`tests/security/p1-34-lint-gates.spec.ts`, 3 cases): the route gained a third import from
   `lib/jobs/internal/**` (`run-config`), and the gate counts them. Fixed in `37cb3e2`: the runner re-exports
   `RUN_PASS_CONFIG`, so the route imports the two internals it had before.
2. **MSW 3 versus local stack sockets** (`message-send-handler-db.spec.ts` "synthetic recipient"; it passes alone):
   MSW 3 intercepts at the socket. With `onUnhandledFrame: "error"`, every request that opens a **new** socket to the
   local stack while the MSW server listens fails ("Cannot bypass a request when using the error strategy"). The spec
   therefore depended on undici reusing keep-alive sockets for every local call. Whether it does depends on the pool
   state that earlier files leave in the worker, and the extra queue RPCs changed that timing. `sms-recipient-exploit-db`
   had the same latent dependence. Fixed in `8527b9c`: `tests/helpers/msw.ts` `loopbackPassthrough` is a handler that
   matches loopback requests only and passes them through, and the `"error"` strategy stays for every other host. The
   synthetic-recipient case counts MSG91 requests only. `tests/setup/msw-loopback.spec.ts` sends 4 concurrent local
   RPCs inside an MSW window and checks that an unhandled MSG91 request still fails. It fails without the handler
   (`evidence/04-07b/msw-loopback-negative-proof.txt`).

## Not changed (owner)

- `ops.backup_runner_stale()` (04-05a/04-07c) still accepts any ok pass. It is the backup's dead-man, outside the
  triage row. Noted for the 04-07c owner and V2-14.
- `ops.cleanup()` keeps the newest ok pass of any source, so `runner_stale`'s `last_ok_at` detail can be null after
  14 days without a pg_cron pass. The rule still fires correctly. Cosmetic, for V2-14.
- `ops.replay_job` resets `attempts` but not `deferrals`. A replayed job that had used all 20 free deferrals spends
  attempts on further deferrals. Rare, and bounded. V2-14.

## Verification

- Typecheck (app + tests): pass. `npx eslint .`: 0 errors (no warnings in the changed jobs, MSW and test files).
  `npm run inventory`: 0 flagged.
- Negative proofs: `evidence/04-07b/negative-proof.txt` (24 regression tests fail on the pre-fix code and SQL) and
  `evidence/04-07b/msw-loopback-negative-proof.txt`.
- Full Vitest run 1 on `b67d2ad`: 4 failed of 4318 (`evidence/04-07b/vitest-full-run1.txt`), root-caused above.
- Full Vitest run 2 on `8527b9c`: **208 files, 4319 tests, 0 failed** (`evidence/04-07b/vitest-full.txt`).
- e2e PR lane (`npm run e2e:build` + `npm run e2e:pr`, desktop / Pixel 7 / iPhone 15) on `8527b9c`: **196 passed,
  9 skipped, 0 failed, 0 flaky, 0 retries** (`evidence/04-07b/e2e-pr.txt`).
- gitleaks (docker, after committing): `evidence/04-07b/gitleaks.txt`.
- Shared stack: during the negative proof, the pre-000043 bodies were applied on the local stack outside the run lock
  for the seconds before that Vitest run took it. The stack was then restored by `npx supabase db reset --local`
  under the lock, and the snapshot was regenerated from the reset.
