---
phase: 04
plan: 04-06
subsystem: ops (heartbeat FT-03, quota monitor FT-04, retention R-2, staging ops report R-28)
status: complete
requirements: [FT-03, FT-04 (job part), V2-03-R-27]
plan_head_before: 9581c62ee61f351877e131baabef854fd6be114b
commits: [5285444, 192ffba, c622bcf, 155077f, docs commit]
---

# 04-06 record: heartbeat (FT-03), quota monitor (FT-04), ops retention, staging ops report

**Outcome:** done locally. pg_cron writes a heartbeat every 6 hours and `heartbeat_gap` fires when the newest is over
7 hours old; a daily quota snapshot measures database bytes, Storage bytes and an MAU estimate against the Free limits.
At 60 % it raises `quota_upgrade_trigger` (warn), at 70 % `quota_critical` (critical). Every Monday one summary email
goes out through 04-04's `alert.notify` path. `ops.cleanup()` applies R-2 retention to every `ops` table and schedules
V2-03's error-event purge (R-27). `ops.report_all()` is the counts-only staging report. A daily read-only workflow
(`ops-report.yml`, Environment `staging-readonly`) fetches it with a script that refuses any non-read-only credential and
checks it for schema and PII. Nothing contacted a hosted Supabase project, Vercel, Resend or GitHub settings. No
workflow was dispatched. No `--linked`, no `db push`, no `.env*` read, no dependency added. Base `9581c62`.

## What shipped

| Commit | Content |
|---|---|
| `5285444` | Migration **`000040_ops_heartbeat_quota_report.sql`** (plan: 000039, which went to 04-04), `EXPECTED_MIGRATION = "000040"`, `scripts/drift/schema-snapshot.txt` regenerated after `db reset --local` (types unchanged: `ops` only; `db:drift:local` PASS); `scripts/ops/ops-report.mjs`, `scripts/ops/check-ops-report.ts`, `tests/ops/fixtures/ops-report-pass.json`; tracer `tests/ops/ops-report-db.spec.ts`; `tests/jobs/alerts-db.spec.ts` (baseline empties heartbeats/snapshots; 13 rules) |
| `192ffba` | `lib/jobs/internal/handlers/alert-notify.ts`: quota level words under `*_level` keys, `RULE_NOTES` (weekly egress reminder, quota notes); `tests/ops/quota-alert-email.spec.ts` |
| `c622bcf` | `tests/ops/{quota-level-db,heartbeat-quota-db,ops-cleanup-db,check-ops-report}.spec.ts` |
| `155077f` | `.github/workflows/ops-report.yml`; `scripts/ci/workflow-policy.mjs` rules `staging-readonly-secrets-ro`, `staging-feature-v2-only`, `ops-report-read-only`; cases in `tests/ci/workflow-policy.spec.ts`; `lint-fixtures/workflows/{clean,staging-pull-request}.yml` gain the feature/v2 `if:` |
| docs commit | `docs/runbooks/jobs.md` §8 (pointer), §12 (four rules + response sections, cooldowns), new §13 (schedules, heartbeat, quota, weekly summary, retention table, ops report, 04-P10 grant SQL, workflow, exit meanings, verify commands); this record; wave notes; evidence |

### Migration 000040

