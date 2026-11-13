---
phase: 04
roadmap_id: V2-04
name: Jobs reliability
gate: G3-partial
requirements: [P0-12, P1-25 (alerts part), FT-02 (built and drilled on staging), FT-03, FT-04 (job part), RL-23, OI-3, V2-03-R-27 (error-event purge scheduling), V2-03 handovers to V2-04 (03-WAVE-NOTES.md and 03-13-REVIEW-TRIAGE.md; mapped in the Source coverage audit), V2-03 review A Lows L-1 L-2 L-3 L-5 L-6 L-7 L-8 (04-00)]
plans: [04-00, 04-01, 04-05a, 04-02, 04-03a, 04-03b, 04-03c, 04-04, 04-06, 04-05b]
waves: {1: [04-00, 04-01, 04-05a], 2: [04-02], 3: [04-03a], 4: [04-03b], 5: [04-03c], 6: [04-04], 7: [04-06], post-merge: [04-05b]}
source: docs/v2/V2_MASTER_ROADMAP.md §12.2 (V2-04), §9.1 (Free-tier controls), §10 (P0-12, P1-25, FT-02/03/04), C22; docs/adr/0005-confine-service-role-client.md D2-D4 + register; docs/v2/TARGET_ARCHITECTURE.md §3.6, §8; docs/v2/ARCHITECTURE_DECISIONS.md ADR-009; docs/v2/TEST_STRATEGY.md T-07, T-09; .planning/phases/02-ci-e2e-foundations/02-PLAN.md RL-23; .planning/phases/03-platform-hygiene/{03-WAVE-NOTES.md, 03-13-REVIEW-TRIAGE.md, 03-07-D1-SPIKE.md, 03-13c-DB-FIXES.md, 03-13d-LOG-SSRF-FIXES.md}
research: 04-RESEARCH.md
depends_on_phase: V2-03 merged into feature/v2 (as shipped, last migration 000030; env schema `lib/env.ts` + `serverEnv()`/`publicEnv` + R-15 checklist; `getSystemDb(reason)` in `lib/supabase/system.ts` with the closed `REASON_OWNER` map; `npm run db:types`, migration immutability, `scripts/drift/schema-snapshot.{mjs,txt}`; ESLint boundary zones incl. the `lib/jobs/internal/**` rules; `record_payment` + `private.outbox_payment_recorded`; staging-as-code; `lib/log` + `ops.error_events`; `lib/email` `getEmailSender()`; `lib/webhooks/transport.ts` pinned delivery; `readiness_probe(p_expected_migration)` booleans only)
base_commit: feature/v2 at the V2-03 merge commit (recorded in 04-SUMMARY at branch time)
branch: v2/phase-04-jobs-reliability -> feature/v2 (one PR for the phase)
po_direction: PO unavailable. External dependencies (AWS account/bucket/KMS/IAM/OIDC, age keys, SSM parameters, staging Vault secrets, Vercel env, ops inbox, staging pg_cron/pg_net confirmation, staging backup drills) never block. Everything is built and tested locally (local stack, local Storage S3 endpoint as the bucket stand-in, a second local stack for the restore drill, offline/sink providers, flags default off) plus CloudFormation, workflows and runbooks as code. Staging-only acceptance is "pending PO" with the exact verification Claude runs later.
must_haves:
  truths:
    - "8 parallel runners over 200 queued messages send each exactly once (0 duplicate sends)"
    - "A job whose lease expired and a delivery row stuck in processing are reclaimed and finish exactly once more"
    - "No request path calls a messaging provider or a webhook endpoint; requests only enqueue through SECURITY DEFINER RPCs that derive the tenant from the subject row and refuse a subject outside the session's active tenant (a dual-clinic user acting in A cannot enqueue for B)"
    - "Authenticated users cannot INSERT, UPDATE or DELETE rows of communication_queue or webhook_delivery_queue; only the enqueue RPCs, triggers and the runner write them"
    - "pg_cron calls POST /api/jobs/run every minute through pg_net with a Vault-held secret; the route rejects every other caller with a constant-time compare"
    - "A doctor- or receptionist-triggered webhook event is enqueued and delivered once (the owner/admin-only silent drop and the enqueue-time double dispatch are fixed)"
    - "A repeated MSG91 callback changes state once and queues at most one reply"
    - "Dead letters, queue lag, a stale runner and stale backups raise an email alert (Mailpit locally, SES on staging)"
    - "An age-encrypted backup of the local stack restores into a second local stack that passes the drill checks, with RPO and RTO recorded"
    - "The heartbeat row is written every 6 h and the quota snapshot reports database, Storage and MAU against 60 % / 70 %"
  artifacts:
    - supabase/migrations/000031_jobs_queue.sql … 000039_ops_heartbeat_quota_report.sql (9 files; next free numbers, see R-39), each with its app/api/ready/expected-migration.ts bump and regenerated scripts/drift/schema-snapshot.txt
    - lib/jobs/enqueue.ts, lib/jobs/auth.ts, lib/jobs/internal/{types,claim,runner,registry}.ts, lib/jobs/internal/handlers/*.ts
    - app/api/jobs/run/route.ts
    - ops/backup/{backup.sh,evidence.ts}, ops/bin/*, ops/restore-drill/** (erratum 2026-11-14, 04-07c: no stack.template.ts/render.ts/stack.json; the AWS design moved to docs/ops/backup-aws-golive.md)
    - supabase/tests/restore_drill_checks.sql
    - .github/workflows/{backup,backup-alert,ops-report}.yml (+ nightly backup-roundtrip job) (erratum 2026-11-14, 04-07c: backup.yml/backup-alert.yml replace backup-evidence.yml)
    - docs/runbooks/{jobs,backup-restore}.md
  key_links:
    - "cron 'jobs-kick' -> ops.kick_job_runner() -> vault.decrypted_secrets -> net.http_post(timeout 30 s) -> POST /api/jobs/run"
    - "app/api/jobs/run/route.ts -> getSystemDb('jobs.run') -> lib/jobs/internal/runner.ts -> public.claim_jobs (FOR UPDATE SKIP LOCKED, lease token)"
    - "public.enqueue_message / enqueue_webhook_event (p_tenant_id = ServiceContext.tenantId, matched on the subject row) -> private.enqueue_*_internal (definer writer, 03-07 pattern) -> delivery-table INSERT -> AFTER INSERT trigger -> ops.enqueue_job (dedupe_key NOT NULL UNIQUE)"
    - "webhook.deliver handler -> webhook_delivery_claim -> resolveWebhookTarget + postPinned (lib/webhooks/transport.ts, V2-03 pinned address) -> webhook_delivery_finish"
    - "ops.evaluate_alerts() (pg_cron 5 min) -> ops.enqueue_job('alert.notify') -> handlers/alert-notify.ts -> lib/email EmailSender -> OPS_ALERT_EMAIL"
    - "GitHub Actions backup.yml schedule 02:00/14:00 IST (Environment staging-backup, R-48) -> ops/backup/backup.sh -> age (2 recipients) -> Cloudflare R2 bucket (30 d lifecycle) + archive SHA-256 in ops.backup_runs, job summary and artifact (erratum 2026-11-14, 04-07c: was EventBridge -> CodeBuild -> S3 ap-south-1; PO decision 2026-11-13; AWS design kept for production, V2-15)"
---

# Phase 04 (V2-04): Jobs reliability — plan

## Revision 2026-11-13 (post V2-03)

Written before V2-03 was built (against `03-PLAN.md`); revised against what V2-03 shipped (`03-WAVE-NOTES.md`, the
`03-*` records, `03-13-REVIEW-TRIAGE.md`, code at `14e0811`). Changes and why:

- **Real interfaces.** Migrations start at **000031** (V2-03 ends at 000030), next free number per plan (R-39). Every
  migration ships, in the same commit, the `EXPECTED_MIGRATION` bump in `app/api/ready/expected-migration.ts`,
  `npx supabase db reset --local && node scripts/drift/schema-snapshot.mjs --local --write`, and `npm run db:types`
  (03-13b/03-13c; CI fails otherwise). Parallel-wave migrations are reconciled at the wave merge (R-45). Env keys follow
  the shipped R-15 mechanism (`shapeSchema` + `Env` + tier rules + typed `ENV_DOCS`; no per-key accessor).
- **Already done by V2-03 (removed or marked done):** factory allowance narrowed to `lib/jobs/internal/**` and the
  jobs-internals import rule (03-04/03-13c; dropped from 04-02); MSG91/Gupshup/Twilio 10 s timeouts and the
  synthetic-number refusal (03-13d; 04-03a keeps only the runner abort and retryable classification, R-20); webhook
  SSRF byte-level checks, connect-time address pinning (`lib/webhooks/transport.ts`), the dispatcher's tenant check,
  `MAX_WEBHOOK_RETRIES` and the test-ping rate limit (03-13d; 04-03b reuses them; T-04-19 now mitigated); `23P01`/`P0001`
  mapping in `lib/db/errors.ts`. Verified **not** done and kept here: the cron routes still compare with `!==` (RL-23,
  closed by deleting them) and the app-side `enqueueWebhookEvent` still drops events for non-owner roles (R-19).
- **Handed over by V2-03 and added with tests:** active-tenant constraint on the enqueue RPCs (03-07 D1 finding 2,
  R-6 revised); `private.*` definer writers for outbox rows (03-07 pattern, R-44); `event_key` in
  `private.outbox_payment_recorded`; outbox claim for the enqueue/cron double POST (03-10); immediate dead letter for
  `disabled`/synthetic refusals (03-01); revoke of authenticated INSERT/UPDATE/DELETE on both queue tables (M-XTENANT-WH);
  `ops.purge_error_events()` scheduling plus overflow/size alerts (03-09b); Send Email hook `webhook-id` dedupe through
  the shared inbound store (03-11b/03-13a, R-43); staging runbook "migrate before promote" (triage, accepted to V2-04).
- **New plan 04-00 (orchestrator, triage owner "V2-04 (04-00)"):** review A Lows L-1, L-2, L-3, L-5, L-6, L-7, L-8
  (whitespace-only env values, odd loopback forms in deploy tiers, CLI opaque local keys, a staging dry run that gates
  nothing, `wait-for-release` false-failing on a newer deploy, DB passwords in argv, test-lane guard gaps), each with a
  test that fails without the fix (R-47). Wave 1, file-disjoint from 04-01/04-05a, no migration.
- **Changed by V2-03 facts:** `/api/ready` is booleans-only and anon-only (M-PROBE), so R-41 adds boolean job flags,
  not counts; the `ops` schema has no `service_role` USAGE; the read-only staging role is `clinicos_drift_ro`; new
  workflows must pass `scripts/ci/workflow-policy.mjs` and use `scripts/staging/target-guard.mjs`; `EmailTag` is a
  closed union (adds `ops-alert`); `sendDirect*` deletion moves from 04-03a to 04-03c (its last caller moves there).
- **New plan 04-00b (Resend email provider; PO decision 2026-11-13 "Resend now, SES after go-live"):** `EMAIL_PROVIDER`
  gains `resend` and the env key `RESEND_API_KEY` (R-15 checklist: schema + tier rules, `env-schema.spec.ts`, test-lane
  forbid, e2e note, `.env.example`); production accepts `resend` or `ses`; `mailpit` stays refused in staging and
  production; a `NEXT_PUBLIC_` name for the key is refused in every tier. Sender = plain `fetch` to
  `https://api.resend.com/emails` (no SDK, no dependency) with Bearer, one recipient, HTML + text, an `Idempotency-Key`
  derived from the hook's `webhook-id`, a 3 s abort inside the 3.5 s hook budget, `redirect: "error"`, fixed error
  codes. `/api/ready` reports `resend` as configured. Tests against a loopback fake of Resend. Record `04-00b-RESEND.md`.
  Not a change to an approved decision: PO-A3 (SES in Mumbai) still holds for after go-live; SES stays supported.
- **PO actions changed:** 04-P1 (approve migrate right after the merge), 04-P8 (verify text: booleans), 04-P10 (role
  name), 04-P14 (rulings R-6, R-41 revised; R-43…R-47 new; ADR-0005 A2 text and new A3); new **04-P16** (read grant on
  the migration history for `clinicos_drift_ro`, for 04-00's `plan` job). New rulings R-43…R-47.

**Objective (roadmap):** no duplicate or lost messages, and no lost data while Supabase runs on the Free plan.

**Acceptance (roadmap, verbatim):** the parallel-dispatcher test shows 0 duplicate sends; a stuck `processing` row is
reclaimed; queue lag p95 < 2 min in staging (**Assumption (validate)**); an alert fires in the staging drill; an
encrypted dump of staging lands in the `ap-south-1` bucket twice a day and a deliberately failed run raises an alert
[erratum 2026-11-14, 04-07c, also applied to the roadmap: staging backups land in the Cloudflare R2 bucket, PO decision
2026-11-13 / R-48; `ap-south-1` is the production target, V2-15];
the first restore drill rebuilds staging data in a local stack and passes the pgTAP RLS suite, with RPO and RTO
recorded; the heartbeat row is written every 6 h; the quota job reports database, Storage and MAU usage against the
60 %/70 % thresholds.
**Tests (roadmap):** concurrency (T-07 subset) with N parallel dispatchers; reaper test; MSW contract for MSG91;
scheduler migration test on the local stack; the scripted restore drill; a quota-threshold unit test.
**Evidence (roadmap):** CI links; the staging alert-drill record; the restore-drill record in VERIFICATION_LOG; a bucket
listing (object names and sizes only, never contents).

**Carry-overs planned into this phase:** RL-23 (non-constant-time cron compare) → 04-02 (runner) + 04-03a/04-03b (cron
routes deleted); OI-3 (who calls `/api/cron/*`) → 04-P9; V2-03 R-27 (schedule the `ops.error_events` purge) → 04-06;
the ADR-0005 register end state ("From V2-04 the register holds only the `/api/v1` entry") → 04-03c; the latent
owner/admin-only webhook drop (research §3) → 04-03b; the research Pitfall 9 test rewrites → 04-03a/b/c; the 03-07
`record_payment` outbox rows get jobs through the delivery-table trigger and an `event_key` → 04-03b. V2-03 handovers
(revision 2026-11-13): active-tenant constraint on enqueue (03-07 finding 2) → 04-03a/b; `private` definer writers →
04-03a/b; outbox claim for the enqueue/cron double POST (03-10) → 04-03b; non-retryable `disabled`/synthetic refusals
→ 04-03a; revoke of direct queue writes (M-XTENANT-WH) → 04-03c; Send Email hook `webhook-id` dedupe (03-11b, 03-13a
residual 6) → 04-03c; staging "migrate before promote" runbook (triage, accepted) → 04-03c; error-sink overflow and
size alerts (03-09b) → 04-04; error-event purge → 04-06; reasons `cron.dispatch_communications`/`cron.webhooks` removed
(03-02) → 04-03a/b; V2-04 ESLint register zone deleted with its passing cases (03-04) → 04-03c. V2-03 R-10 (SES
bounce/complaint webhook "deferred to V2-04") is **re-homed to V2-12**, not built here (R-40, PO confirms in 04-P14).

**Invariants for the whole phase**
- No product behaviour changes beyond the items in this plan. The two user-visible changes are listed and ruled
  (R-26 test ping becomes queued; R-25 bot replies appear in the communication log). Anything else stops and is raised.
- No call of any kind to a hosted Supabase project, Vercel, AWS or GitHub settings from an implementer session. Claude
  never holds AWS credentials or age private keys (R-14, R-29). Hosted steps are PO actions (§"PO actions") or
  scheduled read-only workflows that agents never dispatch.
- Every external piece has a local stand-in: Mailpit (alert email), `sink`/`dev` messaging providers, the local
  Supabase Storage S3 endpoint as the backup bucket, a second local stack (`clinicos-drill`) as the restore target,
  throwaway age keys generated per self-test. Flags default **off**: `JOBS_DRILL_ENABLED=false`; the scheduler is a
  no-op until Vault holds `jobs_runner_url` + `jobs_runner_secret`; alert email is off without `OPS_ALERT_EMAIL`;
  backups run only where the PO deployed the stack.
- Job payloads carry ids only (one exception, the unmatched-sender reply, whose phone is erased when the job finishes,
  R-25). `last_error`, runner responses, alerts, reports and logs carry codes and counts, never PHI.
- Synthetic data only. No PHI or secret in fixtures, logs, commits or evidence.

**Migration numbering (R-39).** `N` = the first number above the highest file in `supabase/migrations/` on
`feature/v2` at branch time. V2-03 ends at `000030_session_age_token_hook.sql`, so **`N` = 000031** unless the V2-03
merge carries a later file; then take the next free number (never a hard-coded one; `scripts/ci/migration-immutability.mjs
--base auto --against origin/feature/v2` refuses reuse or a number not above the base). Assigned in this order:
`000031_jobs_queue` (04-01), `000032_ops_backup_runs` (04-05a), `000033_jobs_scheduler` (04-02),
`000034_message_enqueue` (04-03a), `000035_webhook_enqueue` (04-03b), `000036_inbound_idempotency` and
`000037_queue_contract` (04-03c), `000038_ops_alerts` (04-04), `000039_ops_heartbeat_quota_report` (04-06). Each plan
records its real numbers in 04-SUMMARY. In the text below `<N>`…`<N+8>` name the same files.

**Per-migration chores (V2-03 03-13b/03-13c; CI `static`/`test` fail without them).** In the **same commit** as every
new migration file: (1) `app/api/ready/expected-migration.ts` `EXPECTED_MIGRATION` = the new number
(`tests/api/readiness-probe-db.spec.ts` pins it to the newest file); (2) `npx supabase db reset --local && node
scripts/drift/schema-snapshot.mjs --local --write` and commit `scripts/drift/schema-snapshot.txt` (CI runs `--check`;
the snapshot covers `public`, `ops`, `private`); (3) `npm run db:types` (`types/database.ts`; `ops`/`private`-only
migrations leave it unchanged, CI's freshness diff proves it); (4) every new function revokes EXECUTE from `PUBLIC,
anon` explicitly (Supabase default privileges grant `anon`); a public SECURITY DEFINER function `anon` may execute
fails `readiness-probe-db.spec.ts` unless it is added to that spec's allowlist with the plan that opened it (none in
V2-04 except the replaced `readiness_probe`); (5) `npm run db:drift:local` stays green. Raise machine reasons only
(`RAISE 'REASON' USING ERRCODE = 'P0001'`) and register each in `RPC_REASON_CODES` (`lib/db/errors.ts`); use `SET
lock_timeout`, never a function-level `statement_timeout` (03-07 finding 3).

## Execution protocol (same as V2-03, plus the drill stack)

- Implementer agents **may** run `npx vitest`, `npm run test:db`, `npm run e2e:build`, `npm run e2e:pr`,
  `npx supabase start|stop|db reset --local|db diff --local|gen types --local`, `npm run seed:local`, the second stack
  `npx supabase start --workdir ops/restore-drill …` / `stop --workdir ops/restore-drill`, `ops/restore-drill/run.sh
  --self-test`, `ops/bin/install-age.sh`, `docker pull` of the digest-pinned images in `ops/bin/pins.env`, and
  `npx tsx scripts/ops/scheduler-local-e2e.ts` (macOS only).
- Implementers **must not**: `git push`, open/retarget PRs, change GitHub/Vercel/Supabase-hosted/AWS settings, run any
  `aws` command against a real account, dispatch any workflow (`staging.yml`, `drift.yml`, `ops-report.yml`,
  `backup-evidence.yml`), run `ops/backup/backup.sh` with `BACKUP_ENV` other than `local`, run any CLI command with
  `--linked` or `db push`, run `seed:cdci*`, `seed:diagnoses`, `msg91:*`, `scripts/msg91-test-send.ts`, anything with
  `--env-file=.env`, `scripts/seed-staging.ts` or `scripts/staging/*`. Never open or print `.env*` (03-01's generator
  rewrites `.env.example` without the agent reading it). Delete `.planning/dev-messages.txt` if a run recreates it.
  Every Supabase CLI call passes `--local`, `--workdir ops/restore-drill`, or a loopback `--db-url`.
- **Shared local stack.** One plan per wave resets/restarts the primary stack, only when no test-run lock is held
  (wave 1: 04-01). Its wave partner applies its own migration with `npx supabase migration up --local` (never a reset
  from a worktree that lacks the partner's file: that drops the partner's objects, 03-07 wave note). The drill stack
  (`project_id = "clinicos-drill"`, ports 553xx) is owned by 04-05a and stopped at the end of every run. The e2e lane is
  single-instance (port 3100); e2e runs inside a wave are serialised.
- **Parallel-wave migration chores (R-45).** In wave 1 both plans add a migration. Each commits its own
  `EXPECTED_MIGRATION` bump and snapshot as seen in its worktree; the orchestrator merges them in migration-number order
  and, in the merge commit, sets `EXPECTED_MIGRATION` to the higher number, regenerates `scripts/drift/schema-snapshot.txt`
  after `db reset --local` with both files, re-runs `npm run db:types`, and re-runs the full Vitest lane before pushing.
- **gitleaks before a plan ends (V2-03 orchestrator note).** After committing, before handing back: `docker run --rm -v
  "$PWD":/repo -w /repo zricethezav/gitleaks:v8.30.1 git --redact --no-banner --config .gitleaks.toml .` must print
  "no leaks found"; a false positive gets an exact-fingerprint line in `.gitleaksignore` with a reason, never a quote of
  the flagged string. Synthetic secrets in specs are built at run time (`[...].join("-")`, `randomBytes`).
- **Lockfile (V2-03 03-06/03-11b).** Any `package.json` change runs `scripts/ci/lock-linux-check.sh --fix` (a macOS
  lock drops the `@emnapi/*` entries and breaks `npm ci` on Linux) and records provenance with
  `scripts/ci/package-legitimacy.mjs --base <pre-plan sha> --plan <id> --out evidence/package-legitimacy.json`.
- **File ownership.** Plans in one wave touch disjoint files (order table). A plan that must edit a file owned by its
  wave partner stops that edit and records it for the wave merge.
- **Tracer first.** Step 1 of every plan is the thinnest end-to-end path through every layer the plan touches, with a
  real test; later steps expand from it. A step that only "lays foundation" is folded into the step that uses it.
- **Per-plan done:** `npm run typecheck`, `npx eslint .` (0 errors), `npm run inventory`, the plan's tests, then the full
  Vitest lane (`npm run test:db`) once at the end of the plan; plus `npm run e2e:build && npm run e2e:pr` for any plan
  that touches `proxy.ts`, env, routes or UI (04-00, 04-02, 04-03a, 04-03b, 04-03c, 04-04). UI work (04-03b) checks 360 px,
  tablet (820) and desktop (1280) and axe (0 serious/critical).
- **Env-key checklist (V2-03 R-15, as shipped in 03-01).** A plan that adds or changes an env name adds, in the same
  commit: the name in `shapeSchema`, the `Env` type and the tier rules in `lib/env.ts`, and its `ENV_DOCS` entry (a typed
  record: typecheck fails until it is documented); code reads it only as `serverEnv().NAME` (no per-key accessor, no
  `process.env` outside the 03-04 allow-list); cases in `tests/config/env-schema.spec.ts`, and the `PRODUCTION` profiles
  in `env-schema.spec.ts` / `tests/config/env-boot.spec.ts` gain any key required in production; a pin or forbid rule in
  `tests/setup/test-env.ts`; the e2e value in `tests/e2e/support/app-env.ts`; `.env.example` regenerated by `node
  scripts/ci/env-example.mjs` (never opened). Tests change values with `vi.stubEnv` (`serverEnv()` re-parses when a
  name's value changes).
- **Background cron in test lanes.** From 04-02 on, `tests/setup/global-setup.ts` and `tests/e2e/global-setup.ts` set
  every `cron.job` row inactive (`cron.alter_job(jobid, active := false)`) before the run and the matching teardowns set
  them active again, so no background evaluation or reaping races a test. Tests call the SQL functions directly.
- **Dependencies.** Exact pins; reason stated below; packages without install scripts; tools pinned by version +
  SHA-256 or image digest in `ops/bin/pins.env`.
- **Orchestrator:** branch `v2/phase-04-jobs-reliability` off `feature/v2` after the V2-03 PR merges; push after every
  wave; open the phase PR as draft after wave 2 so CI proves the scheduler migration on Linux; merge only after the
  gate.

## Execution order

| Wave | Plan | Size | Depends on | Hot files this plan owns in its wave | Why this order |
|---|---|---|---|---|---|
| 1 | **04-00** V2-03 carry-over hardening (review A Lows L-1/2/3/5/6/7/8) | S | V2-03 merged | `lib/env.ts`, `lib/env-server.ts`, `tests/config/{env-schema,env-boot}.spec.ts`, `tests/setup/test-env.ts`, `tests/setup/test-env-guard.spec.ts`, `scripts/staging/{target-guard,wait-for-release,schema-drift,migration-plan}.mjs`, `.github/workflows/{staging,drift}.yml`, `scripts/ci/workflow-policy.mjs`, `tests/ci/{staging-scripts,workflow-policy}.spec.ts`, `docs/runbooks/staging.md`; no migration, never resets the stack | Small, independent; closes V2-03 triage items before V2-04 edits the same env schema and staging files |
| 1 | **04-01** job queue core: `ops.jobs`, claim/lease/fencing/reaper, runner library | M | V2-03 merged | migration `000031`, `types/database.ts`, `lib/jobs/internal/{types,claim,runner}.ts`, `tests/jobs/**`; stack resetter of wave 1 | Everything else runs on it |
| 1 | **04-05a** backup + restore drill as code (local, IaC, evidence workflow) | M | V2-03 merged | migration `000032` (`ops` only), `ops/**`, `supabase/tests/restore_drill_checks.sql`, `.github/workflows/{backup-evidence,nightly,ci}.yml`, `eslint.config.mjs` (`ops/**` tooling zone), `tests/security/p1-34-lint-gates.spec.ts`, `.gitignore`, `tests/helpers/sql.ts`, `tests/ops/**`, `docs/runbooks/backup-restore.md`, `docs/ops/backup-restore.md`, `docs/operations/backups.md` | Longest external lead time (AWS); independent of app code |
| 2 | **04-02** scheduler migration + `/api/jobs/run` | S-M | 04-01 | migration `000033`, `app/api/jobs/run/route.ts`, `lib/jobs/auth.ts`, `lib/jobs/internal/{registry.ts,handlers/drill.ts}`, `lib/supabase/system.ts`, `proxy.ts`, env-guard files, guard manifest + engine, `lint-fixtures/p1-34/**`, `tests/security/p1-34-lint-gates.spec.ts`, test setup/teardown files, `docs/runbooks/jobs.md`, `docs/ops/secret-rotation.md` | Proves pg_cron → pg_net → route → runner before any send moves |
| 3 | **04-03a** message enqueue RPC + `message.send`; inline dispatch removed | M-L | 04-02 | migration `000034`, types, `lib/jobs/enqueue.ts`, `handlers/message-send.ts`, registry, `lib/messaging/**`, `lib/db/errors.ts`, `app/api/ready/route.ts` (`sink` state), 6 feature services, `app/api/cron/dispatch-communications/**` (deleted), `lib/supabase/system.ts`, guard manifest, env files, `eslint.config.mjs`, `lint-fixtures/p0-12/**`, `package.json`/lock | Largest diff; messages first (patient-facing) |
| 4 | **04-03b** webhook enqueue RPC + `webhook.deliver`; fire-and-forget removed; role drop fixed | M | 04-03a | migration `000035`, types, `lib/jobs/enqueue.ts`, `handlers/webhook-deliver.ts`, registry, `lib/webhooks/**`, `lib/db/errors.ts`, 5 feature files, 2 v1 routes, developer-settings UI, `app/api/cron/webhooks/**` (deleted), `lib/supabase/system.ts`, guard manifest, `eslint.config.mjs` | Shares feature services with 04-03a |
| 5 | **04-03c** inbound idempotency, bot replies via the queue, contract step, register shrink, hook dedupe | M | 04-03b | migrations `000036`, `000037`, types, inbound route, `app/api/auth/send-email/route.ts`, `features/auth/system.ts` (new), `lib/messaging/{index,webhook-helpers}.ts`, `lib/jobs/enqueue.ts`, `handlers/message-reply-unmatched.ts`, registry, `lib/supabase/system.ts`, `eslint.config.mjs`, `lint-fixtures/p1-34/**`, `scripts/ci/p1-34-counters.mjs`, `scripts/phase-evidence.mjs`, `docs/runbooks/staging.md` | Contract only after every caller moved |
| 6 | **04-04** alerts (dead letter, lag, stale runner, lease expiry, error burst, error-sink overflow/size, backup stale) | M | 04-03c, 04-05a | migration `000038`, types, `handlers/{alert-notify,drill}.ts`, registry, `lib/email/types.ts`, env files, `app/api/ready/route.ts`, health specs, guard manifest | Needs every job kind and `ops.backup_runs` |
| 7 | **04-06** heartbeat (FT-03) + quota (FT-04) + ops retention + staging ops report | M | 04-04 | migration `000039`, `scripts/ops/check-ops-report.ts`, `.github/workflows/ops-report.yml`, `docs/runbooks/jobs.md`, `tests/ops/**` (new files only) | Adds alert rules to 04-04's registry table |
| post-merge | **04-05b** staging backup stack, failed-run drill, first staging restore drill | PO-driven | merge + 04-P2…P7, P11, P13 | evidence files, VERIFICATION_LOG | External; never blocks the gate (R-19 pattern) |
| close | Phase close | — | all | `scripts/ci/assert-vitest-report.mjs` REQUIRED_FILES + FLOOR | |

Cross-wave hot files and their owners in order: every migration plan owns `app/api/ready/expected-migration.ts` and
`scripts/drift/schema-snapshot.txt` in its wave (04-01 + 04-05a reconciled at the wave-1 merge, R-45; then 04-02 →
04-03a → 04-03b → 04-03c → 04-04 → 04-06); `types/database.ts` 04-01 → 04-03a → 04-03b → 04-03c → 04-04;
`lib/jobs/internal/registry.ts` 04-02 → 04-03a → 04-03b → 04-03c → 04-04; `lib/jobs/enqueue.ts` 04-03a → 04-03b →
04-03c; `lib/db/errors.ts` 04-03a → 04-03b; `eslint.config.mjs` + `tests/security/p1-34-lint-gates.spec.ts` 04-05a →
04-02 → 04-03a → 04-03b → 04-03c; env-guard files (`lib/env.ts`, `tests/config/{env-schema,env-boot}.spec.ts`,
`tests/setup/test-env.ts`, `tests/e2e/support/app-env.ts`, `.env.example`) 04-00 → 04-02 → 04-03a → 04-04;
`scripts/ci/workflow-policy.mjs` + `tests/ci/workflow-policy.spec.ts` 04-00 → 04-06 (04-05a's new workflows must pass
the policy as it stands; a needed policy change goes to the wave merge); `docs/runbooks/staging.md` 04-00 → 04-03c;
`tests/security/guard-manifest.ts` 04-02 → 04-03a → 04-03b → 04-03c → 04-04; `lib/supabase/system.ts` 04-02 → 04-03a →
04-03b → 04-03c; `app/api/ready/route.ts` 04-03a → 04-04; `features/{labs,prescriptions}/service.ts` +
`features/appointments/system.ts` 04-03a → 04-03b; `docs/runbooks/jobs.md` 04-02 → 04-03a → 04-03b → 04-03c → 04-04 →
04-06; `tests/helpers/sql.ts` 04-05a only; `.github/workflows/{ci,nightly}.yml` 04-05a only.

## New dependencies and pinned tools (CLAUDE.md: reason required)

| Item | Pin | Plan | Why | Legitimacy |
|---|---|---|---|---|
| `msw` (devDependency) | **3.0.3** exact | 04-03a | TEST_STRATEGY T-09 mandates MSW at the HTTP boundary for MSG91; `vi.stubGlobal('fetch')` would not exercise request construction | Research audit: **[SUS] too-new** (latest 3.0.5 is 2 days old); 3.0.3 is 34 days old, no `postinstall`; PO confirms before merge (04-P15, R-15) |
| `age` CLI (tool, not npm) | v1.3.2, SHA-256 per platform in `ops/bin/pins.env` | 04-05a | FT-02 locks age encryption; the CLI is the reference implementation and streams | GitHub release `FiloSottile/age`; installed by `ops/bin/install-age.sh` with checksum check (same pattern as `scripts/ci/install-gitleaks.sh`); PO confirms pins (04-P15) |
| `postgres:17` image | digest in `pins.env` | 04-05a, 04-06 | `psql` 17 for manifests, restore and the ops report (host `psql` is 14.21, research pitfall 12) | Docker official image |
| `amazon/aws-cli` image | digest in `pins.env` | 04-05a | local S3 stand-in uploads/listing; the AWS CLI is not installed locally and no AWS SDK is added (the S3 SDK was removed in V2-03 P1-43) | official AWS image |
| `aws-actions/configure-aws-credentials` | 40-hex SHA | 04-05a | OIDC for the read-only evidence role (no stored AWS keys) | official action; V2-03 workflow policy requires SHA pins |
| CodeBuild image `aws/codebuild/amazonlinux-x86_64-standard:5.0` | managed | 04-05a | runs the backup in `ap-south-1` (never a GitHub-hosted runner, PO-23(h)) | AWS managed |
| Supabase CLI | repo pin (03-03: `2.120.0`) | 04-05a | `supabase db dump` encodes Supabase's role/schema exclusions (research "Don't hand-roll") | existing |

No runtime dependency is added. `@aws-sdk/client-sesv2` is already in the lockfile (V2-03 03-11b, SES sender) and is
reused unchanged: alert email goes through `getEmailSender()` (`lib/email`). `pgmq` is not adopted (R-13). The msw
provenance goes through V2-03's tool: `node scripts/ci/package-legitimacy.mjs --base <pre-plan sha> --plan 04-03a --out
evidence/package-legitimacy.json --flagged msw@3.0.3` (resolve with `npm install --before=<7 days ago>` as 03-11b did,
then `scripts/ci/lock-linux-check.sh --fix`); plus `npm audit signatures`. For each tool the `shasum -a 256` /
`docker buildx imagetools inspect` output goes to `evidence/pins.json` (tool output).

---

## 04-00 V2-03 carry-over hardening: review A Lows L-1, L-2, L-3, L-5, L-6, L-7, L-8 (03-13 triage, owner V2-04; R-47) · S · Wave 1

Source: `.planning/phases/03-platform-hygiene/reviews/v203-review-adversarial-env-staging.md` §Low;
`03-13-REVIEW-TRIAGE.md` (accepted, owner "V2-04 (04-00)"). All seven were re-checked open at `14e0811` (L-7 half:
`schema-drift.mjs` already feeds psql through `PG*` env, but `db diff`/`db push` still carry the password in argv).
None is exploitable without staging access; each fix lands with a test that fails without it (V2-03 triage rule).

### Files
`lib/env.ts`, `lib/env-server.ts`, `tests/config/env-schema.spec.ts`, `tests/config/env-boot.spec.ts`;
`tests/setup/test-env.ts`, `tests/setup/test-env-guard.spec.ts`; `scripts/staging/target-guard.mjs`,
`scripts/staging/wait-for-release.mjs`, `scripts/staging/schema-drift.mjs`, `scripts/staging/migration-plan.mjs` (new),
`.github/workflows/staging.yml`, `.github/workflows/drift.yml` (only if a step's `env` must change),
`scripts/ci/workflow-policy.mjs`,
`tests/ci/staging-scripts.spec.ts`, `tests/ci/workflow-policy.spec.ts`; `docs/runbooks/staging.md` (§3 grant SQL for
04-P16, §6 plan job and ancestor rule). No migration, no new dependency, no new env name.

### Steps
1. **Tracer (L-1):** `present()`/`normalise()` in `lib/env.ts` treat a value that is empty **after `trim()`** as unset,
   and every secret-shaped name (the schema's secret keys: `*_SECRET`, `*_SECRET_KEY`, `*_KEY` other than
   `NEXT_PUBLIC_*`, `*_TOKEN`, `*_PASSWORD`, e.g. `CRON_SECRET`, `SUPABASE_SECRET_KEY`, `MSG91_AUTH_KEY`,
   `MSG91_WEBHOOK_SECRET`, `SEND_EMAIL_HOOK_SECRET`, `ERROR_INGEST_KEY`, `SES_SECRET_ACCESS_KEY`) with leading or
   trailing whitespace is refused in every tier ("must not have leading or trailing whitespace"; the value is never
   echoed). Length rules (`MIN_CRON_SECRET_LENGTH`) count the value as given. Then steps 2-7.
2. **L-2 (loopback and bare origins):** `isLoopbackUrl` classifies on the WHATWG-canonical host (`new URL().hostname`
   already folds `127.1`, `0x7f.1`, `[::ffff:127.0.0.1]` into canonical text): IPv4 `127.0.0.0/8` and `0.0.0.0`;
   IPv6 `::1`, `::`, `::ffff:7f00:0/104` and `::ffff:0:0`; `localhost`, `localhost.`, `*.localhost` and
   `*.localhost.`. `lib/env.ts` stays isomorphic (no `node:` import; the byte parser of `lib/webhooks/ssrf.ts` is not
   imported because that module pulls `node:dns`). In staging/production `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_APP_URL` must be a **bare https origin**: no userinfo, path other than `/`, query or fragment.
3. **L-3 (CLI local opaque keys):** in staging/production the two fixed opaque keys the pinned Supabase CLI (2.120.0)
   prints for the local stack are refused as "a local-stack key" (today only the `supabase-demo` JWTs are). No key
   literal enters the source (the gitleaks rule and the review's own redaction): the check compares SHA-256 digests,
   computed once at execution from `npx supabase status -o env` piped straight into `shasum -a 256` (the keys are never
   printed), stored as two hex constants with a comment naming the CLI version. Because `lib/env.ts` is also bundled for
   the browser, the digest check runs on the server parse path (`lib/env-server.ts`, `node:crypto`, the same function
   the boot check in `instrumentation.ts` runs). A CLI upgrade that changes the defaults updates the digests in the
   same commit (the spec reads the live local keys, so it fails otherwise).
4. **L-8 (test-lane guard):** `tests/setup/test-env.ts` refuses any variable whose **name** starts with `STAGING_`
   (covers `STAGING_DB_URL`, `STAGING_DB_URL_RO`, `STAGING_SECRET_KEY`, `STAGING_SEED_PASSWORD`,
   `STAGING_PUBLISHABLE_KEY` and later ones) and adds `sb_secret_` and `sb_publishable_` to `HOSTED_MARKERS` (the lane
   loads the local stack's `supabase-demo` JWT keys, never the opaque ones; deploy-tier profiles in specs build
   prefixed keys at run time after the guard has run, 03-13b).
5. **L-6 (`wait-for-release` and a newer deploy):** `/api/health` reporting a release `R` ≠ the run's SHA is accepted
   when `R` is a 40-hex SHA and `git merge-base --is-ancestor <run sha> <R>` succeeds (git runner injected; the
   `migrate` job's checkout uses `fetch-depth: 0`, or fetches `R` explicitly); the readiness step is unchanged
   (`status: "ready"` and `checks.schema: "current"`), so a newer release whose own migration is still pending keeps
   failing until its run applies it. A release that does not descend from the run's SHA (a rollback) keeps waiting and
   times out as today.
6. **L-5 (the dry run gates nothing):** a new job `plan` in Environment `staging-readonly` (no reviewer) runs
   `scripts/staging/migration-plan.mjs`: target guard on `STAGING_DB_URL_RO`, then `psql` through `pgEnv()` (no URL in
   argv) reads `supabase_migrations.schema_migrations` versions and compares them with `supabase/migrations/*.sql`;
   it writes the pending file names and count to the job summary (names only), exits 0, and exits 1 when the database
   holds an applied version that has no file (history drift). `migrate` gains `needs: plan`, so the reviewer sees the
   plan before approving Environment `staging`; the in-job `db push --dry-run` step stays as a second listing. Agents
   never run `db push` (CLAUDE.md), so the plan is a script that can be tested locally, not the CLI dry run. Needs a
   read grant on the migration history for `clinicos_drift_ro` (runbook §3 SQL, PO action **04-P16**). `workflow-policy.mjs`
   gains the rule "in `staging.yml`, `migrate` needs `plan`, and `plan` runs in `staging-readonly`".
7. **L-7 (DB passwords in argv):** `target-guard.mjs` gains `--print-db-url --no-password` (the URL with the password
   removed) and `--print-pgpassword`; the `staging.yml` dry-run and apply steps export `PGPASSWORD` from the latter and
   pass the password-free URL to `npx supabase db push --db-url`; `schema-drift.mjs` `diffArgs()` takes the
   password-free URL and runs the CLI with `PGPASSWORD` in its env (psql already uses `pgEnv()`). Proof that the CLI
   honours `PGPASSWORD` for a password-free `--db-url` (pgx reads `PG*` defaults): run `PGPASSWORD=<local password>
   npx supabase db diff --db-url postgresql://postgres@127.0.0.1:54322/postgres --schema public` against the **local**
   stack only and save the exit code to evidence. If the CLI ignores it, keep the URL form, record L-7 as accepted
   (single-tenant hosted runners, masked value) and tell the orchestrator — do not weaken anything else.
   `workflow-policy.mjs` gains the rule "no `--print-db-url` without `--no-password` in a staging/drift `run:`".

### Tests that fail without the change
- `env-schema.spec.ts` (L-1): production with `CRON_SECRET` of 32 spaces → refused naming `CRON_SECRET`;
  `SUPABASE_SECRET_KEY=" "`, `MSG91_AUTH_KEY=" "`, `MSG91_WEBHOOK_SECRET=" "` → refused as missing; a valid secret with a
  trailing newline → refused naming the key; no message contains a value (before: all four boot).
- `env-schema.spec.ts` (L-2): in production `NEXT_PUBLIC_APP_URL` = `https://localhost./`, `https://0.0.0.0`,
  `https://[::ffff:127.0.0.1]`, `https://127.0.0.2` → refused as loopback; `NEXT_PUBLIC_SUPABASE_URL` with userinfo, a
  path or a query (`https://u:p@<ref>.supabase.co/x?y`, synthetic ref) → refused as not a bare origin; `https://<ref>.supabase.co`
  passes; test/e2e tiers still accept `http://127.0.0.1:54321` (before: every refused case passes).
- `env-boot.spec.ts` (L-3): a staging profile carrying the live local stack's opaque publishable and secret keys (read
  from the running stack by the spec, never committed) → boot refused "local-stack key"; prefixed keys built at run
  time pass (before: both boot).
- `test-env-guard.spec.ts` (L-8): `STAGING_SECRET_KEY`, `STAGING_SEED_PASSWORD`, `STAGING_PUBLISHABLE_KEY` set → refused
  naming the variable; an unrelated variable holding a run-time-built `sb_secret_…` or `sb_publishable_…` value →
  refused as hosted (before: all pass).
- `staging-scripts.spec.ts` (L-6): `/api/health` reports a descendant SHA (injected git runner answers "ancestor") and
  `/api/ready` is current → exit 0; a non-descendant SHA → timeout exit 1; the equal SHA → exit 0 as before (before: the
  descendant case times out). (L-5) `migration-plan.mjs` with injected `psql` output: two files ahead → both names
  listed, exit 0; none ahead → "0 pending"; an applied version with no file → exit 1; the DB URL never appears in
  output or argv. (L-7) `target-guard --print-db-url --no-password` output has no password; `diffArgs()` holds no
  password and the spawn env carries `PGPASSWORD` (before: the password is in argv).
- `workflow-policy.spec.ts` (L-5, L-7): fixture `staging.yml` whose `migrate` lacks `needs: plan`, or whose `plan` job
  runs in `staging` → fail; a `run:` using `--print-db-url` without `--no-password` → fail; the committed workflows pass.

### Acceptance mapping
V2-03 triage "Review A Lows L-1, L-2, L-3, L-5, L-6, L-7, L-8 → V2-04 (04-00)": closed with the tests above (L-7 either
closed or recorded as accepted with the local CLI evidence). The staging half of L-5 (the plan job's first real output)
is verified post-merge after 04-P16.

---

## 04-01 Job queue core: `ops.jobs`, claim / lease / fencing / reaper, runner library (P0-12, ADR-009, TARGET §8, R-7, R-22) · M · Wave 1

### Files
`supabase/migrations/000031_jobs_queue.sql` (+ the per-migration chores: `app/api/ready/expected-migration.ts`,
`scripts/drift/schema-snapshot.txt`), `types/database.ts`, `lib/jobs/internal/types.ts`,
`lib/jobs/internal/claim.ts`, `lib/jobs/internal/runner.ts`, `tests/jobs/helpers.ts`,
`tests/jobs/claim-grants-db.spec.ts`, `tests/jobs/parallel-dispatch-db.spec.ts`, `tests/jobs/reaper-db.spec.ts`,
`tests/jobs/runner.spec.ts`. The `ops` schema already exists (000028, `REVOKE ALL … FROM PUBLIC, anon, authenticated,
service_role`): the migration adds tables to it and never grants schema USAGE to an API role.

### Steps
1. **Tracer:** the migration's `ops.jobs` + `ops.enqueue_job` + `public.claim_jobs` + `public.complete_job`, and a
   `runJobs` that claims and completes through an injected handler; `parallel-dispatch-db.spec.ts`'s first case (one
   job enqueued in SQL is claimed by `runJobs` and ends `done` with `attempts = 1`). Then expand with steps 2-5.
2. **Migration `000031_jobs_queue.sql`** (names aligned with TARGET §8, R-22). Every function `SECURITY DEFINER`,
   `SET search_path = ''`, owned by `postgres`; every `public` wrapper `REVOKE EXECUTE … FROM PUBLIC, anon,
   authenticated` and `GRANT EXECUTE … TO service_role`; every `ops` function revoked from all API roles.
   - `ops.jobs`: `id uuid pk default gen_random_uuid()`, `tenant_id uuid null references public.tenants(id) on delete
     cascade`, `kind text not null check (kind ~ '^[a-z]+(\.[a-z_]+)+$' and char_length(kind) <= 64)`, `payload jsonb
     not null default '{}' check (octet_length(payload::text) <= 4096)`, `status text not null default 'pending' check
     (status in ('pending','running','done','dead','cancelled'))`, `run_at timestamptz not null default now()`,
     `attempts int not null default 0`, `max_attempts int not null default 5 check (max_attempts between 1 and 20)`,
     `locked_until timestamptz`, `lease_token uuid`, `locked_by text check (char_length(locked_by) <= 64)`,
     `first_claimed_at timestamptz`, `last_lease_expired_at timestamptz`, `last_error text check
     (char_length(last_error) <= 500)`, `dedupe_key text not null check (char_length(dedupe_key) <= 200)` with
     `unique (dedupe_key)` (NOT NULL, not TARGET's `NULLS NOT DISTINCT`, R-7), `created_at`, `updated_at`,
     `finished_at`. Indexes: `(run_at) where status = 'pending'`, `(locked_until) where status = 'running'`,
     `(tenant_id)`, `(status, finished_at)`. RLS enabled, no policies; `REVOKE ALL … FROM PUBLIC, anon, authenticated,
     service_role` (access only through the functions; `ops` stays out of `[api] schemas`).
   - `ops.job_runner_runs` (`id bigserial`, `worker`, `source` ∈ `pg_cron|manual|test`, `started_at`, `finished_at`,
     `claimed`, `done`, `retried`, `dead`, `ok boolean`, `error_code text ≤ 64`), same lockdown.
   - `ops.enqueue_job(p_kind, p_tenant_id, p_payload, p_dedupe_key, p_run_at default now(), p_max_attempts default 5)
     returns uuid`: `INSERT … ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`, else returns the existing id. Called only
     by other definer functions and triggers.
   - `public.claim_jobs(p_kinds text[], p_batch int, p_lease_seconds int, p_worker text, p_per_tenant int default 10)
     returns table (id uuid, kind text, tenant_id uuid, payload jsonb, attempts int, max_attempts int, lease_token
     uuid, run_at timestamptz)` (a table type, not `setof ops.jobs`, so PostgREST never needs the `ops` type). Bounds:
     batch 1..100, lease 10..900 s, per-tenant 1..100, else `22023`. Two-step fairness (pitfall 4: `FOR UPDATE` cannot
     sit in a query with a window function): CTE `locked` selects up to `p_batch * 4` rows `WHERE kind = ANY(p_kinds)
     AND ((status = 'pending' AND run_at <= now()) OR (status = 'running' AND locked_until < now() AND attempts <
     max_attempts)) ORDER BY run_at FOR UPDATE SKIP LOCKED`; CTE `fair` keeps `row_number() OVER (PARTITION BY
     coalesce(tenant_id, '00000000-0000-0000-0000-000000000000') ORDER BY run_at) <= p_per_tenant`, ordered by `run_at`,
     `LIMIT p_batch`; the `UPDATE … FROM fair` sets `status = 'running'`, `attempts = attempts + 1` (counted at claim:
     poison-pill protection), `locked_until = now() + p_lease_seconds`, `lease_token = gen_random_uuid()`, `locked_by =
     left(p_worker, 64)`, `first_claimed_at = coalesce(first_claimed_at, now())`, `last_lease_expired_at = CASE WHEN
     status = 'running' THEN now() ELSE last_lease_expired_at END` (old-row value), `updated_at = now()`.
   - `public.complete_job(p_id uuid, p_lease_token uuid) returns boolean`: fencing — only `WHERE id = p_id AND
     lease_token = p_lease_token AND status = 'running'` → `done`, `finished_at`, lease cleared; returns whether a row
     changed (a stale worker gets `false` and changes nothing).
   - `public.fail_job(p_id uuid, p_lease_token uuid, p_error_code text, p_retryable boolean, p_retry_at timestamptz
     default null) returns text` (`pending` | `dead` | `stale`): same fencing; retryable and `attempts < max_attempts` →
     `pending` with `run_at = greatest(now(), coalesce(p_retry_at, now() + least(interval '6 hours', interval '30
     seconds' * power(2, attempts - 1)) * (0.5 + random() / 2)))` (exponential with jitter); otherwise `dead`,
     `finished_at`. `last_error = left(p_error_code, 500)`.
   - `ops.reap_jobs() returns int`: `running` with `locked_until < now()` and `attempts >= max_attempts` → `dead`,
     `last_error = 'lease_expired'` (expired leases with attempts left are simply claimable again).
   - `public.jobs_runner_begin(p_worker text, p_source text) returns bigint` and `public.jobs_runner_end(p_run_id bigint,
     p_claimed int, p_done int, p_retried int, p_dead int, p_ok boolean, p_error_code text) returns void`.
3. **`lib/jobs/internal/types.ts`:** `ClaimedJob`; `HandlerResult = { outcome: "done" } | { outcome: "retry"; code:
   string; retryAt?: Date } | { outcome: "dead"; code: string }`; `JobHandler<P> = { schema: ZodType<P>; maxDurationMs:
   number; run(job, payload: P, ctx: { db; signal: AbortSignal; now(): Date }): Promise<HandlerResult> }`;
   `HandlerMap = Record<string, JobHandler<unknown>>`. `claim.ts`: typed wrappers over the five RPCs (generated
   `Database` types).
4. **`runJobs({ db, budgetMs, batch, leaseSeconds, perTenant, worker, source, kinds, handlers, now? })`:** begins a
   runner row; loops `claim_jobs` until the budget is spent or a claim returns 0 rows; never starts a job when the
   remaining budget is below `handler.maxDurationMs + 1000`; per job: unknown kind → `fail_job(…, 'unknown_kind',
   false)`; payload fails the zod schema → `'invalid_payload'`, non-retryable; handler runs with
   `AbortSignal.timeout(maxDurationMs)`; `done` → `complete_job`; `retry` → `fail_job(retryable, retryAt)`; `dead` →
   `fail_job(non-retryable)`; a thrown error → retryable with `errorTag(err)` (`import { errorTag, log } from
   "@/lib/log"`) as the code, never the message. Jobs in one pass run sequentially. Ends the runner row; returns `{
   claimed, done, retried, dead, durationMs }`; one `log.info({ event: "jobs.run.completed", count, durationMs })`
   (event names match `EVENT_PATTERN`; `reason`/`module` are `LogWord`s, a computed one goes through `logWord()`; job
   kinds are never logged as free text). No env reads (callers pass config), no `getSystemDb` (the route passes the
   client), no payload in logs.
5. Per-migration chores (expected-migration bump, snapshot `--write` after `db reset --local`, `npm run db:types`).

### Tests that fail without the change
- `claim-grants-db.spec.ts`: `anon` and an authenticated member calling `claim_jobs`, `complete_job`, `fail_job`,
  `jobs_runner_begin` get `42501`; `/rest/v1/jobs` is not served; the service role succeeds; `ops.enqueue_job` twice
  with one key → one row (SQL helper); inserting a NULL `dedupe_key` → `23502`; `pg_proc` shows `prosecdef = true` and
  `proconfig = {search_path=""}` for every new function.
- `parallel-dispatch-db.spec.ts` (T-07 subset, jobs level): 200 `test.record` jobs across 3 tenants; 8 concurrent
  `runJobs` (batch 10, lease 60 s) with a recording handler → 200 handled ids, 200 distinct, every job `done` with
  `attempts = 1`. Fairness: tenant A 100 due jobs, tenant B 5, `claim_jobs(batch 10, per_tenant 5)` returns 5 of A and
  all 5 of B (before: no claim RPC exists).
- `reaper-db.spec.ts`: claim with lease 10 s, move `locked_until` into the past via SQL (no sleeps), claim again → same
  id, `attempts = 2`, new token, `last_lease_expired_at` set; `complete_job(first token)` → `false` and status
  unchanged (fencing); `complete_job(second token)` → `done`; a `running` job with `attempts = max_attempts` and an
  expired lease → `ops.reap_jobs()` → `dead`, `last_error = 'lease_expired'`; `fail_job` retryable on attempt 1 →
  `pending` with `run_at` in [now + 15 s, now + 30 s]; on the last attempt → `dead`; non-retryable → `dead` at once.
- `runner.spec.ts` (unit, fake RPC client): an unknown kind and an invalid payload are failed non-retryable; a handler
  throwing an error whose message holds a synthetic phone → `fail_job` receives the error tag only (the phone appears
  nowhere in recorded calls or captured stdout); with a 3 s budget and a handler of `maxDurationMs` 5 s, no job is
  started; counts are returned.

### Acceptance mapping
"the parallel-dispatcher test shows 0 duplicate sends": jobs level here; with the real `message.send` handler and
delivery rows in 04-03a. "a stuck `processing` row is reclaimed": job-lease level here; delivery-row level in 04-03a.

---

## 04-05a Backup and restore drill as code (FT-02 local half, R-3, R-4, R-11, R-14, R-29, R-30, R-31) · M · Wave 1

### Files
- `supabase/migrations/000032_ops_backup_runs.sql` (`ops` only; types unchanged; expected-migration bump and snapshot
  reconciled at the wave-1 merge, R-45; applied to the shared stack with `npx supabase migration up --local`).
- `ops/bin/pins.env` (age version + per-platform SHA-256, `postgres:17` and `amazon/aws-cli` digests, Supabase CLI
  version = repo pin), `ops/bin/install-age.sh`, `ops/bin/aws-docker.sh`, `ops/bin/psql-docker.sh`.
- `ops/backup/backup.sh`, `ops/backup/stack.template.ts`, `ops/backup/render.ts`, `ops/backup/stack.json` (generated),
  `ops/backup/evidence.ts`.
- `ops/restore-drill/supabase/config.toml`, `ops/restore-drill/run.sh`, `ops/restore-drill/compare-manifest.ts`,
  `ops/restore-drill/check-evidence.ts`, `supabase/tests/restore_drill_checks.sql`.
- `.github/workflows/backup-evidence.yml` (new), `.github/workflows/nightly.yml` (job `backup-roundtrip`),
  `.github/workflows/ci.yml` (`static`: `npx tsx ops/backup/render.ts --check`), `.gitignore` (`/.cache/`),
  `eslint.config.mjs` (`ops/**` joins `TOOLING_FILES`, the same exceptions as `scripts/**`; per 03-04 a new allowance
  needs a pass and a fail case in `tests/security/p1-34-lint-gates.spec.ts`: `ops/x.ts` reading `process.env` passes,
  `lib/x.ts` doing the same still fails), `tests/helpers/sql.ts` (it exports `psql`, `psqlAsync`, `psqlSession`,
  `localDbContainer`; add `psqlFile(path, vars, { container })` for the drill checks).
- Workflow rules from V2-03 03-08/03-13b (`node scripts/ci/workflow-policy.mjs` in `static` must stay green):
  `backup-evidence.yml` and the nightly job use SHA-pinned actions, block YAML only, no `${{ }}` inside `run:` (values
  go through step `env`), `npm ci --ignore-scripts` and no npm cache in any job holding a secret or an OIDC role, no
  `pull_request*`/`workflow_run` trigger, no `write-all`. Schedules fire only once the default branch is `feature/v2`
  (RL-3), so the first scheduled runs are post-merge evidence.
- `docs/runbooks/backup-restore.md` (new, R-10); `docs/ops/backup-restore.md`, `docs/operations/backups.md` (pointer
  header to the runbook; their unverified claims removed).
- Tests: `tests/ops/backup-stack-policy.spec.ts`, `tests/ops/backup-render.spec.ts`,
  `tests/ops/backup-script-guards.spec.ts`, `tests/ops/manifest-compare.spec.ts`, `tests/ops/backup-evidence.spec.ts`,
  `tests/ops/restore-drill-checks-db.spec.ts`.
- Evidence: `.planning/phases/04-jobs-reliability/evidence/restore-drill-selftest.json`, `evidence/pins.json`.

### Steps
1. **Tracer:** `ops.backup_runs` + `backup.sh` in `BACKUP_ENV=local` dumping the primary local stack, encrypting to two
   throwaway age recipients and uploading to the local Storage S3 endpoint; `run.sh --self-test` downloading,
   decrypting, restoring into the drill stack and passing `restore_drill_checks.sql`; the evidence JSON written. Then
   expand with steps 2-8.
2. **Migration `000032`:** `ops.backup_runs(id bigserial, environment text, started_at, finished_at, status ok|failed,
   object_key text ≤ 200, archive_bytes bigint, duration_s int, manifest_counts jsonb (row counts per table, object
   count/bytes per bucket; no names of objects), error_code text ≤ 64)`, RLS on, no policies, revoked from every API
   role (the job writes it as `postgres` through `psql`; 04-04's `backup_stale` rule and 04-06's report read it).
3. **Pins and wrappers:** `install-age.sh` downloads the pinned release for the host OS/arch into `.cache/ops-bin/`,
   verifies the SHA-256 from `pins.env`, refuses on mismatch; `aws-docker.sh` runs the digest-pinned `amazon/aws-cli`
   with `--add-host=host.docker.internal:host-gateway` and only the AWS env names it needs; `psql-docker.sh` runs the
   pinned `postgres:17` `psql` the same way, rewriting `127.0.0.1`/`localhost` to `host.docker.internal`. CodeBuild uses
   its native `aws` (container credentials) and the same `psql-docker.sh`.
4. **`backup.sh`** (`set -euo pipefail`, `umask 077`, temp dir removed by `trap` on every exit; never prints a URL or
   key): `--check-config` validates and exits; `FORCE_FAIL=1` exits 64 before any connection (failed-run drill).
   Guards: `BACKUP_ENV=local` requires loopback `DB_URL` and a loopback `TARGET_S3_ENDPOINT`; `staging`/`production`
   require a non-loopback `DB_URL`, no `TARGET_S3_ENDPOINT`, `TARGET_BUCKET`, and ≥ 2 distinct `age1…` recipients.
   Steps: (a) `npx --yes supabase@<pin> db dump` three times — `--role-only` → `roles.sql`, default → `schema.sql`,
   `--data-only --use-copy -x cron.job -x cron.job_run_details -x net.http_request_queue -x net._http_response -x
   storage.buckets_vectors -x storage.vector_indexes` → `data.sql` (flags verified with `--dry-run` at execution; local
   mode uses `--local`, hosted mode `--db-url`), plus `--schema supabase_migrations` history; (b) storage: bucket ids
   from `storage.buckets` via `psql`, then `aws s3 sync s3://<bucket> storage/<bucket> --endpoint-url
   <STORAGE_S3_ENDPOINT>` per bucket (S3 keys from env); (c) `manifest.json`: format version, environment, start/end,
   CLI and server versions, row count per table, `pg_database_size`, per-bucket object count/bytes and per-object
   SHA-256 (inside the encrypted archive only); (d) `tar` → `age -r <r1> -r <r2>` → check the output starts with
   `age-encryption.org/v1` → log `backup.encrypted age_header=ok bytes=<n> sha256=<archive sha>`; (e) upload to
   `<prefix><UTC yyyy-mm-ddTHHMMSSZ>.tar.age` (names carry no tenant or patient data) with `aws s3 cp` (bucket default
   encryption does SSE-KMS; no SSE flags so the local stand-in accepts the same command); (f) insert an
   `ops.backup_runs` row; (g) dead-man for the scheduler: if `vault.secrets` holds `jobs_runner_url` and
   `ops.job_runner_runs` has no `ok` run in the last 15 min, log `backup.deadman runner_stale` and exit 3 after the
   upload, so the build fails and SNS emails (independent of the app); (h) on any error a best-effort `failed`
   `ops.backup_runs` row, then exit ≠ 0.
5. **Restore drill:** `ops/restore-drill/supabase/config.toml` (`project_id = "clinicos-drill"`, ports 55320-55329, no
   `migrations` folder, studio/edge/logflare/vector/imgproxy/supavisor/realtime/kong/postgrest/mailpit/postgres-meta
   excluded at start so only db, auth and storage run — verify at execution that GoTrue and storage-api migrate their
   schemas). `run.sh --dump <file> --identity <file> [--evidence <out>]`: refuses a dump or identity path inside the
   repo; starts the drill stack; `age -d`; restores in Supabase's documented order in one transaction (`psql
   --single-transaction -v ON_ERROR_STOP=1 -f roles.sql -f schema.sql -c 'SET session_replication_role = replica' -f
   data.sql`), then migration history; verifies every restored `storage.objects` row has a file of the same size and
   SHA-256 in the archive (R-29: objects are verified, not re-uploaded); runs `restore_drill_checks.sql` with
   manifest-derived psql variables; `compare-manifest.ts` (restored counts vs manifest); writes evidence JSON (start,
   end, RTO = drill start → checks green, RPO = drill start − dump start, plus `dump_age_h`; check results; counts
   only); stops the drill stack and deletes plaintext. `--self-test`: seeds the primary stack (`npm run seed:local`),
   uploads one synthetic file to a local bucket, generates two throwaway age key pairs in a temp dir, runs `backup.sh`
   (`BACKUP_ENV=local`), downloads the archive from the stand-in, runs the drill, then decrypts once with the second
   key (break-glass path). `--decrypt-only` proves a key without restoring. If a COPY into a Supabase-managed table
   fails because of service-version skew, the runbook step aligns `ops/restore-drill/supabase/.temp/*-version` with
   staging's versions (risk K-6).
6. **`restore_drill_checks.sql`** (pgTAP inside `BEGIN … ROLLBACK`, R-11): RLS enabled on every `public` table; policy
   and function counts equal the manifest; `auth.users` count equals the manifest; `cron.job` is empty and
   `net.http_request_queue` is empty (pitfall 8); tenant isolation: picks a restored membership (user U, tenant A),
   inserts a synthetic tenant B with one patient as `postgres`, then `SET LOCAL ROLE authenticated` + `request.jwt.claims`
   for U → 0 rows of B from `patients` and every other tenant table with a `tenant_id` column. V2-05 swaps in its
   generated pgTAP matrix (05-01).
7. **IaC (R-30):** `stack.template.ts` builds the CloudFormation template as an object; `render.ts` inlines
   `backup.sh`, `install-age.sh`, `psql-docker.sh` and `pins.env` as base64 lines in the buildspec (`printf '%s' … |
   base64 -d > …`, deterministic) and writes `stack.json`; `--check` exits 1 when `stack.json` is stale; `--check-recipients <r1>,<r2>`
   exits 0 only for two distinct well-formed `age1…` recipients (04-P3); template ≤
   51,200 bytes (direct `aws cloudformation deploy` upload limit). Parameters: `Environment` (staging|production),
   `AgeRecipients`, `AlertEmail`, `GitHubRepository`, `GitHubEnvironment`, `CreateGitHubOidcProvider`. Resources:
   customer-managed KMS key + alias (R-3); bucket — versioning on, default SSE-KMS with that key and bucket key on, all
   four Block Public Access flags, policy denying `aws:SecureTransport = false`, lifecycle rule 1 `Expiration 30 days` +
   `NoncurrentVersionExpiration 1 day`, rule 2 `ExpiredObjectDeleteMarker true` (two rules, research A10); SNS topic +
   email subscription + topic policy for EventBridge and CloudWatch; CodeBuild project (privileged for Docker, Node 22
   runtime, timeout 60 min, env: plaintext `BACKUP_ENV`, `TARGET_BUCKET`, `TARGET_PREFIX=<env>/`, `AGE_RECIPIENTS`;
   `PARAMETER_STORE` for `DB_URL` and the storage S3 endpoint/region/key id/secret under `/clinicos/<env>/backup/`);
   log group, 30-day retention; CodeBuild role: `s3:PutObject` on `<bucket>/<env>/*` only (no `GetObject`, no
   `DeleteObject*`, no `*`), `kms:GenerateDataKey` on the key, `ssm:GetParameters` on the parameter path, logs on its
   group; EventBridge Scheduler `cron(0 2,14 * * ? *)`, `Asia/Kolkata`, flexible window off, retry 2 attempts / 3600 s,
   role with `codebuild:StartBuild` on the project only; EventBridge rule on `CodeBuild Build State Change` for
   `FAILED`, `TIMED_OUT`, `STOPPED` → SNS (input transformer: project, build id, status only); CloudWatch alarm
   `AWS/CodeBuild SucceededBuilds` Sum < 1, period 21600 s, 3 of 3, `TreatMissingData: breaching` → SNS (catches a
   schedule that never fires); GitHub OIDC provider (conditional) + evidence role trusted only for
   `repo:<GitHubRepository>:environment:<GitHubEnvironment>` with `aud = sts.amazonaws.com`, allowed `s3:ListBucket`,
   `s3:ListBucketVersions`, `s3:GetBucketVersioning`, `s3:GetLifecycleConfiguration`, `s3:GetEncryptionConfiguration`,
   `s3:GetBucketPublicAccessBlock`, `s3:GetBucketPolicyStatus`, `s3:GetBucketLocation`,
   `codebuild:ListBuildsForProject`, `codebuild:BatchGetBuilds`, `cloudwatch:GetMetricStatistics`,
   `logs:FilterLogEvents` on the build log group — no object reads. Outputs: `BucketName`, `EvidenceRoleArn`,
   `TopicArn`, `ProjectName`, `ScheduleName`. Check current CloudFormation property names (e.g. whether
   `AWS::IAM::OIDCProvider` still needs `ThumbprintList`) against AWS docs at execution.
8. **Evidence + CI:** `evidence.ts` (injected command runner) lists object versions under the prefix (key, size,
   last-modified, version id, latest flag), bucket location/versioning/lifecycle/encryption/public-access-block/policy
   status, the last 20 builds (id, status, times, env-override names), SNS delivered/failed counts, and the
   `backup.encrypted`/`backup.done` log lines; computes `twice_daily_ok` (each of the last N full IST days has an object
   in 02:00–03:30 and in 14:00–15:30 IST), `lifecycle_ok`, `encryption_ok`, `bpa_ok`, `region_ok`, `failed_run_alerted`;
   writes names, sizes and timestamps only; `evidence.ts --check <file>` re-validates a downloaded artifact (allowed
   keys, verdicts) for Claude's post-merge verification. `check-evidence.ts <file>` does the same for a drill evidence
   file (all checks green, RPO ≤ 12 h, RTO ≤ 4 h, counts only). `backup-evidence.yml`: `schedule` `0 12 * * *` (17:30 IST) +
   `workflow_dispatch`; `permissions: { id-token: write, contents: read }`; `environment: staging-readonly`; SHA-pinned
   actions; no `pull_request` trigger; uploads the JSON artifact. Nightly `backup-roundtrip` job (GitHub runner, local
   synthetic data only — allowed by PO-23(h)): installs age, starts the primary stack, runs `run.sh --self-test`,
   uploads the evidence JSON. Runbook `docs/runbooks/backup-restore.md`: architecture, PO deploy (04-P2…P7), schedule,
   on-demand dump before a production migration or purge batch (`aws codebuild start-build`), failed-run drill, monthly
   restore drill, real restore into a new Supabase project (restore order, object upload with `aws s3 sync` to the new
   project's S3 endpoint, re-create Vault secrets — Vault is not in dumps — pause `jobs-kick` and review pending jobs
   older than the dump before resuming), key rotation, RPO ≤ 12 h / RTO ≤ 4 h (R-4), early-upgrade triggers (§9.1 item
   3).

### Tests that fail without the change
- `backup-stack-policy.spec.ts` (on the rendered template object): versioning `Enabled`; both lifecycle rules with the
  exact values; SSE-KMS with the stack key and bucket key; four BPA flags true; the TLS-deny statement; the writer role
  grants `s3:PutObject` only on `<bucket>/staging/*` and nothing matching `s3:Get*`, `s3:Delete*` or `*`; the evidence
  role has no object-read action and its trust policy pins the environment `sub` and `aud`; schedule expression,
  timezone and retry policy; the failure rule's three statuses; the alarm's metric, period, datapoints and
  missing-data treatment; no plaintext env var named like a secret.
- `backup-render.spec.ts`: `render.ts --check` exits 0 on the committed output; a temp copy with a changed `backup.sh`
  exits 1; output ≤ 51,200 bytes; rendering twice is byte-identical.
- `backup-script-guards.spec.ts` (spawns `bash ops/backup/backup.sh --check-config` with synthetic env): `local` + a
  non-loopback `DB_URL` → exit 2 naming `DB_URL`; `staging` + loopback → exit 2; `staging` with one recipient → exit 2;
  `FORCE_FAIL=1` → exit 64 with `docker` and `npx` stubbed on `PATH` to record calls (none made); the synthetic
  password inside `DB_URL` never appears on stdout/stderr.
- `manifest-compare.spec.ts`: equal → pass; one table's count differs → fail naming the table; an object size or
  SHA-256 mismatch → fail naming the bucket.
- `backup-evidence.spec.ts` (fixture command outputs): two objects per IST day in both windows → `twice_daily_ok`; a
  missing 14:00 object → false; a lifecycle without `ExpiredObjectDeleteMarker` → `lifecycle_ok` false; output keys are
  the allowed set.
- `restore-drill-checks-db.spec.ts` (DB lane, primary stack): the check file passes with manifest values computed live;
  wrapped in a transaction that first disables RLS on `public.patients` → fails naming `patients`; a seeded
  `cron.job` row in the transaction → fails.
- Scripted drill (roadmap "the scripted restore drill"): `ops/restore-drill/run.sh --self-test` locally and in the
  nightly job → `restore-drill-selftest.json` with all checks green (tool output).

### Acceptance mapping
"an encrypted dump of staging lands in the `ap-south-1` bucket twice a day and a deliberately failed run raises an
alert" (erratum 2026-11-14, 04-07c: the staging bucket is Cloudflare R2, written by `backup.yml`; no CloudFormation
template; evidence is `backup.yml`'s `backup-evidence` artifact, not `backup-evidence.yml`): code, template, policy proofs and evidence workflow full; the hosted result **pending PO (04-P2…P7, P11)**,
closed by 04-05b. "the first restore drill rebuilds staging data in a local stack and passes the pgTAP RLS suite, with
RPO and RTO recorded": mechanics proven by the self-test (local data); the staging dump drill **pending PO (04-P13)**.
Evidence "a bucket listing (object names and sizes only)": `backup-evidence.yml` artifact after 04-P6.

---

## 04-02 Scheduler (pg_cron → pg_net → `/api/jobs/run`) (P0-12, C22, RL-23, R-12, R-16, R-17, R-18, R-21, R-32) · S-M · Wave 2

### Files
- `supabase/migrations/000033_jobs_scheduler.sql` (no `public` change; types unchanged) + per-migration chores.
- `app/api/jobs/run/route.ts`, `lib/jobs/auth.ts`, `lib/jobs/internal/registry.ts`, `lib/jobs/internal/handlers/drill.ts`.
- `lib/supabase/system.ts`: reason `jobs.run` → `REASON_OWNER` module `app/api/jobs/run` (the closed union makes
  typecheck require the entry; `tests/security/system-db.spec.ts` covers the new reason automatically; the module value
  is a lower-case path, which `lib/log/fields.ts` `MODULE_PATTERN` accepts).
- `proxy.ts` (`/api/jobs/run` joins the `/api/health` / `/api/ready` early return: no session refresh; request id still
  set); `tests/api/proxy-matcher.spec.ts` case.
- Env-key checklist files: `lib/env.ts`, `tests/config/{env-schema,env-boot}.spec.ts`, `tests/setup/test-env.ts`,
  `tests/e2e/support/app-env.ts`, `.env.example` (regenerated).
- `tests/setup/global-setup.ts`, `tests/setup/teardown.ts`, `tests/e2e/global-setup.ts` (pause/resume cron, protocol).
- `tests/security/guard-manifest.ts`, `tests/security/guard/engine.ts` (route kind `runner-secret`; the existing
  `cron-secret` kind stays for the two cron routes until 04-03a/b delete them and for the diag route).
- `lint-fixtures/p1-34/*`, `tests/security/p1-34-lint-gates.spec.ts` (cases only: the rules exist since 03-04/03-13c).
- `scripts/ci/local-drift.mjs` + `tests/ci/local-drift.spec.ts` (only if the CLI diff reports new extension false
  positives; each allowlisted line cites its cause).
- `scripts/ops/scheduler-local-e2e.ts`; `docs/runbooks/jobs.md` (new); `docs/ops/secret-rotation.md`.
- Tests: `tests/jobs/scheduler-migration-db.spec.ts`, `tests/jobs/run-route.spec.ts`, `tests/jobs/runner-auth.spec.ts`,
  `tests/e2e/jobs/run-route.spec.ts`. Evidence: `evidence/scheduler-local-e2e.json`.

### Steps
1. **Tracer:** migration + route + `drill.noop`: a `drill.noop` job seeded by `ops.drill_enqueue` is processed by a
   `POST /api/jobs/run` with the synthetic bearer (`run-route.spec.ts` first case). Then steps 2-7.
2. **Migration:** `create extension if not exists pg_cron;` and `create extension if not exists pg_net with schema
   extensions;` — on a project without them the migration fails loudly (R-34). Then `REVOKE USAGE ON SCHEMA net`, `REVOKE
   ALL ON ALL TABLES IN SCHEMA net`, `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA net` from `PUBLIC, anon, authenticated`
   (pitfall 5; R-16). `ops.kick_job_runner() returns bigint` (definer, `search_path = ''`): reads `jobs_runner_url` and
   `jobs_runner_secret` from `vault.decrypted_secrets`; returns `null` without a request when either is missing (local
   and CI); rejects a URL that is not `https://` unless its host is `127.0.0.1`, `localhost` or `host.docker.internal`;
   `net.http_post(url, body => '{"source":"pg_cron"}', headers => Content-Type + Authorization: Bearer <secret>,
   timeout_milliseconds => 30000)` (R-17). `ops.drill_enqueue(p_kind text, p_count int default 1, p_spread interval
   default '0', p_max_attempts int default 2) returns int`: kinds `drill.%` only, count ≤ 500, `run_at` spread evenly
   over `p_spread`, dedupe `drill:<kind>:<uuid>`; executable by `postgres` only (SQL editor). Name-keyed schedules:
   `jobs-kick` `* * * * *` `select ops.kick_job_runner()`; `jobs-reap` `* * * * *` `select ops.reap_jobs()`;
   `cron-history-cleanup` `15 0 * * *` deleting `cron.job_run_details` older than 7 days (pitfall 10). pg_cron runs in
   GMT on Supabase; the runbook lists IST equivalents.
3. **Runner auth (RL-23, R-18):** `isAuthorisedRunner(header, { current, next })`: requires `Bearer `; compares
   `timingSafeEqual(sha256(given), sha256(secret))` against the current and, if set, the next secret (the shipped
   pattern of `verifyMsg91WebhookSecret` in `lib/messaging/webhook-helpers.ts` and `app/api/diag/error/route.ts`); no
   secret configured → always `false`; never throws on length differences.
4. **Route `app/api/jobs/run/route.ts`:** `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `maxDuration = 60`. `POST`:
   auth first → 401 `{ ok: false }` before any DB access; body ≤ 1 KB parsed with zod `{ source?: "pg_cron" | "manual" }`
   (default `manual`); `runJobs({ db: getSystemDb("jobs.run"), budgetMs: 25_000, batch: 25, leaseSeconds: 120,
   perTenant: 10, worker, source, kinds: Object.keys(handlers), handlers: getJobHandlers() })` with `worker` =
   `<deploymentInfo().region ?? "local">:<8 hex>` (`deploymentInfo()` from `lib/env-server.ts`; no direct
   `VERCEL_REGION` read, 03-04 `process.env` rule) → 200 `{ ok, claimed, done, retried, dead, durationMs }`; an exception → 500 `{ ok: false }` (fixed body) and
   `log.error({ event: "jobs.run.failed", code: errorTag(err), requestId: await getRequestId() })`. `GET`, `PUT`,
   `PATCH`, `DELETE` → 405 with `Allow: POST` (no secret in query strings, no GET side effects). Lease 120 s ≫ runner
   budget 25 s ≫ provider timeouts (`MESSAGING_PROVIDER_TIMEOUT_MS` 10 s, `WEBHOOK_TIMEOUT_MS` 5 s, both V2-03) —
   pitfall 2.
5. **Registry:** `getJobHandlers()` returns the production map; `drill.noop` (done at once) is included only when
   `serverEnv().JOBS_DRILL_ENABLED` is true. Later plans add their kinds here.
6. **Env (checklist):** `JOBS_RUNNER_SECRET` — staging and production required, ≥ 32 characters; other tiers optional
   (unset → the route answers 401). `JOBS_RUNNER_SECRET_NEXT` — optional, ≥ 32, must differ from the current (rotation:
   Vault → NEXT, then promote, runbook). `JOBS_DRILL_ENABLED` — `true|false`, default `false`, `true` forbidden in
   production. Test lane pins a synthetic 64-character secret (built at run time, gitleaks rule) and `false`; e2e sets
   its own synthetic secret (exported from `tests/e2e/support/app-env.ts` like `E2E_CRON_SECRET`) and `true`.
   `CRON_SECRET` is unchanged (V2-03 diag route, R-27). Read through `serverEnv()`; tests use `vi.stubEnv`.
7. **Guard, lint, docs:** route kind `runner-secret` in the engine (legs: secret unset → 401, no header → 401, wrong
   bearer → 401, different-length bearer → 401, other methods → 405, control with the right bearer → 200).
   ESLint: **already in force since V2-03** (03-04, narrowed by 03-13c M-ALLOWLIST): `lib/jobs/internal/**` is
   importable only from `app/api/jobs/**` and `lib/jobs/internal/**`, the factory only from `lib/jobs/internal/**`
   (never `lib/jobs/enqueue.ts`), and dynamic `import()`/`require()` of either is banned. 04-02 adds no rule; it
   replaces 03-04's `// @ts-nocheck` jobs placeholders in `lint-fixtures/p1-34/` with the real module paths and adds the
   real route as a passing case. `docs/runbooks/jobs.md`: architecture, per-environment Vault SQL (names only), secret rotation,
   pausing (`cron.alter_job(…, active := false)`), manual run, drill enqueue, troubleshooting via `net._http_response`
   (`status_code`, `timed_out`). `docs/ops/secret-rotation.md`: `JOBS_RUNNER_SECRET` + Vault row; `CRON_SECRET` noted as
   the diag-route bearer only.
8. **Local end to end (macOS, one-off, R-21):** `scripts/ops/scheduler-local-e2e.ts` refuses a non-loopback Supabase
   URL; starts the e2e build on 3100 the way the Playwright web server does; writes Vault secrets
   `http://host.docker.internal:3100/api/jobs/run` + the e2e secret; activates `jobs-kick`; enqueues 5 `drill.noop`;
   waits ≤ 150 s for all `done` and a `job_runner_runs` row with `source = pg_cron`; records per-job lag
   (`first_claimed_at − run_at`); in `finally` deletes the Vault secrets and restores the cron state; writes
   `evidence/scheduler-local-e2e.json` (counts and timings only). On Linux it exits 2 ("host.docker.internal is
   macOS-only; CI covers the halves separately").

### Tests that fail without the change
- `scheduler-migration-db.spec.ts` (roadmap "scheduler migration test on the local stack"): after `db reset`,
  `cron.job` holds `jobs-kick`, `jobs-reap`, `cron-history-cleanup` exactly once with the expected schedules; applying
  the migration file again inside a rolled-back transaction leaves exactly one row per name (A8); `anon` and
  `authenticated` lack USAGE on `net`, EXECUTE on `net.http_post`, SELECT on `net.http_request_queue`;
  `ops.kick_job_runner()` with no Vault secrets returns `null` and adds no queue row; inside a rolled-back transaction
  with synthetic secrets (`http://127.0.0.1:9/api/jobs/run`) it returns an id and the `net.http_request_queue` row has
  that URL, `Authorization: Bearer <synthetic>` and `timeout_milliseconds = 30000`; an `http://` non-loopback URL raises.
  CI tests the DB half only (pitfall 6).
- `run-route.spec.ts` (DB lane, route half): no configured secret → 401 and the seeded job stays `pending`; missing,
  wrong and different-length bearers → 401; `GET`/`PUT`/`PATCH`/`DELETE` → 405; the right bearer → 200 with exactly
  the six keys and the seeded `drill.noop` job `done`; the NEXT secret → 200; the response never contains the payload.
- `runner-auth.spec.ts`: digest comparison for current and next; no throw on length mismatch; `Bearer` prefix required.
- `p1-34-lint-gates.spec.ts` (regression cases on the real files; the rules pre-date this plan): a server action and
  `app/api/v1/x/route.ts` importing `@/lib/jobs/internal/runner` → fail; `app/api/jobs/run/route.ts` → pass;
  `lib/jobs/enqueue.ts` importing the system factory → fail.
- `system-db.spec.ts` (V2-03): `getSystemDb("jobs.run")` emits one `db.system_acquired` line with module
  `app/api/jobs/run` (fails until the reason exists).
- Guard routes: `app/api/jobs/run/route.ts#POST` (+ other methods) pass the `runner-secret` legs (the inventory fails
  until the manifest has the entry).
- e2e `tests/e2e/jobs/run-route.spec.ts`: on the real server, `POST` without a bearer → 401 with `x-request-id`; with
  the e2e secret → 200 and a seeded `drill.noop` job `done`; `GET` → 405.
- `env-schema.spec.ts`: staging without `JOBS_RUNNER_SECRET`, a 20-character secret, NEXT equal to current, and
  production with `JOBS_DRILL_ENABLED=true` each throw naming the key without its value.

### Acceptance mapping
"queue lag p95 < 2 min in staging": mechanism here (1-minute kick, R-12) and local measurement (macOS evidence);
staging measurement **pending PO (04-P1, P8, P9, P10, P12)**. Roadmap test "scheduler migration test on the local
stack": full. RL-23: closed for the runner (constant time); the old cron routes are deleted in 04-03a/04-03b.

---

## 04-03a Message enqueue RPC + `message.send` handler; inline dispatch removed (P0-12, ADR-0005 D3, R-6, R-7, R-9, R-20, R-23, R-24, R-33, R-44) · M-L · Wave 3

### Files
- `supabase/migrations/000034_message_enqueue.sql` + per-migration chores, `types/database.ts`.
- `lib/jobs/enqueue.ts` (new request-path surface; never imports the system factory),
  `lib/jobs/internal/handlers/message-send.ts`, `lib/jobs/internal/registry.ts`.
- `lib/messaging/dispatcher.ts` (**deleted**), `lib/messaging/index.ts` (`sink` case; `sendDirectSms` /
  `sendDirectWhatsApp` stay until 04-03c moves their last caller, the inbound route), `lib/messaging/providers/sink.ts`
  (new), `lib/messaging/providers/msg91.ts` (runner signal + retryable classification; the 10 s bound and the
  synthetic refusal already exist, V2-03 03-13d `provider-guard.ts`), `lib/messaging/types.ts` (`MessagingProvider.name`
  gains `"sink"`; `retryable` already exists).
- `lib/env.ts` `MESSAGING_PROVIDERS` gains `sink`; `app/api/ready/route.ts` `providerStates()` reports `sink` as
  `disabled` (it is not a real provider) + `tests/api/health-probes.spec.ts` case.
- `lib/db/errors.ts` `RPC_REASON_CODES`: `SUBJECT_MISMATCH` → `NOT_FOUND`, `TEMPLATE_NOT_ALLOWED` and
  `RECIPIENT_NOT_ALLOWED` → `VALIDATION_FAILED` (+ `tests/db/error-map.spec.ts` cases).
- Call sites (`enqueueMessage`): `features/labs/service.ts`, `features/visits/scheduling-service.ts`,
  `features/appointments/system.ts`, `features/referrals/service.ts`, `features/prescriptions/service.ts`,
  `features/billing/service.ts`. `scripts/msg91-test-send.ts` (calls the provider directly; never run by agents).
- `app/api/cron/dispatch-communications/route.ts` (**deleted**; its only function is gone), `lib/supabase/system.ts`
  (reason `cron.dispatch_communications` and its `REASON_OWNER` entry removed, 03-02 handover),
  `tests/security/guard-manifest.ts` (its two `cron-secret` entries removed).
- Env-key checklist files: `MESSAGING_PROVIDER` gains `sink` (allowed development/test/e2e/ci/staging, forbidden in
  production); e2e sets `MESSAGING_PROVIDER=sink` so a runner pass in e2e never writes `.planning/dev-messages.txt`.
- `eslint.config.mjs` (a `P0-12` zone in `BOUNDARY_IMPORT_ZONES`, 03-04 pattern; a temporary owner-commented allowance
  for `app/api/webhooks/messaging/[provider]/route.ts`'s `sendDirectWhatsApp` import, deleted by 04-03c),
  `lint-fixtures/p0-12/*`, `tests/security/p0-12-lint-gates.spec.ts` (new), `scripts/ci/p1-34-counters.mjs` (`P0-12`
  joins the per-backlog-id `boundary_messages` census).
- `package.json` / lock (`msw` 3.0.3 exact, dev); `evidence/package-legitimacy.json` (msw part).
- Tests: `tests/jobs/enqueue-message-rpc-db.spec.ts`, `tests/jobs/message-send-handler-db.spec.ts`,
  `tests/jobs/delivery-reap-db.spec.ts`, `tests/jobs/parallel-dispatch-db.spec.ts` (message case added),
  `tests/messaging/msg91-contract.spec.ts`, `tests/messaging/sink-provider.spec.ts`; rewritten to the new contract (not
  deleted wholesale, pitfall 9): `tests/messaging/outbox-queue.spec.ts`, `tests/messaging/messaging-provider.spec.ts`,
  `tests/messaging/tokenized-sharing.spec.ts`, `tests/messaging/provider-selection.spec.ts`,
  `tests/messaging/provider-timeouts-and-synthetic.spec.ts` (03-13d), `tests/security/review-fixes-app.spec.ts`,
  `tests/security/review-fixes-db.spec.ts`, `tests/security/review2-fixes-db.spec.ts`,
  `tests/security/share-tokens.spec.ts` (each only where it references `enqueueMessage`, the dispatcher or inline
  sends); `docs/runbooks/jobs.md` (messages section).

### Steps
1. **Tracer:** `public.enqueue_message` → `communication_queue` row → trigger → `message.send` job → `runJobs` with the
   real handler and a recording provider → row `sent`, one provider call (`message-send-handler-db.spec.ts` first case).
   Then steps 2-7.
2. **Migration `000034`** (expand):
   - `communication_queue.dedupe_key text check (char_length(dedupe_key) <= 200)` + unique index `(tenant_id,
     dedupe_key) WHERE dedupe_key IS NOT NULL`.
   - `ops.message_templates(template_id text primary key, channel text, unmatched_ok boolean default false)`, seeded
     from the code at execution (`git grep -n "templateId"` in `features/`, the `<type>_sms_fallback` ids of
     `appointment_booked` and `appointment_rescheduled`, and the five bot templates of the inbound route with
     `bot_not_found` marked `unmatched_ok`). V2-12 extends it by migration.
   - AFTER INSERT trigger on `communication_queue` (definer) → `ops.enqueue_job('message.send', tenant_id,
     {queue_id}, 'msg:' || id, next_retry_at, max_retries + 2)` for rows inserted `pending` (R-23: the delivery row's
     own backoff stays authoritative; the job follows `next_retry_at`; `+ 2` leaves room for lease expiries).
   - `private.enqueue_message_internal(p_tenant_id, p_patient_id, p_visit_id, p_channel, p_message_type,
     p_template_id, p_template_params, p_recipient_phone, p_recipient_user_id, p_metadata, p_run_at, p_dedupe_key,
     p_created_by) returns jsonb` — SECURITY DEFINER writer in the non-exposed `private` schema (000027; 03-07 pattern,
     R-44), `REVOKE ALL … FROM PUBLIC, anon, authenticated` (only the definer RPCs below call it in V2-04; V2-07 may
     grant it to INVOKER commands once it adds the subject checks of `private.outbox_payment_recorded`): template must
     be in `ops.message_templates` for the channel; `p_template_params` ≤ 4 KB; when a patient is given the recipient
     must equal (after `toIndianMobileE164`-equivalent normalisation in SQL) the patient's phone or the guardian phone
     column from 000014 (read the column names at execution), or is null and then taken from the patient — no free-form
     numbers (R-24); `INSERT … ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`; returns `{
     id, status, deduped }` (ids and status only).
   - `public.enqueue_message(p_tenant_id uuid, p_patient_id uuid, p_visit_id uuid, p_channel text, p_message_type text,
     p_template_id text, p_template_params jsonb, p_recipient_phone text, p_recipient_user_id uuid, p_metadata jsonb,
     p_run_at timestamptz default now(), p_dedupe_key text default null) returns jsonb` (R-6 revised; 03-07 D1 finding
     2): `auth.uid()` required; the tenant is **derived from the subject** (the visit's tenant if a visit is given, else
     the patient's); both given and different → `P0001 SUBJECT_MISMATCH`; the subject's tenant must **equal
     `p_tenant_id`** (the caller's `ServiceContext.tenantId`, session-derived) **and** be in
     `public.current_user_tenant_ids()`, else `P0002 SUBJECT_MISMATCH` (existence is not revealed; a dual-clinic user
     working in A cannot enqueue for B's patient). `p_tenant_id` only narrows; it is never the source of the row's
     tenant. `created_by = auth.uid()`. `REVOKE … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated`. V2-05 later binds
     the helper itself to the DB-side active tenant (05-01b).
   - `public.enqueue_message_system(p_system_actor text, <same subject and message args>) returns jsonb`: requires
     `auth.uid() IS NULL` and `p_system_actor` ∈ `{system:messaging_webhook, system:patient_self_service_reschedule,
     system:api_v1, system:jobs}` (closed set, 03-07 pattern) else `P0001 ACTOR_INVALID`; tenant from the subject;
     `created_by` null; `metadata.system_actor` recorded. Service role only.
   - `public.communication_queue_dead_letter(p_id uuid, p_error_code text) returns void` (service role): moves a
     non-terminal row to `dead_letter` (for non-retryable provider outcomes: `provider_disabled` from the `disabled`
     provider, the synthetic-number refusal, MSG91 4xx). Closes the 03-01 handover: `communication_queue_finish` has no
     non-retryable path, so a `disabled` refusal used to retry to `dead_letter` while sending nothing.
   - `ops.reap_delivery_rows() returns int`: `communication_queue` rows `processing` with `updated_at < now() - interval
     '240 seconds'` (2 × lease) → `failed`, `error_message = 'outcome_unknown'`, `next_retry_at = now()` (R-7); schedule
     `delivery-reap` `* * * * *`.
   - AFTER UPDATE OF `status` ON `ops.jobs` WHEN `new.status = 'dead' AND new.kind = 'message.send'` (definer): a
     non-terminal delivery row → `dead_letter` with `error_message = 'job_dead:' || coalesce(new.last_error, '')`; inserts
     the existing "Message Delivery Failed" `in_app_notifications` row (same copy and metadata as `dispatcher.ts` today,
     no phone) unless one already exists for that `queue_id`.
3. **`lib/jobs/enqueue.ts`:** `enqueueMessage(ctx, input)` → `enqueue_message` on `ctx.db` (the user client) with
   `p_tenant_id = ctx.tenantId`; `enqueueMessageAsSystem(sysDb, input, actor)` → `enqueue_message_system` on a client
   the caller was allowed to open (system modules, v1 routes, handlers). Input = today's `EnqueueMessageInput` minus
   `tenantId` and `maxRetries`, plus `visitId?` and `dedupeKey?`. Errors go through `mapDbError` (`lib/db/errors.ts`)
   with fixed messages. Returns `{ id, status, deduped }`. No provider import, no factory import.
4. **Handler `message.send`** (`{ queue_id: uuid }`, `maxDurationMs` 12 000): `communication_queue_claim(p_id)` on the
   system client; no row → read the row's status: terminal (`sent`, `delivered`, `read`, `dead_letter`, `cancelled`) or
   missing → `done`; `processing` → retry in 60 s, code `delivery_in_progress`; `pending`/`failed` not yet due → retry at
   its `next_retry_at`, code `not_due`. Otherwise send with the provider (`AbortSignal` from the runner); success →
   `communication_queue_finish(success)` + the existing `communication_sent` audit row (no phone) → `done`; a
   non-retryable failure (any result with `retryable: false`: `provider_disabled`, the synthetic-number refusal of
   `syntheticRecipientRefusal`, MSG91 4xx) → `communication_queue_dead_letter` → `dead`, and no SMS fallback; a retryable
   failure → `communication_queue_finish(failure)`: `failed` → if eligible for the SMS fallback (today's rule: WhatsApp,
   `appointment_booked`/`appointment_rescheduled`, recipient present, not already a fallback) →
   `enqueueMessageAsSystem(…, "system:jobs")` with dedupe key `msg-fallback:<queue_id>` (one fallback even across
   retries) → `retry` at `next_retry_at`; `dead_letter` → `dead` (the trigger adds the notification). Errors are codes.
5. **Providers (R-20, R-9):** V2-03 already bounds every MSG91/Gupshup/Twilio call at `MESSAGING_PROVIDER_TIMEOUT_MS`
   (10 s, `providerSignal()`) and refuses synthetic recipients before any HTTP call (`retryable: false`). V2-04 adds:
   `Msg91Provider` takes an optional `signal` (the runner's) and an optional `timeoutMs` (default
   `MESSAGING_PROVIDER_TIMEOUT_MS`), passing `AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])` to its three
   `fetch` calls; 4xx → `{ success: false, retryable: false }`, 5xx/network/abort → `retryable: true` (today a failed
   MSG91 call carries no `retryable`). The provider error text stays a code (`errorTag`), never the provider's body.
   `SinkProvider` (`name: "sink"`): returns `{ success: true, externalMessageId: "sink-<uuid>" }`, logs `log.info({
   event: "messaging.sink.recorded", count: 1 })`, no network, no file, never the phone. `getMessagingProvider` gains
   `sink`.
6. **Call sites:** import from `@/lib/jobs/enqueue`; pass `ctx` (the tenant constraint is `ctx.tenantId`); pass
   `visitId` where the code has it (the consultation-documents message passes `input.visitId`); system modules use
   `enqueueMessageAsSystem(sys.db, …, "system:" + sys.reason)`. Catch blocks keep the V2-03 pattern (`log.warn({ event,
   code: errorTag(err), requestId: await getRequestId(), tenantId: ctx.tenantId })`, `clientErrorMessage` for any
   response; never `err.message`). Dedupe keys (R-24): `appointment_booked:<visit_id>`,
   `appointment_rescheduled:<visit_id>:<scheduled_at ISO>`, `appointment_cancelled:<visit_id>`; user-initiated sends
   (prescription, lab report, referral letter, receipt, consultation documents) keep per-row keys until V2-07 command
   ids. Enqueue stays best effort at call sites (`try/catch` → `log.warn({ event: "jobs.enqueue.failed", code })`), as
   today; P1-05 (V2-07) moves enqueue into the business transaction. Update any e2e expectation that read a `sent`
   status right after an action to `pending` plus a `message.send` job.
7. **Structural guard (R-33):** ESLint `no-restricted-imports` (`P0-12:` prefix), added the 03-04 way (one zone entry
   in `BOUNDARY_IMPORT_ZONES` + a pass and a fail case; inline disables of it fail `clinicos/no-boundary-directive`):
   `getMessagingProvider`, `sendDirectSms`, `sendDirectWhatsApp` from `@/lib/messaging` and `@/lib/messaging/providers/*`
   only in `lib/jobs/internal/**` and `lib/messaging/**` (`scripts/**`, `tests/**` excepted), plus one owner-commented
   allowance for `app/api/webhooks/messaging/[provider]/route.ts` (owner 04-03c, which deletes it with `sendDirect*`).
   `npm install --save-dev --save-exact msw@3.0.3` after recording the provenance (04-P15 gates the merge, not local
   work), then `scripts/ci/lock-linux-check.sh --fix`.

### Tests that fail without the change
- `enqueue-message-rpc-db.spec.ts`: a receptionist enqueues for a patient of their tenant → one row (`created_by` =
  caller) and one `message.send` job (`msg:<id>`); a patient of another tenant → `P0002`, 0 rows; `anon` → `42501`;
  **dual-member leg (03-07 finding 2):** a user in tenants A and B calling with `p_tenant_id` = A for a B patient →
  `P0002`, 0 rows (before: the RPC does not exist; the old direct insert would have written a B row), and with
  `p_tenant_id` = B → one B row; patient and visit from different tenants → `SUBJECT_MISMATCH`; the same dedupe key
  twice → one row, second result `deduped: true`; a recipient that is not the patient's number → rejected; a template
  outside the allow-list → rejected; `enqueue_message_system` as `authenticated` → `42501`; as service role with
  `system:unknown` → `ACTOR_INVALID`; catalogue: `private.enqueue_message_internal` not executable by `anon` or
  `authenticated`, every new function `prosecdef`/`proconfig = {search_path=""}` as planned. Guard suite leg 3b passes
  for every server action that enqueues (it fails if the service passes a tenant other than `ctx.tenantId`).
- `message-send-handler-db.spec.ts` (recording provider via the handler map, no network): sent once + audit row
  without the phone; retryable failure → row `failed`, job `pending` at the row's `next_retry_at`; an eligible
  WhatsApp `appointment_booked` failing twice → exactly one SMS fallback row; the last failure → `dead_letter`, job
  `dead`, exactly one "Message Delivery Failed" notification; a row already `sent` → job `done`, provider not called;
  `provider_disabled` → `dead_letter` after one attempt and no fallback row (before: retried to `dead_letter`, 03-01
  handover); a recipient in the synthetic range with the real MSG91 provider class (MSW, no handler for the range) →
  `dead_letter` after one attempt, zero HTTP requests.
- `delivery-reap-db.spec.ts` (roadmap "reaper test" at the delivery level): a crash simulated by claiming the delivery
  row and abandoning the job (lease moved to the past by SQL, `updated_at` aged 5 min) → `ops.reap_delivery_rows()` →
  `failed`/`outcome_unknown`; the next runner pass sends once and the row ends `sent` ("a stuck `processing` row is
  reclaimed").
- `parallel-dispatch-db.spec.ts` (roadmap concurrency test with the real handler): 200 `communication_queue` rows +
  jobs; 8 concurrent `runJobs` with a recording provider → 200 provider calls, 200 distinct queue ids, every row
  `sent`.
- `msg91-contract.spec.ts` (roadmap "MSW contract for MSG91", T-09; `setupServer`, `onUnhandledRequest: "error"`):
  the SMS flow request goes to `https://control.msg91.com/api/v5/flow/` with the `authkey` header and the body shape
  `msg91.ts` builds (template id, recipients with `91…` mobiles and params); the WhatsApp request (both endpoints in
  `msg91.ts`) carries the template name, language and button components; 200 → `externalMessageId` from the response;
  400 → `retryable: false` (before: no `retryable`); 500 and a network error → `retryable: true`; a response delayed
  past `timeoutMs` (50 ms in the test) → aborted within 1 s, `retryable: true`; aborting the runner's `signal` aborts the
  call within 1 s (before: the call ran to the 10 s bound). Fixture recipients are **outside** the synthetic range
  (`lib/messaging/synthetic-numbers.ts` refuses `+91 90000 000xx` before any request) and are fake numbers that never
  leave MSW. The worker guard stays active: handled requests never reach a socket.
- `sink-provider.spec.ts`: success with a `sink-` id; a `fetch` spy sees 0 calls; captured output has no phone.
- `outbox-queue.spec.ts` (rewritten): `enqueueMessage` returns `{ status: "pending" }` and a mocked provider sees 0
  calls (before: the row was sent inside the call).
- `p0-12-lint-gates.spec.ts`: a feature service importing `getMessagingProvider` or `sendDirectWhatsApp` → fail;
  `lib/jobs/internal/x.ts` → pass. `env-schema.spec.ts`: `MESSAGING_PROVIDER=sink` passes in staging and throws in
  production. `health-probes.spec.ts`: `MESSAGING_PROVIDER=sink` → `providers.messaging: "disabled"`.

### Acceptance mapping
"the parallel-dispatcher test shows 0 duplicate sends": full. "a stuck `processing` row is reclaimed": full (job lease
04-01 + delivery row here). Roadmap tests "concurrency (T-07 subset) with N parallel dispatchers", "reaper test",
"MSW contract for MSG91": full.

---

## 04-03b Webhook enqueue RPC + `webhook.deliver`; fire-and-forget removed; role drop fixed (P0-12, ADR-0005 D3, R-6, R-19, R-23, R-26, R-44) · M · Wave 4

### Files
- `supabase/migrations/000035_webhook_enqueue.sql` + per-migration chores, `types/database.ts`.
- `lib/jobs/enqueue.ts` (`enqueueWebhookEvent`, `enqueueWebhookEventAsSystem`),
  `lib/jobs/internal/handlers/webhook-deliver.ts`, `lib/jobs/internal/registry.ts`.
- `lib/webhooks/outbox.ts` (**deleted**: its background `dispatchWebhookQueueItem` call is the second writer of the
  03-10 handover); `lib/webhooks/dispatcher.ts` reduced to a pure `deliverWebhook({ endpointUrl, signingSecret, rawBody,
  signal, allowHttp?, resolve?, request?, fetch? }) → { ok, status, durationMs, errorCode, retryable }` built on the
  shipped V2-03 pieces: `resolveWebhookTarget` (byte-level SSRF check, `lib/webhooks/ssrf.ts`), `postPinned`
  (`lib/webhooks/transport.ts`: connects to the checked address, SNI/Host = name, no redirects, body never read),
  `generateWebhookSignature` (`signer.ts`), `WEBHOOK_TIMEOUT_MS` (5 s); the `request` and legacy `fetch` seams stay for
  tests; no DB, no factory. `calculateWebhookBackoff`/`MAX_WEBHOOK_RETRIES` move into SQL (`webhook_delivery_finish`);
  `dispatchWebhookQueueItem`/`dispatchPendingWebhookQueue` are deleted. `lib/webhooks/{signer,ssrf,transport}.ts`
  unchanged.
- `app/api/cron/webhooks/route.ts` (**deleted**), `lib/supabase/system.ts` (reason `cron.webhooks` and its
  `REASON_OWNER` entry removed, 03-02 handover).
- `lib/db/errors.ts` `RPC_REASON_CODES`: `EVENT_NOT_ALLOWED` → `VALIDATION_FAILED`, `RATE_LIMITED` → `RATE_LIMITED`.
- Call sites: `features/labs/service.ts`, `features/consultation/service.ts`, `features/prescriptions/service.ts`,
  `features/appointments/system.ts`, `features/webhooks/service.ts` + `features/webhooks/actions.ts` (test ping),
  `app/api/v1/lab-orders/route.ts`, `app/api/v1/prescriptions/route.ts`.
- UI: `components/settings/developer/webhook-subscription-list.tsx`,
  `components/settings/developer/developer-settings-view.tsx`.
- `tests/security/guard-manifest.ts` (cron webhook entries removed; the `testPingWebhook` exemption removed).
- `eslint.config.mjs`, `lint-fixtures/p0-12/*`, `tests/security/p0-12-lint-gates.spec.ts` (`@/lib/webhooks/dispatcher`
  only from `lib/jobs/internal/**`).
- Tests: `tests/jobs/enqueue-webhook-rpc-db.spec.ts`, `tests/jobs/webhook-deliver-handler-db.spec.ts`,
  `tests/e2e/settings/developer-test-ping.spec.ts`; rewritten to the handler (pitfall 9, assertions kept):
  `tests/api/webhooks-outbox.spec.ts` (its cron section and the `CRON_SECRET` stub go), `tests/api/webhook-dispatch-hardening.spec.ts`
  (03-13d: tenant mismatch, retry cap, pinned transport, test-ping limit), `tests/billing/record-payment-rpc.spec.ts`
  (outbox row now carries `event_key`); `docs/runbooks/jobs.md` (webhooks section).

### Steps
1. **Tracer:** a receptionist-triggered `prescription.issued` → `enqueue_webhook_event` → delivery row → job → handler
   with an injected `request` (pinned-transport seam) receiving the signed body → `delivered`
   (`webhook-deliver-handler-db.spec.ts` first case).
2. **Migration `000035`** (expand):
   - `webhook_delivery_queue.event_key text check (char_length(event_key) <= 200)` + unique index `(subscription_id,
     event_key) WHERE event_key IS NOT NULL` (outbound idempotency).
   - Status CHECK: rows with a status outside `pending, processing, delivered, failed` → `failed`; `ADD CONSTRAINT …
     CHECK (status IN ('pending','processing','delivered','failed')) NOT VALID`, then `VALIDATE CONSTRAINT`.
   - AFTER INSERT trigger on `webhook_delivery_queue` → `ops.enqueue_job('webhook.deliver', tenant_id, {delivery_id},
     'wh:' || id, next_retry_at, least(max_retries, 5) + 2)`. This also gives 03-07's `record_payment` outbox rows a job
     without editing that function.
   - `create or replace private.outbox_payment_recorded(p_payment_id)` (same signature and checks as 000029) now writes
     `event_key = 'payment.recorded:' || payment_id` (03-07 handover: the writer, not `record_payment`, is the place).
   - `public.webhook_delivery_claim(p_id uuid)` (atomic: `UPDATE … SET status = 'processing' WHERE id = p_id AND status
     IN ('pending','failed') AND next_retry_at <= now() RETURNING …`, the row fields the handler needs incl. the
     subscription's `tenant_id`) and `public.webhook_delivery_finish(p_id uuid, p_success boolean, p_status_code int,
     p_error_code text, p_duration_ms int, p_retryable boolean) returns table(new_status text, next_retry_at
     timestamptz)`: success → `delivered`; retryable with retries left → `pending` with today's dispatcher curve (1 m,
     5 m, 15 m, 1 h, 6 h); retries counted against `least(max_retries, 5)` (V2-03 `MAX_WEBHOOK_RETRIES`: a row's own
     value can never raise it); otherwise `failed` (terminal, as today). Write the response columns the delivery-log UI
     already reads (names from 000018 at execution). Service role only. The claim is the single writer that closes the
     03-10 double POST (enqueue-time background dispatch racing the cron tick).
   - `private.enqueue_webhook_internal(p_tenant_id, p_event_type, p_data jsonb, p_event_key, p_subscription_id default
     null) returns jsonb` — SECURITY DEFINER writer in `private` (03-07 pattern, R-44), `REVOKE ALL … FROM PUBLIC, anon,
     authenticated`: reads active subscriptions **of `p_tenant_id`** for the event as definer (fixes the owner/admin-only
     drop, R-19; the app-side `enqueueWebhookEvent` still drops for 3 of 5 roles at V2-03 close), builds the envelope
     text once (`{ id, event, created_at, data }`, stored raw for a stable HMAC), inserts one row per subscription `ON
     CONFLICT DO NOTHING`; returns `{ queued, delivery_ids }`.
   - `public.enqueue_webhook_event(p_tenant_id uuid, p_event_type text, p_subject_id uuid, p_subscription_id uuid
     default null) returns jsonb` (authenticated; R-6 revised): closed event set = the event types used by the call
     sites listed above (enumerated at execution; else `P0001 EVENT_NOT_ALLOWED`); each maps to a subject table
     (`visits`, `prescriptions`, `patient_documents`, `webhook_subscriptions` for `ping`) and a `data` object **built in
     SQL from the subject row** with exactly the fields the call site sends today — no caller-supplied payload (R-26; if
     a call site sends a field not derivable from its subject, stop and raise it). Tenant derived from the subject; it
     must equal `p_tenant_id` (`ctx.tenantId`) and be in `current_user_tenant_ids()`, else `P0002`; `ping` additionally
     requires `public.current_user_has_role(p_tenant_id, '{owner,admin}')`, targets only `p_subscription_id` (which must
     belong to `p_tenant_id`), and keeps the V2-03 limit of 5 pings per tenant per 60 s (03-13d; counted from the
     tenant's ping rows inside the RPC, so it holds across instances) → `P0001 RATE_LIMITED`. Event keys:
     `<event_type>:<subject_id>` for lifecycle events (`appointment.rescheduled` adds `:<scheduled_at>`), `ping:<uuid>`.
   - `public.enqueue_webhook_event_system(p_system_actor text, p_event_type text, p_subject_id uuid) returns jsonb`
     (service role, same closed actor set as 04-03a).
   - AFTER UPDATE OF `status` ON `ops.jobs` WHEN dead and `kind = 'webhook.deliver'`: a non-terminal delivery row →
     `failed`, error `job_dead`.
3. **Handler `webhook.deliver`** (`{ delivery_id }`, `maxDurationMs` 8 000): claim; no row → same status logic as
   `message.send`; load the subscription (`tenant_id`, `endpoint_url`, `signing_secret`, `is_active`); inactive →
   finish non-retryable → `dead`; **subscription tenant ≠ row tenant → finish non-retryable with status code 403 and
   `log.warn({ event: "webhooks.queue_item.tenant_mismatch", tenantId, reason: "subscription_tenant_mismatch" })`, no
   POST** (the V2-03 03-13d M-XTENANT-WH check, kept as defence in depth until V2-05 05-03's composite FK makes the
   mismatch impossible); `deliverWebhook` (production: real DNS, https only, pinned address); finish; map `delivered` →
   `done`, `pending` → `retry` at `next_retry_at`, `failed` → `dead`. Concurrency guard: the delivery claim lets one
   handler POST even if two jobs ever target one row.
4. **Call sites:** user paths → `enqueueWebhookEvent(ctx, eventType, subjectId)` (`p_tenant_id = ctx.tenantId`);
   `features/appointments/system.ts` and the v1 routes → `enqueueWebhookEventAsSystem(db, …, actor)`;
   `features/webhooks/service.ts` stops importing `dispatchWebhookQueueItem` and the in-service ping count (moved into
   the RPC). The duplicate `prescription.issued` emissions
   (consultation completion and prescription creation) now collapse to one event per prescription through the event
   key (recorded in 04-SUMMARY as an intended change).
5. **Test ping (R-26):** `testPingWebhook` checks `clinic:manage`, enqueues the ping, returns `{ success: true, queued:
   true }` (no synchronous delivery). The subscription list shows a status line (`role="status"`, polite live region)
   "Test ping queued. The result appears in Delivery logs within about a minute." in place of the status/duration chip.
6. Delete the cron webhook route and its guard entries; remove the `testPingWebhook` guard exemption (the action's
   control leg can now succeed in the test lane).

### Tests that fail without the change
- `enqueue-webhook-rpc-db.spec.ts`: a **receptionist** and a **doctor** each trigger `prescription.issued` for their
  tenant with one active subscribed endpoint → one delivery row + one `webhook.deliver` job each (before: 0 rows, the
  silent drop); a subject of another tenant → rejected; **dual-member leg:** a member of A and B with `p_tenant_id` = A
  and a B subject → `P0002`, 0 rows; inactive or unsubscribed endpoints → no rows; the same event twice → no new rows;
  `ping` by an admin → one row for that subscription only; a sixth ping inside 60 s → `RATE_LIMITED`; by a receptionist
  → `42501`; the system RPC as `authenticated` → `42501`; a `record_payment` call (03-07) → its outbox row has a job and
  `event_key = payment.recorded:<payment_id>`; `private.enqueue_webhook_internal` not executable by `anon`/`authenticated`.
- `webhook-deliver-handler-db.spec.ts` (injected `request` and `resolve`): one POST whose signature header verifies over
  the stored raw text, sent to the resolved address with `servername`/`Host` = the endpoint name; 500 → `pending`, job
  retry at the row's `next_retry_at`; a resolver answering `10.0.0.5` → `failed`, no POST; a 3xx → failed delivery
  (no redirect followed); a row with `max_retries = 50` stops after 5 attempts; a forged row naming another tenant's
  subscription (inserted as `postgres`) → `failed`/403, no POST; two concurrent handlers for one delivery → one POST.
- `webhooks-outbox.spec.ts` (rewritten): enqueue performs no POST (before: fire-and-forget dispatch, the 03-10 second
  writer); the test ping returns `queued: true` and creates one row.
- `webhook-dispatch-hardening.spec.ts` (03-13d, rewritten to the handler): the same tenant-mismatch, retry-cap and
  pinned-transport assertions hold through `webhook.deliver`.
- `p0-12-lint-gates.spec.ts`: a feature importing `@/lib/webhooks/dispatcher` → fail.
- Guard actions: `testPingWebhook` passes its legs including the control (before: exempt).
- e2e `developer-test-ping.spec.ts` (desktop-chrome + pixel-7; subscription seeded with the local service-role helper):
  the owner sends a test ping, the status line appears, one delivery row and job exist; axe 0 serious/critical and no
  horizontal scroll at 360, 820 and 1280.

### Acceptance mapping
P0-12 "remove … fire-and-forget webhook dispatch; webhook idempotency" (outbound): full. Research latent defect
(owner/admin-only drop): fixed and proven. V2-03 handovers: 03-10 double dispatch (claim), 03-07 `event_key`: closed.

---

## 04-03c Inbound webhook idempotency, bot replies via the queue, contract step, register shrink, hook dedupe (P0-12, ADR-0005 register, RL-23, R-25, R-35, R-38, R-43) · M · Wave 5

### Files
- `supabase/migrations/000036_inbound_idempotency.sql`, `supabase/migrations/000037_queue_contract.sql` (+ chores for
  each), `types/database.ts`.
- `app/api/webhooks/messaging/[provider]/route.ts`, `lib/messaging/webhook-helpers.ts` (`inboundDedupeKey(event,
  rawBody)`), `lib/messaging/index.ts` (`sendDirectSms`/`sendDirectWhatsApp` **deleted**: their last app caller moves
  here), `scripts/msg91-test-send.ts` (switches to `getMessagingProvider("msg91").sendWhatsApp(…)`; `scripts/**` is
  outside the P0-12 rule; never run by agents), `lib/jobs/enqueue.ts` (`enqueueUnmatchedReplyAsSystem`),
  `lib/jobs/internal/handlers/message-reply-unmatched.ts`, `lib/jobs/internal/registry.ts`.
- Send Email hook dedupe (R-43): `app/api/auth/send-email/route.ts`, `features/auth/system.ts` (new, `import
  "server-only"`; `authHookDeliveryBegin`/`authHookDeliveryFinish`), `lib/supabase/system.ts` (reason
  `auth.send_email_hook` → module `features/auth/system`), `tests/auth/send-email-hook.spec.ts` +
  `tests/integration/auth/send-email-hook-dedupe-db.spec.ts` (new).
- `eslint.config.mjs`: the V2-04 register zone (`app/api/cron/**`, `lib/messaging/dispatcher.ts`, `lib/webhooks/**`)
  deleted (03-04 handover: together with its PASSING cases and `ALLOWED_IMPORTER` lines in
  `tests/security/p1-34-lint-gates.spec.ts`); the 04-03a `P0-12` allowance for the inbound route deleted; one A3 zone
  letting exactly `app/api/auth/send-email/route.ts` import `@/features/auth/system` (pass + fail case, like the A1
  share-route zone); `lint-fixtures/p1-34/*`; `scripts/ci/p1-34-counters.mjs` (`system_module_importers` no longer
  lists the register paths) and `scripts/phase-evidence.mjs` (`cron_route_files`).
- `.planning/phases/04-jobs-reliability/04-ADR0005-PROPOSALS.md` (A2 and A3, proposed, not applied to the ADR).
- `docs/runbooks/staging.md` §6 (migrate before promote, R-38; triage item accepted to the V2-04 runbook).
- Tests: `tests/messaging/inbound-dedupe-db.spec.ts` (new), `tests/jobs/backfill-db.spec.ts`,
  `tests/jobs/queue-grants-db.spec.ts`; rewritten: `tests/messaging/msg91-webhook.spec.ts`,
  `tests/messaging/two-way-bot.spec.ts`, `tests/security/webhook-lockdown.spec.ts`,
  `tests/security/review3-fixes-db.spec.ts`; e2e `tests/e2e/security/cron-routes-removed.spec.ts`;
  `docs/runbooks/jobs.md` (inbound section, dead-letter replay).

### Steps
1. **Tracer:** one MSG91 "confirm" callback posted twice → one visit confirmation, one queued
   `appointment_confirmed_ack` (`inbound-dedupe-db.spec.ts` first case).
2. **Migration `000036`:**
   - `ops.inbound_webhook_events(provider text check (provider in ('msg91','supabase_auth_hook')), dedupe_key text ≤
     200, received_at, processed_at, outcome text)`, `unique (provider, dedupe_key)`; no payload stored (PII).
   - `public.inbound_webhook_begin(p_provider text, p_dedupe_key text) returns text`: new key → `process`; existing with
     `processed_at` set → `duplicate`; existing unfinished with `outcome = 'failed'` or `received_at < now() - 5 min` →
     `process` (crash recovery); else `in_flight`. `public.inbound_webhook_finish(p_provider, p_dedupe_key, p_outcome)`
     (`processed` | `ignored` set `processed_at`; `failed` leaves it null). Service role only (REVOKE from `PUBLIC,
     anon, authenticated`).
   - `public.communication_queue_apply_dlr(p_external_message_id text, p_status text, p_at timestamptz, p_reason_code
     text) returns jsonb`: one transaction for the monotonic transition and its audit row (`delivered` never overwrites
     `read`; `failed` never overwrites `delivered` or `read`); returns `{ queue_id, tenant_id, applied, new_status,
     message_type }` plus the fields the existing urgent-failure notification uses. Service role only.
   - `public.enqueue_unmatched_reply_system(p_system_actor text, p_to text, p_template_id text, p_dedupe_key text)
     returns uuid`: template must be `unmatched_ok`; `p_to` must be an Indian mobile in E.164; creates a tenant-less
     `message.reply_unmatched` job `{ to, template_id }`. BEFORE UPDATE trigger on `ops.jobs` for that kind: when the
     status leaves `pending`/`running`, `payload := '{"redacted": true}'` (R-25).
   - **Dead-letter replay (R-35):** `ops.replay_job(p_id uuid) returns void` (postgres only): a `dead` job →
     `pending`, `attempts = 0`, `run_at = now()`, and for delivery kinds the row back to `pending`; runbook entry.
3. **Route rewrite:** verify secret (unchanged, 401 first) → raw body → parse → `inboundDedupeKey`: DLR
   `dlr:<requestId>:<status>`; inbound action → the inbound message's own id if `parseMsg91Payload` exposes one (read
   it at execution), else `sha256(rawBody)` → `inbound_webhook_begin`; `duplicate`/`in_flight` → 200 without side
   effects. DLR → `communication_queue_apply_dlr`, then the existing urgent-failure in-app notification only when
   `applied` (copy unchanged; the phone in that copy stays flagged for V2-12 P1-13). Actions: state changes unchanged
   (already status-guarded); the five direct sends become `enqueueMessageAsSystem(db, { patientId, visitId, channel:
   "whatsapp", messageType, templateId, templateParams, recipientPhone: replyTo, dedupeKey:
   "bot:" + key + ":" + templateId }, "system:messaging_webhook")` and, for an unmatched sender,
   `enqueueUnmatchedReplyAsSystem(db, { to: from, templateId: "bot_not_found", dedupeKey: "bot:" + key + ":bot_not_found"
   })`. Then `inbound_webhook_finish(processed)`; an exception → `finish(failed)` and 500 so MSG91 retries (side
   effects are idempotent through status guards and dedupe keys). Handler `message.reply_unmatched` sends through the
   provider like `message.send` (no delivery row; `maxDurationMs` 12 000; a synthetic or `disabled` refusal → `dead`).
   Delete `sendDirectSms`/`sendDirectWhatsApp` and the 04-03a lint allowance for this route.
4. **Migration `000037` (contract, R-38; closes the M-XTENANT-WH "revoke direct queue writes" item):** `REVOKE EXECUTE`
   on `communication_queue_claim` and `communication_queue_finish` from `authenticated` (service role keeps it);
   revoke every remaining `INSERT`/`UPDATE`/`DELETE` privilege on `communication_queue` from `anon, authenticated`
   (today the column-level `INSERT` grants of 000024 on `appointment_id, channel, max_retries, message_type, metadata,
   next_retry_at, patient_id, recipient_phone, recipient_user_id, template_id, template_params, tenant_id`; re-read the
   catalogue in the migration review); `webhook_delivery_queue`: replace the owner/admin `FOR ALL` policy with a `FOR
   SELECT` policy for owner/admin (the delivery-log UI keeps working) and `REVOKE INSERT, UPDATE, DELETE, TRUNCATE,
   REFERENCES, TRIGGER ON public.webhook_delivery_queue FROM anon, authenticated` (today both hold the Supabase default
   table ACL) plus `REVOKE SELECT … FROM anon`; `ops.backfill_delivery_jobs() returns int` (rows `processing` older
   than 240 s → `failed`; one job per open `pending`/`failed` row of both tables with the trigger's dedupe key,
   idempotent) and one call of it. Expand and contract ship in one PR: staging holds synthetic data and production is
   created fresh in V2-15, so no environment runs pre-V2-04 code with real users.
5. **Staging order: migrate before promote (triage item accepted to the V2-04 runbook).** `docs/runbooks/staging.md` §6
   gains "A merge whose code needs its own migrations (V2-04 is the first, R-38)": approve the `staging.yml` `migrate`
   run for the merge commit immediately; until `scripts/staging/wait-for-release.mjs` passes, `/api/ready` answers 503
   with `checks.schema: "behind"` (the build's `EXPECTED_MIGRATION` is not applied) and staging counts as down; never
   promote or roll back a Vercel deployment across a migration boundary without checking `checks.schema` first. No
   code change: the readiness gate already exists (03-13c) and `readiness-probe-db.spec.ts` proves `behind`.
6. **Register shrink (03-04 handover):** the V2-04 zone leaves `BOUNDARY_IMPORT_ZONES` with its passing cases and
   `ALLOWED_IMPORTER` lines; the census proves it through the existing V2-03 counters (`scripts/ci/p1-34-counters.mjs`):
   `system_module_importers` lists only allow-listed paths and the `/api/v1` register (`app/api/v1/**`, `lib/api/**`),
   `boundary_messages` is 0 for P1-34 and P0-12; `scripts/phase-evidence.mjs` adds `cron_route_files` (expected 0).
7. **Send Email hook `webhook-id` dedupe (R-43; 03-11b handover, 03-13a residual 6).** After the Standard Webhooks
   signature check and before sending, the route calls `authHookDeliveryBegin(webhookId)` (`features/auth/system.ts`,
   `getSystemDb("auth.send_email_hook")` → `inbound_webhook_begin('supabase_auth_hook', <webhook-id>)`; the id must
   match `^[A-Za-z0-9_.-]{1,128}$`, else the shared layer is skipped): `duplicate` → 200, nothing sent, `log.info({
   event: "auth.email.duplicate", reason: "webhook_id_seen" })`; `in_flight` (another instance is sending it now) →
   hook error 409 so GoTrue retries later; `process` → send, then `authHookDeliveryFinish(processed|failed)`. The
   per-instance memory stays as the first layer. The shared layer fails **open**: a DB error logs `errorTag` and the
   email is sent (an auth email is never blocked by its dedupe store). No address, code or token reaches the table
   (provider + webhook id + timestamps only). Needs ADR-0005 amendment **A3** (below; PO confirms in 04-P14).
8. **ADR-0005 proposals file `04-ADR0005-PROPOSALS.md`** (applied to the ADR only after 04-P14):
   - **A2 (R-6, revised for the 03-07 D1 finding):** "Request-path enqueue derives the tenant from the subject row. It
     takes the caller's active tenant (`ServiceContext.tenantId`, session-derived, never request input) only as a
     constraint the subject row must match, and requires membership in it; a mismatch reads as not found. It is never
     the source of the row's tenant. Until V2-05 adds a database-side active tenant, this argument is what stops a
     multi-clinic user acting in clinic A from enqueueing for clinic B." Replaces D3's "accepts no tenant argument".
   - **A3 (R-43):** "`app/api/auth/send-email/route.ts`, a Standard-Webhooks-signed server-to-server endpoint of
     Supabase Auth (an inbound webhook in all but path), may import `features/auth/system.ts` and call it only after the
     signature check, only to record the delivery id (reason `auth.send_email_hook`)." Enforced by one ESLint zone with
     a pass and a fail fixture.

### Tests that fail without the change
- `inbound-dedupe-db.spec.ts`: the same DLR body twice → one status change and one audit row (before: two audit rows);
  the same "confirm" body twice → visit confirmed once, one `appointment_confirmed_ack` row + job, the second response
  200 without effects; an unfinished begin older than 5 min → reprocessed once; a `failed` outcome → the retry
  reprocesses; DLR `failed` after `delivered` → stays `delivered`; `delivered` after `read` → stays `read`; an
  unmatched sender → one `message.reply_unmatched` job; after a runner pass with a recording provider the job is
  `done` and its payload no longer contains the phone.
- `msg91-webhook.spec.ts`, `two-way-bot.spec.ts`, `webhook-lockdown.spec.ts` (rewritten): replies are asserted as
  queued rows/jobs; the provider is never called in the request (before: `sendDirectWhatsApp` spies).
- `review3-fixes-db.spec.ts` + `queue-grants-db.spec.ts`: a member calling `communication_queue_claim` → `42501`
  (before: allowed for own rows); a member inserting into `communication_queue` → `42501`; an owner inserting a
  `webhook_delivery_queue` row naming its own subscription, and updating a row's `status`/`max_retries`/`retry_count`
  (the E-8 knobs) → `42501` (before: allowed by the `FOR ALL` policy) while `listDeliveryLogs` still returns rows;
  `anon` holds no privilege on either table (catalogue); the enqueue RPCs still work.
- `backfill-db.spec.ts`: an open row without a job → one job; a second call → still one; a stale `processing` row →
  `failed` first.
- `p1-34-lint-gates.spec.ts`: the factory imported in `lib/webhooks/x.ts`, `lib/messaging/dispatcher.ts` and
  `app/api/cron/x/route.ts` → fail (before: register pass); `app/api/v1/x/route.ts` and `lib/api/x.ts` → pass;
  `app/api/auth/send-email/route.ts` importing `@/features/auth/system` → pass, `app/api/auth/other/route.ts` → fail.
- `send-email-hook-dedupe-db.spec.ts` (DB lane, Mailpit): the same signed delivery posted to two route instances (the
  per-instance memory cleared between them, simulating two servers) → exactly one Mailpit message (before: two); a
  first attempt that fails at the provider → the retry sends once; the DB call failing (stubbed) → the email is still
  sent; the stored row holds provider, id and timestamps only. `send-email-hook.spec.ts` keeps its existing cases.
- e2e `cron-routes-removed.spec.ts`: `GET` and `POST` on both former cron paths → 404.

### Acceptance mapping
P0-12 "webhook idempotency" (inbound) and "remove inline `dispatchPendingQueue` and fire-and-forget webhook
dispatch": full. ADR-0005 verification 4 ("From V2-04 the register holds only the `/api/v1` entry"): full
(`system_module_importers` census). RL-23: closed (cron routes deleted; runner constant time). V2-03 handovers closed
here: M-XTENANT-WH revoke, 03-11b/03-13a hook dedupe, staging migrate-before-promote runbook.

---

## 04-04 Alerts: dead letters, queue lag, stale runner, lease expiries, error bursts, error-sink overflow/size, stale backups (P1-25 alerts part, R-1, R-5, R-32, R-36, R-41, R-46) · M · Wave 6

### Files
- `supabase/migrations/000038_ops_alerts.sql` + per-migration chores, `types/database.ts`.
- `lib/jobs/internal/handlers/alert-notify.ts` (+ `renderAlertEmail`), `lib/jobs/internal/handlers/drill.ts`
  (`drill.always_fail`), `lib/jobs/internal/registry.ts`.
- `lib/email/types.ts`: `EmailTag` (a closed union, 03-11b) gains `"ops-alert"`.
- Env-key checklist files for `OPS_ALERT_EMAIL` (incl. the `PRODUCTION` profiles in `env-schema`/`env-boot` specs).
- `app/api/ready/route.ts` (`parseProbe` + a `jobs` block), `tests/api/readiness-probe-db.spec.ts`,
  `tests/api/health-probes.spec.ts` (R-41, booleans only).
- Tests: `tests/jobs/alerts-db.spec.ts`, `tests/jobs/alert-notify-db.spec.ts`, `tests/jobs/alert-drill-db.spec.ts`,
  `tests/jobs/alert-email.spec.ts`; `docs/runbooks/jobs.md` (alert rules table, response per rule, drill procedure).

### Steps
1. **Tracer:** a dead `drill.always_fail` job → `ops.evaluate_alerts()` → open `dead_letter` alert → `alert.notify` job
   → runner → Mailpit message to the synthetic ops address (`alert-drill-db.spec.ts`) — the local version of the
   staging drill. Then steps 2-5.
2. **Migration `000038`:**
   - `ops.alert_rules(rule text primary key, severity text check in ('critical','warn','info'), fn regprocedure,
     enabled boolean default true, cooldown_minutes int default 60)`; each rule function returns `table(firing boolean,
     details jsonb)` with counts, rule parameters and at most 10 job/queue ids — never names, phones, emails or payloads.
   - `ops.alerts(id uuid pk, rule text references ops.alert_rules, severity, status open|resolved, first_seen,
     last_seen, count int, details jsonb, clean_evaluations int, notified_at, notify_count int, provider_message_id text
     ≤ 200, resolved_at)`, unique `(rule) WHERE status = 'open'`; RLS on, revoked from API roles.
   - Rules (R-5): `dead_letter` (warn) — any `ops.jobs` → `dead` (kinds other than `alert.notify`), `communication_queue`
     → `dead_letter`, or `webhook_delivery_queue` → `failed` in the last 15 min; `queue_lag` (warn) — p95 of
     `first_claimed_at − run_at` over jobs first claimed in the last 15 min > 120 s (≥ 5 samples); `queue_oldest_due`
     (critical) — the oldest due `pending` job is older than 5 min; `runner_stale` (critical) — Vault holds
     `jobs_runner_url` and no `ok` runner run in 5 min (silent on local/CI stacks); `lease_expiry` (warn) — more than 3
     jobs with `last_lease_expired_at` in the last 15 min; `error_burst` (warn) — `sum(count)` of `ops.error_events` rows
     with `last_seen` in the last 10 min > 20 (V2-03 sink; rows whose fingerprint recurred today count fully, a
     conservative approximation); `error_sink_overflow` (warn; 03-09b handover) — `ops.error_event_overflow` has a row
     for the current or previous UTC day with `dropped > 0` (the `ops.error_sink_daily_cap()` of 500 new fingerprints
     was hit, so events are being dropped); `error_sink_size` (warn; 03-09b handover) —
     `(ops.error_events_size()->>'bytes')::bigint` > 50 000 000 (10 % of the Free database; the purge, 04-06, should
     keep it far below); `backup_stale` (critical) — at least one `ops.backup_runs` row exists and none `ok` in 13 h
     (the AWS-side alarm covers "never ran"). Rule functions read `ops.*` as definer; no API role gains access.
   - `ops.evaluate_alerts() returns int`: per enabled rule, firing → open or refresh the alert (`count + 1`,
     `last_seen`), reset `clean_evaluations`, and when newly opened or `notified_at` older than the cooldown,
     `ops.enqueue_job('alert.notify', null, {alert_id}, 'alert:<id>:<notify_count + 1>', now(), 5)`; not firing →
     `clean_evaluations + 1`, resolve at 2. Schedule `ops-evaluate-alerts` `*/5 * * * *`. Pure SQL, so evaluation works
     while the app is down.
   - Recursion guard (R-36): `alert.notify` jobs never feed `dead_letter`; an alert that could not be sent stays open
     with `notified_at` null and shows in the ops report (04-06).
   - `public.ops_alert_payload(p_alert_id uuid) returns jsonb` and `public.ops_alert_notified(p_alert_id uuid,
     p_provider_message_id text) returns void` (service role only).
   - Readiness (R-41, revised for V2-03 M-PROBE): `CREATE OR REPLACE public.readiness_probe(p_expected_migration text
     default null)` (same signature as 000029, still SECURITY DEFINER, `search_path = ''`, EXECUTE for `anon` only)
     keeps every V2-03 key and adds **booleans only**, each one `EXISTS` served by an index from 04-01/04-04:
     `jobs_backlog` (a due `pending` job older than 5 min), `jobs_dead_24h` (a job `dead` in 24 h), `runner_stale`
     (Vault holds `jobs_runner_url` and no `ok` runner run in 5 min; `false` when the scheduler is not configured), and
     `alerts_critical_open`. No count, no age, no version (the probe is reachable with the publishable key). `/api/ready`
     `parseProbe` accepts the new keys only as booleans and returns them as `jobs: { backlog, dead24h, runnerStale,
     alertsCriticalOpen }`; status codes unchanged (ready = database answered and `checks.schema` current; the V2-15
     uptime monitor decides what pages). Platform-level rate limiting of the public probe stays with Vercel (03-01
     note); the probe's cost stays one RPC of indexed `EXISTS` checks.
3. **Handler `alert.notify`** (`{ alert_id }`, `maxDurationMs` 10 000): loads the payload; `OPS_ALERT_EMAIL` unset or
   `EMAIL_PROVIDER=disabled` → `dead` with `alert_channel_unconfigured` (`getEmailSender()` returns the
   `DisabledEmailSender`, whose `send` throws `EmailDisabledError`); else `getEmailSender().send({ to, subject:
   "[clinicos <APP_ENV>] <SEVERITY> <rule>", text, html, tag: "ops-alert" }, { signal })` (03-11b), then
   `ops_alert_notified` with `providerMessageId`. An `EmailSendError` is retryable with `safeCode`, never the provider
   text.
   `renderAlertEmail` writes environment, rule, severity, first/last seen (IST and UTC), count, details as escaped
   `key: value` lines, and the runbook anchor `docs/runbooks/jobs.md#<rule>`.
