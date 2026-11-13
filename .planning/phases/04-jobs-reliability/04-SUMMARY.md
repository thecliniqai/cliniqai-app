---
phase: 04
roadmap_id: V2-04
name: Jobs reliability
status: awaiting PO gate approval (G3-partial)
base_commit: 90e8fc8 (merge base with origin/feature/v2 after PR #5)
head_commit: 2260c64 (verified; later commits are docs and evidence only)
pr: "#6"
---

# Phase 04 (V2-04) — summary

V2-04 replaces inline dispatch and the cron routes with one job queue. Requests only enqueue (SECURITY DEFINER RPCs);
pg_cron kicks `/api/jobs/run` every minute through pg_net with a short-lived HMAC token; the runner claims per tenant
with lease and fencing, retries, dead-letters and reaps. Messages, webhook deliveries, bot replies and ops alerts all go
through it. It also adds email alerts, the heartbeat and quota monitor, ops retention and a counts-only staging report,
and the backup and restore drill as code. It delivers P0-12, P1-25 (alerts part), FT-02 (built and drilled locally;
staging pending PO), FT-03, FT-04 (job part), RL-23, V2-03 R-27 and the V2-03 review A Lows L-1…L-8 (04-00). The PO
delegated decisions to the agent acting as CTO; rulings R-1…R-51 are in `04-PLAN.md` § Rulings, review rulings in
`04-07-REVIEW-TRIAGE.md`. Every number below is copied from a tool output under `evidence/` or from a plan record that
cites one.

## What changed, by plan
| Plan | Outcome (record) |
|---|---|
| 04-00 Carry-over | V2-03 review A Lows L-1, L-2, L-3, L-5, L-6, L-7, L-8 all fixed, none accepted: padded or blank secrets refused, loopback and bare-origin rules, the CLI's local keys refused by digest, a `plan` job before `migrate` (`migration-plan.mjs`, read-only URL), `wait-for-release` accepts a descendant, password-free CLI URLs (`PGPASSWORD`), `STAGING_*` and opaque hosted keys refused in the test lane (`04-00-CARRYOVER.md`). |
| 04-00b Resend | `EMAIL_PROVIDER=resend` (PO decision 2026-11-13: Resend until go-live, SES after): plain `fetch` sender with timeout and an idempotency key per message, env rules in every tier, no new dependency (`04-00b-RESEND.md`). |
| 04-01 Queue core | `ops.jobs` (TARGET §8 names, `dedupe_key` NOT NULL UNIQUE, R-7/R-22), claim / start / complete / fail / release with lease and fencing token, reaper, `ops.job_runner_runs`; `lib/jobs/internal/{types,claim,runner}.ts`; migration 000031 (`04-01-QUEUE.md`). |
| 04-02 Scheduler | pg_cron `jobs-kick` → `ops.kick_job_runner()` → Vault → pg_net → `POST /api/jobs/run`, constant-time token check with current/next secrets; the `!==` cron routes deleted (RL-23). R-49: the kick sends `v1.<ts>.<hmac>` (±120 s), never the secret; migrations 000033, 000034. The full path ran once for real on macOS (`evidence/scheduler-local-e2e.json`) (`04-02-SCHEDULER.md`). |
| 04-03a Messages | `public.enqueue_message` / `enqueue_message_system` (tenant from the subject row, active tenant as a constraint, ADR-0005 A2), `message.send` handler, delivery reaper, `sink` provider (R-9), MSG91 contract tests through MSW (`msw` 3.0.3, dev only); migration 000035; member writes on `communication_queue` revoked (`04-03a-MESSAGES.md`). |
| 04-03b Webhooks | `public.enqueue_webhook_event` (+ `_system`), `webhook.deliver` through the V2-03 pinned transport, event data built in SQL (R-26); doctor and receptionist actions now produce events (R-19); test ping is queued; migration 000036 (`04-03b-WEBHOOKS.md`). |
| 04-03c Inbound + contract | MSG91 callbacks change state at most once (`ops.inbound_webhook_events`), bot replies queued (R-25), Send Email hook dedupes across instances through `features/auth/system.ts` (R-43, ADR-0005 A3), contract migration that checks itself against the catalogue (R-38), the ADR-0005 register reduced to `app/api/v1/**` + `lib/api/**`; migrations 000037, 000038 (`04-03c-INBOUND-CONTRACT.md`). |
| 04-04 Alerts | Nine SQL alert rules evaluated by pg_cron every 5 minutes, one `alert.notify` job per notification through `EmailSender`, per-rule cooldown, auto-resolve after two clean evaluations, R-50 (a failed backup run fires `backup_stale`), R-51 (at-least-once re-notify every 15 min until sent), four boolean job flags on `/api/ready` (R-41); migration 000039 (`04-04-ALERTS.md`). |
| 04-05a Backup | `ops/backup/backup.sh` (dump + Storage objects + manifest, age-encrypted with two recipients), `backup.yml` (GitHub Actions, Environment `staging-backup`, Cloudflare R2, R-48) and `backup-alert.yml`, the restore drill `ops/restore-drill/run.sh` into a second local stack; self-test RPO 16 s, RTO 32 s at `4ce7806`. The AWS CodeBuild design moved to `docs/ops/backup-aws-golive.md` (V2-15); migration 000032 (`04-05a-BACKUP.md`). |
| 04-06 Heartbeat + quota | Heartbeat every 6 h with `heartbeat_gap`; daily quota snapshot (DB, Storage, MAU estimate) with 60 %/70 % rules; weekly summary email; `ops.cleanup()` retention (R-2) incl. the V2-03 error-event purge (R-27); `ops.report_all()` and the read-only `ops-report.yml`; migration 000040 (`04-06-HEARTBEAT-QUOTA.md`). |
| 04-07a Messaging fixes | H-SMS (provider body built from fixed fields last, per-template param allow-list in SQL, SMS fallbacks system-only), M-ROLE, M-DEDUPE, M-INBOUND, M-REPLAY, M-RXEVENT and the B Lows; migration 000041 (`04-07a-MESSAGING-FIXES.md`). |
| 04-07b Runner fixes | M-FAIR (fair batch through the real runner), M-ATTEMPT (attempt counted at start), handler timeout keeps the lease, hard DB timeouts, invalid `retryAt` per job, `runner_stale` counts scheduler passes only; migration 000043 (`04-07b-RUNNER-FIXES.md`). |
| 04-07c Ops fixes | M-POLICY (workflow-policy bypasses refused), M-BACKUPAUTH (archive SHA-256 recorded and checked before `age -d`, SQL guard refuses meta-commands), M-RESTORE (`ops.ensure_schedules()`), C Lows; plan and roadmap errata (R2, R-49 row); migration 000042 (`04-07c-OPS-FIXES.md`). |
| 04-07d Re-verify fixes | N-1 (tenants least recently served first, `last_claimed_at`), N-2 (guard independent of `standard_conforming_strings`, restore under restricted psql), L-A, L-C, Info; migration 000044 (`04-07d-REVERIFY-FIXES.md`). |
| 04-07e Fairness + restore | N-1b (a hand-back restores the claim stamp; batches start least recently served first), N-2b (every backup/restore/drill psql session restricted, manifest validated, values passed quoted), L-D/L-E/L-F guard spellings; migration 000045. Phase close: re-check I-1 fixed (`sql-guard.ts` refuses `CREATE EVENT TRIGGER … ON login`, record corrected) (`04-07e-FAIRNESS-RESTORE-FIXES.md`). |
| Phase close | Report gate gains the 49 specs V2-04 added outside `tests/e2e` (118 required in total) and a new floor; ADR-0005 A2 and A3 applied; roadmap erratum (R2) recorded in VERIFICATION_LOG §4; D16, F-3a, F-3b marked fixed in V2-04. The first close evidence run failed one test (`alert-notify-db.spec.ts`, order-dependent: its message runner dead-lettered other files' pending messages after its own, pushing its job out of the alert's ten newest `job_ids`); root-caused, reproduced and fixed in `2260c64` (`evidence/close/alert-notify-isolation.txt`), then the evidence was re-run from a fresh `db reset --local`. |

## Migrations (000031–000045, fifteen files, immutability-gated)
| # | File | Plan |
|---|---|---|
| 000031 | `jobs_queue` | 04-01 |
| 000032 | `ops_backup_runs` | 04-05a |
| 000033 | `jobs_scheduler` | 04-02 |
| 000034 | `jobs_runner_token` | 04-02 (R-49) |
| 000035 | `message_enqueue` | 04-03a |
| 000036 | `webhook_enqueue` | 04-03b |
| 000037 | `inbound_idempotency` | 04-03c |
| 000038 | `queue_contract` | 04-03c (contract step, R-38) |
| 000039 | `ops_alerts` | 04-04 |
| 000040 | `ops_heartbeat_quota_report` | 04-06 |
| 000041 | `messaging_review_fixes` | 04-07a |
| 000042 | `ops_review_fixes` | 04-07c |
| 000043 | `runner_review_fixes` | 04-07b |
| 000044 | `claim_tenant_rotation` | 04-07d |
| 000045 | `claim_handback_fairness` | 04-07e |

The applied `000032` header still names AWS CodeBuild and SNS; applied migrations are never edited, and the 04-PLAN
errata paragraph is the correction.

## Deploy notes
- **Migrate before promote, and 000043+ ship with the app in the same promote.** Expand and contract are in one PR
  (R-38). From 000043 the runner must call `start_job` (an old runner on the new schema does not count an attempt a
  crash killed), and from 000045 `claim_jobs` returns `claim_order`, which the new runner uses for its batch order. Apply
  the migrations, then deploy this app at once (staging runbook §6 "migrate before promote"; until then `/api/ready`
  answers 503 with `checks.schema: "behind"`).
- **Separate runner secrets per environment.** Staging and production each get a freshly generated `JOBS_RUNNER_SECRET`
  (the HMAC token is not bound to an environment; 04-07 triage, `docs/runbooks/jobs.md` §2). The secret must differ from
  `CRON_SECRET` (boot refuses equality) and goes to Vault (`jobs_runner_secret`) as well as Vercel.
- `OPS_ALERT_EMAIL` is optional on staging (notifications then stop at `alert_channel_unconfigured`; clear
  `notify_stopped_code` after setting it) and required in production (boot fails without it).
- `MESSAGING_PROVIDER=sink` on staging (R-9); real MSG91 only in V2-12.
- A real restore runs `select ops.ensure_schedules();` after the data restore and `select ops.ensure_schedules(true);`
  after the pending-jobs review and the Vault secrets (runbook `backup-restore.md` §8).

## Deviations (detail in each record's "Deviations" section)
- **Roadmap (R-37, R-34, R-11, R-8, R-41):** plans split into 04-03a/b/c and 04-05a + post-merge 04-05b; the pg_cron
  confirmation moves to the staging apply (04-P1); the "pgTAP RLS suite" is the drill check file until V2-05; FT-04 runs
  daily plus a weekly summary; `/api/ready` gains four booleans (no counts).
- **Staging backups on Cloudflare R2 via GitHub Actions, not AWS CodeBuild in `ap-south-1`** (PO decision B-3, R-48;
  R-14 superseded for staging, R-30 not built). Roadmap erratum applied by 04-07c and recorded in VERIFICATION_LOG §4.
- **R-16's `net` revoke cannot be built** (`net` belongs to `supabase_admin`): superseded by R-49, the HMAC token
  (residual: a database login role can read a queued token and replay it for 120 s, which triggers only an idempotent
  pass).
- **Migration numbers** shifted by one from 04-03a on (000034 went to R-49); 04-07b's 000043 was committed after
  04-07c's 000042.
- **04-00:** `instrumentation.ts` edited for the L-3 check; `target-guard.mjs` refuses unknown flags;
  `migration-plan.mjs` exits 1 for an out-of-order pending file.
- **04-00b:** the Resend key is required in every tier; no URL override env; `from` is the plain `EMAIL_FROM`.
- **04-01:** fairness by tenant (`due_tenants` LATERAL), `release_job` added, error codes sanitised
  (`invalid_error_code`), extra invariants on `ops.jobs`.
- **04-02:** route result gains `ok`; bodies over 1 KB → 413; teardown re-activates every cron row (see the open IND L6
  below); `hosted-dump-diff.mjs` skips `pg_*` schemas.
- **04-03a/b:** member writes on the delivery tables revoked in 000035/000036 (planned for 000038); delivery reaper also
  enqueues the job; extra input bounds (metadata ≤ 4 KB, visit/patient match); `visit.completed` /
  `appointment.cancelled` need the subject's state.
- **04-03c:** inbound key reads the provider message id where present; DLR failure text stored as a code; foreign
  senders get no bot reply; a bot-reply enqueue error is logged and the callback finishes.
- **04-04:** `ops.alert_rules.fn` is text (pg_upgrade refuses `regprocedure` columns); thresholds in `params`; payload
  `{alert_id, seq}` for exactly one email per notification; D7 reversed by R-51.
- **04-05a:** Storage policies travel with the backup; extra round-trip and run-table specs.
- **04-06:** per-rule cooldowns (heartbeat 6 h, quota 24 h, weekly 7 d); `ops.cleanup()` keeps the newest row of each
  monitored kind; `ops-report.mjs` passes `PG*` by name.
- **04-07c:** "signed manifest" not built: the digest is recorded in three places and the restore takes it only from the
  green `backup.yml` run (`--expect-sha256`); Environment allowlist by name.

## Rulings added during execution (PO delegated to CTO; 04-P14)
- **R-41 (revised)** `/api/ready` gains four booleans only (`jobs_backlog`, `jobs_dead_24h`, `runner_stale`,
  `alerts_critical_open`).
- **R-42** (raised for V2-15, not decided) production restore drills put PHI on the drill machine.
- **R-43** the Send Email hook dedupes through one system function → ADR-0005 **A3**.
- **R-44** outbox/enqueue writers are SECURITY DEFINER functions in `private`.
- **R-45** every migration commit carries the `EXPECTED_MIGRATION` bump, the schema snapshot and `db:types`.
- **R-46** error-sink alert rules (`error_sink_overflow`, `error_sink_size`) and the 180-day purge.
- **R-47** the 04-00 hardening choices.
- **R-48** staging backups in GitHub Environment `staging-backup` to Cloudflare R2 (accepted risks, owner V2-15: no R2
  versioning, the token can delete, no India region, a `postgres` URL in a reviewer-free Environment; staging data is
  synthetic).
- **R-49** HMAC runner token (`v1.<ts>.<hmac>`, ±120 s), the secret never leaves the database; supersedes R-16's revoke.
- **R-50** `backup_stale` also fires when the latest backup run failed.
- **R-51** alerts are at-least-once: re-notified every ≥ 15 min until recorded as sent; one email per successful
  notification (provider idempotency key `ops-alert/<id>/<n>`).
- **R-6 (revised)** the enqueue RPCs take the session's active tenant as a constraint only → ADR-0005 **A2**.
- **ADR-0005 A2 and A3** accepted by the CTO under PO delegation (2026-11-13) and **applied** to
  `docs/adr/0005-confine-service-role-client.md` at close (dated amendment note).
- Review rulings (`04-07-REVIEW-TRIAGE.md`): staging and production runner secrets must differ; L-B accepted → V2-12;
  the guard's server-side residual accepted (restricted psql is the control).

## Review outcome (CLAUDE.md DoD 6)
Four isolated reviews of the phase diff at `0dc606b` and three re-verification rounds (reports in `reviews/`).
Severity counts are copied from each report:

| Review | Critical | High | Medium | Low | Info |
|---|---|---|---|---|---|
| Independent (`v204-review-independent.md`) | 0 | 0 | 5 | 7 | 5 |
| A queue/runner (`…-adversarial-queue-runner.md`) | 0 | 0 | 1 | 5 | 4 |
| B messaging/webhooks (`…-adversarial-messaging-webhooks.md`) | 0 | 1 | 3 | 6 | 0 |
| C ops (`…-adversarial-ops.md`) | 0 | 0 | 2 | 5 | 7 |
| Re-verify 1 at `635cd5d` (`v204-review-high-reverify.md`) | 0 | 0 | 2 new (N-1, N-2) | 3 new (L-A, L-B, L-C) | 2 |
| Re-verify 2 at `3947174` (`v204-review-n1-n2-recheck.md`) | 0 | 0 | 2 new (N-1b, N-2b) | 3 new (L-D, L-E, L-F) | 0 |
| Re-verify 3 at `b5c9e11` (`v204-review-n1b-n2b-recheck.md`) | 0 | 0 | 0 | 0 | 1 (I-1) |

Triage (`04-07-REVIEW-TRIAGE.md`):
- **High (1): H-SMS fixed (04-07a) and re-verified CLOSED.**
- **Mediums: 10 triage rows, all fixed** (M-ROLE, M-DEDUPE, M-INBOUND, M-REPLAY, M-RXEVENT, M-FAIR, M-ATTEMPT,
  M-POLICY, M-BACKUPAUTH, M-RESTORE; 11 review Mediums, since IND M1 and A M-1 are both M-FAIR). Re-verify 1 found 8
  CLOSED and M-FAIR and M-BACKUPAUTH partially closed (N-1, N-2, fixed in 04-07d); re-verify 2 reopened both through
  new routes (N-1b, N-2b, fixed in 04-07e); re-verify 3 found both **CLOSED**.
- **Lows fixed:** the B, A and C Lows named in the triage (04-07a/b/c), L-A and L-C (04-07d), L-D, L-E, L-F (04-07e);
  Info I-1 at close (`fceeda2`). Every fix has a regression test that fails without it (negative proofs in
  `evidence/04-07{a..e}/`).
- **Accepted, with reason and owner:** R2 token can overwrite/delete, no bucket lock → V2-15; Send Email hook 409 retry
  by GoTrue unverified → AUTH-00 hosted re-check kit; runner token not bound to an environment → separate secrets per
  environment (runbook); `service_role` reads `vault.decrypted_secrets` (platform default) → V2-14 review; jobs of an
  unknown kind never claimed → covered by `queue_oldest_due` (04-07b); L-B member free text inside permitted template
  values → V2-12; settings changed by server-side code invisible to the guard → restricted psql (accepted residual).
- **Assigned by the CTO (PO delegation, 2026-11-14):** IND L1 (reschedule webhook key `A → B → A`
  suppresses the return event) → V2-12; IND L5 (`dead_letter` counts transient `outcome_unknown` webhook rows;
  backlog rules count unregistered `drill.*` kinds) → V2-14; IND L6 (test teardown re-activates every inactive cron job,
  04-02 D7 by design) → V2-05 test harness; the Info items of IND and C (`I1…I5`, `I-1…I-7`) are observations with no
  change required by the reviewers.

## Deferred, with owner
- SES bounce/complaint webhook → **V2-12** (R-40; re-homed from V2-03 R-10).
- P1-13 phone in the urgent DLR notification copy → **V2-12**.
- Remaining F5 work outside V2-04 scope: reminder producers P1-14 → V2-12; purges P1-17 → V2-13; in-transaction enqueue
  P1-05 → V2-07 (roadmap §10 owners).
- Production FT-02 (AWS `ap-south-1` backup target, object lock, IAM/OIDC; `docs/ops/backup-aws-golive.md`) → **V2-15**.
- Production drill machine (R-42) → **V2-15**.
- DPDP erasure of `ops.error_events` if its tenant/user ids are ever filled → the phase that fills them.
- Generated pgTAP RLS matrix replaces the drill check file (R-11) → **V2-05**.
- Redundant `jobs_tenant_id` index (contract migration); `ops.replay_job` keeps `deferrals`; `backup_runner_stale`
  accepts any ok pass; cosmetic `last_ok_at` null after 14 days → **V2-14** (04-07b/d/e "Not changed").
- Per-role variable shape rules for message templates (L-B) → **V2-12**.
- Accessibility and layout of `/settings/developer` (pre-existing v1 styling: sidebar contrast, table overflow) →
  **V2-06** (`deferred-items.md`).
- MSG91 inbound message-id field name confirmation (04-03c D3) → **V2-12**.

## Proposed doc errata (PO approves; not applied unless stated)
1. **Applied at close:** ADR-0005 A2 and A3 (CTO acceptance under PO delegation).
2. **Applied by 04-07c:** roadmap §12 V2-04 staging backups on R2 (recorded in VERIFICATION_LOG §4).
3. TARGET_ARCHITECTURE §8: `ops.jobs.dedupe_key` NOT NULL (not `NULLS NOT DISTINCT` on a nullable key), table name
   `ops.jobs` (R-7, R-22).
4. V2_MASTER_ROADMAP §9.1: pg_cron/pg_net confirmation happens at the staging apply (04-P1), not before merge (R-34).

## Proposed CLAUDE.md change — PO approves (04-P14)
Not applied. Proposed text for `## Commands`:
- Commands: `ops/restore-drill/run.sh --self-test` (local backup → second local stack → drill checks) and
  `npx tsx scripts/ops/scheduler-local-e2e.ts` (macOS only: real pg_cron → pg_net → app).
- NEVER run: `ops/backup/backup.sh` with `BACKUP_ENV` other than `local`; any `aws` command against a real account;
  dispatching `backup.yml`, `ops-report.yml` or `backup-alert.yml` (they run only in the PO-approved Environments).

## Numbers
- Vitest: 162 files / 3465 tests at the end of V2-03 → **211 files / 4399 tests**, two consecutive runs at `2260c64`,
  0 failed, 0 skipped; each teardown removed 170 tenants, 324 auth users and 1397 storage objects and verified none
  remain (`evidence/summary.json`, `full-run-{1,2}.json`).
- Report gate: floor 4180, 118 required spec files, PASS for both runs (`evidence/close/vitest-report-gate.txt`).
- Playwright PR lane: 196 passed (including the 10 KNOWN-BUG expected failures), 9 skipped by design (pixel-7), 0
  failed, 0 flaky (retried); by project: desktop-chrome 112, pixel-7 70, iphone-15 9, setup 5
  (`evidence/close/playwright-summary.txt`, `evidence/playwright-results.json`). The web server's 6 `ECONNRESET:
  aborted` log lines are the benign WebKit client aborts root-caused in 04-03b (`evidence/04-03b/econnreset-repro.txt`).
- ESLint: 0 errors, 382 warnings (`evidence/close/eslint.txt`); `eslint . --quiet` over 326 files: every boundary
  message id 0 incl. `P0-12`, `boundary_directives` `[]`, 1 service-role factory (`lib/supabase/system.ts`),
  exception register 2 entries (`app/api/v1/**`, `lib/api/**`), no V2-04 register path among the system-module
  importers, `cron_route_files` 0 (`evidence/static-checks.json`).
- Typecheck, inventory, `ci:ai-l1`, workflow policy (7 workflows) exit 0; `ci:audit` PASS (two waived highs)
  (`evidence/close/`).
- Local drift: PASS, 0 statements (V2-03 closed with the pg_net line allowlisted); schema snapshot: 2520 lines equal
  the committed snapshot (`evidence/close/local-drift.txt`, `schema-snapshot-check.txt`).
- Restore drill self-test at `2260c64`: pass, RPO 18 s, RTO 32 s, 12/12 checks (incl. `archive_digest`, `sql_guard`,
  `tampered_archive_refused`), 91 tables / 2905 rows restored, 13 drill pgTAP tests, 45 migrations
  (`evidence/restore-drill-selftest.json`, `evidence/close/restore-drill-selftest-run.txt`).
- Scheduler, real path on macOS (04-02): 5/5 `drill.noop` jobs done, one pg_cron runner pass, one pg_net response 200,
  lag p95 42.212 s (`evidence/scheduler-local-e2e.json`).
- Package legitimacy for the phase: 40 lockfile entries added or re-versioned since `90e8fc8`, 0 problems; `npm audit
  signatures` verified 631 packages (181 with attestations); flagged for the PO: `msw@3.0.3`
  (`evidence/package-legitimacy.json` `plans.phase-close`). Tool pins: `evidence/pins.json`.
- Gitleaks over the git history after the last commit: `evidence/close/gitleaks.txt`.

## Pending PO (ids in `.planning/PO-ACTIONS.md` § "V2-04 Jobs reliability"; not copied here)
- **Before merge:** none blocking. 04-P14 (rulings incl. A2/A3) and 04-P15 (`msw@3.0.3`, age and image pins) are
  delegated to the CTO and recorded as such.
- **Right after merge (in order):** 04-P16, 04-P1 (then approve the staging `migrate` run at once), 04-P8, 04-P9,
  04-P10, 04-P7 (incl. clearing `notify_stopped_code`), 04-P17 (Send Email hook once Resend is live).
- **Later:** 04-R2 (backup Environment), then 04-P11, 04-P12, 04-P13; after each, Claude runs the verify command and
  updates `04-VERIFICATION.md` and VERIFICATION_LOG for acceptance items 3-8.
- Open review Lows without an owner (above) need the PO's assignment.