| Object | What |
|---|---|
| `ops.heartbeats(id, source pg_cron\|manual, at)` + `ops.heartbeat()` | cron `ops-heartbeat` `0 */6 * * *` (05:30/11:30/17:30/23:30 IST) |
| `ops.settings(key, value)` (`plan = free`), `ops.quota_limits(plan, metric, limit_value)` | Free: `db_bytes` 500 000 000, `storage_bytes` 1 000 000 000, `mau` 50 000 (decimal, conservative) |
| `ops.quota_level(used, limit)` (IMMUTABLE) | null/≤ 0 limit or null used → `unknown`; `used*100 >= limit*70` → `critical`; `>= limit*60` → `upgrade_trigger`; else `ok` (exact numeric) |
| `ops.quota_snapshots(at, plan, db_bytes, storage_bytes, mau_estimate, limits, levels)` + `ops.quota_snapshot()` | `pg_database_size`, `sum(storage.objects.metadata->>'size')`, users with `last_sign_in_at` in the current UTC month; cron `ops-quota-snapshot` `30 21 * * *` (03:00 IST) |
| `ops.quota_details(id)` | flat alert details: `snapshot_at`, `<m>_bytes/limit/percent/level` per metric (numbers, ISO timestamp, level words) |
| Rules (INSERT into 04-04's `ops.alert_rules`) | `heartbeat_gap` warn (`max_age_minutes` 420, cooldown 6 h); `quota_upgrade_trigger` warn (newest snapshot has a 60 % metric and none at 70 %, 24 h); `quota_critical` critical (any 70 % metric, 24 h); `quota_weekly_summary` info (fires while this week's summary is open and unsent, ≤ `deliver_hours` 24; cooldown 7 d) |
| `ops.enqueue_quota_weekly_summary()` | cron `ops-quota-weekly-summary` `30 3 * * 1` (Mon 09:00 IST): evaluator's advisory lock; null when this ISO week (Monday 00:00 UTC) has one or the rule is disabled; closes a stale open one; fresh snapshot; one `info` alert + `alert.notify` job `alert:<id>:1` set up exactly as the evaluator does |
| `ops.cleanup()` | cron `ops-cleanup` `45 21 * * *` (03:15 IST); retention table in runbook §13; keeps the newest heartbeat, snapshot, ok runner pass and backup run per environment; calls `ops.purge_error_events('180 days')`; returns counts |
| `ops.report_all(p_hours 1..336)` | definer, STABLE; keys `report_version, generated_at, window_hours, jobs{by_kind_status, lag{samples,p50,p95,max}}, dead_last_24h{total, by_kind}, runner{configured, runs, ok_runs, largest_ok_gap_seconds, last_ok_age_seconds}, alerts[≤100]{rule, severity, status, opened, last_seen, resolved_at, count, notified, notify_count, notify_tries, unsent, provider_id_present}, heartbeats{count, at[], largest_gap_seconds, covered_seconds, last_at}, quota, backups[≤200]{environment, started_at, finished_at, status, archive_bytes, duration_s, error_code}, tables{…row counts}` |

All tables: RLS on, no policy, every privilege revoked from `PUBLIC, anon, authenticated, service_role` (sequences
too). All functions: `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`; the rule functions, snapshot,
weekly, cleanup and report are SECURITY DEFINER with `search_path = ''`.

### Rule registry (as 04-04's table)

| Rule | Severity | Fires when (defaults) | Cooldown |
|---|---|---|---|
| `heartbeat_gap` | warn | heartbeats exist and the newest is older than 420 min | 6 h |
| `quota_upgrade_trigger` | warn | newest snapshot: some metric `upgrade_trigger`, none `critical` | 24 h |
| `quota_critical` | critical | newest snapshot: some metric `critical` | 24 h |
| `quota_weekly_summary` | info | this week's summary alert is open, unsent and < 24 h old | 7 d |

### Report fetch and checker