4. **`drill.always_fail`:** registered only with `JOBS_DRILL_ENABLED=true`; always returns a retryable failure (code
   `drill_failure`), so it dies after `max_attempts` (2 via `ops.drill_enqueue`).
5. **Env:** `OPS_ALERT_EMAIL` — email format; production required; staging optional (alerts then stay visible in the
   report); test lane and e2e pin `ops-alerts@example.test`. Email channel only (R-1); backups alert independently
   through SNS (04-05a).

### Tests that fail without the change
- `alerts-db.spec.ts` (evaluator called directly; background cron paused): a dead job → `dead_letter` open + one
  `alert.notify` job; a second evaluation inside the cooldown → `count = 2`, no new job; a due `pending` job aged 6 min
  → `queue_oldest_due` critical; synthetic `first_claimed_at` data with p95 150 s → `queue_lag`; synthetic Vault runner
  URL (rolled-back transaction) and no runner run → `runner_stale`; no Vault secret → no `runner_stale`; 4 lease
  expiries → `lease_expiry`; 21 error-event counts in 10 min → `error_burst`; an `ops.error_event_overflow` row for
  today with `dropped = 3` → `error_sink_overflow`; a synthetic size reading above the threshold (rule parameter lowered
  in a rolled-back transaction) → `error_sink_size`; a 14-hour-old `ok` backup → `backup_stale`; no backup rows → none;
  two clean evaluations → resolved; a dead `alert.notify` job → no `dead_letter` alert.