- `scripts/ops/ops-report.mjs --out <file> [--hours 48]`: (1) `target-guard` (staging project only); (2) the URL user must
  be `clinicos_drift_ro` or `clinicos_drift_ro.<ref>`, else exit 2 before any process starts; (3) `docker run --rm
  --read-only -e PGHOST … -e PGPASSWORD …` with the digest-pinned `POSTGRES_IMAGE` (`ops/bin/pins.env`), values only in
  the spawn environment (no URL or password in argv); psql `-X -qAt`: `begin read only` → `READ_ONLY_GUARD_SQL` (a DO
  block that raises `ops_report_role_not_read_only: <reason>` for a non-read-only transaction, any of
  superuser/createrole/createdb/replication/bypassrls, any role membership, a write privilege on any table in a usable
  schema except pg_net's `net`, or a create privilege on the database or a schema) → `select ops.report_all(48)` →
  `rollback`; (4) exactly one JSON object line is written; messages are fixed (refusal reason, the 04-P10 hint, line
  count).
- `scripts/ops/check-ops-report.ts <file> [--require …] [--out …]`: strict zod schema (exact keys, kinds
  `^[a-z]+(\.[a-z_]+)+$`, rule names, status enums, ISO UTC timestamps, non-negative counts, level enum); PII scan of
  every string and key (10+ digit phone, email, UUID), naming the path, never the value; requirements as data: `lag`,
  `heartbeat`, `quota`, `alert-drill`, `backups` (≥ 2 ok staging backups in every full IST day; zero full days = not
  met). Exit 0/1/2.
- `ops-report.yml`: `schedule 0 5 * * *` + `workflow_dispatch`, `permissions: contents: read`, job `if` feature/v2,
  Environment `staging-readonly`, SHA-pinned checkout/setup-node/upload-artifact (the pins `drift.yml` uses), `npm ci
  --ignore-scripts`, no cache, target guard `--mask`, secrets only in the two steps' `env`, no `${{ }}` in `run:`,
  artifact `ops-report` 30 days. `node scripts/ci/workflow-policy.mjs`: PASS (7 workflows).

## Tests that fail without the change

`evidence/04-06/before-vitest.txt`: the new and changed specs on pre-plan `9581c62` (throwaway worktree, stack reset to
000039; copied files listed in its header): **8 of 8 files fail, 84 tests** (the 47 passing are the unchanged
policy/alerts cases in the two changed files and the one renderer case that holds before the change).

| Spec | Proves |
|---|---|
| `tests/ops/ops-report-db.spec.ts` (tracer, 16) | heartbeat + snapshot rows read back by `report_all` and accepted by the checker; empty window shape; window bounds; **synthetic phone (both forms), email, patient name and tenant id seeded into the message queue, a job payload/error and the inbound store never appear, no UUID at all**; lag p50 55 / p95 95.5 / max 100 over 10 seeded lags (old and moved rows excluded); heartbeat gap 21 600 s / coverage 46 800 s; runner gap 360 s / last ok 180 s; alert delivery facts without details or ids; backups without object keys; definer + no API role + PostgREST refused; **`ops-report.mjs` through the real guard and report on the local database: `postgres` refused (`role_attributes`), a role with a table write (`table_write_privilege`), a role membership (`role_membership`), a schema create (`create_privilege`), a read-write transaction (`transaction_not_read_only`); the runbook-shaped read-only role with the 04-P10 grant gets a report the checker accepts, no password/host in argv, PG* by name; without the grant → the 04-P10 hint** |
| `tests/ops/quota-level-db.spec.ts` (roadmap "quota-threshold unit test", 18) | 299 999 999/500 000 000 ok, 300 000 000 upgrade_trigger, 349 999 999 upgrade_trigger, 350 000 000 critical (and MAU/Storage boundaries); limit 0, −1, null and used null → unknown; IMMUTABLE, no API role; Free limits seeded |
| `tests/ops/heartbeat-quota-db.spec.ts` (14) | `ops.heartbeat()` writes one `pg_cron` row; the four schedules once each as postgres; **7 h 1 min → `heartbeat_gap` (age 421 min), 6 h 59 min / no heartbeat / a fresh one → quiet**; **an object uploaded through the Storage API adds exactly its size**, `db_bytes` ≈ `pg_database_size`, three sign-ins this month count and last month's does not; **65 % of a lowered Free DB limit → only `quota_upgrade_trigger` (warn), 72 % → only `quota_critical`**, details carry levels and percent; a later ok snapshot clears them; critical wins over upgrade; **weekly summary: one info alert + job per ISO week, a second call null, next week a new one, disabled rule none; carries the metrics, levels and ISO week; a dead first try is re-tried as `:r2` after 15 min (R-51)**; **committed through the real handler and Mailpit: exactly one email `[clinicos test] INFO quota_weekly_summary` with the level lines, a percent and the egress note, nothing omitted; two evaluations later resolved, no second job or email**; grants for 4 tables and 12 functions; the four rule rows |
| `tests/ops/ops-cleanup-db.spec.ts` (10) | per table, rows just past the retention go and rows just inside stay (jobs done/cancelled 8 vs 6 d, dead 31 vs 29 d, pending/running never; runner 15+ vs 13 d with the newest ok kept; inbound 31 vs 29 d; resolved alerts 181 vs 179 d, open never; heartbeats 91 vs 89 d and the newest kept when all are old; snapshots 401 vs 399 d, newest kept; backup runs per environment newest kept); error events 181 vs 179 d and old overflow pruned; counts; schedule |
| `tests/ops/check-ops-report.spec.ts` (36) | pass fixture passes every requirement (CLI, tsx); lag 99 samples / p95 120 / none, heartbeat gap 22 501 s / coverage 86 399 s, no quota, un-emailed dead_letter, one ok backup in the full IST day → fail with `--require`, data without; **phone (spaced, bare), email, UUID and phone-shaped key → exit 1, value never printed**; unknown/missing keys, free text kind, non-ISO time, negative count → schema fail; not JSON 1, unreadable/unknown requirement/no file 2; SQL editor export form; IST day edges and a 12 h window; `ops-report.mjs` refuses `postgres` (both host forms), `authenticator`, `supabase_admin`, a look-alike role, loopback, another project, no URL, all before spawning; pinned image and argv shape; refusal/grant/output messages |
| `tests/ops/quota-alert-email.spec.ts` (4) | level words printed only under `*_level` (a name, a rule word or a phone under `*_level`, or a level word under another key: omitted); weekly note in text and HTML before the runbook line; quota notes, no note for other rules or inherited names |
| `tests/ci/workflow-policy.spec.ts` (+7, 2 changed) | committed `ops-report.yml` passes; moved to `staging` → `ops-report-read-only`; `STAGING_DB_URL` (or a non-`_RO` token) in a `staging-readonly` job of ops-report/drift/staging → `staging-readonly-secrets-ro`; no `if`, another branch, a top-level `||`, branch check second → `staging-feature-v2-only` (and on backup/drift/staging); a parenthesised `||` passes; PR trigger, write token, secret in `run:`, `npm ci`, tag pin, npm cache all bite on ops-report.yml |
| `tests/jobs/alerts-db.spec.ts` (changed) | baseline empties the two new tables; the registry lists 13 rules |

Determinism: no sleeps; time moves by SQL; every DB case except the weekly email runs inside `begin … rollback` (the
probe roles too); the committed email case starts from and leaves an empty `ops.alerts`, deletes its snapshots, runner
runs and Mailpit messages.

## Gates (tool output in `evidence/04-06/`)

- `npm run typecheck` clean; `npx eslint .` 0 errors (382 warnings, pre-existing kinds); `npm run inventory` exit 0;
  `node scripts/ci/workflow-policy.mjs` PASS (7); schema snapshot `--check` PASS (2 484 lines); `npm run
  db:drift:local` PASS (0 statements).
- Full Vitest lane run 1 (`vitest-full-run1.txt`, at `155077f`): **201 files, 4 200 passed, 0 failed**; teardown
  verified; `cron.job` 9/9 active afterwards; no `ops.alerts` rows or `alert.notify`/`drill.always_fail` jobs left; no
  `.planning/dev-messages.txt`.
- Full Vitest lane run 2 (`vitest-full-run2.txt`, same tree): **201 files, 4 200 passed, 0 failed**; `cron.job` 9/9
  active; no alert residue.
- `e2e-build.txt`: output scan clean (1 315 files). `e2e-pr.txt` (desktop, Pixel 7, iPhone 15): **196 passed, 9
  skipped, 0 failed, 0 flaky, 0 retried**; the 10 `✘` lines are the known v1 `knownBug` expected failures (as in
  04-04's run). The exit-status lines of these two files were not captured (zsh has no `PIPESTATUS`); the summary lines
  are the tool's.
- gitleaks 8.30.1 (docker, `--network none`) over the full history after the code commits: no leaks found (646
  commits). The first docs commit carried the `supabase start` status banner (local-stack keys) at the top of the
  two run files and gitleaks flagged it; the banner was cut from both files (the Vitest output is unchanged) and the
  unpushed docs commit amended; gitleaks over the full history then: no leaks found.

## Deviations

| # | Plan said | Done | Why |
|---|---|---|---|
| D1 | migration `000039_ops_heartbeat_quota_report` | `000040_…` | next free number (R-39) |
| D2 | `ops.heartbeats(id, source, at)`; heartbeat inserts `pg_cron` | same, `source` CHECK `pg_cron\|manual` | a PO manual row stays distinguishable |
| D3 | quota snapshot columns `at, plan, db_bytes, storage_bytes, mau_estimate, levels` | + `limits jsonb` | the report and the email show percent against the limits that applied at the time |
| D4 | R-5 "cooldown 60 min" | `heartbeat_gap` 6 h, quota rules 24 h, weekly 7 d | a daily metric would be mailed 24 times a day; 04-04 set per-rule cooldowns the same way (`backup_stale` 3 h, `error_sink_size` 24 h) |
| D5 | `quota_upgrade_trigger` "on the newest snapshot" | fires only when no metric is `critical` | one alert per level: at 72 % the PO gets the critical email, not both |
| D6 | weekly summary "resolves on the next evaluation" | rule fires while the summary is open, unsent and < 24 h; resolves two evaluations after it is sent | the evaluator resolves after two clean evaluations (04-04); firing while unsent gives it R-51's at-least-once retry, which a resolved alert never gets |
| D7 | weekly summary "carrying the three metrics, levels and the reminder that egress is the PO's monthly dashboard check" | levels as `*_level` detail words; the reminder is a fixed note in the renderer (`RULE_NOTES`) | 04-04's renderer prints only numbers/booleans/timestamps/UUIDs (T-04-22); a closed set of four level words under `*_level` keys and code-constant notes keep that guarantee. Touches 04-04's `alert-notify.ts` (Rule 2) |
| D8 | ops-report.yml: "the digest-pinned postgres:17 image runs `psql "$STAGING_DB_URL_RO" -Atc …`" | `scripts/ops/ops-report.mjs` runs the pinned image with `PG*` variables passed by name | a URL with its password in `docker`/`psql` argv is what 04-00 L-7 removed; the script also adds the read-only refusals the done list asks for and is testable against the local database |
| D9 | `ops.cleanup()` deletes rows past retention | also keeps the newest heartbeat, snapshot, ok runner pass and backup run per environment | without it a schedule stopped for > 90/400 days would be purged into silence and `heartbeat_gap`/`backup_stale` would resolve |
| D10 | `tests/ci/workflow-policy.spec.ts` "gains a fixture case if the policy needs a new rule" | three rules (`staging-readonly-secrets-ro`, `staging-feature-v2-only`, `ops-report-read-only`), 7 cases, two lint fixtures gain the feature/v2 `if:`, two existing expectations gain the new rule | the user's done list: the workflow must pass the policy as read-only, feature/v2 only, least privilege; the policy had no rule for any of the three |
| D11 | files: `tests/ops/**` only | also `tests/jobs/alerts-db.spec.ts` (baseline + rule list) and `tests/ops/quota-alert-email.spec.ts` | the new rules change the registry 04-04's spec pins; the plan's "Adds alert rules to 04-04's registry table" |
| D12 | — | `ops.report_all` adds `runner.configured`, `alerts[].unsent/notify_tries`, `dead_last_24h.by_kind`, `tables` row counts | R-51 asks the report to show unsent notifications; T-04-18 growth visible in the report |

## Threats

T-04-10 and T-04-17 (counts-only report: the function never reads payloads, details or names; the checker refuses
PII-shaped strings; the DB spec seeds synthetic PII and asserts absence), T-04-15 (the workflow is reviewer-free but
read-only: `staging-readonly`, `*_RO` secrets only, feature/v2 `if`, no PR trigger, enforced by the policy; the script
refuses any credential that can write), T-04-18 (retention on every `ops` table; quota alerts at 60/70 %). No new
network endpoint, route, API-reachable function or env name. New surface: the reviewer-free daily job holds the
read-only DB URL (existing secret, already used by `drift.yml`).

## For the PO

1. **04-P10 (after the migrate run that applies 000040):** staging SQL editor:
   `grant usage on schema ops to clinicos_drift_ro;` and `grant execute on function ops.report_all(integer) to
   clinicos_drift_ro;` (runbook `docs/runbooks/jobs.md` §13). Nothing else for the role. Then GitHub → Actions →
   "Staging ops report" → Run workflow (or wait for 10:30 IST once `feature/v2` is the default branch).
2. **04-P7:** Supabase organisation → billing / notification email = the ops inbox (pause and quota warnings, FT-03).
3. Rulings to confirm at the gate (04-P14): D4 (per-rule cooldowns), D5, D6, D8.

Claude verifies (read-only): `gh run list --workflow ops-report.yml --limit 1 --json conclusion,url,headSha`;
`gh run download <id> -n ops-report`; `npx tsx scripts/ops/check-ops-report.ts ops-report.json --require heartbeat,quota`
after ≥ 24 h; `--require lag,alert-drill` after 04-P12; `--require backups` after the backup runs.

## Notes for 04-SUMMARY / later owners

- DPDP: `ops.error_events.tenant_id`/`user_id` are null by design (03-09b); if a later phase fills them, erasure must
  cover the table.
- MAU is a proxy (sign-ins in the UTC calendar month), not Supabase's billing-cycle figure. Egress is not measured.
- Plan upgrade = a reviewed migration adding the plan's `ops.quota_limits` rows and setting `ops.settings.plan`.
- Close: add `tests/ops/{quota-level-db,heartbeat-quota-db,ops-cleanup-db,ops-report-db,check-ops-report,quota-alert-email}.spec.ts`
  to `REQUIRED_FILES`.

## Known stubs

None. Staging proof (heartbeat over 24 h, quota block, alert drill, lag) is pending PO actions 04-P8…P10 (+ 24 h) and
04-P12, post-merge.