- `alert-notify-db.spec.ts` (Mailpit, as 03-11b's sender spec does): one message to `ops-alerts@example.test` with the
  expected subject; seeded rows holding a synthetic patient phone and email leave no trace in the message;
  `notified_at` and the provider id set; `OPS_ALERT_EMAIL` unset → `dead`/`alert_channel_unconfigured`, no message.
- `alert-drill-db.spec.ts`: `ops.drill_enqueue('drill.always_fail', 1, '0', 2)` → two runner passes (run_at advanced
  by SQL) → `dead` → evaluate → runner → one Mailpit message for `dead_letter`.
- `alert-email.spec.ts`: HTML escaping; no detail value outside numbers, rule names, ISO timestamps and UUIDs.
- `readiness-probe-db.spec.ts` + `health-probes.spec.ts`: the four job flags are present and boolean (a seeded dead
  job flips `jobs_dead_24h`), the body still holds no number and no version (the V2-03 assertions keep passing), anon
  can still execute only the probe, and the anon-executable definer set is unchanged.
- `env-schema.spec.ts`: production without `OPS_ALERT_EMAIL` and a malformed address throw naming the key.

### Acceptance mapping
"an alert fires in the staging drill": mechanism and local drill full; the staging drill **pending PO (04-P7, P8, P9,
P12)**. P1-25 "dead-letter and queue-lag alerts (V2-04)": full; also carries the V2-03 sink (`error_burst`) and FT-02
(`backup_stale`) signals.

---

## 04-06 Heartbeat (FT-03) + quota monitor (FT-04) + ops retention + staging ops report (FT-03, FT-04 job part, R-2, R-8, R-28, V2-03 R-27) · M · Wave 7

### Files
- `supabase/migrations/000039_ops_heartbeat_quota_report.sql` (`ops` only; types unchanged) + expected-migration bump
  and snapshot.
- `scripts/ops/check-ops-report.ts`, `.github/workflows/ops-report.yml`.
- `docs/runbooks/jobs.md` (heartbeat, quota, retention and report sections; the read-only grant SQL for 04-P10).
- Tests: `tests/ops/quota-level-db.spec.ts`, `tests/ops/heartbeat-quota-db.spec.ts`, `tests/ops/ops-cleanup-db.spec.ts`,
  `tests/ops/ops-report-db.spec.ts`, `tests/ops/check-ops-report.spec.ts`.

### Steps
1. **Tracer:** `ops.heartbeat()` + `ops.quota_snapshot()` rows read back by `ops.report_all()` and accepted by
   `check-ops-report.ts` (`ops-report-db.spec.ts` first case).
2. **Heartbeat (FT-03):** `ops.heartbeats(id bigserial, source text, at timestamptz)`; `ops.heartbeat()` inserts
   `source = 'pg_cron'`; schedule `ops-heartbeat` `0 */6 * * *` (UTC: 05:30, 11:30, 17:30, 23:30 IST); rule
   `heartbeat_gap` (warn) when a heartbeat exists and the newest is older than 7 h. Pause warnings reach the PO through
   the Supabase organisation email (04-P7); the per-minute runner's PostgREST calls are the stronger activity signal
   (pitfall 11, A2).
3. **Quota (FT-04, R-8):** `ops.settings(key text pk, value text)` seeded `plan = free`; `ops.quota_limits(plan,
   metric, limit_value numeric)` seeded `free`: `db_bytes 500000000`, `storage_bytes 1000000000`, `mau 50000` (decimal
   units, conservative; the Pro upgrade is a row update); `ops.quota_level(p_used numeric, p_limit numeric) returns
   text` (immutable): null or ≤ 0 limit → `unknown`, ≥ 70 % → `critical`, ≥ 60 % → `upgrade_trigger`, else `ok`;
   `ops.quota_snapshots(at, plan, db_bytes, storage_bytes, mau_estimate, levels jsonb)`; `ops.quota_snapshot()` reads
   `pg_database_size(current_database())`, `sum((metadata->>'size')::bigint)` over `storage.objects`, and the MAU proxy
   (distinct `auth.users` with `last_sign_in_at` in the current UTC calendar month, A7); schedule `ops-quota-snapshot`
   `30 21 * * *` (03:00 IST daily). Rules `quota_upgrade_trigger` (warn) and `quota_critical` (critical) on the newest
   snapshot. Weekly summary: `ops.enqueue_quota_weekly_summary()` scheduled `30 3 * * 1` (09:00 IST Monday) opens an
   `info` alert `quota_weekly_summary` (dedupe per ISO week) carrying the three metrics, levels and the reminder that
   egress is the PO's monthly dashboard check; it resolves on the next evaluation and is delivered through the same
   `alert.notify` path.
4. **Retention (R-2, V2-03 R-27):** `ops.cleanup() returns jsonb` (counts) scheduled `ops-cleanup` `45 21 * * *`: jobs
   `done`/`cancelled` > 7 d, `dead` > 30 d; `job_runner_runs` > 14 d; `inbound_webhook_events` > 30 d; resolved alerts
   > 180 d; heartbeats > 90 d; quota snapshots and backup runs > 400 d; and `ops.purge_error_events('180 days')` (the
   V2-03 function, 000028; it also prunes `ops.error_event_overflow`; executed by pg_cron as the owner, no API role
   gains EXECUTE — 03-09b handover). `cron.job_run_details` stays with 04-02's job. `ops.error_events` carries no
   `tenant_id`/`user_id` today (null by design); if a later phase fills them, DPDP erasure must cover the table (03-09b
   note, recorded in 04-SUMMARY for the DPDP owner).
5. **Ops report (R-28):** `ops.report_all(p_hours int default 48) returns jsonb` (definer, revoked from every API role;
   the PO grants it to the V2-03 read-only role `clinicos_drift_ro`, `docs/runbooks/staging.md` §3, in 04-P10 — the role
   exists only on staging, so the grant is runbook SQL, not a migration): `jobs` (counts by kind and status, lag p50/p95 in seconds and
   sample size), `runner` (runs, ok runs, largest gap between ok runs, last ok age), `alerts` (rule, severity, opened,
   `notified` boolean, `provider_id_present` boolean), `heartbeats` (timestamps, largest gap), `quota` (latest snapshot
   and levels), `backups` (start time, status, bytes), `dead_last_24h`. Counts and timestamps only — no ids, names,
   phones or payloads. `check-ops-report.ts <file> [--require lag,heartbeat,quota,alert-drill,backups]`: validates the
   key set, fails on any phone/email/UUID-shaped string, and reports per requirement: lag p95 < 120 s with ≥ 100
   samples; heartbeat largest gap ≤ 6 h 15 min over ≥ 24 h; a quota snapshot with three metrics and levels; a notified
   `dead_letter` alert with a provider id; ≥ 2 ok backups per IST day. `ops-report.yml`: `schedule` `0 5 * * *` (10:30
   IST) + `workflow_dispatch`; `environment: staging-readonly`; `permissions: contents: read`; SHA-pinned actions; no
   `pull_request*`/`workflow_run`; `npm ci --ignore-scripts`, no npm cache; first step `node
   scripts/staging/target-guard.mjs --var STAGING_DB_URL_RO --mask` (as `drift.yml` does); the secret reaches the
   step only through `env` (no `${{ }}` inside `run:`); the digest-pinned `postgres:17` image runs `psql
   "$STAGING_DB_URL_RO" -Atc "select ops.report_all(48)"`; the checker runs; the job fails only on a schema or PII
   violation (acceptance results are data); artifact `ops-report`. `node scripts/ci/workflow-policy.mjs` (in `static`)
   must stay green, and `tests/ci/workflow-policy.spec.ts` gains a fixture case if the policy needs a new rule.
   Schedules fire only once the default branch is `feature/v2` (RL-3).

### Tests that fail without the change
- `quota-level-db.spec.ts` (roadmap "quota-threshold unit test"): `(299999999, 500000000)` → `ok`; `(300000000,
  500000000)` → `upgrade_trigger`; `(349999999, …)` → `upgrade_trigger`; `(350000000, …)` → `critical`; limit 0 or
  null → `unknown`.
- `heartbeat-quota-db.spec.ts`: `ops.heartbeat()` writes a row; `ops-heartbeat` is registered with `0 */6 * * *`;
  newest heartbeat aged 7 h 1 min → `heartbeat_gap`; `ops.quota_snapshot()` after uploading one synthetic object
  reports `storage_bytes` ≥ its size, `db_bytes` > 0 and `mau_estimate` ≥ the seeded sign-ins; with the free DB limit
  set by the test (rolled back) to put usage at 65 % → `quota_upgrade_trigger`, at 72 % → `quota_critical`; the weekly
  summary opens one `info` alert per ISO week.
- `ops-cleanup-db.spec.ts`: rows older than each retention are removed and newer rows kept, per table; old
  `ops.error_events` rows are purged.
- `ops-report-db.spec.ts`: with seeded rows containing a synthetic phone, email and patient name in queue tables, the
  report has only the allowed keys and none of those strings; the lag figure matches the seeded data.
- `check-ops-report.spec.ts`: fixtures for pass, lag fail, heartbeat-gap fail, a phone-shaped string → exit 1.

### Acceptance mapping
"the heartbeat row is written every 6 h": mechanism full locally; staging proof via the ops report **pending PO
(04-P8…P10 + 24 h)**. "the quota job reports database, Storage and MAU usage against the 60 %/70 % thresholds": full
locally; staging report pending the same actions. Evidence "the staging alert-drill record": the `ops-report` artifact
after 04-P12.

---

## 04-05b Staging backup stack, failed-run drill and first staging restore drill (FT-02 hosted half) · post-merge, PO-driven

No implementer wave and no code. After the phase PR merges, the PO works through 04-P2…P7 (start these on day one —
longest lead), then 04-P11 and 04-P13. Claude verifies each step with the read-only commands in the PO-actions list,
downloads the `backup-evidence` artifact (`gh run download`), checks it with `npx tsx ops/backup/evidence.ts --check
<file>`, verifies the drill evidence with `npx tsx ops/restore-drill/check-evidence.ts <file>`, and records results in
`04-VERIFICATION.md` and VERIFICATION_LOG. If the first scheduled `backup.yml` run (erratum 2026-11-14, 04-07c: was "CodeBuild run") exposes a runtime detail (A4/A5: image packages,
Docker mode, pooler), the fix ships on a follow-up branch `v2/phase-04-backup-fixes` with a regression case in
`tests/ops/`.

---

## Acceptance mapping (roadmap V2-04, binding)

| # | Acceptance item | Plan(s) | Local proof (tool output) | Hosted part | Status at the gate |
|---|---|---|---|---|---|
| 1 | the parallel-dispatcher test shows 0 duplicate sends | 04-01, 04-03a | `parallel-dispatch-db.spec.ts` (8 runners × 200 messages) | — | Done |
| 2 | a stuck `processing` row is reclaimed | 04-01, 04-03a | `reaper-db.spec.ts`, `delivery-reap-db.spec.ts` | — | Done |
| 3 | queue lag p95 < 2 min in staging (**Assumption (validate)**) | 04-02, 04-06 | `evidence/scheduler-local-e2e.json` (macOS, real pg_cron → pg_net → app); lag computed by `ops.report_all` in `ops-report-db.spec.ts` | `ops-report` artifact after 04-P12 lag load (≥ 100 samples) | **Pending PO (04-P1, P8, P9, P10, P12)**, post-merge |
| 4 | an alert fires in the staging drill | 04-04 | `alert-drill-db.spec.ts` (Mailpit) | SES email + notified `dead_letter` row in the `ops-report` artifact | **Pending PO (04-P7, P8, P9, P10, P12)**, post-merge |
| 5 | an encrypted dump of staging lands in the ~~`ap-south-1`~~ staging R2 bucket (erratum 2026-11-14, 04-07c) twice a day and a deliberately failed run raises an alert | 04-05a (+04-05b) | self-test round trip; `backup-stack-policy`, `backup-script-guards`, `backup-evidence` specs | `backup-evidence` artifact: `twice_daily_ok`, `region_ok`, `encryption_ok`, `lifecycle_ok`, failed build + SNS delivery | **Pending PO (04-P2…P7, P11)**, post-merge |
| 6 | the first restore drill rebuilds staging data in a local stack and passes the pgTAP RLS suite, with RPO and RTO recorded | 04-05a (+04-05b) | `restore-drill-selftest.json` (local data); `restore-drill-checks-db.spec.ts` | `restore-drill-staging.json` + VERIFICATION_LOG entry | Mechanics done; staging drill **pending PO (04-P13)** |
| 7 | the heartbeat row is written every 6 h | 04-06 | `heartbeat-quota-db.spec.ts` (function + schedule) | `ops-report` heartbeat gap ≤ 6 h 15 min over ≥ 24 h | Local done; staging **pending PO (04-P1, P8…P10)** |
| 8 | the quota job reports database, Storage and MAU usage against the 60 %/70 % thresholds | 04-06 | `quota-level-db.spec.ts`, `heartbeat-quota-db.spec.ts` | `ops-report` quota block | Local done; staging pending the same |

Roadmap tests: concurrency T-07 subset (04-01, 04-03a); reaper (04-01, 04-03a); MSW contract for MSG91 (04-03a);
scheduler migration test on the local stack (04-02); the scripted restore drill (04-05a, nightly + local); a
quota-threshold unit test (04-06). Roadmap evidence: CI links (phase close); the staging alert-drill record (04-P12 →
`ops-report` artifact + VERIFICATION_LOG); the restore-drill record in VERIFICATION_LOG (self-test now, staging after
04-P13); a bucket listing with names and sizes only (`backup-evidence` artifact after 04-P6).

## Source coverage audit

| Source | Item | Covered by |
|---|---|---|
| GOAL | no duplicate or lost messages | 04-01, 04-03a/b/c (claim + fencing + delivery claim + dedupe + reaper + scheduler) |
| GOAL | no lost data on the Free plan | 04-05a/b (backups, drill), 04-06 (heartbeat, quota), 04-04 (`backup_stale`) |
| REQ P0-12 | atomic claim + lease + reaper | 04-01, 04-03a (`reap_delivery_rows`) |
| REQ P0-12 | scheduler per C22 | 04-02 |
| REQ P0-12 | remove inline `dispatchPendingQueue` and fire-and-forget webhook dispatch | 04-03a, 04-03b (+ lint guard R-33) |
| REQ P0-12 | webhook idempotency | 04-03b (outbound event keys), 04-03c (inbound dedupe) |
| REQ P1-25 (alerts part) | dead-letter and queue-lag alerts | 04-04 |
| REQ FT-02 | dump + Storage sync twice a day from AWS ap-south-1 (staging: GitHub Actions to Cloudflare R2, unversioned; erratum 2026-11-14, 04-07c, R-48), age, versioned SSE-KMS bucket, 30-day lifecycle rule, failure alert, on-demand dump, monthly drill, RPO/RTO | 04-05a (code, runbook incl. on-demand and monthly), 04-05b (hosted) |
| REQ FT-03 | heartbeat every 6 h; pause warnings to a monitored inbox | 04-06, 04-P7 |
| REQ FT-04 | quota job vs 60 %/70 %; PO monthly egress check | 04-06 (daily + weekly summary, R-8); egress stays a PO dashboard check, named in the weekly email |
| CONTEXT (locked) | C22 pg_cron + pg_net, migration-defined | 04-02 |
| CONTEXT (locked) | ADR-0005 D2 (`lib/jobs` split, factory allow-list), D3 (enqueue RPC, no tenant argument), D4 (ESLint), register end state | 04-02, 04-03a/b/c; R-6 clarification proposed |
| CONTEXT (locked) | ADR-009 / TARGET §8 (claim RPC, lease, backoff with jitter, dead letters 30 d, per-tenant cap, alerts) | 04-01, 04-04, 04-06 |
| CONTEXT (locked) | §9.1 bucket rule; PO-23(h) never a GitHub-hosted runner for real data | 04-05a template + policy spec; evidence workflow lists names only |
| CONTEXT (locked) | §9.1 pg_cron/pg_net confirmed on staging Free | 04-P1, before the staging apply (R-34 — PO direction) |
| CONTEXT (locked) | RL-23 | 04-02, 04-03a/b |
| RESEARCH | rulings R-1…R-14, pitfalls 1-12, test map, PO actions P-1…P-9 | adopted (rulings table); deviations listed below |
| Carry-over | V2-03 R-27 purge scheduling | 04-06 |
| Carry-over | V2-03 R-10 SES bounce/complaint webhook | **Re-homed to V2-12** (R-40), PO confirms (04-P14) |
| V2-03 handover (03-07 D1 finding 2, wave note) | enqueue binds the session's active tenant; dual-member leg | 04-03a, 04-03b (R-6 revised, A2) |
| V2-03 handover (03-07 pattern) | outbox writes through `private.*` definer writers; `event_key` in `private.outbox_payment_recorded` | 04-03a, 04-03b (R-44) |
| V2-03 handover (03-10) | atomic outbox claim for the enqueue + cron double POST | 04-03b (`webhook_delivery_claim`) |
| V2-03 handover (03-01) | `disabled` refusals retry to dead letter (no non-retryable path) | 04-03a (`communication_queue_dead_letter`) |
| V2-03 handover (03-02) | reasons `cron.dispatch_communications` / `cron.webhooks` removed | 04-03a, 04-03b |
| V2-03 handover (03-04) | factory narrowed to `lib/jobs/internal/**` | done in V2-03 (03-13c); 04-02 adds cases only |
| V2-03 handover (03-04) | delete the V2-04 register zone with its passing cases and `ALLOWED_IMPORTER` lines | 04-03c |
| V2-03 triage M-XTENANT-WH | revoke direct queue writes (enqueue RPC) | 04-03c (contract) |
| V2-03 triage M-XTENANT-WH | dispatcher tenant check | done in V2-03 (03-13d); kept in the `webhook.deliver` handler (04-03b); composite FK is V2-05 05-03 |
| V2-03 triage M-SSRF-V6 / M-SSRF-DNS, review E-6 | SSRF byte checks, address pinning, provider timeouts | done in V2-03 (03-13d); reused by 04-03a/04-03b (T-04-19 mitigated) |
| V2-03 handover (03-09b) | schedule `ops.purge_error_events()`; alert on overflow and size | 04-06 (purge), 04-04 (`error_sink_overflow`, `error_sink_size`) |
| V2-03 handover (03-11b, 03-13a residual 6) | Send Email hook `webhook-id` dedupe in a shared store | 04-03c (R-43, ADR A3) |
| V2-03 triage (accepted, owner "V2-04 runbook") | staging migrate before promote | 04-03c (`docs/runbooks/staging.md` §6) |
| V2-03 handover (03-13c) | every migration bumps `EXPECTED_MIGRATION`; snapshot regenerated per migration | every migration plan (per-migration chores, R-45) |
| V2-03 triage (review A Lows, owner V2-04 04-00) | L-1 whitespace-only env values; L-2 loopback/odd URL forms and bare origins; L-3 CLI opaque local keys; L-5 dry run gates nothing; L-6 `wait-for-release` on a newer deploy; L-7 DB passwords in argv; L-8 test-lane guard gaps | 04-00 (R-47; 04-P16 for L-5's staging grant) |
| V2-03 handover (03-01) | `/api/ready` public cost | bounded: booleans from indexed `EXISTS` only (R-41); platform rate limiting stays with Vercel (V2-15 uptime/WAF) |
| Deferred (research, not V2-04) | P1-13 governance, P1-14 producers, remaining webhook F5 hardening (SSRF pinning already done in V2-03), P1-17 purges, P1-05 in-transaction enqueue, V2-15 drain/uptime/production FT-02, Pro upgrade, FT-04 compression, V2-05 pgTAP matrix | not planned |

## PO actions for this phase

The orchestrator copies these into `.planning/PO-ACTIONS.md` under "V2-04 Jobs reliability". No secret value appears
here; secrets go only into the named store. Values in angle brackets are filled by the PO. **Order (lead times):** the
AWS track first — 04-P2 → P3 → P7 → P4 → P5 → P6 (can start before the merge; nothing in the repo waits on it); at the
gate 04-P14, P15; 04-P16 any time before the merge (else right after it); after the merge 04-P1 (before approving
the staging migrate run) → P8 → P9 → P10 → ≥ 48 h of running → P11, P12, P13. None of these blocks local work or the gate except P15 (merge) — R-19 pattern from V2-03.

- [ ] **04-P1 · Confirm pg_cron, pg_net and Vault on the staging Free project**
  - *Do / where:* Supabase Dashboard → project `clinicos-staging` (03-E2) → SQL Editor → run
    `select name, default_version, installed_version from pg_available_extensions where name in ('pg_cron','pg_net','supabase_vault') order by 1;`
    and paste the output. Do not enable anything by hand; migration `000033_jobs_scheduler.sql` does it. Then approve
    the `staging.yml` `migrate` run for the V2-04 merge commit **right away**: V2-04's code needs its own migrations
    (R-38), so until the run finishes staging answers `/api/ready` 503 with `checks.schema: "behind"` (runbook
    `docs/runbooks/staging.md` §6, "migrate before promote").
  - *Values:* none.
  - *Why:* roadmap §9.1 — availability on Free is not stated by Supabase (A1). The migration fails loudly where an
    extension is missing (R-34).
  - *Unblocks:* approving the first `staging.yml` migrate run that contains `000033_jobs_scheduler.sql`; acceptance 3,
    4, 7.
  - *Verify (Claude, read-only):* three rows in the pasted output; after the approved run, `gh run view <run id> --json
    conclusion,jobs` → success (its `wait-for-release` step requires `checks.schema: "current"`); recorded in
    VERIFICATION_LOG.

- [ ] **04-P2 · AWS account baseline in `ap-south-1` (shared with SES, 03-E6)**
  - *Do / where:* AWS console: root user MFA; an admin role or IAM Identity Center user for yourself (do not use root);
    default region **Asia Pacific (Mumbai) `ap-south-1`**; Billing → Budgets → monthly cost budget US$10 with an email
    alert to the ops inbox (04-P7).
  - *Why:* FT-02 runs in AWS `ap-south-1` (PO-23(h)); Claude never holds AWS credentials (R-14).
  - *Unblocks:* 04-P4, P5.
  - *Verify (you paste, read-only, CloudShell in Mumbai):* `aws sts get-caller-identity --query Arn --output text` (not
    a root ARN) and `aws budgets describe-budgets --account-id $(aws sts get-caller-identity --query Account --output
    text) --query 'Budgets[].BudgetName'`.

- [ ] **04-P3 · Two age key pairs for staging backups**
  - *Do / where:* on your machine: install age v1.3.2 (`brew install age`, or the release in `ops/bin/pins.env`); run
    `age-keygen -o clinicos-staging-primary.agekey` and `age-keygen -o clinicos-staging-breakglass.agekey`; store the
    primary file in your password manager and the break-glass file sealed offline; delete the local files.
  - *Values:* give Claude only the two **public** recipient lines (`age1…`, printed by `age-keygen`; public by design).
    Production gets separate pairs in V2-15.
  - *Why:* R-3 — losing one key never loses the backups.
  - *Unblocks:* 04-P5 (`AgeRecipients`), 04-P13.
  - *Verify (Claude):* `npx tsx ops/backup/render.ts --check-recipients <r1>,<r2>` (format, two distinct keys); the
    final proof is 04-P13 (decrypt with each key).

- [ ] **04-P4 · Staging backup credentials in SSM Parameter Store (+ S3 protocol check)**
  - *Do / where:* Supabase staging → Connect → **Session pooler** URI (port 5432, includes the DB password) and Storage →
    Settings → S3 connection (enable the S3 protocol, create an access key; note the endpoint and region). AWS console
    (Mumbai) → Systems Manager → Parameter Store → create, Standard tier: SecureString
    `/clinicos/staging/backup/db_url`, `/clinicos/staging/backup/storage_s3_key_id`,
    `/clinicos/staging/backup/storage_s3_secret`; String `/clinicos/staging/backup/storage_s3_endpoint`
    (`https://<ref>.storage.supabase.co/storage/v1/s3`) and `/clinicos/staging/backup/storage_s3_region`.
  - *Why:* FT-02; the session pooler works from CodeBuild without IPv6 (A4); the S3 keys are used read-only by the sync.
  - *Unblocks:* the first backup run (04-P5).
  - *Verify (you paste):* `aws ssm describe-parameters --parameter-filters Key=Name,Option=BeginsWith,Values=/clinicos/staging/backup/ --query 'Parameters[].[Name,Type]' --output text`
    → five names, no values. If Storage offers no S3 protocol on Free, say so (risk K-5).

- [ ] **04-P5 · Deploy the staging backup stack**
  - *Do / where:* CloudShell (Mumbai): upload `ops/backup/stack.json` from `feature/v2`; `aws cloudformation
    validate-template --template-body file://stack.json`; `aws cloudformation deploy --stack-name
    clinicos-staging-backup --template-file stack.json --capabilities CAPABILITY_NAMED_IAM --parameter-overrides
    Environment=staging AgeRecipients=<age1…>,<age1…> AlertEmail=<04-P7 inbox> GitHubRepository=thecliniqai/cliniqai-app
    GitHubEnvironment=staging-readonly CreateGitHubOidcProvider=true` (set `false` if the account already has the GitHub
    OIDC provider); confirm the SNS subscription email; start one build: `aws codebuild start-build --project-name
    clinicos-staging-backup`.
  - *Why:* FT-02 (R-14).
  - *Unblocks:* acceptance 5, 6; 04-P6, P11, P13.
  - *Verify (you paste, read-only):* `aws cloudformation describe-stacks --stack-name clinicos-staging-backup --query
    'Stacks[0].[StackStatus,Outputs]'`; `aws s3api get-bucket-versioning --bucket <BucketName>`; `aws s3api
    get-bucket-lifecycle-configuration --bucket <BucketName>`; `aws s3api get-bucket-encryption --bucket <BucketName>`;
    `aws s3api get-public-access-block --bucket <BucketName>`; `aws s3api get-bucket-location --bucket <BucketName>`;
    `aws scheduler get-schedule --name clinicos-staging-backup --query
    '{e:ScheduleExpression,tz:ScheduleExpressionTimezone,state:State}'`; `aws sns list-subscriptions-by-topic
    --topic-arn <TopicArn> --query 'Subscriptions[].SubscriptionArn'` (not `PendingConfirmation`); `aws codebuild
    batch-get-builds --ids <id> --query 'builds[0].buildStatus'` → `SUCCEEDED`. From 04-P6 on Claude reads the same
    through the `backup-evidence` artifact.

- [ ] **04-P6 · GitHub variables for backup evidence**
  - *Do / where:* repo `thecliniqai/cliniqai-app` → Settings → Environments → `staging-readonly` (03-E10) → Variables
    (not secrets): `AWS_BACKUP_EVIDENCE_ROLE_ARN` = output `EvidenceRoleArn`, `AWS_REGION=ap-south-1`, `BACKUP_BUCKET` =
    output `BucketName`, `BACKUP_PROJECT=clinicos-staging-backup`, `BACKUP_TOPIC_ARN` = output `TopicArn`.
  - *Why:* tool-produced bucket listing (names and sizes) without AWS keys anywhere.
  - *Unblocks:* acceptance 5 evidence.
  - *Verify (Claude):* `gh variable list --env staging-readonly -R thecliniqai/cliniqai-app`; after the next scheduled
    run `gh run list --workflow backup-evidence.yml --limit 1 --json conclusion,url,headSha` and `gh run download <id>
    -n backup-evidence`, then `npx tsx ops/backup/evidence.ts --check <file>`.

- [ ] **04-P7 · Monitored ops inbox**
  - *Do / where:* choose an address you read daily (e.g. `ops@<domain>` from 03-E0). (a) Supabase organisation
    `clinicos-staging` → Settings → billing/notification email = this address (pause and quota warnings, FT-03);
    (b) SES (03-E6): while in the sandbox, verify it as a recipient; (c) use it for `AlertEmail` (04-P5) and
    `OPS_ALERT_EMAIL` (04-P8).
  - *Why:* R-1 (email only); FT-03 pause warnings.
  - *Unblocks:* acceptance 4; backup failure emails.
  - *Verify (you paste):* `aws sesv2 get-email-identity --email-identity <address> --region ap-south-1 --query
    VerifiedForSendingStatus` → `true` (sandbox); receipt of the SNS confirmation (04-P5) and the drill email (04-P12).

- [ ] **04-P8 · Vercel staging environment for jobs**
  - *Do / where:* Vercel → `clinicos-staging` → Settings → Environment Variables (the environment that serves
    `feature/v2`): `JOBS_RUNNER_SECRET` = output of `openssl rand -hex 32` (sensitive; the same value goes to Vault in
    04-P9); `OPS_ALERT_EMAIL=<04-P7 address>`; `MESSAGING_PROVIDER=sink` (replaces `disabled`, R-9);
    `JOBS_DRILL_ENABLED=false`; `EMAIL_PROVIDER=ses` once 03-E6/E8 are done (until then alerts stay visible in the
    report only). Keep `CRON_SECRET` (diag route, R-27). Redeploy.
  - *Why:* R-9, R-17, R-32.
  - *Unblocks:* 04-P9, P12; acceptance 3, 4.
  - *Verify (Claude, read-only):* `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://staging.<domain>/api/jobs/run`
    → `401` (no secret, no side effect); `curl -s https://staging.<domain>/api/ready` → `"status":"ready"`,
    `checks.schema` `"current"`, `providers.messaging` `"disabled"` (sink) and a `jobs` block of four booleans (no
    counts: V2-03 M-PROBE).

- [ ] **04-P9 · Scheduler secrets in staging Vault + answer OI-3**
  - *Do / where:* after the approved migrate run with `000033`: staging SQL Editor:
    `select vault.create_secret('<the 04-P8 JOBS_RUNNER_SECRET value>', 'jobs_runner_secret');` and
    `select vault.create_secret('https://staging.<domain>/api/jobs/run', 'jobs_runner_url');`. OI-3: Vercel (v1 and
    staging projects) → Settings → Cron Jobs — any entries? any external pinger calling `/api/cron/*`? (those routes
    now answer 404).
  - *Why:* C22; secrets never in migrations or git.
  - *Unblocks:* acceptance 3, 4, 7 (runner traffic, alert delivery).
  - *Verify (you paste, read-only):* `select name, created_at, updated_at from vault.secrets where name like 'jobs_runner_%';`
    → 2 rows, no values. Claude, after 04-P10: `ops-report` artifact shows ≥ 50 ok runner runs in the last hour.

- [ ] **04-P10 · Read-only grants for the ops report**
  - *Do / where:* staging SQL Editor: the two statements in `docs/runbooks/jobs.md` §"Ops report" (`grant usage on schema
    ops to clinicos_drift_ro; grant execute on function ops.report_all(integer) to clinicos_drift_ro;` — the read-only
    role from `docs/runbooks/staging.md` §3, already used by `STAGING_DB_URL_RO` in Environment `staging-readonly`).
    Then GitHub → Actions → `ops-report` → Run workflow (or wait for the daily run; schedules fire only once the
    default branch is `feature/v2`, RL-3).
  - *Why:* R-28 — staging evidence produced by a tool with a role that can read counts only.
  - *Unblocks:* evidence for acceptance 3, 4, 7, 8.
  - *Verify (Claude):* `gh run list --workflow ops-report.yml --limit 1 --json conclusion,url,headSha`; `gh run download
    <id> -n ops-report`; `npx tsx scripts/ops/check-ops-report.ts <file> --require heartbeat,quota`.

- [ ] **04-P11 · Backup failed-run drill**
  - *Do / where:* after ≥ 2 days of scheduled runs, CloudShell: `aws codebuild start-build --project-name
    clinicos-staging-backup --environment-variables-override name=FORCE_FAIL,value=1,type=PLAINTEXT`; confirm the SNS
    "FAILED" email arrives (forward its subject line).
  - *Why:* acceptance 5 ("a deliberately failed run raises an alert").
  - *Unblocks:* acceptance 5.
  - *Verify (Claude):* the next `backup-evidence` artifact shows that build `FAILED` with the `FORCE_FAIL` override name,
    `failed_run_alerted = true` (SNS delivered count in that window) and `twice_daily_ok = true`.

- [ ] **04-P12 · Staging alert drill and lag load**
  - *Do / where:* after 04-P8…P10 and ≥ 24 h of runner traffic: (1) Vercel `JOBS_DRILL_ENABLED=true`, redeploy; (2) SQL
    Editor: `select ops.drill_enqueue('drill.noop', 300, interval '6 hours');` and `select
    ops.drill_enqueue('drill.always_fail', 1, interval '0', 2);`; (3) within about 15 min an email
    "[clinicos staging] WARN dead_letter" arrives; (4) after 6 h set `JOBS_DRILL_ENABLED=false`, redeploy, run
    `ops-report`.
  - *Why:* acceptance 3 and 4.
  - *Unblocks:* acceptance 3, 4; evidence "the staging alert-drill record".
  - *Verify (Claude):* `npx tsx scripts/ops/check-ops-report.ts <ops-report file> --require lag,alert-drill` passes (lag
    p95 < 120 s with ≥ 100 samples; a notified `dead_letter` alert with a provider id); recorded in VERIFICATION_LOG.

- [ ] **04-P13 · First restore drill from a staging backup**
  - *Do / where:* on your machine (Docker running, repo at `feature/v2`): S3 console → backup bucket → `staging/` →
    download the newest `.tar.age` to a folder outside the repo; export the primary key from your password manager to
    a file outside the repo; run `ops/restore-drill/run.sh --dump <file> --identity <primary key file> --evidence
    .planning/phases/04-jobs-reliability/evidence/restore-drill-staging.json`; then once `ops/restore-drill/run.sh
    --dump <file> --identity <break-glass key file> --decrypt-only`; delete the archive and key files afterwards.
  - *Why:* acceptance 6; keys and real dumps never enter an agent session (R-29).
  - *Unblocks:* acceptance 6; evidence "the restore-drill record in VERIFICATION_LOG".
  - *Verify (Claude):* `npx tsx ops/restore-drill/check-evidence.ts .planning/phases/04-jobs-reliability/evidence/restore-drill-staging.json`
    → pass (all checks green, RPO ≤ 12 h, RTO ≤ 4 h, counts only); VERIFICATION_LOG entry written from the file.

- [ ] **04-P14 · Confirm the V2-04 rulings** — the rulings table below (R-1…R-47), in particular R-6 (revised: the
  enqueue RPCs take the session's active tenant as a constraint; ADR-0005 amendment A2 in `04-ADR0005-PROPOSALS.md`
  replaces D3's "accepts no tenant argument"), R-7 (TARGET §8 erratum: `dedupe_key` NOT NULL), R-26 (test ping
  becomes queued; event data built in SQL), R-27 (CRON_SECRET kept), R-34 (pg_cron confirmation at the staging apply),
  R-38 (contract in the same PR), R-40 (SES bounce webhook moves to V2-12), R-41 (revised: `/api/ready` gains four
  booleans, no counts), R-43 (Send Email hook dedupe through the system client; ADR-0005 amendment A3), R-44 (`private`
  definer writers), R-47 (04-00 hardening choices). *Verify:* your confirmation recorded in VERIFICATION_LOG's gate section.
- [ ] **04-P15 · Confirm the pinned artefacts** — `msw@3.0.3` (research verdict SUS "too-new", older pin taken),
  age v1.3.2 SHA-256 values, the `postgres:17` and `amazon/aws-cli` digests, the `configure-aws-credentials` SHA.
  Review `evidence/package-legitimacy.json` and `evidence/pins.json`. Blocks the **merge**, not local work (V2-03
  R-23 pattern). *Verify:* confirmation recorded.

- [ ] **04-P16 · Read grant on the migration history for the `plan` job (04-00, review A L-5)**
  - *Do / where:* any time (best before the V2-04 merge; moot until staging is live), staging SQL Editor: the two
    statements in `docs/runbooks/staging.md` §3 (`grant usage
    on schema supabase_migrations to clinicos_drift_ro; grant select on supabase_migrations.schema_migrations to
    clinicos_drift_ro;`). Nothing else changes for the role (still no table or function grant in `public`).
  - *Values:* none.
  - *Why:* the new `plan` job (Environment `staging-readonly`) lists the pending migrations from the read-only URL before
    you approve `migrate`, so the approval is no longer blind (review A L-5).
  - *Unblocks:* the `plan` job on every `staging.yml` run from the V2-04 merge on; without the grant `plan` fails and
    `migrate` (which `needs: plan`) does not start.
  - *Verify (Claude, read-only):* `gh run view <staging.yml run id> --json jobs` → `plan` success; its summary lists
    migration file names and a count only; recorded in VERIFICATION_LOG.

**No PO action needed for:** the queue, scheduler and alert code and their local tests, the MSG91 MSW contracts, the
local backup self-test and drill, the template and its policy checks, the workflows' code.

## Phase close

1. **Report gate:** add to `REQUIRED_FILES` in `scripts/ci/assert-vitest-report.mjs`: `tests/jobs/claim-grants-db`,
   `parallel-dispatch-db`, `reaper-db`, `scheduler-migration-db`, `run-route`, `enqueue-message-rpc-db`,
   `delivery-reap-db`, `enqueue-webhook-rpc-db`, `queue-grants-db`, `alerts-db` (all `.spec.ts`),
   `tests/messaging/inbound-dedupe-db.spec.ts`, `tests/messaging/msg91-contract.spec.ts`,
   `tests/ops/restore-drill-checks-db.spec.ts`, `tests/ops/backup-stack-policy.spec.ts`,
   `tests/ops/quota-level-db.spec.ts`, `tests/security/p0-12-lint-gates.spec.ts`,
   `tests/jobs/webhook-deliver-handler-db.spec.ts`, `tests/jobs/message-send-handler-db.spec.ts`,
   `tests/integration/auth/send-email-hook-dedupe-db.spec.ts`; raise the FLOOR with the arithmetic in the same commit
   (tests removed by rewrites are counted there too; the V2-03 files already listed stay, rewritten in place).
2. **Local evidence (tool-produced):** `npm run typecheck`, `npx eslint .`, `npm run inventory`, `npm run ci:ai-l1`,
   `npm run ci:audit`; `node scripts/phase-evidence.mjs .planning/phases/04-jobs-reliability/evidence 2` (two full
   Vitest runs + `static-checks.json` with the V2-03 ESLint counters — `boundary_messages` 0 incl. `P0-12`,
   `boundary_directives` `[]`, `system_module_importers` without any V2-04 register path — plus `cron_route_files` 0);
   `node scripts/drift/schema-snapshot.mjs --local --check` and the gitleaks scan output;
   `npm run e2e:build && npm run e2e:pr` with the JSON report copied into `evidence/`;
   `evidence/restore-drill-selftest.json`; `evidence/scheduler-local-e2e.json`; `evidence/package-legitimacy.json`;
   `evidence/pins.json`; `npx tsx ops/backup/render.ts --check` output.
3. **CI (orchestrator):** push; mark the PR ready; all five checks green with 0 retried tests (the nightly
   `backup-roundtrip` job runs on `feature/v2` once merged, because schedules run on the default branch; its first green
   run is recorded post-merge, and until then the local self-test evidence stands); then `node scripts/phase-evidence.mjs
   .planning/phases/04-jobs-reliability/evidence --ci-run <id>`.
4. **Reviews (CLAUDE.md DoD 6)** into `.planning/phases/04-jobs-reliability/reviews/`: one independent review of the
   full diff by an isolated reviewer (fresh context, no implementer reasoning) → `v204-review-independent.md`;
   adversarial second reviews per security-sensitive group: (A) queue, claim, fencing, enqueue RPCs (incl. the
   dual-member active-tenant constraint and the `private` writers), triggers, grants, contract migration, RLS policy
   change (04-01, 04-03a/b/c, migrations 000031, 000034…000037) → `v204-review-adversarial-queue-db.md`; (B) scheduler,
   Vault, pg_net revokes, runner route, secret compare, proxy, env tiers, drill flags, the readiness flags, the Send
   Email hook dedupe and ADR A3, the 04-00 env/staging hardening (env schema, test-lane guard, `staging.yml` `plan`
   job, target guard, `wait-for-release`) (04-00, 04-02, 04-03c step 7, 04-04) → `…-scheduler-secrets.md`; (C) backups, IaC,
   IAM/KMS/OIDC, keys, drill, evidence workflows (04-05a, 04-06 workflow) → `…-backups-iac.md`; (D) PHI in payloads,
   errors, alerts, reports, inbound webhook, messaging providers, webhook delivery through the pinned transport
   (04-03a/b/c, 04-04, 04-06) → `…-phi-messaging.md`. Triage as in V2-03 (`04-07-REVIEW-TRIAGE.md`): fixes land in a
   review-fix plan `04-07` on this branch with regression tests; Highs get a fresh re-verification review; accepted
   items are recorded with reason and owner.
5. **Documents:** `04-SUMMARY.md` (what shipped per plan, the real migration numbers, deviations, deferrals with owners
   — SES bounce webhook V2-12, P1-13 phone in the urgent DLR notification V2-12, remaining F5 webhook hardening per its
   owner, production FT-02 V2-15, production drill machine V2-15 (R-42), DPDP erasure of `ops.error_events` if its
   ids are ever filled; proposed doc errata for PO approval: ADR-0005 A2 and A3,
   TARGET §8 `dedupe_key` NOT NULL and table name `ops.jobs`, V2_MASTER_ROADMAP §9.1 pg_cron confirmation at the
   staging apply; the pending-PO list); `04-VERIFICATION.md` (the acceptance table with tool evidence: CI run link +
   commit SHA + evidence files; hosted items "pending PO (04-P…)"); the V2-04 gate entry in `docs/v2/VERIFICATION_LOG.md`
   (OI-3 answer when 04-P9 lands; D16/F-3b/F-3a rows updated to "fixed in V2-04" with the spec names).
6. **Proposed CLAUDE.md Commands update (PO approves, 04-P14):** never-run list gains `ops/backup/backup.sh` with
   `BACKUP_ENV` other than `local`, any `aws` command against a real account, and dispatching `ops-report.yml` /
   `backup-evidence.yml`; commands gain `ops/restore-drill/run.sh --self-test` and `npx tsx
   scripts/ops/scheduler-local-e2e.ts` (macOS).
7. **After merge (post-gate):** the PO works through 04-P1 and P8…P13; Claude runs each verify command, ticks the item
   in `.planning/PO-ACTIONS.md` with evidence, and updates `04-VERIFICATION.md` and VERIFICATION_LOG for acceptance
   items 3-8.

## Threat model (STRIDE register, phase-wide)

| Threat ID | Category | Component | Severity | Disposition | Mitigation |
|---|---|---|---|---|---|
| T-04-01 | Spoofing | `/api/jobs/run` called by an attacker | high | mitigate | 256-bit dedicated secret, SHA-256 + `timingSafeEqual` against current/next, 401 before DB access, POST only, idempotent claim (extra calls only process due work) (04-02) |
| T-04-02 | Info disclosure | runner secret readable in `net.http_request_queue` | high | mitigate | `net` revoked from `PUBLIC, anon, authenticated` (asserted in the migration test); the secret authorises only the runner, never the service key; rotation via NEXT (04-02) |
| T-04-03 | Elevation | API roles calling `claim_jobs`/`complete_job`/`fail_job` or reading `ops.*` | high | mitigate | service-role-only EXECUTE; `ops` not exposed; RLS on with no policies; grant tests (04-01, 04-03c) |
| T-04-04 | Elevation | cross-tenant enqueue, incl. a dual-clinic user acting in A enqueueing for B (03-07 finding 2) | high | mitigate | tenant from the subject row, required to equal the session's `ctx.tenantId` and be a membership; dual-member spec leg + guard leg 3b; system RPCs service-role only with a closed actor set; writers in non-exposed `private` (04-03a/b) |
| T-04-05 | Tampering | member enqueues arbitrary WhatsApp to any number | high | mitigate | recipient must be the patient's (or guardian's) number; template allow-list; params ≤ 4 KB; member INSERT and claim revoked (04-03a, 04-03c); per-role send rules in V2-12 (P1-13) |
| T-04-06 | Tampering | member forges webhook events to integrators | medium | mitigate | closed event set; event data built in SQL from the subject; `ping` owner/admin only; delivery rows write-locked to RPCs (04-03b, 04-03c) |
| T-04-07 | Tampering | duplicate patient messages | high | mitigate | SKIP LOCKED claim + lease token fencing + delivery-row claim + dedupe keys; parallel test (04-01, 04-03a) |
| T-04-08 | Repudiation | MSG91 retries or replays re-run side effects | medium | mitigate | inbound dedupe table, monotonic DLR, status-guarded actions, reply dedupe keys (04-03c) |
| T-04-09 | DoS | poison job crash loop | medium | mitigate | attempts counted at claim, dead after `max_attempts`, `dead_letter` alert (04-01, 04-04) |
| T-04-10 | Info disclosure | PHI in job payloads, `last_error`, runner responses, alerts, reports | high | mitigate | ids-only payloads; error codes via `errorTag`; unmatched-reply phone erased at finish; counts-only alerts and report; tests seed synthetic PII and assert absence (04-01, 04-03c, 04-04, 04-06) |
| T-04-11 | Info disclosure | backup exfiltration | critical | mitigate | age to two recipients before upload; SSE-KMS CMK; Block Public Access; TLS-only policy; writer `PutObject` only; evidence role lists names/sizes only (04-05a) |
| T-04-12 | Tampering | backup deletion or overwrite | high | mitigate | versioning; writer lacks `Delete*`; lifecycle is the only expiry; noncurrent versions kept 1 day (04-05a) |
| T-04-13 | Info disclosure | drill restores `cron`/`net` rows and calls staging from a laptop | medium | mitigate | excluded from the data dump; drill check asserts `cron.job` and `net.http_request_queue` empty (04-05a) |
| T-04-14 | Info disclosure | keys or real dumps inside an agent session | high | mitigate | the PO runs the staging drill; Claude verifies evidence files only; `run.sh` refuses dump/identity paths inside the repo (04-05a, R-29) |
| T-04-15 | Elevation | evidence role assumed from a PR workflow | high | mitigate | OIDC trust pinned to `environment:staging-readonly` + audience; workflows have no `pull_request` trigger; V2-03 workflow policy (04-05a, 04-06) |
| T-04-16 | DoS / cost | unmatched senders trigger paid bot replies | medium | accept | one reply per inbound event (dedupe); provider-side rate limits; per-number cooldown belongs to V2-12 governance (P1-13) |
| T-04-17 | Info disclosure | read-only report role reads PHI | medium | mitigate | definer report function returning counts only; role granted only that function; checker fails on PII-shaped strings (04-06) |
| T-04-18 | DoS | ops/cron history fills the 500 MB database | medium | mitigate | `cron-history-cleanup`, `ops.cleanup`, quota alerts at 60 %/70 % (04-02, 04-06) |
| T-04-19 | Spoofing | SSRF / DNS rebinding at webhook delivery | medium | mitigate | the handler delivers through V2-03's `resolveWebhookTarget` (byte-level ranges incl. NAT64/6to4/Teredo) + `postPinned` (connects to the checked address, no redirects) and keeps the subscription-tenant check (03-13d); handler spec asserts each (04-03b) |
| T-04-23 | Repudiation / DoS | Send Email hook replayed or retried on another instance re-sends an auth email | low | mitigate | shared `webhook-id` record after the signature check (fails open, never blocks an email); per-instance memory kept (04-03c, R-43) |
| T-04-24 | Elevation | system client reachable from the public Send Email hook route | medium | mitigate | one confined system function (`features/auth/system.ts`, reason `auth.send_email_hook`) called only after signature verification; ESLint zone for exactly that route with pass/fail fixtures; ADR A3 needs PO confirmation (04-03c) |
| T-04-25 | Tampering | owner edits queue rows (`max_retries`, `status`) for unbounded re-delivery (review E-8) | medium | mitigate | INSERT/UPDATE/DELETE revoked from API roles; `least(max_retries, 5)` in SQL (04-03b, 04-03c) |
| T-04-26 | Info disclosure / misconfiguration | weak or whitespace-padded secrets, loopback or userinfo URLs and local-stack keys accepted in deploy tiers; staging names leaking into the test lane; DB passwords in argv; migrations approved without a visible plan | low | mitigate | env schema refusals, test-lane guard markers, password-free CLI URLs with `PGPASSWORD`, `plan` job before `migrate` (04-00, R-47) |
| T-04-20 | Elevation | drill kinds or `ops.drill_enqueue` usable in production | medium | mitigate | `JOBS_DRILL_ENABLED=true` forbidden in production by the env schema; `drill_enqueue` executable by `postgres` only (04-02, 04-04) |
| T-04-21 | Elevation | request path imports runner internals, the provider or the webhook deliverer | high | mitigate | ESLint rules with bypass fixtures; register shrunk to `/api/v1` (04-02, 04-03a/b/c) |
| T-04-22 | Info disclosure | alert email body | low | mitigate | rule names, counts, timestamps, ids only; escaping; test with seeded synthetic PII (04-04) |
| T-04-SC | Tampering | npm install and downloaded tools/images | high | mitigate | research legitimacy audit; exact pin `msw@3.0.3` (SUS → PO confirmation 04-P15); age release SHA-256 check; image digests; SHA-pinned actions; `npm audit signatures` |

## Risks

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| K-1 | pg_cron or pg_net unavailable on staging Free (A1) | L | H | 04-P1 before the staging apply; the migration fails loudly; C22 is locked, so an absence goes to the PO with the TARGET §3.6 alternative (Vercel Cron) as the option to decide |
| K-2 | Existing specs encode inline dispatch (pitfall 9) | H | M | rewritten in the plan that changes the contract; FLOOR arithmetic recorded |
| K-3 | CI cannot reach the app from the DB container (pitfall 6) | H | L | DB half and route half tested separately; macOS end-to-end evidence; staging report (R-21) |
| K-4 | Two local stacks exhaust memory on a laptop or runner | M | M | the drill stack runs only db/auth/storage and stops after each run; nightly job has its own runner |
| K-5 | Supabase Storage S3 protocol not available on Free (A3) | L | M | answer in 04-P4; fallback is a supabase-js listing/download sync in `backup.sh`'s storage step, shipped on the follow-up branch with a test |
| K-6 | Service-version skew between staging and the local drill stack breaks COPY into `auth`/`storage` | M | M | runbook step pins the drill stack's service versions to staging's; the self-test catches local skew nightly |
| K-7 | CodeBuild runtime details unproven until the first run (A4, A5) | M | M | first build in 04-P5; fixes on `v2/phase-04-backup-fixes` with regression tests |
| K-8 | Staging acceptance needs ≥ 48 h of wall-clock running | H | L | post-merge "pending PO" items (R-19 pattern) |
| K-9 | Vercel function duration below the runner budget (A9) | L | M | lower `budgetMs`; batches shrink, correctness unchanged |
| K-10 | MSG91 has no idempotency key (A6): a crash after the call re-sends | L | M | at-least-once with `outcome_unknown` recorded; 240 s reap window; R-7 |
| K-11 | V2-03 outputs differ from its plan (accessor names, `EmailSender` API, `tests/helpers/sql.ts`, ESLint structure) | L | M | revision 2026-11-13 aligned this plan with what V2-03 shipped; a V2-03 close fix that lands after this revision is adopted as merged; stop and raise if it contradicts an approved decision |
| K-14 | Parallel wave-1 migrations collide on `expected-migration.ts`, the snapshot and the shared stack | H | L | R-45: per-plan values, reconciled in the wave-merge commit; partner applies with `migration up --local`; full lane re-run after the merge |
| K-15 | The V2-03 close adds a migration after this revision (000031 taken) | M | L | numbering is "next free" (R-39); immutability gate with `--against origin/feature/v2` catches a collision |
| K-12 | `supabase db diff --local` reports new false positives after enabling pg_cron/pg_net | M | L | allowlist line with its cause in `scripts/ci/local-drift.mjs` + spec case (04-02) |
| K-13 | Staging messages lost in the deploy window between app and migration | M | L | synthetic data only; runbook orders approve-migrate then redeploy (R-38) |

## Rulings (agent acting as CTO under PO delegation; PO confirms at the gate, 04-P14)

| # | Decision | Rationale |
|---|---|---|
| R-1 | Alerts by email only: app alerts through V2-03's `EmailSender` to `OPS_ALERT_EMAIL`; backup alerts through AWS SNS email to the same inbox (independent path) | No new vendor or WhatsApp template (PO-23(h)); email already the ops channel |
| R-2 | Retention: jobs done/cancelled 7 d, dead 30 d (TARGET §8); runner runs 14 d; `cron.job_run_details` 7 d; inbound events 30 d; resolved alerts 180 d; heartbeats 90 d; quota snapshots and backup runs 400 d; error events 180 d; backups 30 d (locked) | Bounded growth on a 500 MB database; forensic window for alerts |
| R-3 | age with two recipients (primary in the PO's password manager, break-glass sealed offline), separate pairs per environment; SSE-KMS with a customer-managed key and bucket key | Losing one key never loses backups; KMS use is auditable and restrictable |
| R-4 | RPO ≤ 12 h and RTO ≤ 4 h are the pass criteria; actuals recorded per drill; two consecutive failed runs or a failed drill is an early-upgrade trigger (§9.1 item 3) | Roadmap targets, validated by drills |
| R-5 | Thresholds: `queue_lag` warn when p95 > 2 min over 15 min; `queue_oldest_due` critical > 5 min; `runner_stale` critical after 5 min; `dead_letter` warn on any in 15 min; `lease_expiry` warn > 3 in 15 min; `error_burst` warn > 20 in 10 min; `backup_stale` critical at 13 h; `heartbeat_gap` warn at 7 h; quota at 60 %/70 %; cooldown 60 min; auto-resolve after 2 clean evaluations | Matches the lag acceptance and the 12-hour backup cadence with margin |
| R-6 | **Revised 2026-11-13.** Enqueue RPCs derive the tenant from the subject row; they take `p_tenant_id` = `ServiceContext.tenantId` (session-derived) only as a constraint the subject must match, plus membership; mismatch → not found. Proposed as ADR-0005 amendment A2 (replaces D3's "accepts no tenant argument"), not applied | V2-03 03-07 finding 2: "any membership" let a dual-clinic user acting in A write B rows (guard leg 3b). Multi-clinic users have no database-side active tenant until V2-05 (`lib/auth/tenant.ts` uses the `clinic_active_tenant` cookie) |
| R-7 | At-least-once delivery with dedupe keys; `ops.jobs.dedupe_key` NOT NULL UNIQUE (TARGET's `NULLS NOT DISTINCT` on a nullable key would allow one NULL table-wide; erratum proposed); an unknown outcome after a crash is retried and recorded `outcome_unknown` | Exactly-once is impossible without provider idempotency (A6); claim + fencing + delivery claim give exactly-once in normal operation |
| R-8 | Quota snapshot daily with alerts on crossing, plus a weekly summary email | Satisfies "weekly job" and warns earlier at negligible cost |
| R-9 | Staging uses a `sink` messaging provider (no network, no phone numbers); real MSG91 only in V2-12 | CLAUDE.md forbids real sends from scripts; lag is measured with synthetic jobs |
| R-10 | Runbook at `docs/runbooks/backup-restore.md`; the two old backup docs get a pointer and lose their unverified claims | Roadmap path; INFRA F-4 |
| R-11 | Until V2-05's generated pgTAP matrix exists, the drill runs `supabase/tests/restore_drill_checks.sql` (RLS on every public table, policy/function/user counts, tenant isolation probe, empty cron/net) | The roadmap's "pgTAP RLS suite" does not exist yet; V2-05 swaps it in |
| R-12 | Kick every minute; no `after()` kick in V2-04 (one dispatch path); revisit for bot replies in V2-12 | p95 < 2 min is met by a 1-minute kick |
| R-13 | No pgmq | No dedupe key or tenant fairness; needs an exposed schema |
| R-14 | ~~Backup runs in CodeBuild triggered by EventBridge Scheduler, one CloudFormation stack per environment, deployed by the PO from CloudShell~~; Claude never holds AWS credentials. **Superseded for staging (erratum 2026-11-14, 04-07c):** PO decision 2026-11-13: staging backups run in GitHub Actions (`backup.yml`, Environment `staging-backup`, R-48) to Cloudflare R2; the CodeBuild/EventBridge/CloudFormation design is kept for production in `docs/ops/backup-aws-golive.md` (V2-15) | Managed, no host or VPC; PO-23(h) |
| R-15 | `msw` 3.0.3 as an exact devDependency for the MSG91 contract tests; PO confirms the SUS pin before merge (04-P15) | TEST_STRATEGY T-09; older pin resolves the recency flag |
| R-16 | ~~Revoke `PUBLIC, anon, authenticated` on every `net` object~~ (not buildable: `net` is owned by `supabase_admin`; the revoke clause is superseded by R-49); the scheduler uses a dedicated runner secret, never the service key | pg_net grants API roles by default (local probe); Supabase's queue-exposure warning |
| R-17 | pg_net `timeout_milliseconds` 30 000; runner budget 25 s; `maxDuration` 60; lease 120 s; provider timeouts 10 s (`MESSAGING_PROVIDER_TIMEOUT_MS`, V2-03) and 5 s (`WEBHOOK_TIMEOUT_MS`, V2-03) | pg_net's 2 s default would time out every call (pitfall 1); lease ≫ budget ≫ handler (pitfall 2) |
| R-18 | Constant-time bearer compare (SHA-256 + `timingSafeEqual`) with current/next secrets on `/api/jobs/run`; the `!==` cron routes are deleted | Closes RL-23 (re-checked at V2-03 close: both cron routes still compare with `!==`) |
| R-19 | Fix the silent drop of webhook events for doctor/receptionist actions by reading subscriptions as definer inside the enqueue RPC | Latent defect found in research |
| R-20 | **Revised 2026-11-13.** `Msg91Provider` honours the runner's abort signal and classifies failures retryable/non-retryable; every `retryable: false` result (incl. `disabled` and the synthetic-number refusal) dead-letters at once | V2-03 03-13d already added the 10 s bound and the synthetic refusal; without classification a 4xx or a `disabled` refusal retries to `dead_letter` while sending nothing (03-01 handover) |
| R-21 | CI cannot test pg_net → app end to end; the DB half and the route half are tested separately, the full path once locally on macOS (`scheduler-local-e2e.ts`) and on staging (ops report) | `host.docker.internal` is absent on Linux runners; the e2e server binds loopback |
| R-22 | Names follow TARGET §8: table `ops.jobs`, RPC `claim_jobs`, status `done` | Avoids an erratum; `ops` keeps it out of PostgREST |
| R-23 | Delivery tables keep their per-message backoff and terminal states; jobs follow `next_retry_at`; job `max_attempts` = delivery `max_retries + 2`; jobs are created by AFTER INSERT triggers on the delivery tables | One retry authority per kind; reuses tested SQL (000024); every insert path (including 03-07's `record_payment`) gets a job atomically |
| R-24 | User enqueue: recipient must be the patient's (or guardian's) number, template from an allow-list; business dedupe keys only for system-originated lifecycle messages; user-initiated sends keep per-row keys until V2-07 command ids | Removes the "send anything to anyone" surface the runner would otherwise create; avoids suppressing deliberate re-sends |
| R-25 | Bot replies go through the queue and therefore appear in the communication log; the unmatched-sender reply is a tenant-less job whose phone is erased when it finishes | One dispatch path; retries; minimal PHI at rest |
| R-26 | Webhook events: closed set, data built in SQL from the subject (payload fields unchanged); the developer-settings test ping becomes queued with the copy "Test ping queued. The result appears in Delivery logs within about a minute." | No synchronous dispatch from a request; integrators cannot be fed forged data |
| R-27 | `CRON_SECRET` stays, only as the bearer of V2-03's diag route (R-18 there); the runner uses `JOBS_RUNNER_SECRET` | Retiring it would reopen V2-03's diag route and PO actions 03-E4/E9 (research had proposed retiring it) |
| R-28 | Staging evidence comes from a scheduled read-only workflow (`ops-report.yml`, Environment `staging-readonly`) calling a counts-only report function; Claude reads artifacts only | Tool-produced evidence (DoD 5) without agent access to hosted databases |
| R-29 | The staging restore drill is run by the PO on their machine; Claude verifies the evidence file by tool; the drill verifies Storage objects by size and SHA-256 against restored metadata rather than re-uploading them | Keys and real dumps never enter an agent session; local stacks are not a Storage restore target |
| R-30 | **Not built (erratum 2026-11-14, 04-07c; follows R-14's supersession):** ~~The CloudFormation template is JSON rendered from TypeScript with the scripts embedded (deterministic base64 lines), checked in CI with `--check`; no `cfn-lint`; the PO runs `validate-template`~~ (re-decided with the production backup target, V2-15) | No new dependency; one source of truth for the script that runs locally and in AWS |
| R-31 | Local stand-ins: the local Supabase Storage S3 endpoint as the bucket via a digest-pinned `amazon/aws-cli` image; age from a checksum-verified release; `psql` from a digest-pinned `postgres:17` image | PO direction; no AWS SDK or host tool drift |
| R-32 | Drill job kinds exist only with `JOBS_DRILL_ENABLED=true` (default false, forbidden in production); `ops.drill_enqueue` executable by `postgres` only | Staging drill without a production surface |
| R-33 | The messaging provider factory and the webhook deliverer are importable only from `lib/jobs/internal/**` (ESLint, fixtures); `sendDirectSms`/`sendDirectWhatsApp` deleted | "No request path dispatches" becomes a structural property, not a convention |
| R-34 | The roadmap's "confirmed on the staging Free project before the scheduler migration merges" is satisfied at the staging apply: the PO runs 04-P1 before approving the first `staging.yml` migrate run that contains the scheduler migration; merging into `feature/v2` is not blocked | PO direction 2026-11-13 (external confirmations never block); staging migrations already need the PO's approval (V2-03 R-9) |
| R-35 | Dead-letter replay is `ops.replay_job(id)` (postgres only) plus a runbook; no admin UI in V2-04 | TARGET §8 allows "admin UI or script"; UI belongs to platform admin (V2-13c) |
| R-36 | Alert rules live in `ops.alert_rules`; failed `alert.notify` jobs never raise `dead_letter`; unsent alerts stay visible in the report | Prevents alert recursion; later phases add rules by migration |
| R-37 | Plan split: 04-03 → 04-03a/b/c, 04-05 → 04-05a (code, in phase) + 04-05b (hosted, post-merge); the staging report is folded into 04-06; review fixes go to 04-07 | One implementer session per plan; file-disjoint waves |
| R-38 | The contract migration (member claim/insert revoked, delivery table write-locked, backfill) ships in the same PR as the expand migrations | No environment runs pre-V2-04 code with real users (staging synthetic; production created fresh in V2-15) |
| R-39 | Migration numbers are the next free numbers after V2-03 (000031…000039 if V2-03 ends at 000030), assigned per plan in the stated order | Immutability check (`--base auto --against origin/feature/v2`) rejects reuse or out-of-order numbers |
| R-40 | V2-03 R-10 (SES bounce/complaint webhook "deferred to V2-04") is re-homed to V2-12 (messaging governance, where per-recipient suppression lives); SES account-level suppression covers the gap; the only V2-04 email goes to one PO-owned inbox | Not in V2-04's roadmap scope; it touches the auth email path and needs SNS signature verification |
| R-41 | **Revised 2026-11-13.** `/api/ready` gains four booleans (`jobs_backlog`, `jobs_dead_24h`, `runner_stale`, `alerts_critical_open`), each an indexed `EXISTS` in the anon-only `readiness_probe(p_expected_migration)`; no counts or ages; the backup job doubles as a dead-man check for the runner | V2-03 M-PROBE made the public probe booleans-only (no cross-tenant counts, no version to anon); if the runner dies, in-app alert delivery stops, and these give the AWS path and the V2-15 uptime monitor a signal |
| R-42 | Raised for V2-15, not decided: production restore drills put PHI on the drill machine — recommend an ephemeral encrypted EC2 instance in `ap-south-1` (or the PO's FileVault laptop with deletion after) | PO decision at V2-15 |
| R-43 | **New 2026-11-13.** The Send Email hook dedupes `webhook-id` in the shared `ops.inbound_webhook_events` store (provider `supabase_auth_hook`) through one system function in `features/auth/system.ts`, called after the signature check; fails open; per-instance memory kept. Needs ADR-0005 amendment A3 (proposed) | 03-11b/03-13a handed the shared store to the V2-04 outbox; ADR-0005 D2 does not list `app/api/auth/**` as a system importer; the route is signature-authenticated server-to-server like `app/api/webhooks/**`; an anon-callable dedupe RPC would let anyone fill the table |
| R-44 | **New 2026-11-13.** Outbox/enqueue writers are SECURITY DEFINER functions in the non-exposed `private` schema (`private.enqueue_message_internal`, `private.enqueue_webhook_internal`), not `ops`; EXECUTE revoked from API roles in V2-04 | V2-03 03-07 pattern (`private.outbox_payment_recorded`); `private` already has USAGE for `authenticated`/`service_role`, so V2-07 INVOKER commands can be granted a writer later without moving it; `ops` stays closed to every API role |
| R-45 | **New 2026-11-13.** Every migration commit carries the `EXPECTED_MIGRATION` bump, the regenerated `scripts/drift/schema-snapshot.txt` and `db:types`; in the parallel wave 1 each plan commits its own values and the orchestrator reconciles them in the merge commit (higher number, snapshot after a reset with both files, full lane re-run) | V2-03 03-13b/03-13c CI gates; wave partners must stay file-disjoint |
| R-46 | **New 2026-11-13.** Error-sink alert rules: `error_sink_overflow` (warn: any dropped events today or yesterday) and `error_sink_size` (warn: > 50 MB); retention purge at 180 days by `ops.cleanup` | 03-09b handover; the 500-fingerprint daily cap silently drops events, and the table counts against the 500 MB Free database |
| R-47 | **New 2026-11-13 (04-00).** Review A Lows closed as: secrets empty after `trim()` are unset and padded secrets refused; loopback = 127/8, 0.0.0.0, `::1`, `::`, `::ffff:127.*`, `localhost.`/`*.localhost`, and deploy-tier Supabase/app URLs must be bare origins; the CLI's local opaque keys refused by SHA-256 digest (no literal in source) on the server parse path; `STAGING_*` names and `sb_secret_`/`sb_publishable_` values refused in the test lane; `wait-for-release` accepts a descendant release; a `plan` job (script over the RO URL, not `db push`) precedes `migrate`; CLI DB URLs carry no password (`PGPASSWORD`), or L-7 is accepted with local evidence if the CLI ignores it | Triage owner V2-04 (04-00); V2-04 edits the same env schema and staging workflows; agents may not run `db push`, so the plan must be a testable script |
| R-48 | **New 2026-11-13 (04-05a, orchestrator as CTO).** Scheduled staging backups run in a GitHub Environment `staging-backup` with no required reviewer, deployment branches `feature/v2` only, holding only the backup secrets/vars (`BACKUP_S3_*`, `BACKUP_AGE_RECIPIENTS`, `STAGING_STORAGE_S3_*`, `STAGING_BACKUP_DB_URL`); `workflow-policy.mjs` allows it in `backup.yml` only (`staging-backup-environment-scope`). The DB URL is the `postgres` session pooler URL, not the read-only role (`supabase db dump` sets `ROLE postgres`; the job writes `ops.backup_runs`). Accepted risks, owner V2-15/go-live: no R2 versioning, the R2 token can delete, no India region, a `postgres` staging URL in a reviewer-free Environment (staging data is synthetic) | Scheduled backups must not wait for a human; the job only reads synthetic staging data and writes age-encrypted objects; migrations and seeds stay behind the reviewed `staging` Environment |
| R-49 | **New 2026-11-13 (04-02, orchestrator as CTO; row added by erratum 2026-11-14, 04-07c, review IND L7: it was cited in code, the runbook and PO-ACTIONS but missing here).** Supersedes R-16's revoke clause, which cannot be built (`net` objects are owned and granted by `supabase_admin`; `postgres` is not superuser, so the revoke is a no-op, `evidence/04-02/pg-net-revoke-probe.txt`). The runner secret never leaves the database: `ops.kick_job_runner()` (migration `000034_jobs_runner_token.sql`) sends `Bearer v1.<unix_ts>.<hex hmac_sha256(secret, 'jobs-run\|v1\|' \|\| unix_ts)>`; `/api/jobs/run` accepts a token within ±120 s signed with the current or next secret and refuses the raw secret. Accepted residual: any database login role can read a queued token (sub-second) and replay it for 120 s, which only triggers an idempotent runner pass. Staging and production use separately generated secrets (the token is not bound to an environment; 04-07 triage, `docs/runbooks/jobs.md` §2) | A leaked token is short-lived and grants nothing but an idempotent pass; the secret itself is never on the wire or in `net` |
| R-50 | **New 2026-11-13 (04-04 D5, orchestrator as CTO).** `backup_stale` also fires when the latest `ops.backup_runs` row is `failed` (not only when no `ok` run in 13 h), so a deliberately failed run raises the app alert at once; the GitHub-side backup alert stays the independent channel | Roadmap V2-04 "a deliberately failed run raises an alert" |
| R-51 | **New 2026-11-13 (reverses 04-04 D7, orchestrator as CTO).** Alerts are at-least-once: an open alert whose notification was never recorded as sent (its `alert.notify` job died: provider down, channel unconfigured) is enqueued again by the next evaluation at least 15 minutes after the previous try, while no try of it is pending or running, until `notified_at`/`notify_count` record it (dedupe `alert:<id>:<n>:r<try>`). Still one email per successful notification: the handler sends nothing for an `n` already recorded and passes the provider idempotency key `ops-alert/<id>/<n>` | A provider outage must not silently swallow an alert; the 15-minute floor keeps a broken channel from flooding the queue (R-36) |

## Deviations from the research and the roadmap

**Roadmap:** plan split and an extra post-merge track (R-37); pg_cron/pg_net confirmation moved from "before merge" to
"before the staging apply" (R-34); staging-only acceptance items 3-8 close after merge as "pending PO"; the "pgTAP RLS
suite" is the drill check file until V2-05 (R-11); FT-04 "weekly job" runs daily plus a weekly summary (R-8);
`/api/ready` gains counts (R-41).
**Research:** names aligned with TARGET §8 (`claim_jobs`, `done`; R-22); jobs created by delivery-table triggers and
delivery tables keep their own backoff (R-23); `CRON_SECRET` kept (R-27); user enqueue restricted to the patient's
number and allow-listed templates, webhook data built in SQL (R-24, R-26); webhook delivery table write-locked (R-38);
the staging drill run by the PO and objects verified rather than re-uploaded (R-29); template as rendered JSON instead
of YAML with an inline buildspec (R-30); staging evidence through a read-only workflow instead of pasted SQL (R-28);
`psql` and the AWS CLI via pinned images (R-31); lease expiries counted with `last_lease_expired_at`; SES bounce
webhook re-homed (R-40).
**V2-03 as shipped (revision 2026-11-13):** enqueue takes the active tenant as a constraint (R-6 revised, ADR A2 text
changed); writers in `private` (R-44); readiness flags are booleans (R-41 revised); provider timeouts, SSRF pinning,
tenant check and jobs lint rules reused rather than built; `sendDirect*` deleted in 04-03c, not 04-03a; Send Email hook
dedupe added (R-43, ADR A3); error-sink alerts added (R-46).

**Errata 2026-11-14 (04-07c, review IND L7 and C; recorded in `04-07c-OPS-FIXES.md`):** (1) staging backups were built
on GitHub Actions + Cloudflare R2 (PO decision 2026-11-13, R-48), not EventBridge → CodeBuild → S3 `ap-south-1`: R-14 is
superseded for staging and R-30 not built, `stack.template.ts`/`render.ts`/`stack.json`/`backup-evidence.yml` do not
exist (the AWS design is `docs/ops/backup-aws-golive.md`, V2-15), and the roadmap's V2-04 text received the same
erratum; (2) the R-49 row was missing from the rulings table (added); (3) `backup-alert.yml` uses a `workflow_run`
trigger, which 04-05a's workflow rule ("never `workflow_run`") excluded for staging workflows: it holds no secret, checks
out only the issue picker and has `issues: write` only, and since 04-07c it is pinned by path, head repository and
schedule/dispatch event (workflow-policy `workflow-run-pinned`); (4) the header of the applied migration
`000032_ops_backup_runs.sql` still says "AWS CodeBuild" and "SNS": applied migrations are never edited, this note is the
correction; `ops/backup/backup.sh`'s header now names Environment `staging-backup`.

## Open for the PO (not blocking)
1. 04-P14: confirm the rulings, especially R-6 (revised; ADR A2), R-26, R-27, R-34, R-38, R-40, R-41 (revised), R-43
   (ADR A3), and the CLAUDE.md Commands update.
2. Start the AWS track now (04-P2 → P3 → P7 → P4 → P5 → P6); it has the longest lead time.
3. 04-P15 before merge; 04-P1 and P8…P13 after merge.

